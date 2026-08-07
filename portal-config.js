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
  SUPABASE_URL: "https://uxiwpsfvmupvwhcmgdqt.supabase.co",

  // Supabase Dashboard → Project Settings → API Keys → publishable ("anon") key
  SUPABASE_ANON_KEY: "sb_publishable_PYdy8V8DxcV0fuyNk2bJHA_IuoyHkS6",

  // Eclipse Discord server ID — only members of this server can enter.
  DISCORD_GUILD_ID: "1173093600549163018",
};
