-- Availability counts physical in_stock units and subtracts active holds.
-- Using returned here both hides the incoming unit and subtracts its hold from
-- unrelated stock. Intake and its exact quarantine holds commit atomically.
do $$
declare
  v_definition text := pg_get_functiondef('warehouse.record_return_v2(jsonb)'::regprocedure);
  v_old text := 'update warehouse.inventory_units set status = ''returned'', assigned_to = null,';
  v_new text := 'update warehouse.inventory_units set status = ''in_stock'', assigned_to = null,';
begin
  if strpos(v_definition, v_new) > 0 then return; end if;
  if strpos(v_definition, v_old) = 0 then
    raise exception 'Unexpected return intake stock transition; review current function before migration';
  end if;
  execute replace(v_definition, v_old, v_new);
end;
$$;

notify pgrst, 'reload schema';
