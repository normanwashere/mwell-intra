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
create unique index if not exists core_profiles_id_kind_key
  on core.profiles(id, kind);

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
  supersedes_id uuid,
  created_at timestamptz not null default now(),
  constraint curriculum_versions_curriculum_fk
    foreign key (curriculum_id, audience)
    references learning.curricula(id, audience) on delete restrict,
  constraint curriculum_versions_supersedes_fk
    foreign key (supersedes_id, audience)
    references learning.curriculum_versions(id, audience) on delete restrict,
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
  constraint curriculum_versions_chronology_check
    check (
      (approved_at is null or approved_at >= created_at)
      and (published_at is null or (approved_at is not null and published_at >= approved_at))
      and (published_at is null or (effective_at is not null and published_at <= effective_at))
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
  unique (id, audience, requirement_kind, governance_owner),
  unique (id, audience, requirement_kind, governance_owner, owner_department_id)
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
  supersedes_id uuid,
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
  constraint requirement_versions_department_owner_fk
    foreign key (
      requirement_id,
      audience,
      requirement_kind,
      governance_owner,
      owner_department_id
    ) references learning.requirements(
      id,
      audience,
      requirement_kind,
      governance_owner,
      owner_department_id
    ) on delete restrict,
  constraint requirement_versions_owner_department_fk
    foreign key (owner_department_id)
    references core.departments(id) on delete restrict,
  constraint requirement_versions_supersedes_fk
    foreign key (supersedes_id, audience)
    references learning.requirement_versions(id, audience) on delete restrict,
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
  constraint requirement_versions_chronology_check
    check (
      (approved_at is null or approved_at >= created_at)
      and (published_at is null or (approved_at is not null and published_at >= approved_at))
      and (published_at is null or (effective_at is not null and published_at <= effective_at))
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
  created_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint curriculum_requirements_curriculum_fk
    foreign key (curriculum_version_id, audience)
    references learning.curriculum_versions(id, audience) on delete restrict,
  constraint curriculum_requirements_requirement_fk
    foreign key (requirement_version_id, audience)
    references learning.requirement_versions(id, audience) on delete restrict,
  constraint curriculum_requirements_order_check check (sort_order >= 0),
  unique (curriculum_version_id, requirement_version_id),
  unique (id, curriculum_version_id, requirement_version_id, audience),
  unique (curriculum_version_id, requirement_version_id, audience)
);

create table learning.curriculum_requirement_prerequisites (
  id uuid primary key default gen_random_uuid(),
  curriculum_requirement_id uuid not null,
  curriculum_version_id uuid not null,
  requirement_version_id uuid not null,
  prerequisite_requirement_version_id uuid not null,
  audience text not null,
  created_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint curriculum_requirement_prerequisites_source_fk
    foreign key (
      curriculum_requirement_id,
      curriculum_version_id,
      requirement_version_id,
      audience
    ) references learning.curriculum_requirements(
      id,
      curriculum_version_id,
      requirement_version_id,
      audience
    ) on delete restrict,
  constraint curriculum_requirement_prerequisites_target_fk
    foreign key (
      curriculum_version_id,
      prerequisite_requirement_version_id,
      audience
    ) references learning.curriculum_requirements(
      curriculum_version_id,
      requirement_version_id,
      audience
    ) on delete restrict,
  constraint curriculum_requirement_prerequisites_not_self_check
    check (requirement_version_id <> prerequisite_requirement_version_id),
  unique (curriculum_requirement_id, prerequisite_requirement_version_id)
);

create table learning.curriculum_capability_outcomes (
  id uuid primary key default gen_random_uuid(),
  curriculum_requirement_id uuid not null,
  curriculum_version_id uuid not null,
  requirement_version_id uuid not null,
  audience text not null,
  module text not null,
  capability text not null,
  created_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint curriculum_capability_outcomes_source_fk
    foreign key (
      curriculum_requirement_id,
      curriculum_version_id,
      requirement_version_id,
      audience
    ) references learning.curriculum_requirements(
      id,
      curriculum_version_id,
      requirement_version_id,
      audience
    ) on delete restrict,
  constraint curriculum_capability_outcomes_capability_fk
    foreign key (module, capability)
    references core.capabilities(module, cap) on delete restrict,
  constraint curriculum_capability_outcomes_audience_check
    check (
      audience = 'internal'
      or (
        audience = 'vendor'
        and module = 'core'
        and capability = 'submit_accreditation'
      )
    ),
  unique (curriculum_requirement_id, module, capability)
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
  user_id uuid not null,
  profile_kind text not null,
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
  superseded_by_id uuid,
  assigned_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint assignments_curriculum_fk
    foreign key (curriculum_version_id, audience)
    references learning.curriculum_versions(id, audience) on delete restrict,
  constraint assignments_profile_fk
    foreign key (user_id, profile_kind)
    references core.profiles(id, kind) on delete restrict,
  constraint assignments_superseded_by_fk
    foreign key (superseded_by_id, user_id, department_id, audience)
    references learning.assignments(id, user_id, department_id, audience) on delete restrict,
  constraint assignments_audience_check check (audience in ('internal', 'vendor')),
  constraint assignments_profile_audience_check
    check (
      (profile_kind = 'employee' and audience = 'internal')
      or (profile_kind = 'vendor' and audience = 'vendor')
    ),
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
  constraint assignments_chronology_check
    check (
      (reassigned_at is null or reassigned_at >= assigned_at)
      and (started_at is null or started_at >= assigned_at)
      and (completed_at is null or completed_at >= coalesce(started_at, assigned_at))
    ),
  unique (id, audience),
  unique (id, user_id, department_id, audience),
  unique (id, user_id, department_id, audience, curriculum_version_id)
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
    check (
      status <> 'waived'
      or (
        jsonb_typeof(waiver_evidence) = 'object'
        and waiver_evidence <> '{}'::jsonb
      )
    ),
  constraint assignment_requirements_chronology_check
    check (
      (started_at is null or started_at >= created_at)
      and (completed_at is null or completed_at >= coalesce(started_at, created_at))
    ),
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
  constraint attempts_chronology_check
    check (
      (submitted_at is null or started_at <= submitted_at)
      and (completed_at is null or started_at <= completed_at)
      and (
        submitted_at is null
        or completed_at is null
        or submitted_at <= completed_at
      )
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
  constraint policy_acknowledgments_chronology_check
    check (accepted_at <= created_at),
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
    foreign key (
      assignment_id,
      user_id,
      department_id,
      audience,
      curriculum_version_id
    ) references learning.assignments(
      id,
      user_id,
      department_id,
      audience,
      curriculum_version_id
    ) on delete restrict,
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
    check (
      cardinality(requirement_version_ids) > 0
      and array_position(requirement_version_ids, null) is null
    ),
  constraint certifications_evidence_check
    check (jsonb_typeof(evidence_references) = 'array' and jsonb_array_length(evidence_references) > 0),
  constraint certifications_effective_window_check
    check (
      issued_at <= created_at
      and issued_at <= effective_at
      and (expires_at is null or expires_at > effective_at)
      and (revoked_at is null or revoked_at >= issued_at)
      and (superseded_at is null or superseded_at >= issued_at)
    ),
  constraint certifications_lifecycle_check
    check (
      (status = 'revoked') = (revoked_at is not null)
      and (status = 'superseded') = (superseded_at is not null)
      and (status <> 'expired' or expires_at is not null)
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
    check (
      grantor_id <> approver_id
      and grantor_id <> user_id
      and approver_id <> user_id
    ),
  constraint emergency_exceptions_duration_check
    check (
      approved_at >= created_at
      and approved_at <= effective_at
      and expires_at > effective_at
      and expires_at <= effective_at + interval '24 hours'
    ),
  constraint emergency_exceptions_no_legal_waiver_check
    check (waives_legal_acknowledgment = false),
  constraint emergency_exceptions_revocation_check
    check (
      (status = 'revoked') = (revoked_at is not null)
      and (status = 'revoked') = (revoked_by is not null)
      and (status = 'revoked') = (nullif(btrim(revocation_reason), '') is not null)
      and (
        revoked_at is null
        or (revoked_at >= created_at and revoked_at >= approved_at)
      )
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

create index learning_curricula_department_fk_idx
  on learning.curricula(owner_department_id);
create index learning_curricula_created_by_fk_idx
  on learning.curricula(created_by);
create index learning_curriculum_versions_curriculum_fk_idx
  on learning.curriculum_versions(curriculum_id, audience, status, effective_at);
create index learning_curriculum_versions_owner_fk_idx
  on learning.curriculum_versions(owner_id);
create index learning_curriculum_versions_reviewer_fk_idx
  on learning.curriculum_versions(reviewer_id);
create index learning_curriculum_versions_supersedes_fk_idx
  on learning.curriculum_versions(supersedes_id, audience);
create index learning_requirements_department_fk_idx
  on learning.requirements(owner_department_id);
create index learning_requirements_created_by_fk_idx
  on learning.requirements(created_by);
create index learning_requirement_versions_requirement_fk_idx
  on learning.requirement_versions(
    requirement_id,
    audience,
    requirement_kind,
    governance_owner,
    owner_department_id
  );
create index learning_requirement_versions_department_fk_idx
  on learning.requirement_versions(owner_department_id);
create index learning_requirement_versions_owner_fk_idx
  on learning.requirement_versions(owner_id);
create index learning_requirement_versions_reviewer_fk_idx
  on learning.requirement_versions(reviewer_id);
create index learning_requirement_versions_supersedes_fk_idx
  on learning.requirement_versions(supersedes_id, audience);
create index learning_curriculum_requirements_curriculum_fk_idx
  on learning.curriculum_requirements(curriculum_version_id, audience);
create index learning_curriculum_requirements_requirement_fk_idx
  on learning.curriculum_requirements(requirement_version_id, audience);
create index learning_curriculum_requirements_created_by_fk_idx
  on learning.curriculum_requirements(created_by);
create index learning_curriculum_requirement_prerequisites_source_fk_idx
  on learning.curriculum_requirement_prerequisites(
    curriculum_requirement_id,
    curriculum_version_id,
    requirement_version_id,
    audience
  );
create index learning_curriculum_requirement_prerequisites_target_fk_idx
  on learning.curriculum_requirement_prerequisites(
    curriculum_version_id,
    prerequisite_requirement_version_id,
    audience
  );
create index learning_curriculum_requirement_prerequisites_created_by_fk_idx
  on learning.curriculum_requirement_prerequisites(created_by);
create index learning_curriculum_capability_outcomes_source_fk_idx
  on learning.curriculum_capability_outcomes(
    curriculum_requirement_id,
    curriculum_version_id,
    requirement_version_id,
    audience
  );
create index learning_curriculum_capability_outcomes_capability_fk_idx
  on learning.curriculum_capability_outcomes(module, capability);
create index learning_curriculum_capability_outcomes_created_by_fk_idx
  on learning.curriculum_capability_outcomes(created_by);
create index learning_role_curricula_curriculum_fk_idx
  on learning.role_curricula(curriculum_version_id, audience);
create index learning_role_curricula_department_fk_idx
  on learning.role_curricula(department_id);
create index learning_role_curricula_created_by_fk_idx
  on learning.role_curricula(created_by);
create index learning_assignments_profile_fk_idx
  on learning.assignments(user_id, profile_kind);
create index learning_assignments_department_fk_idx
  on learning.assignments(department_id);
create index learning_assignments_curriculum_fk_idx
  on learning.assignments(curriculum_version_id, audience);
create index learning_assignments_superseded_by_fk_idx
  on learning.assignments(superseded_by_id, user_id, department_id, audience);
create index learning_assignments_assigned_by_fk_idx
  on learning.assignments(assigned_by);
create index learning_assignments_user_status_idx
  on learning.assignments(user_id, status, due_at);
create index learning_assignments_department_status_idx
  on learning.assignments(department_id, status, due_at);
create index learning_assignment_requirements_assignment_fk_idx
  on learning.assignment_requirements(assignment_id, user_id, department_id, audience);
create index learning_assignment_requirements_requirement_fk_idx
  on learning.assignment_requirements(requirement_version_id, audience);
create index learning_assignment_requirements_user_status_idx
  on learning.assignment_requirements(user_id, status);
create index learning_attempts_assignment_requirement_fk_idx
  on learning.attempts(
    assignment_requirement_id,
    user_id,
    department_id,
    audience,
    requirement_version_id
  );
create index learning_attempts_user_created_idx
  on learning.attempts(user_id, created_at desc);
create index learning_attempt_events_attempt_fk_idx
  on learning.attempt_events(attempt_id, user_id, department_id, audience);
create index learning_attempt_events_user_created_idx
  on learning.attempt_events(user_id, created_at desc);
create index learning_attempt_events_actor_fk_idx
  on learning.attempt_events(actor_id);
create index learning_policy_acknowledgments_assignment_requirement_fk_idx
  on learning.policy_acknowledgments(
    assignment_requirement_id,
    user_id,
    department_id,
    audience,
    requirement_version_id
  );
create index learning_policy_acknowledgments_department_idx
  on learning.policy_acknowledgments(department_id, accepted_at desc);
create index learning_policy_acknowledgments_actor_fk_idx
  on learning.policy_acknowledgments(actor_id);
create index learning_certifications_user_fk_idx
  on learning.certifications(user_id);
create index learning_certifications_department_fk_idx
  on learning.certifications(department_id);
create index learning_certifications_assignment_fk_idx
  on learning.certifications(
    assignment_id,
    user_id,
    department_id,
    audience,
    curriculum_version_id
  );
create index learning_certifications_capability_fk_idx
  on learning.certifications(module, capability);
create index learning_certifications_curriculum_fk_idx
  on learning.certifications(curriculum_version_id, audience);
create index learning_certifications_source_role_assignment_idx
  on learning.certifications(source_role_assignment_id);
create index learning_certifications_user_status_idx
  on learning.certifications(user_id, status, expires_at);
create index learning_emergency_exceptions_user_fk_idx
  on learning.emergency_exceptions(user_id);
create index learning_emergency_exceptions_department_fk_idx
  on learning.emergency_exceptions(department_id);
create index learning_emergency_exceptions_capability_fk_idx
  on learning.emergency_exceptions(module, capability);
create index learning_emergency_exceptions_grantor_fk_idx
  on learning.emergency_exceptions(grantor_id);
create index learning_emergency_exceptions_approver_fk_idx
  on learning.emergency_exceptions(approver_id);
create index learning_emergency_exceptions_revoked_by_fk_idx
  on learning.emergency_exceptions(revoked_by);

create or replace function private.learning_has_active_profile(required_audience text)
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
        (profile.kind = 'employee' and required_audience = 'internal')
        or (profile.kind = 'vendor' and required_audience = 'vendor')
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
    private.learning_has_active_profile('internal')
    and exists (
      select 1
      from core.profile_department_scopes scope
      where scope.profile_id = (select auth.uid())
        and scope.department_id = target_department_id
        and scope.scope_type = 'owner'
        and scope.effective_from <= current_date
        and (scope.effective_to is null or scope.effective_to >= current_date)
    );
$$;

create or replace function private.learning_is_active_employee_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.learning_has_active_profile('internal')
    and core.has_cap('core', 'manage_rbac');
$$;

revoke all on function private.learning_has_active_profile(text)
  from public, anon;
revoke all on function private.learning_owns_department(uuid)
  from public, anon;
revoke all on function private.learning_is_active_employee_platform_admin()
  from public, anon;
grant execute on function private.learning_has_active_profile(text)
  to authenticated, service_role;
grant execute on function private.learning_owns_department(uuid)
  to authenticated, service_role;
grant execute on function private.learning_is_active_employee_platform_admin()
  to authenticated, service_role;

-- Supported isolation: authoritative learning writes run only at READ COMMITTED,
-- which refreshes the command snapshot after waiting for an authority-row lock.
-- Lock order: core.user_roles first, then learning.curriculum_versions in UUID
-- order, then learning.requirement_versions in UUID order. Role deletion already
-- holds its core.user_roles row lock before its BEFORE DELETE trigger runs.
create or replace function private.assert_learning_read_committed()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Authoritative learning writes require READ COMMITTED isolation'
      using errcode = '25001';
  end if;
end;
$$;

revoke all on function private.assert_learning_read_committed()
  from public, anon, authenticated, service_role;
grant execute on function private.assert_learning_read_committed()
  to service_role;

create or replace function private.lock_learning_curriculum_graph(
  target_curriculum_version_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_learning_read_committed();

  perform 1
  from learning.curriculum_versions curriculum_version
  where curriculum_version.id = any(target_curriculum_version_ids)
  order by curriculum_version.id
  for update;
end;
$$;

create or replace function private.validate_curriculum_graph_publication(
  target_curriculum_version_id uuid,
  target_audience text,
  target_effective_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_learning_read_committed();

  perform private.lock_learning_curriculum_graph(
    array[target_curriculum_version_id]
  );

  if target_effective_at is null then
    raise exception 'Approved curriculum graphs require an effective timestamp';
  end if;

  perform 1
  from learning.requirement_versions requirement_version
  join learning.curriculum_requirements curriculum_requirement
    on curriculum_requirement.requirement_version_id = requirement_version.id
   and curriculum_requirement.audience = requirement_version.audience
  where curriculum_requirement.curriculum_version_id = target_curriculum_version_id
    and curriculum_requirement.audience = target_audience
  order by requirement_version.id
  for share of requirement_version;

  if not exists (
    select 1
    from learning.curriculum_requirements curriculum_requirement
    where curriculum_requirement.curriculum_version_id = target_curriculum_version_id
      and curriculum_requirement.audience = target_audience
  ) then
    raise exception 'A curriculum graph cannot be published empty';
  end if;

  if exists (
    select 1
    from learning.curriculum_requirements curriculum_requirement
    join learning.requirement_versions requirement_version
      on requirement_version.id = curriculum_requirement.requirement_version_id
     and requirement_version.audience = curriculum_requirement.audience
    where curriculum_requirement.curriculum_version_id = target_curriculum_version_id
      and curriculum_requirement.audience = target_audience
      and (
        requirement_version.status <> 'published'
        or requirement_version.effective_at > target_effective_at
        or (
          requirement_version.expires_at is not null
          and requirement_version.expires_at <= target_effective_at
        )
      )
  ) then
    raise exception 'Curriculum graph requirements must be published and effective';
  end if;

  if exists (
    with recursive prerequisite_walk as (
      select
        edge.requirement_version_id as origin_id,
        edge.prerequisite_requirement_version_id as current_id,
        array[
          edge.requirement_version_id,
          edge.prerequisite_requirement_version_id
        ]::uuid[] as path,
        false as cycle
      from learning.curriculum_requirement_prerequisites edge
      where edge.curriculum_version_id = target_curriculum_version_id
        and edge.audience = target_audience

      union all

      select
        walk.origin_id,
        edge.prerequisite_requirement_version_id,
        walk.path || edge.prerequisite_requirement_version_id,
        edge.prerequisite_requirement_version_id = any(walk.path)
      from prerequisite_walk walk
      join learning.curriculum_requirement_prerequisites edge
        on edge.curriculum_version_id = target_curriculum_version_id
       and edge.audience = target_audience
       and edge.requirement_version_id = walk.current_id
      where not walk.cycle
    )
    select 1 from prerequisite_walk where cycle
  ) then
    raise exception 'Curriculum prerequisite graph cannot contain cycles';
  end if;
end;
$$;

revoke all on function private.lock_learning_curriculum_graph(uuid[])
  from public, anon, authenticated, service_role;
revoke all on function private.validate_curriculum_graph_publication(uuid, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function private.lock_learning_curriculum_graph(uuid[])
  to service_role;
grant execute on function private.validate_curriculum_graph_publication(uuid, text, timestamptz)
  to service_role;

create or replace function private.validate_assignment_requirement_waiver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requirement_version learning.requirement_versions%rowtype;
  parent_requirement learning.requirements%rowtype;
begin
  perform private.assert_learning_read_committed();

  if new.status <> 'waived' then
    return new;
  end if;

  select version.* into requirement_version
  from learning.requirement_versions version
  where version.id = new.requirement_version_id
    and version.audience = new.audience;
  if not found then
    raise exception 'Waiver requirement version is missing or crosses audiences';
  end if;

  if requirement_version.audience = 'vendor' then
    raise exception 'Vendor learning requirements cannot be waived';
  end if;

  select requirement.* into parent_requirement
  from learning.requirements requirement
  where requirement.id = requirement_version.requirement_id
    and requirement.audience = requirement_version.audience
    and requirement.requirement_kind = requirement_version.requirement_kind
    and requirement.governance_owner = requirement_version.governance_owner
    and requirement.owner_department_id is not distinct from requirement_version.owner_department_id;
  if not found then
    raise exception 'Waiver requirement ownership lineage is invalid';
  end if;

  if not requirement_version.waivable
     or (
       parent_requirement.governance_owner = 'legal'
       and parent_requirement.requirement_kind = 'policy'
     ) then
    raise exception 'This learning requirement cannot be waived';
  end if;

  return new;
end;
$$;

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
       select count(distinct requirement_id)
       from unnest(new.requirement_version_ids) requirement_id
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
    from unnest(new.requirement_version_ids) requirement_id
    where not exists (
      select 1
      from learning.curriculum_requirements curriculum_requirement
      join learning.requirement_versions requirement_version
        on requirement_version.id = curriculum_requirement.requirement_version_id
       and requirement_version.audience = curriculum_requirement.audience
      where curriculum_requirement.curriculum_version_id = new.curriculum_version_id
        and curriculum_requirement.requirement_version_id = requirement_id
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
    from unnest(new.requirement_version_ids) requirement_id
    where not exists (
      select 1
      from learning.assignment_requirements assignment_requirement
      where assignment_requirement.assignment_id = new.assignment_id
        and assignment_requirement.user_id = new.user_id
        and assignment_requirement.department_id = new.department_id
        and assignment_requirement.audience = new.audience
        and assignment_requirement.requirement_version_id = requirement_id
        and assignment_requirement.status in ('passed', 'waived')
    )
  ) then
    raise exception 'Certification requirement evidence is incomplete';
  end if;

  return new;
end;
$$;

create or replace function private.revoke_certifications_for_role_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_learning_read_committed();

  update learning.certifications
  set status = 'revoked',
      revoked_at = pg_catalog.clock_timestamp()
  where source_role_assignment_id = old.id
    and status = 'active';
  return old;
end;
$$;

create or replace function private.validate_emergency_exception_issuance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_learning_read_committed();

  if new.status <> 'active'
     or new.revoked_at is not null
     or new.revoked_by is not null
     or new.revocation_reason is not null then
    raise exception 'Emergency exceptions must be issued active and uncancelled';
  end if;

  if not exists (
    select 1
    from core.profiles beneficiary_profile
    join core.profile_department_scopes beneficiary_scope
      on beneficiary_scope.profile_id = beneficiary_profile.id
     and beneficiary_scope.department_id = new.department_id
     and beneficiary_scope.effective_from <= new.effective_at::date
     and (
       beneficiary_scope.effective_to is null
       or beneficiary_scope.effective_to >= new.expires_at::date
     )
    where beneficiary_profile.id = new.user_id
      and beneficiary_profile.kind = 'employee'
      and beneficiary_profile.status = 'active'
  ) then
    raise exception 'Emergency exception beneficiary must be an active internal department member';
  end if;

  if not exists (
    select 1
    from core.profiles grantor_profile
    join core.user_roles grantor_role
      on grantor_role.user_id = grantor_profile.id
     and grantor_role.module = 'core'
     and grantor_role.role = 'platform_admin'
    join core.roles grantor_role_definition
      on grantor_role_definition.module = grantor_role.module
     and grantor_role_definition.role = grantor_role.role
     and grantor_role_definition.is_active
    where grantor_profile.id = new.grantor_id
      and grantor_profile.kind = 'employee'
      and grantor_profile.status = 'active'
  ) then
    raise exception 'Emergency exception grantor must be an active Platform Administrator';
  end if;

  if not exists (
    select 1
    from core.profiles approver_profile
    join core.profile_department_scopes approver_scope
      on approver_scope.profile_id = approver_profile.id
     and approver_scope.department_id = new.department_id
     and approver_scope.scope_type = 'owner'
     and approver_scope.effective_from <= new.effective_at::date
     and (
       approver_scope.effective_to is null
       or approver_scope.effective_to >= new.expires_at::date
     )
    join core.user_roles approver_role
      on approver_role.user_id = approver_profile.id
     and approver_role.module = new.module
    join core.roles approver_role_definition
      on approver_role_definition.module = approver_role.module
     and approver_role_definition.role = approver_role.role
     and approver_role_definition.is_active
    join core.role_capabilities approver_capability
      on approver_capability.module = approver_role.module
     and approver_capability.role = approver_role.role
     and approver_capability.cap = new.capability
    where approver_profile.id = new.approver_id
      and approver_profile.kind = 'employee'
      and approver_profile.status = 'active'
  ) then
    raise exception 'Emergency exception approver lacks active capability and department scope';
  end if;

  return new;
end;
$$;

create or replace function learning.guard_authoritative_write_isolation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.assert_learning_read_committed();
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function learning.reject_evidence_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.assert_learning_read_committed();

  raise exception 'Authoritative learning evidence is append-only';
end;
$$;

create or replace function learning.guard_attempt_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.assert_learning_read_committed();

  if tg_op = 'DELETE' then
    raise exception 'Attempt evidence cannot be deleted';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'in_progress' then
      raise exception 'Attempts must begin in progress';
    end if;
    return new;
  end if;
  if old.status <> 'in_progress' then
    raise exception 'Terminal attempt evidence is immutable';
  end if;
  if new.status not in ('passed', 'failed', 'abandoned', 'invalidated') then
    raise exception 'Attempt may transition only once to a terminal state';
  end if;
  if (to_jsonb(new) - array['status', 'score', 'integrity_result', 'submitted_at', 'completed_at'])
     is distinct from
     (to_jsonb(old) - array['status', 'score', 'integrity_result', 'submitted_at', 'completed_at']) then
    raise exception 'Attempt identity and source evidence are immutable';
  end if;
  return new;
end;
$$;

create or replace function learning.guard_assignment_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.assert_learning_read_committed();

  if tg_op = 'DELETE' then
    raise exception 'Assignment evidence cannot be deleted';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'assigned' then
      raise exception 'Assignments must begin assigned';
    end if;
    return new;
  end if;
  if old.status in ('completed', 'expired', 'superseded', 'cancelled') then
    if new is distinct from old then
      raise exception 'Terminal assignment evidence is immutable';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - array[
        'status', 'due_at', 'reassigned_at', 'started_at', 'completed_at',
        'blocked_reason', 'retraining_reason', 'superseded_by_id'
      ]) is distinct from
     (to_jsonb(old) - array[
        'status', 'due_at', 'reassigned_at', 'started_at', 'completed_at',
        'blocked_reason', 'retraining_reason', 'superseded_by_id'
      ]) then
    raise exception 'Assignment identity and source evidence are immutable';
  end if;
  if (old.status = 'assigned' and new.status not in (
        'assigned', 'in_progress', 'blocked', 'expired', 'superseded', 'cancelled'
      ))
     or (old.status = 'in_progress' and new.status not in (
        'in_progress', 'completed', 'blocked', 'expired', 'superseded', 'cancelled'
      ))
     or (old.status = 'blocked' and new.status not in (
        'blocked', 'assigned', 'in_progress', 'expired', 'superseded', 'cancelled'
      )) then
    raise exception 'Invalid assignment lifecycle transition';
  end if;
  return new;
end;
$$;

create or replace function learning.guard_assignment_requirement_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.assert_learning_read_committed();

  if tg_op = 'DELETE' then
    raise exception 'Assignment requirement evidence cannot be deleted';
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'not_started' then
      raise exception 'Assignment requirements must begin not started';
    end if;
    return new;
  end if;
  if old.status in ('passed', 'waived', 'expired') then
    if new is distinct from old then
      raise exception 'Terminal assignment requirement evidence is immutable';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - array[
        'status', 'attempt_count', 'progress', 'started_at', 'completed_at',
        'last_checkpoint_id', 'waiver_evidence'
      ]) is distinct from
     (to_jsonb(old) - array[
        'status', 'attempt_count', 'progress', 'started_at', 'completed_at',
        'last_checkpoint_id', 'waiver_evidence'
      ]) then
    raise exception 'Assignment requirement identity is immutable';
  end if;
  if (old.status = 'not_started' and new.status not in (
        'not_started', 'in_progress', 'waived', 'expired'
      ))
     or (old.status = 'in_progress' and new.status not in (
        'in_progress', 'passed', 'failed_retryable', 'needs_support', 'waived', 'expired'
      ))
     or (old.status = 'failed_retryable' and new.status not in (
        'in_progress', 'failed_retryable', 'needs_support', 'waived', 'expired'
      ))
     or (old.status = 'needs_support' and new.status not in (
        'in_progress', 'needs_support', 'waived', 'expired'
      )) then
    raise exception 'Invalid assignment requirement lifecycle transition';
  end if;
  return new;
end;
$$;

create or replace function learning.guard_certification_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.assert_learning_read_committed();

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
  perform private.assert_learning_read_committed();

  if tg_op = 'DELETE' then
    raise exception 'Emergency exception evidence cannot be deleted';
  end if;
  if old.status <> 'active' then
    raise exception 'Finalized emergency exception evidence is immutable';
  end if;
  if new.status = 'revoked' then
    new.revoked_at := pg_catalog.clock_timestamp();
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

create or replace function learning.guard_content_lifecycle()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.assert_learning_read_committed();

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'Learning content must begin as a draft';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status not in ('draft', 'in_review') then
      raise exception 'Approved or published learning content is immutable';
    end if;
    return old;
  end if;

  if tg_table_name = 'curriculum_versions'
     and new.status in ('approved', 'scheduled', 'published') then
    perform private.validate_curriculum_graph_publication(
      new.id,
      new.audience,
      new.effective_at
    );
  end if;

  if old.status = 'draft' and new.status not in ('draft', 'in_review') then
    raise exception 'Invalid draft content transition';
  elsif old.status = 'in_review' and new.status not in ('draft', 'in_review', 'approved') then
    raise exception 'Invalid review content transition';
  elsif old.status = 'approved' and new.status not in ('approved', 'scheduled', 'published', 'retired') then
    raise exception 'Approved content cannot return to an editable state';
  elsif old.status = 'scheduled' and new.status not in ('scheduled', 'published', 'retired') then
    raise exception 'Scheduled content cannot return to an editable state';
  elsif old.status = 'published' and new.status not in ('published', 'superseded', 'retired') then
    raise exception 'Published content cannot return to an editable state';
  elsif old.status in ('superseded', 'retired') and new is distinct from old then
    raise exception 'Finalized learning content is immutable';
  end if;

  if old.status in ('approved', 'scheduled') then
    if (to_jsonb(new) - array['status', 'effective_at', 'expires_at', 'published_at'])
       is distinct from
       (to_jsonb(old) - array['status', 'effective_at', 'expires_at', 'published_at']) then
      raise exception 'Approved learning content is immutable';
    end if;
  elsif old.status = 'published' then
    if (to_jsonb(new) - 'status') is distinct from (to_jsonb(old) - 'status') then
      raise exception 'Published learning content is immutable; create a new version';
    end if;
  end if;
  return new;
end;
$$;

create or replace function learning.guard_curriculum_composition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_parent_status text;
  new_parent_status text;
begin
  perform private.assert_learning_read_committed();

  perform private.lock_learning_curriculum_graph(
    array_remove(
      array[
        case when tg_op in ('UPDATE', 'DELETE') then old.curriculum_version_id end,
        case when tg_op in ('INSERT', 'UPDATE') then new.curriculum_version_id end
      ],
      null::uuid
    )
  );

  if tg_op in ('UPDATE', 'DELETE') then
    select version.status into old_parent_status
    from learning.curriculum_versions version
    where version.id = old.curriculum_version_id
      and version.audience = old.audience;
    if not found then
      raise exception 'Curriculum composition parent is missing';
    end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select version.status into new_parent_status
    from learning.curriculum_versions version
    where version.id = new.curriculum_version_id
      and version.audience = new.audience;
    if not found then
      raise exception 'Curriculum composition parent is missing';
    end if;
  end if;

  if old_parent_status in ('approved', 'scheduled', 'published', 'superseded', 'retired')
     or new_parent_status in ('approved', 'scheduled', 'published', 'superseded', 'retired') then
    raise exception 'Approved or published curriculum composition is immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.validate_assignment_requirement_waiver()
  from public, anon, authenticated, service_role;
revoke all on function private.validate_certification_issuance()
  from public, anon, authenticated, service_role;
revoke all on function private.revoke_certifications_for_role_assignment()
  from public, anon, authenticated, service_role;
revoke all on function private.validate_emergency_exception_issuance()
  from public, anon, authenticated, service_role;
revoke all on function learning.guard_authoritative_write_isolation()
  from public, anon, authenticated, service_role;
revoke all on function learning.reject_evidence_mutation()
  from public, anon, authenticated, service_role;
revoke all on function learning.guard_attempt_lifecycle()
  from public, anon, authenticated, service_role;
revoke all on function learning.guard_assignment_lifecycle()
  from public, anon, authenticated, service_role;
revoke all on function learning.guard_assignment_requirement_lifecycle()
  from public, anon, authenticated, service_role;
revoke all on function learning.guard_certification_lifecycle()
  from public, anon, authenticated, service_role;
revoke all on function learning.guard_emergency_exception_lifecycle()
  from public, anon, authenticated, service_role;
revoke all on function learning.guard_content_lifecycle()
  from public, anon, authenticated, service_role;
revoke all on function learning.guard_curriculum_composition()
  from public, anon, authenticated, service_role;

create trigger learning_curricula_read_committed_guard
before insert or update or delete on learning.curricula
for each row execute function learning.guard_authoritative_write_isolation();

create trigger learning_curriculum_versions_read_committed_guard
before insert or update or delete on learning.curriculum_versions
for each row execute function learning.guard_authoritative_write_isolation();

create trigger learning_requirements_read_committed_guard
before insert or update or delete on learning.requirements
for each row execute function learning.guard_authoritative_write_isolation();

create trigger learning_requirement_versions_read_committed_guard
before insert or update or delete on learning.requirement_versions
for each row execute function learning.guard_authoritative_write_isolation();

create trigger learning_curriculum_requirements_read_committed_guard
before insert or update or delete on learning.curriculum_requirements
for each row execute function learning.guard_authoritative_write_isolation();

create trigger learning_curr_req_prereq_read_committed_guard
before insert or update or delete on learning.curriculum_requirement_prerequisites
for each row execute function learning.guard_authoritative_write_isolation();

create trigger learning_curriculum_capability_outcomes_read_committed_guard
before insert or update or delete on learning.curriculum_capability_outcomes
for each row execute function learning.guard_authoritative_write_isolation();

create trigger learning_role_curricula_read_committed_guard
before insert or update or delete on learning.role_curricula
for each row execute function learning.guard_authoritative_write_isolation();

create trigger learning_assignments_read_committed_guard
before insert or update or delete on learning.assignments
for each row execute function learning.guard_authoritative_write_isolation();

create trigger learning_assignment_requirements_read_committed_guard
before insert or update or delete on learning.assignment_requirements
for each row execute function learning.guard_authoritative_write_isolation();

create trigger learning_attempts_read_committed_guard
before insert or update or delete on learning.attempts
for each row execute function learning.guard_authoritative_write_isolation();

create trigger learning_attempt_events_read_committed_guard
before insert or update or delete on learning.attempt_events
for each row execute function learning.guard_authoritative_write_isolation();

create trigger learning_policy_acknowledgments_read_committed_guard
before insert or update or delete on learning.policy_acknowledgments
for each row execute function learning.guard_authoritative_write_isolation();

create trigger learning_certifications_read_committed_guard
before insert or update or delete on learning.certifications
for each row execute function learning.guard_authoritative_write_isolation();

create trigger learning_emergency_exceptions_read_committed_guard
before insert or update or delete on learning.emergency_exceptions
for each row execute function learning.guard_authoritative_write_isolation();

create trigger learning_attempts_lifecycle_guard
before insert or update or delete on learning.attempts
for each row execute function learning.guard_attempt_lifecycle();

create trigger learning_assignments_lifecycle_guard
before insert or update or delete on learning.assignments
for each row execute function learning.guard_assignment_lifecycle();

create trigger learning_assignment_requirements_lifecycle_guard
before insert or update or delete on learning.assignment_requirements
for each row execute function learning.guard_assignment_requirement_lifecycle();

create trigger learning_attempt_events_append_only
before update or delete on learning.attempt_events
for each row execute function learning.reject_evidence_mutation();

create trigger learning_policy_acknowledgments_append_only
before update or delete on learning.policy_acknowledgments
for each row execute function learning.reject_evidence_mutation();

create trigger learning_assignment_requirements_validate_waiver
before insert or update on learning.assignment_requirements
for each row execute function private.validate_assignment_requirement_waiver();

create trigger learning_certifications_validate_issuance
before insert on learning.certifications
for each row execute function private.validate_certification_issuance();

create trigger learning_certifications_lifecycle_guard
before update or delete on learning.certifications
for each row execute function learning.guard_certification_lifecycle();

create trigger learning_emergency_exceptions_lifecycle_guard
before update or delete on learning.emergency_exceptions
for each row execute function learning.guard_emergency_exception_lifecycle();

create trigger learning_emergency_exceptions_validate_issuance
before insert on learning.emergency_exceptions
for each row execute function private.validate_emergency_exception_issuance();

create trigger learning_curriculum_versions_lifecycle_guard
before insert or update or delete on learning.curriculum_versions
for each row execute function learning.guard_content_lifecycle();

create trigger learning_requirement_versions_lifecycle_guard
before insert or update or delete on learning.requirement_versions
for each row execute function learning.guard_content_lifecycle();

create trigger learning_curriculum_requirements_composition_guard
before insert or update or delete on learning.curriculum_requirements
for each row execute function learning.guard_curriculum_composition();

create trigger learning_curriculum_requirement_prerequisites_composition_guard
before insert or update or delete on learning.curriculum_requirement_prerequisites
for each row execute function learning.guard_curriculum_composition();

create trigger learning_curriculum_capability_outcomes_composition_guard
before insert or update or delete on learning.curriculum_capability_outcomes
for each row execute function learning.guard_curriculum_composition();

create trigger learning_revoke_certifications_on_role_delete
before delete on core.user_roles
for each row execute function private.revoke_certifications_for_role_assignment();

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
alter table learning.curriculum_requirement_prerequisites enable row level security;
alter table learning.curriculum_requirement_prerequisites force row level security;
alter table learning.curriculum_capability_outcomes enable row level security;
alter table learning.curriculum_capability_outcomes force row level security;
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
  and private.learning_has_active_profile(audience)
);

create policy learning_curricula_platform_manage on learning.curricula
for all to authenticated
using (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
)
with check (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
);

create policy learning_curricula_department_manage on learning.curricula
for all to authenticated
using (
  private.learning_has_active_profile('internal')
  and audience = 'internal'
  and governance_owner = 'department'
  and private.learning_owns_department(owner_department_id)
)
with check (
  private.learning_has_active_profile('internal')
  and audience = 'internal'
  and governance_owner = 'department'
  and private.learning_owns_department(owner_department_id)
);

create policy learning_curricula_legal_manage on learning.curricula
for all to authenticated
using (
  private.learning_has_active_profile('internal')
  and governance_owner = 'legal'
  and core.has_cap('legal', 'review_accreditation')
  and not core.is_vendor()
)
with check (
  private.learning_has_active_profile('internal')
  and governance_owner = 'legal'
  and core.has_cap('legal', 'review_accreditation')
  and not core.is_vendor()
);

create policy learning_curriculum_versions_published_read on learning.curriculum_versions
for select to authenticated
using (
  status = 'published'
  and effective_at <= now()
  and (expires_at is null or expires_at > now())
  and private.learning_has_active_profile(audience)
);

create policy learning_curriculum_versions_platform_manage on learning.curriculum_versions
for all to authenticated
using (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
)
with check (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
);

create policy learning_curriculum_versions_owner_manage on learning.curriculum_versions
for all to authenticated
using (
  private.learning_has_active_profile('internal')
  and exists (
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
  private.learning_has_active_profile('internal')
  and exists (
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
  and private.learning_has_active_profile(audience)
);

create policy learning_requirements_platform_manage on learning.requirements
for all to authenticated
using (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
)
with check (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
);

create policy learning_requirements_owner_manage on learning.requirements
for all to authenticated
using (
  private.learning_has_active_profile('internal')
  and (
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
)
with check (
  private.learning_has_active_profile('internal')
  and (
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
);

create policy learning_requirement_versions_published_read on learning.requirement_versions
for select to authenticated
using (
  status = 'published'
  and effective_at <= now()
  and (expires_at is null or expires_at > now())
  and private.learning_has_active_profile(audience)
);

create policy learning_requirement_versions_platform_manage on learning.requirement_versions
for all to authenticated
using (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
)
with check (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
);

create policy learning_requirement_versions_owner_manage on learning.requirement_versions
for all to authenticated
using (
  private.learning_has_active_profile('internal')
  and exists (
    select 1
    from learning.requirements parent_requirement
    where parent_requirement.id = learning.requirement_versions.requirement_id
      and parent_requirement.audience = learning.requirement_versions.audience
      and parent_requirement.requirement_kind = learning.requirement_versions.requirement_kind
      and parent_requirement.governance_owner = learning.requirement_versions.governance_owner
      and parent_requirement.owner_department_id is not distinct from learning.requirement_versions.owner_department_id
      and (
        (
          parent_requirement.audience = 'internal'
          and parent_requirement.governance_owner = 'department'
          and private.learning_owns_department(parent_requirement.owner_department_id)
        )
        or (
          parent_requirement.governance_owner = 'legal'
          and core.has_cap('legal', 'review_accreditation')
          and not core.is_vendor()
        )
      )
  )
)
with check (
  private.learning_has_active_profile('internal')
  and exists (
    select 1
    from learning.requirements parent_requirement
    where parent_requirement.id = learning.requirement_versions.requirement_id
      and parent_requirement.audience = learning.requirement_versions.audience
      and parent_requirement.requirement_kind = learning.requirement_versions.requirement_kind
      and parent_requirement.governance_owner = learning.requirement_versions.governance_owner
      and parent_requirement.owner_department_id is not distinct from learning.requirement_versions.owner_department_id
      and (
        (
          parent_requirement.audience = 'internal'
          and parent_requirement.governance_owner = 'department'
          and private.learning_owns_department(parent_requirement.owner_department_id)
        )
        or (
          parent_requirement.governance_owner = 'legal'
          and core.has_cap('legal', 'review_accreditation')
          and not core.is_vendor()
        )
      )
  )
);

create policy learning_curriculum_requirements_published_read on learning.curriculum_requirements
for select to authenticated
using (
  private.learning_has_active_profile(audience)
  and exists (
    select 1 from learning.curriculum_versions version
    where version.id = learning.curriculum_requirements.curriculum_version_id
      and version.audience = learning.curriculum_requirements.audience
      and version.status = 'published'
      and version.effective_at <= now()
      and (version.expires_at is null or version.expires_at > now())
  )
);

create policy learning_curriculum_requirements_platform_manage on learning.curriculum_requirements
for all to authenticated
using (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
)
with check (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
);

create policy learning_curriculum_requirement_prerequisites_published_read
on learning.curriculum_requirement_prerequisites
for select to authenticated
using (
  private.learning_has_active_profile(audience)
  and exists (
    select 1 from learning.curriculum_versions version
    where version.id = learning.curriculum_requirement_prerequisites.curriculum_version_id
      and version.audience = learning.curriculum_requirement_prerequisites.audience
      and version.status = 'published'
      and version.effective_at <= now()
      and (version.expires_at is null or version.expires_at > now())
  )
);

create policy learning_curriculum_requirement_prerequisites_platform_manage
on learning.curriculum_requirement_prerequisites
for all to authenticated
using (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
)
with check (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
);

create policy learning_curriculum_capability_outcomes_published_read
on learning.curriculum_capability_outcomes
for select to authenticated
using (
  private.learning_has_active_profile(audience)
  and exists (
    select 1 from learning.curriculum_versions version
    where version.id = learning.curriculum_capability_outcomes.curriculum_version_id
      and version.audience = learning.curriculum_capability_outcomes.audience
      and version.status = 'published'
      and version.effective_at <= now()
      and (version.expires_at is null or version.expires_at > now())
  )
);

create policy learning_curriculum_capability_outcomes_platform_manage
on learning.curriculum_capability_outcomes
for all to authenticated
using (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
)
with check (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
);

create policy learning_role_curricula_published_read on learning.role_curricula
for select to authenticated
using (
  effective_at <= now()
  and (expires_at is null or expires_at > now())
  and private.learning_has_active_profile(audience)
);

create policy learning_role_curricula_platform_manage on learning.role_curricula
for all to authenticated
using (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
)
with check (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
);

create policy learning_assignments_learner_read on learning.assignments
for select to authenticated
using (
  not core.is_vendor()
  and user_id = (select auth.uid())
  and private.learning_has_active_profile(audience)
);

create policy learning_assignments_vendor_read on learning.assignments
for select to authenticated
using (
  private.learning_has_active_profile('vendor')
  and core.is_vendor()
  and user_id = (select auth.uid())
  and audience = 'vendor'
);

create policy learning_assignments_department_owner_read on learning.assignments
for select to authenticated
using (
  private.learning_has_active_profile('internal')
  and private.learning_owns_department(department_id)
  and audience = 'internal'
);

create policy learning_assignments_platform_read on learning.assignments
for select to authenticated
using (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
  and audience = 'internal'
);

create policy learning_assignment_requirements_learner_read on learning.assignment_requirements
for select to authenticated
using (
  user_id = (select auth.uid())
  and private.learning_has_active_profile(audience)
);

create policy learning_assignment_requirements_department_owner_read on learning.assignment_requirements
for select to authenticated
using (
  private.learning_has_active_profile('internal')
  and private.learning_owns_department(department_id)
  and audience = 'internal'
);

create policy learning_assignment_requirements_platform_read on learning.assignment_requirements
for select to authenticated
using (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
  and audience = 'internal'
);

create policy learning_attempts_learner_read on learning.attempts
for select to authenticated
using (
  user_id = (select auth.uid())
  and private.learning_has_active_profile(audience)
);

create policy learning_attempts_department_owner_read on learning.attempts
for select to authenticated
using (
  private.learning_has_active_profile('internal')
  and private.learning_owns_department(department_id)
  and audience = 'internal'
);

create policy learning_attempts_platform_read on learning.attempts
for select to authenticated
using (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
  and audience = 'internal'
);

create policy learning_attempt_events_learner_read on learning.attempt_events
for select to authenticated
using (
  user_id = (select auth.uid())
  and private.learning_has_active_profile(audience)
);

create policy learning_attempt_events_department_owner_read on learning.attempt_events
for select to authenticated
using (
  private.learning_has_active_profile('internal')
  and private.learning_owns_department(department_id)
  and audience = 'internal'
);

create policy learning_attempt_events_platform_read on learning.attempt_events
for select to authenticated
using (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
  and audience = 'internal'
);

create policy learning_policy_acknowledgments_learner_read on learning.policy_acknowledgments
for select to authenticated
using (
  user_id = (select auth.uid())
  and private.learning_has_active_profile(audience)
);

create policy learning_policy_acknowledgments_department_owner_read on learning.policy_acknowledgments
for select to authenticated
using (
  private.learning_has_active_profile('internal')
  and private.learning_owns_department(department_id)
  and audience = 'internal'
);

create policy learning_policy_acknowledgments_legal_read on learning.policy_acknowledgments
for select to authenticated
using (
  private.learning_has_active_profile('internal')
  and core.has_cap('legal', 'review_accreditation')
  and not core.is_vendor()
  and audience = 'internal'
  and exists (
    select 1 from learning.requirement_versions requirement_version
    where requirement_version.id = learning.policy_acknowledgments.requirement_version_id
      and requirement_version.audience = learning.policy_acknowledgments.audience
      and requirement_version.requirement_kind = 'policy'
      and requirement_version.governance_owner = 'legal'
  )
);

create policy learning_policy_acknowledgments_legal_vendor_read on learning.policy_acknowledgments
for select to authenticated
using (
  private.learning_has_active_profile('internal')
  and core.has_cap('legal', 'review_accreditation')
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
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
  and audience = 'internal'
);

create policy learning_certifications_learner_read on learning.certifications
for select to authenticated
using (
  user_id = (select auth.uid())
  and private.learning_has_active_profile(audience)
);

create policy learning_certifications_department_owner_read on learning.certifications
for select to authenticated
using (
  private.learning_has_active_profile('internal')
  and private.learning_owns_department(department_id)
  and audience = 'internal'
);

create policy learning_certifications_platform_read on learning.certifications
for select to authenticated
using (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
  and audience = 'internal'
);

create policy learning_emergency_exceptions_learner_read on learning.emergency_exceptions
for select to authenticated
using (
  private.learning_has_active_profile('internal')
  and user_id = (select auth.uid())
  and not core.is_vendor()
  and audience = 'internal'
);

create policy learning_emergency_exceptions_department_owner_read on learning.emergency_exceptions
for select to authenticated
using (
  private.learning_has_active_profile('internal')
  and private.learning_owns_department(department_id)
  and audience = 'internal'
);

create policy learning_emergency_exceptions_platform_read on learning.emergency_exceptions
for select to authenticated
using (
  private.learning_has_active_profile('internal')
  and private.learning_is_active_employee_platform_admin()
  and audience = 'internal'
);

revoke all on learning.curricula from public, anon, authenticated, service_role;
revoke all on learning.curriculum_versions from public, anon, authenticated, service_role;
revoke all on learning.requirements from public, anon, authenticated, service_role;
revoke all on learning.requirement_versions from public, anon, authenticated, service_role;
revoke all on learning.curriculum_requirements from public, anon, authenticated, service_role;
revoke all on learning.curriculum_requirement_prerequisites from public, anon, authenticated, service_role;
revoke all on learning.curriculum_capability_outcomes from public, anon, authenticated, service_role;
revoke all on learning.role_curricula from public, anon, authenticated, service_role;
revoke all on learning.assignments from public, anon, authenticated, service_role;
revoke all on learning.assignment_requirements from public, anon, authenticated, service_role;
revoke all on learning.attempts from public, anon, authenticated, service_role;
revoke all on learning.attempt_events from public, anon, authenticated, service_role;
revoke all on learning.policy_acknowledgments from public, anon, authenticated, service_role;
revoke all on learning.certifications from public, anon, authenticated, service_role;
revoke all on learning.emergency_exceptions from public, anon, authenticated, service_role;

grant select on learning.curricula to authenticated;
grant select on learning.curriculum_versions to authenticated;
grant select on learning.requirements to authenticated;
grant select on learning.requirement_versions to authenticated;
grant select on learning.curriculum_requirements to authenticated;
grant select on learning.curriculum_requirement_prerequisites to authenticated;
grant select on learning.curriculum_capability_outcomes to authenticated;
grant select on learning.role_curricula to authenticated;
grant select on learning.assignments to authenticated;
grant select on learning.assignment_requirements to authenticated;
grant select on learning.attempts to authenticated;
grant select on learning.attempt_events to authenticated;
grant select on learning.policy_acknowledgments to authenticated;
grant select on learning.certifications to authenticated;
grant select on learning.emergency_exceptions to authenticated;

grant select, insert, update, delete on learning.curricula to service_role;
grant select, insert, update, delete on learning.curriculum_versions to service_role;
grant select, insert, update, delete on learning.requirements to service_role;
grant select, insert, update, delete on learning.requirement_versions to service_role;
grant select, insert, update, delete on learning.curriculum_requirements to service_role;
grant select, insert, update, delete on learning.curriculum_requirement_prerequisites to service_role;
grant select, insert, update, delete on learning.curriculum_capability_outcomes to service_role;
grant select, insert, update, delete on learning.role_curricula to service_role;
grant select, insert, update on learning.assignments to service_role;
grant select, insert, update on learning.assignment_requirements to service_role;
grant select, insert, update on learning.attempts to service_role;
grant select, insert on learning.attempt_events to service_role;
grant select, insert on learning.policy_acknowledgments to service_role;
grant select, insert, update on learning.certifications to service_role;
grant select, insert, update on learning.emergency_exceptions to service_role;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
