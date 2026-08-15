-- Resolve vendor curricula under Legal governance without granting vendors an
-- internal department scope. Also retire learning assignments whose source
-- role is no longer effective before authority is evaluated.

create or replace function private.cancel_ineffective_learning_role_assignments()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_cancelled integer := 0;
begin
  perform private.assert_learning_read_committed();
  if v_user_id is null then
    raise exception 'Authentication is required for learning services'
      using errcode = '28000';
  end if;

  update learning.assignments assignment
  set status = 'cancelled',
      blocked_reason = null
  where assignment.user_id = v_user_id
    and assignment.source_type = 'role'
    and assignment.status in ('assigned', 'in_progress', 'blocked')
    and not exists (
      select 1
      from core.user_roles role_assignment
      join core.roles role_definition
        on role_definition.module = role_assignment.module
       and role_definition.role = role_assignment.role
       and role_definition.is_active
      where role_assignment.id = assignment.source_id
        and role_assignment.user_id = assignment.user_id
        and role_assignment.effective_at <= pg_catalog.statement_timestamp()
        and (
          role_assignment.expires_at is null
          or role_assignment.expires_at > pg_catalog.statement_timestamp()
        )
    );
  get diagnostics v_cancelled = row_count;
  return v_cancelled;
end;
$$;

create or replace function private.resolve_vendor_learning_assignments()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile core.profiles%rowtype;
  v_legal_department_id uuid;
  v_inserted integer := 0;
  v_requirements integer := 0;
begin
  perform private.assert_learning_read_committed();
  if v_user_id is null then
    raise exception 'Authentication is required for learning services'
      using errcode = '28000';
  end if;

  select profile.*
  into v_profile
  from core.profiles profile
  where profile.id = v_user_id
    and profile.status = 'active'
  for update;

  if not found or v_profile.kind <> 'vendor' then
    return pg_catalog.jsonb_build_object(
      'assignments_created', 0,
      'requirements_created', 0
    );
  end if;

  select department.id
  into v_legal_department_id
  from core.departments department
  where department.code = 'legal_compliance'
    and department.is_active;
  if v_legal_department_id is null then
    raise exception 'An active Legal & Compliance department is required for vendor learning';
  end if;

  insert into learning.assignments(
    user_id,
    profile_kind,
    department_id,
    curriculum_version_id,
    audience,
    source_type,
    source_id,
    status,
    assigned_by
  )
  select
    v_user_id,
    'vendor',
    v_legal_department_id,
    role_curriculum.curriculum_version_id,
    'vendor',
    'role',
    role_assignment.id,
    'assigned',
    v_user_id
  from core.user_roles role_assignment
  join core.roles role_definition
    on role_definition.module = role_assignment.module
   and role_definition.role = role_assignment.role
   and role_definition.is_active
  join learning.role_curricula role_curriculum
    on role_curriculum.module = role_assignment.module
   and role_curriculum.role = role_assignment.role
   and role_curriculum.audience = 'vendor'
   and role_curriculum.department_id is null
   and role_curriculum.effective_at <= pg_catalog.statement_timestamp()
   and (
     role_curriculum.expires_at is null
     or role_curriculum.expires_at > pg_catalog.statement_timestamp()
   )
  join learning.curriculum_versions curriculum_version
    on curriculum_version.id = role_curriculum.curriculum_version_id
   and curriculum_version.audience = 'vendor'
   and curriculum_version.status = 'published'
   and curriculum_version.effective_at <= pg_catalog.statement_timestamp()
   and (
     curriculum_version.expires_at is null
     or curriculum_version.expires_at > pg_catalog.statement_timestamp()
   )
  where role_assignment.user_id = v_user_id
    and role_assignment.effective_at <= pg_catalog.statement_timestamp()
    and (
      role_assignment.expires_at is null
      or role_assignment.expires_at > pg_catalog.statement_timestamp()
    )
    and not exists (
      select 1
      from learning.assignments existing_assignment
      where existing_assignment.user_id = v_user_id
        and existing_assignment.curriculum_version_id =
          role_curriculum.curriculum_version_id
        and existing_assignment.source_type = 'role'
        and existing_assignment.source_id = role_assignment.id
    )
  on conflict (user_id, curriculum_version_id, source_type, source_id)
    where status in ('assigned', 'in_progress', 'blocked')
    do nothing;
  get diagnostics v_inserted = row_count;

  insert into learning.assignment_requirements(
    assignment_id,
    user_id,
    department_id,
    audience,
    requirement_version_id,
    status
  )
  select
    assignment.id,
    assignment.user_id,
    assignment.department_id,
    assignment.audience,
    curriculum_requirement.requirement_version_id,
    'not_started'
  from learning.assignments assignment
  join learning.curriculum_requirements curriculum_requirement
    on curriculum_requirement.curriculum_version_id = assignment.curriculum_version_id
   and curriculum_requirement.audience = assignment.audience
  join learning.requirement_versions requirement_version
    on requirement_version.id = curriculum_requirement.requirement_version_id
   and requirement_version.audience = curriculum_requirement.audience
   and requirement_version.status = 'published'
   and requirement_version.effective_at <= pg_catalog.statement_timestamp()
   and (
     requirement_version.expires_at is null
     or requirement_version.expires_at > pg_catalog.statement_timestamp()
   )
  where assignment.user_id = v_user_id
    and assignment.audience = 'vendor'
    and assignment.status in ('assigned', 'in_progress', 'blocked')
  on conflict (assignment_id, requirement_version_id) do nothing;
  get diagnostics v_requirements = row_count;

  if v_inserted > 0 or v_requirements > 0 then
    insert into core.activity_log(
      module, entity_type, entity_id, action, actor, detail
    ) values (
      'learning',
      'learning_profile',
      v_user_id,
      'vendor_assignments_resolved',
      v_user_id,
      pg_catalog.jsonb_build_object(
        'governance_department_id', v_legal_department_id,
        'assignments_created', v_inserted,
        'requirements_created', v_requirements
      )
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'assignments_created', v_inserted,
    'requirements_created', v_requirements
  );
end;
$$;

create or replace function learning.resolve_assignments()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_learning_read_committed();
  perform private.resolve_assignments_base();
  perform private.cancel_ineffective_learning_role_assignments();
  perform private.resolve_vendor_learning_assignments();
  perform learning.sync_shared_completions();
  return learning.my_learning_snapshot();
end;
$$;

alter function private.cancel_ineffective_learning_role_assignments() owner to postgres;
alter function private.resolve_vendor_learning_assignments() owner to postgres;
alter function learning.resolve_assignments() owner to postgres;

revoke all on function private.cancel_ineffective_learning_role_assignments()
  from public, anon, authenticated, service_role;
revoke all on function private.resolve_vendor_learning_assignments()
  from public, anon, authenticated, service_role;
revoke all on function learning.resolve_assignments()
  from public, anon, authenticated, service_role;
grant execute on function learning.resolve_assignments()
  to authenticated, service_role;
