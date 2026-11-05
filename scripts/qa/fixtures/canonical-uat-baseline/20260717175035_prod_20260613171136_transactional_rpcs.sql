-- Transactional mutation RPCs for the warehouse schema.

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
  if coalesce(jsonb_array_length(payload->'stock_levels'), 0) > 0 then
    insert into warehouse.stock_levels (product_id, location_id, lot_id, quantity)
    select product_id, location_id, lot_id, quantity from jsonb_populate_recordset(null::warehouse.stock_levels, payload->'stock_levels')
    on conflict (product_id, location_id, lot_id) do update set quantity = excluded.quantity;
  end if;
  if coalesce(jsonb_array_length(payload->'movements'), 0) > 0 then
    insert into warehouse.movements select * from jsonb_populate_recordset(null::warehouse.movements, payload->'movements');
  end if;
  insert into warehouse.receipts select * from jsonb_populate_record(null::warehouse.receipts, payload->'receipt') returning * into v_receipt;
  return to_jsonb(v_receipt);
end; $$;

create or replace function warehouse.issue(payload jsonb)
returns jsonb language plpgsql security invoker set search_path = warehouse, public as $$
declare v_alloc warehouse.allocations; v_unit_ids text[];
begin
  if coalesce(jsonb_array_length(payload->'unit_ids'), 0) > 0 then
    v_unit_ids := array(select jsonb_array_elements_text(payload->'unit_ids'));
    update warehouse.inventory_units set status = 'issued', assigned_to = payload->>'assigned_to', event_id = payload->>'event_id' where id = any(v_unit_ids);
  end if;
  if jsonb_typeof(payload->'stock_level') = 'object' then
    update warehouse.stock_levels s set quantity = (payload->'stock_level'->>'quantity')::int
    where s.product_id = payload->'stock_level'->>'product_id' and s.location_id = payload->'stock_level'->>'location_id';
  end if;
  update warehouse.allocations set status = 'issued' where id = payload->>'allocation_id' returning * into v_alloc;
  if v_alloc.id is null then raise exception 'Allocation not found: %', payload->>'allocation_id'; end if;
  insert into warehouse.movements select * from jsonb_populate_record(null::warehouse.movements, payload->'movement');
  return to_jsonb(v_alloc);
end; $$;

create or replace function warehouse.transfer(payload jsonb)
returns jsonb language plpgsql security invoker set search_path = warehouse, public as $$
declare v_mv warehouse.movements; v_unit_ids text[];
begin
  if coalesce(jsonb_array_length(payload->'unit_ids'), 0) > 0 then
    v_unit_ids := array(select jsonb_array_elements_text(payload->'unit_ids'));
    update warehouse.inventory_units set location_id = payload->>'to_location_id' where id = any(v_unit_ids);
  end if;
  if jsonb_typeof(payload->'from_stock_level') = 'object' then
    update warehouse.stock_levels s set quantity = (payload->'from_stock_level'->>'quantity')::int
    where s.product_id = payload->'from_stock_level'->>'product_id' and s.location_id = payload->'from_stock_level'->>'location_id';
  end if;
  if jsonb_typeof(payload->'to_stock_level') = 'object' then
    insert into warehouse.stock_levels (product_id, location_id, lot_id, quantity)
    select product_id, location_id, lot_id, quantity from jsonb_populate_record(null::warehouse.stock_levels, payload->'to_stock_level')
    on conflict (product_id, location_id, lot_id) do update set quantity = excluded.quantity;
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
  if coalesce(jsonb_array_length(payload->'stock_upserts'), 0) > 0 then
    insert into warehouse.stock_levels (product_id, location_id, lot_id, quantity)
    select product_id, location_id, lot_id, quantity from jsonb_populate_recordset(null::warehouse.stock_levels, payload->'stock_upserts')
    on conflict (product_id, location_id, lot_id) do update set quantity = excluded.quantity;
  end if;
  if coalesce(jsonb_array_length(payload->'movements'), 0) > 0 then
    insert into warehouse.movements select * from jsonb_populate_recordset(null::warehouse.movements, payload->'movements');
  end if;
  insert into warehouse.returns select * from jsonb_populate_record(null::warehouse.returns, payload->'return') returning * into v_ret;
  return to_jsonb(v_ret);
end; $$;

create or replace function warehouse.record_cycle_count(payload jsonb)
returns jsonb language plpgsql security invoker set search_path = warehouse, public as $$
declare v_cc warehouse.cycle_counts;
begin
  if coalesce(jsonb_array_length(payload->'stock_updates'), 0) > 0 then
    update warehouse.stock_levels s set quantity = v.quantity
    from jsonb_populate_recordset(null::warehouse.stock_levels, payload->'stock_updates') v
    where s.product_id = v.product_id and s.location_id = v.location_id;
  end if;
  if coalesce(jsonb_array_length(payload->'movements'), 0) > 0 then
    insert into warehouse.movements select * from jsonb_populate_recordset(null::warehouse.movements, payload->'movements');
  end if;
  insert into warehouse.cycle_counts select * from jsonb_populate_record(null::warehouse.cycle_counts, payload->'cycle_count') returning * into v_cc;
  return to_jsonb(v_cc);
end; $$;

create or replace function warehouse.receive_against_po(payload jsonb)
returns jsonb language plpgsql security invoker set search_path = warehouse, public as $$
declare v_po warehouse.purchase_orders;
begin
  if coalesce(jsonb_array_length(payload->'units'), 0) > 0 then
    insert into warehouse.inventory_units select * from jsonb_populate_recordset(null::warehouse.inventory_units, payload->'units');
  end if;
  if coalesce(jsonb_array_length(payload->'stock_upserts'), 0) > 0 then
    insert into warehouse.stock_levels (product_id, location_id, lot_id, quantity)
    select product_id, location_id, lot_id, quantity from jsonb_populate_recordset(null::warehouse.stock_levels, payload->'stock_upserts')
    on conflict (product_id, location_id, lot_id) do update set quantity = excluded.quantity;
  end if;
  if coalesce(jsonb_array_length(payload->'movements'), 0) > 0 then
    insert into warehouse.movements select * from jsonb_populate_recordset(null::warehouse.movements, payload->'movements');
  end if;
  update warehouse.purchase_orders set status = payload->>'po_status', lines = payload->'po_lines' where id = payload->>'po_id' returning * into v_po;
  if v_po.id is null then raise exception 'Purchase order not found: %', payload->>'po_id'; end if;
  return to_jsonb(v_po);
end; $$;

create or replace function warehouse.adjust_stock(payload jsonb)
returns jsonb language plpgsql security invoker set search_path = warehouse, public as $$
declare v_mv warehouse.movements; v_unit_ids text[];
begin
  if coalesce(jsonb_array_length(payload->'unit_ids'), 0) > 0 then
    v_unit_ids := array(select jsonb_array_elements_text(payload->'unit_ids'));
    update warehouse.inventory_units set status = 'lost', assigned_to = null where id = any(v_unit_ids);
  end if;
  if jsonb_typeof(payload->'stock_level') = 'object' then
    insert into warehouse.stock_levels (product_id, location_id, lot_id, quantity)
    select product_id, location_id, lot_id, quantity from jsonb_populate_record(null::warehouse.stock_levels, payload->'stock_level')
    on conflict (product_id, location_id, lot_id) do update set quantity = excluded.quantity;
  end if;
  insert into warehouse.movements select * from jsonb_populate_record(null::warehouse.movements, payload->'movement') returning * into v_mv;
  return to_jsonb(v_mv);
end; $$;

do $$ declare fn text; begin
  foreach fn in array array['receive_stock','issue','transfer','record_return','record_cycle_count','receive_against_po','adjust_stock'] loop
    execute format('revoke all on function warehouse.%I(jsonb) from public, anon;', fn);
    execute format('grant execute on function warehouse.%I(jsonb) to authenticated, service_role;', fn);
  end loop;
end $$;

notify pgrst, 'reload config';

