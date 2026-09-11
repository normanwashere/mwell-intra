-- Repair only the two public execution boundaries. Keep the deployed bodies,
-- including request scope, delivery validation, idempotency and custody, intact.
do $requester_names$
declare
  v_definition text := pg_catalog.pg_get_functiondef('private.department_request_actor_names(uuid[])'::regprocedure);
  v_old text;
  v_new text;
begin
  foreach v_old in array array[
    'core.has_cap(''warehouse'', ''issue_items'')',
    'core.has_cap(''procurement'', ''approve_request'')'
  ] loop
    v_new := pg_catalog.replace(v_old, 'core.has_cap(', 'core.has_live_cap(');
    if pg_catalog.strpos(v_definition, v_old) = 0 and pg_catalog.strpos(v_definition, v_new) = 0 then
      raise exception 'Requester-name authority contract changed: %', v_old;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  end loop;
  execute v_definition;
end;
$requester_names$;

do $return_resolution$
declare
  v_definition text := pg_catalog.pg_get_functiondef('warehouse.resolve_customer_return_case(jsonb)'::regprocedure);
  v_old text;
  v_new text;
begin
  foreach v_old in array array[
    'core.has_cap(''warehouse'', ''approve_stock_adjustment_finance'')',
    'core.has_cap(''procurement'', ''view_finance'')',
    'core.has_cap(''warehouse'', ''manage_returns'')'
  ] loop
    v_new := pg_catalog.replace(v_old, 'core.has_cap(', 'core.has_live_cap(');
    if pg_catalog.strpos(v_definition, v_old) = 0 and pg_catalog.strpos(v_definition, v_new) = 0 then
      raise exception 'Return-resolution authority contract changed: %', v_old;
    end if;
    v_definition := pg_catalog.replace(v_definition, v_old, v_new);
  end loop;
  execute v_definition;
end;
$return_resolution$;

-- No new grants, role assignments, certification records, or business-data writes.
notify pgrst, 'reload schema';
