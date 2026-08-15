-- Operations launch blockers: attributable custody separation and atomic counts.
-- Forward-only. This migration deliberately does not redefine stock-change
-- approval authority or the shared authority-convergence migration.

alter table warehouse.receipts
  add column if not exists received_by uuid
    references core.profiles(id) on delete restrict;

update warehouse.receipts receipt
   set received_by = profile.id
  from core.profiles profile
 where receipt.received_by is null
   and pg_catalog.lower(profile.email) = pg_catalog.lower(receipt.actor)
   and 1 = (
     select pg_catalog.count(*)
       from core.profiles candidate
      where pg_catalog.lower(candidate.email) = pg_catalog.lower(receipt.actor)
   );

create index if not exists receipts_received_by_fkey_idx
  on warehouse.receipts(received_by);

create or replace function private.stamp_receipt_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.received_by := auth.uid();
    new.actor := warehouse.authoritative_actor();
  end if;
  return new;
end;
$$;

drop trigger if exists warehouse_receipt_actor_stamp on warehouse.receipts;
create trigger warehouse_receipt_actor_stamp
before insert on warehouse.receipts
for each row execute function private.stamp_receipt_actor();

create or replace function private.enforce_independent_receipt_inspection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_received_by uuid;
  v_receipt_actor text;
  v_inspector_email text;
  v_is_final_inspection boolean := false;
begin
  v_is_final_inspection :=
    (tg_op = 'INSERT' and new.disposition <> 'pending')
    or (tg_op = 'UPDATE'
        and old.disposition = 'pending'
        and new.disposition <> 'pending');

  if current_setting('warehouse.defer_independent_receipt_inspection', true) = 'on' then
    return new;
  end if;

  if v_is_final_inspection and auth.uid() is not null then
    new.inspected_by := auth.uid();
    select profile.email
      into new.inspected_by_email
      from core.profiles profile
     where profile.id = auth.uid();
  end if;
  if v_is_final_inspection and new.source_type = 'receipt' then
    select receipt.received_by, receipt.actor
      into v_received_by, v_receipt_actor
      from warehouse.receipts receipt
     where receipt.id = new.source_id;

    select profile.email
      into v_inspector_email
      from core.profiles profile
     where profile.id = new.inspected_by;

    if (v_received_by is not null and v_received_by = new.inspected_by)
       or (v_received_by is null
           and v_inspector_email is not null
           and pg_catalog.lower(v_inspector_email) = pg_catalog.lower(v_receipt_actor)) then
      raise exception 'The receipt actor cannot inspect the same receipt';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists warehouse_independent_receipt_inspection
  on warehouse.quality_inspections;
create trigger warehouse_independent_receipt_inspection
before insert on warehouse.quality_inspections
for each row execute function private.enforce_independent_receipt_inspection();

drop trigger if exists warehouse_independent_receipt_inspection_update
  on warehouse.quality_inspections;
create trigger warehouse_independent_receipt_inspection_update
before update of disposition on warehouse.quality_inspections
for each row execute function private.enforce_independent_receipt_inspection();

create or replace function private.remove_provisional_quality_hold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.disposition = 'pending' then
    delete from warehouse.inventory_holds hold
     where hold.inspection_id = old.id
       and hold.status = 'active'
       and hold.reason = 'Awaiting independent quality inspection';
  end if;
  return old;
end;
$$;

drop trigger if exists warehouse_remove_provisional_quality_hold
  on warehouse.quality_inspections;
create trigger warehouse_remove_provisional_quality_hold
before delete on warehouse.quality_inspections
for each row execute function private.remove_provisional_quality_hold();

create or replace function private.protect_provisional_quality_hold()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.reason = 'Awaiting independent quality inspection'
     and old.status = 'active'
     and new.status <> 'active' then
    raise exception 'Pending independent inspection holds cannot be released directly';
  end if;
  return new;
end;
$$;

drop trigger if exists warehouse_protect_provisional_quality_hold
  on warehouse.inventory_holds;
create trigger warehouse_protect_provisional_quality_hold
before update of status on warehouse.inventory_holds
for each row execute function private.protect_provisional_quality_hold();

-- The existing clean-PO receiver posts the physical receipt and originally
-- auto-accepted its pending QC rows. Keep that transaction and replay contract,
-- then return the rows to a held, independently inspectable state before commit.
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

  if not exists (
    select 1
      from warehouse.command_log command
     where command.actor_id = auth.uid()
       and command.command_name = 'receive_procurement_po'
       and command.idempotency_key = payload->>'idempotency_key'
  ) then
    perform private.assert_goods_procurement_po(payload->>'po_id');
  end if;

  perform set_config('warehouse.defer_independent_receipt_inspection', 'on', true);
  v_response := private.warehouse_receive_procurement_po(payload);
  perform set_config('warehouse.defer_independent_receipt_inspection', 'off', true);
  v_receipt_id := v_response #>> '{receipt,id}';
  if nullif(v_receipt_id, '') is null then
    raise exception 'Warehouse receipt response is missing its identity';
  end if;

  update warehouse.quality_inspections inspection
     set disposition = 'pending',
         reason = 'Awaiting independent quality inspection'
   where inspection.source_type = 'receipt'
     and inspection.source_id = v_receipt_id
     and inspection.disposition = 'accepted';

  insert into warehouse.inventory_holds(
    inspection_id, product_id, location_id, bin_id, lot_id, serial_number,
    quantity, status, reason, evidence_urls, created_by
  )
  select inspection.id, inspection.product_id, inspection.location_id,
         inspection.bin_id, inspection.lot_id, inspection.serial_number,
         inspection.quantity, 'active',
         'Awaiting independent quality inspection',
         inspection.evidence_urls, auth.uid()
    from warehouse.quality_inspections inspection
   where inspection.source_type = 'receipt'
     and inspection.source_id = v_receipt_id
     and inspection.disposition = 'pending'
     and not exists (
       select 1 from warehouse.inventory_holds hold
        where hold.inspection_id = inspection.id and hold.status = 'active'
     );

  update warehouse.receipts
     set quality_status = 'pending'
   where id = v_receipt_id;

  v_response := jsonb_set(
    v_response, '{receipt,quality_status}', to_jsonb('pending'::text), true
  );
  update warehouse.command_log
     set response = v_response
   where actor_id = auth.uid()
     and command_name = 'receive_procurement_po'
     and idempotency_key = payload->>'idempotency_key';
  return v_response;
end;
$$;

create or replace function private.enforce_independent_exception_resolution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.created_by = auth.uid()
     and old.status in ('open', 'in_progress')
     and new.status in ('resolved', 'waived', 'cancelled') then
    raise exception 'The exception creator cannot resolve, waive, or cancel the same exception';
  end if;
  return new;
end;
$$;

drop trigger if exists warehouse_independent_exception_resolution
  on warehouse.exceptions;
create trigger warehouse_independent_exception_resolution
before update on warehouse.exceptions
for each row execute function private.enforce_independent_exception_resolution();

create or replace function warehouse.create_and_submit_cycle_count(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_count jsonb := coalesce(payload->'cycle_count', '{}'::jsonb);
  v_lines jsonb := coalesce(payload->'cycle_count'->'lines', '[]'::jsonb);
  v_evidence jsonb := coalesce(payload->'evidence_urls', '[]'::jsonb);
  v_count_id text;
  v_response jsonb;
begin
  v_started := private.begin_idempotent_command(
    'create_and_submit_cycle_count', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then
    return v_started->'response';
  end if;
  v_command_id := (v_started->>'command_id')::uuid;

  if auth.uid() is null then
    raise exception 'An attributable cycle-count actor is required';
  end if;
  if not core.has_live_cap('warehouse', 'cycle_count') then
    raise exception 'Not authorized: warehouse.cycle_count';
  end if;
  if jsonb_typeof(v_count) <> 'object' then
    raise exception 'Cycle count must be an object';
  end if;
  if nullif(pg_catalog.btrim(v_count->>'location_id'), '') is null then
    raise exception 'A cycle-count location is required';
  end if;
  if jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0 then
    raise exception 'A cycle count must contain at least one line';
  end if;
  if jsonb_typeof(v_evidence) <> 'array' then
    raise exception 'Evidence must be an array';
  end if;
  if jsonb_array_length(v_evidence) = 0 then
    raise exception 'Cycle-count evidence is required';
  end if;

  v_count_id := coalesce(
    nullif(pg_catalog.btrim(v_count->>'id'), ''),
    'cc-' || pg_catalog.replace(gen_random_uuid()::text, '-', '')
  );

  insert into warehouse.cycle_counts(
    id, location_id, bin_id, category, lines, status,
    requested_by, actor, created_at
  ) values (
    v_count_id,
    v_count->>'location_id',
    nullif(v_count->>'bin_id', ''),
    nullif(v_count->>'category', ''),
    v_lines,
    'draft',
    auth.uid(),
    warehouse.authoritative_actor(),
    now()
  );

  v_response := private.warehouse_submit_cycle_count(jsonb_build_object(
    'idempotency_key', 'atomic-' || v_command_id::text,
    'cycle_count_id', v_count_id,
    'reason', payload->>'reason',
    'evidence_urls', v_evidence
  ));

  return private.finish_idempotent_command(v_command_id, v_response);
end;
$$;

revoke all on function private.stamp_receipt_actor() from public, anon, authenticated;
revoke all on function private.enforce_independent_receipt_inspection() from public, anon, authenticated;
revoke all on function private.remove_provisional_quality_hold() from public, anon, authenticated;
revoke all on function private.protect_provisional_quality_hold() from public, anon, authenticated;
revoke all on function private.enforce_independent_exception_resolution() from public, anon, authenticated;
revoke all on function warehouse.receive_procurement_po(jsonb) from public, anon;
revoke all on function warehouse.create_and_submit_cycle_count(jsonb) from public, anon;
grant execute on function warehouse.receive_procurement_po(jsonb)
  to authenticated, service_role;
grant execute on function warehouse.create_and_submit_cycle_count(jsonb)
  to authenticated, service_role;
