-- Mwell - Intra | Warehouse — receive-against-PO hardening + location guard v8

create or replace function warehouse.receive_against_po(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare
  v_po warehouse.purchase_orders;
  v_lines jsonb;
  v_line jsonb;
  v_pid text;
  v_qty int;
  v_idx int;
  v_ordered int;
  v_current int;
  v_total_ordered int;
  v_total_received int;
  v_status text;
begin
  if not warehouse.has_cap('receive_stock') then raise exception 'Not authorized: receive_stock'; end if;
  select * into v_po from warehouse.purchase_orders where id = payload->>'po_id';
  if v_po.id is null then raise exception 'Purchase order not found: %', payload->>'po_id'; end if;
  if v_po.status = 'cancelled' then raise exception 'Cannot receive against a cancelled purchase order.'; end if;
  v_lines := v_po.lines;

  for v_line in select * from jsonb_array_elements(payload->'line_deltas') loop
    v_pid := v_line->>'productId';
    v_qty := (v_line->>'quantityReceived')::int;
    if v_qty <= 0 then continue; end if;
    v_idx := null;
    select idx into v_idx
    from (select (row_number() over () - 1) as idx, line
          from jsonb_array_elements(v_lines) as t(line)) sub
    where line->>'productId' = v_pid
    limit 1;
    if v_idx is null then
      raise exception 'Received product % is not on purchase order %.', v_pid, v_po.id;
    end if;
    v_ordered := (v_lines->v_idx->>'quantityOrdered')::int;
    v_current := coalesce((v_lines->v_idx->>'quantityReceived')::int, 0);
    v_lines := jsonb_set(
      v_lines,
      array[v_idx::text, 'quantityReceived'],
      to_jsonb(least(v_ordered, v_current + v_qty))
    );
  end loop;

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

  select
    coalesce(sum((line->>'quantityOrdered')::int), 0),
    coalesce(sum((line->>'quantityReceived')::int), 0)
    into v_total_ordered, v_total_received
  from jsonb_array_elements(v_lines) as t(line);
  v_status := case
    when v_total_received <= 0 then 'ordered'
    when v_total_received >= v_total_ordered then 'received'
    else 'partially_received'
  end;

  update warehouse.purchase_orders
    set lines = v_lines, status = v_status
    where id = payload->>'po_id'
    returning * into v_po;
  return to_jsonb(v_po);
end; $$;
revoke all on function warehouse.receive_against_po(jsonb) from public, anon;
grant execute on function warehouse.receive_against_po(jsonb) to authenticated, service_role;

create or replace function warehouse.prevent_location_delete_with_stock()
returns trigger language plpgsql set search_path = warehouse, public as $$
begin
  if exists (select 1 from warehouse.stock_levels s where s.location_id = old.id and s.quantity > 0) then
    raise exception 'Cannot delete location % — it still holds stock. Transfer or write off its stock first.', old.id;
  end if;
  if exists (select 1 from warehouse.inventory_units u where u.location_id = old.id and u.status = 'in_stock') then
    raise exception 'Cannot delete location % — it still holds in-stock units. Transfer or write off its stock first.', old.id;
  end if;
  return old;
end; $$;

drop trigger if exists trg_prevent_location_delete_with_stock on warehouse.locations;
create trigger trg_prevent_location_delete_with_stock
  before delete on warehouse.locations
  for each row execute function warehouse.prevent_location_delete_with_stock();

notify pgrst, 'reload schema';

