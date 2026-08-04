-- Complete the operational handoffs that sit after physical Warehouse work.
-- This migration keeps the existing role model and adds governed outcomes for
-- courier delivery, customer closure, event reconciliation, inventory control,
-- replenishment, Finance close, and vendor lifecycle review.

alter table warehouse.fulfillment_orders
  add column if not exists shipment_status text,
  add column if not exists dispatched_at timestamptz,
  add column if not exists last_tracking_at timestamptz,
  add column if not exists delivery_failure_reason text,
  add column if not exists failed_delivery_at timestamptz,
  add column if not exists proof_of_delivery_reference text,
  add column if not exists proof_of_delivery_evidence_url text,
  add column if not exists delivered_at timestamptz;

update warehouse.fulfillment_orders
set shipment_status = case
  when delivery_method <> 'shipment' then 'not_applicable'
  when status = 'completed' then 'delivered'
  when status = 'released' then 'dispatched'
  else 'awaiting_dispatch'
end
where shipment_status is null;

alter table warehouse.fulfillment_orders
  alter column shipment_status set default 'awaiting_dispatch',
  alter column shipment_status set not null,
  drop constraint if exists warehouse_fulfillment_shipment_status_check;
alter table warehouse.fulfillment_orders
  add constraint warehouse_fulfillment_shipment_status_check check (
    shipment_status in (
      'not_applicable', 'awaiting_dispatch', 'dispatched', 'in_transit',
      'delivery_failed', 'delivered', 'returned_to_sender'
    )
  );
create index if not exists warehouse_fulfillment_shipment_queue_idx
  on warehouse.fulfillment_orders(shipment_status, updated_at desc, id)
  where delivery_method = 'shipment' and shipment_status <> 'delivered';

create or replace function warehouse.assign_fulfillment_delivery_method()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.delivery_method := case new.source
    when 'ecommerce' then 'shipment'
    when 'department_request' then 'internal_handover'
    when 'event' then 'event_handover'
    else 'third_party_transfer'
  end;
  new.shipment_status := case
    when new.source = 'ecommerce' then 'awaiting_dispatch'
    else 'not_applicable'
  end;
  return new;
end;
$$;

create or replace function warehouse.sync_fulfillment_shipment_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.delivery_method <> 'shipment' then
    new.shipment_status := 'not_applicable';
  elsif new.status = 'released'
        and old.status is distinct from 'released'
        and new.shipment_status = 'awaiting_dispatch' then
    new.shipment_status := 'dispatched';
    new.dispatched_at := coalesce(new.dispatched_at, now());
    new.last_tracking_at := now();
  end if;
  return new;
end;
$$;
revoke all on function warehouse.sync_fulfillment_shipment_status() from public, anon, authenticated;
drop trigger if exists warehouse_fulfillment_shipment_status_sync
  on warehouse.fulfillment_orders;
create trigger warehouse_fulfillment_shipment_status_sync
before update of status, delivery_method on warehouse.fulfillment_orders
for each row execute function warehouse.sync_fulfillment_shipment_status();
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
    core.has_cap('warehouse', 'issue_items')
    or core.has_cap('warehouse', 'request_fulfillment')
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
      status = 'completed', shipment_status = 'delivered',
      proof_of_delivery_reference = v_reference,
      proof_of_delivery_evidence_url = v_evidence,
      delivered_at = now(), last_tracking_at = now(), updated_at = now()
    where id = v_order.id returning * into v_order;
  elsif v_action = 'return_to_sender' then
    if v_order.shipment_status <> 'delivery_failed' then
      raise exception 'Only a failed delivery can return to sender';
    end if;
    if v_reason is null then raise exception 'A return-to-sender reason is required'; end if;
    update warehouse.fulfillment_orders set
      shipment_status = 'returned_to_sender', delivery_failure_reason = v_reason,
      last_tracking_at = now(), updated_at = now()
    where id = v_order.id returning * into v_order;
  else
    raise exception 'Unsupported shipment tracking action';
  end if;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('warehouse', 'fulfillment_order', v_order.id, v_action, auth.uid(),
    jsonb_build_object(
      'shipment_status', v_order.shipment_status,
      'tracking_reference', v_reference,
      'failure_reason', v_reason
    ));
  return private.finish_idempotent_command(v_command_id, to_jsonb(v_order));
end;
$$;
revoke all on function warehouse.update_shipment_tracking(jsonb) from public, anon;
grant execute on function warehouse.update_shipment_tracking(jsonb) to authenticated, service_role;

alter table warehouse.customer_return_cases
  add column if not exists finance_evidence_url text,
  add column if not exists customer_resolution_reference text,
  add column if not exists customer_closure_evidence_url text,
  add column if not exists customer_closed_by uuid references core.profiles(id) on delete restrict,
  add column if not exists customer_closed_at timestamptz;
alter table warehouse.customer_return_cases
  drop constraint if exists warehouse_customer_return_status_check,
  drop constraint if exists warehouse_customer_return_resolved_check;
alter table warehouse.customer_return_cases
  add constraint warehouse_customer_return_status_check check (
    status in ('submitted', 'received', 'inspecting', 'decision_required', 'resolved', 'closed')
  ),
  add constraint warehouse_customer_return_resolved_check check (
    (status not in ('resolved', 'closed') and resolution = 'pending' and resolved_by is null and resolved_at is null)
    or (status in ('resolved', 'closed') and resolution <> 'pending' and resolved_by is not null and resolved_at is not null)
  ),
  add constraint warehouse_customer_return_closed_check check (
    status <> 'closed' or (
      customer_closed_by is not null and customer_closed_at is not null
      and nullif(pg_catalog.btrim(customer_resolution_reference), '') is not null
      and nullif(pg_catalog.btrim(customer_closure_evidence_url), '') is not null
    )
  ) not valid;
create index if not exists warehouse_customer_return_customer_close_idx
  on warehouse.customer_return_cases(status, resolved_at, id)
  where status = 'resolved';

create or replace function warehouse.resolve_customer_return_case(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_payload jsonb := payload;
  v_case warehouse.customer_return_cases;
  v_replacement_order_id uuid;
  v_evidence text := nullif(pg_catalog.btrim(payload->>'finance_evidence_url'), '');
begin
  if payload->>'resolution' in ('refund', 'write_off') and v_evidence is null then
    raise exception 'Finance evidence is required for refunds and write-offs';
  end if;
  if nullif(payload->>'quarantine_bin_id', '') is null then
    raise exception 'A quarantine bin is required before any return resolution';
  end if;
  if payload->>'resolution' = 'vendor_return'
     and nullif(pg_catalog.btrim(payload->>'supplier_reference'), '') is null then
    raise exception 'A supplier RMA reference is required for vendor return';
  end if;

  if payload->>'resolution' = 'replacement'
     and nullif(payload->>'replacement_order_id', '') is null then
    select * into v_case from warehouse.customer_return_cases
    where id=(payload->>'return_case_id')::uuid
    for update;
    if not found then raise exception 'Open return case not found'; end if;
    v_replacement_order_id := v_case.id;
    if v_case.status not in ('resolved','closed') then
      insert into warehouse.fulfillment_orders(
        id, source, external_reference, source_location_id, customer_reference,
        status, lines, packaging, created_by
      )
      select
      v_replacement_order_id,
      'ecommerce',
      'REPL-' || pg_catalog.upper(pg_catalog.left(pg_catalog.replace(v_case.id::text,'-',''),12)),
      source_order.source_location_id,
      coalesce(source_order.customer_reference, v_case.id::text),
      'received',
      jsonb_build_array(jsonb_build_object(
        'productId',v_case.product_id,
        'quantity',1,
        'pickedQuantity',0,
        'pickedSerialNumbers','[]'::jsonb
      )),
      '[]'::jsonb,
      auth.uid()
    from (select 1) seed
      left join warehouse.fulfillment_orders source_order on source_order.id=v_case.source_order_id
      on conflict(id) do nothing;
    end if;
    v_payload := jsonb_set(v_payload,'{replacement_order_id}',to_jsonb(v_replacement_order_id::text),true);
  end if;

  v_result := private.warehouse_resolve_customer_return_case(v_payload);
  update warehouse.customer_return_cases set finance_evidence_url = v_evidence
  where id = (v_payload->>'return_case_id')::uuid
  returning to_jsonb(customer_return_cases) into v_result;
  return v_result;
end;
$$;
revoke all on function warehouse.resolve_customer_return_case(jsonb) from public, anon;
grant execute on function warehouse.resolve_customer_return_case(jsonb) to authenticated, service_role;

create or replace function warehouse.close_customer_return_case(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_case warehouse.customer_return_cases;
  v_reference text := nullif(pg_catalog.btrim(payload->>'customer_resolution_reference'), '');
  v_evidence text := nullif(pg_catalog.btrim(payload->>'customer_closure_evidence_url'), '');
begin
  v_started := private.begin_idempotent_command(
    'close_customer_return_case', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;
  select * into v_case from warehouse.customer_return_cases
  where id = (payload->>'return_case_id')::uuid for update;
  if not found or v_case.status <> 'resolved' then
    raise exception 'A resolved return case is required for customer closure';
  end if;
  if not (v_case.created_by = auth.uid() or core.has_cap('warehouse', 'submit_return_case')) then
    raise exception 'Customer Service ownership is required to close this case';
  end if;
  if v_reference is null or v_evidence is null then
    raise exception 'Customer resolution reference and closure evidence are required';
  end if;
  update warehouse.customer_return_cases set
    status = 'closed', customer_resolution_reference = v_reference,
    customer_closure_evidence_url = v_evidence,
    customer_closed_by = auth.uid(), customer_closed_at = now()
  where id = v_case.id returning * into v_case;
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('warehouse', 'customer_return_case', v_case.id, 'customer_closed', auth.uid(),
    jsonb_build_object('resolution', v_case.resolution, 'reference', v_reference));
  return private.finish_idempotent_command(v_command_id, to_jsonb(v_case));
end;
$$;
revoke all on function warehouse.close_customer_return_case(jsonb) from public, anon;
grant execute on function warehouse.close_customer_return_case(jsonb) to authenticated, service_role;

create table if not exists warehouse.event_reconciliations (
  event_id text primary key references warehouse.events(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved')),
  sold_units integer not null default 0 check (sold_units >= 0),
  giveaway_units integer not null default 0 check (giveaway_units >= 0),
  returned_units integer not null default 0 check (returned_units >= 0),
  lost_units integer not null default 0 check (lost_units >= 0),
  damaged_units integer not null default 0 check (damaged_units >= 0),
  rekit_units integer not null default 0 check (rekit_units >= 0),
  gross_sales_amount numeric(14,2) not null default 0 check (gross_sales_amount >= 0),
  finance_reference text,
  evidence_url text,
  note text,
  prepared_by uuid references core.profiles(id) on delete restrict,
  prepared_at timestamptz,
  approved_by uuid references core.profiles(id) on delete restrict,
  approved_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table warehouse.event_reconciliations enable row level security;
drop policy if exists event_reconciliations_read on warehouse.event_reconciliations;
create policy event_reconciliations_read on warehouse.event_reconciliations
for select to authenticated using (
  core.has_cap('events', 'view_events')
  or core.has_cap('warehouse', 'view_inventory')
  or core.has_cap('warehouse', 'view_finance')
);
revoke insert, update, delete on warehouse.event_reconciliations from authenticated;
grant select on warehouse.event_reconciliations to authenticated;
grant all on warehouse.event_reconciliations to service_role;

create or replace function warehouse.save_event_reconciliation(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event warehouse.events;
  v_reconciliation warehouse.event_reconciliations;
  v_action text := payload->>'action';
  v_issued integer;
  v_accounted integer;
begin
  if v_action in ('save', 'submit') then
    if not core.has_cap('events', 'manage_events') then
      raise exception 'Not authorized: events.manage_events';
    end if;
  elsif v_action = 'approve' then
    if not (core.has_cap('warehouse', 'view_finance') or core.has_cap('procurement', 'view_finance')) then
      raise exception 'Finance authorization is required for event settlement';
    end if;
  else raise exception 'Unsupported reconciliation action'; end if;

  select * into v_event from warehouse.events where id = payload->>'event_id' for update;
  if not found then raise exception 'Event not found'; end if;
  if exists (
    select 1 from warehouse.event_reconciliations reconciliation
    where reconciliation.event_id = v_event.id and reconciliation.status = 'approved'
  ) then raise exception 'An approved event reconciliation cannot be edited'; end if;
  select coalesce(sum(allocation.quantity), 0)::integer into v_issued
  from warehouse.allocations allocation
  where allocation.event_id = v_event.id and allocation.status in ('issued', 'returned');

  if v_action in ('save', 'submit') then
    insert into warehouse.event_reconciliations(
      event_id, status, sold_units, giveaway_units, returned_units, lost_units,
      damaged_units, rekit_units, gross_sales_amount, finance_reference,
      evidence_url, note, prepared_by, prepared_at, updated_at
    ) values (
      v_event.id, case when v_action = 'submit' then 'submitted' else 'draft' end,
      coalesce((payload->>'sold_units')::integer, 0),
      coalesce((payload->>'giveaway_units')::integer, 0),
      coalesce((payload->>'returned_units')::integer, 0),
      coalesce((payload->>'lost_units')::integer, 0),
      coalesce((payload->>'damaged_units')::integer, 0),
      coalesce((payload->>'rekit_units')::integer, 0),
      coalesce((payload->>'gross_sales_amount')::numeric, 0),
      nullif(pg_catalog.btrim(payload->>'finance_reference'), ''),
      nullif(pg_catalog.btrim(payload->>'evidence_url'), ''),
      nullif(pg_catalog.btrim(payload->>'note'), ''), auth.uid(), now(), now()
    ) on conflict(event_id) do update set
      status = excluded.status, sold_units = excluded.sold_units,
      giveaway_units = excluded.giveaway_units, returned_units = excluded.returned_units,
      lost_units = excluded.lost_units, damaged_units = excluded.damaged_units,
      rekit_units = excluded.rekit_units, gross_sales_amount = excluded.gross_sales_amount,
      finance_reference = excluded.finance_reference, evidence_url = excluded.evidence_url,
      note = excluded.note, prepared_by = auth.uid(), prepared_at = now(),
      approved_by = null, approved_at = null, updated_at = now()
    returning * into v_reconciliation;
  else
    select * into v_reconciliation from warehouse.event_reconciliations
    where event_id = v_event.id for update;
    if not found or v_reconciliation.status <> 'submitted' then
      raise exception 'Submit the event reconciliation before Finance approval';
    end if;
    v_accounted := v_reconciliation.sold_units + v_reconciliation.giveaway_units
      + v_reconciliation.returned_units + v_reconciliation.lost_units
      + v_reconciliation.damaged_units + v_reconciliation.rekit_units;
    if v_accounted <> v_issued then
      raise exception 'Event outcomes must account for all issued units';
    end if;
    if nullif(pg_catalog.btrim(v_reconciliation.finance_reference), '') is null
       or nullif(pg_catalog.btrim(v_reconciliation.evidence_url), '') is null then
      raise exception 'Finance reference and evidence are required for approval';
    end if;
    update warehouse.event_reconciliations set
      status = 'approved', approved_by = auth.uid(), approved_at = now(), updated_at = now()
    where event_id = v_event.id returning * into v_reconciliation;
  end if;
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('events', 'event_reconciliation', v_event.id, v_action, auth.uid(),
    jsonb_build_object('status', v_reconciliation.status, 'issued_units', v_issued));
  return to_jsonb(v_reconciliation);
end;
$$;
revoke all on function warehouse.save_event_reconciliation(jsonb) from public, anon;
grant execute on function warehouse.save_event_reconciliation(jsonb) to authenticated, service_role;

create or replace function warehouse.require_event_reconciliation_before_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'closed' and old.status is distinct from 'closed' then
    if exists (
      select 1 from warehouse.fulfillment_orders fulfillment
      where fulfillment.event_id = new.id
        and fulfillment.status not in ('completed', 'cancelled')
    ) then raise exception 'Complete or cancel every event fulfillment order before closure'; end if;
    if not exists (
      select 1 from warehouse.event_reconciliations reconciliation
      where reconciliation.event_id = new.id and reconciliation.status = 'approved'
    ) then raise exception 'An approved event reconciliation is required before closure'; end if;
  end if;
  return new;
end;
$$;
revoke all on function warehouse.require_event_reconciliation_before_close() from public, anon, authenticated;
drop trigger if exists warehouse_event_close_reconciliation on warehouse.events;
create trigger warehouse_event_close_reconciliation
before update of status on warehouse.events
for each row execute function warehouse.require_event_reconciliation_before_close();

-- P1 control registers. They provide one governed source of truth while the
-- operational screens remain in their owning modules.
create table if not exists warehouse.inventory_integrity_cases (
  id uuid primary key default gen_random_uuid(),
  case_type text not null check (case_type in ('cycle_count', 'expiry', 'recall', 'damage', 'serial_reconciliation')),
  product_id text references warehouse.products(id) on delete restrict,
  lot_id text references warehouse.lots(id) on delete restrict,
  serial_number text,
  status text not null default 'open' check (status in ('open', 'contained', 'pending_approval', 'resolved', 'cancelled')),
  severity text not null default 'normal' check (severity in ('normal', 'high', 'critical')),
  reason text not null,
  evidence_url text,
  resolution_reference text,
  opened_by uuid not null references core.profiles(id) on delete restrict,
  opened_at timestamptz not null default now(),
  resolved_by uuid references core.profiles(id) on delete restrict,
  resolved_at timestamptz
);
create index if not exists warehouse_integrity_open_idx
  on warehouse.inventory_integrity_cases(case_type, severity, opened_at desc)
  where status not in ('resolved', 'cancelled');
alter table warehouse.inventory_integrity_cases enable row level security;
create policy inventory_integrity_cases_read on warehouse.inventory_integrity_cases
for select to authenticated using (core.has_cap('warehouse', 'view_inventory'));
revoke insert, update, delete on warehouse.inventory_integrity_cases from authenticated;
grant select on warehouse.inventory_integrity_cases to authenticated;
grant all on warehouse.inventory_integrity_cases to service_role;

create table if not exists procurement.replenishment_recommendations (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references warehouse.products(id) on delete restrict,
  recommended_quantity integer not null check (recommended_quantity > 0),
  on_hand integer not null,
  reorder_point integer not null,
  lead_time_days integer,
  status text not null default 'recommended' check (status in ('recommended', 'accepted', 'handed_off', 'dismissed', 'ordered')),
  stockout_risk text not null check (stockout_risk in ('low', 'medium', 'high', 'critical')),
  rationale text not null,
  procurement_request_id text references procurement.requests(id) on delete restrict,
  purchase_order_id text references procurement.purchase_orders(id) on delete restrict,
  ordered_at timestamptz,
  expected_arrival_at date,
  created_at timestamptz not null default now(),
  decided_by uuid references core.profiles(id) on delete restrict,
  decided_at timestamptz
);
create unique index if not exists procurement_replenishment_active_product_idx
  on procurement.replenishment_recommendations(product_id)
  where status in ('recommended', 'accepted', 'handed_off');
alter table procurement.replenishment_recommendations enable row level security;
create policy replenishment_recommendations_read on procurement.replenishment_recommendations
for select to authenticated using (
  core.has_cap('warehouse', 'view_inventory') or core.has_cap('procurement', 'view_dashboard')
);
revoke insert, update, delete on procurement.replenishment_recommendations from authenticated;
grant select on procurement.replenishment_recommendations to authenticated;
grant all on procurement.replenishment_recommendations to service_role;

create table if not exists core.finance_close_entries (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  entry_type text not null check (entry_type in ('inventory_valuation', 'cogs', 'merchandise_expense', 'cost_center', 'write_off', 'event_settlement')),
  source_module text not null,
  source_reference text not null,
  cost_center text,
  amount numeric(14,2) not null,
  status text not null default 'draft' check (status in ('draft', 'ready', 'posted', 'reconciled', 'exception')),
  evidence_url text,
  reconciliation_note text,
  prepared_by uuid not null references core.profiles(id) on delete restrict,
  prepared_at timestamptz not null default now(),
  posted_by uuid references core.profiles(id) on delete restrict,
  posted_at timestamptz,
  unique(entry_type, source_module, source_reference, period_end)
);
alter table core.finance_close_entries
  drop constraint if exists finance_close_period_check;
alter table core.finance_close_entries
  add constraint finance_close_period_check check (period_end >= period_start);
create index if not exists finance_close_period_status_idx
  on core.finance_close_entries(period_end desc, status, entry_type);
alter table core.finance_close_entries enable row level security;
create policy finance_close_entries_read on core.finance_close_entries
for select to authenticated using (
  core.has_cap('warehouse', 'view_finance') or core.has_cap('procurement', 'view_finance')
);
revoke insert, update, delete on core.finance_close_entries from authenticated;
grant select on core.finance_close_entries to authenticated;
grant all on core.finance_close_entries to service_role;

create or replace function core.manage_finance_close_entry(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry core.finance_close_entries;
  v_action text := payload->>'action';
begin
  if not (
    core.has_cap('warehouse', 'view_finance')
    or core.has_cap('procurement', 'view_finance')
  ) then raise exception 'Finance authorization is required'; end if;

  if v_action = 'save' then
    if payload->>'entry_type' not in (
      'inventory_valuation', 'cogs', 'merchandise_expense', 'cost_center',
      'write_off', 'event_settlement'
    ) then raise exception 'Invalid Finance close entry type'; end if;
    if nullif(pg_catalog.btrim(payload->>'source_reference'), '') is null
       or nullif(pg_catalog.btrim(payload->>'source_module'), '') is null
       or nullif(payload->>'period_start', '') is null
       or nullif(payload->>'period_end', '') is null then
      raise exception 'Period and source reference are required';
    end if;
    if (payload->>'period_end')::date < (payload->>'period_start')::date then
      raise exception 'Period end cannot be before period start';
    end if;
    insert into core.finance_close_entries(
      id, period_start, period_end, entry_type, source_module, source_reference,
      cost_center, amount, status, evidence_url, reconciliation_note, prepared_by
    ) values (
      coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid()),
      (payload->>'period_start')::date, (payload->>'period_end')::date,
      payload->>'entry_type', pg_catalog.btrim(payload->>'source_module'),
      pg_catalog.btrim(payload->>'source_reference'),
      nullif(pg_catalog.btrim(payload->>'cost_center'), ''),
      coalesce((payload->>'amount')::numeric, 0), 'ready',
      nullif(pg_catalog.btrim(payload->>'evidence_url'), ''),
      nullif(pg_catalog.btrim(payload->>'reconciliation_note'), ''), auth.uid()
    ) on conflict(entry_type, source_module, source_reference, period_end)
    do update set amount = excluded.amount, cost_center = excluded.cost_center,
      evidence_url = excluded.evidence_url,
      reconciliation_note = excluded.reconciliation_note,
      status = 'ready', prepared_by = auth.uid(), prepared_at = now(),
      posted_by = null, posted_at = null
    returning * into v_entry;
  else
    select * into v_entry from core.finance_close_entries
    where id = (payload->>'id')::uuid for update;
    if not found then raise exception 'Finance close entry not found'; end if;
    if v_action = 'post' then
      if v_entry.status <> 'ready' then raise exception 'Only a ready entry can be posted'; end if;
      if v_entry.prepared_by = auth.uid() then
        raise exception 'A second Finance user must post the prepared entry';
      end if;
      if nullif(pg_catalog.btrim(v_entry.evidence_url), '') is null then
        raise exception 'Evidence is required before posting';
      end if;
      update core.finance_close_entries set status = 'posted',
        posted_by = auth.uid(), posted_at = now()
      where id = v_entry.id returning * into v_entry;
    elsif v_action = 'reconcile' then
      if v_entry.status <> 'posted' then raise exception 'Post the entry before reconciliation'; end if;
      update core.finance_close_entries set status = 'reconciled',
        reconciliation_note = coalesce(
          nullif(pg_catalog.btrim(payload->>'reconciliation_note'), ''),
          reconciliation_note
        )
      where id = v_entry.id returning * into v_entry;
    elsif v_action = 'exception' then
      update core.finance_close_entries set status = 'exception',
        reconciliation_note = nullif(pg_catalog.btrim(payload->>'reconciliation_note'), '')
      where id = v_entry.id returning * into v_entry;
    else raise exception 'Unsupported Finance close action'; end if;
  end if;
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('finance', 'close_entry', v_entry.id, v_action, auth.uid(),
    jsonb_build_object('entry_type', v_entry.entry_type, 'status', v_entry.status, 'amount', v_entry.amount));
  return to_jsonb(v_entry);
end;
$$;
revoke all on function core.manage_finance_close_entry(jsonb) from public, anon;
grant execute on function core.manage_finance_close_entry(jsonb) to authenticated, service_role;

create or replace function warehouse.manage_inventory_integrity_case(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_case warehouse.inventory_integrity_cases; v_action text := payload->>'action';
begin
  if not core.has_cap('warehouse', 'manage_inventory') then
    raise exception 'Not authorized: warehouse.manage_inventory';
  end if;
  if v_action = 'open' then
    if payload->>'case_type' not in ('cycle_count','expiry','recall','damage','serial_reconciliation')
       or nullif(pg_catalog.btrim(payload->>'reason'), '') is null then
      raise exception 'Case type and reason are required';
    end if;
    insert into warehouse.inventory_integrity_cases(
      case_type, product_id, lot_id, serial_number, status, severity,
      reason, evidence_url, opened_by
    ) values (
      payload->>'case_type', nullif(payload->>'product_id',''),
      nullif(payload->>'lot_id',''), nullif(payload->>'serial_number',''),
      'open', coalesce(nullif(payload->>'severity',''),'normal'),
      pg_catalog.btrim(payload->>'reason'),
      nullif(pg_catalog.btrim(payload->>'evidence_url'),''), auth.uid()
    ) returning * into v_case;
  else
    select * into v_case from warehouse.inventory_integrity_cases
    where id = (payload->>'id')::uuid for update;
    if not found then raise exception 'Inventory integrity case not found'; end if;
    if v_action = 'contain' then
      if v_case.status <> 'open' then raise exception 'Only an open case can be contained'; end if;
      update warehouse.inventory_integrity_cases set status='contained'
      where id=v_case.id returning * into v_case;
    elsif v_action = 'submit' then
      if v_case.status <> 'contained' then raise exception 'Contain the case before approval'; end if;
      if v_case.severity in ('high','critical')
         and nullif(pg_catalog.btrim(v_case.evidence_url),'') is null then
        raise exception 'Evidence is required for high and critical cases';
      end if;
      update warehouse.inventory_integrity_cases set status='pending_approval'
      where id=v_case.id returning * into v_case;
    elsif v_action = 'resolve' then
      if v_case.status <> 'pending_approval' then raise exception 'Only a submitted case can be resolved'; end if;
      if not core.has_cap('warehouse','approve_stock_adjustment') then
        raise exception 'Supervisor approval is required';
      end if;
      if nullif(pg_catalog.btrim(payload->>'resolution_reference'),'') is null then
        raise exception 'Resolution reference is required';
      end if;
      update warehouse.inventory_integrity_cases set status='resolved',
        resolution_reference=pg_catalog.btrim(payload->>'resolution_reference'),
        resolved_by=auth.uid(), resolved_at=now()
      where id=v_case.id returning * into v_case;
    elsif v_action = 'cancel' then
      if v_case.status in ('resolved','cancelled') then raise exception 'Closed cases cannot be cancelled'; end if;
      update warehouse.inventory_integrity_cases set status='cancelled',
        resolved_by=auth.uid(), resolved_at=now()
      where id=v_case.id returning * into v_case;
    else raise exception 'Unsupported inventory integrity action'; end if;
  end if;
  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values('warehouse','inventory_integrity_case',v_case.id,v_action,auth.uid(),
    jsonb_build_object('case_type',v_case.case_type,'status',v_case.status));
  return to_jsonb(v_case);
end;
$$;
revoke all on function warehouse.manage_inventory_integrity_case(jsonb) from public, anon;
grant execute on function warehouse.manage_inventory_integrity_case(jsonb) to authenticated, service_role;

create or replace function procurement.manage_replenishment_recommendation(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row procurement.replenishment_recommendations;
  v_action text := payload->>'action';
  v_request procurement.requests;
begin
  if not (
    core.has_cap('warehouse','view_procurement')
    or core.has_cap('procurement','manage_rfp')
    or core.has_cap('procurement','author_po')
  ) then raise exception 'Procurement authorization is required'; end if;

  if v_action='recommend' then
    if coalesce((payload->>'recommended_quantity')::integer, 0) <= 0
       or nullif(pg_catalog.btrim(payload->>'rationale'),'') is null
       or payload->>'stockout_risk' not in ('low','medium','high','critical') then
      raise exception 'Quantity, stockout risk, and rationale are required';
    end if;
    insert into procurement.replenishment_recommendations(
      product_id,recommended_quantity,on_hand,reorder_point,lead_time_days,
      status,stockout_risk,rationale
    ) values (
      payload->>'product_id',(payload->>'recommended_quantity')::integer,
      (payload->>'on_hand')::integer,(payload->>'reorder_point')::integer,
      nullif(payload->>'lead_time_days','')::integer,'recommended',
      payload->>'stockout_risk',pg_catalog.btrim(payload->>'rationale')
    ) on conflict(product_id) where status in ('recommended','accepted','handed_off')
    do update set recommended_quantity=excluded.recommended_quantity,
      on_hand=excluded.on_hand,reorder_point=excluded.reorder_point,
      lead_time_days=excluded.lead_time_days,stockout_risk=excluded.stockout_risk,
      rationale=excluded.rationale,created_at=now()
    returning * into v_row;
  else
    select * into v_row from procurement.replenishment_recommendations
    where id=(payload->>'id')::uuid for update;
    if not found then raise exception 'Replenishment recommendation not found'; end if;

    if v_action='accept' then
      if v_row.status <> 'recommended' then raise exception 'Only a recommendation can be accepted'; end if;
      v_row.status:='accepted';
    elsif v_action='handoff' then
      if v_row.status <> 'accepted' then raise exception 'Accept the recommendation before handoff'; end if;
      insert into procurement.requests(
        title, description, requester_id, department, status, category,
        needed_by, justification, compliance, lines
      ) values (
        'Replenish ' || v_row.product_id,
        v_row.rationale || ' Recommended quantity: ' || v_row.recommended_quantity::text || '.',
        auth.uid(), 'operations', 'draft', 'goods',
        current_date + coalesce(v_row.lead_time_days, 0),
        jsonb_build_object(
          'businessNeed', v_row.rationale,
          'replenishmentRecommendationId', v_row.id
        ),
        jsonb_build_object(
          'vendorAccreditationRequired', true,
          'source', 'warehouse_replenishment'
        ),
        jsonb_build_array(jsonb_build_object(
          'description', v_row.product_id,
          'quantity', v_row.recommended_quantity,
          'uom', 'unit'
        ))
      ) returning * into v_request;
      v_row.status:='handed_off';
    elsif v_action='dismiss' then
      if v_row.status not in ('recommended','accepted') then raise exception 'Only an open recommendation can be dismissed'; end if;
      v_row.status:='dismissed';
    else
      raise exception 'Unsupported replenishment action';
    end if;

    update procurement.replenishment_recommendations set
      status=v_row.status,
      procurement_request_id=coalesce(
        v_request.id,
        nullif(payload->>'procurement_request_id',''),
        procurement_request_id
      ),
      decided_by=auth.uid(),
      decided_at=now()
    where id=v_row.id returning * into v_row;
  end if;

  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values('procurement','replenishment_recommendation',v_row.id,v_action,auth.uid(),
    jsonb_build_object(
      'product_id',v_row.product_id,
      'status',v_row.status,
      'procurement_request_id',v_row.procurement_request_id
    ));
  return to_jsonb(v_row);
end;
$$;
revoke all on function procurement.manage_replenishment_recommendation(jsonb) from public, anon;
grant execute on function procurement.manage_replenishment_recommendation(jsonb) to authenticated, service_role;
create or replace function procurement.sync_replenishment_purchase_order()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.request_id is null then return new; end if;
  if new.status in ('issued','closed') then
    update procurement.replenishment_recommendations set
      status='ordered',
      purchase_order_id=new.id,
      ordered_at=coalesce(ordered_at,now()),
      expected_arrival_at=new.expected_date,
      decided_at=now()
    where procurement_request_id=new.request_id
      and status in ('handed_off','ordered');
  elsif new.status='cancelled' then
    update procurement.replenishment_recommendations set
      status='handed_off',
      purchase_order_id=null,
      ordered_at=null,
      expected_arrival_at=null,
      decided_at=now()
    where procurement_request_id=new.request_id
      and purchase_order_id=new.id;
  end if;
  return new;
end;
$$;
revoke all on function procurement.sync_replenishment_purchase_order() from public, anon, authenticated;
drop trigger if exists procurement_replenishment_po_sync on procurement.purchase_orders;
create trigger procurement_replenishment_po_sync
after insert or update of status, expected_date on procurement.purchase_orders
for each row execute function procurement.sync_replenishment_purchase_order();
create table if not exists legal.vendor_lifecycle_reviews (
  id uuid primary key default gen_random_uuid(),
  vendor_id uuid not null references core.vendors(id) on delete restrict,
  review_type text not null check (review_type in ('renewal', 'document_expiry', 'performance', 'reassessment', 'suspension', 'offboarding')),
  status text not null default 'open' check (status in ('open', 'under_review', 'approved', 'rejected', 'completed', 'cancelled')),
  due_date date,
  risk_rating text check (risk_rating is null or risk_rating in ('low', 'medium', 'high', 'critical')),
  score numeric(5,2),
  reason text not null,
  evidence_url text,
  decision_note text,
  opened_by uuid not null references core.profiles(id) on delete restrict,
  opened_at timestamptz not null default now(),
  decided_by uuid references core.profiles(id) on delete restrict,
  decided_at timestamptz
);
create index if not exists legal_vendor_lifecycle_queue_idx
  on legal.vendor_lifecycle_reviews(status, due_date, opened_at desc)
  where status not in ('completed', 'cancelled');
alter table legal.vendor_lifecycle_reviews enable row level security;
create policy vendor_lifecycle_reviews_read on legal.vendor_lifecycle_reviews
for select to authenticated using (core.has_cap('legal', 'review_accreditation'));
revoke insert, update, delete on legal.vendor_lifecycle_reviews from authenticated;
grant select on legal.vendor_lifecycle_reviews to authenticated;
grant all on legal.vendor_lifecycle_reviews to service_role;

alter table core.vendors drop constraint if exists vendors_status_check;
alter table core.vendors add constraint vendors_status_check check (
  accreditation_status in (
    'draft', 'submitted', 'under_review', 'approved', 'provisional',
    'rejected', 'expired', 'renewal_due', 'suspended', 'offboarded'
  )
);

create or replace function legal.manage_vendor_lifecycle_review(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review legal.vendor_lifecycle_reviews;
  v_action text := payload->>'action';
begin
  if not core.has_cap('legal','review_accreditation') then
    raise exception 'Not authorized: legal.review_accreditation';
  end if;

  if v_action='open' then
    if payload->>'review_type' not in (
      'renewal','document_expiry','performance','reassessment','suspension','offboarding'
    ) or nullif(pg_catalog.btrim(payload->>'reason'),'') is null then
      raise exception 'Review type and reason are required';
    end if;
    if nullif(payload->>'score','') is not null
       and (payload->>'score')::numeric not between 0 and 100 then
      raise exception 'Performance score must be between 0 and 100';
    end if;
    insert into legal.vendor_lifecycle_reviews(
      vendor_id,review_type,status,due_date,risk_rating,score,reason,evidence_url,opened_by
    ) values (
      (payload->>'vendor_id')::uuid,payload->>'review_type','open',
      nullif(payload->>'due_date','')::date,nullif(payload->>'risk_rating',''),
      nullif(payload->>'score','')::numeric,pg_catalog.btrim(payload->>'reason'),
      nullif(pg_catalog.btrim(payload->>'evidence_url'),''),auth.uid()
    ) returning * into v_review;
  else
    select * into v_review from legal.vendor_lifecycle_reviews
    where id=(payload->>'id')::uuid for update;
    if not found then raise exception 'Vendor lifecycle review not found'; end if;

    if v_action='start' then
      if v_review.status <> 'open' then raise exception 'Only an open review can be started'; end if;
      v_review.status:='under_review';
    elsif v_action in ('approve','reject') then
      if v_review.status <> 'under_review' then raise exception 'Start the review before a decision'; end if;
      if not core.has_cap('legal','approve_accreditation') then
        raise exception 'Legal decision authority is required';
      end if;
      if nullif(pg_catalog.btrim(payload->>'decision_note'),'') is null then
        raise exception 'A decision note is required';
      end if;
      v_review.status:=case v_action when 'approve' then 'approved' else 'rejected' end;
    elsif v_action='complete' then
      if v_review.status <> 'approved' then raise exception 'Only an approved review can be completed'; end if;
      if not core.has_cap('legal','approve_accreditation') then
        raise exception 'Legal decision authority is required';
      end if;
      v_review.status:='completed';
    elsif v_action='cancel' then
      if v_review.status not in ('open','under_review') then
        raise exception 'A decided review cannot be cancelled';
      end if;
      if not core.has_cap('legal','approve_accreditation') then
        raise exception 'Legal decision authority is required';
      end if;
      v_review.status:='cancelled';
    else
      raise exception 'Unsupported vendor lifecycle action';
    end if;

    update legal.vendor_lifecycle_reviews set
      status=v_review.status,
      decision_note=nullif(pg_catalog.btrim(payload->>'decision_note'),''),
      decided_by=case
        when v_review.status in ('approved','rejected','completed','cancelled') then auth.uid()
        else decided_by
      end,
      decided_at=case
        when v_review.status in ('approved','rejected','completed','cancelled') then now()
        else decided_at
      end
    where id=v_review.id returning * into v_review;

    if v_review.status in ('approved','completed')
       and v_review.review_type in ('suspension','offboarding') then
      update core.vendors set accreditation_status=case v_review.review_type
        when 'suspension' then 'suspended' else 'offboarded' end
      where id=v_review.vendor_id;
      if v_review.review_type='offboarding' then
        update core.profiles set status='disabled'
        where vendor_id=v_review.vendor_id and kind='vendor';
      end if;
    end if;
  end if;

  insert into core.activity_log(module,entity_type,entity_id,action,actor,detail)
  values('legal','vendor_lifecycle_review',v_review.id,v_action,auth.uid(),
    jsonb_build_object(
      'vendor_id',v_review.vendor_id,
      'review_type',v_review.review_type,
      'status',v_review.status
    ));
  return to_jsonb(v_review);
end;
$$;
revoke all on function legal.manage_vendor_lifecycle_review(jsonb) from public, anon;
grant execute on function legal.manage_vendor_lifecycle_review(jsonb) to authenticated, service_role;