-- Vendor training is governed by Legal, not an internal department membership.
-- Retain the existing employee predicate and the query-plan reuse boundary.
create or replace function learning.has_active_certification(
  p_user_id uuid, p_module text, p_cap text
)
returns boolean language plpgsql stable security definer set search_path = ''
as $$
begin
  return exists (
    select 1
    from learning.certifications certification
    join core.user_roles source_assignment
      on source_assignment.id = certification.source_role_assignment_id
     and source_assignment.user_id = certification.user_id
     and source_assignment.module = certification.module
     and source_assignment.role = certification.source_role
    join core.roles source_role
      on source_role.module = source_assignment.module
     and source_role.role = source_assignment.role and source_role.is_active
    join core.role_capabilities source_capability
      on source_capability.module = certification.module
     and source_capability.role = certification.source_role
     and source_capability.cap = certification.capability
    join core.departments certification_department
      on certification_department.id = certification.department_id
     and certification_department.is_active
    where certification.user_id = p_user_id
      and certification.module = p_module and certification.capability = p_cap
      and certification.status = 'active'
      and certification.effective_at <= pg_catalog.now()
      and (certification.expires_at is null or certification.expires_at > pg_catalog.now())
      and (
        exists (
          select 1 from core.profile_department_scopes certification_scope
          where certification_scope.profile_id = certification.user_id
            and certification_scope.department_id = certification.department_id
            and certification_scope.effective_from <= current_date
            and (certification_scope.effective_to is null or certification_scope.effective_to >= current_date)
        )
        or (
          certification.audience = 'vendor'
          and certification.module = 'core'
          and certification.source_role = 'vendor_portal'
          and certification.capability = 'submit_accreditation'
          and certification_department.code = 'legal_compliance'
          and source_assignment.effective_at <= pg_catalog.now()
          and (source_assignment.expires_at is null or source_assignment.expires_at > pg_catalog.now())
          and exists (
            select 1 from core.profiles profile
            join legal.vendor_invites invitation
              on invitation.auth_user_id = profile.id
             and invitation.vendor_id = profile.vendor_id
             and invitation.status = 'accepted'
             and invitation.accepted_generation = invitation.link_generation
            where profile.id = certification.user_id
              and profile.kind = 'vendor' and profile.status = 'active'
              and profile.vendor_id is not null
          )
          and exists (
            select 1 from learning.assignments assignment
            join learning.curriculum_versions curriculum
              on curriculum.id = assignment.curriculum_version_id
             and curriculum.audience = 'vendor' and curriculum.status = 'published'
             and curriculum.effective_at <= pg_catalog.now()
             and (curriculum.expires_at is null or curriculum.expires_at > pg_catalog.now())
            where assignment.id = certification.assignment_id
              and assignment.user_id = certification.user_id
              and assignment.department_id = certification.department_id
              and assignment.profile_kind = 'vendor' and assignment.audience = 'vendor'
              and assignment.source_type = 'role'
              and assignment.source_id = source_assignment.id
              and assignment.status = 'completed'
              and assignment.curriculum_version_id = certification.curriculum_version_id
              and cardinality(certification.requirement_version_ids) > 0
              and not exists (
                select 1 from unnest(certification.requirement_version_ids) required(id)
                where not exists (
                  select 1 from learning.assignment_requirements completed
                  join learning.requirement_versions requirement
                    on requirement.id = completed.requirement_version_id
                   and requirement.audience = 'vendor' and requirement.status = 'published'
                   and requirement.effective_at <= pg_catalog.now()
                   and (requirement.expires_at is null or requirement.expires_at > pg_catalog.now())
                  where completed.assignment_id = assignment.id
                    and completed.user_id = certification.user_id
                    and completed.department_id = certification.department_id
                    and completed.audience = 'vendor'
                    and completed.requirement_version_id = required.id
                    and completed.status in ('passed', 'waived')
                )
              )
          )
        )
      )
  );
end;
$$;

-- CREATE OR REPLACE preserves the existing owner and private-function ACL.
