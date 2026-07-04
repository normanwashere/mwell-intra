-- Mwell Intra — warehouse schema (Step 2c: port of the mwell-intra-warehouse DB)
--
-- Ports the live `warehouse` Postgres schema (mwell-intra-warehouse/supabase/
-- migrations/*.sql, design in docs/LLD.md §11) into the M-Intra monorepo. The
-- warehouse module keeps its OWN dedicated schema alongside `core` (spec §3);
-- the client pins `db.schema = 'warehouse'`.
--
-- This first warehouse migration is the DDL layer only: it recreates every table
-- in its FINAL shape (init + purchase_orders + storage_areas/bins + the v4/v5
-- bin dimensions + cycle_counts.bin_id), the single `stock_levels` unique index
-- (NULLS NOT DISTINCT), the internal bin foreign keys the hardening added, the
-- location-delete orphan guard (v8), and the grants. RLS is ENABLED here but the
-- role-aware POLICIES + write lockdown live in 20260706092200_warehouse_rls.sql,
-- and every SECURITY DEFINER RPC lives in 20260706092400_warehouse_rpcs.sql.
--
-- DESIGN NOTE (docs/LLD.md §4.2): the base tables intentionally use only primary
-- keys + the one stock_levels unique index — NO foreign keys or check
-- constraints; referential integrity is enforced in the app / RPCs. The ONLY
-- exception is the bin_id -> storage_areas FKs the security hardening (v4/v5)
-- added deliberately so scan-to-find never resolves a deleted bin.
--
-- Migration order (see supabase/README.md): all `core` migrations first, then:
--   20260706092000_warehouse_schema            <- this file
--   20260706092100_warehouse_step2_deltas       (ADR-002: core_vendor_id, PO origin)
--   20260706092200_warehouse_rls                (role-aware RLS on core.has_cap)
--   20260706092300_warehouse_evidence_storage   (evidence bucket + storage.objects)
--   20260706092400_warehouse_rpcs               (SECURITY DEFINER RPCs, v1->v8)
--   20260706092500_warehouse_demo_auth_users     (guarded demo users + core RBAC)
--
-- Re-runnable: create schema/table if not exists, guarded add-constraint,
-- create-or-replace, drop-then-create trigger.

create extension if not exists "pgcrypto";

-- Dedicated application schema (never `public`).
create schema if not exists warehouse;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
create table if not exists warehouse.locations (
  id text primary key,
  name text not null,
  type text not null
);

create table if not exists warehouse.suppliers (
  id text primary key,
  name text not null,
  lead_time_days integer not null default 0
);

create table if not exists warehouse.products (
  id text primary key,
  sku text not null,
  name text not null,
  category text not null,
  device_type text,
  merchandise_type text,
  serialized boolean not null default false,
  attributes jsonb not null default '{}'::jsonb,
  unit_cost numeric not null default 0,
  reorder_point integer not null default 0,
  promotional boolean,
  barcode text,
  price numeric
);

-- Legacy demo/staff accounts for the role-tile login screen. NOTE: in the
-- monorepo the AUTHORITATIVE identity is `core.profiles` (id = auth.users.id).
-- This table is kept for warehouse parity (the ported UI reads it) and is a thin
-- projection of the demo directory; it is NOT the identity source of truth.
create table if not exists warehouse.profiles (
  id text primary key,
  role text not null,
  name text not null,
  email text not null,
  title text not null
);

create table if not exists warehouse.events (
  id text primary key,
  name text not null,
  type text not null,
  site_location_id text,
  start_date date not null,
  end_date date
);

create table if not exists warehouse.lots (
  id text primary key,
  product_id text not null,
  lot_code text,
  supplier_id text,
  unit_cost numeric not null default 0,
  received_at timestamptz
);

-- ---------------------------------------------------------------------------
-- Scannable storage areas (bins) inside a warehouse (source: storage_areas).
-- Created before inventory_units/stock_levels/cycle_counts declare their FKs.
-- ---------------------------------------------------------------------------
create table if not exists warehouse.storage_areas (
  id text primary key,
  location_id text not null,
  code text not null,
  label text,
  zone text,
  active boolean not null default true
);
create unique index if not exists storage_areas_code_uq
  on warehouse.storage_areas (location_id, code);

-- ---------------------------------------------------------------------------
-- Inventory state (bin_id carried since v3/v4; null = general/unassigned area)
-- ---------------------------------------------------------------------------
create table if not exists warehouse.inventory_units (
  id text primary key,
  product_id text not null,
  serial_number text not null,
  lot_id text,
  location_id text not null,
  status text not null,
  assigned_to text,
  event_id text,
  bin_id text
);

create table if not exists warehouse.stock_levels (
  product_id text not null,
  location_id text not null,
  lot_id text,
  quantity integer not null default 0,
  bin_id text
);
-- A single stock row per (product, location, bin, lot). NULLS NOT DISTINCT so
-- the common null-bin / null-lot case is a conflict target and upserts merge.
drop index if exists warehouse.stock_levels_uq;
create unique index if not exists stock_levels_uq
  on warehouse.stock_levels (product_id, location_id, bin_id, lot_id) nulls not distinct;

create table if not exists warehouse.allocations (
  id text primary key,
  event_id text not null,
  product_id text not null,
  quantity integer not null,
  status text not null,
  promotional boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists warehouse.movements (
  id text primary key,
  type text not null,
  product_id text not null,
  quantity integer not null,
  from_location_id text,
  to_location_id text,
  lot_id text,
  serial_number text,
  event_id text,
  reason text,
  reference text,
  evidence_urls jsonb not null default '[]'::jsonb,
  actor text not null,
  created_at timestamptz not null default now(),
  from_bin_id text,
  to_bin_id text
);

-- Document-style records (header + line items stored as jsonb)
create table if not exists warehouse.receipts (
  id text primary key,
  supplier_id text,
  location_id text not null,
  lines jsonb not null default '[]'::jsonb,
  evidence_urls jsonb not null default '[]'::jsonb,
  actor text not null,
  created_at timestamptz not null default now()
);

create table if not exists warehouse.returns (
  id text primary key,
  source text not null,
  event_id text,
  lines jsonb not null default '[]'::jsonb,
  evidence_urls jsonb not null default '[]'::jsonb,
  actor text not null,
  created_at timestamptz not null default now()
);

create table if not exists warehouse.cycle_counts (
  id text primary key,
  location_id text not null,
  category text,
  lines jsonb not null default '[]'::jsonb,
  actor text not null,
  created_at timestamptz not null default now(),
  bin_id text
);

-- ---------------------------------------------------------------------------
-- Purchase orders (source: purchase_orders). Lines stored as jsonb
-- ({ productId, quantityOrdered, quantityReceived }[]). The `origin` column is
-- added by 20260706092100_warehouse_step2_deltas.sql (ADR-002 #2).
-- ---------------------------------------------------------------------------
create table if not exists warehouse.purchase_orders (
  id text primary key,
  supplier_id text not null,
  status text not null,
  lines jsonb not null default '[]'::jsonb,
  expected_date date,
  actor text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Bin foreign keys (on delete set null) — the one deliberate FK exception the
-- security hardening (v4/v5) added so scan-to-find never shows stock/units/
-- counts in a deleted bin. Backfill orphans to null first, then guard-add.
-- ---------------------------------------------------------------------------
update warehouse.inventory_units set bin_id = null
 where bin_id is not null and bin_id not in (select id from warehouse.storage_areas);
update warehouse.stock_levels set bin_id = null
 where bin_id is not null and bin_id not in (select id from warehouse.storage_areas);
update warehouse.cycle_counts set bin_id = null
 where bin_id is not null and bin_id not in (select id from warehouse.storage_areas);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inventory_units_bin_fk') then
    alter table warehouse.inventory_units
      add constraint inventory_units_bin_fk foreign key (bin_id)
      references warehouse.storage_areas(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'stock_levels_bin_fk') then
    alter table warehouse.stock_levels
      add constraint stock_levels_bin_fk foreign key (bin_id)
      references warehouse.storage_areas(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'cycle_counts_bin_fk') then
    alter table warehouse.cycle_counts
      add constraint cycle_counts_bin_fk foreign key (bin_id)
      references warehouse.storage_areas(id) on delete set null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Orphan guard (v8): block deleting a location that still holds positive stock
-- or in-stock serialized units (defense-in-depth alongside the client check).
-- ---------------------------------------------------------------------------
create or replace function warehouse.prevent_location_delete_with_stock()
returns trigger language plpgsql set search_path = warehouse, public as $$
begin
  if exists (select 1 from warehouse.stock_levels s where s.location_id = old.id and s.quantity > 0) then
    raise exception 'Cannot delete location % — it still holds stock. Transfer or write off its stock first.', old.id;
  end if;
  if exists (select 1 from warehouse.inventory_units u where u.location_id = old.id and u.status = 'in_stock') then
    raise exception 'Cannot delete location % — it still holds in-stock units. Transfer or write off its stock first.', old.id;
  end if;
  return old;
end; $$;

drop trigger if exists trg_prevent_location_delete_with_stock on warehouse.locations;
create trigger trg_prevent_location_delete_with_stock
  before delete on warehouse.locations
  for each row execute function warehouse.prevent_location_delete_with_stock();

-- ---------------------------------------------------------------------------
-- Grants — the Data API roles use the schema. anon gets NOTHING (login is real
-- Supabase Auth; no anonymous warehouse reads). `authenticated` is granted table
-- privileges here; the RLS migration then REVOKES INSERT/UPDATE/DELETE on the
-- stock/audit/PO/lots tables so those change ONLY through the guarded RPCs.
-- service_role keeps its RLS bypass for seeding / recovery / scheduled jobs.
-- (PostgREST exposure of `warehouse` is already configured by the core
-- 20260706090900_core_expose_postgrest.sql migration.)
-- ---------------------------------------------------------------------------
grant usage on schema warehouse to authenticated, service_role;
grant all on all tables in schema warehouse to authenticated, service_role;
alter default privileges in schema warehouse
  grant all on tables to authenticated, service_role;

-- Enable RLS on every table now; policies are created in the RLS migration.
do $$
declare t text;
begin
  foreach t in array array[
    'locations','suppliers','products','profiles','events','lots','storage_areas',
    'inventory_units','stock_levels','allocations','movements','receipts',
    'returns','cycle_counts','purchase_orders'
  ]
  loop
    execute format('alter table warehouse.%I enable row level security;', t);
  end loop;
end $$;

notify pgrst, 'reload schema';
