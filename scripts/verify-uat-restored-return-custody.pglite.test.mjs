import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const candidate = read('20261106134950_uat_restored_unit_return_custody');
const original = read('20260721200000_cross_department_wms_persistence');
const controls = read('20260710150000_warehouse_w1_control_schema');
const completion = read('20260804200000_operational_flow_completion');
const gated = read('20260920025525_gated_event_seller_custody');
const fn = (sql, name) => {
  const start = sql.search(new RegExp(`create(?: or replace)? function ${name.replaceAll('.', '\\.')}\\(`, 'i'));
  assert(start >= 0, name);
  const body = sql.indexOf('$$', start);
  return sql.slice(start, sql.indexOf('$$;', body + 2) + 3);
};
const table = (sql, name) => {
  const start = sql.indexOf(`create table if not exists ${name} (`);
  assert(start >= 0, name);
  return sql.slice(start, sql.indexOf('\n);', start) + 3);
};
const A = '11111111-1111-4111-8111-111111111111';
const OLD = '22222222-2222-4222-8222-222222222222';
const NEW = '33333333-3333-4333-8333-333333333333';
const OTHER = '44444444-4444-4444-8444-444444444444';
const CASE = '55555555-5555-4555-8555-555555555555';
const OLD_CASE = '66666666-6666-4666-8666-666666666666';
const supersededMessage = 'This watch was restored to stock during UAT cleanup. Use its current order for a return, not this old test order.';
const signatures = ['warehouse.record_return_v2(jsonb)', 'warehouse.record_return_v2_certified_impl(jsonb)', 'warehouse.resolve_customer_return_case(jsonb)',
  'private.warehouse_create_customer_return_case(jsonb)', 'private.warehouse_resolve_customer_return_case(jsonb)'];
let db, beforeMetadata, beforeDefinitions;

const intake = (order = OLD, serial = 'RESET-1') => ({ idempotency_key: `return-intake-${serial}`,
  return: { source: 'customer', source_order_id: order, evidence_urls: [], lines: [
    { productId: 'device', serialNumber: serial, quantity: 1, reason: 'Reported fault', disposition: 'quarantine', locationId: 'wh', binId: 'bin' },
  ] } });
const caseInput = (order = OLD, serial = 'RESET-1') => ({ idempotency_key: `create-case-${serial}`, return_case_id: CASE,
  source_order_id: order, product_id: 'device', serial_number: serial, defect_description: 'Reported fault' });
const resolve = (id = CASE) => ({ idempotency_key: `resolve-case-${id}`, return_case_id: id,
  resolution: 're_kit', quarantine_bin_id: 'bin' });
async function rpc(name, payload) {
  await db.exec('savepoint rpc_actor; set local role authenticated');
  try { return (await db.query(`select warehouse.${name}($1::jsonb) as result`, [payload])).rows[0].result; }
  catch (error) { await db.exec('rollback to savepoint rpc_actor'); throw error; }
  finally { await db.exec('reset role; release savepoint rpc_actor'); }
}
async function isolated(fn) {
  await db.exec('begin');
  try { await fn(); } finally { await db.exec('rollback'); }
}
async function denied(fn, pattern = /Restored unit|This watch|Use this watch|Choose the event/) {
  const before = await snapshot();
  await db.exec('savepoint probe');
  try { await assert.rejects(fn, pattern); }
  finally { await db.exec('rollback to savepoint probe; release savepoint probe'); }
  assert.deepEqual(await snapshot(), before);
}
async function snapshot() {
  const result = {};
  for (const name of ['inventory_units', 'returns', 'movements', 'quality_inspections', 'inventory_holds', 'customer_return_cases', 'fulfillment_orders', 'command_log']) {
    result[name] = (await db.query(`select to_jsonb(t) as row from warehouse.${name} t order by id`)).rows;
  }
  result.history = (await db.query('select * from private.warehouse_unit_history order by id')).rows;
  result.archives = (await db.query('select * from private.uat_admin_reset_archives order by batch_id')).rows;
  return result;
}
async function metadata() {
  return (await db.query(`select p.oid,p.oid::regprocedure::text as signature,p.proowner,p.proacl::text,p.prosecdef,
    p.provolatile,p.proconfig,p.prolang,p.prorettype,p.proargtypes::text,p.proargnames,p.pronargdefaults
    from pg_proc p where p.oid=any($1::regprocedure[]) order by p.oid`, [signatures])).rows;
}

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema core; create schema private;
    create table core.profiles(id uuid primary key,email text); insert into core.profiles(id) values('${A}');
    create table core.activity_log(module text,entity_type text,entity_id text,action text,actor uuid,detail jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;
    create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
    create function core.has_cap(text,text) returns boolean language sql stable as $$select current_setting('test.allowed',true)='yes'$$;
    create function core.has_live_cap(text,text) returns boolean language sql stable as $$select core.has_cap($1,$2)$$;
    create function private.warehouse_payload_hash(jsonb) returns text language sql as $$select encode(sha256(convert_to($1::text,'UTF8')),'hex')$$;
    select set_config('test.actor','${A}',false),set_config('test.allowed','yes',false);`);
  await db.exec(read('20260706092000_warehouse_schema').replace('create extension if not exists "pgcrypto";', ''));
  await db.exec(controls.slice(controls.indexOf('create table if not exists warehouse.quality_inspections'), controls.indexOf('create table if not exists warehouse.stock_change_requests')));
  await db.exec(table(controls, 'warehouse.command_log'));
  const helpers = read('20260710160000_warehouse_w1_quality_and_approval_rpcs');
  await db.exec(fn(helpers, 'private.begin_idempotent_command'));
  await db.exec(fn(helpers, 'private.finish_idempotent_command'));
  await db.exec(fn(read('20260714175318_single_po_receipt_authority'), 'private.lock_warehouse_products'));
  await db.exec(`alter table warehouse.locations add column active boolean default true;
    alter table warehouse.quality_inspections add column bin_id text;
    alter table warehouse.inventory_holds add column bin_id text;
    create function private.warehouse_inspect_quality_v3(jsonb) returns jsonb language sql as $$select $1$$;
    create function warehouse.inspect_quality(payload jsonb) returns jsonb language plpgsql as $$begin return private.warehouse_inspect_quality_v3(payload);end$$;
    create table warehouse.department_stock_requests(id uuid,fulfillment_order_id uuid,requested_by uuid);`);
  await db.exec(table(original, 'warehouse.fulfillment_orders'));
  await db.exec("create unique index fulfillment_reference on warehouse.fulfillment_orders(lower(external_reference)); alter table warehouse.fulfillment_orders add column customer_name text, add column customer_contact text, add column customer_email text, add column delivery_address jsonb;");
  const lifecycle = read('20260804150000_inventory_release_lifecycle_remediation');
  const lifecycleStart = lifecycle.indexOf('alter table warehouse.fulfillment_orders\n  add column');
  const lifecycleEnd = lifecycle.indexOf('create ', lifecycleStart);
  assert(lifecycleStart >= 0 && lifecycleEnd > lifecycleStart);
  await db.exec(lifecycle.slice(lifecycleStart, lifecycleEnd));
  await db.exec(table(original, 'warehouse.customer_return_cases'));
  await db.exec(table(completion, 'warehouse.event_reconciliations'));
  await db.exec(completion.slice(completion.indexOf('alter table warehouse.customer_return_cases'), completion.indexOf('create or replace function warehouse.resolve_customer_return_case')));
  for (const name of ['private.warehouse_create_customer_return_case','private.warehouse_resolve_customer_return_case','warehouse.create_customer_return_case']) await db.exec(fn(original, name));
  await db.exec(fn(completion, 'warehouse.resolve_customer_return_case'));
  await db.exec(read('20260910133142_replacement_delivery_confirmation'));
  await db.exec(read('20260911170103_requester_names_return_live_authority').match(/do \$return_resolution\$[\s\S]*?\$return_resolution\$;/)[0]);
  await db.exec(read('20260828033036_return_intake_atomic_quarantine'));
  await db.exec(read('20260828041500_return_intake_stock_state'));
  await db.exec(fn(read('20260707110000_warehouse_actor_identity'), 'warehouse.record_return')
    .replace('function warehouse.record_return(', 'function warehouse.record_return_uncertified_impl('));
  await db.exec("alter table warehouse.events add column status text not null default 'planned'");
  await db.exec(read('20260828060000_atomic_event_reservations'));
  await db.exec(read('20260905092000_warehouse_integrity'));
  await db.exec(read('20260905095000_return_intake_certified_boundary'));
  await db.exec(read('20260913071110_customer_return_intake_lineage'));
  // Keep the real event custody helpers, retained-body hook and write trigger.
  await db.exec(gated.slice(gated.indexOf('create table private.event_custody_sessions'), gated.indexOf('create index event_custody_entries_allocation')));
  await db.exec(fn(gated, 'private.event_allocation_remaining'));
  await db.exec(fn(gated, 'private.assert_event_return_payload'));
  const eventHook = gated.indexOf("do $$ declare definition text:=pg_get_functiondef('warehouse.record_return_v2_certified_impl(jsonb)'");
  assert(eventHook >= 0);
  await db.exec(gated.slice(eventHook, gated.indexOf('end $$;', eventHook) + 'end $$;'.length));
  await db.exec(fn(gated, 'private.guard_event_custody_return_write'));
  await db.exec('create trigger aa_event_custody_return_write before insert or update on warehouse.returns for each row execute function private.guard_event_custody_return_write()');
  await db.exec(fn(gated, 'private.assert_event_custody_open'));
  await db.exec(fn(gated, 'private.capture_acknowledged_event_custody'));
  await db.exec('create trigger capture_acknowledged_event_custody after update of acknowledged_at on warehouse.fulfillment_orders for each row execute function private.capture_acknowledged_event_custody()');
  await db.exec(fn(read('20260707110000_warehouse_actor_identity'), 'warehouse.authoritative_actor'));
  await db.exec(fn(original, 'private.warehouse_advance_fulfillment_order'));
  await db.exec(fn(gated, 'warehouse.record_return_v2'));
  await db.exec(read('20261105071201_warehouse_unit_custody_history'));
  await db.exec(read('20261019151646_uat_private_maintenance_archive'));
  await db.exec('begin');
  await db.exec(read('20261106134948_uat_archive_restore_test_issued_units'));
  await db.exec('commit');
  await db.exec(`grant usage on schema warehouse,auth,core,private to authenticated,anon,service_role;
    revoke all on function private.warehouse_create_customer_return_case(jsonb),private.warehouse_resolve_customer_return_case(jsonb) from public,anon,authenticated;
    grant execute on function private.warehouse_create_customer_return_case(jsonb),private.warehouse_resolve_customer_return_case(jsonb) to service_role;
    revoke all on function warehouse.create_customer_return_case(jsonb) from public,anon;
    grant execute on function warehouse.create_customer_return_case(jsonb) to authenticated,service_role;
    insert into warehouse.products(id,sku,name,category,serialized) values('device','D','Device','device',true);
    insert into warehouse.locations(id,name,type) values('wh','Warehouse','warehouse');
    insert into warehouse.storage_areas(id,location_id,code) values('bin','wh','BIN');
    insert into warehouse.fulfillment_orders(id,source,external_reference,status,lines,created_by,released_by,released_at,courier,waybill_number)
      select id::uuid,'ecommerce',ref,'released','[{"productId":"device","quantity":1,"pickedSerialNumbers":["RESET-1","LEGACY-1"]}]',
        '${A}','${A}',now(),'Courier','Waybill' from (values('${OLD}','OLD-ORDER'),('${NEW}','NEW-ORDER'),('${OTHER}','OTHER-ORDER')) t(id,ref);
    insert into warehouse.inventory_units(id,product_id,serial_number,location_id,bin_id,status) values('reset-unit','device','RESET-1','wh','bin','in_stock');
    update warehouse.inventory_units set status='issued',assigned_to='OLD-ORDER' where id='reset-unit';
    insert into warehouse.movements(id,type,product_id,quantity,serial_number,reference,actor) values('old-issue','fulfillment_release','device',1,'RESET-1','${OLD}','${A}');
    insert into warehouse.customer_return_cases(id,source_order_id,product_id,serial_number,defect_description,created_by)
      values('${OLD_CASE}','${OLD}','device','RESET-1','Earlier case','${A}');`);
  const beforeUnit = (await db.query("select to_jsonb(u) as row from warehouse.inventory_units u where id='reset-unit'")).rows[0].row;
  await db.exec(`update warehouse.inventory_units set status='in_stock',assigned_to=null where id='reset-unit';
    insert into warehouse.movements(id,type,product_id,quantity,serial_number,reference,actor) values('restore-move','adjustment','device',1,'RESET-1','old-issue','postgres');`);
  const history = (await db.query("select to_jsonb(h) as row from private.warehouse_unit_history h where unit_id='reset-unit' order by id desc limit 1")).rows[0].row;
  const tuple = { source_order_id: OLD, unit_id: 'reset-unit', serial_number: 'RESET-1', product_id: 'device', source_issue_movement_id: 'old-issue', restoration_movement_id: 'restore-move' };
  await db.query(`insert into private.uat_admin_reset_archives(batch_id,operation,plan_sha256,row_images,preservation_before,planned_inserts)
    values('test-reset','restore_test_issued_units',$1,$2,'{}',$3)`, ['a'.repeat(64),
    [{ table: 'warehouse.inventory_units', row: beforeUnit }, { kind: 'restored_issuances', rows: [tuple] }],
    { restored_issuances: [tuple], history: [history] }]);
  await db.exec(`update warehouse.inventory_units set status='issued',assigned_to='NEW-ORDER' where id='reset-unit';
    insert into warehouse.movements(id,type,product_id,quantity,serial_number,reference,actor) values('new-issue','fulfillment_release','device',1,'RESET-1','${NEW}','${A}');
    insert into warehouse.inventory_units(id,product_id,serial_number,location_id,bin_id,status,assigned_to) values('legacy-unit','device','LEGACY-1','wh','bin','issued','LEGACY');`);
  beforeMetadata = await metadata();
  beforeDefinitions = (await db.query('select oid::regprocedure::text as signature,pg_get_functiondef(oid) as definition from pg_proc where oid=any($1::regprocedure[]) order by oid',[signatures])).rows;
  console.log('SOURCE_BODY_MD5', (await db.query('select oid::regprocedure::text as signature,md5(replace(prosrc,chr(13),\'\')) as md5 from pg_proc where oid=any($1::regprocedure[]) order by oid', [signatures])).rows);
  await db.exec('begin');
  await db.exec(candidate);
  await db.exec('commit');
});
after(async () => { await db?.close(); });

test('old source cannot return the same unit after a legitimate different-order reissue', () => isolated(async () => {
  await denied(() => rpc('record_return_v2', intake()), error => error.code==='P0001' && error.message===supersededMessage);
}));
test('new current source retains real intake, pending Quality, hold, movement and replay', () => isolated(async () => {
  const p = intake(NEW); const result = await rpc('record_return_v2', p);
  assert.equal(result.source_order_id, NEW);
  const state = await snapshot();
  assert.equal(state.inventory_holds.length, 1);
  assert.deepEqual(await rpc('record_return_v2', p), result);
  assert.deepEqual(await snapshot(), state);
}));
test('completed intake replay survives later unit history without another write', () => isolated(async () => {
  const p = intake(NEW); const result = await rpc('record_return_v2', p);
  // Later local history is a replay probe, not a certification of Quality/putaway.
  await db.exec("update warehouse.inventory_units set bin_id=null where id='reset-unit'");
  const state = await snapshot();
  assert.deepEqual(await rpc('record_return_v2', p), result);
  assert.deepEqual(await snapshot(), state);
}));
test('cached intake still requires live authority and rejects changed intent', () => isolated(async () => {
  const p = intake(NEW); await rpc('record_return_v2', p);
  const changed = structuredClone(p); changed.return.source_order_id = OLD;
  await denied(() => rpc('record_return_v2', changed), /idempotency|different payload/i);
  await db.exec("select set_config('test.allowed','no',true)");
  await denied(() => rpc('record_return_v2', p), /Not authorized/);
}));
for (const [label, change] of [
  ['omitted order', p => delete p.return.source_order_id],
  ['unrelated historical order', p => p.return.source_order_id = OTHER],
  ['changed return source', p => { p.return.source = 'vendor'; delete p.return.source_order_id; }],
  ['old case hidden behind new order', p => { p.return.source_order_id = NEW; p.return.return_case_id = OLD_CASE; }],
]) test(`reset-unit intake rejects ${label} atomically`, () => isolated(async () => {
  const p = intake(); change(p); await denied(() => rpc('record_return_v2', p));
}));
test('old case alone cannot disguise a superseded source order', () => isolated(async () => {
  const p = intake(); delete p.return.source_order_id; p.return.return_case_id = OLD_CASE;
  await denied(() => rpc('record_return_v2', p));
}));
test('new case alone derives the correct current source', () => isolated(async () => {
  await rpc('create_customer_return_case', caseInput(NEW));
  const p = intake(); delete p.return.source_order_id; p.return.return_case_id = CASE;
  assert.equal((await rpc('record_return_v2', p)).source_order_id, NEW);
}));
test('non-reset serialized legacy unlinked intake is unchanged', () => isolated(async () => {
  const p = intake(null, 'LEGACY-1'); delete p.return.source_order_id;
  assert.equal((await rpc('record_return_v2', p)).lines[0].serialNumber, 'LEGACY-1');
}));
for (const order of [OLD, null, OTHER]) test(`reset-unit case creation rejects noncurrent source ${order}`, () => isolated(async () => {
  await denied(() => rpc('create_customer_return_case', caseInput(order)));
}));
test('new source case creation and direct resolution remain usable', () => isolated(async () => {
  const created = await rpc('create_customer_return_case', caseInput(NEW));
  assert.equal((await rpc('resolve_customer_return_case', resolve())).status, 'resolved');
  const state = await snapshot();
  await rpc('resolve_customer_return_case', resolve());
  assert.deepEqual(await rpc('create_customer_return_case', caseInput(NEW)), created);
  assert.deepEqual(await snapshot(), state);
}));
test('new source intake before resolution remains usable without invented evidence', () => isolated(async () => {
  await rpc('create_customer_return_case', caseInput(NEW));
  await rpc('record_return_v2', intake(NEW));
  assert.equal((await rpc('resolve_customer_return_case', resolve())).status, 'resolved');
}));
test('preexisting old case resolution cannot move the restored/reissued unit', () => isolated(async () => {
  await denied(() => rpc('resolve_customer_return_case', resolve(OLD_CASE)));
}));
test('restored in-stock unit cannot be treated as a newly issued unit', () => isolated(async () => {
  await db.exec("update warehouse.inventory_units set status='in_stock',assigned_to=null where id='reset-unit'");
  await denied(() => rpc('record_return_v2', intake(NEW)), /This watch|Only an issued/);
  await denied(() => rpc('resolve_customer_return_case', resolve(OLD_CASE)));
}));
test('non-reset legacy unlinked case creation and resolution remain unchanged', () => isolated(async () => {
  await rpc('create_customer_return_case', caseInput(null, 'LEGACY-1'));
  assert.equal((await rpc('resolve_customer_return_case', resolve())).status, 'resolved');
}));
test('existing function identity, metadata, grants and public ABI remain unchanged', async () => {
  assert.deepEqual(await metadata(), beforeMetadata);
});
test('intake changes only the fresh retained path and leaves the public authority wrapper intact', async () => {
  const current = (await db.query('select oid::regprocedure::text as signature,pg_get_functiondef(oid) as definition from pg_proc where oid=any($1::regprocedure[]) order by oid', [signatures])).rows;
  const publicSignature = 'warehouse.record_return_v2(jsonb)';
  assert.equal(current.find(row => row.signature===publicSignature).definition, beforeDefinitions.find(row => row.signature===publicSignature).definition);
  const retainedSignature = 'warehouse.record_return_v2_certified_impl(jsonb)';
  const oldDefinition = beforeDefinitions.find(row => row.signature===retainedSignature).definition;
  const anchor = "v_command_id := (v_started->>'command_id')::uuid;";
  assert.equal(current.find(row => row.signature===retainedSignature).definition,
    oldDefinition.replace(anchor, `${anchor}\n  perform private.guard_restored_unit_return(payload,'intake');`));
  assert(oldDefinition.indexOf("if (v_started->>'replayed')::boolean then return v_started->'response'; end if;") < oldDefinition.indexOf(anchor));
});
test('helper and archive remain inaccessible even when the caller has private schema usage', () => isolated(async () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal((await db.query("select has_function_privilege($1,'private.guard_restored_unit_return(jsonb,text)','execute') as allowed", [role])).rows[0].allowed, false);
    await db.exec(`set local role ${role}; savepoint denied_read`);
    try { await assert.rejects(db.query('select * from private.uat_admin_reset_archives'), error => error.code === '42501'); }
    finally { await db.exec('rollback to savepoint denied_read; reset role'); }
  }
}));
test('archive immutability remains enforced after installing the guard', () => isolated(async () => {
  for (const sql of ['update private.uat_admin_reset_archives set planned_inserts=\'{}\'', 'delete from private.uat_admin_reset_archives', 'truncate private.uat_admin_reset_archives']) {
    await denied(() => db.exec(sql), /UAT reset archives are immutable/);
  }
}));
test('current authority is still required before intake/resolution', () => isolated(async () => {
  await db.exec("select set_config('test.allowed','no',true)");
  await denied(() => rpc('record_return_v2', intake(NEW)), /Not authorized/);
  await denied(() => rpc('resolve_customer_return_case', resolve(OLD_CASE)), /Not authorized/);
}));

async function eventFixture(gatedEvent = false) {
  await db.exec(`insert into warehouse.events(id,name,type,start_date,status) values('later-event','Later event','test',current_date,'active');
    update warehouse.inventory_units set status='in_stock',assigned_to=null where id='reset-unit';`);
  let allocation = 'later-allocation';
  if (gatedEvent) {
    await db.exec(`insert into private.event_custody_sessions(event_id,enabled,configured_by) values('later-event',true,'${A}');
      update warehouse.fulfillment_orders set event_id='later-event',created_at=clock_timestamp(),status='ready',
        lines='[{"productId":"device","quantity":1,"pickedQuantity":1,"pickedSerialNumbers":["RESET-1"]}]' where id='${NEW}';`);
    await db.query('select private.warehouse_advance_fulfillment_order($1::jsonb)', [{ order_id: NEW, action: 'release', idempotency_key: 'actual-event-release-0001' }]);
    assert.equal((await db.query("select event_id from warehouse.inventory_units where id='reset-unit'")).rows[0].event_id, null);
    await db.exec(`update warehouse.fulfillment_orders set status='completed',acknowledged_at=clock_timestamp(),acknowledged_by='${A}' where id='${NEW}'`);
    assert.equal((await db.query("select event_id from warehouse.inventory_units where id='reset-unit'")).rows[0].event_id, 'later-event');
    allocation = `event-custody-${NEW}-device`;
  } else {
    await db.exec(`update warehouse.inventory_units set status='issued',assigned_to='NEW-ORDER',event_id='later-event' where id='reset-unit';
      insert into warehouse.allocations(id,event_id,product_id,quantity,status) values('later-allocation','later-event','device',1,'issued');`);
  }
  const p = intake(); delete p.return.source_order_id;
  p.return.source = 'event'; p.return.event_id = 'later-event'; p.allocation_id = allocation;
  return p;
}
for (const gatedEvent of [false, true]) test(`later ${gatedEvent ? 'gated acknowledged' : 'legacy'} event issuance retains real return and replay`, () => isolated(async () => {
  const p = await eventFixture(gatedEvent);
  const result = await rpc('record_return_v2', p);
  assert.equal(result.event_id, 'later-event');
  assert.equal(result.lines[0].allocationId, p.allocation_id);
  const state = await snapshot();
  assert.deepEqual(await rpc('record_return_v2', p), result);
  assert.deepEqual(await snapshot(), state);
}));
test('changing customer custody to an event label does not bypass provenance', () => isolated(async () => {
  const p = intake(); delete p.return.source_order_id; p.return.source='event'; p.return.event_id='forged-event';
  await denied(() => rpc('record_return_v2', p));
}));
test('real retained event assertions still reject sold serial custody', () => isolated(async () => {
  const p = await eventFixture(true);
  await db.exec(`insert into private.event_custody_entries(event_id,allocation_id,seller_id,kind,quantity,serial_numbers,amount,external_reference)
    values('later-event','${p.allocation_id}','${A}','sale',1,array['RESET-1'],1,'SOLD');`);
  await denied(() => rpc('record_return_v2', p), /remaining event custody|unavailable/);
}));
test('retained intake rejects oversized lines instead of bypassing restored-unit protection', () => isolated(async () => {
  const p = intake(); p.return.lines = Array.from({length:1001}, () => ({ ...p.return.lines[0] }));
  await denied(() => rpc('record_return_v2', p), /1 to 1000/);
}));

test('existing private create-case cached reply retains its original no-write authority ordering', () => isolated(async () => {
  const p = caseInput(null, 'LEGACY-1');
  const result = await rpc('create_customer_return_case', p);
  await db.exec("select set_config('test.allowed','no',true)");
  const state = await snapshot();
  assert.deepEqual(await rpc('create_customer_return_case', p), result);
  assert.deepEqual(await snapshot(), state);
}));

test('private resolver also guards fresh service-role calls without adding client access', () => isolated(async () => {
  await denied(async () => {
    await db.exec('set local role service_role');
    return db.query('select private.warehouse_resolve_customer_return_case($1::jsonb)', [resolve(OLD_CASE)]);
  });
}));

test('changing acknowledged event custody to a customer label cannot bypass the event authority', () => isolated(async () => {
  await eventFixture(true);
  await denied(() => rpc('record_return_v2', intake(NEW)), /Choose the event/);
}));

test('changing resolver payload fields cannot replace the stored old case lineage', () => isolated(async () => {
  await denied(() => rpc('resolve_customer_return_case', { ...resolve(OLD_CASE), source_order_id:NEW,serial_number:'LEGACY-1',product_id:'other' }),
    error => error.message===supersededMessage);
}));
test('old source is denied before replacement wrapper can create an order', () => isolated(async () => {
  await denied(() => rpc('resolve_customer_return_case', { ...resolve(OLD_CASE), resolution:'replacement' }),
    error => error.message===supersededMessage);
}));
test('a late intake failure rolls back all real effects and preserves the reset archive', () => isolated(async () => {
  await db.exec(`create function private.fail_test_return() returns trigger language plpgsql as $$begin raise exception 'Injected late failure';end$$;
    create trigger fail_test_return before insert on warehouse.movements for each row execute function private.fail_test_return();`);
  await denied(() => rpc('record_return_v2', intake(NEW)), /Injected late failure/);
}));

for (const signature of signatures) test(`unexpected body drift aborts before installation: ${signature}`, () => isolated(async () => {
  for (const row of beforeDefinitions) await db.exec(row.definition);
  await db.exec('drop function private.guard_restored_unit_return(jsonb,text)');
  const row = beforeDefinitions.find(item => item.signature===signature);
  assert(row.definition.includes('AS $function$'));
  await db.exec(row.definition.replace('AS $function$', 'AS $function$\n-- unexpected body drift\n'));
  const before = (await db.query('select oid::regprocedure::text as signature,prosrc from pg_proc where oid=any($1::regprocedure[]) order by oid',[signatures])).rows;
  await denied(() => db.exec(candidate), /Restored-unit return predecessor drift/);
  assert.deepEqual((await db.query('select oid::regprocedure::text as signature,prosrc from pg_proc where oid=any($1::regprocedure[]) order by oid',[signatures])).rows, before);
  assert.equal((await db.query("select to_regprocedure('private.guard_restored_unit_return(jsonb,text)') as helper")).rows[0].helper,null);
}));
