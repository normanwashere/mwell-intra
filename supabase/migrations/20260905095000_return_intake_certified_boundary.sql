-- The existing implementation already checks live certification before replay.
-- Expose only a governed wrapper; keep its raw-capability defense (including
-- service-role behavior) in a non-client-callable implementation.
alter function warehouse.record_return_v2(jsonb)
  rename to record_return_v2_certified_impl;

revoke all on function warehouse.record_return_v2_certified_impl(jsonb)
  from public, anon, authenticated, service_role;

create function warehouse.record_return_v2(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if core.has_live_cap('warehouse', 'manage_returns') is distinct from true then
    raise exception 'Not authorized: warehouse.manage_returns';
  end if;
  return warehouse.record_return_v2_certified_impl(payload);
end $$;

revoke all on function warehouse.record_return_v2(jsonb) from public, anon;
grant execute on function warehouse.record_return_v2(jsonb) to authenticated, service_role;
notify pgrst, 'reload schema';
