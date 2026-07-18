-- Preserve the converged issue implementation as an internal delegate, then
-- enforce the same exact-source exclusion used by the issue UI at the RPC.
do $$
begin
  if to_regprocedure('private.warehouse_issue_v1(jsonb)') is null then
    alter function warehouse.issue(jsonb) set schema private;
    alter function private.issue(jsonb) rename to warehouse_issue_v1;
  end if;
end;
$$;

revoke all on function private.warehouse_issue_v1(jsonb)
  from public, anon, authenticated;
grant execute on function private.warehouse_issue_v1(jsonb) to service_role;

create or replace function warehouse.issue(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alloc warehouse.allocations;
  v_delta jsonb;
begin
  if not core.has_cap('warehouse','issue_items') then
    raise exception 'Not authorized: issue_items';
  end if;

  select * into v_alloc
    from warehouse.allocations
   where id=payload->>'allocation_id'
     and status='reserved'
   for update;
  if not found then
    raise exception 'Allocation not found or not reservable: %',payload->>'allocation_id';
  end if;

  perform private.lock_warehouse_products(array[v_alloc.product_id]);

  if jsonb_typeof(payload->'stock_deltas')='array' then
    for v_delta in select * from jsonb_array_elements(payload->'stock_deltas') loop
      if exists (
        select 1
          from warehouse.inventory_holds active_hold
         where active_hold.status='active'
           and active_hold.product_id=v_alloc.product_id
           and active_hold.location_id=v_delta->>'location_id'
           and active_hold.bin_id is not distinct from nullif(v_delta->>'bin_id','')
           and active_hold.lot_id is not distinct from nullif(v_delta->>'lot_id','')
           and active_hold.serial_number is null
      ) then
        raise exception 'Held exact lot stock cannot be issued; select an unheld bin or lot';
      end if;
    end loop;
  end if;

  return private.warehouse_issue_v1(payload);
end;
$$;

revoke all on function warehouse.issue(jsonb) from public, anon;
grant execute on function warehouse.issue(jsonb) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
