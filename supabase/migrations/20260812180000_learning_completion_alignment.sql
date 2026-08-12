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

      update learning.attempts
      set status = 'invalidated',
          integrity_result = 'invalid',
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
