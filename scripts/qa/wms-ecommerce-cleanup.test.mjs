import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createManifest } from './wms-ecommerce-signoff-live.mjs';

const moduleUrl = new URL('./wms-ecommerce-cleanup.mjs', import.meta.url);
assert(existsSync(moduleUrl), 'Offline ecommerce cleanup planner must exist');
const { generateEcommerceCleanup, writeEcommerceCleanup, generateEcommerceStorageReferencePreflight, validateEcommerceSchemaCoverage, isVerifiedStorageAbsence } = await import(moduleUrl.href);
const m = createManifest({ runId: 'a1000000-0000-4000-8000-000000000001', commit: 'a'.repeat(40), orderDate: '2026-09-13' });
const c = m.cases[0];
const orderId = 'b1000000-0000-4000-8000-000000000001';
const actor = 'c1000000-0000-4000-8000-000000000001';
const otherActor = 'c2000000-0000-4000-8000-000000000001';
const podPath = `delivery-${orderId}/0/d1000000-0000-4000-8000-000000000001.png`;
const bytes = Buffer.from('offline synthetic POD bytes');
const hash = createHash('sha256').update(bytes).digest('hex');
const bindings = [{ view: c.viewport, orderId, productId: c.productId, reference: c.reference }];
const prefixes = [`delivery-${orderId}/`, `fulfillment/${orderId}/`, `acknowledgment-${orderId}/`];
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const json = value => q(JSON.stringify(value));
function receipt(withPod = true) {
  return { version: 1, kind: 'wms-ecommerce-storage-cleanup', runId: m.runId, project: m.project, commit: m.commit,
    runStopped: true, bindingsComplete: true, inventoryComplete: true, evidenceRef: 'independent-storage-receipt.json',
    inventory: { source: 'authenticated-storage-list', actorId: actor, prefixes, remainingPaths: [], verifiedAt: '2026-09-13T03:00:00.000Z' },
    objects: withPod ? [{ view: c.viewport, orderId, bucket: 'evidence', path: podPath, status: 'deleted-and-verified',
      fixture: { ref: `${c.viewport}-synthetic-pod.png`, sha256: hash, byteLength: bytes.length },
      downloads: [actor, otherActor].map(actorId => ({ actorId, source: 'authenticated-storage-download', sha256: hash, byteLength: bytes.length, verifiedAt: '2026-09-13T01:00:00.000Z' })),
      deletion: { source: 'authenticated-storage-remove', actorId: actor, httpStatus: 200, deletedAt: '2026-09-13T02:00:00.000Z' },
      absence: { source: 'authenticated-storage-download', actorId: actor, httpStatus: 404, verifiedAt: '2026-09-13T03:00:00.000Z' } }] : [] };
}
function isolationReceipt(orderIds = [orderId]) {
  return { version: 1, kind: 'wms-ecommerce-cleanup-isolation', runId: m.runId, project: m.project, commit: m.commit, orderIds,
    scopeWritersStopped: true, inFlightWorkDrained: true, schemaChangesPaused: true, holdThroughPostcleanup: true,
    evidenceRef: 'independent-run-isolation.json', verifiedAt: '2026-09-13T03:00:00.000Z' };
}
const options = (withPod = true) => ({ bindings, storageReceipt: receipt(withPod), isolationReceipt: isolationReceipt(), fixtures: { [c.viewport]: bytes } });

test('Storage absence accepts only reviewed HTTP404 or exact NoSuchKey HTTP400 wrapper', () => {
  for (const record of [
    { httpStatus: 404, storageErrorCode: 'NoSuchKey' },
    { httpStatus: 404, storageErrorCode: 'not_found' },
    ...['404', 404].map(storageStatusCode => ({ httpStatus: 400, storageErrorCode: 'NoSuchKey', storageStatusCode })),
  ]) assert.equal(isVerifiedStorageAbsence(record), true);
  for (const record of [undefined, {},
    { httpStatus: 400 }, { httpStatus: 400, storageErrorCode: 'NoSuchKey' },
    { httpStatus: 400, storageErrorCode: 'not_found', storageStatusCode: '404' },
    { httpStatus: 400, message: 'Object not found', storageStatusCode: '404' },
    { httpStatus: 400, storageErrorCode: 'NoSuchKey', storageStatusCode: ' 404' },
    { httpStatus: 400, storageErrorCode: 'NoSuchKey', storageStatusCode: 400 },
    ...[200, 401, 403, 408, 500, 504].map(httpStatus => ({ httpStatus, storageErrorCode: 'NoSuchKey', storageStatusCode: '404' })),
  ]) assert.equal(isVerifiedStorageAbsence(record), false);
});

function capturedCreateResponse(fixture = c, id = orderId) {
  return { id, source: 'ecommerce', status: 'received', external_reference: fixture.reference,
    source_location_id: fixture.locationId, source_bin_id: null, parent_order_id: null, event_id: null, third_party_location_id: null,
    lines: [{ productId: fixture.productId, quantity: fixture.requestedQuantity, pickedQuantity: 0, pickedSerialNumbers: [] }],
    packaging: [], delivery_address: null, shipment_events: [] };
}

async function setup(t, stage = 'completed') {
  const db = new PGlite(); t.after(() => db.close());
  const issued = ['released', 'completed'].includes(stage);
  await db.exec(`create schema warehouse; create schema core; create schema private; create schema storage;
    create table warehouse.products(id text primary key,sku text,name text,category text,item_class text,serialized boolean,attributes jsonb);
    create table warehouse.locations(id text primary key,name text,type text);
    create table warehouse.storage_areas(id text primary key,location_id text references warehouse.locations,code text,zone text);
    create table warehouse.fulfillment_orders(id uuid primary key,source text,external_reference text,order_notes text,status text,delivery_method text,
      source_location_id text references warehouse.locations,source_bin_id text references warehouse.storage_areas,
      parent_order_id uuid references warehouse.fulfillment_orders,event_id text,third_party_location_id text,lines jsonb,packaging jsonb,
      delivery_address jsonb,shipment_events jsonb,proof_of_delivery_reference text,proof_of_delivery_evidence_url text,
      handover_evidence_url text,handover_reference text,acknowledgement_evidence_url text);
    create table warehouse.fulfillment_reservations(id uuid primary key,order_id uuid references warehouse.fulfillment_orders,
      product_id text references warehouse.products,location_id text,bin_id text,quantity int,status text);
    create table warehouse.stock_levels(id uuid primary key,product_id text references warehouse.products,location_id text,
      bin_id text references warehouse.storage_areas on delete set null,lot_id text,quantity int);
    create table warehouse.movements(id text primary key,product_id text,reference text,type text,quantity int,
      from_location_id text,from_bin_id text,to_location_id text,to_bin_id text,lot_id text,serial_number text,event_id text,evidence_urls jsonb);
    create table core.activity_log(id bigint primary key,module text,entity_type text,entity_id text,detail jsonb);
    create table core.notifications(id text primary key,entity_type text,entity_id text);
    create table warehouse.command_log(id uuid primary key,command_name text,idempotency_key text,response jsonb);
    create table core.documents(id text primary key,entity_id text,storage_path text);
    create table private.action_evidence(id uuid primary key,source_id uuid,storage_path text);
    create table storage.objects(id uuid primary key,bucket_id text,name text);
    create table core.profiles(id text primary key);
    create table core.user_roles(id text primary key);
    insert into core.profiles values('untouched-identity'); insert into core.user_roles values('untouched-role');`);
  for (const [i, fixture] of m.cases.entries()) {
    await db.exec(`insert into warehouse.products values(${q(fixture.productId)},${q(fixture.sku)},${q(fixture.productName)},'merchandise','sellable_sku',false,${json({ signoffRun: m.runId, synthetic: true })});
      insert into warehouse.locations values(${q(fixture.locationId)},${q(fixture.productName)},'warehouse');
      insert into warehouse.storage_areas values(${q(fixture.binId)},${q(fixture.locationId)},${q(fixture.binCode)},'WMS-SIGNOFF');
      insert into warehouse.stock_levels values('00000000-0000-4000-8000-00000000000${i + 1}',${q(fixture.productId)},${q(fixture.locationId)},${q(fixture.binId)},null,${i === 0 && issued ? 8 : 10});`);
  }
  if (stage !== 'fixtures') {
    const evidence = stage === 'completed' ? podPath : null;
    await db.exec(`insert into warehouse.fulfillment_orders(id,source,external_reference,order_notes,status,delivery_method,source_location_id,lines,packaging,delivery_address,shipment_events,proof_of_delivery_reference,proof_of_delivery_evidence_url)
      values('${orderId}','ecommerce',${q(c.reference)},${q(c.notes)},${q(stage)},'shipment',${q(c.locationId)},${json([{ productId: c.productId, quantity: 2 }])},'[]',${json(c.address)},'[]',${evidence ? q(c.podReference) : 'null'},${evidence ? q(evidence) : 'null'});
      ${stage === 'received' ? '' : `insert into warehouse.fulfillment_reservations values('${actor}','${orderId}',${q(c.productId)},null,null,2,${q(issued ? 'released' : 'active')});`}
      insert into core.activity_log values(1,'warehouse','fulfillment_order','${orderId}',${json({ external_reference: c.reference, status: stage })});
      insert into core.notifications values('notice','fulfillment_order','${orderId}');
      insert into warehouse.command_log values('${actor}','update_shipment_tracking','random-ui-key',${json({ id: orderId, proof_of_delivery_evidence_url: evidence })});`);
    if (issued) await db.exec(`insert into warehouse.movements values('movement',${q(c.productId)},'${orderId}','fulfillment_release',2,${q(c.locationId)},${q(c.binId)},null,null,null,null,null,'[]');`);
  }
  return db;
}
async function snapshot(db) {
  const result = {};
  for (const table of ['warehouse.products','warehouse.locations','warehouse.storage_areas','warehouse.fulfillment_orders','warehouse.fulfillment_reservations',
    'warehouse.stock_levels','warehouse.movements','warehouse.command_log','core.activity_log','core.notifications','core.profiles','core.user_roles','storage.objects']) {
    result[table] = (await db.query(`select * from ${table} order by id`)).rows;
  }
  return result;
}
async function blocked(db, sql, pattern = /ownership|scope|unhandled|receipt|evidence|reconcil|Storage|trigger|FK/i) {
  const before = await snapshot(db);
  await assert.rejects(db.exec(sql), pattern); await db.exec('rollback');
  assert.deepEqual(await snapshot(db), before);
}

test('rejects department manifests, malformed/cross-run bindings and unverified Storage receipts', () => {
  assert.throws(() => generateEcommerceCleanup({ ...m, kind: 'department' }, options()));
  assert.throws(() => generateEcommerceCleanup({ ...m, runId: "x';--" }, options()));
  assert.throws(() => generateEcommerceCleanup(m, { ...options(), bindings: [{ ...bindings[0], orderId: 'bad' }] }));
  assert.throws(() => generateEcommerceCleanup(m, { ...options(), bindings: [{ ...bindings[0], productId: 'other' }] }));
  for (const mutate of [r => { r.project = 'production'; }, r => { r.runStopped = false; }, r => { r.inventory.prefixes = []; },
    r => { r.objects[0].fixture.sha256 = '0'.repeat(64); }, r => { r.objects[0].downloads[0].sha256 = '0'.repeat(64); },
    r => { r.objects[0].absence.httpStatus = 403; }, r => { r.objects[0].status = 'verified'; },
    r => { r.objects[0].path = `acknowledgment-${orderId}/0/proof.png`; }, r => { r.objects[0].deletion.actorId = 'service-key'; }]) {
    const value = receipt(); mutate(value);
    assert.throws(() => generateEcommerceCleanup(m, { ...options(), storageReceipt: value }));
  }
  assert.throws(() => generateEcommerceCleanup(m, { ...options(), fixtures: {} }), /fixture/i);
});

test('missing receipt still yields readback/counts but cannot authorize deletion', async t => {
  const db = await setup(t);
  const plan = generateEcommerceCleanup(m, { bindings });
  assert.equal(plan.readyForIndependentExecution, false);
  assert.doesNotMatch(plan.cleanupSql, /delete from/i);
  await db.exec(plan.readbackSql); await db.exec(plan.postcleanupSql);
  await blocked(db, plan.cleanupSql, /receipt/i);
});

test('actual SQL deletes only owned rows in dependency order, with no global or Storage mutation', async t => {
  const db = await setup(t); const plan = generateEcommerceCleanup(m, options());
  await db.exec(`insert into warehouse.products values('other','OTHER','Other','merchandise','sellable_sku',false,'{}');
    insert into warehouse.stock_levels values('${otherActor}','other','other-location',null,null,99);
    insert into warehouse.command_log values('${otherActor}','update_shipment_tracking',${q(m.runId + '-desktop14400-near-match')},'{"id":"other"}');`);
  assert.deepEqual([...plan.cleanupSql.matchAll(/delete from ([\w.]+) r where/g)].map(x => x[1]),
    ['core.notifications','core.activity_log','warehouse.command_log','warehouse.fulfillment_reservations','warehouse.fulfillment_orders','warehouse.movements','warehouse.stock_levels','warehouse.storage_areas','warehouse.locations','warehouse.products']);
  assert.doesNotMatch(plan.cleanupSql, /\b(truncate|disable trigger|session_replication_role|drop schema)\b/i);
  assert.doesNotMatch(plan.cleanupSql, /(?:delete from|update) (?:storage\.|auth\.|core\.(?:profiles|user_roles))/i);
  // A near-match is not owned, but its embedded run UUID still requires review.
  await blocked(db, plan.cleanupSql, /Unhandled.*reference/i);
  await db.exec(`update warehouse.command_log set idempotency_key='unrelated-key' where id='${otherActor}'`);
  await db.exec(plan.readbackSql); await db.exec(plan.cleanupSql);
  const after = await snapshot(db);
  assert.deepEqual(after['warehouse.products'].map(r => r.id), ['other']);
  assert.equal(after['warehouse.stock_levels'][0].quantity, 99);
  assert.equal(after['warehouse.command_log'].length, 1);
  assert.equal(after['core.profiles'].length, 1); assert.equal(after['core.user_roles'].length, 1);
  const results = await db.exec(plan.postcleanupSql);
  const report = results.find(r => r.rows?.[0]?.report).rows[0].report;
  assert.equal(report.databaseRowsRemaining, 0); assert.equal(report.allResidueVerified, false);
});

test('null reservations and unused second viewport are safe; fixture-only cleanup requires empty inventory attestation', async t => {
  const db = await setup(t, 'allocated');
  await db.exec(generateEcommerceCleanup(m, options(false)).cleanupSql);
  assert.equal((await snapshot(db))['warehouse.products'].length, 0);
  const empty = receipt(false); empty.inventory.prefixes = [];
  const fixtureDb = await setup(t, 'fixtures');
  await fixtureDb.exec(generateEcommerceCleanup(m, { bindings: [], storageReceipt: empty, isolationReceipt: isolationReceipt([]) }).cleanupSql);
});

test('captured received create response permits JSON null address without relaxing the persisted order', async t => {
  const db = await setup(t);
  await db.exec(`update warehouse.command_log set command_name='create_fulfillment_order',response=${json(capturedCreateResponse())}`);
  const plan = generateEcommerceCleanup(m, options());
  await db.exec(`update warehouse.fulfillment_orders set delivery_address='null'::jsonb`);
  await blocked(db, plan.cleanupSql, /ownership\/lineage in warehouse.fulfillment_orders/i);
  await db.exec(`update warehouse.fulfillment_orders set delivery_address=${json(c.address)}`);
  await db.exec(plan.cleanupSql);
  assert.equal((await snapshot(db))['warehouse.command_log'].length, 0);
});

test('captured create null-address exception rejects wrong lifecycle, scope and malformed fields', async t => {
  const db = await setup(t); const sql = generateEcommerceCleanup(m, options()).cleanupSql;
  const probes = [
    ['wrong command', 'advance_fulfillment_order', {}],
    ['tracking command', 'update_shipment_tracking', {}],
    ['wrong status', 'create_fulfillment_order', { status: 'released' }],
    ['missing status', 'create_fulfillment_order', { status: undefined }],
    ['foreign order', 'create_fulfillment_order', { id: otherActor }],
    ['missing order', 'create_fulfillment_order', { id: undefined }],
    ['foreign source', 'create_fulfillment_order', { source: 'department_request' }],
    ['missing source', 'create_fulfillment_order', { source: undefined }],
    ['foreign reference', 'create_fulfillment_order', { external_reference: 'foreign' }],
    ['missing reference', 'create_fulfillment_order', { external_reference: undefined }],
    ['foreign location', 'create_fulfillment_order', { source_location_id: 'foreign' }],
    ['missing location', 'create_fulfillment_order', { source_location_id: undefined }],
    ['foreign bin', 'create_fulfillment_order', { source_bin_id: 'foreign' }],
    ['missing lines', 'create_fulfillment_order', { lines: undefined }],
    ['foreign product', 'create_fulfillment_order', { lines: [{ productId: 'foreign', quantity: 2 }] }],
    ['wrong quantity', 'create_fulfillment_order', { lines: [{ productId: c.productId, quantity: 3 }] }],
    ['string null', 'create_fulfillment_order', { delivery_address: 'null' }],
    ['foreign address', 'create_fulfillment_order', { delivery_address: { ...c.address, line1: 'foreign' } }],
    ['empty address', 'create_fulfillment_order', { delivery_address: {} }],
    ['array address', 'create_fulfillment_order', { delivery_address: [] }],
    ['numeric address', 'create_fulfillment_order', { delivery_address: 0 }],
    ['unknown scalar', 'create_fulfillment_order', { unreviewed: 'foreign' }],
    ['unknown nested field', 'create_fulfillment_order', { unreviewed: { id: 'foreign' } }],
  ];
  for (const [name, command, patch] of probes) await t.test(name, async () => {
    // A valid run key deliberately keeps missing/foreign response IDs in the candidate set.
    await db.exec(`update warehouse.command_log set command_name=${q(command)},idempotency_key=${q(`${m.runId}-${c.viewport}-probe`)},
      response=${json({ ...capturedCreateResponse(), ...patch })}`);
    await blocked(db, sql, /ownership\/lineage in warehouse.command_log/i);
  });
  await db.exec(`update warehouse.command_log set command_name='create_fulfillment_order',
    response=${json({ ...capturedCreateResponse(), delivery_address: c.address })}`);
  await db.exec(sql);
});

test('foreign fixtures, source, lines, stock, reservations, movements and commands roll back', async t => {
  for (const change of [
    `update warehouse.products set attributes='{"signoffRun":"${m.runId.slice(0, 8)}","synthetic":true}'`,
    `update warehouse.fulfillment_orders set source='department_request'`,
    `update warehouse.fulfillment_orders set lines='[{"productId":"foreign","quantity":2}]'`,
    `update warehouse.fulfillment_reservations set bin_id='foreign'`,
    `update warehouse.stock_levels set quantity=9 where product_id=${q(c.productId)}`,
    `update warehouse.movements set reference='foreign'`,
    `update warehouse.command_log set response='{"id":"${orderId}","source_location_id":"foreign"}'`,
    `update warehouse.command_log set response='{"id":"${orderId}","shipment_events":[{"status":"delivered","reason":{"id":"foreign"}}]}'`,
    `update warehouse.fulfillment_orders set lines='[{"productId":"${c.productId}","quantity":2,"unitPrice":{"foreign":"data"}}]'`,
    `insert into warehouse.products values('foreign','FOREIGN','Foreign','merchandise','sellable_sku',false,'{}'); insert into warehouse.stock_levels values('${otherActor}','foreign',${q(c.locationId)},${q(c.binId)},null,1)`,
    `insert into warehouse.fulfillment_reservations select '${otherActor}',order_id,product_id,location_id,bin_id,quantity,status from warehouse.fulfillment_reservations`,
    `insert into warehouse.movements select 'duplicate',product_id,reference,type,quantity,from_location_id,from_bin_id,to_location_id,to_bin_id,lot_id,serial_number,event_id,evidence_urls from warehouse.movements`,
    `update core.activity_log set module='finance'`,
  ]) await t.test(change.split(' set ')[0], async sub => {
    const db = await setup(sub); await db.exec(change);
    await blocked(db, generateEcommerceCleanup(m, options()).cleanupSql);
  });
});

test('unknown FK cascade/set-null/restrict and nested unowned JSON references fail closed', async t => {
  for (const action of ['cascade','set null','restrict']) await t.test(action, async sub => {
    const db = await setup(sub);
    await db.exec(`create table warehouse.branch(id int primary key,order_id uuid references warehouse.fulfillment_orders on delete ${action}); insert into warehouse.branch values(1,'${orderId}');`);
    await blocked(db, generateEcommerceCleanup(m, options()).cleanupSql, /FK/);
    assert.equal((await db.query('select order_id from warehouse.branch')).rows[0].order_id, orderId);
  });
  await t.test('nested foreign JSON', async sub => {
    const db = await setup(sub);
    await db.exec(`create table warehouse.unreviewed(id int,payload jsonb); insert into warehouse.unreviewed values(1,'{"nested":[{"order":"${orderId}"}]}');`);
    await blocked(db, generateEcommerceCleanup(m, options()).cleanupSql, /Unhandled.*reference/i);
  });
  await t.test('unknown JSON column on owned row', async sub => {
    const db = await setup(sub);
    await db.exec(`alter table warehouse.fulfillment_orders add column unreviewed jsonb; update warehouse.fulfillment_orders set unreviewed='{"id":"foreign"}';`);
    await blocked(db, generateEcommerceCleanup(m, options()).cleanupSql, /JSON/i);
  });
  await t.test('unreviewed delete trigger', async sub => {
    const db = await setup(sub);
    await db.exec(`create function warehouse.unreviewed_delete() returns trigger language plpgsql as $$ begin return old; end; $$;
      create trigger unreviewed before delete on warehouse.products for each row execute function warehouse.unreviewed_delete();`);
    await blocked(db, generateEcommerceCleanup(m, options()).cleanupSql, /trigger/i);
  });
  await t.test('missing UI binding never permits fixture deletion', async sub => {
    const db = await setup(sub); const empty = receipt(false); empty.inventory.prefixes = [];
    await blocked(db, generateEcommerceCleanup(m, { bindings: [], storageReceipt: empty, isolationReceipt: isolationReceipt([]) }).cleanupSql);
  });
});

test('inline/unknown evidence, orphan objects and evidence registrations block database deletion', async t => {
  for (const change of [
    `update warehouse.fulfillment_orders set proof_of_delivery_evidence_url='data:image/png;base64,YQ=='`,
    `update warehouse.fulfillment_orders set proof_of_delivery_evidence_url='https://unknown.example/proof'`,
    `insert into storage.objects values('${actor}','evidence','delivery-${orderId}/0/orphan.png')`,
    `insert into core.documents values('document','${orderId}','${podPath}')`,
    `insert into private.action_evidence values('${actor}','${orderId}','${podPath}')`,
  ]) await t.test(change.split(' ').slice(0, 3).join(' '), async sub => {
    const db = await setup(sub); await db.exec(change);
    await blocked(db, generateEcommerceCleanup(m, options()).cleanupSql);
  });
});

test('writer creates only exclusive offline SQL outputs and never overwrites another file', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'wms-ecom-cleanup-'));
  const manifestPath = path.join(folder, 'manifest.json'); await writeFile(manifestPath, JSON.stringify(m));
  await writeEcommerceCleanup(manifestPath, { bindings });
  assert.deepEqual((await readdir(folder)).sort(), ['cleanup.sql','manifest.json','postcleanup.sql','pre-cleanup-readback.sql']);
  await assert.rejects(writeEcommerceCleanup(manifestPath, { bindings }), /exist/i);
  assert.equal(JSON.parse(await readFile(manifestPath)).kind, 'wms-ecommerce-shipment');
});

test('narrow cleanup requires separate scoped writer-drain attestation without relaxing Storage receipts', async t => {
  const db = await setup(t, 'received');
  const missing = generateEcommerceCleanup(m, { ...options(false), isolationReceipt: undefined });
  assert.equal(missing.readyForIndependentExecution, false);
  assert.doesNotMatch(missing.cleanupSql, /delete from/i);
  await blocked(db, missing.cleanupSql, /isolation/i);
  for (const key of ['scopeWritersStopped', 'inFlightWorkDrained', 'schemaChangesPaused', 'holdThroughPostcleanup']) {
    assert.throws(() => generateEcommerceCleanup(m, { ...options(false), isolationReceipt: { ...isolationReceipt(), [key]: false } }), /isolation/i);
  }
  assert.throws(() => generateEcommerceCleanup(m, { ...options(false), isolationReceipt: isolationReceipt([]) }), /isolation/i);
  assert.throws(() => generateEcommerceCleanup(m, { ...options(false), isolationReceipt: { ...isolationReceipt(), runId: actor } }), /isolation/i);
  const noStorage = generateEcommerceCleanup(m, { ...options(false), storageReceipt: undefined });
  assert.equal(noStorage.readyForIndependentExecution, false);
  await blocked(db, noStorage.cleanupSql, /Storage/i);
});

test('narrow cleanup locks only explicit target tables in DML-compatible mode and captures exact rows NOWAIT', async t => {
  const db = await setup(t, 'received'); const plan = generateEcommerceCleanup(m, options(false));
  assert.doesNotMatch(plan.cleanupSql, /in share row exclusive mode|in access exclusive mode|in exclusive mode/i);
  const tables = [...plan.cleanupSql.matchAll(/lock table ([\w.]+) in row exclusive mode nowait;/g)].map(x => x[1]);
  assert.deepEqual(tables.sort(), ['core.activity_log','core.notifications','warehouse.command_log','warehouse.fulfillment_orders',
    'warehouse.fulfillment_reservations','warehouse.locations','warehouse.movements','warehouse.products','warehouse.stock_levels','warehouse.storage_areas'].sort());
  assert.equal((plan.cleanupSql.match(/for update of r nowait/gi) ?? []).length, 10);
  assert.match(plan.cleanupSql, /begin isolation level read committed;/i);
  assert.equal(plan.limits.maintenanceWindowRequired, false);
  assert.equal(plan.limits.scopedWriterQuiescenceRequired, true);
  assert.equal(plan.limits.concurrentUnconstrainedReferencesPrevented, false);
  assert.equal(plan.limits.automaticRetry, false);
  await db.exec(plan.cleanupSql);
  assert.equal((await snapshot(db))['warehouse.products'].length, 0);
});

// PGlite has one backend: these inject between SQL phases, not concurrent sessions.
test('late rows are never swept into the delete set; post-delete guards fail closed', async t => {
  for (const [name, change, pattern] of [
    ['owned command', `insert into warehouse.command_log values('${otherActor}','create_fulfillment_order','late-ui-key','{"id":"${orderId}"}')`, /residue/i],
    ['unknown JSON', `insert into core.documents values('late','${orderId}',null)`, /Unhandled.*reference/i],
    ['Storage', `insert into storage.objects values('${otherActor}','evidence','delivery-${orderId}/0/late.png')`, /Storage/i],
  ]) await t.test(name, async sub => {
    const db = await setup(sub, 'received'); const sql = generateEcommerceCleanup(m, options(false)).cleanupSql;
    const [before, after, extra] = sql.split('-- ecom:verified\n');
    assert.equal(extra, undefined); assert(after, 'Stable guard boundary required');
    const original = await snapshot(db);
    await db.exec(before); await db.exec(change);
    const [deletes, post] = after.split('-- ecom:deleted\n'); assert(post);
    await db.exec(deletes);
    if (name === 'owned command') assert.equal((await db.query(`select count(*)::int n from warehouse.command_log where id='${otherActor}'`)).rows[0].n, 1);
    await assert.rejects(db.exec(post), pattern); await db.exec('rollback');
    assert.deepEqual(await snapshot(db), original);
  });
});

test('released desktop without uploads and untouched mobile stock cleans only its own run', async t => {
  const db = await setup(t, 'released');
  const unrelated = createManifest({ runId: 'e1000000-0000-4000-8000-000000000001', commit: m.commit, orderDate: m.orderDate });
  const other = unrelated.cases[0];
  await db.exec(`insert into warehouse.products values(${q(other.productId)},${q(other.sku)},${q(other.productName)},'merchandise','sellable_sku',false,${json({ signoffRun: unrelated.runId, synthetic: true })});
    insert into warehouse.stock_levels values('${otherActor}',${q(other.productId)},null,null,null,10);
    insert into warehouse.fulfillment_orders(id,source,external_reference,status,lines) values('${otherActor}','ecommerce',${q(other.reference)},'received',${json([{ productId: other.productId, quantity: 2 }])});`);
  const otherOrder = (await db.query(`select * from warehouse.fulfillment_orders where id='${otherActor}'`)).rows;
  await db.exec(generateEcommerceCleanup(m, options(false)).cleanupSql);
  assert.deepEqual((await db.query('select * from warehouse.fulfillment_orders')).rows, otherOrder);
  assert.deepEqual((await db.query('select product_id,quantity from warehouse.stock_levels')).rows, [{ product_id: other.productId, quantity: 10 }]);
  assert.equal((await db.query('select count(*)::int n from warehouse.movements')).rows[0].n, 0);
});

test('FK exclusions authorize only captured children, never later matching rows', async t => {
  const db = await setup(t, 'received');
  await db.exec(`alter table core.notifications alter column entity_id type uuid using entity_id::uuid;
    alter table core.notifications add constraint notice_order foreign key(entity_id) references warehouse.fulfillment_orders on delete cascade;`);
  const [locked, rest] = generateEcommerceCleanup(m, options(false)).cleanupSql.split('-- ecom:locked\n'); assert(rest);
  const original = await snapshot(db);
  await db.exec(locked);
  await db.exec(`insert into core.notifications values('late-owned-notice','fulfillment_order','${orderId}')`);
  await assert.rejects(db.exec(rest), /Unhandled FK branch/);
  await db.exec('rollback');
  assert.deepEqual(await snapshot(db), original);
});

test('reviewed shipment handover placeholder is reported as internal, not uploaded evidence', async t => {
  const db = await setup(t, 'released'); const uri = `intra://handover/${orderId}/`;
  await db.exec(`update warehouse.fulfillment_orders set handover_evidence_url=${q(uri)};
    update warehouse.command_log set response=response || ${json({ handover_evidence_url: uri })}::jsonb;`);
  const plan = generateEcommerceCleanup(m, options(false));
  const report = (await db.exec(plan.readbackSql)).find(r => r.rows?.[0]?.report).rows[0].report;
  const internal = report.evidence.filter(e => e.path === uri);
  assert.equal(internal.length, 2);
  assert(internal.every(e => e.kind === 'internal-reference'));
  assert.equal(report.storageObjects.length, 0);
  await blocked(db, generateEcommerceCleanup(m, { ...options(false), storageReceipt: undefined }).cleanupSql, /Storage/i);
  await db.exec(plan.cleanupSql);
});

test('handover exception rejects foreign orders, suffixes, wrong fields and inconsistent reference metadata', async t => {
  const uri = `intra://handover/${orderId}/`;
  for (const [name, change] of [
    ['foreign order', `update warehouse.fulfillment_orders set handover_evidence_url='intra://handover/${otherActor}/'`],
    ['suffix', `update warehouse.fulfillment_orders set handover_evidence_url='${uri}unexpected'`],
    ['query', `update warehouse.fulfillment_orders set handover_evidence_url='${uri}?file=unknown'`],
    ['POD', `update warehouse.fulfillment_orders set proof_of_delivery_evidence_url='${uri}'`],
    ['acknowledgement', `update warehouse.fulfillment_orders set acknowledgement_evidence_url='${uri}'`],
    ['cached wrong order', `update warehouse.command_log set response=response || '{"handover_evidence_url":"intra://handover/${otherActor}/"}'::jsonb`],
    ['reference metadata', `update warehouse.fulfillment_orders set handover_evidence_url='${uri}',handover_reference='foreign-reference'`],
  ]) await t.test(name, async sub => {
    const db = await setup(sub, 'released'); await db.exec(change);
    await blocked(db, generateEcommerceCleanup(m, options(false)).cleanupSql, /evidence|receipt/i);
  });
});

test('administrative Storage receipts identify service_role honestly and require subsequent independent DB absence', () => {
  const r = receipt(); r.version = 2;
  const principal = { kind: 'service_role', project: m.project, credentialSource: 'authenticated-supabase-cli' };
  for (const record of [r.inventory, r.objects[0].deletion, r.objects[0].absence]) {
    delete record.actorId; record.principal = principal;
  }
  r.objects[0].absence.storageErrorCode = 'NoSuchKey';
  r.databaseVerification = { source: 'independent-readonly-sql', runId: m.runId, project: m.project, commit: m.commit,
    verifiedAt: '2026-09-13T04:00:00.000Z', evidenceRef: 'independent-storage-db.json', apiReceiptSha256: 'a'.repeat(64),
    expectedPaths: [podPath], remainingObjects: [] };
  assert.equal(generateEcommerceCleanup(m, { ...options(), storageReceipt: r }).readyForIndependentExecution, true);
  for (const mutate of [x => { delete x.databaseVerification; }, x => { x.databaseVerification.remainingObjects = [{ name: podPath }]; },
    x => { x.databaseVerification.verifiedAt = '2026-09-13T01:00:00.000Z'; }, x => { x.inventory.actorId = actor; },
    x => { x.inventory.principal = { ...principal, project: 'foreign' }; },
    x => { x.objects[0].downloads[0] = { ...x.objects[0].downloads[0], principal }; }]) {
    const bad = structuredClone(r); mutate(bad);
    assert.throws(() => generateEcommerceCleanup(m, { ...options(), storageReceipt: bad }));
  }
});

test('independent Storage preflight checks foreign references before granting any removal', async t => {
  const db = await setup(t); const mobile = m.cases[1]; const mobileOrder = 'b2000000-0000-4000-8000-000000000001';
  const mobilePath = `delivery-${mobileOrder}/0/d2000000-0000-4000-8000-000000000001.png`;
  const allBindings = [...bindings, { view: mobile.viewport, orderId: mobileOrder, productId: mobile.productId, reference: mobile.reference }];
  const objects = [{ bucket: 'evidence', orderId, path: podPath }, { bucket: 'evidence', orderId: mobileOrder, path: mobilePath }];
  const generated = generateEcommerceStorageReferencePreflight(m, { bindings: allBindings, objects,
    isolationReceipt: isolationReceipt([orderId, mobileOrder]), scopeSha256: 'b'.repeat(64) });
  for (const schema of ['core','warehouse','private','public','learning','legal','procurement','product']) await db.exec(`create schema if not exists ${schema}`);
  await db.exec(`alter table storage.objects add column created_at timestamptz default now(), add column updated_at timestamptz default now(), add column metadata jsonb;
    insert into storage.objects(id,bucket_id,name,metadata) values('${actor}','evidence',${q(podPath)},'{"size":20,"mimetype":"image/png"}'),
      ('${otherActor}','evidence',${q(mobilePath)},'{"size":20,"mimetype":"image/png"}');
    update warehouse.stock_levels set quantity=8 where product_id=${q(mobile.productId)};
    insert into warehouse.fulfillment_orders(id,source,external_reference,order_notes,status,delivery_method,source_location_id,lines,packaging,delivery_address,shipment_events,proof_of_delivery_reference,proof_of_delivery_evidence_url)
      values('${mobileOrder}','ecommerce',${q(mobile.reference)},${q(mobile.notes)},'completed','shipment',${q(mobile.locationId)},${json([{ productId: mobile.productId, quantity: 2 }])},'[]',${json(mobile.address)},'[]',${q(mobile.podReference)},${q(mobilePath)});
    insert into warehouse.fulfillment_reservations values('${otherActor}','${mobileOrder}',${q(mobile.productId)},null,null,2,'released');
    insert into warehouse.movements values('mobile-movement',${q(mobile.productId)},'${mobileOrder}','fulfillment_release',2,${q(mobile.locationId)},${q(mobile.binId)},null,null,null,null,null,'[]');`);
  for (const [fixture, id] of [[c, orderId], [mobile, mobileOrder]]) {
    await db.exec(`insert into warehouse.command_log values('${id}','create_fulfillment_order',${q(`create_fulfillment_order-${id}`)},${json(capturedCreateResponse(fixture, id))})`);
  }
  assert.doesNotMatch(generated.sql, /delete from|truncate|lock table|insert into/i);
  const before = await snapshot(db);
  const result = (await db.exec(generated.sql)).flatMap(r => r.rows).find(r => r.verification).verification;
  validateEcommerceSchemaCoverage(result);
  assert(result.scannedSchemas.includes('public')); assert(!result.scannedSchemas.includes('events')); assert(!result.scannedSchemas.includes('finance'));
  assert.equal(result.referenceChecksPassed, true); assert.deepEqual(result.foreignReferences, []);
  assert.equal(result.storageObjects.length, 2); assert.equal(result.ownedRows['warehouse.fulfillment_orders'].length, 2);
  assert.deepEqual(await snapshot(db), before);
  await t.test('partial resume preflight retains two expected paths but reports only the remaining object', async () => {
    await db.exec('begin');
    try {
      await db.exec(`delete from storage.objects where id='${actor}'`);
      const body = generated.sql.replace('begin isolation level repeatable read read only;', '').replace(/commit;\s*$/, '');
      const partial = (await db.exec(body)).flatMap(r => r.rows).find(r => r.verification).verification;
      assert.deepEqual(partial.expectedPaths, [podPath, mobilePath]);
      assert.deepEqual(partial.storageObjects.map(o => o.path), [mobilePath]);
      assert.equal(partial.referenceChecksPassed, true); assert.deepEqual(partial.foreignReferences, []);
    } finally { await db.exec('rollback'); }
    assert.deepEqual(await snapshot(db), before);
  });
  const probes = [
    ['foreign order', `insert into warehouse.fulfillment_orders(id,proof_of_delivery_evidence_url) values('${otherActor}',${q(podPath)})`],
    ['document', `insert into core.documents values('foreign-document',null,${q(podPath)})`],
    ['action evidence', `insert into private.action_evidence values('${otherActor}',null,${q(podPath)})`],
    ['filename-only JSON', `create table legal.pod_refs(id text,payload jsonb); insert into legal.pod_refs values('foreign',${json({ nested: [podPath.split('/').at(-1)] })})`],
    ['public scalar', `create table public.attachments(id text,path text); insert into public.attachments values('foreign',${q(podPath)})`],
    ['public nested JSON', `create table public.orders(id text,details jsonb); insert into public.orders values('foreign',${json({ nested: { pod: podPath } })})`],
    ['public FK', `create table public.pod_fk(id text,product_id text references warehouse.products); insert into public.pod_fk values('foreign',${q(c.productId)})`],
    ['unknown schema', 'create schema unreviewed_business; create table unreviewed_business.records(id text)'],
    ['unreviewed infrastructure table', 'create schema graphql; create table graphql.records(id text)'],
    ['materialized public reference', `create materialized view public.pod_cache as select ${q(podPath)} as pod`],
    ['unknown Storage', `insert into storage.objects(id,bucket_id,name) values('${orderId}','evidence',${q(`delivery-${orderId}/unexpected.png`)})`],
    ['foreign bucket', `update storage.objects set bucket_id='foreign' where id='${actor}'`],
    ['missing mandatory schema', 'drop schema core cascade'],
    ['foreign FK', `create table core.pod_fk(id text,product_id text references warehouse.products on delete cascade); insert into core.pod_fk values('foreign',${q(c.productId)})`],
  ];
  for (const [name, mutation] of probes) await t.test(name, async () => {
    await db.exec('begin'); await db.exec(mutation);
    // Strip transaction framing only for this local rollback-contained probe.
    const body = generated.sql.replace('begin isolation level repeatable read read only;', '').replace(/commit;\s*$/, '');
    try { await assert.rejects(db.exec(body), /Unhandled|Unreviewed|Unexpected|coverage|ownership|scope/i); }
    finally { await db.exec('rollback'); }
    assert.deepEqual(await snapshot(db), before);
  });
});

test('database cleanup also blocks public references and unclassified schemas without widening deletion', async t => {
  for (const [name, sql] of [
    ['public JSON', `create table public.attachments(id text,data jsonb); insert into public.attachments values('foreign',${json({ pod: podPath })})`],
    ['unknown schema', 'create schema unreviewed_business; create table unreviewed_business.records(id text)'],
  ]) await t.test(name, async t => {
    const db = await setup(t); await db.exec(sql);
    await blocked(db, generateEcommerceCleanup(m, options()).cleanupSql, /Unhandled|Unreviewed/);
  });
});
