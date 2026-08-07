// Eclipse Portal — backend configuration
// ─────────────────────────────────────────────────────────────────────────────
// While these are blank, the portal runs in BUILD MODE: username/password
// curtain, per-browser saves. Fill them in and the portal flips to LIVE MODE:
// "Login with Discord", shared signups, admin edits that publish to everyone,
// and the driver DB served only to admins.
//
// These values are safe to be public — the anon/publishable key is designed
// for browsers; Supabase's row-level security rules (supabase-setup.sql) are
// what actually protect the data.
window.EC_CONFIG = {
  // Supabase Dashboard → Project Settings → Data API → "Project URL"
  SUPABASE_URL: "",

  // Supabase Dashboard → Project Settings → API Keys → publishable ("anon") key
  SUPABASE_ANON_KEY: "",

  // Eclipse Discord server ID (right-click server icon → Copy Server ID,
  // with Developer Mode on). Only members of this server can enter.
  // Leave blank to let any Discord account in (not recommended).
  DISCORD_GUILD_ID: "",
};
