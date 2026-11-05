-- Harden the existing inner mutation only. Keep the live-capability, offline
-- receipt and multi-lot relocation wrappers, including their function OIDs.
begin;
-- Main verified this CRLF-normalized body hash against the live UAT catalog.
do $$
begin
  if (select md5(replace(prosrc, chr(13), '')) from pg_proc
       where oid = to_regprocedure('private.warehouse_transfer_pre_lot_putaway(jsonb)'))
       is distinct from '50973cd87f9aacaae2582b4480be732d' then
    raise exception 'Transfer predecessor definition drifted; review the live function before applying';
  end if;
end;
$$;
create or replace function private.warehouse_transfer_pre_lot_putaway(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mv warehouse.movements;
  v_actor text;
  v_unit_ids text[];
  v_serials text[] := array[]::text[];
  v_command jsonb := payload->'command_input';
  v_movement jsonb := payload->'movement';
  v_quantity integer;
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
  if jsonb_typeof(v_movement) is distinct from 'object'
     or v_movement->>'type' is distinct from 'transfer'
     or jsonb_typeof(v_movement->'quantity') is distinct from 'number'
     or (v_movement->>'quantity') !~ '^[1-9][0-9]*$'
     or (v_movement->>'quantity')::numeric > 2147483647 then
    raise exception 'Transfer movement requires type transfer and a positive whole-number quantity';
  end if;
  v_quantity := (v_movement->>'quantity')::integer;
  payload := jsonb_set(payload, '{movement}', warehouse.force_actor_on_object(v_movement, v_actor));
  if payload->'unit_ids' is not null and payload->'unit_ids' <> 'null'::jsonb
     and jsonb_typeof(payload->'unit_ids') is distinct from 'array' then
    raise exception 'Serialized transfer unit_ids must be an array';
  end if;
  v_unit_ids := array(select jsonb_array_elements_text(nullif(payload->'unit_ids', 'null'::jsonb)));
  v_expected := cardinality(v_unit_ids);

  if v_expected > 0 then
    if jsonb_typeof(payload->'from_stock_delta') = 'object'
       or jsonb_typeof(payload->'to_stock_delta') = 'object' then
      raise exception 'Serialized transfer cannot include bulk stock deltas';
    end if;
    if v_quantity <> v_expected
       or v_expected <> (select count(distinct id) from unnest(v_unit_ids) id)
       or exists (select 1 from jsonb_array_elements(payload->'unit_ids') id
                   where jsonb_typeof(id) <> 'string' or nullif(id #>> '{}', '') is null) then
      raise exception 'Serialized transfer quantity must equal the distinct unit count';
    end if;
    v_from_location_id := payload->>'from_location_id';
    v_to_location_id := payload->>'to_location_id';
    v_from_bin_id := nullif(coalesce(payload->>'from_bin_id', v_movement->>'from_bin_id'), '');
    v_to_bin_id := nullif(payload->>'to_bin_id', '');
    if nullif(v_from_location_id, '') is null or nullif(v_to_location_id, '') is null
       or v_movement->>'from_location_id' is distinct from v_from_location_id
       or v_movement->>'to_location_id' is distinct from v_to_location_id
       or nullif(v_movement->>'from_bin_id', '') is distinct from v_from_bin_id
       or nullif(v_movement->>'to_bin_id', '') is distinct from v_to_bin_id then
      raise exception 'Serialized transfer movement source and destination must match the unit payload';
    end if;
    if v_command is not null then
      if jsonb_typeof(v_command) is distinct from 'object'
         or jsonb_typeof(v_command->'quantity') is distinct from 'number'
         or v_command->'quantity' is distinct from v_movement->'quantity'
         or v_command->>'productId' is distinct from v_movement->>'product_id'
         or (case when v_command ? 'locationId' then
               v_command->>'locationId' is distinct from v_from_location_id
               or v_command->>'locationId' is distinct from v_to_location_id
               or (v_command ? 'fromLocationId' and v_command->>'fromLocationId' is distinct from v_from_location_id)
               or (v_command ? 'toLocationId' and v_command->>'toLocationId' is distinct from v_to_location_id)
             else v_command->>'fromLocationId' is distinct from v_from_location_id
               or v_command->>'toLocationId' is distinct from v_to_location_id end)
         or nullif(v_command->>'fromBinId', '') is distinct from v_from_bin_id
         or nullif(v_command->>'toBinId', '') is distinct from v_to_bin_id then
        raise exception 'Serialized transfer command must match movement quantity and identity';
      end if;
      if v_command ? 'serialNumbers' then
        if jsonb_typeof(v_command->'serialNumbers') is distinct from 'array' then
          raise exception 'Serialized transfer serialNumbers must be an exact array';
        end if;
        if jsonb_array_length(v_command->'serialNumbers') > 0 and (
           jsonb_array_length(v_command->'serialNumbers') <> v_expected
           or exists (select 1 from jsonb_array_elements(v_command->'serialNumbers') serial
                       where jsonb_typeof(serial) <> 'string' or nullif(serial #>> '{}', '') is null)
           or (select count(distinct serial) from jsonb_array_elements_text(v_command->'serialNumbers') serial) <> v_expected) then
          raise exception 'Serialized transfer serialNumbers must match the distinct unit count';
        end if;
      end if;
    end if;

    select array_agg(distinct unit.product_id order by unit.product_id)
      into v_product_ids from warehouse.inventory_units unit where unit.id = any(v_unit_ids);
    if coalesce(array_length(v_product_ids, 1), 0) = 0 then
      raise exception 'No serialized inventory units were found for transfer';
    end if;
    perform private.lock_warehouse_products(v_product_ids);
    v_updated := 0;
    for v_unit in
      select unit.* from warehouse.inventory_units unit
       where unit.id = any(v_unit_ids) order by unit.id for update
    loop
      v_updated := v_updated + 1;
      if v_unit.product_id is distinct from v_movement->>'product_id'
         or (nullif(v_movement->>'lot_id', '') is not null and v_movement->>'lot_id' is distinct from v_unit.lot_id)
         or (nullif(v_movement->>'serial_number', '') is not null
             and (v_expected <> 1 or v_movement->>'serial_number' is distinct from v_unit.serial_number)) then
        raise exception 'Serialized transfer movement must match every selected unit identity';
      end if;
      v_serials := array_append(v_serials, v_unit.serial_number);
      if v_unit.status <> 'in_stock'
         or v_unit.location_id is distinct from v_from_location_id
         or v_unit.bin_id is distinct from v_from_bin_id then
        raise exception 'Serialized unit % is no longer in stock at the exact source', v_unit.id;
      end if;
      if exists (
        select 1 from warehouse.inventory_holds active_hold
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
    if v_command ? 'serialNumbers' and jsonb_array_length(v_command->'serialNumbers') > 0
       and (select array_agg(serial order by serial) from unnest(v_serials) serial)
           is distinct from (select array_agg(serial order by serial) from jsonb_array_elements_text(v_command->'serialNumbers') serial) then
      raise exception 'Serialized transfer serialNumbers must identify exactly the selected units';
    end if;
    update warehouse.inventory_units unit
       set location_id = v_to_location_id, bin_id = v_to_bin_id where unit.id = any(v_unit_ids);
  elsif exists (select 1 from warehouse.products p where p.id = v_movement->>'product_id' and p.serialized) then
    raise exception 'Serialized transfer requires exact unit IDs';
  elsif jsonb_typeof(payload->'from_stock_delta') is distinct from 'object' then
    raise exception 'Transfer requires serialized units or bulk stock deltas';
  end if;

  if jsonb_typeof(payload->'from_stock_delta') = 'object' then
    v_from_delta := payload->'from_stock_delta';
    v_to_delta := payload->'to_stock_delta';
    if jsonb_typeof(v_from_delta->'delta') is distinct from 'number'
       or (v_from_delta->>'delta') !~ '^-[1-9][0-9]*$'
       or (v_from_delta->>'delta')::numeric < -2147483647
       or jsonb_typeof(v_to_delta) is distinct from 'object'
       or jsonb_typeof(v_to_delta->'delta') is distinct from 'number'
       or (v_to_delta->>'delta') !~ '^[1-9][0-9]*$'
       or (v_to_delta->>'delta')::numeric > 2147483647 then
      raise exception 'Transfer stock deltas require negative source and positive destination whole-number quantities';
    end if;
    v_product_id := v_from_delta->>'product_id';
    v_from_location_id := v_from_delta->>'location_id';
    v_from_bin_id := nullif(v_from_delta->>'bin_id', '');
    v_from_quantity := -(v_from_delta->>'delta')::integer;
    v_to_location_id := v_to_delta->>'location_id';
    v_to_bin_id := nullif(v_to_delta->>'bin_id', '');
    v_to_quantity := (v_to_delta->>'delta')::integer;
    if nullif(v_product_id, '') is null or nullif(v_from_location_id, '') is null or nullif(v_to_location_id, '') is null
       or v_to_delta->>'product_id' is distinct from v_product_id
       or v_to_quantity <> v_from_quantity or v_quantity <> v_from_quantity
       or v_movement->>'product_id' is distinct from v_product_id
       or v_movement->>'from_location_id' is distinct from v_from_location_id
       or v_movement->>'to_location_id' is distinct from v_to_location_id
       or nullif(v_movement->>'from_bin_id', '') is distinct from v_from_bin_id
       or nullif(v_movement->>'to_bin_id', '') is distinct from v_to_bin_id then
      raise exception 'Transfer movement must match the bulk stock delta quantity and identity';
    end if;
    if v_command is not null and (
       jsonb_typeof(v_command) is distinct from 'object'
       or jsonb_typeof(v_command->'quantity') is distinct from 'number'
       or v_command->'quantity' is distinct from v_movement->'quantity'
       or v_command->>'productId' is distinct from v_product_id
       or v_command->>'fromLocationId' is distinct from v_from_location_id
       or v_command->>'toLocationId' is distinct from v_to_location_id
       or nullif(v_command->>'fromBinId', '') is distinct from v_from_bin_id
       or nullif(v_command->>'toBinId', '') is distinct from v_to_bin_id) then
      raise exception 'Transfer command must match the bulk stock delta quantity and identity';
    end if;

    perform private.lock_warehouse_products(array[v_product_id]);
    if v_from_delta ? 'lot_id' then
      v_lot_id := nullif(v_from_delta->>'lot_id', '');
    else
      select count(*), min(source.lot_id) into v_source_candidates, v_lot_id
        from warehouse.stock_levels source
       where source.product_id = v_product_id and source.location_id = v_from_location_id
         and source.bin_id is not distinct from v_from_bin_id;
      if v_source_candidates > 1 then raise exception 'Ambiguous source inventory; lot_id is required'; end if;
    end if;
    if v_to_delta ? 'lot_id' and nullif(v_to_delta->>'lot_id', '') is distinct from v_lot_id then
      raise exception 'Transfer destination must preserve the source lot_id';
    end if;
    if nullif(v_movement->>'lot_id', '') is not null and v_movement->>'lot_id' is distinct from v_lot_id then
      raise exception 'Transfer movement must preserve the source lot_id';
    end if;
    select source.quantity into v_source_quantity from warehouse.stock_levels source
     where source.product_id = v_product_id and source.location_id = v_from_location_id
       and source.bin_id is not distinct from v_from_bin_id and source.lot_id is not distinct from v_lot_id
     for update;
    if not found or v_source_quantity < v_from_quantity then
      raise exception 'Insufficient stock in the exact source bin and lot for this transfer';
    end if;
    select coalesce(sum(active_hold.quantity), 0)::integer into v_held_quantity
      from warehouse.inventory_holds active_hold
     where active_hold.status = 'active' and active_hold.product_id = v_product_id
       and active_hold.location_id = v_from_location_id and active_hold.bin_id is not distinct from v_from_bin_id
       and active_hold.lot_id is not distinct from v_lot_id and active_hold.serial_number is null;
    if v_source_quantity - v_held_quantity < v_from_quantity then
      raise exception 'Inventory covered by an active hold cannot be transferred';
    end if;
    update warehouse.stock_levels source set quantity = source.quantity - v_from_quantity
     where source.product_id = v_product_id and source.location_id = v_from_location_id
       and source.bin_id is not distinct from v_from_bin_id and source.lot_id is not distinct from v_lot_id;
    insert into warehouse.stock_levels (product_id, location_id, bin_id, lot_id, quantity)
    values (v_product_id, v_to_location_id, v_to_bin_id, v_lot_id, v_to_quantity)
    on conflict (product_id, location_id, bin_id, lot_id)
    do update set quantity = warehouse.stock_levels.quantity + excluded.quantity;
  end if;
  insert into warehouse.movements
  select * from jsonb_populate_record(null::warehouse.movements, payload->'movement') returning * into v_mv;
  return to_jsonb(v_mv);
end;
$$;
revoke all on function private.warehouse_transfer_pre_lot_putaway(jsonb) from public, anon, authenticated;
grant execute on function private.warehouse_transfer_pre_lot_putaway(jsonb) to service_role;
select pg_notify('pgrst', 'reload schema');
commit;
