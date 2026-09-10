import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const releaser = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const orderId = '11111111-1111-4111-8111-111111111111';
const sql = {};
for (const [key, name] of Object.entries({
  controls: '20260710150000_warehouse_w1_control_schema.sql',
  helpers: '20260710160000_warehouse_w1_quality_and_approval_rpcs.sql',
  original: '20260721200000_cross_department_wms_persistence.sql',
  lifecycle: '20260804150000_inventory_release_lifecycle_remediation.sql',
  v3: '20260817121220_ecommerce_fulfillment_intake_and_directed_pick.sql',
  v2: '20260828011200_fulfillment_zero_line_backorder.sql',
  migration: '20260910140118_fulfillment_handover_acknowledgment_guard.sql',
})) sql[key] = await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const installed = await readFile(new URL('./fixtures/sep08-installed-fulfillment.sql', import.meta.url), 'utf8');

function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Missing SQL: ${startMarker}`);
  return source.slice(start, end + endMarker.length);
}
const tableSql = (source, name) => extract(source, `create table if not exists ${name} (`, '\n);');
const functionSql = (source, name) => extract(source, `create or replace function ${name}(`, '$$;');
const rows = async (db, query, params = []) => (await db.query(query, params)).rows;

async function setup(t, { migrate = true, method = 'internal_handover' } = {}) {
  const db = new PGlite();
  t.after(() => db.close());
  // Actual fulfillment schema, v2/v3/exposed bodies, and command storage/helpers.
  // Only ancillary inventory/auth catalogs and the pgcrypto hash primitive are scaffolded.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema warehouse; create schema private; create schema core; create schema auth;
    grant usage on schema warehouse, private, core, auth to authenticated, service_role;
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('test.actor', true), '')::uuid
    $$;
    create function core.has_cap(text, text) returns boolean language sql as $$
      select coalesce(current_setting('test.capabilities', true)::jsonb ? ($1 || '.' || $2), false)
    $$;
    create function warehouse.authoritative_actor() returns text language sql as $$ select auth.uid()::text $$;
    create function private.warehouse_payload_hash(jsonb) returns text language sql as $$
      select encode(sha256(convert_to($1::text, 'UTF8')), 'hex')
    $$;
    set test.actor = '${actor}';
    set test.capabilities = '["warehouse.request_fulfillment"]';
    create table core.profiles(id uuid primary key);
    insert into core.profiles values('${actor}'), ('${other}'), ('${releaser}');
    create table warehouse.locations(id text primary key);
    create table warehouse.events(id text primary key);
    create table warehouse.storage_areas(id text primary key, location_id text, active boolean);
    create table warehouse.products(id text primary key, name text, serialized boolean, item_class text);
    create table warehouse.stock_levels(product_id text, location_id text, bin_id text, lot_id text, quantity integer);
    create table warehouse.inventory_units(id text, product_id text, serial_number text, status text, location_id text, bin_id text, assigned_to text);
    create table warehouse.inventory_holds(product_id text, location_id text, bin_id text, lot_id text, serial_number text, status text, quantity integer);
    create table warehouse.movements(id text, type text, product_id text, quantity integer, from_location_id text, from_bin_id text, serial_number text, lot_id text, event_id text, reference text, actor text, reason text);
    create table warehouse.fulfillment_reservations(order_id uuid, product_id text, status text, closed_at timestamptz);
    create table warehouse.department_stock_requests(fulfillment_order_id uuid, requested_by uuid);
    create table core.activity_log(module text, entity_type text, entity_id uuid, action text, actor uuid, detail jsonb);
  `);
  await db.exec(tableSql(sql.controls, 'warehouse.command_log'));
  await db.exec(tableSql(sql.original, 'warehouse.fulfillment_orders'));
  const alterStart = sql.lifecycle.indexOf('alter table warehouse.fulfillment_orders');
  const alterEnd = sql.lifecycle.indexOf('drop index if exists warehouse.warehouse_fulfillment_work_queue_idx');
  assert.ok(alterStart >= 0 && alterEnd > alterStart);
  await db.exec(sql.lifecycle.slice(alterStart, alterEnd));
  await db.exec('alter table warehouse.fulfillment_orders add column delivery_link text;');
  await db.exec(functionSql(sql.helpers, 'private.begin_idempotent_command'));
  await db.exec(functionSql(sql.helpers, 'private.finish_idempotent_command'));
  // Preserve the actual installed base delegate, then install the current
  // checked-in v2 and exposed/v3 wrappers with their real grants.
  await db.exec(installed);
  await db.exec(sql.v2);
  await db.exec(sql.v3.slice(sql.v3.indexOf('create or replace function private.warehouse_advance_fulfillment_order_v3(')));
  await db.exec(`revoke all on function private.warehouse_advance_fulfillment_order(jsonb) from public, anon, authenticated;
    grant execute on function private.warehouse_advance_fulfillment_order(jsonb) to service_role;`);
  if (migrate) await db.exec(sql.migration);
  if (![ 'shipment', 'internal_handover', 'event_handover', 'third_party_transfer' ].includes(method)) {
    // Current schema forbids unknown/null methods. Remove only those checks in
    // this adversarial fixture to prove the function also fails closed.
    await db.exec(`alter table warehouse.fulfillment_orders
      drop constraint warehouse_fulfillment_delivery_method_check,
      alter column delivery_method drop not null;`);
  }
  await db.query(`insert into warehouse.fulfillment_orders(
      id, source, external_reference, status, delivery_method, lines, created_by,
      released_by, released_at, courier, waybill_number, handover_recipient_name,
      handover_recipient_department, handover_reference, handover_evidence_url)
    values($1, 'department_request', 'ACK-TEST', 'released', $2,
      '[{"productId":"product","quantity":1}]', $3, $4, now(), 'Courier', 'WAYBILL',
      'Recipient', 'Marketing', 'HANDOVER', 'evidence/handover.jpg')`, [orderId, method, other, releaser]);
  return db;
}

const command = (extra = {}) => ({
  order_id: orderId, action: 'acknowledge_receipt', idempotency_key: 'acknowledgment-test-command',
  acknowledgement_reference: '  ACK-TEST  ', acknowledgement_evidence_url: '  evidence/acceptance.jpg  ', ...extra,
});
async function call(db, payload = command()) {
  await db.exec('set role authenticated');
  try {
    return (await rows(db, 'select warehouse.advance_fulfillment_order($1::jsonb) as result', [JSON.stringify(payload)]))[0].result;
  } finally { await db.exec('reset role'); }
}
async function snapshot(db) {
  const result = {};
  for (const table of ['warehouse.fulfillment_orders', 'warehouse.command_log', 'core.activity_log',
    'warehouse.stock_levels', 'warehouse.inventory_units', 'warehouse.movements', 'warehouse.fulfillment_reservations',
    'warehouse.department_stock_requests']) {
    result[table] = await rows(db, `select to_jsonb(t) as value from ${table} t order by to_jsonb(t)::text`);
  }
  return result;
}
async function definitions(db) {
  return rows(db, `select p.oid, p.proname, p.proowner, p.proacl, p.prosecdef, p.proconfig, p.prosrc
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='warehouse' and p.proname='advance_fulfillment_order')
      or (n.nspname='private' and p.proname in ('warehouse_advance_fulfillment_order',
        'warehouse_advance_fulfillment_order_v2', 'warehouse_advance_fulfillment_order_v3'))
    order by p.proname`);
}

test('baseline: actual exposed/v3/v2 chain completes a released shipment without POD', async t => {
  const db = await setup(t, { migrate: false, method: 'shipment' });
  assert.equal((await call(db)).status, 'completed');
});

for (const method of ['shipment', 'unknown_method', '', null]) {
  test(`${String(method)}: exposed acknowledgment rejects without any persisted writes`, async t => {
    const db = await setup(t, { method });
    const before = await snapshot(db);
    await assert.rejects(call(db), /only available for handovers.*proof of delivery/i);
    // A client-supplied method must not override the stored order's method.
    await assert.rejects(call(db, command({ delivery_method: 'internal_handover' })), /only available for handovers/i);
    assert.deepEqual(await snapshot(db), before);
  });
}

for (const method of ['internal_handover', 'event_handover', 'third_party_transfer']) {
  test(`${method}: request_fulfillment-only actor can acknowledge and replay exactly once`, async t => {
    const db = await setup(t, { method });
    const first = await call(db);
    assert.equal(first.status, 'completed');
    assert.equal(first.acknowledged_by, actor);
    assert.equal(first.acknowledgement_reference, 'ACK-TEST');
    assert.equal(first.acknowledgement_evidence_url, 'evidence/acceptance.jpg');
    const saved = await snapshot(db);
    assert.equal(saved['warehouse.command_log'].length, 1);
    assert.equal(saved['core.activity_log'].length, 1);
    assert.deepEqual(await call(db), first);
    await assert.rejects(call(db, command({ acknowledgement_reference: 'CHANGED' })), /different payload/i);
    assert.deepEqual(await snapshot(db), saved);
  });
}

for (const [name, prepare] of [
  ['creator without execution rights', `set test.capabilities='[]'; update warehouse.fulfillment_orders set created_by='${actor}'`],
  ['linked requester without execution rights', `set test.capabilities='[]'; insert into warehouse.department_stock_requests values('${orderId}', '${actor}')`],
  ['issue_items-only recorder', `set test.capabilities='["warehouse.issue_items"]'`],
]) {
  test(`preserves actor authority: ${name}`, async t => {
    const db = await setup(t);
    await db.exec(prepare);
    assert.equal((await call(db)).status, 'completed');
  });
}

test('existing auth, nonreleaser, status and evidence checks still reject atomically', async t => {
  const db = await setup(t);
  for (const [prepare, extra, message] of [
    [`set test.capabilities='[]'`, {}, /Not authorized/],
    [`set test.capabilities='["warehouse.reserve_allocate"]'`, {}, /Not authorized/],
    [`set test.capabilities='["warehouse.request_fulfillment"]'; update warehouse.fulfillment_orders set released_by='${actor}', created_by='${actor}'`, {}, /releasing operator/],
    [`update warehouse.fulfillment_orders set released_by='${releaser}', status='ready'`, {}, /Only released/],
    [`update warehouse.fulfillment_orders set status='released'`, { acknowledgement_reference: ' ' }, /reference and evidence/],
    ['', { acknowledgement_evidence_url: '' }, /reference and evidence/],
    [`set test.actor=''`, {}, /Authentication required/],
  ]) {
    if (prepare) await db.exec(prepare);
    const before = await snapshot(db);
    await assert.rejects(call(db, command(extra)), message);
    assert.deepEqual(await snapshot(db), before);
  }
});

test('unrelated actions delegate through the actual base and preserve its capability checks', async t => {
  const db = await setup(t, { method: 'shipment' });
  await db.exec(`update warehouse.fulfillment_orders set status='allocated'; set test.capabilities='["warehouse.issue_items"]'`);
  assert.equal((await call(db, command({ action: 'start_picking' }))).status, 'picking');
  assert.equal((await rows(db, 'select * from warehouse.command_log')).length, 2);
  await db.exec(`set test.capabilities='["warehouse.reserve_allocate"]'`);
  assert.equal((await call(db, command({ action: 'cancel', cancellation_reason: 'No longer needed', idempotency_key: 'cancel-delegation-command' }))).status, 'cancelled');
  await db.exec(`update warehouse.fulfillment_orders set status='allocated'; set test.capabilities='["warehouse.request_fulfillment"]'`);
  const before = await snapshot(db);
  await assert.rejects(call(db, command({ action: 'start_picking', idempotency_key: 'unauthorized-start-command' })), /Not authorized: warehouse.issue_items/);
  assert.deepEqual(await snapshot(db), before);
});

test('migration changes only the acknowledgment guard and preserves OIDs, grants, owner and wrappers', async t => {
  const db = await setup(t, { migrate: false });
  const before = await definitions(db);
  await db.exec(sql.migration);
  const after = await definitions(db);
  const guard = extract(sql.migration, '    if v_order.delivery_method is null', '    end if;');
  assert.deepEqual(after.map(row => row.proname === 'warehouse_advance_fulfillment_order_v2'
    ? { ...row, prosrc: row.prosrc.replace(`\n${guard}`, '') } : row), before);
  const grants = (await rows(db, `select
    has_function_privilege('authenticated', 'warehouse.advance_fulfillment_order(jsonb)', 'execute') as exposed,
    has_function_privilege('anon', 'warehouse.advance_fulfillment_order(jsonb)', 'execute') as anonymous,
    has_function_privilege('authenticated', 'private.warehouse_advance_fulfillment_order_v2(jsonb)', 'execute') as private_v2,
    has_function_privilege('authenticated', 'private.warehouse_advance_fulfillment_order_v3(jsonb)', 'execute') as private_v3`))[0];
  assert.deepEqual(grants, { exposed: true, anonymous: false, private_v2: false, private_v3: false });
  await assert.rejects(db.exec(sql.migration), /already installed/);
  assert.deepEqual(await definitions(db), after);
});

test('unexpected predecessor definition fails migration without replacing the function', async t => {
  const db = await setup(t, { migrate: false });
  await db.exec(functionSql(sql.v2, 'private.warehouse_advance_fulfillment_order_v2')
    .replace("payload->>'action' = 'acknowledge_receipt'", "payload->>'action' = 'changed_acknowledgment'"));
  const before = await definitions(db);
  await assert.rejects(db.exec(sql.migration), /Expected exactly one v2 acknowledgment branch/);
  assert.deepEqual(await definitions(db), before);
});
