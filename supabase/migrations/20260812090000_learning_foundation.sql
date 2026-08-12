-- Governed learning foundation for mandatory role onboarding.
-- Certifications activate no role or row scope: they only reference existing
-- role assignments and are evaluated with current RBAC authority in later work.

create schema if not exists learning;
grant usage on schema learning to authenticated, service_role;

alter role authenticator set "pgrst.db_schemas" =
  'public, core, warehouse, procurement, legal, product, learning, graphql_public';

-- Role assignments previously used only a composite natural key. Learning
-- evidence needs a stable source identity without changing RBAC semantics.
alter table core.user_roles
  add column if not exists id uuid not null default gen_random_uuid();

create unique index if not exists core_user_roles_id_key
  on core.user_roles(id);
create unique index if not exists core_user_roles_assignment_identity_key
  on core.user_roles(id, user_id, module, role);

create table learning.curricula (
  id uuid primary key default gen_random_uuid(),
  catalog_key text not null unique,
  audience text not null,
  governance_owner text not null,
  owner_department_id uuid references core.departments(id) on delete restrict,
  status text not null default 'active',
  created_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint curricula_catalog_key_check
    check (catalog_key = lower(catalog_key) and catalog_key ~ '^[a-z][a-z0-9_.-]+$'),
  constraint curricula_audience_check check (audience in ('internal', 'vendor')),
  constraint curricula_governance_owner_check
    check (governance_owner in ('platform', 'department', 'legal')),
  constraint curricula_owner_department_check
    check ((governance_owner = 'department') = (owner_department_id is not null)),
  constraint curricula_status_check check (status in ('active', 'retired')),
  unique (id, audience),
  unique (id, audience, governance_owner, owner_department_id)
);

create table learning.curriculum_versions (
  id uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null,
  audience text not null,
  version integer not null,
  status text not null default 'draft',
  effective_at timestamptz,
  expires_at timestamptz,
  change_reason text not null,
  materiality text not null,
  source_references jsonb not null default '[]'::jsonb,
  owner_id uuid not null references core.profiles(id) on delete restrict,
  reviewer_id uuid references core.profiles(id) on delete restrict,
  approved_at timestamptz,
  published_at timestamptz,
  supersedes_id uuid references learning.curriculum_versions(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint curriculum_versions_curriculum_fk
    foreign key (curriculum_id, audience)
    references learning.curricula(id, audience) on delete restrict,
  constraint curriculum_versions_version_check check (version > 0),
  constraint curriculum_versions_status_check
    check (status in ('draft', 'in_review', 'approved', 'scheduled', 'published', 'superseded', 'retired')),
  constraint curriculum_versions_materiality_check
    check (materiality in ('material', 'non_material')),
  constraint curriculum_versions_source_references_check
    check (jsonb_typeof(source_references) = 'array'),
  constraint curriculum_versions_effective_window_check
    check (expires_at is null or (effective_at is not null and expires_at > effective_at)),
  constraint curriculum_versions_independent_review_check
    check (
      status in ('draft', 'in_review')
      or (
        reviewer_id is not null
        and reviewer_id <> owner_id
        and approved_at is not null
      )
    ),
  constraint curriculum_versions_publication_check
    check (
      status not in ('scheduled', 'published', 'superseded', 'retired')
      or (effective_at is not null and published_at is not null)
    ),
  unique (curriculum_id, version),
  unique (id, audience)
);

create table learning.requirements (
  id uuid primary key default gen_random_uuid(),
  requirement_key text not null unique,
  audience text not null,
  requirement_kind text not null,
  governance_owner text not null,
  owner_department_id uuid references core.departments(id) on delete restrict,
  status text not null default 'active',
  created_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint requirements_key_check
    check (requirement_key = lower(requirement_key) and requirement_key ~ '^[a-z][a-z0-9_.-]+$'),
  constraint requirements_audience_check check (audience in ('internal', 'vendor')),
  constraint requirements_kind_check
    check (requirement_kind in ('orientation', 'policy', 'tour', 'scenario', 'assessment', 'attestation')),
  constraint requirements_governance_owner_check
    check (governance_owner in ('platform', 'department', 'legal')),
  constraint requirements_owner_department_check
    check ((governance_owner = 'department') = (owner_department_id is not null)),
  constraint requirements_status_check check (status in ('active', 'retired')),
  unique (id, audience),
  unique (id, audience, requirement_kind, governance_owner)
);

create table learning.requirement_versions (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null,
  audience text not null,
  requirement_kind text not null,
  governance_owner text not null,
  owner_department_id uuid,
  version integer not null,
  status text not null default 'draft',
  title text not null,
  content_reference text,
  simulation_id text,
  assessment_settings jsonb not null default '{}'::jsonb,
  pass_rules jsonb not null default '{}'::jsonb,
  passing_score numeric(5,2),
  max_attempts integer,
  estimated_minutes integer not null,
  waivable boolean not null default false,
  effective_at timestamptz,
  expires_at timestamptz,
  change_reason text not null,
  materiality text not null,
  source_references jsonb not null default '[]'::jsonb,
  owner_id uuid not null references core.profiles(id) on delete restrict,
  reviewer_id uuid references core.profiles(id) on delete restrict,
  approved_at timestamptz,
  published_at timestamptz,
  supersedes_id uuid references learning.requirement_versions(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint requirement_versions_requirement_fk
    foreign key (
      requirement_id,
      audience,
      requirement_kind,
      governance_owner
    ) references learning.requirements(
      id,
      audience,
      requirement_kind,
      governance_owner
    ) on delete restrict,
  constraint requirement_versions_owner_department_fk
    foreign key (owner_department_id)
    references core.departments(id) on delete restrict,
  constraint requirement_versions_owner_department_check
    check ((governance_owner = 'department') = (owner_department_id is not null)),
  constraint requirement_versions_version_check check (version > 0),
  constraint requirement_versions_status_check
    check (status in ('draft', 'in_review', 'approved', 'scheduled', 'published', 'superseded', 'retired')),
  constraint requirement_versions_title_check check (btrim(title) <> ''),
  constraint requirement_versions_settings_check
    check (jsonb_typeof(assessment_settings) = 'object' and jsonb_typeof(pass_rules) = 'object'),
  constraint requirement_versions_score_check
    check (passing_score is null or passing_score between 0 and 100),
  constraint requirement_versions_attempts_check
    check (max_attempts is null or max_attempts > 0),
  constraint requirement_versions_duration_check check (estimated_minutes > 0),
  constraint requirement_versions_materiality_check
    check (materiality in ('material', 'non_material')),
  constraint requirement_versions_source_references_check
    check (jsonb_typeof(source_references) = 'array'),
  constraint requirement_versions_effective_window_check
    check (expires_at is null or (effective_at is not null and expires_at > effective_at)),
  constraint requirement_versions_legal_waiver_check
    check (
      governance_owner <> 'legal'
      or requirement_kind <> 'policy'
      or not waivable
    ),
  constraint requirement_versions_simulation_check
    check (
      requirement_kind not in ('tour', 'scenario')
      or nullif(btrim(simulation_id), '') is not null
    ),
  constraint requirement_versions_assessment_check
    check (
      requirement_kind <> 'assessment'
      or (passing_score is not null and max_attempts is not null)
    ),
  constraint requirement_versions_independent_review_check
    check (
      status in ('draft', 'in_review')
      or (
        reviewer_id is not null
        and reviewer_id <> owner_id
        and approved_at is not null
      )
    ),
  constraint requirement_versions_publication_check
    check (
      status not in ('scheduled', 'published', 'superseded', 'retired')
      or (effective_at is not null and published_at is not null)
    ),
  unique (requirement_id, version),
  unique (id, audience)
);

create table learning.curriculum_requirements (
  id uuid primary key default gen_random_uuid(),
  curriculum_version_id uuid not null,
  requirement_version_id uuid not null,
  audience text not null,
  sort_order integer not null,
  mandatory boolean not null default true,
  prerequisite_requirement_version_ids uuid[] not null default '{}'::uuid[],
  capability_outcomes jsonb not null default '[]'::jsonb,
  created_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint curriculum_requirements_curriculum_fk
    foreign key (curriculum_version_id, audience)
    references learning.curriculum_versions(id, audience) on delete restrict,
  constraint curriculum_requirements_requirement_fk
    foreign key (requirement_version_id, audience)
    references learning.requirement_versions(id, audience) on delete restrict,
  constraint curriculum_requirements_order_check check (sort_order >= 0),
  constraint curriculum_requirements_prerequisite_check
    check (not requirement_version_id = any(prerequisite_requirement_version_ids)),
  constraint curriculum_requirements_capability_outcomes_check
    check (jsonb_typeof(capability_outcomes) = 'array'),
  unique (curriculum_version_id, requirement_version_id)
);

create table learning.role_curricula (
  id uuid primary key default gen_random_uuid(),
  module text not null,
  role text not null,
  curriculum_version_id uuid not null,
  audience text not null,
  department_id uuid references core.departments(id) on delete restrict,
  effective_at timestamptz not null,
  expires_at timestamptz,
  created_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint role_curricula_role_fk
    foreign key (module, role)
    references core.roles(module, role) on delete restrict,
  constraint role_curricula_curriculum_fk
    foreign key (curriculum_version_id, audience)
    references learning.curriculum_versions(id, audience) on delete restrict,
  constraint role_curricula_audience_boundary_check
    check (
      (
        audience = 'vendor'
        and module = 'core'
        and role = 'vendor_portal'
        and department_id is null
      )
      or (
        audience = 'internal'
        and not (module = 'core' and role = 'vendor_portal')
      )
    ),
  constraint role_curricula_effective_window_check
    check (expires_at is null or expires_at > effective_at),
  unique (module, role, curriculum_version_id, department_id)
);

create table learning.assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.profiles(id) on delete restrict,
  department_id uuid not null references core.departments(id) on delete restrict,
  curriculum_version_id uuid not null,
  audience text not null,
  source_type text not null,
  source_id uuid not null,
  status text not null default 'assigned',
  due_at timestamptz,
  assigned_at timestamptz not null default now(),
  reassigned_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  blocked_reason text,
  retraining_reason text,
  superseded_by_id uuid references learning.assignments(id) on delete restrict,
  assigned_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint assignments_curriculum_fk
    foreign key (curriculum_version_id, audience)
    references learning.curriculum_versions(id, audience) on delete restrict,
  constraint assignments_audience_check check (audience in ('internal', 'vendor')),
  constraint assignments_source_type_check
    check (source_type in ('role', 'department', 'user', 'retraining', 'corrective')),
  constraint assignments_status_check
    check (status in ('assigned', 'in_progress', 'completed', 'blocked', 'expired', 'superseded', 'cancelled')),
  constraint assignments_blocked_reason_check
    check (status <> 'blocked' or nullif(btrim(blocked_reason), '') is not null),
  constraint assignments_completion_check
    check ((status = 'completed') = (completed_at is not null)),
  constraint assignments_superseded_check
    check ((status = 'superseded') = (superseded_by_id is not null)),
  unique (id, user_id, department_id, audience)
);

create table learning.assignment_requirements (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null,
  user_id uuid not null,
  department_id uuid not null,
  audience text not null,
  requirement_version_id uuid not null,
  status text not null default 'not_started',
  attempt_count integer not null default 0,
  progress jsonb not null default '{}'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  last_checkpoint_id text,
  waiver_evidence jsonb,
  created_at timestamptz not null default now(),
  constraint assignment_requirements_assignment_fk
    foreign key (assignment_id, user_id, department_id, audience)
    references learning.assignments(id, user_id, department_id, audience) on delete restrict,
  constraint assignment_requirements_requirement_fk
    foreign key (requirement_version_id, audience)
    references learning.requirement_versions(id, audience) on delete restrict,
  constraint assignment_requirements_status_check
    check (status in ('not_started', 'in_progress', 'passed', 'failed_retryable', 'needs_support', 'expired', 'waived')),
  constraint assignment_requirements_attempt_count_check check (attempt_count >= 0),
  constraint assignment_requirements_progress_check check (jsonb_typeof(progress) = 'object'),
  constraint assignment_requirements_completion_check
    check ((status in ('passed', 'waived')) = (completed_at is not null)),
  constraint assignment_requirements_waiver_evidence_check
    check (status <> 'waived' or jsonb_typeof(waiver_evidence) = 'object'),
  unique (assignment_id, requirement_version_id),
  unique (id, user_id, department_id, audience, requirement_version_id)
);

create table learning.attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_requirement_id uuid not null,
  user_id uuid not null,
  department_id uuid not null,
  audience text not null,
  requirement_version_id uuid not null,
  attempt_number integer not null,
  mode text not null,
  status text not null,
  score numeric(5,2),
  integrity_result text not null default 'valid',
  started_at timestamptz not null,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint attempts_assignment_requirement_fk
    foreign key (
      assignment_requirement_id,
      user_id,
      department_id,
      audience,
      requirement_version_id
    ) references learning.assignment_requirements(
      id,
      user_id,
      department_id,
      audience,
      requirement_version_id
    ) on delete restrict,
  constraint attempts_number_check check (attempt_number > 0),
  constraint attempts_mode_check
    check (mode in ('tour', 'scenario', 'assessment', 'attestation')),
  constraint attempts_status_check
    check (status in ('in_progress', 'passed', 'failed', 'abandoned', 'invalidated')),
  constraint attempts_score_check check (score is null or score between 0 and 100),
  constraint attempts_integrity_check
    check (integrity_result in ('valid', 'flagged', 'invalid')),
  constraint attempts_completion_check
    check (
      (status = 'in_progress' and completed_at is null)
      or (status <> 'in_progress' and completed_at is not null)
    ),
  unique (assignment_requirement_id, attempt_number),
  unique (id, user_id, department_id, audience)
);

create table learning.attempt_events (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null,
  user_id uuid not null,
  department_id uuid not null,
  audience text not null,
  event_type text not null,
  checkpoint_id text,
  event_at timestamptz not null default now(),
  actor_id uuid not null references core.profiles(id) on delete restrict,
  evidence_hash text not null,
  detail jsonb not null default '{}'::jsonb,
  idempotency_key uuid not null,
  created_at timestamptz not null default now(),
  constraint attempt_events_attempt_fk
    foreign key (attempt_id, user_id, department_id, audience)
    references learning.attempts(id, user_id, department_id, audience) on delete restrict,
  constraint attempt_events_type_check
    check (event_type in ('started', 'checkpoint', 'decision', 'validation', 'recovery', 'submitted', 'completed', 'support_requested')),
  constraint attempt_events_hash_check check (evidence_hash ~ '^[a-f0-9]{64}$'),
  constraint attempt_events_detail_check check (jsonb_typeof(detail) = 'object'),
  unique (attempt_id, idempotency_key)
);

create table learning.policy_acknowledgments (
  id uuid primary key default gen_random_uuid(),
  assignment_requirement_id uuid not null,
  user_id uuid not null,
  department_id uuid not null,
  audience text not null,
  requirement_version_id uuid not null,
  controlled_document_id text not null,
  controlled_document_version text not null,
  accepted_at timestamptz not null,
  evidence_hash text not null,
  actor_id uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint policy_acknowledgments_assignment_requirement_fk
    foreign key (
      assignment_requirement_id,
      user_id,
      department_id,
      audience,
      requirement_version_id
    ) references learning.assignment_requirements(
      id,
      user_id,
      department_id,
      audience,
      requirement_version_id
    ) on delete restrict,
  constraint policy_acknowledgments_document_check
    check (
      nullif(btrim(controlled_document_id), '') is not null
      and nullif(btrim(controlled_document_version), '') is not null
    ),
  constraint policy_acknowledgments_hash_check check (evidence_hash ~ '^[a-f0-9]{64}$'),
  unique (user_id, requirement_version_id, controlled_document_id, controlled_document_version)
);

create table learning.certifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.profiles(id) on delete restrict,
  department_id uuid not null references core.departments(id) on delete restrict,
  audience text not null,
  assignment_id uuid not null,
  source_role_assignment_id uuid not null,
  source_role text not null,
  module text not null,
  capability text not null,
  curriculum_version_id uuid not null,
  requirement_version_ids uuid[] not null,
  status text not null default 'active',
  issued_at timestamptz not null,
  effective_at timestamptz not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  superseded_at timestamptz,
  issued_by text not null,
  policy_version text,
  evidence_references jsonb not null,
  created_at timestamptz not null default now(),
  constraint certifications_assignment_fk
    foreign key (assignment_id, user_id, department_id, audience)
    references learning.assignments(id, user_id, department_id, audience) on delete restrict,
  constraint certifications_role_assignment_fk
    foreign key (source_role_assignment_id, user_id, module, source_role)
    references core.user_roles(id, user_id, module, role) on delete restrict,
  constraint certifications_capability_fk
    foreign key (module, capability)
    references core.capabilities(module, cap) on delete restrict,
  constraint certifications_curriculum_fk
    foreign key (curriculum_version_id, audience)
    references learning.curriculum_versions(id, audience) on delete restrict,
  constraint certifications_status_check
    check (status in ('active', 'expired', 'revoked', 'superseded')),
  constraint certifications_audience_check check (audience in ('internal', 'vendor')),
  constraint certifications_requirement_evidence_check
    check (cardinality(requirement_version_ids) > 0),
  constraint certifications_evidence_check
    check (jsonb_typeof(evidence_references) = 'array' and jsonb_array_length(evidence_references) > 0),
  constraint certifications_effective_window_check
    check (expires_at is null or expires_at > effective_at),
  constraint certifications_lifecycle_check
    check (
      (status = 'revoked') = (revoked_at is not null)
      and (status = 'superseded') = (superseded_at is not null)
    )
);

create table learning.emergency_exceptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references core.profiles(id) on delete restrict,
  department_id uuid not null references core.departments(id) on delete restrict,
  audience text not null default 'internal',
  module text not null,
  capability text not null,
  business_reason text not null,
  incident_reference text not null,
  grantor_id uuid not null references core.profiles(id) on delete restrict,
  approver_id uuid not null references core.profiles(id) on delete restrict,
  approved_at timestamptz not null,
  effective_at timestamptz not null,
  expires_at timestamptz not null,
  status text not null default 'active',
  waives_legal_acknowledgment boolean not null default false,
  revoked_at timestamptz,
  revoked_by uuid references core.profiles(id) on delete restrict,
  revocation_reason text,
  created_at timestamptz not null default now(),
  constraint emergency_exceptions_capability_fk
    foreign key (module, capability)
    references core.capabilities(module, cap) on delete restrict,
  constraint emergency_exceptions_internal_only_check check (audience = 'internal'),
  constraint emergency_exceptions_status_check
    check (status in ('active', 'expired', 'revoked')),
  constraint emergency_exceptions_reason_check
    check (
      nullif(btrim(business_reason), '') is not null
      and nullif(btrim(incident_reference), '') is not null
    ),
  constraint emergency_exceptions_independent_approval_check
    check (grantor_id <> approver_id),
  constraint emergency_exceptions_duration_check
    check (
      expires_at > effective_at
      and expires_at <= effective_at + interval '24 hours'
    ),
  constraint emergency_exceptions_no_legal_waiver_check
    check (waives_legal_acknowledgment = false),
  constraint emergency_exceptions_revocation_check
    check (
      (status = 'revoked') = (revoked_at is not null)
      and (status = 'revoked') = (revoked_by is not null)
      and (status = 'revoked') = (nullif(btrim(revocation_reason), '') is not null)
    )
);

create unique index learning_one_active_certification_idx
  on learning.certifications(user_id, department_id, module, capability, source_role_assignment_id)
  where status = 'active';

create unique index learning_one_open_assignment_idx
  on learning.assignments(user_id, curriculum_version_id, source_type, source_id)
  where status in ('assigned', 'in_progress', 'blocked');

create unique index learning_one_global_role_curriculum_idx
  on learning.role_curricula(module, role, curriculum_version_id)
  where department_id is null;

create unique index learning_one_scoped_role_curriculum_idx
  on learning.role_curricula(module, role, curriculum_version_id, department_id)
  where department_id is not null;

create unique index learning_one_active_emergency_exception_idx
  on learning.emergency_exceptions(user_id, department_id, module, capability)
  where status = 'active';

create index learning_curriculum_versions_curriculum_idx
  on learning.curriculum_versions(curriculum_id, status, effective_at);
create index learning_curriculum_versions_owner_idx
  on learning.curriculum_versions(owner_id);
create index learning_curriculum_versions_reviewer_idx
  on learning.curriculum_versions(reviewer_id);
create index learning_curriculum_versions_supersedes_idx
  on learning.curriculum_versions(supersedes_id);
create index learning_requirements_department_idx
  on learning.requirements(owner_department_id);
create index learning_requirement_versions_requirement_idx
  on learning.requirement_versions(requirement_id, status, effective_at);
create index learning_requirement_versions_owner_idx
  on learning.requirement_versions(owner_id);
create index learning_requirement_versions_reviewer_idx
  on learning.requirement_versions(reviewer_id);
create index learning_requirement_versions_supersedes_idx
  on learning.requirement_versions(supersedes_id);
create index learning_curriculum_requirements_requirement_idx
  on learning.curriculum_requirements(requirement_version_id);
create index learning_role_curricula_curriculum_idx
  on learning.role_curricula(curriculum_version_id);
create index learning_role_curricula_department_idx
  on learning.role_curricula(department_id);
create index learning_assignments_user_status_idx
  on learning.assignments(user_id, status, due_at);
create index learning_assignments_department_status_idx
  on learning.assignments(department_id, status, due_at);
create index learning_assignments_superseded_by_idx
  on learning.assignments(superseded_by_id);
create index learning_assignment_requirements_requirement_idx
  on learning.assignment_requirements(requirement_version_id);
create index learning_assignment_requirements_user_status_idx
  on learning.assignment_requirements(user_id, status);
create index learning_attempts_requirement_idx
  on learning.attempts(requirement_version_id);
create index learning_attempts_user_created_idx
  on learning.attempts(user_id, created_at desc);
create index learning_attempt_events_user_created_idx
  on learning.attempt_events(user_id, created_at desc);
create index learning_attempt_events_actor_idx
  on learning.attempt_events(actor_id);
create index learning_policy_acknowledgments_requirement_idx
  on learning.policy_acknowledgments(requirement_version_id);
create index learning_policy_acknowledgments_department_idx
  on learning.policy_acknowledgments(department_id, accepted_at desc);
create index learning_policy_acknowledgments_actor_idx
  on learning.policy_acknowledgments(actor_id);
create index learning_certifications_assignment_idx
  on learning.certifications(assignment_id);
create index learning_certifications_curriculum_idx
  on learning.certifications(curriculum_version_id);
create index learning_certifications_user_status_idx
  on learning.certifications(user_id, status, expires_at);
create index learning_emergency_exceptions_grantor_idx
  on learning.emergency_exceptions(grantor_id);
create index learning_emergency_exceptions_approver_idx
  on learning.emergency_exceptions(approver_id);
create index learning_emergency_exceptions_revoked_by_idx
  on learning.emergency_exceptions(revoked_by);

create or replace function private.learning_audience_matches_current_profile(target_audience text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from core.profiles profile
    where profile.id = (select auth.uid())
      and profile.status = 'active'
      and (
        (profile.kind = 'employee' and target_audience = 'internal')
        or (profile.kind = 'vendor' and target_audience = 'vendor')
      )
  );
$$;

create or replace function private.learning_owns_department(target_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    not core.is_vendor()
    and exists (
      select 1
      from core.profile_department_scopes scope
      join core.profiles profile on profile.id = scope.profile_id
      where scope.profile_id = (select auth.uid())
        and scope.department_id = target_department_id
        and scope.scope_type = 'owner'
        and scope.effective_from <= current_date
        and (scope.effective_to is null or scope.effective_to >= current_date)
        and profile.kind = 'employee'
        and profile.status = 'active'
    );
$$;

revoke all on function private.learning_audience_matches_current_profile(text)
  from public, anon;
revoke all on function private.learning_owns_department(uuid)
  from public, anon;
grant execute on function private.learning_audience_matches_current_profile(text)
  to authenticated, service_role;
grant execute on function private.learning_owns_department(uuid)
  to authenticated, service_role;

create or replace function learning.reject_evidence_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Authoritative learning evidence is append-only';
end;
$$;

create or replace function learning.guard_certification_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Certification evidence cannot be deleted';
  end if;
  if old.status <> 'active' then
    raise exception 'Finalized certification evidence is immutable';
  end if;
  if (to_jsonb(new) - array['status', 'revoked_at', 'superseded_at'])
     is distinct from
     (to_jsonb(old) - array['status', 'revoked_at', 'superseded_at']) then
    raise exception 'Certification issuance evidence is immutable';
  end if;
  if new.status not in ('active', 'expired', 'revoked', 'superseded') then
    raise exception 'Invalid certification lifecycle transition';
  end if;
  return new;
end;
$$;

create or replace function learning.guard_emergency_exception_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Emergency exception evidence cannot be deleted';
  end if;
  if old.status <> 'active' then
    raise exception 'Finalized emergency exception evidence is immutable';
  end if;
  if (to_jsonb(new) - array['status', 'revoked_at', 'revoked_by', 'revocation_reason'])
     is distinct from
     (to_jsonb(old) - array['status', 'revoked_at', 'revoked_by', 'revocation_reason']) then
    raise exception 'Emergency exception approval evidence is immutable';
  end if;
  if new.status not in ('active', 'expired', 'revoked') then
    raise exception 'Invalid emergency exception lifecycle transition';
  end if;
  return new;
end;
$$;

create or replace function learning.guard_published_content()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Reviewed or published learning content is immutable';
    end if;
    return old;
  end if;
  if old.status in ('superseded', 'retired') and new is distinct from old then
    raise exception 'Finalized learning content is immutable';
  end if;
  if old.status = 'published' then
    if new.status not in ('published', 'superseded', 'retired') then
      raise exception 'Published learning content cannot return to an editable state';
    end if;
    if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
      raise exception 'Published learning content is immutable; create a new version';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function learning.reject_evidence_mutation()
  from public, anon, authenticated;
revoke all on function learning.guard_certification_lifecycle()
  from public, anon, authenticated;
revoke all on function learning.guard_emergency_exception_lifecycle()
  from public, anon, authenticated;
revoke all on function learning.guard_published_content()
  from public, anon, authenticated;
grant execute on function learning.reject_evidence_mutation() to service_role;
grant execute on function learning.guard_certification_lifecycle() to service_role;
grant execute on function learning.guard_emergency_exception_lifecycle() to service_role;
grant execute on function learning.guard_published_content() to service_role;

create trigger learning_attempts_append_only
before update or delete on learning.attempts
for each row execute function learning.reject_evidence_mutation();

create trigger learning_attempt_events_append_only
before update or delete on learning.attempt_events
for each row execute function learning.reject_evidence_mutation();

create trigger learning_policy_acknowledgments_append_only
before update or delete on learning.policy_acknowledgments
for each row execute function learning.reject_evidence_mutation();

create trigger learning_certifications_lifecycle_guard
before update or delete on learning.certifications
for each row execute function learning.guard_certification_lifecycle();

create trigger learning_emergency_exceptions_lifecycle_guard
before update or delete on learning.emergency_exceptions
for each row execute function learning.guard_emergency_exception_lifecycle();

create trigger learning_curriculum_versions_published_immutable
before update or delete on learning.curriculum_versions
for each row execute function learning.guard_published_content();

create trigger learning_requirement_versions_published_immutable
before update or delete on learning.requirement_versions
for each row execute function learning.guard_published_content();

alter table learning.curricula enable row level security;
alter table learning.curricula force row level security;
alter table learning.curriculum_versions enable row level security;
alter table learning.curriculum_versions force row level security;
alter table learning.requirements enable row level security;
alter table learning.requirements force row level security;
alter table learning.requirement_versions enable row level security;
alter table learning.requirement_versions force row level security;
alter table learning.curriculum_requirements enable row level security;
alter table learning.curriculum_requirements force row level security;
alter table learning.role_curricula enable row level security;
alter table learning.role_curricula force row level security;
alter table learning.assignments enable row level security;
alter table learning.assignments force row level security;
alter table learning.assignment_requirements enable row level security;
alter table learning.assignment_requirements force row level security;
alter table learning.attempts enable row level security;
alter table learning.attempts force row level security;
alter table learning.attempt_events enable row level security;
alter table learning.attempt_events force row level security;
alter table learning.policy_acknowledgments enable row level security;
alter table learning.policy_acknowledgments force row level security;
alter table learning.certifications enable row level security;
alter table learning.certifications force row level security;
alter table learning.emergency_exceptions enable row level security;
alter table learning.emergency_exceptions force row level security;

create policy learning_curricula_published_read on learning.curricula
for select to authenticated
using (
  status = 'active'
  and private.learning_audience_matches_current_profile(audience)
);

create policy learning_curricula_platform_manage on learning.curricula
for all to authenticated
using (core.has_cap('core', 'manage_rbac'))
with check (core.has_cap('core', 'manage_rbac'));

create policy learning_curricula_department_manage on learning.curricula
for all to authenticated
using (
  audience = 'internal'
  and governance_owner = 'department'
  and private.learning_owns_department(owner_department_id)
)
with check (
  audience = 'internal'
  and governance_owner = 'department'
  and private.learning_owns_department(owner_department_id)
);

create policy learning_curricula_legal_manage on learning.curricula
for all to authenticated
using (
  governance_owner = 'legal'
  and core.has_cap('legal', 'review_accreditation')
  and not core.is_vendor()
)
with check (
  governance_owner = 'legal'
  and core.has_cap('legal', 'review_accreditation')
  and not core.is_vendor()
);

create policy learning_curriculum_versions_published_read on learning.curriculum_versions
for select to authenticated
using (
  status = 'published'
  and effective_at <= now()
  and (expires_at is null or expires_at > now())
  and private.learning_audience_matches_current_profile(audience)
);

create policy learning_curriculum_versions_platform_manage on learning.curriculum_versions
for all to authenticated
using (core.has_cap('core', 'manage_rbac'))
with check (core.has_cap('core', 'manage_rbac'));

create policy learning_curriculum_versions_owner_manage on learning.curriculum_versions
for all to authenticated
using (
  exists (
    select 1 from learning.curricula curriculum
    where curriculum.id = learning.curriculum_versions.curriculum_id
      and curriculum.audience = learning.curriculum_versions.audience
      and (
        (
          curriculum.governance_owner = 'department'
          and curriculum.audience = 'internal'
          and private.learning_owns_department(curriculum.owner_department_id)
        )
        or (
          curriculum.governance_owner = 'legal'
          and core.has_cap('legal', 'review_accreditation')
          and not core.is_vendor()
        )
      )
  )
)
with check (
  exists (
    select 1 from learning.curricula curriculum
    where curriculum.id = learning.curriculum_versions.curriculum_id
      and curriculum.audience = learning.curriculum_versions.audience
      and (
        (
          curriculum.governance_owner = 'department'
          and curriculum.audience = 'internal'
          and private.learning_owns_department(curriculum.owner_department_id)
        )
        or (
          curriculum.governance_owner = 'legal'
          and core.has_cap('legal', 'review_accreditation')
          and not core.is_vendor()
        )
      )
  )
);

create policy learning_requirements_published_read on learning.requirements
for select to authenticated
using (
  status = 'active'
  and private.learning_audience_matches_current_profile(audience)
);

create policy learning_requirements_platform_manage on learning.requirements
for all to authenticated
using (core.has_cap('core', 'manage_rbac'))
with check (core.has_cap('core', 'manage_rbac'));

create policy learning_requirements_owner_manage on learning.requirements
for all to authenticated
using (
  (
    audience = 'internal'
    and governance_owner = 'department'
    and private.learning_owns_department(owner_department_id)
  )
  or (
    governance_owner = 'legal'
    and core.has_cap('legal', 'review_accreditation')
    and not core.is_vendor()
  )
)
with check (
  (
    audience = 'internal'
    and governance_owner = 'department'
    and private.learning_owns_department(owner_department_id)
  )
  or (
    governance_owner = 'legal'
    and core.has_cap('legal', 'review_accreditation')
    and not core.is_vendor()
  )
);

create policy learning_requirement_versions_published_read on learning.requirement_versions
for select to authenticated
using (
  status = 'published'
  and effective_at <= now()
  and (expires_at is null or expires_at > now())
  and private.learning_audience_matches_current_profile(audience)
);

create policy learning_requirement_versions_platform_manage on learning.requirement_versions
for all to authenticated
using (core.has_cap('core', 'manage_rbac'))
with check (core.has_cap('core', 'manage_rbac'));

create policy learning_requirement_versions_owner_manage on learning.requirement_versions
for all to authenticated
using (
  (
    audience = 'internal'
    and governance_owner = 'department'
    and private.learning_owns_department(owner_department_id)
  )
  or (
    governance_owner = 'legal'
    and core.has_cap('legal', 'review_accreditation')
    and not core.is_vendor()
  )
)
with check (
  (
    audience = 'internal'
    and governance_owner = 'department'
    and private.learning_owns_department(owner_department_id)
  )
  or (
    governance_owner = 'legal'
    and core.has_cap('legal', 'review_accreditation')
    and not core.is_vendor()
  )
);

create policy learning_curriculum_requirements_published_read on learning.curriculum_requirements
for select to authenticated
using (
  private.learning_audience_matches_current_profile(audience)
  and exists (
    select 1 from learning.curriculum_versions version
    where version.id = curriculum_version_id
      and version.status = 'published'
      and version.effective_at <= now()
      and (version.expires_at is null or version.expires_at > now())
  )
);

create policy learning_curriculum_requirements_platform_manage on learning.curriculum_requirements
for all to authenticated
using (core.has_cap('core', 'manage_rbac'))
with check (core.has_cap('core', 'manage_rbac'));

create policy learning_role_curricula_published_read on learning.role_curricula
for select to authenticated
using (
  effective_at <= now()
  and (expires_at is null or expires_at > now())
  and private.learning_audience_matches_current_profile(audience)
);

create policy learning_role_curricula_platform_manage on learning.role_curricula
for all to authenticated
using (core.has_cap('core', 'manage_rbac'))
with check (core.has_cap('core', 'manage_rbac'));

create policy learning_assignments_learner_read on learning.assignments
for select to authenticated
using (
  not core.is_vendor()
  and user_id = (select auth.uid())
  and private.learning_audience_matches_current_profile(audience)
);

create policy learning_assignments_vendor_read on learning.assignments
for select to authenticated
using (
  core.is_vendor()
  and user_id = (select auth.uid())
  and audience = 'vendor'
);

create policy learning_assignments_department_owner_read on learning.assignments
for select to authenticated
using (
  private.learning_owns_department(department_id)
  and audience = 'internal'
);

create policy learning_assignments_platform_read on learning.assignments
for select to authenticated
using (
  core.has_cap('core', 'manage_rbac')
  and audience = 'internal'
);

create policy learning_assignment_requirements_learner_read on learning.assignment_requirements
for select to authenticated
using (
  user_id = (select auth.uid())
  and private.learning_audience_matches_current_profile(audience)
);

create policy learning_assignment_requirements_department_owner_read on learning.assignment_requirements
for select to authenticated
using (
  private.learning_owns_department(department_id)
  and audience = 'internal'
);

create policy learning_assignment_requirements_platform_read on learning.assignment_requirements
for select to authenticated
using (
  core.has_cap('core', 'manage_rbac')
  and audience = 'internal'
);

create policy learning_attempts_learner_read on learning.attempts
for select to authenticated
using (
  user_id = (select auth.uid())
  and private.learning_audience_matches_current_profile(audience)
);

create policy learning_attempts_department_owner_read on learning.attempts
for select to authenticated
using (
  private.learning_owns_department(department_id)
  and audience = 'internal'
);

create policy learning_attempts_platform_read on learning.attempts
for select to authenticated
using (
  core.has_cap('core', 'manage_rbac')
  and audience = 'internal'
);

create policy learning_attempt_events_learner_read on learning.attempt_events
for select to authenticated
using (
  user_id = (select auth.uid())
  and private.learning_audience_matches_current_profile(audience)
);

create policy learning_attempt_events_department_owner_read on learning.attempt_events
for select to authenticated
using (
  private.learning_owns_department(department_id)
  and audience = 'internal'
);

create policy learning_attempt_events_platform_read on learning.attempt_events
for select to authenticated
using (
  core.has_cap('core', 'manage_rbac')
  and audience = 'internal'
);

create policy learning_policy_acknowledgments_learner_read on learning.policy_acknowledgments
for select to authenticated
using (
  user_id = (select auth.uid())
  and private.learning_audience_matches_current_profile(audience)
);

create policy learning_policy_acknowledgments_department_owner_read on learning.policy_acknowledgments
for select to authenticated
using (
  private.learning_owns_department(department_id)
  and audience = 'internal'
);

create policy learning_policy_acknowledgments_legal_read on learning.policy_acknowledgments
for select to authenticated
using (
  core.has_cap('legal', 'review_accreditation')
  and not core.is_vendor()
  and audience = 'internal'
  and exists (
    select 1 from learning.requirement_versions requirement_version
    where requirement_version.id = requirement_version_id
      and requirement_version.requirement_kind = 'policy'
      and requirement_version.governance_owner = 'legal'
  )
);

create policy learning_policy_acknowledgments_legal_vendor_read on learning.policy_acknowledgments
for select to authenticated
using (
  core.has_cap('legal', 'review_accreditation')
  and not core.is_vendor()
  and audience = 'vendor'
  and exists (
    select 1 from learning.requirement_versions requirement_version
    where requirement_version.id = learning.policy_acknowledgments.requirement_version_id
      and requirement_version.audience = 'vendor'
      and requirement_version.requirement_kind = 'policy'
      and requirement_version.governance_owner = 'legal'
  )
);

create policy learning_policy_acknowledgments_platform_read on learning.policy_acknowledgments
for select to authenticated
using (
  core.has_cap('core', 'manage_rbac')
  and audience = 'internal'
);

create policy learning_certifications_learner_read on learning.certifications
for select to authenticated
using (
  user_id = (select auth.uid())
  and private.learning_audience_matches_current_profile(audience)
);

create policy learning_certifications_department_owner_read on learning.certifications
for select to authenticated
using (
  private.learning_owns_department(department_id)
  and audience = 'internal'
);

create policy learning_certifications_platform_read on learning.certifications
for select to authenticated
using (
  core.has_cap('core', 'manage_rbac')
  and audience = 'internal'
);

create policy learning_emergency_exceptions_learner_read on learning.emergency_exceptions
for select to authenticated
using (
  user_id = (select auth.uid())
  and not core.is_vendor()
  and audience = 'internal'
);

create policy learning_emergency_exceptions_department_owner_read on learning.emergency_exceptions
for select to authenticated
using (
  private.learning_owns_department(department_id)
  and audience = 'internal'
);

create policy learning_emergency_exceptions_platform_read on learning.emergency_exceptions
for select to authenticated
using (
  core.has_cap('core', 'manage_rbac')
  and audience = 'internal'
);

revoke all on learning.curricula from public, anon, authenticated;
revoke all on learning.curriculum_versions from public, anon, authenticated;
revoke all on learning.requirements from public, anon, authenticated;
revoke all on learning.requirement_versions from public, anon, authenticated;
revoke all on learning.curriculum_requirements from public, anon, authenticated;
revoke all on learning.role_curricula from public, anon, authenticated;
revoke all on learning.assignments from public, anon, authenticated;
revoke all on learning.assignment_requirements from public, anon, authenticated;
revoke all on learning.attempts from public, anon, authenticated;
revoke all on learning.attempt_events from public, anon, authenticated;
revoke all on learning.policy_acknowledgments from public, anon, authenticated;
revoke all on learning.certifications from public, anon, authenticated;
revoke all on learning.emergency_exceptions from public, anon, authenticated;

grant select on learning.curricula to authenticated;
grant select on learning.curriculum_versions to authenticated;
grant select on learning.requirements to authenticated;
grant select on learning.requirement_versions to authenticated;
grant select on learning.curriculum_requirements to authenticated;
grant select on learning.role_curricula to authenticated;
grant select on learning.assignments to authenticated;
grant select on learning.assignment_requirements to authenticated;
grant select on learning.attempts to authenticated;
grant select on learning.attempt_events to authenticated;
grant select on learning.policy_acknowledgments to authenticated;
grant select on learning.certifications to authenticated;
grant select on learning.emergency_exceptions to authenticated;

grant insert, update, delete on learning.curricula to authenticated;
grant insert, update, delete on learning.curriculum_versions to authenticated;
grant insert, update, delete on learning.requirements to authenticated;
grant insert, update, delete on learning.requirement_versions to authenticated;
grant insert, update, delete on learning.curriculum_requirements to authenticated;
grant insert, update, delete on learning.role_curricula to authenticated;

grant all on learning.curricula to service_role;
grant all on learning.curriculum_versions to service_role;
grant all on learning.requirements to service_role;
grant all on learning.requirement_versions to service_role;
grant all on learning.curriculum_requirements to service_role;
grant all on learning.role_curricula to service_role;
grant all on learning.assignments to service_role;
grant all on learning.assignment_requirements to service_role;
grant all on learning.attempts to service_role;
grant all on learning.attempt_events to service_role;
grant all on learning.policy_acknowledgments to service_role;
grant all on learning.certifications to service_role;
grant all on learning.emergency_exceptions to service_role;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
