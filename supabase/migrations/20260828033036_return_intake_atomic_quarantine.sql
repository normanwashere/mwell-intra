-- Returns intake owns its inventory writes; caller-supplied rows are forbidden.
create or replace function warehouse.record_return_v2(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_return warehouse.returns;
  v_product warehouse.products;
  v_unit warehouse.inventory_units;
  v_allocation warehouse.allocations;
  v_inspection_id uuid;
  v_line jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_source text := payload#>>'{return,source}';
  v_event text := nullif(payload#>>'{return,event_id}', '');
  v_evidence jsonb := coalesce(payload#>'{return,evidence_urls}', '[]'::jsonb);
  v_serial text;
  v_seen text[] := '{}';
  v_quantity integer;
  v_index integer := 0;
  v_actor text;
  v_lot text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not core.has_cap('warehouse', 'manage_returns') or
    (coalesce(auth.role(), '') <> 'service_role' and not core.has_live_cap('warehouse', 'manage_returns')) then
    raise exception 'Not authorized: warehouse.manage_returns';
  end if;
  if jsonb_typeof(payload) is distinct from 'object'
     or jsonb_typeof(payload->'return') is distinct from 'object' then
    raise exception 'Return intake must be an object';
  end if;
  if payload ?| array['unit_updates', 'stock_deltas', 'movements'] then
    raise exception 'Return inventory writes are server-owned';
  end if;
  if v_source is null or v_source not in ('customer', 'vendor', 'event') then
    raise exception 'Invalid return source';
  end if;
  if v_source = 'event' and v_event is null then raise exception 'A source event is required'; end if;
  if jsonb_typeof(payload#>'{return,lines}') is distinct from 'array' then
    raise exception 'Return lines must be an array';
  end if;
  if jsonb_array_length(payload#>'{return,lines}') not between 1 and 1000 then
    raise exception 'Return intake requires 1 to 1000 lines';
  end if;
  if jsonb_typeof(v_evidence) is distinct from 'array' then raise exception 'Evidence must be an array'; end if;
  if exists (select 1 from jsonb_array_elements(v_evidence) evidence
    where jsonb_typeof(evidence) <> 'string' or btrim(evidence#>>'{}') = '') then
    raise exception 'Evidence must contain nonempty strings';
  end if;
  -- Hash only semantic intent, excluding caller IDs, timestamps and actor labels.
  v_started := private.begin_idempotent_command('record_return_v2', payload->>'idempotency_key',
    jsonb_build_object('source', v_source, 'event_id', v_event,
      'allocation_id', nullif(payload->>'allocation_id', ''),
      'lines', payload#>'{return,lines}', 'evidence_urls', v_evidence));
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;
  v_actor := coalesce(nullif(auth.jwt()->>'email', ''), auth.uid()::text);
  if v_event is not null then
    perform 1 from warehouse.events where id = v_event for share;
    if not found then raise exception 'Return event not found'; end if;
  end if;
  perform private.lock_warehouse_products(array(
    select distinct line->>'productId' from jsonb_array_elements(payload#>'{return,lines}') line));
  if nullif(payload->>'allocation_id', '') is not null then
    select * into v_allocation from warehouse.allocations where id = payload->>'allocation_id' for update;
    if not found or v_allocation.status <> 'issued' or v_allocation.event_id is distinct from v_event then
      raise exception 'Return does not match an issued allocation';
    end if;
  end if;
  -- Lock destination metadata through the transaction so deactivation cannot race intake.
  perform 1 from warehouse.locations where id in (
    select line->>'locationId' from jsonb_array_elements(payload#>'{return,lines}') line
  ) order by id for share;
  perform 1 from warehouse.storage_areas where id in (
    select line->>'binId' from jsonb_array_elements(payload#>'{return,lines}') line
  ) order by id for share;
  for v_line in select * from jsonb_array_elements(payload#>'{return,lines}') loop
    if jsonb_typeof(v_line) is distinct from 'object'
       or jsonb_typeof(v_line->'quantity') is distinct from 'number' then
      raise exception 'Return quantity must be a positive whole number';
    end if;
    if (v_line->>'quantity')::numeric <> trunc((v_line->>'quantity')::numeric)
       or (v_line->>'quantity')::numeric not between 1 and 2147483647 then
      raise exception 'Return quantity must be a positive whole number';
    end if;
    v_quantity := (v_line->>'quantity')::numeric::integer;
    if coalesce(v_line->>'disposition', 'quarantine') <> 'quarantine' then
      raise exception 'Return intake is quarantine-first';
    end if;
    if jsonb_typeof(v_line->'reason') is distinct from 'string' or nullif(btrim(v_line->>'reason'), '') is null then
      raise exception 'A return reason is required';
    end if;
    select * into v_product from warehouse.products where id = v_line->>'productId' for share;
    if not found then raise exception 'Return product not found'; end if;
    if not exists (select 1 from warehouse.locations where id = v_line->>'locationId' and active and type <> 'vendor') then
      raise exception 'An active non-vendor quarantine location is required';
    end if;
    if nullif(v_line->>'binId', '') is not null and not exists (
      select 1 from warehouse.storage_areas where id = v_line->>'binId' and active and location_id = v_line->>'locationId'
    ) then raise exception 'Quarantine bin must be active and belong to its location'; end if;
    v_serial := nullif(upper(btrim(v_line->>'serialNumber')), '');
    if v_product.serialized then
      if v_serial is null or v_quantity <> 1 then raise exception 'Serialized returns require exactly one serial per line'; end if;
      if v_serial = any(v_seen) then raise exception 'Duplicate serial in return intake'; end if;
      v_seen := array_append(v_seen, v_serial);
      select * into v_unit from warehouse.inventory_units
       where serial_number = v_serial and product_id = v_product.id for update;
      if not found or v_unit.status <> 'issued' then raise exception 'Only an issued serial for this product can be returned'; end if;
      if v_event is not null and v_unit.event_id is distinct from v_event then raise exception 'Serial belongs to a different event'; end if;
      if exists (select 1 from warehouse.inventory_holds where status = 'active' and serial_number = v_serial) then
        raise exception 'Serial already has active quality custody';
      end if;
    elsif v_serial is not null then raise exception 'Bulk products cannot carry a serial number';
    end if;
    if v_allocation.id is not null and v_product.id <> v_allocation.product_id then
      raise exception 'Return product does not match the issued allocation';
    end if;
    v_lines := v_lines || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'productId', v_product.id, 'quantity', v_quantity, 'reason', btrim(v_line->>'reason'),
      'serialNumber', v_serial, 'locationId', v_line->>'locationId',
      'binId', nullif(v_line->>'binId', ''), 'disposition', 'quarantine')));
  end loop;
  if v_allocation.id is not null and (select sum((line->>'quantity')::integer) from jsonb_array_elements(v_lines) line) > v_allocation.quantity then
    raise exception 'Return quantity exceeds the issued allocation';
  end if;
  insert into warehouse.returns(id, source, event_id, lines, evidence_urls, actor, created_at)
  values ('ret-' || v_command_id, v_source, v_event, v_lines, v_evidence, v_actor, now()) returning * into v_return;
  for v_line in select * from jsonb_array_elements(v_lines) loop
    v_quantity := (v_line->>'quantity')::integer;
    v_serial := v_line->>'serialNumber';
    v_lot := null;
    if v_serial is not null then
      update warehouse.inventory_units set status = 'returned', assigned_to = null,
        location_id = v_line->>'locationId', bin_id = v_line->>'binId'
       where serial_number = v_serial and product_id = v_line->>'productId'
       returning lot_id into v_lot;
    else
      insert into warehouse.stock_levels(product_id, location_id, bin_id, lot_id, quantity)
      values(v_line->>'productId', v_line->>'locationId', v_line->>'binId', null, v_quantity)
      on conflict (product_id, location_id, bin_id, lot_id)
      do update set quantity = warehouse.stock_levels.quantity + excluded.quantity;
    end if;
    insert into warehouse.quality_inspections(source_type, source_id, product_id, location_id, bin_id,
      lot_id, serial_number, quantity, disposition, reason, evidence_urls, inspected_by, inspected_by_email)
    values('return', v_return.id, v_line->>'productId', v_line->>'locationId', v_line->>'binId',
      v_lot, v_serial, v_quantity, 'pending', 'Awaiting independent quality inspection', v_evidence, auth.uid(), v_actor)
    returning id into v_inspection_id;
    insert into warehouse.inventory_holds(inspection_id, product_id, location_id, bin_id, lot_id,
      serial_number, quantity, status, reason, evidence_urls, created_by)
    values(v_inspection_id, v_line->>'productId', v_line->>'locationId', v_line->>'binId', v_lot,
      v_serial, v_quantity, 'active', 'Awaiting independent quality inspection', v_evidence, auth.uid());
    insert into warehouse.movements(id, type, product_id, quantity, to_location_id, to_bin_id,
      lot_id, serial_number, event_id, reason, reference, evidence_urls, actor, created_at)
    values('mv-' || v_command_id || '-' || v_index, 'return', v_line->>'productId', v_quantity,
      v_line->>'locationId', v_line->>'binId', v_lot, v_serial, v_event,
      (v_line->>'reason') || ' (quarantine)', v_return.id, v_evidence, v_actor, now());
    v_index := v_index + 1;
  end loop;
  if v_allocation.id is not null and (
    (v_serial is not null and not exists (select 1 from warehouse.inventory_units
      where product_id = v_allocation.product_id and event_id = v_allocation.event_id and status = 'issued'))
    or (v_serial is null and (select sum((line->>'quantity')::integer) from jsonb_array_elements(v_lines) line) = v_allocation.quantity)
  ) then update warehouse.allocations set status = 'returned' where id = v_allocation.id; end if;
  return private.finish_idempotent_command(v_command_id, to_jsonb(v_return));
end;
$$;

revoke all on function warehouse.record_return_v2(jsonb) from public, anon;
grant execute on function warehouse.record_return_v2(jsonb) to authenticated, service_role;
-- The old intake RPC and its grants stay intact for already-open clients.

-- Resolve only the exact custody posted by the new Returns intake. Receipt and
-- legacy-return quality implementations remain unchanged.
create or replace function private.inspect_return_intake(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_started jsonb;
  v_return warehouse.returns;
  v_pending warehouse.quality_inspections;
  v_inspection warehouse.quality_inspections;
  v_hold warehouse.inventory_holds;
  v_exception warehouse.exceptions;
  v_quantity integer;
  v_remaining integer;
  v_take integer;
  v_serial text := nullif(payload->>'serial_number', '');
  v_bin text := nullif(payload->>'bin_id', '');
  v_reason text := nullif(btrim(payload->>'reason'), '');
  v_evidence jsonb := coalesce(payload->'evidence_urls', '[]'::jsonb);
begin
  if auth.uid() is null or not core.has_cap('warehouse', 'inspect_quality') or
    (coalesce(auth.role(), '') <> 'service_role' and not core.has_live_cap('warehouse', 'inspect_quality')) then
    raise exception 'Not authorized: warehouse.inspect_quality';
  end if;
  v_started := private.begin_idempotent_command('inspect_quality', payload->>'idempotency_key', payload);
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  if jsonb_typeof(payload->'quantity') is distinct from 'number'
     or (payload->>'quantity')::numeric <> trunc((payload->>'quantity')::numeric)
     or (payload->>'quantity')::numeric not between 1 and 2147483647 then
    raise exception 'Inspection quantity must be a positive whole number';
  end if;
  v_quantity := (payload->>'quantity')::numeric::integer;
  v_remaining := v_quantity;
  if coalesce(payload->>'disposition', '') not in ('accepted', 'damaged', 'hold', 'vendor_return', 'unavailable') then
    raise exception 'Invalid quality disposition';
  end if;
  if payload->>'disposition' <> 'accepted' and v_reason is null then raise exception 'A reason is required for non-accepted stock'; end if;
  if jsonb_typeof(v_evidence) is distinct from 'array' then raise exception 'Evidence must be an array'; end if;
  perform private.lock_warehouse_products(array[payload->>'product_id']);
  select * into v_return from warehouse.returns where id = payload->>'source_id' for update;
  if not found then raise exception 'Return not found'; end if;
  if exists (select 1 from warehouse.products where id = payload->>'product_id' and serialized)
     and (v_serial is null or v_quantity <> 1) then
    raise exception 'Serialized inspection requires one exact serial';
  end if;
  if v_quantity > (select coalesce(sum(quantity), 0) from warehouse.quality_inspections
    where source_type = 'return' and source_id = v_return.id and product_id = payload->>'product_id'
      and bin_id is not distinct from v_bin and serial_number is not distinct from v_serial
      and disposition = 'pending') then raise exception 'Inspection quantity exceeds pending return custody'; end if;
  for v_pending in select * from warehouse.quality_inspections
    where source_type = 'return' and source_id = v_return.id and product_id = payload->>'product_id'
      and bin_id is not distinct from v_bin and serial_number is not distinct from v_serial
      and disposition = 'pending' order by id for update
  loop
    exit when v_remaining = 0;
    select * into v_hold from warehouse.inventory_holds where inspection_id = v_pending.id
      and status = 'active' and reason = 'Awaiting independent quality inspection' for update;
    if not found or v_hold.quantity <> v_pending.quantity then raise exception 'Pending return hold is inconsistent'; end if;
    if nullif(payload->>'lot_id', '') is not null and v_pending.lot_id is distinct from payload->>'lot_id' then
      raise exception 'Return inspection lot does not match custody';
    end if;
    v_take := least(v_pending.quantity, v_remaining);
    if v_take = v_pending.quantity then
      -- Existing trigger removes only this provisional hold before the FK check.
      delete from warehouse.quality_inspections where id = v_pending.id;
    else
      update warehouse.inventory_holds set quantity = quantity - v_take where id = v_hold.id;
      update warehouse.quality_inspections set quantity = quantity - v_take where id = v_pending.id;
    end if;
    insert into warehouse.quality_inspections(source_type, source_id, product_id, location_id, bin_id,
      lot_id, serial_number, quantity, disposition, reason, evidence_urls, inspected_by, inspected_by_email)
    values('return', v_return.id, v_pending.product_id, v_pending.location_id, v_bin, v_pending.lot_id,
      v_serial, v_take, payload->>'disposition', v_reason, v_evidence, auth.uid(), coalesce(auth.jwt()->>'email', auth.uid()::text))
    returning * into v_inspection;
    v_hold := null;
    if payload->>'disposition' <> 'accepted' then
      insert into warehouse.inventory_holds(inspection_id, product_id, location_id, bin_id, lot_id,
        serial_number, quantity, status, reason, evidence_urls, created_by)
      values(v_inspection.id, v_pending.product_id, v_pending.location_id, v_bin, v_pending.lot_id,
        v_serial, v_take, 'active', v_reason, v_evidence, auth.uid()) returning * into v_hold;
      insert into warehouse.exceptions(exception_type, severity, source_type, source_id, status, due_at, created_by)
      values('quality', 'P2', 'quality_inspection', v_inspection.id::text, 'open', now() + interval '1 day', auth.uid())
      returning * into v_exception;
    end if;
    v_remaining := v_remaining - v_take;
  end loop;
  if v_remaining <> 0 then raise exception 'Pending return custody not found'; end if;
  return private.finish_idempotent_command((v_started->>'command_id')::uuid,
    jsonb_build_object('inspection', to_jsonb(v_inspection), 'hold', to_jsonb(v_hold), 'exception', to_jsonb(v_exception)));
end;
$$;
revoke all on function private.inspect_return_intake(jsonb) from public, anon, authenticated;

-- Guard against silently overwriting another agent's newer quality wrapper.
do $$
declare v_definition text := pg_get_functiondef('warehouse.inspect_quality(jsonb)'::regprocedure);
begin
  if v_definition not like '%return private.warehouse_inspect_quality_v3(payload);%' then
    raise exception 'Unexpected quality wrapper: review the latest definition before applying Returns routing';
  end if;
  execute replace(v_definition, 'return private.warehouse_inspect_quality_v3(payload);',
    'if payload->>''source_type'' = ''return'' and exists (
       select 1 from warehouse.command_log where command_name = ''record_return_v2''
         and response->>''id'' = payload->>''source_id''
     ) then return private.inspect_return_intake(payload); end if;
     return private.warehouse_inspect_quality_v3(payload);');
end;
$$;

notify pgrst, 'reload schema';
