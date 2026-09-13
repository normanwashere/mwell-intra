import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const url = new URL('./wms-ecommerce-signoff-live.mjs', import.meta.url);
assert.ok(existsSync(url), 'The offline-importable ecommerce runner must exist');
const api = await import(url.href);
const options = { runId: 'a1000000-0000-4000-8000-000000000001', commit: 'a'.repeat(40), orderDate: '2026-09-13' };
const manifest = () => api.createManifest(options);
const orderId = 'b1000000-0000-4000-8000-000000000001';
const actors = { creator: 'creator', picker: 'picker', releaser: 'releaser' };
const podPath = `delivery-${orderId}/0/c1000000-0000-4000-8000-000000000001.png`;
const fixtureBytes = Buffer.from('synthetic fixture bytes for offline hash verification');
const fixture = { ref: 'desktop1440-synthetic-pod.png', sha256: createHash('sha256').update(fixtureBytes).digest('hex'), byteLength: fixtureBytes.length };
function privateProof(m) {
  return { status: 'verified', runId: m.runId, project: m.project, view: m.cases[0].viewport, orderId,
    bucket: 'evidence', path: podPath, fixture,
    upload: { method: 'POST', requestUrl: `https://${m.project}.supabase.co/storage/v1/object/evidence/${podPath}`,
      bucket: 'evidence', path: podPath, actorId: actors.releaser, httpStatus: 200 },
    publicRead: { method: 'GET', url: `https://${m.project}.supabase.co/storage/v1/object/public/evidence/${podPath}`, anonymous: true, status: 400 },
    downloads: [actors.releaser, actors.picker].map(actorId => ({ actorId, bucket: 'evidence', path: podPath,
      source: 'authenticated-storage-download', sha256: fixture.sha256, byteLength: fixture.byteLength })),
    verifiedAt: '2026-09-13T01:00:00.000Z' };
}
function state(m, status = 'completed') {
  const c = m.cases[0];
  const issued = ['released', 'completed'].includes(status);
  return {
    order: { id: orderId, source: 'ecommerce', delivery_method: 'shipment', external_reference: c.reference,
      source_location_id: c.locationId, source_bin_id: null, order_notes: c.notes, created_by: actors.creator,
      status, shipment_status: status === 'completed' ? 'delivered' : issued ? 'dispatched' : 'awaiting_dispatch',
      lines: [{ productId: c.productId, quantity: 2, pickedQuantity: status === 'received' ? 0 : 2, pickBinId: c.binId }], packaging: [],
      picked_by: actors.picker, packed_by: actors.picker, released_by: actors.releaser,
      courier: c.courier, waybill_number: c.waybill, delivery_link: c.deliveryLink,
      proof_of_delivery_reference: status === 'completed' ? c.podReference : null,
      proof_of_delivery_evidence_url: status === 'completed' ? podPath : null,
      delivered_at: status === 'completed' ? '2026-09-13T01:00:00Z' : null,
      shipment_events: status === 'completed' ? [{ status: 'delivered', actor: actors.releaser, reference: c.podReference, evidenceUrl: podPath }] : [] },
    podFixture: fixture, privateStorageEvidence: status === 'completed' ? privateProof(m) : null,
    products: [{ id: c.productId, sku: c.sku, serialized: false, item_class: 'sellable_sku', attributes: { signoffRun: m.runId, synthetic: true } }],
    stock: [{ id: 'stock', product_id: c.productId, location_id: c.locationId, bin_id: c.binId, lot_id: null, quantity: issued ? 8 : 10 }],
    reservations: status === 'received' ? [] : [{ id: 'reservation', order_id: orderId, product_id: c.productId, location_id: null, bin_id: null, quantity: 2, status: issued ? 'released' : 'active' }],
    movements: issued ? [{ id: 'movement', product_id: c.productId, reference: orderId, type: 'fulfillment_release', quantity: 2,
      from_location_id: c.locationId, from_bin_id: c.binId, to_location_id: null, to_bin_id: null, lot_id: null, serial_number: null, actor: actors.releaser }] : [],
    holds: [], allocations: [], units: [], activity: status === 'completed'
      ? [{ id: 1, module: 'warehouse', entity_type: 'fulfillment_order', entity_id: orderId, action: 'confirm_delivery', actor: actors.releaser }] : [],
  };
}

test('offline preparation freezes values and generates only isolated fixture inserts and read-only cleanup inventory', async () => {
  const m = manifest();
  assert.deepEqual(m, manifest());
  assert.deepEqual(m.cases.map(c => c.viewport), ['desktop1440', 'mobile390']);
  assert(Object.isFrozen(m.cases[0]));
  const sql = api.prepareSql(m);
  assert.deepEqual([...sql.matchAll(/insert into (\w+\.\w+)/g)].map(x => x[1]),
    Array(2).fill(['warehouse.locations', 'warehouse.storage_areas', 'warehouse.products', 'warehouse.stock_levels']).flat());
  assert.match(sql, /sellable_sku/);
  assert.match(sql, new RegExp(m.runId));
  assert.doesNotMatch(sql, /\b(update|delete|truncate|on conflict|auth\.|grant|disable trigger)\b/i);
  const inventory = api.cleanupInventorySql(m);
  assert.match(inventory, /begin read only/);
  assert.match(inventory, /storage.objects/);
  assert.match(inventory, /command_log/);
  assert.match(inventory, /pg_constraint/);
  assert.doesNotMatch(inventory, /\b(delete from|truncate|update warehouse)\b/i);
  const folder = path.join(await mkdtemp(path.join(tmpdir(), 'wms-ecommerce-')), 'prepared');
  await api.prepare(folder, options);
  assert.deepEqual((await readdir(folder)).sort(), ['cleanup-inventory.sql', 'manifest.json', 'prepare.sql']);
  assert.deepEqual(JSON.parse(await readFile(path.join(folder, 'manifest.json'))), m);
  await assert.rejects(api.prepare(folder, options), /exist/i);
});

test('manifest rejects cross-target, SQL injection and changes to frozen fixture/intake values', () => {
  for (const mutate of [m => { m.runId = "x';--"; }, m => { m.commit = 'main'; }, m => { m.project = 'production'; },
    m => { m.cases[0].productId += '-other'; }, m => { m.cases[0].openingQuantity = 99; },
    m => { m.cases[0].podReference = 'other'; }, m => { m.orderDate = '2026-02-30'; },
    m => { m.cases[1] = m.cases[0]; }]) {
    const m = structuredClone(manifest()); mutate(m);
    assert.throws(() => api.validateManifest(m));
  }
  const good = { status: 'ok', commit: options.commit, deployment: { appEnv: 'uat', supabaseProjectRef: manifest().project } };
  api.assertHealth(good, manifest());
  assert.throws(() => api.assertHealth({ ...good, commit: 'b'.repeat(40) }, manifest()), /build/i);
  assert.throws(() => api.assertRunPermission(manifest(), {}), /uat|mutations/i);
});

test('inventory reconciliation rejects incorrect bin, duplicate issue, foreign reservations and fake completion', () => {
  const m = manifest(); const c = m.cases[0];
  assert.deepEqual(api.reconcile(m, c, state(m), actors), { onHand: 8, reserved: 0, held: 0, available: 8, issued: 2 });
  for (const mutate of [s => { s.stock[0].bin_id = 'foreign'; }, s => { s.movements.push(s.movements[0]); },
    s => { s.reservations[0].order_id = m.runId; }, s => { s.reservations[0].quantity = 3; },
    s => { s.order.released_by = actors.picker; }, s => { s.order.shipment_status = 'dispatched'; },
    s => { s.order.proof_of_delivery_evidence_url = null; }, s => { s.products[0].attributes.signoffRun = m.runId.slice(0, 8); },
    s => { s.stock[0].quantity = 9; }, s => { s.holds.push({ quantity: 1 }); },
    s => { s.activity = []; }, s => { s.order.parent_order_id = options.runId; },
    s => { s.order.lines.push({ productId: 'other', quantity: 1 }); }]) {
    const s = state(m); mutate(s);
    assert.throws(() => api.reconcile(m, c, s, actors));
  }
  const allocated = state(m, 'allocated');
  assert.equal(api.reconcile(m, c, allocated, actors).available, 8);
});

test('UI payload ownership blocks foreign writes and accepts only the real shipment RPC for completion', () => {
  const c = manifest().cases[0];
  const payload = { order_id: orderId, action: 'confirm_delivery', idempotency_key: 'ui-frozen-key',
    tracking_reference: c.podReference, evidence_url: podPath, failure_reason: null };
  api.assertUiPayload(c, orderId, 'update_shipment_tracking', payload);
  assert.throws(() => api.assertUiPayload(c, orderId, 'advance_fulfillment_order', payload));
  assert.throws(() => api.assertUiPayload(c, orderId, 'update_shipment_tracking', { ...payload, order_id: options.runId }));
  assert.throws(() => api.assertUiPayload(c, orderId, 'update_shipment_tracking', { ...payload, evidence_url: 'shared/proof.png' }));
  assert.throws(() => api.assertUiPayload(c, orderId, 'advance_fulfillment_order', { ...payload, action: 'confirm_pack', packaging: [{ productId: 'real-stock', quantity: 1 }] }));
});

test('fresh POD rejects inline, noncanonical and foreign Storage paths at the UI boundary', () => {
  const c = manifest().cases[0];
  for (const evidence_url of ['data:image/png;base64,YQ==', 'https://example.invalid/proof.png',
    `evidence/${podPath}`, podPath.replace(orderId, options.runId), podPath.replace('/0/', '/1/'),
    `delivery-${orderId}/0/proof.png`, podPath.replace('/0/', '/../')]) {
    assert.throws(() => api.assertUiPayload(c, orderId, 'update_shipment_tracking', {
      order_id: orderId, action: 'confirm_delivery', idempotency_key: 'original-key', tracking_reference: c.podReference, evidence_url,
    }), /POD|owned/);
  }
});

test('completed reconciliation refuses unverified private Storage, upload mismatch and unverified hashes', () => {
  const m = manifest(); const c = m.cases[0];
  for (const mutate of [s => { s.privateStorageEvidence = null; }, s => { s.privateStorageEvidence.status = 'attempted'; },
    s => { s.order.proof_of_delivery_evidence_url = 'data:image/png;base64,YQ=='; },
    s => { s.privateStorageEvidence.path = podPath.replace(orderId, options.runId); },
    s => { s.privateStorageEvidence.upload.bucket = 'public'; }, s => { s.privateStorageEvidence.upload.httpStatus = 500; },
    s => { s.privateStorageEvidence.upload.requestUrl += '?other'; }, s => { s.privateStorageEvidence.upload.actorId = actors.creator; },
    s => { s.privateStorageEvidence.downloads[0].sha256 = '0'.repeat(64); },
    s => { s.privateStorageEvidence.downloads[0].sha256 = ''; }, s => { s.privateStorageEvidence.downloads[1].actorId = actors.releaser; },
    s => { s.privateStorageEvidence.fixture.sha256 = '1'.repeat(64); },
    s => { s.podFixture = null; },
    s => { s.privateStorageEvidence.downloads = []; }, s => { s.privateStorageEvidence.publicRead.status = 200; }]) {
    const s = structuredClone(state(m)); mutate(s);
    assert.throws(() => api.reconcile(m, c, s, actors));
  }
});

test('durable POD verifier downloads saved bytes as both authorized actors and hashes the actual fixture', async () => {
  const m = manifest(); const c = m.cases[0]; const requests = [];
  const input = { manifest: m, c, order: state(m).order, upload: privateProof(m).upload,
    fixtureBytes, fixtureRef: fixture.ref, actors,
    download: async (actorId, bucket, path) => { requests.push({ actorId, bucket, path }); return fixtureBytes; },
    probePublic: async url => { assert.equal(url, privateProof(m).publicRead.url); return 400; } };
  const proof = await api.verifyPrivateStorageEvidence(input);
  assert.deepEqual(proof.fixture, fixture);
  assert.deepEqual(requests, [actors.releaser, actors.picker].map(actorId => ({ actorId, bucket: 'evidence', path: podPath })));
  assert(proof.downloads.every(d => d.sha256 === fixture.sha256));
  assert.equal(proof.status, 'verified');
  api.reconcile(m, c, { ...state(m), privateStorageEvidence: proof }, actors);
  assert(Object.isFrozen(proof.downloads[0]));
  await assert.rejects(api.verifyPrivateStorageEvidence({ ...input, download: async () => Buffer.from('changed') }), /hash|bytes|SHA/i);
  const changedBytes = Buffer.from(fixtureBytes); changedBytes[0] ^= 1;
  await assert.rejects(api.verifyPrivateStorageEvidence({ ...input, download: async () => changedBytes }), /SHA256/);
  await assert.rejects(api.verifyPrivateStorageEvidence({ ...input, probePublic: async () => 200 }), /public|private/i);
  await assert.rejects(api.verifyPrivateStorageEvidence({ ...input, probePublic: async () => 503 }), /public|private/i);
  await assert.rejects(api.verifyPrivateStorageEvidence({ ...input, download: async () => { throw new Error('Access denied'); } }), /Access denied/);
  let accessed = false;
  await assert.rejects(api.verifyPrivateStorageEvidence({ ...input, upload: { ...input.upload, path: 'foreign' },
    download: async () => { accessed = true; return fixtureBytes; } }), /upload|path/i);
  assert.equal(accessed, false);
});

test('UI intake must match frozen synthetic fields and cannot create a second or mixed-stock order', () => {
  const c = manifest().cases[0];
  const p = { idempotency_key: 'create-ui-key', order_id: orderId, source: 'ecommerce', external_reference: c.reference,
    source_location_id: c.locationId, order_notes: c.notes, customer_name: c.customerName, customer_contact: c.customerContact,
    ecommerce_channel: c.channel, payment_method: c.paymentMethod, payment_status: c.paymentStatus, delivery_address: c.address,
    lines: [{ productId: c.productId, quantity: c.requestedQuantity, pickedSerialNumbers: [] }] };
  const frozen = api.assertUiPayload(c, undefined, 'create_fulfillment_order', p);
  assert(Object.isFrozen(frozen.lines[0]));
  assert.throws(() => api.assertUiPayload(c, options.runId, 'create_fulfillment_order', p));
  for (const mutate of [v => { v.lines[0].productId = 'shared'; }, v => { v.source_location_id = 'shared'; },
    v => { v.customer_name = 'Not synthetic'; }, v => { v.lines[0].quantity = 1; }, v => { v.event_id = options.runId; }]) {
    const changed = structuredClone(p); mutate(changed);
    assert.throws(() => api.assertUiPayload(c, undefined, 'create_fulfillment_order', changed));
  }
});

test('read-only POST RPC allowlist permits capability/bootstrap reads, never authority or arbitrary RPCs', () => {
  assert.equal(api.isReviewedReadRpc('core', 'my_capability_snapshot'), true);
  assert.equal(api.isReviewedReadRpc('warehouse', 'department_request_actor_names'), true);
  assert.equal(api.isReviewedReadRpc('warehouse', 'list_stock_change_requests'), true);
  assert.equal(api.isReviewedReadRpc('warehouse', 'create_fulfillment_order'), false);
  assert.equal(api.isReviewedReadRpc('core', 'assign_role'), false);
  assert.equal(api.isReviewedReadRpc('other', 'my_capability_snapshot'), false);
});

test('cleanup inventory retains attempted UI order IDs even if creation rolled back, and rejects foreign bindings', () => {
  const m = manifest(); const c = m.cases[0];
  const binding = { view: c.viewport, orderId, reference: c.reference, productId: c.productId };
  assert.match(api.cleanupInventorySql(m, [binding]), new RegExp(orderId));
  assert.throws(() => api.cleanupInventorySql(m, [{ ...binding, productId: 'foreign' }]));
  assert.throws(() => api.cleanupInventorySql(m, [{ ...binding, orderId: "bad';--" }]));
});

test('negative probe requires the expected denial AND an unchanged persisted snapshot', async () => {
  let current = { order: { status: 'ready' }, stock: 10 };
  const read = async () => structuredClone(current);
  await api.assertDeniedUnchanged(read, async () => ({ error: { message: 'second warehouse operator' } }), /second warehouse/);
  await assert.rejects(api.assertDeniedUnchanged(read, async () => ({ error: null }), /denied/));
  await assert.rejects(api.assertDeniedUnchanged(read, async () => {
    current.stock--; return { error: { message: 'denied' } };
  }, /denied/), /mutated/i);
});

test('tracking replay reuses the frozen key/payload and rejects additional events or inventory effects', async () => {
  const payload = { order_id: orderId, action: 'confirm_delivery', idempotency_key: 'original-ui-key', evidence_url: 'frozen' };
  let current = { order: { id: orderId, shipment_events: ['delivered'] }, movements: ['one'] };
  const read = async () => structuredClone(current);
  const frozen = structuredClone(payload);
  await api.assertReplayUnchanged(read, async actual => {
    assert.deepEqual(actual, frozen); return { data: current.order, error: null };
  }, payload, current.order);
  assert.deepEqual(payload, frozen);
  await assert.rejects(api.assertReplayUnchanged(read, async () => {
    current.order.shipment_events.push('delivered'); return { data: current.order, error: null };
  }, payload, structuredClone(current.order)), /replay|mutated/i);
});

test('run without explicit permission stops before any network or browser access', async () => {
  const folder = path.join(await mkdtemp(path.join(tmpdir(), 'wms-ecommerce-guard-')), 'prepared');
  await api.prepare(folder, options);
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = () => { called = true; throw new Error('Network forbidden in harness'); };
  try { await assert.rejects(api.run(folder, {}), /uat/); } finally { globalThis.fetch = originalFetch; }
  assert.equal(called, false);
  assert.deepEqual((await readdir(folder)).sort(), ['cleanup-inventory.sql', 'manifest.json', 'prepare.sql']);
});

test('generated SQL executes only in local PGlite: isolated fixture inserts, collision rollback and orphan discovery', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create schema warehouse; create schema core; create schema private; create schema storage;
    create table warehouse.locations(id text primary key,name text,type text);
    create table warehouse.storage_areas(id text primary key,location_id text references warehouse.locations,code text,label text,zone text);
    create table warehouse.products(id text primary key,sku text,name text,category text,serialized boolean,attributes jsonb,unit_cost numeric,item_class text);
    create table warehouse.stock_levels(id int generated always as identity,product_id text references warehouse.products,location_id text,bin_id text,quantity int);
    create table warehouse.fulfillment_orders(id uuid primary key,external_reference text);
    create table warehouse.fulfillment_reservations(id uuid,order_id uuid,product_id text);
    create table warehouse.movements(id text,product_id text,reference text);
    create table warehouse.inventory_holds(id uuid,product_id text);
    create table warehouse.allocations(id text,product_id text);
    create table warehouse.inventory_units(id text,product_id text);
    create table core.activity_log(id bigint,entity_id uuid);
    create table core.notifications(id text,entity_id text);
    create table core.documents(id text,entity_id text);
    create table private.action_evidence(id uuid,source_id uuid);
    create table warehouse.command_log(id uuid,response jsonb,idempotency_key text);
    create table storage.objects(id uuid,bucket_id text,name text);`);
  const m = manifest(); const c = m.cases[0];
  await db.exec(api.prepareSql(m));
  assert.equal((await db.query('select sum(quantity)::int as quantity from warehouse.stock_levels')).rows[0].quantity, 20);
  await assert.rejects(db.exec(api.prepareSql(m)), /duplicate/i); await db.exec('rollback');
  assert.equal((await db.query('select count(*)::int as n from warehouse.products')).rows[0].n, 2);
  await db.exec(`insert into storage.objects values('${orderId}','evidence','delivery-${orderId}/0/orphan.png')`);
  const result = await db.exec(api.cleanupInventorySql(m, [{ view: c.viewport, orderId, reference: c.reference, productId: c.productId }]));
  const inventory = result.find(r => r.rows?.[0]?.cleanup_inventory).rows[0].cleanup_inventory;
  assert.equal(inventory.storage.length, 1); assert.equal(inventory.orders, null);
  assert.equal(inventory.allResidueVerified, false);
  assert.equal(inventory.products.length, 2);
});
