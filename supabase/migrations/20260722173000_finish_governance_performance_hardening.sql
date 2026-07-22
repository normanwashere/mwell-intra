-- Close the remaining actionable performance-advisor findings introduced by
-- governed role evidence and event lifecycle ownership.

create index if not exists event_lifecycle_events_actor_id_fkey_idx
  on warehouse.event_lifecycle_events (actor_id);

create index if not exists events_owner_id_fkey_idx
  on warehouse.events (owner_id);

drop policy if exists role_change_evidence_read on core.role_change_evidence;
create policy role_change_evidence_read on core.role_change_evidence
for select to authenticated
using (
  core.has_cap('core', 'manage_rbac')
  or core.has_cap('core', 'view_audit')
  or user_id = (select auth.uid())
);
