-- A mutation capability becomes certification-gated only after users have a
-- current, published pathway capable of issuing that exact certification.
-- This prevents an orphaned mutation rule from making an operation impossible
-- while preserving fail-closed certification once its curriculum is live.
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
       and exists (
         select 1
           from learning.curriculum_capability_outcomes outcome
           join learning.curriculum_versions curriculum_version
             on curriculum_version.id = outcome.curriculum_version_id
            and curriculum_version.audience = outcome.audience
           join learning.requirement_versions requirement_version
             on requirement_version.id = outcome.requirement_version_id
            and requirement_version.audience = outcome.audience
          where outcome.module = rule.module
            and outcome.capability = rule.capability
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
       )
  );
$$;

alter function learning.is_certification_required(text, text) owner to postgres;
revoke all on function learning.is_certification_required(text, text)
  from public, anon, authenticated;
grant execute on function learning.is_certification_required(text, text)
  to service_role;
