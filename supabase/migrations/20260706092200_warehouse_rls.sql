-- Mwell Intra — warehouse role-aware RLS, rewired onto core RBAC
--
-- Ports the warehouse role/capability-aware policies (source: role_aware_rls +
-- locations_crud + storage_areas + the v4 hardening reads + v4/v6 write
-- lockdowns) into their FINAL state, but rewired onto the AUTHORITATIVE monorepo
-- RBAC (spec §4.2, §6.6):
--
--   * The source used a warehouse-local `warehouse.role_capabilities` +
--     `warehouse.has_cap(cap)`. That table/helper is NOT ported. Instead every
--     gate calls the core helpers, which read `core.user_roles` +
--     `core.role_capabilities` for auth.uid():
--       - WRITE policies  ->  core.has_cap('warehouse', <cap>)
--       - capability-scoped READ policies (suppliers/purchase_orders/lots) ->
--         core.has_any_cap(<cap>)  (mirrors the core RLS pattern for
--         cross-cutting reads; the warehouse caps live only in the warehouse
--         module so this resolves to the same set of users).
--   * The warehouse caps this file gates on are already seeded in
--     core.role_capabilities (module='warehouse') by 20260706091000_core_seed_rbac.sql.
--
-- Also performs the v4 + v6 WRITE LOCKDOWN: direct INSERT/UPDATE/DELETE on the
-- stock/audit/PO/lots tables is revoked from `authenticated` so those mutate
-- ONLY through the SECURITY DEFINER RPCs (20260706092400_warehouse_rpcs.sql).
--
-- Re-runnable: drop policy if exists before every create; idempotent revokes.

-- ---------------------------------------------------------------------------
-- Drop any legacy permissive policy left from a demo-era apply.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'locations','suppliers','products','profiles','events','lots','storage_areas',
    'inventory_units','stock_levels','allocations','movements','receipts',
    'returns','cycle_counts','purchase_orders'
  ]
  loop
    execute format('alter table warehouse.%I enable row level security;', t);
    execute format('drop policy if exists demo_all on warehouse.%I;', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- READ: any authenticated user loads the general warehouse read-model
-- (dashboards / analytics span roles). profiles is self-only; the cost /
-- procurement-sensitive tables (suppliers, purchase_orders, lots) are
-- capability-scoped below and intentionally EXCLUDED from this loop.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'locations','products','events','storage_areas',
    'inventory_units','stock_levels','allocations','movements','receipts',
    'returns','cycle_counts'
  ]
  loop
    execute format('drop policy if exists read_authenticated on warehouse.%I;', t);
    execute format('create policy read_authenticated on warehouse.%I for select to authenticated using (true);', t);
  end loop;
end $$;

drop policy if exists read_self on warehouse.profiles;
create policy read_self on warehouse.profiles
  for select to authenticated
  using (coalesce(auth.jwt() ->> 'email', '') = email);

-- Capability-scoped reads for cost / procurement-sensitive tables (v4).
drop policy if exists read_authenticated on warehouse.suppliers;
drop policy if exists read_suppliers on warehouse.suppliers;
create policy read_suppliers on warehouse.suppliers for select to authenticated
  using (
    core.has_any_cap('view_procurement')
    or core.has_any_cap('receive_stock')
    or core.has_any_cap('manage_products')
  );

drop policy if exists read_authenticated on warehouse.purchase_orders;
drop policy if exists read_purchase_orders on warehouse.purchase_orders;
create policy read_purchase_orders on warehouse.purchase_orders for select to authenticated
  using (core.has_any_cap('view_procurement') or core.has_any_cap('receive_stock'));

drop policy if exists read_authenticated on warehouse.lots;
drop policy if exists read_lots on warehouse.lots;
create policy read_lots on warehouse.lots for select to authenticated
  using (
    core.has_any_cap('view_procurement')
    or core.has_any_cap('view_finance')
    or core.has_any_cap('view_pricing')
    or core.has_any_cap('receive_stock')
  );

-- ---------------------------------------------------------------------------
-- WRITE policies for the tables that are still directly writable via PostgREST
-- (catalog + reference data). Keyed to the capability that governs the action.
-- Stock/audit/PO/lots are RPC-only (their direct-write policies are dropped and
-- privileges revoked below).
-- ---------------------------------------------------------------------------

-- products: catalog managed by manage_products. Price edits route through the
-- set_product_price() RPC (v4), so the UPDATE policy is manage_products-only.
drop policy if exists products_insert on warehouse.products;
drop policy if exists products_update on warehouse.products;
drop policy if exists products_delete on warehouse.products;
create policy products_insert on warehouse.products for insert to authenticated
  with check (core.has_cap('warehouse','manage_products'));
create policy products_update on warehouse.products for update to authenticated
  using (core.has_cap('warehouse','manage_products'))
  with check (core.has_cap('warehouse','manage_products'));
create policy products_delete on warehouse.products for delete to authenticated
  using (core.has_cap('warehouse','manage_products'));

-- suppliers: procurement maintains the projection (incl. core_vendor_id link).
drop policy if exists suppliers_write on warehouse.suppliers;
create policy suppliers_write on warehouse.suppliers for all to authenticated
  using (core.has_cap('warehouse','view_procurement'))
  with check (core.has_cap('warehouse','view_procurement'));

-- locations + storage_areas: logistics supervisor (manage_locations).
drop policy if exists locations_insert on warehouse.locations;
drop policy if exists locations_update on warehouse.locations;
drop policy if exists locations_delete on warehouse.locations;
create policy locations_insert on warehouse.locations for insert to authenticated
  with check (core.has_cap('warehouse','manage_locations'));
create policy locations_update on warehouse.locations for update to authenticated
  using (core.has_cap('warehouse','manage_locations'))
  with check (core.has_cap('warehouse','manage_locations'));
create policy locations_delete on warehouse.locations for delete to authenticated
  using (core.has_cap('warehouse','manage_locations'));

drop policy if exists storage_areas_insert on warehouse.storage_areas;
drop policy if exists storage_areas_update on warehouse.storage_areas;
drop policy if exists storage_areas_delete on warehouse.storage_areas;
create policy storage_areas_insert on warehouse.storage_areas for insert to authenticated
  with check (core.has_cap('warehouse','manage_locations'));
create policy storage_areas_update on warehouse.storage_areas for update to authenticated
  using (core.has_cap('warehouse','manage_locations'))
  with check (core.has_cap('warehouse','manage_locations'));
create policy storage_areas_delete on warehouse.storage_areas for delete to authenticated
  using (core.has_cap('warehouse','manage_locations'));

-- events: created from allocation planning or finance.
drop policy if exists events_insert on warehouse.events;
create policy events_insert on warehouse.events for insert to authenticated
  with check (core.has_cap('warehouse','reserve_allocate') or core.has_cap('warehouse','view_finance'));

-- ---------------------------------------------------------------------------
-- WRITE LOCKDOWN (v4 + v6): stock/audit/PO/lots mutate ONLY via the definer
-- RPCs. Drop any residual direct-write policies and revoke the privileges.
-- ---------------------------------------------------------------------------
drop policy if exists stock_insert on warehouse.stock_levels;
drop policy if exists stock_update on warehouse.stock_levels;
drop policy if exists units_insert on warehouse.inventory_units;
drop policy if exists units_update on warehouse.inventory_units;
drop policy if exists allocations_insert on warehouse.allocations;
drop policy if exists allocations_update on warehouse.allocations;
drop policy if exists allocations_delete on warehouse.allocations;
drop policy if exists movements_insert on warehouse.movements;
drop policy if exists receipts_insert on warehouse.receipts;
drop policy if exists returns_insert on warehouse.returns;
drop policy if exists cycle_counts_insert on warehouse.cycle_counts;
drop policy if exists purchase_orders_write on warehouse.purchase_orders;
drop policy if exists lots_insert on warehouse.lots;
drop policy if exists lots_update on warehouse.lots;
drop policy if exists lots_delete on warehouse.lots;

revoke insert, update, delete on
  warehouse.stock_levels,
  warehouse.inventory_units,
  warehouse.movements,
  warehouse.receipts,
  warehouse.returns,
  warehouse.cycle_counts,
  warehouse.allocations,
  warehouse.purchase_orders,
  warehouse.lots
from authenticated;

-- ---------------------------------------------------------------------------
-- Lock anon out of the warehouse schema entirely (login is real Supabase Auth).
-- ---------------------------------------------------------------------------
revoke all on all tables in schema warehouse from anon;
revoke usage on schema warehouse from anon;
alter default privileges in schema warehouse revoke all on tables from anon;

notify pgrst, 'reload schema';
