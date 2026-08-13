-- ═══════════════════════════════════════════════════════════════════════════
-- ECLIPSE PORTAL — SUPABASE SETUP
-- Paste this entire file into: Supabase Dashboard → SQL Editor → New query → Run
-- Safe to re-run. One thing to edit: the Discord webhook URL near the bottom.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pg_net;

-- ── ADMINS ──────────────────────────────────────────────────────────────────
-- Discord usernames (lowercase) that get the admin view + write access.
-- Add/remove rows here to change who's an admin.
create table if not exists admins (
  discord_username text primary key
);
insert into admins (discord_username) values
  ('griffyell88'), ('swifty2352'), ('titussherlock31'),
  ('enbeesamon'), ('keewoe'), ('.tristanm')
on conflict do nothing;
alter table admins enable row level security;
drop policy if exists "read admins" on admins;
create policy "read admins" on admins for select to authenticated using (true);

-- Who is the current user? (discord username from the login token)
create or replace function current_discord() returns text
language sql stable as $$
  select lower(split_part(coalesce(
    auth.jwt() -> 'user_metadata' ->> 'name',
    auth.jwt() -> 'user_metadata' ->> 'full_name', ''), '#', 1));
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins a where a.discord_username = current_discord());
$$;

-- ── SERVER-SIDE MEMBERSHIP GATE ─────────────────────────────────────────────
-- guild_members mirrors the Discord server's member list (synced by
-- scripts/sync-tickets.mjs every 30 min). is_member() fails OPEN while the
-- table is empty and enforces once populated. The browser-side guild check
-- in portal.jsx is best-effort only — this is the real lock.
create table if not exists guild_members (
  user_id text primary key,
  username text not null,
  synced_at timestamptz not null default now()
);
alter table guild_members enable row level security;

create or replace function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select (not exists (select 1 from guild_members))
      or is_admin()
      or exists (select 1 from guild_members g where g.username = current_discord())
      or exists (select 1 from guild_members g
                 where g.user_id = coalesce(auth.jwt() -> 'user_metadata' ->> 'provider_id', ''));
$$;

-- ── SIGNUPS ─────────────────────────────────────────────────────────────────
create table if not exists signups (
  id bigint generated always as identity primary key,
  event_id text not null,
  event_title text not null default '',
  cls text not null,
  state text not null check (state in ('confirmed','available','tentative','reserve')),
  driver_name text not null,
  discord_username text not null default '',
  user_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  -- one entry per CLASS per event — drivers can hold spots in multiple classes
  unique (event_id, user_id, cls)
);
alter table signups enable row level security;
drop policy if exists "read signups" on signups;
create policy "read signups" on signups for select to authenticated using (is_member());
drop policy if exists "insert own signup" on signups;
create policy "insert own signup" on signups for insert to authenticated
  with check (user_id = auth.uid() and is_member());
drop policy if exists "delete own or admin" on signups;
create policy "delete own or admin" on signups for delete to authenticated
  using ((user_id = auth.uid() and is_member()) or is_admin());

-- live updates for everyone with the portal open
do $$ begin
  alter publication supabase_realtime add table signups;
exception when duplicate_object then null; end $$;

-- Signups display REAL names: Discord only supplies usernames, so each new
-- signup pulls the driver's real name from the Driver Info board (matched on
-- Discord username) before it's stored.
create or replace function resolve_driver_name() returns trigger
language plpgsql security definer set search_path = public as $$
declare real_name text;
begin
  select d->>'name' into real_name
  from portal_docs p, jsonb_array_elements(p.data) d
  where p.key = 'driver_db'
    and lower(trim(d->>'discord')) = lower(trim(new.discord_username))
    and coalesce(d->>'name', '') <> ''
  limit 1;
  if real_name is not null then
    new.driver_name := real_name;
  end if;
  return new;
end $$;

drop trigger if exists signups_resolve_name on signups;
create trigger signups_resolve_name before insert on signups
  for each row execute function resolve_driver_name();

-- Board edits propagate: fixing a driver's name/discord on the Driver Info
-- board corrects their existing signups on publish.
create or replace function backfill_signup_names() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update signups s
  set driver_name = d->>'name'
  from jsonb_array_elements(new.data) d
  where lower(trim(d->>'discord')) = lower(trim(s.discord_username))
    and coalesce(d->>'name', '') <> ''
    and s.driver_name is distinct from d->>'name';
  return new;
end $$;

drop trigger if exists driverdb_backfill_names on portal_docs;
create trigger driverdb_backfill_names after insert or update on portal_docs
  for each row when (new.key = 'driver_db') execute function backfill_signup_names();


-- ── PORTAL DOCS (schedules / lineups / driver DB) ───────────────────────────
-- driver_db is ADMIN-ONLY, enforced here — drivers can't read it even with
-- the API, which is the whole point of moving it out of portal-data.js.
create table if not exists portal_docs (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text not null default ''
);
alter table portal_docs enable row level security;
drop policy if exists "read docs" on portal_docs;
create policy "read docs" on portal_docs for select to authenticated
  using (is_member() and (key <> 'driver_db' or is_admin()));
drop policy if exists "admin insert docs" on portal_docs;
create policy "admin insert docs" on portal_docs for insert to authenticated
  with check (is_admin());
drop policy if exists "admin update docs" on portal_docs;
create policy "admin update docs" on portal_docs for update to authenticated
  using (is_admin());

-- Seed with the current portal data (only if not already present):
insert into portal_docs (key, data) values
  ('schedules', '[{"series": "FIS \u2014 Formula Indy Series", "cadence": "Season 9 \u00b7 Wednesdays \u00b7 P 7:30 / Q 8:20 / R 8:30 PM ET", "rounds": [{"r": 5, "date": "AUG 12", "iso": "2026-08-12", "track": "Talladega \u2014 94 laps"}, {"r": 6, "date": "AUG 19", "iso": "2026-08-19", "track": "Miami Autodrome \u2014 37 laps"}, {"r": 7, "date": "AUG 26", "iso": "2026-08-26", "track": "Belle Isle \u2014 54 laps"}, {"r": 8, "date": "SEP 2", "iso": "2026-09-02", "track": "Milwaukee \u2014 150 laps"}, {"r": 9, "date": "SEP 16", "iso": "2026-09-16", "track": "Fuji \u2014 44 laps"}, {"r": 10, "date": "SEP 23", "iso": "2026-09-23", "track": "Richmond Duels \u2014 100 laps \u00d72"}, {"r": 11, "date": "SEP 30", "iso": "2026-09-30", "track": "Mid-Ohio \u2014 56 laps"}, {"r": 12, "date": "OCT 7", "iso": "2026-10-07", "track": "Road America \u2014 31 laps"}]}, {"series": "Special Events", "cadence": "2026 \u00b7 Team Events", "rounds": [{"r": 1, "date": "SEP 10\u201315", "iso": "2026-09-15", "track": "Suzuka 1000km \u2014 GT3"}, {"r": 2, "date": "SEP 25\u201327", "iso": "2026-09-27", "track": "Petit Le Mans \u2014 GTP \u00b7 LMP2 \u00b7 GT3"}, {"r": 3, "date": "OCT 16\u201318", "iso": "2026-10-18", "track": "8 Hours of Indianapolis \u2014 GT3"}]}]'::jsonb),
  ('lineups', '{}'::jsonb),
  ('driver_db', '[{"status": "Trial", "name": "Pierre Yague", "discord": "Magikrex", "iracingName": "Pierre Peytral Yag\u00fce", "iracingId": "1133857", "scIr": "4447", "fmIr": "2334", "scLic": "A 3.61", "fmLic": "", "source": "Referral", "joined": "2026-08-02", "lastEvent": "", "lastEventDate": "", "prefCars": "LMP2 or GT3", "bestResult": "", "region": "", "notes": "p4 daytona"}, {"status": "Trial", "name": "Julian Colbert", "discord": "aotkptw", "iracingName": "Julian Colbert", "iracingId": "945537", "scIr": "4529", "fmIr": "4915", "scLic": "A 3.45", "fmLic": "C 2.69", "source": "Referral", "joined": "2026-07-31", "lastEvent": "", "lastEventDate": "", "prefCars": "GT3", "bestResult": "", "region": "", "notes": ""}, {"status": "Trial", "name": "Sergio Vicen", "discord": "sergiova2000", "iracingName": "Sergio Vicen", "iracingId": "1483671", "scIr": "3138", "fmIr": "1661", "scLic": "A 2.10", "fmLic": "D 2.34", "source": "Discord", "joined": "2026-07-24", "lastEvent": "", "lastEventDate": "", "prefCars": "GTP", "bestResult": "", "region": "", "notes": "finished P6 in my first ever endurance in Iracing, 6h of the glen"}, {"status": "Trial", "name": "", "discord": "ashtondunno", "iracingName": "", "iracingId": "", "scIr": "5600", "fmIr": "", "scLic": "", "fmLic": "", "source": "Referral", "joined": "2026-07-12", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "NZ", "notes": ""}, {"status": "Active", "name": "Seth Comer", "discord": "voitechhh4080", "iracingName": "Seth J Comer", "iracingId": "674824", "scIr": "4525", "fmIr": "2368", "scLic": "A 4.99", "fmLic": "B 2.22", "source": "Recruited", "joined": "2026-07-10", "lastEvent": "N/a", "lastEventDate": "N/a", "prefCars": "GT3", "bestResult": "N/A", "region": "", "notes": "3rd in Watkins glen 6hr 2nd split"}, {"status": "One Off", "name": "Cooper Shipman", "discord": "cooper.shipman", "iracingName": "Cooper Shipman", "iracingId": "491563", "scIr": "2222", "fmIr": "1696", "scLic": "A 1.34", "fmLic": "C 2.19", "source": "IRL", "joined": "2026-07-10", "lastEvent": "SPA 24", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "John Brendan Walsh", "discord": "jbwracing", "iracingName": "John Brendan Walsh", "iracingId": "638866", "scIr": "3652", "fmIr": "2444", "scLic": "A 2.35", "fmLic": "C 2.68", "source": "Recruited", "joined": "2026-07-09", "lastEvent": "Spa 24", "lastEventDate": "2026-07-11", "prefCars": "GT3", "bestResult": "", "region": "BST", "notes": "Bananna Man/ Daytona 2023 Win"}, {"status": "Trial", "name": "Nikos Efstathiou", "discord": "efstathiounikos", "iracingName": "Nikos Efstathiou", "iracingId": "551707", "scIr": "3335", "fmIr": "3357", "scLic": "A 4.34", "fmLic": "A 4.02", "source": "Recruited", "joined": "2026-07-09", "lastEvent": "SPA 24", "lastEventDate": "2026-07-11", "prefCars": "GT3", "bestResult": "", "region": "GMT +3", "notes": "4 participating Daytona24hour , 2 wins Sebring 6 hours"}, {"status": "Trial", "name": "Stan van den Brinkk", "discord": "stan091962", "iracingName": "Stan Van Den Brink", "iracingId": "1190722", "scIr": "3683", "fmIr": "1039", "scLic": "A 3.27", "fmLic": "D 2.71", "source": "Recruited", "joined": "2026-07-08", "lastEvent": "", "lastEventDate": "", "prefCars": "GT3", "bestResult": "", "region": "", "notes": ""}, {"status": "Inactive", "name": "Nathaniel Fryman", "discord": "planb34", "iracingName": "Nathaniel Fryman", "iracingId": "730906", "scIr": "2724", "fmIr": "2243", "scLic": "A 3.58", "fmLic": "A 3.86", "source": "", "joined": "2026-07-07", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Jack Beeton", "discord": "jackbeeton", "iracingName": "Jack Beeton", "iracingId": "578388", "scIr": "1800", "fmIr": "3114", "scLic": "D 2.24", "fmLic": "B 2.00", "source": "IRL", "joined": "2026-06-29", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Christos Arabatzis", "discord": "ca27_777", "iracingName": "Christos Arabatzis", "iracingId": "1348080", "scIr": "1793", "fmIr": "1628", "scLic": "B 2.29", "fmLic": "D 2.50", "source": "Recruited", "joined": "2026-06-28", "lastEvent": "SPA 24", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Michele Amadori", "discord": "micheleamadori55", "iracingName": "Michele Amadori", "iracingId": "1297139", "scIr": "3941", "fmIr": "2531", "scLic": "A 3.75", "fmLic": "C 3.42", "source": "Recruited", "joined": "2026-06-25", "lastEvent": "", "lastEventDate": "", "prefCars": "GT3, PCUP", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Max Fuster", "discord": "m_f_19", "iracingName": "Max Fuster", "iracingId": "890536", "scIr": "2577", "fmIr": "1942", "scLic": "A 4.21", "fmLic": "B 2.56", "source": "", "joined": "2026-06-22", "lastEvent": "", "lastEventDate": "", "prefCars": "GTP", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Sebastien Leusch", "discord": "sebleu36", "iracingName": "Sebastien Leusch", "iracingId": "", "scIr": "", "fmIr": "", "scLic": "", "fmLic": "", "source": "", "joined": "2026-06-08", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Inactive", "name": "", "discord": "matthth97", "iracingName": "", "iracingId": "", "scIr": "", "fmIr": "", "scLic": "", "fmLic": "", "source": "", "joined": "2026-05-30", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Patrick Hingston", "discord": "yahwnings", "iracingName": "", "iracingId": "", "scIr": "", "fmIr": "", "scLic": "", "fmLic": "", "source": "", "joined": "2026-05-20", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Inactive", "name": "Luke Fallon", "discord": "lukefall00", "iracingName": "", "iracingId": "", "scIr": "", "fmIr": "", "scLic": "", "fmLic": "", "source": "", "joined": "2026-05-18", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Inactive", "name": "Hugo Ortiz", "discord": "hurricane0044", "iracingName": "", "iracingId": "", "scIr": "", "fmIr": "", "scLic": "", "fmLic": "", "source": "Recruited", "joined": "2026-05-13", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Thijs Hermse", "discord": "thijshermse_63951", "iracingName": "", "iracingId": "", "scIr": "", "fmIr": "", "scLic": "", "fmLic": "", "source": "Recruited", "joined": "2026-05-09", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "James Pyper", "discord": "jamesgamer12314", "iracingName": "James Pyper", "iracingId": "990745", "scIr": "3420", "fmIr": "2668", "scLic": "A 3.61", "fmLic": "B 1.56", "source": "", "joined": "2026-04-25", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Tucker Salyer", "discord": "kuetzi", "iracingName": "Tucker Salyer", "iracingId": "424725", "scIr": "2882", "fmIr": "3569", "scLic": "A 2.61", "fmLic": "A 4.70", "source": "", "joined": "2026-04-24", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Marton Fritz", "discord": "fritzmarton_", "iracingName": "Marton Fritz", "iracingId": "795606", "scIr": "3056", "fmIr": "1835", "scLic": "A 2.44", "fmLic": "A 3.11", "source": "", "joined": "2026-04-22", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Johnny Linberg", "discord": "dzhel666", "iracingName": "", "iracingId": "", "scIr": "", "fmIr": "", "scLic": "", "fmLic": "", "source": "", "joined": "2026-04-22", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Joey Van den Berg", "discord": "joeyvdberg", "iracingName": "", "iracingId": "", "scIr": "", "fmIr": "", "scLic": "", "fmLic": "", "source": "", "joined": "2026-04-21", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "TC Watkins", "discord": "milkkid5", "iracingName": "TC Watkins", "iracingId": "933204", "scIr": "3120", "fmIr": "1707", "scLic": "A 2.00", "fmLic": "C 2.15", "source": "Referral", "joined": "2026-04-10", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Inactive", "name": "Billy Smith", "discord": "billyjack2", "iracingName": "", "iracingId": "", "scIr": "", "fmIr": "", "scLic": "", "fmLic": "", "source": "IRL", "joined": "2026-03-23", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Carter Kundinger", "discord": "carterbadger2", "iracingName": "Carter Kundinger", "iracingId": "174942", "scIr": "5003", "fmIr": "5067", "scLic": "A 4.73", "fmLic": "A 2.96", "source": "IRL", "joined": "2026-02-26", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Inactive", "name": "Peter Dempsey", "discord": "peterdempsey", "iracingName": "Peter Dempsey", "iracingId": "47292", "scIr": "3636", "fmIr": "3729", "scLic": "B 3.66", "fmLic": "B 2.08", "source": "IRL", "joined": "2026-02-23", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Matthew McComish", "discord": "mrme1405", "iracingName": "Matthew Mccomish", "iracingId": "1063615", "scIr": "1482", "fmIr": "2167", "scLic": "B 2.16", "fmLic": "C 2.45", "source": "IRL", "joined": "2026-02-22", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "CST", "notes": ""}, {"status": "Inactive", "name": "Luke Kendall", "discord": "fiberbtw", "iracingName": "Luke Kendall", "iracingId": "1138998", "scIr": "2183", "fmIr": "1782", "scLic": "C 3.38", "fmLic": "D 2.53", "source": "Referral", "joined": "2026-01-06", "lastEvent": "RA 6HR", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "EST", "notes": ""}, {"status": "Inactive", "name": "Dane Scott", "discord": "danejscott", "iracingName": "Dane Scott", "iracingId": "747632", "scIr": "1027", "fmIr": "1242", "scLic": "B 2.52", "fmLic": "B 2.79", "source": "IRL", "joined": "2025-12-15", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Tanner DeFabis", "discord": "keewoe", "iracingName": "Tanner DeFabis", "iracingId": "891954", "scIr": "2842", "fmIr": "3959", "scLic": "A 3.54", "fmLic": "B 3.78", "source": "OWNER", "joined": "2025-12-04", "lastEvent": "RA 6HR", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "EST", "notes": ""}, {"status": "Inactive", "name": "JT Hoskins", "discord": "jthulk1", "iracingName": "John Hoskins", "iracingId": "1001954", "scIr": "1416", "fmIr": "1218", "scLic": "C 1.63", "fmLic": "D 2.22", "source": "IRL", "joined": "2025-11-10", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "EST", "notes": ""}, {"status": "Active", "name": "Anthony Haitsma", "discord": "anthonyrh22", "iracingName": "Anthony Haitsma", "iracingId": "1145127", "scIr": "2430", "fmIr": "3099", "scLic": "A 3.35", "fmLic": "A 4.95", "source": "Recruited", "joined": "2025-10-29", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Sybren Stoel", "discord": "sjsgames14", "iracingName": "Sybren Stoel", "iracingId": "830315", "scIr": "1670", "fmIr": "1645", "scLic": "A 2.56", "fmLic": "C 2.33", "source": "SJS", "joined": "2025-10-16", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Zach Fourie", "discord": "zach_4451_13220", "iracingName": "Zach Fourie", "iracingId": "1122314", "scIr": "3612", "fmIr": "2442", "scLic": "A 1.64", "fmLic": "B 2.19", "source": "IRL", "joined": "2025-10-01", "lastEvent": "SPA 24", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "BST", "notes": ""}, {"status": "Inactive", "name": "Demitri Nolan", "discord": "d3m1", "iracingName": "Demitri Nolan", "iracingId": "1124648", "scIr": "1452", "fmIr": "1856", "scLic": "B 2.55", "fmLic": "C 2.47", "source": "IRL", "joined": "2025-09-30", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Barrett Wolfe", "discord": "synr", "iracingName": "Barrett Wolfe", "iracingId": "802694", "scIr": "2278", "fmIr": "2719", "scLic": "B 2.50", "fmLic": "A 2.57", "source": "IRL", "joined": "2025-08-27", "lastEvent": "SPA 24", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "PST", "notes": ""}, {"status": "Active", "name": "Dustin Glenn", "discord": "va1or", "iracingName": "Dustin Glenn", "iracingId": "589660", "scIr": "2483", "fmIr": "2455", "scLic": "A 3.54", "fmLic": "A 2.26", "source": "", "joined": "2025-07-13", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Oleksandr Rosberg", "discord": "oleksandrrosberg", "iracingName": "Oleksandr Rosberg", "iracingId": "1127689", "scIr": "4122", "fmIr": "4141", "scLic": "A 1.49", "fmLic": "C 3.61", "source": "Recruited", "joined": "2025-07-12", "lastEvent": "SPA 24", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Inactive", "name": "Aiden Mataisz", "discord": "idkaiden", "iracingName": "Aiden Mataisz", "iracingId": "857408", "scIr": "9250", "fmIr": "5654", "scLic": "A 3.65", "fmLic": "A 2.22", "source": "", "joined": "2025-06-15", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Sam Hopkins", "discord": "samhpk", "iracingName": "Sam Hopkins", "iracingId": "849139", "scIr": "3615", "fmIr": "", "scLic": "B 3.38", "fmLic": "", "source": "Referral", "joined": "2025-05-16", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Inactive", "name": "Gavin", "discord": "mr.tayt0", "iracingName": "", "iracingId": "", "scIr": "", "fmIr": "", "scLic": "", "fmLic": "", "source": "", "joined": "2025-03-25", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Sara Guerra", "discord": "sargs", "iracingName": "Sara Guerra", "iracingId": "755333", "scIr": "1843", "fmIr": "1828", "scLic": "B 2.15", "fmLic": "C 2.49", "source": "SJS", "joined": "2025-01-23", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Inactive", "name": "Zach j Shit", "discord": "rooze1", "iracingName": "Zachary J Smith", "iracingId": "535062", "scIr": "3242", "fmIr": "2281", "scLic": "A 4.75", "fmLic": "A 2.58", "source": "", "joined": "2024-12-26", "lastEvent": "RA 6HR", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Tristan Moss", "discord": ".tristanm", "iracingName": "Tristan Moss", "iracingId": "640799", "scIr": "2477", "fmIr": "3084", "scLic": "A 2.14", "fmLic": "B 4.52", "source": "ADMIN", "joined": "2024-11-10", "lastEvent": "RA 6HR", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "EST", "notes": ""}, {"status": "Active", "name": "Kaden Coolidge", "discord": "kd0t6", "iracingName": "Kaden Coolidge", "iracingId": "953119", "scIr": "1897", "fmIr": "836", "scLic": "", "fmLic": "", "source": "", "joined": "2024-10-27", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Inactive", "name": "Bacon Zelenka", "discord": "baconzelenka", "iracingName": "Bacon Zelenka", "iracingId": "578883", "scIr": "6901", "fmIr": "4820", "scLic": "A 3.34", "fmLic": "A 2.42", "source": "IRL", "joined": "2024-10-27", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "EST", "notes": ""}, {"status": "Active", "name": "Daryl DeLeon", "discord": "daryldeleon_", "iracingName": "", "iracingId": "", "scIr": "", "fmIr": "", "scLic": "", "fmLic": "", "source": "", "joined": "2024-10-11", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Inactive", "name": "Devlin Defrancesco", "discord": "devlindefran", "iracingName": "", "iracingId": "", "scIr": "", "fmIr": "", "scLic": "", "fmLic": "", "source": "IRL", "joined": "2024-10-04", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "EST", "notes": ""}, {"status": "Inactive", "name": "Talley Fare", "discord": "talleyfare", "iracingName": "Talley Fare", "iracingId": "942376", "scIr": "1428", "fmIr": "1346", "scLic": "D 2.55", "fmLic": "D 2.94", "source": "IRL", "joined": "2024-05-30", "lastEvent": "RA 6HR", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "EST", "notes": ""}, {"status": "Inactive", "name": "Max Taylor", "discord": "sped_maxt", "iracingName": "Max M Taylor", "iracingId": "725933", "scIr": "3390", "fmIr": "3736", "scLic": "D 1.32", "fmLic": "C 2.41", "source": "IRL", "joined": "2024-05-13", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "EST", "notes": ""}, {"status": "Active", "name": "Griffin Yellin", "discord": "griffyell88", "iracingName": "Griffin Yellin", "iracingId": "768285", "scIr": "1786", "fmIr": "2954", "scLic": "B 3.0", "fmLic": "A 2.05", "source": "ADMIN", "joined": "2024-04-08", "lastEvent": "RA 6HR", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "EST", "notes": ""}, {"status": "Active", "name": "Gage Cognet", "discord": "eengage", "iracingName": "Gage Cognet", "iracingId": "406718", "scIr": "1173", "fmIr": "1149", "scLic": "C 2.25", "fmLic": "B 2.28", "source": "", "joined": "2024-03-17", "lastEvent": "RA 6HR", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Inactive", "name": "Ryan Shehan", "discord": "rs66_", "iracingName": "Ryan Shehan", "iracingId": "158842", "scIr": "4319", "fmIr": "4320", "scLic": "A 4.75", "fmLic": "A 3.41", "source": "IRL", "joined": "2024-02-12", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Evagoras Papasavvas", "discord": "evagoras71p", "iracingName": "Evagoras Papasavvas", "iracingId": "514257", "scIr": "2869", "fmIr": "2561", "scLic": "A 3.79", "fmLic": "C 2.43", "source": "Recruited", "joined": "2024-02-02", "lastEvent": "SPA 24", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "EST", "notes": ""}, {"status": "Active", "name": "Drew Szuch", "discord": "drewszu", "iracingName": "Drew Szuch", "iracingId": "780146", "scIr": "2565", "fmIr": "3406", "scLic": "B 2.45", "fmLic": "B 1.48", "source": "IRL", "joined": "2024-01-18", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "CST", "notes": ""}, {"status": "Inactive", "name": "Bryson Morris", "discord": "bryson._.", "iracingName": "Bryson Morris", "iracingId": "483169", "scIr": "2384", "fmIr": "1987", "scLic": "A 2.47", "fmLic": "A 3.14", "source": "IRL", "joined": "2023-12-30", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "CST", "notes": ""}, {"status": "Active", "name": "Cadence Presley", "discord": "relentless1c", "iracingName": "Cadence Presley", "iracingId": "482277", "scIr": "4356", "fmIr": "2404", "scLic": "A 2.55", "fmLic": "D 2.52", "source": "IRL", "joined": "2023-12-25", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Sam McDougall", "discord": "enbeesamon", "iracingName": "Sam McDougall", "iracingId": "938513", "scIr": "3126", "fmIr": "2243", "scLic": "A 2.27", "fmLic": "A 3.87", "source": "OWNER", "joined": "2023-12-20", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Inactive", "name": "Noah Smartt", "discord": "noahs__", "iracingName": "Noah Smartt", "iracingId": "778621", "scIr": "2166", "fmIr": "1991", "scLic": "A 4.02", "fmLic": "B 2.18", "source": "Discord", "joined": "2023-12-04", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Inactive", "name": "Noah Nicholson", "discord": "melon4576", "iracingName": "Noah Nicholson", "iracingId": "873922", "scIr": "1880", "fmIr": "2025", "scLic": "A 2.83", "fmLic": "A 2.51", "source": "SJS", "joined": "2023-11-29", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Inactive", "name": "Alex Benavitz", "discord": "alexbenavitz", "iracingName": "Alex Benavitz", "iracingId": "553005", "scIr": "3132", "fmIr": "3201", "scLic": "B 3.33", "fmLic": "A 2.15", "source": "IRL", "joined": "2023-11-28", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Jeremy Fairbairn", "discord": "tkracerrr", "iracingName": "Jeremy Fairbairn", "iracingId": "372140", "scIr": "7289", "fmIr": "5984", "scLic": "A 3.19", "fmLic": "A 2.57", "source": "IRL", "joined": "2023-11-24", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "EST", "notes": ""}, {"status": "Active", "name": "Josh Ahern", "discord": "jna1996", "iracingName": "", "iracingId": "", "scIr": "", "fmIr": "", "scLic": "", "fmLic": "", "source": "", "joined": "2023-11-23", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Inactive", "name": "Archie Williams", "discord": "atoomic", "iracingName": "", "iracingId": "", "scIr": "", "fmIr": "", "scLic": "", "fmLic": "", "source": "", "joined": "2023-11-20", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Inactive", "name": "Oliver Noden-Mayor", "discord": "nordensimsport", "iracingName": "Oliver Noden-Mayor", "iracingId": "871024", "scIr": "1664", "fmIr": "1271", "scLic": "A 2.20", "fmLic": "D 2.58", "source": "SJS", "joined": "2023-11-15", "lastEvent": "", "lastEventDate": "", "prefCars": "", "bestResult": "", "region": "", "notes": ""}, {"status": "Active", "name": "Titus Sherlock", "discord": "titussherlock31", "iracingName": "Titus Sherlock", "iracingId": "419040", "scIr": "5468", "fmIr": "4684", "scLic": "A 4.58", "fmLic": "A 2.1", "source": "OWNER", "joined": "2023-11-12", "lastEvent": "RA 6HR", "lastEventDate": "2026-06-28", "prefCars": "ALL", "bestResult": "P1 Daytona 24", "region": "CST", "notes": ""}, {"status": "Active", "name": "Michael Costello", "discord": "swifty2352", "iracingName": "Michael J Costello", "iracingId": "476322", "scIr": "3286", "fmIr": "4119", "scLic": "A 2.11", "fmLic": "B 2.72", "source": "OWNER", "joined": "2023-11-12", "lastEvent": "RA 6HR", "lastEventDate": "", "prefCars": "", "bestResult": "P1 Daytona 24", "region": "EST", "notes": ""}]'::jsonb)
on conflict (key) do nothing;

-- ── DISCORD ANNOUNCEMENTS ───────────────────────────────────────────────────
-- ①  EDIT THIS LINE: paste your channel webhook URL between the quotes.
--    (Discord channel → Edit channel → Integrations → Webhooks → New → Copy URL)
create schema if not exists private;
create table if not exists private.config (key text primary key, value text);
insert into private.config (key, value) values
  ('discord_webhook', 'PASTE_WEBHOOK_URL_HERE')
on conflict (key) do update set value = excluded.value;

create or replace function notify_signup() returns trigger
language plpgsql security definer set search_path = public, private, net as $$
declare url text; msg text;
begin
  select value into url from private.config where key = 'discord_webhook';
  if url is null or url = '' or url = 'PASTE_WEBHOOK_URL_HERE' then
    return coalesce(new, old);
  end if;
  if tg_op = 'INSERT' then
    msg := '🏁 **' || new.driver_name || '** is ' || upper(new.state) ||
           ' for **' || new.event_title || '** (' || new.cls || ')';
  else
    msg := '↩️ **' || old.driver_name || '** withdrew from **' || old.event_title ||
           '** (' || old.cls || ')';
  end if;
  perform net.http_post(
    url := url,
    body := jsonb_build_object('content', msg),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return coalesce(new, old);
end $$;

drop trigger if exists signups_notify on signups;
create trigger signups_notify after insert or delete on signups
  for each row execute function notify_signup();

create or replace function notify_docs() returns trigger
language plpgsql security definer set search_path = public, private, net as $$
declare url text; msg text;
begin
  select value into url from private.config where key = 'discord_webhook';
  if url is null or url = '' or url = 'PASTE_WEBHOOK_URL_HERE' then
    return new;
  end if;
  if new.key = 'lineups' then
    msg := '📋 Event lineups were just updated — check the portal.';
  elsif new.key = 'events' then
    msg := '📅 The events list was just updated — check the portal for signups.';
  else
    return new;
  end if;
  perform net.http_post(
    url := url,
    body := jsonb_build_object('content', msg),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return new;
end $$;

drop trigger if exists lineups_notify on portal_docs;
drop trigger if exists docs_notify on portal_docs;
create trigger docs_notify after insert or update on portal_docs
  for each row when (new.key in ('lineups', 'events')) execute function notify_docs();

-- Done. If this ran without errors you should see 3 rows:
select key, updated_at from portal_docs order by key;
