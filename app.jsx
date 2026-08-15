// Eclipse Competition — App component
const { useState, useEffect } = React;
const D = window.EC_DATA;

// Safari with "Block All Cookies", Brave in strict mode and some managed
// browsers throw SecurityError on any localStorage access. Reading it
// unguarded took the whole site down to a blank page, so every call goes
// through here. Losing a saved preference is fine; losing the site is not.
const store = {
  get(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* no-op */ } },
};

function useTweaks() {
  const [accent, setAccent] = useState(() => store.get('ec-accent') || 'purple');
  const [hero, setHero] = useState(() => store.get('ec-hero') || 'full');
  const [density, setDensity] = useState(() => store.get('ec-density') || 'normal');

  useEffect(() => {
    document.documentElement.dataset.accent = accent;
    store.set('ec-accent', accent);
  }, [accent]);
  useEffect(() => {
    document.documentElement.dataset.hero = hero;
    store.set('ec-hero', hero);
  }, [hero]);
  useEffect(() => {
    document.documentElement.dataset.density = density;
    store.set('ec-density', density);
  }, [density]);

  return { accent, setAccent, hero, setHero, density, setDensity };
}

function TweaksPanel({ tw, open, setOpen }) {
  return (
    <div className="tweaks" data-open={open}>
      <div className="tw-head">
        <span>Tweaks</span>
        <button className="close" onClick={() => setOpen(false)}>×</button>
      </div>
      <div className="tw-body">
        <div className="tw-group">
          <label>Accent color</label>
          <div className="tw-swatches">
            {[
              ['purple', '#8a00e6'],
              ['cyan',   '#28b8d4'],
              ['amber',  '#ffb800'],
              ['red',    '#ff2d2d'],
            ].map(([k, c]) => (
              <button key={k} className="tw-swatch" style={{ background: c }}
                data-active={tw.accent === k} onClick={() => tw.setAccent(k)} />
            ))}
          </div>
        </div>
        <div className="tw-group">
          <label>Hero layout</label>
          <div className="tw-opts">
            {['full', 'split', 'kinetic'].map(k => (
              <button key={k} className="tw-opt" data-active={tw.hero === k}
                onClick={() => tw.setHero(k)}>{k}</button>
            ))}
          </div>
        </div>
        <div className="tw-group">
          <label>Density</label>
          <div className="tw-opts">
            {['compact', 'normal', 'roomy'].map(k => (
              <button key={k} className="tw-opt" data-active={tw.density === k}
                onClick={() => tw.setDensity(k)}>{k}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LatestResultRibbon() {
  // The dismiss key is versioned by D.latest.id, so bumping the result in
  // data.js re-shows the ribbon to people who dismissed the previous one.
  const key = 'ec-ribbon-dismissed';
  const [dismissed, setDismissed] = useState(() => store.get(key) === D.latest.id);
  if (dismissed) return null;
  const dismiss = () => {
    store.set(key, D.latest.id);
    setDismissed(true);
  };
  return (
    <div className="ribbon">
      <div className="ribbon-inner">
        <span className="rb-flag">JUST WON</span>
        <span className="rb-msg">
          <strong>{D.latest.title}</strong>
          <span className="rb-sep">·</span>
          {D.latest.detail}
        </span>
        <a className="rb-cta" href="#accolades">View trophy →</a>
        <button className="rb-close" aria-label="Dismiss" onClick={dismiss}>×</button>
      </div>
    </div>
  );
}

function Nav() {
  const [menuOpen, setMenuOpen] = useState(false);
  const close = () => setMenuOpen(false);

  // Escape closes the mobile menu
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  return (
    <nav className="nav" data-menu-open={menuOpen}>
      <a className="brand" href="#top" onClick={close}>
        <img src="assets/icon-white.png" alt="" width="28" height="28" />
        <span className="wm">ECLIPSE <span>COMPETITION</span></span>
      </a>
      <button
        className="nav-toggle"
        aria-label="Toggle menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(!menuOpen)}
      >
        <span /><span /><span />
      </button>
      <ul data-open={menuOpen}>
        <li><a href="#team" onClick={close}>Team</a></li>
        <li><a href="#accolades" onClick={close}>Accolades</a></li>
        <li><a href="#spotter" onClick={close}>Spotter Guide</a></li>
        <li><a href="#events" onClick={close}>Events</a></li>
        <li><a href="#programs" onClick={close}>Programs</a></li>
        <li><a href="#gallery" onClick={close}>Media</a></li>
        <li><a href="#contact" onClick={close}>Partner</a></li>
        <li className="nav-mobile-cta"><a href="portal.html" onClick={close}>Driver Login</a></li>
        <li className="nav-mobile-cta"><a href="#join" onClick={close}>Join the Team</a></li>
      </ul>
      <div className="nav-ctas">
        <a className="cta cta--ghost" href="portal.html">Login</a>
        <a className="cta" href="#join">Join the Team</a>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <header className="hero" id="top" data-screen-label="01 Hero">
      <div className="hero-bg" />
      <div className="hero-stripe" />
      <div className="hero-content">
        <div className="hero-meta">
          <span className="dot" />
          <span>PREMIER iRACING ENDURANCE TEAM</span>
          <span>//</span>
          <span>EST. {D.brand.founded.toUpperCase()}</span>
        </div>
        <h1 className="hero-title">
          ECLIPSE
          <span className="pt2">COMPETITION</span>
        </h1>
        <p className="hero-sub">
          Endurance, Formula and GT programs on iRacing. We do the setup work before a race weekend starts, which is how we win Daytona, Sebring and Petit Le Mans.
        </p>
        <div className="hero-cta">
          <a href="#accolades" className="btn btn-primary">View Results →</a>
          <a href="#events" className="btn">2026 Calendar</a>
        </div>
        <div className="hero-tickers">
          <div className="hero-ticker"><div className="n"><em>10+</em></div><div className="l">Endurance Wins</div></div>
          <div className="hero-ticker"><div className="n"><em>9</em></div><div className="l">Special Event Wins</div></div>
          <div className="hero-ticker"><div className="n"><em>4</em></div><div className="l">Formula Championships</div></div>
          <div className="hero-ticker"><div className="n"><em>5K+</em></div><div className="l">Avg iRating</div></div>
        </div>
        <div className="marquee">
          <div className="marquee-inner">
            <span>Petit Le Mans Winners</span>
            <span>Indy 500 Winners</span>
            <span>FIS Team Champions</span>
            <span>FSS Teams Champions</span>
            <span>2× Sebring 12 Winners</span>
            <span>Petit Le Mans Winners</span>
            <span>Indy 500 Winners</span>
            <span>FIS Team Champions</span>
            <span>FSS Teams Champions</span>
            <span>2× Sebring 12 Winners</span>
          </div>
        </div>
      </div>
    </header>
  );
}

function MarqueeStrip() {
  const items = ["iRacing Official Partner", "Endurance · Formula · GT", "SJS Games Partner", "Setup Shop Coming Soon", "Est. Nov 2023"];
  return (
    <div className="strip">
      <div className="strip-inner">
        {[...items, ...items, ...items].map((t, i) => (
          <span key={i}>{t}<i>◆</i></span>
        ))}
      </div>
    </div>
  );
}

function TrophyLightbox({ trophy, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={trophy.title}
         onClick={onClose}>
      {trophy.video ? (
        <video
          src={trophy.video}
          poster={trophy.img}
          controls
          autoPlay
          playsInline
          aria-label={`${trophy.title} — ${trophy.class}, ${trophy.drivers}`}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <img src={trophy.img} alt={`${trophy.title} — ${trophy.class}, ${trophy.drivers}`}
             onClick={(e) => e.stopPropagation()} />
      )}
      <div className="lb-meta">
        <div className="lb-title">{trophy.title}</div>
        <div className="lb-sub">{trophy.year} · {trophy.class} · {trophy.drivers}</div>
      </div>
      <button className="lb-close" onClick={onClose} aria-label="Close" autoFocus>×</button>
    </div>
  );
}

function Accolades() {
  const [open, setOpen] = useState(null);
  return (
    <section className="section-dark" id="accolades" data-screen-label="02 Accolades">
      <div className="wrap">
        <div className="sec-head">
          <div>
            <div className="num">/ 02</div>
            <h2>By the Numbers</h2>
          </div>
          <div className="tag">Updated Aug 2026</div>
        </div>
        <div className="stats-grid">
          {D.stats.map((s, i) => (
            <div className="stat-cell" key={i}>
              <div className="stat-n">{s.n}</div>
              <div className="stat-l">{s.l}</div>
            </div>
          ))}
        </div>

        <div className="sec-head" style={{ marginTop: 96 }}>
          <div>
            <div className="num">/ 02.1</div>
            <h2>Trophy Cabinet</h2>
          </div>
          <div className="tag">Select Highlights · 2025–2026</div>
        </div>
        <div className="trophies">
          {D.trophies.map((t, i) => (
            <button
              type="button"
              className={"trophy" + (t.size ? " trophy--" + t.size : "")}
              key={t.title + t.year}
              onClick={() => setOpen(t)}
              aria-label={`View ${t.title}, ${t.class}, ${t.drivers}`}
            >
              <img
                src={t.img}
                alt=""
                loading={i === 0 ? 'eager' : 'lazy'}
                decoding="async"
                style={t.pos ? { objectPosition: t.pos } : undefined}
              />
              <div className="t-overlay" />
              <div className="t-year">{t.year} · {t.class}</div>
              {t.video && <span className="t-play">▶ {t.videoLabel || 'Watch the clip'}</span>}
              <div className="t-meta">
                <span className="t-tag">{t.tag}</span>
                <div className="t-title">{t.title}</div>
                <div className="t-drivers">{t.drivers}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
      {open && <TrophyLightbox trophy={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function Roster() {
  return (
    <section className="section-dark" id="team" data-screen-label="03 Team">
      <div className="wrap">
        <div className="sec-head">
          <div>
            <div className="num">/ 03</div>
            <h2>The Roster</h2>
          </div>
          <div className="tag">Owners · Staff · Drivers</div>
        </div>

        <div className="tier-head">
          <span className="idx">/ OWNERS</span>
          <h3>Built by three</h3>
          <span className="line" />
        </div>
        <div className="owners-grid">
          {D.owners.map((o, i) => (
            <div className="owner-card" key={i} data-tint={o.tint}>
              <div className="owner-avatar">
                {o.img ? (
                  <img src={o.img} alt={o.name} loading="lazy" decoding="async" />
                ) : (
                  <>
                    <span className="ini">{o.initials}</span>
                    <span className="ph">PLACEHOLDER</span>
                  </>
                )}
              </div>
              <div className="owner-body">
                <div className="name">{o.name}</div>
                <div className="role">{o.role}</div>
                <p className="bio">{o.bio}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="tier-head">
          <span className="idx">/ KEY STAFF · PIT WALL</span>
          <h3>Behind the car</h3>
          <span className="line" />
        </div>
        <div className="staff-grid">
          {D.staff.map((s, i) => (
            <div className="staff-card" key={i}>
              <div className="staff-ini">
                {s.img ? <img src={s.img} alt={s.name} loading="lazy" decoding="async" /> : s.initials}
              </div>
              <div>
                <div className="sc-name">{s.name}</div>
                <div className="sc-role">{s.role}</div>
                <p className="sc-bio">{s.bio}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="tier-head">
          <span className="idx">/ FEATURED DRIVERS · RACE SEAT</span>
          <h3>In the car</h3>
          <span className="line" />
        </div>
        <div className="drivers-grid">
          {D.drivers.map((d, i) => (
            <div className="driver-card" key={i}>
              <div className="driver-avatar">
                {d.img && <img src={d.img} alt={d.name} loading="lazy" decoding="async" />}
                <span className="driver-num">#{String(i + 1).padStart(2,'0')}</span>
                {!d.img && <span className="ini">{d.initials}</span>}
              </div>
              <div className="driver-body">
                <div className="name">{d.name}</div>
                <div className="note">{d.note}</div>
                <div className="progs">
                  {d.programs.map((p, j) => <span className="prog" key={j}>{p}</span>)}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SpotterGuide() {
  const [zoom, setZoom] = useState(false);
  return (
    <section className="section-dark spotter-sec" id="spotter" data-screen-label="03b Spotter">
      <div className="wrap">
        <div className="sec-head">
          <div>
            <div className="num">/ 03.5</div>
            <h2>FIS Spotter Guide</h2>
          </div>
          <div className="tag">Formula Indy Series · Season 9</div>
        </div>

        <div className="tier-head">
          <span className="idx">/ KNOW THE FLEET</span>
          <h3>Twelve Eclipse cars on the grid</h3>
          <span className="line" />
        </div>

        <div className="spotter-frame" data-zoom={zoom}>
          <button
            className="spotter-img-btn"
            onClick={() => setZoom(!zoom)}
            aria-label={zoom ? 'Zoom out of the spotter guide' : 'Zoom into the spotter guide'}
          >
            <img
              src="assets/fis-s9-spotter-guide.webp"
              alt="Eclipse Competition — FIS Season 9 Spotter Guide"
              loading="lazy"
              decoding="async"
            />
          </button>
          <button className="spotter-zoom-btn" onClick={() => setZoom(!zoom)}>
            {zoom ? 'Close ×' : 'Tap to zoom ⤢'}
          </button>
        </div>

        <div className="spotter-foot">
          <div className="spotter-legend">
            <span className="lg-item"><em>12 cars</em> across the grid</span>
            <span className="lg-item"><em>4 teams</em> Main · Blue · White · Purple</span>
            <span className="lg-item"><em>2 teams</em> Academy · Academy White</span>
          </div>
          <a className="spotter-dl" href="assets/fis-s9-spotter-guide.png" download>
            Download full-size ↓
          </a>
        </div>
      </div>
    </section>
  );
}

function Events() {
  // Next 3 upcoming events relative to the real current date
  const monthOrder = { JAN:1, FEB:2, MAR:3, APR:4, MAY:5, JUN:6, "JUN/JUL":6, JUL:7, AUG:8, SEP:9, OCT:10, NOV:11, DEC:12 };
  const now = new Date();
  const today = { m: now.getMonth() + 1, d: now.getDate() };
  // Use the END of a multi-day event so a race weekend in progress still counts
  // as upcoming instead of vanishing on its first day.
  const parseEnd = (ev) => {
    const m = monthOrder[ev.mo] || 1;
    const nums = ev.d.match(/\d+/g) || ['1'];
    return { m, d: parseInt(nums[nums.length - 1], 10) };
  };
  let upcoming = D.events
    .map(ev => ({ ev, s: parseEnd(ev) }))
    .filter(({ s }) => s.m > today.m || (s.m === today.m && s.d >= today.d))
    .slice(0, 3)
    .map(x => x.ev);
  // Past the last race of the year, loop to the top of the calendar. Label it as
  // next season, otherwise January dates read as upcoming all through December.
  const nextSeason = upcoming.length === 0;
  if (nextSeason) upcoming = D.events.slice(0, 3);
  const seasonYear = now.getFullYear() + (nextSeason ? 1 : 0);

  return (
    <section className="section-dark" id="events" data-screen-label="04 Events">
      <div className="wrap">
        <div className="sec-head">
          <div>
            <div className="num">/ 04</div>
            <h2>2026 Calendar</h2>
          </div>
          <div className="tag">IMSA · Endurance · IndyCar</div>
        </div>

        <div className="tier-head">
          <span className="idx">{nextSeason ? `/ ${seasonYear} SEASON` : '/ UP NEXT'}</span>
          <h3>{nextSeason ? `Opening the ${seasonYear} season` : 'The next three'}</h3>
          <span className="line" />
        </div>
        <div className="up-next">
          {upcoming.map((e, i) => (
            <div className="up-card" key={i}>
              <div className="up-mo">{e.mo} {seasonYear}</div>
              <div className="up-date">{e.d}</div>
              <div className="up-title">{e.t}</div>
              <div className="up-v">{e.v}</div>
              <span className="up-c">{e.c}</span>
            </div>
          ))}
        </div>

        <div className="tier-head">
          <span className="idx">/ FULL SEASON</span>
          <h3>All of 2026</h3>
          <span className="line" />
        </div>
        <div className="events-table">
          {D.events.map((e, i) => (
            <div className={`ev-row ${e.featured ? 'featured' : ''}`} key={i}>
              <div className="ev-mo">{e.mo}<br/><span className="ev-date">{e.d}</span></div>
              <div />
              <div className="ev-title">{e.t}</div>
              <div className="ev-v">{e.v}</div>
              <div className="ev-c">{e.c}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Programs() {
  return (
    <section className="section-dark" id="programs" data-screen-label="05 Programs">
      <div className="wrap">
        <div className="sec-head">
          <div>
            <div className="num">/ 05</div>
            <h2>How We Operate</h2>
          </div>
          <div className="tag">iRacing · Team Garage 61</div>
        </div>
        <div className="ops">
          <div className="ops-card">
            <div className="num">/ 05.1</div>
            <h3>Endurance Program</h3>
            <p>A full-time roster in GTP, LMP2 and GT3 across IMSA and Global Endurance. Every car tests in the weeks before a race, not the morning of it.</p>
            <ul>
              <li><span>24H RACES</span><span>4 DRIVERS</span></li>
              <li><span>6H RACES</span><span>2 PER CAR</span></li>
              <li><span>SEBRING 12</span><span>2× WINNERS</span></li>
            </ul>
          </div>
          <div className="ops-card">
            <div className="num">/ 05.2</div>
            <h3>Formula Program</h3>
            <p>Open-wheel racing on the Dallara IR-18. Three Formula league titles, plus Indy 500 and Brickyard 400 wins.</p>
            <ul>
              <li><span>FIS</span><span>TEAM CHAMPS</span></li>
              <li><span>INDY 500</span><span>WINNER ×1</span></li>
              <li><span>FSS</span><span>TEAMS CHAMPS</span></li>
            </ul>
          </div>
          <div className="ops-card">
            <div className="num">/ 05.3</div>
            <h3>Team Culture</h3>
            <p>Vote on race check-in, show up for testing, and race under your real iRacing name. Short list of rules, and drivers who cover for each other when a stint goes wrong.</p>
            <ul>
              <li><span>FOUNDED</span><span>NOV 2023</span></li>
              <li><span>PLATFORM</span><span>iRACING</span></li>
              <li><span>AVG iR</span><span>5,000+</span></li>
            </ul>
          </div>
        </div>

        <div className="sec-head" style={{ marginTop: 96 }}>
          <div>
            <div className="num">/ 05.4</div>
            <h2>Setup Shop</h2>
          </div>
          <div className="tag">Coming Soon</div>
        </div>
        <div className="setup-teaser setup-teaser--solo">
          <div className="st-left">
            <div className="st-eyebrow">/ IN DEVELOPMENT</div>
            <div className="st-title">Eclipse<br/>Setup Shop</div>
            <p className="st-desc">
              We're opening a shop for the setups our own drivers race, covering GTP, LMP2, GT3 and Formula. Our engineering group is building an AI-assisted setup tool to go with it.
            </p>
            <span className="st-badge">Launching 2026</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Gallery() {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const total = D.gallery.length;

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setIdx(i => (i + 1) % total), 5000);
    return () => clearInterval(t);
  }, [paused, total]);

  const go = (n) => setIdx(((n % total) + total) % total);
  const prev = () => go(idx - 1);
  const next = () => go(idx + 1);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); prev(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
  };

  const current = D.gallery[idx];

  return (
    <section className="section-dark gallery-sec" id="gallery" data-screen-label="05b Gallery">
      <div className="wrap">
        <div className="sec-head">
          <div>
            <div className="num">/ 05.5</div>
            <h2>Media</h2>
          </div>
          <div className="tag">From the Garage · 2025 – 2026</div>
        </div>
        <div
          className="gallery-slideshow"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
          onKeyDown={onKeyDown}
          tabIndex={0}
          role="region"
          aria-roledescription="carousel"
          aria-label="Eclipse Competition media gallery"
        >
          <div className="slideshow-track">
            {D.gallery.map((g, i) => (
              <figure
                className={`slideshow-slide ${i === idx ? 'active' : ''}`}
                key={i}
                aria-hidden={i !== idx}
              >
                <img
                  src={g.img}
                  alt={g.caption}
                  loading={i === 0 ? 'eager' : 'lazy'}
                  decoding="async"
                />
              </figure>
            ))}
          </div>
          <figcaption className="slideshow-cap">
            <span className="slideshow-tag">{current.tag}</span>
            <span className="slideshow-text">{current.caption}</span>
          </figcaption>
          <button className="slideshow-arrow prev" onClick={prev} aria-label="Previous">‹</button>
          <button className="slideshow-arrow next" onClick={next} aria-label="Next">›</button>
          <button
            className="slideshow-pause"
            onClick={() => setPaused(p => !p)}
            aria-label={paused ? 'Resume slideshow' : 'Pause slideshow'}
          >
            {paused ? '▶' : '❚❚'}
          </button>
          <div className="slideshow-dots">
            {D.gallery.map((_, i) => (
              <button
                key={i}
                className={`slideshow-dot ${i === idx ? 'active' : ''}`}
                onClick={() => go(i)}
                aria-label={`Go to slide ${i + 1}`}
                aria-current={i === idx}
              />
            ))}
          </div>
          <div className="slideshow-counter">{String(idx + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</div>
        </div>
      </div>
    </section>
  );
}

function Academy() {
  return (
    <section className="academy" id="join" data-screen-label="06 Academy">
      <div className="academy-inner">
        <div className="eyebrow">/ 06 · ECLIPSE ACADEMY</div>
        <h2>Think you've got the <em>pace</em>?</h2>
        <p>We run two Academy teams in 2026 alongside the main roster. Show up for testing, vote on check-in, and race clean, and you'll get a seat.</p>
        <div className="cta-row">
          <a href={D.brand.discord} target="_blank" rel="noopener noreferrer" className="btn btn-primary">Join our Discord →</a>
          <a href="#team" className="btn">Meet the team</a>
        </div>
      </div>
    </section>
  );
}

function Sponsors() {
  return (
    <section className="section-dark" id="sponsors" data-screen-label="07 Sponsors">
      <div className="wrap">
        <div className="sec-head">
          <div>
            <div className="num">/ 07</div>
            <h2>Partners &amp; Sponsors</h2>
          </div>
          <div className="tag">Running with us in 2026</div>
        </div>
        <div className="sponsors-grid">
          {D.sponsors.map((s, i) => (
            <div className="sponsor-cell" key={i}>
              <div className="sp-tag">// {s.type}</div>
              {s.logo ? (
                <div className="sp-logo-wrap">
                  <img src={s.logo} alt={s.name} className="sp-logo" loading="lazy" decoding="async" />
                  <div className="sp-sub">{s.name}</div>
                </div>
              ) : (
                <div>
                  <div className="sp-name">{s.short}</div>
                  <div className="sp-sub">{s.name}</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function InstagramFeed() {
  const posts = D.brand.igPosts || [];

  // Instagram's official embed script: load it once after the blockquotes are
  // in the DOM, then ask it to hydrate them. Re-runs safely if already loaded.
  useEffect(() => {
    if (posts.length === 0) return;
    const process = () => window.instgrm && window.instgrm.Embeds.process();
    if (window.instgrm) { process(); return; }
    const s = document.createElement('script');
    s.src = 'https://www.instagram.com/embed.js';
    s.async = true;
    s.onload = process;
    document.body.appendChild(s);
  }, [posts.length]);

  return (
    <section className="section-dark ig-sec" id="instagram" data-screen-label="07b Instagram">
      <div className="wrap">
        <div className="sec-head">
          <div>
            <div className="num">/ 07.5</div>
            <h2>On Instagram</h2>
          </div>
          <div className="tag">{D.brand.ig}</div>
        </div>

        {posts.length > 0 && (
          <div className="ig-grid">
            {posts.map((url, i) => (
              <blockquote
                key={url}
                className="instagram-media"
                data-instgrm-permalink={url}
                data-instgrm-version="14"
              >
                {/* Fallback link if embed.js is blocked (ad blockers etc.) */}
                <a href={url} target="_blank" rel="noopener noreferrer">View this post on Instagram</a>
              </blockquote>
            ))}
          </div>
        )}

        <div className="ig-band">
          <div className="ig-band-left">
            <span className="ig-glyph" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4.2" />
                <circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" stroke="none" />
              </svg>
            </span>
            <div>
              <div className="ig-band-title">Race wins, liveries and paddock content</div>
              <div className="ig-band-sub">Follow the team on Instagram · {D.brand.ig}</div>
            </div>
          </div>
          <a className="btn btn-primary" href={D.brand.igUrl} target="_blank" rel="noopener noreferrer">
            Follow →
          </a>
        </div>
      </div>
    </section>
  );
}

function Contact() {
  return (
    <section className="contact-sec" id="contact" data-screen-label="08 Contact">
      <div className="wrap">
        <div className="sec-head">
          <div>
            <div className="num">/ 08</div>
            <h2>Partner With Us</h2>
          </div>
          <div className="tag">Sponsorship · Media · Collaboration</div>
        </div>

        <div className="contact-grid">
          <div className="contact-pitch">
            <p className="ct-lead">
              Eclipse races the events sim racing fans turn up for: Daytona, Sebring,
              Spa, the Indy 500 and Petit Le Mans.
            </p>
            <p className="ct-body">
              We put brands on the car and into the content our drivers make, across a
              fourteen-race calendar. To reach someone who can say yes, come to the
              Discord.
            </p>
            {/* Counts read from data.js so they can't drift out of date */}
            <div className="ct-points">
              <div className="ct-point"><em>{D.events.length}</em><span>Events on the 2026 calendar</span></div>
              <div className="ct-point"><em>{D.trophies.length}</em><span>Wins &amp; titles in the cabinet</span></div>
              <div className="ct-point"><em>{D.sponsors.length}</em><span>Partners &amp; charities running with us</span></div>
            </div>
          </div>

          <div className="contact-actions">
            <div className="ca-head">/ GET IN TOUCH</div>
            {D.brand.email ? (
              <a className="ca-btn ca-btn--primary" href={`mailto:${D.brand.email}?subject=Eclipse%20Competition%20Partnership%20Enquiry`}>
                <span className="ca-label">Email the team</span>
                <span className="ca-val">{D.brand.email}</span>
              </a>
            ) : null}
            <a className={"ca-btn" + (D.brand.email ? "" : " ca-btn--primary")}
               href={D.brand.discord} target="_blank" rel="noopener noreferrer">
              <span className="ca-label">Discord</span>
              <span className="ca-val">Message an admin directly</span>
            </a>
            <a className="ca-btn" href={D.brand.igUrl} target="_blank" rel="noopener noreferrer">
              <span className="ca-label">Instagram</span>
              <span className="ca-val">{D.brand.ig}</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <div className="footer-main">
          <div className="footer-brand">
            <img src="assets/logo-white.png" alt="Eclipse Competition" loading="lazy" />
            <p>iRacing endurance team, founded November 2023. Still run by the two drivers who started it.</p>
          </div>
          <div>
            <h3>Team</h3>
            <ul>
              <li><a href="#team">Roster</a></li>
              <li><a href="#accolades">Results</a></li>
              <li><a href="#spotter">Spotter Guide</a></li>
              <li><a href="#programs">Programs</a></li>
              <li><a href="#join">Academy</a></li>
            </ul>
          </div>
          <div>
            <h3>Racing</h3>
            <ul>
              <li><a href="#events">2026 Calendar</a></li>
              <li><a href="#programs">Endurance Program</a></li>
              <li><a href="#programs">Formula Program</a></li>
              <li><a href="#gallery">Media Gallery</a></li>
            </ul>
          </div>
          <div>
            <h3>Connect</h3>
            <ul>
              <li><a href={D.brand.discord} target="_blank" rel="noopener noreferrer">Discord · Join the Server</a></li>
              <li><a href="#instagram">Instagram · {D.brand.ig}</a></li>
              <li><a href="#join">Join Academy</a></li>
              <li><a href="#contact">Partner with Us</a></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <div>© 2026 ECLIPSE COMPETITION · ALL RIGHTS RESERVED</div>
          <div>EST. NOV 2023 · BUILT ON iRACING</div>
        </div>
      </div>
    </footer>
  );
}

function App() {
  const tw = useTweaks();
  const [tweaksOpen, setTweaksOpen] = useState(false);
  const [editModeActive, setEditModeActive] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      if (!e.data || typeof e.data !== 'object') return;
      if (e.data.type === '__activate_edit_mode') { setEditModeActive(true); setTweaksOpen(true); }
      if (e.data.type === '__deactivate_edit_mode') { setEditModeActive(false); setTweaksOpen(false); }
    };
    window.addEventListener('message', handler);
    window.parent.postMessage({ type: '__edit_mode_available' }, '*');
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <>
      <LatestResultRibbon />
      <Nav />
      <Hero />
      <MarqueeStrip />
      <Accolades />
      <Roster />
      <SpotterGuide />
      <Events />
      <Programs />
      <Gallery />
      <Academy />
      <Sponsors />
      <InstagramFeed />
      <Contact />
      <Footer />
      {editModeActive && (
        <TweaksPanel tw={tw} open={tweaksOpen} setOpen={setTweaksOpen} />
      )}
    </>
  );
}

// If data.js fails to load, or any component throws, show a small branded card
// with a live Discord link instead of the blank white page we used to serve.
function Fallback() {
  return (
    <div className="site-fallback">
      <img src="assets/logo-white.png" alt="Eclipse Competition" />
      <p>We're having trouble loading the site right now. Our Discord is always open.</p>
      <a className="btn btn-primary" href="https://discord.gg/CBtQMmcksE"
         target="_blank" rel="noopener noreferrer">Join our Discord →</a>
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err) { console.error('Eclipse site error:', err); }
  render() { return this.state.failed ? <Fallback /> : this.props.children; }
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  D ? <ErrorBoundary><App /></ErrorBoundary> : <Fallback />
);
