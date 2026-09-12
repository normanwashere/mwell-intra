-- Keep existing authorization, line reservations and exact idempotent replay.
-- Validate only when inserting a new exception receipt; never infer old dates.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef('private.warehouse_receive_procurement_po_exception(jsonb)'::regprocedure);
  old_text text;
  new_text text;
begin
  if strpos(definition, 'private.receipt_actual_delivery_date(payload)') > 0 then
    raise exception 'Exception receipt delivery date already installed';
  end if;
  for old_text, new_text in select * from (values
    ('insert into warehouse.receipts(', 'insert into warehouse.receipts(actual_delivery_date,'),
    ($old$v_receipt_id,'proc-'||v_po.core_vendor_id::text,payload->>'location_id',v_facts,$old$,
     $new$private.receipt_actual_delivery_date(payload),v_receipt_id,'proc-'||v_po.core_vendor_id::text,payload->>'location_id',v_facts,$new$)
  ) replacements(old_text,new_text) loop
    if (length(definition) - length(replace(definition,old_text,''))) / length(old_text) <> 1 then
      raise exception 'Unexpected exception receipt poster shape; review before migration';
    end if;
    definition := replace(definition,old_text,new_text);
  end loop;
  execute definition;
end;
$migration$;
