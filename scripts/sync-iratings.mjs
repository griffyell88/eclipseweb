// ═══════════════════════════════════════════════════════════════════════════
// ECLIPSE PORTAL — WEEKLY iRATING / LICENSE SYNC
// Pulls current Sports Car + Formula iRating and license (letter + SR) from
// the official iRacing Data API for every driver in the portal's driver DB
// that has an iRacing ID filled in, and writes them back to Supabase.
//
// Runs from GitHub Actions weekly (.github/workflows/sync-iratings.yml) or
// by hand:  node scripts/sync-iratings.mjs
//
// SETUP (one-time):
//   1. iRacing account for the sync (your own works):
//      iracing.com → Account → Security → enable "Legacy Read-Only
//      Authentication". (Accounts using 2FA-only can't script logins.)
//   2. Supabase Dashboard → Project Settings → API Keys → copy the
//      service_role (secret) key. NEVER put this in portal-config.js or any
//      file that ships to browsers — it bypasses row-level security.
//   3. GitHub repo → Settings → Secrets and variables → Actions → add:
//        IRACING_EMAIL, IRACING_PASSWORD,
//        SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   Until the secrets exist, the workflow just skips — nothing breaks.
//
// Requires Node 18+ (built-in fetch). No npm dependencies.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';

const {
  IRACING_EMAIL,
  IRACING_PASSWORD,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

for (const [k, v] of Object.entries({ IRACING_EMAIL, IRACING_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(1); }
}

const IR = 'https://members-ng.iracing.com';
let cookies = '';

function rememberCookies(res) {
  const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (set.length) {
    const jar = new Map(cookies.split('; ').filter(Boolean).map(c => c.split('=', 2)));
    for (const c of set) {
      const [pair] = c.split(';');
      const [k, v] = pair.split('=', 2);
      jar.set(k, v);
    }
    cookies = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

async function irLogin() {
  // iRacing legacy auth: password is base64(sha256(password + lowercased email))
  const hash = createHash('sha256')
    .update(IRACING_PASSWORD + IRACING_EMAIL.toLowerCase())
    .digest('base64');
  const res = await fetch(`${IR}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: IRACING_EMAIL, password: hash }),
  });
  rememberCookies(res);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.authcode === 0 || body.authcode === undefined && !cookies) {
    throw new Error(`iRacing login failed (${res.status}): ${JSON.stringify(body).slice(0, 300)} — is Legacy Read-Only Authentication enabled on the account?`);
  }
  console.log('iRacing: logged in.');
}

async function irGet(path) {
  // Data API responds with a { link } envelope pointing at a signed S3 URL.
  const res = await fetch(`${IR}${path}`, { headers: { Cookie: cookies } });
  rememberCookies(res);
  if (res.status === 429) {
    console.log('Rate limited, waiting 30s…');
    await new Promise(r => setTimeout(r, 30000));
    return irGet(path);
  }
  if (!res.ok) throw new Error(`iRacing GET ${path} → ${res.status}`);
  const env = await res.json();
  if (!env.link) return env;
  const data = await fetch(env.link);
  if (!data.ok) throw new Error(`iRacing data link → ${data.status}`);
  return data.json();
}

// license entry → "A 3.61" style string used in the portal
function licString(lic) {
  if (!lic) return '';
  // group_name is e.g. "Class A", "Rookie", "Pro"; safety_rating e.g. 3.61
  const g = String(lic.group_name || '');
  const letter = /rookie/i.test(g) ? 'R'
               : /pro/i.test(g) ? 'P'
               : (g.match(/class\s+([A-D])/i) || [])[1] || g[0] || '';
  const sr = lic.safety_rating != null ? Number(lic.safety_rating).toFixed(2) : '';
  return [letter.toUpperCase(), sr].filter(Boolean).join(' ');
}

function pickLicense(licenses, wanted) {
  // categories today: sports_car / formula_car (post-2023 road split)
  return (licenses || []).find(l => String(l.category || '').includes(wanted));
}

async function main() {
  // 1. Current driver DB from Supabase
  const sbHeaders = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
  const docRes = await fetch(`${SUPABASE_URL}/rest/v1/portal_docs?key=eq.driver_db&select=data`, { headers: sbHeaders });
  if (!docRes.ok) throw new Error(`Supabase read failed: ${docRes.status} ${await docRes.text()}`);
  const rows = await docRes.json();
  const db = rows[0]?.data;
  if (!Array.isArray(db)) throw new Error('driver_db doc missing or not an array — run supabase-setup.sql first.');

  const withIds = db.filter(d => String(d.iracingId || '').trim().match(/^\d+$/));
  console.log(`Driver DB: ${db.length} drivers, ${withIds.length} with iRacing IDs.`);
  if (withIds.length === 0) return;

  // 2. Fetch members from iRacing (batches of 50 IDs per call)
  await irLogin();
  const byId = new Map();
  const ids = [...new Set(withIds.map(d => String(d.iracingId).trim()))];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const out = await irGet(`/data/member/get?cust_ids=${batch.join(',')}&include_licenses=true`);
    for (const m of out.members || []) byId.set(String(m.cust_id), m);
    console.log(`Fetched ${Math.min(i + 50, ids.length)}/${ids.length} members…`);
  }

  // 3. Merge fresh numbers into the doc
  let changed = 0;
  const next = db.map(d => {
    const m = byId.get(String(d.iracingId || '').trim());
    if (!m) return d;
    const sc = pickLicense(m.licenses, 'sports_car');
    const fm = pickLicense(m.licenses, 'formula_car');
    const upd = {
      ...d,
      ...(sc && sc.irating != null ? { scIr: String(sc.irating) } : {}),
      ...(fm && fm.irating != null ? { fmIr: String(fm.irating) } : {}),
      ...(sc ? { scLic: licString(sc) } : {}),
      ...(fm ? { fmLic: licString(fm) } : {}),
      ...(m.display_name && !d.iracingName ? { iracingName: m.display_name } : {}),
    };
    if (JSON.stringify(upd) !== JSON.stringify(d)) changed++;
    return upd;
  });

  if (changed === 0) { console.log('No changes — everything already current.'); return; }

  // 4. Write back
  const patch = await fetch(`${SUPABASE_URL}/rest/v1/portal_docs?key=eq.driver_db`, {
    method: 'PATCH',
    headers: { ...sbHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({
      data: next,
      updated_at: new Date().toISOString(),
      updated_by: 'irating-sync-bot',
    }),
  });
  if (!patch.ok) throw new Error(`Supabase write failed: ${patch.status} ${await patch.text()}`);
  console.log(`Done — updated ${changed} driver${changed === 1 ? '' : 's'}.`);
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
