-- Mwell Intra — retention enforcement + log_activity rate limit (RA 10173)
--
-- 1. Implements core.job_purge_expired() FOR REAL (the docs/RETENTION.md §2.3
--    stub) against the §1 retention matrix:
--      * core.notifications (row #4): delete read rows 90 days after read_at;
--        delete unread rows 1 year after created_at.
--      * core.activity_log (row #2, 5 years): ANONYMIZE the actor rather than
--        delete the row. RATIONALE: the trail is the RA 10173 access log and
--        is append-only by design — deleting rows would punch holes in audit
--        evidence, while §16(f) only requires that PERSONAL data (the actor
--        identity) stop being retained. Clearing `actor` (FK → core.profiles)
--        and stamping detail.retention_anonymised keeps the event ledger
--        intact with zero PII. docs/RETENTION.md §1 row #2 + §2.3 document
--        this choice.
--      * core.rate_limits: NOT handled here — core.job_purge_old_rate_limits()
--        (20260706160000) already owns that table's 24h purge.
--      * demo/test residue: `_rls_test_*` fixtures from supabase/tests are
--        transactional and roll back, but a defensive sweep removes any that
--        leaked into a long-lived database (best-effort; never fails the job).
--    The job emits an entity_type='retention_job' summary row to
--    core.activity_log with per-class row counts (RETENTION.md §2.3 contract).
--
-- 2. Schedules the job via pg_cron following the 20260706140000 conventions:
--    idempotent unschedule-by-name, staggered after the existing nightly
--    jobs, service_role-only execution (pg_cron runs it as the DB owner).
--
-- 3. Adds core.check_rate_limit('log_activity', 60) inside core.log_activity:
--    it is the one RPC callable by ANY authenticated user with no capability
--    gate, so it was the audited unthrottled write path.
--
-- Re-runnable: create-or-replace functions + guarded scheduling.

create extension if not exists pg_cron;

-- ===========================================================================
-- 1) core.job_purge_expired — the RETENTION.md §2.3 enforcement job.
-- ===========================================================================
create or replace function core.job_purge_expired()
returns jsonb
language plpgsql
security definer
set search_path = core, public
as $fn$
declare
  v_notif_read   int := 0;
  v_notif_unread int := 0;
  v_log_anon     int := 0;
  v_demo         int := 0;
begin
  -- Retention matrix row #4 — notifications: 90 days after read_at.
  delete from core.notifications
   where read_at is not null
     and read_at < now() - interval '90 days';
  get diagnostics v_notif_read = row_count;

  -- Retention matrix row #4 — unread notifications: 1 year after creation.
  delete from core.notifications
   where read_at is null
     and created_at < now() - interval '1 year';
  get diagnostics v_notif_unread = row_count;

  -- Retention matrix row #2 — activity_log beyond 5 years: anonymize the
  -- actor instead of deleting (append-only audit ledger stays intact; only
  -- the personal identifier is purged — see header rationale).
  update core.activity_log
     set actor  = null,
         detail = coalesce(detail, '{}'::jsonb)
                  || jsonb_build_object('retention_anonymised', true)
   where created_at < now() - interval '5 years'
     and actor is not null;
  get diagnostics v_log_anon = row_count;

  -- Demo/test residue sweep (best-effort). The rls_negative.sql fixtures are
  -- prefixed `_rls_test_` and normally roll back; if any leaked, remove them.
  -- Wrapped so a stray FK reference can never abort the retention pass.
  begin
    delete from core.documents where storage_path like '\_rls\_test/%';
    delete from core.profiles  where email      like '\_rls\_test\_%';
    delete from core.vendors   where legal_name like '\_rls\_test\_%';
    get diagnostics v_demo = row_count;
  exception when others then
    v_demo := -1; -- flagged in the summary row; investigate manually
  end;

  -- RETENTION.md §2.3: evidence the job ran + per-class counts.
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values (
    'core', 'retention_job', gen_random_uuid(), 'ran', null,
    jsonb_build_object(
      'notifications_read_purged',   v_notif_read,
      'notifications_unread_purged', v_notif_unread,
      'activity_log_anonymised',     v_log_anon,
      'demo_residue_removed',        v_demo
    )
  );

  return jsonb_build_object(
    'notifications_read_purged',   v_notif_read,
    'notifications_unread_purged', v_notif_unread,
    'activity_log_anonymised',     v_log_anon,
    'demo_residue_removed',        v_demo
  );
end
$fn$;

-- Jobs are internal: pg_cron runs them as the DB owner; service_role may
-- invoke on-demand (catch-up run); never anon/authenticated.
revoke all on function core.job_purge_expired() from public, anon, authenticated;
grant  execute on function core.job_purge_expired() to service_role;

-- ===========================================================================
-- 2) Idempotent scheduling — staggered after nightly-accreditation (02:00)
--    and nightly-overdue-approvals (02:15).
-- ===========================================================================
do $sched$
begin
  if exists (select 1 from cron.job where jobname = 'nightly-retention-purge') then
    perform cron.unschedule('nightly-retention-purge');
  end if;
  perform cron.schedule(
    'nightly-retention-purge',
    '30 2 * * *',
    $$select core.job_purge_expired();$$
  );
end
$sched$;

-- ===========================================================================
-- 3) core.log_activity — add the sliding-hour rate limit (60/hr per actor).
--    Body otherwise identical to 20260706090800_core_rpcs.sql; actor is
--    still forced to auth.uid().
-- ===========================================================================
create or replace function core.log_activity(payload jsonb)
returns jsonb language plpgsql security definer set search_path = core, public as $$
declare v core.activity_log;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  perform core.check_rate_limit('log_activity', 60);
  if (payload->>'module') is null or (payload->>'entity_type') is null
     or (payload->>'entity_id') is null or (payload->>'action') is null then
    raise exception 'module, entity_type, entity_id and action are required';
  end if;
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values (
    payload->>'module', payload->>'entity_type', (payload->>'entity_id')::uuid,
    payload->>'action', auth.uid(), payload->'detail'
  )
  returning * into v;
  return to_jsonb(v);
end; $$;

revoke all on function core.log_activity(jsonb) from public, anon;
grant execute on function core.log_activity(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
