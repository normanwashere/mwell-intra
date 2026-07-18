-- Converge current RLS init plans and foreign-key covering indexes.

drop policy if exists profile_department_scopes_read on core.profile_department_scopes;
create policy profile_department_scopes_read on core.profile_department_scopes
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or core.has_cap('core', 'manage_rbac')
  );

drop policy if exists procurement_legacy_receipts_read on procurement.receipts;
create policy procurement_legacy_receipts_read on procurement.receipts
  for select to authenticated
  using (
    core.has_cap('procurement','view_dashboard')
    or core.has_cap('procurement','author_po')
    or exists (
      select 1
      from procurement.purchase_orders purchase_order
      join procurement.requests request on request.id=purchase_order.request_id
      where purchase_order.id::text=procurement.receipts.purchase_order_id::text
        and request.requester_id=(select auth.uid())
    )
  );

-- CREATE INDEX CONCURRENTLY must run outside a transaction block. Use Supabase CLI
-- 2.109.0 or newer (or another migration runner that executes these statements
-- without wrapping the file in BEGIN/COMMIT).
set lock_timeout = '5s';
-- Do not cancel a healthy long-running concurrent build and leave an invalid index.
set statement_timeout = '0';

create index concurrently if not exists approval_groups_module_capability_fkey_idx on core.approval_groups (module, capability);
create index concurrently if not exists departments_created_by_fkey_idx on core.departments (created_by);
create index concurrently if not exists departments_updated_by_fkey_idx on core.departments (updated_by);
create index concurrently if not exists profile_department_scopes_created_by_fkey_idx on core.profile_department_scopes (created_by);
create index concurrently if not exists profile_department_scopes_updated_by_fkey_idx on core.profile_department_scopes (updated_by);
create index concurrently if not exists acceptance_reviewer_assignments_assigned_by_fkey_idx on procurement.acceptance_reviewer_assignments (assigned_by);
create index concurrently if not exists acceptance_reviewer_assignments_reviewer_id_fkey_idx on procurement.acceptance_reviewer_assignments (reviewer_id);
create index concurrently if not exists exception_packs_route_decision_id_fkey_idx on procurement.exception_packs (route_decision_id);
create index concurrently if not exists payment_readiness_staleness_events_purchase_order_id_fkey_idx on procurement.payment_readiness_staleness_events (purchase_order_id);
create index concurrently if not exists policy_evidence_created_by_fkey_idx on procurement.policy_evidence (created_by);
create index concurrently if not exists policy_evidence_reviewed_by_fkey_idx on procurement.policy_evidence (reviewed_by);
create index concurrently if not exists purchase_order_amendment_steps_assigned_user_id_fkey_idx on procurement.purchase_order_amendment_steps (assigned_user_id);
create index concurrently if not exists purchase_order_amendment_steps_decided_by_fkey_idx on procurement.purchase_order_amendment_steps (decided_by);
create index concurrently if not exists purchase_order_amendment_steps_doa_assignment_id_fkey_idx on procurement.purchase_order_amendment_steps (doa_assignment_id);
create index concurrently if not exists purchase_order_amendments_approved_by_fkey_idx on procurement.purchase_order_amendments (approved_by);
create index concurrently if not exists purchase_order_amendments_decided_by_fkey_idx on procurement.purchase_order_amendments (decided_by);
create index concurrently if not exists purchase_order_amendments_doa_matrix_id_fkey_idx on procurement.purchase_order_amendments (doa_matrix_id);
create index concurrently if not exists purchase_order_amendments_po_line_id_fkey_idx on procurement.purchase_order_amendments (po_line_id);
create index concurrently if not exists purchase_order_amendments_requested_by_fkey_idx on procurement.purchase_order_amendments (requested_by);
create index concurrently if not exists receipt_reconciliations_reconciled_by_fkey_idx on procurement.receipt_reconciliations (reconciled_by);
create index concurrently if not exists procurement_receipt_exception_decisions_decided_by_fkey_idx on warehouse.procurement_receipt_exception_decisions (decided_by);
create index concurrently if not exists procurement_receipt_exception_decisions_purchase_order_id_fkey_ on warehouse.procurement_receipt_exception_decisions (purchase_order_id);
create index concurrently if not exists procurement_receipt_exception_decisions_requested_by_fkey_idx on warehouse.procurement_receipt_exception_decisions (requested_by);
create index concurrently if not exists procurement_receipt_excess_custody_approved_amendment_id_fkey_i on warehouse.procurement_receipt_excess_custody (approved_amendment_id);
create index concurrently if not exists procurement_receipt_excess_custody_po_line_id_fkey_idx on warehouse.procurement_receipt_excess_custody (po_line_id);
create index concurrently if not exists procurement_receipt_excess_custody_product_id_fkey_idx on warehouse.procurement_receipt_excess_custody (product_id);
create index concurrently if not exists procurement_receipt_excess_custody_receipt_id_fkey_idx on warehouse.procurement_receipt_excess_custody (receipt_id);
create index concurrently if not exists procurement_receipt_excess_custody_resolved_by_fkey_idx on warehouse.procurement_receipt_excess_custody (resolved_by);
create index concurrently if not exists unidentified_receipt_custody_identified_by_fkey_idx on warehouse.unidentified_receipt_custody (identified_by);
create index concurrently if not exists unidentified_receipt_custody_identified_product_id_fkey_idx on warehouse.unidentified_receipt_custody (identified_product_id);
create index concurrently if not exists unidentified_receipt_custody_po_line_id_fkey_idx on warehouse.unidentified_receipt_custody (po_line_id);
create index concurrently if not exists unidentified_receipt_custody_receipt_id_fkey_idx on warehouse.unidentified_receipt_custody (receipt_id);

reset statement_timeout;
reset lock_timeout;
