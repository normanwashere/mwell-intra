-- Qualify UUID-array evidence to avoid collisions with nested requirement columns.

create or replace function private.validate_certification_issuance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  assignment learning.assignments%rowtype;
  profile core.profiles%rowtype;
begin
  perform private.assert_learning_read_committed();

  select candidate.* into assignment
  from learning.assignments candidate
  where candidate.id = new.assignment_id
    and candidate.user_id = new.user_id
    and candidate.department_id = new.department_id
    and candidate.audience = new.audience
    and candidate.curriculum_version_id = new.curriculum_version_id
    and candidate.source_type = 'role'
    and candidate.source_id = new.source_role_assignment_id
    and candidate.status = 'completed';
  if not found then
    raise exception 'Certification assignment and curriculum lineage is invalid';
  end if;

  select candidate.* into profile
  from core.profiles candidate
  where candidate.id = new.user_id;
  if profile.id is null
     or profile.status <> 'active'
     or (profile.kind = 'employee' and new.audience <> 'internal')
     or (profile.kind = 'vendor' and new.audience <> 'vendor')
     or profile.kind not in ('employee', 'vendor') then
    raise exception 'Certification beneficiary must be active in the matching audience';
  end if;

  perform 1
    from core.user_roles role_assignment
    join core.roles role_definition
      on role_definition.module = role_assignment.module
     and role_definition.role = role_assignment.role
     and role_definition.is_active
    where role_assignment.id = new.source_role_assignment_id
      and role_assignment.user_id = new.user_id
      and role_assignment.module = new.module
      and role_assignment.role = new.source_role
    for key share of role_assignment;
  if not found then
    raise exception 'Certification source role assignment is not active';
  end if;

  perform private.lock_learning_curriculum_graph(
    array[new.curriculum_version_id]
  );

  if not exists (
    select 1
    from core.role_capabilities role_capability
    where role_capability.module = new.module
      and role_capability.role = new.source_role
      and role_capability.cap = new.capability
  ) then
    raise exception 'Certification capability is not granted by the source role';
  end if;

  if not exists (
    select 1
    from learning.role_curricula role_curriculum
    where role_curriculum.module = new.module
      and role_curriculum.role = new.source_role
      and role_curriculum.curriculum_version_id = new.curriculum_version_id
      and role_curriculum.audience = new.audience
      and (
        role_curriculum.department_id is null
        or role_curriculum.department_id = new.department_id
      )
      and role_curriculum.effective_at <= new.effective_at
      and (
        role_curriculum.expires_at is null
        or role_curriculum.expires_at > new.effective_at
      )
  ) then
    raise exception 'Certification curriculum is not assigned to the source role';
  end if;

  if not exists (
    select 1
    from learning.curriculum_versions curriculum_version
    where curriculum_version.id = new.curriculum_version_id
      and curriculum_version.audience = new.audience
      and curriculum_version.status = 'published'
      and curriculum_version.effective_at <= new.effective_at
      and (
        curriculum_version.expires_at is null
        or curriculum_version.expires_at > new.effective_at
      )
  ) then
    raise exception 'Certification curriculum must be published and effective';
  end if;

  if cardinality(new.requirement_version_ids) < 1
     or cardinality(new.requirement_version_ids) <> (
       select count(distinct evidence.requirement_id)
       from pg_catalog.unnest(new.requirement_version_ids) as evidence(requirement_id)
     ) then
    raise exception 'Certification requirement evidence must be non-empty and unique';
  end if;

  perform 1
  from learning.requirement_versions requirement_version
  where requirement_version.id = any(new.requirement_version_ids)
  order by requirement_version.id
  for share;

  if exists (
    select 1
    from pg_catalog.unnest(new.requirement_version_ids) as evidence(requirement_id)
    where not exists (
      select 1
      from learning.curriculum_requirements curriculum_requirement
      join learning.requirement_versions requirement_version
        on requirement_version.id = curriculum_requirement.requirement_version_id
       and requirement_version.audience = curriculum_requirement.audience
      where curriculum_requirement.curriculum_version_id = new.curriculum_version_id
        and curriculum_requirement.requirement_version_id = evidence.requirement_id
        and curriculum_requirement.audience = new.audience
        and requirement_version.status = 'published'
        and requirement_version.effective_at <= new.effective_at
        and (
          requirement_version.expires_at is null
          or requirement_version.expires_at > new.effective_at
        )
    )
  ) then
    raise exception 'Certification includes an unpublished, expired, or unrelated requirement version';
  end if;

  if not exists (
    select 1
    from learning.curriculum_capability_outcomes outcome
    where outcome.curriculum_version_id = new.curriculum_version_id
      and outcome.requirement_version_id = any(new.requirement_version_ids)
      and outcome.audience = new.audience
      and outcome.module = new.module
      and outcome.capability = new.capability
  ) then
    raise exception 'Certified capability is not a declared curriculum outcome';
  end if;

  if exists (
    select 1
    from learning.curriculum_requirement_prerequisites prerequisite
    where prerequisite.curriculum_version_id = new.curriculum_version_id
      and prerequisite.audience = new.audience
      and prerequisite.requirement_version_id = any(new.requirement_version_ids)
      and not prerequisite.prerequisite_requirement_version_id = any(new.requirement_version_ids)
  ) then
    raise exception 'Certification omits a prerequisite requirement';
  end if;

  if exists (
    select 1
    from learning.curriculum_requirements curriculum_requirement
    where curriculum_requirement.curriculum_version_id = new.curriculum_version_id
      and curriculum_requirement.audience = new.audience
      and curriculum_requirement.mandatory
      and not curriculum_requirement.requirement_version_id = any(new.requirement_version_ids)
  ) then
    raise exception 'Certification omits a mandatory curriculum requirement';
  end if;

  if exists (
    select 1
    from pg_catalog.unnest(new.requirement_version_ids) as evidence(requirement_id)
    where not exists (
      select 1
      from learning.assignment_requirements assignment_requirement
      where assignment_requirement.assignment_id = new.assignment_id
        and assignment_requirement.user_id = new.user_id
        and assignment_requirement.department_id = new.department_id
        and assignment_requirement.audience = new.audience
        and assignment_requirement.requirement_version_id = evidence.requirement_id
        and assignment_requirement.status in ('passed', 'waived')
    )
  ) then
    raise exception 'Certification requirement evidence is incomplete';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_certification_issuance()
  from public, anon, authenticated, service_role;
