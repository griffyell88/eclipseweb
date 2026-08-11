// Eclipse Competition — Driver Portal
// Structure mirrors app.jsx: no build step. Data: portal-data.js (+ Supabase).
//
// TWO MODES, switched by portal-config.js:
//  BUILD MODE (no keys): username/password curtain, per-browser saves. The
//    original demo behavior — nothing is shared, nothing is secure.
//  LIVE MODE (keys set): "Login with Discord" via Supabase. Signups are shared
//    team-wide in the database, admin edits publish for everyone on "Done
//    editing", the driver DB is served ONLY to admins (enforced server-side by
//    supabase-setup.sql), and signups announce to Discord via webhook.
const { useState, useEffect, useMemo } = React;
const P = window.EC_PORTAL;
const CFG = window.EC_CONFIG || {};
const LIVE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase);
const sb = LIVE ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

// Guarded storage — same rationale as app.jsx (Safari/Brave can throw).
const store = {
  get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* no-op */ } },
  del(k) { try { window.localStorage.removeItem(k); } catch (e) { /* no-op */ } },
};

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
}

// ── BUILD-MODE auth (curtain). Goes away entirely once LIVE. ────────────────
const SESSION_KEY = 'ec-portal-session';
const localAuth = {
  current() {
    const raw = store.get(SESSION_KEY);
    if (!raw) return null;
    try {
      const s = JSON.parse(raw);
      return (P.auth.users || []).find(u => u.user === s.user) || null;
    } catch (e) { return null; }
  },
  async login(user, pass) {
    if (!window.crypto || !crypto.subtle) {
      throw new Error('Secure crypto unavailable — open the portal over https or localhost.');
    }
    const hash = await sha256(`${user.trim().toLowerCase()}:${pass}`);
    const match = (P.auth.users || []).find(u => u.user === user.trim().toLowerCase() && u.hash === hash);
    if (!match) throw new Error('Wrong username or password.');
    store.set(SESSION_KEY, JSON.stringify({ user: match.user }));
    return match;
  },
  logout() { store.del(SESSION_KEY); },
};

// ── LIVE-MODE auth helpers ───────────────────────────────────────────────────
function mapSession(session) {
  if (!session) return null;
  const m = session.user.user_metadata || {};
  // Discord accounts present the username differently depending on account age
  // (legacy "Name#1234", migrated "name#0", new plain "name") and sometimes in
  // different fields — check all of them. Server-side access (RLS) does the same.
  const cands = [m.name, m.preferred_username, m.full_name]
    .filter(Boolean)
    .map(s => String(s).split('#')[0].toLowerCase());
  const admins = (P.auth.adminDiscord || []).map(a => a.toLowerCase());
  const adminIds = (P.auth.adminDiscordIds || []).map(String);
  const isAdmin = cands.some(c => admins.includes(c)) || adminIds.includes(String(m.provider_id || ''));
  const display = (m.custom_claims && m.custom_claims.global_name) || m.full_name || m.name || cands[0] || 'Driver';
  return { id: session.user.id, name: display, username: cands[0] || '', role: isAdmin ? 'admin' : 'driver' };
}

// Best-effort "are you in the Eclipse server" gate. Real data protection is
// the server-side rules in supabase-setup.sql — this just keeps randoms out
// of the UI. Verified once per account, then remembered.
async function checkGuild(session) {
  const gid = CFG.DISCORD_GUILD_ID;
  if (!gid) return true;
  const okKey = 'ec-guild-ok-' + session.user.id;
  if (store.get(okKey) === '1') return true;
  const token = session.provider_token;
  if (!token) return true; // token only exists right after login; skip on refresh
  try {
    const res = await fetch('https://discord.com/api/users/@me/guilds', {
      headers: { Authorization: 'Bearer ' + token },
    });
    if (!res.ok) return true;
    const guilds = await res.json();
    const ok = Array.isArray(guilds) && guilds.some(g => g.id === gid);
    if (ok) store.set(okKey, '1');
    return ok;
  } catch (e) { return true; }
}

// ── Local persistence (BUILD MODE only) ─────────────────────────────────────
const SIGNUP_KEY = 'ec-portal-signups';
function loadLocalSignups() {
  try { return JSON.parse(store.get(SIGNUP_KEY) || '{}'); } catch (e) { return {}; }
}
function saveLocalSignups(map) { store.set(SIGNUP_KEY, JSON.stringify(map)); }

const OVERRIDE_KEY = 'ec-portal-overrides';
function loadOverrides() {
  try { return JSON.parse(store.get(OVERRIDE_KEY) || '{}'); } catch (e) { return {}; }
}

const STATE_LABEL = { confirmed: 'CONFIRMED', available: 'AVAILABLE', tentative: 'TENTATIVE', reserve: 'RESERVE' };

// ── Date automation ──────────────────────────────────────────────────────────
function isPast(iso) {
  if (!iso) return false;
  const end = new Date(iso + 'T23:59:59');
  return new Date() > end;
}
// Events resolve from the admin-published override (portal_docs → events) when
// present, else the baked-in list. ARRAY ORDER IS DISPLAY ORDER — admins keep
// it chronological (auto-placement on date entry) or reorder manually.
function allEvents(ov) {
  return (ov && ov.events) || P.events;
}
function liveEvents(ov) {
  return allEvents(ov).filter(ev => !isPast(ev.end));
}
function soonest(evs) {
  return [...evs].sort((a, b) => (a.end || '9999').localeCompare(b.end || '9999'))[0];
}
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text; document.body.appendChild(ta); ta.select();
  document.execCommand('copy'); document.body.removeChild(ta);
  return Promise.resolve();
}

function ExportBtn({ data, label }) {
  const [done, setDone] = useState(false);
  return (
    <button className="pt-mini-btn" onClick={() => {
      copyText(JSON.stringify(data, null, 2)).then(() => {
        setDone(true); setTimeout(() => setDone(false), 1600);
      });
    }}>{done ? 'Copied ✓' : (label || 'Export JSON')}</button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function Login({ onAuthed, gateErr }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submitLocal = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const u = await localAuth.login(user, pass);
      onAuthed(u);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  const discordLogin = async () => {
    setErr(''); setBusy(true);
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        scopes: 'identify guilds',
        redirectTo: window.location.origin + window.location.pathname,
      },
    });
    if (error) { setErr(error.message); setBusy(false); }
  };

  return (
    <div className="pt-login">
      <form className="pt-login-card" onSubmit={LIVE ? (e) => e.preventDefault() : submitLocal}>
        <img src="assets/logo-white.png" alt="Eclipse Competition" className="pt-login-logo" />
        <div className="pt-login-eyebrow">/ TEAM PORTAL · RESTRICTED</div>
        <h1 className="pt-login-title">Driver<br/>Access</h1>

        {LIVE ? (
          <>
            <button type="button" className="btn btn-primary pt-login-btn" onClick={discordLogin} disabled={busy}>
              {busy ? 'Sending you to Discord…' : 'Login with Discord →'}
            </button>
            {(err || gateErr) && <div className="pt-login-err">{err || gateErr}</div>}
            <div className="pt-login-foot">
              Uses your Discord account — members of the Eclipse server only.<br/>
              Not a member? <a href={(window.EC_DATA && window.EC_DATA.brand.discord) || 'https://discord.gg/CBtQMmcksE'}>Join the Discord</a>
            </div>
          </>
        ) : (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) ? (
          // Keys are set but the Supabase library didn't load (CDN hiccup).
          // Passwords no longer exist, so there's nothing to fall back to.
          <>
            <div className="pt-login-err">
              Couldn't load the login system — check your connection and refresh.
            </div>
          </>
        ) : (
          <>
            <label className="pt-field">
              <span>Username</span>
              <input type="text" value={user} onChange={e => setUser(e.target.value)}
                     autoComplete="username" autoFocus required />
            </label>
            <label className="pt-field">
              <span>Password</span>
              <input type="password" value={pass} onChange={e => setPass(e.target.value)}
                     autoComplete="current-password" required />
            </label>
            {err && <div className="pt-login-err">{err}</div>}
            <button className="btn btn-primary pt-login-btn" disabled={busy}>
              {busy ? 'Checking…' : 'Enter the garage →'}
            </button>
            <div className="pt-login-foot">
              Build mode — Discord login activates once the backend keys are in.<br/>
              Not a member? <a href={(window.EC_DATA && window.EC_DATA.brand.discord) || 'https://discord.gg/CBtQMmcksE'}>Join the Discord</a>
            </div>
          </>
        )}
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function Dashboard({ user, api, goto, isAdmin, ov }) {
  const open = liveEvents(ov).filter(e => e.status === 'open');
  const next = soonest(open);
  const nextEntries = next ? api.entriesFor(next) : [];
  const db = ov.driverDB || P.driverDB || [];
  return (
    <div className="pt-panel">
      <div className="pt-welcome">
        <div className="pt-welcome-eyebrow">/ WELCOME BACK</div>
        <h2 className="pt-h2">{user.name.split(' ')[0]}</h2>
      </div>
      <div className="pt-dash-grid">
        <button className="pt-dash-card pt-dash-card--wide" onClick={() => goto('events')}>
          <div className="pt-dc-label">NEXT EVENT</div>
          {next ? (
            <>
              <div className="pt-dc-big">{next.title}</div>
              <div className="pt-dc-sub">{next.date} · {next.track}</div>
              <div className="pt-dc-meta">{nextEntries.length} {nextEntries.length === 1 ? 'driver' : 'drivers'} in · signups {next.status}</div>
            </>
          ) : <div className="pt-dc-big">No open events</div>}
        </button>
        <button className="pt-dash-card" onClick={() => goto('events')}>
          <div className="pt-dc-label">OPEN SIGNUPS</div>
          <div className="pt-dc-big">{open.length}</div>
          <div className="pt-dc-sub">events taking entries</div>
        </button>
        <button className="pt-dash-card" onClick={() => goto('rosters')}>
          <div className="pt-dc-label">ROSTERS</div>
          <div className="pt-dc-big">{open.length + 1}</div>
          <div className="pt-dc-sub">event lineups + FIS</div>
        </button>
        {isAdmin ? (
          <button className="pt-dash-card" onClick={() => goto('driverinfo')}>
            <div className="pt-dc-label">DRIVER DATABASE</div>
            <div className="pt-dc-big">{db.length}</div>
            <div className="pt-dc-sub">drivers on file · admin only</div>
          </button>
        ) : (
          <button className="pt-dash-card" onClick={() => goto('paints')}>
            <div className="pt-dc-label">PAINTS</div>
            <div className="pt-dc-big">{P.paints.length}</div>
            <div className="pt-dc-sub">Trading Paints collections</div>
          </button>
        )}
      </div>
      {(P.tools || []).length > 0 && (
        <>
          <div className="pt-rb-cls mono" style={{ marginTop: 8 }}>TEAM TOOLS</div>
          <div className="pt-paints">
            {P.tools.map((t, i) => (
              <a className="pt-paint-card" key={i} href={t.url} target="_blank" rel="noopener noreferrer">
                <div className="pt-dc-label">TOOL</div>
                <div className="pt-dc-big">{t.name}</div>
                <div className="pt-dc-sub">{t.note}</div>
                <div className="pt-paint-cta mono">OPEN →</div>
              </a>
            ))}
          </div>
        </>
      )}
      {LIVE ? (
        isAdmin && (
          <div className="pt-note">
            <strong>Live mode:</strong> signups are shared team-wide and announce to
            Discord. Your edits publish to everyone when you hit “Done editing”.
          </div>
        )
      ) : (
        <div className="pt-note">
          <strong>Build note:</strong> signups{isAdmin ? ' and admin edits' : ''} save to this
          browser only — Discord login + shared data activate once the backend keys
          are in <span className="mono">portal-config.js</span>.
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function EventCard({ ev, user, api, isAdmin }) {
  const entries = api.entriesFor(ev);
  const mine = api.mineAll(ev);
  const myCls = new Set(mine.map(en => en.cls));
  const openCls = ev.classes.filter(c => !myCls.has(c));
  const locked = ev.status !== 'open';
  const firmState = ev.mode === 'admin' ? 'available' : 'confirmed';

  return (
    <div className={"pt-event" + (ev.featured ? " pt-event--featured" : "")} data-locked={locked}>
      <div className="pt-ev-head">
        <div>
          <div className="pt-ev-date mono">{ev.date} · {ev.series.toUpperCase()}</div>
          <div className="pt-ev-title">{ev.title}</div>
          <div className="pt-ev-track">{ev.track}</div>
        </div>
        <div className="pt-ev-status">
          <span className="pt-badge" data-kind={locked ? 'locked' : 'open'}>
            {locked ? 'LOCKED' : 'OPEN'}
          </span>
          <span className="pt-seats mono">{entries.length} in</span>
        </div>
      </div>

      <div className="pt-ev-mode mono">
        {ev.mode === 'admin'
          ? '// AVAILABILITY EVENT — mark yourself available, admins pick the lineup'
          : '// SELF-SIGNUP — claim your spot directly'}
      </div>

      {entries.length > 0 && (
        <ul className="pt-ev-entries">
          {entries.map((en, i) => (
            <li key={i}>
              <span className="pt-en-driver">{en.driver}</span>
              <span className="pt-en-cls mono">{en.cls}</span>
              <span className="pt-en-state" data-state={en.state}>{STATE_LABEL[en.state] || en.state.toUpperCase()}</span>
              {isAdmin && api.canRemove(ev, en) && (
                <button className="pt-en-x" title="Remove (admin)" onClick={() => api.remove(ev, en)}>×</button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="pt-ev-actions">
        {mine.length > 0 && (
          <div className="pt-mine">
            {mine.map((en, i) => (
              <div className="pt-mine-row" key={i}>
                <span className="pt-ev-in mono" data-state={en.state}>
                  // YOU'RE IN — {en.cls} · {STATE_LABEL[en.state] || en.state.toUpperCase()}
                </span>
                {api.canRemove(ev, en) && (
                  <button className="btn pt-btn-sm" onClick={() => api.leave(ev, en)}>Withdraw</button>
                )}
              </div>
            ))}
          </div>
        )}
        {!locked && openCls.length > 0 && (
          <div className="pt-signup-rows">
            {mine.length > 0 && (
              <div className="pt-ev-mode mono">// ADD ANOTHER CLASS</div>
            )}
            <div className="pt-signup-row">
              {openCls.map(cls => (
                <button key={cls} className="btn btn-primary pt-btn-sm" onClick={() => api.join(ev, cls, firmState)}>
                  {ev.mode === 'admin' ? `Available — ${cls}` : `Sign up — ${cls}`}
                </button>
              ))}
            </div>
            <div className="pt-signup-row">
              {openCls.map(cls => (
                <button key={cls} className="btn pt-btn-sm pt-btn-tent" onClick={() => api.join(ev, cls, 'tentative')}>
                  Tentative — {cls}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Admin event editor ───────────────────────────────────────────────────────
// Events publish through portal_docs ('events') exactly like schedules, so
// adding/editing/removing an event needs no redeploy. New events auto-place
// chronologically once their end date is typed (on blur); arrows override.
function EventEditCard({ ev, i, count, ops }) {
  return (
    <div className="pt-event pt-event--edit">
      <div className="pt-ev-edit-top">
        <span className="pt-ev-edit-n mono">{String(i + 1).padStart(2, '0')}</span>
        <div className="pt-ev-edit-ctl">
          <button className="pt-mini-btn pt-arrow" title="Move up" disabled={i === 0} onClick={() => ops.move(i, -1)}>↑</button>
          <button className="pt-mini-btn pt-arrow" title="Move down" disabled={i === count - 1} onClick={() => ops.move(i, 1)}>↓</button>
          <button className="pt-en-x" title="Delete event" onClick={() => ops.del(i)}>×</button>
        </div>
      </div>
      <div className="pt-ev-edit-grid">
        <label className="pt-efield pt-efield--wide"><span>TITLE</span>
          <input className="pt-input" value={ev.title} placeholder="Suzuka 1000km"
                 onChange={e => ops.set(i, 'title', e.target.value)} /></label>
        <label className="pt-efield pt-efield--wide"><span>TRACK</span>
          <input className="pt-input" value={ev.track} placeholder="Suzuka Circuit"
                 onChange={e => ops.set(i, 'track', e.target.value)} /></label>
        <label className="pt-efield"><span>DATE LABEL</span>
          <input className="pt-input mono" value={ev.date} placeholder="SEP 10–15"
                 onChange={e => ops.set(i, 'date', e.target.value)} /></label>
        <label className="pt-efield"><span>END (YYYY-MM-DD)</span>
          <input className="pt-input mono" value={ev.end || ''} placeholder="2026-09-15"
                 onChange={e => ops.set(i, 'end', e.target.value)}
                 onBlur={() => ops.place(i)} /></label>
        <label className="pt-efield pt-efield--wide"><span>SERIES LABEL</span>
          <input className="pt-input" value={ev.series} placeholder="Special Event · Team Event"
                 onChange={e => ops.set(i, 'series', e.target.value)} /></label>
        <label className="pt-efield"><span>CLASSES (COMMA-SEPARATED)</span>
          <input className="pt-input mono" defaultValue={(ev.classes || []).join(', ')} placeholder="GTP, LMP2, GT3"
                 onBlur={e => ops.set(i, 'classes', e.target.value.split(',').map(s => s.trim()).filter(Boolean))} /></label>
        <label className="pt-efield"><span>SIGNUP MODE</span>
          <select className="pt-input" value={ev.mode} onChange={e => ops.set(i, 'mode', e.target.value)}>
            <option value="self">Self-signup (drivers claim spots)</option>
            <option value="admin">Availability (admins pick lineup)</option>
          </select></label>
        <label className="pt-efield"><span>SIGNUPS</span>
          <select className="pt-input" value={ev.status} onChange={e => ops.set(i, 'status', e.target.value)}>
            <option value="open">Open</option>
            <option value="locked">Locked</option>
          </select></label>
        <label className="pt-efield pt-efield--check"><span>FEATURED</span>
          <input type="checkbox" checked={!!ev.featured} onChange={e => ops.set(i, 'featured', e.target.checked)} /></label>
      </div>
      {isPast(ev.end) && <div className="pt-ev-mode mono">// PAST EVENT — hidden from drivers, kept here for your records</div>}
    </div>
  );
}

function Events({ user, isAdmin, api, ov, patchOv, publish }) {
  const [editing, setEditing] = useState(false);
  const all = allEvents(ov);
  const evs = liveEvents(ov);
  const hasOverride = !!ov.events;

  const mutate = (fn) => {
    const next = JSON.parse(JSON.stringify(all));
    fn(next);
    patchOv({ events: next });
  };
  const ops = {
    set: (i, field, val) => mutate(es => { es[i][field] = val; }),
    move: (i, dir) => mutate(es => {
      const j = i + dir;
      if (j < 0 || j >= es.length) return;
      [es[i], es[j]] = [es[j], es[i]];
    }),
    del: (i) => {
      if (window.confirm(`Delete "${all[i].title || 'this event'}"? Its signups disappear from the portal with it.`)) {
        mutate(es => es.splice(i, 1));
      }
    },
    // Chronological auto-placement: once a valid end date is set, the event
    // slides to its date-ordered slot. Arrows still let you override after.
    place: (i) => mutate(es => {
      const ev = es[i];
      if (!ISO_RE.test(ev.end || '')) return;
      es.splice(i, 1);
      let k = es.findIndex(x => x.end && x.end > ev.end);
      if (k === -1) k = es.length;
      es.splice(k, 0, ev);
    }),
  };
  const addEvent = () => mutate(es => es.push({
    id: 'ev-' + Math.random().toString(36).slice(2, 10),
    title: '', track: '', date: '', end: '',
    series: 'Special Event · Team Event',
    classes: ['GT3'], mode: 'admin', status: 'open', entries: [],
  }));
  const sortByDate = () => mutate(es => es.sort((a, b) => (a.end || '9999').localeCompare(b.end || '9999')));
  const doneEditing = () => { setEditing(false); publish('events'); };

  return (
    <div className="pt-panel">
      <div className="pt-panel-head">
        <h2 className="pt-h2">Events &amp; Signups</h2>
        <div className="pt-sched-controls">
          {isAdmin && (
            <>
              {hasOverride && !LIVE && <ExportBtn data={all} label="Export JSON" />}
              {hasOverride && !editing && !LIVE && (
                <button className="pt-mini-btn pt-mini-btn--warn" onClick={() => {
                  if (window.confirm('Discard local event edits and go back to what portal-data.js says?')) patchOv({ events: undefined });
                }}>Reset to file</button>
              )}
              {editing && <button className="pt-mini-btn" onClick={addEvent}>+ Add event</button>}
              {editing && <button className="pt-mini-btn" onClick={sortByDate}>Sort by date</button>}
              <button className="pt-subtab" data-active={editing} onClick={() => editing ? doneEditing() : setEditing(true)}>
                {editing ? (LIVE ? 'Done — publish' : 'Done editing') : 'Edit events'}
              </button>
            </>
          )}
          {!editing && <div className="pt-tag mono">REPLACES #race-check-in</div>}
        </div>
      </div>

      {editing && (
        <div className="pt-note">
          {LIVE
            ? <>Events go live for the whole team when you hit <strong>Done — publish</strong> — no redeploy needed.</>
            : <>Edits save in this browser only. <strong>Export JSON</strong> → paste over the <span className="mono">events</span> block in <span className="mono">portal-data.js</span> to publish.</>}
          {' '}Type the <span className="mono">END</span> date and the event drops into chronological order on its own — arrows to override.
        </div>
      )}

      <div className="pt-events">
        {editing
          ? all.map((ev, i) => (
              <EventEditCard key={ev.id} ev={ev} i={i} count={all.length} ops={ops} />
            ))
          : evs.map(ev => (
              <EventCard key={ev.id} ev={ev} user={user} api={api} isAdmin={isAdmin} />
            ))}
        {!editing && evs.length === 0 && (
          <div className="pt-empty">No upcoming events{isAdmin ? ' — hit Edit events to add one' : ' — check back after the admins add the next one'}.</div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function Schedule({ isAdmin, ov, patchOv, publish }) {
  const [showPast, setShowPast] = useState(false);
  const [editing, setEditing] = useState(false);
  const schedules = ov.schedules || P.schedules;

  const mutate = (fn) => {
    const next = JSON.parse(JSON.stringify(schedules));
    fn(next);
    patchOv({ schedules: next });
  };
  const setRound = (si, ri, field, val) => mutate(s => { s[si].rounds[ri][field] = field === 'r' ? (parseInt(val, 10) || 0) : val; });
  const addRound = (si) => mutate(s => s[si].rounds.push({ r: s[si].rounds.length + 1, date: '', iso: '', track: '' }));
  const delRound = (si, ri) => mutate(s => s[si].rounds.splice(ri, 1));
  const moveRound = (si, ri, dir) => mutate(s => {
    const arr = s[si].rounds, j = ri + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[ri], arr[j]] = [arr[j], arr[ri]];
  });
  // Chronological auto-placement: when a round's iso date is entered (blur),
  // it slides to its date-ordered slot. Arrows override afterwards if needed.
  const placeRound = (si, ri) => mutate(s => {
    const arr = s[si].rounds, r = arr[ri];
    if (!ISO_RE.test(r.iso || '')) return;
    arr.splice(ri, 1);
    let k = arr.findIndex(x => x.iso && x.iso > r.iso);
    if (k === -1) k = arr.length;
    arr.splice(k, 0, r);
  });
  const setSeries = (si, field, val) => mutate(s => { s[si][field] = val; });
  const hasOverride = !!ov.schedules;
  const doneEditing = () => { setEditing(false); publish('schedules'); };

  return (
    <div className="pt-panel">
      <div className="pt-panel-head">
        <h2 className="pt-h2">Schedules</h2>
        <div className="pt-sched-controls">
          {isAdmin && (
            <>
              {hasOverride && !LIVE && <ExportBtn data={schedules} label="Export JSON" />}
              {hasOverride && !editing && !LIVE && (
                <button className="pt-mini-btn pt-mini-btn--warn" onClick={() => {
                  if (window.confirm('Discard local schedule edits and go back to what portal-data.js says?')) patchOv({ schedules: undefined });
                }}>Reset to file</button>
              )}
              <button className="pt-subtab" data-active={editing} onClick={() => editing ? doneEditing() : setEditing(true)}>
                {editing ? (LIVE ? 'Done — publish' : 'Done editing') : 'Edit schedules'}
              </button>
            </>
          )}
          <button className="pt-subtab" data-active={showPast} onClick={() => setShowPast(!showPast)}>
            {showPast ? 'Hide past rounds' : 'Show past rounds'}
          </button>
        </div>
      </div>

      {editing && (
        <div className="pt-note">
          {LIVE
            ? <>Changes go live for the whole team when you hit <strong>Done — publish</strong>.</>
            : <>Edits save in this browser only. When the schedule's right, <strong>Export JSON</strong> and
               paste it over the <span className="mono">schedules</span> block in <span className="mono">portal-data.js</span>.</>}
          {' '}Dates: <span className="mono">iso</span> = the round's last day, <span className="mono">YYYY-MM-DD</span> — it drives the auto-hiding, and entering it drops the round into chronological order (arrows to override).
        </div>
      )}

      {schedules.map((s, si) => {
        const upcoming = s.rounds.filter(r => !isPast(r.iso));
        const nextIso = upcoming.find(r => r.iso)?.iso;
        const rounds = (showPast || editing) ? s.rounds : upcoming;
        return (
          <div className="pt-sched" key={si}>
            <div className="pt-sched-head">
              {editing ? (
                <input className="pt-input pt-input--title" value={s.series} onChange={e => setSeries(si, 'series', e.target.value)} />
              ) : (
                <span className="pt-sched-series">{s.series}</span>
              )}
              {editing ? (
                <input className="pt-input pt-input--cad mono" value={s.cadence} onChange={e => setSeries(si, 'cadence', e.target.value)} />
              ) : (
                <span className="pt-sched-cad mono">{s.cadence}</span>
              )}
            </div>
            <div className="pt-sched-rounds">
              {rounds.map((r, j) => {
                const ri = s.rounds.indexOf(r);
                const past = isPast(r.iso);
                const next = r.iso && r.iso === nextIso;
                return editing ? (
                  <div className="pt-round pt-round--edit" key={ri}>
                    <input className="pt-input pt-input--xs mono" value={r.r || ''} onChange={e => setRound(si, ri, 'r', e.target.value)} placeholder="R#" />
                    <input className="pt-input pt-input--sm mono" value={r.date} onChange={e => setRound(si, ri, 'date', e.target.value)} placeholder="AUG 12" />
                    <input className="pt-input pt-input--sm mono" value={r.iso || ''} onChange={e => setRound(si, ri, 'iso', e.target.value)} onBlur={() => placeRound(si, ri)} placeholder="2026-08-12" />
                    <input className="pt-input" value={r.track} onChange={e => setRound(si, ri, 'track', e.target.value)} placeholder="Track — laps" />
                    <button className="pt-mini-btn pt-arrow" title="Move up" disabled={ri === 0} onClick={() => moveRound(si, ri, -1)}>↑</button>
                    <button className="pt-mini-btn pt-arrow" title="Move down" disabled={ri === s.rounds.length - 1} onClick={() => moveRound(si, ri, 1)}>↓</button>
                    <button className="pt-en-x" title="Delete round" onClick={() => delRound(si, ri)}>×</button>
                  </div>
                ) : (
                  <div className="pt-round" key={j} data-past={past}>
                    <span className="pt-round-n mono">{r.r ? `R${r.r}` : '—'}</span>
                    <span className="pt-round-date mono">{r.date}</span>
                    <span className="pt-round-track">
                      {r.track}
                      {next && <em className="pt-upnext mono">UP NEXT</em>}
                    </span>
                  </div>
                );
              })}
              {rounds.length === 0 && !editing && (
                <div className="pt-empty">Season complete — flip “Show past rounds” to see how it went.</div>
              )}
              {editing && (
                <button className="pt-mini-btn pt-add-round" onClick={() => addRound(si)}>+ Add round</button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function Rosters({ api, isAdmin, ov, patchOv, publish }) {
  const [editing, setEditing] = useState(false);
  const openEvents = liveEvents(ov).filter(e => e.status === 'open');
  const lineups = ov.lineups || {};
  const getLineup = (ev) => lineups[ev.id] || ev.lineup || {};
  const setLineup = (ev, lu) => patchOv({ lineups: { ...lineups, [ev.id]: lu } });
  const db = ov.driverDB || P.driverDB || [];
  const doneEditing = () => { setEditing(false); publish('lineups'); };

  const carOps = (ev, cls) => {
    const lu = getLineup(ev);
    const cars = lu[cls] || [];
    const write = (nextCars) => setLineup(ev, { ...lu, [cls]: nextCars });
    return {
      cars,
      addCar: () => write([...cars, { num: '', drivers: [] }]),
      delCar: (ci) => write(cars.filter((_, i) => i !== ci)),
      setNum: (ci, num) => write(cars.map((c, i) => i === ci ? { ...c, num } : c)),
      addDriver: (ci, name) => {
        if (!name.trim()) return;
        write(cars.map((c, i) => i === ci ? { ...c, drivers: [...c.drivers, name.trim()] } : c));
      },
      delDriver: (ci, di) => write(cars.map((c, i) => i === ci ? { ...c, drivers: c.drivers.filter((_, j) => j !== di) } : c)),
    };
  };

  return (
    <div className="pt-panel">
      <div className="pt-panel-head">
        <h2 className="pt-h2">Rosters</h2>
        <div className="pt-sched-controls">
          {isAdmin && ov.lineups && !LIVE && <ExportBtn data={ov.lineups} label="Export lineups" />}
          {isAdmin && (
            <button className="pt-subtab" data-active={editing} onClick={() => editing ? doneEditing() : setEditing(true)}>
              {editing ? (LIVE ? 'Done — publish' : 'Done editing') : 'Edit lineups'}
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="pt-note">
          Build each car: number + drivers (type a name — signups and the driver DB
          autocomplete, Enter to add). {LIVE
            ? <>Lineups go live for the team — and announce to Discord — when you hit <strong>Done — publish</strong>.</>
            : <>Saves in this browser; <strong>Export lineups</strong> → paste into each event's <span className="mono">lineup</span> in <span className="mono">portal-data.js</span> to publish.</>}
        </div>
      )}

      {openEvents.map(ev => {
        const entries = api.entriesFor(ev);
        const listId = `dl-${ev.id}`;
        const suggestions = [...new Set([...entries.map(en => en.driver), ...db.map(d => d.name).filter(Boolean)])];
        return (
          <div className="pt-roster-block" key={ev.id}>
            <div className="pt-rb-head">
              <span className="pt-rb-title">{ev.title}</span>
              <span className="pt-rb-date mono">{ev.date} · {entries.length} SIGNED UP</span>
            </div>

            <datalist id={listId}>
              {suggestions.map((n, i) => <option key={i} value={n} />)}
            </datalist>

            {ev.classes.map(cls => {
              const ops = carOps(ev, cls);
              if (!editing && ops.cars.length === 0) return null;
              return (
                <div className="pt-rb-class" key={cls}>
                  <div className="pt-rb-cls mono">{cls}</div>
                  <div className="pt-cars">
                    {ops.cars.map((car, ci) => (
                      <div className="pt-car" key={ci}>
                        <div className="pt-car-num">
                          {editing
                            ? <input className="pt-input pt-input--xs mono" value={car.num} placeholder="#" onChange={e => ops.setNum(ci, e.target.value)} />
                            : <span className="mono">#{car.num || '—'}</span>}
                          {editing && <button className="pt-en-x" title="Remove car" onClick={() => ops.delCar(ci)}>×</button>}
                        </div>
                        <div className="pt-car-drivers">
                          {car.drivers.map((d, di) => (
                            <span className="pt-chip" key={di}>
                              {d}
                              {editing && <button onClick={() => ops.delDriver(ci, di)}>×</button>}
                            </span>
                          ))}
                          {car.drivers.length === 0 && !editing && <span className="pt-empty-inline mono">NO DRIVERS ASSIGNED</span>}
                          {editing && (
                            <input className="pt-input pt-input--driver" list={listId} placeholder="+ add driver, press Enter"
                              onKeyDown={e => {
                                if (e.key === 'Enter') { e.preventDefault(); ops.addDriver(ci, e.target.value); e.target.value = ''; }
                              }} />
                          )}
                        </div>
                      </div>
                    ))}
                    {editing && (
                      <button className="pt-mini-btn" onClick={ops.addCar}>+ Add {cls} car</button>
                    )}
                  </div>
                </div>
              );
            })}
            {!editing && ev.classes.every(cls => (getLineup(ev)[cls] || []).length === 0) && (
              <div className="pt-empty">No lineup published yet{isAdmin ? ' — hit Edit lineups to build it' : ''}.</div>
            )}

            {entries.length > 0 && (
              <div className="pt-rb-class">
                <div className="pt-rb-cls mono">SIGNUP POOL</div>
                <div className="pt-roster">
                  {entries.map((en, i) => (
                    <div className="pt-roster-row" key={i}>
                      <span className="pt-rr-n mono">{String(i + 1).padStart(2, '0')}</span>
                      <span className="pt-rr-name">{en.driver}</span>
                      <span className="pt-rr-car mono">{en.cls}</span>
                      <span className="pt-en-state" data-state={en.state}>{STATE_LABEL[en.state] || en.state}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}

      <div className="pt-roster-block">
        <div className="pt-rb-head">
          <span className="pt-rb-title">FIS — Season 9</span>
          <span className="pt-rb-date mono">FIXED LINEUP · FROM SPOTTER GUIDE</span>
        </div>
        {P.fisRoster.map((t, i) => (
          <div className="pt-rb-class" key={i}>
            <div className="pt-rb-cls mono">{t.team.replace('Eclipse Competition', 'EC').trim() || 'MAIN'}</div>
            <div className="pt-roster">
              {t.drivers.map((d, j) => (
                <div className="pt-roster-row" key={j}>
                  <span className="pt-rr-n mono">{String(j + 1).padStart(2, '0')}</span>
                  <span className="pt-rr-name">{d}</span>
                  <span className="pt-rr-car mono">{t.team}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function Paints() {
  return (
    <div className="pt-panel">
      <div className="pt-panel-head">
        <h2 className="pt-h2">Paints</h2>
        <div className="pt-tag mono">TRADING PAINTS COLLECTIONS</div>
      </div>
      <div className="pt-paints">
        {P.paints.map((p, i) => (
          <a className="pt-paint-card" key={i} href={p.url} target="_blank" rel="noopener noreferrer">
            <div className="pt-dc-label">COLLECTION</div>
            <div className="pt-dc-big">{p.name}</div>
            <div className="pt-dc-sub">{p.note}</div>
            <div className="pt-paint-cta mono">OPEN ON TRADINGPAINTS →</div>
          </a>
        ))}
      </div>
      <div className="pt-note">
        Set Trading Paints to auto-download and the liveries above load in-sim
        automatically. Ping the PaintBooth channel for custom requests.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const DB_COLS = [
  { key: 'status',      label: 'STATUS' },
  { key: 'name',        label: 'NAME' },
  { key: 'discord',     label: 'DISCORD' },
  { key: 'iracingName', label: 'iR NAME' },
  { key: 'iracingId',   label: 'iR ID', num: true },
  { key: 'scIr',        label: 'SC iR', num: true },
  { key: 'fmIr',        label: 'FM iR', num: true },
  { key: 'scLic',       label: 'SC LIC' },
  { key: 'fmLic',       label: 'FM LIC' },
  { key: 'prefCars',    label: 'CARS' },
  { key: 'region',      label: 'REGION' },
  { key: 'joined',      label: 'JOINED' },
  { key: 'notes',       label: 'NOTES' },
];
const EMPTY_DRIVER = Object.fromEntries(DB_COLS.map(c => [c.key, '']));

// iRacing license badge — color-coded by class letter per iRacing's system:
// R rookie red, D orange, C yellow, B green, A blue, P/pro black.
function LicBadge({ v }) {
  const s = String(v || '').trim();
  if (!s) return <span className="mono">—</span>;
  return <span className="pt-lic mono" data-lic={s[0].toUpperCase()}>{s}</span>;
}

function DriverInfo({ ov, patchOv, publish }) {
  const [sort, setSort] = useState({ key: null, dir: 1 });
  const [filters, setFilters] = useState({});
  const [editing, setEditing] = useState(false);
  const db = ov.driverDB || P.driverDB || [];

  const write = (next) => patchOv({ driverDB: next });
  const setCell = (idx, key, val) => write(db.map((d, i) => i === idx ? { ...d, [key]: val } : d));
  const delRow = (idx) => {
    const d = db[idx];
    if (window.confirm(`Remove ${d.name || d.discord || 'this driver'} from the database?`)) {
      write(db.filter((_, i) => i !== idx));
    }
  };
  const addRow = () => { setFilters({}); setSort({ key: null, dir: 1 }); write([{ ...EMPTY_DRIVER, status: 'Trial' }, ...db]); };
  const doneEditing = () => { setEditing(false); publish('driverDB'); };

  const clickSort = (key) => setSort(s => s.key === key ? (s.dir === 1 ? { key, dir: -1 } : { key: null, dir: 1 }) : { key, dir: 1 });

  const view = useMemo(() => {
    let rows = db.map((d, i) => ({ d, i }));
    for (const [key, f] of Object.entries(filters)) {
      if (!f) continue;
      // Status is prefix-matched so "active" doesn't also catch "Inactive".
      rows = rows.filter(({ d }) => {
        const v = String(d[key] || '').toLowerCase(), q = f.toLowerCase();
        return key === 'status' ? v.startsWith(q) : v.includes(q);
      });
    }
    if (sort.key) {
      const col = DB_COLS.find(c => c.key === sort.key);
      rows = [...rows].sort((a, b) => {
        const av = a.d[sort.key] || '', bv = b.d[sort.key] || '';
        if (col.num) {
          const an = parseFloat(av), bn = parseFloat(bv);
          if (isNaN(an) && isNaN(bn)) return 0;
          if (isNaN(an)) return 1;
          if (isNaN(bn)) return -1;
          return (an - bn) * sort.dir;
        }
        if (!av && !bv) return 0;
        if (!av) return 1;
        if (!bv) return -1;
        return String(av).localeCompare(String(bv)) * sort.dir;
      });
    }
    return rows;
  }, [db, filters, sort]);

  const active = db.filter(d => d.status === 'Active');
  const avg = (arr) => {
    const n = arr.map(Number).filter(x => x > 0);
    return n.length ? Math.round(n.reduce((a, b) => a + b, 0) / n.length) : '—';
  };

  return (
    <div className="pt-panel">
      <div className="pt-panel-head">
        <h2 className="pt-h2">Driver Info</h2>
        <div className="pt-sched-controls">
          {ov.driverDB && !LIVE && <ExportBtn data={db} label="Export JSON" />}
          {ov.driverDB && !editing && !LIVE && (
            <button className="pt-mini-btn pt-mini-btn--warn" onClick={() => {
              if (window.confirm('Discard local driver DB edits and go back to what portal-data.js says?')) patchOv({ driverDB: undefined });
            }}>Reset to file</button>
          )}
          {editing && <button className="pt-mini-btn" onClick={addRow}>+ Add driver</button>}
          <button className="pt-subtab" data-active={editing} onClick={() => editing ? doneEditing() : setEditing(true)}>
            {editing ? (LIVE ? 'Done — publish' : 'Done editing') : 'Edit'}
          </button>
        </div>
      </div>

      <div className="pt-dash-grid pt-dash-grid--tiles">
        <div className="pt-dash-card pt-dash-card--static">
          <div className="pt-dc-label">TOTAL</div>
          <div className="pt-dc-big">{db.length}</div>
        </div>
        <div className="pt-dash-card pt-dash-card--static">
          <div className="pt-dc-label">ACTIVE</div>
          <div className="pt-dc-big">{active.length}</div>
        </div>
        <div className="pt-dash-card pt-dash-card--static">
          <div className="pt-dc-label">AVG SC iR (ACTIVE)</div>
          <div className="pt-dc-big">{avg(active.map(d => d.scIr))}</div>
        </div>
        <div className="pt-dash-card pt-dash-card--static">
          <div className="pt-dc-label">AVG FM iR (ACTIVE)</div>
          <div className="pt-dc-big">{avg(active.map(d => d.fmIr))}</div>
        </div>
      </div>

      {editing && (
        <div className="pt-note">
          {LIVE
            ? <>Changes save for all admins when you hit <strong>Done — publish</strong>. Drivers can never see this tab or its data.</>
            : <>Edits save in this browser only. <strong>Export JSON</strong> → paste over the
               <span className="mono"> driverDB</span> block in <span className="mono">portal-data.js</span> to publish.</>}
          {' '}Filters still work while editing.
        </div>
      )}

      <div className="pt-db">
        <div className="pt-db-row pt-db-row--head mono">
          {DB_COLS.map(c => (
            <button key={c.key} className="pt-db-sort" data-active={sort.key === c.key} onClick={() => clickSort(c.key)}>
              {c.label}{sort.key === c.key ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
            </button>
          ))}
          <span />
        </div>
        <div className="pt-db-row pt-db-row--filters">
          {DB_COLS.map(c => (
            <input key={c.key} className="pt-db-filter mono" placeholder="filter"
                   value={filters[c.key] || ''}
                   onChange={e => setFilters(f => ({ ...f, [c.key]: e.target.value }))} />
          ))}
          <button className="pt-en-x" title="Clear filters" onClick={() => setFilters({})}>×</button>
        </div>
        {view.map(({ d, i }) => (
          <div className="pt-db-row" key={i} data-editing={editing}>
            {editing ? (
              DB_COLS.map(c => (
                <input key={c.key} className="pt-db-edit mono" value={d[c.key] || ''}
                       onChange={e => setCell(i, c.key, e.target.value)} />
              ))
            ) : (
              <>
                <span className="pt-db-status" data-status={d.status}>{d.status}</span>
                <span className="pt-db-name">{d.name || '—'}</span>
                <span className="mono">{d.discord}</span>
                <span>{d.iracingName || '—'}</span>
                <span className="mono">{d.iracingId || '—'}</span>
                <span className="mono">{d.scIr || '—'}</span>
                <span className="mono">{d.fmIr || '—'}</span>
                <span><LicBadge v={d.scLic} /></span>
                <span><LicBadge v={d.fmLic} /></span>
                <span>{d.prefCars || '—'}</span>
                <span className="mono">{d.region || '—'}</span>
                <span className="mono">{d.joined || '—'}</span>
                <span className="pt-db-notes">{d.notes}</span>
              </>
            )}
            {editing
              ? <button className="pt-en-x" title="Delete driver" onClick={() => delRow(i)}>×</button>
              : <span />}
          </div>
        ))}
        {view.length === 0 && <div className="pt-empty">No drivers match.</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function Portal({ user, onLogout }) {
  const [tab, setTab] = useState('dash');
  const isAdmin = user.role === 'admin';

  // ── Signups: local map (build mode) or shared table (live mode) ────────────
  const [localMap, setLocalMap] = useState(loadLocalSignups);
  const [remote, setRemote] = useState({});
  const refreshSignups = async () => {
    const { data, error } = await sb.from('signups').select('*').order('created_at');
    if (!error && data) {
      const m = {};
      for (const r of data) (m[r.event_id] = m[r.event_id] || []).push(r);
      setRemote(m);
    }
  };
  useEffect(() => {
    if (!LIVE) return;
    refreshSignups();
    const ch = sb.channel('signups-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'signups' }, refreshSignups)
      .subscribe();
    return () => { sb.removeChannel(ch); };
  }, []);

  const api = LIVE ? {
    entriesFor: (ev) => [
      ...ev.entries,
      ...(remote[ev.id] || []).map(r => ({ driver: r.driver_name, cls: r.cls, state: r.state, _row: r })),
    ],
    mineAll: (ev) => api.entriesFor(ev).filter(en => en._row && en._row.user_id === user.id),
    join: async (ev, cls, state) => {
      const { error } = await sb.from('signups').insert({
        event_id: ev.id, event_title: ev.title, cls, state,
        driver_name: user.name, discord_username: user.username,
      });
      if (error) {
        window.alert(error.code === '23505'
          ? `You're already signed up for ${cls} at this event.`
          : 'Signup failed: ' + error.message);
      }
      refreshSignups();
    },
    leave: async (ev, en) => {
      // Per-entry withdrawal — you can be in multiple classes now.
      if (en && en._row) await sb.from('signups').delete().eq('id', en._row.id);
      else await sb.from('signups').delete().eq('event_id', ev.id).eq('user_id', user.id);
      refreshSignups();
    },
    remove: async (ev, en) => {
      if (!en._row) return;
      await sb.from('signups').delete().eq('id', en._row.id);
      refreshSignups();
    },
    canRemove: (ev, en) => !!en._row,
  } : {
    entriesFor: (ev) => [...ev.entries, ...(localMap[ev.id] || [])],
    mineAll: (ev) => api.entriesFor(ev).filter(en => en.driver === user.name),
    join: (ev, cls, state) => {
      const locals = localMap[ev.id] || [];
      if (locals.some(en => en.driver === user.name && en.cls === cls)) return;
      const next = { ...localMap, [ev.id]: [...locals, { driver: user.name, cls, state }] };
      setLocalMap(next); saveLocalSignups(next);
    },
    leave: (ev, en) => {
      const next = { ...localMap, [ev.id]: (localMap[ev.id] || []).filter(x => x !== en) };
      setLocalMap(next); saveLocalSignups(next);
    },
    remove: (ev, en) => {
      const next = { ...localMap, [ev.id]: (localMap[ev.id] || []).filter(x => x !== en) };
      setLocalMap(next); saveLocalSignups(next);
    },
    canRemove: (ev, en) => (localMap[ev.id] || []).includes(en),
  };

  // ── Docs: localStorage overrides (build) or portal_docs table (live) ───────
  const [ov, setOv] = useState(() => (LIVE ? {} : loadOverrides()));
  useEffect(() => {
    if (!LIVE) return;
    sb.from('portal_docs').select('key,data').then(({ data }) => {
      if (!data) return;
      const m = {};
      for (const r of data) {
        if (r.key === 'schedules') m.schedules = r.data;
        if (r.key === 'lineups') m.lineups = r.data;
        if (r.key === 'driver_db') m.driverDB = r.data;
        if (r.key === 'events') m.events = r.data;
      }
      setOv(m);
    });
  }, [user.id]);

  const patchOv = (patch) => setOv(prev => {
    const next = { ...prev, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    if (!LIVE) store.set(OVERRIDE_KEY, JSON.stringify(next));
    return next;
  });

  const publish = async (key) => {
    if (!LIVE) return;
    const dbKey = key === 'driverDB' ? 'driver_db' : key;
    const payload = key === 'schedules' ? ov.schedules
                  : key === 'lineups' ? (ov.lineups || {})
                  : key === 'events' ? ov.events
                  : ov.driverDB;
    if (payload === undefined || payload === null) return;
    const { error } = await sb.from('portal_docs').upsert({
      key: dbKey, data: payload, updated_at: new Date().toISOString(), updated_by: user.username,
    });
    if (error) window.alert('Publish failed: ' + error.message);
  };

  const TABS = [
    { key: 'dash',       label: 'Dashboard' },
    { key: 'events',     label: 'Events & Signups' },
    { key: 'schedule',   label: 'Schedules' },
    { key: 'rosters',    label: 'Rosters' },
    { key: 'paints',     label: 'Paints' },
    ...(isAdmin ? [{ key: 'driverinfo', label: 'Driver Info' }] : []),
  ];

  return (
    <div className="pt-shell">
      <header className="pt-top">
        <a className="brand" href="index.html">
          <img src="assets/icon-white.png" alt="" width="28" height="28" />
          <span className="wm">ECLIPSE <span>PORTAL</span></span>
        </a>
        <nav className="pt-tabs">
          {TABS.map(t => (
            <button key={t.key} className="pt-tab" data-active={tab === t.key}
                    data-admin={t.key === 'driverinfo'}
                    onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </nav>
        <div className="pt-user">
          <span className="pt-user-name">{user.name}{isAdmin && <em> · ADMIN</em>}</span>
          <button className="pt-logout" onClick={onLogout}>Log out</button>
        </div>
      </header>
      <main className={"pt-main" + (tab === 'driverinfo' ? ' pt-main--wide' : '')}>
        {tab === 'dash'       && <Dashboard user={user} api={api} goto={setTab} isAdmin={isAdmin} ov={ov} />}
        {tab === 'events'     && <Events user={user} isAdmin={isAdmin} api={api} ov={ov} patchOv={patchOv} publish={publish} />}
        {tab === 'schedule'   && <Schedule isAdmin={isAdmin} ov={ov} patchOv={patchOv} publish={publish} />}
        {tab === 'rosters'    && <Rosters api={api} isAdmin={isAdmin} ov={ov} patchOv={patchOv} publish={publish} />}
        {tab === 'paints'     && <Paints />}
        {tab === 'driverinfo' && isAdmin && <DriverInfo ov={ov} patchOv={patchOv} publish={publish} />}
      </main>
      <footer className="pt-foot mono">
        ECLIPSE COMPETITION · TEAM PORTAL · {LIVE ? 'LIVE' : 'IN DEVELOPMENT — DATA MAY LAG THE DISCORD'}
      </footer>
    </div>
  );
}

function PortalApp() {
  const [user, setUser] = useState(() => (LIVE ? null : localAuth.current()));
  const [booting, setBooting] = useState(LIVE);
  const [gateErr, setGateErr] = useState('');

  useEffect(() => {
    if (!LIVE) return;
    const handle = async (session) => {
      if (!session) { setUser(null); return; }
      const ok = await checkGuild(session);
      if (!ok) {
        setGateErr("That Discord account isn't in the Eclipse server. Join the Discord first, then log in again.");
        await sb.auth.signOut();
        setUser(null);
        return;
      }
      setGateErr('');
      setUser(mapSession(session));
    };
    sb.auth.getSession().then(async ({ data }) => {
      await handle(data.session);
      setBooting(false);
    });
    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => { handle(session); });
    return () => sub.subscription.unsubscribe();
  }, []);

  if (booting) {
    return (
      <div className="pt-login">
        <div className="pt-login-card">
          <img src="assets/logo-white.png" alt="Eclipse Competition" className="pt-login-logo" />
          <div className="pt-login-eyebrow">/ CONNECTING…</div>
        </div>
      </div>
    );
  }
  if (!user) return <Login onAuthed={setUser} gateErr={gateErr} />;
  return (
    <Portal user={user} onLogout={async () => {
      if (LIVE) await sb.auth.signOut(); else localAuth.logout();
      setUser(null);
    }} />
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.error('Eclipse portal error:', err); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="site-fallback">
        <img src="assets/logo-white.png" alt="Eclipse Competition" />
        <p>The portal hit an error. Ping Griffin on Discord.</p>
      </div>
    );
  }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(P ? <ErrorBoundary><PortalApp /></ErrorBoundary> : <div className="site-fallback"><p>portal-data.js failed to load.</p></div>);
