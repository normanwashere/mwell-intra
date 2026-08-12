-- Align the public learning snapshot with the stable TypeScript domain contract.
-- This is forward-only because 20260812160000 may already exist in shared UAT.

create or replace function learning.my_learning_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_kind text;
  v_audience text;
  v_curricula jsonb;
  v_progress jsonb;
  v_certifications jsonb;
  v_locked_capabilities jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication is required for learning services'
      using errcode = '28000';
  end if;

  select profile.kind
  into v_profile_kind
  from core.profiles profile
  where profile.id = v_user_id
    and profile.status = 'active';

  v_audience := case v_profile_kind
    when 'employee' then 'internal'
    when 'vendor' then 'vendor'
    else null
  end;
  if v_audience is null then
    raise exception 'An active employee or vendor profile is required';
  end if;

  select coalesce(pg_catalog.jsonb_agg(curriculum_row.value order by curriculum_row.sort_at, curriculum_row.assignment_id), '[]'::jsonb)
  into v_curricula
  from (
    select
      assignment.id as assignment_id,
      assignment.assigned_at as sort_at,
      pg_catalog.jsonb_build_object(
        'curriculum', pg_catalog.jsonb_build_object(
          'id', curriculum.catalog_key,
          'version', curriculum_version.version,
          'personaId', case
            when assignment.source_type <> 'role' then curriculum.catalog_key
            else case role_assignment.module || ':' || role_assignment.role
              when 'core:platform_admin' then 'platform_administrator'
              when 'core:staff' then 'general_employee'
              when 'core:vendor_portal' then 'vendor_representative'
              when 'warehouse:warehouse_operator' then 'operations_associate'
              when 'warehouse:warehouse_supervisor' then 'operations_lead'
              when 'warehouse:logistics_supervisor' then 'operations_lead'
              when 'warehouse:operations' then 'general_employee'
              when 'warehouse:finance' then 'finance_controller'
              when 'warehouse:bi_analyst' then 'leadership_insights'
              when 'warehouse:business_unit' then 'general_employee'
              when 'warehouse:marketing' then 'marketing_events_lead'
              when 'warehouse:procurement' then 'procurement_lead'
              when 'warehouse:pricing' then 'product_owner'
              when 'warehouse:warehouse_admin' then 'operations_lead'
              when 'procurement:requester' then 'general_employee'
              when 'procurement:procurement_officer' then 'procurement_lead'
              when 'procurement:approver' then 'operations_lead'
              when 'procurement:finance' then 'finance_controller'
              when 'procurement:admin' then 'procurement_lead'
              when 'legal:legal_reviewer' then 'legal_compliance_lead'
              when 'legal:compliance' then 'legal_compliance_lead'
              when 'legal:admin' then 'legal_compliance_lead'
              when 'events:requester' then 'general_employee'
              when 'events:coordinator' then 'marketing_events_lead'
              when 'events:viewer' then 'leadership_insights'
              when 'events:finance_reviewer' then 'finance_controller'
              when 'events:admin' then 'marketing_events_lead'
              when 'insights:analyst' then 'leadership_insights'
              when 'insights:manager' then 'leadership_insights'
              when 'insights:executive' then 'leadership_insights'
              when 'insights:admin' then 'leadership_insights'
              when 'product:contributor' then 'product_owner'
              when 'product:product_owner' then 'product_owner'
              when 'product:operations_partner' then 'operations_lead'
              else null
            end
          end,
          'audience', assignment.audience,
          'requirementIds', coalesce(requirement_rows.requirement_ids, '[]'::jsonb)
        ),
        'requirements', coalesce(requirement_rows.requirements, '[]'::jsonb),
        'source', case assignment.source_type
          when 'role' then 'role'
          when 'department' then 'department'
          else 'assignment'
        end
      ) as value
    from learning.assignments assignment
    join learning.curriculum_versions curriculum_version
      on curriculum_version.id = assignment.curriculum_version_id
     and curriculum_version.audience = assignment.audience
    join learning.curricula curriculum
      on curriculum.id = curriculum_version.curriculum_id
     and curriculum.audience = curriculum_version.audience
    left join core.user_roles role_assignment
      on assignment.source_type = 'role'
     and role_assignment.id = assignment.source_id
     and role_assignment.user_id = assignment.user_id
    left join lateral (
      select
        pg_catalog.jsonb_agg(requirement.requirement_key order by curriculum_requirement.sort_order) as requirement_ids,
        pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', requirement.requirement_key,
            'version', requirement_version.version,
            'audience', requirement_version.audience,
            'kind', requirement_version.requirement_kind,
            'title', requirement_version.title,
            'mandatory', curriculum_requirement.mandatory,
            'prerequisiteIds', coalesce(prerequisite_rows.ids, '[]'::jsonb),
            'capabilityOutcomes', coalesce(outcome_rows.outcomes, '[]'::jsonb),
            'simulationId', requirement_version.simulation_id,
            'passingScore', requirement_version.passing_score,
            'maxAttempts', requirement_version.max_attempts
          ) order by curriculum_requirement.sort_order
        ) as requirements
      from learning.curriculum_requirements curriculum_requirement
      join learning.requirement_versions requirement_version
        on requirement_version.id = curriculum_requirement.requirement_version_id
       and requirement_version.audience = curriculum_requirement.audience
      join learning.requirements requirement
        on requirement.id = requirement_version.requirement_id
       and requirement.audience = requirement_version.audience
      left join lateral (
        select pg_catalog.jsonb_agg(prerequisite_requirement.requirement_key order by prerequisite_requirement.requirement_key) as ids
        from learning.curriculum_requirement_prerequisites prerequisite
        join learning.requirement_versions prerequisite_version
          on prerequisite_version.id = prerequisite.prerequisite_requirement_version_id
         and prerequisite_version.audience = prerequisite.audience
        join learning.requirements prerequisite_requirement
          on prerequisite_requirement.id = prerequisite_version.requirement_id
         and prerequisite_requirement.audience = prerequisite_version.audience
        where prerequisite.curriculum_version_id = curriculum_requirement.curriculum_version_id
          and prerequisite.requirement_version_id = curriculum_requirement.requirement_version_id
          and prerequisite.audience = curriculum_requirement.audience
      ) prerequisite_rows on true
      left join lateral (
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object('module', outcome.module, 'capability', outcome.capability)
          order by outcome.module, outcome.capability
        ) as outcomes
        from learning.curriculum_capability_outcomes outcome
        where outcome.curriculum_requirement_id = curriculum_requirement.id
      ) outcome_rows on true
      where curriculum_requirement.curriculum_version_id = assignment.curriculum_version_id
        and curriculum_requirement.audience = assignment.audience
    ) requirement_rows on true
    where assignment.user_id = v_user_id
      and assignment.profile_kind = v_profile_kind
      and assignment.audience = v_audience
      and assignment.status not in ('cancelled', 'superseded')
  ) curriculum_row;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'assignmentRequirementId', assignment_requirement.id,
      'requirementId', requirement.requirement_key,
      'requirementVersion', requirement_version.version,
      'state', assignment_requirement.status,
      'attemptCount', assignment_requirement.attempt_count,
      'activeAttempt', active_attempt.value,
      'completedAt', assignment_requirement.completed_at,
      'updatedAt', greatest(
        assignment_requirement.created_at,
        coalesce(assignment_requirement.started_at, assignment_requirement.created_at),
        coalesce(assignment_requirement.completed_at, assignment_requirement.created_at)
      )
    ) order by assignment.assigned_at, curriculum_requirement.sort_order
  ), '[]'::jsonb)
  into v_progress
  from learning.assignment_requirements assignment_requirement
  join learning.assignments assignment
    on assignment.id = assignment_requirement.assignment_id
  join learning.requirement_versions requirement_version
    on requirement_version.id = assignment_requirement.requirement_version_id
   and requirement_version.audience = assignment_requirement.audience
  join learning.requirements requirement
    on requirement.id = requirement_version.requirement_id
   and requirement.audience = requirement_version.audience
  join learning.curriculum_requirements curriculum_requirement
    on curriculum_requirement.curriculum_version_id = assignment.curriculum_version_id
   and curriculum_requirement.requirement_version_id = assignment_requirement.requirement_version_id
   and curriculum_requirement.audience = assignment_requirement.audience
  left join lateral (
    select pg_catalog.jsonb_build_object(
      'id', attempt.id,
      'attemptNumber', attempt.attempt_number,
      'mode', attempt.mode,
      'startedAt', attempt.started_at
    ) as value
    from learning.attempts attempt
    where attempt.assignment_requirement_id = assignment_requirement.id
      and attempt.user_id = v_user_id
      and attempt.audience = v_audience
      and attempt.status = 'in_progress'
    order by attempt.attempt_number desc
    limit 1
  ) active_attempt on true
  where assignment_requirement.user_id = v_user_id
    and assignment_requirement.audience = v_audience
    and assignment.status not in ('cancelled', 'superseded');

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', certification.id,
      'userId', certification.user_id,
      'departmentId', certification.department_id,
      'sourceRoleAssignmentId', certification.source_role_assignment_id,
      'capability', pg_catalog.jsonb_build_object('module', certification.module, 'capability', certification.capability),
      'curriculumId', curriculum.catalog_key,
      'curriculumVersion', curriculum_version.version,
      'requirementIds', coalesce(requirement_rows.ids, '[]'::jsonb),
      'issuedAt', certification.issued_at,
      'effectiveAt', certification.effective_at,
      'expiresAt', certification.expires_at,
      'revokedAt', certification.revoked_at,
      'supersededAt', certification.superseded_at,
      'issuedBy', certification.issued_by,
      'policyVersion', certification.policy_version
    ) order by certification.issued_at desc, certification.id
  ), '[]'::jsonb)
  into v_certifications
  from learning.certifications certification
  join learning.curriculum_versions curriculum_version
    on curriculum_version.id = certification.curriculum_version_id
   and curriculum_version.audience = certification.audience
  join learning.curricula curriculum
    on curriculum.id = curriculum_version.curriculum_id
   and curriculum.audience = curriculum_version.audience
  left join lateral (
    select pg_catalog.jsonb_agg(requirement.requirement_key order by requirement.requirement_key) as ids
    from unnest(certification.requirement_version_ids)
      as requirement_evidence(requirement_version_id)
    join learning.requirement_versions requirement_version
      on requirement_version.id = requirement_evidence.requirement_version_id
    join learning.requirements requirement
      on requirement.id = requirement_version.requirement_id
     and requirement.audience = requirement_version.audience
  ) requirement_rows on true
  where certification.user_id = v_user_id
    and certification.audience = v_audience;

  select coalesce(pg_catalog.jsonb_agg(lock_row.value order by lock_row.module, lock_row.capability), '[]'::jsonb)
  into v_locked_capabilities
  from (
    select
      outcome.module,
      outcome.capability,
      pg_catalog.jsonb_build_object(
        'capability', pg_catalog.jsonb_build_object('module', outcome.module, 'capability', outcome.capability),
        'reason', case
          when assignment.source_type = 'retraining' then 'retraining_required'
          when exists (
            select 1 from learning.certifications expired
            where expired.user_id = assignment.user_id
              and expired.source_role_assignment_id = assignment.source_id
              and expired.module = outcome.module
              and expired.capability = outcome.capability
              and expired.status = 'expired'
          ) then 'expired_certification'
          else 'missing_certification'
        end,
        'requirementIds', pg_catalog.jsonb_agg(distinct requirement.requirement_key),
        'canRequestEmergencyException', assignment.audience = 'internal'
      ) as value
    from learning.assignments assignment
    join learning.curriculum_capability_outcomes outcome
      on outcome.curriculum_version_id = assignment.curriculum_version_id
     and outcome.audience = assignment.audience
    join learning.requirement_versions requirement_version
      on requirement_version.id = outcome.requirement_version_id
    join learning.requirements requirement
      on requirement.id = requirement_version.requirement_id
     and requirement.audience = requirement_version.audience
    where assignment.user_id = v_user_id
      and assignment.audience = v_audience
      and assignment.status not in ('cancelled', 'superseded')
      and not exists (
        select 1
        from learning.certifications active
        where active.user_id = assignment.user_id
          and active.source_role_assignment_id = assignment.source_id
          and active.module = outcome.module
          and active.capability = outcome.capability
          and active.status = 'active'
          and active.effective_at <= pg_catalog.statement_timestamp()
          and (active.expires_at is null or active.expires_at > pg_catalog.statement_timestamp())
      )
    group by assignment.id, assignment.source_type, assignment.source_id,
      assignment.user_id, assignment.audience, outcome.module, outcome.capability
  ) lock_row;

  return pg_catalog.jsonb_build_object(
    'curricula', v_curricula,
    'progress', v_progress,
    'certifications', v_certifications,
    'lockedCapabilities', v_locked_capabilities,
    'refreshedAt', pg_catalog.statement_timestamp()
  );
end;
$$;

alter function learning.my_learning_snapshot() owner to postgres;
revoke all on function learning.my_learning_snapshot()
  from public, anon, authenticated, service_role;
grant execute on function learning.my_learning_snapshot()
  to authenticated, service_role;
