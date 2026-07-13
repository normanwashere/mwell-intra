-- Keep private warehouse evidence on the same authoritative capability
-- catalogue as the application and warehouse table policies.

drop policy if exists evidence_auth_read on storage.objects;
create policy evidence_auth_read on storage.objects for select to authenticated
  using (
    bucket_id = 'evidence'
    and (
      owner = auth.uid()
      or core.has_cap('warehouse', 'view_finance')
    )
  );

drop policy if exists evidence_auth_write on storage.objects;
create policy evidence_auth_write on storage.objects for insert to authenticated
  with check (
    bucket_id = 'evidence'
    and (
      core.has_cap('warehouse', 'receive_stock')
      or core.has_cap('warehouse', 'manage_returns')
      or core.has_cap('warehouse', 'issue_items')
      or core.has_cap('warehouse', 'cycle_count')
    )
  );
