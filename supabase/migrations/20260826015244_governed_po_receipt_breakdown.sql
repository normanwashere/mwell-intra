-- Accept line-level receiving outcomes without splitting one physical delivery
-- across independently committed commands. Existing scalar-quantity callers
-- continue through the established receipt implementation.

alter table warehouse.procurement_receipt_exception_decisions
  drop constraint if exists procurement_receipt_exception_decisions_receipt_id_key;
create index if not exists procurement_receipt_exception_decisions_receipt_idx
  on warehouse.procurement_receipt_exception_decisions(receipt_id, requested_at);

alter table warehouse.procurement_receipt_exception_lines
  add column if not exists outcome text;
alter table warehouse.procurement_receipt_exception_lines
  drop constraint if exists procurement_receipt_exception_lines_outcome_check;
alter table warehouse.procurement_receipt_exception_lines
  add constraint procurement_receipt_exception_lines_outcome_check
  check (outcome is null or outcome in ('damaged','unidentified','short','excess'));
drop index if exists warehouse.procurement_receipt_exception_one_active_line;
create unique index if not exists procurement_receipt_exception_one_active_legacy_line
  on warehouse.procurement_receipt_exception_lines(po_line_id)
  where active and outcome is null;
create unique index if not exists procurement_receipt_exception_one_active_outcome_line
  on warehouse.procurement_receipt_exception_lines(po_line_id, outcome)
  where active and outcome is not null;

create table if not exists warehouse.procurement_receipt_serial_claims (
  id uuid primary key default gen_random_uuid(),
  receipt_id text not null references warehouse.receipts(id) on delete restrict,
  decision_id uuid references warehouse.procurement_receipt_exception_decisions(id) on delete restrict,
  po_line_id text not null references procurement.purchase_order_lines(id) on delete restrict,
  product_id text references warehouse.products(id) on delete restrict,
  outcome text not null check (outcome in ('clean','damaged','unidentified','excess')),
  serial_number text not null,
  status text not null default 'pending'
    check (status in ('pending','held','posted','released')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  transitioned_by uuid references auth.users(id) on delete restrict,
  transitioned_at timestamptz,
  check ((outcome='clean' and decision_id is null) or
         (outcome<>'clean' and decision_id is not null))
);
create unique index if not exists procurement_receipt_serial_one_active_claim
  on warehouse.procurement_receipt_serial_claims(serial_number)
  where status in ('pending','held','posted');
create index if not exists procurement_receipt_serial_claim_decision_idx
  on warehouse.procurement_receipt_serial_claims(decision_id, status);
alter table warehouse.procurement_receipt_serial_claims enable row level security;
alter table warehouse.procurement_receipt_serial_claims force row level security;
revoke all on warehouse.procurement_receipt_serial_claims from public, anon, authenticated;
grant all on warehouse.procurement_receipt_serial_claims to service_role;

create or replace function private.warehouse_receive_procurement_po_breakdown(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_po record;
  v_line record;
  v_product record;
  v_receipt record;
  v_exception record;
  v_decision record;
  v_input jsonb;
  v_outcomes jsonb;
  v_outcome text;
  v_outcome_quantity integer;
  v_serials jsonb;
  v_all_serials jsonb := '[]'::jsonb;
  v_exception_serials jsonb;
  v_receipt_lines jsonb := '[]'::jsonb;
  v_facts jsonb := '[]'::jsonb;
  v_decisions jsonb := '[]'::jsonb;
  v_fact jsonb;
  v_evidence jsonb := coalesce(payload->'evidence_urls', '[]'::jsonb);
  v_reason text := nullif(pg_catalog.btrim(coalesce(payload->>'exception_reason', '')), '');
  v_expected integer;
  v_remaining integer;
  v_clean integer;
  v_damaged integer;
  v_unidentified integer;
  v_short integer;
  v_excess integer;
  v_physical integer;
  v_exception_physical integer;
  v_product_id text;
  v_has_product boolean;
  v_serialized boolean;
  v_has_exceptions boolean := false;
  v_requested_disposition text := 'short';
  v_supplier_id text;
  v_receipt_id text := 'rcpt-' || replace(gen_random_uuid()::text, '-', '');
  v_route_id uuid;
  v_route_requires_evidence boolean;
  v_serial text;
  v_movement_id text;
  v_inspection_id uuid;
  v_closed boolean;
  v_response jsonb;
begin
  if not core.has_cap('warehouse', 'receive_stock') then
    raise exception 'Not authorized: warehouse.receive_stock';
  end if;
  v_started := private.begin_idempotent_command(
    'receive_procurement_po', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then
    return v_started->'response';
  end if;
  v_command_id := (v_started->>'command_id')::uuid;

  perform private.assert_goods_procurement_po(payload->>'po_id');
  if jsonb_typeof(v_evidence) <> 'array' or jsonb_array_length(v_evidence) = 0 then
    raise exception 'Delivery evidence is required for a governed receipt breakdown';
  end if;
  if jsonb_typeof(payload->'lines') <> 'array'
     or jsonb_array_length(payload->'lines') = 0 then
    raise exception 'At least one procurement PO receipt breakdown is required';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(payload->'lines') item
    group by item->>'line_id'
    having count(*) > 1
  ) then
    raise exception 'A procurement PO line cannot appear twice in one receipt breakdown';
  end if;
  if not exists (
    select 1 from warehouse.locations location
    where location.id = payload->>'location_id' and location.type = 'warehouse'
  ) then
    raise exception 'Receiving destination must be a warehouse';
  end if;
  if nullif(payload->>'bin_id', '') is not null and not exists (
    select 1 from warehouse.storage_areas area
    where area.id = payload->>'bin_id'
      and area.location_id = payload->>'location_id'
      and area.active
  ) then
    raise exception 'Receiving staging bin is invalid or inactive';
  end if;

  select po.* into v_po
  from procurement.purchase_orders po
  where po.id::text = payload->>'po_id'
  for update;
  if not found then raise exception 'Procurement purchase order not found'; end if;
  if v_po.status <> 'issued' then
    raise exception 'Only issued procurement POs can be received';
  end if;

  -- Validate and normalize every line before any stock, receipt, or exception
  -- write. A later failure rolls the idempotency claim back with the statement.
  for v_input in select value from jsonb_array_elements(payload->'lines')
  loop
    select line.* into v_line
    from procurement.purchase_order_lines line
    where line.id::text = v_input->>'line_id'
      and line.purchase_order_id = v_po.id
    for update;
    if not found or v_line.receiving_status <> 'open' then
      raise exception 'Receipt breakdown must reference an open line on the locked PO';
    end if;
    if exists (
      select 1
      from warehouse.procurement_receipt_exception_lines active_claim
      where active_claim.po_line_id = v_line.id and active_claim.active
    ) then
      raise exception 'A governed receipt decision already reserves this procurement PO line';
    end if;
    v_remaining := v_line.quantity - v_line.received_quantity;
    begin
      v_expected := (v_input->>'expected_quantity')::integer;
      v_outcomes := v_input->'outcomes';
      v_clean := coalesce((v_outcomes #>> '{clean,quantity}')::integer, 0);
      v_damaged := coalesce((v_outcomes #>> '{damaged,quantity}')::integer, 0);
      v_unidentified := coalesce((v_outcomes #>> '{unidentified,quantity}')::integer, 0);
      v_short := coalesce((v_outcomes #>> '{short,quantity}')::integer, 0);
      v_excess := coalesce((v_outcomes #>> '{excess,quantity}')::integer, 0);
    exception when others then
      raise exception 'Receipt outcome quantities must be whole numbers';
    end;
    if jsonb_typeof(v_outcomes) <> 'object'
       or v_expected is null
       or least(v_clean, v_damaged, v_unidentified, v_short, v_excess) < 0 then
      raise exception 'Receipt outcome quantities must be non-negative whole numbers';
    end if;
    if v_expected <> v_remaining then
      raise exception 'Expected quantity drift: locked PO-line remaining quantity is %, caller supplied %',
        v_remaining, v_expected;
    end if;
    if v_clean + v_damaged + v_unidentified + v_short <> v_remaining then
      raise exception 'Clean, damaged, unidentified, and short outcomes must reconcile to the locked expected quantity';
    end if;
    v_physical := v_clean + v_damaged + v_unidentified + v_excess;
    v_exception_physical := v_damaged + v_unidentified + v_excess;
    if v_physical <= 0 and v_short <= 0 then
      raise exception 'A receipt breakdown must record a physical or short outcome';
    end if;

    v_product_id := nullif(v_input->>'product_id', '');
    select product.* into v_product
    from warehouse.products product
    where product.id = v_product_id
    for share;
    v_has_product := found;
    v_serialized := v_has_product and v_product.serialized;
    if v_line.warehouse_product_id is not null
       and (not v_has_product or v_line.warehouse_product_id <> v_product_id) then
      raise exception 'Receipt breakdown product does not match the PO-line mapping';
    end if;
    if v_clean + v_damaged + v_excess > 0 and not v_has_product then
      raise exception 'Identified physical outcomes require a Warehouse product mapping';
    end if;
    if v_has_product and v_line.warehouse_product_id is null then
      update procurement.purchase_order_lines
      set warehouse_product_id = v_product_id
      where id = v_line.id;
    end if;

    v_exception_serials := '[]'::jsonb;
    foreach v_outcome in array array['clean','damaged','unidentified','excess']
    loop
      v_serials := coalesce(v_outcomes->v_outcome->'serial_numbers', '[]'::jsonb);
      if jsonb_typeof(v_serials) <> 'array' then
        raise exception 'Receipt outcome serial numbers must be arrays';
      end if;
      if exists (
        select 1 from jsonb_array_elements_text(v_serials) scanned(serial)
        where nullif(pg_catalog.btrim(scanned.serial), '') is null
      ) then
        raise exception 'Receipt serial identities cannot be blank';
      end if;
      v_outcome_quantity := case v_outcome
        when 'clean' then v_clean
        when 'damaged' then v_damaged
        when 'unidentified' then v_unidentified
        else v_excess end;
      if v_serialized and jsonb_array_length(v_serials) <> v_outcome_quantity then
        raise exception 'Each serialized outcome serial count must match its physical quantity';
      end if;
      if not v_serialized and jsonb_array_length(v_serials) > 0 then
        raise exception 'Non-serialized receipt outcomes cannot include serial numbers';
      end if;
      v_all_serials := v_all_serials || v_serials;
      if v_outcome <> 'clean' then
        v_exception_serials := v_exception_serials || v_serials;
      end if;
    end loop;

    if v_damaged > 0 then
      v_has_exceptions := true;
      if v_requested_disposition not in ('unidentified','excess') then
        v_requested_disposition := 'damaged';
      end if;
    end if;
    if v_short > 0 then v_has_exceptions := true; end if;
    if v_excess > 0 then
      v_has_exceptions := true;
      if v_requested_disposition <> 'unidentified' then
        v_requested_disposition := 'excess';
      end if;
    end if;
    if v_unidentified > 0 then
      v_has_exceptions := true;
      v_requested_disposition := 'unidentified';
      if nullif(pg_catalog.btrim(coalesce(
        v_outcomes #>> '{unidentified,observed_description}', ''
      )), '') is null then
        raise exception 'Unidentified receipt outcomes require an observed description';
      end if;
    end if;

    v_receipt_lines := v_receipt_lines || jsonb_build_array(jsonb_build_object(
      'productId', case when v_unidentified > 0 then null else v_product_id end,
      'mappedProductId', v_product_id,
      'quantity', v_physical,
      'binId', nullif(payload->>'bin_id', ''),
      'serialNumbers',
        coalesce(v_outcomes->'clean'->'serial_numbers', '[]'::jsonb)
        || coalesce(v_outcomes->'damaged'->'serial_numbers', '[]'::jsonb)
        || coalesce(v_outcomes->'unidentified'->'serial_numbers', '[]'::jsonb)
        || coalesce(v_outcomes->'excess'->'serial_numbers', '[]'::jsonb),
      'procurementLineId', v_line.id::text,
      'rawDescription', v_line.description,
      'expectedQuantity', v_expected,
      'outcomes', v_outcomes
    ));
    if v_damaged + v_unidentified + v_short + v_excess > 0 then
      v_facts := v_facts || jsonb_build_array(jsonb_build_object(
        'po_line_id', v_line.id::text,
        'procurementLineId', v_line.id::text,
        'product_id', case when v_unidentified > 0 then null else v_product_id end,
        'productId', case when v_unidentified > 0 then null else v_product_id end,
        'mapped_product_id', v_product_id,
        'actual_quantity', v_exception_physical,
        'quantity', v_exception_physical,
        'expected_quantity', v_expected,
        'remaining_at_request', v_expected - v_clean,
        'ordered_quantity_at_request', v_line.quantity,
        'raw_description', coalesce(
          nullif(v_outcomes #>> '{unidentified,observed_description}', ''),
          v_line.description
        ),
        'observed_identifiers', case
          when jsonb_typeof(v_outcomes->'unidentified'->'observed_identifiers') = 'object'
            then v_outcomes->'unidentified'->'observed_identifiers'
          else jsonb_build_object(
            'operator_entry', coalesce(v_outcomes #>> '{unidentified,observed_identifiers}', '')
          ) end,
        'bin_id', nullif(payload->>'bin_id', ''),
        'serial_numbers', v_exception_serials,
        'outcomes', v_outcomes
      ));
    end if;
  end loop;

  if jsonb_array_length(v_all_serials) <> (
    select count(distinct scanned.serial)
    from jsonb_array_elements_text(v_all_serials) scanned(serial)
  ) then
    raise exception 'Duplicate serial number in receipt breakdown';
  end if;
  if exists (
    select 1
    from warehouse.inventory_units unit
    join jsonb_array_elements_text(v_all_serials) scanned(serial)
      on scanned.serial = unit.serial_number
  ) then
    raise exception 'Receipt breakdown includes a serial number that already exists';
  end if;
  if exists (
    select 1
    from warehouse.procurement_receipt_serial_claims claim
    join jsonb_array_elements_text(v_all_serials) scanned(serial)
      on scanned.serial = claim.serial_number
    where claim.status in ('pending','held','posted')
  ) then
    raise exception 'Receipt serial number is already claimed by another governed receipt';
  end if;
  if v_has_exceptions and v_reason is null then
    raise exception 'Exception reason is required for non-clean receipt outcomes';
  end if;

  select route.id, route.requires_evidence into v_route_id, v_route_requires_evidence
  from warehouse.operation_routes route
  join warehouse.operation_types operation on operation.id = route.operation_type_id
  where operation.code = 'receipt' and operation.active and route.active
    and 'vendor' = any(route.source_location_types)
    and 'warehouse' = any(route.destination_location_types)
  order by route.created_at, route.id
  limit 1;
  if v_route_id is null then raise exception 'No active vendor-to-warehouse receipt route'; end if;
  if v_route_requires_evidence and jsonb_array_length(v_evidence) = 0 then
    raise exception 'Delivery evidence is required by the active receipt route';
  end if;
  v_supplier_id := 'proc-' || v_po.core_vendor_id::text;
  insert into warehouse.suppliers(id, name, lead_time_days)
  values(v_supplier_id, coalesce(v_po.vendor_name, 'Procurement vendor'), 0)
  on conflict(id) do update set name = excluded.name;

  insert into warehouse.receipts(
    id, supplier_id, location_id, lines, evidence_urls, actor, created_at,
    operation_route_id, procurement_po_id, quality_status
  ) values(
    v_receipt_id, v_supplier_id, payload->>'location_id', v_receipt_lines,
    v_evidence, auth.uid()::text, now(), v_route_id, v_po.id::text, 'pending'
  ) returning * into v_receipt;

  -- Clean stock enters staging immediately, but remains unavailable behind a
  -- pending inspection and provisional hold until a different inspector acts.
  for v_input in select value from jsonb_array_elements(v_receipt_lines)
  loop
    v_clean := (v_input #>> '{outcomes,clean,quantity}')::integer;
    if v_clean <= 0 then continue; end if;
    v_product_id := v_input->>'mappedProductId';
    select product.* into v_product
    from warehouse.products product where product.id = v_product_id for share;
    v_serials := coalesce(v_input #> '{outcomes,clean,serial_numbers}', '[]'::jsonb);
    if v_product.serialized then
      for v_serial in select value from jsonb_array_elements_text(v_serials)
      loop
        begin
          insert into warehouse.procurement_receipt_serial_claims(
            receipt_id, po_line_id, product_id, outcome, serial_number,
            status, created_by
          ) values(
            v_receipt.id, v_input->>'procurementLineId', v_product.id,
            'clean', v_serial, 'pending', auth.uid()
          );
        exception when unique_violation then
          raise exception 'Receipt serial number is already claimed: %', v_serial;
        end;
        insert into warehouse.inventory_units(
          id, product_id, serial_number, location_id, bin_id, status
        ) values(
          'unit-' || replace(gen_random_uuid()::text, '-', ''),
          v_product.id, v_serial, payload->>'location_id',
          nullif(payload->>'bin_id', ''), 'in_stock'
        );
      end loop;
      update warehouse.procurement_receipt_serial_claims
         set status='posted', transitioned_by=auth.uid(), transitioned_at=now()
       where receipt_id=v_receipt.id
         and po_line_id=v_input->>'procurementLineId'
         and outcome='clean' and status='pending';
    else
      insert into warehouse.stock_levels(product_id, location_id, bin_id, lot_id, quantity)
      values(
        v_product.id, payload->>'location_id', nullif(payload->>'bin_id', ''),
        null, v_clean
      )
      on conflict(product_id, location_id, bin_id, lot_id) do update
        set quantity = warehouse.stock_levels.quantity + excluded.quantity;
    end if;
    v_movement_id := 'mv-' || replace(gen_random_uuid()::text, '-', '');
    insert into warehouse.movements(
      id, type, product_id, quantity, to_location_id, to_bin_id,
      reference, evidence_urls, actor, created_at
    ) values(
      v_movement_id, 'receipt', v_product.id, v_clean, payload->>'location_id',
      nullif(payload->>'bin_id', ''), v_receipt_id, v_evidence,
      auth.uid()::text, now()
    );
    update procurement.purchase_order_lines
    set received_quantity = received_quantity + v_clean
    where id::text = v_input->>'procurementLineId'
      and received_quantity + v_clean <= quantity;
    if not found then
      raise exception 'Concurrent receipt changed the locked ordered balance';
    end if;
    insert into warehouse.quality_inspections(
      source_type, source_id, product_id, location_id, bin_id, quantity,
      disposition, reason, evidence_urls, inspected_by, inspected_by_email,
      procurement_po_line_id
    ) values(
      'receipt', v_receipt.id, v_input->>'mappedProductId', v_receipt.location_id,
      nullif(payload->>'bin_id', ''), v_clean, 'pending',
      'Awaiting independent quality inspection', v_evidence,
      auth.uid(), coalesce(auth.jwt()->>'email', auth.uid()::text),
      v_input->>'procurementLineId'
    ) returning id into v_inspection_id;
    insert into warehouse.inventory_holds(
      inspection_id, product_id, location_id, bin_id, lot_id, serial_number,
      quantity, status, reason, evidence_urls, created_by
    ) values(
      v_inspection_id, v_product.id, v_receipt.location_id,
      nullif(payload->>'bin_id', ''), null, null, v_clean, 'active',
      'Awaiting independent quality inspection', v_evidence, auth.uid()
    );
  end loop;

  -- Every non-clean outcome owns a separate decision and active line claim.
  -- This keeps decision-time quantities and serial transitions independent.
  if v_has_exceptions then
    for v_input in select value from jsonb_array_elements(v_receipt_lines)
    loop
      v_outcomes := v_input->'outcomes';
      foreach v_outcome in array array['damaged','unidentified','short','excess']
      loop
        v_outcome_quantity := (v_outcomes #>> array[v_outcome,'quantity'])::integer;
        if v_outcome_quantity <= 0 then continue; end if;
        v_serials := case when v_outcome='short' then '[]'::jsonb
          else coalesce(v_outcomes->v_outcome->'serial_numbers','[]'::jsonb) end;
        v_fact := jsonb_build_object(
          'outcome', v_outcome,
          'po_line_id', v_input->>'procurementLineId',
          'poLineId', v_input->>'procurementLineId',
          'procurementLineId', v_input->>'procurementLineId',
          'product_id', case when v_outcome='unidentified' then null
            else v_input->>'mappedProductId' end,
          'productId', case when v_outcome='unidentified' then null
            else v_input->>'mappedProductId' end,
          'mapped_product_id', v_input->>'mappedProductId',
          'actual_quantity', case when v_outcome='short' then 0 else v_outcome_quantity end,
          'actualQuantity', case when v_outcome='short' then 0 else v_outcome_quantity end,
          'outcome_quantity', v_outcome_quantity,
          'expected_quantity', (v_input->>'expectedQuantity')::integer,
          'expectedQuantity', (v_input->>'expectedQuantity')::integer,
          'remaining_at_request',
            (v_input->>'expectedQuantity')::integer
            - (v_outcomes #>> '{clean,quantity}')::integer,
          'ordered_quantity_at_request', (v_input->>'expectedQuantity')::integer,
          'raw_description', coalesce(
            nullif(v_outcomes #>> '{unidentified,observed_description}', ''),
            v_input->>'rawDescription'
          ),
          'rawDescription', coalesce(
            nullif(v_outcomes #>> '{unidentified,observed_description}', ''),
            v_input->>'rawDescription'
          ),
          'observed_identifiers', case
            when jsonb_typeof(v_outcomes->'unidentified'->'observed_identifiers')='object'
              then v_outcomes->'unidentified'->'observed_identifiers'
            else jsonb_build_object('operator_entry',
              coalesce(v_outcomes #>> '{unidentified,observed_identifiers}', '')) end,
          'bin_id', nullif(payload->>'bin_id', ''),
          'serial_numbers', v_serials
        );
        insert into warehouse.exceptions(
          exception_type, severity, source_type, source_id, status,
          resolution, created_by
        ) values(
          'po_receipt', case when v_outcome in ('unidentified','excess')
            then 'P1' else 'P2' end,
          'receipt', v_receipt.id, 'open',
          'Receipt outcome awaits an independent Warehouse Supervisor.', auth.uid()
        ) returning * into v_exception;
        insert into warehouse.procurement_receipt_exception_decisions(
          receipt_id, purchase_order_id, exception_id, requested_disposition,
          request_reason, request_evidence_urls, facts, requested_by
        ) values(
          v_receipt.id, v_po.id::text, v_exception.id, v_outcome,
          v_reason, v_evidence, jsonb_build_array(v_fact), auth.uid()
        ) returning * into v_decision;
        insert into warehouse.procurement_receipt_exception_lines(
          decision_id, po_line_id, outcome
        ) values(v_decision.id, v_input->>'procurementLineId', v_outcome);
        v_decisions := v_decisions || jsonb_build_array(to_jsonb(v_decision));

        if v_outcome <> 'short' then
          for v_serial in select value from jsonb_array_elements_text(v_serials)
          loop
            begin
              insert into warehouse.procurement_receipt_serial_claims(
                receipt_id, decision_id, po_line_id, product_id, outcome,
                serial_number, status, created_by
              ) values(
                v_receipt.id, v_decision.id, v_input->>'procurementLineId',
                nullif(v_input->>'mappedProductId',''), v_outcome,
                v_serial, 'pending', auth.uid()
              );
            exception when unique_violation then
              raise exception 'Receipt serial number is already claimed: %', v_serial;
            end;
          end loop;
        end if;
        if v_outcome='excess' then
          insert into warehouse.procurement_receipt_excess_custody(
            decision_id, receipt_id, po_line_id, product_id,
            ordered_quantity, excess_quantity
          ) values(
            v_decision.id, v_receipt.id, v_input->>'procurementLineId',
            nullif(v_input->>'mappedProductId',''),
            (v_input->>'expectedQuantity')::integer, v_outcome_quantity
          );
        elsif v_outcome='unidentified' then
          insert into warehouse.unidentified_receipt_custody(
            decision_id, receipt_id, po_line_id, observed_description,
            observed_identifiers, quantity
          ) values(
            v_decision.id, v_receipt.id, v_input->>'procurementLineId',
            v_fact->>'raw_description', v_fact->'observed_identifiers',
            v_outcome_quantity
          );
        end if;
      end loop;
    end loop;
  end if;

  select not exists (
    select 1 from procurement.purchase_order_lines line
    where line.purchase_order_id = v_po.id
      and line.receiving_status = 'open'
      and line.received_quantity < line.quantity
  ) and not exists (
    select 1
    from warehouse.procurement_receipt_exception_lines claim
    join warehouse.procurement_receipt_exception_decisions decision
      on decision.id=claim.decision_id
    where decision.purchase_order_id=v_po.id and claim.active
  ) into v_closed;
  update procurement.purchase_orders
  set status = case when v_closed then 'closed' else 'issued' end,
      updated_at = now()
  where id = v_po.id
  returning * into v_po;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values(
    'warehouse', 'procurement_purchase_order', v_po.id::text,
    'receipt_breakdown_recorded', auth.uid(),
    jsonb_build_object(
      'warehouse_receipt_id', v_receipt.id,
      'decisions', v_decisions,
      'lines', v_receipt_lines
    )
  );
  v_response := jsonb_build_object(
    'receipt', to_jsonb(v_receipt),
    'purchase_order', to_jsonb(v_po),
    'decision', case when v_has_exceptions then to_jsonb(v_decision) else null end,
    'decisions', v_decisions
  );
  return private.finish_idempotent_command(v_command_id, v_response);
end;
$$;

create or replace function warehouse.receive_procurement_po(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response jsonb;
  v_receipt_id text;
begin
  if not core.has_cap('warehouse', 'receive_stock') then
    raise exception 'Not authorized: warehouse.receive_stock';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(payload->'lines', '[]'::jsonb)) line
    where line ? 'outcomes'
  ) then
    return private.warehouse_receive_procurement_po_breakdown(payload);
  end if;

  if exists (
    select 1 from warehouse.command_log command
    where command.actor_id = auth.uid()
      and command.command_name = 'receive_procurement_po'
      and command.idempotency_key = payload->>'idempotency_key'
  ) then
    return private.warehouse_receive_procurement_po(payload);
  end if;
  perform private.assert_goods_procurement_po(payload->>'po_id');
  perform set_config('warehouse.defer_independent_receipt_inspection', 'on', true);
  v_response := private.warehouse_receive_procurement_po(payload);
  perform set_config('warehouse.defer_independent_receipt_inspection', 'off', true);
  v_receipt_id := v_response #>> '{receipt,id}';
  if nullif(v_receipt_id, '') is null then
    -- A test or compatibility implementation may not expose a receipt row.
    return v_response;
  end if;
  update warehouse.quality_inspections inspection
     set disposition='pending', reason='Awaiting independent quality inspection'
   where inspection.source_type='receipt' and inspection.source_id=v_receipt_id
     and inspection.disposition='accepted';
  insert into warehouse.inventory_holds(
    inspection_id,product_id,location_id,bin_id,lot_id,serial_number,
    quantity,status,reason,evidence_urls,created_by
  )
  select inspection.id,inspection.product_id,inspection.location_id,
    inspection.bin_id,inspection.lot_id,inspection.serial_number,
    inspection.quantity,'active','Awaiting independent quality inspection',
    inspection.evidence_urls,auth.uid()
  from warehouse.quality_inspections inspection
  where inspection.source_type='receipt' and inspection.source_id=v_receipt_id
    and inspection.disposition='pending'
    and not exists (
      select 1 from warehouse.inventory_holds hold_record
      where hold_record.inspection_id=inspection.id and hold_record.status='active'
    );
  update warehouse.receipts set quality_status='pending' where id=v_receipt_id;
  v_response:=jsonb_set(v_response,'{receipt,quality_status}',to_jsonb('pending'::text),true);
  update warehouse.command_log set response=v_response
   where actor_id=auth.uid() and command_name='receive_procurement_po'
     and idempotency_key=payload->>'idempotency_key';
  return v_response;
end;
$$;

create or replace function private.warehouse_resolve_procurement_po_breakdown_outcome(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_decision record;
  v_claim record;
  v_receipt record;
  v_po record;
  v_line record;
  v_product record;
  v_inspection record;
  v_fact jsonb;
  v_outcome text;
  v_decision_outcome text := payload->>'decision';
  v_reason text := nullif(pg_catalog.btrim(coalesce(payload->>'reason','')), '');
  v_evidence jsonb := coalesce(payload->'evidence_urls','[]'::jsonb);
  v_product_id text;
  v_actual integer;
  v_remaining integer;
  v_serial text;
  v_response jsonb;
begin
  if not core.has_cap('warehouse','release_quality_hold')
     or not core.has_cap('warehouse','resolve_exceptions') then
    raise exception 'Not authorized: Warehouse Supervisor controlled receipt decision';
  end if;
  v_started := private.begin_idempotent_command(
    'resolve_procurement_po_exception', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;
  if v_decision_outcome not in ('accept','reject','quarantine','escalate') then
    raise exception 'Receipt decision must be accept, reject, quarantine, or escalate';
  end if;
  if v_reason is null then raise exception 'Decision reason is required'; end if;
  if jsonb_typeof(v_evidence)<>'array' or jsonb_array_length(v_evidence)=0 then
    raise exception 'Decision evidence is required';
  end if;
  select * into v_decision
  from warehouse.procurement_receipt_exception_decisions decision
  where decision.id=(payload->>'decision_id')::uuid
    and decision.status in ('pending','escalated')
  for update;
  if not found then raise exception 'Actionable receipt decision not found'; end if;
  if v_decision.requested_by=auth.uid() then
    raise exception 'The receiving Operator cannot approve their own exception, including through delegation';
  end if;
  v_fact := v_decision.facts->0;
  v_outcome := v_fact->>'outcome';
  if v_outcome not in ('damaged','unidentified','short','excess') then
    raise exception 'Receipt decision is not an outcome-specific breakdown decision';
  end if;
  select * into v_claim
  from warehouse.procurement_receipt_exception_lines claim
  where claim.decision_id=v_decision.id and claim.active
    and claim.outcome=v_outcome
  for update;
  if not found then raise exception 'The receipt outcome has no locked active PO-line claim'; end if;
  select * into v_receipt from warehouse.receipts
  where id=v_decision.receipt_id for update;
  select * into v_po from procurement.purchase_orders
  where id=v_decision.purchase_order_id for update;
  select * into v_line from procurement.purchase_order_lines
  where id=v_claim.po_line_id and purchase_order_id=v_po.id
    and receiving_status='open' for update;
  if not found then raise exception 'Receipt fact PO-line binding is invalid or closed'; end if;

  if v_decision_outcome='escalate' then
    update warehouse.procurement_receipt_exception_decisions
       set status='escalated', decision='escalate', decision_reason=v_reason,
           decision_evidence_urls=v_evidence, decided_by=auth.uid(), decided_at=now()
     where id=v_decision.id returning * into v_decision;
    update warehouse.exceptions set status='in_progress', resolution=v_reason,
      evidence_urls=v_evidence, owner_id=auth.uid(), updated_at=now()
     where id=v_decision.exception_id;
    v_response:=jsonb_build_object('decision',to_jsonb(v_decision),'receipt',to_jsonb(v_receipt));
    return private.finish_idempotent_command(v_command_id,v_response);
  end if;

  v_actual := (v_fact->>'actual_quantity')::integer;
  v_remaining := v_line.quantity-v_line.received_quantity;
  if v_remaining<0 then raise exception 'Locked PO-line accepted quantity exceeds ordered quantity'; end if;

  if v_outcome='short' then
    if v_decision_outcome='quarantine' then
      raise exception 'A shortage has no physical custody to quarantine';
    end if;
    update warehouse.procurement_receipt_exception_lines
       set active=false,released_at=now()
     where decision_id=v_decision.id and active;
  elsif v_outcome='excess' then
    if v_decision_outcome='accept' then
      raise exception 'Excess requires quarantine before its governed custody disposition';
    elsif v_decision_outcome='quarantine' then
      update warehouse.procurement_receipt_excess_custody
         set status='held'
       where decision_id=v_decision.id and status='pending';
      update warehouse.procurement_receipt_serial_claims
         set status='held',transitioned_by=auth.uid(),transitioned_at=now()
       where decision_id=v_decision.id and status='pending';
    else
      update warehouse.procurement_receipt_excess_custody
         set status='vendor_return', resolution_reason=v_reason,
             resolution_evidence_urls=v_evidence, resolved_by=auth.uid(),resolved_at=now()
       where decision_id=v_decision.id and status in ('pending','held');
      update warehouse.procurement_receipt_serial_claims
         set status='released',transitioned_by=auth.uid(),transitioned_at=now()
       where decision_id=v_decision.id and status in ('pending','held');
      update warehouse.procurement_receipt_exception_lines
         set active=false,released_at=now()
       where decision_id=v_decision.id and active;
    end if;
  elsif v_decision_outcome in ('accept','quarantine') then
    if v_actual<=0 or (v_decision_outcome='accept' and v_actual>v_remaining) then
      raise exception 'Receipt outcome exceeds the locked ordered balance';
    end if;
    v_product_id:=nullif(v_fact->>'product_id','');
    if v_product_id is null then
      select coalesce(
        (select identification->>'product_id'
         from jsonb_array_elements(coalesce(payload->'identifications','[]'::jsonb)) identification
         where identification->>'po_line_id'=v_line.id limit 1),
        nullif(payload->>'identified_product_id','')
      ) into v_product_id;
      if v_product_id is null then
        raise exception 'Governed product identification is required before final unidentified disposition';
      end if;
      update warehouse.unidentified_receipt_custody
         set identified_product_id=v_product_id,identified_by=auth.uid(),identified_at=now()
       where decision_id=v_decision.id and po_line_id=v_line.id;
      update procurement.purchase_order_lines
         set warehouse_product_id=v_product_id
       where id=v_line.id
         and (warehouse_product_id is null or warehouse_product_id=v_product_id)
       returning * into v_line;
      if not found then
        raise exception 'Governed product identification conflicts with the PO-line mapping';
      end if;
      update warehouse.procurement_receipt_serial_claims
         set product_id=v_product_id
       where decision_id=v_decision.id and product_id is null;
    end if;
    select * into v_product from warehouse.products
    where id=v_product_id for share;
    if not found or v_line.warehouse_product_id is distinct from v_product.id then
      raise exception 'Receipt outcome product binding is invalid';
    end if;
    if v_product.serialized then
      if (select count(*) from warehouse.procurement_receipt_serial_claims serial_claim
          where serial_claim.decision_id=v_decision.id
            and serial_claim.status='pending') <> v_actual then
        raise exception 'Serialized exception quantity requires exact reserved serial identities';
      end if;
      for v_serial in
        select serial_claim.serial_number
        from warehouse.procurement_receipt_serial_claims serial_claim
        where serial_claim.decision_id=v_decision.id and serial_claim.status='pending'
        order by serial_claim.serial_number
      loop
        insert into warehouse.inventory_units(
          id,product_id,serial_number,location_id,status,bin_id
        ) values(
          'unit-'||replace(gen_random_uuid()::text,'-',''),v_product.id,v_serial,
          v_receipt.location_id,'in_stock',nullif(v_fact->>'bin_id','')
        );
      end loop;
    else
      insert into warehouse.stock_levels(product_id,location_id,bin_id,lot_id,quantity)
      values(v_product.id,v_receipt.location_id,nullif(v_fact->>'bin_id',''),null,v_actual)
      on conflict(product_id,location_id,bin_id,lot_id) do update
        set quantity=warehouse.stock_levels.quantity+excluded.quantity;
    end if;
    insert into warehouse.movements(
      id,type,product_id,quantity,to_location_id,to_bin_id,reason,reference,
      evidence_urls,actor,created_at
    ) values(
      'mv-'||replace(gen_random_uuid()::text,'-',''),'receipt',v_product.id,v_actual,
      v_receipt.location_id,nullif(v_fact->>'bin_id',''),v_reason,v_receipt.id,
      v_evidence,coalesce(auth.jwt()->>'email',auth.uid()::text),now()
    );
    if v_decision_outcome='accept' then
      update procurement.purchase_order_lines
         set received_quantity=received_quantity+v_actual
       where id=v_line.id and received_quantity+v_actual<=quantity;
      if not found then raise exception 'Concurrent receipt changed the locked ordered balance'; end if;
    end if;
    insert into warehouse.quality_inspections(
      source_type,source_id,product_id,location_id,bin_id,quantity,disposition,
      reason,evidence_urls,inspected_by,inspected_by_email,procurement_po_line_id
    ) values(
      'receipt',v_receipt.id,v_product.id,v_receipt.location_id,
      nullif(v_fact->>'bin_id',''),v_actual,
      case when v_decision_outcome='accept' then 'accepted' else 'hold' end,
      v_reason,v_evidence,auth.uid(),coalesce(auth.jwt()->>'email',auth.uid()::text),v_line.id
    ) returning * into v_inspection;
    if v_decision_outcome='quarantine' then
      insert into warehouse.inventory_holds(
        inspection_id,product_id,location_id,bin_id,lot_id,serial_number,quantity,
        status,reason,evidence_urls,created_by
      ) values(
        v_inspection.id,v_inspection.product_id,v_inspection.location_id,
        v_inspection.bin_id,null,null,v_inspection.quantity,'active',v_reason,
        v_evidence,auth.uid()
      );
    end if;
    update warehouse.procurement_receipt_serial_claims
       set status=case when v_decision_outcome='accept' then 'posted' else 'held' end,
           transitioned_by=auth.uid(),transitioned_at=now()
     where decision_id=v_decision.id and status='pending';
    if v_decision_outcome='accept' then
      update warehouse.procurement_receipt_exception_lines
         set active=false,released_at=now()
       where decision_id=v_decision.id and active;
    end if;
  else
    update warehouse.procurement_receipt_serial_claims
       set status='released',transitioned_by=auth.uid(),transitioned_at=now()
     where decision_id=v_decision.id and status in ('pending','held');
    update warehouse.procurement_receipt_exception_lines
       set active=false,released_at=now()
     where decision_id=v_decision.id and active;
  end if;

  update warehouse.procurement_receipt_exception_decisions
     set status='decided',decision=v_decision_outcome,decision_reason=v_reason,
         decision_evidence_urls=v_evidence,decided_by=auth.uid(),decided_at=now()
   where id=v_decision.id returning * into v_decision;
  update warehouse.exceptions
     set status=case when v_decision_outcome='quarantine' then 'in_progress' else 'resolved' end,
         resolution=v_reason,evidence_urls=v_evidence,owner_id=auth.uid(),updated_at=now()
   where id=v_decision.exception_id;
  update warehouse.receipts receipt
     set quality_status=case
       when exists (select 1 from warehouse.procurement_receipt_exception_decisions pending
                    where pending.receipt_id=receipt.id and pending.status in ('pending','escalated'))
         or exists (select 1 from warehouse.quality_inspections quality
                    where quality.source_type='receipt' and quality.source_id=receipt.id
                      and quality.disposition='pending') then 'pending'
       when exists (select 1 from warehouse.quality_inspections quality
                    where quality.source_type='receipt' and quality.source_id=receipt.id
                      and quality.disposition='hold') then 'hold'
       else 'accepted' end
   where receipt.id=v_receipt.id returning * into v_receipt;
  update procurement.purchase_orders po
     set status=case when not exists (
       select 1 from procurement.purchase_order_lines line
       where line.purchase_order_id=po.id and line.receiving_status='open'
         and line.received_quantity<line.quantity
     ) and not exists (
       select 1 from warehouse.procurement_receipt_exception_lines active_claim
       join warehouse.procurement_receipt_exception_decisions active_decision
         on active_decision.id=active_claim.decision_id
       where active_claim.active and active_decision.purchase_order_id=po.id
     ) then 'closed' else 'issued' end, updated_at=now()
   where po.id=v_po.id returning * into v_po;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values('warehouse','receipt_exception_decision',v_decision.id,'decide',auth.uid(),
    jsonb_build_object('receipt_id',v_receipt.id,'outcome',v_outcome,
      'decision',v_decision_outcome));
  v_response:=jsonb_build_object('decision',to_jsonb(v_decision),
    'receipt',to_jsonb(v_receipt),'purchase_order',to_jsonb(v_po));
  return private.finish_idempotent_command(v_command_id,v_response);
end;
$$;

create or replace function private.warehouse_resolve_procurement_po_exception(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from warehouse.procurement_receipt_exception_decisions decision
    where decision.id=(payload->>'decision_id')::uuid
      and decision.facts->0 ? 'outcome'
  ) then
    return private.warehouse_resolve_procurement_po_breakdown_outcome(payload);
  end if;
  return private.warehouse_resolve_procurement_po_exception_v3(payload);
end;
$$;

create or replace function private.release_procurement_receipt_line_claim(
  p_receipt_id text,
  p_po_line_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_has_outcome_claim boolean;
  v_decision record;
  v_claim record;
begin
  select exists (
    select 1
    from warehouse.procurement_receipt_exception_lines claim
    join warehouse.procurement_receipt_exception_decisions decision
      on decision.id=claim.decision_id
    where decision.receipt_id=p_receipt_id and claim.po_line_id=p_po_line_id
      and claim.active and claim.outcome is not null
  ) into v_has_outcome_claim;
  if v_has_outcome_claim then
    for v_claim in
      select claim.*
      from warehouse.procurement_receipt_exception_lines claim
      join warehouse.procurement_receipt_exception_decisions decision
        on decision.id=claim.decision_id
      where decision.receipt_id=p_receipt_id and claim.po_line_id=p_po_line_id
        and claim.active and claim.outcome is not null and decision.status='decided'
      for update of claim
    loop
      if v_claim.outcome='excess' and not exists (
        select 1 from warehouse.procurement_receipt_excess_custody custody
        where custody.decision_id=v_claim.decision_id and custody.status in ('pending','held')
      ) then
        update warehouse.procurement_receipt_serial_claims serial_claim
           set status=case when exists (
             select 1 from warehouse.procurement_receipt_excess_custody custody
             where custody.decision_id=v_claim.decision_id
               and custody.status='accepted_amendment'
           ) then 'posted' else 'released' end,
               transitioned_by=auth.uid(),transitioned_at=now()
         where serial_claim.decision_id=v_claim.decision_id
           and serial_claim.status in ('pending','held');
        update warehouse.procurement_receipt_exception_lines
           set active=false,released_at=now()
         where decision_id=v_claim.decision_id and po_line_id=p_po_line_id and active;
      elsif v_claim.outcome in ('damaged','unidentified') and not exists (
        select 1 from warehouse.inventory_holds hold_record
        join warehouse.quality_inspections inspection on inspection.id=hold_record.inspection_id
        where inspection.source_type='receipt' and inspection.source_id=p_receipt_id
          and inspection.procurement_po_line_id=p_po_line_id and hold_record.status='active'
      ) then
        update warehouse.procurement_receipt_serial_claims serial_claim
           set status=case when exists (
             select 1 from warehouse.quality_inspections inspection
             where inspection.source_type='receipt' and inspection.source_id=p_receipt_id
               and inspection.procurement_po_line_id=p_po_line_id
               and inspection.disposition='accepted'
           ) then 'posted' else 'released' end,
               transitioned_by=auth.uid(),transitioned_at=now()
         where serial_claim.decision_id=v_claim.decision_id
           and serial_claim.status='held';
        update warehouse.procurement_receipt_exception_lines
           set active=false,released_at=now()
         where decision_id=v_claim.decision_id and po_line_id=p_po_line_id and active;
      elsif v_claim.outcome='short' then
        update warehouse.procurement_receipt_exception_lines
           set active=false,released_at=now()
         where decision_id=v_claim.decision_id and po_line_id=p_po_line_id and active;
      end if;
    end loop;
    return;
  end if;

  if exists (
    select 1 from warehouse.inventory_holds hold_record
    join warehouse.quality_inspections inspection on inspection.id=hold_record.inspection_id
    where inspection.source_type='receipt' and inspection.source_id=p_receipt_id
      and inspection.procurement_po_line_id=p_po_line_id and hold_record.status='active'
  ) or exists (
    select 1 from warehouse.procurement_receipt_excess_custody custody
    where custody.receipt_id=p_receipt_id and custody.po_line_id=p_po_line_id
      and custody.status in ('pending','held')
  ) then return; end if;
  select decision.* into v_decision
  from warehouse.procurement_receipt_exception_decisions decision
  join warehouse.procurement_receipt_exception_lines claim on claim.decision_id=decision.id
  where decision.receipt_id=p_receipt_id and claim.po_line_id=p_po_line_id
    and claim.active and decision.status='decided'
    and decision.decision in ('accept','reject','quarantine')
  for update of decision,claim;
  if not found then
    raise exception 'A locked active line claim with a terminal parent decision is required';
  end if;
  update warehouse.procurement_receipt_exception_lines claim
     set active=false,released_at=now()
   where claim.decision_id=v_decision.id and claim.po_line_id=p_po_line_id and claim.active;
  if not found then raise exception 'The active receipt line claim was not locked'; end if;
end;
$$;

alter function private.warehouse_receive_procurement_po_breakdown(jsonb) owner to postgres;
alter function private.warehouse_resolve_procurement_po_breakdown_outcome(jsonb) owner to postgres;
alter function private.warehouse_resolve_procurement_po_exception(jsonb) owner to postgres;
alter function private.release_procurement_receipt_line_claim(text,text) owner to postgres;
alter function warehouse.receive_procurement_po(jsonb) owner to postgres;

revoke all on function private.warehouse_receive_procurement_po_breakdown(jsonb)
  from public, anon, authenticated;
grant execute on function private.warehouse_receive_procurement_po_breakdown(jsonb)
  to service_role;
revoke all on function private.warehouse_resolve_procurement_po_breakdown_outcome(jsonb)
  from public, anon, authenticated;
grant execute on function private.warehouse_resolve_procurement_po_breakdown_outcome(jsonb)
  to service_role;
revoke all on function private.warehouse_resolve_procurement_po_exception(jsonb)
  from public, anon, authenticated;
grant execute on function private.warehouse_resolve_procurement_po_exception(jsonb)
  to service_role;
revoke all on function private.release_procurement_receipt_line_claim(text,text)
  from public, anon, authenticated;
grant execute on function private.release_procurement_receipt_line_claim(text,text)
  to service_role;
revoke all on function warehouse.receive_procurement_po(jsonb) from public, anon;
grant execute on function warehouse.receive_procurement_po(jsonb)
  to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
