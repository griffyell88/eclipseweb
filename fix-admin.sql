-- ═══════════════════════════════════════════════════════════════════════════
-- ECLIPSE PORTAL — admin-detection fix + diagnostics
-- Paste into Supabase SQL Editor and Run. Safe to re-run. Does NOT touch your
-- webhook URL or data.
-- ═══════════════════════════════════════════════════════════════════════════

-- Admins can now also be matched by Discord user ID (never changes, can't be
-- impersonated). Fill these in later if username matching ever misbehaves:
--   update admins set discord_id = '<paste id>' where discord_username = 'swifty2352';
alter table admins add column if not exists discord_id text;

-- More tolerant admin check: matches the username whether Discord sends
-- "swifty2352", "Swifty2352#1234", or puts it in preferred_username — and
-- falls back to discord_id when set. (Display names are NOT matched here:
-- anyone can change their display name to anything, so that would be an
-- impersonation hole.)
create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from admins a
    where a.discord_username in (
        lower(split_part(coalesce(auth.jwt()->'user_metadata'->>'name',''), '#', 1)),
        lower(split_part(coalesce(auth.jwt()->'user_metadata'->>'preferred_username',''), '#', 1))
      )
      or (a.discord_id is not null
          and a.discord_id = auth.jwt()->'user_metadata'->>'provider_id')
  );
$$;

-- DIAGNOSTICS — the output shows every account that has logged in (so you can
-- see exactly how Michael's username arrived) plus whether the portal docs
-- (driver_db etc.) actually exist. If Driver Info is still empty after this
-- fix, send Claude this output.
select 'USER: ' || raw_user_meta_data::text as info from auth.users
union all
select 'DOC: ' || key || ' · updated ' || updated_at::text from portal_docs
order by info;
