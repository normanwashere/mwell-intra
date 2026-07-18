-- Patch already-versioned environments after the governed receive_stock body
-- has been restored. Receipt time and initial QC state are server authority.
do $$
declare
  target constant regprocedure := 'warehouse.receive_stock(jsonb)'::regprocedure;
  definition text := pg_get_functiondef(target);
  corrected_definition text;
  anchor constant text := 'v_actor := warehouse.authoritative_actor();';
begin
  if position('''{receipt,quality_status}''' in definition)>0 then return; end if;
  corrected_definition := replace(
    definition,
    anchor,
    anchor || E'\n  if payload ? ''receipt'' then\n'
      || E'    payload := jsonb_set(payload,''{receipt,created_at}'',to_jsonb(now()),true);\n'
      || E'    payload := jsonb_set(payload,''{receipt,quality_status}'',to_jsonb(''pending''::text),true);\n'
      || E'  end if;'
  );
  if corrected_definition=definition then
    raise exception 'Unable to install authoritative receipt defaults';
  end if;
  execute corrected_definition;
end;
$$;
