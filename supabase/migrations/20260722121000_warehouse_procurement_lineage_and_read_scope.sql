-- Warehouse consumes approved Procurement purchase orders; it does not author
-- a parallel supplier commitment. This forward migration also separates
-- inventory visibility from physical custody mutations.

insert into core.capabilities(module, cap)
values ('warehouse', 'view_inventory')
on conflict do nothing;

insert into core.role_capabilities(module, role, cap)
select 'warehouse', role, 'view_inventory'
from core.roles
where module = 'warehouse'
  and is_active
on conflict do nothing;

delete from core.role_capabilities
where module = 'warehouse'
  and role in ('finance', 'pricing')
  and cap in ('manage_inventory', 'cycle_count', 'transfer_stock');

delete from core.role_capabilities
where module = 'warehouse'
  and role in ('finance', 'pricing')
  and cap in (
    'receive_stock', 'manage_locations', 'manage_returns', 'reserve_allocate',
    'issue_items', 'inspect_quality', 'release_quality_hold',
    'approve_stock_adjustment', 'resolve_exceptions', 'import_warehouse_data',
    'manage_operation_routes'
  );

delete from core.role_capabilities
where module = 'warehouse'
  and role = 'operations'
  and cap in (
    'receive_stock', 'cycle_count', 'manage_returns', 'reserve_allocate',
    'issue_items', 'transfer_stock', 'inspect_quality',
    'release_quality_hold', 'approve_stock_adjustment',
    'approve_stock_adjustment_finance', 'resolve_exceptions',
    'import_warehouse_data', 'manage_operation_routes'
  );

insert into core.role_capabilities(module, role, cap) values
  ('warehouse', 'operations', 'request_fulfillment'),
  ('warehouse', 'operations', 'request_stock'),
  ('warehouse', 'operations', 'submit_return_case')
on conflict do nothing;

delete from core.role_capabilities
where module = 'warehouse'
  and role in (
    'operations', 'bi_analyst', 'business_unit', 'marketing', 'procurement'
  )
  and cap = 'manage_inventory';

create or replace function warehouse.create_purchase_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = warehouse, procurement, core, public
as $$
begin
  raise exception 'Warehouse PO authoring is disabled; create an approved Procurement PO instead';
end;
$$;

revoke all on function warehouse.create_purchase_order(jsonb)
  from public, anon, authenticated;
grant execute on function warehouse.create_purchase_order(jsonb)
  to service_role;

create or replace function warehouse.reject_raw_purchase_order_insert()
returns trigger
language plpgsql
security definer
set search_path = warehouse, procurement, core, public
as $$
begin
  raise exception 'Warehouse PO authoring is disabled; create an approved Procurement PO instead';
end;
$$;

revoke all on function warehouse.reject_raw_purchase_order_insert()
  from public, anon, authenticated;
grant execute on function warehouse.reject_raw_purchase_order_insert()
  to service_role;

drop trigger if exists reject_raw_purchase_order_insert
  on warehouse.purchase_orders;
create trigger reject_raw_purchase_order_insert
before insert on warehouse.purchase_orders
for each row execute function warehouse.reject_raw_purchase_order_insert();
