-- Catalog-only regression: no custody rows are read or changed.
do $$
declare
  relation_name text;
  role_name text;
begin
  foreach relation_name in array array[
    'warehouse.returns', 'warehouse.movements',
    'warehouse.allocations', 'warehouse.event_reconciliations'
  ] loop
    foreach role_name in array array['anon', 'authenticated'] loop
      if has_table_privilege(role_name, relation_name, 'TRUNCATE') then
        raise exception '% retains TRUNCATE on %', role_name, relation_name;
      end if;
    end loop;
  end loop;
end $$;
