-- Active quality holds are bound to an exact inventory identity. Transfers
-- must preserve that identity and cannot move held quantity to a new bin where
-- the issue guard would no longer find the hold.
create or replace function private.warehouse_transfer(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mv warehouse.movements;
  v_actor text;
  v_unit_ids text[];
  v_product_ids text[];
  v_expected integer;
  v_updated integer;
  v_unit warehouse.inventory_units;
  v_from_delta jsonb;
  v_to_delta jsonb;
  v_product_id text;
  v_from_location_id text;
  v_to_location_id text;
  v_from_bin_id text;
  v_to_bin_id text;
  v_lot_id text;
  v_from_quantity integer;
  v_to_quantity integer;
  v_source_candidates integer;
  v_source_quantity integer;
  v_held_quantity integer;
begin
  if not core.has_cap('warehouse', 'transfer_stock') then
    raise exception 'Not authorized: transfer_stock';
  end if;

  v_actor := warehouse.authoritative_actor();
  if payload ? 'movement' then
    payload := jsonb_set(
      payload,
      '{movement}',
      warehouse.force_actor_on_object(payload->'movement', v_actor)
    );
  end if;

  if coalesce(jsonb_array_length(payload->'unit_ids'), 0) > 0 then
    v_unit_ids := array(select jsonb_array_elements_text(payload->'unit_ids'));
    v_expected := coalesce(array_length(v_unit_ids, 1), 0);
    v_from_location_id := payload->>'from_location_id';
    v_to_location_id := payload->>'to_location_id';
    v_from_bin_id := nullif(
      coalesce(payload->>'from_bin_id', payload->'movement'->>'from_bin_id'),
      ''
    );
    v_to_bin_id := nullif(payload->>'to_bin_id', '');

    select array_agg(distinct unit.product_id order by unit.product_id)
      into v_product_ids
      from warehouse.inventory_units unit
     where unit.id = any(v_unit_ids);

    if coalesce(array_length(v_product_ids, 1), 0) = 0 then
      raise exception 'No serialized inventory units were found for transfer';
    end if;

    perform private.lock_warehouse_products(v_product_ids);

    v_updated := 0;
    for v_unit in
      select unit.*
        from warehouse.inventory_units unit
       where unit.id = any(v_unit_ids)
       order by unit.id
       for update
    loop
      v_updated := v_updated + 1;
      if v_unit.status <> 'in_stock'
         or v_unit.location_id is distinct from v_from_location_id
         or v_unit.bin_id is distinct from v_from_bin_id then
        raise exception 'Serialized unit % is no longer in stock at the exact source', v_unit.id;
      end if;

      if exists (
        select 1
          from warehouse.inventory_holds active_hold
         where active_hold.status = 'active'
           and active_hold.product_id = v_unit.product_id
           and active_hold.location_id = v_unit.location_id
           and active_hold.bin_id is not distinct from v_unit.bin_id
           and active_hold.lot_id is not distinct from v_unit.lot_id
           and active_hold.serial_number = v_unit.serial_number
      ) then
        raise exception 'Held serialized inventory cannot be transferred: %', v_unit.serial_number;
      end if;
    end loop;

    if v_updated <> v_expected then
      raise exception 'Some serialized units were not found (% of %)', v_updated, v_expected;
    end if;

    update warehouse.inventory_units unit
       set location_id = v_to_location_id,
           bin_id = v_to_bin_id
     where unit.id = any(v_unit_ids);
  end if;

  if jsonb_typeof(payload->'from_stock_delta') = 'object' then
    v_from_delta := payload->'from_stock_delta';
    v_to_delta := payload->'to_stock_delta';
    v_product_id := v_from_delta->>'product_id';
    v_from_location_id := v_from_delta->>'location_id';
    v_from_bin_id := nullif(v_from_delta->>'bin_id', '');
    v_from_quantity := abs((v_from_delta->>'delta')::integer);

    if v_product_id is null or v_from_location_id is null or v_from_quantity <= 0 then
      raise exception 'Transfer source product, location, and positive quantity are required';
    end if;
    if jsonb_typeof(v_to_delta) <> 'object' then
      raise exception 'Transfer destination stock delta is required';
    end if;

    v_to_location_id := v_to_delta->>'location_id';
    v_to_bin_id := nullif(v_to_delta->>'bin_id', '');
    v_to_quantity := abs((v_to_delta->>'delta')::integer);
    if v_to_delta->>'product_id' is distinct from v_product_id
       or v_to_quantity <> v_from_quantity then
      raise exception 'Transfer source/destination product and quantities must match';
    end if;

    perform private.lock_warehouse_products(array[v_product_id]);

    if v_from_delta ? 'lot_id' then
      v_lot_id := nullif(v_from_delta->>'lot_id', '');
    else
      select count(*), min(source.lot_id)
        into v_source_candidates, v_lot_id
        from warehouse.stock_levels source
       where source.product_id = v_product_id
         and source.location_id = v_from_location_id
         and source.bin_id is not distinct from v_from_bin_id;

      if v_source_candidates > 1 then
        raise exception 'Ambiguous source inventory; lot_id is required';
      end if;
    end if;

    if v_to_delta ? 'lot_id'
       and nullif(v_to_delta->>'lot_id', '') is distinct from v_lot_id then
      raise exception 'Transfer destination must preserve the source lot_id';
    end if;

    select source.quantity
      into v_source_quantity
      from warehouse.stock_levels source
     where source.product_id = v_product_id
       and source.location_id = v_from_location_id
       and source.bin_id is not distinct from v_from_bin_id
       and source.lot_id is not distinct from v_lot_id
     for update;

    if not found or v_source_quantity < v_from_quantity then
      raise exception 'Insufficient stock in the exact source bin and lot for this transfer';
    end if;

    select coalesce(sum(active_hold.quantity), 0)::integer
      into v_held_quantity
      from warehouse.inventory_holds active_hold
     where active_hold.status = 'active'
       and active_hold.product_id = v_product_id
       and active_hold.location_id = v_from_location_id
       and active_hold.bin_id is not distinct from v_from_bin_id
       and active_hold.lot_id is not distinct from v_lot_id
       and active_hold.serial_number is null;

    if v_source_quantity - v_held_quantity < v_from_quantity then
      raise exception 'Inventory covered by an active hold cannot be transferred';
    end if;

    update warehouse.stock_levels source
       set quantity = source.quantity - v_from_quantity
     where source.product_id = v_product_id
       and source.location_id = v_from_location_id
       and source.bin_id is not distinct from v_from_bin_id
       and source.lot_id is not distinct from v_lot_id;

    insert into warehouse.stock_levels
      (product_id, location_id, bin_id, lot_id, quantity)
    values
      (v_product_id, v_to_location_id, v_to_bin_id, v_lot_id, v_to_quantity)
    on conflict (product_id, location_id, bin_id, lot_id)
    do update set quantity = warehouse.stock_levels.quantity + excluded.quantity;
  end if;

  insert into warehouse.movements
  select *
    from jsonb_populate_record(null::warehouse.movements, payload->'movement')
  returning * into v_mv;

  return to_jsonb(v_mv);
end;
$$;

create or replace function warehouse.transfer(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.warehouse_transfer(payload) $$;

revoke all on function private.warehouse_transfer(jsonb) from public, anon;
revoke all on function warehouse.transfer(jsonb) from public, anon;
grant execute on function private.warehouse_transfer(jsonb) to authenticated, service_role;
grant execute on function warehouse.transfer(jsonb) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
