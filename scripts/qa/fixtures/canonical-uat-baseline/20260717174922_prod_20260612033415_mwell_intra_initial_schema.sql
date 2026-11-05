create extension if not exists "pgcrypto";

create type public.app_role as enum (
  'guard',
  'warehouse',
  'packing',
  'inventory',
  'manager',
  'finance',
  'admin'
);

create type public.work_status as enum (
  'draft',
  'ready',
  'in-progress',
  'pending',
  'needs-review',
  'approval-hold',
  'completed',
  'blocked',
  'critical',
  'quarantine'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role public.app_role not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.skus (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  product_name text not null,
  brand text not null,
  variant text,
  barcode text unique,
  category text not null,
  unit text not null,
  status text not null default 'active',
  reorder_point integer not null default 0,
  reorder_quantity integer not null default 0,
  average_daily_sales numeric(12, 2) not null default 0,
  lead_time_days integer not null default 0,
  safety_stock integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  zone text not null,
  rack text not null,
  shelf text not null,
  bin text not null,
  holding_lane boolean not null default false,
  quarantine boolean not null default false
);

create table public.inventory_balances (
  id uuid primary key default gen_random_uuid(),
  sku_id uuid not null references public.skus (id),
  location_id uuid not null references public.locations (id),
  quantity integer not null default 0 check (quantity >= 0),
  stock_status text not null default 'available',
  reserved_quantity integer not null default 0 check (reserved_quantity >= 0),
  updated_at timestamptz not null default now(),
  unique (sku_id, location_id, stock_status)
);

create table public.inventory_ledger (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  user_id uuid references public.profiles (id),
  event_type text not null,
  sku_id uuid not null references public.skus (id),
  quantity_change integer not null,
  unit text not null,
  from_location_id uuid references public.locations (id),
  to_location_id uuid references public.locations (id),
  reference_type text not null,
  reference_id text not null,
  reason_code text not null,
  approval_status public.work_status not null default 'completed',
  evidence_attachment_id uuid
);

create table public.receiving_records (
  id text primary key,
  supplier text not null,
  po_number text,
  driver_name text,
  vehicle_manifest text,
  arrival_time timestamptz not null,
  status public.work_status not null default 'draft',
  priority text not null default 'medium',
  expected_cartons integer not null default 0,
  received_cartons integer not null default 0,
  qc_status text not null default 'hold',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.receiving_items (
  id uuid primary key default gen_random_uuid(),
  receiving_id text not null references public.receiving_records (id) on delete cascade,
  sku_id uuid not null references public.skus (id),
  expected_quantity integer not null,
  received_quantity integer not null,
  qc_status text not null
);

create table public.orders (
  id text primary key,
  channel text not null,
  customer_reference text not null,
  status public.work_status not null default 'draft',
  priority text not null default 'medium',
  due_at timestamptz,
  waybill text,
  courier text,
  created_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders (id) on delete cascade,
  sku_id uuid not null references public.skus (id),
  quantity integer not null check (quantity > 0),
  picked_quantity integer not null default 0,
  packed_quantity integer not null default 0
);

create table public.pick_tasks (
  id text primary key,
  order_id text not null references public.orders (id),
  sku_id uuid not null references public.skus (id),
  location_id uuid references public.locations (id),
  quantity integer not null check (quantity > 0),
  picker_id uuid references public.profiles (id),
  status public.work_status not null default 'ready',
  created_at timestamptz not null default now()
);

create table public.task_scans (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references public.pick_tasks (id) on delete cascade,
  scanned_code text not null,
  scanned_by uuid references public.profiles (id),
  scanned_at timestamptz not null default now(),
  unique (task_id, scanned_code)
);

create table public.return_records (
  id text primary key,
  original_order_id text,
  sku_id uuid references public.skus (id),
  quantity integer not null,
  grade text not null,
  disposition text not null,
  status public.work_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table public.procurement_requests (
  id text primary key,
  sku_id uuid not null references public.skus (id),
  supplier text not null,
  quantity integer not null,
  eta date,
  status public.work_status not null default 'pending',
  requester_id uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.approvals (
  id text primary key,
  approval_type text not null,
  requester_id uuid references public.profiles (id),
  approver_id uuid references public.profiles (id),
  status text not null default 'pending',
  decision text,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  comment text,
  related_record_id text not null,
  high_risk boolean not null default false
);

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  attachment_type text not null,
  linked_record_id text not null,
  storage_path text not null,
  uploaded_by uuid references public.profiles (id),
  uploaded_at timestamptz not null default now()
);

create table public.csv_exports (
  id uuid primary key default gen_random_uuid(),
  export_type text not null,
  date_range text not null,
  generated_by uuid references public.profiles (id),
  generated_at timestamptz not null default now(),
  row_count integer not null,
  storage_path text
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id),
  role public.app_role,
  occurred_at timestamptz not null default now(),
  action text not null,
  linked_record_id text not null,
  device_type text,
  previous_value jsonb,
  new_value jsonb,
  attachment_id uuid references public.attachments (id)
);

alter table public.profiles enable row level security;
alter table public.skus enable row level security;
alter table public.locations enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.inventory_ledger enable row level security;
alter table public.receiving_records enable row level security;
alter table public.receiving_items enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.pick_tasks enable row level security;
alter table public.task_scans enable row level security;
alter table public.return_records enable row level security;
alter table public.procurement_requests enable row level security;
alter table public.approvals enable row level security;
alter table public.attachments enable row level security;
alter table public.csv_exports enable row level security;
alter table public.audit_events enable row level security;

create policy "internal users can read profiles" on public.profiles
  for select to authenticated using (true);
create policy "users can read and maintain their profile" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

create policy "authenticated users can read sku reference data" on public.skus
  for select to authenticated using (true);
create policy "authenticated users can read locations" on public.locations
  for select to authenticated using (true);

create policy "authenticated users can read inventory balances" on public.inventory_balances
  for select to authenticated using (true);
create policy "authenticated users can write inventory balances" on public.inventory_balances
  for all to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "authenticated users can read inventory ledger" on public.inventory_ledger
  for select to authenticated using (true);
create policy "authenticated users can insert inventory ledger" on public.inventory_ledger
  for insert to authenticated with check (auth.uid() is not null);

create policy "authenticated users can manage receiving" on public.receiving_records
  for all to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated users can manage receiving items" on public.receiving_items
  for all to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);

create policy "authenticated users can manage orders" on public.orders
  for all to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated users can manage order items" on public.order_items
  for all to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated users can manage pick tasks" on public.pick_tasks
  for all to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated users can insert task scans" on public.task_scans
  for insert to authenticated with check (auth.uid() is not null);
create policy "authenticated users can read task scans" on public.task_scans
  for select to authenticated using (true);

create policy "authenticated users can manage returns" on public.return_records
  for all to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated users can manage procurement" on public.procurement_requests
  for all to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated users can manage approvals" on public.approvals
  for all to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated users can manage attachments" on public.attachments
  for all to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated users can manage csv exports" on public.csv_exports
  for all to authenticated using (auth.uid() is not null) with check (auth.uid() is not null);
create policy "authenticated users can insert audit events" on public.audit_events
  for insert to authenticated with check (auth.uid() is not null);
create policy "authenticated users can read audit events" on public.audit_events
  for select to authenticated using (true);

insert into storage.buckets (id, name, public)
values ('warehouse-evidence', 'warehouse-evidence', false)
on conflict (id) do nothing;

create policy "authenticated users can upload warehouse evidence"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'warehouse-evidence' and auth.uid() is not null);
create policy "authenticated users can read warehouse evidence"
  on storage.objects for select to authenticated
  using (bucket_id = 'warehouse-evidence' and auth.uid() is not null);

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema public grant usage, select on sequences to authenticated, service_role;
