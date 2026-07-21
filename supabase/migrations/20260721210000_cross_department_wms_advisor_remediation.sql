-- Follow-up for Supabase advisor findings after the cross-department WMS rollout.
-- Foreign-key indexes support handoff queues and the auth UID subqueries avoid
-- evaluating auth.uid() once per row in requester-scoped read policies.

create index if not exists warehouse_fulfillment_source_bin_idx
  on warehouse.fulfillment_orders (source_bin_id);
create index if not exists warehouse_fulfillment_event_idx
  on warehouse.fulfillment_orders (event_id);
create index if not exists warehouse_fulfillment_third_party_location_idx
  on warehouse.fulfillment_orders (third_party_location_id);
create index if not exists warehouse_fulfillment_created_by_idx
  on warehouse.fulfillment_orders (created_by);
create index if not exists warehouse_fulfillment_released_by_idx
  on warehouse.fulfillment_orders (released_by);

create index if not exists warehouse_department_request_approved_by_idx
  on warehouse.department_stock_requests (approved_by);
create index if not exists warehouse_department_request_fulfillment_idx
  on warehouse.department_stock_requests (fulfillment_order_id);

create index if not exists warehouse_customer_return_source_order_idx
  on warehouse.customer_return_cases (source_order_id);
create index if not exists warehouse_customer_return_quarantine_bin_idx
  on warehouse.customer_return_cases (quarantine_bin_id);
create index if not exists warehouse_customer_return_replacement_order_idx
  on warehouse.customer_return_cases (replacement_order_id);
create index if not exists warehouse_customer_return_created_by_idx
  on warehouse.customer_return_cases (created_by);
create index if not exists warehouse_customer_return_resolved_by_idx
  on warehouse.customer_return_cases (resolved_by);

create index if not exists warehouse_kit_created_by_idx
  on warehouse.kit_definitions (created_by);

create index if not exists warehouse_rekit_source_return_idx
  on warehouse.rekit_work_orders (source_return_case_id);
create index if not exists warehouse_rekit_definition_idx
  on warehouse.rekit_work_orders (kit_definition_id);
create index if not exists warehouse_rekit_created_by_idx
  on warehouse.rekit_work_orders (created_by);
create index if not exists warehouse_rekit_completed_by_idx
  on warehouse.rekit_work_orders (completed_by);

drop policy if exists fulfillment_orders_read on warehouse.fulfillment_orders;
create policy fulfillment_orders_read on warehouse.fulfillment_orders for select to authenticated using (
  created_by = (select auth.uid())
  or exists (
    select 1 from warehouse.department_stock_requests request
     where request.fulfillment_order_id = fulfillment_orders.id
       and request.requested_by = (select auth.uid())
  )
  or core.has_cap('warehouse', 'view_dashboard')
  or core.has_cap('warehouse', 'request_fulfillment')
  or core.has_cap('warehouse', 'reserve_allocate')
  or core.has_cap('warehouse', 'issue_items')
);

drop policy if exists department_stock_requests_read on warehouse.department_stock_requests;
create policy department_stock_requests_read on warehouse.department_stock_requests for select to authenticated using (
  requested_by = (select auth.uid())
  or core.has_cap('warehouse', 'issue_items')
  or core.has_cap('procurement', 'approve_request')
);

drop policy if exists customer_return_cases_read on warehouse.customer_return_cases;
create policy customer_return_cases_read on warehouse.customer_return_cases for select to authenticated using (
  created_by = (select auth.uid())
  or core.has_cap('warehouse', 'manage_returns')
  or core.has_cap('warehouse', 'approve_stock_adjustment_finance')
);
