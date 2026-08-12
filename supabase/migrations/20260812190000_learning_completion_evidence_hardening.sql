-- Forward-only completion and certification evidence hardening.
-- Upgrades databases that already recorded the initial completion alignment.

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
      'allowsSharedCompletion', assignment.source_type not in (
        'retraining', 'corrective'
      ),
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
          when assignment.source_type in ('retraining', 'corrective')
            then 'retraining_required'
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
      and (
        (
          assignment.source_type = 'role'
          and assignment.status not in ('cancelled', 'superseded')
        )
        or (
          assignment.source_type <> 'role'
          and assignment.status in ('assigned', 'in_progress', 'blocked', 'expired')
        )
      )
      and (
        assignment.source_type in ('retraining', 'corrective')
        or not exists (
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

-- Converge immutable shared requirement completion across compatible assignments.
-- The caller's active profile row serializes syncs before assignment evidence locks.

create or replace function learning.sync_shared_completions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile core.profiles%rowtype;
  v_audience text;
  v_source record;
  v_target record;
  v_propagated integer := 0;
  v_now timestamptz;
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

  for v_source in
    select distinct on (source_requirement.requirement_version_id)
      coalesce(
        nullif(
          source_requirement.progress->>'shared_completion_source_id',
          ''
        )::uuid,
        source_requirement.id
      ) as id,
      source_requirement.requirement_version_id,
      source_requirement.completed_at
    from learning.assignment_requirements source_requirement
    join learning.assignments source_assignment
      on source_assignment.id = source_requirement.assignment_id
     and source_assignment.user_id = source_requirement.user_id
     and source_assignment.audience = source_requirement.audience
    where source_requirement.user_id = v_user_id
      and source_requirement.audience = v_audience
      and source_requirement.status = 'passed'
      and source_assignment.source_type not in ('retraining', 'corrective')
      and source_assignment.status not in ('cancelled', 'superseded')
    order by source_requirement.requirement_version_id,
      source_requirement.completed_at,
      source_requirement.id
  loop
    for v_target in
      select
        target_requirement.id,
        target_requirement.assignment_id,
        target_requirement.status
      from learning.assignment_requirements target_requirement
      join learning.assignments target_assignment
        on target_assignment.id = target_requirement.assignment_id
       and target_assignment.user_id = target_requirement.user_id
       and target_assignment.audience = target_requirement.audience
      where target_requirement.user_id = v_user_id
        and target_requirement.audience = v_audience
        and target_requirement.requirement_version_id =
          v_source.requirement_version_id
        and target_requirement.id <> v_source.id
        and target_requirement.status in (
          'not_started', 'in_progress', 'failed_retryable', 'needs_support'
        )
        and target_assignment.source_type not in ('retraining', 'corrective')
        and target_assignment.status in ('assigned', 'in_progress')
      order by target_assignment.id, target_requirement.id
      for update of target_assignment, target_requirement
    loop
      v_now := pg_catalog.clock_timestamp();

      update learning.assignments
      set status = 'in_progress',
          started_at = coalesce(started_at, v_now),
          blocked_reason = null
      where id = v_target.assignment_id
        and status = 'assigned';

      insert into learning.attempt_events(
        attempt_id,
        user_id,
        department_id,
        audience,
        event_type,
        actor_id,
        evidence_hash,
        detail,
        idempotency_key
      )
      select
        attempt.id,
        attempt.user_id,
        attempt.department_id,
        attempt.audience,
        'recovery',
        v_user_id,
        pg_catalog.encode(
          public.digest(
            pg_catalog.convert_to(
              attempt.id::text || ':' || v_source.id::text,
              'UTF8'
            ),
            'sha256'
          ),
          'hex'
        ),
        pg_catalog.jsonb_build_object(
          'reason', 'shared_completion_superseded_attempt',
          'source_assignment_requirement_id', v_source.id,
          'target_assignment_requirement_id', v_target.id
        ),
        pg_catalog.gen_random_uuid()
      from learning.attempts attempt
      where attempt.assignment_requirement_id = v_target.id
        and attempt.user_id = v_user_id
        and attempt.status = 'in_progress'
      on conflict (attempt_id, idempotency_key) do nothing;

      update learning.attempts
      set status = 'abandoned',
          integrity_result = 'valid',
          completed_at = v_now
      where assignment_requirement_id = v_target.id
        and user_id = v_user_id
        and status = 'in_progress';

      if v_target.status <> 'in_progress' then
        update learning.assignment_requirements
        set status = 'in_progress',
            started_at = coalesce(started_at, v_now),
            completed_at = null
        where id = v_target.id;
      end if;

      update learning.assignment_requirements
      set status = 'passed',
          completed_at = v_now,
          progress = progress || pg_catalog.jsonb_build_object(
            'shared_completion_source_id', v_source.id,
            'shared_completion_propagated_at', v_now
          )
      where id = v_target.id;

      insert into core.activity_log(
        module, entity_type, entity_id, action, actor, detail
      ) values (
        'learning', 'assignment_requirement', v_target.id,
        'shared_completion_propagated', v_user_id,
        pg_catalog.jsonb_build_object(
          'source_assignment_requirement_id', v_source.id,
          'requirement_version_id', v_source.requirement_version_id,
          'previous_status', v_target.status
        )
      );

      update learning.assignments target_assignment
      set status = 'completed',
          completed_at = v_now,
          blocked_reason = null
      where target_assignment.id = v_target.assignment_id
        and target_assignment.status = 'in_progress'
        and not exists (
          select 1
          from learning.curriculum_requirements mandatory_requirement
          where mandatory_requirement.curriculum_version_id =
              target_assignment.curriculum_version_id
            and mandatory_requirement.audience = target_assignment.audience
            and mandatory_requirement.mandatory
            and not exists (
              select 1
              from learning.assignment_requirements completed_requirement
              where completed_requirement.assignment_id = target_assignment.id
                and completed_requirement.requirement_version_id =
                  mandatory_requirement.requirement_version_id
                and completed_requirement.status in ('passed', 'waived')
            )
        );

      v_propagated := v_propagated + 1;
    end loop;
  end loop;

  if v_propagated > 0 then
    insert into core.activity_log(
      module, entity_type, entity_id, action, actor, detail
    ) values (
      'learning', 'learning_profile', v_user_id,
      'shared_completions_synchronized', v_user_id,
      pg_catalog.jsonb_build_object(
        'audience', v_audience,
        'propagated_count', v_propagated
      )
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'propagated_count', v_propagated
  );
end;
$$;

alter function learning.sync_shared_completions() owner to postgres;
revoke all on function learning.sync_shared_completions()
  from public, anon, authenticated, service_role;
grant execute on function learning.sync_shared_completions()
  to authenticated, service_role;

-- Keep the original reviewed transition bodies private, and make convergence
-- part of the public assignment-resolution and start transactions.
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
alter function private.resolve_assignments_base() owner to postgres;
revoke all on function private.resolve_assignments_base()
  from public, anon, authenticated, service_role;

create or replace function learning.resolve_assignments()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_learning_read_committed();
  perform private.resolve_assignments_base();
  perform learning.sync_shared_completions();
  return learning.my_learning_snapshot();
end;
$$;

alter function learning.resolve_assignments() owner to postgres;
revoke all on function learning.resolve_assignments()
  from public, anon, authenticated, service_role;
grant execute on function learning.resolve_assignments()
  to authenticated, service_role;

create or replace function private.start_requirement_base(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_requirement_id uuid;
  v_idempotency_key uuid;
  v_source_type text;
  v_source_id uuid;
  v_assignment learning.assignments%rowtype;
  v_assignment_requirement learning.assignment_requirements%rowtype;
  v_requirement_version learning.requirement_versions%rowtype;
  v_attempt learning.attempts%rowtype;
  v_mode text;
  v_retry_after_seconds integer := 0;
  v_last_completed_at timestamptz;
begin
  perform private.assert_learning_read_committed();
  if v_user_id is null then
    raise exception 'Authentication is required for learning services'
      using errcode = '28000';
  end if;
  if payload is null or pg_catalog.jsonb_typeof(payload) <> 'object' then
    raise exception 'A learning command payload object is required';
  end if;
  if payload ?| array[
    'score', 'passed', 'answer_key', 'certification_status',
    'certification_state'
  ] then
    raise exception 'Forbidden learning authority field: score, passed, answer_key, certification_status, certification_state';
  end if;
  if payload - array['assignment_requirement_id', 'idempotency_key']
     <> '{}'::jsonb then
    raise exception 'Unknown start-requirement payload field';
  end if;

  v_requirement_id := nullif(payload->>'assignment_requirement_id', '')::uuid;
  v_idempotency_key := nullif(payload->>'idempotency_key', '')::uuid;
  if v_requirement_id is null or v_idempotency_key is null then
    raise exception 'assignment_requirement_id and idempotency_key are required';
  end if;

  select assignment.source_type, assignment.source_id
  into v_source_type, v_source_id
  from learning.assignment_requirements assignment_requirement
  join learning.assignments assignment
    on assignment.id = assignment_requirement.assignment_id
  where assignment_requirement.id = v_requirement_id
    and assignment_requirement.user_id = v_user_id;
  if not found then
    raise exception 'Learning requirement is not assigned to the caller';
  end if;

  if v_source_type = 'role' then
    perform 1
    from core.roles role_definition
    join core.user_roles role_assignment
      on role_assignment.module = role_definition.module
     and role_assignment.role = role_definition.role
    where role_assignment.id = v_source_id
      and role_assignment.user_id = v_user_id
      and role_definition.is_active
    for key share of role_assignment;
    if not found then
      raise exception 'The source role assignment is no longer active';
    end if;
  end if;

  select assignment.*
  into v_assignment
  from learning.assignments assignment
  join learning.assignment_requirements assignment_requirement
    on assignment_requirement.assignment_id = assignment.id
  where assignment_requirement.id = v_requirement_id
    and assignment_requirement.user_id = v_user_id
    and assignment.user_id = v_user_id
    and assignment.status in ('assigned', 'in_progress')
  for update of assignment;
  if not found then
    raise exception 'Learning assignment is not open for progress';
  end if;

  select assignment_requirement.*
  into v_assignment_requirement
  from learning.assignment_requirements assignment_requirement
  where assignment_requirement.id = v_requirement_id
    and assignment_requirement.assignment_id = v_assignment.id
    and assignment_requirement.user_id = v_user_id
  for update;
  if not found then
    raise exception 'Learning requirement is not assigned to the caller';
  end if;

  perform private.lock_learning_curriculum_graph(
    array[v_assignment.curriculum_version_id]
  );

  select requirement_version.*
  into v_requirement_version
  from learning.requirement_versions requirement_version
  where requirement_version.id = v_assignment_requirement.requirement_version_id
    and requirement_version.audience = v_assignment.audience
    and requirement_version.status = 'published'
    and requirement_version.effective_at <= pg_catalog.statement_timestamp()
    and (
      requirement_version.expires_at is null
      or requirement_version.expires_at > pg_catalog.statement_timestamp()
    )
  for share;
  if not found then
    raise exception 'Learning requirement is not published and effective';
  end if;

  if (v_assignment.profile_kind = 'employee' and v_assignment.audience <> 'internal')
     or (v_assignment.profile_kind = 'vendor' and v_assignment.audience <> 'vendor')
     or v_assignment.profile_kind not in ('employee', 'vendor') then
    raise exception 'Learning assignment audience does not match the caller';
  end if;

  if exists (
    select 1
    from learning.curriculum_requirement_prerequisites prerequisite
    where prerequisite.curriculum_version_id = v_assignment.curriculum_version_id
      and prerequisite.requirement_version_id = v_assignment_requirement.requirement_version_id
      and prerequisite.audience = v_assignment.audience
      and not exists (
        select 1
        from learning.assignment_requirements completed_prerequisite
        where completed_prerequisite.assignment_id = v_assignment.id
          and completed_prerequisite.requirement_version_id =
            prerequisite.prerequisite_requirement_version_id
          and completed_prerequisite.user_id = v_user_id
          and completed_prerequisite.audience = v_assignment.audience
          and completed_prerequisite.status in ('passed', 'waived')
      )
  ) then
    raise exception 'Complete prerequisite learning requirements first';
  end if;

  if v_assignment_requirement.status in ('passed', 'waived') then
    return pg_catalog.jsonb_build_object(
      'assignment_requirement', pg_catalog.to_jsonb(v_assignment_requirement),
      'attempt', null
    );
  end if;
  if v_assignment_requirement.status = 'needs_support' then
    raise exception 'This requirement needs support before another attempt';
  end if;
  if v_requirement_version.max_attempts is not null
     and v_assignment_requirement.attempt_count >= v_requirement_version.max_attempts then
    raise exception 'Assessment retry limit is exhausted; request support';
  end if;
  if v_assignment_requirement.status = 'failed_retryable'
     and pg_catalog.jsonb_typeof(
       v_requirement_version.assessment_settings->'retry_after_seconds'
     ) = 'number' then
    v_retry_after_seconds := pg_catalog.greatest(
      0,
      (v_requirement_version.assessment_settings->>'retry_after_seconds')::integer
    );
    select max(attempt.completed_at)
    into v_last_completed_at
    from learning.attempts attempt
    where attempt.assignment_requirement_id = v_assignment_requirement.id
      and attempt.user_id = v_user_id;
    if v_last_completed_at is not null
       and pg_catalog.statement_timestamp() <
         v_last_completed_at + pg_catalog.make_interval(
           secs => v_retry_after_seconds
         ) then
      raise exception 'Assessment retry is not available yet';
    end if;
  end if;

  update learning.assignments
  set status = 'in_progress',
      started_at = coalesce(started_at, pg_catalog.clock_timestamp()),
      blocked_reason = null
  where id = v_assignment.id
    and status in ('assigned', 'in_progress');

  update learning.assignment_requirements
  set status = 'in_progress',
      started_at = coalesce(started_at, pg_catalog.clock_timestamp())
  where id = v_assignment_requirement.id
    and status in ('not_started', 'in_progress', 'failed_retryable');

  if v_requirement_version.requirement_kind = 'policy' then
    select * into v_assignment_requirement
    from learning.assignment_requirements
    where id = v_assignment_requirement.id;
    insert into core.activity_log(
      module, entity_type, entity_id, action, actor, detail
    ) values (
      'learning', 'assignment_requirement', v_assignment_requirement.id,
      'policy_requirement_started', v_user_id,
      pg_catalog.jsonb_build_object('idempotency_key', v_idempotency_key)
    );
    return pg_catalog.jsonb_build_object(
      'assignment_requirement', pg_catalog.to_jsonb(v_assignment_requirement),
      'attempt', null
    );
  end if;

  v_mode := case v_requirement_version.requirement_kind
    when 'tour' then 'tour'
    when 'scenario' then 'scenario'
    when 'assessment' then 'assessment'
    when 'orientation' then 'attestation'
    when 'attestation' then 'attestation'
    else null
  end;
  if v_mode is null then
    raise exception 'Unsupported requirement type for an attempt';
  end if;

  select attempt.* into v_attempt
  from learning.attempts attempt
  where attempt.assignment_requirement_id = v_assignment_requirement.id
    and attempt.user_id = v_user_id
    and attempt.status = 'in_progress'
  order by attempt.attempt_number desc
  limit 1;

  if v_attempt.id is null then
    insert into learning.attempts(
      assignment_requirement_id,
      user_id,
      department_id,
      audience,
      requirement_version_id,
      attempt_number,
      mode,
      status,
      started_at
    ) values (
      v_assignment_requirement.id,
      v_user_id,
      v_assignment.department_id,
      v_assignment.audience,
      v_assignment_requirement.requirement_version_id,
      v_assignment_requirement.attempt_count + 1,
      v_mode,
      'in_progress',
      pg_catalog.clock_timestamp()
    ) returning * into v_attempt;

    update learning.assignment_requirements
    set attempt_count = attempt_count + 1
    where id = v_assignment_requirement.id
    returning * into v_assignment_requirement;

    insert into learning.attempt_events(
      attempt_id,
      user_id,
      department_id,
      audience,
      event_type,
      actor_id,
      evidence_hash,
      detail,
      idempotency_key
    ) values (
      v_attempt.id,
      v_user_id,
      v_assignment.department_id,
      v_assignment.audience,
      'started',
      v_user_id,
      pg_catalog.encode(
        public.digest(
          pg_catalog.convert_to(
            v_attempt.id::text || ':' || v_idempotency_key::text,
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      ),
      pg_catalog.jsonb_build_object(
        'requirement_version_id', v_attempt.requirement_version_id,
        'attempt_number', v_attempt.attempt_number
      ),
      v_idempotency_key
    );
  else
    select * into v_assignment_requirement
    from learning.assignment_requirements
    where id = v_assignment_requirement.id;
  end if;

  return pg_catalog.jsonb_build_object(
    'assignment_requirement', pg_catalog.to_jsonb(v_assignment_requirement),
    'attempt', pg_catalog.to_jsonb(v_attempt)
  );
end;
$$;
alter function private.start_requirement_base(jsonb) owner to postgres;
revoke all on function private.start_requirement_base(jsonb)
  from public, anon, authenticated, service_role;

create or replace function learning.start_requirement(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_requirement_id uuid;
  v_requirement learning.assignment_requirements%rowtype;
begin
  perform private.assert_learning_read_committed();
  if v_user_id is null then
    raise exception 'Authentication is required for learning services'
      using errcode = '28000';
  end if;
  if payload is null or pg_catalog.jsonb_typeof(payload) <> 'object' then
    raise exception 'A learning command payload object is required';
  end if;
  if payload ?| array[
    'score', 'passed', 'answer_key', 'certification_status',
    'certification_state'
  ] then
    raise exception 'Forbidden learning authority field: score, passed, answer_key, certification_status, certification_state';
  end if;
  if payload - array['assignment_requirement_id', 'idempotency_key']
     <> '{}'::jsonb then
    raise exception 'Unknown start-requirement payload field';
  end if;
  v_requirement_id := nullif(payload->>'assignment_requirement_id', '')::uuid;
  if v_requirement_id is null
     or nullif(payload->>'idempotency_key', '')::uuid is null then
    raise exception 'assignment_requirement_id and idempotency_key are required';
  end if;

  perform learning.sync_shared_completions();

  select requirement.*
  into v_requirement
  from learning.assignment_requirements requirement
  where requirement.id = v_requirement_id
    and requirement.user_id = v_user_id;
  if not found then
    raise exception 'Learning requirement is not assigned to the caller';
  end if;
  if v_requirement.status in ('passed', 'waived') then
    return pg_catalog.jsonb_build_object(
      'assignment_requirement', pg_catalog.to_jsonb(v_requirement),
      'attempt', null
    );
  end if;

  return private.start_requirement_base(payload);
end;
$$;

alter function learning.start_requirement(jsonb) owner to postgres;
revoke all on function learning.start_requirement(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function learning.start_requirement(jsonb)
  to authenticated, service_role;

create or replace function private.validate_certification_completion_evidence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_requirement_version_id uuid;
  v_target learning.assignment_requirements%rowtype;
  v_source learning.assignment_requirements%rowtype;
  v_kind text;
  v_attempt_ids jsonb;
  v_acknowledgment_ids jsonb;
  v_evidence jsonb := '[]'::jsonb;
begin
  perform private.assert_learning_read_committed();

  for v_requirement_version_id in
    select evidence_id
    from pg_catalog.unnest(new.requirement_version_ids) evidence_id
    order by evidence_id
  loop
    select requirement.*
    into v_target
    from learning.assignment_requirements requirement
    where requirement.assignment_id = new.assignment_id
      and requirement.user_id = new.user_id
      and requirement.department_id = new.department_id
      and requirement.audience = new.audience
      and requirement.requirement_version_id = v_requirement_version_id;
    if not found or v_target.status not in ('passed', 'waived') then
      raise exception 'Certification requirement completion is missing';
    end if;

    if v_target.status = 'waived' then
      if v_target.waiver_evidence is null
         or v_target.waiver_evidence = '{}'::jsonb then
        raise exception 'Certification waiver evidence is missing';
      end if;
      v_evidence := v_evidence || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'assignment_requirement_id', v_target.id,
          'requirement_version_id', v_requirement_version_id,
          'status', 'waived',
          'waiver_evidence', v_target.waiver_evidence
        )
      );
      continue;
    end if;

    select source_requirement.*
    into v_source
    from learning.assignment_requirements source_requirement
    where source_requirement.id = coalesce(
        nullif(
          v_target.progress->>'shared_completion_source_id',
          ''
        )::uuid,
        v_target.id
      )
      and source_requirement.user_id = new.user_id
      and source_requirement.audience = new.audience
      and source_requirement.requirement_version_id =
        v_requirement_version_id
      and source_requirement.status = 'passed';
    if not found then
      raise exception 'Shared certification completion lineage is invalid';
    end if;

    select requirement_version.requirement_kind
    into v_kind
    from learning.requirement_versions requirement_version
    where requirement_version.id = v_requirement_version_id
      and requirement_version.audience = new.audience;

    select coalesce(
      pg_catalog.jsonb_agg(attempt.id order by attempt.id),
      '[]'::jsonb
    )
    into v_attempt_ids
    from learning.attempts attempt
    where attempt.assignment_requirement_id = v_source.id
      and attempt.user_id = new.user_id
      and attempt.audience = new.audience
      and attempt.status = 'passed'
      and attempt.integrity_result = 'valid';

    select coalesce(
      pg_catalog.jsonb_agg(acknowledgment.id order by acknowledgment.id),
      '[]'::jsonb
    )
    into v_acknowledgment_ids
    from learning.policy_acknowledgments acknowledgment
    where acknowledgment.assignment_requirement_id = v_source.id
      and acknowledgment.user_id = new.user_id
      and acknowledgment.audience = new.audience;

    if (v_kind = 'policy' and pg_catalog.jsonb_array_length(
          v_acknowledgment_ids
        ) = 0)
       or (v_kind <> 'policy' and pg_catalog.jsonb_array_length(
          v_attempt_ids
        ) = 0) then
      raise exception 'Certification completion lacks authoritative evidence';
    end if;

    v_evidence := v_evidence || pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'assignment_requirement_id', v_target.id,
        'source_assignment_requirement_id', v_source.id,
        'requirement_version_id', v_requirement_version_id,
        'status', 'passed',
        'attempt_ids', v_attempt_ids,
        'acknowledgment_ids', v_acknowledgment_ids
      )
    );
  end loop;

  new.evidence_references := v_evidence;
  return new;
end;
$$;

alter function private.validate_certification_completion_evidence()
  owner to postgres;
revoke all on function private.validate_certification_completion_evidence()
  from public, anon, authenticated, service_role;

drop trigger if exists learning_certifications_completion_evidence
  on learning.certifications;
create trigger learning_certifications_completion_evidence
before insert on learning.certifications
for each row execute function
  private.validate_certification_completion_evidence();
