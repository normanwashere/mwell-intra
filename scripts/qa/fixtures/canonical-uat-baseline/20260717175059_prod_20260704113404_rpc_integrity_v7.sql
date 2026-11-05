create or replace function warehouse.adjust_stock(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_mv warehouse.movements; v_unit_ids text[]; v_expected int; v_updated int;
begin
  if not warehouse.has_cap('cycle_count') then raise exception 'Not authorized: adjust_stock'; end if;
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
revoke all on function warehouse.adjust_stock(jsonb) from public, anon;
grant execute on function warehouse.adjust_stock(jsonb) to authenticated, service_role;

create or replace function warehouse.issue(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare
  v_alloc warehouse.allocations;
  v_unit_ids text[];
  v_expected int;
  v_updated int;
  v_serialized boolean;
  v_d jsonb;
  v_sum int := 0;
begin
  if not warehouse.has_cap('issue_items') then raise exception 'Not authorized: issue_items'; end if;
  select serialized into v_serialized from warehouse.products
    where id = (select product_id from warehouse.allocations where id = payload->>'allocation_id');
  update warehouse.allocations set status = 'issued' where id = payload->>'allocation_id' and status = 'reserved' returning * into v_alloc;
  if v_alloc.id is null then raise exception 'Allocation not found or not reservable: %', payload->>'allocation_id'; end if;
  if v_serialized then
    v_unit_ids := array(select jsonb_array_elements_text(payload->'unit_ids'));
    v_expected := coalesce(array_length(v_unit_ids, 1), 0);
    if v_expected <> v_alloc.quantity then
      raise exception 'Must issue exactly % serialized unit(s), got %.', v_alloc.quantity, v_expected;
    end if;
    update warehouse.inventory_units set status = 'issued', assigned_to = payload->>'assigned_to', event_id = payload->>'event_id'
    where id = any(v_unit_ids) and status = 'in_stock' and product_id = v_alloc.product_id;
    get diagnostics v_updated = row_count;
    if v_updated <> v_expected then
      raise exception 'Serialized units must all belong to the allocation product and be in stock (% of %).', v_updated, v_expected;
    end if;
  else
    if jsonb_typeof(payload->'stock_deltas') <> 'array' or jsonb_array_length(payload->'stock_deltas') = 0 then
      raise exception 'Missing stock movement for non-serialized issue.';
    end if;
    for v_d in select * from jsonb_array_elements(payload->'stock_deltas') loop
      if (v_d->>'product_id') is distinct from v_alloc.product_id then
        raise exception 'Issue stock delta product does not match the allocation.';
      end if;
      v_sum := v_sum + abs((v_d->>'delta')::int);
      update warehouse.stock_levels s set quantity = greatest(0, s.quantity + (v_d->>'delta')::int)
      where s.product_id = v_d->>'product_id' and s.location_id = v_d->>'location_id'
        and s.bin_id is not distinct from (v_d->>'bin_id');
      get diagnostics v_updated = row_count;
      if v_updated = 0 then raise exception 'Issue stock row not found for the requested bin.'; end if;
    end loop;
    if v_sum <> v_alloc.quantity then
      raise exception 'Issue deltas must sum to the allocation quantity (% vs %).', v_sum, v_alloc.quantity;
    end if;
  end if;
  insert into warehouse.movements select * from jsonb_populate_record(null::warehouse.movements, payload->'movement');
  return to_jsonb(v_alloc);
end; $$;
revoke all on function warehouse.issue(jsonb) from public, anon;
grant execute on function warehouse.issue(jsonb) to authenticated, service_role;

create or replace function warehouse.transfer(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_mv warehouse.movements; v_unit_ids text[]; v_expected int; v_updated int; v_from int; v_to int;
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
    v_from := abs((payload->'from_stock_delta'->>'delta')::int);
    if jsonb_typeof(payload->'to_stock_delta') = 'object' then
      v_to := abs((payload->'to_stock_delta'->>'delta')::int);
      if v_from <> v_to then raise exception 'Transfer source/destination quantities must match.'; end if;
    end if;
    if not exists (
      select 1 from warehouse.stock_levels s
      where s.product_id = payload->'from_stock_delta'->>'product_id'
        and s.location_id = payload->'from_stock_delta'->>'location_id'
        and s.bin_id is not distinct from (payload->'from_stock_delta'->>'bin_id')
        and s.quantity >= v_from
    ) then
      raise exception 'Insufficient stock in the source bin for this transfer.';
    end if;
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
revoke all on function warehouse.transfer(jsonb) from public, anon;
grant execute on function warehouse.transfer(jsonb) to authenticated, service_role;

drop policy if exists evidence_auth_write on storage.objects;
create policy evidence_auth_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'evidence'
    and (
      warehouse.has_cap('receive_stock')
      or warehouse.has_cap('manage_returns')
      or warehouse.has_cap('issue_items')
      or warehouse.has_cap('cycle_count')
    )
  );

notify pgrst, 'reload schema';
