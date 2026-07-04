-- Mwell Intra — warehouse evidence Storage bucket + object RLS
--
-- Ports the durable evidence storage (source: evidence_storage + the v4 read /
-- v7 write / v5 delete hardening) into its FINAL state. Photo evidence
-- (receiving slips, return condition, issue handovers, cycle-count proof) is
-- uploaded to the PRIVATE `evidence` Storage bucket; rows store the object PATH
-- and viewing goes through short-lived signed URLs.
--
-- ADR-002 #1 (spec §4.4/§8/§11): the evidence FILES stay in this bucket — there
-- is NO file migration — but every evidence object is REGISTERED in
-- core.documents (entity_type='receipt'/'return') by the receipt/return RPCs in
-- 20260706092400_warehouse_rpcs.sql, so all documents are queryable / RLS-
-- governed in one place.
--
-- RBAC rewire: the source `warehouse.has_cap(cap)` gates become the core helper
-- core.has_any_cap(cap) (storage.objects is a cross-cutting, non-warehouse
-- table; the warehouse caps referenced live only in the warehouse module so the
-- effective grantee set is unchanged).
--
-- Re-runnable: on-conflict-do-nothing bucket insert; drop policy if exists.

insert into storage.buckets (id, name, public)
values ('evidence', 'evidence', false)
on conflict (id) do nothing;

-- READ (v4): the uploader, or a finance/audit reviewer. Signed URLs (which
-- bypass RLS for their lifetime) are how end users actually view objects.
drop policy if exists evidence_auth_read on storage.objects;
create policy evidence_auth_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'evidence'
    and (owner = auth.uid() or core.has_any_cap('view_finance'))
  );

-- WRITE (v7): only roles that actually CAPTURE evidence may upload.
drop policy if exists evidence_auth_write on storage.objects;
create policy evidence_auth_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'evidence'
    and (
      core.has_any_cap('receive_stock')
      or core.has_any_cap('manage_returns')
      or core.has_any_cap('issue_items')
      or core.has_any_cap('cycle_count')
    )
  );

-- DELETE (v5): uploader-only.
drop policy if exists evidence_auth_delete on storage.objects;
create policy evidence_auth_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'evidence' and owner = auth.uid());
