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
  if jsonb_typeof(payload->'allocation_id') = 'string' then
    update warehouse.allocations set status = 'returned' where id = payload->>'allocation_id' and status = 'issued';
  end if;
  insert into warehouse.returns select * from jsonb_populate_record(null::warehouse.returns, payload->'return') returning * into v_ret;
  return to_jsonb(v_ret);
end; $$;

notify pgrst, 'reload schema';
