-- Read-only pg_get_functiondef snapshot from UAT kkoitlvydytdhlpxhuah on 2026-09-08.
CREATE OR REPLACE FUNCTION private.warehouse_advance_fulfillment_order(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_started jsonb;
  v_command_id uuid;
  v_order warehouse.fulfillment_orders;
  v_action text := payload->>'action';
  v_next_status text;
  v_line jsonb;
  v_pick jsonb;
  v_material jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_product warehouse.products;
  v_unit warehouse.inventory_units;
  v_stock warehouse.stock_levels;
  v_serial text;
  v_available integer;
  v_committed integer;
  v_remaining integer;
  v_take integer;
  v_held integer;
  v_actor text;
begin
  v_started := private.begin_idempotent_command(
    'advance_fulfillment_order', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;

  if v_action in ('allocate', 'cancel') then
    if not core.has_cap('warehouse', 'reserve_allocate') then
      raise exception 'Not authorized: warehouse.reserve_allocate';
    end if;
  elsif not core.has_cap('warehouse', 'issue_items') then
    raise exception 'Not authorized: warehouse.issue_items';
  end if;

  select * into v_order from warehouse.fulfillment_orders
   where id = (payload->>'order_id')::uuid for update;
  if not found then raise exception 'Fulfillment order not found'; end if;
  v_next_status := case
    when v_order.status = 'received' and v_action = 'allocate' then 'allocated'
    when v_order.status = 'allocated' and v_action = 'start_picking' then 'picking'
    when v_order.status = 'picking' and v_action = 'confirm_pick' then 'packing'
    when v_order.status = 'packing' and v_action in ('confirm_pack', 'mark_ready') then 'ready'
    when v_order.status = 'ready' and v_action = 'release' then 'released'
    when v_order.status in ('received', 'allocated', 'picking', 'packing', 'ready')
      and v_action = 'cancel' then 'cancelled'
    else null end;
  if v_next_status is null then
    raise exception 'Cannot % an order while it is %', replace(v_action, '_', ' '), v_order.status;
  end if;

  if v_action = 'allocate' then
    for v_line in select value from jsonb_array_elements(v_order.lines) loop
      select * into v_product from warehouse.products
       where id = v_line->>'productId' for update;
      if v_product.serialized then
        select count(*) into v_available from warehouse.inventory_units unit
         where unit.product_id = v_product.id and unit.status = 'in_stock'
           and (v_order.source_location_id is null or unit.location_id = v_order.source_location_id)
           and (v_order.source_bin_id is null or unit.bin_id = v_order.source_bin_id)
           and not exists (
             select 1 from warehouse.inventory_holds hold
              where hold.status = 'active' and hold.product_id = unit.product_id
                and hold.serial_number = unit.serial_number
           );
      else
        select coalesce(sum(level.quantity), 0)::integer into v_available
          from warehouse.stock_levels level
         where level.product_id = v_product.id
           and (v_order.source_location_id is null or level.location_id = v_order.source_location_id)
           and (v_order.source_bin_id is null or level.bin_id = v_order.source_bin_id);
        select coalesce(sum(hold.quantity), 0)::integer into v_held
          from warehouse.inventory_holds hold
         where hold.status = 'active' and hold.product_id = v_product.id
           and hold.serial_number is null
           and (v_order.source_location_id is null or hold.location_id = v_order.source_location_id)
           and (v_order.source_bin_id is null or hold.bin_id = v_order.source_bin_id);
        v_available := greatest(0, v_available - v_held);
      end if;
      select coalesce(sum((other_line->>'quantity')::integer), 0)::integer into v_committed
        from warehouse.fulfillment_orders other_order
        cross join lateral jsonb_array_elements(other_order.lines) other_line
       where other_order.id <> v_order.id
         and other_order.status in ('allocated', 'picking', 'packing', 'ready')
         and other_line->>'productId' = v_product.id
         and (
           v_order.source_location_id is null
           or other_order.source_location_id is null
           or other_order.source_location_id = v_order.source_location_id
         )
         and (
           v_order.source_bin_id is null
           or other_order.source_bin_id is null
           or other_order.source_bin_id = v_order.source_bin_id
         );
      if v_available - v_committed < (v_line->>'quantity')::integer then
        raise exception 'Only % of % is available for this order',
          greatest(0, v_available - v_committed), v_product.name;
      end if;
    end loop;
  elsif v_action = 'confirm_pick' then
    if jsonb_typeof(payload->'picked_lines') <> 'array' then
      raise exception 'Picked lines must be an array';
    end if;
    if exists (
      select 1
        from jsonb_array_elements(payload->'picked_lines') picked,
             lateral jsonb_array_elements_text(coalesce(picked->'serialNumbers', '[]'::jsonb)) serial
       group by serial having count(*) > 1
    ) then raise exception 'A serial number cannot be scanned twice'; end if;
    for v_line in select value from jsonb_array_elements(v_order.lines) loop
      select value into v_pick from jsonb_array_elements(payload->'picked_lines')
       where value->>'productId' = v_line->>'productId' limit 1;
      if v_pick is null or coalesce((v_pick->>'quantity')::integer, 0) <> (v_line->>'quantity')::integer then
        raise exception 'Every order line must be picked in full';
      end if;
      select * into v_product from warehouse.products where id = v_line->>'productId';
      if v_product.serialized and jsonb_array_length(coalesce(v_pick->'serialNumbers', '[]'::jsonb))
          <> (v_line->>'quantity')::integer then
        raise exception '% requires one serial scan per unit', v_product.name;
      end if;
      if not v_product.serialized and jsonb_array_length(coalesce(v_pick->'serialNumbers', '[]'::jsonb)) > 0 then
        raise exception '% does not accept serial scans', v_product.name;
      end if;
      for v_serial in select value from jsonb_array_elements_text(coalesce(v_pick->'serialNumbers', '[]'::jsonb)) loop
        if not exists (
          select 1 from warehouse.inventory_units unit
           where unit.product_id = v_product.id and unit.serial_number = v_serial
             and unit.status = 'in_stock'
             and (v_order.source_location_id is null or unit.location_id = v_order.source_location_id)
             and (v_order.source_bin_id is null or unit.bin_id = v_order.source_bin_id)
             and not exists (
               select 1 from warehouse.inventory_holds hold
                where hold.status = 'active' and hold.product_id = unit.product_id
                  and hold.serial_number = unit.serial_number
             )
        ) then raise exception 'Serial % is not available at the pick location', v_serial; end if;
      end loop;
      v_lines := v_lines || jsonb_build_array(
        v_line || jsonb_build_object(
          'pickedQuantity', (v_pick->>'quantity')::integer,
          'pickedSerialNumbers', coalesce(v_pick->'serialNumbers', '[]'::jsonb)
        )
      );
    end loop;
    v_order.lines := v_lines;
  elsif v_action = 'confirm_pack' then
    if nullif(pg_catalog.btrim(coalesce(payload->>'courier', '')), '') is null then
      raise exception 'Courier is required at packing';
    end if;
    if nullif(pg_catalog.btrim(coalesce(payload->>'waybill_number', '')), '') is null then
      raise exception 'Waybill number is required at packing';
    end if;
    if jsonb_typeof(payload->'packaging') <> 'array' then raise exception 'Packaging must be an array'; end if;
    for v_material in select value from jsonb_array_elements(payload->'packaging') loop
      select * into v_product from warehouse.products where id = v_material->>'productId';
      if not found or v_product.item_class <> 'fulfillment_supply' then
        raise exception 'Only fulfillment supplies may be consumed during packing';
      end if;
      if coalesce((v_material->>'quantity')::integer, 0) <= 0 then
        raise exception 'Packaging quantity must be greater than zero';
      end if;
      select coalesce(sum(level.quantity), 0)::integer into v_available
        from warehouse.stock_levels level where level.product_id = v_product.id
          and (v_order.source_location_id is null or level.location_id = v_order.source_location_id);
      if v_available < (v_material->>'quantity')::integer then
        raise exception 'Insufficient % for packing', v_product.name;
      end if;
    end loop;
    v_order.courier := pg_catalog.btrim(payload->>'courier');
    v_order.waybill_number := pg_catalog.btrim(payload->>'waybill_number');
    v_order.packaging := payload->'packaging';
  elsif v_action = 'release' then
    if nullif(pg_catalog.btrim(coalesce(v_order.courier, '')), '') is null
       or nullif(pg_catalog.btrim(coalesce(v_order.waybill_number, '')), '') is null then
      raise exception 'Courier and waybill are required before release';
    end if;
    v_actor := warehouse.authoritative_actor();
    for v_line in select value from jsonb_array_elements(v_order.lines) loop
      if (v_line->>'pickedQuantity')::integer <> (v_line->>'quantity')::integer then
        raise exception 'Every order line must be fully picked before release';
      end if;
      select * into v_product from warehouse.products where id = v_line->>'productId' for update;
      if v_product.serialized then
        for v_serial in select value from jsonb_array_elements_text(v_line->'pickedSerialNumbers') loop
          select * into v_unit from warehouse.inventory_units unit
           where unit.product_id = v_product.id and unit.serial_number = v_serial
             and unit.status = 'in_stock'
             and (v_order.source_location_id is null or unit.location_id = v_order.source_location_id)
             and (v_order.source_bin_id is null or unit.bin_id = v_order.source_bin_id)
           for update;
          if not found or exists (
            select 1 from warehouse.inventory_holds hold
             where hold.status = 'active' and hold.product_id = v_product.id
               and hold.serial_number = v_serial
          ) then raise exception 'Serial % is no longer available', v_serial; end if;
          update warehouse.inventory_units set status = 'issued', assigned_to = v_order.external_reference
           where id = v_unit.id;
          insert into warehouse.movements(
            id, type, product_id, quantity, from_location_id, from_bin_id,
            serial_number, event_id, reference, actor
          ) values (
            gen_random_uuid()::text, 'fulfillment_release', v_product.id, 1,
            v_unit.location_id, v_unit.bin_id, v_serial, v_order.event_id,
            v_order.id::text, v_actor
          );
        end loop;
      else
        v_remaining := (v_line->>'quantity')::integer;
        for v_stock in select * from warehouse.stock_levels level
          where level.product_id = v_product.id and level.quantity > 0
            and (v_order.source_location_id is null or level.location_id = v_order.source_location_id)
            and (v_order.source_bin_id is null or level.bin_id = v_order.source_bin_id)
          order by level.location_id, level.bin_id nulls first, level.lot_id nulls first
          for update
        loop
          select coalesce(sum(hold.quantity), 0)::integer into v_held
            from warehouse.inventory_holds hold
           where hold.status = 'active' and hold.product_id = v_product.id
             and hold.location_id = v_stock.location_id and hold.serial_number is null
             and hold.bin_id is not distinct from v_stock.bin_id
             and hold.lot_id is not distinct from v_stock.lot_id;
          v_take := least(v_remaining, greatest(0, v_stock.quantity - v_held));
          if v_take > 0 then
            update warehouse.stock_levels set quantity = quantity - v_take
             where product_id = v_stock.product_id and location_id = v_stock.location_id
               and bin_id is not distinct from v_stock.bin_id
               and lot_id is not distinct from v_stock.lot_id;
            insert into warehouse.movements(
              id, type, product_id, quantity, from_location_id, from_bin_id,
              lot_id, event_id, reference, actor
            ) values (
              gen_random_uuid()::text, 'fulfillment_release', v_product.id, v_take,
              v_stock.location_id, v_stock.bin_id, v_stock.lot_id, v_order.event_id,
              v_order.id::text, v_actor
            );
            v_remaining := v_remaining - v_take;
          end if;
          exit when v_remaining = 0;
        end loop;
        if v_remaining > 0 then raise exception '% is no longer available', v_product.name; end if;
      end if;
    end loop;
    for v_material in select value from jsonb_array_elements(v_order.packaging) loop
      v_remaining := (v_material->>'quantity')::integer;
      for v_stock in select * from warehouse.stock_levels level
        where level.product_id = v_material->>'productId' and level.quantity > 0
          and (v_order.source_location_id is null or level.location_id = v_order.source_location_id)
        order by level.location_id, level.bin_id nulls first, level.lot_id nulls first
        for update
      loop
        v_take := least(v_remaining, v_stock.quantity);
        update warehouse.stock_levels set quantity = quantity - v_take
         where product_id = v_stock.product_id and location_id = v_stock.location_id
           and bin_id is not distinct from v_stock.bin_id
           and lot_id is not distinct from v_stock.lot_id;
        insert into warehouse.movements(
          id, type, product_id, quantity, from_location_id, from_bin_id,
          lot_id, reference, actor
        ) values (
          gen_random_uuid()::text, 'packaging_consumption', v_stock.product_id, v_take,
          v_stock.location_id, v_stock.bin_id, v_stock.lot_id, v_order.id::text, v_actor
        );
        v_remaining := v_remaining - v_take;
        exit when v_remaining = 0;
      end loop;
      if v_remaining > 0 then raise exception 'Packaging stock changed before release'; end if;
    end loop;
    v_order.released_by := auth.uid();
    v_order.released_at := now();
  end if;

  update warehouse.fulfillment_orders set
    status = v_next_status, lines = v_order.lines, packaging = v_order.packaging,
    courier = v_order.courier, waybill_number = v_order.waybill_number,
    released_by = v_order.released_by, released_at = v_order.released_at,
    updated_at = now()
   where id = v_order.id returning * into v_order;
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('warehouse', 'fulfillment_order', v_order.id, v_action, auth.uid(),
    jsonb_build_object('status', v_order.status, 'external_reference', v_order.external_reference));
  return private.finish_idempotent_command(v_command_id, to_jsonb(v_order));
end;
$function$;

CREATE OR REPLACE FUNCTION private.warehouse_advance_fulfillment_order_v2(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION private.warehouse_advance_fulfillment_order_v3(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order warehouse.fulfillment_orders;
  v_line jsonb;
  v_pick jsonb;
  v_bin warehouse.storage_areas;
  v_product warehouse.products;
  v_serial text;
  v_available integer;
  v_forward jsonb := payload;
  v_result jsonb;
  v_lines jsonb;
begin
  select * into v_order from warehouse.fulfillment_orders
  where id = (payload->>'order_id')::uuid;
  if not found then raise exception 'Fulfillment order not found'; end if;

  if payload->>'action' = 'confirm_pick' then
    for v_line in select value from jsonb_array_elements(v_order.lines) loop
      select value into v_pick
      from jsonb_array_elements(coalesce(payload->'picked_lines', '[]'::jsonb))
      where value->>'productId' = v_line->>'productId'
      limit 1;
      if nullif(v_pick->>'binId', '') is not null then
        select * into v_bin from warehouse.storage_areas area
        where area.id = v_pick->>'binId'
          and area.active
          and (v_order.source_location_id is null or area.location_id = v_order.source_location_id);
        if not found then raise exception 'The scanned bin is not active at the source warehouse'; end if;

        select * into v_product from warehouse.products product
        where product.id = v_line->>'productId';
        if v_product.serialized then
          for v_serial in
            select value
            from jsonb_array_elements_text(coalesce(v_pick->'serialNumbers', '[]'::jsonb))
          loop
            if not exists (
              select 1 from warehouse.inventory_units unit
              where unit.product_id = v_product.id
                and unit.serial_number = v_serial
                and unit.status = 'in_stock'
                and unit.bin_id = v_bin.id
            ) then
              raise exception 'Serial % is not available in the scanned bin', v_serial;
            end if;
          end loop;
        else
          select coalesce(sum(level.quantity), 0)::integer into v_available
          from warehouse.stock_levels level
          where level.product_id = v_product.id
            and level.location_id = v_bin.location_id
            and level.bin_id = v_bin.id;
          if v_available < (v_line->>'quantity')::integer then
            raise exception '% is not available in the scanned bin', v_product.name;
          end if;
        end if;
      end if;
    end loop;
  end if;

  if payload->>'action' = 'confirm_pack'
     and v_order.delivery_method = 'shipment'
     and nullif(pg_catalog.btrim(coalesce(payload->>'delivery_link', v_order.delivery_link, '')), '') is null then
    raise exception 'Delivery tracking link is required before shipment release';
  end if;

  v_forward := jsonb_set(
    v_forward,
    '{idempotency_key}',
    to_jsonb((payload->>'idempotency_key') || '-v2')
  );
  v_result := private.warehouse_advance_fulfillment_order_v2(v_forward);

  if payload->>'action' = 'confirm_pick' then
    select jsonb_agg(
      line
      || case
        when nullif(picked.value->>'binId', '') is null then '{}'::jsonb
        else jsonb_build_object('pickBinId', picked.value->>'binId')
      end
      || case
        when nullif(picked.value->>'evidenceUrl', '') is null then '{}'::jsonb
        else jsonb_build_object('fulfillmentEvidenceUrl', picked.value->>'evidenceUrl')
      end
      order by ordinal
    ) into v_lines
    from jsonb_array_elements((v_result->'lines')) with ordinality order_line(line, ordinal)
    left join lateral (
      select value
      from jsonb_array_elements(coalesce(payload->'picked_lines', '[]'::jsonb))
      where value->>'productId' = line->>'productId'
      limit 1
    ) picked on true;
    update warehouse.fulfillment_orders set lines = v_lines
    where id = v_order.id returning * into v_order;
    v_result := to_jsonb(v_order);
  end if;
  if payload->>'action' = 'confirm_pack' then
    update warehouse.fulfillment_orders set
      delivery_link = coalesce(
        nullif(pg_catalog.btrim(coalesce(payload->>'delivery_link', '')), ''),
        delivery_link
      )
    where id = v_order.id returning * into v_order;
    v_result := to_jsonb(v_order);
  end if;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION warehouse.advance_fulfillment_order(payload jsonb)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$ select private.warehouse_advance_fulfillment_order_v3(payload) $function$;
