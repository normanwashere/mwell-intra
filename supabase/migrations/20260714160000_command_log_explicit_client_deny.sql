-- command_log is an internal idempotency ledger used only by security-definer
-- warehouse RPCs. Keep the existing privilege revocation and make the RLS
-- client denial explicit so the database advisor can verify the boundary.

drop policy if exists warehouse_command_log_no_client_access
  on warehouse.command_log;

create policy warehouse_command_log_no_client_access
  on warehouse.command_log
  for all
  to anon, authenticated
  using (false)
  with check (false);
