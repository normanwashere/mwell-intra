-- Intersect legacy permissive/owner policies with current database authority.
-- Scoped SECURITY DEFINER RPCs retain their own authorization and row scope.
create or replace function private.can_read_warehouse_table(p_table text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_caps text[];
begin
  if auth.uid() is null or p_table is null or not (p_table = any(array[
    'allocations', 'customer_return_cases', 'cycle_counts', 'department_stock_requests',
    'event_lifecycle_events', 'event_reconciliations', 'event_settlements', 'events',
    'exceptions', 'export_jobs', 'fulfillment_orders', 'fulfillment_reservations',
    'import_errors', 'import_jobs', 'inventory_holds', 'inventory_integrity_cases',
    'inventory_units', 'kit_definitions', 'locations', 'lots', 'movements',
    'operation_routes', 'operation_types', 'products', 'profiles', 'purchase_orders',
    'quality_inspections', 'receipts', 'receiving_drafts', 'rekit_work_orders',
    'returns', 'stock_change_requests', 'stock_levels', 'storage_areas', 'suppliers', 'vendor_returns'
  ])) then
    return false;
  end if;

  -- Every existing Warehouse persona hydrates the shared inventory read model.
  -- This does not override narrower permissive policies on controlled tables.
  if core.has_live_cap('warehouse', 'view_inventory') then
    return true;
  end if;

  if p_table = any(array['events', 'allocations', 'movements', 'products',
      'event_lifecycle_events', 'event_reconciliations', 'department_stock_requests'])
      and core.has_live_cap('events', 'view_events') then
    return true;
  end if;
  if p_table = any(array['kit_definitions', 'products'])
      and core.has_live_cap('product', 'view_readiness') then
    return true;
  end if;
  if p_table = any(array['products', 'inventory_units', 'stock_levels', 'movements',
      'cycle_counts', 'locations', 'storage_areas'])
      and core.has_live_cap('insights', 'view_warehouse') then
    return true;
  end if;
  if p_table = 'export_jobs' and core.has_live_cap('insights', 'prepare_exports') then
    return true;
  end if;
  if p_table = 'department_stock_requests' and core.has_live_cap('procurement', 'approve_request') then
    return true;
  end if;
  if p_table = any(array['event_reconciliations', 'event_settlements'])
      and core.has_live_cap('events', 'approve_settlement') then
    return true;
  end if;

  -- Action-only custom roles need their current learning-effective capability;
  -- a stale JWT, expired assignment or historical ownership is not authority.
  v_caps := case p_table
    when 'allocations' then array['reserve_allocate', 'issue_items', 'manage_returns', 'view_finance']
    when 'customer_return_cases' then array['submit_return_case', 'manage_returns', 'approve_stock_adjustment_finance']
    when 'cycle_counts' then array['cycle_count', 'view_analytics']
    when 'department_stock_requests' then array['request_stock', 'issue_items']
    when 'event_lifecycle_events' then array[]::text[]
    when 'event_reconciliations' then array['view_finance', 'manage_finance_close']
    when 'event_settlements' then array['manage_finance_close']
    when 'events' then array['request_fulfillment', 'reserve_allocate', 'issue_items', 'view_finance']
    when 'exceptions' then array['view_exceptions', 'resolve_exceptions']
    when 'export_jobs' then array['register_exports', 'review_exports']
    when 'fulfillment_orders' then array['view_dashboard', 'request_fulfillment', 'request_stock', 'reserve_allocate', 'issue_items']
    when 'fulfillment_reservations' then array['request_fulfillment', 'request_stock', 'reserve_allocate', 'issue_items']
    when 'import_errors' then array['import_warehouse_data', 'view_finance']
    when 'import_jobs' then array['import_warehouse_data', 'view_finance']
    when 'inventory_holds' then array['inspect_quality', 'release_quality_hold', 'view_exceptions', 'view_finance']
    when 'inventory_integrity_cases' then array['view_exceptions', 'resolve_exceptions']
    when 'inventory_units' then array['receive_stock', 'manage_inventory', 'cycle_count', 'manage_returns', 'reserve_allocate', 'issue_items', 'transfer_stock', 'inspect_quality', 'release_quality_hold', 'view_finance', 'view_exceptions']
    when 'kit_definitions' then array['manage_products', 'manage_returns']
    when 'locations' then array['manage_locations', 'receive_stock', 'reserve_allocate', 'issue_items', 'transfer_stock', 'cycle_count', 'inspect_quality']
    when 'lots' then array['view_procurement', 'view_finance', 'view_pricing', 'receive_stock']
    when 'movements' then array['view_finance', 'view_analytics', 'receive_stock', 'manage_inventory', 'manage_returns', 'issue_items', 'transfer_stock', 'inspect_quality']
    when 'operation_routes' then array['manage_operation_routes']
    when 'operation_types' then array['manage_operation_routes']
    when 'products' then array['manage_products', 'receive_stock', 'inspect_quality', 'manage_returns', 'view_pricing', 'view_procurement', 'view_finance', 'request_stock', 'request_fulfillment', 'reserve_allocate', 'issue_items']
    when 'profiles' then array['view_dashboard']
    when 'purchase_orders' then array['view_procurement', 'receive_stock']
    when 'quality_inspections' then array['inspect_quality', 'release_quality_hold', 'view_exceptions', 'view_finance']
    when 'receipts' then array['receive_stock', 'inspect_quality', 'view_finance', 'view_procurement']
    when 'receiving_drafts' then array['receive_stock']
    when 'rekit_work_orders' then array['manage_returns', 'manage_products']
    when 'returns' then array['manage_returns', 'submit_return_case', 'inspect_quality', 'view_finance']
    when 'stock_change_requests' then array['manage_inventory', 'cycle_count', 'approve_stock_adjustment', 'approve_stock_adjustment_finance', 'view_exceptions']
    when 'stock_levels' then array['receive_stock', 'manage_inventory', 'cycle_count', 'reserve_allocate', 'issue_items', 'transfer_stock', 'view_finance', 'view_analytics', 'view_procurement', 'request_stock', 'request_fulfillment']
    when 'storage_areas' then array['manage_locations', 'receive_stock', 'reserve_allocate', 'issue_items', 'transfer_stock', 'cycle_count', 'inspect_quality']
    when 'suppliers' then array['view_procurement', 'receive_stock', 'manage_products']
    when 'vendor_returns' then array['inspect_quality', 'view_procurement', 'view_exceptions']
    else array[]::text[]
  end;
  return exists(select 1 from unnest(v_caps) as c(cap) where core.has_live_cap('warehouse', c.cap));
end;
$$;

revoke all on function private.can_read_warehouse_table(text) from public, anon;
grant execute on function private.can_read_warehouse_table(text) to authenticated, service_role;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'allocations', 'customer_return_cases', 'cycle_counts', 'department_stock_requests',
    'event_lifecycle_events', 'event_reconciliations', 'event_settlements', 'events',
    'exceptions', 'export_jobs', 'fulfillment_orders', 'fulfillment_reservations',
    'import_errors', 'import_jobs', 'inventory_holds', 'inventory_integrity_cases',
    'inventory_units', 'kit_definitions', 'locations', 'lots', 'movements',
    'operation_routes', 'operation_types', 'products', 'profiles', 'purchase_orders',
    'quality_inspections', 'receipts', 'receiving_drafts', 'rekit_work_orders',
    'returns', 'stock_change_requests', 'stock_levels', 'storage_areas', 'suppliers', 'vendor_returns'
  ] loop
    execute format('alter table warehouse.%I enable row level security', v_table);
    execute format('create policy current_capability_read_guard on warehouse.%I as restrictive for select to authenticated using ((select private.can_read_warehouse_table(%L)))', v_table, v_table);
  end loop;
end;
$$;

-- Product readiness needs kit metadata, not a generic core directory grant.
alter policy kit_definitions_read on warehouse.kit_definitions
  using (private.can_read_warehouse_table('kit_definitions'));
