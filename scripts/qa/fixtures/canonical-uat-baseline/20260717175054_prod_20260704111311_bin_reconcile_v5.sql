-- bin reconciliation v5
alter table warehouse.cycle_counts
  add column if not exists bin_id text;

update warehouse.cycle_counts set bin_id = null
 where bin_id is not null and bin_id not in (select id from warehouse.storage_areas);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cycle_counts_bin_fk') then
    alter table warehouse.cycle_counts
      add constraint cycle_counts_bin_fk foreign key (bin_id)
      references warehouse.storage_areas(id) on delete set null;
  end if;
end $$;

create or replace function warehouse.record_return(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_ret warehouse.returns; v_unit jsonb;
begin
  if not warehouse.has_cap('manage_returns') then raise exception 'Not authorized: manage_returns'; end if;
  if coalesce(jsonb_array_length(payload->'unit_updates'), 0) > 0 then
    for v_unit in select * from jsonb_array_elements(payload->'unit_updates') loop
      update warehouse.inventory_units
      set status = v_unit->>'status',
          assigned_to = null,
          location_id = coalesce(v_unit->>'location_id', location_id),
          bin_id = case when v_unit ? 'location_id' then v_unit->>'bin_id' else bin_id end
      where serial_number = v_unit->>'serial_number';
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

revoke all on function warehouse.record_return(jsonb) from public, anon;
grant execute on function warehouse.record_return(jsonb) to authenticated, service_role;

create or replace function warehouse.reserve(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_alloc warehouse.allocations; v_atp int; v_pid text; v_qty int;
begin
  if not warehouse.has_cap('reserve_allocate') then raise exception 'Not authorized: reserve_allocate'; end if;
  v_pid := payload->>'product_id';
  v_qty := (payload->>'quantity')::int;
  if (payload->'allocation'->>'product_id') is distinct from v_pid then
    raise exception 'Allocation product does not match the checked product.';
  end if;
  if (payload->'allocation'->>'quantity')::int is distinct from v_qty then
    raise exception 'Allocation quantity does not match the checked quantity.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('warehouse.reserve:' || v_pid, 0));
  v_atp := warehouse.available_to_promise(v_pid);
  if v_qty <= 0 then raise exception 'Quantity must be greater than zero.'; end if;
  if v_qty > v_atp then raise exception 'Cannot reserve % — only % available.', v_qty, v_atp; end if;
  insert into warehouse.allocations select * from jsonb_populate_record(null::warehouse.allocations, payload->'allocation') returning * into v_alloc;
  update warehouse.allocations set status = 'reserved' where id = v_alloc.id returning * into v_alloc;
  return to_jsonb(v_alloc);
end; $$;
revoke all on function warehouse.reserve(jsonb) from public, anon;
grant execute on function warehouse.reserve(jsonb) to authenticated, service_role;

create or replace function warehouse.issue(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_alloc warehouse.allocations; v_unit_ids text[]; v_expected int; v_updated int; v_serialized boolean;
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
    update warehouse.inventory_units set status = 'issued', assigned_to = payload->>'assigned_to', event_id = payload->>'event_id' where id = any(v_unit_ids) and status = 'in_stock';
    get diagnostics v_updated = row_count;
    if v_updated < v_expected then raise exception 'Some serialized units were no longer in stock (% of %)', v_updated, v_expected; end if;
  else
    if jsonb_typeof(payload->'stock_delta') <> 'object' then
      raise exception 'Missing stock movement for non-serialized issue.';
    end if;
    if abs((payload->'stock_delta'->>'delta')::int) <> v_alloc.quantity then
      raise exception 'Issue delta must equal the allocation quantity.';
    end if;
    update warehouse.stock_levels s set quantity = greatest(0, s.quantity + (payload->'stock_delta'->>'delta')::int)
    where s.product_id = payload->'stock_delta'->>'product_id' and s.location_id = payload->'stock_delta'->>'location_id'
      and s.bin_id is not distinct from (payload->'stock_delta'->>'bin_id');
  end if;
  insert into warehouse.movements select * from jsonb_populate_record(null::warehouse.movements, payload->'movement');
  return to_jsonb(v_alloc);
end; $$;
revoke all on function warehouse.issue(jsonb) from public, anon;
grant execute on function warehouse.issue(jsonb) to authenticated, service_role;

drop policy if exists evidence_auth_delete on storage.objects;
create policy evidence_auth_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'evidence' and owner = auth.uid());

notify pgrst, 'reload schema';
