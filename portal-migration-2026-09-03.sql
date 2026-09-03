-- Eclipse Portal — migration 2026-09-03
-- DISCORD RACE FEED (the "bot", minus the bot).
--
-- WHAT YOU GET, in one Discord channel:
--   • Every published event gets ONE embed: title, track, date, series, and the
--     live signup list per class. The embed is EDITED IN PLACE as drivers sign
--     up / withdraw, so the channel always shows the current roster.
--   • For the NEXT race only, each signup/withdrawal also posts a one-liner
--     ("🏁 **Titus Sherlock** is IN for **Petit Le Mans** — GT3") so people see
--     the activity. Other events update silently.
--   • Removing an event from the portal strikes its embed through.
--
-- HOW: Postgres triggers + the synchronous `http` extension + a Discord channel
-- webhook. Nothing to host. Replaces the old pg_net notify_signup/notify_docs
-- text pings from supabase-setup.sql (this file drops them).
--
-- SETUP (3 steps, ~2 minutes):
--   1. Discord: channel → Edit Channel → Integrations → Webhooks → New Webhook.
--      Name it (e.g. "Eclipse Race Control"), set the avatar, Copy Webhook URL.
--   2. Paste that URL over PASTE_WEBHOOK_URL_HERE in step ① below.
--   3. Supabase → SQL Editor → paste this whole file → Run.
--      It ends by posting every currently published event to the channel.
--
-- Safe to re-run. Signups NEVER fail because of Discord — every call is
-- wrapped; a failed post just marks the event "stale" and a 5-minute cron
-- retries it (if pg_cron is available; it is on Supabase).
--
-- "Next race" = the published event with the soonest `end` date that hasn't
-- passed (events with no `end` come last; ties → portal list order).

-- ── ① WEBHOOK URL ───────────────────────────────────────────────────────────
create schema if not exists private;
create table if not exists private.config (key text primary key, value text);
insert into private.config (key, value) values
  ('discord_webhook', 'yjmW5N9iHV')
on conflict (key) do update set value = excluded.value
  where excluded.value <> 'PASTE_WEBHOOK_URL_HERE';   -- re-running with the placeholder won't wipe a real URL

-- Optional: where the embed title links.
insert into private.config (key, value) values
  ('portal_url', 'https://eclipsecompetition.com/portal.html')
on conflict (key) do nothing;

-- ── extensions ──────────────────────────────────────────────────────────────
create extension if not exists http with schema extensions;

-- ── message bookkeeping (private = not exposed through the API) ─────────────
create table if not exists private.discord_messages (
  event_id    text primary key,
  message_id  text,                       -- Discord message id (null = post failed)
  embed_hash  text,                       -- md5 of the last embed we sent
  stale       boolean not null default false,
  removed     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── helpers ─────────────────────────────────────────────────────────────────
create or replace function private.discord_webhook() returns text
language sql stable set search_path = private as $$
  select case
    when value is null or value = '' or value = 'PASTE_WEBHOOK_URL_HERE' then null
    else value end
  from private.config where key = 'discord_webhook';
$$;

-- One HTTP call to Discord. Returns the response body as jsonb (null on
-- failure). Never raises — callers decide what to do with null.
create or replace function private.discord_call(method text, url text, body jsonb)
returns jsonb
language plpgsql set search_path = private, extensions, public as $$
declare resp http_response; body_out jsonb;
begin
  begin
    perform http_set_curlopt('CURLOPT_TIMEOUT_MS', '6000');
  exception when others then null; end;

  begin
    resp := http((
      method::http_method, url,
      array[http_header('User-Agent', 'EclipsePortal (eclipsecompetition.com)')],
      'application/json', coalesce(body::text, '')
    )::http_request);
  exception when others then
    raise warning 'discord_call % % failed: %', method, url, sqlerrm;
    return null;
  end;

  if resp.status < 200 or resp.status >= 300 then
    raise warning 'discord_call % returned %: %', method, resp.status, left(resp.content, 300);
    return null;
  end if;

  begin
    body_out := nullif(resp.content, '')::jsonb;
  exception when others then
    body_out := '{}'::jsonb;
  end;
  return coalesce(body_out, '{}'::jsonb);
end $$;

-- The published events list (portal_docs → 'events'), or [] if none.
create or replace function private.events_doc() returns jsonb
language sql stable set search_path = public as $$
  select coalesce(
    (select case when jsonb_typeof(data) = 'array' then data else '[]'::jsonb end
     from portal_docs where key = 'events'),
    '[]'::jsonb);
$$;

create or replace function private.event_by_id(p_event_id text) returns jsonb
language sql stable set search_path = private as $$
  select ev from jsonb_array_elements(private.events_doc()) ev
  where ev->>'id' = p_event_id limit 1;
$$;

-- Which event is "next"? Soonest `end` >= today; undated events last; ties by
-- list position. Events past their `end` are ignored (the portal hides them).
create or replace function private.next_event_id() returns text
language sql stable set search_path = private as $$
  select ev->>'id'
  from jsonb_array_elements(private.events_doc()) with ordinality as t(ev, pos)
  where coalesce(ev->>'status', 'open') <> 'closed'
    and (
      nullif(ev->>'end', '') is null
      or (ev->>'end') ~ '^\d{4}-\d{2}-\d{2}$' and (ev->>'end')::date >= current_date
    )
  order by
    case when nullif(ev->>'end', '') is null then 1 else 0 end,
    case when (ev->>'end') ~ '^\d{4}-\d{2}-\d{2}$' then (ev->>'end')::date end nulls last,
    pos
  limit 1;
$$;

create or replace function private.state_label(s text) returns text
language sql immutable as $$
  select case lower(coalesce(s, ''))
    when 'confirmed' then 'IN'
    when 'available' then 'AVAILABLE'
    when 'tentative' then 'TENTATIVE'
    when 'reserve'   then 'ON RESERVE'
    else upper(coalesce(s, 'IN')) end;
$$;

-- Build the roster embed for one event from the live signups table (plus any
-- baked-in `entries` on the event itself).
create or replace function private.event_embed(ev jsonb, p_removed boolean default false)
returns jsonb
language plpgsql stable set search_path = public, private as $$
declare
  ev_id text := ev->>'id';
  title text := coalesce(nullif(ev->>'title', ''), ev_id, 'Event');
  fields jsonb := '[]'::jsonb;
  v_cls text; entries text; n int; total int := 0; extra int;
  descr text := '';
  portal text;
  classes jsonb;
  all_classes text[];
begin
  select value into portal from private.config where key = 'portal_url';

  -- Description: track / date / series / how signups work.
  if nullif(ev->>'track', '') is not null then descr := descr || '📍 ' || (ev->>'track') || E'\n'; end if;
  if nullif(ev->>'date', '')  is not null then descr := descr || '📅 ' || (ev->>'date'); end if;
  if nullif(ev->>'series', '') is not null then
    descr := descr || case when nullif(ev->>'date', '') is not null then ' · ' else '' end || (ev->>'series');
  end if;
  if descr <> '' then descr := descr || E'\n\n'; end if;
  if p_removed then
    descr := descr || '❌ **Removed from the calendar.**';
  elsif coalesce(ev->>'status', 'open') = 'closed' then
    descr := descr || '🔒 Signups closed.';
  elsif coalesce(ev->>'mode', 'self') = 'admin' then
    descr := descr || 'Mark your **availability** on the portal — admins build the lineup.';
  else
    descr := descr || '**Sign yourself up** on the portal.';
  end if;

  -- Classes: the event's declared classes, then any class someone signed up
  -- under that isn't declared (so nobody is hidden).
  classes := case when jsonb_typeof(ev->'classes') = 'array' then ev->'classes' else '[]'::jsonb end;
  select coalesce(array_agg(c order by ord, c), '{}') into all_classes
  from (
    select c, ord from jsonb_array_elements_text(classes) with ordinality as t(c, ord)
    union
    select distinct s.cls, 1000::bigint from signups s
     where s.event_id = ev_id
       and s.cls not in (select jsonb_array_elements_text(classes))
  ) x;

  foreach v_cls in array all_classes loop
    -- live signups + baked-in entries, oldest first
    select string_agg(line, E'\n' order by ord, ts), count(*)
      into entries, n
    from (
      select 0 as ord, s.created_at as ts,
             '• ' || s.driver_name ||
             case lower(s.state)
               when 'tentative' then ' *(tentative)*'
               when 'reserve'   then ' *(reserve)*'
               else '' end as line
      from signups s where s.event_id = ev_id and s.cls = v_cls
      union all
      select 1, now(),
             '• ' || coalesce(e->>'driver', e->>'name', '?') ||
             case lower(coalesce(e->>'state', ''))
               when 'tentative' then ' *(tentative)*'
               when 'reserve'   then ' *(reserve)*'
               else '' end
      from jsonb_array_elements(case when jsonb_typeof(ev->'entries') = 'array' then ev->'entries' else '[]'::jsonb end) e
      where e->>'cls' = v_cls
    ) z;
    n := coalesce(n, 0);
    total := total + n;
    entries := coalesce(entries, '—');
    -- Discord caps a field at 1024 chars.
    if length(entries) > 1000 then
      entries := regexp_replace(left(entries, 950), E'\n[^\n]*$', '');   -- cut on a whole line
      extra := n - (length(entries) - length(replace(entries, E'\n', '')) + 1);
      entries := entries || E'\n…and ' || extra || ' more';
    end if;
    fields := fields || jsonb_build_object(
      'name', v_cls || ' · ' || n,
      'value', entries,
      'inline', true);
  end loop;

  if jsonb_array_length(fields) = 0 then
    fields := jsonb_build_array(jsonb_build_object('name', 'Signups', 'value', '—', 'inline', false));
  end if;

  return jsonb_build_object(
    'title', case when p_removed then '~~' || left(title, 240) || '~~' else left(title, 250) end,
    'url', coalesce(portal, 'https://eclipsecompetition.com/portal.html'),
    'description', left(descr, 4000),
    'color', case when p_removed then 5592405 else 9044198 end,   -- grey / Eclipse purple #8a00e6
    'fields', fields,
    'footer', jsonb_build_object('text',
      total || ' signed up · ' || case when coalesce(ev->>'mode','self') = 'admin' then 'availability' else 'signups' end
      || ' · live from the portal'),
    'timestamp', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
end $$;

-- Post or edit one event's embed. Skips the call if nothing changed.
create or replace function private.discord_sync_event(ev jsonb, p_removed boolean default false)
returns void
language plpgsql set search_path = public, private as $$
declare
  url text := private.discord_webhook();
  ev_id text := ev->>'id';
  embed jsonb; h text; m private.discord_messages; resp jsonb;
begin
  if url is null or ev_id is null then return; end if;

  embed := private.event_embed(ev, p_removed);
  h := md5((embed - 'timestamp')::text);
  select * into m from private.discord_messages where event_id = ev_id;

  if m.event_id is not null and m.message_id is not null then
    if m.embed_hash = h and not m.stale and m.removed = p_removed then return; end if;
    resp := private.discord_call('PATCH', url || '/messages/' || m.message_id,
              jsonb_build_object('embeds', jsonb_build_array(embed)));
    update private.discord_messages
       set embed_hash = case when resp is null then embed_hash else h end,
           stale = (resp is null), removed = p_removed, updated_at = now()
     where event_id = ev_id;
  else
    if p_removed then
      delete from private.discord_messages where event_id = ev_id;
      return;
    end if;
    resp := private.discord_call('POST', url || case when position('?' in url) > 0 then '&' else '?' end || 'wait=true',
              jsonb_build_object('embeds', jsonb_build_array(embed)));
    insert into private.discord_messages (event_id, message_id, embed_hash, stale)
      values (ev_id, resp->>'id', h, (resp->>'id') is null)
    on conflict (event_id) do update
      set message_id = excluded.message_id, embed_hash = excluded.embed_hash,
          stale = excluded.stale, removed = false, updated_at = now();
  end if;
end $$;

-- Sync every published event; strike through ones that disappeared.
create or replace function private.discord_sync_all() returns void
language plpgsql set search_path = public, private as $$
declare ev jsonb; r record;
begin
  if private.discord_webhook() is null then return; end if;
  for ev in select e from jsonb_array_elements(private.events_doc()) e loop
    perform private.discord_sync_event(ev);
  end loop;
  for r in
    select m.event_id from private.discord_messages m
    where not m.removed
      and m.event_id not in (select e->>'id' from jsonb_array_elements(private.events_doc()) e where e->>'id' is not null)
  loop
    perform private.discord_sync_event(
      jsonb_build_object('id', r.event_id, 'title', coalesce(
        (select event_title from signups where event_id = r.event_id limit 1), r.event_id)),
      true);
  end loop;
end $$;

-- Retry anything a failed/rate-limited call left stale.
create or replace function private.discord_retry_stale() returns void
language plpgsql set search_path = public, private as $$
declare r record; ev jsonb;
begin
  if private.discord_webhook() is null then return; end if;
  for r in select * from private.discord_messages where stale loop
    ev := private.event_by_id(r.event_id);
    if ev is null then
      ev := jsonb_build_object('id', r.event_id, 'title', coalesce(
        (select event_title from signups where event_id = r.event_id limit 1), r.event_id));
      perform private.discord_sync_event(ev, true);
    else
      perform private.discord_sync_event(ev, r.removed);
    end if;
  end loop;
end $$;

-- ── TRIGGERS ────────────────────────────────────────────────────────────────
-- Drop the old pg_net text pings.
drop trigger if exists signups_notify on signups;
drop trigger if exists lineups_notify on portal_docs;
drop trigger if exists docs_notify on portal_docs;
drop function if exists notify_signup();
drop function if exists notify_docs();

-- Events published from the portal → post new ones, edit changed ones,
-- strike removed ones.
create or replace function private.on_events_published() returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  begin
    perform private.discord_sync_all();
  exception when others then
    raise warning 'discord events sync failed: %', sqlerrm;
  end;
  return new;
end $$;

drop trigger if exists discord_events on portal_docs;
create trigger discord_events after insert or update on portal_docs
  for each row when (new.key = 'events') execute function private.on_events_published();

-- Signup / withdrawal → refresh that event's embed; ping if it's the next race.
create or replace function private.on_signup_changed() returns trigger
language plpgsql security definer set search_path = public, private as $$
declare
  r signups; ev jsonb; url text; msg text;
begin
  r := coalesce(new, old);
  begin
    url := private.discord_webhook();
    if url is null then return coalesce(new, old); end if;

    ev := private.event_by_id(r.event_id);
    if ev is null then
      -- unpublished / seed-only event: still show it, minimally
      ev := jsonb_build_object('id', r.event_id, 'title', r.event_title, 'classes', jsonb_build_array(r.cls));
    end if;
    perform private.discord_sync_event(ev);

    if r.event_id = private.next_event_id() then
      if tg_op = 'INSERT' then
        msg := '🏁 **' || new.driver_name || '** is ' || private.state_label(new.state) ||
               ' for **' || coalesce(nullif(ev->>'title', ''), new.event_title) || '** — ' || new.cls;
      else
        msg := '↩️ **' || old.driver_name || '** withdrew from **' ||
               coalesce(nullif(ev->>'title', ''), old.event_title) || '** — ' || old.cls;
      end if;
      perform private.discord_call('POST', url, jsonb_build_object('content', msg));
    end if;
  exception when others then
    raise warning 'discord signup sync failed: %', sqlerrm;
  end;
  return coalesce(new, old);
end $$;

drop trigger if exists discord_signups on signups;
create trigger discord_signups after insert or delete on signups
  for each row execute function private.on_signup_changed();

-- ── retry cron (optional — skipped silently if pg_cron isn't enabled) ───────
do $$
begin
  create extension if not exists pg_cron;
  begin
    perform cron.unschedule('discord-retry-stale');
  exception when others then null; end;
  perform cron.schedule('discord-retry-stale', '*/5 * * * *',
    $c$ select private.discord_retry_stale(); $c$);
exception when others then
  raise notice 'pg_cron not available (%); stale embeds will refresh on the next signup/publish instead.', sqlerrm;
end $$;

-- ── bootstrap: post every currently published event now ─────────────────────
select private.discord_sync_all();

-- Done. Sanity check — one row per event, message_id filled, stale = false:
select event_id, message_id is not null as posted, stale, removed, updated_at
from private.discord_messages order by created_at;
-- And which event the signup pings are watching:
select private.next_event_id() as next_race;
