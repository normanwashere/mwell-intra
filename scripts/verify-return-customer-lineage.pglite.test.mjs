import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, after, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const actor = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const order = '33333333-3333-4333-8333-333333333333';
const caseId = '44444444-4444-4444-8444-444444444444';
const foreign = '55555555-5555-4555-8555-555555555555';
const migration = '20260913071110_customer_return_intake_lineage.sql';
const read = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const fn = (sql, name) => { const start = sql.indexOf(`create or replace function ${name}(`); assert(start >= 0, name); const body = sql.indexOf('as $$', start); return sql.slice(start, sql.indexOf('$$;', body + 5) + 3); };
const input = () => ({ idempotency_key: 'customer-lineage-test-0001', allocation_id: null, return: { source: 'customer', event_id: null,
  source_order_id: order, return_case_id: caseId, evidence_urls: [], lines: [{ productId: 'bulk', quantity: 1, reason: 'defective', locationId: 'wh', binId: 'bin', disposition: 'quarantine' }] } });
const rpc = async p => (await db.query('select warehouse.record_return_v2($1::jsonb) result', [JSON.stringify(p)])).rows[0].result;
const snapshot = async () => (await db.query(`select jsonb_build_object(
  'returns',(select jsonb_agg(t order by id) from warehouse.returns t),
  'stock',(select jsonb_agg(t order by product_id,location_id,bin_id,lot_id) from warehouse.stock_levels t),
  'holds',(select jsonb_agg(t order by id) from warehouse.inventory_holds t),
  'quality',(select jsonb_agg(t order by id) from warehouse.quality_inspections t),
  'movements',(select jsonb_agg(t order by id) from warehouse.movements t),
  'commands',(select jsonb_agg(t order by id) from warehouse.command_log t)) result`)).rows[0].result;

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema core; create schema private;
    create table core.profiles(id uuid primary key); insert into core.profiles values('${actor}'),('${other}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email',auth.uid()::text||'@test.invalid') $$;
    create function core.has_cap(text,text) returns boolean language sql stable as $$ select $2=any(string_to_array(current_setting('test.caps',true),',')) $$;
    create function core.has_live_cap(text,text) returns boolean language sql stable as $$ select core.has_cap($1,$2) and current_setting('test.live',true)='on' $$;
    create function private.warehouse_payload_hash(jsonb) returns text language sql as $$ select encode(sha256(convert_to($1::text,'UTF8')),'hex') $$;`);
  await db.exec((await read('20260706092000_warehouse_schema.sql')).replace('create extension if not exists "pgcrypto";', ''));
  const controls = await read('20260710150000_warehouse_w1_control_schema.sql');
  await db.exec(controls.slice(controls.indexOf('create table if not exists warehouse.quality_inspections'), controls.indexOf('create table if not exists warehouse.stock_change_requests')));
  await db.exec(controls.slice(controls.indexOf('create table if not exists warehouse.command_log'), controls.indexOf('create table if not exists warehouse.import_jobs')));
  const helpers = await read('20260710160000_warehouse_w1_quality_and_approval_rpcs.sql');
  await db.exec(fn(helpers, 'private.begin_idempotent_command')); await db.exec(fn(helpers, 'private.finish_idempotent_command'));
  await db.exec(`alter table warehouse.locations add column active boolean not null default true;
    alter table warehouse.quality_inspections add column bin_id text references warehouse.storage_areas(id);
    alter table warehouse.inventory_holds add column bin_id text references warehouse.storage_areas(id);
    create function private.lock_warehouse_products(text[]) returns void language sql as $$ select $$;
    create function private.warehouse_inspect_quality_v3(jsonb) returns jsonb language sql as $$ select $1 $$;
    create function warehouse.inspect_quality(payload jsonb) returns jsonb language plpgsql as $$ begin return private.warehouse_inspect_quality_v3(payload); end $$;
    create table warehouse.fulfillment_orders(id uuid primary key, created_by uuid, status text, lines jsonb);
    create table warehouse.department_stock_requests(id uuid primary key, fulfillment_order_id uuid, requested_by uuid);
    create table warehouse.customer_return_cases(id uuid primary key, source_order_id uuid references warehouse.fulfillment_orders, product_id text, serial_number text, created_by uuid);
    alter table warehouse.fulfillment_orders enable row level security;
    alter table warehouse.department_stock_requests enable row level security;
    alter table warehouse.customer_return_cases enable row level security;
    alter table warehouse.returns enable row level security;
    create policy returns_read on warehouse.returns for select to authenticated using(core.has_cap('warehouse','manage_returns'));
    grant usage on schema warehouse,core,auth to authenticated;
    grant select on warehouse.returns,warehouse.fulfillment_orders,warehouse.customer_return_cases,warehouse.department_stock_requests to authenticated;`);
  const policies = await read('20260721210000_cross_department_wms_advisor_remediation.sql');
  await db.exec(policies.slice(policies.indexOf('drop policy if exists fulfillment_orders_read')));
  await db.exec(await read('20260828033036_return_intake_atomic_quarantine.sql'));
  await db.exec(await read('20260828041500_return_intake_stock_state.sql'));
  await db.exec(fn(await read('20260707110000_warehouse_actor_identity.sql'), 'warehouse.record_return')
    .replace('function warehouse.record_return(', 'function warehouse.record_return_uncertified_impl('));
  await db.exec("alter table warehouse.events add column status text not null default 'planned'");
  await db.exec(await read('20260828060000_atomic_event_reservations.sql'));
  await db.exec(await read('20260905092000_warehouse_integrity.sql'));
  await db.exec(await read('20260905095000_return_intake_certified_boundary.sql'));
  await db.exec(`select set_config('request.jwt.claim.sub','${actor}',false),set_config('test.caps','manage_returns,issue_items',false),set_config('test.live','on',false);
    insert into warehouse.products(id,sku,name,category,serialized) values('bulk','B','Bulk','merchandise',false);
    insert into warehouse.locations(id,name,type) values('wh','Warehouse','warehouse');
    insert into warehouse.storage_areas(id,location_id,code) values('bin','wh','B');`);
  // A command cached before the migration must replay with exactly its old hash/response.
  const legacy = input(); delete legacy.return.source_order_id; delete legacy.return.return_case_id;
  const result = await rpc(legacy); const state = await snapshot();
  const beforePolicies = (await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows;
  await db.exec(await read(migration));
  assert.deepEqual((await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows, beforePolicies);
  assert.deepEqual(await rpc(legacy), result);
  legacy.return.source_order_id = null; legacy.return.return_case_id = null;
  assert.deepEqual(await rpc(legacy), result);
  assert.deepEqual((await snapshot()).commands, state.commands);
});
after(() => db.close());
beforeEach(async () => {
  await db.exec(`reset role; truncate warehouse.vendor_returns,warehouse.inventory_holds,warehouse.quality_inspections,warehouse.exceptions,warehouse.command_log,warehouse.returns,warehouse.movements,warehouse.stock_levels;
    delete from warehouse.customer_return_cases; delete from warehouse.fulfillment_orders;
    select set_config('request.jwt.claim.sub','${actor}',false),set_config('test.caps','manage_returns,issue_items',false),set_config('test.live','on',false);
    insert into warehouse.fulfillment_orders values('${order}','${other}','released','[{"productId":"bulk","quantity":2}]'),('${foreign}','${other}','received','[{"productId":"other"}]');
    insert into warehouse.customer_return_cases values('${caseId}','${order}','bulk',null,'${other}');`);
});

test('links persist atomically with real pending QC, held stock, movement and replay', async () => {
  const p = input(); const r = await rpc(p); const state = await snapshot();
  assert.equal(r.source_order_id, order); assert.equal(r.return_case_id, caseId);
  assert.equal(state.quality[0].source_id, r.id); assert.equal(state.quality[0].disposition, 'pending');
  assert.equal(state.holds[0].quantity, 1); assert.equal(state.holds[0].status, 'active'); assert.equal(state.stock[0].quantity, 1);
  assert.equal(state.movements[0].reference, r.id);
  assert.deepEqual(await rpc(p), r); assert.deepEqual(await snapshot(), state);
  await assert.rejects(rpc({ ...p, return: { ...p.return, return_case_id: null } }), /different payload/);
  assert.deepEqual(await snapshot(), state);
});
test('case-only derives order; order-only and unlinked remain supported without a completed-only gate', async () => {
  const p = input(); delete p.return.source_order_id;
  assert.equal((await rpc(p)).source_order_id, order);
  const next = input(); next.idempotency_key = 'customer-order-only-0001'; delete next.return.return_case_id;
  await db.exec(`update warehouse.fulfillment_orders set status='received' where id='${order}'`);
  assert.equal((await rpc(next)).source_order_id, order);
  delete next.return.source_order_id; next.idempotency_key = 'customer-unlinked-0001';
  assert.equal((await rpc(next)).source_order_id, null);
});
for (const [label, change] of [
  ['foreign case', p => p.return.return_case_id = foreign],
  ['case/order mismatch', p => p.return.source_order_id = foreign],
  ['foreign order product', p => { p.return.source_order_id = foreign; delete p.return.return_case_id; }],
  ['case product mismatch', p => p.return.lines[0].productId = 'other'],
  ['noncustomer source', p => p.return.source = 'vendor'],
  ['forged serial', p => p.return.lines[0].serialNumber = 'FOREIGN'],
]) test(`rejects ${label} with no partial custody or command`, async () => {
  const p = input(); change(p); const before = await snapshot(); await assert.rejects(rpc(p)); assert.deepEqual(await snapshot(), before);
});
test('source access is checked inside definer even for an intake-capable actor', async () => {
  await db.exec("select set_config('test.caps','manage_returns',false); set role authenticated");
  assert.deepEqual((await db.query('select id from warehouse.fulfillment_orders')).rows, []);
  await assert.rejects(rpc(input()), /unavailable|access/i);
  assert.deepEqual((await db.query('select id from warehouse.returns')).rows, []);
});
test('authorized actors retain RLS readback; source ownership alone grants no intake/raw-write authority', async () => {
  await db.exec('set role authenticated'); const r = await rpc(input());
  assert.equal((await db.query('select source_order_id from warehouse.returns where id=$1',[r.id])).rows[0].source_order_id, order);
  assert.deepEqual((await db.query('update warehouse.returns set source_order_id=$1 where id=$2 returning id',[foreign,r.id])).rows, []);
  assert.equal((await db.query('select source_order_id from warehouse.returns where id=$1',[r.id])).rows[0].source_order_id, order);
  await db.exec(`select set_config('request.jwt.claim.sub','${other}',false),set_config('test.caps','',false)`);
  await assert.rejects(rpc(input()), /authorized/i);
  assert.deepEqual((await db.query('select id from warehouse.returns')).rows, []);
});
test('current authentication/certification and hidden implementation grants stay fail-closed', async () => {
  await rpc(input()); await db.exec("select set_config('test.live','off',false)");
  await assert.rejects(rpc(input()), /authorized/i);
  await db.exec("select set_config('request.jwt.claim.sub','',false)"); await assert.rejects(rpc(input()), /Authentication/i);
  assert.equal((await db.query("select has_function_privilege('authenticated','warehouse.record_return_v2_certified_impl(jsonb)','execute') allowed")).rows[0].allowed, false);
});

test('valid source serial succeeds; an existing but different case product cannot be attached', async () => {
  await db.exec(`insert into warehouse.products(id,sku,name,category,serialized) values('device','D','Device','device',true);
    insert into warehouse.inventory_units(id,product_id,serial_number,location_id,status) values('unit','device','SERIAL-1','wh','issued');
    update warehouse.fulfillment_orders set lines='[{"productId":"bulk","quantity":2},{"productId":"device","quantity":1,"pickedSerialNumbers":["SERIAL-1"]}]' where id='${order}';`);
  const p = input(); p.return.lines[0] = { ...p.return.lines[0], productId: 'device', serialNumber: 'serial-1' };
  const before = await snapshot(); await assert.rejects(rpc(p), /case product or serial/i); assert.deepEqual(await snapshot(), before);
  await db.exec(`update warehouse.customer_return_cases set product_id='device',serial_number='SERIAL-1' where id='${caseId}'`);
  assert.equal((await rpc(p)).lines[0].serialNumber, 'SERIAL-1');
});
test('no new customer quantity cap; late failures roll back links and all intake effects', async () => {
  const p = input(); p.return.lines[0].quantity = 3;
  await db.exec(`create function private.fail_linked_return() returns trigger language plpgsql as $$ begin raise exception 'Injected late failure'; end $$;
    create trigger fail_linked_return before insert on warehouse.movements for each row execute function private.fail_linked_return();`);
  const before = await snapshot();
  try { await assert.rejects(rpc(p), /Injected late failure/); assert.deepEqual(await snapshot(), before); }
  finally { await db.exec('drop trigger fail_linked_return on warehouse.movements; drop function private.fail_linked_return()'); }
  assert.equal((await rpc(p)).lines[0].quantity, 3);
});
test('stored links prevent source deletion and helpers remain inaccessible to clients', async () => {
  const p = input(); delete p.return.return_case_id; await rpc(p);
  await db.exec('delete from warehouse.customer_return_cases');
  await assert.rejects(db.query('delete from warehouse.fulfillment_orders where id=$1',[order]), /foreign key/i);
  for (const role of ['anon','authenticated','service_role']) {
    assert.equal((await db.query("select has_function_privilege($1,'private.validate_return_customer_lineage(jsonb)','execute') allowed",[role])).rows[0].allowed, false);
  }
});
