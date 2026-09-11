-- Bound lock waits; no data, grants, capability rules or existing indexes change.
set local lock_timeout = '2s';
set local statement_timeout = '15s';

-- The audit screen orders its latest 250 rows by created_at.
create index if not exists activity_log_created_at_id_idx
  on core.activity_log (created_at desc, id desc);

-- auth.uid is invariant within a statement. Preserve every existing predicate.
alter policy insight_followups_read on core.insight_followups
  using (requested_by = (select auth.uid()) or core.platform_followup_owner(area));

alter policy warehouse_export_jobs_read on warehouse.export_jobs
  using (
    (created_by = (select auth.uid()) and (
      (export_type = 'insights_snapshot' and core.has_live_cap('insights', 'prepare_exports'))
      or (export_type <> 'insights_snapshot' and core.has_live_cap('warehouse', 'register_exports'))
    )) or core.has_live_cap('warehouse', 'review_exports')
  );

alter policy request_collaborators_read on procurement.request_collaborators
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from procurement.requests request
      where request.id = request_collaborators.request_id
        and request.requester_id = (select auth.uid())
    )
  );
