-- ═══════════════════════════════════════════════════════════════════════════
-- ECLIPSE PORTAL — MIGRATION · Aug 13, 2026
-- Paste into: Supabase Dashboard → SQL Editor → New query → Run. Re-runnable.
--
-- Fixes two launch-day issues:
--   1. REAL NAMES: signups resolve to the Driver Info board's real name
--      (matched on Discord username), existing signups are backfilled, AND
--      from now on fixing a name/discord on the board instantly corrects
--      that driver's signups too. A report at the bottom shows exactly which
--      signups still can't match (missing/blank board rows).
--   2. SERVER-SIDE MEMBERSHIP GATE: someone's alt (not in the Discord) got
--      in because the old server check ran in the browser and failed open.
--      Now the database itself refuses signups/data to anyone not in the
--      guild_members table, which the ticket-sync bot keeps in sync with the
--      actual Discord member list every 30 minutes.
--      ⚠ The gate stays OPEN (old behavior) until guild_members has rows in
--      it — so run the updated Sync Tickets workflow once after this, and
--      the gate arms itself. Nothing breaks in between.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1a. Resolve real name on every new signup ───────────────────────────────
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

-- ── 1b. Board edits propagate to existing signups automatically ─────────────
-- Fix a driver's NAME or DISCORD on the Driver Info tab → their signups
-- correct themselves the moment you hit "Done — publish".
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

-- ── 1c. Backfill everything already in the system, right now ────────────────
update signups s
set driver_name = d->>'name'
from portal_docs p, jsonb_array_elements(p.data) d
where p.key = 'driver_db'
  and lower(trim(d->>'discord')) = lower(trim(s.discord_username))
  and coalesce(d->>'name', '') <> ''
  and s.driver_name is distinct from d->>'name';

-- ── 2a. Guild member roster (kept fresh by the ticket-sync bot) ─────────────
create table if not exists guild_members (
  user_id text primary key,      -- Discord user ID
  username text not null,        -- Discord username, lowercase
  synced_at timestamptz not null default now()
);
alter table guild_members enable row level security;
-- No policies on purpose: only the service-role bot reads/writes it directly;
-- the portal touches it solely through is_member() below.

-- ── 2b. The gate ────────────────────────────────────────────────────────────
-- FAIL-OPEN while guild_members is empty (pre-first-sync), enforced after.
-- Matches on Discord username OR Discord user ID; admins always pass.
create or replace function is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select (not exists (select 1 from guild_members))
      or is_admin()
      or exists (select 1 from guild_members g where g.username = current_discord())
      or exists (select 1 from guild_members g
                 where g.user_id = coalesce(auth.jwt() -> 'user_metadata' ->> 'provider_id', ''));
$$;

-- ── 2c. Enforce it on everything the portal serves ──────────────────────────
drop policy if exists "read signups" on signups;
create policy "read signups" on signups for select to authenticated
  using (is_member());

drop policy if exists "insert own signup" on signups;
create policy "insert own signup" on signups for insert to authenticated
  with check (user_id = auth.uid() and is_member());

drop policy if exists "delete own or admin" on signups;
create policy "delete own or admin" on signups for delete to authenticated
  using ((user_id = auth.uid() and is_member()) or is_admin());

drop policy if exists "read docs" on portal_docs;
create policy "read docs" on portal_docs for select to authenticated
  using (is_member() and (key <> 'driver_db' or is_admin()));

-- ── Cleanup: remove any signups made by accounts outside the server ─────────
-- (Safe to run now — no-op until guild_members is populated. Re-run it after
--  the first member sync to purge anything an outsider already added.)
delete from signups s
where exists (select 1 from guild_members)  -- only once the gate is armed
  and s.discord_username <> ''              -- never judge rows missing a username
  and lower(trim(s.discord_username)) not in (select username from guild_members)
  and not exists (select 1 from admins a where a.discord_username = lower(trim(s.discord_username)));

-- ── REPORT: name resolution status for every signup ─────────────────────────
-- board_status column tells you what to fix on the Driver Info tab:
--   a real name        → resolved correctly
--   (blank)            → board row exists but its NAME field is empty
--   NOT ON BOARD       → no board row has this exact Discord username
select
  s.driver_name          as shown_on_portal,
  s.discord_username,
  s.event_title, s.cls,
  coalesce(m.board_name, '⚠ NOT ON BOARD') as board_status,
  s.created_at
from signups s
left join lateral (
  select d->>'name' as board_name
  from portal_docs p, jsonb_array_elements(p.data) d
  where p.key = 'driver_db'
    and lower(trim(d->>'discord')) = lower(trim(s.discord_username))
  limit 1
) m on true
order by s.created_at desc;
