-- Candidate publication check only. Does not assign training, grant roles, or certify users.
create or replace function private.event_seller_learning_ready()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  with published_requirements as (
    select rv.*, r.requirement_key
    from learning.requirement_versions rv
    join learning.requirements r on r.id = rv.requirement_id
      and r.audience = rv.audience and r.requirement_kind = rv.requirement_kind
    where r.status = 'active' and rv.audience = 'internal'
      and rv.version = 1 and rv.status = 'published'
      and rv.owner_id is not null and rv.reviewer_id is not null
      and rv.owner_id <> rv.reviewer_id
      and rv.approved_at is not null and rv.published_at is not null
      and rv.approved_at <= rv.published_at
      and rv.published_at <= rv.effective_at and rv.effective_at <= now()
      and (rv.expires_at is null or rv.expires_at > now())
  )
  select exists (
    select 1
    from learning.curricula c
    join learning.curriculum_versions cv on cv.curriculum_id = c.id
    join learning.curriculum_requirements seller_member
      on seller_member.curriculum_version_id = cv.id
      and seller_member.audience = 'internal'
      and seller_member.mandatory and seller_member.sort_order = 2
    join published_requirements seller
      on seller.id = seller_member.requirement_version_id
      and seller.requirement_key = 'internal.role.events.seller.custody-practice.v1'
      and seller.requirement_kind = 'scenario'
      and seller.simulation_id = 'event-seller-custody-v1'
      and seller.max_attempts = 3 and not seller.waivable
      and seller.assessment_settings = '{}'::jsonb
      and seller.passing_score is null
      and seller.pass_rules = '{"required_checkpoints":["verify-assignment","verify-custody","record-outcome","retry-intent","reverse-correction","handoff-finance"]}'::jsonb
    join learning.curriculum_requirements orientation_member
      on orientation_member.curriculum_version_id = cv.id
      and orientation_member.audience = 'internal'
      and orientation_member.mandatory and orientation_member.sort_order = 1
    join published_requirements orientation
      on orientation.id = orientation_member.requirement_version_id
      and orientation.requirement_key = 'internal.general_employee.orientation.v1'
      and orientation.requirement_kind = 'orientation'
    where c.catalog_key = 'internal.role.events.seller.v1'
      and c.audience = 'internal' and c.status = 'active'
      and cv.audience = 'internal' and cv.version = 1 and cv.status = 'published'
      and cv.owner_id is not null and cv.reviewer_id is not null
      and cv.owner_id <> cv.reviewer_id
      and cv.approved_at is not null and cv.published_at is not null
      and cv.approved_at <= cv.published_at
      and cv.published_at <= cv.effective_at and cv.effective_at <= now()
      and (cv.expires_at is null or cv.expires_at > now())
      and (select count(*) from learning.curriculum_requirements member
        where member.curriculum_version_id = cv.id) = 2
      and (select count(*) from learning.curriculum_requirement_prerequisites prerequisite
        where prerequisite.curriculum_version_id = cv.id) = 1
      and exists (
        select 1 from learning.curriculum_requirement_prerequisites prerequisite
        where prerequisite.curriculum_version_id = cv.id
          and prerequisite.curriculum_requirement_id = seller_member.id
          and prerequisite.requirement_version_id = seller.id
          and prerequisite.prerequisite_requirement_version_id = orientation.id
          and prerequisite.audience = 'internal'
      )
      and (select count(*) from learning.curriculum_capability_outcomes outcome
        where outcome.curriculum_version_id = cv.id) = 1
      and exists (
        select 1 from learning.curriculum_capability_outcomes outcome
        where outcome.curriculum_version_id = cv.id
          and outcome.curriculum_requirement_id = seller_member.id
          and outcome.requirement_version_id = seller.id
          and outcome.audience = 'internal' and outcome.module = 'events'
          and outcome.capability = 'record_event_outcome'
      )
      and exists (
        select 1 from learning.role_curricula mapping
        where mapping.curriculum_version_id = cv.id
          and mapping.audience = 'internal'
          and mapping.module = 'events' and mapping.role = 'seller'
          -- Events have no department key; a different department's mapping is not proof.
          and mapping.department_id is null
          and mapping.effective_at <= now()
          and (mapping.expires_at is null or mapping.expires_at > now())
      )
  );
$function$;

revoke all on function private.event_seller_learning_ready() from public, anon, authenticated, service_role;
comment on function private.event_seller_learning_ready() is
  'Read-only exact seller learning publication check for the controlled Events enable gate; not individual certification.';
