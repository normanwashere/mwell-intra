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

revoke all on function private.warehouse_payload_hash(jsonb) from public, anon, authenticated;
revoke all on function private.begin_idempotent_command(text, text, jsonb) from public, anon, authenticated;
revoke all on function private.finish_idempotent_command(uuid, jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_update_operation_route(jsonb) from public, anon;
revoke all on function private.warehouse_inspect_quality(jsonb) from public, anon;
revoke all on function private.warehouse_release_quality_hold(jsonb) from public, anon;
revoke all on function private.warehouse_create_vendor_return(jsonb) from public, anon;

revoke all on function warehouse.update_operation_route(jsonb) from public, anon;
revoke all on function warehouse.inspect_quality(jsonb) from public, anon;
revoke all on function warehouse.release_quality_hold(jsonb) from public, anon;
revoke all on function warehouse.create_vendor_return(jsonb) from public, anon;

grant execute on function private.warehouse_update_operation_route(jsonb) to authenticated, service_role;
grant execute on function private.warehouse_inspect_quality(jsonb) to authenticated, service_role;
grant execute on function private.warehouse_release_quality_hold(jsonb) to authenticated, service_role;
grant execute on function private.warehouse_create_vendor_return(jsonb) to authenticated, service_role;
grant execute on function warehouse.update_operation_route(jsonb) to authenticated, service_role;
grant execute on function warehouse.inspect_quality(jsonb) to authenticated, service_role;
grant execute on function warehouse.release_quality_hold(jsonb) to authenticated, service_role;
grant execute on function warehouse.create_vendor_return(jsonb) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
