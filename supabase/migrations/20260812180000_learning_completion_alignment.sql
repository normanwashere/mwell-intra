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
      source_requirement.id,
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
        and target_assignment.status in ('assigned', 'in_progress', 'blocked')
      order by target_assignment.id, target_requirement.id
      for update of target_assignment, target_requirement
    loop
      v_now := pg_catalog.clock_timestamp();

      update learning.assignments
      set status = 'in_progress',
          started_at = coalesce(started_at, v_now),
          blocked_reason = null
      where id = v_target.assignment_id
        and status in ('assigned', 'blocked');

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
alter function learning.resolve_assignments()
  rename to resolve_assignments_base;
alter function learning.resolve_assignments_base()
  set schema private;
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

alter function learning.start_requirement(jsonb)
  rename to start_requirement_base;
alter function learning.start_requirement_base(jsonb)
  set schema private;
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

create trigger learning_certifications_completion_evidence
before insert on learning.certifications
for each row execute function
  private.validate_certification_completion_evidence();
