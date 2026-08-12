-- ═══════════════════════════════════════════════════════════════════════════
-- ECLIPSE PORTAL — REAL NAMES ON SIGNUPS · Aug 12, 2026
-- Paste into: Supabase Dashboard → SQL Editor → New query → Run. Re-runnable.
--
-- Problem: signups showed Discord usernames because Discord doesn't carry
-- real names. Fix: every signup now looks up the driver's REAL NAME from the
-- Driver Info board (matched by Discord username) the moment it's inserted —
-- and this also backfills every signup already in the system.
--
-- Fine print: a driver only gets their real name if their row on the Driver
-- Info board has (a) their real name in NAME and (b) their exact Discord
-- username in DISCORD. Anyone missing from the board keeps their Discord
-- display name until you add them.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Resolve real name on every new signup ───────────────────────────────────
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
-- (BEFORE insert, so the Discord announcement — an AFTER trigger — already
--  carries the real name too.)

-- ── Backfill signups that already exist ─────────────────────────────────────
update signups s
set driver_name = d->>'name'
from portal_docs p, jsonb_array_elements(p.data) d
where p.key = 'driver_db'
  and lower(trim(d->>'discord')) = lower(trim(s.discord_username))
  and coalesce(d->>'name', '') <> ''
  and s.driver_name is distinct from d->>'name';

-- Sanity check — every current signup with its (possibly fixed) name:
select driver_name, discord_username, event_title, cls, state from signups
order by created_at desc;
