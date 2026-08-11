// ═══════════════════════════════════════════════════════════════════════════
// ECLIPSE PORTAL — WEEKLY iRATING / LICENSE SYNC
// Pulls current Sports Car + Formula iRating and license (letter + SR) from
// the official iRacing Data API for every driver in the portal's driver DB
// that has an iRacing ID filled in, and writes them back to Supabase.
//
// Runs from GitHub Actions weekly (.github/workflows/sync-iratings.yml) or
// by hand:  node scripts/sync-iratings.mjs
//
// AUTH (updated Aug 2026): iRacing retired legacy email/password script
// logins in the 2026 Season 1 release (Dec 9, 2025); the replacement is
// OAuth2's "password_limited" grant, which needs a client_id + client_secret
// registered with iRacing (docs: oauth.iracing.com/oauth2/book) — and iRacing
// has PAUSED new client registrations as of Aug 2026.
//
// This script supports BOTH paths:
//   · If IRACING_CLIENT_ID + IRACING_CLIENT_SECRET are set → OAuth (preferred).
//   · If not → tries the legacy login. Check https://oauth.iracing.com/accountmanagement/
//     → Security: if a "Legacy Authentication" toggle still exists there,
//     enable it and the sync works TODAY with just the 4 base secrets.
//     If iRacing has fully removed it, you'll get a clear error, and the
//     OAuth path is ready for when they reopen client registration.
//
// SETUP (one-time):
//   1. Supabase Dashboard → Project Settings → API Keys → copy the
//      service_role (secret) key. NEVER put this in portal-config.js or any
//      file that ships to browsers — it bypasses row-level security.
//   2. GitHub repo → Settings → Secrets and variables → Actions → add:
//        IRACING_EMAIL, IRACING_PASSWORD,
//        SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//        (+ IRACING_CLIENT_ID, IRACING_CLIENT_SECRET when you have them)
//   Until the secrets exist, the workflow just skips — nothing breaks.
//
// Requires Node 18+ (built-in fetch). No npm dependencies.
// ═══════════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';

const {
  IRACING_EMAIL,
  IRACING_PASSWORD,
  IRACING_CLIENT_ID,
  IRACING_CLIENT_SECRET,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
} = process.env;

for (const [k, v] of Object.entries({ IRACING_EMAIL, IRACING_PASSWORD, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(1); }
}

const IR = 'https://members-ng.iracing.com';
const OAUTH = !!(IRACING_CLIENT_ID && IRACING_CLIENT_SECRET);
let accessToken = '';
let cookies = '';

// Both auth paths mask the password the same way:
// base64(sha256(password + lowercased email))
function maskedPassword() {
  return createHash('sha256')
    .update(IRACING_PASSWORD + IRACING_EMAIL.trim().toLowerCase())
    .digest('base64');
}

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
  if (OAUTH) {
    // Preferred: OAuth2 password_limited grant (oauth.iracing.com/oauth2/book).
    const res = await fetch('https://oauth.iracing.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password_limited',
        client_id: IRACING_CLIENT_ID,
        client_secret: IRACING_CLIENT_SECRET,
        username: IRACING_EMAIL,
        password: maskedPassword(),
        scope: 'iracing.auth',
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.access_token) {
      throw new Error(`iRacing OAuth login failed (${res.status}): ${JSON.stringify(body).slice(0, 300)} — check client_id/client_secret and that this username is pre-registered for the password_limited grant.`);
    }
    accessToken = body.access_token; // valid ~600s, plenty for one run
    console.log('iRacing: logged in (OAuth).');
    return;
  }
  // Fallback: legacy read-only auth. iRacing retired this Dec 2025, but if
  // the "Legacy Authentication" toggle at oauth.iracing.com/accountmanagement
  // still exists and is enabled on your account, this path works without
  // OAuth client credentials. If it fails, the error below tells you why.
  const res = await fetch(`${IR}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: IRACING_EMAIL, password: maskedPassword() }),
  });
  rememberCookies(res);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.authcode === 0 || (!body.authcode && !cookies)) {
    throw new Error(`iRacing legacy login failed (${res.status}): ${JSON.stringify(body).slice(0, 300)}\n` +
      `Legacy auth was retired by iRacing (Dec 2025). Either enable "Legacy Authentication" at https://oauth.iracing.com/accountmanagement/ (Security) if the option still exists, ` +
      `or obtain OAuth client credentials from iRacing and set IRACING_CLIENT_ID / IRACING_CLIENT_SECRET.`);
  }
  console.log('iRacing: logged in (legacy).');
}

async function irGet(path) {
  // Data API responds with a { link } envelope pointing at a signed S3 URL.
  const res = await fetch(`${IR}${path}`, {
    headers: OAUTH ? { Authorization: `Bearer ${accessToken}` } : { Cookie: cookies },
  });
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
