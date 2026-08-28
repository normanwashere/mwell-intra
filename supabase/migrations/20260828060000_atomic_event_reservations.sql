-- One event reservation intent, with the existing actor-scoped command log and
-- product locks shared by reservations, fulfillment and inventory holds.
create or replace function warehouse.reserve_batch(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_line jsonb;
  v_demand record;
  v_available integer;
  v_alloc warehouse.allocations;
  v_allocations jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not core.has_live_cap('warehouse', 'reserve_allocate') then
    raise exception 'Not authorized: warehouse.reserve_allocate';
  end if;
  v_started := private.begin_idempotent_command('reserve_batch', payload->>'idempotency_key', payload);
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;

  begin
    if not exists (select 1 from warehouse.events where id = payload->>'event_id') then
      raise exception 'Select a valid event';
    end if;
    if jsonb_typeof(payload->'lines') is distinct from 'array' then
      raise exception 'Reservation lines must be an array';
    end if;
    if jsonb_array_length(payload->'lines') not between 1 and 100 then
      raise exception 'Provide between 1 and 100 reservation lines';
    end if;
    for v_line in select value from jsonb_array_elements(payload->'lines') loop
      if not exists (select 1 from warehouse.products where id = v_line->>'product_id') then
        raise exception 'Each reservation line requires a valid product';
      end if;
      if jsonb_typeof(v_line->'quantity') is distinct from 'number' then
        raise exception 'Quantity must be a positive whole number';
      end if;
      if (v_line->>'quantity')::numeric < 1
         or (v_line->>'quantity')::numeric > 2147483647
         or trunc((v_line->>'quantity')::numeric) <> (v_line->>'quantity')::numeric then
        raise exception 'Quantity must be a positive whole number';
      end if;
      if v_line ? 'promotional' and jsonb_typeof(v_line->'promotional') <> 'boolean' then
        raise exception 'Promotional must be a boolean';
      end if;
    end loop;

    perform private.lock_warehouse_products(array(
      select value->>'product_id' from jsonb_array_elements(payload->'lines')
    ));
    for v_demand in
      select value->>'product_id' product_id, sum((value->>'quantity')::numeric) quantity
      from jsonb_array_elements(payload->'lines') group by value->>'product_id'
    loop
      v_available := warehouse.available_to_promise(v_demand.product_id);
      if v_demand.quantity > v_available then
        raise exception 'Cannot reserve % of % - only % available after active inventory holds',
          v_demand.quantity, v_demand.product_id, v_available;
      end if;
    end loop;

    for v_line in select value from jsonb_array_elements(payload->'lines') loop
      insert into warehouse.allocations(id, event_id, product_id, quantity, status, promotional)
      values ('alloc-' || gen_random_uuid()::text, payload->>'event_id', v_line->>'product_id',
        (v_line->>'quantity')::numeric::integer, 'reserved', coalesce((v_line->>'promotional')::boolean, false))
      returning * into v_alloc;
      v_allocations := v_allocations || jsonb_build_array(to_jsonb(v_alloc));
    end loop;
    v_result := jsonb_build_object('status', 'committed', 'allocations', v_allocations);
  exception when raise_exception then
    -- This subtransaction rolls back every line. A persisted rejection is also
    -- replayable, so a lost rejection cannot later become a surprise success.
    v_result := jsonb_build_object('status', 'rejected', 'error', sqlerrm);
  end;
  return private.finish_idempotent_command((v_started->>'command_id')::uuid, v_result);
end;
$$;

revoke all on function warehouse.reserve_batch(jsonb) from public, anon;
grant execute on function warehouse.reserve_batch(jsonb) to authenticated;

select pg_notify('pgrst', 'reload schema');
