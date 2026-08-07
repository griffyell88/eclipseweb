// Eclipse Competition — Driver Portal
// Structure mirrors app.jsx: no build step, data comes from portal-data.js.
//
// AUTH DISCLAIMER: the login below is a curtain for the build phase — it hashes
// credentials client-side against portal-data.js, which ships to the browser.
// The swap to real auth (Supabase + Discord login) is isolated in `auth` below:
// replace its functions and the rest of the portal doesn't change. Admin/driver
// roles come from the user record now, and from auth.adminDiscord once Discord
// login lands.
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
function allEntries(ev, localMap) { return [...ev.entries, ...(localMap[ev.id] || [])]; }

const STATE_LABEL = { confirmed: 'CONFIRMED', available: 'AVAILABLE', tentative: 'TENTATIVE', reserve: 'RESERVE' };

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
          Not a member? <a href={(window.EC_DATA && window.EC_DATA.brand.discord) || 'https://discord.gg/CBtQMmcksE'}>Join the Discord</a>
        </div>
      </form>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function Dashboard({ user, localMap, goto, isAdmin }) {
  const open = P.events.filter(e => e.status === 'open');
  const next = open[0];
  const nextEntries = next ? allEntries(next, localMap) : [];
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
          <div className="pt-dc-sub">event rosters + FIS</div>
        </button>
        {isAdmin ? (
          <button className="pt-dash-card" onClick={() => goto('driverinfo')}>
            <div className="pt-dc-label">DRIVER DATABASE</div>
            <div className="pt-dc-big">{P.driverDB.length}</div>
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
      <div className="pt-note">
        <strong>Build note:</strong> signups you make here save to this browser only for
        now. The team-wide backend (Discord login) is the next phase — until then,
        entries in <span className="mono">portal-data.js</span> are the shared source of truth.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function EventCard({ ev, user, localMap, setLocalMap, isAdmin }) {
  const localEntries = (localMap[ev.id] || []);
  const entries = [...ev.entries, ...localEntries];
  const mine = entries.find(en => en.driver === user.name);
  const locked = ev.status !== 'open';
  const firmState = ev.mode === 'admin' ? 'available' : 'confirmed';

  const join = (cls, state) => {
    if (mine || locked) return;
    const next = { ...localMap, [ev.id]: [...localEntries, { driver: user.name, cls, state }] };
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
            ? <>
                <span className="pt-ev-in mono" data-state={mine.state}>
                  // YOU'RE IN — {mine.cls} · {STATE_LABEL[mine.state]}
                </span>
                <button className="btn pt-btn-sm" onClick={leave}>Withdraw</button>
              </>
            : <span className="pt-ev-in mono">// YOU'RE ON THE ENTRY LIST</span>
        ) : !locked && (
          <div className="pt-signup-rows">
            <div className="pt-signup-row">
              {ev.classes.map(cls => (
                <button key={cls} className="btn btn-primary pt-btn-sm" onClick={() => join(cls, firmState)}>
                  {ev.mode === 'admin' ? `Available — ${cls}` : `Sign up — ${cls}`}
                </button>
              ))}
            </div>
            <div className="pt-signup-row">
              {ev.classes.map(cls => (
                <button key={cls} className="btn pt-btn-sm pt-btn-tent" onClick={() => join(cls, 'tentative')}>
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

function Events({ user, isAdmin, localMap, setLocalMap }) {
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
                <span className="pt-round-n mono">{r.r ? `R${r.r}` : '—'}</span>
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
// Rosters: auto-built from event signups (one block per open event, grouped by
// class), plus the static FIS roster from the spotter guide.
function Rosters({ localMap }) {
  const openEvents = P.events.filter(e => e.status === 'open');
  return (
    <div className="pt-panel">
      <div className="pt-panel-head">
        <h2 className="pt-h2">Rosters</h2>
        <div className="pt-tag mono">AUTO-BUILT FROM SIGNUPS</div>
      </div>

      {openEvents.map(ev => {
        const entries = allEntries(ev, localMap);
        const byClass = ev.classes.map(cls => ({ cls, list: entries.filter(en => en.cls === cls) }));
        return (
          <div className="pt-roster-block" key={ev.id}>
            <div className="pt-rb-head">
              <span className="pt-rb-title">{ev.title}</span>
              <span className="pt-rb-date mono">{ev.date} · {entries.length} {entries.length === 1 ? 'DRIVER' : 'DRIVERS'}</span>
            </div>
            {entries.length === 0 ? (
              <div className="pt-empty">No signups yet — first in gets the good stint.</div>
            ) : byClass.map(({ cls, list }) => list.length > 0 && (
              <div className="pt-rb-class" key={cls}>
                <div className="pt-rb-cls mono">{cls}</div>
                <div className="pt-roster">
                  {list.map((en, i) => (
                    <div className="pt-roster-row" key={i}>
                      <span className="pt-rr-n mono">{String(i + 1).padStart(2, '0')}</span>
                      <span className="pt-rr-name">{en.driver}</span>
                      <span className="pt-en-state" data-state={en.state}>{STATE_LABEL[en.state] || en.state}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
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
// Admin-only: the driver database from the team spreadsheet.
const DB_STATUSES = ['All', 'Active', 'Trial', 'Inactive', 'One Off'];
function DriverInfo() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('Active');
  const db = P.driverDB;

  const list = useMemo(() => db.filter(d => {
    if (status !== 'All' && d.status !== status) return false;
    const hay = `${d.name} ${d.discord} ${d.iracingName} ${d.prefCars} ${d.region} ${d.source} ${d.notes}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  }), [q, status]);

  const active = db.filter(d => d.status === 'Active');
  const avg = (arr) => {
    const n = arr.map(Number).filter(x => x > 0);
    return n.length ? Math.round(n.reduce((a, b) => a + b, 0) / n.length) : '—';
  };

  return (
    <div className="pt-panel">
      <div className="pt-panel-head">
        <h2 className="pt-h2">Driver Info</h2>
        <div className="pt-tag mono">ADMIN ONLY · FROM THE TEAM SPREADSHEET</div>
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

      <div className="pt-db-controls">
        <input className="pt-search" placeholder="Search name, Discord, cars, notes…"
               value={q} onChange={e => setQ(e.target.value)} />
        <div className="pt-subtabs">
          {DB_STATUSES.map(s => (
            <button key={s} className="pt-subtab" data-active={s === status}
                    onClick={() => setStatus(s)}>{s}</button>
          ))}
        </div>
      </div>

      <div className="pt-db">
        <div className="pt-db-row pt-db-row--head mono">
          <span>STATUS</span><span>NAME</span><span>DISCORD</span><span>iR NAME / ID</span>
          <span>SC iR</span><span>FM iR</span><span>SC LIC</span><span>FM LIC</span>
          <span>CARS</span><span>REGION</span><span>NOTES</span>
        </div>
        {list.map((d, i) => (
          <div className="pt-db-row" key={i}>
            <span className="pt-db-status" data-status={d.status}>{d.status}</span>
            <span className="pt-db-name">{d.name || '—'}</span>
            <span className="mono">{d.discord}</span>
            <span className="pt-db-irname">{d.iracingName || '—'}{d.iracingId && <em className="mono"> #{d.iracingId}</em>}</span>
            <span className="mono">{d.scIr || '—'}</span>
            <span className="mono">{d.fmIr || '—'}</span>
            <span className="mono">{d.scLic || '—'}</span>
            <span className="mono">{d.fmLic || '—'}</span>
            <span>{d.prefCars || '—'}</span>
            <span className="mono">{d.region || '—'}</span>
            <span className="pt-db-notes">{d.notes}</span>
          </div>
        ))}
        {list.length === 0 && <div className="pt-empty">No drivers match.</div>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function Portal({ user, onLogout }) {
  const [tab, setTab] = useState('dash');
  const [localMap, setLocalMap] = useState(loadLocalSignups);
  const isAdmin = user.role === 'admin';

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
      <main className="pt-main">
        {tab === 'dash'       && <Dashboard user={user} localMap={localMap} goto={setTab} isAdmin={isAdmin} />}
        {tab === 'events'     && <Events user={user} isAdmin={isAdmin} localMap={localMap} setLocalMap={setLocalMap} />}
        {tab === 'schedule'   && <Schedule />}
        {tab === 'rosters'    && <Rosters localMap={localMap} />}
        {tab === 'paints'     && <Paints />}
        {tab === 'driverinfo' && isAdmin && <DriverInfo />}
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
