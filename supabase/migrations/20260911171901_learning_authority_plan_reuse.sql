-- Reuse prepared query plans, never authorization results. Keep each existing
-- SELECT expression, STABLE semantics, grants, owner and empty search path.
do $plans$
declare
  v_signature text;
  v_definition text;
  v_source text;
  v_language text;
  v_expression text;
begin
  foreach v_signature in array array[
    'learning.is_certification_required(text,text)',
    'learning.has_active_certification(uuid,text,text)',
    'learning.has_active_emergency_exception(uuid,text,text)'
  ] loop
    select pg_catalog.pg_get_functiondef(p.oid), p.prosrc, l.lanname
      into strict v_definition, v_source, v_language
      from pg_catalog.pg_proc p join pg_catalog.pg_language l on l.oid=p.prolang
      where p.oid=v_signature::regprocedure;
    if v_language = 'plpgsql' and v_source like '%-- authority-plan-reuse%' then continue; end if;
    if v_language <> 'sql' or v_source !~* '^\s*select\s+exists\s*\(' then
      raise exception 'Unexpected authority query contract: %', v_signature;
    end if;
    v_expression := pg_catalog.regexp_replace(v_source, ';\s*$', '');
    v_definition := pg_catalog.replace(v_definition, 'LANGUAGE sql', 'LANGUAGE plpgsql');
    v_definition := pg_catalog.replace(v_definition, v_source,
      E'\nbegin\n  -- authority-plan-reuse\n  return (' || v_expression || E');\nend;\n');
    execute v_definition;
  end loop;
end;
$plans$;
notify pgrst, 'reload schema';
