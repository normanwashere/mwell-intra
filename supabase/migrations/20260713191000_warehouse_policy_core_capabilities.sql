-- Remove the remaining legacy warehouse.has_cap policy calls. The live app's
-- authoritative RBAC catalogue is core.user_roles + core.role_capabilities.

drop policy if exists locations_insert on warehouse.locations;
drop policy if exists locations_update on warehouse.locations;
drop policy if exists locations_delete on warehouse.locations;
create policy locations_insert on warehouse.locations for insert to authenticated
  with check (core.has_cap('warehouse', 'manage_locations'));
create policy locations_update on warehouse.locations for update to authenticated
  using (core.has_cap('warehouse', 'manage_locations'))
  with check (core.has_cap('warehouse', 'manage_locations'));
create policy locations_delete on warehouse.locations for delete to authenticated
  using (core.has_cap('warehouse', 'manage_locations'));

drop policy if exists products_insert on warehouse.products;
drop policy if exists products_update on warehouse.products;
drop policy if exists products_delete on warehouse.products;
create policy products_insert on warehouse.products for insert to authenticated
  with check (core.has_cap('warehouse', 'manage_products'));
create policy products_update on warehouse.products for update to authenticated
  using (core.has_cap('warehouse', 'manage_products'))
  with check (core.has_cap('warehouse', 'manage_products'));
create policy products_delete on warehouse.products for delete to authenticated
  using (core.has_cap('warehouse', 'manage_products'));

drop policy if exists suppliers_write_insert on warehouse.suppliers;
drop policy if exists suppliers_write_update on warehouse.suppliers;
drop policy if exists suppliers_write_delete on warehouse.suppliers;
create policy suppliers_write_insert on warehouse.suppliers for insert to authenticated
  with check (core.has_cap('warehouse', 'view_procurement'));
create policy suppliers_write_update on warehouse.suppliers for update to authenticated
  using (core.has_cap('warehouse', 'view_procurement'))
  with check (core.has_cap('warehouse', 'view_procurement'));
create policy suppliers_write_delete on warehouse.suppliers for delete to authenticated
  using (core.has_cap('warehouse', 'view_procurement'));

drop policy if exists read_lots on warehouse.lots;
create policy read_lots on warehouse.lots for select to authenticated
  using (
    core.has_cap('warehouse', 'view_procurement')
    or core.has_cap('warehouse', 'view_finance')
    or core.has_cap('warehouse', 'view_pricing')
    or core.has_cap('warehouse', 'receive_stock')
  );

drop policy if exists read_purchase_orders on warehouse.purchase_orders;
create policy read_purchase_orders on warehouse.purchase_orders for select to authenticated
  using (
    core.has_cap('warehouse', 'view_procurement')
    or core.has_cap('warehouse', 'receive_stock')
  );

drop policy if exists read_suppliers on warehouse.suppliers;
create policy read_suppliers on warehouse.suppliers for select to authenticated
  using (
    core.has_cap('warehouse', 'view_procurement')
    or core.has_cap('warehouse', 'receive_stock')
    or core.has_cap('warehouse', 'manage_products')
  );
