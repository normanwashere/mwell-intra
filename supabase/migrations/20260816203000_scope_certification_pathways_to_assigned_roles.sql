-- Scope certification gates to the signed-in user's current role pathways.
-- A pathway published for another role must not orphan an otherwise valid
-- capability grant. The matching RPC remains fail-closed when the user's role
-- does have a current published pathway.

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
    join core.user_roles role_assignment
      on role_assignment.user_id = auth.uid()
     and role_assignment.module = rule.module
     and role_assignment.effective_at <= pg_catalog.statement_timestamp()
     and (
       role_assignment.expires_at is null
       or role_assignment.expires_at > pg_catalog.statement_timestamp()
     )
    join core.roles role_definition
      on role_definition.module = role_assignment.module
     and role_definition.role = role_assignment.role
     and role_definition.is_active
    join learning.role_curricula role_curriculum
      on role_curriculum.module = role_assignment.module
     and role_curriculum.role = role_assignment.role
     and role_curriculum.effective_at <= pg_catalog.statement_timestamp()
     and (
       role_curriculum.expires_at is null
       or role_curriculum.expires_at > pg_catalog.statement_timestamp()
     )
     and (
       role_curriculum.department_id is null
       or exists (
         select 1
         from core.profile_department_scopes scope
         join core.departments department
           on department.id = scope.department_id
          and department.is_active
         where scope.profile_id = role_assignment.user_id
           and scope.department_id = role_curriculum.department_id
           and scope.effective_from <= current_date
           and (
             scope.effective_to is null
             or scope.effective_to >= current_date
           )
       )
     )
    join learning.curriculum_versions curriculum_version
      on curriculum_version.id = role_curriculum.curriculum_version_id
     and curriculum_version.audience = role_curriculum.audience
     and curriculum_version.status = 'published'
     and curriculum_version.effective_at <= pg_catalog.now()
     and (
       curriculum_version.expires_at is null
       or curriculum_version.expires_at > pg_catalog.now()
     )
    join learning.curriculum_capability_outcomes outcome
      on outcome.curriculum_version_id = curriculum_version.id
     and outcome.audience = curriculum_version.audience
     and outcome.module = rule.module
     and outcome.capability = rule.capability
    join learning.requirement_versions requirement_version
      on requirement_version.id = outcome.requirement_version_id
     and requirement_version.audience = outcome.audience
     and requirement_version.status = 'published'
     and requirement_version.effective_at <= pg_catalog.now()
     and (
       requirement_version.expires_at is null
       or requirement_version.expires_at > pg_catalog.now()
     )
    where rule.module = p_module
      and rule.capability = p_cap
  );
$$;

alter function learning.is_certification_required(text, text) owner to postgres;
revoke all on function learning.is_certification_required(text, text)
  from public, anon, authenticated;
grant execute on function learning.is_certification_required(text, text)
  to service_role;

-- The queue is a governed, capability-checked read RPC used by the Warehouse
-- Supervisor purchase-order workspace. A prior convergence migration left its
-- authenticated grant behind even though the function still enforces both
-- resolve_exceptions and release_quality_hold internally.
revoke all on function warehouse.procurement_receipt_excess_work_items(jsonb)
  from public, anon;
grant execute on function warehouse.procurement_receipt_excess_work_items(jsonb)
  to authenticated, service_role;
