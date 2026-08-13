// ═══════════════════════════════════════════════════════════════════════════
// ECLIPSE PORTAL — TICKET → DRIVER BOARD SYNC
// Polls the Discord server for Ticket Tool tickets (channels named ticket-*),
// parses the intake form answers (class, iRating, iRacing ID, staying/one-off,
// accomplishments), and adds new drivers to the portal's Driver Info board
// (Supabase portal_docs → driver_db) automatically.
//
// No 24/7 bot needed — this uses Discord's REST API from a scheduled GitHub
// Action (see .github/workflows/sync-tickets.yml). Runs every 30 minutes.
//
// SETUP (one-time):
//   1. Create the reader bot (it's just a token — nothing to host):
//      discord.com/developers/applications → New Application ("Eclipse Board
//      Sync") → Bot → Reset Token → copy it. On the same Bot page, turn ON
//      "Server Members Intent" (needed to read the member list that powers
//      the server-side membership gate).
//   2. Invite it to the Eclipse server: OAuth2 → URL Generator → scope "bot",
//      permissions "View Channels" + "Read Message History" → open the URL.
//   3. IMPORTANT: ticket channels are private. Give the bot's role access —
//      easiest is adding the bot's role to Ticket Tool's Support Team roles
//      (Ticket Tool dashboard) so it's inside every ticket, or grant its role
//      Administrator.
//   4. GitHub repo → Settings → Secrets and variables → Actions → add:
//        DISCORD_BOT_TOKEN   (from step 1)
//      (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are shared with the
//       iRating sync — add those too if you haven't.)
//
// Dedup: processed ticket-channel IDs are stored in portal_docs key
// 'ticket_ingest', and anyone whose Discord username is already on the board
// is skipped. Note: Ticket Tool deletes channels when tickets close, so the
// 30-minute cadence is what catches tickets while they're open — don't
// close tickets within minutes of them being opened.
//
// Requires Node 18+ (built-in fetch). No npm dependencies.
// ═══════════════════════════════════════════════════════════════════════════

const {
  DISCORD_BOT_TOKEN,
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  DISCORD_GUILD_ID = '1173093600549163018', // Eclipse Competition
} = process.env;

for (const [k, v] of Object.entries({ DISCORD_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
  if (!v) { console.error(`Missing env var: ${k}`); process.exit(1); }
}

const D = 'https://discord.com/api/v10';
const dHeaders = { Authorization: `Bot ${DISCORD_BOT_TOKEN}` };
const sbHeaders = {
  apikey: SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
};

async function dGet(path) {
  const res = await fetch(`${D}${path}`, { headers: dHeaders });
  if (res.status === 429) {
    const body = await res.json().catch(() => ({}));
    const wait = (body.retry_after || 2) * 1000 + 250;
    await new Promise(r => setTimeout(r, wait));
    return dGet(path);
  }
  if (!res.ok) throw new Error(`Discord GET ${path} → ${res.status} ${await res.text().then(t => t.slice(0, 200))}`);
  return res.json();
}

// ── Pull every visible string out of a message (content, embeds, and the
//    newer layout components Ticket Tool uses), then parse Q → A pairs. ──────
function collectStrings(msg) {
  const out = [];
  if (msg.content) out.push(msg.content);
  for (const e of msg.embeds || []) {
    if (e.title) out.push(e.title);
    if (e.description) out.push(e.description);
    for (const f of e.fields || []) out.push(`${f.name}\n${f.value}`);
  }
  const walk = (c) => {
    if (!c) return;
    if (Array.isArray(c)) return c.forEach(walk);
    if (c.content && typeof c.content === 'string') out.push(c.content);
    if (c.components) walk(c.components);
  };
  walk(msg.components);
  return out.join('\n');
}

function stripMd(s) {
  return s
    .replace(/```[a-z]*\n/g, '\n') // opening fence with language tag
    .replace(/```/g, '')           // remaining/inline fences
    .replace(/[*_`>#]/g, '')
    .trim();
}

// Parse "question line → next non-empty line is the answer" pairs.
function parseQA(text) {
  const lines = text.split('\n').map(stripMd).filter(l => l !== '');
  const qa = [];
  for (let i = 0; i < lines.length; i++) {
    if (/\?$/.test(lines[i]) || /^what is your irating/i.test(lines[i])) {
      if (lines[i + 1] && !/\?$/.test(lines[i + 1])) qa.push([lines[i].toLowerCase(), lines[i + 1]]);
    }
  }
  return qa;
}

function mapAnswers(qa) {
  const d = {};
  for (const [q, a] of qa) {
    if (/car class|which class|compete in/.test(q)) d.prefCars = a.toUpperCase();
    else if (/irating/.test(q) && !/customer/.test(q)) d.scIr = (a.match(/\d+/) || [''])[0];
    else if (/customer id|iracing.*id/.test(q)) d.iracingId = (a.match(/\d+/) || [''])[0];
    else if (/accomplishments/.test(q)) d.notes = a;
    else if (/1 off|one off|staying/.test(q)) d.status = /stay/i.test(a) ? 'Trial' : 'One Off';
  }
  return d;
}

// ── Guild member roster → guild_members table ────────────────────────────────
// Drives the SERVER-SIDE membership gate (is_member() in the Aug 13 migration):
// only Discord accounts in this table can read/write portal data. Requires the
// "Server Members Intent" toggle ON for the bot (Developer Portal → Bot page) —
// without it Discord returns 403 and this logs + skips, leaving the table as-is.
async function syncMembers() {
  const runStart = new Date().toISOString();
  const members = [];
  let after = '0';
  while (true) {
    let page;
    try {
      page = await dGet(`/guilds/${DISCORD_GUILD_ID}/members?limit=1000&after=${after}`);
    } catch (e) {
      console.log(`Member sync skipped (${e.message.slice(0, 120)}) — is "Server Members Intent" enabled on the bot?`);
      return;
    }
    members.push(...page);
    if (page.length < 1000) break;
    after = page[page.length - 1].user.id;
  }
  const rows = members
    .filter(m => m.user && !m.user.bot)
    .map(m => ({ user_id: m.user.id, username: String(m.user.username || '').toLowerCase(), synced_at: runStart }));
  if (rows.length === 0) { console.log('Member sync: 0 members returned — leaving guild_members untouched.'); return; }
  const up = await fetch(`${SUPABASE_URL}/rest/v1/guild_members?on_conflict=user_id`, {
    method: 'POST',
    headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows),
  });
  if (!up.ok) {
    console.log(`Member sync write failed (${up.status}): ${(await up.text()).slice(0, 150)} — did you run portal-migration-2026-08-13.sql?`);
    return;
  }
  // Drop members who left the server (rows not touched this run)
  await fetch(`${SUPABASE_URL}/rest/v1/guild_members?synced_at=lt.${encodeURIComponent(runStart)}`, {
    method: 'DELETE', headers: sbHeaders,
  });
  console.log(`Member sync: ${rows.length} members in the gate.`);
}

async function main() {
  await syncMembers();
  // 1. Load driver_db + ingest ledger from Supabase
  const docs = await fetch(`${SUPABASE_URL}/rest/v1/portal_docs?key=in.(driver_db,ticket_ingest)&select=key,data`, { headers: sbHeaders }).then(r => r.json());
  const db = docs.find(r => r.key === 'driver_db')?.data;
  if (!Array.isArray(db)) throw new Error('driver_db doc missing — run supabase-setup.sql first.');
  const ledger = docs.find(r => r.key === 'ticket_ingest')?.data || { processedChannels: [] };
  const processed = new Set(ledger.processedChannels || []);
  const knownDiscord = new Set(db.map(x => String(x.discord || '').toLowerCase()).filter(Boolean));

  // 2. Find open ticket channels
  const channels = await dGet(`/guilds/${DISCORD_GUILD_ID}/channels`);
  const tickets = channels.filter(c => c.type === 0 && /^ticket-\d+/.test(c.name) && !processed.has(c.id));
  console.log(`Found ${tickets.length} unprocessed ticket channel(s).`);
  if (tickets.length === 0) return;

  const added = [];
  for (const ch of tickets) {
    let msgs;
    try {
      msgs = await dGet(`/channels/${ch.id}/messages?limit=25`);
    } catch (e) {
      console.log(`#${ch.name}: can't read (${e.message.slice(0, 80)}) — is the bot in Ticket Tool's support roles?`);
      continue; // don't mark processed; retry next run once perms are fixed
    }
    // Ticket Tool's intake message: from a bot, containing the form answers
    const form = [...msgs].reverse().find(m => m.author?.bot && /irating|customer id/i.test(collectStrings(m)));
    if (!form) {
      // No form yet (or not a form ticket) — mark support tickets w/o forms
      // as processed only if the channel is older than 2h, else retry.
      const ageMs = Date.now() - Number((BigInt(ch.id) >> 22n) + 1420070400000n);
      if (ageMs > 2 * 3600 * 1000) { processed.add(ch.id); console.log(`#${ch.name}: no intake form, skipping.`); }
      continue;
    }
    const fields = mapAnswers(parseQA(collectStrings(form)));

    // Who opened it? Ticket Tool @-mentions the opener in the welcome message.
    let discord = '', name = '';
    const mentionId = (collectStrings(form).match(/<@!?(\d+)>/) || form.content?.match(/<@!?(\d+)>/) || [])[1]
      || (form.mentions && form.mentions[0]?.id);
    if (mentionId) {
      try {
        const member = await dGet(`/guilds/${DISCORD_GUILD_ID}/members/${mentionId}`);
        discord = member.user?.username || '';
        name = member.nick || member.user?.global_name || member.user?.username || '';
      } catch (e) { /* member may have left */ }
    }
    if (discord && knownDiscord.has(discord.toLowerCase())) {
      processed.add(ch.id);
      console.log(`#${ch.name}: ${discord} already on the board, skipping.`);
      continue;
    }

    added.push({
      status: fields.status || 'Trial',
      name, discord,
      iracingName: '', iracingId: fields.iracingId || '',
      scIr: fields.scIr || '', fmIr: '', scLic: '', fmLic: '',
      source: 'Discord',
      joined: new Date().toISOString().slice(0, 10),
      lastEvent: '', lastEventDate: '',
      prefCars: fields.prefCars || '', bestResult: '', region: '',
      notes: [fields.notes, `via ${ch.name}`].filter(Boolean).join(' · '),
    });
    processed.add(ch.id);
    console.log(`#${ch.name}: adding ${name || discord || 'unknown'} (${fields.status || 'Trial'}, iR ID ${fields.iracingId || '—'}).`);
  }

  // 3. Write back
  if (added.length > 0) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/portal_docs?key=eq.driver_db`, {
      method: 'PATCH',
      headers: { ...sbHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify({ data: [...added, ...db], updated_at: new Date().toISOString(), updated_by: 'ticket-sync-bot' }),
    });
    if (!res.ok) throw new Error(`Supabase driver_db write failed: ${res.status} ${await res.text()}`);
  }
  const up = await fetch(`${SUPABASE_URL}/rest/v1/portal_docs`, {
    method: 'POST',
    headers: { ...sbHeaders, Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key: 'ticket_ingest', data: { processedChannels: [...processed] }, updated_at: new Date().toISOString(), updated_by: 'ticket-sync-bot' }),
  });
  if (!up.ok) throw new Error(`Supabase ledger write failed: ${up.status} ${await up.text()}`);
  console.log(`Done — ${added.length} driver(s) added to the board.`);
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
