-- Guarded learner services for mandatory role onboarding.
-- Supported isolation for every authoritative mutation is READ COMMITTED.

create table private.learning_assessment_answer_keys (
  requirement_version_id uuid primary key
    references learning.requirement_versions(id) on delete restrict,
  answer_key jsonb not null,
  created_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_by uuid not null references core.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  constraint learning_assessment_answer_keys_object_check
    check (jsonb_typeof(answer_key) = 'object' and answer_key <> '{}'::jsonb)
);

alter table private.learning_assessment_answer_keys enable row level security;
alter table private.learning_assessment_answer_keys force row level security;
alter table private.learning_assessment_answer_keys owner to postgres;

revoke all on table private.learning_assessment_answer_keys
  from public, anon, authenticated, service_role;
grant select, insert, update, delete
  on table private.learning_assessment_answer_keys to service_role;

alter table learning.requirement_versions
  add constraint requirement_versions_private_answer_key_check
  check (
    not assessment_settings ?| array[
      'answer_key', 'answer_keys', 'answers', 'correct_answers'
    ]
  ) not valid;
alter table learning.requirement_versions
  validate constraint requirement_versions_private_answer_key_check;

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
  v_assignments jsonb;
  v_certifications jsonb;
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

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'assignment', pg_catalog.to_jsonb(assignment),
        'requirements', coalesce(requirement_rows.rows, '[]'::jsonb)
      ) order by assignment.assigned_at, assignment.id
    ),
    '[]'::jsonb
  )
  into v_assignments
  from learning.assignments assignment
  left join lateral (
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'progress', pg_catalog.to_jsonb(assignment_requirement),
        'title', requirement_version.title,
        'kind', requirement_version.requirement_kind,
        'content_reference', requirement_version.content_reference,
        'simulation_id', requirement_version.simulation_id,
        'estimated_minutes', requirement_version.estimated_minutes,
        'mandatory', curriculum_requirement.mandatory,
        'sort_order', curriculum_requirement.sort_order
      ) order by curriculum_requirement.sort_order, assignment_requirement.id
    ) as rows
    from learning.assignment_requirements assignment_requirement
    join learning.requirement_versions requirement_version
      on requirement_version.id = assignment_requirement.requirement_version_id
     and requirement_version.audience = assignment_requirement.audience
    join learning.curriculum_requirements curriculum_requirement
      on curriculum_requirement.curriculum_version_id = assignment.curriculum_version_id
     and curriculum_requirement.requirement_version_id = assignment_requirement.requirement_version_id
     and curriculum_requirement.audience = assignment_requirement.audience
    where assignment_requirement.assignment_id = assignment.id
      and assignment_requirement.user_id = v_user_id
      and assignment_requirement.audience = v_audience
  ) requirement_rows on true
  where assignment.user_id = v_user_id
    and assignment.profile_kind = v_profile_kind
    and assignment.audience = v_audience;

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.to_jsonb(certification)
      order by certification.issued_at desc, certification.id),
    '[]'::jsonb
  )
  into v_certifications
  from learning.certifications certification
  where certification.user_id = v_user_id
    and certification.audience = v_audience;

  return pg_catalog.jsonb_build_object(
    'user_id', v_user_id,
    'audience', v_audience,
    'assignments', v_assignments,
    'certifications', v_certifications,
    'generated_at', pg_catalog.statement_timestamp()
  );
end;
$$;

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

create or replace function learning.start_requirement(payload jsonb)
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

  select assignment, assignment_requirement
  into v_assignment, v_assignment_requirement
  from learning.assignments assignment
  join learning.assignment_requirements assignment_requirement
    on assignment_requirement.assignment_id = assignment.id
  where assignment_requirement.id = v_requirement_id
    and assignment_requirement.user_id = v_user_id
    and assignment.user_id = v_user_id
    and assignment.status in ('assigned', 'in_progress', 'blocked')
  for update of assignment, assignment_requirement;
  if not found then
    raise exception 'Learning assignment is not open for progress';
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
    and status in ('assigned', 'in_progress', 'blocked');

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

create or replace function learning.record_simulation_checkpoint(payload jsonb)
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
  v_checkpoint_id text;
  v_outcome_id text;
  v_source_type text;
  v_source_id uuid;
  v_assignment learning.assignments%rowtype;
  v_assignment_requirement learning.assignment_requirements%rowtype;
  v_requirement_version learning.requirement_versions%rowtype;
  v_attempt learning.attempts%rowtype;
  v_required_checkpoints jsonb;
  v_completed boolean := false;
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
    'assignment_requirement_id', 'attempt_id', 'checkpoint_id',
    'outcome_id', 'idempotency_key'
  ] <> '{}'::jsonb then
    raise exception 'Unknown simulation-checkpoint payload field';
  end if;

  v_requirement_id := nullif(payload->>'assignment_requirement_id', '')::uuid;
  v_attempt_id := nullif(payload->>'attempt_id', '')::uuid;
  v_idempotency_key := nullif(payload->>'idempotency_key', '')::uuid;
  v_checkpoint_id := nullif(pg_catalog.btrim(payload->>'checkpoint_id'), '');
  v_outcome_id := nullif(pg_catalog.btrim(payload->>'outcome_id'), '');
  if v_requirement_id is null
     or v_attempt_id is null
     or v_idempotency_key is null
     or v_checkpoint_id is null then
    raise exception 'Requirement, attempt, checkpoint, and idempotency identifiers are required';
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

  select assignment, assignment_requirement
  into v_assignment, v_assignment_requirement
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
    raise exception 'Learning requirement is not in progress';
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
    and requirement_version.requirement_kind in (
      'orientation', 'tour', 'scenario', 'attestation'
    )
  for share;
  if not found then
    raise exception 'A published simulation or attestation requirement is required';
  end if;

  select attempt.* into v_attempt
  from learning.attempts attempt
  where attempt.id = v_attempt_id
    and attempt.assignment_requirement_id = v_assignment_requirement.id
    and attempt.user_id = v_user_id
  for update;
  if not found then
    raise exception 'Attempt does not belong to this learning requirement';
  end if;

  if exists (
    select 1
    from learning.attempt_events event
    where event.attempt_id = v_attempt.id
      and event.idempotency_key = v_idempotency_key
  ) then
    return pg_catalog.to_jsonb(v_assignment_requirement);
  end if;
  if v_attempt.status <> 'in_progress' then
    raise exception 'Attempt is already finalized';
  end if;

  v_required_checkpoints := v_requirement_version.pass_rules->'required_checkpoints';
  if pg_catalog.jsonb_typeof(v_required_checkpoints) <> 'array'
     or pg_catalog.jsonb_array_length(v_required_checkpoints) = 0 then
    raise exception 'Published simulation pass rules require checkpoints';
  end if;
  if not v_required_checkpoints ? v_checkpoint_id then
    raise exception 'Checkpoint is not part of the published simulation';
  end if;
  if v_requirement_version.pass_rules->'checkpoint_outcomes' ? v_checkpoint_id
     and not exists (
       select 1
       from pg_catalog.jsonb_array_elements_text(
         v_requirement_version.pass_rules->'checkpoint_outcomes'->v_checkpoint_id
       ) allowed_outcome(value)
       where allowed_outcome.value = v_outcome_id
     ) then
    raise exception 'Checkpoint outcome is not accepted by the published simulation';
  end if;

  select not exists (
    select 1
    from pg_catalog.jsonb_array_elements_text(v_required_checkpoints)
      required_checkpoint(value)
    where required_checkpoint.value <> v_checkpoint_id
      and not exists (
        select 1
        from learning.attempt_events event
        where event.attempt_id = v_attempt.id
          and event.checkpoint_id = required_checkpoint.value
          and event.event_type in ('checkpoint', 'completed')
      )
  ) into v_completed;

  insert into learning.attempt_events(
    attempt_id,
    user_id,
    department_id,
    audience,
    event_type,
    checkpoint_id,
    actor_id,
    evidence_hash,
    detail,
    idempotency_key
  ) values (
    v_attempt.id,
    v_user_id,
    v_assignment.department_id,
    v_assignment.audience,
    case when v_completed then 'completed' else 'checkpoint' end,
    v_checkpoint_id,
    v_user_id,
    pg_catalog.encode(
      public.digest(
        pg_catalog.convert_to(
          v_attempt.id::text || ':' || v_checkpoint_id || ':' ||
            coalesce(v_outcome_id, '') || ':' || v_idempotency_key::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    pg_catalog.jsonb_build_object(
      'outcome_id', v_outcome_id,
      'validated', true,
      'terminal', v_completed
    ),
    v_idempotency_key
  );

  update learning.assignment_requirements
  set progress = progress || pg_catalog.jsonb_build_object(
        'last_checkpoint_id', v_checkpoint_id,
        'last_outcome_id', v_outcome_id,
        'updated_at', pg_catalog.clock_timestamp()
      ),
      last_checkpoint_id = v_checkpoint_id,
      status = case when v_completed then 'passed' else 'in_progress' end,
      completed_at = case
        when v_completed then pg_catalog.clock_timestamp()
        else null
      end
  where id = v_assignment_requirement.id
  returning * into v_assignment_requirement;

  if v_completed then
    update learning.attempts
    set status = 'passed',
        submitted_at = pg_catalog.clock_timestamp(),
        completed_at = pg_catalog.clock_timestamp()
    where id = v_attempt.id;

    if not exists (
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
  end if;

  return pg_catalog.to_jsonb(v_assignment_requirement);
end;
$$;

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
  v_requirement_version learning.requirement_versions%rowtype;
  v_attempt learning.attempts%rowtype;
  v_question_count integer;
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

  select assignment, assignment_requirement
  into v_assignment, v_assignment_requirement
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

  if pg_catalog.jsonb_object_length(v_answers) <> v_question_count
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

create or replace function learning.acknowledge_policy(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_requirement_id uuid;
  v_idempotency_key uuid;
  v_document_id text;
  v_document_version text;
  v_evidence_hash text;
  v_source_type text;
  v_source_id uuid;
  v_assignment learning.assignments%rowtype;
  v_assignment_requirement learning.assignment_requirements%rowtype;
  v_requirement_version learning.requirement_versions%rowtype;
  v_acknowledgment learning.policy_acknowledgments%rowtype;
  v_inserted integer := 0;
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
    'assignment_requirement_id', 'controlled_document_id',
    'controlled_document_version', 'evidence_hash', 'idempotency_key'
  ] <> '{}'::jsonb then
    raise exception 'Unknown policy-acknowledgment payload field';
  end if;

  v_requirement_id := nullif(payload->>'assignment_requirement_id', '')::uuid;
  v_idempotency_key := nullif(payload->>'idempotency_key', '')::uuid;
  v_document_id := nullif(pg_catalog.btrim(payload->>'controlled_document_id'), '');
  v_document_version := nullif(
    pg_catalog.btrim(payload->>'controlled_document_version'),
    ''
  );
  v_evidence_hash := lower(nullif(pg_catalog.btrim(payload->>'evidence_hash'), ''));
  if v_requirement_id is null
     or v_idempotency_key is null
     or v_document_id is null
     or v_document_version is null
     or v_evidence_hash is null
     or v_evidence_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Requirement, controlled document, evidence hash, and idempotency identifiers are required';
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

  select assignment, assignment_requirement
  into v_assignment, v_assignment_requirement
  from learning.assignments assignment
  join learning.assignment_requirements assignment_requirement
    on assignment_requirement.assignment_id = assignment.id
  where assignment_requirement.id = v_requirement_id
    and assignment_requirement.user_id = v_user_id
    and assignment.user_id = v_user_id
    and assignment.status in ('in_progress', 'completed')
  for update of assignment, assignment_requirement;
  if not found then
    raise exception 'Policy requirement must be started before acknowledgment';
  end if;

  select acknowledgment.* into v_acknowledgment
  from learning.policy_acknowledgments acknowledgment
  where acknowledgment.assignment_requirement_id = v_assignment_requirement.id
    and acknowledgment.user_id = v_user_id
    and acknowledgment.controlled_document_id = v_document_id
    and acknowledgment.controlled_document_version = v_document_version;
  if found then
    return pg_catalog.to_jsonb(v_acknowledgment);
  end if;
  if v_assignment_requirement.status <> 'in_progress' then
    raise exception 'Policy requirement is already finalized';
  end if;

  perform private.lock_learning_curriculum_graph(
    array[v_assignment.curriculum_version_id]
  );

  select requirement_version.*
  into v_requirement_version
  from learning.requirement_versions requirement_version
  where requirement_version.id = v_assignment_requirement.requirement_version_id
    and requirement_version.audience = v_assignment.audience
    and requirement_version.requirement_kind = 'policy'
    and requirement_version.status = 'published'
    and requirement_version.effective_at <= pg_catalog.statement_timestamp()
    and (
      requirement_version.expires_at is null
      or requirement_version.expires_at > pg_catalog.statement_timestamp()
    )
  for share;
  if not found then
    raise exception 'A published and effective policy is required';
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
          and completed_prerequisite.status in ('passed', 'waived')
      )
  ) then
    raise exception 'Complete prerequisite learning requirements first';
  end if;

  if not exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      v_requirement_version.source_references
    ) source_reference
    where source_reference->>'controlled_document_id' = v_document_id
      and source_reference->>'controlled_document_version' = v_document_version
  ) then
    raise exception 'Acknowledgment does not match the published controlled document';
  end if;

  insert into learning.policy_acknowledgments(
    assignment_requirement_id,
    user_id,
    department_id,
    audience,
    requirement_version_id,
    controlled_document_id,
    controlled_document_version,
    accepted_at,
    evidence_hash,
    actor_id
  ) values (
    v_assignment_requirement.id,
    v_user_id,
    v_assignment.department_id,
    v_assignment.audience,
    v_assignment_requirement.requirement_version_id,
    v_document_id,
    v_document_version,
    pg_catalog.clock_timestamp(),
    v_evidence_hash,
    v_user_id
  )
  on conflict (
    user_id,
    requirement_version_id,
    controlled_document_id,
    controlled_document_version
  ) do nothing
  returning * into v_acknowledgment;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select acknowledgment.* into v_acknowledgment
    from learning.policy_acknowledgments acknowledgment
    where acknowledgment.user_id = v_user_id
      and acknowledgment.requirement_version_id =
        v_assignment_requirement.requirement_version_id
      and acknowledgment.controlled_document_id = v_document_id
      and acknowledgment.controlled_document_version = v_document_version;
    return pg_catalog.to_jsonb(v_acknowledgment);
  end if;

  update learning.assignment_requirements
  set status = 'passed',
      completed_at = pg_catalog.clock_timestamp(),
      progress = progress || pg_catalog.jsonb_build_object(
        'controlled_document_id', v_document_id,
        'controlled_document_version', v_document_version,
        'acknowledgment_id', v_acknowledgment.id
      )
  where id = v_assignment_requirement.id;

  insert into core.activity_log(
    module, entity_type, entity_id, action, actor, detail
  ) values (
    'learning', 'assignment_requirement', v_assignment_requirement.id,
    'policy_acknowledged', v_user_id,
    pg_catalog.jsonb_build_object(
      'acknowledgment_id', v_acknowledgment.id,
      'controlled_document_id', v_document_id,
      'controlled_document_version', v_document_version,
      'idempotency_key', v_idempotency_key
    )
  );

  if not exists (
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

  return pg_catalog.to_jsonb(v_acknowledgment);
end;
$$;

create or replace function learning.request_support(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_requirement_id uuid;
  v_idempotency_key uuid;
  v_reason text;
  v_source_type text;
  v_source_id uuid;
  v_assignment learning.assignments%rowtype;
  v_assignment_requirement learning.assignment_requirements%rowtype;
  v_attempt learning.attempts%rowtype;
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
    'assignment_requirement_id', 'reason', 'idempotency_key'
  ] <> '{}'::jsonb then
    raise exception 'Unknown support-request payload field';
  end if;

  v_requirement_id := nullif(payload->>'assignment_requirement_id', '')::uuid;
  v_idempotency_key := nullif(payload->>'idempotency_key', '')::uuid;
  v_reason := nullif(pg_catalog.btrim(payload->>'reason'), '');
  if v_requirement_id is null
     or v_idempotency_key is null
     or v_reason is null
     or pg_catalog.length(v_reason) > 1000 then
    raise exception 'Requirement, concise support reason, and idempotency key are required';
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

  select assignment, assignment_requirement
  into v_assignment, v_assignment_requirement
  from learning.assignments assignment
  join learning.assignment_requirements assignment_requirement
    on assignment_requirement.assignment_id = assignment.id
  where assignment_requirement.id = v_requirement_id
    and assignment_requirement.user_id = v_user_id
    and assignment.user_id = v_user_id
    and assignment.status in ('in_progress', 'blocked')
    and assignment_requirement.status in (
      'in_progress', 'failed_retryable', 'needs_support'
    )
  for update of assignment, assignment_requirement;
  if not found then
    raise exception 'Only active or retryable requirements can request support';
  end if;

  if exists (
    select 1
    from core.activity_log activity
    where activity.module = 'learning'
      and activity.entity_type = 'assignment_requirement'
      and activity.entity_id = v_assignment_requirement.id
      and activity.action = 'support_requested'
      and activity.actor = v_user_id
      and activity.detail->>'idempotency_key' = v_idempotency_key::text
  ) then
    return pg_catalog.to_jsonb(v_assignment_requirement);
  end if;

  update learning.assignment_requirements
  set status = 'needs_support',
      progress = progress || pg_catalog.jsonb_build_object(
        'support_requested_at', pg_catalog.clock_timestamp()
      )
  where id = v_assignment_requirement.id
  returning * into v_assignment_requirement;

  update learning.assignments
  set status = 'blocked',
      blocked_reason = v_reason
  where id = v_assignment.id;

  select attempt.* into v_attempt
  from learning.attempts attempt
  where attempt.assignment_requirement_id = v_assignment_requirement.id
    and attempt.user_id = v_user_id
    and attempt.status = 'in_progress'
  order by attempt.attempt_number desc
  limit 1;

  if v_attempt.id is not null then
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
      'support_requested',
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
      pg_catalog.jsonb_build_object('reason_recorded', true),
      v_idempotency_key
    )
    on conflict (attempt_id, idempotency_key) do nothing;
  end if;

  insert into core.activity_log(
    module, entity_type, entity_id, action, actor, detail
  ) values (
    'learning', 'assignment_requirement', v_assignment_requirement.id,
    'support_requested', v_user_id,
    pg_catalog.jsonb_build_object(
      'reason', v_reason,
      'idempotency_key', v_idempotency_key
    )
  );

  return pg_catalog.to_jsonb(v_assignment_requirement);
end;
$$;

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
        pg_catalog.clock_timestamp(),
        pg_catalog.clock_timestamp(),
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

alter function learning.my_learning_snapshot() owner to postgres;
alter function learning.resolve_assignments() owner to postgres;
alter function learning.start_requirement(jsonb) owner to postgres;
alter function learning.record_simulation_checkpoint(jsonb) owner to postgres;
alter function learning.submit_assessment(jsonb) owner to postgres;
alter function learning.acknowledge_policy(jsonb) owner to postgres;
alter function learning.evaluate_certifications() owner to postgres;
alter function learning.request_support(jsonb) owner to postgres;

revoke all on function learning.my_learning_snapshot()
  from public, anon, authenticated, service_role;
revoke all on function learning.resolve_assignments()
  from public, anon, authenticated, service_role;
revoke all on function learning.start_requirement(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function learning.record_simulation_checkpoint(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function learning.submit_assessment(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function learning.acknowledge_policy(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function learning.evaluate_certifications()
  from public, anon, authenticated, service_role;
revoke all on function learning.request_support(jsonb)
  from public, anon, authenticated, service_role;

grant execute on function learning.my_learning_snapshot()
  to authenticated, service_role;
grant execute on function learning.resolve_assignments()
  to authenticated, service_role;
grant execute on function learning.start_requirement(jsonb)
  to authenticated, service_role;
grant execute on function learning.record_simulation_checkpoint(jsonb)
  to authenticated, service_role;
grant execute on function learning.submit_assessment(jsonb)
  to authenticated, service_role;
grant execute on function learning.acknowledge_policy(jsonb)
  to authenticated, service_role;
grant execute on function learning.evaluate_certifications()
  to authenticated, service_role;
grant execute on function learning.request_support(jsonb)
  to authenticated, service_role;
