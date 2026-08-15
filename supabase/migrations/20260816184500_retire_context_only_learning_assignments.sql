-- Completed context-only assignments remain immutable and auditable, but must
-- not continue to appear as active onboarding after their role-curriculum
-- mapping expires.

alter function learning.my_learning_snapshot()
  rename to my_learning_snapshot_base;
alter function learning.my_learning_snapshot_base() owner to postgres;
revoke all on function learning.my_learning_snapshot_base()
  from public, anon, authenticated, service_role;

create or replace function learning.my_learning_snapshot()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_snapshot jsonb;
  v_curricula jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication is required for learning services'
      using errcode = '28000';
  end if;

  v_snapshot := learning.my_learning_snapshot_base();

  select coalesce(pg_catalog.jsonb_agg(item.value), '[]'::jsonb)
  into v_curricula
  from pg_catalog.jsonb_array_elements(v_snapshot->'curricula') item(value)
  where item.value->>'source' <> 'role'
     or exists (
       select 1
       from core.user_roles role_assignment
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
       join learning.curriculum_versions curriculum_version
         on curriculum_version.id = role_curriculum.curriculum_version_id
        and curriculum_version.audience = role_curriculum.audience
        and curriculum_version.status = 'published'
       join learning.curricula curriculum
         on curriculum.id = curriculum_version.curriculum_id
        and curriculum.audience = curriculum_version.audience
       where role_assignment.user_id = v_user_id
         and role_assignment.effective_at <= pg_catalog.statement_timestamp()
         and (
           role_assignment.expires_at is null
           or role_assignment.expires_at > pg_catalog.statement_timestamp()
         )
         and curriculum.catalog_key =
           item.value#>>'{curriculum,id}'
     );

  return pg_catalog.jsonb_set(
    v_snapshot,
    '{curricula}',
    v_curricula,
    false
  );
end;
$$;

alter function learning.my_learning_snapshot() owner to postgres;
revoke all on function learning.my_learning_snapshot()
  from public, anon, authenticated, service_role;
grant execute on function learning.my_learning_snapshot()
  to authenticated, service_role;
