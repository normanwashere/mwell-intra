-- Validate the caller-supplied PO line against the exact receipt before
-- consulting controlled-exception state. This keeps denial reasons precise and
-- prevents an unrelated active claim from masking a cross-receipt line error.

do $migration$
declare
  v_definition text;
  v_repaired text;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'private.warehouse_inspect_quality_v2(jsonb)'::pg_catalog.regprocedure
  );
  if v_definition ~ 'Procurement PO line does not belong to the receipt' then
    return;
  end if;
  v_repaired := pg_catalog.regexp_replace(
    v_definition,
    $pattern$if v_line_id is null then[[:space:]]+raise exception 'Procurement PO-line identity is required for receipt quality disposition';[[:space:]]+end if;$pattern$,
    $replacement$if v_line_id is null then
    raise exception 'Procurement PO-line identity is required for receipt quality disposition';
  end if;
  if not exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_receipt.lines) receipt_line
    where receipt_line->>'procurementLineId' = v_line_id
  ) then
    raise exception 'Procurement PO line does not belong to the receipt';
  end if;$replacement$
  );
  if v_repaired = v_definition then
    raise exception 'Expected receipt quality identity guard was not found';
  end if;
  execute v_repaired;
end;
$migration$;

alter function private.warehouse_inspect_quality_v2(jsonb) owner to postgres;
revoke all on function private.warehouse_inspect_quality_v2(jsonb)
  from public, anon, authenticated;
grant execute on function private.warehouse_inspect_quality_v2(jsonb)
  to service_role;

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
  v_doa_definition text;
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
  v_quality_definition := pg_catalog.pg_get_functiondef(
    'private.warehouse_inspect_quality_v2(jsonb)'::pg_catalog.regprocedure
  );
  if v_quality_definition !~
       'v_disposition[[:space:]]*=[[:space:]]*''accepted''[[:space:]]+and[[:space:]]+v_stock[.]quantity[[:space:]]*<[[:space:]]*v_quantity'
     or v_quality_definition !~
       'v_disposition[[:space:]]*<>[[:space:]]*''accepted''[[:space:]]+and[[:space:]]+v_stock[.]quantity[[:space:]]*-[[:space:]]*v_exact_held' then
    v_missing := pg_catalog.array_append(
      v_missing,
      'accepted quality classification independent of active holds'
    );
  end if;
  if pg_catalog.strpos(
       v_quality_definition,
       'Procurement PO line does not belong to the receipt'
     ) = 0
     or pg_catalog.strpos(
       v_quality_definition,
       'Procurement PO line does not belong to the receipt'
     ) > pg_catalog.strpos(
       v_quality_definition,
       'Active controlled receipt exception must be finalized'
     ) then
    v_missing := pg_catalog.array_append(
      v_missing,
      'receipt PO-line identity validation before controlled exception state'
    );
  end if;

  v_doa_definition := pg_catalog.pg_get_functiondef(
    'procurement.activate_doa_matrix(jsonb)'::pg_catalog.regprocedure
  );
  if v_doa_definition !~
       'jsonb_build_object[[:space:]]*[(][[:space:]]*''id''[[:space:]]*,[[:space:]]*v_matrix_id[[:space:]]*[)]' then
    v_missing := pg_catalog.array_append(
      v_missing,
      'procurement.activate_doa_matrix private identity translation'
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
