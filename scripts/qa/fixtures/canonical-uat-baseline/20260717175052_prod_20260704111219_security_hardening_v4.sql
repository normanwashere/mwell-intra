-- security hardening v4
create or replace function warehouse.available_to_promise(p_product_id text)
returns integer
language sql
stable
security definer
set search_path = warehouse, public
as $$
  select greatest(
    0,
    (
      coalesce((select sum(quantity) from warehouse.stock_levels
                 where product_id = p_product_id), 0)
      + coalesce((select count(*) from warehouse.inventory_units
                   where product_id = p_product_id and status = 'in_stock'), 0)
    )
    - coalesce(
        (select sum(quantity) from warehouse.allocations
          where product_id = p_product_id
            and status in ('reserved','allocated')),
        0
      )
  );
$$;
revoke all on function warehouse.available_to_promise(text) from public, anon;
grant execute on function warehouse.available_to_promise(text) to authenticated, service_role;

create or replace function warehouse.receive_stock(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_receipt warehouse.receipts;
begin
  if not warehouse.has_cap('receive_stock') then raise exception 'Not authorized: receive_stock'; end if;
  if coalesce(jsonb_array_length(payload->'lots'), 0) > 0 then
    insert into warehouse.lots select * from jsonb_populate_recordset(null::warehouse.lots, payload->'lots');
  end if;
  if coalesce(jsonb_array_length(payload->'units'), 0) > 0 then
    insert into warehouse.inventory_units select * from jsonb_populate_recordset(null::warehouse.inventory_units, payload->'units');
  end if;
  if coalesce(jsonb_array_length(payload->'stock_deltas'), 0) > 0 then
    insert into warehouse.stock_levels (product_id, location_id, bin_id, lot_id, quantity)
    select product_id, location_id, bin_id, lot_id, greatest(0, quantity)
    from jsonb_populate_recordset(null::warehouse.stock_levels,
      (select jsonb_agg(jsonb_build_object('product_id', d->>'product_id','location_id', d->>'location_id','bin_id', d->>'bin_id','lot_id', d->>'lot_id','quantity', (d->>'delta')::int)) from jsonb_array_elements(payload->'stock_deltas') d))
    on conflict (product_id, location_id, bin_id, lot_id) do update set quantity = greatest(0, warehouse.stock_levels.quantity + excluded.quantity);
  end if;
  if coalesce(jsonb_array_length(payload->'movements'), 0) > 0 then
    insert into warehouse.movements select * from jsonb_populate_recordset(null::warehouse.movements, payload->'movements');
  end if;
  insert into warehouse.receipts select * from jsonb_populate_record(null::warehouse.receipts, payload->'receipt') returning * into v_receipt;
  return to_jsonb(v_receipt);
end; $$;

create or replace function warehouse.issue(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_alloc warehouse.allocations; v_unit_ids text[]; v_expected int; v_updated int;
begin
  if not warehouse.has_cap('issue_items') then raise exception 'Not authorized: issue_items'; end if;
  update warehouse.allocations set status = 'issued' where id = payload->>'allocation_id' and status = 'reserved' returning * into v_alloc;
  if v_alloc.id is null then raise exception 'Allocation not found or not reservable: %', payload->>'allocation_id'; end if;
  if coalesce(jsonb_array_length(payload->'unit_ids'), 0) > 0 then
    v_unit_ids := array(select jsonb_array_elements_text(payload->'unit_ids'));
    v_expected := coalesce(array_length(v_unit_ids, 1), 0);
    update warehouse.inventory_units set status = 'issued', assigned_to = payload->>'assigned_to', event_id = payload->>'event_id' where id = any(v_unit_ids) and status = 'in_stock';
    get diagnostics v_updated = row_count;
    if v_updated < v_expected then raise exception 'Some serialized units were no longer in stock (% of %)', v_updated, v_expected; end if;
  end if;
  if jsonb_typeof(payload->'stock_delta') = 'object' then
    update warehouse.stock_levels s set quantity = greatest(0, s.quantity + (payload->'stock_delta'->>'delta')::int)
    where s.product_id = payload->'stock_delta'->>'product_id' and s.location_id = payload->'stock_delta'->>'location_id'
      and s.bin_id is not distinct from (payload->'stock_delta'->>'bin_id');
  end if;
  insert into warehouse.movements select * from jsonb_populate_record(null::warehouse.movements, payload->'movement');
  return to_jsonb(v_alloc);
end; $$;

create or replace function warehouse.transfer(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_mv warehouse.movements; v_unit_ids text[]; v_expected int; v_updated int;
begin
  if not warehouse.has_cap('transfer_stock') then raise exception 'Not authorized: transfer_stock'; end if;
  if coalesce(jsonb_array_length(payload->'unit_ids'), 0) > 0 then
    v_unit_ids := array(select jsonb_array_elements_text(payload->'unit_ids'));
    v_expected := coalesce(array_length(v_unit_ids, 1), 0);
    update warehouse.inventory_units
    set location_id = payload->>'to_location_id', bin_id = payload->>'to_bin_id'
    where id = any(v_unit_ids) and status = 'in_stock' and location_id = payload->>'from_location_id';
    get diagnostics v_updated = row_count;
    if v_updated < v_expected then raise exception 'Some units were no longer in stock at the source (% of %)', v_updated, v_expected; end if;
  end if;
  if jsonb_typeof(payload->'from_stock_delta') = 'object' then
    update warehouse.stock_levels s set quantity = greatest(0, s.quantity + (payload->'from_stock_delta'->>'delta')::int)
    where s.product_id = payload->'from_stock_delta'->>'product_id' and s.location_id = payload->'from_stock_delta'->>'location_id'
      and s.bin_id is not distinct from (payload->'from_stock_delta'->>'bin_id');
  end if;
  if jsonb_typeof(payload->'to_stock_delta') = 'object' then
    insert into warehouse.stock_levels (product_id, location_id, bin_id, lot_id, quantity)
    values (payload->'to_stock_delta'->>'product_id', payload->'to_stock_delta'->>'location_id', payload->'to_stock_delta'->>'bin_id', null, greatest(0, (payload->'to_stock_delta'->>'delta')::int))
    on conflict (product_id, location_id, bin_id, lot_id) do update set quantity = greatest(0, warehouse.stock_levels.quantity + excluded.quantity);
  end if;
  insert into warehouse.movements select * from jsonb_populate_record(null::warehouse.movements, payload->'movement') returning * into v_mv;
  return to_jsonb(v_mv);
end; $$;

create or replace function warehouse.record_return(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_ret warehouse.returns; v_unit jsonb;
begin
  if not warehouse.has_cap('manage_returns') then raise exception 'Not authorized: manage_returns'; end if;
  if coalesce(jsonb_array_length(payload->'unit_updates'), 0) > 0 then
    for v_unit in select * from jsonb_array_elements(payload->'unit_updates') loop
      update warehouse.inventory_units set status = v_unit->>'status', assigned_to = null where serial_number = v_unit->>'serial_number';
    end loop;
  end if;
  if coalesce(jsonb_array_length(payload->'stock_deltas'), 0) > 0 then
    insert into warehouse.stock_levels (product_id, location_id, bin_id, lot_id, quantity)
    select product_id, location_id, bin_id, lot_id, greatest(0, quantity)
    from jsonb_populate_recordset(null::warehouse.stock_levels,
      (select jsonb_agg(jsonb_build_object('product_id', d->>'product_id','location_id', d->>'location_id','bin_id', d->>'bin_id','lot_id', d->>'lot_id','quantity', (d->>'delta')::int)) from jsonb_array_elements(payload->'stock_deltas') d))
    on conflict (product_id, location_id, bin_id, lot_id) do update set quantity = greatest(0, warehouse.stock_levels.quantity + excluded.quantity);
  end if;
  if coalesce(jsonb_array_length(payload->'movements'), 0) > 0 then insert into warehouse.movements select * from jsonb_populate_recordset(null::warehouse.movements, payload->'movements'); end if;
  if jsonb_typeof(payload->'allocation_id') = 'string' then
    update warehouse.allocations set status = 'returned' where id = payload->>'allocation_id' and status = 'issued';
  end if;
  insert into warehouse.returns select * from jsonb_populate_record(null::warehouse.returns, payload->'return') returning * into v_ret;
  return to_jsonb(v_ret);
end; $$;

create or replace function warehouse.record_cycle_count(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_cc warehouse.cycle_counts;
begin
  if not warehouse.has_cap('cycle_count') then raise exception 'Not authorized: cycle_count'; end if;
  if coalesce(jsonb_array_length(payload->'stock_sets'), 0) > 0 then
    update warehouse.stock_levels s set quantity = v.quantity
    from jsonb_populate_recordset(null::warehouse.stock_levels, payload->'stock_sets') v
    where s.product_id = v.product_id and s.location_id = v.location_id and s.bin_id is not distinct from v.bin_id;
    insert into warehouse.stock_levels (product_id, location_id, bin_id, lot_id, quantity)
    select v.product_id, v.location_id, v.bin_id, null, v.quantity
    from jsonb_populate_recordset(null::warehouse.stock_levels, payload->'stock_sets') v
    where not exists (
      select 1 from warehouse.stock_levels s
      where s.product_id = v.product_id and s.location_id = v.location_id and s.bin_id is not distinct from v.bin_id and s.lot_id is null
    )
    on conflict (product_id, location_id, bin_id, lot_id) do update set quantity = excluded.quantity;
  end if;
  if coalesce(jsonb_array_length(payload->'movements'), 0) > 0 then insert into warehouse.movements select * from jsonb_populate_recordset(null::warehouse.movements, payload->'movements'); end if;
  insert into warehouse.cycle_counts select * from jsonb_populate_record(null::warehouse.cycle_counts, payload->'cycle_count') returning * into v_cc;
  return to_jsonb(v_cc);
end; $$;

create or replace function warehouse.receive_against_po(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_po warehouse.purchase_orders; v_lines jsonb; v_line jsonb; v_pid text; v_qty int; v_idx int;
begin
  if not warehouse.has_cap('receive_stock') then raise exception 'Not authorized: receive_stock'; end if;
  select * into v_po from warehouse.purchase_orders where id = payload->>'po_id';
  if v_po.id is null then raise exception 'Purchase order not found: %', payload->>'po_id'; end if;
  v_lines := v_po.lines;
  for v_line in select * from jsonb_array_elements(payload->'line_deltas') loop
    v_pid := v_line->>'productId'; v_qty := (v_line->>'quantityReceived')::int;
    if v_qty <= 0 then continue; end if;
    v_idx := null;
    select idx into v_idx from (select (row_number() over () - 1) as idx, line from jsonb_array_elements(v_lines) as t(line)) sub where line->>'productId' = v_pid limit 1;
    if v_idx is not null then v_lines := jsonb_set(v_lines, array[v_idx::text, 'quantityReceived'], to_jsonb((v_lines->v_idx->>'quantityReceived')::int + v_qty)); end if;
  end loop;
  if coalesce(jsonb_array_length(payload->'units'), 0) > 0 then insert into warehouse.inventory_units select * from jsonb_populate_recordset(null::warehouse.inventory_units, payload->'units'); end if;
  if coalesce(jsonb_array_length(payload->'stock_deltas'), 0) > 0 then
    insert into warehouse.stock_levels (product_id, location_id, bin_id, lot_id, quantity)
    select product_id, location_id, bin_id, lot_id, greatest(0, quantity)
    from jsonb_populate_recordset(null::warehouse.stock_levels,
      (select jsonb_agg(jsonb_build_object('product_id', d->>'product_id','location_id', d->>'location_id','bin_id', d->>'bin_id','lot_id', d->>'lot_id','quantity', (d->>'delta')::int)) from jsonb_array_elements(payload->'stock_deltas') d))
    on conflict (product_id, location_id, bin_id, lot_id) do update set quantity = greatest(0, warehouse.stock_levels.quantity + excluded.quantity);
  end if;
  if coalesce(jsonb_array_length(payload->'movements'), 0) > 0 then insert into warehouse.movements select * from jsonb_populate_recordset(null::warehouse.movements, payload->'movements'); end if;
  update warehouse.purchase_orders set lines = v_lines, status = payload->>'po_status' where id = payload->>'po_id' returning * into v_po;
  return to_jsonb(v_po);
end; $$;

create or replace function warehouse.adjust_stock(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_mv warehouse.movements; v_unit_ids text[]; v_expected int; v_updated int;
begin
  if not warehouse.has_cap('manage_inventory') then raise exception 'Not authorized: manage_inventory'; end if;
  if coalesce(jsonb_array_length(payload->'unit_ids'), 0) > 0 then
    v_unit_ids := array(select jsonb_array_elements_text(payload->'unit_ids'));
    v_expected := coalesce(array_length(v_unit_ids, 1), 0);
    update warehouse.inventory_units set status = 'lost', assigned_to = null where id = any(v_unit_ids) and status = 'in_stock';
    get diagnostics v_updated = row_count;
    if v_updated < v_expected then raise exception 'Some units were no longer in stock (% of %)', v_updated, v_expected; end if;
  end if;
  if jsonb_typeof(payload->'stock_delta') = 'object' then
    insert into warehouse.stock_levels (product_id, location_id, bin_id, lot_id, quantity)
    values (payload->'stock_delta'->>'product_id', payload->'stock_delta'->>'location_id', payload->'stock_delta'->>'bin_id', null, greatest(0, (payload->'stock_delta'->>'delta')::int))
    on conflict (product_id, location_id, bin_id, lot_id) do update set quantity = greatest(0, warehouse.stock_levels.quantity + excluded.quantity);
  end if;
  insert into warehouse.movements select * from jsonb_populate_record(null::warehouse.movements, payload->'movement') returning * into v_mv;
  return to_jsonb(v_mv);
end; $$;

create or replace function warehouse.reserve(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_alloc warehouse.allocations; v_atp int;
begin
  if not warehouse.has_cap('reserve_allocate') then raise exception 'Not authorized: reserve_allocate'; end if;
  v_atp := warehouse.available_to_promise(payload->>'product_id');
  if (payload->>'quantity')::int <= 0 then raise exception 'Quantity must be greater than zero.'; end if;
  if (payload->>'quantity')::int > v_atp then raise exception 'Cannot reserve % — only % available.', payload->>'quantity', v_atp; end if;
  insert into warehouse.allocations select * from jsonb_populate_record(null::warehouse.allocations, payload->'allocation') returning * into v_alloc;
  return to_jsonb(v_alloc);
end; $$;

create or replace function warehouse.cancel_allocation(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_alloc warehouse.allocations;
begin
  if not warehouse.has_cap('reserve_allocate') then raise exception 'Not authorized: reserve_allocate'; end if;
  update warehouse.allocations set status = 'cancelled'
  where id = payload->>'allocation_id' and status <> 'issued'
  returning * into v_alloc;
  if v_alloc.id is null then raise exception 'Allocation not found or already issued.'; end if;
  return to_jsonb(v_alloc);
end; $$;

create or replace function warehouse.set_product_price(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_prod warehouse.products;
begin
  if not (warehouse.has_cap('set_pricing') or warehouse.has_cap('manage_products')) then
    raise exception 'Not authorized: set_pricing';
  end if;
  if (payload->>'price')::numeric < 0 then raise exception 'Price must be zero or more.'; end if;
  update warehouse.products set price = (payload->>'price')::numeric
  where id = payload->>'product_id' returning * into v_prod;
  if v_prod.id is null then raise exception 'Product not found.'; end if;
  return to_jsonb(v_prod);
end; $$;

create or replace function warehouse.delete_storage_area(payload jsonb)
returns void language plpgsql security definer set search_path = warehouse, public as $$
begin
  if not warehouse.has_cap('manage_locations') then raise exception 'Not authorized: manage_locations'; end if;
  delete from warehouse.storage_areas where id = payload->>'storage_area_id';
end; $$;

do $$ declare fn text;
begin
  foreach fn in array array[
    'receive_stock','issue','transfer','record_return','record_cycle_count',
    'receive_against_po','adjust_stock','reserve','cancel_allocation',
    'set_product_price','delete_storage_area'
  ]
  loop
    execute format('revoke all on function warehouse.%I(jsonb) from public, anon;', fn);
    execute format('grant execute on function warehouse.%I(jsonb) to authenticated, service_role;', fn);
  end loop;
end $$;

revoke insert, update, delete on
  warehouse.stock_levels,
  warehouse.inventory_units,
  warehouse.movements,
  warehouse.receipts,
  warehouse.returns,
  warehouse.cycle_counts,
  warehouse.allocations
from authenticated;

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

drop policy if exists products_update on warehouse.products;
create policy products_update on warehouse.products for update to authenticated
  using (warehouse.has_cap('manage_products'))
  with check (warehouse.has_cap('manage_products'));

drop policy if exists read_authenticated on warehouse.suppliers;
create policy read_suppliers on warehouse.suppliers for select to authenticated
  using (
    warehouse.has_cap('view_procurement')
    or warehouse.has_cap('receive_stock')
    or warehouse.has_cap('manage_products')
  );

drop policy if exists read_authenticated on warehouse.purchase_orders;
create policy read_purchase_orders on warehouse.purchase_orders for select to authenticated
  using (warehouse.has_cap('view_procurement') or warehouse.has_cap('receive_stock'));

drop policy if exists read_authenticated on warehouse.lots;
create policy read_lots on warehouse.lots for select to authenticated
  using (
    warehouse.has_cap('view_procurement')
    or warehouse.has_cap('view_finance')
    or warehouse.has_cap('view_pricing')
    or warehouse.has_cap('receive_stock')
  );

drop policy if exists evidence_auth_read on storage.objects;
create policy evidence_auth_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'evidence'
    and (owner = auth.uid() or warehouse.has_cap('view_finance'))
  );

update warehouse.inventory_units set bin_id = null
 where bin_id is not null and bin_id not in (select id from warehouse.storage_areas);
update warehouse.stock_levels set bin_id = null
 where bin_id is not null and bin_id not in (select id from warehouse.storage_areas);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_units_bin_fk') then
    alter table warehouse.inventory_units
      add constraint inventory_units_bin_fk foreign key (bin_id)
      references warehouse.storage_areas(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_levels_bin_fk') then
    alter table warehouse.stock_levels
      add constraint stock_levels_bin_fk foreign key (bin_id)
      references warehouse.storage_areas(id) on delete set null;
  end if;
end $$;

notify pgrst, 'reload schema';
