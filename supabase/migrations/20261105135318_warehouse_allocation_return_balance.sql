-- Read only: return actors get quantity authority, not seller identities or revenue.
create or replace function warehouse.allocation_return_balance(p_allocation_id text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  allocation warehouse.allocations;
  balance jsonb;
  returned bigint;
begin
  if auth.uid() is null or core.has_live_cap('warehouse','manage_returns') is distinct from true then
    raise exception 'Not authorized: warehouse.manage_returns';
  end if;
  select * into allocation from warehouse.allocations where id=p_allocation_id;
  if not found then raise exception 'Allocation not found'; end if;

  if exists(select 1 from private.event_custody_sessions where event_id=allocation.event_id) then
    -- Share the mutation guard's sale/giveaway/reversal and lineage calculation.
    balance := private.event_allocation_remaining(allocation.id);
    return jsonb_build_object('allocation_id',allocation.id,
      'issued_units',balance->'issued_units','returned_units',balance->'returned_units',
      'remaining_units',balance->'remaining_units');
  end if;

  select coalesce(sum((line->>'quantity')::bigint),0) into returned
  from warehouse.returns r cross join lateral jsonb_array_elements(r.lines) line
  where r.event_id=allocation.event_id and line->>'allocationId'=allocation.id;
  if returned<0 or returned>allocation.quantity then raise exception 'Allocation return balance is invalid'; end if;
  return jsonb_build_object('allocation_id',allocation.id,'issued_units',allocation.quantity,
    'returned_units',returned,'remaining_units',allocation.quantity-returned);
end;
$$;

revoke all on function warehouse.allocation_return_balance(text) from public,anon;
grant execute on function warehouse.allocation_return_balance(text) to authenticated,service_role;
notify pgrst, 'reload schema';
