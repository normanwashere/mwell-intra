-- Restrict recipient acknowledgment to handovers; shipments must use POD.
-- Patch only the locked v2 branch, retaining the exposed/v3 chain, grants,
-- command replay, actor authority, evidence checks and all other actions.
do $migration$
declare
  definition text := pg_catalog.pg_get_functiondef(
    'private.warehouse_advance_fulfillment_order_v2(jsonb)'::pg_catalog.regprocedure
  );
  old_text text := $old$  if payload->>'action' = 'acknowledge_receipt' then$old$;
  new_text text := $new$  if payload->>'action' = 'acknowledge_receipt' then
    if v_order.delivery_method is null or v_order.delivery_method not in (
      'internal_handover', 'event_handover', 'third_party_transfer'
    ) then
      raise exception 'Receipt acknowledgment is only available for handovers. Shipments require proof of delivery through shipment tracking';
    end if;$new$;
begin
  if pg_catalog.strpos(definition, new_text) > 0 then
    raise exception 'Handover acknowledgment guard is already installed';
  end if;
  if (pg_catalog.length(definition) - pg_catalog.length(pg_catalog.replace(definition, old_text, '')))
       / pg_catalog.length(old_text) <> 1 then
    raise exception 'Expected exactly one v2 acknowledgment branch; review installed definition before migrating';
  end if;
  execute pg_catalog.replace(definition, old_text, new_text);
end;
$migration$;
