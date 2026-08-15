-- Accepted QC classifies an exact receipt line; it does not consume available
-- stock. Active holds must constrain new holds, reservations, and issues, but
-- cannot make an independently received line impossible to accept.

do $migration$
declare
  v_definition text;
  v_repaired text;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'private.warehouse_inspect_quality_v2(jsonb)'::pg_catalog.regprocedure
  );
  v_repaired := pg_catalog.regexp_replace(
    v_definition,
    $pattern$if[[:space:]]+v_stock[.]quantity[[:space:]]*-[[:space:]]*v_exact_held[[:space:]]*<[[:space:]]*v_quantity[[:space:]]+then[[:space:]]+raise exception 'Exact receipt lot stock is not available after active holds';[[:space:]]+end if;$pattern$,
    $replacement$if v_disposition = 'accepted' and v_stock.quantity < v_quantity then
      raise exception 'Exact receipt lot stock is not available for QC';
    elsif v_disposition <> 'accepted'
      and v_stock.quantity - v_exact_held < v_quantity then
      raise exception 'Exact receipt lot stock is not available after active holds';
    end if;$replacement$
  );
  if v_repaired = v_definition then
    raise exception 'Expected exact-lot quality guard was not found';
  end if;
  execute v_repaired;
end;
$migration$;

alter function private.warehouse_inspect_quality_v2(jsonb) owner to postgres;
revoke all on function private.warehouse_inspect_quality_v2(jsonb)
  from public, anon, authenticated;
grant execute on function private.warehouse_inspect_quality_v2(jsonb)
  to service_role;

-- The governed public contract uses matrix_id. Translate it for the older
-- private policy implementation after enforcing attribution and four-eyes.
create or replace function procurement.activate_doa_matrix(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_matrix_id uuid;
  v_created_by uuid;
begin
  if auth.uid() is null then
    raise exception 'An attributable DOA checker is required';
  end if;
  if auth.role() <> 'service_role'
    and not core.has_live_cap('core', 'manage_rbac')
    and not core.has_live_cap('legal', 'manage_doa') then
    raise exception 'Not authorized to activate a DOA matrix';
  end if;
  begin
    v_matrix_id := nullif(payload->>'matrix_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'A valid DOA matrix identity is required';
  end;
  if v_matrix_id is null then
    raise exception 'A valid DOA matrix identity is required';
  end if;
  select created_by
    into v_created_by
  from procurement.doa_matrices
  where id = v_matrix_id
  for update;
  if not found then
    raise exception 'DOA matrix not found';
  end if;
  if v_created_by is not distinct from auth.uid() then
    raise exception 'A separate DOA checker must activate the matrix';
  end if;
  return private.policy_activate_doa_matrix(
    payload || pg_catalog.jsonb_build_object('id', v_matrix_id)
  );
end;
$$;

alter function procurement.activate_doa_matrix(jsonb) owner to postgres;
revoke all on function procurement.activate_doa_matrix(jsonb)
  from public, anon;
grant execute on function procurement.activate_doa_matrix(jsonb)
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
