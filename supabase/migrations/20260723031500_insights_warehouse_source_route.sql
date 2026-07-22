-- Keep governed Insights drilldowns on the canonical Warehouse data route.
do $$
declare
  v_function regprocedure := to_regprocedure('core.insights_snapshot()');
  v_definition text;
begin
  if v_function is null then
    raise exception 'core.insights_snapshot() is required before correcting its Warehouse source route';
  end if;

  select pg_get_functiondef(v_function) into v_definition;
  if position('/warehouse/analytics' in v_definition) > 0 then
    execute replace(v_definition, '/warehouse/analytics', '/warehouse/data');
  end if;
end;
$$;

notify pgrst, 'reload schema';
