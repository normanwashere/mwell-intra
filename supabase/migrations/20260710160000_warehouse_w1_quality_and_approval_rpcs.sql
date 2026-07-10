-- Warehouse W1 guarded command implementations live in an unexposed schema.
-- The exposed warehouse functions are SECURITY INVOKER wrappers only.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

alter table warehouse.quality_inspections
  add column if not exists bin_id text
  references warehouse.storage_areas(id) on delete set null;

alter table warehouse.inventory_holds
  add column if not exists bin_id text
  references warehouse.storage_areas(id) on delete set null;

create or replace function private.warehouse_payload_hash(payload jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_extension_schema text;
  v_hash text;
begin
  select n.nspname
    into v_extension_schema
    from pg_catalog.pg_extension e
    join pg_catalog.pg_namespace n on n.oid = e.extnamespace
   where e.extname = 'pgcrypto';

  if v_extension_schema is null then
    raise exception 'pgcrypto is required for Warehouse command idempotency';
  end if;

  execute pg_catalog.format(
    'select pg_catalog.encode(%I.digest(pg_catalog.convert_to($1::text, ''UTF8''), ''sha256''), ''hex'')',
    v_extension_schema
  ) into v_hash using payload;

  return v_hash;
end;
$$;

create or replace function private.begin_idempotent_command(
  p_command_name text,
  p_idempotency_key text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing warehouse.command_log;
  v_hash text;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{12,128}$' then
    raise exception 'A valid idempotency key is required';
  end if;

  v_hash := private.warehouse_payload_hash(p_payload);

  insert into warehouse.command_log(
    actor_id, command_name, idempotency_key, payload_hash
  ) values (
    auth.uid(), p_command_name, p_idempotency_key, v_hash
  )
  on conflict (actor_id, command_name, idempotency_key) do nothing
  returning id into v_id;

  if v_id is null then
    select *
      into v_existing
      from warehouse.command_log
     where actor_id = auth.uid()
       and command_name = p_command_name
       and idempotency_key = p_idempotency_key
     for update;

    if not found then
      raise exception 'Idempotent command could not be claimed';
    end if;
    if v_existing.payload_hash <> v_hash then
      raise exception 'Idempotency key was reused with a different payload';
    end if;
    if v_existing.response is null then
      raise exception 'The command is already in progress';
    end if;
    return jsonb_build_object(
      'command_id', v_existing.id,
      'replayed', true,
      'response', v_existing.response
    );
  end if;

  return jsonb_build_object('command_id', v_id, 'replayed', false);
end;
$$;

create or replace function private.finish_idempotent_command(
  p_command_id uuid,
  p_response jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update warehouse.command_log
     set response = p_response,
         completed_at = now()
   where id = p_command_id
     and actor_id = auth.uid()
     and response is null;

  if not found then
    raise exception 'Idempotent command was not found or was already completed';
  end if;
  return p_response;
end;
$$;

create or replace function private.warehouse_update_operation_route(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_route warehouse.operation_routes;
  v_next_route warehouse.operation_routes;
  v_patch jsonb := coalesce(payload->'patch', '{}'::jsonb);
  v_sources text[];
  v_destinations text[];
  v_response jsonb;
begin
  v_started := private.begin_idempotent_command(
    'update_operation_route', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;

  if not core.has_cap('warehouse', 'manage_operation_routes') then
    raise exception 'Not authorized: warehouse.manage_operation_routes';
  end if;

  select * into v_route
    from warehouse.operation_routes
   where id = (payload->>'route_id')::uuid
   for update;
  if not found then raise exception 'Operation route not found'; end if;

  v_sources := case when v_patch ? 'source_location_types'
    then array(select jsonb_array_elements_text(v_patch->'source_location_types'))
    else v_route.source_location_types end;
  v_destinations := case when v_patch ? 'destination_location_types'
    then array(select jsonb_array_elements_text(v_patch->'destination_location_types'))
    else v_route.destination_location_types end;

  if not (v_sources <@ array['warehouse', 'event_site', 'vendor']::text[])
     or not (v_destinations <@ array['warehouse', 'event_site', 'vendor']::text[]) then
    raise exception 'Invalid route location type';
  end if;
  if coalesce((v_patch->>'active')::boolean, v_route.active) = false
     and v_route.active
     and not exists (
       select 1 from warehouse.operation_routes other
       where other.operation_type_id = v_route.operation_type_id
         and other.id <> v_route.id
         and other.active
     ) then
    raise exception 'The last active route for an operation type cannot be disabled';
  end if;

  update warehouse.operation_routes
     set source_location_types = v_sources,
         destination_location_types = v_destinations,
         requires_evidence = coalesce((v_patch->>'requires_evidence')::boolean, requires_evidence),
         requires_approval = coalesce((v_patch->>'requires_approval')::boolean, requires_approval),
         requires_online = coalesce((v_patch->>'requires_online')::boolean, requires_online),
         active = coalesce((v_patch->>'active')::boolean, active),
         updated_at = now()
   where id = v_route.id
   returning * into v_next_route;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'warehouse', 'operation_route', v_next_route.id, 'updated', auth.uid(),
    jsonb_build_object(
      'before', to_jsonb(v_route),
      'after', to_jsonb(v_next_route)
    )
  );

  v_response := to_jsonb(v_next_route);
  return private.finish_idempotent_command(v_command_id, v_response);
end;
$$;

create or replace function private.warehouse_inspect_quality(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_source_type text := payload->>'source_type';
  v_source_id text := payload->>'source_id';
  v_product_id text := payload->>'product_id';
  v_serial text := nullif(payload->>'serial_number', '');
  v_lot_id text := nullif(payload->>'lot_id', '');
  v_requested_lot_id text := nullif(payload->>'lot_id', '');
  v_quantity integer := coalesce((payload->>'quantity')::integer, 0);
  v_disposition text := payload->>'disposition';
  v_reason text := nullif(pg_catalog.btrim(coalesce(payload->>'reason', '')), '');
  v_evidence jsonb := coalesce(payload->'evidence_urls', '[]'::jsonb);
  v_receipt warehouse.receipts;
  v_return warehouse.returns;
  v_location_id text;
  v_bin_id text := nullif(payload->>'bin_id', '');
  v_requested_bin_id text := nullif(payload->>'bin_id', '');
  v_unit_location_id text;
  v_unit_bin_id text;
  v_unit_lot_id text;
  v_bin_count integer := 0;
  v_source_quantity integer := 0;
  v_previously_inspected integer := 0;
  v_total_source integer := 0;
  v_total_inspected integer := 0;
  v_inspection warehouse.quality_inspections;
  v_hold warehouse.inventory_holds;
  v_exception warehouse.exceptions;
  v_response jsonb;
begin
  v_started := private.begin_idempotent_command(
    'inspect_quality', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;

  if not core.has_cap('warehouse', 'inspect_quality') then
    raise exception 'Not authorized: warehouse.inspect_quality';
  end if;
  if v_source_type not in ('receipt', 'return') then
    raise exception 'Invalid quality source';
  end if;
  if v_disposition not in ('accepted', 'damaged', 'hold', 'vendor_return', 'unavailable') then
    raise exception 'Invalid quality disposition';
  end if;
  if v_quantity <= 0 then raise exception 'Inspection quantity must be positive'; end if;
  if v_serial is not null and v_quantity <> 1 then
    raise exception 'A serialized inspection must contain exactly one unit';
  end if;
  if v_disposition <> 'accepted' and v_reason is null then
    raise exception 'A reason is required for non-accepted stock';
  end if;
  if jsonb_typeof(v_evidence) <> 'array' then raise exception 'Evidence must be an array'; end if;

  if v_source_type = 'receipt' then
    select * into v_receipt from warehouse.receipts
     where id = v_source_id for update;
    if not found then raise exception 'Receipt not found'; end if;
    v_location_id := v_receipt.location_id;
    if v_serial is null then
      select coalesce(sum((line->>'quantity')::integer), 0),
             count(distinct coalesce(nullif(line->>'binId', ''), '__general__')),
             max(nullif(line->>'binId', ''))
        into v_source_quantity, v_bin_count, v_bin_id
        from jsonb_array_elements(v_receipt.lines) line
       where line->>'productId' = v_product_id
         and (
           nullif(payload->>'bin_id', '') is null
           or nullif(line->>'binId', '') is not distinct from nullif(payload->>'bin_id', '')
         );
      if nullif(payload->>'bin_id', '') is null and v_bin_count > 1 then
        raise exception 'A bin is required when the product spans multiple receipt bins';
      end if;
    else
      select count(*), max(nullif(line->>'binId', ''))
        into v_source_quantity, v_bin_id
        from jsonb_array_elements(v_receipt.lines) line
        cross join lateral jsonb_array_elements_text(
          coalesce(line->'serialNumbers', '[]'::jsonb)
        ) serial
       where line->>'productId' = v_product_id
         and serial = v_serial
         and (
           nullif(payload->>'bin_id', '') is null
           or nullif(line->>'binId', '') is not distinct from nullif(payload->>'bin_id', '')
         );
    end if;
    select coalesce(sum((line->>'quantity')::integer), 0)
      into v_total_source
      from jsonb_array_elements(v_receipt.lines) line;
  else
    select * into v_return from warehouse.returns
     where id = v_source_id for update;
    if not found then raise exception 'Return not found'; end if;
    select coalesce(sum((line->>'quantity')::integer), 0),
           max(nullif(line->>'locationId', '')),
           max(nullif(line->>'binId', ''))
      into v_source_quantity, v_location_id, v_bin_id
      from jsonb_array_elements(v_return.lines) line
     where line->>'productId' = v_product_id
       and (v_serial is null or line->>'serialNumber' = v_serial)
       and (
         nullif(payload->>'bin_id', '') is null
         or nullif(line->>'binId', '') is not distinct from nullif(payload->>'bin_id', '')
       );
    select coalesce(sum((line->>'quantity')::integer), 0)
      into v_total_source
      from jsonb_array_elements(v_return.lines) line;
    if v_serial is not null and v_source_quantity > 0 then v_source_quantity := 1; end if;
    if v_location_id is null and v_serial is not null then
      select location_id, bin_id into v_location_id, v_bin_id
        from warehouse.inventory_units
       where product_id = v_product_id and serial_number = v_serial
       for update;
    end if;
  end if;

  if v_source_quantity = 0 then raise exception 'Product or serial is not part of the source record'; end if;
  if v_location_id is null then raise exception 'Inspection location cannot be resolved'; end if;

  if v_serial is not null then
    select location_id, bin_id, lot_id
      into v_unit_location_id, v_unit_bin_id, v_unit_lot_id
      from warehouse.inventory_units
     where product_id = v_product_id
       and serial_number = v_serial
       and location_id = v_location_id
       and status in ('in_stock', 'returned')
     for update;
    if not found then raise exception 'Serialized unit is not available at the source location'; end if;
    if v_requested_bin_id is not null and v_requested_bin_id is distinct from v_unit_bin_id then
      raise exception 'Serialized unit bin does not match the requested bin';
    end if;
    if v_requested_lot_id is not null and v_requested_lot_id is distinct from v_unit_lot_id then
      raise exception 'Serialized unit lot does not match the requested lot';
    end if;
    v_location_id := v_unit_location_id;
    v_bin_id := v_unit_bin_id;
    v_lot_id := v_unit_lot_id;
  elsif v_lot_id is not null and not exists (
    select 1
      from warehouse.stock_levels
     where product_id = v_product_id
       and location_id = v_location_id
       and bin_id is not distinct from v_bin_id
       and lot_id = v_lot_id
       and quantity >= v_quantity
  ) then
    raise exception 'Bulk lot is not available at the source location and bin';
  end if;

  select coalesce(sum(quantity), 0)
    into v_previously_inspected
    from warehouse.quality_inspections
   where source_type = v_source_type
     and source_id = v_source_id
     and product_id = v_product_id
     and bin_id is not distinct from v_bin_id
     and coalesce(serial_number, '') = coalesce(v_serial, '');
  if v_previously_inspected + v_quantity > v_source_quantity then
    raise exception 'Inspection quantity exceeds the remaining source quantity';
  end if;

  insert into warehouse.quality_inspections(
    source_type, source_id, product_id, lot_id, serial_number, location_id, bin_id,
    quantity, disposition, reason, evidence_urls, inspected_by,
    inspected_by_email
  ) values (
    v_source_type, v_source_id, v_product_id, v_lot_id, v_serial,
    v_location_id, v_bin_id, v_quantity, v_disposition, v_reason, v_evidence,
    auth.uid(), coalesce(auth.jwt()->>'email', '')
  ) returning * into v_inspection;

  if v_disposition <> 'accepted' then
    insert into warehouse.inventory_holds(
      inspection_id, product_id, location_id, bin_id, lot_id, serial_number,
      quantity, reason, evidence_urls, created_by
    ) values (
      v_inspection.id, v_product_id, v_location_id, v_bin_id, v_lot_id, v_serial,
      v_quantity, v_reason, v_evidence, auth.uid()
    ) returning * into v_hold;

    insert into warehouse.exceptions(
      exception_type, severity, source_type, source_id, status,
      due_at, created_by
    ) values (
      'quality', 'P2', 'quality_inspection', v_inspection.id::text,
      'open', now() + interval '1 day', auth.uid()
    ) returning * into v_exception;
  end if;

  if v_source_type = 'receipt' then
    select coalesce(sum(quantity), 0) into v_total_inspected
      from warehouse.quality_inspections
     where source_type = 'receipt' and source_id = v_source_id;
    update warehouse.receipts
       set quality_status = case
         when exists (
           select 1 from warehouse.inventory_holds h
           join warehouse.quality_inspections i on i.id = h.inspection_id
           where i.source_type = 'receipt' and i.source_id = v_source_id
             and h.status = 'active'
         ) then 'hold'
         when v_total_inspected >= v_total_source then 'accepted'
         else 'partial'
       end
     where id = v_source_id;
  end if;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'warehouse', 'quality_inspection', v_inspection.id, 'inspected', auth.uid(),
    jsonb_build_object(
      'source_type', v_source_type,
      'source_id', v_source_id,
      'product_id', v_product_id,
      'quantity', v_quantity,
      'disposition', v_disposition,
      'hold_id', v_hold.id,
      'exception_id', v_exception.id
    )
  );

  v_response := jsonb_build_object(
    'inspection', to_jsonb(v_inspection),
    'hold', case when v_hold.id is null then null else to_jsonb(v_hold) end,
    'exception', case when v_exception.id is null then null else to_jsonb(v_exception) end
  );
  return private.finish_idempotent_command(v_command_id, v_response);
end;
$$;

create or replace function private.warehouse_release_quality_hold(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_hold warehouse.inventory_holds;
  v_inspection warehouse.quality_inspections;
  v_total_source integer := 0;
  v_total_inspected integer := 0;
  v_reason text := nullif(pg_catalog.btrim(coalesce(payload->>'reason', '')), '');
  v_evidence jsonb := coalesce(payload->'evidence_urls', '[]'::jsonb);
  v_response jsonb;
begin
  v_started := private.begin_idempotent_command(
    'release_quality_hold', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;

  if not core.has_cap('warehouse', 'release_quality_hold') then
    raise exception 'Not authorized: warehouse.release_quality_hold';
  end if;
  if payload->>'target_disposition' <> 'accepted' then
    raise exception 'Damaged, unavailable, and vendor-return stock require their governed disposition workflow';
  end if;
  if v_reason is null then raise exception 'A release reason is required'; end if;
  if jsonb_typeof(v_evidence) <> 'array' then raise exception 'Evidence must be an array'; end if;
  if jsonb_array_length(v_evidence) = 0 then raise exception 'Release evidence is required'; end if;

  select * into v_hold
    from warehouse.inventory_holds
   where id = (payload->>'hold_id')::uuid
     and status = 'active'
   for update;
  if not found then raise exception 'Active hold not found'; end if;
  if v_hold.created_by = auth.uid() then
    raise exception 'The hold creator cannot release their own hold';
  end if;

  update warehouse.inventory_holds
     set status = 'released',
         released_by = auth.uid(),
         released_at = now(),
         release_reason = v_reason,
         release_evidence_urls = v_evidence
   where id = v_hold.id
   returning * into v_hold;

  update warehouse.quality_inspections
     set disposition = 'accepted', reason = v_reason
   where id = v_hold.inspection_id
   returning * into v_inspection;
  update warehouse.exceptions
     set status = 'resolved',
         resolution = v_reason,
         evidence_urls = v_evidence,
         updated_at = now()
   where source_type = 'quality_inspection'
     and source_id = v_hold.inspection_id::text
     and status in ('open', 'in_progress');

  if v_inspection.source_type = 'receipt' then
    select coalesce(sum((line->>'quantity')::integer), 0)
      into v_total_source
      from warehouse.receipts r
      cross join lateral jsonb_array_elements(r.lines) line
     where r.id = v_inspection.source_id;
    select coalesce(sum(quantity), 0)
      into v_total_inspected
      from warehouse.quality_inspections
     where source_type = 'receipt' and source_id = v_inspection.source_id;
    update warehouse.receipts
       set quality_status = case
         when exists (
           select 1 from warehouse.inventory_holds h
           join warehouse.quality_inspections i on i.id = h.inspection_id
           where i.source_type = 'receipt' and i.source_id = v_inspection.source_id
             and h.status = 'active'
         ) then 'hold'
         when v_total_inspected >= v_total_source then 'accepted'
         else 'partial'
       end
     where id = v_inspection.source_id;
  end if;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'warehouse', 'inventory_hold', v_hold.id, 'released', auth.uid(),
    jsonb_build_object('inspection_id', v_hold.inspection_id, 'reason', v_reason)
  );

  v_response := to_jsonb(v_hold);
  return private.finish_idempotent_command(v_command_id, v_response);
end;
$$;

create or replace function private.warehouse_create_vendor_return(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_hold warehouse.inventory_holds;
  v_inspection warehouse.quality_inspections;
  v_vendor_return warehouse.vendor_returns;
  v_movement_id text := 'mv-' || replace(gen_random_uuid()::text, '-', '');
  v_reason text := nullif(pg_catalog.btrim(coalesce(payload->>'reason', '')), '');
  v_reference text := nullif(pg_catalog.btrim(coalesce(payload->>'reference', '')), '');
  v_evidence jsonb := coalesce(payload->'evidence_urls', '[]'::jsonb);
  v_source_supplier_id text;
  v_total_source integer := 0;
  v_total_inspected integer := 0;
  v_response jsonb;
begin
  v_started := private.begin_idempotent_command(
    'create_vendor_return', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;

  if not core.has_cap('warehouse', 'release_quality_hold') then
    raise exception 'Not authorized: warehouse.release_quality_hold';
  end if;
  if v_reason is null or v_reference is null then
    raise exception 'Vendor return reason and reference are required';
  end if;
  if jsonb_typeof(v_evidence) <> 'array' then raise exception 'Evidence must be an array'; end if;

  select * into v_hold
    from warehouse.inventory_holds
   where id = (payload->>'hold_id')::uuid
     and status = 'active'
   for update;
  if not found then raise exception 'Active hold not found'; end if;
  if v_hold.created_by = auth.uid() then
    raise exception 'The hold creator cannot return their own hold to a vendor';
  end if;

  select * into v_inspection
    from warehouse.quality_inspections
   where id = v_hold.inspection_id
   for update;
  if v_inspection.disposition <> 'vendor_return' then
    raise exception 'The inspection is not marked for vendor return';
  end if;
  if v_inspection.source_type = 'receipt' then
    select supplier_id into v_source_supplier_id
      from warehouse.receipts
     where id = v_inspection.source_id;
    if v_source_supplier_id is distinct from payload->>'supplier_id' then
      raise exception 'Vendor return supplier must match the source receipt';
    end if;
  end if;
  if not exists (
    select 1 from warehouse.suppliers where id = payload->>'supplier_id'
  ) then
    raise exception 'Supplier not found';
  end if;

  if v_hold.serial_number is not null then
    update warehouse.inventory_units
       set status = 'vendor_return', assigned_to = null
     where product_id = v_hold.product_id
       and serial_number = v_hold.serial_number
       and location_id = v_hold.location_id
       and status in ('in_stock', 'returned');
    if not found then raise exception 'Held serialized unit is not available for vendor return'; end if;
  else
    update warehouse.stock_levels
       set quantity = quantity - v_hold.quantity
     where product_id = v_hold.product_id
       and location_id = v_hold.location_id
       and bin_id is not distinct from v_hold.bin_id
       and lot_id is not distinct from v_hold.lot_id
       and quantity >= v_hold.quantity;
    if not found then raise exception 'Held quantity is not available for vendor return'; end if;
  end if;

  insert into warehouse.vendor_returns(
    hold_id, supplier_id, source_receipt_id, source_return_id,
    product_id, lot_id, serial_number, quantity, reason, reference,
    status, evidence_urls, created_by
  ) values (
    v_hold.id, payload->>'supplier_id',
    case when v_inspection.source_type = 'receipt' then v_inspection.source_id end,
    case when v_inspection.source_type = 'return' then v_inspection.source_id end,
    v_hold.product_id, v_hold.lot_id, v_hold.serial_number, v_hold.quantity,
    v_reason, v_reference, 'ready', v_evidence, auth.uid()
  ) returning * into v_vendor_return;

  update warehouse.inventory_holds
     set status = 'vendor_return',
         released_by = auth.uid(),
         released_at = now(),
         release_reason = v_reason,
         release_evidence_urls = v_evidence
   where id = v_hold.id;

  insert into warehouse.movements(
    id, type, product_id, quantity, from_location_id, from_bin_id, lot_id,
    serial_number, reason, reference, evidence_urls, actor, created_at
  ) values (
    v_movement_id, 'vendor_return', v_hold.product_id, v_hold.quantity,
    v_hold.location_id, v_hold.bin_id, v_hold.lot_id, v_hold.serial_number, v_reason,
    v_vendor_return.id::text, v_evidence,
    coalesce(auth.jwt()->>'email', auth.uid()::text), now()
  );

  update warehouse.exceptions
     set status = 'resolved',
         resolution = 'Vendor return ' || v_reference || ' created',
         evidence_urls = v_evidence,
         updated_at = now()
   where source_type = 'quality_inspection'
     and source_id = v_hold.inspection_id::text
     and status in ('open', 'in_progress');

  if v_inspection.source_type = 'receipt' then
    select coalesce(sum((line->>'quantity')::integer), 0)
      into v_total_source
      from warehouse.receipts r
      cross join lateral jsonb_array_elements(r.lines) line
     where r.id = v_inspection.source_id;
    select coalesce(sum(quantity), 0)
      into v_total_inspected
      from warehouse.quality_inspections
     where source_type = 'receipt' and source_id = v_inspection.source_id;
    update warehouse.receipts
       set quality_status = case
         when exists (
           select 1 from warehouse.inventory_holds h
           join warehouse.quality_inspections i on i.id = h.inspection_id
           where i.source_type = 'receipt' and i.source_id = v_inspection.source_id
             and h.status = 'active'
         ) then 'hold'
         when v_total_inspected >= v_total_source then 'closed'
         else 'partial'
       end
     where id = v_inspection.source_id;
  end if;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'warehouse', 'vendor_return', v_vendor_return.id, 'created', auth.uid(),
    jsonb_build_object(
      'hold_id', v_hold.id,
      'supplier_id', v_vendor_return.supplier_id,
      'product_id', v_vendor_return.product_id,
      'quantity', v_vendor_return.quantity,
      'movement_id', v_movement_id
    )
  );

  v_response := to_jsonb(v_vendor_return);
  return private.finish_idempotent_command(v_command_id, v_response);
end;
$$;

create or replace function private.warehouse_submit_cycle_count(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_count warehouse.cycle_counts;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_product warehouse.products;
  v_request warehouse.stock_change_requests;
  v_exception warehouse.exceptions;
  v_product_id text;
  v_expected integer;
  v_counted integer;
  v_variance integer;
  v_serials jsonb;
  v_has_variance boolean := false;
  v_reason text := nullif(pg_catalog.btrim(coalesce(payload->>'reason', '')), '');
  v_evidence jsonb := coalesce(payload->'evidence_urls', '[]'::jsonb);
  v_response jsonb;
begin
  v_started := private.begin_idempotent_command(
    'submit_cycle_count', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;

  if not core.has_cap('warehouse', 'cycle_count') then
    raise exception 'Not authorized: warehouse.cycle_count';
  end if;
  if v_reason is null then raise exception 'A cycle-count reason is required'; end if;
  if jsonb_typeof(v_evidence) <> 'array' then raise exception 'Evidence must be an array'; end if;

  select * into v_count
    from warehouse.cycle_counts
   where id = payload->>'cycle_count_id'
     and status = 'draft'
   for update;
  if not found then raise exception 'Draft cycle count not found'; end if;
  if jsonb_typeof(v_count.lines) <> 'array' or jsonb_array_length(v_count.lines) = 0 then
    raise exception 'A cycle count must contain at least one line';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(v_count.lines) line
     group by line->>'productId'
    having count(*) > 1
  ) then
    raise exception 'A cycle count cannot contain duplicate product lines';
  end if;

  perform 1
    from warehouse.stock_levels
   where location_id = v_count.location_id
     and bin_id is not distinct from v_count.bin_id
   order by product_id, location_id, bin_id
   for update;
  perform 1
    from warehouse.inventory_units
   where location_id = v_count.location_id
     and bin_id is not distinct from v_count.bin_id
     and status in ('in_stock', 'returned')
   order by product_id, location_id, bin_id, id
   for update;

  for v_line in select value from jsonb_array_elements(v_count.lines)
  loop
    v_product_id := nullif(v_line->>'productId', '');
    select * into v_product from warehouse.products where id = v_product_id;
    if not found then raise exception 'Unknown product in cycle count: %', v_product_id; end if;

    if v_product.serialized then
      v_serials := coalesce(v_line->'serialNumbers', '[]'::jsonb);
      if jsonb_typeof(v_serials) <> 'array' then
        raise exception 'Serialized count scans must be an array';
      end if;
      if jsonb_array_length(v_serials) <> (
        select count(distinct serial_number)
          from jsonb_array_elements_text(v_serials) as scanned(serial_number)
      ) then
        raise exception 'Duplicate serial scan in cycle count';
      end if;
      if exists (
        select 1
          from jsonb_array_elements_text(v_serials) scanned(serial)
         where not exists (
           select 1 from warehouse.inventory_units unit
            where unit.product_id = v_product_id
              and unit.serial_number = scanned.serial
              and unit.location_id = v_count.location_id
              and unit.bin_id is not distinct from v_count.bin_id
              and unit.status in ('in_stock', 'returned')
         )
      ) then
        raise exception 'Unknown serial scan in cycle count';
      end if;
      select count(*) into v_expected
        from warehouse.inventory_units
       where product_id = v_product_id
         and location_id = v_count.location_id
         and bin_id is not distinct from v_count.bin_id
         and status in ('in_stock', 'returned');
      v_counted := jsonb_array_length(v_serials);
      if v_line ? 'counted' and (v_line->>'counted')::integer <> v_counted then
        raise exception 'Serialized counted quantity must equal the serial scan count';
      end if;
    else
      if not (v_line ? 'counted') or (v_line->>'counted')::integer < 0 then
        raise exception 'Bulk counted quantity must be zero or greater';
      end if;
      select coalesce(sum(quantity), 0) into v_expected
        from warehouse.stock_levels
       where product_id = v_product_id
         and location_id = v_count.location_id
         and bin_id is not distinct from v_count.bin_id;
      v_counted := (v_line->>'counted')::integer;
      v_serials := '[]'::jsonb;
    end if;

    v_variance := v_counted - v_expected;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'productId', v_product_id,
      'expected', v_expected,
      'counted', v_counted,
      'serialNumbers', v_serials
    ));

    if v_variance <> 0 then
      v_has_variance := true;
      insert into warehouse.stock_change_requests(
        source_type, source_id, product_id, location_id, bin_id,
        quantity_delta, unit_cost, reason, evidence_urls, requested_by
      ) values (
        'cycle_count', v_count.id, v_product_id, v_count.location_id, v_count.bin_id,
        v_variance, v_product.unit_cost, v_reason, v_evidence, auth.uid()
      ) returning * into v_request;

      insert into core.approvals(
        entity_type, entity_id, step, approver_role, sla_due_at
      ) values (
        'warehouse_stock_change', v_request.id, 1, 'logistics_supervisor', now() + interval '1 day'
      );
      if v_request.financial_impact > 10000 then
        insert into core.approvals(
          entity_type, entity_id, step, approver_role, sla_due_at
        ) values (
          'warehouse_stock_change', v_request.id, 2, 'finance', now() + interval '2 days'
        );
      end if;

      insert into warehouse.exceptions(
        exception_type, severity, source_type, source_id, status,
        due_at, created_by
      ) values (
        'count_variance',
        case when v_request.financial_impact > 10000 then 'P1' else 'P2' end,
        'stock_change_request', v_request.id::text, 'open',
        now() + interval '1 day', auth.uid()
      ) returning * into v_exception;
    end if;
  end loop;

  update warehouse.cycle_counts
     set lines = v_lines,
         status = case when v_has_variance then 'pending_approval' else 'approved' end,
         requested_by = auth.uid(),
         submitted_at = now()
   where id = v_count.id
   returning * into v_count;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'warehouse', 'cycle_count', v_count.id, 'submitted', auth.uid(),
    jsonb_build_object(
      'status', v_count.status,
      'line_count', jsonb_array_length(v_lines),
      'has_variance', v_has_variance
    )
  );

  v_response := jsonb_build_object(
    'cycle_count', to_jsonb(v_count),
    'requests', coalesce((
      select jsonb_agg(to_jsonb(request_row) order by requested_at, id)
        from warehouse.stock_change_requests request_row
       where source_type = 'cycle_count' and source_id = v_count.id
    ), '[]'::jsonb)
  );
  return private.finish_idempotent_command(v_command_id, v_response);
end;
$$;

create or replace function private.warehouse_decide_stock_change(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_request warehouse.stock_change_requests;
  v_step core.approvals;
  v_count warehouse.cycle_counts;
  v_product warehouse.products;
  v_line jsonb;
  v_decision text := payload->>'decision';
  v_note text := nullif(pg_catalog.btrim(coalesce(payload->>'note', '')), '');
  v_movement_id text := 'mv-' || replace(gen_random_uuid()::text, '-', '');
  v_updated integer := 0;
  v_response jsonb;
begin
  v_started := private.begin_idempotent_command(
    'decide_stock_change', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;

  if not core.has_cap('warehouse', 'approve_stock_adjustment') then
    raise exception 'Not authorized: warehouse.approve_stock_adjustment';
  end if;
  if v_decision not in ('approved', 'rejected') then
    raise exception 'Invalid stock-change decision';
  end if;
  if v_decision = 'rejected' and v_note is null then
    raise exception 'A rejection note is required';
  end if;

  select * into v_request
    from warehouse.stock_change_requests
   where id = (payload->>'request_id')::uuid
     and status in ('pending_supervisor', 'pending_finance')
   for update;
  if not found then raise exception 'Pending stock-change request not found'; end if;
  if v_request.requested_by = auth.uid() then
    raise exception 'The requester cannot approve their own stock change';
  end if;

  select * into v_step
    from core.approvals
   where entity_type = 'warehouse_stock_change'
     and entity_id = v_request.id
     and decision = 'pending'
   order by step
   limit 1
   for update;
  if not found then raise exception 'Pending approval step not found'; end if;
  if (v_request.status = 'pending_supervisor' and v_step.approver_role <> 'logistics_supervisor')
     or (v_request.status = 'pending_finance' and v_step.approver_role <> 'finance') then
    raise exception 'Approval state and current step are inconsistent';
  end if;
  if not exists (
    select 1 from core.user_roles
     where user_id = auth.uid()
       and module = 'warehouse'
       and role = v_step.approver_role
  ) then
    raise exception 'The current approval tier requires role %', v_step.approver_role;
  end if;

  update core.approvals
     set decision = v_decision,
         decided_by = auth.uid(),
         decided_at = now(),
         note = v_note
   where id = v_step.id;

  if v_decision = 'rejected' then
    update core.approvals
       set decision = 'rejected',
           decided_by = auth.uid(),
           decided_at = now(),
           note = 'Cancelled after an earlier approval step was rejected'
     where entity_type = 'warehouse_stock_change'
       and entity_id = v_request.id
       and decision = 'pending';
    update warehouse.stock_change_requests
       set status = 'rejected', decided_at = now()
     where id = v_request.id
     returning * into v_request;
    if v_request.source_type = 'cycle_count' then
      update warehouse.cycle_counts set status = 'rejected' where id = v_request.source_id;
    end if;
    update warehouse.exceptions
       set status = 'in_progress',
           resolution = v_note,
           owner_id = auth.uid(),
           updated_at = now()
     where source_type = 'stock_change_request'
       and source_id = v_request.id::text
       and status = 'open';
  elsif exists (
    select 1 from core.approvals
     where entity_type = 'warehouse_stock_change'
       and entity_id = v_request.id
       and decision = 'pending'
  ) then
    update warehouse.stock_change_requests
       set status = 'pending_finance'
     where id = v_request.id
     returning * into v_request;
  else
    select * into v_product from warehouse.products where id = v_request.product_id;
    if not found then raise exception 'Stock-change product not found'; end if;

    if v_product.serialized then
      if v_request.quantity_delta > 0 then
        raise exception 'Serialized cycle counts cannot add unknown units';
      end if;
      select * into v_count
        from warehouse.cycle_counts
       where id = v_request.source_id
       for update;
      select value into v_line
        from jsonb_array_elements(v_count.lines)
       where value->>'productId' = v_request.product_id;
      with missing_units as (
        select id
          from warehouse.inventory_units
         where product_id = v_request.product_id
           and location_id = v_request.location_id
           and bin_id is not distinct from v_request.bin_id
           and status in ('in_stock', 'returned')
           and not (serial_number = any (
             array(select jsonb_array_elements_text(coalesce(v_line->'serialNumbers', '[]'::jsonb)))
           ))
         order by id
         limit abs(v_request.quantity_delta)
         for update
      )
      update warehouse.inventory_units
         set status = 'lost', assigned_to = null, event_id = null
       where id in (select id from missing_units);
      get diagnostics v_updated = row_count;
      if v_updated <> abs(v_request.quantity_delta) then
        raise exception 'Serialized variance no longer matches locked inventory';
      end if;
    else
      update warehouse.stock_levels
         set quantity = quantity + v_request.quantity_delta
       where product_id = v_request.product_id
         and location_id = v_request.location_id
         and bin_id is not distinct from v_request.bin_id
         and lot_id is null
         and quantity + v_request.quantity_delta >= 0;
      if not found and v_request.quantity_delta > 0 then
        insert into warehouse.stock_levels(product_id, location_id, bin_id, lot_id, quantity)
        values (
          v_request.product_id, v_request.location_id, v_request.bin_id,
          null, v_request.quantity_delta
        );
      elsif not found then
        raise exception 'Stock variance would make inventory negative';
      end if;
    end if;

    insert into warehouse.movements(
      id, type, product_id, quantity, to_location_id, to_bin_id,
      reason, reference, evidence_urls, actor, created_at
    ) values (
      v_movement_id,
      case when v_request.source_type = 'cycle_count' then 'cycle_count' else 'adjustment' end,
      v_request.product_id, v_request.quantity_delta,
      v_request.location_id, v_request.bin_id, v_request.reason,
      v_request.id::text, v_request.evidence_urls,
      coalesce(auth.jwt()->>'email', auth.uid()::text), now()
    );

    update warehouse.stock_change_requests
       set status = 'approved', decided_at = now()
     where id = v_request.id
     returning * into v_request;
    update warehouse.exceptions
       set status = 'resolved',
           resolution = coalesce(v_note, 'Approved stock change posted'),
           owner_id = auth.uid(),
           updated_at = now()
     where source_type = 'stock_change_request'
       and source_id = v_request.id::text
       and status in ('open', 'in_progress');
    if v_request.source_type = 'cycle_count' and not exists (
      select 1 from warehouse.stock_change_requests sibling
       where sibling.source_type = 'cycle_count'
         and sibling.source_id = v_request.source_id
         and sibling.status <> 'approved'
    ) then
      update warehouse.cycle_counts set status = 'approved' where id = v_request.source_id;
    end if;
  end if;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'warehouse', 'stock_change_request', v_request.id, v_decision, auth.uid(),
    jsonb_build_object(
      'step', v_step.step,
      'approver_role', v_step.approver_role,
      'status', v_request.status,
      'note', v_note,
      'movement_id', case when v_request.status = 'approved' then v_movement_id end
    )
  );

  v_response := to_jsonb(v_request);
  return private.finish_idempotent_command(v_command_id, v_response);
end;
$$;

create or replace function private.warehouse_resolve_exception(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_exception warehouse.exceptions;
  v_next warehouse.exceptions;
  v_action text := payload->>'action';
  v_resolution text := nullif(pg_catalog.btrim(coalesce(payload->>'resolution', '')), '');
  v_evidence jsonb := coalesce(payload->'evidence_urls', '[]'::jsonb);
  v_owner uuid := nullif(payload->>'owner_id', '')::uuid;
  v_response jsonb;
begin
  v_started := private.begin_idempotent_command(
    'resolve_exception', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;

  if not core.has_cap('warehouse', 'resolve_exceptions') then
    raise exception 'Not authorized: warehouse.resolve_exceptions';
  end if;
  if v_action not in ('assign', 'begin', 'resolve', 'waive', 'cancel') then
    raise exception 'Invalid exception action';
  end if;
  if jsonb_typeof(v_evidence) <> 'array' then raise exception 'Evidence must be an array'; end if;

  select * into v_exception
    from warehouse.exceptions
   where id = (payload->>'exception_id')::uuid
     and status in ('open', 'in_progress')
   for update;
  if not found then raise exception 'Active exception not found'; end if;
  if v_owner is not null and not exists (
    select 1 from core.user_roles
     where user_id = v_owner and module = 'warehouse'
  ) then
    raise exception 'Exception owner must have a Warehouse role';
  end if;

  if v_action = 'assign' then
    if v_owner is null then raise exception 'An exception owner is required'; end if;
    update warehouse.exceptions
       set owner_id = v_owner, updated_at = now()
     where id = v_exception.id returning * into v_next;
  elsif v_action = 'begin' then
    if v_exception.status <> 'open' then raise exception 'Only open exceptions can begin'; end if;
    update warehouse.exceptions
       set status = 'in_progress', owner_id = coalesce(v_owner, auth.uid()), updated_at = now()
     where id = v_exception.id returning * into v_next;
  elsif v_action = 'resolve' then
    if v_resolution is null then raise exception 'Resolution text is required'; end if;
    update warehouse.exceptions
       set status = 'resolved', resolution = v_resolution,
           evidence_urls = v_evidence, owner_id = coalesce(owner_id, auth.uid()), updated_at = now()
     where id = v_exception.id returning * into v_next;
  elsif v_action = 'waive' then
    if v_exception.severity = 'P1' then raise exception 'P1 exceptions cannot be waived'; end if;
    if not exists (
      select 1 from core.user_roles
       where user_id = auth.uid()
         and module = 'warehouse'
         and role in ('logistics_supervisor', 'warehouse_admin')
    ) then
      raise exception 'Only a Warehouse Supervisor may waive an exception';
    end if;
    if v_resolution is null or jsonb_array_length(v_evidence) = 0 then
      raise exception 'Waiver reason and evidence are required';
    end if;
    update warehouse.exceptions
       set status = 'waived', resolution = v_resolution, evidence_urls = v_evidence,
           waived_by = auth.uid(), waived_at = now(), owner_id = coalesce(owner_id, auth.uid()),
           updated_at = now()
     where id = v_exception.id returning * into v_next;
  else
    if v_resolution is null then raise exception 'Cancellation reason is required'; end if;
    update warehouse.exceptions
       set status = 'cancelled', resolution = v_resolution, evidence_urls = v_evidence,
           owner_id = coalesce(owner_id, auth.uid()), updated_at = now()
     where id = v_exception.id returning * into v_next;
  end if;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values (
    'warehouse', 'exception', v_exception.id, v_action, auth.uid(),
    jsonb_build_object('before', to_jsonb(v_exception), 'after', to_jsonb(v_next))
  );

  v_response := to_jsonb(v_next);
  return private.finish_idempotent_command(v_command_id, v_response);
end;
$$;

-- Exposed RPCs remain invoker wrappers; privileged bodies stay in `private`.
create or replace function warehouse.update_operation_route(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.warehouse_update_operation_route(payload) $$;

create or replace function warehouse.inspect_quality(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.warehouse_inspect_quality(payload) $$;

create or replace function warehouse.release_quality_hold(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.warehouse_release_quality_hold(payload) $$;

create or replace function warehouse.create_vendor_return(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.warehouse_create_vendor_return(payload) $$;

create or replace function warehouse.submit_cycle_count(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.warehouse_submit_cycle_count(payload) $$;

create or replace function warehouse.decide_stock_change(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.warehouse_decide_stock_change(payload) $$;

create or replace function warehouse.resolve_exception(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.warehouse_resolve_exception(payload) $$;

revoke all on function private.warehouse_payload_hash(jsonb) from public, anon, authenticated;
revoke all on function private.begin_idempotent_command(text, text, jsonb) from public, anon, authenticated;
revoke all on function private.finish_idempotent_command(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_update_operation_route(jsonb) from public, anon;
revoke all on function private.warehouse_inspect_quality(jsonb) from public, anon;
revoke all on function private.warehouse_release_quality_hold(jsonb) from public, anon;
revoke all on function private.warehouse_create_vendor_return(jsonb) from public, anon;
revoke all on function private.warehouse_submit_cycle_count(jsonb) from public, anon;
revoke all on function private.warehouse_decide_stock_change(jsonb) from public, anon;
revoke all on function private.warehouse_resolve_exception(jsonb) from public, anon;

revoke all on function warehouse.update_operation_route(jsonb) from public, anon;
revoke all on function warehouse.inspect_quality(jsonb) from public, anon;
revoke all on function warehouse.release_quality_hold(jsonb) from public, anon;
revoke all on function warehouse.create_vendor_return(jsonb) from public, anon;
revoke all on function warehouse.submit_cycle_count(jsonb) from public, anon;
revoke all on function warehouse.decide_stock_change(jsonb) from public, anon;
revoke all on function warehouse.resolve_exception(jsonb) from public, anon;

grant execute on function private.warehouse_update_operation_route(jsonb) to authenticated, service_role;
grant execute on function private.warehouse_inspect_quality(jsonb) to authenticated, service_role;
grant execute on function private.warehouse_release_quality_hold(jsonb) to authenticated, service_role;
grant execute on function private.warehouse_create_vendor_return(jsonb) to authenticated, service_role;
grant execute on function private.warehouse_submit_cycle_count(jsonb) to authenticated, service_role;
grant execute on function private.warehouse_decide_stock_change(jsonb) to authenticated, service_role;
grant execute on function private.warehouse_resolve_exception(jsonb) to authenticated, service_role;
grant execute on function warehouse.update_operation_route(jsonb) to authenticated, service_role;
grant execute on function warehouse.inspect_quality(jsonb) to authenticated, service_role;
grant execute on function warehouse.release_quality_hold(jsonb) to authenticated, service_role;
grant execute on function warehouse.create_vendor_return(jsonb) to authenticated, service_role;
grant execute on function warehouse.submit_cycle_count(jsonb) to authenticated, service_role;
grant execute on function warehouse.decide_stock_change(jsonb) to authenticated, service_role;
grant execute on function warehouse.resolve_exception(jsonb) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
