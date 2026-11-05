create schema if not exists private;

create or replace function private.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

revoke all on schema private from public, anon, authenticated;
revoke all on function private.current_app_role() from public, anon, authenticated;

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  sku_code text not null unique,
  name text not null,
  category text not null,
  item_type text not null check (item_type in ('device', 'wearable', 'merchandise', 'token', 'bundle', 'supply')),
  tracking_mode text not null check (tracking_mode in ('quantity', 'serialized', 'batch', 'serialized-and-batch')),
  active boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sku_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products (id) on delete cascade,
  variant_code text not null,
  size text,
  model text,
  color text,
  barcode text unique,
  uom text not null default 'unit',
  reorder_point integer not null default 0,
  reorder_quantity integer not null default 0,
  serial_required boolean not null default false,
  lot_required boolean not null default false,
  active boolean not null default true,
  unique (product_id, variant_code)
);

create table if not exists public.inventory_locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  location_type text not null check (location_type in ('warehouse', 'bin', 'event-site', 'department', 'quarantine', 'vendor', 'customer', 'holding-lane')),
  parent_id uuid references public.inventory_locations (id),
  site_owner text,
  active boolean not null default true
);

create table if not exists public.cost_layers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.products (id),
  variant_id uuid references public.sku_variants (id),
  supplier text,
  batch_lot text,
  received_at timestamptz not null default now(),
  unit_cost numeric(14, 2) not null check (unit_cost >= 0),
  landed_cost numeric(14, 2) not null default 0 check (landed_cost >= 0),
  currency text not null default 'PHP',
  quantity_received numeric(14, 2) not null check (quantity_received >= 0),
  quantity_remaining numeric(14, 2) not null check (quantity_remaining >= 0)
);

create table if not exists public.serialized_units (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.sku_variants (id),
  serial_number text not null unique,
  batch_lot text,
  status text not null check (status in ('available', 'reserved', 'issued', 'returned', 'quarantine', 'write-off', 'lost')),
  current_location_id uuid references public.inventory_locations (id),
  current_event_id uuid,
  cost_layer_id uuid references public.cost_layers (id),
  created_at timestamptz not null default now()
);

alter table public.inventory_balances
  add column if not exists variant_id uuid references public.sku_variants (id),
  add column if not exists lld_location_id uuid references public.inventory_locations (id),
  add column if not exists status_reason text;

alter table public.inventory_ledger
  add column if not exists variant_id uuid references public.sku_variants (id),
  add column if not exists serial_unit_id uuid references public.serialized_units (id),
  add column if not exists lld_from_location_id uuid references public.inventory_locations (id),
  add column if not exists lld_to_location_id uuid references public.inventory_locations (id),
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.activation_events (
  id uuid primary key default gen_random_uuid(),
  event_code text not null unique,
  event_type text not null,
  channel text not null,
  department text,
  site_location_id uuid references public.inventory_locations (id),
  owner_id uuid references public.profiles (id),
  planned_start timestamptz,
  planned_end timestamptz,
  target_audience text,
  status public.work_status not null default 'draft',
  created_at timestamptz not null default now()
);

create table if not exists public.allocation_requests (
  id uuid primary key default gen_random_uuid(),
  request_code text not null unique,
  activation_event_id uuid not null references public.activation_events (id) on delete cascade,
  requester_id uuid references public.profiles (id),
  purpose text not null,
  needed_by date not null,
  status public.work_status not null default 'draft',
  created_at timestamptz not null default now()
);

create table if not exists public.allocation_request_lines (
  id uuid primary key default gen_random_uuid(),
  allocation_request_id uuid not null references public.allocation_requests (id) on delete cascade,
  variant_id uuid not null references public.sku_variants (id),
  requested_quantity numeric(14, 2) not null check (requested_quantity > 0),
  approved_quantity numeric(14, 2) not null default 0 check (approved_quantity >= 0),
  status public.work_status not null default 'pending'
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  reservation_code text not null unique,
  allocation_request_line_id uuid not null references public.allocation_request_lines (id) on delete cascade,
  variant_id uuid not null references public.sku_variants (id),
  location_id uuid references public.inventory_locations (id),
  quantity numeric(14, 2) not null check (quantity > 0),
  status text not null check (status in ('active', 'expired', 'released', 'issued')),
  expires_at timestamptz not null,
  approved_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table if not exists public.issuances (
  id uuid primary key default gen_random_uuid(),
  issuance_code text not null unique,
  activation_event_id uuid not null references public.activation_events (id),
  reservation_id uuid references public.reservations (id),
  variant_id uuid not null references public.sku_variants (id),
  serial_unit_id uuid references public.serialized_units (id),
  recipient_type text not null,
  purpose text not null check (purpose in ('sold', 'promotional', 'corporate-giveaway', 'demo', 'loaner', 'replacement', 'internal-use')),
  quantity numeric(14, 2) not null check (quantity > 0),
  issued_by uuid references public.profiles (id),
  issued_at timestamptz not null default now(),
  status public.work_status not null default 'completed'
);

create table if not exists public.event_usage_reports (
  id uuid primary key default gen_random_uuid(),
  usage_code text not null unique,
  activation_event_id uuid not null references public.activation_events (id) on delete cascade,
  channel text not null check (channel in ('business-unit', 'marketing', 'operations')),
  event_type text not null check (event_type in ('corporate', 'government-lgu', 'medical-mission', 'vip-activation', 'partner-marketplace')),
  target_audience text not null,
  variant_id uuid references public.sku_variants (id),
  issued_quantity numeric(14, 2) not null check (issued_quantity >= 0),
  consumed_quantity numeric(14, 2) not null check (consumed_quantity >= 0),
  returned_quantity numeric(14, 2) not null check (returned_quantity >= 0),
  sold_quantity numeric(14, 2) not null default 0 check (sold_quantity >= 0),
  promotional_quantity numeric(14, 2) not null default 0 check (promotional_quantity >= 0),
  corporate_giveaway_quantity numeric(14, 2) not null default 0 check (corporate_giveaway_quantity >= 0),
  engagement_outcome text not null,
  event_date date not null,
  status public.work_status not null default 'needs-review',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  check (consumed_quantity + returned_quantity <= issued_quantity),
  check (sold_quantity + promotional_quantity + corporate_giveaway_quantity <= consumed_quantity)
);

alter table public.return_records
  add column if not exists activation_event_id uuid references public.activation_events (id),
  add column if not exists variant_id uuid references public.sku_variants (id),
  add column if not exists serial_unit_id uuid references public.serialized_units (id),
  add column if not exists reason_code text,
  add column if not exists source_type text,
  add column if not exists evidence_required boolean not null default false;

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_code text not null unique,
  name text not null,
  lead_time_days integer not null default 0,
  minimum_order_quantity numeric(14, 2) not null default 0,
  status text not null check (status in ('active', 'review', 'inactive')),
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique,
  supplier_id uuid not null references public.suppliers (id),
  procurement_request_id text references public.procurement_requests (id),
  variant_id uuid references public.sku_variants (id),
  quantity numeric(14, 2) not null check (quantity > 0),
  eta date,
  status public.work_status not null default 'pending',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table if not exists public.valuation_snapshots (
  id uuid primary key default gen_random_uuid(),
  as_of timestamptz not null,
  category text,
  variant_id uuid references public.sku_variants (id),
  quantity numeric(14, 2) not null default 0,
  weighted_avg_cost numeric(14, 2) not null default 0,
  total_value numeric(14, 2) not null default 0,
  generated_by uuid references public.profiles (id),
  export_job_id uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.metric_definitions (
  id uuid primary key default gen_random_uuid(),
  metric_code text not null unique,
  metric_name text not null,
  formula text not null,
  grain text not null,
  primary_consumers text[] not null default '{}',
  owner_role public.app_role not null,
  lineage text not null,
  sample_record_id text,
  status public.work_status not null default 'ready',
  updated_at timestamptz not null default now()
);

create table if not exists public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  export_type text not null,
  requested_by uuid references public.profiles (id),
  status public.work_status not null default 'pending',
  row_count integer not null default 0,
  checksum text,
  manifest jsonb not null default '{}'::jsonb,
  failure_reason text,
  retry_of uuid references public.export_jobs (id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.valuation_snapshots
  add constraint valuation_snapshots_export_job_fk
  foreign key (export_job_id) references public.export_jobs (id) deferrable initially deferred;

create table if not exists public.pricing_simulations (
  id uuid primary key default gen_random_uuid(),
  simulation_code text not null unique,
  requested_by uuid references public.profiles (id),
  scenario_name text not null,
  inputs jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  cost_masked boolean not null default true,
  writes_inventory boolean not null default false,
  export_job_id uuid references public.export_jobs (id),
  created_at timestamptz not null default now(),
  check (writes_inventory = false)
);

create table if not exists public.failure_states (
  id uuid primary key default gen_random_uuid(),
  failure_code text not null unique,
  scenario text not null,
  owner_role public.app_role not null,
  linked_record_id text not null,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  status public.work_status not null,
  recovery_action text not null,
  created_at timestamptz not null default now()
);

alter table public.products enable row level security;
alter table public.sku_variants enable row level security;
alter table public.inventory_locations enable row level security;
alter table public.cost_layers enable row level security;
alter table public.serialized_units enable row level security;
alter table public.activation_events enable row level security;
alter table public.allocation_requests enable row level security;
alter table public.allocation_request_lines enable row level security;
alter table public.reservations enable row level security;
alter table public.issuances enable row level security;
alter table public.event_usage_reports enable row level security;
alter table public.suppliers enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.valuation_snapshots enable row level security;
alter table public.metric_definitions enable row level security;
alter table public.export_jobs enable row level security;
alter table public.pricing_simulations enable row level security;
alter table public.failure_states enable row level security;

create policy products_internal_select on public.products
  for select to authenticated using (private.current_app_role() is not null);
create policy products_masterdata_write on public.products
  for all to authenticated
  using (private.current_app_role() in ('logistics-supervisor', 'procurement-consultant', 'admin'))
  with check (private.current_app_role() in ('logistics-supervisor', 'procurement-consultant', 'admin'));

create policy sku_variants_internal_select on public.sku_variants
  for select to authenticated using (private.current_app_role() is not null);
create policy sku_variants_masterdata_write on public.sku_variants
  for all to authenticated
  using (private.current_app_role() in ('logistics-supervisor', 'procurement-consultant', 'admin'))
  with check (private.current_app_role() in ('logistics-supervisor', 'procurement-consultant', 'admin'));

create policy inventory_locations_internal_select on public.inventory_locations
  for select to authenticated using (private.current_app_role() is not null);
create policy inventory_locations_admin_write on public.inventory_locations
  for all to authenticated
  using (private.current_app_role() = 'admin')
  with check (private.current_app_role() = 'admin');

create policy serialized_units_floor_select on public.serialized_units
  for select to authenticated
  using (private.current_app_role() in ('logistics-supervisor', 'warehouse-supervisor', 'operations-user', 'operations-manager', 'finance-manager', 'bi-analyst', 'admin'));
create policy serialized_units_logistics_write on public.serialized_units
  for all to authenticated
  using (private.current_app_role() in ('logistics-supervisor', 'warehouse-supervisor', 'operations-manager'))
  with check (private.current_app_role() in ('logistics-supervisor', 'warehouse-supervisor', 'operations-manager'));

create policy cost_layers_finance_only_select on public.cost_layers
  for select to authenticated
  using (private.current_app_role() in ('finance-manager', 'admin'));
create policy cost_layers_finance_only_write on public.cost_layers
  for all to authenticated
  using (private.current_app_role() = 'finance-manager')
  with check (private.current_app_role() = 'finance-manager');

create policy activation_events_requester_select on public.activation_events
  for select to authenticated
  using (private.current_app_role() in ('operations-user', 'operations-manager', 'business-unit-manager', 'marketing-manager', 'warehouse-supervisor', 'bi-analyst', 'admin'));
create policy activation_events_requester_write on public.activation_events
  for all to authenticated
  using (private.current_app_role() in ('operations-user', 'business-unit-manager', 'marketing-manager', 'operations-manager'))
  with check (private.current_app_role() in ('operations-user', 'business-unit-manager', 'marketing-manager', 'operations-manager'));

create policy allocation_requests_role_select on public.allocation_requests
  for select to authenticated
  using (private.current_app_role() in ('operations-user', 'operations-manager', 'business-unit-manager', 'marketing-manager', 'warehouse-supervisor', 'admin'));
create policy allocation_requests_requester_write on public.allocation_requests
  for all to authenticated
  using (private.current_app_role() in ('operations-user', 'business-unit-manager', 'marketing-manager', 'operations-manager'))
  with check (private.current_app_role() in ('operations-user', 'business-unit-manager', 'marketing-manager', 'operations-manager'));

create policy allocation_request_lines_role_select on public.allocation_request_lines
  for select to authenticated
  using (private.current_app_role() in ('operations-user', 'operations-manager', 'business-unit-manager', 'marketing-manager', 'warehouse-supervisor', 'admin'));
create policy allocation_request_lines_manager_write on public.allocation_request_lines
  for all to authenticated
  using (private.current_app_role() in ('operations-manager', 'warehouse-supervisor'))
  with check (private.current_app_role() in ('operations-manager', 'warehouse-supervisor'));

create policy reservations_role_select on public.reservations
  for select to authenticated
  using (private.current_app_role() in ('operations-user', 'operations-manager', 'business-unit-manager', 'marketing-manager', 'warehouse-supervisor', 'admin'));
create policy reservations_manager_write on public.reservations
  for all to authenticated
  using (private.current_app_role() in ('operations-manager', 'warehouse-supervisor'))
  with check (private.current_app_role() in ('operations-manager', 'warehouse-supervisor'));

create policy issuances_role_select on public.issuances
  for select to authenticated
  using (private.current_app_role() in ('operations-user', 'operations-manager', 'warehouse-supervisor', 'finance-manager', 'bi-analyst', 'admin'));
create policy issuances_floor_write on public.issuances
  for all to authenticated
  using (private.current_app_role() in ('operations-user', 'warehouse-supervisor', 'operations-manager'))
  with check (private.current_app_role() in ('operations-user', 'warehouse-supervisor', 'operations-manager'));

create policy event_usage_reports_role_select on public.event_usage_reports
  for select to authenticated
  using (
    private.current_app_role() in (
      'operations-user',
      'operations-manager',
      'business-unit-manager',
      'marketing-manager',
      'finance-manager',
      'bi-analyst',
      'procurement-consultant',
      'pricing-consultant',
      'admin'
    )
  );
create policy event_usage_reports_owner_write on public.event_usage_reports
  for all to authenticated
  using (private.current_app_role() in ('operations-user', 'operations-manager', 'business-unit-manager', 'marketing-manager', 'admin'))
  with check (private.current_app_role() in ('operations-user', 'operations-manager', 'business-unit-manager', 'marketing-manager', 'admin'));

create policy suppliers_procurement_select on public.suppliers
  for select to authenticated
  using (private.current_app_role() in ('procurement-consultant', 'operations-manager', 'finance-manager', 'admin'));
create policy suppliers_procurement_write on public.suppliers
  for all to authenticated
  using (private.current_app_role() in ('procurement-consultant', 'admin'))
  with check (private.current_app_role() in ('procurement-consultant', 'admin'));

create policy purchase_orders_role_select on public.purchase_orders
  for select to authenticated
  using (private.current_app_role() in ('procurement-consultant', 'operations-manager', 'finance-manager', 'admin'));
create policy purchase_orders_procurement_write on public.purchase_orders
  for all to authenticated
  using (private.current_app_role() in ('procurement-consultant', 'operations-manager'))
  with check (private.current_app_role() in ('procurement-consultant', 'operations-manager'));

create policy valuation_snapshots_finance_select on public.valuation_snapshots
  for select to authenticated
  using (private.current_app_role() in ('finance-manager', 'admin'));
create policy valuation_snapshots_finance_write on public.valuation_snapshots
  for all to authenticated
  using (private.current_app_role() = 'finance-manager')
  with check (private.current_app_role() = 'finance-manager');

create policy metric_definitions_bi_select on public.metric_definitions
  for select to authenticated
  using (private.current_app_role() in ('bi-analyst', 'pricing-consultant', 'finance-manager', 'admin'));
create policy metric_definitions_bi_write on public.metric_definitions
  for all to authenticated
  using (private.current_app_role() in ('bi-analyst', 'admin'))
  with check (private.current_app_role() in ('bi-analyst', 'admin'));

create policy export_jobs_role_scoped_select on public.export_jobs
  for select to authenticated
  using (
    private.current_app_role() in ('operations-manager', 'finance-manager', 'bi-analyst', 'procurement-consultant', 'pricing-consultant', 'admin')
  );
create policy export_jobs_role_scoped_write on public.export_jobs
  for all to authenticated
  using (
    private.current_app_role() in ('operations-manager', 'finance-manager', 'bi-analyst', 'procurement-consultant', 'pricing-consultant', 'admin')
  )
  with check (
    private.current_app_role() in ('operations-manager', 'finance-manager', 'bi-analyst', 'procurement-consultant', 'pricing-consultant', 'admin')
  );

create policy pricing_simulations_read_only_select on public.pricing_simulations
  for select to authenticated
  using (private.current_app_role() in ('pricing-consultant', 'bi-analyst', 'admin'));
create policy pricing_simulations_pricing_insert_only on public.pricing_simulations
  for insert to authenticated
  with check (private.current_app_role() = 'pricing-consultant' and writes_inventory = false);

create policy failure_states_role_select on public.failure_states
  for select to authenticated
  using (private.current_app_role() in ('logistics-supervisor', 'warehouse-supervisor', 'operations-user', 'operations-manager', 'finance-manager', 'bi-analyst', 'admin'));
create policy failure_states_owner_update on public.failure_states
  for update to authenticated
  using (private.current_app_role() in (owner_role, 'operations-manager', 'admin'))
  with check (private.current_app_role() in (owner_role, 'operations-manager', 'admin'));

create policy storage_warehouse_evidence_role_select
  on storage.objects for select to authenticated
  using (
    bucket_id = 'warehouse-evidence'
    and private.current_app_role() in ('logistics-supervisor', 'warehouse-supervisor', 'operations-user', 'operations-manager', 'finance-manager', 'bi-analyst', 'admin')
  );

grant select, insert, update, delete on public.products to authenticated, service_role;
grant select, insert, update, delete on public.sku_variants to authenticated, service_role;
grant select, insert, update, delete on public.inventory_locations to authenticated, service_role;
grant select, insert, update, delete on public.cost_layers to authenticated, service_role;
grant select, insert, update, delete on public.serialized_units to authenticated, service_role;
grant select, insert, update, delete on public.activation_events to authenticated, service_role;
grant select, insert, update, delete on public.allocation_requests to authenticated, service_role;
grant select, insert, update, delete on public.allocation_request_lines to authenticated, service_role;
grant select, insert, update, delete on public.reservations to authenticated, service_role;
grant select, insert, update, delete on public.issuances to authenticated, service_role;
grant select, insert, update, delete on public.event_usage_reports to authenticated, service_role;
grant select, insert, update, delete on public.suppliers to authenticated, service_role;
grant select, insert, update, delete on public.purchase_orders to authenticated, service_role;
grant select, insert, update, delete on public.valuation_snapshots to authenticated, service_role;
grant select, insert, update, delete on public.metric_definitions to authenticated, service_role;
grant select, insert, update, delete on public.export_jobs to authenticated, service_role;
grant select, insert, update, delete on public.pricing_simulations to authenticated, service_role;
grant select, insert, update, delete on public.failure_states to authenticated, service_role;
