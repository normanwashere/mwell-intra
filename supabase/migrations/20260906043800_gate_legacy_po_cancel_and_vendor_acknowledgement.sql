-- Preserve the installed business bodies and ACLs; fail on unexpected source drift.
-- Cancellation has no standalone learning pathway. Existing PO author authority
-- supplies its learning gate while the cancellation capability remains required.
do $migration$
declare definition text; anchor text; guard text;
begin
  definition := pg_get_functiondef('warehouse.cancel_purchase_order(jsonb)'::regprocedure);
  anchor := '  if not core.has_cap(''warehouse'',''view_procurement'') then';
  guard := E'  if auth.uid() is null or not core.has_live_cap(''procurement'',''cancel_purchase_order'')\n'
    || E'     or not core.has_live_cap(''procurement'',''author_po'') then\n'
    || E'    raise exception ''Not authorized: certified Procurement PO cancellation'';\n  end if;\n';
  if position(guard in definition) = 0 then
    if position(anchor in definition) = 0 then raise exception 'Legacy PO cancellation guard anchor changed'; end if;
    execute replace(definition, anchor, guard || anchor);
  end if;

  definition := pg_get_functiondef('procurement.acknowledge_purchase_order(jsonb)'::regprocedure);
  anchor := '  if auth.uid() is null or nullif(payload->>''expected_revision'','''') is null then';
  guard := E'  if auth.uid() is null or not core.has_live_cap(''core'',''submit_accreditation'') then\n'
    || E'    raise exception ''Not authorized: certified Vendor acknowledgement'';\n  end if;\n';
  if position(guard in definition) = 0 then
    if position(anchor in definition) = 0 then raise exception 'Vendor PO acknowledgement guard anchor changed'; end if;
    execute replace(definition, anchor, guard || anchor);
  end if;
end;
$migration$;
