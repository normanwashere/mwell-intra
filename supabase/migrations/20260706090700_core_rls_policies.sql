-- Mwell Intra — core RLS policies + write lockdown
--
-- Two jobs, mirroring the warehouse hardening pattern (docs/LLD.md §11.2):
--   1. SELECT policies on every readable core table. Reads are capability-scoped
--      (spec §5); VENDOR-KIND sessions are filtered to their own vendor_id
--      (spec §5, ADR-002 #3). Cross-cutting reads use core.has_any_cap(cap) so a
--      procurement approver / legal reviewer / warehouse role can all read the
--      shared master data their role's cap allows.
--   2. Revoke direct INSERT/UPDATE/DELETE from `authenticated` on every core
--      table — writes go ONLY through the SECURITY DEFINER RPCs (spec §6.2).
--      SELECT is retained; the RPCs (which run as owner) own all writes.
--
-- The catalogue tables (capabilities/roles/role_capabilities) already have RLS
-- on with NO grants and NO policies (rbac migration) — they stay unreadable to
-- API roles; only the security-definer helpers touch them.
--
-- VENDOR-TIER RLS — how it is enforced (spec §5):
--   * core.is_vendor() -> true when the caller's profile.kind = 'vendor'.
--   * core.current_vendor_id() -> the caller's profiles.vendor_id.
--   Vendor visibility is granted ONLY through these branches (their own vendor
--   row, their own vendor's documents, their own profile) and NOT through any
--   has_*_cap() branch, so vendor roles must never be seeded a broad read cap.
--
-- Re-runnable: drop policy if exists before every create; idempotent revokes.

-- ---------------------------------------------------------------------------
-- profiles — self, plus internal directory readers. Vendors see only self.
-- ---------------------------------------------------------------------------
drop policy if exists read_profiles on core.profiles;
create policy read_profiles on core.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or core.has_any_cap('view_directory')
  );

-- ---------------------------------------------------------------------------
-- user_roles — a user sees their own role assignments; RBAC admins see all.
-- ---------------------------------------------------------------------------
drop policy if exists read_user_roles on core.user_roles;
create policy read_user_roles on core.user_roles
  for select to authenticated
  using (
    user_id = auth.uid()
    or core.has_any_cap('manage_rbac')
  );

-- ---------------------------------------------------------------------------
-- vendors — internal readers with view_vendors; a vendor sees only its own row.
-- ---------------------------------------------------------------------------
drop policy if exists read_vendors on core.vendors;
create policy read_vendors on core.vendors
  for select to authenticated
  using (
    core.has_any_cap('view_vendors')
    or (core.is_vendor() and id = core.current_vendor_id())
  );

-- ---------------------------------------------------------------------------
-- documents — internal readers with view_documents, the uploader, or a vendor
-- restricted to documents for their own vendor record (spec §5, RA 10173).
-- ---------------------------------------------------------------------------
drop policy if exists read_documents on core.documents;
create policy read_documents on core.documents
  for select to authenticated
  using (
    core.has_any_cap('view_documents')
    or uploaded_by = auth.uid()
    or (
      core.is_vendor()
      and entity_type = 'vendor'
      and entity_id = core.current_vendor_id()
    )
  );

-- ---------------------------------------------------------------------------
-- approvals — internal reviewers with view_approvals (vendors do not see these).
-- ---------------------------------------------------------------------------
drop policy if exists read_approvals on core.approvals;
create policy read_approvals on core.approvals
  for select to authenticated
  using (core.has_any_cap('view_approvals'));

-- ---------------------------------------------------------------------------
-- activity_log — auditors with view_audit, or the actor sees their own trail.
-- ---------------------------------------------------------------------------
drop policy if exists read_activity_log on core.activity_log;
create policy read_activity_log on core.activity_log
  for select to authenticated
  using (
    core.has_any_cap('view_audit')
    or actor = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- notifications — recipients see their own; notification admins see all.
-- ---------------------------------------------------------------------------
drop policy if exists read_notifications on core.notifications;
create policy read_notifications on core.notifications
  for select to authenticated
  using (
    user_id = auth.uid()
    or core.has_any_cap('manage_notifications')
  );

-- ---------------------------------------------------------------------------
-- Write lockdown: RPCs are the ONLY write path (spec §6.2). SELECT retained.
-- ---------------------------------------------------------------------------
revoke insert, update, delete on
  core.profiles,
  core.user_roles,
  core.vendors,
  core.documents,
  core.approvals,
  core.activity_log,
  core.notifications
from authenticated;

notify pgrst, 'reload schema';
