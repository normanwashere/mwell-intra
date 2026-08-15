-- PL/pgSQL resolves this query when the function executes. Repair the launch
-- migration to use the effective requirement_versions.simulation_id column.

do $repair$
declare
  v_definition text;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid)
  into v_definition
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace
    on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'learning'
    and procedure.proname = 'sync_equivalent_role_practices'
    and pg_catalog.pg_get_function_identity_arguments(procedure.oid) = '';

  if v_definition is null then
    raise exception 'learning.sync_equivalent_role_practices() is missing';
  end if;

  execute pg_catalog.replace(
    v_definition,
    'simulation_version_id',
    'simulation_id'
  );
end;
$repair$;

alter function learning.sync_equivalent_role_practices() owner to postgres;
revoke all on function learning.sync_equivalent_role_practices()
  from public, anon, authenticated, service_role;
