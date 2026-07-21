-- Cross-department WMS persistence. All commands are authenticated,
-- capability-gated, idempotent, server-attributed, and audited.

insert into core.capabilities(module, cap) values
  ('warehouse', 'request_fulfillment'),
  ('warehouse', 'request_stock'),
  ('warehouse', 'submit_return_case')
on conflict do nothing;

delete from core.role_capabilities
where module = 'warehouse'
  and role in ('operations', 'business_unit', 'marketing')
  and cap in (
    'receive_stock', 'cycle_count', 'reserve_allocate', 'issue_items',
    'manage_returns', 'transfer_stock', 'inspect_quality', 'view_exceptions'
  );

insert into core.role_capabilities(module, role, cap) values
  ('warehouse', 'operations', 'view_dashboard'),
  ('warehouse', 'operations', 'manage_inventory'),
  ('warehouse', 'operations', 'request_fulfillment'),
  ('warehouse', 'operations', 'request_stock'),
  ('warehouse', 'operations', 'submit_return_case'),
  ('warehouse', 'business_unit', 'request_stock'),
  ('warehouse', 'marketing', 'request_stock'),
  ('warehouse', 'warehouse_admin', 'request_fulfillment'),
  ('warehouse', 'warehouse_admin', 'request_stock'),
  ('warehouse', 'warehouse_operator', 'submit_return_case'),
  ('warehouse', 'warehouse_supervisor', 'submit_return_case'),
  ('warehouse', 'logistics_supervisor', 'submit_return_case'),
  ('warehouse', 'warehouse_admin', 'submit_return_case')
on conflict do nothing;

alter table warehouse.products add column if not exists item_class text;
alter table warehouse.products add column if not exists serialization_policy text;
alter table warehouse.products add column if not exists uom text;

alter table warehouse.receipts add column if not exists actual_delivery_date date;
alter table warehouse.receipts add column if not exists delivery_reference text;
alter table warehouse.receipts add column if not exists courier_or_driver text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'warehouse_receipt_delivery_reference_check') then
    alter table warehouse.receipts add constraint warehouse_receipt_delivery_reference_check check (
      delivery_reference is null or pg_catalog.length(pg_catalog.btrim(delivery_reference)) between 1 and 120
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'warehouse_receipt_courier_driver_check') then
    alter table warehouse.receipts add constraint warehouse_receipt_courier_driver_check check (
      courier_or_driver is null or pg_catalog.length(pg_catalog.btrim(courier_or_driver)) between 1 and 160
    );
  end if;
end
$$;

update warehouse.products
set item_class = coalesce(
      item_class,
      case when category = 'device' then 'sellable_sku' else 'merchandise' end
    ),
    serialization_policy = coalesce(
      serialization_policy,
      case coalesce(
        item_class,
        case when category = 'device' then 'sellable_sku' else 'merchandise' end
      )
        when 'sellable_sku' then 'required'
        when 'warehouse_tool' then 'asset_tag'
        when 're_kitted_item' then 'required'
        else 'none'
      end
    ),
    uom = coalesce(nullif(pg_catalog.btrim(uom), ''), 'piece');

alter table warehouse.products alter column item_class set default 'merchandise';
alter table warehouse.products alter column item_class set not null;
alter table warehouse.products alter column serialization_policy set default 'none';
alter table warehouse.products alter column serialization_policy set not null;
alter table warehouse.products alter column uom set default 'piece';
alter table warehouse.products alter column uom set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'warehouse_product_item_class_check') then
    alter table warehouse.products add constraint warehouse_product_item_class_check check (
      item_class in (
        'sellable_sku', 'merchandise', 'event_material', 'fulfillment_supply',
        'warehouse_tool', 're_kitted_item'
      )
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'warehouse_product_serialization_policy_check') then
    alter table warehouse.products add constraint warehouse_product_serialization_policy_check check (
      serialization_policy in ('required', 'optional', 'none', 'asset_tag')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'warehouse_product_serialization_consistency_check') then
    alter table warehouse.products add constraint warehouse_product_serialization_consistency_check check (
      (serialization_policy in ('required', 'asset_tag') and serialized)
      or (serialization_policy = 'none' and not serialized)
      or serialization_policy = 'optional'
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'warehouse_product_uom_check') then
    alter table warehouse.products add constraint warehouse_product_uom_check check (
      pg_catalog.length(pg_catalog.btrim(uom)) between 1 and 40
    );
  end if;
end
$$;

create table if not exists warehouse.fulfillment_orders (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_reference text not null,
  requesting_department text,
  source_location_id text references warehouse.locations(id) on delete restrict,
  source_bin_id text references warehouse.storage_areas(id) on delete restrict,
  customer_reference text,
  event_id text references warehouse.events(id) on delete restrict,
  third_party_location_id text references warehouse.locations(id) on delete restrict,
  gross_sales_amount numeric(14,2),
  courier text,
  waybill_number text,
  status text not null default 'received',
  lines jsonb not null default '[]'::jsonb,
  packaging jsonb not null default '[]'::jsonb,
  created_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  released_by uuid references core.profiles(id) on delete restrict,
  released_at timestamptz,
  constraint warehouse_fulfillment_source_check check (
    source in ('ecommerce', 'department_request', 'event', 'third_party')
  ),
  constraint warehouse_fulfillment_status_check check (
    status in ('received', 'allocated', 'picking', 'packing', 'ready', 'released', 'cancelled')
  ),
  constraint warehouse_fulfillment_lines_check check (
    jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0
  ),
  constraint warehouse_fulfillment_packaging_check check (jsonb_typeof(packaging) = 'array'),
  constraint warehouse_fulfillment_sales_check check (
    gross_sales_amount is null or gross_sales_amount >= 0
  ),
  constraint warehouse_fulfillment_release_check check (
    (status <> 'released') or (
      released_by is not null and released_at is not null
      and nullif(pg_catalog.btrim(courier), '') is not null
      and nullif(pg_catalog.btrim(waybill_number), '') is not null
    )
  )
);
create unique index if not exists warehouse_fulfillment_external_reference_uq
  on warehouse.fulfillment_orders (pg_catalog.lower(external_reference));
create index if not exists warehouse_fulfillment_work_queue_idx
  on warehouse.fulfillment_orders (status, updated_at desc, id)
  where status not in ('released', 'cancelled');
create index if not exists warehouse_fulfillment_source_location_idx
  on warehouse.fulfillment_orders (source_location_id, status);
create index if not exists warehouse_fulfillment_source_bin_idx
  on warehouse.fulfillment_orders (source_bin_id);
create index if not exists warehouse_fulfillment_event_idx
  on warehouse.fulfillment_orders (event_id);
create index if not exists warehouse_fulfillment_third_party_location_idx
  on warehouse.fulfillment_orders (third_party_location_id);
create index if not exists warehouse_fulfillment_created_by_idx
  on warehouse.fulfillment_orders (created_by);
create index if not exists warehouse_fulfillment_released_by_idx
  on warehouse.fulfillment_orders (released_by);

create table if not exists warehouse.department_stock_requests (
  id uuid primary key default gen_random_uuid(),
  requesting_department text not null,
  purpose text not null,
  cost_center text not null,
  required_date date not null,
  expense_treatment text not null,
  status text not null default 'pending_approval',
  lines jsonb not null default '[]'::jsonb,
  requested_by uuid not null references core.profiles(id) on delete restrict,
  requested_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  approved_by uuid references core.profiles(id) on delete restrict,
  approved_at timestamptz,
  fulfillment_order_id uuid references warehouse.fulfillment_orders(id) on delete restrict,
  constraint warehouse_department_request_expense_check check (
    expense_treatment in ('expense', 'custody', 'sale')
  ),
  constraint warehouse_department_request_status_check check (
    status in (
      'draft', 'pending_approval', 'approved', 'rejected', 'allocated',
      'issued', 'closed', 'cancelled'
    )
  ),
  constraint warehouse_department_request_lines_check check (
    jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) > 0
  ),
  constraint warehouse_department_request_decision_check check (
    (status not in ('approved', 'rejected')) or (approved_by is not null and approved_at is not null)
  )
);
create index if not exists warehouse_department_request_queue_idx
  on warehouse.department_stock_requests (status, required_date, requested_at, id)
  where status = 'pending_approval';
create index if not exists warehouse_department_request_owner_idx
  on warehouse.department_stock_requests (requested_by, requested_at desc);
create index if not exists warehouse_department_request_approved_by_idx
  on warehouse.department_stock_requests (approved_by);
create index if not exists warehouse_department_request_fulfillment_idx
  on warehouse.department_stock_requests (fulfillment_order_id);

create table if not exists warehouse.customer_return_cases (
  id uuid primary key default gen_random_uuid(),
  source_order_id uuid references warehouse.fulfillment_orders(id) on delete restrict,
  serial_number text,
  product_id text not null references warehouse.products(id) on delete restrict,
  defect_description text not null,
  requesting_department text not null default 'customer_service',
  status text not null default 'submitted',
  resolution text not null default 'pending',
  quarantine_bin_id text references warehouse.storage_areas(id) on delete restrict,
  replacement_order_id uuid references warehouse.fulfillment_orders(id) on delete restrict,
  refund_reference text,
  supplier_reference text,
  created_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  resolved_by uuid references core.profiles(id) on delete restrict,
  resolved_at timestamptz,
  constraint warehouse_customer_return_department_check check (
    requesting_department = 'customer_service'
  ),
  constraint warehouse_customer_return_status_check check (
    status in ('submitted', 'received', 'inspecting', 'decision_required', 'resolved')
  ),
  constraint warehouse_customer_return_resolution_check check (
    resolution in ('pending', 'replacement', 'refund', 'vendor_return', 're_kit', 'write_off')
  ),
  constraint warehouse_customer_return_resolved_check check (
    (status <> 'resolved' and resolution = 'pending' and resolved_by is null and resolved_at is null)
    or (status = 'resolved' and resolution <> 'pending' and resolved_by is not null and resolved_at is not null)
  )
);
create index if not exists warehouse_customer_return_serial_idx
  on warehouse.customer_return_cases (product_id, serial_number)
  where serial_number is not null;
create index if not exists warehouse_customer_return_queue_idx
  on warehouse.customer_return_cases (status, created_at, id)
  where status <> 'resolved';
create index if not exists warehouse_customer_return_source_order_idx
  on warehouse.customer_return_cases (source_order_id);
create index if not exists warehouse_customer_return_quarantine_bin_idx
  on warehouse.customer_return_cases (quarantine_bin_id);
create index if not exists warehouse_customer_return_replacement_order_idx
  on warehouse.customer_return_cases (replacement_order_id);
create index if not exists warehouse_customer_return_created_by_idx
  on warehouse.customer_return_cases (created_by);
create index if not exists warehouse_customer_return_resolved_by_idx
  on warehouse.customer_return_cases (resolved_by);

create table if not exists warehouse.kit_definitions (
  id uuid primary key default gen_random_uuid(),
  product_id text not null references warehouse.products(id) on delete restrict,
  version integer not null,
  name text not null,
  components jsonb not null default '[]'::jsonb,
  status text not null default 'draft',
  owner_department text not null default 'product',
  product_approval_reference text not null,
  created_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (product_id, version),
  constraint warehouse_kit_version_check check (version > 0),
  constraint warehouse_kit_components_check check (
    jsonb_typeof(components) = 'array' and jsonb_array_length(components) > 0
  ),
  constraint warehouse_kit_status_check check (status in ('draft', 'active', 'retired')),
  constraint warehouse_kit_owner_check check (owner_department = 'product')
);
create index if not exists warehouse_kit_product_status_idx
  on warehouse.kit_definitions (product_id, status, version desc);
create index if not exists warehouse_kit_created_by_idx
  on warehouse.kit_definitions (created_by);

alter table warehouse.kit_definitions add column if not exists product_approval_reference text;
update warehouse.kit_definitions
set product_approval_reference = 'LEGACY-REVIEW-REQUIRED'
where nullif(pg_catalog.btrim(product_approval_reference), '') is null;
alter table warehouse.kit_definitions alter column product_approval_reference set not null;

create table if not exists warehouse.rekit_work_orders (
  id uuid primary key default gen_random_uuid(),
  source_return_case_id uuid not null references warehouse.customer_return_cases(id) on delete restrict,
  kit_definition_id uuid not null references warehouse.kit_definitions(id) on delete restrict,
  output_serial_number text not null unique,
  component_serial_numbers jsonb not null default '[]'::jsonb,
  condition text not null,
  status text not null default 'inspection',
  created_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_by uuid references core.profiles(id) on delete restrict,
  completed_at timestamptz,
  constraint warehouse_rekit_component_serials_check check (
    jsonb_typeof(component_serial_numbers) = 'array'
  ),
  constraint warehouse_rekit_condition_check check (condition in ('open_box', 'reconditioned')),
  constraint warehouse_rekit_status_check check (
    status in ('draft', 'inspection', 'ready', 'completed', 'cancelled')
  ),
  constraint warehouse_rekit_complete_check check (
    (status <> 'completed') or (completed_by is not null and completed_at is not null)
  )
);
create index if not exists warehouse_rekit_queue_idx
  on warehouse.rekit_work_orders (status, created_at, id)
  where status not in ('completed', 'cancelled');
create index if not exists warehouse_rekit_source_return_idx
  on warehouse.rekit_work_orders (source_return_case_id);
create index if not exists warehouse_rekit_definition_idx
  on warehouse.rekit_work_orders (kit_definition_id);
create index if not exists warehouse_rekit_created_by_idx
  on warehouse.rekit_work_orders (created_by);
create index if not exists warehouse_rekit_completed_by_idx
  on warehouse.rekit_work_orders (completed_by);

alter table warehouse.fulfillment_orders enable row level security;
alter table warehouse.department_stock_requests enable row level security;
alter table warehouse.customer_return_cases enable row level security;
alter table warehouse.kit_definitions enable row level security;
alter table warehouse.rekit_work_orders enable row level security;

drop policy if exists fulfillment_orders_read on warehouse.fulfillment_orders;
create policy fulfillment_orders_read on warehouse.fulfillment_orders for select to authenticated using (
  created_by = (select auth.uid())
  or exists (
    select 1 from warehouse.department_stock_requests request
     where request.fulfillment_order_id = fulfillment_orders.id
       and request.requested_by = (select auth.uid())
  )
  or core.has_cap('warehouse', 'view_dashboard')
  or core.has_cap('warehouse', 'request_fulfillment')
  or core.has_cap('warehouse', 'reserve_allocate')
  or core.has_cap('warehouse', 'issue_items')
);
drop policy if exists department_stock_requests_read on warehouse.department_stock_requests;
create policy department_stock_requests_read on warehouse.department_stock_requests for select to authenticated using (
  requested_by = (select auth.uid())
  or core.has_cap('warehouse', 'issue_items')
  or core.has_cap('procurement', 'approve_request')
);
drop policy if exists customer_return_cases_read on warehouse.customer_return_cases;
create policy customer_return_cases_read on warehouse.customer_return_cases for select to authenticated using (
  created_by = (select auth.uid())
  or core.has_cap('warehouse', 'manage_returns')
  or core.has_cap('warehouse', 'approve_stock_adjustment_finance')
);
drop policy if exists kit_definitions_read on warehouse.kit_definitions;
create policy kit_definitions_read on warehouse.kit_definitions for select to authenticated using (
  core.has_cap('core', 'view_directory')
  or core.has_cap('warehouse', 'manage_products')
);
drop policy if exists rekit_work_orders_read on warehouse.rekit_work_orders;
create policy rekit_work_orders_read on warehouse.rekit_work_orders for select to authenticated using (
  core.has_cap('warehouse', 'manage_returns')
  or core.has_cap('warehouse', 'manage_products')
);

grant select on warehouse.fulfillment_orders to authenticated;
grant select on warehouse.department_stock_requests to authenticated;
grant select on warehouse.customer_return_cases to authenticated;
grant select on warehouse.kit_definitions to authenticated;
grant select on warehouse.rekit_work_orders to authenticated;
grant all on warehouse.fulfillment_orders to service_role;
grant all on warehouse.department_stock_requests to service_role;
grant all on warehouse.customer_return_cases to service_role;
grant all on warehouse.kit_definitions to service_role;
grant all on warehouse.rekit_work_orders to service_role;
revoke insert, update, delete on
  warehouse.fulfillment_orders,
  warehouse.department_stock_requests,
  warehouse.customer_return_cases,
  warehouse.kit_definitions,
  warehouse.rekit_work_orders
from authenticated;

create or replace function private.warehouse_create_fulfillment_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started jsonb;
  v_command_id uuid;
  v_order warehouse.fulfillment_orders;
  v_line jsonb;
begin
  v_started := private.begin_idempotent_command(
    'create_fulfillment_order', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;

  if not (
    core.has_cap('warehouse', 'request_fulfillment')
    or core.has_cap('events', 'request_fulfillment')
  ) then raise exception 'Not authorized: create fulfillment order'; end if;
  if payload->>'source' not in ('ecommerce', 'department_request', 'event', 'third_party') then
    raise exception 'Invalid fulfillment source';
  end if;
  if nullif(pg_catalog.btrim(payload->>'external_reference'), '') is null then
    raise exception 'Order reference is required';
  end if;
  if jsonb_typeof(payload->'lines') <> 'array' or jsonb_array_length(payload->'lines') = 0 then
    raise exception 'At least one order line is required';
  end if;
  for v_line in select value from jsonb_array_elements(payload->'lines') loop
    if nullif(v_line->>'productId', '') is null
       or not exists (select 1 from warehouse.products p where p.id = v_line->>'productId') then
      raise exception 'Unknown product: %', coalesce(v_line->>'productId', '');
    end if;
    if not exists (
      select 1
      from warehouse.products p
      where p.id = v_line->>'productId'
        and (
          (payload->>'source' = 'ecommerce' and p.item_class in ('sellable_sku', 're_kitted_item'))
          or (payload->>'source' = 'department_request' and p.item_class in ('sellable_sku', 'merchandise'))
          or (payload->>'source' in ('event', 'third_party') and p.item_class in (
            'sellable_sku', 're_kitted_item', 'merchandise', 'event_material'
          ))
        )
    ) then
      raise exception 'Product % is not eligible for % fulfillment',
        v_line->>'productId', payload->>'source';
    end if;
    if coalesce((v_line->>'quantity')::integer, 0) <= 0 then
      raise exception 'Order quantities must be greater than zero';
    end if;
    if v_line ? 'bundleSetCodes' and (
      jsonb_typeof(v_line->'bundleSetCodes') <> 'array'
      or jsonb_array_length(v_line->'bundleSetCodes') <> (v_line->>'quantity')::integer
    ) then raise exception 'Bundle set codes must identify every customer-facing set'; end if;
  end loop;
  if nullif(payload->>'source_bin_id', '') is not null and not exists (
    select 1 from warehouse.storage_areas b
    where b.id = payload->>'source_bin_id'
      and b.location_id = payload->>'source_location_id' and b.active
  ) then raise exception 'Source bin does not belong to the active source location'; end if;
  if payload->>'source' = 'event' and nullif(payload->>'event_id', '') is null then
    raise exception 'An event is required for event fulfillment';
  end if;
  if payload->>'source' = 'third_party' and nullif(payload->>'third_party_location_id', '') is null then
    raise exception 'A third-party location is required';
  end if;
  if payload->>'source' = 'third_party' and nullif(payload->>'event_id', '') is null then
    raise exception 'An event is required for third-party sales';
  end if;
  if payload->>'source' = 'third_party' and (
    nullif(payload->>'gross_sales_amount', '') is null
    or (payload->>'gross_sales_amount')::numeric < 0
  ) then raise exception 'Gross sales amount is required for third-party sales'; end if;

  insert into warehouse.fulfillment_orders(
    id, source, external_reference, requesting_department, source_location_id,
    source_bin_id, customer_reference, event_id, third_party_location_id, gross_sales_amount,
    status, lines, packaging, created_by
  ) values (
    (payload->>'order_id')::uuid, payload->>'source', pg_catalog.btrim(payload->>'external_reference'),
    nullif(pg_catalog.btrim(coalesce(payload->>'requesting_department', '')), ''),
    nullif(payload->>'source_location_id', ''), nullif(payload->>'source_bin_id', ''),
    nullif(pg_catalog.btrim(coalesce(payload->>'customer_reference', '')), ''),
    nullif(payload->>'event_id', ''), nullif(payload->>'third_party_location_id', ''),
    nullif(payload->>'gross_sales_amount', '')::numeric,
    'received', payload->'lines', '[]'::jsonb, auth.uid()
  ) returning * into v_order;

  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('warehouse', 'fulfillment_order', v_order.id, 'created', auth.uid(),
    jsonb_build_object('source', v_order.source, 'external_reference', v_order.external_reference));
  return private.finish_idempotent_command(v_command_id, to_jsonb(v_order));
end;
$$;

create or replace function private.warehouse_advance_fulfillment_order(payload jsonb)
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
  v_next_status text;
  v_line jsonb;
  v_pick jsonb;
  v_material jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_product warehouse.products;
  v_unit warehouse.inventory_units;
  v_stock warehouse.stock_levels;
  v_serial text;
  v_available integer;
  v_committed integer;
  v_remaining integer;
  v_take integer;
  v_held integer;
  v_actor text;
begin
  v_started := private.begin_idempotent_command(
    'advance_fulfillment_order', payload->>'idempotency_key', payload
  );
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;

  if v_action in ('allocate', 'cancel') then
    if not core.has_cap('warehouse', 'reserve_allocate') then
      raise exception 'Not authorized: warehouse.reserve_allocate';
    end if;
  elsif not core.has_cap('warehouse', 'issue_items') then
    raise exception 'Not authorized: warehouse.issue_items';
  end if;

  select * into v_order from warehouse.fulfillment_orders
   where id = (payload->>'order_id')::uuid for update;
  if not found then raise exception 'Fulfillment order not found'; end if;
  v_next_status := case
    when v_order.status = 'received' and v_action = 'allocate' then 'allocated'
    when v_order.status = 'allocated' and v_action = 'start_picking' then 'picking'
    when v_order.status = 'picking' and v_action = 'confirm_pick' then 'packing'
    when v_order.status = 'packing' and v_action in ('confirm_pack', 'mark_ready') then 'ready'
    when v_order.status = 'ready' and v_action = 'release' then 'released'
    when v_order.status in ('received', 'allocated', 'picking', 'packing', 'ready')
      and v_action = 'cancel' then 'cancelled'
    else null end;
  if v_next_status is null then
    raise exception 'Cannot % an order while it is %', replace(v_action, '_', ' '), v_order.status;
  end if;

  if v_action = 'allocate' then
    for v_line in select value from jsonb_array_elements(v_order.lines) loop
      select * into v_product from warehouse.products
       where id = v_line->>'productId' for update;
      if v_product.serialized then
        select count(*) into v_available from warehouse.inventory_units unit
         where unit.product_id = v_product.id and unit.status = 'in_stock'
           and (v_order.source_location_id is null or unit.location_id = v_order.source_location_id)
           and (v_order.source_bin_id is null or unit.bin_id = v_order.source_bin_id)
           and not exists (
             select 1 from warehouse.inventory_holds hold
              where hold.status = 'active' and hold.product_id = unit.product_id
                and hold.serial_number = unit.serial_number
           );
      else
        select coalesce(sum(level.quantity), 0)::integer into v_available
          from warehouse.stock_levels level
         where level.product_id = v_product.id
           and (v_order.source_location_id is null or level.location_id = v_order.source_location_id)
           and (v_order.source_bin_id is null or level.bin_id = v_order.source_bin_id);
        select coalesce(sum(hold.quantity), 0)::integer into v_held
          from warehouse.inventory_holds hold
         where hold.status = 'active' and hold.product_id = v_product.id
           and hold.serial_number is null
           and (v_order.source_location_id is null or hold.location_id = v_order.source_location_id)
           and (v_order.source_bin_id is null or hold.bin_id = v_order.source_bin_id);
        v_available := greatest(0, v_available - v_held);
      end if;
      select coalesce(sum((other_line->>'quantity')::integer), 0)::integer into v_committed
        from warehouse.fulfillment_orders other_order
        cross join lateral jsonb_array_elements(other_order.lines) other_line
       where other_order.id <> v_order.id
         and other_order.status in ('allocated', 'picking', 'packing', 'ready')
         and other_line->>'productId' = v_product.id
         and (
           v_order.source_location_id is null
           or other_order.source_location_id is null
           or other_order.source_location_id = v_order.source_location_id
         )
         and (
           v_order.source_bin_id is null
           or other_order.source_bin_id is null
           or other_order.source_bin_id = v_order.source_bin_id
         );
      if v_available - v_committed < (v_line->>'quantity')::integer then
        raise exception 'Only % of % is available for this order',
          greatest(0, v_available - v_committed), v_product.name;
      end if;
    end loop;
  elsif v_action = 'confirm_pick' then
    if jsonb_typeof(payload->'picked_lines') <> 'array' then
      raise exception 'Picked lines must be an array';
    end if;
    if exists (
      select 1
        from jsonb_array_elements(payload->'picked_lines') picked,
             lateral jsonb_array_elements_text(coalesce(picked->'serialNumbers', '[]'::jsonb)) serial
       group by serial having count(*) > 1
    ) then raise exception 'A serial number cannot be scanned twice'; end if;
    for v_line in select value from jsonb_array_elements(v_order.lines) loop
      select value into v_pick from jsonb_array_elements(payload->'picked_lines')
       where value->>'productId' = v_line->>'productId' limit 1;
      if v_pick is null or coalesce((v_pick->>'quantity')::integer, 0) <> (v_line->>'quantity')::integer then
        raise exception 'Every order line must be picked in full';
      end if;
      select * into v_product from warehouse.products where id = v_line->>'productId';
      if v_product.serialized and jsonb_array_length(coalesce(v_pick->'serialNumbers', '[]'::jsonb))
          <> (v_line->>'quantity')::integer then
        raise exception '% requires one serial scan per unit', v_product.name;
      end if;
      if not v_product.serialized and jsonb_array_length(coalesce(v_pick->'serialNumbers', '[]'::jsonb)) > 0 then
        raise exception '% does not accept serial scans', v_product.name;
      end if;
      for v_serial in select value from jsonb_array_elements_text(coalesce(v_pick->'serialNumbers', '[]'::jsonb)) loop
        if not exists (
          select 1 from warehouse.inventory_units unit
           where unit.product_id = v_product.id and unit.serial_number = v_serial
             and unit.status = 'in_stock'
             and (v_order.source_location_id is null or unit.location_id = v_order.source_location_id)
             and (v_order.source_bin_id is null or unit.bin_id = v_order.source_bin_id)
             and not exists (
               select 1 from warehouse.inventory_holds hold
                where hold.status = 'active' and hold.product_id = unit.product_id
                  and hold.serial_number = unit.serial_number
             )
        ) then raise exception 'Serial % is not available at the pick location', v_serial; end if;
      end loop;
      v_lines := v_lines || jsonb_build_array(
        v_line || jsonb_build_object(
          'pickedQuantity', (v_pick->>'quantity')::integer,
          'pickedSerialNumbers', coalesce(v_pick->'serialNumbers', '[]'::jsonb)
        )
      );
    end loop;
    v_order.lines := v_lines;
  elsif v_action = 'confirm_pack' then
    if nullif(pg_catalog.btrim(coalesce(payload->>'courier', '')), '') is null then
      raise exception 'Courier is required at packing';
    end if;
    if nullif(pg_catalog.btrim(coalesce(payload->>'waybill_number', '')), '') is null then
      raise exception 'Waybill number is required at packing';
    end if;
    if jsonb_typeof(payload->'packaging') <> 'array' then raise exception 'Packaging must be an array'; end if;
    for v_material in select value from jsonb_array_elements(payload->'packaging') loop
      select * into v_product from warehouse.products where id = v_material->>'productId';
      if not found or v_product.item_class <> 'fulfillment_supply' then
        raise exception 'Only fulfillment supplies may be consumed during packing';
      end if;
      if coalesce((v_material->>'quantity')::integer, 0) <= 0 then
        raise exception 'Packaging quantity must be greater than zero';
      end if;
      select coalesce(sum(level.quantity), 0)::integer into v_available
        from warehouse.stock_levels level where level.product_id = v_product.id
          and (v_order.source_location_id is null or level.location_id = v_order.source_location_id);
      if v_available < (v_material->>'quantity')::integer then
        raise exception 'Insufficient % for packing', v_product.name;
      end if;
    end loop;
    v_order.courier := pg_catalog.btrim(payload->>'courier');
    v_order.waybill_number := pg_catalog.btrim(payload->>'waybill_number');
    v_order.packaging := payload->'packaging';
  elsif v_action = 'release' then
    if nullif(pg_catalog.btrim(coalesce(v_order.courier, '')), '') is null
       or nullif(pg_catalog.btrim(coalesce(v_order.waybill_number, '')), '') is null then
      raise exception 'Courier and waybill are required before release';
    end if;
    v_actor := warehouse.authoritative_actor();
    for v_line in select value from jsonb_array_elements(v_order.lines) loop
      if (v_line->>'pickedQuantity')::integer <> (v_line->>'quantity')::integer then
        raise exception 'Every order line must be fully picked before release';
      end if;
      select * into v_product from warehouse.products where id = v_line->>'productId' for update;
      if v_product.serialized then
        for v_serial in select value from jsonb_array_elements_text(v_line->'pickedSerialNumbers') loop
          select * into v_unit from warehouse.inventory_units unit
           where unit.product_id = v_product.id and unit.serial_number = v_serial
             and unit.status = 'in_stock'
             and (v_order.source_location_id is null or unit.location_id = v_order.source_location_id)
             and (v_order.source_bin_id is null or unit.bin_id = v_order.source_bin_id)
           for update;
          if not found or exists (
            select 1 from warehouse.inventory_holds hold
             where hold.status = 'active' and hold.product_id = v_product.id
               and hold.serial_number = v_serial
          ) then raise exception 'Serial % is no longer available', v_serial; end if;
          update warehouse.inventory_units set status = 'issued', assigned_to = v_order.external_reference
           where id = v_unit.id;
          insert into warehouse.movements(
            id, type, product_id, quantity, from_location_id, from_bin_id,
            serial_number, event_id, reference, actor
          ) values (
            gen_random_uuid()::text, 'fulfillment_release', v_product.id, 1,
            v_unit.location_id, v_unit.bin_id, v_serial, v_order.event_id,
            v_order.id::text, v_actor
          );
        end loop;
      else
        v_remaining := (v_line->>'quantity')::integer;
        for v_stock in select * from warehouse.stock_levels level
          where level.product_id = v_product.id and level.quantity > 0
            and (v_order.source_location_id is null or level.location_id = v_order.source_location_id)
            and (v_order.source_bin_id is null or level.bin_id = v_order.source_bin_id)
          order by level.location_id, level.bin_id nulls first, level.lot_id nulls first
          for update
        loop
          select coalesce(sum(hold.quantity), 0)::integer into v_held
            from warehouse.inventory_holds hold
           where hold.status = 'active' and hold.product_id = v_product.id
             and hold.location_id = v_stock.location_id and hold.serial_number is null
             and hold.bin_id is not distinct from v_stock.bin_id
             and hold.lot_id is not distinct from v_stock.lot_id;
          v_take := least(v_remaining, greatest(0, v_stock.quantity - v_held));
          if v_take > 0 then
            update warehouse.stock_levels set quantity = quantity - v_take
             where product_id = v_stock.product_id and location_id = v_stock.location_id
               and bin_id is not distinct from v_stock.bin_id
               and lot_id is not distinct from v_stock.lot_id;
            insert into warehouse.movements(
              id, type, product_id, quantity, from_location_id, from_bin_id,
              lot_id, event_id, reference, actor
            ) values (
              gen_random_uuid()::text, 'fulfillment_release', v_product.id, v_take,
              v_stock.location_id, v_stock.bin_id, v_stock.lot_id, v_order.event_id,
              v_order.id::text, v_actor
            );
            v_remaining := v_remaining - v_take;
          end if;
          exit when v_remaining = 0;
        end loop;
        if v_remaining > 0 then raise exception '% is no longer available', v_product.name; end if;
      end if;
    end loop;
    for v_material in select value from jsonb_array_elements(v_order.packaging) loop
      v_remaining := (v_material->>'quantity')::integer;
      for v_stock in select * from warehouse.stock_levels level
        where level.product_id = v_material->>'productId' and level.quantity > 0
          and (v_order.source_location_id is null or level.location_id = v_order.source_location_id)
        order by level.location_id, level.bin_id nulls first, level.lot_id nulls first
        for update
      loop
        v_take := least(v_remaining, v_stock.quantity);
        update warehouse.stock_levels set quantity = quantity - v_take
         where product_id = v_stock.product_id and location_id = v_stock.location_id
           and bin_id is not distinct from v_stock.bin_id
           and lot_id is not distinct from v_stock.lot_id;
        insert into warehouse.movements(
          id, type, product_id, quantity, from_location_id, from_bin_id,
          lot_id, reference, actor
        ) values (
          gen_random_uuid()::text, 'packaging_consumption', v_stock.product_id, v_take,
          v_stock.location_id, v_stock.bin_id, v_stock.lot_id, v_order.id::text, v_actor
        );
        v_remaining := v_remaining - v_take;
        exit when v_remaining = 0;
      end loop;
      if v_remaining > 0 then raise exception 'Packaging stock changed before release'; end if;
    end loop;
    v_order.released_by := auth.uid();
    v_order.released_at := now();
  end if;

  update warehouse.fulfillment_orders set
    status = v_next_status, lines = v_order.lines, packaging = v_order.packaging,
    courier = v_order.courier, waybill_number = v_order.waybill_number,
    released_by = v_order.released_by, released_at = v_order.released_at,
    updated_at = now()
   where id = v_order.id returning * into v_order;
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('warehouse', 'fulfillment_order', v_order.id, v_action, auth.uid(),
    jsonb_build_object('status', v_order.status, 'external_reference', v_order.external_reference));
  return private.finish_idempotent_command(v_command_id, to_jsonb(v_order));
end;
$$;

create or replace function private.warehouse_create_department_stock_request(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_started jsonb; v_command_id uuid; v_request warehouse.department_stock_requests;
  v_line jsonb; v_product warehouse.products;
begin
  v_started := private.begin_idempotent_command('create_department_stock_request', payload->>'idempotency_key', payload);
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;
  if not core.has_cap('warehouse', 'request_stock') then
    raise exception 'Not authorized: warehouse.request_stock';
  end if;
  if nullif(pg_catalog.btrim(payload->>'requesting_department'), '') is null
     or nullif(pg_catalog.btrim(payload->>'purpose'), '') is null
     or nullif(pg_catalog.btrim(payload->>'cost_center'), '') is null
     or nullif(payload->>'required_date', '') is null then
    raise exception 'Department, purpose, cost center, and required date are required';
  end if;
  if payload->>'expense_treatment' not in ('expense', 'custody', 'sale') then raise exception 'Invalid expense treatment'; end if;
  if jsonb_typeof(payload->'lines') <> 'array' or jsonb_array_length(payload->'lines') = 0 then
    raise exception 'At least one stock line is required';
  end if;
  for v_line in select value from jsonb_array_elements(payload->'lines') loop
    select * into v_product from warehouse.products p where p.id = v_line->>'productId';
    if coalesce((v_line->>'quantity')::integer, 0) <= 0 or not found then
      raise exception 'Every request line must identify a product and positive quantity';
    end if;
    if v_product.item_class not in ('sellable_sku', 'merchandise') then
      raise exception 'Department requests may include only sellable SKU and merchandise items';
    end if;
    if v_product.item_class = 'merchandise' and payload->>'expense_treatment' <> 'expense' then
      raise exception 'All merchandise requests must use expense treatment';
    end if;
  end loop;
  insert into warehouse.department_stock_requests(
    id, requesting_department, purpose, cost_center, required_date,
    expense_treatment, status, lines, requested_by
  ) values (
    (payload->>'request_id')::uuid, pg_catalog.btrim(payload->>'requesting_department'),
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

create or replace function private.warehouse_decide_department_stock_request(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_started jsonb; v_command_id uuid; v_request warehouse.department_stock_requests;
  v_order warehouse.fulfillment_orders; v_decision text := payload->>'decision'; v_order_lines jsonb;
begin
  v_started := private.begin_idempotent_command('decide_department_stock_request', payload->>'idempotency_key', payload);
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;
  if not (core.has_cap('warehouse', 'issue_items') or core.has_cap('procurement', 'approve_request')) then
    raise exception 'Not authorized to decide department stock requests';
  end if;
  if v_decision not in ('approved', 'rejected') then raise exception 'Invalid request decision'; end if;
  select * into v_request from warehouse.department_stock_requests
   where id = (payload->>'request_id')::uuid and status = 'pending_approval' for update;
  if not found then raise exception 'Pending department request not found'; end if;
  if v_request.requested_by = auth.uid() then raise exception 'Requester cannot approve their own request'; end if;
  if v_decision = 'approved' then
    select jsonb_agg(line || jsonb_build_object(
      'pickedQuantity', 0, 'pickedSerialNumbers', '[]'::jsonb
    )) into v_order_lines from jsonb_array_elements(v_request.lines) line;
    insert into warehouse.fulfillment_orders(
      id, source, external_reference, requesting_department, status, lines, packaging, created_by
    ) values (
      (payload->>'fulfillment_order_id')::uuid, 'department_request', 'REQ-' || v_request.id::text,
      v_request.requesting_department, 'received', v_order_lines, '[]'::jsonb, auth.uid()
    ) returning * into v_order;
  end if;
  update warehouse.department_stock_requests set
    status = v_decision, approved_by = auth.uid(), approved_at = now(),
    fulfillment_order_id = case when v_decision = 'approved' then v_order.id else null end
   where id = v_request.id returning * into v_request;
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('warehouse', 'department_stock_request', v_request.id, v_decision, auth.uid(),
    jsonb_build_object('fulfillment_order_id', v_request.fulfillment_order_id));
  if v_order.id is not null then
    insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
    values ('warehouse', 'fulfillment_order', v_order.id, 'created_from_department_request', auth.uid(),
      jsonb_build_object('department_stock_request_id', v_request.id));
  end if;
  return private.finish_idempotent_command(v_command_id, to_jsonb(v_request));
end;
$$;

create or replace function private.warehouse_create_customer_return_case(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_started jsonb; v_command_id uuid; v_case warehouse.customer_return_cases; v_product warehouse.products;
begin
  v_started := private.begin_idempotent_command('create_customer_return_case', payload->>'idempotency_key', payload);
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;
  if not core.has_cap('warehouse', 'submit_return_case') then
    raise exception 'Not authorized: warehouse.submit_return_case';
  end if;
  select * into v_product from warehouse.products where id = payload->>'product_id';
  if not found then raise exception 'Product not found'; end if;
  if nullif(pg_catalog.btrim(payload->>'defect_description'), '') is null then raise exception 'Defect description is required'; end if;
  if v_product.serialized and nullif(pg_catalog.btrim(coalesce(payload->>'serial_number', '')), '') is null then
    raise exception 'Serial number is required for this product';
  end if;
  if nullif(payload->>'serial_number', '') is not null and not exists (
    select 1 from warehouse.inventory_units unit
     where unit.product_id = v_product.id and unit.serial_number = payload->>'serial_number'
  ) then raise exception 'Serial number is not recognized for this product'; end if;
  if nullif(payload->>'source_order_id', '') is not null and not exists (
    select 1 from warehouse.fulfillment_orders o where o.id = (payload->>'source_order_id')::uuid
      and exists (select 1 from jsonb_array_elements(o.lines) line where line->>'productId' = v_product.id)
  ) then raise exception 'Source order does not contain this product'; end if;
  insert into warehouse.customer_return_cases(
    id, source_order_id, serial_number, product_id, defect_description,
    requesting_department, status, resolution, created_by
  ) values (
    (payload->>'return_case_id')::uuid, nullif(payload->>'source_order_id', '')::uuid,
    nullif(pg_catalog.btrim(coalesce(payload->>'serial_number', '')), ''), v_product.id,
    pg_catalog.btrim(payload->>'defect_description'), 'customer_service',
    'submitted', 'pending', auth.uid()
  ) returning * into v_case;
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('warehouse', 'customer_return_case', v_case.id, 'submitted', auth.uid(),
    jsonb_build_object('product_id', v_case.product_id, 'source_order_id', v_case.source_order_id));
  return private.finish_idempotent_command(v_command_id, to_jsonb(v_case));
end;
$$;

create or replace function private.warehouse_resolve_customer_return_case(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_started jsonb; v_command_id uuid; v_case warehouse.customer_return_cases;
  v_resolution text := payload->>'resolution'; v_bin warehouse.storage_areas;
  v_unit warehouse.inventory_units; v_actor text;
begin
  v_started := private.begin_idempotent_command('resolve_customer_return_case', payload->>'idempotency_key', payload);
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;
  if v_resolution = 'refund' then
    if not (
      core.has_cap('warehouse', 'approve_stock_adjustment_finance')
      or core.has_cap('procurement', 'view_finance')
    ) then raise exception 'Finance authorization is required for refunds'; end if;
  elsif not core.has_cap('warehouse', 'manage_returns') then
    raise exception 'Not authorized: warehouse.manage_returns';
  end if;
  if v_resolution not in ('replacement', 'refund', 'vendor_return', 're_kit', 'write_off') then
    raise exception 'Invalid return resolution';
  end if;
  select * into v_case from warehouse.customer_return_cases
   where id = (payload->>'return_case_id')::uuid and status <> 'resolved' for update;
  if not found then raise exception 'Open return case not found'; end if;
  if v_resolution in ('replacement', 'refund', 're_kit') and nullif(payload->>'quarantine_bin_id', '') is null then
    raise exception 'A quarantine bin is required before resolution';
  end if;
  if nullif(payload->>'quarantine_bin_id', '') is not null and not exists (
    select 1 from warehouse.storage_areas b where b.id = payload->>'quarantine_bin_id' and b.active
  ) then raise exception 'Active quarantine bin not found'; end if;
  if v_resolution = 'refund' and nullif(pg_catalog.btrim(coalesce(payload->>'refund_reference', '')), '') is null then
    raise exception 'Finance refund reference is required';
  end if;
  if nullif(payload->>'replacement_order_id', '') is not null and not exists (
    select 1 from warehouse.fulfillment_orders o where o.id = (payload->>'replacement_order_id')::uuid
  ) then raise exception 'Replacement fulfillment order not found'; end if;
  update warehouse.customer_return_cases set
    status = 'resolved', resolution = v_resolution,
    quarantine_bin_id = nullif(payload->>'quarantine_bin_id', ''),
    replacement_order_id = nullif(payload->>'replacement_order_id', '')::uuid,
    refund_reference = nullif(pg_catalog.btrim(coalesce(payload->>'refund_reference', '')), ''),
    supplier_reference = nullif(pg_catalog.btrim(coalesce(payload->>'supplier_reference', '')), ''),
    resolved_by = auth.uid(), resolved_at = now()
   where id = v_case.id returning * into v_case;
  if v_case.serial_number is not null and v_case.quarantine_bin_id is not null then
    select * into v_bin from warehouse.storage_areas
     where id = v_case.quarantine_bin_id and active;
    select * into v_unit from warehouse.inventory_units
     where product_id = v_case.product_id and serial_number = v_case.serial_number for update;
    if not found then raise exception 'Returned serial is no longer recognized'; end if;
    update warehouse.inventory_units set
      status = 'returned', location_id = v_bin.location_id,
      bin_id = v_bin.id, assigned_to = null
     where id = v_unit.id;
    v_actor := auth.uid()::text;
    insert into warehouse.movements(
      id, type, product_id, quantity, to_location_id, to_bin_id,
      serial_number, reason, reference, actor
    ) values (
      gen_random_uuid()::text, 'return', v_case.product_id, 1,
      v_bin.location_id, v_bin.id, v_case.serial_number,
      v_resolution, v_case.id::text, v_actor
    );
  end if;
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('warehouse', 'customer_return_case', v_case.id, 'resolved', auth.uid(),
    jsonb_build_object('resolution', v_case.resolution, 'replacement_order_id', v_case.replacement_order_id));
  return private.finish_idempotent_command(v_command_id, to_jsonb(v_case));
end;
$$;

create or replace function private.warehouse_create_kit_definition(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_started jsonb; v_command_id uuid; v_kit warehouse.kit_definitions;
  v_component jsonb; v_version integer; v_component_product warehouse.products;
begin
  v_started := private.begin_idempotent_command('create_kit_definition', payload->>'idempotency_key', payload);
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;
  if not core.has_cap('warehouse', 'manage_products') then raise exception 'Not authorized: warehouse.manage_products'; end if;
  if payload->>'owner_department' <> 'product' then raise exception 'Only the Product department can own a kit definition'; end if;
  if nullif(pg_catalog.btrim(payload->>'name'), '') is null
     or nullif(pg_catalog.btrim(payload->>'product_approval_reference'), '') is null
     or jsonb_typeof(payload->'components') <> 'array'
     or jsonb_array_length(payload->'components') = 0 then raise exception 'Kit name and components are required'; end if;
  if payload->>'status' not in ('draft', 'active', 'retired') then raise exception 'Invalid kit status'; end if;
  perform 1 from warehouse.products where id = payload->>'product_id' for update;
  if not found then raise exception 'Kit product not found'; end if;
  for v_component in select value from jsonb_array_elements(payload->'components') loop
    select * into v_component_product from warehouse.products where id = v_component->>'productId';
    if not found or coalesce((v_component->>'quantity')::integer, 0) <= 0 then
      raise exception 'Every kit component must identify a product and positive quantity';
    end if;
    if v_component->>'serializationPolicy' is distinct from v_component_product.serialization_policy then
      raise exception 'Kit component serialization policy is stale for product %', v_component_product.sku;
    end if;
  end loop;
  select coalesce(max(version), 0) + 1 into v_version
    from warehouse.kit_definitions where product_id = payload->>'product_id';
  insert into warehouse.kit_definitions(
    id, product_id, version, name, components, status, owner_department,
    product_approval_reference, created_by
  ) values (
    (payload->>'kit_definition_id')::uuid, payload->>'product_id', v_version,
    pg_catalog.btrim(payload->>'name'), payload->'components', payload->>'status',
    'product', pg_catalog.btrim(payload->>'product_approval_reference'), auth.uid()
  ) returning * into v_kit;
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('warehouse', 'kit_definition', v_kit.id, 'created', auth.uid(),
    jsonb_build_object('product_id', v_kit.product_id, 'version', v_kit.version, 'status', v_kit.status));
  return private.finish_idempotent_command(v_command_id, to_jsonb(v_kit));
end;
$$;

create or replace function private.warehouse_create_rekit_work_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_started jsonb; v_command_id uuid; v_work warehouse.rekit_work_orders;
  v_case warehouse.customer_return_cases; v_kit warehouse.kit_definitions; v_component jsonb;
  v_required integer; v_found integer;
begin
  v_started := private.begin_idempotent_command('create_rekit_work_order', payload->>'idempotency_key', payload);
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;
  if not (core.has_cap('warehouse', 'manage_returns') and core.has_cap('warehouse', 'manage_products')) then
    raise exception 'Warehouse return and product-control authorization is required';
  end if;
  select * into v_case from warehouse.customer_return_cases
   where id = (payload->>'source_return_case_id')::uuid and resolution = 're_kit' for update;
  if not found then raise exception 'A return case resolved for re-kitting is required'; end if;
  select * into v_kit from warehouse.kit_definitions
   where id = (payload->>'kit_definition_id')::uuid and status = 'active';
  if not found then raise exception 'An active kit definition is required'; end if;
  if nullif(pg_catalog.btrim(payload->>'output_serial_number'), '') is null then raise exception 'Output serial number is required'; end if;
  if payload->>'condition' not in ('open_box', 'reconditioned') then raise exception 'Invalid re-kit condition'; end if;
  if jsonb_typeof(payload->'component_serial_numbers') <> 'array' then raise exception 'Component serial numbers must be an array'; end if;
  if (select count(*) from jsonb_array_elements_text(payload->'component_serial_numbers')) <>
     (select count(distinct value) from jsonb_array_elements_text(payload->'component_serial_numbers')) then
    raise exception 'Component serial numbers must be unique';
  end if;
  if exists (select 1 from warehouse.inventory_units unit where unit.serial_number = payload->>'output_serial_number') then
    raise exception 'Output serial number already exists';
  end if;
  for v_component in select value from jsonb_array_elements(v_kit.components)
    where value->>'serializationPolicy' in ('required', 'asset_tag')
  loop
    v_required := (v_component->>'quantity')::integer;
    select count(*) into v_found from warehouse.inventory_units unit
     where unit.product_id = v_component->>'productId'
       and unit.status in ('in_stock', 'returned')
       and unit.serial_number in (
         select value from jsonb_array_elements_text(payload->'component_serial_numbers')
       );
    if v_found <> v_required then
      raise exception 'Re-kit requires % serialized component(s) for product %', v_required, v_component->>'productId';
    end if;
  end loop;
  insert into warehouse.rekit_work_orders(
    id, source_return_case_id, kit_definition_id, output_serial_number,
    component_serial_numbers, condition, status, created_by
  ) values (
    (payload->>'rekit_work_order_id')::uuid, v_case.id, v_kit.id,
    pg_catalog.btrim(payload->>'output_serial_number'), payload->'component_serial_numbers',
    payload->>'condition', 'inspection', auth.uid()
  ) returning * into v_work;
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('warehouse', 'rekit_work_order', v_work.id, 'created', auth.uid(),
    jsonb_build_object('source_return_case_id', v_work.source_return_case_id,
      'kit_definition_id', v_work.kit_definition_id, 'condition', v_work.condition));
  return private.finish_idempotent_command(v_command_id, to_jsonb(v_work));
end;
$$;

create or replace function private.warehouse_complete_rekit_work_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_started jsonb; v_command_id uuid; v_work warehouse.rekit_work_orders;
  v_kit warehouse.kit_definitions; v_bin warehouse.storage_areas; v_actor text;
begin
  v_started := private.begin_idempotent_command('complete_rekit_work_order', payload->>'idempotency_key', payload);
  if (v_started->>'replayed')::boolean then return v_started->'response'; end if;
  v_command_id := (v_started->>'command_id')::uuid;
  if not (core.has_cap('warehouse', 'manage_returns') and core.has_cap('warehouse', 'manage_products')) then
    raise exception 'Warehouse return and product-control authorization is required';
  end if;
  select * into v_work from warehouse.rekit_work_orders
   where id = (payload->>'work_order_id')::uuid and status in ('inspection', 'ready') for update;
  if not found then raise exception 'Inspected re-kit work order not found'; end if;
  select * into v_kit from warehouse.kit_definitions
   where id = v_work.kit_definition_id and status = 'active';
  if not found then raise exception 'The active kit definition is no longer available'; end if;
  if not exists (
    select 1 from warehouse.products p
     where p.id = v_kit.product_id and p.serialized and p.item_class in ('sellable_sku', 're_kitted_item')
  ) then raise exception 'Re-kit output must be a serialized product'; end if;
  select * into v_bin from warehouse.storage_areas
   where id = payload->>'bin_id' and location_id = payload->>'location_id' and active;
  if not found then raise exception 'An active output warehouse bin is required'; end if;
  if exists (select 1 from warehouse.inventory_units unit where unit.serial_number = v_work.output_serial_number) then
    raise exception 'Output serial number already exists';
  end if;
  v_actor := auth.uid()::text;
  update warehouse.inventory_units
     set status = 'issued', assigned_to = 'rekit:' || v_work.id::text
   where serial_number in (
     select value from jsonb_array_elements_text(v_work.component_serial_numbers)
   );
  insert into warehouse.inventory_units(
    id, product_id, serial_number, location_id, bin_id, status
  ) values (
    gen_random_uuid()::text, v_kit.product_id, v_work.output_serial_number,
    v_bin.location_id, v_bin.id, 'in_stock'
  );
  insert into warehouse.movements(
    id, type, product_id, quantity, to_location_id, to_bin_id,
    serial_number, reason, reference, actor
  ) values (
    gen_random_uuid()::text, 're_kit', v_kit.product_id, 1,
    v_bin.location_id, v_bin.id, v_work.output_serial_number,
    v_work.condition || ' assembly completed', v_work.id::text, v_actor
  );
  update warehouse.rekit_work_orders set
    status = 'completed', completed_by = auth.uid(), completed_at = now()
   where id = v_work.id returning * into v_work;
  insert into core.activity_log(module, entity_type, entity_id, action, actor, detail)
  values ('warehouse', 'rekit_work_order', v_work.id, 'completed', auth.uid(),
    jsonb_build_object('output_serial_number', v_work.output_serial_number,
      'location_id', v_bin.location_id, 'bin_id', v_bin.id));
  return private.finish_idempotent_command(v_command_id, to_jsonb(v_work));
end;
$$;

create or replace function warehouse.create_fulfillment_order(payload jsonb)
returns jsonb language sql security definer set search_path = ''
as $$ select private.warehouse_create_fulfillment_order(payload) $$;
create or replace function warehouse.advance_fulfillment_order(payload jsonb)
returns jsonb language sql security definer set search_path = ''
as $$ select private.warehouse_advance_fulfillment_order(payload) $$;
create or replace function warehouse.create_department_stock_request(payload jsonb)
returns jsonb language sql security definer set search_path = ''
as $$ select private.warehouse_create_department_stock_request(payload) $$;
create or replace function warehouse.decide_department_stock_request(payload jsonb)
returns jsonb language sql security definer set search_path = ''
as $$ select private.warehouse_decide_department_stock_request(payload) $$;
create or replace function warehouse.create_customer_return_case(payload jsonb)
returns jsonb language sql security definer set search_path = ''
as $$ select private.warehouse_create_customer_return_case(payload) $$;
create or replace function warehouse.resolve_customer_return_case(payload jsonb)
returns jsonb language sql security definer set search_path = ''
as $$ select private.warehouse_resolve_customer_return_case(payload) $$;
create or replace function warehouse.create_kit_definition(payload jsonb)
returns jsonb language sql security definer set search_path = ''
as $$ select private.warehouse_create_kit_definition(payload) $$;
create or replace function warehouse.create_rekit_work_order(payload jsonb)
returns jsonb language sql security definer set search_path = ''
as $$ select private.warehouse_create_rekit_work_order(payload) $$;
create or replace function warehouse.complete_rekit_work_order(payload jsonb)
returns jsonb language sql security definer set search_path = ''
as $$ select private.warehouse_complete_rekit_work_order(payload) $$;

revoke all on function private.warehouse_create_fulfillment_order(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_advance_fulfillment_order(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_create_department_stock_request(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_decide_department_stock_request(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_create_customer_return_case(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_resolve_customer_return_case(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_create_kit_definition(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_create_rekit_work_order(jsonb) from public, anon, authenticated;
revoke all on function private.warehouse_complete_rekit_work_order(jsonb) from public, anon, authenticated;
revoke all on function warehouse.create_fulfillment_order(jsonb) from public, anon;
revoke all on function warehouse.advance_fulfillment_order(jsonb) from public, anon;
revoke all on function warehouse.create_department_stock_request(jsonb) from public, anon;
revoke all on function warehouse.decide_department_stock_request(jsonb) from public, anon;
revoke all on function warehouse.create_customer_return_case(jsonb) from public, anon;
revoke all on function warehouse.resolve_customer_return_case(jsonb) from public, anon;
revoke all on function warehouse.create_kit_definition(jsonb) from public, anon;
revoke all on function warehouse.create_rekit_work_order(jsonb) from public, anon;
revoke all on function warehouse.complete_rekit_work_order(jsonb) from public, anon;

grant execute on function private.warehouse_create_fulfillment_order(jsonb) to service_role;
grant execute on function private.warehouse_advance_fulfillment_order(jsonb) to service_role;
grant execute on function private.warehouse_create_department_stock_request(jsonb) to service_role;
grant execute on function private.warehouse_decide_department_stock_request(jsonb) to service_role;
grant execute on function private.warehouse_create_customer_return_case(jsonb) to service_role;
grant execute on function private.warehouse_resolve_customer_return_case(jsonb) to service_role;
grant execute on function private.warehouse_create_kit_definition(jsonb) to service_role;
grant execute on function private.warehouse_create_rekit_work_order(jsonb) to service_role;
grant execute on function private.warehouse_complete_rekit_work_order(jsonb) to service_role;
grant execute on function warehouse.create_fulfillment_order(jsonb) to authenticated, service_role;
grant execute on function warehouse.advance_fulfillment_order(jsonb) to authenticated, service_role;
grant execute on function warehouse.create_department_stock_request(jsonb) to authenticated, service_role;
grant execute on function warehouse.decide_department_stock_request(jsonb) to authenticated, service_role;
grant execute on function warehouse.create_customer_return_case(jsonb) to authenticated, service_role;
grant execute on function warehouse.resolve_customer_return_case(jsonb) to authenticated, service_role;
grant execute on function warehouse.create_kit_definition(jsonb) to authenticated, service_role;
grant execute on function warehouse.create_rekit_work_order(jsonb) to authenticated, service_role;
grant execute on function warehouse.complete_rekit_work_order(jsonb) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
