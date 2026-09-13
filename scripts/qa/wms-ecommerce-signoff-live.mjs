import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const TARGET = Object.freeze({ origin: 'https://mwell-intra-uat.vercel.app', project: 'kkoitlvydytdhlpxhuah' });
export const ECOMMERCE_ACTORS = Object.freeze({ creator: 'operations_associate', picker: 'operations_associate', releaser: 'operations_lead' });
export function requiredLiveCapabilities(role) {
  if (role === 'operations_associate') return ['request_fulfillment', 'reserve_allocate', 'issue_items'];
  if (role === 'operations_lead') return ['issue_items'];
  return [];
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const VIEWS = ['desktop1440', 'mobile390'];
const sqlValue = value => `'${String(value).replaceAll("'", "''")}'`;
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

export async function captureCheckpointViewport(page, outputPath) {
  const geometry = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, contentWidth: document.documentElement.scrollWidth }));
  const bytes = await page.screenshot({ path: outputPath, type: 'png', fullPage: false, scale: 'css' });
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Checkpoint must be a PNG');
  assert.equal(bytes.readUInt32BE(16), geometry.width, 'Checkpoint width differs from the working viewport');
  assert.equal(bytes.readUInt32BE(20), geometry.height, 'Checkpoint height differs from the working viewport');
  return geometry;
}

export function createManifest({ commit, runId = randomUUID(), orderDate = new Date().toISOString().slice(0, 10) } = {}) {
  assert(UUID.test(runId), 'Canonical run UUID required');
  assert(typeof commit === 'string' && /^[a-f0-9]{40}$/.test(commit), 'Explicit deployed commit SHA required');
  assert(typeof orderDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(orderDate)
    && Number.isFinite(Date.parse(orderDate)) && new Date(orderDate).toISOString().slice(0, 10) === orderDate, 'Invalid frozen order date');
  return freeze({ version: 1, kind: 'wms-ecommerce-shipment', runId, ...TARGET, commit, orderDate,
    fixturePurpose: 'Synthetic nonserialized merchandise classified sellable_sku for ecommerce eligibility. Opening stock is not receiving evidence.',
    cases: VIEWS.map(viewport => {
      const id = `wms-ecom-${runId.slice(0, 8)}-${viewport}`;
      return { viewport, productId: id, productName: `Synthetic ecommerce ${viewport}`, sku: id.toUpperCase(),
        locationId: `${id}-loc`, binId: `${id}-bin`, binCode: id.toUpperCase(), openingQuantity: 10, requestedQuantity: 2,
        reference: `WMS-ECOM-${runId}-${viewport}`, notes: `Synthetic ecommerce signoff ${runId} ${viewport}; no physical shipment.`,
        courier: 'Synthetic UAT courier', waybill: `WAYBILL-${runId}-${viewport}`,
        deliveryLink: `https://example.invalid/wms/${runId}/${viewport}`, podReference: `POD-${runId}-${viewport}`,
        customerName: 'Synthetic UAT recipient', customerContact: '00000000000',
        address: { addressLine: 'SYNTHETIC UAT ONLY - DO NOT SHIP', city: 'Makati', province: 'Metro Manila', postalCode: '1200' },
        failureReason: `Synthetic failed delivery ${runId} ${viewport}`, channel: 'Eshop', paymentMethod: 'cash', paymentStatus: 'cod' };
    }) });
}

export function validateManifest(input) {
  const expected = createManifest({ commit: input?.commit, runId: input?.runId, orderDate: input?.orderDate });
  assert.deepEqual(input, expected, 'Manifest target or frozen values changed');
  return expected;
}

export function assertHealth(body, m) {
  assert.equal(body.status, 'ok');
  assert.equal(body.deployment?.appEnv, 'uat');
  assert.equal(body.deployment?.supabaseProjectRef, TARGET.project);
  assert.equal(body.commit, m.commit, 'UAT build differs from frozen manifest');
}

export function assertRunPermission(m, env) {
  validateManifest(m);
  assert.equal(env.APP_ENV, 'uat', 'APP_ENV must be uat');
  assert.equal(env.AUDIT_MUTATIONS, 'true', 'Explicit audit mutations permission required');
  assert.equal(env.WMS_ECOMMERCE_RUN_ID, m.runId, 'Explicit run UUID confirmation required');
  assert(env.AUDIT_PASSWORD, 'AUDIT_PASSWORD must be supplied securely');
}

export function prepareSql(input) {
  const m = validateManifest(input);
  return `-- OFFLINE ONLY: independently verify UAT ${m.project} and build ${m.commit} before execution.
-- Unique inserts only. No authority changes; no business orders or evidence are seeded.
begin;
${m.cases.map(c => `insert into warehouse.locations(id,name,type) values(${sqlValue(c.locationId)},${sqlValue(c.productName)},'warehouse');
insert into warehouse.storage_areas(id,location_id,code,label,zone) values(${sqlValue(c.binId)},${sqlValue(c.locationId)},${sqlValue(c.binCode)},${sqlValue(c.productName)},'WMS-SIGNOFF');
insert into warehouse.products(id,sku,name,category,serialized,attributes,unit_cost,item_class) values(${sqlValue(c.productId)},${sqlValue(c.sku)},${sqlValue(c.productName)},'merchandise',false,${sqlValue(JSON.stringify({ signoffRun: m.runId, synthetic: true }))}::jsonb,1,'sellable_sku');
insert into warehouse.stock_levels(product_id,location_id,bin_id,quantity) values(${sqlValue(c.productId)},${sqlValue(c.locationId)},${sqlValue(c.binId)},${c.openingQuantity});`).join('\n')}
commit;
`;
}

export function cleanupInventorySql(input, bindings = []) {
  const m = validateManifest(input);
  assert(Array.isArray(bindings) && bindings.length <= m.cases.length, 'Invalid cleanup bindings');
  const seen = new Set();
  for (const binding of bindings) {
    const c = m.cases.find(c => c.viewport === binding.view);
    assert(c && binding.reference === c.reference && binding.productId === c.productId && UUID.test(binding.orderId), 'Foreign cleanup binding');
    assert(!seen.has(binding.view) && !seen.has(binding.orderId), 'Duplicate cleanup binding');
    seen.add(binding.view); seen.add(binding.orderId);
  }
  const ids = key => m.cases.map(c => sqlValue(c[key])).join(',');
  // This is a discovery inventory, NOT deletion authorization. JSON and unknown
  // FK branches, evidence registrations and orphan objects need independent review.
  return `-- UAT ${m.project}; run ${m.runId}. Read-only cleanup inventory, NOT zero-residue certification.
-- Orders have UI-generated IDs. Archive attempt command captures and verify full signoffRun product proof.
-- Never reuse the department cleanup generator for this shipment manifest.
begin read only;
set local row_security = off;
with owned_orders as (
 select id from warehouse.fulfillment_orders where external_reference in (${ids('reference')})
 ${bindings.map(b => `union select '${b.orderId}'::uuid`).join('\n ')}
), entities as (
 select id::text from owned_orders union select unnest(array[${ids('productId')},${ids('locationId')},${ids('binId')}])
)
select jsonb_build_object(
 'runId', '${m.runId}', 'allResidueVerified', false,
 'products', (select jsonb_agg(to_jsonb(r)) from warehouse.products r where r.id in (${ids('productId')}) or r.attributes->>'signoffRun'='${m.runId}'),
 'locations', (select jsonb_agg(to_jsonb(r)) from warehouse.locations r where r.id in (${ids('locationId')})),
 'bins', (select jsonb_agg(to_jsonb(r)) from warehouse.storage_areas r where r.id in (${ids('binId')}) or r.location_id in (${ids('locationId')})),
 'orders', (select jsonb_agg(to_jsonb(r)) from warehouse.fulfillment_orders r where r.id in (select id from owned_orders)),
 'reservations', (select jsonb_agg(to_jsonb(r)) from warehouse.fulfillment_reservations r where r.order_id in (select id from owned_orders) or r.product_id in (${ids('productId')})),
 'stock', (select jsonb_agg(to_jsonb(r)) from warehouse.stock_levels r where r.product_id in (${ids('productId')}) or r.location_id in (${ids('locationId')}) or r.bin_id in (${ids('binId')})),
 'movements', (select jsonb_agg(to_jsonb(r)) from warehouse.movements r where r.product_id in (${ids('productId')}) or r.reference in (select id::text from owned_orders)),
 'holds', (select jsonb_agg(to_jsonb(r)) from warehouse.inventory_holds r where r.product_id in (${ids('productId')})),
 'allocations', (select jsonb_agg(to_jsonb(r)) from warehouse.allocations r where r.product_id in (${ids('productId')})),
 'units', (select jsonb_agg(to_jsonb(r)) from warehouse.inventory_units r where r.product_id in (${ids('productId')})),
 'activity', (select jsonb_agg(to_jsonb(r)) from core.activity_log r where r.entity_id::text in (select id from entities)),
 'notifications', (select jsonb_agg(to_jsonb(r)) from core.notifications r where r.entity_id::text in (select id from entities)),
 'commands', (select jsonb_agg(to_jsonb(r)) from warehouse.command_log r where r.response->>'id' in (select id::text from owned_orders)
   or left(r.idempotency_key,${m.runId.length + 1})='${m.runId}-'),
 'documents', (select jsonb_agg(to_jsonb(r)) from core.documents r where r.entity_id::text in (select id from entities)),
 'actionEvidence', (select jsonb_agg(to_jsonb(r)) from private.action_evidence r where r.source_id::text in (select id from entities)),
 'storage', (select jsonb_agg(jsonb_build_object('id',r.id,'bucket',r.bucket_id,'path',r.name)) from storage.objects r
   where r.bucket_id='evidence' and exists(select 1 from owned_orders o where starts_with(r.name,'delivery-'||o.id::text||'/') or starts_with(r.name,'fulfillment/'||o.id::text||'/'))),
 'inboundForeignKeys', (select jsonb_agg(jsonb_build_object('name',conname,'child',conrelid::regclass::text,'parent',confrelid::regclass::text,'definition',pg_get_constraintdef(oid)))
   from pg_catalog.pg_constraint where contype='f' and confrelid in ('warehouse.products'::regclass,'warehouse.locations'::regclass,'warehouse.storage_areas'::regclass,'warehouse.fulfillment_orders'::regclass))
) as cleanup_inventory;
commit;
`;
}

export async function prepare(folder, options) {
  const m = createManifest(options);
  await mkdir(path.dirname(path.resolve(folder)), { recursive: true });
  await mkdir(folder);
  for (const [name, body] of [['manifest.json', JSON.stringify(m, null, 2)], ['prepare.sql', prepareSql(m)], ['cleanup-inventory.sql', cleanupInventorySql(m)]]) {
    await writeFile(path.join(folder, name), body, { flag: 'wx' });
  }
  return m;
}

function assertOwnedOrder(c, order) {
  assert(order && UUID.test(order.id), 'Exactly one owned order required');
  for (const [key, value] of Object.entries({ source: 'ecommerce', delivery_method: 'shipment', external_reference: c.reference,
    source_location_id: c.locationId, order_notes: c.notes })) assert.equal(order[key], value, `Owned order ${key}`);
  assert(order.source_bin_id == null || order.source_bin_id === c.binId);
  assert.equal(order.lines.length, 1);
  assert.equal(order.lines[0].productId, c.productId);
  assert.equal(order.lines[0].quantity, c.requestedQuantity);
  assert.deepEqual(order.packaging, [], 'No shared packaging stock is authorized');
  for (const key of ['event_id', 'third_party_location_id', 'parent_order_id']) assert(order[key] == null, `Unexpected order lineage: ${key}`);
}

export function reconcile(m, c, s, actors) {
  assert.equal(s.products.length, 1);
  const product = s.products[0];
  assert.equal(product.id, c.productId); assert.equal(product.sku, c.sku);
  assert.equal(product.attributes?.signoffRun, m.runId); assert.equal(product.attributes.synthetic, true);
  assert.equal(product.serialized, false); assert.equal(product.item_class, 'sellable_sku');
  assert.equal(s.holds.length, 0, 'Unexpected hold; do not weaken quality controls');
  assert.equal(s.allocations.length, 0, 'Unexpected event allocation');
  assert.equal(s.units.length, 0, 'Unexpected serialized units');
  assert.equal(s.stock.length, 1, 'Exactly one isolated stock row required');
  const level = s.stock[0];
  assert.equal(level.product_id, c.productId); assert.equal(level.location_id, c.locationId); assert.equal(level.bin_id, c.binId);
  assert.equal(level.lot_id, null);
  const o = s.order;
  if (o) {
    assertOwnedOrder(c, o); assert.equal(o.created_by, actors.creator);
    assert(['received', 'allocated', 'picking', 'packing', 'ready', 'released', 'completed'].includes(o.status), 'Unreviewed order state');
  }
  const issued = o && ['released', 'completed'].includes(o.status);
  const reserved = o && ['allocated', 'picking', 'packing', 'ready'].includes(o.status);
  assert.equal(level.quantity, c.openingQuantity - (issued ? c.requestedQuantity : 0));
  assert.equal(s.reservations.length, reserved || issued ? 1 : 0);
  for (const r of s.reservations) {
    assert.equal(r.order_id, o.id); assert.equal(r.product_id, c.productId); assert.equal(r.quantity, c.requestedQuantity);
    assert(r.location_id == null || r.location_id === c.locationId);
    assert(r.bin_id == null || r.bin_id === c.binId);
    assert.equal(r.status, issued ? 'released' : 'active');
  }
  assert.equal(s.movements.length, issued ? 1 : 0, 'Exactly one issue, never duplicate inventory consumption');
  if (issued) assert(typeof actors.releaserLabel === 'string' && actors.releaserLabel.length > 0, 'Server-derived release actor label required');
  for (const movement of s.movements) {
    for (const [key, value] of Object.entries({ product_id: c.productId, reference: o.id, type: 'fulfillment_release', quantity: c.requestedQuantity,
      from_location_id: c.locationId, from_bin_id: c.binId, to_location_id: null, to_bin_id: null, lot_id: null, serial_number: null, actor: actors.releaserLabel })) assert.equal(movement[key], value, `Movement ${key}`);
  }
  if (o && ['packing', 'ready', 'released', 'completed'].includes(o.status)) {
    assert.equal(o.picked_by, actors.picker); assert.equal(o.lines[0].pickBinId, c.binId); assert.equal(o.lines[0].pickedQuantity, c.requestedQuantity);
  }
  if (o && ['ready', 'released', 'completed'].includes(o.status)) {
    assert.equal(o.packed_by, actors.picker); assert.equal(o.courier, c.courier);
    assert.equal(o.waybill_number, c.waybill); assert.equal(o.delivery_link, c.deliveryLink);
  }
  if (issued) { assert.equal(o.released_by, actors.releaser); assert.notEqual(o.packed_by, o.released_by); }
  if (o?.status === 'completed') {
    assert.equal(o.shipment_status, 'delivered'); assert.equal(o.proof_of_delivery_reference, c.podReference);
    assert(o.proof_of_delivery_evidence_url && o.delivered_at, 'Persisted POD evidence and delivery timestamp required');
    assertPrivateStorageProof(m, c, o, s.privateStorageEvidence, s.podFixture, actors);
    assert.equal(o.shipment_events.filter(e => e.status === 'delivered').length, 1);
    const event = o.shipment_events.find(e => e.status === 'delivered');
    assert.equal(event.actor, actors.releaserLabel); assert.equal(event.reference, c.podReference); assert.equal(event.evidenceUrl, o.proof_of_delivery_evidence_url);
    const deliveryAudit = s.activity.filter(row => row.action === 'confirm_delivery');
    assert.equal(deliveryAudit.length, 1, 'Exactly one persisted delivery audit required');
    for (const [key, value] of Object.entries({ module: 'warehouse', entity_type: 'fulfillment_order', entity_id: o.id, actor: actors.releaser })) {
      assert.equal(deliveryAudit[0][key], value, `Delivery audit ${key}`);
    }
  }
  const quantity = reserved ? c.requestedQuantity : 0;
  return { onHand: level.quantity, reserved: quantity, held: 0, available: level.quantity - quantity, issued: issued ? c.requestedQuantity : 0 };
}

function ownedEvidence(value, orderId) {
  if (!UUID.test(orderId) || typeof value !== 'string') return false;
  const parts = value.split('/');
  return parts.length === 3 && parts[0] === `delivery-${orderId}` && parts[1] === '0'
    && parts[2].endsWith('.png') && UUID.test(parts[2].slice(0, -4));
}

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const storageUrl = (objectPath, isPublic = false) =>
  `https://${TARGET.project}.supabase.co/storage/v1/object/${isPublic ? 'public/' : ''}evidence/${objectPath}`;

function assertUploadEvidence(orderId, objectPath, upload, actorId) {
  assert(ownedEvidence(objectPath, orderId), 'POD must be the exact owned private Storage path');
  assert(upload, 'Observed POD upload required');
  for (const [key, value] of Object.entries({ method: 'POST', requestUrl: storageUrl(objectPath), bucket: 'evidence', path: objectPath, actorId })) {
    assert.equal(upload[key], value, `POD upload ${key} mismatch`);
  }
  assert(Number.isInteger(upload.httpStatus) && upload.httpStatus >= 200 && upload.httpStatus < 300, 'Successful POD upload response required');
}

function assertPrivateStorageProof(m, c, order, evidence, fixture, actors) {
  const objectPath = order.proof_of_delivery_evidence_url;
  assert(ownedEvidence(objectPath, order.id), 'Fresh POD cannot use inline or foreign evidence');
  assert(evidence && evidence.status === 'verified', 'Verified private Storage evidence required');
  for (const [key, value] of Object.entries({ runId: m.runId, project: m.project, view: c.viewport, orderId: order.id, bucket: 'evidence', path: objectPath })) {
    assert.equal(evidence[key], value, `Private Storage ${key} mismatch`);
  }
  assert(fixture?.ref === `${c.viewport}-synthetic-pod.png` && /^[a-f0-9]{64}$/.test(fixture.sha256)
    && Number.isSafeInteger(fixture.byteLength) && fixture.byteLength > 0, 'Actual synthetic fixture SHA256 required');
  assert.deepEqual(evidence.fixture, fixture, 'Private Storage fixture hash mismatch');
  assertUploadEvidence(order.id, objectPath, evidence.upload, actors.releaser);
  assert.equal(evidence.publicRead?.method, 'GET');
  assert.equal(evidence.publicRead?.url, storageUrl(objectPath, true));
  assert.equal(evidence.publicRead?.anonymous, true);
  assert([400, 401, 403, 404].includes(evidence.publicRead?.status), 'Private Storage requires an observed public-read denial, not success or an outage');
  assert(actors.releaser && actors.picker && actors.releaser !== actors.picker, 'Independent authenticated download actors required');
  assert.deepEqual(evidence.downloads?.map(d => d.actorId), [actors.releaser, actors.picker], 'Both authorized Storage downloads required');
  for (const download of evidence.downloads) {
    for (const [key, value] of Object.entries({ bucket: 'evidence', path: objectPath, source: 'authenticated-storage-download', sha256: fixture.sha256, byteLength: fixture.byteLength })) {
      assert.equal(download[key], value, `Downloaded POD ${key} mismatch`);
    }
  }
  assert(typeof evidence.verifiedAt === 'string' && Number.isFinite(Date.parse(evidence.verifiedAt)), 'Storage verification timestamp required');
}

// Adapters return real authenticated download bytes and an anonymous public GET
// status in the live runner. Tests inject these adapters without network access.
export async function verifyPrivateStorageEvidence({ manifest, c, order, upload, fixtureBytes, fixtureRef, actors, download, probePublic }) {
  const m = validateManifest(manifest);
  assert.deepEqual(c, m.cases.find(item => item.viewport === c.viewport));
  assertOwnedOrder(c, order);
  assert.equal(order.status, 'completed'); assert.equal(order.shipment_status, 'delivered');
  assert.equal(order.proof_of_delivery_reference, c.podReference);
  const objectPath = order.proof_of_delivery_evidence_url;
  assertUploadEvidence(order.id, objectPath, upload, actors.releaser);
  assert(fixtureBytes instanceof Uint8Array && fixtureBytes.byteLength > 0, 'Actual fixture bytes required');
  assert.equal(fixtureRef, `${c.viewport}-synthetic-pod.png`);
  assert(actors.releaser && actors.picker && actors.releaser !== actors.picker);
  const fixture = { ref: fixtureRef, sha256: sha256(fixtureBytes), byteLength: fixtureBytes.byteLength };
  const evidence = { status: 'verified', runId: m.runId, project: m.project, view: c.viewport, orderId: order.id,
    bucket: 'evidence', path: objectPath, fixture, upload: structuredClone(upload), downloads: [] };
  for (const actorId of [actors.releaser, actors.picker]) {
    const bytes = await download(actorId, 'evidence', objectPath);
    assert(bytes instanceof Uint8Array && bytes.byteLength === fixture.byteLength, 'Downloaded POD bytes differ from synthetic fixture');
    const hash = sha256(bytes);
    assert.equal(hash, fixture.sha256, 'Downloaded POD SHA256 differs from synthetic fixture');
    evidence.downloads.push({ actorId, bucket: 'evidence', path: objectPath, source: 'authenticated-storage-download', sha256: hash, byteLength: bytes.byteLength });
  }
  const publicUrl = storageUrl(objectPath, true);
  evidence.publicRead = { method: 'GET', url: publicUrl, anonymous: true, status: await probePublic(publicUrl) };
  evidence.verifiedAt = new Date().toISOString();
  assertPrivateStorageProof(m, c, order, evidence, fixture, actors);
  return freeze(evidence);
}

export function isReviewedReadRpc(schema, name) {
  return (schema === 'core' && name === 'my_capability_snapshot')
    || (schema === 'learning' && name === 'my_learning_snapshot')
    || (schema === 'warehouse' && ['department_request_actor_names', 'list_stock_change_requests'].includes(name));
}

export function isOwnLearningBootstrap(schema, name, body) {
  return schema === 'learning' && ['resolve_assignments', 'evaluate_certifications'].includes(name)
    && body !== null && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 0;
}

export function assertUiPayload(c, orderId, name, p) {
  assert(p && typeof p.idempotency_key === 'string' && p.idempotency_key.length > 0 && p.idempotency_key.length < 300);
  assert(UUID.test(p.order_id), 'UI order UUID required');
  if (name === 'create_fulfillment_order') {
    assert(!orderId || p.order_id === orderId, 'A second UI order is not authorized');
    for (const [key, value] of Object.entries({ source: 'ecommerce', external_reference: c.reference, source_location_id: c.locationId,
      order_notes: c.notes, customer_name: c.customerName, customer_contact: c.customerContact,
      ecommerce_channel: c.channel, payment_method: c.paymentMethod, payment_status: c.paymentStatus })) assert.equal(p[key], value, `Intake ${key}`);
    assert.deepEqual(p.delivery_address, c.address);
    for (const key of ['customer_email', 'event_id', 'third_party_location_id', 'source_bin_id']) assert(p[key] == null, `Unexpected ${key}`);
    assert.equal(p.lines.length, 1); assert.equal(p.lines[0].productId, c.productId); assert.equal(p.lines[0].quantity, c.requestedQuantity);
    assert.deepEqual(p.lines[0].pickedSerialNumbers, []);
    assert(!p.lines[0].bundleSetCodes?.length);
  } else {
    assert.equal(p.order_id, orderId, 'Foreign order mutation refused');
    if (name === 'update_shipment_tracking') {
      assert(['mark_in_transit', 'record_delivery_failed', 'confirm_delivery'].includes(p.action));
      if (p.action === 'confirm_delivery') {
        assert.equal(p.tracking_reference, c.podReference); assert(ownedEvidence(p.evidence_url, orderId), 'POD evidence is not owned');
      } else assert(p.evidence_url == null);
      if (p.action === 'record_delivery_failed') assert.equal(p.failure_reason, c.failureReason);
    } else {
      assert.equal(name, 'advance_fulfillment_order', 'Unreviewed warehouse RPC');
      assert(['allocate', 'start_picking', 'confirm_pick', 'confirm_pack', 'release'].includes(p.action));
      assert.deepEqual(p.packaging ?? [], [], 'Shared packaging is forbidden');
      assert.deepEqual(p.fulfilled_lines ?? [], []);
      if (p.action === 'confirm_pick') {
        assert.equal(p.picked_lines.length, 1);
        const line = p.picked_lines[0];
        assert.equal(line.productId, c.productId); assert.equal(line.quantity, c.requestedQuantity); assert.equal(line.binId, c.binId);
        assert.deepEqual(line.serialNumbers, []); assert(line.evidenceUrl == null);
      }
      if (p.action === 'confirm_pack') {
        assert.equal(p.courier, c.courier); assert.equal(p.waybill_number, c.waybill); assert.equal(p.delivery_link, c.deliveryLink);
      }
    }
  }
  return freeze(structuredClone(p));
}

export async function assertDeniedUnchanged(read, invoke, expected) {
  const before = await read();
  const result = await invoke();
  assert(result.error, 'Negative probe unexpectedly allowed');
  assert.match(result.error.message, expected);
  assert.deepEqual(await read(), before, 'Denied command mutated persisted order, audit or inventory');
  return result.error.message;
}

export async function assertReplayUnchanged(read, invoke, payload, originalResponse) {
  const before = await read();
  const frozen = freeze(structuredClone(payload));
  const result = await invoke(frozen);
  assert(!result.error, `Replay failed: ${result.error?.message}`);
  assert.deepEqual(result.data, originalResponse, 'Replay response differs');
  assert.deepEqual(await read(), before, 'Replay mutated events, audit or inventory');
}

async function health(m) {
  const response = await fetch(`${TARGET.origin}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  assert(response.ok, 'UAT health request failed');
  const body = await response.json(); assertHealth(body, m); return body;
}

export function validateReleasedContinuation(m, source, releaseCommand) {
  validateManifest(m);
  assert.equal(source.runId, m.runId); assert.equal(source.commit, m.commit);
  assert.equal(source.environment, 'uat'); assert.equal(source.complete, false);
  assert(source.finishedAt && Number.isFinite(Date.parse(source.finishedAt)), 'Only a terminal attempt can be continued');
  assertHealth(source.endHealth, m);
  assert.equal(source.failures?.length, 1);
  assert.equal(source.failures[0].view, 'desktop1440');
  assert.match(source.failures[0].message, /^Movement actor\n/, 'Only the reviewed release-actor assertion failure is resumable');
  assert.deepEqual(source.storageAttempts, []); assert.deepEqual(source.privateStorageEvidence, []);
  assert.equal(source.bindings?.length, 1);
  const binding = source.bindings[0]; const c = m.cases[0];
  assert.equal(binding.view, c.viewport); assert.equal(binding.productId, c.productId); assert.equal(binding.reference, c.reference);
  assert(UUID.test(binding.orderId)); assert.equal(source.failures[0].orderId, binding.orderId);
  assert.deepEqual(source.checks.map(check => [check.view, check.checkpoint]), [
    'ecommerce-intake', 'denied-procurement_lead-allocate', 'allocated', 'picking', 'wrong-bin-denied',
    'pick-persisted', 'packed-independent-release-required', 'denied-operations_associate-release',
  ].map(checkpoint => ['desktop1440', checkpoint]));
  assert.deepEqual(source.commands.map(command => [command.name, command.action ?? null, command.orderId]), [
    ['create_fulfillment_order', null], ...['allocate', 'start_picking', 'confirm_pick', 'confirm_pack', 'release'].map(action => ['advance_fulfillment_order', action]),
  ].map(([name, action]) => [name, action, binding.orderId]));
  assert.equal(releaseCommand.name, 'advance_fulfillment_order');
  assert.equal(releaseCommand.payload?.action, 'release');
  assertUiPayload(c, binding.orderId, releaseCommand.name, releaseCommand.payload);
  return structuredClone(binding);
}

// Live dependencies are loaded only after explicit mutation/target/build guards.
export async function run(folder, env = process.env) {
  folder = path.resolve(folder);
  const m = validateManifest(JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8')));
  assertRunPermission(m, env);
  let continuation;
  if (env.WMS_ECOMMERCE_RESUME_ATTEMPT) {
    const ref = env.WMS_ECOMMERCE_RESUME_ATTEMPT;
    assert(/^attempt-[0-9TZ-]+-[a-f0-9]{8}$/.test(ref), 'Resume must name a retained attempt in this run folder');
    const directory = path.join(folder, ref);
    const sourceBytes = await readFile(path.join(directory, 'results.json'));
    const source = JSON.parse(sourceBytes);
    const releaseRef = source.commands?.at(-1)?.ref;
    assert.equal(releaseRef, 'desktop1440-command-5.json');
    const releaseBytes = await readFile(path.join(directory, releaseRef));
    const binding = validateReleasedContinuation(m, source, JSON.parse(releaseBytes));
    for (const check of source.checks) {
      assert(/^desktop1440-[0-9]+-[a-z_-]+\.png$/.test(check.screenshot?.ref), 'Invalid retained screenshot reference');
      assert((await readFile(path.join(directory, check.screenshot.ref))).byteLength > 0);
    }
    continuation = { ref, source, binding, resultsSha256: sha256(sourceBytes), releaseCommandSha256: sha256(releaseBytes) };
  }
  await health(m);
  const lockPath = path.join(folder, 'run.lock');
  const lock = await open(lockPath, 'wx');
  let browser;
  const actors = {};
  const attempt = path.join(folder, `attempt-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  const report = { runId: m.runId, commit: m.commit, environment: 'uat', startedAt: new Date().toISOString(), complete: false,
    smtpIndependent: true, globalWmsSignoff: false, cleanup: { status: 'pending-independent-review', allResidueVerified: false },
    scope: 'Synthetic ecommerce COD shipment only; no physical courier, payment settlement or human acceptance claimed.',
    gaps: ['held-stock denial', 'partial/short/cancel', 'concurrency', 'session/network recovery', 'serialized/lot/bundle goods', 'packaging consumption', 'hardware', 'verified cleanup', 'human screenshot review'],
    checks: [], failures: [], commands: [], bootstrapCommands: [], storageAttempts: [], privateStorageEvidence: [], bindings: [] };
  if (continuation) {
    report.continuation = { sourceAttempt: continuation.ref, resultsSha256: continuation.resultsSha256,
      releaseCommandSha256: continuation.releaseCommandSha256, boundary: 'released',
      previousCheckCount: continuation.source.checks.length, freshEndToEndRun: false };
    report.bindings.push(continuation.binding);
  }
  let writes = Promise.resolve();
  const persist = () => {
    const json = JSON.stringify(report, null, 2);
    writes = writes.then(() => writeFile(path.join(attempt, 'results.json'), json));
    return writes;
  };
  try {
    await mkdir(attempt);
    await writeFile(path.join(attempt, 'manifest.json'), JSON.stringify(m, null, 2), { flag: 'wx' });
    await persist();
    const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
    const { chromium, expect: baseExpect } = require('@playwright/test');
    const expect = baseExpect.configure({ timeout: 25000 });
    const { createClient } = require('@supabase/supabase-js');
    const { auditPersonas } = await import('./uat-audit-identities.mjs');
    for (const role of ['marketing_events_lead', 'operations_associate', 'operations_lead', 'procurement_lead']) {
      const persona = auditPersonas('checkpoint-v1').find(p => p.role === role);
      assert(persona);
      const client = createClient(`https://${TARGET.project}.supabase.co`, 'sb_publishable_7YRN3Sg0Cm8QRoDt6IszlA_yAuRD5u9', {
        auth: { persistSession: false, autoRefreshToken: true },
        global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.any([AbortSignal.timeout(20000), init?.signal].filter(Boolean)) }) },
      });
      actors[role] = { persona, client };
      const login = await client.auth.signInWithPassword({ email: persona.email, password: env.AUDIT_PASSWORD });
      assert(!login.error, `Login failed: ${role}`); actors[role].id = login.data.user.id;
      const ownProfile = await client.schema('core').from('profiles').select('id,email').eq('id', login.data.user.id).single();
      assert(!ownProfile.error && ownProfile.data?.id === login.data.user.id, `Own actor profile lookup failed: ${role}`);
      const actorLabel = ownProfile.data.email == null || ownProfile.data.email === '' ? login.data.user.id : ownProfile.data.email;
      assert(typeof actorLabel === 'string' && actorLabel.length > 0);
      actors[role].authoritativeActor = actorLabel;
      const capabilities = await client.schema('core').rpc('my_capability_snapshot');
      assert(!capabilities.error && capabilities.data, `Capability readback failed: ${role}`);
      const granted = capabilities.data.roleCapabilities?.warehouse ?? [];
      const live = capabilities.data.userCapabilities?.warehouse ?? [];
      assert(Array.isArray(granted) && Array.isArray(live), 'Malformed capability readback');
      report.actors ??= [];
      report.actors.push({ role, id: login.data.user.id, authoritativeActor: actorLabel, actorSource: 'authenticated-own-core.profiles; authoritative_actor projection', capabilities: capabilities.data, source: 'core.my_capability_snapshot' });
      const required = requiredLiveCapabilities(role);
      for (const capability of required) assert(live.includes(capability), `Missing governed live capability ${role}:${capability}; do not bypass certification`);
      if (role === 'marketing_events_lead') assert(!granted.includes('request_fulfillment') && !live.includes('request_fulfillment'), 'Marketing must not receive ecommerce intake authority');
      if (role === 'procurement_lead') assert(!['reserve_allocate', 'issue_items', 'request_fulfillment'].some(cap => granted.includes(cap) || live.includes(cap)), 'Negative persona has warehouse execution authority');
    }
    const identities = Object.fromEntries(Object.entries(ECOMMERCE_ACTORS).map(([step, role]) => [step, actors[role].id]));
    // Movement and shipment-event labels use the server profile projection;
    // order actor columns and core audit entries retain authenticated UUIDs.
    identities.releaserLabel = actors[ECOMMERCE_ACTORS.releaser].authoritativeActor;
    assert.equal(new Set(Object.values(actors).map(a => a.id)).size, 4, 'Independent identities required');
    if (continuation) for (const [role, actor] of Object.entries(actors)) {
      assert.equal(continuation.source.actors.find(a => a.role === role)?.id, actor.id, 'Continuation actor changed');
    }
    browser = await chromium.launch();
    for (const c of m.cases) {
      await health(m);
      const resumeReleased = continuation?.binding.view === c.viewport;
      let orderId = resumeReleased ? continuation.binding.orderId : undefined;
      let activePage; let activeRole; let guardError;
      let podFixture = null; let privateStorageEvidence = null;
      const contexts = []; const pages = {};
      const reads = async (schema, table, column, value) => {
        const result = await actors.operations_lead.client.schema(schema).from(table).select('*').eq(column, value).order('id');
        assert(!result.error, `Readback failed: ${schema}.${table}: ${result.error?.message}`); return result.data;
      };
      const read = async () => {
        const orders = await reads('warehouse', 'fulfillment_orders', 'external_reference', c.reference);
        assert(orders.length <= 1, 'Duplicate reference; manual review required');
        if (orderId && orders.length) assert.equal(orders[0].id, orderId);
        const s = { order: orders[0] ?? null };
        for (const [key, table] of Object.entries({ products: 'products', stock: 'stock_levels', movements: 'movements', reservations: 'fulfillment_reservations',
          holds: 'inventory_holds', allocations: 'allocations', units: 'inventory_units' })) {
          s[key] = await reads('warehouse', table, key === 'products' ? 'id' : 'product_id', c.productId);
        }
        s.activity = s.order ? await reads('core', 'activity_log', 'entity_id', s.order.id) : [];
        s.podFixture = podFixture;
        s.privateStorageEvidence = privateStorageEvidence;
        return s;
      };
      const capture = async (checkpoint, role, extra = {}) => {
        assert(!guardError, guardError);
        const snapshot = await read(); const inventory = reconcile(m, c, snapshot, identities);
        const file = `${c.viewport}-${report.checks.length}-${checkpoint}.png`;
        const geometry = await captureCheckpointViewport(activePage, path.join(attempt, file));
        report.checks.push({ checkpoint, view: c.viewport, actor: { id: actors[role].id, configuredRoles: actors[role].persona.assignments.warehouse },
          kind: 'live', readback: { source: 'persisted-requery', snapshot, inventory },
          screenshot: { ref: file, reviewed: false, sessionActorId: actors[activeRole]?.id, ...geometry }, ...extra });
        await persist(); assert(geometry.contentWidth <= geometry.width + 1, `${checkpoint} horizontal overflow`);
      };
      const rpc = async (role, name, payload) => {
        await health(m);
        const before = await read(); assertOwnedOrder(c, before.order);
        assert.equal(payload.order_id, before.order.id); reconcile(m, c, before, identities);
        return actors[role].client.schema('warehouse').rpc(name, { payload });
      };
      const negative = async (role, name, action, expected, values = {}) => {
        await health(m);
        const s = await read(); assertOwnedOrder(c, s.order); assert.equal(s.order.id, orderId);
        const payload = freeze({ ...values, order_id: orderId, action, idempotency_key: `${m.runId}-${c.viewport}-deny-${role}-${action}` });
        await writeFile(path.join(attempt, `${c.viewport}-negative-${role}-${action}.json`), JSON.stringify({ name, payload }, null, 2), { flag: 'wx' });
        const error = await assertDeniedUnchanged(read, () => rpc(role, name, payload), expected);
        await capture(`denied-${role}-${action}`, role, { kind: 'negative-api', operation: { rpc: `warehouse.${name}`, action }, error, unchanged: true });
      };
      const pageFor = async role => {
        if (!pages[role]) {
          const mobile = c.viewport === 'mobile390';
          const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1440, height: mobile ? 844 : 900 },
            isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce', serviceWorkers: 'block' });
          contexts.push(context);
          // Validate and durably capture the real UI payload before allowing it;
          // never replace IDs, keys, RPC responses or evidence upload behavior.
          await context.route(`https://${TARGET.project}.supabase.co/rest/v1/**`, async route => {
            const request = route.request();
            if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
            try {
              assert.equal(request.method(), 'POST', 'Direct database writes are forbidden');
              const name = new URL(request.url()).pathname.split('/').at(-1);
              const schema = request.headers()['content-profile'];
              assert(new URL(request.url()).pathname.startsWith('/rest/v1/rpc/'), 'Direct table writes are forbidden');
              if (isReviewedReadRpc(schema, name)) return route.continue();
              if (isOwnLearningBootstrap(schema, name, request.postDataJSON())) {
                // Normal own-account learning reconciliation is a governed write,
                // not a read or a fabricated training completion.
                report.bootstrapCommands.push({ schema, name, actorId: actors[role].id, view: c.viewport, parameters: {}, observedAt: new Date().toISOString() });
                await persist();
                return route.continue();
              }
              assert.equal(schema, 'warehouse', `Non-warehouse mutation refused: ${schema}.${name}`);
              const payload = assertUiPayload(c, orderId, name, request.postDataJSON()?.payload);
              if (name === 'update_shipment_tracking' && payload.action === 'confirm_delivery') {
                const uploads = report.storageAttempts.filter(u => u.view === c.viewport && u.orderId === orderId && u.path === payload.evidence_url);
                assert.equal(uploads.length, 1, 'Exactly one observed POD upload must match the persisted command path');
                assert(podFixture, 'Actual synthetic POD fixture required before submission');
                assertUploadEvidence(orderId, payload.evidence_url, uploads[0], identities.releaser);
              }
              if (name === 'create_fulfillment_order') {
                assert.equal(payload.order_date, m.orderDate);
                orderId = payload.order_id;
                if (!report.bindings.some(b => b.orderId === orderId)) report.bindings.push({ view: c.viewport, orderId, reference: c.reference, productId: c.productId });
                await writeFile(path.join(attempt, 'cleanup-inventory.sql'), cleanupInventorySql(m, report.bindings));
              }
              const ref = `${c.viewport}-command-${report.commands.length}.json`;
              await writeFile(path.join(attempt, ref), JSON.stringify({ name, payload }, null, 2), { flag: 'wx' });
              report.commands.push({ ref, name, action: payload.action, orderId: payload.order_id }); await persist();
              await route.continue();
            } catch (error) { guardError = error.message; await route.abort('blockedbyclient'); }
          });
          await context.route(`https://${TARGET.project}.supabase.co/storage/v1/object/evidence/**`, async route => {
            if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(route.request().method())) return route.continue();
            try {
              assert.equal(route.request().method(), 'POST', 'Only a new POD upload is allowed');
              const objectPath = decodeURIComponent(new URL(route.request().url()).pathname.split('/object/evidence/')[1]);
              assert(orderId && ownedEvidence(objectPath, orderId), 'Unowned upload refused');
              report.storageAttempts.push({ view: c.viewport, orderId, bucket: 'evidence', path: objectPath, status: 'attempted-not-cleaned',
                method: route.request().method(), requestUrl: route.request().url(), actorId: actors[role].id });
              await persist(); await route.continue();
            } catch (error) { guardError = error.message; await route.abort('blockedbyclient'); }
          });
          const page = await context.newPage(); pages[role] = page; activePage = page; activeRole = role;
          page.setDefaultTimeout(25000);
          await page.goto(`${TARGET.origin}/login?redirect=%2Fwarehouse%2Ffulfillment`);
          await page.locator('#email').fill(actors[role].persona.email); await page.locator('#password').fill(env.AUDIT_PASSWORD);
          await page.getByRole('button', { name: /^sign in$/i }).click(); await page.waitForURL(url => url.pathname !== '/login');
        }
        activePage = pages[role]; activeRole = role; return activePage;
      };
      const queue = async role => {
        const page = await pageFor(role);
        await page.goto(`${TARGET.origin}/warehouse/fulfillment?tab=orders&status=all&q=${encodeURIComponent(c.reference)}`);
        const card = page.getByRole('listitem', { name: `Order ${c.reference}`, exact: true });
        await expect(card).toBeVisible(); return { page, card };
      };
      const uiCommand = async (page, name, click) => {
        await health(m);
        reconcile(m, c, await read(), identities);
        const responsePromise = page.waitForResponse(r => r.request().method() === 'POST'
          && r.url() === `https://${TARGET.project}.supabase.co/rest/v1/rpc/${name}`, { timeout: 30000 });
        // Attach a rejection handler immediately so a UI failure cannot leave an unhandled wait.
        responsePromise.catch(() => {});
        await click();
        const response = await responsePromise;
        assert(response.ok(), `${name} UI RPC failed: HTTP ${response.status()}`);
        const payload = assertUiPayload(c, orderId, name, response.request().postDataJSON().payload);
        const data = await response.json(); assert.equal(data.id, orderId);
        return { payload, data };
      };
      try {
        const initial = await read();
        if (resumeReleased) {
          assertOwnedOrder(c, initial.order);
          assert.equal(initial.order.id, orderId); assert.equal(initial.order.status, 'released');
          assert.equal(initial.order.shipment_status, 'dispatched');
          assert.equal(initial.order.proof_of_delivery_evidence_url, null); assert.equal(initial.order.delivered_at, null);
          assert.deepEqual(initial.order.shipment_events.map(event => event.status), ['awaiting_dispatch', 'dispatched']);
        } else assert.equal(initial.order, null, 'Existing order: do not replay the UI journey. Review retained attempts and cleanup first.');
        reconcile(m, c, initial, identities);
        const locations = await reads('warehouse', 'locations', 'id', c.locationId);
        const bins = await reads('warehouse', 'storage_areas', 'id', c.binId);
        assert.equal(locations.length, 1); assert.equal(locations[0].name, c.productName); assert.equal(locations[0].type, 'warehouse');
        assert.equal(bins.length, 1); assert.equal(bins[0].location_id, c.locationId); assert.equal(bins[0].code, c.binCode);
        assert.equal(bins[0].zone, 'WMS-SIGNOFF'); assert.equal(bins[0].active, true);
        if (!resumeReleased) {
        const creator = await pageFor(ECOMMERCE_ACTORS.creator);
        await creator.goto(`${TARGET.origin}/warehouse/fulfillment?tab=orders`);
        await creator.getByRole('button', { name: 'New order / demand', exact: true }).click();
        const intake = creator.getByRole('dialog', { name: 'Create order or fulfillment demand', exact: true });
        await intake.getByLabel('Demand source', { exact: true }).selectOption('ecommerce');
        for (const [selector, value] of Object.entries({ '#order-reference': c.reference, '#order-date': m.orderDate,
          '#customer-name': c.customerName, '#customer-contact': c.customerContact, '#customer-email': '', '#delivery-address': c.address.addressLine,
          '#delivery-city': c.address.city, '#delivery-province': c.address.province, '#delivery-postal': c.address.postalCode, '#order-notes': c.notes })) await intake.locator(selector).fill(value);
        await intake.locator('#order-channel').selectOption(c.channel);
        await intake.getByLabel('Source warehouse', { exact: true }).selectOption(c.locationId);
        await intake.getByLabel('Product', { exact: true }).selectOption(c.productId);
        await intake.getByLabel('Quantity', { exact: true }).fill(String(c.requestedQuantity));
        await intake.getByLabel('Payment method', { exact: true }).selectOption(c.paymentMethod);
        await uiCommand(creator, 'create_fulfillment_order', () => intake.getByRole('button', { name: 'Create order', exact: true }).click());
        await expect.poll(async () => (await read()).order?.status).toBe('received');
        await expect(intake).not.toBeVisible(); await capture('ecommerce-intake', ECOMMERCE_ACTORS.creator);
        await negative('procurement_lead', 'advance_fulfillment_order', 'allocate', /Not authorized/i);
        const worker = await queue('operations_associate');
        for (const [button, status] of [['Allocate stock', 'allocated'], ['Start picking', 'picking']]) {
          await uiCommand(worker.page, 'advance_fulfillment_order', () => worker.card.getByRole('button', { name: button, exact: true }).click());
          await expect.poll(async () => (await read()).order.status).toBe(status); await capture(status, 'operations_associate');
        }
        await worker.card.getByRole('button', { name: 'Confirm scanned pick', exact: true }).click();
        const pick = worker.page.getByRole('dialog', { name: `Confirm pick / ${c.reference}`, exact: true });
        const beforeWrongBin = await read();
        await pick.getByLabel(`Scanned bin code for ${c.productName}`, { exact: true }).fill('SYNTHETIC-WRONG-BIN');
        await pick.getByRole('button', { name: 'Use bin', exact: true }).click();
        await expect(pick.getByRole('alert')).toContainText('Wrong source bin');
        assert.deepEqual(await read(), beforeWrongBin); await capture('wrong-bin-denied', 'operations_associate');
        await pick.getByLabel(`Scanned bin code for ${c.productName}`, { exact: true }).fill(c.binCode);
        await pick.getByRole('button', { name: 'Use bin', exact: true }).click();
        await pick.getByLabel(`Product barcode for ${c.productName}`, { exact: true }).fill(c.sku);
        await pick.getByRole('button', { name: 'Use product', exact: true }).click();
        await pick.getByLabel(`Picked quantity for ${c.productName}`, { exact: true }).fill(String(c.requestedQuantity));
        await uiCommand(worker.page, 'advance_fulfillment_order', () => pick.getByRole('button', { name: 'Confirm pick', exact: true }).click());
        await expect.poll(async () => (await read()).order.status).toBe('packing');
        await worker.page.reload(); await expect(worker.card).toBeVisible(); await capture('pick-persisted', 'operations_associate');
        await worker.card.getByRole('button', { name: 'Pack and add waybill', exact: true }).click();
        const pack = worker.page.getByRole('dialog', { name: `Pack order / ${c.reference}`, exact: true });
        for (const [label, value] of [['Courier', c.courier], ['Waybill number', c.waybill], ['Delivery tracking link', c.deliveryLink]]) await pack.getByLabel(label, { exact: true }).fill(value);
        await uiCommand(worker.page, 'advance_fulfillment_order', () => pack.getByRole('button', { name: 'Confirm packing', exact: true }).click());
        await expect.poll(async () => (await read()).order.status).toBe('ready'); await expect(pack).not.toBeVisible();
        await expect(worker.card.getByText('Awaiting release by a second warehouse operator.')).toBeVisible();
        await expect(worker.card.getByRole('button', { name: 'Release shipment', exact: true })).toHaveCount(0);
        await capture('packed-independent-release-required', 'operations_associate');
        await negative('operations_associate', 'advance_fulfillment_order', 'release', /second warehouse operator/i);
        }
        const lead = await queue('operations_lead');
        if (!resumeReleased) await uiCommand(lead.page, 'advance_fulfillment_order', () => lead.card.getByRole('button', { name: 'Release shipment', exact: true }).click());
        await expect.poll(async () => (await read()).order.status).toBe('released');
        assert.equal((await read()).order.shipment_status, 'dispatched');
        assert.equal((await read()).order.delivered_at, null); await capture('released-not-delivered', 'operations_lead');
        await negative('operations_lead', 'advance_fulfillment_order', 'acknowledge_receipt', /Shipments require proof of delivery|only available for handovers/i);
        await negative('procurement_lead', 'update_shipment_tracking', 'mark_in_transit', /Not authorized/i);
        await negative('operations_lead', 'update_shipment_tracking', 'confirm_delivery', /reference and evidence are required/i);
        const tracking = async action => {
          await lead.card.getByRole('button', { name: 'Update delivery', exact: true }).click();
          const dialog = lead.page.getByRole('dialog', { name: `Delivery / ${c.reference}`, exact: true });
          await dialog.getByLabel('Delivery outcome', { exact: true }).selectOption(action); return dialog;
        };
        for (const [action, status] of [['mark_in_transit', 'in_transit'], ['record_delivery_failed', 'delivery_failed'], ['mark_in_transit', 'in_transit']]) {
          const dialog = await tracking(action);
          if (action === 'record_delivery_failed') await dialog.getByLabel('Exception reason', { exact: true }).fill(c.failureReason);
          const result = await uiCommand(lead.page, 'update_shipment_tracking', () => dialog.getByRole('button', { name: 'Save delivery update', exact: true }).click());
          await expect.poll(async () => (await read()).order.shipment_status).toBe(status); await expect(dialog).not.toBeVisible();
          await assertReplayUnchanged(read, p => rpc('operations_lead', 'update_shipment_tracking', p), result.payload, result.data);
          await capture(`${action}-replay-unchanged`, 'operations_lead', { operation: { rpc: 'warehouse.update_shipment_tracking', action } });
        }
        const pod = await tracking('confirm_delivery');
        await pod.getByLabel('Proof-of-delivery reference', { exact: true }).fill(c.podReference);
        await expect(pod.getByRole('button', { name: 'Save delivery update', exact: true })).toBeDisabled();
        const proofPage = await browser.newPage({ viewport: { width: 640, height: 360 } });
        await proofPage.setContent(`<body style="font:22px Arial;background:white;color:black;padding:24px"><h1>SYNTHETIC UAT POD</h1><p>${m.runId}</p><p>${c.viewport}</p><p>No physical shipment or human acceptance claimed.</p></body>`);
        const proof = await proofPage.screenshot(); await proofPage.close();
        const fixtureRef = `${c.viewport}-synthetic-pod.png`;
        await writeFile(path.join(attempt, fixtureRef), proof, { flag: 'wx' });
        const savedFixture = await readFile(path.join(attempt, fixtureRef));
        assert.deepEqual(savedFixture, proof, 'Saved synthetic fixture bytes differ');
        podFixture = freeze({ ref: fixtureRef, sha256: sha256(savedFixture), byteLength: savedFixture.byteLength });
        await writeFile(path.join(attempt, `${c.viewport}-pod-fixture.json`), JSON.stringify(podFixture, null, 2), { flag: 'wx' });
        await health(m);
        const uploadResponsePromise = lead.page.waitForResponse(response => response.request().method() === 'POST'
          && response.url().startsWith(storageUrl(`delivery-${orderId}/0/`)), { timeout: 30000 });
        uploadResponsePromise.catch(() => {});
        await pod.locator('input[type=file]').setInputFiles({ name: 'synthetic-pod.png', mimeType: 'image/png', buffer: proof });
        const uploadResponse = await uploadResponsePromise;
        const observedUploads = report.storageAttempts.filter(u => u.view === c.viewport && u.requestUrl === uploadResponse.url());
        assert.equal(observedUploads.length, 1, 'Exactly one captured upload request required');
        const observedUpload = observedUploads[0];
        observedUpload.httpStatus = uploadResponse.status();
        observedUpload.status = uploadResponse.ok() ? 'uploaded-not-cleaned' : 'upload-failed-not-cleaned';
        await persist();
        assertUploadEvidence(orderId, observedUpload.path, observedUpload, identities.releaser);
        await expect(pod.getByRole('button', { name: 'Save delivery update', exact: true })).toBeEnabled();
        const delivered = await uiCommand(lead.page, 'update_shipment_tracking', () => pod.getByRole('button', { name: 'Save delivery update', exact: true }).click());
        await expect.poll(async () => (await read()).order.status).toBe('completed'); await expect(pod).not.toBeVisible();
        await health(m);
        const persistedOrder = (await read()).order;
        assert.equal(persistedOrder.proof_of_delivery_evidence_url, delivered.payload.evidence_url, 'Persisted POD path differs from UI command');
        privateStorageEvidence = await verifyPrivateStorageEvidence({ manifest: m, c, order: persistedOrder, upload: observedUpload,
          fixtureBytes: await readFile(path.join(attempt, fixtureRef)), fixtureRef, actors: identities,
          download: async (actorId, bucket, objectPath) => {
            const actor = Object.values(actors).find(a => a.id === actorId);
            assert(actor, 'Unknown Storage download actor');
            const result = await actor.client.storage.from(bucket).download(objectPath);
            assert(!result.error && result.data, `Authenticated POD download failed for ${actor.persona.role}: ${result.error?.message}`);
            return new Uint8Array(await result.data.arrayBuffer());
          },
          probePublic: async url => {
            const response = await fetch(url, { method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) });
            await response.body?.cancel();
            return response.status;
          } });
        assertPrivateStorageProof(m, c, persistedOrder, privateStorageEvidence, podFixture, identities);
        await writeFile(path.join(attempt, `${c.viewport}-private-storage.json`), JSON.stringify(privateStorageEvidence, null, 2), { flag: 'wx' });
        report.privateStorageEvidence.push(privateStorageEvidence);
        await persist();
        await assertReplayUnchanged(read, p => rpc('operations_lead', 'update_shipment_tracking', p), delivered.payload, delivered.data);
        const conflict = { ...delivered.payload, tracking_reference: `${c.podReference}-CONFLICT` };
        await writeFile(path.join(attempt, `${c.viewport}-idempotency-conflict.json`), JSON.stringify(conflict, null, 2), { flag: 'wx' });
        await assertDeniedUnchanged(read, () => rpc('operations_lead', 'update_shipment_tracking', conflict), /Idempotency key.*different payload/i);
        const duplicate = { ...delivered.payload, idempotency_key: `${m.runId}-${c.viewport}-duplicate-confirm-delivery` };
        await writeFile(path.join(attempt, `${c.viewport}-duplicate-delivery.json`), JSON.stringify(duplicate, null, 2), { flag: 'wx' });
        await assertDeniedUnchanged(read, () => rpc('operations_lead', 'update_shipment_tracking', duplicate), /Only a released shipment can be tracked/i);
        await lead.page.reload(); await expect(lead.card).toBeVisible();
        await expect(lead.card.getByRole('button', { name: 'Update delivery', exact: true })).toHaveCount(0);
        await lead.card.getByRole('button', { name: 'View order details', exact: true }).click();
        const details = lead.page.getByRole('dialog', { name: `Order details / ${c.reference}`, exact: true });
        await expect(details.getByText(c.podReference, { exact: true }).first()).toBeVisible();
        const proofImage = details.getByRole('region', { name: 'Proof of delivery', exact: true }).getByRole('img', { name: 'Evidence', exact: true });
        await expect(proofImage).toBeVisible();
        await expect.poll(() => proofImage.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
        assert.deepEqual((await read()).order.shipment_events.map(event => event.status),
          ['awaiting_dispatch', 'dispatched', 'in_transit', 'delivery_failed', 'in_transit', 'delivered']);
        await capture('delivered-completed-reconciled', 'operations_lead', { operation: { rpc: 'warehouse.update_shipment_tracking', action: 'confirm_delivery' }, replayUnchanged: true, duplicateDenied: true });
      } catch (error) {
        const ref = `${c.viewport}-failure.png`;
        await activePage?.screenshot({ path: path.join(attempt, ref), fullPage: true }).catch(() => {});
        report.failures.push({ view: c.viewport, message: guardError ?? error.message, screenshot: ref, orderId });
        await persist();
        break; // Stop the batch; never create the other viewport after an uncertain write.
      } finally { for (const context of contexts) await context.close(); }
    }
    report.endHealth = await health(m);
    report.complete = report.failures.length === 0 && report.checks.filter(c => c.checkpoint === 'delivered-completed-reconciled').length === 2;
  } catch (error) { report.failures.push({ message: error.message }); }
  finally {
    await browser?.close();
    for (const actor of Object.values(actors)) actor.client.auth.stopAutoRefresh();
    report.finishedAt = new Date().toISOString();
    try {
      await persist();
      await writeFile(path.join(attempt, 'cleanup-inventory.sql'), cleanupInventorySql(m, report.bindings));
    } finally { await lock.close(); await unlink(lockPath); }
  }
  return { attempt, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, folder, flag, commit, ...extra] = process.argv.slice(2);
  assert(folder && extra.length === 0, 'Usage: prepare FOLDER --commit DEPLOYED_SHA | run FOLDER');
  if (command === 'prepare') {
    assert.equal(flag, '--commit'); assert(commit);
    const m = await prepare(path.resolve(folder), { commit });
    console.log(JSON.stringify({ folder: path.resolve(folder), runId: m.runId, preparedOffline: true, executedLiveSql: false }));
  } else {
    assert(command === 'run' && !flag && !commit, 'Usage: prepare FOLDER --commit DEPLOYED_SHA | run FOLDER');
    const result = await run(folder);
    console.log(JSON.stringify({ attempt: result.attempt, complete: result.report.complete, failures: result.report.failures }));
    if (!result.report.complete) process.exitCode = 1;
  }
}
