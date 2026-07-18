-- The shared approval ledger stores entity identifiers as text. Converge the
-- already-versioned stock decision implementation before enforcing role policy.
do $$
declare
  target regprocedure := 'private.warehouse_decide_stock_change(jsonb)'::regprocedure;
  definition text;
  corrected_definition text;
begin
  definition := pg_get_functiondef(target);
  corrected_definition := pg_catalog.replace(
    definition,
    'entity_id=v_request.id',
    'entity_id=v_request.id::text'
  );
  if corrected_definition=definition then
    raise exception 'Unable to align Warehouse stock approval entity identity';
  end if;
  execute corrected_definition;
end;
$$;

select pg_notify('pgrst', 'reload schema');
