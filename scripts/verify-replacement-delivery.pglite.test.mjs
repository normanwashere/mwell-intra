import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const actor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherActor = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const id = '11111111-1111-4111-8111-111111111111';
const source = '22222222-2222-4222-8222-222222222222';
const authorityMigration = await readFile(new URL('../supabase/migrations/20260911170103_requester_names_return_live_authority.sql', import.meta.url), 'utf8');
assert.match(authorityMigration, /do \$return_resolution\$[\s\S]*?\$return_resolution\$;/);
const [controls, helpers, original, predecessor, migration] = await Promise.all([
  '20260710150000_warehouse_w1_control_schema.sql',
  '20260710160000_warehouse_w1_quality_and_approval_rpcs.sql',
  '20260721200000_cross_department_wms_persistence.sql',
  '20260804200000_operational_flow_completion.sql',
  '20260910133142_replacement_delivery_confirmation.sql',
].map(name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')));

function extract(sql, startMarker, endMarker) {
  const start = sql.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing SQL start: ${startMarker}`);
  const end = sql.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Missing SQL end: ${endMarker}`);
  return sql.slice(start, end + endMarker.length);
}
const functionSql = (sql, name) => extract(sql, `create or replace function ${name}(`, '$$;');
const tableSql = (sql, name) => extract(sql, `create table if not exists ${name} (`, '\n);');

async function setup(t) {
  const db = new PGlite();
  t.after(() => db.close());
  // Ancillary auth/catalog tables are scaffolded. Resolver bodies, command
  // storage, begin/finish logic, and return-case constraints come from migrations.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema warehouse; create schema private; create schema core; create schema auth;
    create function auth.uid() returns uuid language sql as $$
      select nullif(current_setting('test.actor', true), '')::uuid
    $$;
    create function core.has_cap(text, text) returns boolean language sql as $$
      select coalesce(current_setting('test.capabilities', true)::jsonb ? ($1 || '.' || $2), false)
    $$;
    create function core.has_live_cap(text, text) returns boolean language sql as $$
      select core.has_cap($1,$2) and coalesce(current_setting('test.certified',true),'true') = 'true'
    $$;
    set test.actor = '${actor}';
    set test.capabilities = '["warehouse.manage_returns"]';
    create table core.profiles(id uuid primary key);
    insert into core.profiles values('${actor}'), ('${otherActor}');
    create table warehouse.locations(id text primary key);
    create table warehouse.storage_areas(id text primary key, location_id text, active boolean);
    create table warehouse.products(id text primary key);
    create table warehouse.events(id text primary key);
    create table warehouse.inventory_units(id text primary key, product_id text, serial_number text,
      status text, location_id text, bin_id text, assigned_to text);
    create table warehouse.movements(id text, type text, product_id text, quantity int,
      to_location_id text, to_bin_id text, serial_number text, reason text, reference text, actor text);
    create table core.activity_log(module text, entity_type text, entity_id uuid, action text, actor uuid, detail jsonb);
    -- Equivalent SHA-256 primitive without requiring the pgcrypto extension.
    create function private.warehouse_payload_hash(jsonb) returns text language sql as $$
      select encode(sha256(convert_to($1::text, 'UTF8')), 'hex')
    $$;
    insert into warehouse.locations values('warehouse');
    insert into warehouse.storage_areas values('quarantine', 'warehouse', true), ('other-bin', 'warehouse', true);
    insert into warehouse.products values('product');
    insert into warehouse.inventory_units values('unit', 'product', 'SERIAL-1', 'issued', 'warehouse', null, 'customer');
  `);
  await db.exec(tableSql(controls, 'warehouse.command_log'));
  await db.exec(tableSql(original, 'warehouse.fulfillment_orders'));
  await db.exec(tableSql(original, 'warehouse.customer_return_cases'));
  const caseStart = predecessor.indexOf('alter table warehouse.customer_return_cases');
  const wrapperStart = predecessor.indexOf('create or replace function warehouse.resolve_customer_return_case');
  assert.ok(caseStart >= 0 && wrapperStart > caseStart);
  await db.exec(predecessor.slice(caseStart, wrapperStart));
  await db.exec(`alter table warehouse.fulfillment_orders add column customer_name text,
    add column customer_contact text, add column customer_email text, add column delivery_address jsonb;`);
  await db.exec(functionSql(helpers, 'private.begin_idempotent_command'));
  await db.exec(functionSql(helpers, 'private.finish_idempotent_command'));
  await db.exec(functionSql(original, 'private.warehouse_resolve_customer_return_case'));
  await db.exec(functionSql(predecessor, 'warehouse.resolve_customer_return_case'));
  await db.exec(migration);
  await db.exec(authorityMigration.match(/do \$return_resolution\$[\s\S]*?\$return_resolution\$;/)?.[0] ?? 'select 1;');
  await db.exec('grant usage on schema warehouse to authenticated, anon;');
  await db.exec(`
    insert into warehouse.fulfillment_orders(id, source, external_reference, source_location_id, lines,
      created_by, customer_name, customer_contact, delivery_address)
    values('${source}', 'ecommerce', 'SOURCE-1', 'warehouse', '[{"productId":"product","quantity":1}]',
      '${actor}', 'Original recipient', '09170000000',
      '{"addressLine":"Original street","city":"Pasig","province":"Metro Manila","postalCode":"1600"}');
    insert into warehouse.customer_return_cases(id, source_order_id, serial_number, product_id, defect_description, created_by)
    values('${id}', '${source}', 'SERIAL-1', 'product', 'Charging defect', '${actor}');
  `);
  return db;
}

const originalDelivery = { mode: 'original' };
const newDelivery = {
  mode: 'new', customerName: 'New recipient', customerContactNumber: '09171111111',
  customerEmail: 'recipient@example.test', reason: 'Recipient confirmed new address',
  deliveryAddress: { addressLine: 'New street', city: 'Makati', province: 'Metro Manila', postalCode: '1200' },
};
const payload = delivery => ({
  idempotency_key: `resolve_replacement-${id}`, return_case_id: id, resolution: 'replacement',
  quarantine_bin_id: 'quarantine', replacement_order_id: null, refund_reference: null,
  supplier_reference: null, finance_evidence_url: null,
  ...(delivery === undefined ? {} : { replacement_delivery: delivery }),
});
const call = async (db, value) => {
  await db.exec('set role authenticated');
  try {
    return (await db.query('select warehouse.resolve_customer_return_case($1::jsonb) as result', [JSON.stringify(value)])).rows[0].result;
  } finally { await db.exec('reset role'); }
};
const rows = async (db, sql) => (await db.query(sql)).rows;
const snapshot = async db => ({
  cases: await rows(db, 'select * from warehouse.customer_return_cases order by id'),
  orders: await rows(db, 'select * from warehouse.fulfillment_orders order by id'),
  units: await rows(db, 'select * from warehouse.inventory_units order by id'),
  movements: await rows(db, 'select * from warehouse.movements order by id'),
  commands: await rows(db, 'select * from warehouse.command_log order by id'),
  audit: await rows(db, 'select * from core.activity_log order by action'),
});
async function closeCase(db) {
  await db.exec(`update warehouse.customer_return_cases set status='closed', customer_closed_by='${actor}',
    customer_closed_at=now(), customer_resolution_reference='CLOSE-1',
    customer_closure_evidence_url='https://example.test/proof' where id='${id}'`);
}

for (const resolution of ['replacement', 'refund', 'vendor_return', 're_kit', 'write_off']) {
  test(`${resolution}: uncertified authority fails before writes; certified authority keeps the resolution chain`, async t => {
    const db = await setup(t);
    const cap = resolution === 'refund' ? 'warehouse.approve_stock_adjustment_finance' : 'warehouse.manage_returns';
    await db.exec(`set test.capabilities='["${cap}"]'; set test.certified='false'`);
    const command = { ...payload(resolution === 'replacement' ? originalDelivery : undefined), resolution,
      refund_reference: resolution === 'refund' ? 'REFUND-CERT' : null,
      supplier_reference: resolution === 'vendor_return' ? 'RMA-CERT' : null,
      finance_evidence_url: ['refund', 'write_off'].includes(resolution) ? 'https://example.test/finance' : null };
    const before = await snapshot(db);
    await assert.rejects(call(db, command), /Not authorized|Finance authorization/i);
    assert.deepEqual(await snapshot(db), before);
    await db.exec("set test.certified='true'");
    assert.equal((await call(db,command)).resolution,resolution);
    const resolved = await snapshot(db);
    await db.exec("set test.certified='false'");
    await assert.rejects(call(db,command), /Not authorized|Finance authorization/i);
    assert.deepEqual(await snapshot(db), resolved);
  });
}

for (const delivery of [originalDelivery, newDelivery]) {
  test(`${delivery.mode}: actual chain returns and caches delivery confirmation on first success`, async t => {
    const db = await setup(t);
    const sourceBefore = await rows(db, `select * from warehouse.fulfillment_orders where id='${source}'`);
    const first = await call(db, payload(delivery));
    const cached = (await rows(db, 'select response from warehouse.command_log'))[0].response;
    assert.deepEqual(first.replacement_delivery, delivery);
    assert.deepEqual(cached, first);
    assert.deepEqual(await call(db, payload(delivery)), first);
    assert.deepEqual(await rows(db, `select * from warehouse.fulfillment_orders where id='${source}'`), sourceBefore);
    const replacement = (await rows(db, `select * from warehouse.fulfillment_orders where id='${id}'`))[0];
    assert.equal(replacement.customer_name, delivery.mode === 'original' ? 'Original recipient' : 'New recipient');
    assert.equal(replacement.delivery_address.city, delivery.mode === 'original' ? 'Pasig' : 'Makati');
    assert.equal((await rows(db, 'select * from warehouse.movements')).length, 1);
    assert.equal((await rows(db, 'select * from core.activity_log')).length, 2);
  });
}

test('confirmed replacement stages normalized finance evidence before the private command cache', async t => {
  const db = await setup(t);
  const command = { ...payload(newDelivery), finance_evidence_url: '  https://example.test/proof  ' };
  const first = await call(db, command);
  assert.equal(first.finance_evidence_url, 'https://example.test/proof');
  assert.deepEqual(first.replacement_delivery, newDelivery);
  assert.deepEqual((await rows(db, 'select response from warehouse.command_log'))[0].response, first);
  assert.deepEqual(await call(db, command), first);
});

for (const state of ['resolved', 'closed']) {
  test(`${state}: confirmed replacement replay with fresh key/actor returns current state without writes`, async t => {
    const db = await setup(t);
    await call(db, payload(originalDelivery));
    if (state === 'closed') await closeCase(db);
    await db.exec("update warehouse.inventory_units set status='issued', bin_id='other-bin', assigned_to='next-customer'");
    const before = await snapshot(db);
    assert.equal((await call(db, payload(originalDelivery))).status, state);
    assert.deepEqual(await snapshot(db), before);
    await db.exec(`set test.actor='${otherActor}'`);
    const result = await call(db, { ...payload(originalDelivery), idempotency_key: 'fresh-replay-command' });
    assert.equal(result.status, state);
    assert.deepEqual(result.replacement_delivery, originalDelivery);
    assert.deepEqual(await snapshot(db), before);
  });
}

for (const delivery of [undefined, null]) {
  test(`legacy ${delivery === null ? 'null' : 'omitted'} delivery cannot re-resolve a closed case`, async t => {
    const db = await setup(t);
    const command = payload(delivery);
    await call(db, command);
    await closeCase(db);
    const before = await snapshot(db);
    const result = await call(db, { ...command, idempotency_key: 'legacy-replay-command' });
    assert.equal(result.status, 'closed');
    assert.deepEqual(await snapshot(db), before);
    await assert.rejects(call(db, { ...command, idempotency_key: 'legacy-mutated-command', quarantine_bin_id: 'other-bin' }), /already resolved|already confirmed|cannot change/i);
    await assert.rejects(call(db, { ...command, idempotency_key: 'legacy-reroute-command', resolution: 're_kit' }), /already resolved|already confirmed|cannot change/i);
    assert.deepEqual(await snapshot(db), before);
  });
}

test('confirmed closed cases reject changed destinations, custody, references, and legacy bypasses', async t => {
  const db = await setup(t);
  await call(db, payload(originalDelivery));
  await closeCase(db);
  const before = await snapshot(db);
  for (const change of [
    { replacement_delivery: newDelivery }, { quarantine_bin_id: 'other-bin' },
    { resolution: 're_kit' }, { supplier_reference: 'new-reference' },
    { refund_reference: 'new-refund' }, { finance_evidence_url: 'https://example.test/new-proof' },
    { replacement_order_id: source }, { replacement_delivery: undefined }, { replacement_delivery: null },
  ]) {
    await assert.rejects(call(db, { ...payload(originalDelivery), ...change, idempotency_key: 'changed-replay-command' }), /already resolved|already confirmed|cannot change|case-created/i);
    assert.deepEqual(await snapshot(db), before);
  }
});

test('replays retain command hash checks even when extra payload fields do not change the case', async t => {
  const db = await setup(t);
  const command = payload(originalDelivery);
  await call(db, command);
  const before = await snapshot(db);
  await assert.rejects(call(db, { ...command, unexpected: 'different-payload' }), /different payload/i);
  assert.deepEqual(await snapshot(db), before);
});

test('no-op replays still require authentication, return authority and valid command keys', async t => {
  const db = await setup(t);
  await call(db, payload(originalDelivery));
  const before = await snapshot(db);
  await db.exec("set test.capabilities='[]'");
  await assert.rejects(call(db, payload(originalDelivery)), /Not authorized/i);
  await db.exec("set test.capabilities='[\"warehouse.manage_returns\"]'; set test.actor=''");
  await assert.rejects(call(db, payload(originalDelivery)), /Authentication|Not authorized/i);
  await db.exec(`set test.actor='${actor}'`);
  await assert.rejects(call(db, { ...payload(originalDelivery), idempotency_key: 'bad' }), /idempotency key/i);
  assert.deepEqual(await snapshot(db), before);
});

test('finance-only legacy refund authority survives wrapping and closed refunds cannot repeat custody', async t => {
  const db = await setup(t);
  await db.exec("set test.capabilities='[\"procurement.view_finance\"]'");
  const command = { ...payload(), idempotency_key: 'refund-original-command', resolution: 'refund',
    refund_reference: 'REFUND-1', finance_evidence_url: 'https://example.test/refund' };
  assert.equal((await call(db, command)).resolution, 'refund');
  await closeCase(db);
  const before = await snapshot(db);
  assert.equal((await call(db, { ...command, idempotency_key: 'refund-replay-command' })).status, 'closed');
  assert.deepEqual(await snapshot(db), before);
});

test('delivery validation and predecessor custody failures leave no confirmation, order, movement or cache', async t => {
  const db = await setup(t);
  const before = await snapshot(db);
  for (const [command, error] of [
    [payload({ ...newDelivery, reason: '' }), /reason/i],
    [payload({ mode: 'invalid' }), /delivery mode/i],
    [payload({ ...newDelivery, customerEmail: 'invalid' }), /email/i],
    [payload({ ...newDelivery, deliveryAddress: { city: 'Makati' } }), /complete replacement/i],
    [{ ...payload(originalDelivery), quarantine_bin_id: 'missing' }, /quarantine bin/i],
    [{ ...payload(originalDelivery), replacement_order_id: source }, /case-created/i],
  ]) {
    await assert.rejects(call(db, command), error);
    assert.deepEqual(await snapshot(db), before);
  }
  await db.exec("delete from warehouse.inventory_units");
  const missingUnit = await snapshot(db);
  await assert.rejects(call(db, payload(originalDelivery)), /serial is no longer recognized/i);
  assert.deepEqual(await snapshot(db), missingUnit);
});

test('failure after the predecessor resolves rolls back confirmation, custody, audit and command cache', async t => {
  const db = await setup(t);
  await db.exec(`
    create function warehouse.test_block_delivery_update() returns trigger language plpgsql as $$
    begin raise exception 'Simulated destination write failure'; end; $$;
    create trigger test_block_delivery_update before update of delivery_address on warehouse.fulfillment_orders
      for each row execute function warehouse.test_block_delivery_update();
  `);
  const before = await snapshot(db);
  await assert.rejects(call(db, payload(newDelivery)), /Simulated destination write failure/);
  assert.deepEqual(await snapshot(db), before);
});
