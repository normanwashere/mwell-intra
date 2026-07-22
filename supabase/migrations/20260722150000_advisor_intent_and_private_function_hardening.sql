-- Make intentionally RPC-only tables explicit and remove direct execution of
-- internal SECURITY DEFINER helpers from application roles.

drop policy if exists direct_access_denied on core.approval_groups;
create policy direct_access_denied on core.approval_groups
for select to authenticated using (false);

drop policy if exists direct_access_denied on procurement.acceptance_reviewer_assignments;
create policy direct_access_denied on procurement.acceptance_reviewer_assignments
for select to authenticated using (false);

drop policy if exists direct_access_denied on procurement.payment_readiness_staleness_events;
create policy direct_access_denied on procurement.payment_readiness_staleness_events
for select to authenticated using (false);

drop policy if exists direct_access_denied on procurement.purchase_order_amendment_steps;
create policy direct_access_denied on procurement.purchase_order_amendment_steps
for select to authenticated using (false);

drop policy if exists direct_access_denied on procurement.purchase_order_amendments;
create policy direct_access_denied on procurement.purchase_order_amendments
for select to authenticated using (false);

drop policy if exists direct_access_denied on procurement.receipt_reconciliations;
create policy direct_access_denied on procurement.receipt_reconciliations
for select to authenticated using (false);

drop policy if exists direct_access_denied on warehouse.procurement_receipt_exception_decisions;
create policy direct_access_denied on warehouse.procurement_receipt_exception_decisions
for select to authenticated using (false);

drop policy if exists direct_access_denied on warehouse.procurement_receipt_exception_lines;
create policy direct_access_denied on warehouse.procurement_receipt_exception_lines
for select to authenticated using (false);

drop policy if exists direct_access_denied on warehouse.procurement_receipt_excess_custody;
create policy direct_access_denied on warehouse.procurement_receipt_excess_custody
for select to authenticated using (false);

drop policy if exists direct_access_denied on warehouse.unidentified_receipt_custody;
create policy direct_access_denied on warehouse.unidentified_receipt_custody
for select to authenticated using (false);

comment on policy direct_access_denied on core.approval_groups is
  'RPC-only relation. Direct authenticated reads intentionally fail closed.';
comment on policy direct_access_denied on procurement.purchase_order_amendments is
  'Use governed amendment RPCs and projections; direct reads intentionally fail closed.';

revoke execute on all functions in schema private from public, anon, authenticated;

-- Legacy public procurement-request RLS policies call this helper directly.
grant execute on function private.current_app_role() to authenticated;

-- Trigger helpers and private policy implementations remain callable by their
-- owning triggers and SECURITY DEFINER public wrappers, not by API roles.
revoke execute on function private.guard_po_amendment_snapshot()
  from public, anon, authenticated;
