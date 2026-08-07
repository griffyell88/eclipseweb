// Eclipse Competition — Driver Portal
// Structure mirrors app.jsx: no build step, data comes from portal-data.js.
//
// AUTH DISCLAIMER: the login below is a curtain for the build phase — it hashes
// credentials client-side against portal-data.js, which ships to the browser.
// The swap to real auth (Supabase + Discord login) is isolated in `auth` below.
//
// ADMIN EDITING: schedule/lineup/driver-DB edits save to THIS BROWSER ONLY
// (localStorage overrides on top of portal-data.js). Each editable section has
// an Export button — copy the JSON and paste it into portal-data.js to make
// changes permanent for everyone. This all moves server-side with Supabase.
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

// ── Local persistence (browser-local until the backend exists) ───────────────
const SIGNUP_KEY = 'ec-portal-signups';
function loadLocalSignups() {
  try { return JSON.parse(store.get(SIGNUP_KEY) || '{}'); } catch (e) { return {}; }
}
function saveLocalSignups(map) { store.set(SIGNUP_KEY, JSON.stringify(map)); }
function allEntries(ev, localMap) { return [...ev.entries, ...(localMap[ev.id] || [])]; }

// Admin edits live here as overrides on top of portal-data.js:
// { schedules: [...]?, lineups: { [eventId]: { [class]: [{num, drivers[]}] } }?, driverDB: [...]? }
const OVERRIDE_KEY = 'ec-portal-overrides';
function loadOverrides() {
  try { return JSON.parse(store.get(OVERRIDE_KEY) || '{}'); } catch (e) { return {}; }
}

const STATE_LABEL = { confirmed: 'CONFIRMED', available: 'AVAILABLE', tentative: 'TENTATIVE', reserve: 'RESERVE' };

// ── Date automation ──────────────────────────────────────────────────────────
// A round/event is "past" starting the day AFTER its end date, so race day
// itself still shows as upcoming (same rule as the public site's calendar).
function isPast(iso) {
  if (!iso) return false;
  const end = new Date(iso + 'T23:59:59');
  return new Date() > end;
}
function liveEvents() {
  return P.events
    .filter(ev => !isPast(ev.end))
    .sort((a, b) => (a.end || '9999').localeCompare(b.end || '9999'));
}

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
function Dashboard({ user, localMap, goto, isAdmin, ov }) {
  const open = liveEvents().filter(e => e.status === 'open');
  const next = open[0];
  const nextEntries = next ? allEntries(next, localMap) : [];
  const db = ov.driverDB || P.driverDB;
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
      <div className="pt-note">
        <strong>Build note:</strong> signups{isAdmin ? ' and admin edits' : ''} save to this
        browser only for now — the team-wide backend (Discord login) is the next phase.
        {isAdmin && <> Use the Export buttons to copy edits into <span className="mono">portal-data.js</span> so everyone gets them.</>}
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
  const evs = liveEvents();
  return (
    <div className="pt-panel">
      <div className="pt-panel-head">
        <h2 className="pt-h2">Events &amp; Signups</h2>
        <div className="pt-tag mono">REPLACES #race-check-in</div>
      </div>
      <div className="pt-events">
        {evs.map(ev => (
          <EventCard key={ev.id} ev={ev} user={user} localMap={localMap}
                     setLocalMap={setLocalMap} isAdmin={isAdmin} />
        ))}
        {evs.length === 0 && (
          <div className="pt-empty">No upcoming events — new ones appear here when they're added to portal-data.js.</div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function Schedule({ isAdmin, ov, patchOv }) {
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
  const setSeries = (si, field, val) => mutate(s => { s[si][field] = val; });
  const hasOverride = !!ov.schedules;

  return (
    <div className="pt-panel">
      <div className="pt-panel-head">
        <h2 className="pt-h2">Schedules</h2>
        <div className="pt-sched-controls">
          {isAdmin && (
            <>
              {hasOverride && <ExportBtn data={schedules} label="Export JSON" />}
              {hasOverride && !editing && (
                <button className="pt-mini-btn pt-mini-btn--warn" onClick={() => {
                  if (window.confirm('Discard local schedule edits and go back to what portal-data.js says?')) patchOv({ schedules: undefined });
                }}>Reset to file</button>
              )}
              <button className="pt-subtab" data-active={editing} onClick={() => setEditing(!editing)}>
                {editing ? 'Done editing' : 'Edit schedules'}
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
          Edits save in this browser only. When the schedule's right, hit <strong>Export
          JSON</strong> and paste it over the <span className="mono">schedules</span> block in
          <span className="mono"> portal-data.js</span> (or send it to Claude) to make it live for everyone.
          Dates: <span className="mono">iso</span> = the round's last day, <span className="mono">YYYY-MM-DD</span> — it drives the auto-hiding.
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
                    <input className="pt-input pt-input--sm mono" value={r.iso || ''} onChange={e => setRound(si, ri, 'iso', e.target.value)} placeholder="2026-08-12" />
                    <input className="pt-input" value={r.track} onChange={e => setRound(si, ri, 'track', e.target.value)} placeholder="Track — laps" />
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
// Rosters: per-event lineups (class → car number → drivers), the signup pool
// underneath each, and the fixed FIS roster.
function Rosters({ localMap, isAdmin, ov, patchOv }) {
  const [editing, setEditing] = useState(false);
  const openEvents = liveEvents().filter(e => e.status === 'open');
  const lineups = ov.lineups || {};
  const getLineup = (ev) => lineups[ev.id] || ev.lineup || {};
  const setLineup = (ev, lu) => patchOv({ lineups: { ...lineups, [ev.id]: lu } });
  const db = ov.driverDB || P.driverDB;

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
          {isAdmin && ov.lineups && <ExportBtn data={ov.lineups} label="Export lineups" />}
          {isAdmin && (
            <button className="pt-subtab" data-active={editing} onClick={() => setEditing(!editing)}>
              {editing ? 'Done editing' : 'Edit lineups'}
            </button>
          )}
        </div>
      </div>

      {editing && (
        <div className="pt-note">
          Build each car: number + drivers (type a name — signups and the driver DB
          autocomplete). Saves in this browser; <strong>Export lineups</strong> →
          paste into each event's <span className="mono">lineup</span> in <span className="mono">portal-data.js</span> to publish.
        </div>
      )}

      {openEvents.map(ev => {
        const entries = allEntries(ev, localMap);
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

            {/* Lineup: class → car number → drivers */}
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

            {/* Signup pool */}
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
// Admin-only: the driver database. Sortable + filterable per column, editable.
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

function DriverInfo({ ov, patchOv }) {
  const [sort, setSort] = useState({ key: null, dir: 1 });
  const [filters, setFilters] = useState({});
  const [editing, setEditing] = useState(false);
  const db = ov.driverDB || P.driverDB;

  const write = (next) => patchOv({ driverDB: next });
  const setCell = (idx, key, val) => write(db.map((d, i) => i === idx ? { ...d, [key]: val } : d));
  const delRow = (idx) => {
    const d = db[idx];
    if (window.confirm(`Remove ${d.name || d.discord || 'this driver'} from the database?`)) {
      write(db.filter((_, i) => i !== idx));
    }
  };
  const addRow = () => { setFilters({}); setSort({ key: null, dir: 1 }); write([{ ...EMPTY_DRIVER, status: 'Trial' }, ...db]); };

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
          if (isNaN(an)) return 1;   // blanks sink regardless of direction
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
          {ov.driverDB && <ExportBtn data={db} label="Export JSON" />}
          {ov.driverDB && !editing && (
            <button className="pt-mini-btn pt-mini-btn--warn" onClick={() => {
              if (window.confirm('Discard local driver DB edits and go back to what portal-data.js says?')) patchOv({ driverDB: undefined });
            }}>Reset to file</button>
          )}
          {editing && <button className="pt-mini-btn" onClick={addRow}>+ Add driver</button>}
          <button className="pt-subtab" data-active={editing} onClick={() => setEditing(!editing)}>
            {editing ? 'Done editing' : 'Edit'}
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
          Edits save in this browser only. <strong>Export JSON</strong> → paste over the
          <span className="mono"> driverDB</span> block in <span className="mono">portal-data.js</span> (or
          send to Claude) to publish. Filters still work while editing.
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
                <span className="mono">{d.scLic || '—'}</span>
                <span className="mono">{d.fmLic || '—'}</span>
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
  const [localMap, setLocalMap] = useState(loadLocalSignups);
  const [ov, setOv] = useState(loadOverrides);
  const patchOv = (patch) => setOv(prev => {
    const next = { ...prev, ...patch };
    for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
    store.set(OVERRIDE_KEY, JSON.stringify(next));
    return next;
  });
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
        {tab === 'dash'       && <Dashboard user={user} localMap={localMap} goto={setTab} isAdmin={isAdmin} ov={ov} />}
        {tab === 'events'     && <Events user={user} isAdmin={isAdmin} localMap={localMap} setLocalMap={setLocalMap} />}
        {tab === 'schedule'   && <Schedule isAdmin={isAdmin} ov={ov} patchOv={patchOv} />}
        {tab === 'rosters'    && <Rosters localMap={localMap} isAdmin={isAdmin} ov={ov} patchOv={patchOv} />}
        {tab === 'paints'     && <Paints />}
        {tab === 'driverinfo' && isAdmin && <DriverInfo ov={ov} patchOv={patchOv} />}
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
