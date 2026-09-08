-- Reuse the existing date column. Do not infer dates for historical receipts.
-- Validation is inside new receipt insertion, after existing idempotent replay.
create or replace function private.receipt_actual_delivery_date(payload jsonb)
returns date language plpgsql stable security invoker set search_path = ''
as $function$
declare
  value text := payload->>'actual_delivery_date';
  delivered date;
begin
  if value is null or value = '' then
    raise exception 'Actual delivery date is required for a new governed receipt';
  end if;
  if value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'Actual delivery date must be a valid YYYY-MM-DD calendar date';
  end if;
  begin
    delivered := value::date;
  exception when others then
    raise exception 'Actual delivery date must be a valid YYYY-MM-DD calendar date';
  end;
  if pg_catalog.to_char(delivered, 'YYYY-MM-DD') <> value
     or delivered > (pg_catalog.now() at time zone 'Asia/Manila')::date then
    raise exception 'Actual delivery date cannot be invalid or future (Philippines)';
  end if;
  return delivered;
end;
$function$;
revoke all on function private.receipt_actual_delivery_date(jsonb) from public, anon, authenticated;
grant execute on function private.receipt_actual_delivery_date(jsonb) to service_role;

do $migration$
declare
  signature text;
  definition text;
  old_text text;
  new_text text;
begin
  foreach signature in array array[
    'private.warehouse_receive_procurement_po_legacy(jsonb)',
    'private.warehouse_receive_procurement_po_breakdown(jsonb)'
  ] loop
    definition := pg_catalog.pg_get_functiondef(signature::pg_catalog.regprocedure);
    if strpos(definition, 'private.receipt_actual_delivery_date(payload)') > 0 then
      raise exception 'Delivery date already installed in %', signature;
    end if;
    for old_text, new_text in select * from (values
      ('insert into warehouse.receipts(', 'insert into warehouse.receipts(actual_delivery_date,'),
      ($old$v_receipt_id, v_supplier_id, payload->>'location_id', v_receipt_lines$old$,
       $new$private.receipt_actual_delivery_date(payload), v_receipt_id, v_supplier_id, payload->>'location_id', v_receipt_lines$new$)
    ) replacements(old_text,new_text) loop
      if (length(definition) - length(replace(definition,old_text,''))) / length(old_text) <> 1 then
        raise exception 'Unexpected receipt poster shape in %; review before migration', signature;
      end if;
      definition := replace(definition,old_text,new_text);
    end loop;
    execute definition;
  end loop;
end;
$migration$;
