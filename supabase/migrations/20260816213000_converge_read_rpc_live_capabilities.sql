-- Forward-only convergence for read RPCs added or re-granted after the
-- certification-boundary hardening migration.
do $converge$
declare
  candidate record;
  revised_definition text;
  capability_pattern constant text :=
    'core[.]has_cap[[:space:]]*[(][[:space:]]*''([^'']+)''[[:space:]]*,[[:space:]]*''([^'']+)''[[:space:]]*[)]';
begin
  for candidate in
    select
      procedure.oid,
      pg_catalog.pg_get_functiondef(procedure.oid) as definition
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
    where procedure.prokind = 'f'
      and procedure.prosecdef
      and namespace.nspname not in ('pg_catalog', 'information_schema')
      and pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
      and exists (
        select 1
        from pg_catalog.regexp_matches(
          pg_catalog.pg_get_functiondef(procedure.oid),
          capability_pattern,
          'gi'
        ) as raw_pair
        join learning.mutation_capability_rules rule
          on rule.module = raw_pair[1]
         and rule.capability = raw_pair[2]
      )
  loop
    revised_definition := pg_catalog.regexp_replace(
      candidate.definition,
      'core[.]has_cap[[:space:]]*[(]',
      'core.has_live_cap(',
      'gi'
    );
    execute revised_definition;
  end loop;
end;
$converge$;

notify pgrst, 'reload schema';
