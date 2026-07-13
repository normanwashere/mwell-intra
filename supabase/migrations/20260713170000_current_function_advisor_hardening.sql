begin;

alter table warehouse.stock_levels
  add column if not exists id uuid default gen_random_uuid();

update warehouse.stock_levels
set id = gen_random_uuid()
where id is null;

alter table warehouse.stock_levels
  alter column id set default gen_random_uuid(),
  alter column id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'warehouse.stock_levels'::regclass
      and contype = 'p'
  ) then
    alter table warehouse.stock_levels
      add constraint stock_levels_pkey primary key (id);
  end if;
end
$$;

-- Advisor-derived supporting indexes. The existing stock-level business key
-- remains authoritative while these indexes support FK checks and joins.
create index if not exists policy_remediation_queue_assigned_to_fkey_idx on core.policy_remediation_queue (assigned_to);
create index if not exists accreditation_dispositions_case_id_fkey_idx on legal.accreditation_dispositions (case_id);
create index if not exists accreditation_dispositions_decided_by_fkey_idx on legal.accreditation_dispositions (decided_by);
create index if not exists accreditation_dispositions_equivalent_document_id_fkey_idx on legal.accreditation_dispositions (equivalent_document_id);
create index if not exists instrument_documents_created_by_fkey_idx on legal.instrument_documents (created_by);
create index if not exists instrument_lifecycle_events_actor_id_fkey_idx on legal.instrument_lifecycle_events (actor_id);
create index if not exists instrument_lifecycle_events_instrument_document_id_fkey_idx on legal.instrument_lifecycle_events (instrument_document_id);
create index if not exists instrument_signatures_revoked_by_fkey_idx on legal.instrument_signatures (revoked_by);
create index if not exists instrument_signatures_signer_user_id_fkey_idx on legal.instrument_signatures (signer_user_id);
create index if not exists vendor_application_snapshots_created_by_fkey_idx on legal.vendor_application_snapshots (created_by);
create index if not exists vendor_application_snapshots_policy_id_policy_version_fkey_idx on legal.vendor_application_snapshots (policy_id, policy_version);
create index if not exists vendor_application_snapshots_vendor_id_fkey_idx on legal.vendor_application_snapshots (vendor_id);
create index if not exists vendor_technology_qualifications_reviewed_by_fkey_idx on legal.vendor_technology_qualifications (reviewed_by);
create index if not exists acceptance_packs_accepted_by_fkey_idx on procurement.acceptance_packs (accepted_by);
create index if not exists acceptance_packs_request_id_fkey_idx on procurement.acceptance_packs (request_id);
create index if not exists approval_steps_assigned_user_id_fkey_idx on procurement.approval_steps (assigned_user_id);
create index if not exists doa_assignments_approver_user_id_fkey_idx on procurement.doa_assignments (approver_user_id);
create index if not exists doa_matrices_activated_by_fkey_idx on procurement.doa_matrices (activated_by);
create index if not exists doa_matrices_created_by_fkey_idx on procurement.doa_matrices (created_by);
create index if not exists exception_packs_final_approval_step_id_fkey_idx on procurement.exception_packs (final_approval_step_id);
create index if not exists exception_packs_procurement_head_reviewed_by_fkey_idx on procurement.exception_packs (procurement_head_reviewed_by);
create index if not exists exception_packs_vendor_id_fkey_idx on procurement.exception_packs (vendor_id);
create index if not exists financial_protection_requirements_request_id_fkey_idx on procurement.financial_protection_requirements (request_id);
create index if not exists financial_protection_requirements_reviewed_by_fkey_idx on procurement.financial_protection_requirements (reviewed_by);
create index if not exists payment_readiness_packs_acceptance_pack_id_fkey_idx on procurement.payment_readiness_packs (acceptance_pack_id);
create index if not exists payment_readiness_packs_corrected_from_fkey_idx on procurement.payment_readiness_packs (corrected_from);
create index if not exists payment_readiness_packs_finance_reviewed_by_fkey_idx on procurement.payment_readiness_packs (finance_reviewed_by);
create index if not exists payment_readiness_packs_prepared_by_fkey_idx on procurement.payment_readiness_packs (prepared_by);
create index if not exists purchase_order_lines_warehouse_product_id_fkey_idx on procurement.purchase_order_lines (warehouse_product_id);
create index if not exists route_decisions_confirmed_by_fkey_idx on procurement.route_decisions (confirmed_by);
create index if not exists sourcing_events_created_by_fkey_idx on procurement.sourcing_events (created_by);
create index if not exists sourcing_events_route_decision_id_fkey_idx on procurement.sourcing_events (route_decision_id);
create index if not exists sourcing_responses_vendor_id_fkey_idx on procurement.sourcing_responses (vendor_id);
create index if not exists activation_events_owner_id_fkey_idx on public.activation_events (owner_id);
create index if not exists activation_events_site_location_id_fkey_idx on public.activation_events (site_location_id);
create index if not exists allocation_request_lines_allocation_request_id_fkey_idx on public.allocation_request_lines (allocation_request_id);
create index if not exists allocation_request_lines_variant_id_fkey_idx on public.allocation_request_lines (variant_id);
create index if not exists allocation_requests_activation_event_id_fkey_idx on public.allocation_requests (activation_event_id);
create index if not exists allocation_requests_requester_id_fkey_idx on public.allocation_requests (requester_id);
create index if not exists approvals_approver_id_fkey_idx on public.approvals (approver_id);
create index if not exists approvals_requester_id_fkey_idx on public.approvals (requester_id);
create index if not exists attachments_uploaded_by_fkey_idx on public.attachments (uploaded_by);
create index if not exists audit_events_attachment_id_fkey_idx on public.audit_events (attachment_id);
create index if not exists audit_events_user_id_fkey_idx on public.audit_events (user_id);
create index if not exists cost_layers_product_id_fkey_idx on public.cost_layers (product_id);
create index if not exists cost_layers_variant_id_fkey_idx on public.cost_layers (variant_id);
create index if not exists csv_exports_generated_by_fkey_idx on public.csv_exports (generated_by);
create index if not exists event_usage_reports_activation_event_id_fkey_idx on public.event_usage_reports (activation_event_id);
create index if not exists event_usage_reports_created_by_fkey_idx on public.event_usage_reports (created_by);
create index if not exists event_usage_reports_variant_id_fkey_idx on public.event_usage_reports (variant_id);
create index if not exists export_jobs_requested_by_fkey_idx on public.export_jobs (requested_by);
create index if not exists export_jobs_retry_of_fkey_idx on public.export_jobs (retry_of);
create index if not exists inventory_balances_lld_location_id_fkey_idx on public.inventory_balances (lld_location_id);
create index if not exists inventory_balances_location_id_fkey_idx on public.inventory_balances (location_id);
create index if not exists inventory_balances_variant_id_fkey_idx on public.inventory_balances (variant_id);
create index if not exists inventory_ledger_from_location_id_fkey_idx on public.inventory_ledger (from_location_id);
create index if not exists inventory_ledger_lld_from_location_id_fkey_idx on public.inventory_ledger (lld_from_location_id);
create index if not exists inventory_ledger_lld_to_location_id_fkey_idx on public.inventory_ledger (lld_to_location_id);
create index if not exists inventory_ledger_serial_unit_id_fkey_idx on public.inventory_ledger (serial_unit_id);
create index if not exists inventory_ledger_sku_id_fkey_idx on public.inventory_ledger (sku_id);
create index if not exists inventory_ledger_to_location_id_fkey_idx on public.inventory_ledger (to_location_id);
create index if not exists inventory_ledger_user_id_fkey_idx on public.inventory_ledger (user_id);
create index if not exists inventory_ledger_variant_id_fkey_idx on public.inventory_ledger (variant_id);
create index if not exists inventory_locations_parent_id_fkey_idx on public.inventory_locations (parent_id);
create index if not exists issuances_activation_event_id_fkey_idx on public.issuances (activation_event_id);
create index if not exists issuances_issued_by_fkey_idx on public.issuances (issued_by);
create index if not exists issuances_reservation_id_fkey_idx on public.issuances (reservation_id);
create index if not exists issuances_serial_unit_id_fkey_idx on public.issuances (serial_unit_id);
create index if not exists issuances_variant_id_fkey_idx on public.issuances (variant_id);
create index if not exists order_items_order_id_fkey_idx on public.order_items (order_id);
create index if not exists order_items_sku_id_fkey_idx on public.order_items (sku_id);
create index if not exists pick_tasks_location_id_fkey_idx on public.pick_tasks (location_id);
create index if not exists pick_tasks_order_id_fkey_idx on public.pick_tasks (order_id);
create index if not exists pick_tasks_picker_id_fkey_idx on public.pick_tasks (picker_id);
create index if not exists pick_tasks_sku_id_fkey_idx on public.pick_tasks (sku_id);
create index if not exists pricing_simulations_export_job_id_fkey_idx on public.pricing_simulations (export_job_id);
create index if not exists pricing_simulations_requested_by_fkey_idx on public.pricing_simulations (requested_by);
create index if not exists procurement_requests_requester_id_fkey_idx on public.procurement_requests (requester_id);
create index if not exists procurement_requests_sku_id_fkey_idx on public.procurement_requests (sku_id);
create index if not exists products_created_by_fkey_idx on public.products (created_by);
create index if not exists purchase_orders_created_by_fkey_idx on public.purchase_orders (created_by);
create index if not exists purchase_orders_procurement_request_id_fkey_idx on public.purchase_orders (procurement_request_id);
create index if not exists purchase_orders_supplier_id_fkey_idx on public.purchase_orders (supplier_id);
create index if not exists purchase_orders_variant_id_fkey_idx on public.purchase_orders (variant_id);
create index if not exists receiving_items_receiving_id_fkey_idx on public.receiving_items (receiving_id);
create index if not exists receiving_items_sku_id_fkey_idx on public.receiving_items (sku_id);
create index if not exists receiving_records_created_by_fkey_idx on public.receiving_records (created_by);
create index if not exists reservations_allocation_request_line_id_fkey_idx on public.reservations (allocation_request_line_id);
create index if not exists reservations_approved_by_fkey_idx on public.reservations (approved_by);
create index if not exists reservations_location_id_fkey_idx on public.reservations (location_id);
create index if not exists reservations_variant_id_fkey_idx on public.reservations (variant_id);
create index if not exists return_records_activation_event_id_fkey_idx on public.return_records (activation_event_id);
create index if not exists return_records_serial_unit_id_fkey_idx on public.return_records (serial_unit_id);
create index if not exists return_records_sku_id_fkey_idx on public.return_records (sku_id);
create index if not exists return_records_variant_id_fkey_idx on public.return_records (variant_id);
create index if not exists serialized_units_cost_layer_id_fkey_idx on public.serialized_units (cost_layer_id);
create index if not exists serialized_units_current_location_id_fkey_idx on public.serialized_units (current_location_id);
create index if not exists serialized_units_variant_id_fkey_idx on public.serialized_units (variant_id);
create index if not exists task_scans_scanned_by_fkey_idx on public.task_scans (scanned_by);
create index if not exists valuation_snapshots_export_job_id_fkey_idx on public.valuation_snapshots (export_job_id);
create index if not exists valuation_snapshots_generated_by_fkey_idx on public.valuation_snapshots (generated_by);
create index if not exists valuation_snapshots_variant_id_fkey_idx on public.valuation_snapshots (variant_id);
create index if not exists cycle_counts_requested_by_fkey_idx on warehouse.cycle_counts (requested_by);
create index if not exists exceptions_created_by_fkey_idx on warehouse.exceptions (created_by);
create index if not exists exceptions_owner_id_fkey_idx on warehouse.exceptions (owner_id);
create index if not exists exceptions_waived_by_fkey_idx on warehouse.exceptions (waived_by);
create index if not exists import_jobs_corrected_from_fkey_idx on warehouse.import_jobs (corrected_from);
create index if not exists import_jobs_reviewed_by_fkey_idx on warehouse.import_jobs (reviewed_by);
create index if not exists inventory_holds_bin_id_fkey_idx on warehouse.inventory_holds (bin_id);
create index if not exists inventory_holds_created_by_fkey_idx on warehouse.inventory_holds (created_by);
create index if not exists inventory_holds_inspection_id_fkey_idx on warehouse.inventory_holds (inspection_id);
create index if not exists inventory_holds_location_id_fkey_idx on warehouse.inventory_holds (location_id);
create index if not exists inventory_holds_lot_id_fkey_idx on warehouse.inventory_holds (lot_id);
create index if not exists inventory_holds_product_id_fkey_idx on warehouse.inventory_holds (product_id);
create index if not exists inventory_holds_released_by_fkey_idx on warehouse.inventory_holds (released_by);
create index if not exists quality_inspections_bin_id_fkey_idx on warehouse.quality_inspections (bin_id);
create index if not exists quality_inspections_inspected_by_fkey_idx on warehouse.quality_inspections (inspected_by);
create index if not exists quality_inspections_location_id_fkey_idx on warehouse.quality_inspections (location_id);
create index if not exists quality_inspections_lot_id_fkey_idx on warehouse.quality_inspections (lot_id);
create index if not exists quality_inspections_product_id_fkey_idx on warehouse.quality_inspections (product_id);
create index if not exists receipts_operation_route_id_fkey_idx on warehouse.receipts (operation_route_id);
create index if not exists stock_change_requests_bin_id_fkey_idx on warehouse.stock_change_requests (bin_id);
create index if not exists stock_change_requests_location_id_fkey_idx on warehouse.stock_change_requests (location_id);
create index if not exists stock_change_requests_product_id_fkey_idx on warehouse.stock_change_requests (product_id);
create index if not exists stock_change_requests_requested_by_fkey_idx on warehouse.stock_change_requests (requested_by);
create index if not exists vendor_returns_created_by_fkey_idx on warehouse.vendor_returns (created_by);
create index if not exists vendor_returns_handed_off_by_fkey_idx on warehouse.vendor_returns (handed_off_by);
create index if not exists vendor_returns_hold_id_fkey_idx on warehouse.vendor_returns (hold_id);
create index if not exists vendor_returns_lot_id_fkey_idx on warehouse.vendor_returns (lot_id);
create index if not exists vendor_returns_product_id_fkey_idx on warehouse.vendor_returns (product_id);
create index if not exists vendor_returns_supplier_id_fkey_idx on warehouse.vendor_returns (supplier_id);

drop policy if exists request_attachments_read on procurement.request_attachments;
create policy request_attachments_read
  on procurement.request_attachments for select to authenticated
  using (
    core.has_cap('procurement', 'view_dashboard')
    or exists (
      select 1 from procurement.requests r
      where r.id = request_attachments.request_id
        and r.requester_id = (select auth.uid())
    )
  );

drop policy if exists warehouse_export_jobs_read on warehouse.export_jobs;
create policy warehouse_export_jobs_read
  on warehouse.export_jobs for select to authenticated
  using (
    created_by = (select auth.uid())
    or core.has_cap('warehouse', 'view_analytics')
    or core.has_cap('warehouse', 'view_finance')
  );

drop policy if exists warehouse_stock_changes_read on warehouse.stock_change_requests;
create policy warehouse_stock_changes_read
  on warehouse.stock_change_requests for select to authenticated
  using (
    requested_by = (select auth.uid())
    or core.has_cap('warehouse', 'approve_stock_adjustment')
    or core.has_cap('warehouse', 'view_exceptions')
  );

drop policy if exists warehouse_import_jobs_read on warehouse.import_jobs;
create policy warehouse_import_jobs_read
  on warehouse.import_jobs for select to authenticated
  using (
    created_by = (select auth.uid())
    or core.has_cap('warehouse', 'import_warehouse_data')
    or core.has_cap('warehouse', 'view_finance')
  );

drop policy if exists warehouse_import_errors_read on warehouse.import_errors;
create policy warehouse_import_errors_read
  on warehouse.import_errors for select to authenticated
  using (
    exists (
      select 1 from warehouse.import_jobs j
      where j.id = import_errors.import_job_id
        and (
          j.created_by = (select auth.uid())
          or core.has_cap('warehouse', 'import_warehouse_data')
          or core.has_cap('warehouse', 'view_finance')
        )
    )
  );

drop policy if exists procurement_pos_read on procurement.purchase_orders;
drop policy if exists warehouse_receivable_pos_read on procurement.purchase_orders;
drop policy if exists procurement_purchase_orders_read on procurement.purchase_orders;
create policy procurement_purchase_orders_read
  on procurement.purchase_orders for select to authenticated
  using (
    core.has_cap('procurement', 'author_po')
    or core.has_cap('procurement', 'approve_award')
    or core.has_cap('procurement', 'view_finance')
    or (
      core.has_cap('warehouse', 'receive_stock')
      and status in ('approved', 'issued')
    )
  );

drop policy if exists procurement_po_lines_read on procurement.purchase_order_lines;
drop policy if exists warehouse_receivable_po_lines_read on procurement.purchase_order_lines;
drop policy if exists procurement_purchase_order_lines_read on procurement.purchase_order_lines;
create policy procurement_purchase_order_lines_read
  on procurement.purchase_order_lines for select to authenticated
  using (
    exists (
      select 1 from procurement.purchase_orders po
      where po.id = purchase_order_lines.purchase_order_id
        and (
          core.has_cap('procurement', 'author_po')
          or core.has_cap('procurement', 'approve_award')
          or core.has_cap('procurement', 'view_finance')
          or (
            core.has_cap('warehouse', 'receive_stock')
            and po.status in ('approved', 'issued')
          )
        )
    )
  );

select pg_notify('pgrst', 'reload schema');
commit;

