create or replace function warehouse.receive_stock(payload jsonb)
returns jsonb language plpgsql security invoker set search_path = warehouse, public as $$
declare v_receipt warehouse.receipts;
begin
  if coalesce(jsonb_array_length(payload->'lots'), 0) > 0 then
    insert into warehouse.lots select * from jsonb_populate_recordset(null::warehouse.lots, payload->'lots');
  end if;
  if coalesce(jsonb_array_length(payload->'units'), 0) > 0 then
    insert into warehouse.inventory_units select * from jsonb_populate_recordset(null::warehouse.inventory_units, payload->'units');
  end if;
  if coalesce(jsonb_array_length(payload->'stock_deltas'), 0) > 0 then
    insert into warehouse.stock_levels (product_id, location_id, bin_id, lot_id, quantity)
    select product_id, location_id, bin_id, lot_id, greatest(0, quantity)
    from jsonb_populate_recordset(null::warehouse.stock_levels, (select jsonb_agg(jsonb_build_object('product_id', d->>'product_id','location_id', d->>'location_id','bin_id', d->>'bin_id','lot_id', d->>'lot_id','quantity', (d->>'delta')::int)) from jsonb_array_elements(payload->'stock_deltas') d))
    on conflict (product_id, location_id, bin_id, lot_id) do update set quantity = greatest(0, warehouse.stock_levels.quantity + excluded.quantity);
  end if;
  if coalesce(jsonb_array_length(payload->'movements'), 0) > 0 then insert into warehouse.movements select * from jsonb_populate_recordset(null::warehouse.movements, payload->'movements'); end if;
  insert into warehouse.receipts select * from jsonb_populate_record(null::warehouse.receipts, payload->'receipt') returning * into v_receipt;
  return to_jsonb(v_receipt);
end; $$;

create or replace function warehouse.issue(payload jsonb)
returns jsonb language plpgsql security invoker set search_path = warehouse, public as $$
declare v_alloc warehouse.allocations; v_unit_ids text[]; v_expected int; v_updated int;
begin
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
    where s.product_id = payload->'stock_delta'->>'product_id' and s.location_id = payload->'stock_delta'->>'location_id' and s.bin_id is not distinct from (payload->'stock_delta'->>'bin_id');
  end if;
  insert into warehouse.movements select * from jsonb_populate_record(null::warehouse.movements, payload->'movement');
  return to_jsonb(v_alloc);
end; $$;

create or replace function warehouse.transfer(payload jsonb)
returns jsonb language plpgsql security invoker set search_path = warehouse, public as $$
declare v_mv warehouse.movements; v_unit_ids text[]; v_expected int; v_updated int;
begin
  if coalesce(jsonb_array_length(payload->'unit_ids'), 0) > 0 then
    v_unit_ids := array(select jsonb_array_elements_text(payload->'unit_ids'));
    v_expected := coalesce(array_length(v_unit_ids, 1), 0);
    update warehouse.inventory_units set location_id = payload->>'to_location_id', bin_id = payload->>'to_bin_id' where id = any(v_unit_ids) and status = 'in_stock' and location_id = payload->>'from_location_id';
    get diagnostics v_updated = row_count;
    if v_updated < v_expected then raise exception 'Some units were no longer in stock at the source (% of %)', v_updated, v_expected; end if;
  end if;
  if jsonb_typeof(payload->'from_stock_delta') = 'object' then
    update warehouse.stock_levels s set quantity = greatest(0, s.quantity + (payload->'from_stock_delta'->>'delta')::int)
    where s.product_id = payload->'from_stock_delta'->>'product_id' and s.location_id = payload->'from_stock_delta'->>'location_id' and s.bin_id is not distinct from (payload->'from_stock_delta'->>'bin_id');
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
returns jsonb language plpgsql security invoker set search_path = warehouse, public as $$
declare v_ret warehouse.returns; v_unit jsonb;
begin
  if coalesce(jsonb_array_length(payload->'unit_updates'), 0) > 0 then
    for v_unit in select * from jsonb_array_elements(payload->'unit_updates') loop
      update warehouse.inventory_units set status = v_unit->>'status', assigned_to = null where serial_number = v_unit->>'serial_number';
    end loop;
  end if;
  if coalesce(jsonb_array_length(payload->'stock_deltas'), 0) > 0 then
    insert into warehouse.stock_levels (product_id, location_id, bin_id, lot_id, quantity)
    select product_id, location_id, bin_id, lot_id, greatest(0, quantity)
    from jsonb_populate_recordset(null::warehouse.stock_levels, (select jsonb_agg(jsonb_build_object('product_id', d->>'product_id','location_id', d->>'location_id','bin_id', d->>'bin_id','lot_id', d->>'lot_id','quantity', (d->>'delta')::int)) from jsonb_array_elements(payload->'stock_deltas') d))
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
returns jsonb language plpgsql security invoker set search_path = warehouse, public as $$
declare v_cc warehouse.cycle_counts;
begin
  if coalesce(jsonb_array_length(payload->'stock_sets'), 0) > 0 then
    update warehouse.stock_levels s set quantity = v.quantity from jsonb_populate_recordset(null::warehouse.stock_levels, payload->'stock_sets') v where s.product_id = v.product_id and s.location_id = v.location_id and s.bin_id is not distinct from v.bin_id;
    insert into warehouse.stock_levels (product_id, location_id, bin_id, lot_id, quantity)
    select v.product_id, v.location_id, v.bin_id, null, v.quantity from jsonb_populate_recordset(null::warehouse.stock_levels, payload->'stock_sets') v
    where not exists (select 1 from warehouse.stock_levels s where s.product_id = v.product_id and s.location_id = v.location_id and s.bin_id is not distinct from v.bin_id and s.lot_id is null)
    on conflict (product_id, location_id, bin_id, lot_id) do update set quantity = excluded.quantity;
  end if;
  if coalesce(jsonb_array_length(payload->'movements'), 0) > 0 then insert into warehouse.movements select * from jsonb_populate_recordset(null::warehouse.movements, payload->'movements'); end if;
  insert into warehouse.cycle_counts select * from jsonb_populate_record(null::warehouse.cycle_counts, payload->'cycle_count') returning * into v_cc;
  return to_jsonb(v_cc);
end; $$;

create or replace function warehouse.receive_against_po(payload jsonb)
returns jsonb language plpgsql security invoker set search_path = warehouse, public as $$
declare v_po warehouse.purchase_orders; v_lines jsonb; v_line jsonb; v_pid text; v_qty int; v_idx int;
begin
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
    from jsonb_populate_recordset(null::warehouse.stock_levels, (select jsonb_agg(jsonb_build_object('product_id', d->>'product_id','location_id', d->>'location_id','bin_id', d->>'bin_id','lot_id', d->>'lot_id','quantity', (d->>'delta')::int)) from jsonb_array_elements(payload->'stock_deltas') d))
    on conflict (product_id, location_id, bin_id, lot_id) do update set quantity = greatest(0, warehouse.stock_levels.quantity + excluded.quantity);
  end if;
  if coalesce(jsonb_array_length(payload->'movements'), 0) > 0 then insert into warehouse.movements select * from jsonb_populate_recordset(null::warehouse.movements, payload->'movements'); end if;
  update warehouse.purchase_orders set lines = v_lines, status = payload->>'po_status' where id = payload->>'po_id' returning * into v_po;
  return to_jsonb(v_po);
end; $$;

create or replace function warehouse.adjust_stock(payload jsonb)
returns jsonb language plpgsql security invoker set search_path = warehouse, public as $$
declare v_mv warehouse.movements; v_unit_ids text[]; v_expected int; v_updated int;
begin
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

notify pgrst, 'reload schema';
