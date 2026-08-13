-- Use one transaction timestamp for issued, effective, and created chronology.

create or replace function learning.evaluate_certifications()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile core.profiles%rowtype;
  v_audience text;
  v_assignment record;
  v_outcome record;
  v_requirement_ids uuid[];
  v_evidence jsonb;
  v_expires_at timestamptz;
  v_issued integer := 0;
  v_certifications jsonb;
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

  update learning.certifications certification
  set status = 'expired'
  where certification.user_id = v_user_id
    and certification.audience = v_audience
    and certification.status = 'active'
    and certification.expires_at is not null
    and certification.expires_at <= pg_catalog.statement_timestamp();

  for v_assignment in
    select
      assignment.*,
      role_assignment.module as source_module,
      role_assignment.role as source_role,
      role_assignment.id as exact_source_role_assignment_id,
      curriculum_version.expires_at as curriculum_expires_at
    from learning.assignments assignment
    join core.user_roles role_assignment
      on role_assignment.id = assignment.source_id
     and role_assignment.user_id = assignment.user_id
    join core.roles role_definition
      on role_definition.module = role_assignment.module
     and role_definition.role = role_assignment.role
     and role_definition.is_active
    join learning.role_curricula role_curriculum
      on role_curriculum.module = role_assignment.module
     and role_curriculum.role = role_assignment.role
     and role_curriculum.curriculum_version_id =
       assignment.curriculum_version_id
     and role_curriculum.audience = assignment.audience
     and (
       role_curriculum.department_id is null
       or role_curriculum.department_id = assignment.department_id
     )
     and role_curriculum.effective_at <= pg_catalog.statement_timestamp()
     and (
       role_curriculum.expires_at is null
       or role_curriculum.expires_at > pg_catalog.statement_timestamp()
     )
    join learning.curriculum_versions curriculum_version
      on curriculum_version.id = assignment.curriculum_version_id
     and curriculum_version.audience = assignment.audience
     and curriculum_version.status = 'published'
     and curriculum_version.effective_at <= pg_catalog.statement_timestamp()
     and (
       curriculum_version.expires_at is null
       or curriculum_version.expires_at > pg_catalog.statement_timestamp()
     )
    where assignment.user_id = v_user_id
      and assignment.profile_kind = v_profile.kind
      and assignment.audience = v_audience
      and assignment.source_type = 'role'
      and assignment.status = 'completed'
    order by assignment.id
  loop
    perform private.lock_learning_curriculum_graph(
      array[v_assignment.curriculum_version_id]
    );

    select pg_catalog.array_agg(
      assignment_requirement.requirement_version_id
      order by assignment_requirement.requirement_version_id
    )
    into v_requirement_ids
    from learning.assignment_requirements assignment_requirement
    join learning.curriculum_requirements curriculum_requirement
      on curriculum_requirement.curriculum_version_id =
        v_assignment.curriculum_version_id
     and curriculum_requirement.requirement_version_id =
        assignment_requirement.requirement_version_id
     and curriculum_requirement.audience = assignment_requirement.audience
    where assignment_requirement.assignment_id = v_assignment.id
      and assignment_requirement.user_id = v_user_id
      and assignment_requirement.audience = v_audience
      and assignment_requirement.status in ('passed', 'waived');

    if coalesce(pg_catalog.cardinality(v_requirement_ids), 0) = 0
       or exists (
         select 1
         from learning.curriculum_requirements mandatory_requirement
         where mandatory_requirement.curriculum_version_id =
             v_assignment.curriculum_version_id
           and mandatory_requirement.audience = v_audience
           and mandatory_requirement.mandatory
           and not mandatory_requirement.requirement_version_id =
             any(v_requirement_ids)
       ) then
      continue;
    end if;

    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'assignment_requirement_id', assignment_requirement.id,
          'requirement_version_id',
            assignment_requirement.requirement_version_id,
          'status', assignment_requirement.status,
          'attempt_ids', coalesce(attempt_evidence.ids, '[]'::jsonb),
          'acknowledgment_ids',
            coalesce(acknowledgment_evidence.ids, '[]'::jsonb)
        ) order by assignment_requirement.requirement_version_id
      ),
      '[]'::jsonb
    )
    into v_evidence
    from learning.assignment_requirements assignment_requirement
    left join lateral (
      select pg_catalog.jsonb_agg(attempt.id order by attempt.id) as ids
      from learning.attempts attempt
      where attempt.assignment_requirement_id = assignment_requirement.id
        and attempt.user_id = v_user_id
        and attempt.status = 'passed'
        and attempt.integrity_result = 'valid'
    ) attempt_evidence on true
    left join lateral (
      select pg_catalog.jsonb_agg(acknowledgment.id order by acknowledgment.id)
        as ids
      from learning.policy_acknowledgments acknowledgment
      where acknowledgment.assignment_requirement_id =
          assignment_requirement.id
        and acknowledgment.user_id = v_user_id
    ) acknowledgment_evidence on true
    where assignment_requirement.assignment_id = v_assignment.id
      and assignment_requirement.requirement_version_id =
        any(v_requirement_ids);

    select min(expiry)
    into v_expires_at
    from (
      select v_assignment.curriculum_expires_at as expiry
      union all
      select requirement_version.expires_at
      from learning.requirement_versions requirement_version
      where requirement_version.id = any(v_requirement_ids)
    ) expiry_candidates
    where expiry is not null;

    for v_outcome in
      select distinct
        outcome.module,
        outcome.capability
      from learning.curriculum_capability_outcomes outcome
      join core.role_capabilities role_capability
        on role_capability.module = v_assignment.source_module
       and role_capability.role = v_assignment.source_role
       and role_capability.cap = outcome.capability
       and outcome.module = v_assignment.source_module
      where outcome.curriculum_version_id =
          v_assignment.curriculum_version_id
        and outcome.audience = v_audience
        and outcome.requirement_version_id = any(v_requirement_ids)
      order by outcome.module, outcome.capability
    loop
      insert into learning.certifications(
        user_id,
        department_id,
        audience,
        assignment_id,
        source_role_assignment_id,
        source_role,
        module,
        capability,
        curriculum_version_id,
        requirement_version_ids,
        status,
        issued_at,
        effective_at,
        expires_at,
        issued_by,
        policy_version,
        evidence_references
      ) values (
        v_user_id,
        v_assignment.department_id,
        v_audience,
        v_assignment.id,
        v_assignment.exact_source_role_assignment_id,
        v_assignment.source_role,
        v_outcome.module,
        v_outcome.capability,
        v_assignment.curriculum_version_id,
        v_requirement_ids,
        'active',
        pg_catalog.now(),
        pg_catalog.now(),
        v_expires_at,
        'learning.evaluate_certifications',
        null,
        v_evidence
      )
      on conflict (
        user_id,
        department_id,
        module,
        capability,
        source_role_assignment_id
      ) where status = 'active'
      do nothing;
      if found then
        v_issued := v_issued + 1;
      end if;
    end loop;
  end loop;

  insert into core.activity_log(
    module, entity_type, entity_id, action, actor, detail
  ) values (
    'learning', 'learning_profile', v_user_id,
    'certifications_evaluated', v_user_id,
    pg_catalog.jsonb_build_object(
      'audience', v_audience,
      'certifications_issued', v_issued
    )
  );

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(certification)
      order by certification.module, certification.capability,
        certification.issued_at),
    '[]'::jsonb
  )
  into v_certifications
  from learning.certifications certification
  where certification.user_id = v_user_id
    and certification.audience = v_audience
    and certification.status = 'active'
    and certification.effective_at <= pg_catalog.statement_timestamp()
    and (
      certification.expires_at is null
      or certification.expires_at > pg_catalog.statement_timestamp()
    );

  return v_certifications;
end;
$$;

alter function learning.evaluate_certifications() owner to postgres;
revoke all on function learning.evaluate_certifications()
  from public, anon, authenticated, service_role;
grant execute on function learning.evaluate_certifications()
  to authenticated, service_role;
