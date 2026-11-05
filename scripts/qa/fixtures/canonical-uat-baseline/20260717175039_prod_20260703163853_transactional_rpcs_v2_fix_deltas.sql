-- Fix: the stock_deltas inner SELECT referenced a non-existent `delta` column.
-- The temp row is a stock_levels rowtype whose quantity column carries the delta value.

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
    insert into warehouse.stock_levels (product_id, location_id, lot_id, quantity)
    select product_id, location_id, lot_id, greatest(0, quantity)
    from jsonb_populate_recordset(null::warehouse.stock_levels,
      (select jsonb_agg(jsonb_build_object('product_id', d->>'product_id','location_id', d->>'location_id','lot_id', nullif(d->'lot_id','null'),'quantity', (d->>'delta')::int)) from jsonb_array_elements(payload->'stock_deltas') d))
    on conflict (product_id, location_id, lot_id) do update set quantity = greatest(0, warehouse.stock_levels.quantity + excluded.quantity);
  end if;
  if coalesce(jsonb_array_length(payload->'movements'), 0) > 0 then
    insert into warehouse.movements select * from jsonb_populate_recordset(null::warehouse.movements, payload->'movements');
  end if;
  insert into warehouse.receipts select * from jsonb_populate_record(null::warehouse.receipts, payload->'receipt') returning * into v_receipt;
  return to_jsonb(v_receipt);
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
    insert into warehouse.stock_levels (product_id, location_id, lot_id, quantity) select product_id, location_id, lot_id, greatest(0, quantity) from jsonb_populate_recordset(null::warehouse.stock_levels, (select jsonb_agg(jsonb_build_object('product_id', d->>'product_id','location_id', d->>'location_id','lot_id', nullif(d->'lot_id','null'),'quantity', (d->>'delta')::int)) from jsonb_array_elements(payload->'stock_deltas') d)) on conflict (product_id, location_id, lot_id) do update set quantity = greatest(0, warehouse.stock_levels.quantity + excluded.quantity);
  end if;
  if coalesce(jsonb_array_length(payload->'movements'), 0) > 0 then insert into warehouse.movements select * from jsonb_populate_recordset(null::warehouse.movements, payload->'movements'); end if;
  insert into warehouse.returns select * from jsonb_populate_record(null::warehouse.returns, payload->'return') returning * into v_ret;
  return to_jsonb(v_ret);
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
  if coalesce(jsonb_array_length(payload->'stock_deltas'), 0) > 0 then insert into warehouse.stock_levels (product_id, location_id, lot_id, quantity) select product_id, location_id, lot_id, greatest(0, quantity) from jsonb_populate_recordset(null::warehouse.stock_levels, (select jsonb_agg(jsonb_build_object('product_id', d->>'product_id','location_id', d->>'location_id','lot_id', nullif(d->'lot_id','null'),'quantity', (d->>'delta')::int)) from jsonb_array_elements(payload->'stock_deltas') d)) on conflict (product_id, location_id, lot_id) do update set quantity = greatest(0, warehouse.stock_levels.quantity + excluded.quantity); end if;
  if coalesce(jsonb_array_length(payload->'movements'), 0) > 0 then insert into warehouse.movements select * from jsonb_populate_recordset(null::warehouse.movements, payload->'movements'); end if;
  update warehouse.purchase_orders set lines = v_lines, status = payload->>'po_status' where id = payload->>'po_id' returning * into v_po;
  return to_jsonb(v_po);
end; $$;

notify pgrst, 'reload schema';
