create or replace function learning.submit_assessment(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_requirement_id uuid;
  v_attempt_id uuid;
  v_idempotency_key uuid;
  v_answers jsonb;
  v_answer_key jsonb;
  v_source_type text;
  v_source_id uuid;
  v_assignment learning.assignments%rowtype;
  v_assignment_requirement learning.assignment_requirements%rowtype;
  v_locked_rows jsonb;
  v_requirement_version learning.requirement_versions%rowtype;
  v_attempt learning.attempts%rowtype;
  v_question_count integer;
  v_submitted_answer_count integer;
  v_match_count integer;
  v_score numeric(5,2);
  v_passed boolean;
  v_next_status text;
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
  if payload - array[
    'assignment_requirement_id', 'attempt_id', 'answers', 'idempotency_key'
  ] <> '{}'::jsonb then
    raise exception 'Unknown assessment-submission payload field';
  end if;

  v_requirement_id := nullif(payload->>'assignment_requirement_id', '')::uuid;
  v_attempt_id := nullif(payload->>'attempt_id', '')::uuid;
  v_idempotency_key := nullif(payload->>'idempotency_key', '')::uuid;
  v_answers := payload->'answers';
  if v_requirement_id is null
     or v_attempt_id is null
     or v_idempotency_key is null
     or pg_catalog.jsonb_typeof(v_answers) <> 'object' then
    raise exception 'Requirement, attempt, answer object, and idempotency identifiers are required';
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

  select pg_catalog.jsonb_build_object(
    'assignment', pg_catalog.to_jsonb(assignment),
    'assignment_requirement', pg_catalog.to_jsonb(assignment_requirement)
  )
  into v_locked_rows
  from learning.assignments assignment
  join learning.assignment_requirements assignment_requirement
    on assignment_requirement.assignment_id = assignment.id
  where assignment_requirement.id = v_requirement_id
    and assignment_requirement.user_id = v_user_id
    and assignment.user_id = v_user_id
    and assignment.status = 'in_progress'
    and assignment_requirement.status = 'in_progress'
  for update of assignment, assignment_requirement;
  if not found then
    raise exception 'Assessment requirement is not in progress';
  end if;

  v_assignment := pg_catalog.jsonb_populate_record(
    null::learning.assignments,
    v_locked_rows->'assignment'
  );
  v_assignment_requirement := pg_catalog.jsonb_populate_record(
    null::learning.assignment_requirements,
    v_locked_rows->'assignment_requirement'
  );

  perform private.lock_learning_curriculum_graph(
    array[v_assignment.curriculum_version_id]
  );

  select requirement_version.*
  into v_requirement_version
  from learning.requirement_versions requirement_version
  where requirement_version.id = v_assignment_requirement.requirement_version_id
    and requirement_version.audience = v_assignment.audience
    and requirement_version.requirement_kind = 'assessment'
    and requirement_version.status = 'published'
    and requirement_version.effective_at <= pg_catalog.statement_timestamp()
    and (
      requirement_version.expires_at is null
      or requirement_version.expires_at > pg_catalog.statement_timestamp()
    )
  for share;
  if not found then
    raise exception 'A published and effective assessment is required';
  end if;

  select attempt.* into v_attempt
  from learning.attempts attempt
  where attempt.id = v_attempt_id
    and attempt.assignment_requirement_id = v_assignment_requirement.id
    and attempt.user_id = v_user_id
    and attempt.mode = 'assessment'
  for update;
  if not found then
    raise exception 'Assessment attempt does not belong to this requirement';
  end if;

  if exists (
    select 1
    from learning.attempt_events event
    where event.attempt_id = v_attempt.id
      and event.idempotency_key = v_idempotency_key
  ) then
    return pg_catalog.to_jsonb(v_attempt);
  end if;
  if v_attempt.status <> 'in_progress' then
    raise exception 'Assessment attempt is already finalized';
  end if;

  select key_store.answer_key
  into v_answer_key
  from private.learning_assessment_answer_keys key_store
  where key_store.requirement_version_id = v_requirement_version.id
  for share;
  if not found then
    raise exception 'Assessment answer key is not configured';
  end if;

  select count(*)::integer,
         count(*) filter (
           where v_answers ? expected.key
             and v_answers->expected.key = expected.value
         )::integer
  into v_question_count, v_match_count
  from pg_catalog.jsonb_each(v_answer_key) expected;

  select count(*)::integer
  into v_submitted_answer_count
  from pg_catalog.jsonb_object_keys(v_answers);

  if v_submitted_answer_count <> v_question_count
     or exists (
       select 1
       from pg_catalog.jsonb_object_keys(v_answers) submitted_key(value)
       where not v_answer_key ? submitted_key.value
     ) then
    raise exception 'Submitted answers must match the assigned question set';
  end if;

  v_score := pg_catalog.round(
    (v_match_count::numeric * 100) / v_question_count::numeric,
    2
  );
  v_passed := v_score >= v_requirement_version.passing_score;
  v_next_status := case
    when v_passed then 'passed'
    when v_requirement_version.max_attempts is not null
      and v_assignment_requirement.attempt_count >=
        v_requirement_version.max_attempts then 'needs_support'
    else 'failed_retryable'
  end;

  update learning.attempts
  set status = case when v_passed then 'passed' else 'failed' end,
      score = v_score,
      submitted_at = pg_catalog.clock_timestamp(),
      completed_at = pg_catalog.clock_timestamp()
  where id = v_attempt.id
  returning * into v_attempt;

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
    'completed',
    v_user_id,
    pg_catalog.encode(
      public.digest(
        pg_catalog.convert_to(v_answers::text, 'UTF8'),
        'sha256'
      ),
      'hex'
    ),
    pg_catalog.jsonb_build_object(
      'score', v_score,
      'passed', v_passed,
      'question_count', v_question_count,
      'matched_count', v_match_count
    ),
    v_idempotency_key
  );

  update learning.assignment_requirements
  set status = v_next_status,
      completed_at = case
        when v_passed then pg_catalog.clock_timestamp()
        else null
      end,
      progress = progress || pg_catalog.jsonb_build_object(
        'last_score', v_score,
        'last_attempt_id', v_attempt.id,
        'updated_at', pg_catalog.clock_timestamp()
      )
  where id = v_assignment_requirement.id
  returning * into v_assignment_requirement;

  if v_next_status = 'needs_support' then
    update learning.assignments
    set status = 'blocked',
        blocked_reason = 'Assessment attempts exhausted; training support is required'
    where id = v_assignment.id;
  elsif v_passed and not exists (
    select 1
    from learning.curriculum_requirements curriculum_requirement
    join learning.assignment_requirements pending_requirement
      on pending_requirement.assignment_id = v_assignment.id
     and pending_requirement.requirement_version_id =
       curriculum_requirement.requirement_version_id
    where curriculum_requirement.curriculum_version_id =
        v_assignment.curriculum_version_id
      and curriculum_requirement.audience = v_assignment.audience
      and curriculum_requirement.mandatory
      and pending_requirement.status not in ('passed', 'waived')
  ) then
    update learning.assignments
    set status = 'completed',
        completed_at = pg_catalog.clock_timestamp(),
        blocked_reason = null
    where id = v_assignment.id;
  end if;

  return pg_catalog.to_jsonb(v_attempt);
end;
$$;

alter function learning.submit_assessment(jsonb) owner to postgres;
revoke all on function learning.submit_assessment(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function learning.submit_assessment(jsonb)
  to authenticated, service_role;
