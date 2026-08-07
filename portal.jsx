// Eclipse Competition — Driver Portal
// Structure mirrors app.jsx: no build step, data comes from portal-data.js.
//
// AUTH DISCLAIMER (read me): the login below is a curtain for the build phase.
// It hashes credentials client-side and compares against portal-data.js, which
// ships to the browser — so it keeps casual visitors out and nothing more.
// The swap to real auth is isolated in `auth` below: replace its three
// functions with Supabase calls and the rest of the portal doesn't change.
const { useState, useEffect, useMemo } = React;
const P = window.EC_PORTAL;

// Guarded storage — same rationale as app.jsx (Safari/Brave can throw).
const store = {
  get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* no-op */ } },
  del(k) { try { window.localStorage.removeItem(k); } catch (e) { /* no-op */ } },
};

async function sha256(text) {
  // crypto.subtle needs a secure context (https or localhost). file:// won't work.
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
}

// ── Auth layer: the ONLY thing that changes when Supabase lands ──────────────
const SESSION_KEY = 'ec-portal-session';
const auth = {
  current() {
    const raw = store.get(SESSION_KEY);
    if (!raw) return null;
    try {
      const s = JSON.parse(raw);
      return P.auth.users.find(u => u.user === s.user) || null;
    } catch (e) { return null; }
  },
  async login(user, pass) {
    if (!window.crypto || !crypto.subtle) {
      throw new Error('Secure crypto unavailable — open the portal over https or localhost.');
    }
    const hash = await sha256(`${user.trim().toLowerCase()}:${pass}`);
    const match = P.auth.users.find(u => u.user === user.trim().toLowerCase() && u.hash === hash);
    if (!match) throw new Error('Wrong username or password.');
    store.set(SESSION_KEY, JSON.stringify({ user: match.user }));
    return match;
  },
  logout() { store.del(SESSION_KEY); },
};

// ── Signup persistence (browser-local until the backend exists) ─────────────
// Merges UI-added entries on top of the entries hardcoded in portal-data.js.
const SIGNUP_KEY = 'ec-portal-signups';
function loadLocalSignups() {
  try { return JSON.parse(store.get(SIGNUP_KEY) || '{}'); } catch (e) { return {}; }
}
function saveLocalSignups(map) { store.set(SIGNUP_KEY, JSON.stringify(map)); }

// ─────────────────────────────────────────────────────────────────────────────
function Login({ onAuthed }) {
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const u = await auth.login(user, pass);
      onAuthed(u);
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pt-login">
      <form className="pt-login-card" onSubmit={submit}>
        <img src="assets/logo-white.png" alt="Eclipse Competition" className="pt-login-logo" />
        <div className="pt-login-eyebrow">/ TEAM PORTAL · RESTRICTED</div>
        <h1 className="pt-login-title">Driver<br/>Access</h1>
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
          Driver accounts &amp; Discord login coming soon.<br/>
          Not a member? <a href={ (window.EC_DATA && window.EC_DATA.brand.discord) || 'https://discord.gg/CBtQMmcksE' }>Join the Discord</a>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function Dashboard({ user, events, goto }) {
  const open = events.filter(e => e.status === 'open');
  const next = open[0];
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
              <div className="pt-dc-meta">{next.entries.length}/{next.seats} seats filled · signups {next.status}</div>
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
          <div className="pt-dc-big">{P.rosters.length}</div>
          <div className="pt-dc-sub">active series rosters</div>
        </button>
        <button className="pt-dash-card" onClick={() => goto('setups')}>
          <div className="pt-dc-label">SETUP LIBRARY</div>
          <div className="pt-dc-big">{P.setups.length}</div>
          <div className="pt-dc-sub">setups on file</div>
        </button>
      </div>
      <div className="pt-note">
        <strong>Build note:</strong> signups you make here save to this browser only for
        now. The team-wide backend (real accounts + Discord login) is the next phase —
        until then, rosters and entries in <span className="mono">portal-data.js</span> are the source of truth.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function EventCard({ ev, user, localMap, setLocalMap, isAdmin }) {
  const localEntries = (localMap[ev.id] || []);
  const entries = [...ev.entries, ...localEntries];
  const full = entries.length >= ev.seats;
  const mine = entries.find(en => en.driver === user.name);
  const locked = ev.status !== 'open';

  const join = (cls) => {
    if (mine || full || locked) return;
    const next = { ...localMap, [ev.id]: [...localEntries, { driver: user.name, cls, state: ev.mode === 'admin' ? 'available' : 'confirmed' }] };
    setLocalMap(next); saveLocalSignups(next);
  };
  const leave = () => {
    const next = { ...localMap, [ev.id]: localEntries.filter(en => en.driver !== user.name) };
    setLocalMap(next); saveLocalSignups(next);
    // Entries hardcoded in portal-data.js can't be removed from the UI — by design.
  };

  return (
    <div className={"pt-event" + (ev.featured ? " pt-event--featured" : "")} data-locked={locked}>
      <div className="pt-ev-head">
        <div>
          <div className="pt-ev-date mono">{ev.date} · {ev.series.toUpperCase()}</div>
          <div className="pt-ev-title">{ev.title}</div>
          <div className="pt-ev-track">{ev.track}</div>
        </div>
        <div className="pt-ev-status">
          <span className="pt-badge" data-kind={locked ? 'locked' : full ? 'full' : 'open'}>
            {locked ? 'LOCKED' : full ? 'FULL' : 'OPEN'}
          </span>
          <span className="pt-seats mono">{entries.length}/{ev.seats}</span>
        </div>
      </div>

      <div className="pt-ev-mode mono">
        {ev.mode === 'admin'
          ? '// AVAILABILITY EVENT — mark yourself available, admins pick the lineup'
          : '// SELF-SIGNUP — claim a seat directly'}
      </div>

      {entries.length > 0 && (
        <ul className="pt-ev-entries">
          {entries.map((en, i) => (
            <li key={i}>
              <span className="pt-en-driver">{en.driver}</span>
              <span className="pt-en-cls mono">{en.cls}</span>
              <span className="pt-en-state" data-state={en.state}>{en.state.toUpperCase()}</span>
              {isAdmin && localEntries.includes(en) && (
                <button className="pt-en-x" title="Remove (admin)" onClick={() => {
                  const next = { ...localMap, [ev.id]: localEntries.filter(x => x !== en) };
                  setLocalMap(next); saveLocalSignups(next);
                }}>×</button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="pt-ev-actions">
        {mine ? (
          localEntries.includes(mine)
            ? <button className="btn pt-btn-sm" onClick={leave}>Withdraw</button>
            : <span className="pt-ev-in mono">// YOU'RE ON THE ENTRY LIST</span>
        ) : (
          ev.classes.map(cls => (
            <button key={cls} className="btn btn-primary pt-btn-sm"
                    disabled={full || locked} onClick={() => join(cls)}>
              {ev.mode === 'admin' ? `Available — ${cls}` : `Sign up — ${cls}`}
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function Events({ user, isAdmin }) {
  const [localMap, setLocalMap] = useState(loadLocalSignups);
  return (
    <div className="pt-panel">
      <div className="pt-panel-head">
        <h2 className="pt-h2">Events &amp; Signups</h2>
        <div className="pt-tag mono">REPLACES #race-check-in</div>
      </div>
      <div className="pt-events">
        {P.events.map(ev => (
          <EventCard key={ev.id} ev={ev} user={user} localMap={localMap}
                     setLocalMap={setLocalMap} isAdmin={isAdmin} />
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function Schedule() {
  return (
    <div className="pt-panel">
      <div className="pt-panel-head">
        <h2 className="pt-h2">Schedules</h2>
        <div className="pt-tag mono">REPLACES #schedules</div>
      </div>
      {P.schedules.map((s, i) => (
        <div className="pt-sched" key={i}>
          <div className="pt-sched-head">
            <span className="pt-sched-series">{s.series}</span>
            <span className="pt-sched-cad mono">{s.cadence}</span>
          </div>
          <div className="pt-sched-rounds">
            {s.rounds.map((r, j) => (
              <div className="pt-round" key={j}>
                <span className="pt-round-n mono">R{r.r}</span>
                <span className="pt-round-date mono">{r.date}</span>
                <span className="pt-round-track">{r.track}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function Rosters() {
  const [active, setActive] = useState(P.rosters[0].key);
  const roster = P.rosters.find(r => r.key === active);
  return (
    <div className="pt-panel">
      <div className="pt-panel-head">
        <h2 className="pt-h2">Rosters</h2>
        <div className="pt-tag mono">REPLACES THE 4 ROSTER CHANNELS</div>
      </div>
      <div className="pt-subtabs">
        {P.rosters.map(r => (
          <button key={r.key} className="pt-subtab" data-active={r.key === active}
                  onClick={() => setActive(r.key)}>{r.name}</button>
        ))}
      </div>
      <div className="pt-roster">
        {roster.drivers.map((d, i) => (
          <div className="pt-roster-row" key={i}>
            <span className="pt-rr-n mono">{String(i + 1).padStart(2, '0')}</span>
            <span className="pt-rr-name">{d.name}</span>
            <span className="pt-rr-car mono">{d.car}</span>
            <span className="pt-rr-note">{d.note}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function Setups() {
  const [q, setQ] = useState('');
  const list = P.setups.filter(s =>
    (s.series + s.track + s.car + s.name + s.by).toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="pt-panel">
      <div className="pt-panel-head">
        <h2 className="pt-h2">Setup Library</h2>
        <div className="pt-tag mono">PHASE 2 · FILE HOSTING LATER</div>
      </div>
      <input className="pt-search" placeholder="Filter by track, car, series…"
             value={q} onChange={e => setQ(e.target.value)} />
      <div className="pt-setups">
        <div className="pt-setup-row pt-setup-row--head mono">
          <span>SERIES</span><span>TRACK</span><span>CAR</span><span>SETUP</span><span>BY</span><span>UPDATED</span>
        </div>
        {list.map((s, i) => (
          <div className="pt-setup-row" key={i}>
            <span className="mono">{s.series}</span>
            <span>{s.track}</span>
            <span>{s.car}</span>
            <span className="pt-setup-name">{s.link ? <a href={s.link}>{s.name}</a> : s.name}</span>
            <span>{s.by}</span>
            <span className="mono">{s.updated}</span>
          </div>
        ))}
        {list.length === 0 && <div className="pt-empty">No setups match “{q}”.</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'dash',     label: 'Dashboard' },
  { key: 'events',   label: 'Events & Signups' },
  { key: 'schedule', label: 'Schedules' },
  { key: 'rosters',  label: 'Rosters' },
  { key: 'setups',   label: 'Setups' },
];

function Portal({ user, onLogout }) {
  const [tab, setTab] = useState('dash');
  const isAdmin = user.role === 'admin';
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
                    onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </nav>
        <div className="pt-user">
          <span className="pt-user-name">{user.name}{isAdmin && <em> · ADMIN</em>}</span>
          <button className="pt-logout" onClick={onLogout}>Log out</button>
        </div>
      </header>
      <main className="pt-main">
        {tab === 'dash'     && <Dashboard user={user} events={P.events} goto={setTab} />}
        {tab === 'events'   && <Events user={user} isAdmin={isAdmin} />}
        {tab === 'schedule' && <Schedule />}
        {tab === 'rosters'  && <Rosters />}
        {tab === 'setups'   && <Setups />}
      </main>
      <footer className="pt-foot mono">
        ECLIPSE COMPETITION · TEAM PORTAL · IN DEVELOPMENT — DATA MAY LAG THE DISCORD
      </footer>
    </div>
  );
}

function PortalApp() {
  const [user, setUser] = useState(() => auth.current());
  if (!user) return <Login onAuthed={setUser} />;
  return <Portal user={user} onLogout={() => { auth.logout(); setUser(null); }} />;
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
