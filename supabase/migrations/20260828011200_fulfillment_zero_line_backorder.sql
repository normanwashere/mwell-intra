-- August 27 fulfillment feedback: explicit zero lines defer completely.
-- Only split validation and retained lines change; other lifecycle branches are preserved.
create or replace function private.warehouse_advance_fulfillment_order_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_order warehouse.fulfillment_orders;
  v_forward jsonb := payload;
  v_result jsonb;
  v_line jsonb;
  v_selection jsonb;
  v_current_lines jsonb := '[]'::jsonb;
  v_backorder_lines jsonb := '[]'::jsonb;
  v_remainder integer;
  v_sequence integer;
  v_material jsonb;
  v_stock warehouse.stock_levels;
  v_remaining integer;
  v_take integer;
  v_cancel_reason text;
  v_cancelled_at timestamptz;
begin
  v_started := private.begin_idempotent_command(
    'advance_fulfillment_order_v2', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;

  select * into v_order from warehouse.fulfillment_orders
  where id = (payload->>'order_id')::uuid for update;
  if not found then raise exception 'Fulfillment order not found'; end if;

  if payload->>'action' = 'split_backorder' then
    if not core.has_cap('warehouse', 'reserve_allocate') then
      raise exception 'Not authorized: warehouse.reserve_allocate';
    end if;
    if v_order.status <> 'received' then raise exception 'Only received demand can be split'; end if;
    if jsonb_typeof(payload->'fulfilled_lines') is distinct from 'array' then
      raise exception 'Provide exactly one fulfill-now quantity for every order line';
    end if;
    if jsonb_array_length(payload->'fulfilled_lines') <> jsonb_array_length(v_order.lines)
       or (select count(distinct value->>'productId') from jsonb_array_elements(payload->'fulfilled_lines')) <> jsonb_array_length(v_order.lines) then
      raise exception 'Provide exactly one fulfill-now quantity for every order line';
    end if;
    for v_line in select value from jsonb_array_elements(v_order.lines) loop
      select value into v_selection from jsonb_array_elements(coalesce(payload->'fulfilled_lines', '[]'::jsonb))
      where value->>'productId' = v_line->>'productId' limit 1;
      if v_selection is null or jsonb_typeof(v_selection->'quantity') is distinct from 'number' then
        raise exception 'Every line must have a whole fulfill-now quantity from zero to original demand';
      end if;
      if (v_selection->>'quantity')::numeric <> trunc((v_selection->>'quantity')::numeric)
         or (v_selection->>'quantity')::numeric < 0
         or (v_selection->>'quantity')::numeric > (v_line->>'quantity')::numeric then
        raise exception 'Every line must have a whole fulfill-now quantity from zero to original demand';
      end if;
      if (v_selection->>'quantity')::integer > 0 then
        v_current_lines := v_current_lines || jsonb_build_array(
          v_line || jsonb_build_object('quantity', (v_selection->>'quantity')::integer)
        );
      end if;
      v_remainder := (v_line->>'quantity')::integer - (v_selection->>'quantity')::integer;
      if v_remainder > 0 then
        v_backorder_lines := v_backorder_lines || jsonb_build_array(
          v_line || jsonb_build_object('quantity', v_remainder)
        );
      end if;
    end loop;
    if jsonb_array_length(v_current_lines) = 0 then
      raise exception 'At least one line must have a fulfill-now quantity';
    end if;
    if jsonb_array_length(v_backorder_lines) = 0 then
      raise exception 'At least one line must have a backordered quantity';
    end if;
    select count(*) + 1 into v_sequence from warehouse.fulfillment_orders child
    where child.parent_order_id = v_order.id;
    update warehouse.fulfillment_orders set lines = v_current_lines, updated_at = now()
    where id = v_order.id;
    insert into warehouse.fulfillment_orders(
      source, external_reference, requesting_department, source_location_id,
      source_bin_id, customer_reference, event_id, third_party_location_id,
      gross_sales_amount, status, lines, packaging, created_by, parent_order_id
    ) values (
      v_order.source, v_order.external_reference || '-BO-' || v_sequence,
      v_order.requesting_department, v_order.source_location_id, v_order.source_bin_id,
      v_order.customer_reference, v_order.event_id, v_order.third_party_location_id,
      v_order.gross_sales_amount, 'received', v_backorder_lines, '[]'::jsonb,
      auth.uid(), v_order.id
    );
    insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
    values ('warehouse', 'fulfillment_order', v_order.id, 'split_backorder', auth.uid(),
      jsonb_build_object('backorder_sequence', v_sequence));
    select * into v_order from warehouse.fulfillment_orders where id = v_order.id;
    return private.finish_idempotent_command(v_command_id, to_jsonb(v_order));
  end if;

  if payload->>'action' = 'acknowledge_receipt' then
    if v_order.status <> 'released' then raise exception 'Only released demand can be acknowledged'; end if;
    if v_order.released_by = auth.uid() then raise exception 'The releasing operator cannot acknowledge receipt'; end if;
    if not (
      v_order.created_by = auth.uid()
      or core.has_cap('warehouse', 'request_fulfillment')
      or core.has_cap('warehouse', 'issue_items')
      or exists (
        select 1 from warehouse.department_stock_requests request
        where request.fulfillment_order_id = v_order.id and request.requested_by = auth.uid()
      )
    ) then raise exception 'Not authorized to acknowledge this release'; end if;
    if nullif(pg_catalog.btrim(payload->>'acknowledgement_reference'), '') is null
       or nullif(pg_catalog.btrim(payload->>'acknowledgement_evidence_url'), '') is null then
      raise exception 'Acknowledgment reference and evidence are required';
    end if;
    update warehouse.fulfillment_orders set
      status = 'completed', acknowledged_by = auth.uid(), acknowledged_at = now(),
      acknowledgement_reference = pg_catalog.btrim(payload->>'acknowledgement_reference'),
      acknowledgement_evidence_url = pg_catalog.btrim(payload->>'acknowledgement_evidence_url'),
      updated_at = now()
    where id = v_order.id returning * into v_order;
    insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
    values ('warehouse', 'fulfillment_order', v_order.id, 'acknowledge_receipt', auth.uid(),
      jsonb_build_object('reference', v_order.acknowledgement_reference));
    return private.finish_idempotent_command(v_command_id, to_jsonb(v_order));
  end if;

  if payload->>'action' = 'mark_ready' then
    raise exception 'Use confirm packing so dispatch or handover evidence is recorded';
  end if;

  if payload->>'action' = 'confirm_pack' then
    if v_order.delivery_method = 'shipment' then
      if nullif(pg_catalog.btrim(payload->>'courier'), '') is null
         or nullif(pg_catalog.btrim(payload->>'waybill_number'), '') is null then
        raise exception 'Courier and waybill are required at packing';
      end if;
    else
      if nullif(pg_catalog.btrim(payload->>'handover_recipient_name'), '') is null
         or nullif(pg_catalog.btrim(payload->>'handover_recipient_department'), '') is null
         or nullif(pg_catalog.btrim(payload->>'handover_reference'), '') is null
         or nullif(pg_catalog.btrim(payload->>'handover_evidence_url'), '') is null then
        raise exception 'Recipient, department, handover reference, and evidence are required at packing';
      end if;
      v_forward := v_forward || jsonb_build_object(
        'courier', 'Internal handover',
        'waybill_number', payload->>'handover_reference'
      );
    end if;
  end if;

  if payload->>'action' = 'release' then
    if v_order.packed_by is null then raise exception 'Packing must be confirmed before release'; end if;
    if v_order.packed_by = auth.uid() then
      raise exception 'A second warehouse operator must release the prepared order';
    end if;
    if v_order.delivery_method <> 'shipment' then
      update warehouse.fulfillment_orders set
        courier = 'Internal handover', waybill_number = handover_reference
      where id = v_order.id;
    end if;
  end if;

  if payload->>'action' = 'cancel' then
    v_cancel_reason := nullif(pg_catalog.btrim(payload->>'cancellation_reason'), '');
    if v_cancel_reason is null then raise exception 'A cancellation reason is required'; end if;
    if v_order.status in ('packing', 'ready') and jsonb_array_length(v_order.packaging) > 0
       and payload->>'packaging_disposition' not in ('returned_to_stock', 'consumed') then
      raise exception 'Choose whether prepared packaging was consumed or returned';
    end if;
    v_cancelled_at := now();
    if v_order.status in ('packing', 'ready') and payload->>'packaging_disposition' = 'consumed' then
      for v_material in select value from jsonb_array_elements(v_order.packaging) loop
        v_remaining := (v_material->>'quantity')::integer;
        for v_stock in select * from warehouse.stock_levels stock
          where stock.product_id = v_material->>'productId' and stock.quantity > 0
            and (v_order.source_location_id is null or stock.location_id = v_order.source_location_id)
          order by stock.location_id, stock.bin_id nulls first, stock.lot_id nulls first
          for update
        loop
          v_take := least(v_remaining, v_stock.quantity);
          update warehouse.stock_levels set quantity = quantity - v_take
          where product_id = v_stock.product_id and location_id = v_stock.location_id
            and bin_id is not distinct from v_stock.bin_id
            and lot_id is not distinct from v_stock.lot_id;
          insert into warehouse.movements(
            id, type, product_id, quantity, from_location_id, from_bin_id,
            lot_id, reference, reason, actor
          ) values (
            gen_random_uuid()::text, 'packaging_consumption', v_stock.product_id,
            v_take, v_stock.location_id, v_stock.bin_id, v_stock.lot_id,
            v_order.id::text, 'Cancelled after packing: ' || v_cancel_reason,
            warehouse.authoritative_actor()
          );
          v_remaining := v_remaining - v_take;
          exit when v_remaining = 0;
        end loop;
        if v_remaining > 0 then raise exception 'Packaging stock changed before cancellation'; end if;
      end loop;
    end if;
  end if;

  v_forward := jsonb_set(
    v_forward,
    '{idempotency_key}',
    to_jsonb((payload->>'idempotency_key') || '-base')
  );
  v_result := private.warehouse_advance_fulfillment_order(v_forward);

  if payload->>'action' = 'allocate' then
    insert into warehouse.fulfillment_reservations(
      order_id, product_id, location_id, bin_id, quantity, created_by
    )
    select
      v_order.id, line->>'productId', v_order.source_location_id,
      v_order.source_bin_id, (line->>'quantity')::integer, auth.uid()
    from jsonb_array_elements(v_order.lines) line
    on conflict (order_id, product_id) do update set
      quantity = excluded.quantity, status = 'active', closed_at = null;
  elsif payload->>'action' = 'confirm_pick' then
    update warehouse.fulfillment_orders set picked_by = auth.uid(), picked_at = now()
    where id = v_order.id;
  elsif payload->>'action' = 'confirm_pack' then
    update warehouse.fulfillment_orders set
      packed_by = auth.uid(), packed_at = now(),
      handover_recipient_name = nullif(pg_catalog.btrim(payload->>'handover_recipient_name'), ''),
      handover_recipient_department = nullif(pg_catalog.btrim(payload->>'handover_recipient_department'), ''),
      handover_reference = nullif(pg_catalog.btrim(payload->>'handover_reference'), ''),
      handover_evidence_url = nullif(pg_catalog.btrim(payload->>'handover_evidence_url'), ''),
      courier = case when delivery_method = 'shipment' then courier else null end,
      waybill_number = case when delivery_method = 'shipment' then waybill_number else null end
    where id = v_order.id;
  elsif payload->>'action' = 'release' then
    update warehouse.fulfillment_orders set
      courier = case when delivery_method = 'shipment' then courier else null end,
      waybill_number = case when delivery_method = 'shipment' then waybill_number else null end
    where id = v_order.id;
    update warehouse.fulfillment_reservations set
      status = 'released', closed_at = now()
    where order_id = v_order.id and status = 'active';
  elsif payload->>'action' = 'cancel' then
    update warehouse.fulfillment_orders set
      cancellation_reason = v_cancel_reason,
      packaging_disposition = nullif(payload->>'packaging_disposition', '')
    where id = v_order.id;
    update warehouse.fulfillment_reservations set
      status = 'cancelled', closed_at = now()
    where order_id = v_order.id and status = 'active';
  end if;

  select * into v_order from warehouse.fulfillment_orders where id = v_order.id;
  return private.finish_idempotent_command(v_command_id, to_jsonb(v_order));
end;
$$;

revoke all on function private.warehouse_advance_fulfillment_order_v2(jsonb)
  from public, anon, authenticated;
grant execute on function private.warehouse_advance_fulfillment_order_v2(jsonb)
  to service_role;
