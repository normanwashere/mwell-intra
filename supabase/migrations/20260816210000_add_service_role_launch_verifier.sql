create or replace function core.verify_security_database_launch_blockers()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with raw_boundaries as (
    select distinct
      procedure.oid,
      namespace.nspname || '.' || procedure.proname || '('
        || pg_catalog.pg_get_function_identity_arguments(procedure.oid) || ')' as signature
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    cross join lateral pg_catalog.regexp_matches(
      pg_catalog.pg_get_functiondef(procedure.oid),
      'core[.]has_cap[[:space:]]*[(][[:space:]]*''([^'']+)''[[:space:]]*,[[:space:]]*''([^'']+)''[[:space:]]*[)]',
      'gi'
    ) as raw_pair
    join learning.mutation_capability_rules rule
      on rule.module = raw_pair[1]
     and rule.capability = raw_pair[2]
    where procedure.prokind = 'f'
      and procedure.prosecdef
      and namespace.nspname not in ('pg_catalog', 'information_schema')
      and pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
  ),
  boundary_summary as (
    select
      count(*)::integer as raw_boundaries,
      coalesce(
        pg_catalog.jsonb_agg(signature order by signature),
        '[]'::jsonb
      ) as examples
    from raw_boundaries
  ),
  checks(label, present) as (
    values
      (
        'core.v_my_work exact 12-column contract',
        (
          select pg_catalog.array_agg(column_name::text order by ordinal_position)
          from information_schema.columns
          where table_schema = 'core' and table_name = 'v_my_work'
        ) = array[
          'id', 'principal_id', 'source', 'title', 'description', 'status',
          'priority', 'due_at', 'href', 'required_module',
          'required_capability', 'source_record_exists'
        ]::text[]
      ),
      (
        'core.has_live_cap(text,text)',
        pg_catalog.to_regprocedure('core.has_live_cap(text,text)') is not null
      ),
      (
        'core.user_roles.effective_at',
        exists (
          select 1 from information_schema.columns
          where table_schema = 'core'
            and table_name = 'user_roles'
            and column_name = 'effective_at'
            and is_nullable = 'NO'
        )
      ),
      (
        'core.user_roles.expires_at',
        exists (
          select 1 from information_schema.columns
          where table_schema = 'core'
            and table_name = 'user_roles'
            and column_name = 'expires_at'
        )
      ),
      (
        'core.prevent_last_platform_admin_expiry()',
        pg_catalog.to_regprocedure('core.prevent_last_platform_admin_expiry()') is not null
      ),
      (
        'core_user_roles_last_admin_guard trigger',
        exists (
          select 1
          from pg_catalog.pg_trigger trigger_definition
          where trigger_definition.tgrelid = 'core.user_roles'::pg_catalog.regclass
            and trigger_definition.tgname = 'core_user_roles_last_admin_guard'
            and not trigger_definition.tgisinternal
        )
      ),
      (
        'core_profiles_last_admin_guard trigger',
        exists (
          select 1
          from pg_catalog.pg_trigger trigger_definition
          where trigger_definition.tgrelid = 'core.profiles'::pg_catalog.regclass
            and trigger_definition.tgname = 'core_profiles_last_admin_guard'
            and not trigger_definition.tgisinternal
        )
      ),
      (
        'learning_one_completed_assignment_idx',
        pg_catalog.to_regclass('learning.learning_one_completed_assignment_idx') is not null
      ),
      (
        'learning_assessment_answer_keys_created_by_fkey_idx',
        pg_catalog.to_regclass(
          'private.learning_assessment_answer_keys_created_by_fkey_idx'
        ) is not null
      ),
      (
        'learning_assessment_answer_keys_updated_by_fkey_idx',
        pg_catalog.to_regclass(
          'private.learning_assessment_answer_keys_updated_by_fkey_idx'
        ) is not null
      )
  ),
  object_summary as (
    select coalesce(
      pg_catalog.array_agg(label order by label) filter (where not present),
      array[]::text[]
    ) as missing_objects
    from checks
  )
  select pg_catalog.jsonb_build_object(
    'raw_boundaries', boundary_summary.raw_boundaries,
    'examples', boundary_summary.examples,
    'missing_objects', pg_catalog.to_jsonb(object_summary.missing_objects)
  )
  from boundary_summary
  cross join object_summary;
$$;

revoke all on function core.verify_security_database_launch_blockers() from public;
revoke all on function core.verify_security_database_launch_blockers() from anon;
revoke all on function core.verify_security_database_launch_blockers() from authenticated;
grant execute on function core.verify_security_database_launch_blockers() to service_role;

notify pgrst, 'reload schema';
