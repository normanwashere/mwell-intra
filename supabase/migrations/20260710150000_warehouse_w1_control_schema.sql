-- Warehouse W1 control foundation: governed routes, quality, holds, vendor
-- returns, stock-change approvals, exceptions, idempotency, and import evidence.

-- ---------------------------------------------------------------------------
-- Expiry and workflow context on the existing inventory spine
-- ---------------------------------------------------------------------------

alter table warehouse.products
  add column if not exists expiry_tracked boolean not null default false;
alter table warehouse.products
  add column if not exists shelf_life_warning_days integer not null default 30;
alter table warehouse.lots
  add column if not exists expiry_date date;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'warehouse_product_shelf_life_check'
  ) then
    alter table warehouse.products
      add constraint warehouse_product_shelf_life_check
      check (shelf_life_warning_days between 0 and 3650);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Controlled operation types and routes
-- ---------------------------------------------------------------------------

create table if not exists warehouse.operation_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint warehouse_operation_type_code_check check (
    code in (
      'receipt', 'putaway', 'transfer', 'issue', 'return', 'vendor_return',
      'cycle_count', 'adjustment'
    )
  )
);

create table if not exists warehouse.operation_routes (
  id uuid primary key default gen_random_uuid(),
  operation_type_id uuid not null references warehouse.operation_types(id) on delete restrict,
  name text not null,
  source_location_types text[] not null default '{}',
  destination_location_types text[] not null default '{}',
  requires_evidence boolean not null default false,
  requires_approval boolean not null default false,
  requires_online boolean not null default true,
  active boolean not null default true,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (operation_type_id, name),
  constraint warehouse_operation_route_source_check check (
    source_location_types <@ array['warehouse', 'event_site', 'vendor']::text[]
  ),
  constraint warehouse_operation_route_destination_check check (
    destination_location_types <@ array['warehouse', 'event_site', 'vendor']::text[]
  ),
  constraint warehouse_operation_route_dates_check check (
    effective_to is null or effective_to > effective_from
  )
);

create index if not exists warehouse_operation_routes_active_idx
  on warehouse.operation_routes(operation_type_id, active);

insert into warehouse.operation_types(code, label)
values
  ('receipt', 'Receipt'),
  ('putaway', 'Putaway'),
  ('transfer', 'Internal transfer'),
  ('issue', 'Issue / delivery'),
  ('return', 'Return intake'),
  ('vendor_return', 'Vendor return'),
  ('cycle_count', 'Cycle count'),
  ('adjustment', 'Stock adjustment')
on conflict (code) do update set label = excluded.label, active = true;

insert into warehouse.operation_routes (
  operation_type_id,
  name,
  source_location_types,
  destination_location_types,
  requires_evidence,
  requires_approval,
  requires_online
)
select
  id,
  'Default ' || label,
  case code
    when 'receipt' then array['vendor']::text[]
    when 'putaway' then array['warehouse']::text[]
    when 'transfer' then array['warehouse']::text[]
    when 'issue' then array['warehouse']::text[]
    when 'return' then array['event_site']::text[]
    when 'vendor_return' then array['warehouse']::text[]
    when 'cycle_count' then array['warehouse']::text[]
    else array['warehouse']::text[]
  end,
  case code
    when 'receipt' then array['warehouse']::text[]
    when 'putaway' then array['warehouse']::text[]
    when 'transfer' then array['warehouse', 'event_site']::text[]
    when 'issue' then array['event_site']::text[]
    when 'return' then array['warehouse']::text[]
    when 'vendor_return' then array['vendor']::text[]
    when 'cycle_count' then array['warehouse']::text[]
    else array['warehouse']::text[]
  end,
  code in ('receipt', 'return', 'vendor_return', 'adjustment'),
  code = 'adjustment',
  code in ('receipt', 'vendor_return', 'cycle_count', 'adjustment')
from warehouse.operation_types
on conflict (operation_type_id, name) do nothing;

alter table warehouse.receipts
  add column if not exists operation_route_id uuid references warehouse.operation_routes(id) on delete restrict;
alter table warehouse.receipts
  add column if not exists procurement_po_id text;
alter table warehouse.receipts
  add column if not exists quality_status text not null default 'pending';
alter table warehouse.cycle_counts
  add column if not exists status text not null default 'draft';
alter table warehouse.cycle_counts
  add column if not exists requested_by uuid references core.profiles(id) on delete set null;
alter table warehouse.cycle_counts
  add column if not exists submitted_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'warehouse_receipt_quality_status_check'
  ) then
    alter table warehouse.receipts
      add constraint warehouse_receipt_quality_status_check
      check (quality_status in ('pending', 'partial', 'accepted', 'hold', 'closed'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'warehouse_cycle_count_status_check'
  ) then
    alter table warehouse.cycle_counts
      add constraint warehouse_cycle_count_status_check
      check (status in ('draft', 'submitted', 'pending_approval', 'approved', 'rejected'));
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Quality, holds, vendor returns, exceptions, and approvals
-- ---------------------------------------------------------------------------

create table if not exists warehouse.quality_inspections (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id text not null,
  product_id text not null references warehouse.products(id) on delete restrict,
  lot_id text references warehouse.lots(id) on delete set null,
  serial_number text,
  location_id text not null references warehouse.locations(id) on delete restrict,
  quantity integer not null,
  disposition text not null default 'pending',
  reason text,
  evidence_urls jsonb not null default '[]'::jsonb,
  inspected_by uuid not null references core.profiles(id) on delete restrict,
  inspected_by_email text not null,
  inspected_at timestamptz not null default now(),
  constraint warehouse_quality_source_check check (source_type in ('receipt', 'return')),
  constraint warehouse_quality_quantity_check check (quantity > 0),
  constraint warehouse_quality_disposition_check check (
    disposition in ('pending', 'accepted', 'damaged', 'hold', 'vendor_return', 'unavailable')
  )
);

create index if not exists warehouse_quality_source_idx
  on warehouse.quality_inspections(source_type, source_id);
create index if not exists warehouse_quality_queue_idx
  on warehouse.quality_inspections(disposition, inspected_at desc, id);
create unique index if not exists warehouse_quality_serial_source_uq
  on warehouse.quality_inspections(source_type, source_id, serial_number)
  where serial_number is not null;

create table if not exists warehouse.inventory_holds (
  id uuid primary key default gen_random_uuid(),
  inspection_id uuid not null references warehouse.quality_inspections(id) on delete restrict,
  product_id text not null references warehouse.products(id) on delete restrict,
  location_id text not null references warehouse.locations(id) on delete restrict,
  lot_id text references warehouse.lots(id) on delete set null,
  serial_number text,
  quantity integer not null,
  status text not null default 'active',
  reason text not null,
  evidence_urls jsonb not null default '[]'::jsonb,
  created_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  released_by uuid references core.profiles(id) on delete restrict,
  released_at timestamptz,
  release_reason text,
  release_evidence_urls jsonb not null default '[]'::jsonb,
  constraint warehouse_hold_quantity_check check (quantity > 0),
  constraint warehouse_hold_status_check check (
    status in ('active', 'released', 'vendor_return', 'written_off')
  ),
  constraint warehouse_hold_release_check check (
    (status = 'active' and released_by is null and released_at is null)
    or (status <> 'active' and released_by is not null and released_at is not null)
  )
);

create index if not exists warehouse_holds_active_idx
  on warehouse.inventory_holds(status, created_at desc, id)
  where status = 'active';

create table if not exists warehouse.vendor_returns (
  id uuid primary key default gen_random_uuid(),
  hold_id uuid not null references warehouse.inventory_holds(id) on delete restrict,
  supplier_id text not null references warehouse.suppliers(id) on delete restrict,
  source_receipt_id text,
  source_return_id text,
  product_id text not null references warehouse.products(id) on delete restrict,
  lot_id text references warehouse.lots(id) on delete set null,
  serial_number text,
  quantity integer not null,
  reason text not null,
  reference text not null,
  status text not null default 'draft',
  evidence_urls jsonb not null default '[]'::jsonb,
  created_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  handed_off_by uuid references core.profiles(id) on delete restrict,
  handed_off_at timestamptz,
  completed_at timestamptz,
  constraint warehouse_vendor_return_quantity_check check (quantity > 0),
  constraint warehouse_vendor_return_status_check check (
    status in ('draft', 'ready', 'handed_off', 'completed', 'cancelled')
  )
);

create index if not exists warehouse_vendor_returns_status_idx
  on warehouse.vendor_returns(status, created_at desc, id);

create table if not exists warehouse.exceptions (
  id uuid primary key default gen_random_uuid(),
  exception_type text not null,
  severity text not null,
  source_type text not null,
  source_id text not null,
  status text not null default 'open',
  owner_id uuid references core.profiles(id) on delete set null,
  due_at timestamptz,
  resolution text,
  evidence_urls jsonb not null default '[]'::jsonb,
  waived_by uuid references core.profiles(id) on delete restrict,
  waived_at timestamptz,
  created_by uuid not null references core.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint warehouse_exception_type_check check (
    exception_type in ('quality', 'count_variance', 'po_receipt', 'scan_mismatch', 'import')
  ),
  constraint warehouse_exception_severity_check check (severity in ('P1', 'P2', 'P3')),
  constraint warehouse_exception_status_check check (
    status in ('open', 'in_progress', 'resolved', 'waived', 'cancelled')
  ),
  constraint warehouse_exception_waiver_check check (
    status <> 'waived' or (severity <> 'P1' and waived_by is not null and waived_at is not null)
  )
);

create index if not exists warehouse_exceptions_queue_idx
  on warehouse.exceptions(status, severity, due_at, created_at, id)
  where status in ('open', 'in_progress');
create index if not exists warehouse_exceptions_source_idx
  on warehouse.exceptions(source_type, source_id);

create table if not exists warehouse.stock_change_requests (
  id uuid primary key default gen_random_uuid(),
  source_type text not null,
  source_id text not null,
  product_id text not null references warehouse.products(id) on delete restrict,
  location_id text not null references warehouse.locations(id) on delete restrict,
  bin_id text references warehouse.storage_areas(id) on delete set null,
  quantity_delta integer not null,
  unit_cost numeric(14, 4) not null,
  financial_impact numeric(16, 4) generated always as (abs(quantity_delta * unit_cost)) stored,
  reason text not null,
  evidence_urls jsonb not null default '[]'::jsonb,
  status text not null default 'pending_supervisor',
  requested_by uuid not null references core.profiles(id) on delete restrict,
  requested_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  constraint warehouse_stock_change_source_check check (
    source_type in ('cycle_count', 'adjustment', 'write_off')
  ),
  constraint warehouse_stock_change_quantity_check check (quantity_delta <> 0),
  constraint warehouse_stock_change_cost_check check (unit_cost >= 0),
  constraint warehouse_stock_change_status_check check (
    status in ('pending_supervisor', 'pending_finance', 'approved', 'rejected')
  )
);

create index if not exists warehouse_stock_change_pending_idx
  on warehouse.stock_change_requests(status, requested_at, id)
  where status in ('pending_supervisor', 'pending_finance');

-- ---------------------------------------------------------------------------
-- Idempotent command evidence and governed imports
-- ---------------------------------------------------------------------------

create table if not exists warehouse.command_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references core.profiles(id) on delete restrict,
  command_name text not null,
  idempotency_key text not null,
  payload_hash text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (actor_id, command_name, idempotency_key),
  constraint warehouse_command_hash_check check (payload_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists warehouse_command_log_created_idx
  on warehouse.command_log(created_at desc);

create table if not exists warehouse.import_jobs (
  id uuid primary key default gen_random_uuid(),
  import_kind text not null,
  schema_version text not null,
  filename text not null,
  storage_path text not null unique,
  checksum_sha256 text not null,
  source_rows integer not null default 0,
  accepted_rows integer not null default 0,
  rejected_rows integer not null default 0,
  duplicate_rows integer not null default 0,
  status text not null default 'validating',
  created_by uuid not null references core.profiles(id) on delete restrict,
  created_by_email text not null,
  created_at timestamptz not null default now(),
  reviewed_by uuid references core.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  applied_at timestamptz,
  corrected_from uuid references warehouse.import_jobs(id) on delete restrict,
  constraint warehouse_import_kind_check check (
    import_kind in ('locations_bins_v1', 'products_opening_stock_v1')
  ),
  constraint warehouse_import_status_check check (
    status in ('validating', 'invalid', 'ready', 'approved', 'applying', 'applied', 'failed', 'superseded')
  ),
  constraint warehouse_import_checksum_check check (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  constraint warehouse_import_counts_check check (
    source_rows >= 0 and accepted_rows >= 0 and rejected_rows >= 0 and duplicate_rows >= 0
    and source_rows = accepted_rows + rejected_rows + duplicate_rows
  ),
  constraint warehouse_import_review_check check (
    reviewed_by is null or reviewed_by <> created_by
  )
);

create index if not exists warehouse_import_jobs_status_idx
  on warehouse.import_jobs(status, created_at desc, id);
create index if not exists warehouse_import_jobs_creator_idx
  on warehouse.import_jobs(created_by, created_at desc);

create table if not exists warehouse.import_errors (
  id bigserial primary key,
  import_job_id uuid not null references warehouse.import_jobs(id) on delete cascade,
  row_number integer not null,
  field_name text not null,
  error_code text not null,
  message text not null,
  created_at timestamptz not null default now(),
  constraint warehouse_import_error_row_check check (row_number >= 1)
);

create index if not exists warehouse_import_errors_job_idx
  on warehouse.import_errors(import_job_id, row_number, id);

-- ---------------------------------------------------------------------------
-- RLS and least-privilege grants
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'operation_types', 'operation_routes', 'quality_inspections',
    'inventory_holds', 'vendor_returns', 'exceptions',
    'stock_change_requests', 'command_log', 'import_jobs', 'import_errors'
  ]
  loop
    execute format('alter table warehouse.%I enable row level security', t);
    execute format('alter table warehouse.%I force row level security', t);
  end loop;
end
$$;

-- Keep explicit statements for static release verification.
alter table warehouse.operation_types enable row level security;
alter table warehouse.operation_types force row level security;
alter table warehouse.operation_routes enable row level security;
alter table warehouse.operation_routes force row level security;
alter table warehouse.quality_inspections enable row level security;
alter table warehouse.quality_inspections force row level security;
alter table warehouse.inventory_holds enable row level security;
alter table warehouse.inventory_holds force row level security;
alter table warehouse.vendor_returns enable row level security;
alter table warehouse.vendor_returns force row level security;
alter table warehouse.exceptions enable row level security;
alter table warehouse.exceptions force row level security;
alter table warehouse.stock_change_requests enable row level security;
alter table warehouse.stock_change_requests force row level security;
alter table warehouse.command_log enable row level security;
alter table warehouse.command_log force row level security;
alter table warehouse.import_jobs enable row level security;
alter table warehouse.import_jobs force row level security;
alter table warehouse.import_errors enable row level security;
alter table warehouse.import_errors force row level security;

drop policy if exists warehouse_operation_types_read on warehouse.operation_types;
create policy warehouse_operation_types_read on warehouse.operation_types
  for select to authenticated
  using (core.has_module_role('warehouse'));

drop policy if exists warehouse_operation_routes_read on warehouse.operation_routes;
create policy warehouse_operation_routes_read on warehouse.operation_routes
  for select to authenticated
  using (core.has_module_role('warehouse'));

drop policy if exists warehouse_quality_read on warehouse.quality_inspections;
create policy warehouse_quality_read on warehouse.quality_inspections
  for select to authenticated
  using (
    core.has_cap('warehouse', 'inspect_quality')
    or core.has_cap('warehouse', 'view_exceptions')
    or core.has_cap('warehouse', 'view_finance')
  );

drop policy if exists warehouse_holds_read on warehouse.inventory_holds;
create policy warehouse_holds_read on warehouse.inventory_holds
  for select to authenticated
  using (
    core.has_cap('warehouse', 'inspect_quality')
    or core.has_cap('warehouse', 'view_exceptions')
    or core.has_cap('warehouse', 'view_finance')
  );

drop policy if exists warehouse_vendor_returns_read on warehouse.vendor_returns;
create policy warehouse_vendor_returns_read on warehouse.vendor_returns
  for select to authenticated
  using (
    core.has_cap('warehouse', 'inspect_quality')
    or core.has_cap('warehouse', 'view_procurement')
    or core.has_cap('warehouse', 'view_exceptions')
  );

drop policy if exists warehouse_exceptions_read on warehouse.exceptions;
create policy warehouse_exceptions_read on warehouse.exceptions
  for select to authenticated
  using (core.has_cap('warehouse', 'view_exceptions'));

drop policy if exists warehouse_stock_changes_read on warehouse.stock_change_requests;
create policy warehouse_stock_changes_read on warehouse.stock_change_requests
  for select to authenticated
  using (
    requested_by = auth.uid()
    or core.has_cap('warehouse', 'approve_stock_adjustment')
    or core.has_cap('warehouse', 'view_exceptions')
  );

drop policy if exists warehouse_import_jobs_read on warehouse.import_jobs;
create policy warehouse_import_jobs_read on warehouse.import_jobs
  for select to authenticated
  using (
    created_by = auth.uid()
    or core.has_cap('warehouse', 'import_warehouse_data')
    or core.has_cap('warehouse', 'view_finance')
  );

drop policy if exists warehouse_import_errors_read on warehouse.import_errors;
create policy warehouse_import_errors_read on warehouse.import_errors
  for select to authenticated
  using (
    exists (
      select 1
      from warehouse.import_jobs j
      where j.id = import_job_id
        and (
          j.created_by = auth.uid()
          or core.has_cap('warehouse', 'import_warehouse_data')
          or core.has_cap('warehouse', 'view_finance')
        )
    )
  );

revoke all on warehouse.operation_types from public, anon, authenticated;
revoke all on warehouse.operation_routes from public, anon, authenticated;
revoke all on warehouse.quality_inspections from public, anon, authenticated;
revoke all on warehouse.inventory_holds from public, anon, authenticated;
revoke all on warehouse.vendor_returns from public, anon, authenticated;
revoke all on warehouse.exceptions from public, anon, authenticated;
revoke all on warehouse.stock_change_requests from public, anon, authenticated;
revoke all on warehouse.command_log from public, anon, authenticated;
revoke all on warehouse.import_jobs from public, anon, authenticated;
revoke all on warehouse.import_errors from public, anon, authenticated;

grant select on warehouse.operation_types to authenticated;
grant select on warehouse.operation_routes to authenticated;
grant select on warehouse.quality_inspections to authenticated;
grant select on warehouse.inventory_holds to authenticated;
grant select on warehouse.vendor_returns to authenticated;
grant select on warehouse.exceptions to authenticated;
grant select on warehouse.stock_change_requests to authenticated;
grant select on warehouse.import_jobs to authenticated;
grant select on warehouse.import_errors to authenticated;

grant all on warehouse.operation_types to service_role;
grant all on warehouse.operation_routes to service_role;
grant all on warehouse.quality_inspections to service_role;
grant all on warehouse.inventory_holds to service_role;
grant all on warehouse.vendor_returns to service_role;
grant all on warehouse.exceptions to service_role;
grant all on warehouse.stock_change_requests to service_role;
grant all on warehouse.command_log to service_role;
grant all on warehouse.import_jobs to service_role;
grant all on warehouse.import_errors to service_role;
grant usage, select on sequence warehouse.import_errors_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- Capability catalogue and role grants
-- ---------------------------------------------------------------------------

insert into core.capabilities(module, cap)
values
  ('warehouse', 'manage_operation_routes'),
  ('warehouse', 'inspect_quality'),
  ('warehouse', 'release_quality_hold'),
  ('warehouse', 'approve_stock_adjustment'),
  ('warehouse', 'view_exceptions'),
  ('warehouse', 'resolve_exceptions'),
  ('warehouse', 'import_warehouse_data')
on conflict do nothing;

insert into core.roles(module, role, label)
values ('warehouse', 'warehouse_admin', 'Warehouse Administrator')
on conflict (module, role) do update set label = excluded.label;

insert into core.role_capabilities(module, role, cap)
values
  ('warehouse', 'logistics_supervisor', 'manage_operation_routes'),
  ('warehouse', 'logistics_supervisor', 'inspect_quality'),
  ('warehouse', 'logistics_supervisor', 'release_quality_hold'),
  ('warehouse', 'logistics_supervisor', 'approve_stock_adjustment'),
  ('warehouse', 'logistics_supervisor', 'view_exceptions'),
  ('warehouse', 'logistics_supervisor', 'resolve_exceptions'),
  ('warehouse', 'logistics_supervisor', 'import_warehouse_data'),
  ('warehouse', 'operations', 'inspect_quality'),
  ('warehouse', 'operations', 'view_exceptions'),
  ('warehouse', 'finance', 'approve_stock_adjustment'),
  ('warehouse', 'finance', 'view_exceptions'),
  ('warehouse', 'bi_analyst', 'view_exceptions')
on conflict do nothing;

insert into core.role_capabilities(module, role, cap)
select 'warehouse', 'warehouse_admin', cap
from core.capabilities
where module = 'warehouse'
on conflict do nothing;

select pg_notify('pgrst', 'reload schema');
