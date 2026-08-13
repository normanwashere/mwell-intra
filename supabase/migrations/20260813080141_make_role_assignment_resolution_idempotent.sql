-- Do not recreate normal role assignments after they reach a terminal status.

create or replace function private.resolve_assignments_base()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile core.profiles%rowtype;
  v_audience text;
  v_inserted integer := 0;
  v_cancelled integer := 0;
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
  if not found or v_profile.kind not in ('employee', 'vendor') then
    raise exception 'An active employee or vendor profile is required';
  end if;
  v_audience := case v_profile.kind
    when 'employee' then 'internal'
    else 'vendor'
  end;

  perform 1
  from core.roles role_definition
  join core.user_roles role_assignment
    on role_assignment.module = role_definition.module
   and role_assignment.role = role_definition.role
  where role_assignment.user_id = v_user_id
    and role_definition.is_active
  order by role_definition.module, role_definition.role
  for share of role_definition;

  perform 1
  from core.user_roles role_assignment
  where role_assignment.user_id = v_user_id
  order by role_assignment.module, role_assignment.role, role_assignment.id
  for key share;

  perform 1
  from learning.assignments assignment
  where assignment.user_id = v_user_id
  order by assignment.id
  for update;

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
      join learning.role_curricula role_curriculum
        on role_curriculum.module = role_assignment.module
       and role_curriculum.role = role_assignment.role
       and role_curriculum.curriculum_version_id = assignment.curriculum_version_id
       and role_curriculum.audience = assignment.audience
      where role_assignment.id = assignment.source_id
        and role_assignment.user_id = assignment.user_id
        and role_curriculum.effective_at <= pg_catalog.statement_timestamp()
        and (
          role_curriculum.expires_at is null
          or role_curriculum.expires_at > pg_catalog.statement_timestamp()
        )
    );
  get diagnostics v_cancelled = row_count;

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
    v_profile.kind,
    effective_scope.department_id,
    role_curriculum.curriculum_version_id,
    role_curriculum.audience,
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
   and role_curriculum.audience = v_audience
   and role_curriculum.effective_at <= pg_catalog.statement_timestamp()
   and (
     role_curriculum.expires_at is null
     or role_curriculum.expires_at > pg_catalog.statement_timestamp()
   )
  join learning.curriculum_versions curriculum_version
    on curriculum_version.id = role_curriculum.curriculum_version_id
   and curriculum_version.audience = role_curriculum.audience
   and curriculum_version.status = 'published'
   and curriculum_version.effective_at <= pg_catalog.statement_timestamp()
   and (
     curriculum_version.expires_at is null
     or curriculum_version.expires_at > pg_catalog.statement_timestamp()
   )
  join lateral (
    select scope.department_id
    from core.profile_department_scopes scope
    join core.departments department on department.id = scope.department_id
    where scope.profile_id = v_user_id
      and department.is_active
      and scope.effective_from <= current_date
      and (scope.effective_to is null or scope.effective_to >= current_date)
      and (
        role_curriculum.department_id is null
        or role_curriculum.department_id = scope.department_id
      )
    order by
      (scope.scope_type = 'primary') desc,
      (scope.scope_type = 'member') desc,
      scope.effective_from desc,
      scope.id
    limit 1
  ) effective_scope on true
  where role_assignment.user_id = v_user_id
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
    and assignment.audience = v_audience
    and assignment.status in ('assigned', 'in_progress', 'blocked')
  on conflict (assignment_id, requirement_version_id) do nothing;
  get diagnostics v_requirements = row_count;

  insert into core.activity_log(
    module, entity_type, entity_id, action, actor, detail
  ) values (
    'learning',
    'learning_profile',
    v_user_id,
    'assignments_resolved',
    v_user_id,
    pg_catalog.jsonb_build_object(
      'audience', v_audience,
      'assignments_created', v_inserted,
      'assignments_cancelled', v_cancelled,
      'requirements_created', v_requirements
    )
  );

  return learning.my_learning_snapshot();
end;
$$;

revoke all on function private.resolve_assignments_base()
  from public, anon, authenticated, service_role;
