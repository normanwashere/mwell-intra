import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const moduleUrl = new URL('./wms-department-cleanup.mjs', import.meta.url);
assert.ok(existsSync(moduleUrl), 'The manifest-bound cleanup generator must exist');
const { generateDepartmentCleanup, writeDepartmentCleanup } = await import(moduleUrl.href);
// Minimal synthetic-run fixtures; no ignored signoff artifacts are required.
const manifestUrl = new URL('./fixtures/wms-department/first-manifest.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
const otherManifest = JSON.parse(await readFile(new URL('./fixtures/wms-department/second-manifest.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(manifest);
const q = value => `'${String(value).replaceAll("'", "''")}'`;

async function setup(t, m = manifest) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create schema warehouse; create schema core; create schema storage; create schema private;
    create table warehouse.products(id text primary key, sku text, attributes jsonb);
    create table warehouse.locations(id text primary key, name text, type text);
    create table warehouse.storage_areas(id text primary key, location_id text, code text, zone text);
    create table warehouse.fulfillment_orders(id uuid primary key, source text, external_reference text,
      source_location_id text references warehouse.locations, source_bin_id text references warehouse.storage_areas,
      parent_order_id uuid references warehouse.fulfillment_orders, third_party_location_id text, event_id text,
      lines jsonb, packaging jsonb, status text, acknowledgement_evidence_url text, handover_evidence_url text);
    create table warehouse.department_stock_requests(id uuid primary key, purpose text, lines jsonb,
      fulfillment_order_id uuid references warehouse.fulfillment_orders, event_id text);
    create table warehouse.fulfillment_reservations(id uuid primary key, order_id uuid references warehouse.fulfillment_orders,
      product_id text references warehouse.products, location_id text, bin_id text, quantity integer);
    create table warehouse.stock_levels(id uuid primary key, product_id text, location_id text,
      bin_id text references warehouse.storage_areas on delete set null, lot_id text, quantity integer);
    create table warehouse.movements(id text primary key, product_id text, reference text, type text,
      from_location_id text, from_bin_id text, to_location_id text, to_bin_id text,
      serial_number text, lot_id text, event_id text, quantity integer, evidence_urls jsonb);
    create table core.activity_log(id bigint primary key, module text, entity_type text, entity_id text);
    create table core.notifications(id text primary key, entity_type text, entity_id text);
    create table warehouse.command_log(id uuid primary key, command_name text, idempotency_key text, response jsonb);
    create table core.profiles(id text primary key);
    create table core.user_roles(id text primary key);
    insert into core.profiles values('untouched-person'); insert into core.user_roles values('untouched-role');
    create table storage.objects(id uuid primary key, bucket_id text, name text);
    create table core.documents(id text primary key, entity_type text, entity_id text, storage_path text);
    create table private.action_evidence(id uuid primary key, source_type text, source_id text, storage_path text);
  `);
  for (const [i, c] of m.cases.entries()) {
    const id = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    const lines = q(JSON.stringify([{ productId: c.productId, quantity: c.requestedQuantity }]));
    await db.exec(`
      insert into warehouse.products values(${q(c.productId)},${q(c.sku)},${q(JSON.stringify({ signoffRun: m.runId, synthetic: true }))});
      insert into warehouse.locations values(${q(c.locationId)},${q(c.productName)},'warehouse');
      insert into warehouse.storage_areas values(${q(c.binId)},${q(c.locationId)},${q(c.binCode)},'WMS-SIGNOFF');
      insert into warehouse.fulfillment_orders(id,source,external_reference,source_location_id,source_bin_id,lines,packaging,status)
        values(${q(c.orderId)},'department_request',${q('REQ-' + c.requestId)},${q(c.locationId)},${q(c.binId)},${lines},'[]','released');
      insert into warehouse.department_stock_requests values(${q(c.requestId)},${q('Synthetic WMS signoff ' + m.runId)},${lines},${q(c.orderId)},null);
      insert into warehouse.fulfillment_reservations values(${q(id)},${q(c.orderId)},${q(c.productId)},${q(c.locationId)},${q(c.binId)},2);
      insert into warehouse.stock_levels values(${q(id)},${q(c.productId)},${q(c.locationId)},${q(c.binId)},null,8);
      insert into warehouse.movements values(${q(id)},${q(c.productId)},${q(c.orderId)},'fulfillment_release',${q(c.locationId)},${q(c.binId)},null,null,null,null,null,2,'[]');
      insert into core.activity_log values(${i + 1},'warehouse','fulfillment_order',${q(c.orderId)});
      insert into core.notifications values(${q(id)},'department_stock_request',${q(c.requestId)});
      insert into warehouse.command_log values(${q(id)},'advance_fulfillment_order_v2',${q('random-ui-key-' + i)},${q(JSON.stringify({ id: c.orderId }))});
    `);
  }
  return db;
}

async function snapshot(db) {
  const result = {};
  for (const table of ['products', 'locations', 'storage_areas', 'fulfillment_orders', 'department_stock_requests',
    'fulfillment_reservations', 'stock_levels', 'movements', 'command_log']) {
    result[table] = (await db.query(`select * from warehouse.${table} order by id`)).rows;
  }
  for (const table of ['activity_log', 'notifications', 'profiles', 'user_roles']) {
    result[table] = (await db.query(`select * from core.${table} order by id`)).rows;
  }
  return result;
}

async function refusedWithoutWrites(db, sql, pattern) {
  const before = await snapshot(db);
  await assert.rejects(db.exec(sql), pattern);
  await db.exec('rollback');
  assert.deepEqual(await snapshot(db), before);
}

test('both real manifests generate read-only readbacks and ordered bounded deletion', () => {
  for (const m of [manifest, otherManifest]) {
    const scripts = generateDepartmentCleanup(m);
    assert.match(scripts.readbackSql, /begin read only;/i);
    assert.match(scripts.postcleanupSql, /begin read only;/i);
    assert.match(scripts.readbackSql, /set local row_security = off;/i);
    assert.match(scripts.postcleanupSql, /set local row_security = off;/i);
    assert.doesNotMatch(scripts.readbackSql + scripts.postcleanupSql, /\b(delete from|update warehouse|insert into)\b/i);
    const tables = [...scripts.cleanupSql.matchAll(/delete from ([a-z_]+\.[a-z_]+) r where /g)].map(match => match[1]);
    assert.deepEqual(tables, ['core.notifications', 'core.activity_log', 'warehouse.command_log',
      'warehouse.fulfillment_reservations', 'warehouse.department_stock_requests', 'warehouse.fulfillment_orders',
      'warehouse.movements', 'warehouse.stock_levels', 'warehouse.storage_areas', 'warehouse.locations', 'warehouse.products']);
    assert.doesNotMatch(scripts.cleanupSql, /\b(truncate|disable trigger|session_replication_role|drop schema|reset role)\b/i);
    assert.doesNotMatch(scripts.cleanupSql, /(?:delete from|update) (?:auth\.|core\.(?:profiles|user_roles)|storage\.)/i);
    assert.match(scripts.cleanupSql, /signoffRun/);
    assert.match(scripts.cleanupSql, new RegExp(m.runId));
  }
});

test('rejects SQL injection, malformed UUIDs, cross-run names, duplicate identities and invalid quantities', () => {
  const mutations = [
    m => { m.runId = "x'; delete from core.profiles;--"; },
    m => { m.cases[0].requestId = 'not-a-uuid'; },
    m => { m.cases[0].orderId += "'"; },
    m => { m.cases[0].viewport = 'desktop-1440-other'; },
    ...['productId', 'locationId', 'binId', 'binCode', 'sku', 'productName'].map(field => m => { m.cases[0][field] = otherManifest.cases[0][field] + "'"; }),
    m => { m.cases[0].productId = otherManifest.cases[0].productId; },
    m => { m.cases[1].requestId = m.cases[0].orderId; },
    m => { m.cases[0].orderId = m.runId; },
    m => { m.cases.push(m.cases[0]); },
    m => { m.cases = []; },
    m => { m.project = 'production'; },
    m => { m.origin = 'https://other.example'; },
    m => { m.cases[0].openingQuantity = '10;select 1'; },
    m => { m.cases[0].requestedQuantity = 1.5; },
    m => { m.cases[0].requestedQuantity = 11; },
  ];
  for (const mutate of mutations) {
    const m = copy(); mutate(m);
    assert.throws(() => generateDepartmentCleanup(m), /manifest|UUID|scope|quantity|viewport|duplicate/i);
  }
});

test('real SQL removes only owned rows, including random UI command keys; counts remain honestly scoped', async t => {
  const db = await setup(t);
  const c = manifest.cases[0];
  await db.exec(`
    insert into warehouse.products values('other','OTHER','{}');
    insert into warehouse.stock_levels values('99999999-9999-4999-8999-999999999999','other','other-loc',null,null,90);
    insert into warehouse.command_log values('99999999-9999-4999-8999-999999999999','advance_fulfillment_order',${q(manifest.runId + '-desktop-14400-request')},'{"id":"unrelated"}');
    insert into warehouse.command_log values('88888888-8888-4888-8888-888888888888','advance_fulfillment_order',${q(manifest.runId + '-desktop-1440-deny')},null);
    update warehouse.fulfillment_orders set acknowledgement_evidence_url='data:image/png;base64,YQ==',
      handover_evidence_url=${q('intra://handover/' + c.orderId + '/HO-test')} where id=${q(c.orderId)};
  `);
  const scripts = generateDepartmentCleanup(manifest);
  await db.exec(scripts.readbackSql);
  await db.exec(scripts.cleanupSql);
  const after = await snapshot(db);
  assert.deepEqual(after.products.map(row => row.id), ['other']);
  assert.equal(after.stock_levels[0].quantity, 90);
  assert.equal(after.command_log.length, 1);
  assert.equal(after.command_log[0].response.id, 'unrelated');
  assert.deepEqual(after.profiles, [{ id: 'untouched-person' }]);
  assert.deepEqual(after.user_roles, [{ id: 'untouched-role' }]);
  for (const table of ['locations', 'storage_areas', 'fulfillment_orders', 'department_stock_requests', 'movements', 'fulfillment_reservations', 'activity_log', 'notifications']) assert.equal(after[table].length, 0, table);
  const result = await db.exec(scripts.postcleanupSql);
  const report = result.find(item => item.rows?.[0]?.report)?.rows[0].report;
  assert.equal(report.databaseRowsRemaining, 0);
  assert.equal(report.allResidueVerified, false);
});

test('owned reservations accept null or exact sources but retain order/product/quantity proof', async t => {
  for (const mode of ['both-null', 'location-null', 'bin-null']) {
    await t.test(mode, async sub => {
      const db = await setup(sub);
      await db.exec(`update warehouse.fulfillment_orders set source_location_id=null, source_bin_id=null, status='allocated';
        update warehouse.fulfillment_reservations set ${mode === 'both-null' ? 'location_id=null, bin_id=null' : mode === 'location-null' ? 'location_id=null' : 'bin_id=null'};`);
      await db.exec(generateDepartmentCleanup(manifest).cleanupSql);
      const after = await snapshot(db);
      assert.equal(after.fulfillment_reservations.length, 0);
      assert.equal(after.products.length, 0);
      assert.deepEqual(after.profiles, [{ id: 'untouched-person' }]);
      assert.deepEqual(after.user_roles, [{ id: 'untouched-role' }]);
    });
  }
  const c = manifest.cases[0];
  for (const [field, value] of [
    ['location_id', 'unrelated-location'], ['bin_id', manifest.cases[1].binId],
    ['order_id', manifest.cases[1].orderId], ['product_id', manifest.cases[1].productId], ['quantity', 3],
  ]) {
    await t.test(`reject mismatched ${field}`, async sub => {
      const db = await setup(sub);
      await db.exec(`update warehouse.fulfillment_reservations set location_id=null, bin_id=null;
        update warehouse.fulfillment_reservations set ${field}=${q(value)} where order_id=${q(c.orderId)};`);
      await refusedWithoutWrites(db, generateDepartmentCleanup(manifest).cleanupSql, /out.of.scope|ownership|lineage/i);
    });
  }
});

test('prefix collision without full UUID product proof rolls back', async t => {
  const db = await setup(t);
  await db.exec(`update warehouse.products set attributes='{"signoffRun":"${manifest.runId.slice(0, 8)}-different-run"}'`);
  await refusedWithoutWrites(db, generateDepartmentCleanup(manifest).cleanupSql, /ownership proof/i);
});

test('other stock, unexpected movement and request/order lineage cannot be swept up', async t => {
  const c = manifest.cases[0];
  for (const change of [
    `update warehouse.stock_levels set location_id='unrelated-location' where product_id=${q(c.productId)}`,
    `update warehouse.movements set reference='unrelated-order' where product_id=${q(c.productId)}`,
    `update warehouse.department_stock_requests set purpose='Real request' where id=${q(c.requestId)}`,
    `update warehouse.fulfillment_orders set packaging='[{"productId":"other","quantity":1}]' where id=${q(c.orderId)}`,
    `update core.activity_log set module='finance' where entity_id=${q(c.orderId)}`,
    `update warehouse.command_log set idempotency_key=${q(manifest.runId + '-desktop-1440-foreign')},response='{"id":"unrelated"}' where response->>'id'=${q(c.orderId)}`,
  ]) {
    await t.test(change.split(' set ')[0], async sub => {
      const db = await setup(sub);
      await db.exec(change);
      await refusedWithoutWrites(db, generateDepartmentCleanup(manifest).cleanupSql, /out.of.scope|ownership|lineage|unhandled/i);
    });
  }
});

test('unknown cascade/set-null/restrict FK branches abort without modifying child rows', async t => {
  for (const action of ['cascade', 'set null', 'restrict']) {
    await t.test(action, async sub => {
      const db = await setup(sub);
      await db.exec(`create table warehouse.unreviewed(id int primary key, order_id uuid references warehouse.fulfillment_orders on delete ${action});
        insert into warehouse.unreviewed values(1,${q(manifest.cases[0].orderId)});`);
      await refusedWithoutWrites(db, generateDepartmentCleanup(manifest).cleanupSql, /FK branch/i);
      assert.equal((await db.query('select order_id from warehouse.unreviewed')).rows[0].order_id, manifest.cases[0].orderId);
    });
  }
});

test('orphaned uploaded acknowledgment blocks cleanup even with no saved evidence URL', async t => {
  const db = await setup(t);
  await db.exec(`insert into storage.objects values('99999999-9999-4999-8999-999999999999','evidence',${q('acknowledgment-' + manifest.cases[0].orderId + '/0/orphan.png')})`);
  await refusedWithoutWrites(db, generateDepartmentCleanup(manifest).cleanupSql, /storage cleanup/i);
});

test('non-FK inventory references also fail closed', async t => {
  const db = await setup(t);
  await db.exec(`create table warehouse.inventory_units(id text primary key, product_id text, location_id text);
    insert into warehouse.inventory_units values('unexpected-unit',${q(manifest.cases[0].productId)},null);`);
  await refusedWithoutWrites(db, generateDepartmentCleanup(manifest).cleanupSql, /Unhandled logical reference/i);
});

test('failed or partial runs can be cleaned without inventing missing business records', async t => {
  const db = await setup(t);
  await db.exec(`delete from warehouse.fulfillment_reservations;
    delete from warehouse.department_stock_requests;
    delete from warehouse.fulfillment_orders;
    delete from warehouse.movements;
    delete from warehouse.command_log;
    update warehouse.stock_levels set quantity=10;`);
  await db.exec(generateDepartmentCleanup(manifest).cleanupSql);
  assert.equal((await snapshot(db)).products.length, 0);
});

test('persisted storage paths require separate verified cleanup; opaque evidence never counts as handled', async t => {
  const db = await setup(t);
  const c = manifest.cases[0];
  const storagePath = `acknowledgment-${c.orderId}/0/proof.png`;
  await db.exec(`update warehouse.fulfillment_orders set acknowledgement_evidence_url=${q(storagePath)} where id=${q(c.orderId)}`);
  await refusedWithoutWrites(db, generateDepartmentCleanup(manifest).cleanupSql, /separately verified storage/i);
  const verification = { runId: manifest.runId, project: manifest.project, verifiedBy: 'Independent operator',
    verifiedAt: '2026-09-13T04:00:00Z', evidenceRef: 'storage-cleanup-receipt.json', inventoryComplete: true,
    objects: [{ bucket: 'evidence', path: storagePath, status: 'deleted-and-verified' }] };
  assert.throws(() => generateDepartmentCleanup(manifest, { storageVerification: { ...verification, runId: otherManifest.runId } }), /storage.*scope/i);
  assert.throws(() => generateDepartmentCleanup(manifest, { storageVerification: { ...verification, objects: [{ ...verification.objects[0], path: 'shared/proof.png' }] } }), /storage.*scope/i);
  await db.exec(`update warehouse.fulfillment_orders set acknowledgement_evidence_url='https://unknown.example/proof.png' where id=${q(c.orderId)}`);
  await refusedWithoutWrites(db, generateDepartmentCleanup(manifest, { storageVerification: verification }).cleanupSql, /unhandled evidence/i);
  await db.exec(`update warehouse.fulfillment_orders set acknowledgement_evidence_url=${q(storagePath)} where id=${q(c.orderId)}`);
  await db.exec(generateDepartmentCleanup(manifest, { storageVerification: verification }).cleanupSql);
});

test('unhandled evidence registration and new DELETE triggers fail closed', async t => {
  await t.test('registered evidence', async sub => {
    const db = await setup(sub);
    await db.exec(`insert into core.documents values('proof','fulfillment_order',${q(manifest.cases[0].orderId)},'unhandled/proof.png')`);
    await refusedWithoutWrites(db, generateDepartmentCleanup(manifest).cleanupSql, /unhandled evidence/i);
  });
  await t.test('trigger', async sub => {
    const db = await setup(sub);
    await db.exec(`create function warehouse.unreviewed_delete() returns trigger language plpgsql as $$ begin return old; end $$;
      create trigger unreviewed before delete on warehouse.products for each row execute function warehouse.unreviewed_delete();`);
    await refusedWithoutWrites(db, generateDepartmentCleanup(manifest).cleanupSql, /DELETE trigger/i);
  });
});

test('writer is offline, creates only three SQL files, and refuses overwrite', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'wms-cleanup-test-'));
  const file = path.join(folder, 'manifest.json');
  await writeFile(file, JSON.stringify(manifest));
  await writeDepartmentCleanup(file);
  assert.deepEqual((await readdir(folder)).sort(), ['cleanup.sql', 'manifest.json', 'postcleanup.sql', 'pre-cleanup-readback.sql']);
  await assert.rejects(writeDepartmentCleanup(file), /exist/i);
});
