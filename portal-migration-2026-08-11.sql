-- ═══════════════════════════════════════════════════════════════════════════
-- ECLIPSE PORTAL — MIGRATION · Aug 11, 2026
-- Paste this entire file into: Supabase Dashboard → SQL Editor → New query → Run
-- Safe to re-run. Do this BEFORE announcing the portal to the team.
--
-- What it does:
--   1. MULTI-CLASS SIGNUPS — drivers can now hold one entry PER CLASS per
--      event (e.g. tentative in GT3 and LMP2 at Petit) instead of one total.
--   2. FIXES the lineup-announcement webhook check — it was comparing against
--      a real webhook URL instead of the placeholder, so "lineups updated"
--      messages never sent. Also announces admin event-list updates now.
--   3. Withdraw announcements now say which class was dropped.
--
-- ⚠ SEPARATELY, IN DISCORD: your webhook URL was sitting in supabase-setup.sql
--   in the repo. Rotate it: channel → Edit → Integrations → Webhooks → delete
--   the old one, make a new one, then re-run the config insert at the bottom.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. One signup per class (was: one per event) ────────────────────────────
alter table signups drop constraint if exists signups_event_id_user_id_key;
alter table signups drop constraint if exists signups_event_user_cls_key;
alter table signups add constraint signups_event_user_cls_key
  unique (event_id, user_id, cls);

-- ── 2+3. Discord announcement fixes ─────────────────────────────────────────
-- Withdraw messages include the class.
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

-- Correct placeholder check (this was the bug), and announce both lineup and
-- event-list publishes.
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

-- ── Webhook rotation (uncomment + paste the NEW url after rotating) ─────────
-- insert into private.config (key, value) values
--   ('discord_webhook', 'PASTE_NEW_WEBHOOK_URL_HERE')
-- on conflict (key) do update set value = excluded.value;

-- Done. Sanity check — should show the new per-class constraint:
select conname from pg_constraint where conrelid = 'signups'::regclass;
