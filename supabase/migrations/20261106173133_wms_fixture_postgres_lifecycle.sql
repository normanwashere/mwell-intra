-- Admin-only durable ownership for the bounded one-serial fixture adapter.
-- No existing business table, role, archive function or app permission changes.
set local lock_timeout='3s';
set local statement_timeout='30s';

create table private.wms_fixture_runs (
  run_id text primary key check(run_id ~ '^wms-fixture-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  plan jsonb not null check(jsonb_typeof(plan)='object'),
  bindings jsonb not null check(jsonb_typeof(bindings)='object'),
  preservation jsonb not null check(jsonb_typeof(preservation)='array'),
  created_at timestamptz not null default clock_timestamp()
);
create table private.wms_fixture_leases (
  run_id text primary key references private.wms_fixture_runs(run_id),
  fence uuid not null,
  state text not null check(state in ('open','drained'))
);
create table private.wms_fixture_operations (
  run_id text not null references private.wms_fixture_runs(run_id),
  operation_id text not null check(operation_id='seed-one-serial'),
  receipt_id text not null unique,
  completed_at timestamptz not null default clock_timestamp(),
  primary key(run_id,operation_id)
);
create table private.wms_fixture_owned_rows (
  run_id text not null,
  operation_id text not null,
  table_name text not null check(table_name in ('warehouse.products','warehouse.inventory_units','private.warehouse_unit_history')),
  row_id text not null,
  row_sha256 text not null check(row_sha256 ~ '^[0-9a-f]{64}$'),
  row_md5 text not null check(row_md5 ~ '^[0-9a-f]{32}$'),
  primary key(table_name,row_id),
  foreign key(run_id,operation_id) references private.wms_fixture_operations(run_id,operation_id)
);
do $guards$
declare t text;
begin
  foreach t in array array['wms_fixture_runs','wms_fixture_leases','wms_fixture_operations','wms_fixture_owned_rows'] loop
    execute format('alter table private.%I owner to postgres',t);
    execute format('alter table private.%I enable row level security',t);
    execute format('alter table private.%I force row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
    if t<>'wms_fixture_leases' then
      execute format('create trigger immutable_fixture_ledger before update or delete or truncate on private.%I for each statement execute function private.uat_warehouse_archive_immutable()',t);
    end if;
  end loop;
end;
$guards$;
