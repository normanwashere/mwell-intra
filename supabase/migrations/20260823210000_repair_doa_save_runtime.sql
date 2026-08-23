-- Repair the governed DOA save path after the department-code convergence
-- migration schema-qualified COALESCE, which is SQL syntax rather than a
-- pg_catalog function.

create or replace function private.policy_save_doa_matrix(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_matrix procurement.doa_matrices;
  v_id uuid;
  v_department text;
  v_assignments jsonb := coalesce(payload->'assignments', '[]'::jsonb);
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not private.policy_can_manage_doa() then raise exception 'Not authorized to manage DOA'; end if;

  v_department := private.policy_resolve_department_code(payload->>'department');
  if nullif(pg_catalog.btrim(payload->>'version'), '') is null then raise exception 'Version is required'; end if;
  if pg_catalog.jsonb_typeof(v_assignments) <> 'array' then raise exception 'Assignments must be an array'; end if;

  v_id := nullif(payload->>'id', '')::uuid;
  if v_id is null then
    insert into procurement.doa_matrices(
      version, department, source_document, approved_by_name, approved_at,
      effective_at, expires_at, active, status, created_by
    ) values (
      pg_catalog.btrim(payload->>'version'), v_department,
      coalesce(nullif(pg_catalog.btrim(payload->>'source_document'), ''), 'Configured in Mwell Intra'),
      'Pending activation', pg_catalog.now(),
      coalesce((payload->>'effective_at')::timestamptz, pg_catalog.now()),
      nullif(payload->>'expires_at', '')::timestamptz, false, 'draft', auth.uid()
    ) returning * into v_matrix;
  else
    select * into v_matrix
    from procurement.doa_matrices
    where id = v_id
    for update;
    if v_matrix.id is null then raise exception 'DOA matrix not found'; end if;
    if v_matrix.status <> 'draft' then raise exception 'Activated DOA matrices are immutable; create a revision'; end if;
    update procurement.doa_matrices set
      version = pg_catalog.btrim(payload->>'version'),
      department = v_department,
      source_document = coalesce(nullif(pg_catalog.btrim(payload->>'source_document'), ''), source_document),
      effective_at = coalesce((payload->>'effective_at')::timestamptz, effective_at),
      expires_at = nullif(payload->>'expires_at', '')::timestamptz,
      updated_at = pg_catalog.now()
    where id = v_id
    returning * into v_matrix;
    delete from procurement.doa_assignments where matrix_id = v_id;
  end if;

  insert into procurement.doa_assignments(
    matrix_id, department, category, min_amount, max_amount, tier,
    approver_user_id, active
  )
  select v_matrix.id, v_department, nullif(pg_catalog.btrim(item.category), ''),
    item.min_amount, item.max_amount, item.tier, item.approver_user_id, true
  from pg_catalog.jsonb_to_recordset(v_assignments) as item(
    category text, min_amount numeric, max_amount numeric,
    tier text, approver_user_id uuid
  );

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values(
    'procurement', 'doa_matrix', v_matrix.id::text, 'doa_matrix_saved', auth.uid(),
    pg_catalog.jsonb_build_object('department', v_department, 'version', v_matrix.version)
  );
  return pg_catalog.to_jsonb(v_matrix);
end;
$$;

alter function private.policy_save_doa_matrix(jsonb) owner to postgres;
revoke all on function private.policy_save_doa_matrix(jsonb)
  from public, anon, authenticated;
grant execute on function private.policy_save_doa_matrix(jsonb)
  to service_role;

do $$
declare
  v_definition text := pg_catalog.pg_get_functiondef(
    'private.policy_save_doa_matrix(jsonb)'::pg_catalog.regprocedure
  );
begin
  if pg_catalog.strpos(v_definition, 'pg_catalog.coalesce') > 0 then
    raise exception 'DOA save contract still contains an invalid pg_catalog.coalesce reference';
  end if;
  if not pg_catalog.has_function_privilege(
    'authenticated',
    'procurement.save_doa_matrix(jsonb)',
    'execute'
  ) then
    raise exception 'Authenticated users cannot execute the governed DOA save wrapper';
  end if;
end;
$$;

notify pgrst, 'reload schema';
