-- Keep shipment tracking available to signed-in fulfillment operators while
-- enforcing the current live-role authority boundary.
create or replace function warehouse.update_shipment_tracking(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_order warehouse.fulfillment_orders;
  v_action text := payload->>'action';
  v_reference text := nullif(pg_catalog.btrim(payload->>'tracking_reference'), '');
  v_evidence text := nullif(pg_catalog.btrim(payload->>'evidence_url'), '');
  v_reason text := nullif(pg_catalog.btrim(payload->>'failure_reason'), '');
begin
  v_started := private.begin_idempotent_command(
    'update_shipment_tracking', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;

  select * into v_order from warehouse.fulfillment_orders
  where id = (payload->>'order_id')::uuid for update;
  if not found then raise exception 'Fulfillment order not found'; end if;
  if v_order.delivery_method <> 'shipment' then
    raise exception 'Courier tracking applies only to shipment orders';
  end if;
  if v_order.status <> 'released' then
    raise exception 'Only a released shipment can be tracked';
  end if;
  if not (
    core.has_live_cap('warehouse', 'issue_items')
    or core.has_live_cap('warehouse', 'request_fulfillment')
    or v_order.created_by = auth.uid()
  ) then raise exception 'Not authorized to update this shipment'; end if;

  if v_action = 'mark_in_transit' then
    if v_order.shipment_status not in ('dispatched', 'delivery_failed') then
      raise exception 'Shipment cannot enter transit from its current state';
    end if;
    update warehouse.fulfillment_orders set
      shipment_status = 'in_transit',
      dispatched_at = coalesce(dispatched_at, now()),
      last_tracking_at = now(),
      delivery_failure_reason = null,
      updated_at = now()
    where id = v_order.id returning * into v_order;
  elsif v_action = 'record_delivery_failed' then
    if v_order.shipment_status not in ('dispatched', 'in_transit') then
      raise exception 'Only a dispatched shipment can record failed delivery';
    end if;
    if v_reason is null then raise exception 'A failed-delivery reason is required'; end if;
    update warehouse.fulfillment_orders set
      shipment_status = 'delivery_failed',
      delivery_failure_reason = v_reason,
      failed_delivery_at = now(),
      last_tracking_at = now(),
      updated_at = now()
    where id = v_order.id returning * into v_order;
  elsif v_action = 'confirm_delivery' then
    if v_order.shipment_status not in ('dispatched', 'in_transit', 'delivery_failed') then
      raise exception 'Shipment cannot be delivered from its current state';
    end if;
    if v_reference is null or v_evidence is null then
      raise exception 'Proof-of-delivery reference and evidence are required';
    end if;
    update warehouse.fulfillment_orders set
      status = 'completed',
      shipment_status = 'delivered',
      proof_of_delivery_reference = v_reference,
      proof_of_delivery_evidence_url = v_evidence,
      delivered_at = now(),
      last_tracking_at = now(),
      updated_at = now()
    where id = v_order.id returning * into v_order;
  elsif v_action = 'return_to_sender' then
    if v_order.shipment_status <> 'delivery_failed' then
      raise exception 'Only a failed delivery can return to sender';
    end if;
    if v_reason is null then raise exception 'A return-to-sender reason is required'; end if;
    update warehouse.fulfillment_orders set
      shipment_status = 'returned_to_sender',
      delivery_failure_reason = v_reason,
      last_tracking_at = now(),
      updated_at = now()
    where id = v_order.id returning * into v_order;
  else
    raise exception 'Unsupported shipment tracking action';
  end if;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'warehouse',
    'fulfillment_order',
    v_order.id,
    v_action,
    auth.uid(),
    pg_catalog.jsonb_build_object(
      'shipment_status', v_order.shipment_status,
      'tracking_reference', v_reference,
      'failure_reason', v_reason
    )
  );
  return private.finish_idempotent_command(v_command_id, pg_catalog.to_jsonb(v_order));
end;
$$;

revoke all on function warehouse.update_shipment_tracking(jsonb) from public, anon;
grant usage on schema warehouse to authenticated, service_role;
grant execute on function warehouse.update_shipment_tracking(jsonb) to authenticated, service_role;
