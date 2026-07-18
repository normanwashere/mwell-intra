-- Replace Warehouse-local RBAC gates retained by already-versioned databases
-- with the shared active-role capability catalogue.
do $$
declare
  target regprocedure;
  definition text;
  corrected_definition text;
begin
  for target in
    select function.oid::regprocedure
    from pg_proc function
    join pg_namespace namespace on namespace.oid=function.pronamespace
    where namespace.nspname='warehouse'
      and function.prokind='f'
      and function.proname<>'has_cap'
      and pg_get_functiondef(function.oid) like '%warehouse.has_cap(%'
  loop
    definition := pg_get_functiondef(target);
    corrected_definition := regexp_replace(
      definition,
      'warehouse\.has_cap\(''([^'']+)''\)',
      'core.has_cap(''warehouse'',''\1'')',
      'g'
    );
    if corrected_definition=definition then
      raise exception 'Unable to converge Warehouse RBAC gate in %',target;
    end if;
    execute corrected_definition;
  end loop;
end;
$$;
