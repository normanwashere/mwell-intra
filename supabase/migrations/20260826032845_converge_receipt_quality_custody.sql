-- Forward convergence for the governed mixed-receipt migration already applied
-- to UAT. Pending QC rows and their provisional holds are durable workflow
-- records: Quality transitions them in place and never reposts received stock.

-- Keep this convergence independently applicable to UAT even when the adjacent
-- location-lifecycle migration has not been promoted yet.
alter table warehouse.locations
  add column if not exists active boolean not null default true;

-- Normalize serial identity at both custody boundaries before enforcing the
-- normalized indexes. A clean receipt legitimately owns one claim and one unit;
-- all later claims are rejected because the unit already exists.
update warehouse.procurement_receipt_serial_claims
   set serial_number = pg_catalog.upper(pg_catalog.btrim(serial_number));
update warehouse.inventory_units
   set serial_number = pg_catalog.upper(pg_catalog.btrim(serial_number));

do $migration$
begin
  if exists (
    select 1
      from warehouse.procurement_receipt_serial_claims
     where status in ('pending','held','posted')
     group by pg_catalog.upper(pg_catalog.btrim(serial_number))
    having count(*) > 1
  ) then
    raise exception 'Cannot converge duplicate normalized active receipt serial claims';
  end if;
  if exists (
    select 1
      from warehouse.inventory_units
     group by pg_catalog.upper(pg_catalog.btrim(serial_number))
    having count(*) > 1
  ) then
    raise exception 'Cannot converge duplicate normalized inventory-unit serials';
  end if;
end;
$migration$;

drop index if exists warehouse.procurement_receipt_serial_one_active_claim;
create unique index procurement_receipt_serial_one_active_claim
  on warehouse.procurement_receipt_serial_claims(
    pg_catalog.upper(pg_catalog.btrim(serial_number))
  ) where status in ('pending','held','posted');

create unique index if not exists warehouse_inventory_unit_serial_normalized_uq
  on warehouse.inventory_units(pg_catalog.upper(pg_catalog.btrim(serial_number)));

create or replace function private.normalize_receipt_serial_claim()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.serial_number := pg_catalog.upper(pg_catalog.btrim(new.serial_number));
  if new.serial_number = '' then
    raise exception 'Receipt serial number cannot be blank';
  end if;
  if new.status in ('pending','held','posted')
     and (tg_op = 'INSERT'
       or new.serial_number is distinct from old.serial_number
       or new.product_id is distinct from old.product_id)
     and exists (
       select 1 from warehouse.inventory_units unit
        where pg_catalog.upper(pg_catalog.btrim(unit.serial_number)) = new.serial_number
     ) then
    raise exception 'Receipt serial number already exists in inventory: %', new.serial_number;
  end if;
  return new;
end;
$$;

create or replace function private.normalize_inventory_unit_serial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.serial_number := pg_catalog.upper(pg_catalog.btrim(new.serial_number));
  if new.serial_number = '' then
    raise exception 'Inventory-unit serial number cannot be blank';
  end if;
  if tg_op = 'INSERT'
     or new.serial_number is distinct from old.serial_number
     or new.product_id is distinct from old.product_id then
    if exists (
      select 1
        from warehouse.procurement_receipt_serial_claims claim
       where pg_catalog.upper(pg_catalog.btrim(claim.serial_number)) = new.serial_number
         and claim.status in ('pending','held','posted')
         and claim.product_id is distinct from new.product_id
    ) then
      raise exception 'Inventory-unit serial number is reserved by governed receipt custody: %', new.serial_number;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists procurement_receipt_serial_normalize on warehouse.procurement_receipt_serial_claims;
create trigger procurement_receipt_serial_normalize
before insert or update of serial_number, product_id, status
on warehouse.procurement_receipt_serial_claims
for each row execute function private.normalize_receipt_serial_claim();

drop trigger if exists warehouse_inventory_unit_serial_normalize on warehouse.inventory_units;
create trigger warehouse_inventory_unit_serial_normalize
before insert or update of serial_number, product_id
on warehouse.inventory_units
for each row execute function private.normalize_inventory_unit_serial();

-- Convert aggregate serialized staging rows written by 20260826015244 into one
-- exact inspection and hold per clean serial. This block is intentionally
-- rerunnable: only null-serial provisional rows are candidates.
create or replace function private.converge_serialized_receipt_quality(p_receipt_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pending warehouse.quality_inspections;
  v_hold warehouse.inventory_holds;
  v_claim record;
  v_first boolean;
  v_claim_count integer;
  v_new_inspection_id uuid;
begin
  for v_pending in
    select inspection.*
      from warehouse.quality_inspections inspection
      join warehouse.products product on product.id = inspection.product_id
     where inspection.source_type = 'receipt'
       and inspection.source_id = p_receipt_id
       and inspection.disposition = 'pending'
       and inspection.reason = 'Awaiting independent quality inspection'
       and inspection.serial_number is null
       and product.serialized
     order by inspection.id
     for update of inspection
  loop
    select count(*)::integer into v_claim_count
      from warehouse.procurement_receipt_serial_claims claim
     where claim.receipt_id = v_pending.source_id
       and claim.po_line_id = v_pending.procurement_po_line_id
       and claim.product_id = v_pending.product_id
       and claim.outcome = 'clean'
       and claim.status = 'posted';
    if v_claim_count <> v_pending.quantity then
      raise exception 'Serialized QC convergence count mismatch for receipt %, PO line %',
        v_pending.source_id, v_pending.procurement_po_line_id;
    end if;

    select * into v_hold
      from warehouse.inventory_holds hold_record
     where hold_record.inspection_id = v_pending.id
       and hold_record.status = 'active'
       and hold_record.reason = 'Awaiting independent quality inspection'
     for update;
    if not found then
      raise exception 'Serialized QC convergence requires its provisional hold';
    end if;

    v_first := true;
    for v_claim in
      select claim.serial_number
        from warehouse.procurement_receipt_serial_claims claim
       where claim.receipt_id = v_pending.source_id
         and claim.po_line_id = v_pending.procurement_po_line_id
         and claim.product_id = v_pending.product_id
         and claim.outcome = 'clean'
         and claim.status = 'posted'
       order by claim.serial_number
    loop
      if v_first then
        update warehouse.quality_inspections
           set serial_number = v_claim.serial_number, quantity = 1
         where id = v_pending.id;
        update warehouse.inventory_holds
           set serial_number = v_claim.serial_number, quantity = 1
         where id = v_hold.id;
        v_first := false;
      else
        insert into warehouse.quality_inspections(
          source_type, source_id, product_id, lot_id, serial_number, location_id,
          bin_id, quantity, disposition, reason, evidence_urls, inspected_by,
          inspected_by_email, inspected_at, procurement_po_line_id
        ) values(
          v_pending.source_type, v_pending.source_id, v_pending.product_id,
          v_pending.lot_id, v_claim.serial_number, v_pending.location_id,
          v_pending.bin_id, 1, 'pending', v_pending.reason,
          v_pending.evidence_urls, v_pending.inspected_by,
          v_pending.inspected_by_email, v_pending.inspected_at,
          v_pending.procurement_po_line_id
        ) returning id into v_new_inspection_id;
        insert into warehouse.inventory_holds(
          inspection_id, product_id, location_id, bin_id, lot_id, serial_number,
          quantity, status, reason, evidence_urls, created_by, created_at
        ) values(
          v_new_inspection_id, v_hold.product_id, v_hold.location_id,
          v_hold.bin_id, v_hold.lot_id, v_claim.serial_number, 1, 'active',
          v_hold.reason, v_hold.evidence_urls, v_hold.created_by, v_hold.created_at
        );
      end if;
    end loop;
  end loop;
end;
$$;

do $migration$
declare
  v_receipt record;
begin
  for v_receipt in
    select distinct inspection.source_id
      from warehouse.quality_inspections inspection
      join warehouse.products product on product.id = inspection.product_id
     where inspection.source_type = 'receipt'
       and inspection.disposition = 'pending'
       and inspection.reason = 'Awaiting independent quality inspection'
       and inspection.serial_number is null
       and product.serialized
  loop
    perform private.converge_serialized_receipt_quality(v_receipt.source_id);
  end loop;
end;
$migration$;

-- Repair the already-installed private mutation boundaries in place. Every
-- boundary checks current certification before an idempotent replay can return.
do $migration$
declare
  v_definition text;
  v_repaired text;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'private.warehouse_receive_procurement_po_breakdown(jsonb)'::pg_catalog.regprocedure
  );
  v_repaired := pg_catalog.replace(
    v_definition,
    'if not core.has_cap(''warehouse'', ''receive_stock'') then',
    'if auth.role() <> ''service_role'' and not core.has_live_cap(''warehouse'', ''receive_stock'') then'
  );
  v_repaired := pg_catalog.replace(
    v_repaired,
    'where location.id = payload->>''location_id'' and location.type = ''warehouse''',
    'where location.id = payload->>''location_id'' and location.type = ''warehouse'' and location.active'
  );
  v_repaired := pg_catalog.replace(
    v_repaired,
    'Receiving destination must be a warehouse',
    'Receiving destination must be an active warehouse'
  );
  if v_repaired = v_definition
     or v_repaired not like '%core.has_live_cap%'
     or v_repaired not like '%location.active%' then
    raise exception 'Expected governed receipt convergence anchors were not found';
  end if;
  execute v_repaired;

  v_definition := pg_catalog.pg_get_functiondef(
    'private.warehouse_resolve_procurement_po_breakdown_outcome(jsonb)'::pg_catalog.regprocedure
  );
  v_repaired := pg_catalog.regexp_replace(
    v_definition,
    'if[[:space:]]+not core[.]has_cap[(]''warehouse'',''release_quality_hold''[)][[:space:]]+or not core[.]has_cap[(]''warehouse'',''resolve_exceptions''[)][[:space:]]+then',
    'if auth.role() <> ''service_role'' and (not core.has_live_cap(''warehouse'',''release_quality_hold'') or not core.has_live_cap(''warehouse'',''resolve_exceptions'')) then'
  );
  if v_repaired = v_definition or v_repaired not like '%core.has_live_cap%' then
    raise exception 'Expected controlled receipt resolver capability anchor was not found';
  end if;
  execute v_repaired;
end;
$migration$;

-- Public receipt contract: certification precedes replay; new and replayed
-- breakdown receipts both leave serialized staging in exact actionable rows.
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
  if auth.role() <> 'service_role'
     and not core.has_live_cap('warehouse', 'receive_stock') then
    raise exception 'Not authorized: warehouse.receive_stock';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements(
      coalesce(payload->'lines', '[]'::jsonb)
    ) line where line ? 'outcomes'
  ) then
    v_response := private.warehouse_receive_procurement_po_breakdown(payload);
    v_receipt_id := v_response #>> '{receipt,id}';
    if nullif(v_receipt_id, '') is not null then
      perform private.converge_serialized_receipt_quality(v_receipt_id);
    end if;
    return v_response;
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
  perform pg_catalog.set_config('warehouse.defer_independent_receipt_inspection', 'on', true);
  v_response := private.warehouse_receive_procurement_po(payload);
  perform pg_catalog.set_config('warehouse.defer_independent_receipt_inspection', 'off', true);
  v_receipt_id := v_response #>> '{receipt,id}';
  if nullif(v_receipt_id, '') is null then return v_response; end if;
  update warehouse.quality_inspections inspection
     set disposition = 'pending', reason = 'Awaiting independent quality inspection'
   where inspection.source_type = 'receipt'
     and inspection.source_id = v_receipt_id
     and inspection.disposition = 'accepted';
  insert into warehouse.inventory_holds(
    inspection_id, product_id, location_id, bin_id, lot_id, serial_number,
    quantity, status, reason, evidence_urls, created_by
  )
  select inspection.id, inspection.product_id, inspection.location_id,
    inspection.bin_id, inspection.lot_id, inspection.serial_number,
    inspection.quantity, 'active', 'Awaiting independent quality inspection',
    inspection.evidence_urls, auth.uid()
  from warehouse.quality_inspections inspection
  where inspection.source_type = 'receipt' and inspection.source_id = v_receipt_id
    and inspection.disposition = 'pending'
    and not exists (
      select 1 from warehouse.inventory_holds hold_record
       where hold_record.inspection_id = inspection.id and hold_record.status = 'active'
    );
  perform private.converge_serialized_receipt_quality(v_receipt_id);
  update warehouse.receipts set quality_status = 'pending' where id = v_receipt_id;
  v_response := pg_catalog.jsonb_set(
    v_response, '{receipt,quality_status}', pg_catalog.to_jsonb('pending'::text), true
  );
  update warehouse.command_log set response = v_response
   where actor_id = auth.uid() and command_name = 'receive_procurement_po'
     and idempotency_key = payload->>'idempotency_key';
  return v_response;
end;
$$;

-- Exact QC transition for governed procurement receipts. Other receipt/return
-- flows continue through the established v2 implementation.
create or replace function private.warehouse_inspect_quality_v3(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_receipt warehouse.receipts;
  v_inspection warehouse.quality_inspections;
  v_hold warehouse.inventory_holds;
  v_exception warehouse.exceptions;
  v_line_id text := nullif(payload->>'procurement_po_line_id', '');
  v_serial text := nullif(
    pg_catalog.upper(pg_catalog.btrim(coalesce(payload->>'serial_number', ''))), ''
  );
  v_quantity integer := coalesce((payload->>'quantity')::integer, 0);
  v_disposition text := payload->>'disposition';
  v_reason text := nullif(pg_catalog.btrim(coalesce(payload->>'reason','')), '');
  v_evidence jsonb := coalesce(payload->'evidence_urls', '[]'::jsonb);
  v_response jsonb;
begin
  if auth.role() <> 'service_role'
     and not core.has_live_cap('warehouse', 'inspect_quality') then
    raise exception 'Not authorized: warehouse.inspect_quality';
  end if;
  if payload->>'source_type' <> 'receipt' then
    return private.warehouse_inspect_quality_v2(payload);
  end if;
  select * into v_receipt from warehouse.receipts
   where id = payload->>'source_id' for update;
  if not found or v_receipt.procurement_po_id is null then
    return private.warehouse_inspect_quality_v2(payload);
  end if;
  v_started := private.begin_idempotent_command(
    'inspect_quality', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;
  if v_line_id is null then
    raise exception 'Procurement PO-line identity is required for receipt quality disposition';
  end if;
  if v_disposition not in ('accepted','damaged','hold','vendor_return','unavailable') then
    raise exception 'Invalid quality disposition';
  end if;
  if v_quantity <= 0 then raise exception 'Inspection quantity must be positive'; end if;
  if v_disposition <> 'accepted' and v_reason is null then
    raise exception 'A reason is required for non-accepted stock';
  end if;
  if pg_catalog.jsonb_typeof(v_evidence) <> 'array' then
    raise exception 'Evidence must be an array';
  end if;
  if v_receipt.received_by = auth.uid() then
    raise exception 'The receipt actor cannot inspect the same receipt';
  end if;

  select inspection.* into v_inspection
    from warehouse.quality_inspections inspection
   where inspection.source_type = 'receipt'
     and inspection.source_id = v_receipt.id
     and inspection.product_id = payload->>'product_id'
     and inspection.procurement_po_line_id = v_line_id
     and inspection.bin_id is not distinct from nullif(payload->>'bin_id','')
     and inspection.lot_id is not distinct from nullif(payload->>'lot_id','')
     and pg_catalog.upper(pg_catalog.btrim(inspection.serial_number))
       is not distinct from v_serial
     and inspection.disposition = 'pending'
     and inspection.reason = 'Awaiting independent quality inspection'
   for update;
  if not found then raise exception 'Actionable provisional receipt inspection not found'; end if;
  if v_inspection.quantity <> v_quantity then
    raise exception 'Inspection must resolve the exact provisional custody quantity';
  end if;

  select * into v_hold from warehouse.inventory_holds hold_record
   where hold_record.inspection_id = v_inspection.id
     and hold_record.status = 'active'
     and hold_record.reason = 'Awaiting independent quality inspection'
   for update;
  if not found then raise exception 'Actionable provisional receipt hold not found'; end if;

  update warehouse.quality_inspections
     set disposition = v_disposition,
         reason = case when v_disposition = 'accepted'
           then 'Accepted by independent quality inspection' else v_reason end,
         evidence_urls = v_evidence,
         inspected_by = auth.uid(),
         inspected_by_email = coalesce(auth.jwt()->>'email', auth.uid()::text),
         inspected_at = pg_catalog.now()
   where id = v_inspection.id returning * into v_inspection;

  if v_disposition = 'accepted' then
    update warehouse.inventory_holds
       set status = 'released', released_by = auth.uid(), released_at = pg_catalog.now(),
           release_reason = 'Accepted by independent quality inspection',
           release_evidence_urls = v_evidence
     where id = v_hold.id returning * into v_hold;
  else
    update warehouse.inventory_holds
       set reason = v_reason, evidence_urls = v_evidence
     where id = v_hold.id returning * into v_hold;
    insert into warehouse.exceptions(
      exception_type, severity, source_type, source_id, status,
      resolution, evidence_urls, created_by
    ) values(
      'quality', 'P2', 'quality_inspection', v_inspection.id::text, 'open',
      'Awaiting independent hold disposition', v_evidence, auth.uid()
    ) returning * into v_exception;
  end if;

  update warehouse.receipts
     set quality_status = case
       when exists (
         select 1 from warehouse.quality_inspections pending
          where pending.source_type = 'receipt' and pending.source_id = v_receipt.id
            and pending.disposition = 'pending'
       ) then 'pending'
       when exists (
         select 1 from warehouse.inventory_holds active_hold
         join warehouse.quality_inspections quality on quality.id = active_hold.inspection_id
          where quality.source_type = 'receipt' and quality.source_id = v_receipt.id
            and active_hold.status = 'active'
       ) then 'hold'
       else 'accepted' end
   where id = v_receipt.id;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values(
    'warehouse', 'quality_inspection', v_inspection.id, 'provisional_custody_resolved',
    auth.uid(), pg_catalog.jsonb_build_object(
      'source_id', v_receipt.id, 'procurement_po_line_id', v_line_id,
      'serial_number', v_serial, 'quantity', v_quantity,
      'disposition', v_disposition, 'hold_id', v_hold.id
    )
  );
  v_response := pg_catalog.jsonb_build_object(
    'inspection', pg_catalog.to_jsonb(v_inspection),
    'hold', pg_catalog.to_jsonb(v_hold),
    'exception', case when v_exception.id is null then null else pg_catalog.to_jsonb(v_exception) end
  );
  return private.finish_idempotent_command(v_command_id, v_response);
end;
$$;

create or replace function warehouse.inspect_quality(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role'
     and not core.has_live_cap('warehouse', 'inspect_quality') then
    raise exception 'Not authorized: warehouse.inspect_quality';
  end if;
  return private.warehouse_inspect_quality_v3(payload);
end;
$$;

-- Public resolver and vendor-rejection wrappers certify before delegation.
create or replace function warehouse.resolve_procurement_po_exception(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' and (
    not core.has_live_cap('warehouse','release_quality_hold')
    or not core.has_live_cap('warehouse','resolve_exceptions')
  ) then
    raise exception 'Not authorized: Warehouse Supervisor controlled receipt decision';
  end if;
  return private.warehouse_resolve_procurement_po_exception(payload);
end;
$$;

create or replace function warehouse.reject_quality_hold_to_vendor(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' and (
    not core.has_live_cap('warehouse','release_quality_hold')
    or not core.has_live_cap('warehouse','manage_returns')
  ) then
    raise exception 'Not authorized: controlled hold rejection requires Supervisor returns authority';
  end if;
  return private.warehouse_reject_quality_hold_to_vendor(payload);
end;
$$;

alter function private.normalize_receipt_serial_claim() owner to postgres;
alter function private.normalize_inventory_unit_serial() owner to postgres;
alter function private.converge_serialized_receipt_quality(text) owner to postgres;
alter function private.warehouse_inspect_quality_v3(jsonb) owner to postgres;
alter function warehouse.receive_procurement_po(jsonb) owner to postgres;
alter function warehouse.inspect_quality(jsonb) owner to postgres;
alter function warehouse.resolve_procurement_po_exception(jsonb) owner to postgres;
alter function warehouse.reject_quality_hold_to_vendor(jsonb) owner to postgres;

revoke all on function private.normalize_receipt_serial_claim() from public, anon, authenticated;
revoke all on function private.normalize_inventory_unit_serial() from public, anon, authenticated;
revoke all on function private.converge_serialized_receipt_quality(text) from public, anon, authenticated;
revoke all on function private.warehouse_inspect_quality_v3(jsonb) from public, anon, authenticated;
revoke all on function warehouse.receive_procurement_po(jsonb) from public, anon;
revoke all on function warehouse.inspect_quality(jsonb) from public, anon;
revoke all on function warehouse.resolve_procurement_po_exception(jsonb) from public, anon;
revoke all on function warehouse.reject_quality_hold_to_vendor(jsonb) from public, anon;

grant execute on function private.normalize_receipt_serial_claim() to service_role;
grant execute on function private.normalize_inventory_unit_serial() to service_role;
grant execute on function private.converge_serialized_receipt_quality(text) to service_role;
grant execute on function private.warehouse_inspect_quality_v3(jsonb) to service_role;
grant execute on function warehouse.receive_procurement_po(jsonb) to authenticated, service_role;
grant execute on function warehouse.inspect_quality(jsonb) to authenticated, service_role;
grant execute on function warehouse.resolve_procurement_po_exception(jsonb) to authenticated, service_role;
grant execute on function warehouse.reject_quality_hold_to_vendor(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
