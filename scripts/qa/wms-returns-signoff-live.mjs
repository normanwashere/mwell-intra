import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, open, unlink, readdir, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ecommerce from './wms-ecommerce-signoff-live.mjs';

export const CHECKPOINTS = Object.freeze(['source-delivered', 'case-submitted', 'physical-intake', 'physical-inspected-held', 'physical-hold-released', 'physical-relocated', 'replacement-resolved', 'replacement-allocated',
  'replacement-picking', 'replacement-picked', 'replacement-packed', 'replacement-released', 'replacement-delivered', 'customer-closed']);
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const RESERVED = ['acd6711b', 'fbceedf7', '55b66a58'];
const RESERVED_ORDERS = new Set(['ab9c70a4-869b-48ab-990d-272c82d881bb', 'a903be33-47ee-413a-b4f7-b874ea1afc2a',
  '80cb6afb-5e97-4448-96fe-619a7c66cebe', '309bf7db-7265-41fc-a558-55a972809dce', '1d1b2dd1-d9be-4159-ad4b-ea43079b72d4']);
const ROLES = ['operations_associate', 'operations_lead'];
const BASE = `https://${ecommerce.TARGET.project}.supabase.co`;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const json = value => JSON.stringify(value, null, 2);
const sql = value => `'${String(value).replaceAll("'", "''")}'`;
const clone = value => structuredClone(value);
const now = () => new Date().toISOString();

export function assertSavedSourceReport(bytes, report) {
  const saved = JSON.parse(bytes); assert.deepEqual(saved, JSON.parse(JSON.stringify(report)), 'Saved source report differs from its JSON representation'); return saved;
}

export async function readScopedRows(client, schema, table, column, value, contains = false) {
  let query = client.schema(schema).from(table).select('*', { count: 'exact' });
  query = contains ? query.contains(column, JSON.stringify(value)) : query.eq(column, value);
  const result = await query.order('id').limit(200);
  assert(!result.error, `Persisted read failed ${schema}.${table} (${result.error?.code ?? 'unknown'})`);
  assert(Array.isArray(result.data) && result.count === result.data.length && result.data.length < 200, `Incomplete persisted readback ${schema}.${table}`);
  return result.data;
}

export async function readJourneyActivity(actors, entityId) {
  assert(UUID.test(entityId));
  assert.equal(actors.length, 2, 'Two ordinary journey actors required');
  assert.equal(new Set(actors.map(actor => actor.id)).size, 2, 'Journey actors must be distinct');
  const readbacks = []; const rows = [];
  for (const actor of actors) {
    assert(UUID.test(actor.id));
    const result = await actor.client.schema('core').from('activity_log').select('*', { count: 'exact' })
      .eq('entity_id', entityId).eq('actor', actor.id).order('id').limit(200);
    assert(!result.error, `Journey audit read failed (${result.error?.code ?? 'unknown'})`);
    assert(Array.isArray(result.data) && result.count === result.data.length && result.data.length < 200, 'Incomplete own-actor audit read');
    for (const row of result.data) {
      assert.equal(row.actor, actor.id, 'Audit actor differs from queried actor');
      assert.equal(row.entity_id, entityId); assert.equal(row.module, 'warehouse');
      assert(['customer_return_case', 'fulfillment_order'].includes(row.entity_type), 'Unexpected journey audit entity type');
      assert(Number.isSafeInteger(row.id) && row.id > 0, 'Invalid audit row id');
      rows.push(row);
    }
    readbacks.push({ source: 'ordinary-actor-persisted-requery', actorId: actor.id, entityId, rows: result.data });
  }
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length, 'Duplicate journey audit row');
  return { rows: rows.sort((a, b) => a.id - b.id), readbacks };
}

const SOURCE_STEPS = ['ecommerce-intake', 'denied-procurement_lead-allocate', 'allocated', 'picking', 'wrong-bin-denied', 'pick-persisted',
  'packed-independent-release-required', 'denied-operations_associate-release', 'released-not-delivered', 'denied-operations_lead-acknowledge_receipt',
  'denied-procurement_lead-mark_in_transit', 'denied-operations_lead-confirm_delivery', 'mark_in_transit-replay-unchanged',
  'record_delivery_failed-replay-unchanged', 'mark_in_transit-replay-unchanged', 'delivered-completed-reconciled'];

export function validatePreReturnContinuation(m, failed, source) {
  validateManifest(m);
  for (const report of [failed, source]) { assert.equal(report.runId, m.runId); assert.equal(report.commit, m.commit); assert.equal(report.environment, 'uat'); }
  assert.equal(failed.complete, false); assert.equal(failed.failures?.length, 1);
  assert.match(failed.failures[0].message, /Expected values to be strictly deep-equal/); assert.match(failed.failures[0].message, /action: undefined/);
  assert.equal(failed.failures[0].cleanup, 'retained-pending-independent-review');
  for (const key of ['bindings', 'checks', 'formEvidence', 'negatives', 'commands', 'bootstrapCommands', 'storageAttempts']) assert.deepEqual(failed[key], [], `Pre-return boundary requires zero ${key}`);
  for (const key of ['previews', 'browserActors', 'negativeAttempts']) if (key in failed) assert.deepEqual(failed[key], []);
  for (const key of ['sourceAttempt', 'continuation', 'baselines']) assert(!(key in failed), 'Only the original pre-return serialization boundary is resumable');
  assert.equal(source.complete, true); assert.deepEqual(source.failures, []); assert(!source.continuation, 'Source must be the complete original two-view run');
  const times = [failed.startedAt, source.startedAt, source.finishedAt, failed.finishedAt].map(Date.parse);
  assert(times.every(Number.isFinite) && times.every((value, i) => i === 0 || value >= times[i - 1]), 'Terminal nested source/root timing required');
  ecommerce.assertHealth(source.endHealth, m.source);
  assert.equal(source.actors?.length, 4); assert.equal(new Set(source.actors.map(a => a.id)).size, 4);
  for (const role of ['marketing_events_lead', ...ROLES, 'procurement_lead']) assert.equal(source.actors.filter(a => a.role === role && UUID.test(a.id)).length, 1);
  assert.equal(failed.actors?.length, 2);
  for (const role of ROLES) {
    const actor = failed.actors.find(a => a.role === role), original = source.actors.find(a => a.role === role);
    assert.equal(actor?.id, original.id); assert.equal(actor.authoritativeActor, original.authoritativeActor); assert.deepEqual(actor.capabilities, original.capabilities);
  }
  const identities = { creator: source.actors.find(a => a.role === 'operations_associate').id, picker: source.actors.find(a => a.role === 'operations_associate').id,
    releaser: source.actors.find(a => a.role === 'operations_lead').id, releaserLabel: source.actors.find(a => a.role === 'operations_lead').authoritativeActor };
  assert.equal(source.bindings?.length, 2); assert.equal(new Set(source.bindings.map(b => b.orderId)).size, 2); assert.equal(source.checks?.length, 32);
  assert.equal(source.commands?.length, 20); assert.equal(source.storageAttempts?.length, 2); assert.equal(source.privateStorageEvidence?.length, 2);
  for (const c of m.source.cases) {
    const binding = source.bindings.find(b => b.view === c.viewport); assert(binding && UUID.test(binding.orderId) && !RESERVED_ORDERS.has(binding.orderId));
    assert.equal(binding.productId, c.productId); assert.equal(binding.reference, c.reference);
    const checks = source.checks.filter(x => x.view === c.viewport); assert.deepEqual(checks.map(x => x.checkpoint), SOURCE_STEPS);
    for (const [index, check] of checks.entries()) {
      const status = ['received', 'received', 'allocated', 'picking', 'picking', 'packing', 'ready', 'ready', 'released', 'released', 'released', 'released', 'released', 'released', 'released', 'completed'][index];
      assert.equal(check.readback?.source, 'persisted-requery'); assert.equal(check.readback.snapshot.order?.id, binding.orderId); assert.equal(check.readback.snapshot.order.status, status);
      assert.deepEqual(check.readback.inventory, ecommerce.reconcile(m.source, c, check.readback.snapshot, identities));
      const role = [1, 10].includes(index) ? 'procurement_lead' : index < 8 ? 'operations_associate' : 'operations_lead';
      assert.equal(check.actor?.id, source.actors.find(a => a.role === role).id);
      assert.equal(check.screenshot?.width, c.viewport === 'mobile390' ? 390 : 1440); assert(check.screenshot.contentWidth <= check.screenshot.width + 1);
      if (check.kind === 'negative-api') { assert.equal(check.unchanged, true); assert(typeof check.error === 'string' && check.error.length > 0); }
      else { assert.equal(check.kind, 'live'); assert.equal(check.screenshot.sessionActorId, check.actor.id); }
    }
    assert.equal(checks.at(-1).replayUnchanged, true); assert.equal(checks.at(-1).duplicateDenied, true);
    assert.deepEqual(checks.at(-1).readback.snapshot.order.shipment_events.map(e => e.status), ['awaiting_dispatch', 'dispatched', 'in_transit', 'delivery_failed', 'in_transit', 'delivered']);
    const commands = source.commands.filter(cmd => cmd.orderId === binding.orderId);
    assert.deepEqual(commands.map(cmd => [cmd.name, cmd.action ?? null]), [['create_fulfillment_order', null], ...['allocate', 'start_picking', 'confirm_pick', 'confirm_pack', 'release'].map(action => ['advance_fulfillment_order', action]),
      ...['mark_in_transit', 'record_delivery_failed', 'mark_in_transit', 'confirm_delivery'].map(action => ['update_shipment_tracking', action])]);
  }
  return identities;
}

export async function inspectPreReturnContinuation(folder, failedAttempt, sourceAttempt) {
  const attemptPattern = /^attempt-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}$/;
  assert(attemptPattern.test(failedAttempt) && sourceAttempt.startsWith('source/') && attemptPattern.test(sourceAttempt.slice(7)), 'Exact local failed/source attempt paths required');
  folder = await realpath(path.resolve(folder)); const archive = []; const files = new Map();
  const saved = async ref => {
    assert(ref.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..'), 'Unsafe archive reference');
    const target = path.resolve(folder, ref); const actual = await realpath(target);
    assert.equal(path.relative(folder, actual).replaceAll('\\', '/'), ref, 'Archive symlink or path escape refused');
    assert((await lstat(target)).isFile()); const bytes = await readFile(target); files.set(ref, bytes);
    archive.push({ ref, sha256: sha(bytes), byteLength: bytes.length }); return bytes;
  };
  for (const [dir, allowed] of [['', failedAttempt], ['source', sourceAttempt.slice(7)]]) {
    const entries = await readdir(path.join(folder, dir), { withFileTypes: true });
    assert(!entries.some(e => e.name === 'run.lock'), 'Original root/source execution is still locked');
    assert.deepEqual(entries.filter(e => e.name.startsWith('attempt-')).map(e => e.name), [allowed], 'Only this original pre-return boundary is supported; additional attempts require review');
  }
  const m = validateManifest(JSON.parse(await saved('manifest.json')));
  assert.deepEqual(JSON.parse(await saved('source/manifest.json')), m.source);
  const failedBytes = await saved(`${failedAttempt}/results.json`), failed = JSON.parse(failedBytes);
  const failedEntries = await readdir(path.join(folder, failedAttempt), { withFileTypes: true });
  assert(failedEntries.every(entry => entry.isFile()), 'Failed attempt inventory must contain regular files only');
  assert.deepEqual(failedEntries.map(entry => entry.name).sort(), ['cleanup-inventory.sql', 'results.json'], 'Failed attempt inventory contains unexpected evidence');
  assert.equal((await saved(`${failedAttempt}/cleanup-inventory.sql`)).toString(), cleanupInventorySql(m, failed.bindings), 'Failed attempt cleanup inventory differs from its owned bindings');
  const sourceBytes = await saved(`${sourceAttempt}/results.json`), source = JSON.parse(sourceBytes);
  validatePreReturnContinuation(m, failed, source);
  const required = new Set(['manifest.json', 'results.json', 'cleanup-inventory.sql']);
  for (const check of source.checks) required.add(check.screenshot.ref);
  for (const command of source.commands) required.add(command.ref);
  for (const c of m.cases) {
    for (const suffix of ['synthetic-pod.png', 'pod-fixture.json', 'private-storage.json', 'idempotency-conflict.json', 'duplicate-delivery.json']) required.add(`${c.viewport}-${suffix}`);
    for (const check of source.checks.filter(x => x.view === c.viewport && x.kind === 'negative-api')) required.add(`${c.viewport}-negative-${check.checkpoint.slice('denied-'.length)}.json`);
  }
  assert.equal(required.size, 75, 'Reviewed source archive shape changed');
  const entries = await readdir(path.join(folder, sourceAttempt), { withFileTypes: true });
  if (entries.some(e => e.name === 'parent-file-verification.json')) required.add('parent-file-verification.json');
  assert(entries.every(e => e.isFile()), 'Unexpected source archive directory or symlink'); assert.deepEqual(entries.map(e => e.name).sort(), [...required].sort());
  for (const ref of [...required].sort()) if (ref !== 'results.json') await saved(`${sourceAttempt}/${ref}`);
  const sourceFile = ref => files.get(`${sourceAttempt}/${ref}`); const parsed = ref => JSON.parse(sourceFile(ref));
  assert.deepEqual(parsed('manifest.json'), m.source); assert.equal(sourceFile('cleanup-inventory.sql').toString(), ecommerce.cleanupInventorySql(m.source, source.bindings));
  for (const check of source.checks) assert(sourceFile(check.screenshot.ref).subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'Missing/non-PNG checkpoint screenshot');
  for (const c of m.source.cases) {
    const binding = source.bindings.find(b => b.view === c.viewport);
    for (const command of source.commands.filter(cmd => cmd.orderId === binding.orderId)) {
      const raw = parsed(command.ref); assert.equal(raw.name, command.name); assert.equal(raw.payload.order_id, binding.orderId);
      assert.equal(raw.payload.action ?? null, command.action ?? null); ecommerce.assertUiPayload(c, binding.orderId, raw.name, raw.payload);
    }
    const final = source.checks.find(x => x.view === c.viewport && x.checkpoint === 'delivered-completed-reconciled').readback.snapshot;
    const fixture = parsed(`${c.viewport}-pod-fixture.json`); assert.deepEqual(fixture, final.podFixture);
    const bytes = sourceFile(fixture.ref); assert(bytes && sha(bytes) === fixture.sha256 && bytes.length === fixture.byteLength, 'Saved POD fixture hash mismatch');
    assert.deepEqual(parsed(`${c.viewport}-private-storage.json`), final.privateStorageEvidence);
    assert.deepEqual(source.privateStorageEvidence.find(x => x.view === c.viewport), final.privateStorageEvidence);
    assert.deepEqual(source.storageAttempts.find(x => x.view === c.viewport), final.privateStorageEvidence.upload);
  }
  archive.sort((a, b) => a.ref.localeCompare(b.ref));
  return { manifest: m, failed, source, archive, pins: { failedAttempt, sourceAttempt, failedSha256: sha(failedBytes), sourceSha256: sha(sourceBytes), archiveSha256: sha(json(archive)) } };
}

export function assertContinuationPins(actual, expected) {
  assert(expected && ['failedSha256', 'sourceSha256', 'archiveSha256'].every(key => /^[a-f0-9]{64}$/.test(expected[key])), 'Independent parent-pinned report/archive hashes required');
  assert.deepEqual(actual, expected, 'Pinned pre-return source artifacts changed');
}

export function continuationPinsFromEnv(env) {
  const fields = { failedAttempt: 'WMS_RETURNS_RESUME_FAILED_ATTEMPT', sourceAttempt: 'WMS_RETURNS_RESUME_SOURCE_ATTEMPT',
    failedSha256: 'WMS_RETURNS_RESUME_FAILED_SHA256', sourceSha256: 'WMS_RETURNS_RESUME_SOURCE_SHA256', archiveSha256: 'WMS_RETURNS_RESUME_ARCHIVE_SHA256' };
  if (!Object.values(fields).some(key => env[key])) return null;
  const pins = Object.fromEntries(Object.entries(fields).map(([field, key]) => [field, env[key]]));
  assert(typeof pins.failedAttempt === 'string' && typeof pins.sourceAttempt === 'string', 'All pre-return continuation pins required');
  assertContinuationPins(pins, pins); return pins;
}

export function assertFreshPreReturnSource(m, c, fresh, baseline, identities) {
  assert.deepEqual(fresh.cases, [], 'A customer case already exists; partial returns cannot resume');
  assert.deepEqual(fresh.physicalReturns, [], 'Physical custody already exists; partial returns cannot resume');
  assert.deepEqual(fresh.linkedCases, [], 'A source-linked customer case already exists'); assert.deepEqual(fresh.linkedPhysicalReturns, [], 'A source-linked physical return already exists');
  assert.deepEqual(fresh.inspections, [], 'Physical inspection already exists');
  assert.equal(fresh.orders?.length, 1); assert.equal(fresh.orders[0].id, baseline.order.id);
  ecommerce.reconcile(m.source, m.source.cases.find(row => row.viewport === c.viewport), fresh, identities);
  for (const key of ['order', 'products', 'stock', 'movements', 'reservations', 'holds', 'allocations', 'units', 'activity']) assert.deepEqual(fresh[key], baseline[key], `Fresh source ${key} differs from the pinned completed source`);
}

export function safeFailure(error, secrets = []) {
  let message = String(error?.message ?? error);
  for (const secret of secrets.filter(Boolean)) message = message.split(secret).join('[redacted]');
  return message.replace(/https?:\/\/[^\s"'<>]+/gi, '[redacted URL]').replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted token]');
}

export function assertBrowserIdentity(login, user, authorization, actorId) {
  assert(login?.user?.id === actorId && user?.id === actorId, 'Browser identity differs from authenticated API actor');
  assert(typeof login.access_token === 'string' && login.access_token.length > 0, 'Browser access token missing');
  assert(authorization === `Bearer ${login.access_token}`, 'Browser getUser did not verify the password-login session');
}

export function createManifest({ runId = randomUUID(), commit, orderDate = now().slice(0, 10) } = {}) {
  assert(!RESERVED.includes(runId.slice(0, 8)), 'Historical ecommerce run/prefix is reserved for cleanup');
  const source = ecommerce.createManifest({ runId, commit, orderDate });
  return freeze({ version: 1, kind: 'wms-customer-return-replacement', runId, commit, orderDate, ...ecommerce.TARGET, source,
    smtpIndependent: true, scope: 'Synthetic nonserialized linked customer intake, independent hold inspection/release, accepted relocation, replacement shipment and customer closure. Real human handling and delivery acceptance are not certified.',
    gaps: ['direct-accepted-without-hold', 'damaged-unavailable-disposition', 'write-off', 'vendor-return-RMA', 'refund-finance',
      're-kit', 'serialized-lot-bundle-returns', 'return-to-sender', 'concurrency-network-recovery', 'hardware-human-pilot', 'independent-cleanup'],
    cases: source.cases.map((c, index) => ({ ...c, sourceReference: c.reference, defect: `Synthetic customer case ${runId} ${c.viewport}: reported defect; return requires physical inspection.`,
      inspectionReason: `Synthetic inspection hold ${runId} ${c.viewport}: pending independent condition review`,
      releaseReason: `Synthetic reviewed condition ${runId} ${c.viewport}: accepted for restock`,
      quarantineBinId: `${c.productId}-return-qbin`, delivery: index === 0 ? { mode: 'original' } : {
        mode: 'new', customerName: 'Synthetic replacement recipient', customerContactNumber: '00000000001',
        deliveryAddress: { addressLine: 'SYNTHETIC REPLACEMENT ONLY - DO NOT SHIP', city: 'Pasig', province: 'Metro Manila', postalCode: '1600' },
        reason: `Synthetic customer-confirmed destination ${runId}` },
      replacementWaybill: `REPL-WAYBILL-${runId}-${c.viewport}`, replacementPodReference: `REPL-POD-${runId}-${c.viewport}`,
      closureReference: `CUSTOMER-CLOSURE-${runId}-${c.viewport}` })) });
}

export function validateManifest(input) {
  const expected = createManifest({ runId: input?.runId, commit: input?.commit, orderDate: input?.orderDate });
  assert.deepEqual(input, expected, 'Frozen returns manifest changed'); return expected;
}

export function assertRunPermission(m, env) {
  validateManifest(m);
  assert.equal(env.APP_ENV, 'uat'); assert.equal(env.AUDIT_MUTATIONS, 'true', 'Explicit live mutation permission required');
  assert.equal(env.WMS_RETURNS_RUN_ID, m.runId, 'Exact new returns run confirmation required');
  assert(env.AUDIT_PASSWORD, 'Secure audit password required');
  assert(!env.WMS_ECOMMERCE_RESUME_ATTEMPT, 'Historical/external continuation is forbidden');
  continuationPinsFromEnv(env);
}

export function prepareSql(input) {
  const m = validateManifest(input);
  const seed = ecommerce.prepareSql(m.source);
  assert(seed.endsWith('commit;\n'));
  return seed.slice(0, -'commit;\n'.length) + m.cases.map(c => `insert into warehouse.storage_areas(id,location_id,code,label,zone)
values(${sql(c.quarantineBinId)},${sql(c.locationId)},${sql(`${c.binCode}-RETURN`)},'Synthetic physical return inspection bin','WMS-SIGNOFF');`).join('\n') + '\ncommit;\n';
}

export async function prepare(folder, options) {
  const m = createManifest(options); folder = path.resolve(folder);
  await mkdir(path.dirname(folder), { recursive: true }); await mkdir(folder);
  await ecommerce.prepare(path.join(folder, 'source'), { runId: m.runId, commit: m.commit, orderDate: m.orderDate });
  await writeFile(path.join(folder, 'manifest.json'), json(m), { flag: 'wx' });
  await writeFile(path.join(folder, 'prepare.sql'), prepareSql(m), { flag: 'wx' });
  await writeFile(path.join(folder, 'cleanup-inventory.sql'), cleanupInventorySql(m), { flag: 'wx' });
  return m;
}

export function replacementReference(id) { assert(UUID.test(id)); return `REPL-${id.replaceAll('-', '').slice(0, 12).toUpperCase()}`; }
function replacementCase(c, binding, openingQuantity = 9) {
  return { ...c, reference: replacementReference(binding.caseId), notes: null, openingQuantity, requestedQuantity: 1,
    waybill: c.replacementWaybill, podReference: c.replacementPodReference };
}
function exactKeys(p, keys) { assert(Object.keys(p).every(key => keys.includes(key)), 'Unreviewed payload field'); }
function assertBinding(c, b, requireCase = true) {
  assert(b?.view === c.viewport && UUID.test(b.sourceOrderId), 'Owned source binding required');
  assert(![b.sourceOrderId, b.caseId, b.replacementOrderId].some(id => RESERVED_ORDERS.has(id)), 'Historical order ID is reserved for cleanup');
  if (requireCase) assert(UUID.test(b.caseId) && b.caseId !== b.sourceOrderId && b.replacementOrderId === b.caseId, 'Case/replacement binding required');
}

export function assertPhysicalPayload(c, b, role, name, p, evidence) {
  assert(p && /^[A-Za-z0-9_-]{12,128}$/.test(p.idempotency_key), 'Physical UI command key required');
  if (name === 'record_return_v2') {
    assert.equal(role, 'operations_lead');
    assert(evidence?.intake?.path, 'Uploaded intake evidence required');
    assert.deepEqual(p, { idempotency_key: p.idempotency_key, allocation_id: null, return: { source: 'customer', event_id: null,
      source_order_id: b.sourceOrderId, return_case_id: b.caseId,
      lines: [{ productId: c.productId, quantity: 1, reason: 'defective', locationId: c.locationId, binId: c.quarantineBinId, disposition: 'quarantine' }],
      evidence_urls: [evidence.intake.path] } });
  } else if (name === 'inspect_quality') {
    assert.equal(role, 'operations_associate'); assert(/^ret-[a-f0-9-]{36}$/.test(b.physicalReturnId));
    assert(evidence?.inspection?.path, 'Uploaded inspection evidence required');
    assert.deepEqual(p, { idempotency_key: p.idempotency_key, source_type: 'return', source_id: b.physicalReturnId, product_id: c.productId,
      procurement_po_line_id: null, bin_id: c.quarantineBinId, lot_id: null, serial_number: null, quantity: 1,
      disposition: 'hold', reason: c.inspectionReason, evidence_urls: [evidence.inspection.path] });
  } else if (name === 'release_quality_hold') {
    assert.equal(role, 'operations_lead'); assert(UUID.test(b.holdId)); assert(evidence?.release?.path, 'Uploaded release evidence required');
    assert.deepEqual(p, { idempotency_key: p.idempotency_key, hold_id: b.holdId, target_disposition: 'accepted', reason: c.releaseReason, evidence_urls: [evidence.release.path] });
  } else {
    assert.equal(name, 'transfer'); assert.equal(role, 'operations_associate');
    exactKeys(p, ['idempotency_key', 'command_input', 'replay_only', 'unit_ids', 'from_location_id', 'to_location_id', 'to_bin_id', 'from_stock_delta', 'to_stock_delta', 'movement']);
    assert.deepEqual(p.command_input, { productId: c.productId, locationId: c.locationId, fromBinId: c.quarantineBinId, toBinId: c.binId, quantity: 1 });
    if (p.replay_only === true) { assert.deepEqual(Object.keys(p).sort(), ['command_input', 'idempotency_key', 'replay_only']); return clone(p); }
    assert(p.replay_only == null); assert.deepEqual(p.unit_ids, []);
    assert.equal(p.from_location_id, c.locationId); assert.equal(p.to_location_id, c.locationId); assert.equal(p.to_bin_id, c.binId);
    assert.deepEqual(p.from_stock_delta, { product_id: c.productId, location_id: c.locationId, bin_id: c.quarantineBinId, delta: -1 });
    assert.deepEqual(p.to_stock_delta, { product_id: c.productId, location_id: c.locationId, bin_id: c.binId, delta: 1 });
    exactKeys(p.movement, ['id', 'type', 'product_id', 'quantity', 'from_location_id', 'from_bin_id', 'to_location_id', 'to_bin_id', 'reason', 'actor', 'created_at', 'lot_id', 'serial_number', 'event_id', 'reference', 'evidence_urls', 'unit_cost_at_movement']);
    assert(typeof p.movement.id === 'string' && p.movement.id.length > 0);
    for (const [key, value] of Object.entries({ type: 'transfer', product_id: c.productId, quantity: 1, from_location_id: c.locationId,
      to_location_id: c.locationId, from_bin_id: c.quarantineBinId, to_bin_id: c.binId, reason: 'bin relocation' })) assert.equal(p.movement[key], value);
    for (const key of ['lot_id', 'serial_number', 'event_id', 'reference']) assert(p.movement[key] == null);
    assert.deepEqual(p.movement.evidence_urls ?? [], []);
  }
  return freeze(clone(p));
}

export function assertUiPayload(m, c, b, role, name, p, closureEvidenceUrl, physicalEvidence) {
  validateManifest(m); assertBinding(c, b, name !== 'create_customer_return_case');
  assert(p && /^[A-Za-z0-9_-]{12,128}$/.test(p.idempotency_key), 'UI idempotency key required');
  if (['record_return_v2', 'inspect_quality', 'release_quality_hold', 'transfer'].includes(name)) return assertPhysicalPayload(c, b, role, name, p, physicalEvidence);
  if (name === 'create_customer_return_case') {
    assert.equal(role, 'operations_associate'); assert(!b.caseId, 'Second case creation on bound source refused');
    assert(!RESERVED_ORDERS.has(p.return_case_id), 'Historical order ID is reserved for cleanup');
    assert(UUID.test(p.return_case_id) && p.return_case_id !== b.sourceOrderId);
    assert.deepEqual(p, { idempotency_key: `create_customer_return-${p.return_case_id}`, return_case_id: p.return_case_id,
      source_order_id: b.sourceOrderId, product_id: c.productId, serial_number: null, defect_description: c.defect });
  } else if (name === 'resolve_customer_return_case') {
    assert.equal(role, 'operations_lead');
    assert.deepEqual(p, { idempotency_key: `resolve_replacement-${b.caseId}`, return_case_id: b.caseId, resolution: 'replacement',
      quarantine_bin_id: c.quarantineBinId, replacement_order_id: null, replacement_delivery: c.delivery,
      refund_reference: null, supplier_reference: null, finance_evidence_url: null });
  } else if (name === 'close_customer_return_case') {
    assert.equal(role, 'operations_associate'); assert(closureEvidenceUrl, 'Verified replacement POD required before closure');
    assert.deepEqual(p, { idempotency_key: `close_customer_return-${b.caseId}`, return_case_id: b.caseId,
      customer_resolution_reference: c.closureReference, customer_closure_evidence_url: closureEvidenceUrl });
  } else {
    assert(['advance_fulfillment_order', 'update_shipment_tracking'].includes(name), 'Unreviewed return workflow RPC');
    assert.equal(role, name === 'update_shipment_tracking' || p.action === 'release' ? 'operations_lead' : 'operations_associate');
    exactKeys(p, ['idempotency_key', 'order_id', 'action', 'picked_lines', 'fulfilled_lines', 'packaging', 'courier', 'delivery_link', 'waybill_number',
      'handover_recipient_name', 'handover_recipient_department', 'handover_reference', 'handover_evidence_url', 'acknowledgement_reference',
      'acknowledgement_evidence_url', 'cancellation_reason', 'packaging_disposition', 'tracking_reference', 'evidence_url', 'failure_reason']);
    for (const key of ['handover_recipient_name', 'handover_recipient_department', 'handover_reference', 'acknowledgement_reference', 'acknowledgement_evidence_url', 'cancellation_reason', 'packaging_disposition']) assert(p[key] == null);
    if (p.handover_evidence_url != null) assert(p.action === 'confirm_pack' && p.handover_evidence_url === `intra://handover/${b.caseId}/`);
    if (name === 'update_shipment_tracking') assert.equal(p.action, 'confirm_delivery');
    ecommerce.assertUiPayload(replacementCase(c, b), b.replacementOrderId, name, p);
  }
  return freeze(clone(p));
}

export function assertPhysicalEvidence(m, c, purpose, proof, actorId, b) {
  assert(['intake', 'inspection', 'release'].includes(purpose));
  assert.equal(proof?.purpose, purpose); assert.equal(proof.runId, m.runId); assert.equal(proof.view, c.viewport);
  assert.equal(proof.actorId, actorId); assert.equal(proof.bucket, 'evidence');
  assertPhysicalStoragePath(purpose, proof.path, b);
  assert.equal(proof.fixture.ref, `${c.viewport}-${purpose}-synthetic.png`);
  assert(/^[a-f0-9]{64}$/.test(proof.fixture.sha256) && proof.fixture.byteLength > 0);
  assert(proof.upload.httpStatus >= 200 && proof.upload.httpStatus < 300); assert.equal(proof.upload.path, proof.path);
  assert.deepEqual(proof.download, { actorId, source: 'authenticated-storage-download', sha256: proof.fixture.sha256, byteLength: proof.fixture.byteLength });
  assert([400, 401, 403, 404].includes(proof.publicReadStatus), 'Public physical evidence must not be readable');
}

export function assertPhysicalStoragePath(purpose, objectPath, b) {
  const parts = String(objectPath).split('/'); const file = parts.at(-1);
  assert(file?.endsWith('.png') && UUID.test(file.slice(0, -4)), 'Exact PNG object UUID required');
  if (purpose === 'intake') {
    assert.equal(parts.length, 3); assert.equal(parts[1], '0');
    assert((parts[0].startsWith('ref-') && UUID.test(parts[0].slice(4))) || /^return-[A-Za-z0-9._-]{1,121}$/.test(parts[0]), 'Unreviewed intake prefix');
  } else if (purpose === 'inspection') {
    assert.equal(parts.length, 4); assert.equal(parts[0], 'inspection'); assert.equal(parts[2], '0');
    assert(parts[1].startsWith('ref-') && UUID.test(parts[1].slice(4)), 'Unreviewed inspection prefix');
  } else {
    assert.equal(purpose, 'release'); assert(UUID.test(b.holdId));
    assert.deepEqual(parts.slice(0, -1), ['hold', b.holdId, 'release', '0']);
  }
}

export function assertPhysicalStage(name, stage) {
  const required = { record_return_v2: 'none', inspect_quality: 'intake', release_quality_hold: 'held', transfer: 'released', resolve_customer_return_case: 'relocated' }[name];
  if (required) assert.equal(stage, required, `Runner ${name} prerequisite not verified`);
}

export function physicalDenial(c, b, kind, evidence, actorLabel, id = randomUUID()) {
  assertBinding(c, b); assert(UUID.test(id));
  if (kind === 'unauthorized-hold-release') {
    assert(UUID.test(b.holdId) && evidence?.release?.path);
    return { kind, name: 'release_quality_hold', role: 'operations_associate', expected: 'Not authorized: warehouse.release_quality_hold',
      payload: { idempotency_key: `denied-release-${id}`, hold_id: b.holdId, target_disposition: 'accepted', reason: c.releaseReason, evidence_urls: [evidence.release.path] } };
  }
  assert(['provisional-held-transfer', 'inspected-held-transfer'].includes(kind));
  const payload = { idempotency_key: `denied-transfer-${id}`, command_input: { productId: c.productId, locationId: c.locationId, fromBinId: c.quarantineBinId, toBinId: c.binId, quantity: 1 },
    unit_ids: [], from_location_id: c.locationId, to_location_id: c.locationId, to_bin_id: c.binId,
    from_stock_delta: { product_id: c.productId, location_id: c.locationId, bin_id: c.quarantineBinId, delta: -1 },
    to_stock_delta: { product_id: c.productId, location_id: c.locationId, bin_id: c.binId, delta: 1 },
    movement: { id: `mv-${id}`, type: 'transfer', product_id: c.productId, quantity: 1, from_location_id: c.locationId,
      to_location_id: c.locationId, from_bin_id: c.quarantineBinId, to_bin_id: c.binId, reason: 'bin relocation', actor: actorLabel, created_at: now(), evidence_urls: [] } };
  assertPhysicalPayload(c, b, 'operations_associate', 'transfer', payload);
  return { kind, name: 'transfer', role: 'operations_associate', expected: 'Inventory covered by an active hold cannot be transferred', payload };
}

export async function assertPhysicalDeniedUnchanged(read, invoke, expected) {
  const before = await read(); const result = await invoke(); const after = await read();
  assert(result.error, 'Physical denial probe unexpectedly allowed'); assert.equal(result.error.message, expected);
  assert.deepEqual(after, before, 'Denied physical command changed persisted state');
  return { error: result.error.message, unchanged: true, readback: { source: 'persisted-requery-before-and-after', before, after } };
}

export function assertIntakePreview(m, c, proof, b, actorId, evidencePath) {
  assert.equal(proof?.view, c.viewport); assert.equal(proof.runId, m.runId); assert.equal(proof.commit, m.commit);
  assert.equal(proof.actorId, actorId); assert.equal(proof.path, evidencePath); assertPhysicalStoragePath('intake', proof.path, b);
  for (const key of ['restoredUnsentForm', 'restoredFocus', 'unchangedCommands', 'unchangedUploads', 'unchangedReadback']) assert.equal(proof[key], true, key);
  const f = proof.framing; assert.equal(f?.naturalWidth, 640); assert.equal(f.naturalHeight, 360); assert.equal(f.fit, 'contain');
  assert.equal(f.viewportWidth, c.viewport === 'mobile390' ? 390 : 1440);
  assert(f.width > 0 && f.height > 0 && f.x >= 0 && f.y >= 0 && f.x + f.width <= f.viewportWidth + 1 && f.y + f.height <= f.viewportHeight + 1, 'Whole image must fit viewport');
}

export function isOwnedEvidenceImage(src, objectPath) {
  if (!src) return false;
  try { const url = new URL(src); return url.origin === BASE && decodeURIComponent(url.pathname) === `/storage/v1/object/sign/evidence/${objectPath}`; }
  catch { return false; }
}

export function reconcilePhysical(m, c, s, b, actors) {
  const returns = s.physicalReturns; const inspections = s.inspections; const holds = s.holds;
  assert(Array.isArray(returns) && Array.isArray(inspections) && Array.isArray(holds), 'Complete physical readbacks required');
  const movements = s.movements.filter(row => ['return', 'transfer'].includes(row.type));
  const qstock = s.stock.filter(row => row.bin_id === c.quarantineBinId);
  assert(returns.length <= 1 && qstock.length <= 1, 'Duplicate physical custody');
  assert(s.stock.every(row => [c.binId, c.quarantineBinId].includes(row.bin_id) && row.location_id === c.locationId && row.lot_id == null && row.product_id === c.productId), 'Foreign physical stock');
  if (!returns.length) {
    for (const rows of [inspections, holds, movements, qstock, s.physicalExceptions, s.holdActivity]) assert.deepEqual(rows, []);
    return { stage: 'none', physicalReturnVerified: false, openingQuantity: 8, quarantineQuantity: 0, heldQuantity: 0 };
  }
  const r = returns[0]; assert.equal(r.id, b.physicalReturnId); assert(/^ret-[a-f0-9-]{36}$/.test(r.id));
  assert.equal(r.source, 'customer'); assert.equal(r.source_order_id, b.sourceOrderId); assert.equal(r.return_case_id, b.caseId);
  assert.equal(r.actor, actors.releaserLabel); assert(r.event_id == null); assert(Number.isFinite(Date.parse(r.created_at)));
  assert.deepEqual(r.lines, [{ productId: c.productId, quantity: 1, reason: 'defective', locationId: c.locationId, binId: c.quarantineBinId, disposition: 'quarantine' }]);
  const evidence = s.physicalEvidence; assertPhysicalEvidence(m, c, 'intake', evidence?.intake, actors.resolver, b);
  assert.deepEqual(r.evidence_urls, [evidence.intake.path]);
  const incoming = movements.filter(row => row.type === 'return'); assert.equal(incoming.length, 1);
  for (const [key, value] of Object.entries({ reference: r.id, product_id: c.productId, quantity: 1, to_location_id: c.locationId,
    to_bin_id: c.quarantineBinId, actor: actors.releaserLabel, reason: 'defective (quarantine)' })) assert.equal(incoming[0][key], value, `Physical movement ${key}`);
  for (const key of ['from_location_id', 'from_bin_id', 'lot_id', 'serial_number', 'event_id']) assert(incoming[0][key] == null);
  assert.deepEqual(incoming[0].evidence_urls, r.evidence_urls);
  assert.equal(inspections.length, 1); assert.equal(holds.length, 1);
  const i = inspections[0], h = holds[0]; assert(UUID.test(i.id) && UUID.test(h.id));
  assert.equal(i.source_type, 'return'); assert.equal(i.source_id, r.id); assert.equal(h.inspection_id, i.id);
  for (const row of [i, h]) {
    for (const [key, value] of Object.entries({ product_id: c.productId, location_id: c.locationId, bin_id: c.quarantineBinId, quantity: 1 })) assert.equal(row[key], value);
    assert(row.lot_id == null && row.serial_number == null);
  }
  let stage;
  if (i.disposition === 'pending') {
    stage = 'intake'; assert.equal(i.inspected_by, actors.resolver); assert.equal(h.created_by, actors.resolver);
    assert.equal(h.reason, 'Awaiting independent quality inspection'); assert.equal(h.status, 'active');
    assert.deepEqual(i.evidence_urls, r.evidence_urls); assert.deepEqual(h.evidence_urls, r.evidence_urls);
    assert.deepEqual(s.physicalExceptions, []); assert.deepEqual(s.holdActivity, []);
  } else {
    assert.equal(i.id, b.inspectionId); assert.equal(h.id, b.holdId);
    assert.notEqual(actors.creator, actors.resolver); assert.equal(i.inspected_by, actors.creator); assert.equal(h.created_by, actors.creator);
    assertPhysicalEvidence(m, c, 'inspection', evidence.inspection, actors.creator, b);
    assert.deepEqual(h.evidence_urls, [evidence.inspection.path]); assert.equal(h.reason, c.inspectionReason);
    assert.equal(s.physicalExceptions.length, 1); const exception = s.physicalExceptions[0];
    assert.equal(exception.source_type, 'quality_inspection'); assert.equal(exception.source_id, i.id); assert.equal(exception.created_by, actors.creator);
    assert.equal(exception.exception_type, 'quality');
    if (h.status === 'active') {
      stage = 'held'; assert.equal(i.disposition, 'hold'); assert.equal(i.reason, c.inspectionReason);
      assert.deepEqual(i.evidence_urls, [evidence.inspection.path]); assert.equal(exception.status, 'open'); assert.deepEqual(s.holdActivity, []);
    } else {
      stage = 'released'; assert.equal(h.status, 'released'); assert.equal(h.released_by, actors.resolver); assert(Number.isFinite(Date.parse(h.released_at)));
      assert.equal(h.release_reason, c.releaseReason); assert.equal(i.disposition, 'accepted'); assert.equal(i.reason, c.releaseReason);
      assertPhysicalEvidence(m, c, 'release', evidence.release, actors.resolver, b);
      for (const urls of [h.release_evidence_urls, i.evidence_urls, exception.evidence_urls]) assert.deepEqual(urls, [evidence.release.path]);
      assert.equal(exception.status, 'resolved'); assert.equal(exception.resolution, c.releaseReason);
      assert.equal(s.holdActivity.length, 1); assert.equal(s.holdActivity[0].action, 'released');
      assert.equal(s.holdActivity[0].entity_id, h.id); assert.equal(s.holdActivity[0].entity_type, 'inventory_hold'); assert.equal(s.holdActivity[0].actor, actors.resolver);
    }
  }
  const transfers = movements.filter(row => row.type === 'transfer'); assert(transfers.length <= 1);
  if (transfers.length) {
    assert.equal(stage, 'released', 'Held return cannot be relocated'); stage = 'relocated';
    const move = transfers[0]; assert.equal(move.id, b.relocationId);
    for (const [key, value] of Object.entries({ product_id: c.productId, quantity: 1, from_location_id: c.locationId, to_location_id: c.locationId,
      from_bin_id: c.quarantineBinId, to_bin_id: c.binId, reason: 'bin relocation', actor: actors.creatorLabel })) assert.equal(move[key], value, `Relocation ${key}`);
    for (const key of ['reference', 'event_id', 'serial_number', 'lot_id']) assert(move[key] == null);
    assert.deepEqual(move.evidence_urls ?? [], []);
  }
  assert.equal(qstock.length, 1); assert.equal(qstock[0].quantity, stage === 'relocated' ? 0 : 1);
  if (h.status === 'active') assert(h.released_by == null && h.released_at == null);
  return { stage, physicalReturnVerified: stage === 'relocated', openingQuantity: stage === 'relocated' ? 9 : 8,
    quarantineQuantity: qstock[0].quantity, heldQuantity: h.status === 'active' ? 1 : 0 };
}

export function reconcile(m, c, s, b, baseline, actors) {
  assertBinding(c, b, s.cases.length > 0);
  assert.deepEqual(s.sourceOrder, baseline.order, 'Original delivered order must remain unchanged');
  assert.equal(baseline.order.id, b.sourceOrderId); assert.equal(baseline.order.status, 'completed');
  assert.equal(baseline.order.external_reference, c.sourceReference); assert.equal(baseline.order.source_location_id, c.locationId);
  assert.equal(baseline.order.lines.length, 1); assert.equal(baseline.order.lines[0].productId, c.productId); assert.equal(baseline.order.lines[0].quantity, 2);
  const physical = reconcilePhysical(m, c, s, b, actors);
  assert.deepEqual(s.reservations.filter(r => r.order_id === b.sourceOrderId), baseline.reservations, 'Original reservations changed');
  assert.deepEqual(s.movements.filter(r => r.reference === b.sourceOrderId), baseline.movements, 'Original issue changed');
  assert(s.cases.length <= 1 && s.orders.length <= 1, 'Duplicate/foreign case or replacement');
  const r = s.cases[0]; const order = s.orders[0] ?? null;
  if (r) {
    for (const [key, expected] of Object.entries({ id: b.caseId, product_id: c.productId, source_order_id: b.sourceOrderId,
      serial_number: null, defect_description: c.defect, created_by: actors.creator })) assert.equal(r[key], expected, `Case ${key}`);
    assert(['submitted', 'resolved', 'closed'].includes(r.status));
    const audit = (action, actor) => {
      const rows = s.caseActivity.filter(x => x.action === action); assert.equal(rows.length, 1, `Exactly one ${action} audit required`);
      for (const [key, value] of Object.entries({ actor, entity_id: b.caseId, module: 'warehouse', entity_type: 'customer_return_case' })) assert.equal(rows[0][key], value);
    };
    audit('submitted', actors.creator);
    if (r.status === 'submitted') { assert.equal(r.resolution, 'pending'); assert.equal(order, null); }
    else {
      assert(physical.physicalReturnVerified, 'Physical intake, QC, independent release and relocation required before this runner resolves the case');
      assert.equal(r.resolution, 'replacement'); assert.equal(r.quarantine_bin_id, c.quarantineBinId); assert.equal(r.replacement_order_id, b.caseId);
      assert.equal(r.resolved_by, actors.resolver); assert(r.resolved_at); assert.deepEqual(r.replacement_delivery, c.delivery);
      audit('resolved', actors.resolver); audit('replacement_delivery_confirmed', actors.resolver);
      assert(order && order.id === b.caseId);
      const destination = c.delivery.mode === 'original' ? { customer_name: baseline.order.customer_name, customer_contact: baseline.order.customer_contact, delivery_address: baseline.order.delivery_address }
        : { customer_name: c.delivery.customerName, customer_contact: c.delivery.customerContactNumber, delivery_address: c.delivery.deliveryAddress };
      for (const [key, value] of Object.entries(destination)) assert.deepEqual(order[key], value, `Confirmed replacement ${key}`);
    }
    if (r.status === 'closed') {
      assert.equal(order?.status, 'completed', 'Runner must verify replacement delivery before customer closure');
      assert.equal(r.customer_resolution_reference, c.closureReference); assert.equal(r.customer_closed_by, actors.creator); assert(r.customer_closed_at);
      assert.equal(r.customer_closure_evidence_url, `${BASE}/storage/v1/object/authenticated/evidence/${order.proof_of_delivery_evidence_url}`);
      audit('customer_closed', actors.creator);
    }
  } else assert.equal(order, null);
  const projected = { ...s, order, holds: [], stock: s.stock.filter(x => x.bin_id === c.binId), reservations: s.reservations.filter(x => x.order_id !== b.sourceOrderId),
    movements: s.movements.filter(x => x.reference !== b.sourceOrderId && !['return', 'transfer'].includes(x.type)) };
  // The replacement consumes one additional unit; original issue/reservation remain immutable.
  const inventory = ecommerce.reconcile(m.source, { ...replacementCase(c, { ...b, caseId: b.caseId ?? '00000000-0000-4000-8000-000000000001' }, physical.openingQuantity) }, projected,
    { ...actors, creator: actors.resolver });
  return { ...inventory, onHand: inventory.onHand + physical.quarantineQuantity, held: physical.heldQuantity, heldQuantity: physical.heldQuantity,
    available: inventory.available + physical.quarantineQuantity - physical.heldQuantity,
    physicalStage: physical.stage, physicalReturnVerified: physical.physicalReturnVerified, replacementDelivered: order?.status === 'completed', customerClosed: r?.status === 'closed' };
}

export function assertComplete(m, report) {
  assert.equal(report.runId, m.runId); assert.equal(report.commit, m.commit); assert.deepEqual(report.failures, []);
  assert.equal(report.bindings?.length, 2, 'Complete scope bindings required');
  assert(Array.isArray(report.actors) && report.actors.length === 2, 'Authenticated actor evidence required');
  const creator = report.actors.find(a => a.role === 'operations_associate'); const resolver = report.actors.find(a => a.role === 'operations_lead');
  assert(UUID.test(creator?.id) && UUID.test(resolver?.id) && creator.id !== resolver.id, 'Independent actor evidence required');
  const actors = { creator: creator.id, creatorLabel: creator.authoritativeActor, resolver: resolver.id, picker: creator.id, releaser: resolver.id, releaserLabel: resolver.authoritativeActor };
  assert.equal(new Set(report.bindings.flatMap(b => [b.sourceOrderId, b.caseId])).size, 4, 'Duplicate scope binding');
  for (const key of ['physicalReturnId', 'inspectionId', 'holdId', 'relocationId']) assert.equal(new Set(report.bindings.map(b => b[key])).size, 2, `Duplicate physical ${key}`);
  const refs = new Set();
  for (const c of m.cases) {
    const b = report.bindings.find(x => x.view === c.viewport); assertBinding(c, b);
    for (const [role, actorId] of [['operations_associate', creator.id], ['operations_lead', resolver.id]]) {
      const sessions = report.browserActors?.filter(x => x.view === c.viewport && x.role === role); assert.equal(sessions?.length, 1, 'Verified browser session evidence required');
      assert.equal(sessions[0].actorId, actorId); assert.equal(sessions[0].source, 'browser-password-login-and-auth.getUser');
    }
    const checks = report.checks.filter(x => x.view === c.viewport);
    assert.deepEqual(checks.map(x => x.checkpoint), CHECKPOINTS, 'Missing/duplicate/reordered checkpoint evidence');
    assert.notEqual(checks[2].readback.snapshot.inspections[0].id, checks[3].readback.snapshot.inspections[0].id, 'Full inspection must replace provisional inspection');
    assert.notEqual(checks[2].readback.snapshot.holds[0].id, checks[3].readback.snapshot.holds[0].id, 'Full inspection must replace provisional hold');
    for (const [name, actorId] of [['record_return_v2', resolver.id], ['inspect_quality', creator.id], ['release_quality_hold', resolver.id], ['transfer', creator.id]]) {
      const replays = report.negatives?.filter(x => x.view === c.viewport && x.kind === 'exact-successful-command-replay' && x.name === name);
      assert.equal(replays?.length, 1, 'Physical replay verification required'); assert.equal(replays[0].actorId, actorId); assert.equal(replays[0].unchanged, true);
      assert.equal(replays[0].runId, m.runId); assert.equal(replays[0].commit, m.commit);
    }
    for (const [kind, stage] of [['provisional-held-transfer', 'intake'], ['inspected-held-transfer', 'held'], ['unauthorized-hold-release', 'held']]) {
      const denials = report.negatives?.filter(x => x.view === c.viewport && x.kind === kind); assert.equal(denials?.length, 1, 'Physical backend denial evidence required');
      const denial = denials[0]; assert.equal(denial.actorId, creator.id); assert.equal(denial.unchanged, true);
      assert.equal(denial.runId, m.runId); assert.equal(denial.commit, m.commit);
      assert.equal(denial.readback?.source, 'persisted-requery-before-and-after'); assert.deepEqual(denial.readback.before, denial.readback.after);
      assert.equal(reconcile(m, c, denial.readback.before, b, report.baselines[c.viewport], actors).physicalStage, stage);
      const key = denial.payload?.idempotency_key; assert(typeof key === 'string');
      const expected = physicalDenial(c, b, kind, denial.readback.before.physicalEvidence, creator.authoritativeActor, key.slice(-36));
      assert.equal(denial.name, expected.name); assert.equal(denial.error, expected.expected);
      if (expected.name === 'transfer') {
        assert.equal(key, expected.payload.idempotency_key); assert.equal(denial.payload.movement.id, expected.payload.movement.id);
        assertPhysicalPayload(c, b, 'operations_associate', 'transfer', denial.payload); assert(denial.payload.replay_only == null);
      } else assert.deepEqual(denial.payload, expected.payload);
    }
    const previews = report.previews?.filter(x => x.view === c.viewport); assert.equal(previews?.length, 1, 'One pre-submit preview verification required');
    assertIntakePreview(m, c, previews[0], b, resolver.id, checks[2].readback.snapshot.physicalEvidence.intake.path);
    for (const checkpoint of ['physical-intake-evidence-preview', 'physical-intake-preview-closed-unsent']) {
      const forms = report.formEvidence?.filter(x => x.view === c.viewport && x.checkpoint === checkpoint); assert.equal(forms?.length, 1, 'Preview/unsent screenshot evidence required');
      const form = forms[0]; assert.equal(form.runId, m.runId); assert.equal(form.commit, m.commit); assert.equal(form.actor?.id, resolver.id);
      assert.equal(form.readback?.source, 'persisted-requery'); assert.deepEqual(form.readback.snapshot.physicalReturns, []);
      assert.deepEqual(form.result, reconcile(m, c, form.readback.snapshot, b, report.baselines[c.viewport], actors));
      assert.equal(form.screenshot?.sessionActorId, resolver.id); assert(/^[a-f0-9]{64}$/.test(form.screenshot.sha256) && form.screenshot.byteLength > 0);
      assert(/^[A-Za-z0-9_-]+\.png$/.test(form.screenshot.ref) && !refs.has(form.screenshot.ref)); refs.add(form.screenshot.ref);
    }
    for (const check of checks) {
      assert.equal(check.runId, m.runId); assert.equal(check.commit, m.commit);
      assert(UUID.test(check.actor?.id)); assert.equal(check.readback?.source, 'persisted-requery');
      assert(check.readback.snapshot?.sourceOrder?.id === b.sourceOrderId, 'Persisted source readback required');
      const index = CHECKPOINTS.indexOf(check.checkpoint); const snapshot = check.readback.snapshot;
      const expectedOrder = [null, null, null, null, null, null, 'received', 'allocated', 'picking', 'packing', 'ready', 'released', 'completed', 'completed'][index];
      const expectedCase = index === 0 ? null : index <= 5 ? 'submitted' : index === 13 ? 'closed' : 'resolved';
      assert.equal(snapshot.orders?.[0]?.status ?? null, expectedOrder, 'Wrong checkpoint order stage');
      assert.equal(snapshot.cases?.[0]?.status ?? null, expectedCase, 'Wrong checkpoint case stage');
      assert.equal(check.actor.id, [2, 4, 6, 11, 12].includes(index) ? resolver.id : creator.id, 'Wrong checkpoint actor');
      assert.equal(check.result.physicalStage, index < 2 ? 'none' : ['intake', 'held', 'released'][index - 2] ?? 'relocated', 'Wrong physical checkpoint stage');
      assert(report.baselines?.[c.viewport], 'Original source readback required');
      assert.deepEqual(check.result, reconcile(m, c, snapshot, b, report.baselines[c.viewport], actors), 'Unverified checkpoint result');
      const shot = check.screenshot;
      assert(shot && /^[A-Za-z0-9_-]+\.png$/.test(shot.ref) && !refs.has(shot.ref) && /^[a-f0-9]{64}$/.test(shot.sha256) && shot.byteLength > 0, 'Unique hashed UI evidence required');
      refs.add(shot.ref); assert.equal(shot.sessionActorId, check.actor.id);
    }
    assert(checks.at(-1).result?.customerClosed && checks.at(-1).result?.replacementDelivered, 'Persisted closure and delivery required');
  }
}

export function cleanupInventorySql(input, bindings = []) {
  const m = validateManifest(input);
  for (const b of bindings) assertBinding(m.cases.find(c => c.viewport === b.view), b, !!b.caseId);
  const products = m.cases.map(c => sql(c.productId)).join(',');
  return `-- Read-only discovery for ${m.runId}; not deletion authorization. Keep all attempts, PODs and closure references.
-- Customer cases, replacement IDs (same UUID), commands, activity, evidence registrations and unknown FK/JSON branches need independent review.
begin read only; set local row_security=off;
select jsonb_build_object('runId',${sql(m.runId)},'allResidueVerified',false,
 'cases',(select jsonb_agg(to_jsonb(r)) from warehouse.customer_return_cases r where product_id in (${products})),
 'orders',(select jsonb_agg(to_jsonb(r)) from warehouse.fulfillment_orders r where exists(select 1 from jsonb_array_elements(r.lines) l where l->>'productId' in (${products}))),
 'bins',(select jsonb_agg(to_jsonb(r)) from warehouse.storage_areas r where id in (${m.cases.map(c => sql(c.quarantineBinId)).join(',')})),
 'stock',(select jsonb_agg(to_jsonb(r)) from warehouse.stock_levels r where product_id in (${products})),
 'physicalReturns',(select jsonb_agg(to_jsonb(r)) from warehouse.returns r where exists(select 1 from jsonb_array_elements(r.lines) l where l->>'productId' in (${products}))),
 'inspections',(select jsonb_agg(to_jsonb(r)) from warehouse.quality_inspections r where product_id in (${products})),
 'holds',(select jsonb_agg(to_jsonb(r)) from warehouse.inventory_holds r where product_id in (${products})),
 'qualityExceptions',(select jsonb_agg(to_jsonb(r)) from warehouse.exceptions r where source_type='quality_inspection' and source_id in (select id::text from warehouse.quality_inspections where product_id in (${products}))),
 'movements',(select jsonb_agg(to_jsonb(r)) from warehouse.movements r where product_id in (${products}))) as inventory;
commit;
`;
}

async function health(m) {
  const response = await fetch(`${m.origin}/api/health?returns=${Date.now()}`, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20000) });
  assert(response.ok); const body = await response.json(); ecommerce.assertHealth(body, m); return body;
}

export async function run(folder, env = process.env) {
  folder = path.resolve(folder);
  const m = validateManifest(JSON.parse(await readFile(path.join(folder, 'manifest.json'), 'utf8'))); assertRunPermission(m, env);
  assert.deepEqual(JSON.parse(await readFile(path.join(folder, 'source', 'manifest.json'), 'utf8')), m.source);
  const pins = continuationPinsFromEnv(env);
  const continuation = pins ? await inspectPreReturnContinuation(folder, pins.failedAttempt, pins.sourceAttempt) : null;
  if (continuation) { assertContinuationPins(continuation.pins, pins); assert.deepEqual(continuation.manifest, m); }
  else assert(!(await readdir(folder)).some(name => name.startsWith('attempt-')), 'Existing returns attempt requires the explicitly pinned pre-return continuation; never rerun as fresh');
  const lockPath = path.join(folder, 'run.lock'); const lock = await open(lockPath, 'wx');
  const attempt = path.join(folder, `attempt-${now().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
  const actors = {}; let browser; let activePage; let guardError; let pendingOperation;
  const failure = error => safeFailure(error, [env.AUDIT_PASSWORD]);
  const report = { runId: m.runId, commit: m.commit, environment: 'uat', startedAt: now(), complete: false, smtpIndependent: true,
    globalWmsSignoff: false, scope: m.scope, gaps: m.gaps, bindings: [], checks: [], formEvidence: [], negatives: [], commands: [], bootstrapCommands: [], storageAttempts: [], failures: [],
    cleanup: { status: 'pending-independent-review', allResidueVerified: false,
      policy: 'Retain all evidence and rows after success or failure; never auto-delete, reseed, grant or retry uncertain writes. Customer cases and replacements require separate dependency review; never use ecommerce-only cleanup after a case exists.' } };
  if (continuation) report.continuation = { boundary: 'source-complete-before-any-return', ...pins, archive: continuation.archive, previousReturnCheckCount: 0, sourceCommandsReplayed: false };
  let writes = Promise.resolve();
  const persist = () => { const text = json(report); writes = writes.then(() => writeFile(path.join(attempt, 'results.json'), text)); return writes; };
  try {
    await mkdir(attempt); await persist(); await health(m);
    const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
    const { chromium, expect: baseExpect } = require('@playwright/test'); const expect = baseExpect.configure({ timeout: 25000 });
    const { createClient } = require('@supabase/supabase-js'); const { auditPersonas } = await import('./uat-audit-identities.mjs');
    for (const role of ROLES) {
      const persona = auditPersonas('checkpoint-v1').find(p => p.role === role); assert(persona);
      const client = createClient(BASE, 'sb_publishable_7YRN3Sg0Cm8QRoDt6IszlA_yAuRD5u9', { auth: { persistSession: false },
        global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.any([AbortSignal.timeout(20000), init?.signal].filter(Boolean)) }) } });
      actors[role] = { client, persona };
      const login = await client.auth.signInWithPassword({ email: persona.email, password: env.AUDIT_PASSWORD }); assert(!login.error && login.data.user);
      const id = login.data.user.id; const profile = await client.schema('core').from('profiles').select('id,email').eq('id', id).single();
      assert(!profile.error && profile.data.id === id); actors[role].id = id;
      actors[role].label = profile.data.email == null || profile.data.email === '' ? id : profile.data.email;
      const caps = await client.schema('core').rpc('my_capability_snapshot'); assert(!caps.error);
      for (const cap of role === 'operations_associate' ? ['submit_return_case', 'reserve_allocate', 'issue_items', 'inspect_quality', 'transfer_stock'] : ['manage_returns', 'issue_items', 'release_quality_hold']) {
        assert(caps.data?.userCapabilities?.warehouse?.includes(cap), `Missing governed capability ${role}:${cap}; do not grant or bypass`);
      }
      if (role === 'operations_associate') assert(!caps.data?.userCapabilities?.warehouse?.includes('release_quality_hold'), 'This denial scenario requires the existing associate without release authority; do not change roles');
      report.actors ??= []; report.actors.push({ role, id, authoritativeActor: actors[role].label, capabilities: caps.data });
    }
    const identities = { creator: actors.operations_associate.id, creatorLabel: actors.operations_associate.label, resolver: actors.operations_lead.id, picker: actors.operations_associate.id,
      releaser: actors.operations_lead.id, releaserLabel: actors.operations_lead.label };
    assert.notEqual(identities.creator, identities.resolver); await persist();
    const lineage = await actors.operations_lead.client.schema('warehouse').from('returns').select('source_order_id,return_case_id').limit(0);
    assert(!lineage.error, 'Reviewed physical lineage migration must be deployed before any source-order run');
    // Preflight returns authority before the new, manifest-owned source-order UI run.
    const original = continuation ? { attempt: path.join(folder, pins.sourceAttempt), report: continuation.source }
      : await ecommerce.run(path.join(folder, 'source'), { ...env, WMS_ECOMMERCE_RUN_ID: m.runId });
    const sourceBytes = await readFile(path.join(original.attempt, 'results.json'));
    original.report = assertSavedSourceReport(sourceBytes, original.report); assert.equal(original.report.runId, m.runId); assert.equal(original.report.commit, m.commit);
    report.sourceAttempt = { ref: path.relative(folder, original.attempt).replaceAll('\\', '/'), sha256: sha(sourceBytes), runId: m.runId, commit: m.commit };
    await persist();
    assert(original.report.complete && original.report.failures.length === 0, 'New source shipment run failed; no returns may start');
    for (const role of ROLES) assert.equal(original.report.actors.find(a => a.role === role)?.id, actors[role].id, 'Source/returns actors changed');
    const rows = (...args) => readScopedRows(actors.operations_lead.client, ...args);
    if (continuation) {
      for (const role of ROLES) {
        const old = continuation.failed.actors.find(a => a.role === role), current = report.actors.find(a => a.role === role);
        assert.equal(current.id, old.id); assert.equal(current.authoritativeActor, old.authoritativeActor); assert.deepEqual(current.capabilities, old.capabilities, 'Continuation roles/capabilities changed');
      }
      for (const file of continuation.archive) {
        const target = path.resolve(folder, file.ref); assert.equal(path.relative(await realpath(folder), await realpath(target)).replaceAll('\\', '/'), file.ref);
        const bytes = await readFile(target); assert.equal(sha(bytes), file.sha256); assert.equal(bytes.length, file.byteLength);
      }
      report.continuation.freshReadbacks = [];
      for (const c of m.cases) {
        const baseline = original.report.checks.find(x => x.view === c.viewport && x.checkpoint === 'delivered-completed-reconciled').readback.snapshot;
        const fresh = { ...clone(baseline), orders: await rows('warehouse', 'fulfillment_orders', 'lines', [{ productId: c.productId }], true) };
        fresh.order = fresh.orders[0]; fresh.cases = await rows('warehouse', 'customer_return_cases', 'product_id', c.productId);
        fresh.physicalReturns = await rows('warehouse', 'returns', 'lines', [{ productId: c.productId }], true);
        fresh.linkedCases = await rows('warehouse', 'customer_return_cases', 'source_order_id', baseline.order.id);
        fresh.linkedPhysicalReturns = await rows('warehouse', 'returns', 'source_order_id', baseline.order.id);
        for (const [key, table] of Object.entries({ products: 'products', stock: 'stock_levels', movements: 'movements', reservations: 'fulfillment_reservations',
          holds: 'inventory_holds', allocations: 'allocations', units: 'inventory_units', inspections: 'quality_inspections' })) fresh[key] = await rows('warehouse', table, key === 'products' ? 'id' : 'product_id', c.productId);
        fresh.activity = await rows('core', 'activity_log', 'entity_id', baseline.order.id);
        assertFreshPreReturnSource(m, c, fresh, baseline, identities);
        const downloads = [];
        for (const role of ROLES) {
          const downloaded = await actors[role].client.storage.from('evidence').download(baseline.order.proof_of_delivery_evidence_url);
          assert(!downloaded.error && downloaded.data, 'Pinned source POD is no longer privately readable');
          const bytes = Buffer.from(await downloaded.data.arrayBuffer()); assert.equal(sha(bytes), baseline.podFixture.sha256); assert.equal(bytes.length, baseline.podFixture.byteLength);
          downloads.push({ actorId: actors[role].id, sha256: sha(bytes), byteLength: bytes.length });
        }
        report.continuation.freshReadbacks.push({ view: c.viewport, snapshot: fresh, downloads, observedAt: now() }); await persist();
      }
      await health(m);
    }
    browser = await chromium.launch();
    for (const c of m.cases) {
      const sourceBinding = original.report.bindings.find(b => b.view === c.viewport); assert(sourceBinding);
      const sourceCheck = original.report.checks.filter(x => x.view === c.viewport && x.checkpoint === 'delivered-completed-reconciled'); assert.equal(sourceCheck.length, 1);
      const baseline = sourceCheck[0].readback.snapshot;
      report.baselines ??= {}; report.baselines[c.viewport] = clone(baseline);
      ecommerce.reconcile(m.source, m.source.cases.find(x => x.viewport === c.viewport), baseline, { ...identities, creator: identities.creator });
      const b = { view: c.viewport, sourceOrderId: sourceBinding.orderId, caseId: null, replacementOrderId: null }; report.bindings.push(b);
      let closureEvidenceUrl; let podFixture = null; let privateStorageEvidence = null; const contexts = []; const pages = {}; const physicalEvidence = {};
      const read = async () => {
        const allOrders = await rows('warehouse', 'fulfillment_orders', 'lines', [{ productId: c.productId }], true);
        const source = allOrders.filter(o => o.id === b.sourceOrderId); assert.equal(source.length, 1);
        const snapshot = { sourceOrder: source[0], orders: allOrders.filter(o => o.id !== b.sourceOrderId), cases: await rows('warehouse', 'customer_return_cases', 'product_id', c.productId) };
        for (const [key, table] of Object.entries({ products: 'products', stock: 'stock_levels', reservations: 'fulfillment_reservations', movements: 'movements', holds: 'inventory_holds', inspections: 'quality_inspections', units: 'inventory_units', allocations: 'allocations' })) {
          snapshot[key] = await rows('warehouse', table, key === 'products' ? 'id' : 'product_id', c.productId);
        }
        snapshot.physicalReturns = await rows('warehouse', 'returns', 'lines', [{ productId: c.productId }], true);
        snapshot.physicalExceptions = []; snapshot.holdActivity = [];
        for (const inspection of snapshot.inspections) snapshot.physicalExceptions.push(...await rows('warehouse', 'exceptions', 'source_id', inspection.id));
        for (const hold of snapshot.holds) snapshot.holdActivity.push(...await rows('core', 'activity_log', 'entity_id', hold.id));
        snapshot.physicalEvidence = clone(physicalEvidence);
        const audit = b.caseId ? await readJourneyActivity(ROLES.map(role => actors[role]), b.caseId) : { rows: [], readbacks: [] };
        const allActivity = audit.rows; snapshot.activityReadbacks = audit.readbacks;
        // Case and replacement deliberately share a UUID; entity type must disambiguate their audits.
        snapshot.caseActivity = allActivity.filter(x => x.entity_type === 'customer_return_case');
        snapshot.activity = allActivity.filter(x => x.entity_type === 'fulfillment_order');
        snapshot.podFixture = podFixture; snapshot.privateStorageEvidence = privateStorageEvidence; return snapshot;
      };
      const check = snapshot => reconcile(m, c, snapshot, b, baseline, identities);
      const capture = async (checkpoint, role, form = false) => {
        assert(!guardError, guardError); const snapshot = await read(); const result = check(snapshot);
        const ref = `${c.viewport}-${checkpoint}.png`;
        const geometry = await ecommerce.captureCheckpointViewport(activePage, path.join(attempt, ref));
        const bytes = await readFile(path.join(attempt, ref));
        (form ? report.formEvidence : report.checks).push({ checkpoint, view: c.viewport, runId: m.runId, commit: m.commit, actor: { id: actors[role].id, role },
          readback: { source: 'persisted-requery', snapshot }, result, screenshot: { ref, sha256: sha(bytes), byteLength: bytes.length, sessionActorId: actors[role].id, reviewed: false, ...geometry } });
        await persist(); assert(geometry.contentWidth <= geometry.width + 1, 'UI horizontal overflow');
      };
      const pageFor = async role => {
        if (!pages[role]) {
          const mobile = c.viewport === 'mobile390';
          const context = await browser.newContext({ viewport: { width: mobile ? 390 : 1440, height: mobile ? 844 : 900 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' }); contexts.push(context);
          await context.route(`${BASE}/rest/v1/**`, async route => {
            const request = route.request(); if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
            try {
              assert.equal(request.method(), 'POST'); const schema = request.headers()['content-profile']; const name = new URL(request.url()).pathname.split('/').at(-1);
              assert(new URL(request.url()).pathname.startsWith('/rest/v1/rpc/'));
              if (ecommerce.isReviewedReadRpc(schema, name)) return route.continue();
              if (ecommerce.isOwnLearningBootstrap(schema, name, request.postDataJSON())) {
                report.bootstrapCommands.push({ schema, name, role, actorId: actors[role].id, observedAt: now() }); await persist(); return route.continue();
              }
              assert.equal(schema, 'warehouse'); assert.equal(pendingOperation?.name, name, 'Unarmed UI mutation refused'); assert.equal(pendingOperation?.role, role);
              const payload = assertUiPayload(m, c, b, role, name, request.postDataJSON()?.payload, closureEvidenceUrl, physicalEvidence);
              const probe = name === 'transfer' && payload.replay_only === true;
              assert(!pendingOperation[probe ? 'probeSent' : 'sent'], 'Duplicate UI command refused');
              if (name === 'transfer' && !probe) {
                assert(pendingOperation.probeSent, 'Relocation must retain the existing replay probe');
                assert.equal(payload.idempotency_key, pendingOperation.probePayload.idempotency_key);
                assert.deepEqual(payload.command_input, pendingOperation.probePayload.command_input);
              }
              if (probe) pendingOperation.probePayload = payload;
              pendingOperation[probe ? 'probeSent' : 'sent'] = true;
              await health(m);
              assertPhysicalStage(name, check(await read()).physicalStage);
              if (name === 'create_customer_return_case') {
                assert.equal((await rows('warehouse', 'fulfillment_orders', 'id', payload.return_case_id)).length, 0, 'New case UUID collides with an existing order');
                assert.equal((await rows('warehouse', 'customer_return_cases', 'id', payload.return_case_id)).length, 0, 'New case UUID already exists');
                b.caseId = payload.return_case_id; b.replacementOrderId = payload.return_case_id;
              }
              if (name === 'update_shipment_tracking') assert(report.storageAttempts.some(x => x.path === payload.evidence_url && x.httpStatus >= 200 && x.httpStatus < 300));
              const ref = `${c.viewport}-command-${report.commands.length}.json`;
              await writeFile(path.join(attempt, ref), json({ name, payload, actorId: actors[role].id }), { flag: 'wx' });
              report.commands.push({ ref, name, payload, view: c.viewport, actorId: actors[role].id, observedAt: now() }); await persist(); await route.continue();
            } catch (error) { guardError = failure(error); await route.abort('blockedbyclient'); }
          });
          await context.route(`${BASE}/storage/v1/**`, async route => {
            const request = route.request(); if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue();
            try {
              const pathname = decodeURIComponent(new URL(request.url()).pathname);
              if (request.method() === 'POST' && pathname.startsWith('/storage/v1/object/sign/evidence/')) return route.continue();
              assert.equal(request.method(), 'POST'); assert.equal(pendingOperation?.role, role);
              assert(['pod-upload', 'physical-upload'].includes(pendingOperation.name));
              assert(pathname.startsWith('/storage/v1/object/evidence/'));
              const purpose = pendingOperation.purpose ?? 'pod';
              const objectPath = pathname.slice('/storage/v1/object/evidence/'.length);
              if (purpose === 'pod') {
                assert.equal(role, 'operations_lead');
                const prefix = `delivery-${b.caseId}/0/`; assert(objectPath.startsWith(prefix));
                const filename = objectPath.slice(prefix.length); assert(filename.endsWith('.png') && UUID.test(filename.slice(0, -4)));
              } else {
                assert.equal(role, purpose === 'inspection' ? 'operations_associate' : 'operations_lead');
                assertPhysicalStoragePath(purpose, objectPath, b);
                assert.equal(sha(request.postDataBuffer()), pendingOperation.sha256, 'Unreviewed physical evidence bytes');
              }
              assert.equal(request.headers()['x-upsert'] ?? 'false', 'false');
              assert(!report.storageAttempts.some(x => x.view === c.viewport && x.purpose === purpose), 'Second evidence upload refused');
              report.storageAttempts.push({ purpose, view: c.viewport, orderId: b.caseId, actorId: actors[role].id, path: objectPath, bucket: 'evidence', method: 'POST', requestUrl: request.url(), status: 'attempted-not-cleaned' });
              await persist(); await route.continue();
            } catch (error) { guardError = failure(error); await route.abort('blockedbyclient'); }
          });
          const page = await context.newPage(); pages[role] = page; activePage = page; page.setDefaultTimeout(25000);
          await page.goto(`${m.origin}/login?redirect=%2Fwarehouse%2Ffulfillment`);
          await page.locator('#email').fill(actors[role].persona.email); await page.locator('#password').fill(env.AUDIT_PASSWORD);
          const loginWait = page.waitForResponse(r => r.request().method() === 'POST' && r.url().startsWith(`${BASE}/auth/v1/token?grant_type=password`)); loginWait.catch(() => {});
          const userWait = page.waitForResponse(r => r.request().method() === 'GET' && r.url() === `${BASE}/auth/v1/user`); userWait.catch(() => {});
          await page.getByRole('button', { name: /^sign in$/i }).click();
          const loginResponse = await loginWait; assert(loginResponse.ok()); const login = await loginResponse.json();
          const userResponse = await userWait; assert(userResponse.ok());
          assertBrowserIdentity(login, await userResponse.json(), (await userResponse.request().allHeaders()).authorization, actors[role].id);
          report.browserActors ??= []; report.browserActors.push({ view: c.viewport, role, actorId: actors[role].id, source: 'browser-password-login-and-auth.getUser', verifiedAt: now() }); await persist();
          await page.waitForURL(url => url.pathname !== '/login');
        }
        activePage = pages[role]; return activePage;
      };
      const caseQueue = async role => {
        const page = await pageFor(role); await page.goto(`${m.origin}/warehouse/fulfillment?tab=returns`);
        const card = page.getByRole('list', { name: 'Customer return cases', exact: true }).getByRole('listitem').filter({ hasText: c.defect });
        return { page, card };
      };
      const queue = async role => {
        const page = await pageFor(role); const reference = replacementReference(b.caseId);
        await page.goto(`${m.origin}/warehouse/fulfillment?tab=orders&status=all&q=${encodeURIComponent(reference)}`);
        const card = page.getByRole('listitem', { name: `Order ${reference}`, exact: true }); await expect(card).toBeVisible(); return { page, card };
      };
      const command = async (role, name, invoke, expectedStatus) => {
        await health(m); check(await read()); pendingOperation = { role, name };
        const page = await pageFor(role);
        const responsePromise = page.waitForResponse(r => r.request().method() === 'POST' && r.url() === `${BASE}/rest/v1/rpc/${name}` && !r.request().postDataJSON()?.payload?.replay_only); responsePromise.catch(() => {});
        try {
          await invoke(); const response = await responsePromise; assert(response.ok(), `${name} failed: HTTP ${response.status()}`);
          const body = await response.json();
          if (name === 'record_return_v2') { assert(/^ret-[a-f0-9-]{36}$/.test(body.id)); b.physicalReturnId = body.id; }
          else if (name === 'inspect_quality') { assert(UUID.test(body.inspection?.id) && UUID.test(body.hold?.id)); b.inspectionId = body.inspection.id; b.holdId = body.hold.id; }
          else if (name === 'release_quality_hold') assert.equal(body.id, b.holdId);
          else if (name === 'transfer') { assert.equal(body.id, response.request().postDataJSON().payload.movement.id); b.relocationId = body.id; }
          else assert.equal(body.id, b.caseId);
          await persist();
          await expect.poll(async () => { const s = await read(); return ['record_return_v2', 'inspect_quality', 'release_quality_hold', 'transfer'].includes(name)
            ? check(s).physicalStage : name.includes('customer_return_case') ? s.cases[0]?.status : s.orders[0]?.status; }).toBe(expectedStatus);
          return { payload: response.request().postDataJSON().payload, data: body };
        } finally { pendingOperation = null; }
      };
      const replay = async (role, name, observed) => {
        check(await read()); await health(m);
        await ecommerce.assertReplayUnchanged(read, payload => actors[role].client.schema('warehouse').rpc(name, { payload }), observed.payload, observed.data);
        report.negatives.push({ view: c.viewport, runId: m.runId, commit: m.commit, kind: 'exact-successful-command-replay', name, actorId: actors[role].id, unchanged: true, observedAt: now() }); await persist();
      };
      const denyPhysical = async kind => {
        const probe = physicalDenial(c, b, kind, physicalEvidence, identities.creatorLabel);
        const before = await read(); const stage = check(before).physicalStage;
        assert.equal(stage, kind === 'provisional-held-transfer' ? 'intake' : 'held'); await health(m);
        const ref = `${c.viewport}-${kind}.json`; await writeFile(path.join(attempt, ref), json({ ...probe, actorId: identities.creator, before }), { flag: 'wx' });
        report.negativeAttempts ??= []; report.negativeAttempts.push({ view: c.viewport, kind, name: probe.name, ref, actorId: identities.creator, observedAt: now() }); await persist();
        const result = await assertPhysicalDeniedUnchanged(read, () => actors.operations_associate.client.schema('warehouse').rpc(probe.name, { payload: probe.payload }), probe.expected);
        assert.deepEqual(result.readback.before, before, 'Physical preflight changed before denial probe'); check(result.readback.after);
        const proof = { view: c.viewport, runId: m.runId, commit: m.commit, kind, name: probe.name, payload: probe.payload, actorId: identities.creator, ref, ...result, observedAt: now() };
        await writeFile(path.join(attempt, `${c.viewport}-${kind}-result.json`), json(proof), { flag: 'wx' }); report.negatives.push(proof); await persist();
      };
      const uploadPhysical = async (purpose, role, surface, label) => {
        const page = await pageFor(role); const canvas = await browser.newPage({ viewport: { width: 640, height: 360 } });
        await canvas.setContent(`<body style="margin:0;box-sizing:border-box;border:8px solid #176149;height:360px;padding:16px;font:18px Arial"><h1>SYNTHETIC RETURN ${purpose.toUpperCase()}</h1><p>${m.runId}</p><p>${c.viewport}</p><p>No real physical condition or human acceptance claimed.</p><p>Whole-image bottom edge</p></body>`);
        const bytes = await canvas.screenshot(); await canvas.close(); const ref = `${c.viewport}-${purpose}-synthetic.png`;
        await writeFile(path.join(attempt, ref), bytes, { flag: 'wx' });
        const fixture = { ref, sha256: sha(bytes), byteLength: bytes.length };
        pendingOperation = { name: 'physical-upload', role, purpose, sha256: fixture.sha256 };
        const uploadWait = page.waitForResponse(r => r.request().method() === 'POST' && r.url().startsWith(`${BASE}/storage/v1/object/evidence/`)); uploadWait.catch(() => {});
        try {
          await surface.getByLabel(label, { exact: true }).setInputFiles({ name: `${purpose}-synthetic.png`, mimeType: 'image/png', buffer: bytes });
          const response = await uploadWait;
          const upload = report.storageAttempts.find(x => x.requestUrl === response.url()); assert(upload);
          upload.httpStatus = response.status(); upload.status = response.ok() ? 'uploaded-not-cleaned' : 'failed-not-cleaned'; await persist(); assert(response.ok());
          const download = await actors[role].client.storage.from('evidence').download(upload.path); assert(!download.error && download.data);
          const actual = Buffer.from(await download.data.arrayBuffer()); assert.deepEqual(actual, bytes, 'Physical evidence download bytes changed');
          const publicRead = await fetch(`${BASE}/storage/v1/object/public/evidence/${upload.path}`, { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) });
          await publicRead.body?.cancel();
          const proof = { purpose, runId: m.runId, view: c.viewport, actorId: actors[role].id, bucket: 'evidence', path: upload.path, fixture, upload: clone(upload),
            download: { actorId: actors[role].id, source: 'authenticated-storage-download', sha256: sha(actual), byteLength: actual.length }, publicReadStatus: publicRead.status };
          assertPhysicalEvidence(m, c, purpose, proof, actors[role].id, b); physicalEvidence[purpose] = proof;
          await writeFile(path.join(attempt, `${c.viewport}-${purpose}-storage.json`), json(proof), { flag: 'wx' });
          const trigger = surface.getByRole('button', { name: /view.*evidence photo/i });
          await expect(trigger).toHaveCount(1); await expect(trigger).toBeEnabled();
          await expect.poll(async () => { const img = await trigger.getByRole('img').evaluate(img => ({ loaded: img.complete && img.naturalWidth === 640 && img.naturalHeight === 360, src: img.currentSrc }));
            return img.loaded && isOwnedEvidenceImage(img.src, upload.path); }).toBe(true);
        } finally { pendingOperation = null; }
      };
      try {
        const initial = await read(); assert.equal(initial.cases.length, 0, 'Existing cases: no automatic retry'); assert.equal(initial.orders.length, 0); check(initial);
        const creator = await caseQueue('operations_associate'); await capture('source-delivered', 'operations_associate');
        await creator.page.getByRole('button', { name: 'New return case', exact: true }).click();
        const intake = creator.page.getByRole('dialog', { name: 'Record customer return', exact: true });
        await intake.getByLabel('Product', { exact: true }).selectOption(c.productId); await intake.getByLabel('Original release order', { exact: true }).selectOption(b.sourceOrderId);
        await intake.getByLabel('Defect description', { exact: true }).fill(c.defect);
        const created = await command('operations_associate', 'create_customer_return_case', () => intake.getByRole('button', { name: 'Create return case', exact: true }).click(), 'submitted');
        await expect(intake).not.toBeVisible(); await expect(creator.card).toBeVisible(); await replay('operations_associate', 'create_customer_return_case', created); await capture('case-submitted', 'operations_associate');
        const physical = await caseQueue('operations_lead');
        await physical.card.getByRole('link', { name: 'Receive physical return', exact: true }).click();
        const returnPage = physical.page;
        const returnForm = returnPage.getByRole('group', { name: 'Return intake', exact: true });
        await expect(returnPage.getByLabel('Original order', { exact: true })).toHaveValue(b.sourceOrderId);
        await expect(returnPage.getByLabel('Customer return case', { exact: true })).toHaveValue(b.caseId);
        await expect(returnPage.getByLabel('Product', { exact: true })).toHaveValue(c.productId);
        await returnPage.getByLabel('Quarantine location', { exact: true }).selectOption(c.locationId);
        await returnPage.getByLabel('Quarantine bin', { exact: true }).selectOption(c.quarantineBinId);
        await returnPage.getByLabel('Quantity', { exact: true }).fill('1');
        await returnPage.getByLabel('Reason', { exact: true }).selectOption('defective');
        await uploadPhysical('intake', 'operations_lead', returnForm, 'Attach return evidence');
        const formState = () => returnForm.locator('select,input:not([type=file]),textarea').evaluateAll(els => els.map(el => ({ id: el.id, value: el.value })));
        const beforePreview = { form: await formState(), snapshot: await read(), commands: report.commands.length, uploads: report.storageAttempts.length };
        const photo = returnForm.getByRole('button', { name: /view.*evidence photo/i }); await photo.click();
        const preview = returnPage.getByRole('dialog', { name: 'Evidence photo', exact: true });
        await expect(preview).toBeVisible(); const fullImage = preview.getByRole('img');
        await expect.poll(() => fullImage.evaluate(img => img.complete && img.naturalWidth === 640 && img.naturalHeight === 360)).toBe(true);
        assert(isOwnedEvidenceImage(await fullImage.evaluate(img => img.currentSrc), physicalEvidence.intake.path), 'Preview must show the owned upload');
        const framing = await fullImage.evaluate(img => { const r = img.getBoundingClientRect(); return { naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
          fit: getComputedStyle(img).objectFit, x: r.x, y: r.y, width: r.width, height: r.height, viewportWidth: innerWidth, viewportHeight: innerHeight }; });
        assert.equal(framing.fit, 'contain'); assert(framing.x >= 0 && framing.y >= 0 && framing.x + framing.width <= framing.viewportWidth + 1 && framing.y + framing.height <= framing.viewportHeight + 1);
        await capture('physical-intake-evidence-preview', 'operations_lead', true);
        await preview.getByRole('button', { name: 'Close', exact: true }).click(); await expect(preview).toHaveCount(0); await expect(photo).toBeFocused();
        await expect(returnPage.getByRole('button', { name: 'Record return', exact: true })).toBeEnabled();
        assert.deepEqual(await formState(), beforePreview.form); assert.deepEqual(await read(), beforePreview.snapshot);
        assert.equal(report.commands.length, beforePreview.commands); assert.equal(report.storageAttempts.length, beforePreview.uploads);
        report.previews ??= []; report.previews.push({ view: c.viewport, runId: m.runId, commit: m.commit, actorId: identities.resolver,
          path: physicalEvidence.intake.path, framing, restoredUnsentForm: true, restoredFocus: true, unchangedCommands: true, unchangedUploads: true, unchangedReadback: true });
        await capture('physical-intake-preview-closed-unsent', 'operations_lead', true);
        const received = await command('operations_lead', 'record_return_v2', () => returnPage.getByRole('button', { name: 'Record return', exact: true }).click(), 'intake');
        await expect(returnPage.getByRole('link', { name: 'View saved return', exact: true })).toBeVisible();
        await replay('operations_lead', 'record_return_v2', received);
        await returnPage.getByRole('link', { name: 'View saved return', exact: true }).click();
        await expect(returnPage.locator(`[id="return-${b.physicalReturnId}"]`)).toBeVisible(); await capture('physical-intake', 'operations_lead');
        await denyPhysical('provisional-held-transfer');
        const inspector = await pageFor('operations_associate'); await inspector.goto(`${m.origin}/warehouse/quality`);
        await inspector.getByLabel('Find receipt, product or serial', { exact: true }).fill(b.physicalReturnId);
        const pending = inspector.getByRole('list', { name: 'Pending inspections', exact: true });
        await expect(pending.getByRole('button', { name: 'Inspect', exact: true })).toHaveCount(1);
        await pending.getByRole('button', { name: 'Inspect', exact: true }).click();
        const inspection = inspector.getByRole('dialog', { name: 'Inspect stock', exact: true });
        await inspection.getByLabel('Disposition', { exact: true }).selectOption('hold'); await inspection.getByLabel('Reason', { exact: true }).fill(c.inspectionReason);
        await uploadPhysical('inspection', 'operations_associate', inspection, 'Attach inspection evidence'); await capture('physical-inspection-form', 'operations_associate', true);
        const inspected = await command('operations_associate', 'inspect_quality', () => inspection.getByRole('button', { name: 'Submit inspection', exact: true }).click(), 'held');
        await expect(inspection).not.toBeVisible(); await replay('operations_associate', 'inspect_quality', inspected);
        await inspector.reload(); await inspector.getByRole('tab', { name: 'Holds', exact: true }).click();
        await inspector.getByLabel('Find receipt, product or serial', { exact: true }).fill(c.inspectionReason);
        await expect(inspector.getByRole('list', { name: 'Active holds', exact: true })).toContainText(c.inspectionReason);
        await capture('physical-inspected-held', 'operations_associate');
        await denyPhysical('inspected-held-transfer');
        const reviewer = await pageFor('operations_lead'); await reviewer.goto(`${m.origin}/warehouse/quality?inspection=${b.holdId}`);
        await reviewer.getByRole('list', { name: 'Active holds', exact: true }).getByRole('button', { name: 'Review hold', exact: true }).click();
        const hold = reviewer.getByRole('dialog', { name: 'Review inventory hold', exact: true }); await expect(hold).toBeVisible();
        await hold.getByLabel('Release reason', { exact: true }).fill(c.releaseReason);
        await uploadPhysical('release', 'operations_lead', hold, 'Attach release evidence'); await capture('physical-hold-release-form', 'operations_lead', true);
        await denyPhysical('unauthorized-hold-release');
        const releasedHold = await command('operations_lead', 'release_quality_hold', () => hold.getByRole('button', { name: 'Release as accepted', exact: true }).click(), 'released');
        await expect(hold).not.toBeVisible(); await replay('operations_lead', 'release_quality_hold', releasedHold);
        await reviewer.goto(`${m.origin}/warehouse/quality?inspection=${b.inspectionId}`);
        await expect(reviewer.getByRole('listitem', { name: `Inspection ${b.inspectionId}`, exact: true })).toBeVisible(); await capture('physical-hold-released', 'operations_lead');
        const mover = await pageFor('operations_associate'); await mover.goto(`${m.origin}/warehouse/inventory/${c.productId}`);
        await mover.getByRole('button', { name: 'Relocate', exact: true }).click(); const relocation = mover.getByRole('dialog', { name: 'Relocate stock', exact: true });
        if (await relocation.getByLabel('Warehouse', { exact: true }).count()) await relocation.getByLabel('Warehouse', { exact: true }).selectOption(c.locationId);
        await relocation.getByLabel('From bin', { exact: true }).selectOption(c.quarantineBinId); await relocation.getByLabel('To bin', { exact: true }).selectOption(c.binId);
        await relocation.getByLabel('Relocate quantity', { exact: true }).fill('1'); await capture('physical-relocation-form', 'operations_associate', true);
        const relocated = await command('operations_associate', 'transfer', () => relocation.getByRole('button', { name: 'Move stock', exact: true }).click(), 'relocated');
        await expect(relocation).not.toBeVisible(); await replay('operations_associate', 'transfer', relocated); await capture('physical-relocated', 'operations_associate');
        const manager = await caseQueue('operations_lead'); await manager.card.getByRole('button', { name: 'Record resolution', exact: true }).click();
        const resolution = manager.page.getByRole('dialog', { name: 'Resolve return case', exact: true });
        await resolution.getByLabel('Resolution', { exact: true }).selectOption('replacement');
        await resolution.getByLabel('Quarantine bin', { exact: true }).selectOption(c.quarantineBinId);
        if (c.delivery.mode === 'original') await resolution.getByRole('radio', { name: 'Original delivery details', exact: true }).check();
        else {
          await resolution.getByRole('radio', { name: 'New delivery details', exact: true }).check();
          for (const [key, value] of Object.entries({ customerName: c.delivery.customerName, customerContactNumber: c.delivery.customerContactNumber,
            ...c.delivery.deliveryAddress, reason: c.delivery.reason })) await resolution.locator(`#replacement-${key}`).fill(value);
        }
        await capture('replacement-delivery-confirmation-form', 'operations_lead', true);
        const resolved = await command('operations_lead', 'resolve_customer_return_case', () => resolution.getByRole('button', { name: 'Save resolution', exact: true }).click(), 'resolved');
        await expect(resolution).not.toBeVisible(); await replay('operations_lead', 'resolve_customer_return_case', resolved);
        const conflict = { ...resolved.payload, replacement_delivery: { ...resolved.payload.replacement_delivery, reason: 'Synthetic changed-confirmation denial probe' } };
        const conflictRef = `${c.viewport}-resolution-conflict.json`;
        await writeFile(path.join(attempt, conflictRef), json({ name: 'resolve_customer_return_case', payload: conflict, actorId: identities.resolver }), { flag: 'wx' });
        await health(m); check(await read());
        const denial = await ecommerce.assertDeniedUnchanged(read,
          () => actors.operations_lead.client.schema('warehouse').rpc('resolve_customer_return_case', { payload: conflict }), /already resolved|different payload/i);
        report.negatives.push({ view: c.viewport, kind: 'changed-confirmed-resolution-denied', ref: conflictRef, actorId: identities.resolver, error: denial, unchanged: true, observedAt: now() });
        await capture('replacement-resolved', 'operations_lead');
        const worker = await queue('operations_associate'); const ref = replacementReference(b.caseId);
        for (const [label, status, checkpoint] of [['Allocate stock', 'allocated', 'replacement-allocated'], ['Start picking', 'picking', 'replacement-picking']]) {
          await command('operations_associate', 'advance_fulfillment_order', () => worker.card.getByRole('button', { name: label, exact: true }).click(), status); await capture(checkpoint, 'operations_associate');
        }
        await worker.card.getByRole('button', { name: 'Confirm scanned pick', exact: true }).click();
        const pick = worker.page.getByRole('dialog', { name: `Confirm pick / ${ref}`, exact: true });
        await pick.getByLabel(`Scanned bin code for ${c.productName}`, { exact: true }).fill(c.binCode); await pick.getByRole('button', { name: 'Use bin', exact: true }).click();
        await pick.getByLabel(`Product barcode for ${c.productName}`, { exact: true }).fill(c.sku); await pick.getByRole('button', { name: 'Use product', exact: true }).click();
        await pick.getByLabel(`Picked quantity for ${c.productName}`, { exact: true }).fill('1');
        await command('operations_associate', 'advance_fulfillment_order', () => pick.getByRole('button', { name: 'Confirm pick', exact: true }).click(), 'packing');
        await expect(pick).not.toBeVisible(); await capture('replacement-picked', 'operations_associate');
        await worker.card.getByRole('button', { name: 'Pack and add waybill', exact: true }).click();
        const pack = worker.page.getByRole('dialog', { name: `Pack order / ${ref}`, exact: true });
        for (const [label, value] of [['Courier', c.courier], ['Waybill number', c.replacementWaybill], ['Delivery tracking link', c.deliveryLink]]) await pack.getByLabel(label, { exact: true }).fill(value);
        await command('operations_associate', 'advance_fulfillment_order', () => pack.getByRole('button', { name: 'Confirm packing', exact: true }).click(), 'ready');
        await expect(pack).not.toBeVisible(); await expect(worker.card.getByRole('button', { name: 'Release shipment', exact: true })).toHaveCount(0); await capture('replacement-packed', 'operations_associate');
        const lead = await queue('operations_lead');
        await command('operations_lead', 'advance_fulfillment_order', () => lead.card.getByRole('button', { name: 'Release shipment', exact: true }).click(), 'released');
        await capture('replacement-released', 'operations_lead');
        await lead.card.getByRole('button', { name: 'Update delivery', exact: true }).click();
        const delivery = lead.page.getByRole('dialog', { name: `Delivery / ${ref}`, exact: true });
        await delivery.getByLabel('Delivery outcome', { exact: true }).selectOption('confirm_delivery');
        await delivery.getByLabel('Proof-of-delivery reference', { exact: true }).fill(c.replacementPodReference);
        const canvas = await browser.newPage({ viewport: { width: 640, height: 360 } });
        await canvas.setContent(`<body style="font:20px Arial;padding:24px"><h1>SYNTHETIC REPLACEMENT POD</h1><p>${m.runId}</p><p>${c.viewport}</p><p>Offline-designated test evidence. No physical delivery or customer acceptance claimed.</p></body>`);
        const bytes = await canvas.screenshot(); await canvas.close(); const fixtureRef = `${c.viewport}-synthetic-pod.png`;
        await writeFile(path.join(attempt, fixtureRef), bytes, { flag: 'wx' }); podFixture = { ref: fixtureRef, sha256: sha(bytes), byteLength: bytes.length };
        pendingOperation = { role: 'operations_lead', name: 'pod-upload' };
        const uploadWait = lead.page.waitForResponse(r => r.request().method() === 'POST' && r.url().startsWith(`${BASE}/storage/v1/object/evidence/delivery-${b.caseId}/0/`)); uploadWait.catch(() => {});
        await delivery.locator('input[type=file]').setInputFiles({ name: 'synthetic-replacement-pod.png', mimeType: 'image/png', buffer: bytes });
        const uploadResponse = await uploadWait; pendingOperation = null;
        const upload = report.storageAttempts.find(x => x.requestUrl === uploadResponse.url()); assert(upload);
        upload.httpStatus = uploadResponse.status(); upload.status = uploadResponse.ok() ? 'uploaded-not-cleaned' : 'failed-not-cleaned'; await persist(); assert(uploadResponse.ok());
        await expect(delivery.getByRole('button', { name: 'Save delivery update', exact: true })).toBeEnabled();
        await command('operations_lead', 'update_shipment_tracking', () => delivery.getByRole('button', { name: 'Save delivery update', exact: true }).click(), 'completed');
        const order = (await read()).orders[0]; assert.equal(order.proof_of_delivery_evidence_url, upload.path);
        privateStorageEvidence = { status: 'verified', runId: m.runId, project: m.project, view: c.viewport, orderId: b.caseId, bucket: 'evidence', path: upload.path,
          fixture: podFixture, upload: clone(upload), downloads: [] };
        for (const role of ['operations_lead', 'operations_associate']) {
          const download = await actors[role].client.storage.from('evidence').download(upload.path); assert(!download.error && download.data);
          const actual = Buffer.from(await download.data.arrayBuffer()); assert.deepEqual(actual, bytes, 'Authenticated POD hash/bytes mismatch');
          privateStorageEvidence.downloads.push({ actorId: actors[role].id, source: 'authenticated-storage-download', bucket: 'evidence', path: upload.path, sha256: sha(actual), byteLength: actual.length });
        }
        const publicUrl = `${BASE}/storage/v1/object/public/evidence/${upload.path}`;
        const publicRead = await fetch(publicUrl, { credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000) });
        privateStorageEvidence.publicRead = { method: 'GET', url: publicUrl, anonymous: true, status: publicRead.status }; await publicRead.body?.cancel(); privateStorageEvidence.verifiedAt = now();
        check(await read()); await writeFile(path.join(attempt, `${c.viewport}-private-storage.json`), json(privateStorageEvidence), { flag: 'wx' });
        await lead.page.reload(); await expect(lead.card).toBeVisible();
        await lead.card.getByRole('button', { name: 'View order details', exact: true }).click();
        const details = lead.page.getByRole('dialog', { name: `Order details / ${ref}`, exact: true });
        const image = details.getByRole('region', { name: 'Proof of delivery', exact: true }).getByRole('img', { name: 'Evidence', exact: true });
        await expect(image).toBeVisible(); await expect.poll(() => image.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true); await capture('replacement-delivered', 'operations_lead');
        closureEvidenceUrl = `${BASE}/storage/v1/object/authenticated/evidence/${upload.path}`;
        const customer = await caseQueue('operations_associate'); await customer.card.getByRole('button', { name: 'Close with customer', exact: true }).click();
        const close = customer.page.getByRole('dialog', { name: 'Close customer return', exact: true });
        await close.getByLabel('Customer resolution reference', { exact: true }).fill(c.closureReference);
        await close.getByLabel('Customer confirmation evidence URL', { exact: true }).fill(closureEvidenceUrl);
        const closed = await command('operations_associate', 'close_customer_return_case', () => close.getByRole('button', { name: 'Confirm customer closure', exact: true }).click(), 'closed');
        await expect(close).not.toBeVisible(); await replay('operations_associate', 'close_customer_return_case', closed);
        await customer.page.reload(); await expect(customer.card).toContainText(c.closureReference); await capture('customer-closed', 'operations_associate');
      } catch (error) {
        let screenshot; let readback;
        try { const snapshot = await read(); readback = { source: 'persisted-requery-after-failure', snapshot }; } catch (readError) { readback = { unavailable: failure(readError) }; }
        if (activePage && !activePage.isClosed()) {
          try { const ref = `${c.viewport}-failure.png`; const bytes = await activePage.screenshot({ fullPage: false });
            await writeFile(path.join(attempt, ref), bytes, { flag: 'wx' }); screenshot = { ref, sha256: sha(bytes), byteLength: bytes.length }; } catch {}
        }
        report.failures.push({ view: c.viewport, message: guardError ?? failure(error), screenshot, readback, binding: clone(b),
          lastCommand: report.commands.at(-1)?.ref, lastNegative: report.negativeAttempts?.at(-1)?.ref, observedAt: now(), cleanup: 'retained-pending-independent-review' });
        await persist(); throw error;
      } finally { pendingOperation = null; for (const context of contexts) await context.close(); }
    }
    report.endHealth = await health(m); assertComplete(m, report); report.complete = true;
  } catch (error) {
    const ref = 'failure.png'; let screenshot;
    if (activePage && !activePage.isClosed()) { try { const bytes = await activePage.screenshot({ fullPage: false }); await writeFile(path.join(attempt, ref), bytes, { flag: 'wx' }); screenshot = { ref, sha256: sha(bytes), byteLength: bytes.length }; } catch {} }
    if (!report.failures.length) report.failures.push({ message: guardError ?? failure(error), screenshot, pendingOperation, observedAt: now(), cleanup: 'retained-pending-independent-review' });
  } finally {
    try { await browser?.close(); } catch (error) { report.complete = false; report.failures.push({ message: `Browser shutdown failed: ${failure(error)}` }); }
    for (const actor of Object.values(actors)) actor.client.auth.stopAutoRefresh(); report.finishedAt = now();
    try { await persist(); await writeFile(path.join(attempt, 'cleanup-inventory.sql'), cleanupInventorySql(m, report.bindings)); }
    finally { await lock.close(); await unlink(lockPath); }
  }
  return { attempt, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, folder, commit, runId, orderDate, ...extra] = process.argv.slice(2); assert(folder && !extra.length);
    if (mode === 'inspect-continuation') {
      assert(commit && runId && !orderDate); const inspection = await inspectPreReturnContinuation(folder, commit, runId);
      console.log(json({ offlineOnly: true, runId: inspection.manifest.runId, commit: inspection.manifest.commit, sourceChecks: inspection.source.checks.length,
        archiveFiles: inspection.archive.length, pins: inspection.pins, visualReview: 'Original screenshots retained; no new visual certification or viewport-height claim.' }));
    } else if (mode === 'prepare') console.log(json(await prepare(folder, { commit, ...(runId ? { runId } : {}), ...(orderDate ? { orderDate } : {}) })));
    else { assert(mode === 'run' && !commit && !runId && !orderDate); const result = await run(folder); console.log(json({ attempt: result.attempt, complete: result.report.complete, failures: result.report.failures })); if (!result.report.complete) process.exitCode = 1; }
  } catch (error) { console.error(`Returns signoff stopped: ${safeFailure(error, [process.env.AUDIT_PASSWORD])}`); process.exitCode = 1; }
}
