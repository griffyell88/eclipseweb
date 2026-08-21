-- Eclipse Portal — migration 2026-08-21
-- Live sync for portal_docs.
--
-- WHY: signups were already in the realtime publication, but portal_docs was
-- not. That meant the portal loaded schedules/events/lineups/driver_db exactly
-- once, on page load, and never heard about anyone else's changes. Two admins
-- with the portal open would silently overwrite each other on publish —
-- last click wins, no warning, no way to get the lost version back.
--
-- The portal now subscribes to portal_docs and warns before overwriting, but
-- it can only do that if this table actually broadcasts. Safe to re-run.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'portal_docs'
  ) then
    alter publication supabase_realtime add table portal_docs;
  end if;
end $$;

-- Realtime still honours row-level security, so drivers get schedule/event/
-- lineup updates and never see driver_db — same rules as the REST reads.

-- Verify: should list both signups and portal_docs.
select tablename from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;
