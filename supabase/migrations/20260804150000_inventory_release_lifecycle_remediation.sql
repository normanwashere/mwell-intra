-- Governed inventory release lifecycle: reservations, two-person release,
-- internal handover evidence, recipient acknowledgment, request synchronization,
-- backorders, and cancellation packaging accounting.

create table if not exists core.department_cost_centers (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references core.departments(id) on delete restrict,
  code text not null,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references core.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references core.profiles(id) on delete set null,
  constraint department_cost_center_code_check
    check (pg_catalog.btrim(code) <> ''),
  constraint department_cost_center_name_check
    check (pg_catalog.btrim(name) <> ''),
  unique(department_id, code)
);

create index if not exists department_cost_centers_active_idx
  on core.department_cost_centers(department_id, code)
  where is_active;

insert into core.department_cost_centers(department_id, code, name)
select department.id, seed.code, seed.name
from (values
  ('marketing', 'CC-4100', 'Marketing'),
  ('sales', 'CC-2200', 'Sales'),
  ('product', 'CC-3300', 'Product'),
  ('technology', 'CC-5100', 'Technology'),
  ('pmo', 'CC-6100', 'Project Management Office'),
  ('operations', 'CC-1100', 'Operations'),
  ('operations.warehouse_logistics', 'CC-1110', 'Warehouse and Logistics'),
  ('operations.customer_service', 'CC-1120', 'Customer Service'),
  ('operations.client_product_implementation', 'CC-1130', 'Implementation'),
  ('finance', 'CC-7100', 'Finance'),
  ('procurement', 'CC-8100', 'Procurement'),
  ('legal_compliance', 'CC-9100', 'Legal and Compliance'),
  ('people_culture', 'CC-1000', 'People and Culture'),
  ('administration', 'CC-1200', 'Administration')
) as seed(department_code, code, name)
join core.departments department on department.code = seed.department_code
on conflict (department_id, code) do update set
  name = excluded.name,
  is_active = true,
  updated_at = now();

alter table core.department_cost_centers enable row level security;
drop policy if exists department_cost_centers_read on core.department_cost_centers;
create policy department_cost_centers_read
  on core.department_cost_centers for select to authenticated
  using (true);
revoke insert, update, delete on core.department_cost_centers from authenticated;
grant select on core.department_cost_centers to authenticated;
grant all on core.department_cost_centers to service_role;

create or replace function core.upsert_department_cost_center(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_saved core.department_cost_centers;
  v_id uuid := coalesce(nullif(payload->>'id', '')::uuid, gen_random_uuid());
  v_department_id uuid := nullif(payload->>'department_id', '')::uuid;
  v_code text := upper(nullif(pg_catalog.btrim(payload->>'code'), ''));
  v_name text := nullif(pg_catalog.btrim(payload->>'name'), '');
begin
  if not core.has_cap('core', 'manage_rbac') then
    raise exception 'Not authorized: core.manage_rbac';
  end if;
  if v_department_id is null or not exists (
    select 1 from core.departments department
    where department.id = v_department_id and department.is_active
  ) then raise exception 'An active department is required'; end if;
  if v_code is null or v_name is null then
    raise exception 'Cost center code and name are required';
  end if;
  insert into core.department_cost_centers(
    id, department_id, code, name, is_active, created_by, updated_by
  ) values (
    v_id, v_department_id, v_code, v_name,
    coalesce((payload->>'is_active')::boolean, true), auth.uid(), auth.uid()
  )
  on conflict (id) do update set
    department_id = excluded.department_id,
    code = excluded.code,
    name = excluded.name,
    is_active = excluded.is_active,
    updated_at = now(),
    updated_by = auth.uid()
  returning * into v_saved;
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('core', 'department_cost_center', v_saved.id::text, 'upserted', auth.uid(),
    jsonb_build_object('department_id', v_saved.department_id, 'code', v_saved.code));
  return to_jsonb(v_saved);
end;
$$;
revoke all on function core.upsert_department_cost_center(jsonb) from public, anon;
grant execute on function core.upsert_department_cost_center(jsonb) to authenticated, service_role;

alter table warehouse.fulfillment_orders
  add column if not exists delivery_method text,
  add column if not exists handover_recipient_name text,
  add column if not exists handover_recipient_department text,
  add column if not exists handover_reference text,
  add column if not exists handover_evidence_url text,
  add column if not exists parent_order_id uuid references warehouse.fulfillment_orders(id) on delete restrict,
  add column if not exists picked_by uuid references core.profiles(id) on delete restrict,
  add column if not exists picked_at timestamptz,
  add column if not exists packed_by uuid references core.profiles(id) on delete restrict,
  add column if not exists packed_at timestamptz,
  add column if not exists acknowledged_by uuid references core.profiles(id) on delete restrict,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledgement_reference text,
  add column if not exists acknowledgement_evidence_url text,
  add column if not exists cancellation_reason text,
  add column if not exists packaging_disposition text;

-- Preserve terminal history under the courier-era contract. Open work adopts the
-- correct fulfillment mode so it can continue through the new handover controls.
update warehouse.fulfillment_orders
set delivery_method = case
  when status in ('released', 'cancelled') then 'shipment'
  when source = 'department_request' then 'internal_handover'
  when source = 'event_request' then 'event_handover'
  when source = 'third_party_transfer' then 'third_party_transfer'
  else 'shipment'
end
where delivery_method is null;

-- A ready internal order created before this migration has no accountable handover
-- evidence. Return it to packing so an operator can capture the required details.
update warehouse.fulfillment_orders
set status = 'packing',
    packed_by = null,
    packed_at = null,
    updated_at = now()
where status = 'ready'
  and delivery_method <> 'shipment';
alter table warehouse.fulfillment_orders
  alter column delivery_method set not null,
  alter column delivery_method set default 'shipment';

alter table warehouse.fulfillment_orders
  drop constraint if exists warehouse_fulfillment_status_check,
  drop constraint if exists warehouse_fulfillment_release_check,
  drop constraint if exists warehouse_fulfillment_delivery_method_check,
  drop constraint if exists warehouse_fulfillment_packaging_disposition_check;
alter table warehouse.fulfillment_orders
  add constraint warehouse_fulfillment_status_check check (
    status in ('received', 'allocated', 'picking', 'packing', 'ready', 'released', 'completed', 'cancelled')
  ),
  add constraint warehouse_fulfillment_delivery_method_check check (
    delivery_method in ('shipment', 'internal_handover', 'event_handover', 'third_party_transfer')
  ),
  add constraint warehouse_fulfillment_packaging_disposition_check check (
    packaging_disposition is null or packaging_disposition in ('returned_to_stock', 'consumed')
  ),
  add constraint warehouse_fulfillment_release_check check (
    status not in ('released', 'completed') or (
      released_by is not null and released_at is not null and (
        (
          delivery_method = 'shipment'
          and nullif(pg_catalog.btrim(courier), '') is not null
          and nullif(pg_catalog.btrim(waybill_number), '') is not null
        ) or (
          delivery_method <> 'shipment'
          and nullif(pg_catalog.btrim(handover_recipient_name), '') is not null
          and nullif(pg_catalog.btrim(handover_recipient_department), '') is not null
          and nullif(pg_catalog.btrim(handover_reference), '') is not null
          and nullif(pg_catalog.btrim(handover_evidence_url), '') is not null
        )
      )
    )
  ) not valid;

drop index if exists warehouse.warehouse_fulfillment_work_queue_idx;
create index warehouse_fulfillment_work_queue_idx
  on warehouse.fulfillment_orders(status, updated_at desc, id)
  where status not in ('released', 'completed', 'cancelled');
create index if not exists warehouse_fulfillment_parent_idx
  on warehouse.fulfillment_orders(parent_order_id);
create index if not exists warehouse_fulfillment_packed_by_idx
  on warehouse.fulfillment_orders(packed_by);
create index if not exists warehouse_fulfillment_acknowledged_by_idx
  on warehouse.fulfillment_orders(acknowledged_by);

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
  return new;
end;
$$;

revoke all on function warehouse.assign_fulfillment_delivery_method() from public, anon, authenticated;
drop trigger if exists warehouse_fulfillment_delivery_method on warehouse.fulfillment_orders;
create trigger warehouse_fulfillment_delivery_method
before insert on warehouse.fulfillment_orders
for each row execute function warehouse.assign_fulfillment_delivery_method();

create table warehouse.fulfillment_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references warehouse.fulfillment_orders(id) on delete restrict,
  product_id text not null references warehouse.products(id) on delete restrict,
  location_id text references warehouse.locations(id) on delete restrict,
  bin_id text references warehouse.storage_areas(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  status text not null default 'active' check (status in ('active', 'released', 'cancelled')),
  created_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique(order_id, product_id)
);
create index fulfillment_reservations_active_product_idx
  on warehouse.fulfillment_reservations(product_id, location_id, bin_id)
  where status = 'active';
alter table warehouse.fulfillment_reservations enable row level security;
create policy fulfillment_reservations_read
  on warehouse.fulfillment_reservations for select to authenticated using (
    core.has_cap('warehouse', 'view_inventory')
    or exists (
      select 1 from warehouse.fulfillment_orders fulfillment
      where fulfillment.id = order_id and fulfillment.created_by = auth.uid()
    )
  );
revoke insert, update, delete on warehouse.fulfillment_reservations from authenticated;
grant select on warehouse.fulfillment_reservations to authenticated;
grant all on warehouse.fulfillment_reservations to service_role;

create or replace view warehouse.department_request_options
with (security_invoker = true)
as
select
  department.code as department_code,
  department.name as department_name,
  cost_center.code as cost_center_code,
  cost_center.name as cost_center_name
from core.departments department
join core.department_cost_centers cost_center
  on cost_center.department_id = department.id
where department.is_active and cost_center.is_active;
grant select on warehouse.department_request_options to authenticated, service_role;

create or replace function warehouse.sync_department_request_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update warehouse.department_stock_requests request
  set status = case new.status
    when 'received' then 'approved'
    when 'allocated' then 'allocated'
    when 'picking' then 'allocated'
    when 'packing' then 'allocated'
    when 'ready' then 'allocated'
    when 'released' then 'issued'
    when 'completed' then 'closed'
    when 'cancelled' then 'cancelled'
    else request.status
  end
  where request.fulfillment_order_id = new.id;
  return new;
end;
$$;
drop trigger if exists warehouse_fulfillment_request_status_sync
  on warehouse.fulfillment_orders;
create trigger warehouse_fulfillment_request_status_sync
after update of status on warehouse.fulfillment_orders
for each row when (old.status is distinct from new.status)
execute function warehouse.sync_department_request_status();
revoke all on function warehouse.sync_department_request_status() from public, anon, authenticated;
grant execute on function warehouse.sync_department_request_status() to service_role;

create or replace function private.warehouse_create_department_stock_request(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_request warehouse.department_stock_requests;
  v_line jsonb;
  v_product warehouse.products;
  v_department core.departments;
begin
  v_started := private.begin_idempotent_command(
    'create_department_stock_request', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;
  if not core.has_cap('warehouse', 'request_stock') then
    raise exception 'Not authorized: warehouse.request_stock';
  end if;
  select * into v_department from core.departments department
  where department.code = pg_catalog.btrim(payload->>'requesting_department')
    and department.is_active;
  if not found then raise exception 'Select an active configured department'; end if;
  if not exists (
    select 1 from core.department_cost_centers cost_center
    where cost_center.department_id = v_department.id
      and cost_center.code = pg_catalog.btrim(payload->>'cost_center')
      and cost_center.is_active
  ) then raise exception 'Select an active cost center for the requesting department'; end if;
  if nullif(pg_catalog.btrim(payload->>'purpose'), '') is null
     or nullif(payload->>'required_date', '') is null then
    raise exception 'Purpose and required date are required';
  end if;
  if payload->>'expense_treatment' not in ('expense', 'custody', 'sale') then
    raise exception 'Invalid expense treatment';
  end if;
  if jsonb_typeof(payload->'lines') <> 'array' or jsonb_array_length(payload->'lines') = 0 then
    raise exception 'At least one stock line is required';
  end if;
  for v_line in select value from jsonb_array_elements(payload->'lines') loop
    select * into v_product from warehouse.products product where product.id = v_line->>'productId';
    if not found or coalesce((v_line->>'quantity')::integer, 0) <= 0 then
      raise exception 'Every request line must identify a product and positive quantity';
    end if;
    if v_product.item_class not in ('sellable_sku', 'merchandise', 'event_material') then
      raise exception 'Department requests may include only sellable SKU, merchandise, and event material items';
    end if;
    if v_product.item_class = 'merchandise' and payload->>'expense_treatment' <> 'expense' then
      raise exception 'All merchandise requests must use expense treatment';
    end if;
  end loop;
  insert into warehouse.department_stock_requests(
    id, requesting_department, purpose, cost_center, required_date,
    expense_treatment, status, lines, requested_by
  ) values (
    (payload->>'request_id')::uuid, v_department.code,
    pg_catalog.btrim(payload->>'purpose'), pg_catalog.btrim(payload->>'cost_center'),
    (payload->>'required_date')::date, payload->>'expense_treatment',
    'pending_approval', payload->'lines', auth.uid()
  ) returning * into v_request;
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('warehouse', 'department_stock_request', v_request.id, 'submitted', auth.uid(),
    jsonb_build_object('department', v_request.requesting_department, 'cost_center', v_request.cost_center));
  return private.finish_idempotent_command(v_command_id, to_jsonb(v_request));
end;
$$;

create or replace function private.warehouse_advance_fulfillment_order_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
    for v_line in select value from jsonb_array_elements(v_order.lines) loop
      select value into v_selection from jsonb_array_elements(coalesce(payload->'fulfilled_lines', '[]'::jsonb))
      where value->>'productId' = v_line->>'productId' limit 1;
      if v_selection is null or coalesce((v_selection->>'quantity')::integer, 0) <= 0
         or (v_selection->>'quantity')::integer > (v_line->>'quantity')::integer then
        raise exception 'Every line must keep a positive quantity that does not exceed original demand';
      end if;
      v_current_lines := v_current_lines || jsonb_build_array(
        v_line || jsonb_build_object('quantity', (v_selection->>'quantity')::integer)
      );
      v_remainder := (v_line->>'quantity')::integer - (v_selection->>'quantity')::integer;
      if v_remainder > 0 then
        v_backorder_lines := v_backorder_lines || jsonb_build_array(
          v_line || jsonb_build_object('quantity', v_remainder)
        );
      end if;
    end loop;
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
$$;

create or replace function warehouse.advance_fulfillment_order(payload jsonb)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.warehouse_advance_fulfillment_order_v2(payload) $$;
revoke all on function private.warehouse_advance_fulfillment_order_v2(jsonb)
  from public, anon, authenticated;
grant execute on function private.warehouse_advance_fulfillment_order_v2(jsonb)
  to service_role;
revoke all on function warehouse.advance_fulfillment_order(jsonb) from public, anon;
grant execute on function warehouse.advance_fulfillment_order(jsonb)
  to authenticated, service_role;

-- Event fulfillment requests use the same governed product and accounting
-- contract as ordinary department demand.
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
  v_department core.departments;
begin
  v_started := private.begin_idempotent_command(
    'request_event_fulfillment', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;
  if not core.has_cap('events', 'request_fulfillment') then
    raise exception 'Not authorized: events.request_fulfillment';
  end if;
  select * into v_event from warehouse.events event
  where event.id = payload->>'event_id' and event.status in ('planned', 'active');
  if not found then raise exception 'Active event not found'; end if;
  select * into v_department from core.departments department
  where department.code = pg_catalog.btrim(payload->>'requesting_department')
    and department.is_active;
  if not found then raise exception 'Select an active configured department'; end if;
  if not exists (
    select 1 from core.department_cost_centers cost_center
    where cost_center.department_id = v_department.id
      and cost_center.code = pg_catalog.btrim(payload->>'cost_center')
      and cost_center.is_active
  ) then raise exception 'Select an active cost center for the requesting department'; end if;
  if nullif(pg_catalog.btrim(payload->>'purpose'), '') is null
     or nullif(payload->>'required_date', '') is null then
    raise exception 'Purpose and required date are required';
  end if;
  if payload->>'expense_treatment' not in ('expense', 'custody', 'sale') then
    raise exception 'Invalid expense treatment';
  end if;
  if jsonb_typeof(payload->'lines') <> 'array' or jsonb_array_length(payload->'lines') = 0 then
    raise exception 'At least one stock line is required';
  end if;
  for v_line in select value from jsonb_array_elements(payload->'lines') loop
    select * into v_product from warehouse.products product where product.id = v_line->>'productId';
    if not found or coalesce((v_line->>'quantity')::integer, 0) <= 0 then
      raise exception 'Every request line must identify a product and positive quantity';
    end if;
    if v_product.item_class not in ('sellable_sku', 'merchandise', 'event_material') then
      raise exception 'Event requests may include only sellable SKU, merchandise, and event material items';
    end if;
    if v_product.item_class = 'merchandise' and payload->>'expense_treatment' <> 'expense' then
      raise exception 'All merchandise requests must use expense treatment';
    end if;
  end loop;
  insert into warehouse.department_stock_requests(
    id, event_id, requesting_department, purpose, cost_center, required_date,
    expense_treatment, status, lines, requested_by
  ) values (
    gen_random_uuid(), v_event.id, v_department.code,
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
revoke all on function warehouse.request_event_fulfillment(jsonb) from public, anon;
grant execute on function warehouse.request_event_fulfillment(jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
