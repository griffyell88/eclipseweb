// Eclipse Competition — DRIVER PORTAL data source of truth
// Same idea as data.js: edit this file, the portal re-renders from it.
// ─────────────────────────────────────────────────────────────────────────────
// NOTE ON THE LOGIN: this is a privacy curtain while the portal is in build,
// NOT real security. Anyone who reads the page source can get past it, so do
// not put anything sensitive in here. Real auth (Supabase: email/password +
// Discord login) replaces this before drivers get accounts.
//
// To change the password: open the browser console on any https page and run
//   crypto.subtle.digest('SHA-256', new TextEncoder().encode('user:newpass'))
//     .then(b => console.log([...new Uint8Array(b)].map(x => x.toString(16).padStart(2,'0')).join('')))
// then paste the printed hash below.
// ─────────────────────────────────────────────────────────────────────────────
window.EC_PORTAL = {
  auth: {
    // sha256("user:password"). Current login → user: griffin
    users: [
      { user: "griffin", hash: "4b4b892eedb98b1b800156468ff85851a7dcbd9e71ace489ce8c08ccfc2416ea", name: "Griffin Yellin", role: "admin" },
    ],
  },

  // ── EVENTS & SIGNUPS ───────────────────────────────────────────────────────
  // mode: "self"  → drivers claim seats themselves (league nights, check-in)
  //       "admin" → drivers mark availability, admins build the lineup (enduros)
  // status: "open" | "locked" | "done"
  // Entries added through the UI persist in the browser only (localStorage)
  // until the backend lands — treat what's written HERE as the source of truth.
  events: [
    {
      id: "suzuka-1000-2026",
      title: "Suzuka 1000km",
      track: "Suzuka Circuit",
      date: "SEP 10–15",
      series: "Special Event",
      classes: ["GT3"],
      mode: "admin",
      status: "open",
      seats: 4,
      entries: [
        // { driver: "Tristan Moss", cls: "GT3", state: "confirmed" },
      ],
    },
    {
      id: "britcar-24-2026",
      title: "Britcar 24",
      track: "Silverstone",
      date: "SEP 18–20",
      series: "Special Event",
      classes: ["GT3"],
      mode: "admin",
      status: "open",
      seats: 4,
      entries: [],
    },
    {
      id: "petit-le-mans-2026",
      title: "Petit Le Mans",
      track: "Michelin Raceway Road Atlanta",
      date: "SEP 25–27",
      series: "IMSA Endurance",
      classes: ["GTP", "LMP2", "GT3"],
      mode: "admin",
      status: "open",
      seats: 9,
      featured: true,
      entries: [],
    },
    {
      id: "8h-indy-2026",
      title: "8 Hours of Indianapolis",
      track: "Indianapolis Motor Speedway",
      date: "OCT 16–18",
      series: "Special Event",
      classes: ["GT3"],
      mode: "self",
      status: "open",
      seats: 6,
      entries: [],
    },
  ],

  // ── SERIES SCHEDULES ──────────────────────────────────────────────────────
  // One block per series the team runs. Mirrors the #schedules channel.
  schedules: [
    {
      series: "FIS — Formula Indy Series",
      cadence: "Season 9",
      rounds: [
        { r: 1, date: "TBD", track: "TBD — fill from #schedules" },
      ],
    },
    {
      series: "IMSA Endurance",
      cadence: "2026 Special Events",
      rounds: [
        { r: 1, date: "SEP 25–27", track: "Petit Le Mans — Road Atlanta" },
        { r: 2, date: "OCT 16–18", track: "8 Hours of Indianapolis" },
      ],
    },
    {
      series: "Global Endurance",
      cadence: "2026",
      rounds: [
        { r: 1, date: "TBD", track: "TBD — fill from #schedules" },
      ],
    },
  ],

  // ── ROSTERS ───────────────────────────────────────────────────────────────
  // Mirrors the four roster channels. Names pull from the public site where
  // they overlap; edit freely — this is the version drivers will check.
  rosters: [
    {
      name: "FIS Roster",
      key: "fis",
      drivers: [
        { name: "Titus Sherlock",   car: "Main",        note: "FSS Drivers' Champion" },
        { name: "Tanner DeFabis",   car: "Main",        note: "Pocono R2 winner" },
        { name: "Michael Costello", car: "Main",        note: "FSS Champion 2026" },
        { name: "Bryson Morris",    car: "Blue",        note: "" },
        { name: "Zach Fourie",      car: "Blue",        note: "" },
        { name: "Drew Szuch",       car: "White",       note: "" },
        { name: "Tyke Durst",       car: "Purple",      note: "" },
        { name: "Max Taylor",       car: "Purple",      note: "" },
      ],
    },
    {
      name: "Global Endurance",
      key: "global-endurance",
      drivers: [
        { name: "Titus Sherlock",  car: "GTP", note: "" },
        { name: "Tanner DeFabis",  car: "GTP", note: "" },
        { name: "Peter Dempsey",   car: "LMP2", note: "" },
        { name: "Alex Berg",       car: "LMP2", note: "" },
      ],
    },
    {
      name: "IMSA Endurance",
      key: "imsa-endurance",
      drivers: [
        { name: "Michael Costello",    car: "GTP", note: "" },
        { name: "Jeremy Fairbairn",    car: "GTP", note: "" },
        { name: "Tristan Moss",        car: "GTP", note: "" },
        { name: "Evagoras Papasavvas", car: "LMP2", note: "" },
        { name: "G3 Argyros",          car: "LMP2", note: "Road America 6H winner" },
        { name: "Barrett Wolfe",       car: "GT3", note: "" },
      ],
    },
    {
      name: "Special Event Roster",
      key: "special-event",
      drivers: [
        { name: "Tristan Moss", car: "—", note: "Brickyard 400 winner" },
      ],
    },
  ],

  // ── SETUP LIBRARY ─────────────────────────────────────────────────────────
  // Mirrors the Setups channels. `link` can be a Discord message link, a file
  // in /uploads, or anywhere else the .sto lives right now.
  setups: [
    { series: "IndyCar",  track: "Road America",  car: "Dallara IR-18",  name: "RA quali trim",        by: "Griffin", updated: "2026-08-01", link: "" },
    { series: "IMSA",     track: "Road Atlanta",  car: "Porsche 963",    name: "PLM race baseline",    by: "Michael", updated: "2026-08-05", link: "" },
    { series: "IMSA",     track: "Road Atlanta",  car: "Dallara P217",   name: "LMP2 long-run",        by: "Griffin", updated: "2026-08-05", link: "" },
  ],
};
