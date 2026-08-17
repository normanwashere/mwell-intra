-- Ecommerce order intake and directed pick controls.
-- CSV is a transitional migration source; Intra and Supabase are authoritative.

alter table warehouse.fulfillment_orders
  add column if not exists ecommerce_channel text,
  add column if not exists order_date date,
  add column if not exists customer_name text,
  add column if not exists customer_contact text,
  add column if not exists customer_email text,
  add column if not exists delivery_area text,
  add column if not exists delivery_address jsonb,
  add column if not exists payment_status text,
  add column if not exists payment_method text,
  add column if not exists payment_reference text,
  add column if not exists payment_date date,
  add column if not exists payment_rrn text,
  add column if not exists payment_provider_method text,
  add column if not exists payment_provider_status text,
  add column if not exists campaign_name text,
  add column if not exists sales_invoice_number text,
  add column if not exists shipping_fee numeric(14,2),
  add column if not exists other_fees numeric(14,2),
  add column if not exists reported_total_amount numeric(14,2),
  add column if not exists order_notes text,
  add column if not exists delivery_link text,
  add column if not exists shipment_events jsonb not null default '[]'::jsonb;

alter table warehouse.fulfillment_orders
  drop constraint if exists warehouse_fulfillment_payment_status_check,
  add constraint warehouse_fulfillment_payment_status_check check (
    payment_status is null or payment_status in (
      'paid', 'authorized', 'cod', 'pending', 'failed', 'refunded'
    )
  ),
  drop constraint if exists warehouse_fulfillment_shipping_fee_check,
  add constraint warehouse_fulfillment_shipping_fee_check check (
    shipping_fee is null or shipping_fee >= 0
  ),
  drop constraint if exists warehouse_fulfillment_other_fees_check,
  add constraint warehouse_fulfillment_other_fees_check check (
    other_fees is null or other_fees >= 0
  ),
  drop constraint if exists warehouse_fulfillment_reported_total_check,
  add constraint warehouse_fulfillment_reported_total_check check (
    reported_total_amount is null or reported_total_amount >= 0
  ),
  drop constraint if exists warehouse_fulfillment_delivery_link_check,
  add constraint warehouse_fulfillment_delivery_link_check check (
    delivery_link is null or delivery_link ~* '^https?://'
  ),
  drop constraint if exists warehouse_fulfillment_delivery_address_check,
  add constraint warehouse_fulfillment_delivery_address_check check (
    delivery_address is null or (
      jsonb_typeof(delivery_address) = 'object'
      and delivery_address ?& array['addressLine', 'city', 'province', 'postalCode']
    )
  ),
  drop constraint if exists warehouse_fulfillment_shipment_events_check,
  add constraint warehouse_fulfillment_shipment_events_check check (
    jsonb_typeof(shipment_events) = 'array'
  );

create index if not exists warehouse_fulfillment_channel_queue_idx
  on warehouse.fulfillment_orders(
    ecommerce_channel, status, order_date desc, updated_at desc, id
  )
  where source = 'ecommerce';
create index if not exists warehouse_fulfillment_payment_queue_idx
  on warehouse.fulfillment_orders(payment_status, updated_at desc, id)
  where source = 'ecommerce' and payment_status is not null;

create or replace function private.append_fulfillment_shipment_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reference text;
  v_reason text;
  v_evidence text;
begin
  if new.shipment_status is not distinct from old.shipment_status then
    return new;
  end if;
  v_reference := case
    when new.shipment_status = 'delivered' then new.proof_of_delivery_reference
    else new.waybill_number
  end;
  v_reason := case
    when new.shipment_status in ('delivery_failed', 'returned_to_sender')
      then new.delivery_failure_reason
    else null
  end;
  v_evidence := case
    when new.shipment_status = 'delivered' then new.proof_of_delivery_evidence_url
    else null
  end;
  new.shipment_events := coalesce(new.shipment_events, '[]'::jsonb)
    || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'status', new.shipment_status,
      'occurredAt', coalesce(new.last_tracking_at, now()),
      'actor', warehouse.authoritative_actor(),
      'reference', v_reference,
      'reason', v_reason,
      'evidenceUrl', v_evidence
    )));
  return new;
end;
$$;
revoke all on function private.append_fulfillment_shipment_event()
  from public, anon, authenticated;
grant execute on function private.append_fulfillment_shipment_event()
  to service_role;

drop trigger if exists warehouse_fulfillment_shipment_event_append
  on warehouse.fulfillment_orders;
drop trigger if exists warehouse_zz_fulfillment_shipment_event_append
  on warehouse.fulfillment_orders;
create trigger warehouse_zz_fulfillment_shipment_event_append
before update on warehouse.fulfillment_orders
for each row execute function private.append_fulfillment_shipment_event();

update warehouse.fulfillment_orders
set shipment_events = jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
  'status', shipment_status,
  'occurredAt', coalesce(last_tracking_at, dispatched_at, delivered_at, created_at),
  'actor', 'system:migration',
  'reference', case
    when shipment_status = 'delivered' then proof_of_delivery_reference
    else waybill_number
  end,
  'reason', case
    when shipment_status in ('delivery_failed', 'returned_to_sender')
      then delivery_failure_reason
    else null
  end,
  'evidenceUrl', case
    when shipment_status = 'delivered' then proof_of_delivery_evidence_url
    else null
  end
)))
where delivery_method = 'shipment'
  and jsonb_array_length(shipment_events) = 0;

create or replace function warehouse.create_fulfillment_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_order warehouse.fulfillment_orders;
  v_address jsonb := payload->'delivery_address';
  v_status text := pg_catalog.lower(pg_catalog.btrim(coalesce(payload->>'payment_status', '')));
  v_line jsonb;
  v_quantity numeric;
  v_unit_price numeric;
  v_discount numeric;
begin
  if payload->>'source' = 'ecommerce' and (
    nullif(pg_catalog.btrim(coalesce(payload->>'ecommerce_channel', '')), '') is not null
    or nullif(pg_catalog.btrim(coalesce(payload->>'customer_name', '')), '') is not null
    or jsonb_typeof(v_address) = 'object'
    or nullif(v_status, '') is not null
    or payload->>'requesting_department' = 'sales_ecommerce'
  ) then
    if nullif(pg_catalog.btrim(coalesce(payload->>'ecommerce_channel', '')), '') is null then
      raise exception 'Ecommerce channel is required for controlled intake';
    end if;
    if nullif(pg_catalog.btrim(coalesce(payload->>'customer_name', '')), '') is null
       or nullif(pg_catalog.btrim(coalesce(payload->>'customer_contact', '')), '') is null then
      raise exception 'Customer name and contact are required for ecommerce intake';
    end if;
    if jsonb_typeof(v_address) <> 'object'
       or nullif(pg_catalog.btrim(coalesce(v_address->>'addressLine', '')), '') is null
       or nullif(pg_catalog.btrim(coalesce(v_address->>'city', '')), '') is null
       or nullif(pg_catalog.btrim(coalesce(v_address->>'province', '')), '') is null
       or nullif(pg_catalog.btrim(coalesce(v_address->>'postalCode', '')), '') is null then
      raise exception 'A complete delivery address is required for ecommerce intake';
    end if;
    if v_status not in ('paid', 'authorized', 'cod') then
      raise exception 'Payment must be paid, authorized, or COD before warehouse allocation';
    end if;
    if nullif(pg_catalog.btrim(coalesce(payload->>'customer_email', '')), '') is not null
       and payload->>'customer_email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
      raise exception 'Customer email is invalid';
    end if;
    if nullif(payload->>'shipping_fee', '') is not null
       and (payload->>'shipping_fee')::numeric < 0 then
      raise exception 'Shipping fee cannot be negative';
    end if;
    if nullif(payload->>'other_fees', '') is not null
       and (payload->>'other_fees')::numeric < 0 then
      raise exception 'Other fees cannot be negative';
    end if;
    if nullif(payload->>'reported_total_amount', '') is not null
       and (payload->>'reported_total_amount')::numeric < 0 then
      raise exception 'Reported total cannot be negative';
    end if;
    if nullif(pg_catalog.btrim(coalesce(payload->>'delivery_link', '')), '') is not null
       and payload->>'delivery_link' !~* '^https?://' then
      raise exception 'Delivery link must start with http:// or https://';
    end if;
    for v_line in select value from jsonb_array_elements(coalesce(payload->'lines', '[]'::jsonb)) loop
      v_quantity := coalesce((v_line->>'quantity')::numeric, 0);
      v_unit_price := nullif(v_line->>'unitPrice', '')::numeric;
      v_discount := nullif(v_line->>'discountAmount', '')::numeric;
      if v_unit_price is not null and v_unit_price < 0 then
        raise exception 'Unit price cannot be negative';
      end if;
      if v_discount is not null and v_discount < 0 then
        raise exception 'Discount amount cannot be negative';
      end if;
      if v_discount is not null and v_unit_price is not null
         and v_discount > v_unit_price * v_quantity then
        raise exception 'Discount amount cannot exceed the line value';
      end if;
    end loop;
  end if;

  v_result := private.warehouse_create_fulfillment_order(payload);

  update warehouse.fulfillment_orders set
    ecommerce_channel = nullif(pg_catalog.btrim(coalesce(payload->>'ecommerce_channel', '')), ''),
    order_date = nullif(payload->>'order_date', '')::date,
    customer_name = nullif(pg_catalog.btrim(coalesce(payload->>'customer_name', '')), ''),
    customer_contact = nullif(pg_catalog.btrim(coalesce(payload->>'customer_contact', '')), ''),
    customer_email = nullif(pg_catalog.btrim(coalesce(payload->>'customer_email', '')), ''),
    delivery_area = nullif(pg_catalog.btrim(coalesce(payload->>'delivery_area', '')), ''),
    delivery_address = case when jsonb_typeof(v_address) = 'object' then v_address else null end,
    payment_status = nullif(v_status, ''),
    payment_method = nullif(pg_catalog.btrim(coalesce(payload->>'payment_method', '')), ''),
    payment_reference = nullif(pg_catalog.btrim(coalesce(payload->>'payment_reference', '')), ''),
    payment_date = nullif(payload->>'payment_date', '')::date,
    payment_rrn = nullif(pg_catalog.btrim(coalesce(payload->>'payment_rrn', '')), ''),
    payment_provider_method = nullif(pg_catalog.btrim(coalesce(payload->>'payment_provider_method', '')), ''),
    payment_provider_status = nullif(pg_catalog.btrim(coalesce(payload->>'payment_provider_status', '')), ''),
    campaign_name = nullif(pg_catalog.btrim(coalesce(payload->>'campaign_name', '')), ''),
    sales_invoice_number = nullif(pg_catalog.btrim(coalesce(payload->>'sales_invoice_number', '')), ''),
    shipping_fee = nullif(payload->>'shipping_fee', '')::numeric,
    other_fees = nullif(payload->>'other_fees', '')::numeric,
    reported_total_amount = nullif(payload->>'reported_total_amount', '')::numeric,
    order_notes = nullif(pg_catalog.btrim(coalesce(payload->>'order_notes', '')), ''),
    courier = nullif(pg_catalog.btrim(coalesce(payload->>'courier', '')), ''),
    delivery_link = nullif(pg_catalog.btrim(coalesce(payload->>'delivery_link', '')), ''),
    waybill_number = nullif(pg_catalog.btrim(coalesce(payload->>'waybill_number', '')), ''),
    shipment_events = case
      when delivery_method = 'shipment' and jsonb_array_length(shipment_events) = 0
        then jsonb_build_array(jsonb_build_object(
          'status', 'awaiting_dispatch',
          'occurredAt', created_at,
          'actor', warehouse.authoritative_actor()
        ))
      else shipment_events
    end
  where id = (payload->>'order_id')::uuid
  returning * into v_order;

  return to_jsonb(v_order);
end;
$$;
revoke all on function warehouse.create_fulfillment_order(jsonb)
  from public, anon;
grant execute on function warehouse.create_fulfillment_order(jsonb)
  to authenticated, service_role;

create or replace function private.warehouse_advance_fulfillment_order_v3(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;
revoke all on function private.warehouse_advance_fulfillment_order_v3(jsonb)
  from public, anon, authenticated;
grant execute on function private.warehouse_advance_fulfillment_order_v3(jsonb)
  to service_role;

create or replace function warehouse.advance_fulfillment_order(payload jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.warehouse_advance_fulfillment_order_v3(payload) $$;
revoke all on function warehouse.advance_fulfillment_order(jsonb)
  from public, anon;
grant execute on function warehouse.advance_fulfillment_order(jsonb)
  to authenticated, service_role;
