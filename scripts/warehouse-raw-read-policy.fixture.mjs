import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { coreModule } from '../packages/rbac/src/modules/core.ts';
import { warehouseModule } from '../packages/rbac/src/modules/warehouse.ts';
import { eventsModule } from '../packages/rbac/src/modules/events.ts';
import { productModule } from '../packages/rbac/src/modules/product.ts';
import { procurementModule } from '../packages/rbac/src/modules/procurement.ts';
import { legalModule } from '../packages/rbac/src/modules/legal.ts';
import { insightsModule } from '../packages/rbac/src/modules/insights.ts';

export const POLICY_MIGRATION = '20260920080131_gate_warehouse_raw_reads_by_current_capability.sql';
export const READER = '11111111-1111-4111-8111-111111111111';
export const OTHER = '22222222-2222-4222-8222-222222222222';
export const RAW_TABLES = [
  'allocations', 'customer_return_cases', 'cycle_counts', 'department_stock_requests',
  'event_lifecycle_events', 'event_reconciliations', 'event_settlements', 'events',
  'exceptions', 'export_jobs', 'fulfillment_orders', 'fulfillment_reservations',
  'import_errors', 'import_jobs', 'inventory_holds', 'inventory_integrity_cases',
  'inventory_units', 'kit_definitions', 'locations', 'lots', 'movements',
  'operation_routes', 'operation_types', 'products', 'profiles', 'purchase_orders',
  'quality_inspections', 'receipts', 'receiving_drafts', 'rekit_work_orders',
  'returns', 'stock_change_requests', 'stock_levels', 'storage_areas', 'suppliers', 'vendor_returns',
];
export const ROLE_MODULES = [coreModule, warehouseModule, eventsModule, productModule, procurementModule, legalModule, insightsModule];
const readMigration = async name => (await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
const extract = (source, name) => source.match(new RegExp(`create or replace function ${name.replaceAll('.', '\\.')}\\([\\s\\S]*?\\$\\$;`, 'i'))[0];

export async function rawReadFixture({ apply = true } = {}) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema core; create schema learning; create schema warehouse; create schema private;
    grant usage on schema auth,core,warehouse,private to authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
    create table core.profiles(id uuid primary key,status text);
    insert into core.profiles values('${READER}','active'),('${OTHER}','active');
    create table core.roles(module text,role text,is_active boolean default true,primary key(module,role));
    create table core.role_capabilities(module text,role text,cap text,primary key(module,role,cap));
    create table core.user_roles(user_id uuid,module text,role text,effective_at timestamptz default now()-interval '1 day',expires_at timestamptz);
    create table learning.test_certification_required(module text,cap text);
    create function learning.is_certification_required(m text,c text) returns boolean language sql as $$select exists(select 1 from learning.test_certification_required where module=m and cap=c)$$;
    create function learning.has_active_certification(uuid,text,text) returns boolean language sql as $$select false$$;
    create function learning.has_active_emergency_exception(uuid,text,text) returns boolean language sql as $$select false$$;`);
  await db.exec(extract(await readMigration('20260816090000_security_database_launch_blocker_convergence.sql'), 'core.has_cap'));
  await db.exec(extract(await readMigration('20260812200000_learning_authority.sql'), 'core.has_live_cap'));
  for (const module of ROLE_MODULES) {
    for (const [role, definition] of Object.entries(module.roles)) {
      await db.query('insert into core.roles(module,role) values($1,$2)', [module.module, role]);
      for (const cap of definition.capabilities) {
        await db.query('insert into core.role_capabilities values($1,$2,$3)', [module.module, role, cap]);
      }
    }
  }
  // Actual UAT unconditional policy for primitives; deliberately permissive
  // surrounding fixtures prove the new restrictive boundary cannot widen rows.
  for (const table of RAW_TABLES) {
    await db.exec(`create table warehouse.${table}(id text primary key,event_id text,created_by uuid,requested_by uuid);
      insert into warehouse.${table} values('own','own-event','${READER}','${READER}'),('foreign','foreign-event','${OTHER}','${OTHER}');
      alter table warehouse.${table} enable row level security;
      grant select on warehouse.${table} to authenticated,service_role;
      create policy read_authenticated on warehouse.${table} for select to authenticated using(true);`);
  }
  await db.exec(`drop policy read_authenticated on warehouse.kit_definitions;
    create policy kit_definitions_read on warehouse.kit_definitions for select to authenticated using(core.has_cap('core','view_directory') or core.has_cap('warehouse','manage_products'));
    create view warehouse.inventory_read_projection with(security_invoker=true) as select * from warehouse.inventory_units;
    grant select on warehouse.inventory_read_projection to authenticated;
    create function warehouse.test_scoped_seller_read() returns setof warehouse.inventory_units language sql security definer set search_path='' as $$
      select * from warehouse.inventory_units where id='own' and core.has_live_cap('events','view_event_custody')$$;
    revoke all on function warehouse.test_scoped_seller_read() from public;
    grant execute on function warehouse.test_scoped_seller_read() to authenticated;`);
  if (apply) await db.exec(await readMigration(POLICY_MIGRATION));
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)", [READER]);
  return db;
}

export async function setRoles(db, roles) {
  await db.exec('reset role; delete from core.user_roles');
  for (const [module, role] of roles) await db.query('insert into core.user_roles(user_id,module,role) values($1,$2,$3)', [READER,module,role]);
  await db.exec('set role authenticated');
}
export async function readIds(db, table) {
  return (await db.query(`select id from warehouse.${table} order by id`)).rows.map(row => row.id);
}
