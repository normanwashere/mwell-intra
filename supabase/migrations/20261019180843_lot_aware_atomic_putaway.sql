-- Keep the public live-capability and offline-intent wrappers in place.
begin;
alter function private.warehouse_transfer(jsonb) rename to warehouse_transfer_pre_lot_putaway;
revoke all on function private.warehouse_transfer_pre_lot_putaway(jsonb) from public,anon,authenticated;

create function private.warehouse_transfer(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
<<relocation>>
declare
  command jsonb := payload->'command_input';
  product_id text;
  location_id text;
  from_bin text;
  to_bin text;
  requested integer;
  remaining integer;
  available integer;
  held integer;
  take integer;
  source warehouse.stock_levels;
  allocation jsonb;
  plan jsonb := '[]'::jsonb;
  result jsonb := '[]'::jsonb;
  movement jsonb;
begin
  if payload->'bulk_relocation' is distinct from 'true'::jsonb then
    return private.warehouse_transfer_pre_lot_putaway(payload);
  end if;
  if not coalesce(core.has_live_cap('warehouse','transfer_stock'),false)
     or not coalesce(core.has_cap('warehouse','transfer_stock'),false) then
    raise exception 'Not authorized: warehouse.transfer_stock';
  end if;
  if jsonb_typeof(command) is distinct from 'object'
     or jsonb_typeof(command->'quantity') is distinct from 'number'
     or (command->>'quantity') !~ '^[1-9][0-9]*$'
     or (command->>'quantity')::numeric > 2147483647 then
    raise exception 'Enter a whole-number quantity greater than zero.';
  end if;
  product_id := nullif(command->>'productId','');
  location_id := nullif(command->>'locationId','');
  from_bin := nullif(command->>'fromBinId','');
  to_bin := nullif(command->>'toBinId','');
  requested := (command->>'quantity')::integer;
  if from_bin is not distinct from to_bin then
    raise exception 'Choose a destination different from the current storage area.';
  end if;
  perform private.lock_warehouse_products(array[product_id]);
  perform 1 from warehouse.products p where p.id=relocation.product_id and p.serialized=false for share;
  if not found then raise exception 'Choose a quantity-tracked product for this move. Scan individual serial numbers for serialized items.'; end if;
  perform 1 from warehouse.locations l where l.id=relocation.location_id and l.type='warehouse' for share;
  if not found then raise exception 'Choose a valid warehouse before moving stock.'; end if;
  if from_bin is not null then
    perform 1 from warehouse.storage_areas b where b.id=from_bin and b.location_id=relocation.location_id and b.active for share;
    if not found then raise exception 'The source bin is not active in this warehouse. Refresh and select its current location.'; end if;
  end if;
  if to_bin is not null then
    perform 1 from warehouse.storage_areas b where b.id=to_bin and b.location_id=relocation.location_id and b.active for share;
    if not found then raise exception 'Choose an active destination bin in the same warehouse.'; end if;
  end if;

  -- Plan under the same product lock used by hold creation, then mutate exact lots.
  remaining := requested;
  for source in
    select s.* from warehouse.stock_levels s
     where s.product_id=relocation.product_id and s.location_id=relocation.location_id
       and s.bin_id is not distinct from from_bin and s.quantity>0
     order by s.lot_id nulls first for update
  loop
    select coalesce(sum(h.quantity),0)::integer into held
      from warehouse.inventory_holds h
     where h.product_id=relocation.product_id and h.location_id=relocation.location_id
       and h.bin_id is not distinct from from_bin and h.lot_id is not distinct from source.lot_id
       and h.serial_number is null and h.status='active';
    available := greatest(source.quantity-held,0);
    take := least(available,remaining);
    if take>0 then
      plan := plan || jsonb_build_array(jsonb_build_object('lot_id',source.lot_id,'quantity',take));
      remaining := remaining-take;
    end if;
    exit when remaining=0;
  end loop;
  if remaining>0 then
    raise exception 'Only % unit(s) can be moved from this area. Refresh stock availability or ask Quality to review items on hold. Nothing was moved.', requested-remaining;
  end if;

  for allocation in select value from jsonb_array_elements(plan)
  loop
    movement := private.warehouse_transfer_pre_lot_putaway(jsonb_build_object(
      'from_stock_delta',jsonb_build_object('product_id',product_id,'location_id',location_id,'bin_id',from_bin,'lot_id',allocation->'lot_id','delta',-(allocation->>'quantity')::integer),
      'to_stock_delta',jsonb_build_object('product_id',product_id,'location_id',location_id,'bin_id',to_bin,'lot_id',allocation->'lot_id','delta',(allocation->>'quantity')::integer),
      'movement',jsonb_build_object('id','mv-'||gen_random_uuid()::text,'type','transfer','product_id',product_id,
        'quantity',(allocation->>'quantity')::integer,'from_location_id',location_id,'to_location_id',location_id,
        'from_bin_id',from_bin,'to_bin_id',to_bin,'lot_id',allocation->'lot_id','reason','bin relocation',
        'actor',warehouse.authoritative_actor(),'created_at',now(),'evidence_urls','[]'::jsonb)
    ));
    result := result || jsonb_build_array(movement);
  end loop;
  return jsonb_build_object('movements',result);
end;
$$;
revoke all on function private.warehouse_transfer(jsonb) from public,anon,authenticated;
grant execute on function private.warehouse_transfer(jsonb),private.warehouse_transfer_pre_lot_putaway(jsonb) to service_role;
select pg_notify('pgrst','reload schema');
commit;
