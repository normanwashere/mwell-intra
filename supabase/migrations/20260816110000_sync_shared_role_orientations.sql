-- The UI intentionally presents equivalent internal role orientations once.
-- Propagate that completion across every active role curriculum with the same
-- audience and normalized orientation title while preserving evidence lineage.

create or replace function learning.resolve_assignments()
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
  v_now timestamptz;
begin
  perform private.assert_learning_read_committed();
  if v_user_id is null then
    raise exception 'Authentication is required for learning services'
      using errcode = '28000';
  end if;

  perform private.resolve_assignments_base();
  perform private.cancel_ineffective_learning_role_assignments();
  perform private.resolve_vendor_learning_assignments();
  perform learning.sync_shared_completions();

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
    select distinct on (
      pg_catalog.lower(
        pg_catalog.regexp_replace(
          pg_catalog.btrim(source_version.title),
          '\s+',
          ' ',
          'g'
        )
      )
    )
      source_requirement.id,
      source_requirement.completed_at,
      pg_catalog.lower(
        pg_catalog.regexp_replace(
          pg_catalog.btrim(source_version.title),
          '\s+',
          ' ',
          'g'
        )
      ) as completion_key
    from learning.assignment_requirements source_requirement
    join learning.assignments source_assignment
      on source_assignment.id = source_requirement.assignment_id
     and source_assignment.user_id = source_requirement.user_id
     and source_assignment.audience = source_requirement.audience
    join learning.requirement_versions source_version
      on source_version.id = source_requirement.requirement_version_id
     and source_version.audience = source_requirement.audience
     and source_version.requirement_kind = 'orientation'
    where source_requirement.user_id = v_user_id
      and source_requirement.audience = v_audience
      and source_requirement.status = 'passed'
      and source_assignment.source_type not in ('retraining', 'corrective')
      and source_assignment.status not in ('cancelled', 'superseded')
    order by
      pg_catalog.lower(
        pg_catalog.regexp_replace(
          pg_catalog.btrim(source_version.title),
          '\s+',
          ' ',
          'g'
        )
      ),
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
      join learning.requirement_versions target_version
        on target_version.id = target_requirement.requirement_version_id
       and target_version.audience = target_requirement.audience
       and target_version.requirement_kind = 'orientation'
      where target_requirement.user_id = v_user_id
        and target_requirement.audience = v_audience
        and target_requirement.id <> v_source.id
        and target_requirement.status in (
          'not_started', 'in_progress', 'failed_retryable', 'needs_support'
        )
        and target_assignment.source_type not in ('retraining', 'corrective')
        and target_assignment.status in ('assigned', 'in_progress')
        and pg_catalog.lower(
          pg_catalog.regexp_replace(
            pg_catalog.btrim(target_version.title),
            '\s+',
            ' ',
            'g'
          )
        ) = v_source.completion_key
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
          'reason', 'shared_role_orientation_superseded_attempt',
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
            'shared_completion_propagated_at', v_now,
            'shared_completion_kind', 'role_orientation'
          )
      where id = v_target.id;

      insert into core.activity_log(
        module, entity_type, entity_id, action, actor, detail
      ) values (
        'learning',
        'assignment_requirement',
        v_target.id,
        'shared_role_orientation_propagated',
        v_user_id,
        pg_catalog.jsonb_build_object(
          'source_assignment_requirement_id', v_source.id,
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
    end loop;
  end loop;

  return learning.my_learning_snapshot();
end;
$$;

alter function learning.resolve_assignments() owner to postgres;
revoke all on function learning.resolve_assignments()
  from public, anon, authenticated, service_role;
grant execute on function learning.resolve_assignments()
  to authenticated, service_role;
