-- jsonb_populate_record maps omitted keys to null instead of applying table
-- defaults. Cycle-count creation time is server authority.
do $$
declare
  target constant regprocedure := 'warehouse.record_cycle_count(jsonb)'::regprocedure;
  definition text := pg_get_functiondef(target);
  corrected_definition text;
  anchor constant text :=
    'v_cycle_count := jsonb_set(v_cycle_count, ''{requested_by}'', to_jsonb(auth.uid()), true);';
begin
  if position('''{created_at}''' in definition)>0 then return; end if;
  corrected_definition := replace(
    definition,
    anchor,
    anchor || E'\n  v_cycle_count := jsonb_set(v_cycle_count, ''{created_at}'', to_jsonb(now()), true);'
  );
  if corrected_definition=definition then
    raise exception 'Unable to install authoritative cycle-count timestamp';
  end if;
  execute corrected_definition;
end;
$$;
