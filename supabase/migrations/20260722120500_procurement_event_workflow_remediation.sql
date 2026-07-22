-- Procurement and Events workflow remediation. This migration is intentionally
-- forward-only: drafts remain the eventual request row and all writes stay RPC-only.

alter table procurement.requests
  add column if not exists draft_client_key text,
  add column if not exists draft_version integer not null default 0,
  add column if not exists draft_payload jsonb;

alter table procurement.requests
  drop constraint if exists procurement_requests_owner_draft_client_key_uq;
alter table procurement.requests
  add constraint procurement_requests_owner_draft_client_key_uq
  unique (requester_id, draft_client_key);

alter table procurement.requests
  drop constraint if exists procurement_requests_draft_version_check;
alter table procurement.requests
  add constraint procurement_requests_draft_version_check
  check (draft_version >= 0);

create or replace function procurement.get_latest_request_draft(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request procurement.requests;
begin
  if not core.has_cap('procurement', 'create_request') then
    raise exception 'Not authorized: procurement.get_latest_request_draft';
  end if;

  select request.*
    into v_request
    from procurement.requests request
   where request.requester_id = auth.uid()
     and request.status = 'draft'
     and request.draft_payload is not null
   order by request.updated_at desc, request.created_at desc
   limit 1;

  if not found then return null; end if;
  return jsonb_build_object(
    'id', v_request.id,
    'client_key', v_request.draft_client_key,
    'draft_version', v_request.draft_version,
    'draft_payload', v_request.draft_payload,
    'updated_at', v_request.updated_at
  );
end;
$$;

create or replace function procurement.save_request_draft(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request procurement.requests;
  v_client_key text := nullif(pg_catalog.btrim(payload->>'client_key'), '');
  v_payload jsonb := payload->'draft';
  v_expected_version integer := nullif(payload->>'expected_version', '')::integer;
begin
  if not core.has_cap('procurement', 'create_request') then
    raise exception 'Not authorized: procurement.save_request_draft';
  end if;
  if v_client_key is null or pg_catalog.length(v_client_key) > 128 then
    raise exception 'A valid draft client key is required';
  end if;
  if jsonb_typeof(v_payload) <> 'object' then
    raise exception 'Draft payload must be an object';
  end if;

  select request.*
    into v_request
    from procurement.requests request
   where request.requester_id = auth.uid()
     and request.draft_client_key = v_client_key
     and request.status = 'draft'
   for update;

  if found then
    -- A network retry with the same content is a true replay, not a new version.
    if v_request.draft_payload = v_payload then
      return jsonb_build_object(
        'id', v_request.id,
        'client_key', v_request.draft_client_key,
        'draft_version', v_request.draft_version,
        'draft_payload', v_request.draft_payload,
        'updated_at', v_request.updated_at
      );
    end if;
    if v_expected_version is null or v_expected_version <> v_request.draft_version then
      raise exception 'Draft changed in another session; reload before saving';
    end if;
    update procurement.requests request
       set title = coalesce(v_payload->>'title', ''),
           draft_payload = v_payload,
           draft_version = request.draft_version + 1,
           updated_at = now()
     where request.id = v_request.id
     returning * into v_request;
  else
    if v_expected_version is not null and v_expected_version <> 0 then
      raise exception 'Draft no longer exists; reload before saving';
    end if;
    insert into procurement.requests (
      id, title, requester_id, requester_name, requester_email, status,
      draft_client_key, draft_version, draft_payload
    ) values (
      'req_' || replace(gen_random_uuid()::text, '-', ''),
      coalesce(v_payload->>'title', ''), auth.uid(),
      nullif(v_payload->>'requesterName', ''), auth.jwt()->>'email', 'draft',
      v_client_key, 1, v_payload
    ) returning * into v_request;
    insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
    values ('procurement', 'request', v_request.id, 'draft_created', auth.uid(),
      jsonb_build_object('client_key', v_client_key));
  end if;

  return jsonb_build_object(
    'id', v_request.id,
    'client_key', v_request.draft_client_key,
    'draft_version', v_request.draft_version,
    'draft_payload', v_request.draft_payload,
    'updated_at', v_request.updated_at
  );
end;
$$;

create or replace function procurement.discard_request_draft(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := payload->>'id';
begin
  if not core.has_cap('procurement', 'create_request') then
    raise exception 'Not authorized: procurement.discard_request_draft';
  end if;
  delete from procurement.requests request
   where request.id = v_id
     and request.requester_id = auth.uid()
     and request.status = 'draft'
     and request.draft_payload is not null;
  if not found then raise exception 'Draft not found'; end if;
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('procurement', 'request', v_id, 'draft_discarded', auth.uid(), '{}'::jsonb);
  return jsonb_build_object('id', v_id, 'discarded', true);
end;
$$;

create or replace function procurement.finalize_request_draft(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text := payload->>'id';
begin
  if not core.has_cap('procurement', 'create_request') then
    raise exception 'Not authorized: procurement.finalize_request_draft';
  end if;
  perform 1
    from procurement.requests request
   where request.id = v_id
     and request.requester_id = auth.uid()
     and request.status = 'draft'
     and request.draft_payload is not null
   for update;
  if not found then raise exception 'Owned server draft not found'; end if;

  -- The delete and governed create run in one transaction. Any validation or
  -- attachment failure rolls the delete back, so an unfinished draft is retained.
  delete from procurement.requests request
   where request.id = v_id and request.requester_id = auth.uid();
  return procurement.create_request(payload);
end;
$$;

revoke all on function procurement.get_latest_request_draft(jsonb) from public, anon;
revoke all on function procurement.save_request_draft(jsonb) from public, anon;
revoke all on function procurement.discard_request_draft(jsonb) from public, anon;
revoke all on function procurement.finalize_request_draft(jsonb) from public, anon;
grant execute on function procurement.get_latest_request_draft(jsonb) to authenticated, service_role;
grant execute on function procurement.save_request_draft(jsonb) to authenticated, service_role;
grant execute on function procurement.discard_request_draft(jsonb) to authenticated, service_role;
grant execute on function procurement.finalize_request_draft(jsonb) to authenticated, service_role;

-- Events owns intent and auditable lifecycle decisions. Warehouse remains the
-- physical custodian and receives demand through a dedicated handoff RPC.
alter table warehouse.events
  add column if not exists status text not null default 'planned',
  add column if not exists owner_id uuid references core.profiles(id) on delete restrict,
  add column if not exists owner_email text,
  add column if not exists lifecycle_reason text,
  add column if not exists updated_at timestamptz not null default now();

alter table warehouse.events
  drop constraint if exists warehouse_events_status_check;
alter table warehouse.events
  add constraint warehouse_events_status_check
  check (status in ('planned', 'active', 'closed', 'cancelled'));
alter table warehouse.events
  drop constraint if exists warehouse_events_date_order_check;
alter table warehouse.events
  add constraint warehouse_events_date_order_check
  check (end_date is null or end_date >= start_date);

create table if not exists warehouse.event_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references warehouse.events(id) on delete restrict,
  action text not null,
  from_status text,
  to_status text not null,
  reason text not null,
  changes jsonb not null default '{}'::jsonb,
  actor_id uuid not null references core.profiles(id) on delete restrict,
  actor_email text,
  created_at timestamptz not null default now(),
  constraint warehouse_event_lifecycle_action_check check (
    action in ('created','edit','reschedule','cancel','close','reopen','transfer_owner')
  )
);
create index if not exists warehouse_event_lifecycle_event_idx
  on warehouse.event_lifecycle_events(event_id, created_at desc);
alter table warehouse.event_lifecycle_events enable row level security;
drop policy if exists warehouse_event_lifecycle_read on warehouse.event_lifecycle_events;
create policy warehouse_event_lifecycle_read on warehouse.event_lifecycle_events
  for select to authenticated
  using (core.has_cap('events', 'view_events'));
revoke insert, update, delete on warehouse.event_lifecycle_events from authenticated;

create or replace function warehouse.create_event(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event warehouse.events;
  v_data jsonb := payload->'event';
begin
  if not (
    core.has_cap('events', 'create_event')
    or core.has_cap('warehouse', 'reserve_allocate')
  ) then
    raise exception 'Not authorized: events.create_event';
  end if;
  if nullif(pg_catalog.btrim(v_data->>'name'), '') is null then
    raise exception 'Event name is required';
  end if;
  if nullif(v_data->>'start_date', '') is null then
    raise exception 'Start date is required';
  end if;
  if nullif(v_data->>'end_date', '') is not null
     and (v_data->>'end_date')::date < (v_data->>'start_date')::date then
    raise exception 'End date cannot be before the start date';
  end if;

  insert into warehouse.events(
    id, name, type, site_location_id, start_date, end_date,
    status, owner_id, owner_email, lifecycle_reason, updated_at
  ) values (
    v_data->>'id', pg_catalog.btrim(v_data->>'name'), v_data->>'type',
    nullif(v_data->>'site_location_id', ''), (v_data->>'start_date')::date,
    nullif(v_data->>'end_date', '')::date,
    case when (v_data->>'start_date')::date > current_date then 'planned' else 'active' end,
    auth.uid(), auth.jwt()->>'email', 'Event created', now()
  ) returning * into v_event;

  insert into warehouse.event_lifecycle_events(
    event_id, action, from_status, to_status, reason, changes, actor_id, actor_email
  ) values (
    v_event.id, 'created', null, v_event.status, 'Event created',
    jsonb_build_object('name', v_event.name, 'start_date', v_event.start_date),
    auth.uid(), auth.jwt()->>'email'
  );
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('events', 'event', v_event.id, 'created', auth.uid(),
    jsonb_build_object('status', v_event.status, 'start_date', v_event.start_date));
  return to_jsonb(v_event);
end;
$$;

create or replace function warehouse.manage_event(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event warehouse.events;
  v_action text := payload->>'action';
  v_reason text := nullif(pg_catalog.btrim(payload->>'reason'), '');
  v_changes jsonb := coalesce(payload->'changes', '{}'::jsonb);
  v_expected_updated_at timestamptz := nullif(payload->>'expected_updated_at', '')::timestamptz;
  v_from_status text;
  v_owner core.profiles;
begin
  if v_action in ('edit', 'reschedule', 'transfer_owner') then
    if not core.has_cap('events', 'manage_events') then
      raise exception 'Not authorized: events.manage_events';
    end if;
  elsif v_action in ('cancel', 'close', 'reopen') then
    if not core.has_cap('events', 'close_event') then
      raise exception 'Not authorized: events.close_event';
    end if;
  else
    raise exception 'Unsupported event action';
  end if;
  if v_reason is null then raise exception 'A reason is required'; end if;
  if jsonb_typeof(v_changes) <> 'object' then raise exception 'Changes must be an object'; end if;
  if v_expected_updated_at is null then raise exception 'Expected update timestamp is required'; end if;

  select event.* into v_event
    from warehouse.events event
   where event.id = payload->>'event_id'
   for update;
  if not found then raise exception 'Event not found'; end if;
  if v_event.updated_at <> v_expected_updated_at then
    raise exception 'Event changed in another session; reload before saving';
  end if;
  v_from_status := v_event.status;

  if v_action in ('edit', 'reschedule', 'transfer_owner')
     and v_event.status in ('closed', 'cancelled') then
    raise exception 'Reopen the event before changing it';
  end if;
  if v_action = 'edit' then
    v_event.name := coalesce(nullif(pg_catalog.btrim(v_changes->>'name'), ''), v_event.name);
    v_event.type := coalesce(nullif(v_changes->>'type', ''), v_event.type);
    if v_changes ? 'site_location_id' then
      v_event.site_location_id := nullif(v_changes->>'site_location_id', '');
    end if;
  elsif v_action = 'reschedule' then
    v_event.start_date := coalesce(nullif(v_changes->>'start_date', '')::date, v_event.start_date);
    if v_changes ? 'end_date' then v_event.end_date := nullif(v_changes->>'end_date', '')::date; end if;
    if v_event.end_date is not null and v_event.end_date < v_event.start_date then
      raise exception 'End date cannot be before the start date';
    end if;
    v_event.status := case when v_event.start_date > current_date then 'planned' else 'active' end;
  elsif v_action = 'transfer_owner' then
    select profile.* into v_owner from core.profiles profile
     where lower(profile.email) = lower(v_changes->>'owner_email') and profile.status = 'active';
    if not found then raise exception 'Active event owner not found'; end if;
    v_event.owner_id := v_owner.id;
    v_event.owner_email := v_owner.email;
  elsif v_action = 'cancel' then
    if v_event.status not in ('planned', 'active') then raise exception 'Event cannot be cancelled from its current status'; end if;
    v_event.status := 'cancelled';
  elsif v_action = 'close' then
    if v_event.status not in ('planned', 'active') then raise exception 'Event cannot be closed from its current status'; end if;
    v_event.status := 'closed';
  elsif v_action = 'reopen' then
    if v_event.status not in ('closed', 'cancelled') then raise exception 'Only closed or cancelled events can be reopened'; end if;
    v_event.status := case when v_event.start_date > current_date then 'planned' else 'active' end;
  end if;

  update warehouse.events event set
    name = v_event.name, type = v_event.type, site_location_id = v_event.site_location_id,
    start_date = v_event.start_date, end_date = v_event.end_date, status = v_event.status,
    owner_id = v_event.owner_id, owner_email = v_event.owner_email,
    lifecycle_reason = v_reason, updated_at = now()
   where event.id = v_event.id returning * into v_event;

  insert into warehouse.event_lifecycle_events(
    event_id, action, from_status, to_status, reason, changes, actor_id, actor_email
  ) values (
    v_event.id, v_action, v_from_status, v_event.status, v_reason, v_changes,
    auth.uid(), auth.jwt()->>'email'
  );
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('events', 'event', v_event.id, v_action, auth.uid(),
    jsonb_build_object('from_status', v_from_status, 'to_status', v_event.status, 'reason', v_reason));
  return to_jsonb(v_event);
end;
$$;

alter table warehouse.department_stock_requests
  add column if not exists event_id text references warehouse.events(id) on delete restrict;
create index if not exists warehouse_department_request_event_idx
  on warehouse.department_stock_requests(event_id, requested_at desc);

create or replace function warehouse.request_event_fulfillment(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_request warehouse.department_stock_requests;
  v_event warehouse.events;
  v_line jsonb;
  v_product warehouse.products;
begin
  v_started := private.begin_idempotent_command(
    'request_event_fulfillment', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;
  if not core.has_cap('events', 'request_fulfillment') then
    raise exception 'Not authorized: events.request_fulfillment';
  end if;
  select event.* into v_event from warehouse.events event
   where event.id = payload->>'event_id' and event.status in ('planned', 'active');
  if not found then raise exception 'Active event not found'; end if;
  if nullif(pg_catalog.btrim(payload->>'requesting_department'), '') is null
     or nullif(pg_catalog.btrim(payload->>'purpose'), '') is null
     or nullif(pg_catalog.btrim(payload->>'cost_center'), '') is null
     or nullif(payload->>'required_date', '') is null then
    raise exception 'Department, purpose, cost center, and required date are required';
  end if;
  if payload->>'expense_treatment' not in ('expense', 'custody', 'sale') then
    raise exception 'Invalid expense treatment';
  end if;
  if jsonb_typeof(payload->'lines') <> 'array' or jsonb_array_length(payload->'lines') = 0 then
    raise exception 'At least one stock line is required';
  end if;
  for v_line in select value from jsonb_array_elements(payload->'lines') loop
    select product.* into v_product from warehouse.products product where product.id = v_line->>'productId';
    if not found or coalesce((v_line->>'quantity')::integer, 0) <= 0 then
      raise exception 'Every request line must identify a product and positive quantity';
    end if;
    if v_product.item_class not in ('sellable_sku', 'merchandise') then
      raise exception 'Event requests may include only sellable SKU and merchandise items';
    end if;
    if v_product.item_class = 'merchandise' and payload->>'expense_treatment' <> 'expense' then
      raise exception 'All merchandise requests must use expense treatment';
    end if;
  end loop;

  insert into warehouse.department_stock_requests(
    id, event_id, requesting_department, purpose, cost_center, required_date,
    expense_treatment, status, lines, requested_by
  ) values (
    gen_random_uuid(), v_event.id, pg_catalog.btrim(payload->>'requesting_department'),
    pg_catalog.btrim(payload->>'purpose'), pg_catalog.btrim(payload->>'cost_center'),
    (payload->>'required_date')::date, payload->>'expense_treatment',
    'pending_approval', payload->'lines', auth.uid()
  ) returning * into v_request;
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('events', 'fulfillment_request', v_request.id, 'submitted', auth.uid(),
    jsonb_build_object('event_id', v_event.id, 'cost_center', v_request.cost_center));
  return private.finish_idempotent_command(v_command_id, to_jsonb(v_request));
end;
$$;

create or replace function warehouse.propagate_department_request_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.event_id is not null and new.fulfillment_order_id is not null
     and new.fulfillment_order_id is distinct from old.fulfillment_order_id then
    update warehouse.fulfillment_orders fulfillment
       set event_id = new.event_id, updated_at = now()
     where fulfillment.id = new.fulfillment_order_id;
  end if;
  return new;
end;
$$;
drop trigger if exists warehouse_department_request_event_handoff
  on warehouse.department_stock_requests;
create trigger warehouse_department_request_event_handoff
after update of fulfillment_order_id on warehouse.department_stock_requests
for each row execute function warehouse.propagate_department_request_event();

revoke all on function warehouse.propagate_department_request_event() from public, anon, authenticated;
grant execute on function warehouse.propagate_department_request_event() to service_role;

revoke insert, update, delete on warehouse.events from authenticated;
revoke all on function warehouse.create_event(jsonb) from public, anon;
revoke all on function warehouse.manage_event(jsonb) from public, anon;
revoke all on function warehouse.request_event_fulfillment(jsonb) from public, anon;
grant execute on function warehouse.create_event(jsonb) to authenticated, service_role;
grant execute on function warehouse.manage_event(jsonb) to authenticated, service_role;
grant execute on function warehouse.request_event_fulfillment(jsonb) to authenticated, service_role;
