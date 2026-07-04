-- Mwell Intra — scheduled jobs + notification delivery (Phase 4, spec §8)
--
-- Spec §8 requires a nightly job that flips vendor accreditation to
-- `renewal_due` / `expired` and drops rows into core.notifications, plus a job
-- that flags overdue approvals (approvals whose sla_due_at has passed) so
-- their approvers get a nudge. Delivery in Phase 4 is in-app: rows land in
-- core.notifications and the shell's bell (this step) surfaces them; an email
-- fanout worker consumes the same rows later without another migration.
--
-- Two functions (SECURITY DEFINER, since the pg_cron runner has no
-- auth.uid()); a small pg_cron schedule for each. Everything is idempotent:
--   * `create extension if not exists pg_cron` (Supabase installs it into the
--     `extensions` schema; we reference the objects via the public `cron.*`
--     views/functions Supabase publishes).
--   * `create or replace function`.
--   * The scheduler block unschedules the previous job by name before
--     re-creating it, so re-running the migration is safe.
--   * Notification inserts are de-duplicated against unread rows of the same
--     (user_id, kind, entity_id) tuple — running the job twice in a row
--     does not pile up duplicate nudges.
--
-- IMPORTANT: The job functions are NOT exposed to `authenticated` or `anon`.
-- pg_cron runs them as the database owner; `service_role` may execute them
-- on-demand (e.g. for a one-off catch-up run from an admin console).

create extension if not exists pg_cron;

-- ===========================================================================
-- 1) core.job_flip_accreditation_status()
-- ---------------------------------------------------------------------------
-- Scans core.vendors.  If accreditation_expires_at is in the past and the
-- current status is 'approved', flips to 'expired' and inserts a notification
-- (kind 'accreditation_expired').  If accreditation_expires_at is within the
-- next 30 days and status is still 'approved', flips to 'renewal_due' and
-- inserts a notification (kind 'accreditation_renewal_due').
--
-- Recipients per flipped vendor:
--   * every core.profiles row whose vendor_id matches (the vendor's own
--     portal users), AND
--   * every user holding the `manage_accreditation` capability in any module
--     (i.e. Legal reviewers / compliance owners — the accreditation owners).
-- ===========================================================================
create or replace function core.job_flip_accreditation_status()
returns jsonb
language plpgsql
security definer
set search_path = core, public
as $fn$
declare
  v_expired_count      int := 0;
  v_renewal_due_count  int := 0;
begin
  -- 1a) Flip to 'expired' + fan-out notifications.
  with flipped as (
    update core.vendors
       set accreditation_status = 'expired'
     where accreditation_status = 'approved'
       and accreditation_expires_at is not null
       and accreditation_expires_at < current_date
     returning id
  ),
  recipients as (
    select f.id as vendor_id, p.id as user_id
      from flipped f
      join core.profiles p on p.vendor_id = f.id
    union
    select f.id as vendor_id, ur.user_id
      from flipped f
      cross join core.user_roles ur
      join core.role_capabilities rc
        on rc.module = ur.module and rc.role = ur.role
     where rc.cap = 'manage_accreditation'
  )
  insert into core.notifications (user_id, kind, entity_type, entity_id)
  select r.user_id, 'accreditation_expired', 'vendor', r.vendor_id
    from recipients r
   where r.user_id is not null
     and not exists (
       select 1
         from core.notifications n
        where n.user_id     = r.user_id
          and n.kind        = 'accreditation_expired'
          and n.entity_type = 'vendor'
          and n.entity_id   = r.vendor_id
          and n.read_at is null
     );
  get diagnostics v_expired_count = row_count;

  -- 1b) Flip to 'renewal_due' + fan-out notifications.
  with flipped as (
    update core.vendors
       set accreditation_status = 'renewal_due'
     where accreditation_status = 'approved'
       and accreditation_expires_at is not null
       and accreditation_expires_at >= current_date
       and accreditation_expires_at <  (current_date + interval '30 days')
     returning id
  ),
  recipients as (
    select f.id as vendor_id, p.id as user_id
      from flipped f
      join core.profiles p on p.vendor_id = f.id
    union
    select f.id as vendor_id, ur.user_id
      from flipped f
      cross join core.user_roles ur
      join core.role_capabilities rc
        on rc.module = ur.module and rc.role = ur.role
     where rc.cap = 'manage_accreditation'
  )
  insert into core.notifications (user_id, kind, entity_type, entity_id)
  select r.user_id, 'accreditation_renewal_due', 'vendor', r.vendor_id
    from recipients r
   where r.user_id is not null
     and not exists (
       select 1
         from core.notifications n
        where n.user_id     = r.user_id
          and n.kind        = 'accreditation_renewal_due'
          and n.entity_type = 'vendor'
          and n.entity_id   = r.vendor_id
          and n.read_at is null
     );
  get diagnostics v_renewal_due_count = row_count;

  -- Summary audit row so /activity_log carries evidence the job ran.
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values (
    'legal', 'accreditation_job', gen_random_uuid(), 'ran', null,
    jsonb_build_object(
      'expired_notifications',      v_expired_count,
      'renewal_due_notifications',  v_renewal_due_count
    )
  );

  return jsonb_build_object(
    'expired_notifications',     v_expired_count,
    'renewal_due_notifications', v_renewal_due_count
  );
end
$fn$;

-- ===========================================================================
-- 2) core.job_flag_overdue_approvals()
-- ---------------------------------------------------------------------------
-- Scans core.approvals for pending steps whose sla_due_at has elapsed and
-- inserts one notification per user that holds the matching approver_role
-- (via core.user_roles).  Kind: 'approval_overdue'.
--
-- We match on ur.role = a.approver_role (approvals rows don't carry a
-- module; the role name is the contract).  De-duped against existing UNREAD
-- notifications so a nightly re-run doesn't pile up.
-- ===========================================================================
create or replace function core.job_flag_overdue_approvals()
returns jsonb
language plpgsql
security definer
set search_path = core, public
as $fn$
declare
  v_count int := 0;
begin
  with overdue as (
    select a.id, a.entity_type, a.entity_id, a.approver_role
      from core.approvals a
     where a.decision = 'pending'
       and a.sla_due_at is not null
       and a.sla_due_at < now()
  ),
  recipients as (
    select ur.user_id, o.entity_type, o.entity_id
      from overdue o
      join core.user_roles ur on ur.role = o.approver_role
  )
  insert into core.notifications (user_id, kind, entity_type, entity_id)
  select r.user_id, 'approval_overdue', r.entity_type, r.entity_id
    from recipients r
   where r.user_id is not null
     and not exists (
       select 1
         from core.notifications n
        where n.user_id     = r.user_id
          and n.kind        = 'approval_overdue'
          and n.entity_type = r.entity_type
          and n.entity_id   = r.entity_id
          and n.read_at is null
     );
  get diagnostics v_count = row_count;

  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values (
    'core', 'approval_job', gen_random_uuid(), 'ran', null,
    jsonb_build_object('overdue_notifications', v_count)
  );

  return jsonb_build_object('overdue_notifications', v_count);
end
$fn$;

-- ===========================================================================
-- Grants — jobs are internal.  pg_cron invokes them as the DB owner; humans
-- may only invoke them via service_role (admin console) — never anon/authed.
-- ===========================================================================
revoke all on function core.job_flip_accreditation_status() from public, anon, authenticated;
grant  execute on function core.job_flip_accreditation_status() to service_role;

revoke all on function core.job_flag_overdue_approvals() from public, anon, authenticated;
grant  execute on function core.job_flag_overdue_approvals() to service_role;

-- ===========================================================================
-- Idempotent scheduling.  cron.job.jobname is unique per database; we look it
-- up and unschedule by name before re-creating so a re-applied migration
-- lands a single fresh schedule row.  Two cron entries, staggered by 15m so
-- the second doesn't race the first when the DB is under morning warm-up.
-- ===========================================================================
do $sched$
begin
  if exists (select 1 from cron.job where jobname = 'nightly-accreditation') then
    perform cron.unschedule('nightly-accreditation');
  end if;
  perform cron.schedule(
    'nightly-accreditation',
    '0 2 * * *',
    $$select core.job_flip_accreditation_status();$$
  );

  if exists (select 1 from cron.job where jobname = 'nightly-overdue-approvals') then
    perform cron.unschedule('nightly-overdue-approvals');
  end if;
  perform cron.schedule(
    'nightly-overdue-approvals',
    '15 2 * * *',
    $$select core.job_flag_overdue_approvals();$$
  );
end
$sched$;

notify pgrst, 'reload schema';
