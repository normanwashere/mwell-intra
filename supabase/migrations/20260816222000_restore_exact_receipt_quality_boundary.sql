-- Route public receipt QC through the exact PO-line implementation. The
-- capability wrapper remains certification-aware and the private helper stays
-- unavailable to app roles.

create or replace function warehouse.inspect_quality(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role'
     and not core.has_live_cap('warehouse', 'inspect_quality') then
    raise exception 'Not authorized: warehouse.inspect_quality';
  end if;
  return private.warehouse_inspect_quality_v2(payload);
end;
$$;

alter function warehouse.inspect_quality(jsonb) owner to postgres;
revoke all on function warehouse.inspect_quality(jsonb) from public, anon;
grant execute on function warehouse.inspect_quality(jsonb)
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
  v_quality_definition text;
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

  if pg_catalog.has_function_privilege(
    'authenticated',
    'private.warehouse_inspect_quality_v2(jsonb)',
    'EXECUTE'
  ) then
    v_missing := pg_catalog.array_append(
      v_missing,
      'private.warehouse_inspect_quality_v2(jsonb) unavailable to authenticated'
    );
  end if;

  v_quality_definition := pg_catalog.pg_get_functiondef(
    'warehouse.inspect_quality(jsonb)'::pg_catalog.regprocedure
  );
  if v_quality_definition !~
       'private[.]warehouse_inspect_quality_v2[[:space:]]*[(][[:space:]]*payload[[:space:]]*[)]'
     or v_quality_definition ~
       'private[.]warehouse_inspect_quality[[:space:]]*[(][[:space:]]*payload[[:space:]]*[)]' then
    v_missing := pg_catalog.array_append(
      v_missing,
      'warehouse.inspect_quality exact PO-line delegate'
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
