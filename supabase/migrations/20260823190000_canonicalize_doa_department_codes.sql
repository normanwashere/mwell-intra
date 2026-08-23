-- Keep procurement authority and request routing on the same controlled
-- department identity. Display names remain presentation-only.

create or replace function private.policy_resolve_department_code(p_department text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_input text := nullif(pg_catalog.btrim(p_department), '');
  v_code text;
  v_match_count integer;
begin
  if v_input is null then
    raise exception 'Select an active department from the controlled directory';
  end if;

  select department.code
    into v_code
  from core.departments department
  where department.is_active
    and pg_catalog.lower(department.code) = pg_catalog.lower(v_input)
  limit 1;

  if v_code is not null then
    return v_code;
  end if;

  select pg_catalog.count(*)::integer, pg_catalog.min(department.code)
    into v_match_count, v_code
  from core.departments department
  where department.is_active
    and pg_catalog.lower(department.name) = pg_catalog.lower(v_input);

  if v_match_count = 1 then
    return v_code;
  end if;

  raise exception 'Select an active department from the controlled directory';
end;
$$;

-- Preserve the known legacy Legal label before the general directory match.
update procurement.doa_matrices
set department = 'legal_compliance',
    updated_at = pg_catalog.now()
where pg_catalog.lower(pg_catalog.btrim(department)) = 'legal';

update procurement.doa_matrices matrix
set department = department.code,
    updated_at = pg_catalog.now()
from core.departments department
where department.is_active
  and (
    pg_catalog.lower(department.code) = pg_catalog.lower(pg_catalog.btrim(matrix.department))
    or pg_catalog.lower(department.name) = pg_catalog.lower(pg_catalog.btrim(matrix.department))
  )
  and matrix.department is distinct from department.code;

do $$
begin
  if exists (
    select 1
    from procurement.doa_matrices matrix
    left join core.departments department
      on department.code = matrix.department
     and department.is_active
    where department.id is null
  ) then
    raise exception 'Every DOA matrix must use an active controlled department code';
  end if;
end;
$$;

update procurement.doa_assignments assignment
set department = matrix.department
from procurement.doa_matrices matrix
where matrix.id = assignment.matrix_id
  and assignment.department is distinct from matrix.department;

create or replace function private.canonicalize_doa_matrix_department()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.department := private.policy_resolve_department_code(new.department);
  return new;
end;
$$;

create or replace function private.synchronize_doa_assignment_department()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  select matrix.department
    into new.department
  from procurement.doa_matrices matrix
  where matrix.id = new.matrix_id;

  if new.department is null then
    raise exception 'A DOA assignment requires an existing matrix';
  end if;
  return new;
end;
$$;

drop trigger if exists canonicalize_doa_matrix_department
  on procurement.doa_matrices;
create trigger canonicalize_doa_matrix_department
before insert or update of department on procurement.doa_matrices
for each row execute function private.canonicalize_doa_matrix_department();

drop trigger if exists synchronize_doa_assignment_department
  on procurement.doa_assignments;
create trigger synchronize_doa_assignment_department
before insert or update of matrix_id, department on procurement.doa_assignments
for each row execute function private.synchronize_doa_assignment_department();

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
  v_assignments jsonb := pg_catalog.coalesce(payload->'assignments', '[]'::jsonb);
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
      pg_catalog.coalesce(nullif(pg_catalog.btrim(payload->>'source_document'), ''), 'Configured in Mwell Intra'),
      'Pending activation', pg_catalog.now(),
      pg_catalog.coalesce((payload->>'effective_at')::timestamptz, pg_catalog.now()),
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
      source_document = pg_catalog.coalesce(nullif(pg_catalog.btrim(payload->>'source_document'), ''), source_document),
      effective_at = pg_catalog.coalesce((payload->>'effective_at')::timestamptz, effective_at),
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

alter function private.policy_resolve_department_code(text) owner to postgres;
alter function private.canonicalize_doa_matrix_department() owner to postgres;
alter function private.synchronize_doa_assignment_department() owner to postgres;
alter function private.policy_save_doa_matrix(jsonb) owner to postgres;

revoke all on function private.policy_resolve_department_code(text)
  from public, anon, authenticated;
revoke all on function private.canonicalize_doa_matrix_department()
  from public, anon, authenticated;
revoke all on function private.synchronize_doa_assignment_department()
  from public, anon, authenticated;
revoke all on function private.policy_save_doa_matrix(jsonb)
  from public, anon, authenticated;
grant execute on function private.policy_resolve_department_code(text)
  to service_role;
grant execute on function private.policy_save_doa_matrix(jsonb)
  to service_role;
