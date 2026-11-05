-- Replace the permissive demo_all policies with role/capability-aware RLS.
-- All policies target `authenticated`; anon loses access entirely (login no
-- longer reads the DB). service_role keeps its built-in RLS bypass for recovery
-- and seeding. Runs as one transaction so it is atomic / re-runnable.

-- Drop the old open policy everywhere.
do $$
declare t text;
begin
  foreach t in array array[
    'locations','suppliers','products','profiles','events','lots',
    'inventory_units','stock_levels','allocations','movements','receipts',
    'returns','cycle_counts','purchase_orders'
  ]
  loop
    execute format('alter table warehouse.%I enable row level security;', t);
    execute format('drop policy if exists demo_all on warehouse.%I;', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- READ: every authenticated user loads the warehouse read-model (dashboards /
-- analytics span roles). profiles is the exception: a user sees only their own.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'locations','suppliers','products','events','lots',
    'inventory_units','stock_levels','allocations','movements','receipts',
    'returns','cycle_counts','purchase_orders'
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

-- ---------------------------------------------------------------------------
-- WRITE: keyed to the capability that governs the action in the app.
-- ---------------------------------------------------------------------------

-- products: catalog managed by manage_products; price edits also allowed for
-- set_pricing. (Column-scoping of price-only is enforced in the app UI.)
create policy products_insert on warehouse.products for insert to authenticated
  with check (warehouse.has_cap('manage_products'));
create policy products_update on warehouse.products for update to authenticated
  using (warehouse.has_cap('manage_products') or warehouse.has_cap('set_pricing'))
  with check (warehouse.has_cap('manage_products') or warehouse.has_cap('set_pricing'));
create policy products_delete on warehouse.products for delete to authenticated
  using (warehouse.has_cap('manage_products'));

-- suppliers + purchase_orders: procurement.
create policy suppliers_write on warehouse.suppliers for all to authenticated
  using (warehouse.has_cap('view_procurement'))
  with check (warehouse.has_cap('view_procurement'));
create policy purchase_orders_write on warehouse.purchase_orders for all to authenticated
  using (warehouse.has_cap('view_procurement'))
  with check (warehouse.has_cap('view_procurement'));

-- lots: created by procurement planning and by receiving.
create policy lots_insert on warehouse.lots for insert to authenticated
  with check (warehouse.has_cap('view_procurement') or warehouse.has_cap('receive_stock'));
create policy lots_update on warehouse.lots for update to authenticated
  using (warehouse.has_cap('view_procurement'))
  with check (warehouse.has_cap('view_procurement'));
create policy lots_delete on warehouse.lots for delete to authenticated
  using (warehouse.has_cap('view_procurement'));

-- inventory_units: created only via receiving; mutated by inventory actions.
create policy units_insert on warehouse.inventory_units for insert to authenticated
  with check (warehouse.has_cap('receive_stock'));
create policy units_update on warehouse.inventory_units for update to authenticated
  using (warehouse.has_cap('manage_inventory'))
  with check (warehouse.has_cap('manage_inventory'));

-- stock_levels: touched by every quantity-moving action (all roles hold
-- manage_inventory); still capability-gated, never anon.
create policy stock_insert on warehouse.stock_levels for insert to authenticated
  with check (warehouse.has_cap('manage_inventory'));
create policy stock_update on warehouse.stock_levels for update to authenticated
  using (warehouse.has_cap('manage_inventory'))
  with check (warehouse.has_cap('manage_inventory'));

-- allocations: reserve creates; issue/cancel update.
create policy allocations_insert on warehouse.allocations for insert to authenticated
  with check (warehouse.has_cap('reserve_allocate'));
create policy allocations_update on warehouse.allocations for update to authenticated
  using (warehouse.has_cap('issue_items') or warehouse.has_cap('reserve_allocate'))
  with check (warehouse.has_cap('issue_items') or warehouse.has_cap('reserve_allocate'));
create policy allocations_delete on warehouse.allocations for delete to authenticated
  using (warehouse.has_cap('reserve_allocate'));

-- events: created from allocation planning or finance.
create policy events_insert on warehouse.events for insert to authenticated
  with check (warehouse.has_cap('reserve_allocate') or warehouse.has_cap('view_finance'));

-- Append-only audit / document logs: insert keyed to the originating capability,
-- no update/delete (immutable).
create policy movements_insert on warehouse.movements for insert to authenticated
  with check (warehouse.has_cap('manage_inventory'));
create policy receipts_insert on warehouse.receipts for insert to authenticated
  with check (warehouse.has_cap('receive_stock'));
create policy returns_insert on warehouse.returns for insert to authenticated
  with check (warehouse.has_cap('manage_returns'));
create policy cycle_counts_insert on warehouse.cycle_counts for insert to authenticated
  with check (warehouse.has_cap('cycle_count'));

-- ---------------------------------------------------------------------------
-- Lock anon out of the warehouse schema entirely.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema warehouse from anon;
revoke usage on schema warehouse from anon;
alter default privileges in schema warehouse revoke all on tables from anon;

notify pgrst, 'reload config';
