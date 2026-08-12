-- Effective capability authority for mandatory role onboarding.
-- Raw role grants remain observable, while mutating capabilities become live
-- only after certification or a bounded emergency exception.

create table learning.mutation_capability_rules (
  module text not null,
  capability text not null,
  created_at timestamptz not null default now(),
  primary key (module, capability),
  constraint mutation_capability_rules_capability_fk
    foreign key (module, capability)
    references core.capabilities(module, cap) on delete restrict
);

insert into learning.mutation_capability_rules(module, capability)
values
  ('core', 'manage_rbac'),
  ('core', 'manage_vendors'),
  ('core', 'manage_accreditation'),
  ('core', 'manage_documents'),
  ('core', 'submit_accreditation'),
  ('core', 'manage_approvals'),
  ('core', 'record_approval'),
  ('core', 'manage_notifications'),
  ('warehouse', 'receive_stock'),
  ('warehouse', 'manage_inventory'),
  ('warehouse', 'manage_products'),
  ('warehouse', 'manage_locations'),
  ('warehouse', 'cycle_count'),
  ('warehouse', 'manage_returns'),
  ('warehouse', 'request_fulfillment'),
  ('warehouse', 'request_stock'),
  ('warehouse', 'submit_return_case'),
  ('warehouse', 'reserve_allocate'),
  ('warehouse', 'issue_items'),
  ('warehouse', 'transfer_stock'),
  ('warehouse', 'manage_finance_close'),
  ('warehouse', 'set_pricing'),
  ('warehouse', 'manage_operation_routes'),
  ('warehouse', 'inspect_quality'),
  ('warehouse', 'release_quality_hold'),
  ('warehouse', 'approve_stock_adjustment'),
  ('warehouse', 'approve_stock_adjustment_finance'),
  ('warehouse', 'resolve_exceptions'),
  ('warehouse', 'import_warehouse_data'),
  ('procurement', 'create_request'),
  ('procurement', 'manage_rfp'),
  ('procurement', 'author_po'),
  ('procurement', 'approve_request'),
  ('procurement', 'approve_award'),
  ('procurement', 'manage_vendors'),
  ('procurement', 'admin'),
  ('legal', 'review_accreditation'),
  ('legal', 'manage_checklist'),
  ('legal', 'approve_accreditation'),
  ('legal', 'manage_documents'),
  ('legal', 'manage_doa'),
  ('legal', 'admin'),
  ('events', 'create_event'),
  ('events', 'manage_events'),
  ('events', 'request_fulfillment'),
  ('events', 'close_event'),
  ('events', 'approve_settlement'),
  ('events', 'admin'),
  ('insights', 'admin'),
  ('product', 'prepare_readiness'),
  ('product', 'decide_go_live'),
  ('product', 'acknowledge_operations_handoff'),
  ('product', 'propose_pricing'),
  ('product', 'approve_pricing');

alter table learning.mutation_capability_rules enable row level security;
alter table learning.mutation_capability_rules force row level security;

create trigger learning_mutation_capability_rules_read_committed_guard
before insert or update or delete on learning.mutation_capability_rules
for each row execute function learning.guard_authoritative_write_isolation();

revoke all on table learning.mutation_capability_rules
  from public, anon, authenticated, service_role;
grant select on table learning.mutation_capability_rules to service_role;

create or replace function learning.is_certification_required(
  p_module text,
  p_cap text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from learning.mutation_capability_rules rule
    where rule.module = p_module
      and rule.capability = p_cap
  );
$$;

create or replace function learning.has_active_certification(
  p_user_id uuid,
  p_module text,
  p_cap text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from learning.certifications certification
    join core.user_roles source_assignment
      on source_assignment.id = certification.source_role_assignment_id
     and source_assignment.user_id = certification.user_id
     and source_assignment.module = certification.module
     and source_assignment.role = certification.source_role
    join core.roles source_role
      on source_role.module = source_assignment.module
     and source_role.role = source_assignment.role
     and source_role.is_active
    join core.role_capabilities source_capability
      on source_capability.module = certification.module
     and source_capability.role = certification.source_role
     and source_capability.cap = certification.capability
    join core.profile_department_scopes certification_scope
      on certification_scope.profile_id = certification.user_id
     and certification_scope.department_id = certification.department_id
     and certification_scope.effective_from <= current_date
     and (
       certification_scope.effective_to is null
       or certification_scope.effective_to >= current_date
     )
    join core.departments certification_department
      on certification_department.id = certification.department_id
     and certification_department.is_active
    where certification.user_id = p_user_id
      and certification.module = p_module
      and certification.capability = p_cap
      and certification.status = 'active'
      and certification.effective_at <= pg_catalog.now()
      and (
        certification.expires_at is null
        or certification.expires_at > pg_catalog.now()
      )
  );
$$;

create or replace function learning.has_active_emergency_exception(
  p_user_id uuid,
  p_module text,
  p_cap text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from learning.emergency_exceptions exception
    join core.profile_department_scopes beneficiary_scope
      on beneficiary_scope.profile_id = exception.user_id
     and beneficiary_scope.department_id = exception.department_id
     and beneficiary_scope.effective_from <= current_date
     and (
       beneficiary_scope.effective_to is null
       or beneficiary_scope.effective_to >= current_date
     )
    join core.departments beneficiary_department
      on beneficiary_department.id = exception.department_id
     and beneficiary_department.is_active
    where exception.user_id = p_user_id
      and exception.module = p_module
      and exception.capability = p_cap
      and exception.audience = 'internal'
      and exception.status = 'active'
      and exception.effective_at <= pg_catalog.now()
      and exception.expires_at > pg_catalog.now()
      and exception.grantor_id <> exception.user_id
      and exception.approver_id <> exception.user_id
      and exception.grantor_id <> exception.approver_id
      and exception.waives_legal_acknowledgment = false
      and not exists (
        select 1
        from learning.curriculum_capability_outcomes outcome
        join learning.curriculum_requirements curriculum_requirement
          on curriculum_requirement.id = outcome.curriculum_requirement_id
         and curriculum_requirement.curriculum_version_id = outcome.curriculum_version_id
         and curriculum_requirement.requirement_version_id = outcome.requirement_version_id
         and curriculum_requirement.audience = outcome.audience
        join learning.curriculum_versions curriculum_version
          on curriculum_version.id = curriculum_requirement.curriculum_version_id
         and curriculum_version.audience = curriculum_requirement.audience
        join learning.requirement_versions requirement_version
          on requirement_version.id = curriculum_requirement.requirement_version_id
         and requirement_version.audience = curriculum_requirement.audience
        where outcome.module = exception.module
          and outcome.capability = exception.capability
          and curriculum_requirement.mandatory
          and curriculum_version.status = 'published'
          and curriculum_version.effective_at <= pg_catalog.now()
          and (
            curriculum_version.expires_at is null
            or curriculum_version.expires_at > pg_catalog.now()
          )
          and requirement_version.status = 'published'
          and requirement_version.effective_at <= pg_catalog.now()
          and (
            requirement_version.expires_at is null
            or requirement_version.expires_at > pg_catalog.now()
          )
          and requirement_version.requirement_kind = 'policy'
          and not requirement_version.waivable
      )
  );
$$;

create or replace function core.has_live_cap(
  p_module text,
  p_cap text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(auth.role() = 'service_role', false)
    or (
      core.has_cap(p_module, p_cap)
      and (
        not learning.is_certification_required(p_module, p_cap)
        or learning.has_active_certification(auth.uid(), p_module, p_cap)
        or learning.has_active_emergency_exception(auth.uid(), p_module, p_cap)
      )
    );
$$;

create or replace function core.my_role_capabilities()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_object_agg(raw.module, raw.capabilities order by raw.module),
    '{}'::jsonb
  )
  from (
    select
      role_capability.module,
      pg_catalog.jsonb_agg(
        distinct role_capability.cap order by role_capability.cap
      ) as capabilities
    from core.user_roles user_role
    join core.roles role_definition
      on role_definition.module = user_role.module
     and role_definition.role = user_role.role
     and role_definition.is_active
    join core.role_capabilities role_capability
      on role_capability.module = user_role.module
     and role_capability.role = user_role.role
    where user_role.user_id = auth.uid()
    group by role_capability.module
  ) raw;
$$;

create or replace function core.my_capabilities()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with raw as (
    select core.my_role_capabilities() as capabilities
  ),
  effective as (
    select
      module_entry.key as module,
      pg_catalog.jsonb_agg(
        capability_entry.value order by capability_entry.value
      ) as capabilities
    from raw
    cross join lateral pg_catalog.jsonb_each(raw.capabilities) module_entry
    cross join lateral pg_catalog.jsonb_array_elements_text(module_entry.value)
      capability_entry(value)
    where core.has_live_cap(module_entry.key, capability_entry.value)
    group by module_entry.key
  )
  select coalesce(
    pg_catalog.jsonb_object_agg(
      effective.module,
      effective.capabilities order by effective.module
    ),
    '{}'::jsonb
  )
  from effective;
$$;

create or replace function core.my_capability_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'roleCapabilities', core.my_role_capabilities(),
    'userCapabilities', core.my_capabilities()
  );
$$;

alter function learning.is_certification_required(text, text) owner to postgres;
alter function learning.has_active_certification(uuid, text, text) owner to postgres;
alter function learning.has_active_emergency_exception(uuid, text, text) owner to postgres;
alter function core.has_live_cap(text, text) owner to postgres;
alter function core.my_role_capabilities() owner to postgres;
alter function core.my_capabilities() owner to postgres;
alter function core.my_capability_snapshot() owner to postgres;

revoke all on function learning.is_certification_required(text, text)
  from public, anon, authenticated;
revoke all on function learning.has_active_certification(uuid, text, text)
  from public, anon, authenticated;
revoke all on function learning.has_active_emergency_exception(uuid, text, text)
  from public, anon, authenticated;
revoke all on function core.has_live_cap(text, text)
  from public, anon;
revoke all on function core.my_role_capabilities() from public, anon;
revoke all on function core.my_capabilities() from public, anon;
revoke all on function core.my_capability_snapshot() from public, anon;

grant execute on function learning.is_certification_required(text, text)
  to service_role;
grant execute on function learning.has_active_certification(uuid, text, text)
  to service_role;
grant execute on function learning.has_active_emergency_exception(uuid, text, text)
  to service_role;
grant execute on function core.has_live_cap(text, text)
  to authenticated, service_role;
grant execute on function core.my_role_capabilities() to authenticated, service_role;
grant execute on function core.my_capabilities() to authenticated, service_role;
grant execute on function core.my_capability_snapshot() to authenticated, service_role;
