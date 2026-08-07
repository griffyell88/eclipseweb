// Eclipse Competition — DRIVER PORTAL data source of truth
// Edit this file, the portal re-renders from it. One block per section.
// ─────────────────────────────────────────────────────────────────────────────
// This file is PUBLIC (ships to every browser). Nothing sensitive belongs in
// it. Auth is Supabase + Discord; private data (driver DB, signups) lives in
// the database behind row-level security — see supabase-setup.sql.
// ─────────────────────────────────────────────────────────────────────────────
window.EC_PORTAL = {
  auth: {
    // LIVE MODE: login is "Sign in with Discord" via Supabase — no passwords.
    // These Discord usernames get the admin view; everyone else in the server
    // gets the driver view. Admin WRITE access is enforced server-side by the
    // admins table in Supabase (supabase-setup.sql) — this list only shapes UI.
    adminDiscord: ["griffyell88", "swifty2352", "titussherlock31", "enbeesamon", "keewoe", ".tristanm"],
    // Optional bulletproof fallback: Discord user IDs (right-click a user with
    // Developer Mode on → Copy User ID). Add here AND in the Supabase admins
    // table (fix-admin.sql shows how) if a username ever fails to match.
    adminDiscordIds: [],
  },

  // ── TEAM TOOLS ─────────────────────────────────────────────────────────────
  tools: [
    { name: "iRacePlan", url: "https://iraceplan.com/",    note: "Race & stint planning" },
    { name: "Garage 61", url: "https://garage61.net/app",  note: "Telemetry & lap data" },
  ],

  // ── EVENTS & SIGNUPS ───────────────────────────────────────────────────────
  // mode: "self"  → drivers sign themselves up (state: confirmed)
  //       "admin" → drivers mark availability, admins build the lineup (state: available)
  // Either mode also offers a Tentative option. No seat caps.
  // DATES: `date` is the display label; `end` (YYYY-MM-DD) drives automation —
  // the day after `end`, the event drops out of signups/rosters/dashboard on
  // its own. Leave `end` off to keep an event up forever.
  // LINEUPS: an event can carry a baked-in lineup — class → cars → drivers:
  //   lineup: { "GT3": [{ num: "31", drivers: ["Titus Sherlock", "Michael Costello"] }] }
  // Admins can also build lineups in the UI (saved per-browser); use the
  // Export button on the Rosters tab and paste here to make them permanent.
  // Entries added in the UI persist per-browser (localStorage) until the backend
  // lands — entries listed HERE are the shared source of truth.
  events: [
    {
      id: "suzuka-1000-2026",
      title: "Suzuka 1000km",
      track: "Suzuka Circuit",
      date: "SEP 10–15",
      end: "2026-09-15",
      series: "Special Event · Team Event",
      classes: ["GT3"],
      mode: "admin",
      status: "open",
      entries: [],
    },
    {
      id: "petit-le-mans-2026",
      title: "Petit Le Mans",
      track: "Michelin Raceway Road Atlanta",
      date: "SEP 25–27",
      end: "2026-09-27",
      series: "Special Event · Team Event",
      classes: ["GTP", "LMP2", "GT3"],
      mode: "admin",
      status: "open",
      featured: true,
      entries: [],
    },
    {
      id: "8h-indy-2026",
      title: "8 Hours of Indianapolis",
      track: "Indianapolis Motor Speedway",
      date: "OCT 16–18",
      end: "2026-10-18",
      series: "Special Event · Team Event",
      classes: ["GT3"],
      mode: "self",
      status: "open",
      entries: [],
    },
  ],

  // ── SERIES SCHEDULES ──────────────────────────────────────────────────────
  // `iso` (YYYY-MM-DD, the round's last day) drives automation: past rounds
  // auto-hide behind the "show past" toggle and the next round gets flagged
  // UP NEXT. Rounds without `iso` (TBDs) always show.
  schedules: [
    {
      series: "FIS — Formula Indy Series",
      cadence: "Season 9 · Wednesdays · P 7:30 / Q 8:20 / R 8:30 PM ET",
      rounds: [
        { r: 5,  date: "AUG 12", iso: "2026-08-12", track: "Talladega — 94 laps" },
        { r: 6,  date: "AUG 19", iso: "2026-08-19", track: "Miami Autodrome — 37 laps" },
        { r: 7,  date: "AUG 26", iso: "2026-08-26", track: "Belle Isle — 54 laps" },
        { r: 8,  date: "SEP 2",  iso: "2026-09-02", track: "Milwaukee — 150 laps" },
        { r: 9,  date: "SEP 16", iso: "2026-09-16", track: "Fuji — 44 laps" },
        { r: 10, date: "SEP 23", iso: "2026-09-23", track: "Richmond Duels — 100 laps ×2" },
        { r: 11, date: "SEP 30", iso: "2026-09-30", track: "Mid-Ohio — 56 laps" },
        { r: 12, date: "OCT 7",  iso: "2026-10-07", track: "Road America — 31 laps" },
      ],
    },
    {
      series: "Special Events",
      cadence: "2026 · Team Events",
      rounds: [
        { r: 1, date: "SEP 10–15", iso: "2026-09-15", track: "Suzuka 1000km — GT3" },
        { r: 2, date: "SEP 25–27", iso: "2026-09-27", track: "Petit Le Mans — GTP · LMP2 · GT3" },
        { r: 3, date: "OCT 16–18", iso: "2026-10-18", track: "8 Hours of Indianapolis — GT3" },
      ],
    },
  ],

  // ── FIS ROSTER (static, from the Season 9 spotter guide) ──────────────────
  fisRoster: [
    { team: "Eclipse Competition",               drivers: ["Titus Sherlock", "Michael Costello"] },
    { team: "Eclipse Competition Blue",          drivers: ["Tanner DeFabis", "Jeremy Fairbairn"] },
    { team: "Eclipse Competition White",         drivers: ["Sam McDougall", "Drew Szuch"] },
    { team: "Eclipse Competition Purple",        drivers: ["Tucker Salyer", "Jack Beeton"] },
    { team: "Eclipse Competition Academy",       drivers: ["Griffin Yellin", "James Pyper"] },
    { team: "Eclipse Competition Academy White", drivers: ["Tristan Moss", "Barrett Wolfe"] },
  ],

  // ── PAINTS ────────────────────────────────────────────────────────────────
  paints: [
    { name: "Eclipse Competition V4",         url: "https://www.tradingpaints.com/collections/view/303171/Eclipse-Competition-V4",         note: "Main team liveries" },
    { name: "Eclipse Competition Academy V4", url: "https://www.tradingpaints.com/collections/view/303172/Eclipse-Competition-Academy-V4", note: "Academy liveries" },
  ],

  // ── DRIVER DATABASE ───────────────────────────────────────────────────────
  // Moved to Supabase (portal_docs → driver_db), served ONLY to logged-in
  // admins. It no longer ships in this public file — that was the point.
  // Admins edit it on the Driver Info tab; changes publish on "Done — publish".
  driverDB: [],
};
