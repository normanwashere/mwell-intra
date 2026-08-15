-- Restore launch-critical authenticated read surfaces after capability-boundary
-- convergence, and expose a service-role-only check so CI detects grant drift.

grant execute on function procurement.commitment_readiness(jsonb)
  to authenticated, service_role;
grant execute on function procurement.purchase_order_receipt_status(jsonb)
  to authenticated, service_role;

create or replace function core.verify_launch_read_contracts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_missing text[] := array[]::text[];
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required for launch read-contract verification'
      using errcode = '42501';
  end if;

  if not pg_catalog.has_function_privilege(
    'authenticated',
    'procurement.commitment_readiness(jsonb)',
    'EXECUTE'
  ) then
    v_missing := pg_catalog.array_append(
      v_missing,
      'authenticated execute on procurement.commitment_readiness(jsonb)'
    );
  end if;

  if not pg_catalog.has_function_privilege(
    'authenticated',
    'procurement.purchase_order_receipt_status(jsonb)',
    'EXECUTE'
  ) then
    v_missing := pg_catalog.array_append(
      v_missing,
      'authenticated execute on procurement.purchase_order_receipt_status(jsonb)'
    );
  end if;

  return pg_catalog.jsonb_build_object('missing_grants', v_missing);
end;
$$;

alter function core.verify_launch_read_contracts() owner to postgres;
revoke all on function core.verify_launch_read_contracts()
  from public, anon, authenticated;
grant execute on function core.verify_launch_read_contracts()
  to service_role;

notify pgrst, 'reload schema';
