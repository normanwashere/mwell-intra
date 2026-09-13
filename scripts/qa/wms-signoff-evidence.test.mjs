import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, readdir, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createManifest, reconcile } from './wms-ecommerce-signoff-live.mjs';
import { generateEcommerceCleanup } from './wms-ecommerce-cleanup.mjs';
import { WMS_CHECKPOINTS, requiredWmsEvidence } from './wms-signoff-contract.mjs';
import { WMS_EVIDENCE_REGISTRY, EVIDENCE_SOURCE_FILES } from './wms-signoff-evidence-registry.mjs';
import { readEvidenceArtifact, readTrustedEvidence, verifyWmsEvidence, decodeEvidencePng } from './wms-signoff-evidence.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const scope = { runId: 'a1000000-0000-4000-8000-000000000001', buildId: 'a'.repeat(40), environment: 'uat' };
const scoped = { ...scope, view: 'desktop1440' };
async function directory(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'wms-evidence-offline-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function artifact(root, ref, body) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  await mkdir(path.dirname(path.join(root, ref)), { recursive: true });
  await writeFile(path.join(root, ref), bytes);
  return { ref, sha256: hash(bytes), byteLength: bytes.length };
}
async function trust() {
  return { version: 1, kind: 'wms-evidence-trust', scope, origin: 'https://mwell-intra-uat.vercel.app',
    project: 'kkoitlvydytdhlpxhuah', notBefore: '2026-09-13T00:00:00.000Z', notAfter: '2026-09-14T00:00:00.000Z',
    records: { capture: [], review: [], cleanup: [] }, sourceHashes: Object.fromEntries(await Promise.all(EVIDENCE_SOURCE_FILES.map(async file =>
      [file, hash(await readFile(new URL(`../../${file}`, import.meta.url)))]))) };
}

test('registry preserves all 45 checkpoints, 88 views and every named invariant without granting partial credit', () => {
  assert.equal(WMS_EVIDENCE_REGISTRY.length, 45);
  assert.equal(requiredWmsEvidence().length, 88);
  for (const [i, row] of WMS_EVIDENCE_REGISTRY.entries()) {
    assert.equal(row.checkpoint, WMS_CHECKPOINTS[i].id);
    assert.deepEqual(row.checks, WMS_CHECKPOINTS[i].checks);
    assert.deepEqual(row.views, WMS_CHECKPOINTS[i].views);
    assert.equal(row.contractReady, false);
    assert(row.blockers.length > 0);
    assert(Object.isFrozen(row.checks));
  }
  assert.equal(WMS_EVIDENCE_REGISTRY.find(r => r.checkpoint === 'ecommerce.receipt').artifactAdapter, 'ecommerce-receipt-v1');
  for (const checkpoint of ['returns.intake', 'returns.disposition']) {
    const row = WMS_EVIDENCE_REGISTRY.find(r => r.checkpoint === checkpoint);
    assert.equal(row.sourceRunner, 'scripts/qa/wms-returns-signoff-live.mjs');
    assert.equal(row.sourceCoverage, 'partial'); assert.equal(row.artifactAdapter, null); assert.equal(row.contractReady, false);
    assert.match(row.blockers[0], /implemented in source/); assert.match(row.blockers[0], /serialized/);
    assert.match(row.blockers[0], /full evidence adapter missing/); assert.match(row.blockers[0], /No live outcome credited/);
  }
  assert.match(WMS_EVIDENCE_REGISTRY.find(r => r.checkpoint === 'returns.disposition').blockers[0], /independent release as accepted and relocation.*nonaccepted/);
});

test('artifact reader requires real matching bytes and rejects missing/truncated files', async t => {
  const root = await directory(t); const ref = await artifact(root, 'attempt/raw.json', { real: 'bytes' });
  assert.equal(hash(await readEvidenceArtifact(root, ref)), ref.sha256);
  for (const bad of [{ ...ref, sha256: '0'.repeat(64) }, { ...ref, byteLength: ref.byteLength + 1 }, { ...ref, ref: 'missing' }]) {
    await assert.rejects(readEvidenceArtifact(root, bad));
  }
});

for (const ref of ['../escape', '/absolute', 'C:/outside', 'C:relative', 'a\\b', 'a/../b', './b', 'a//b',
  'https://example.invalid/a', 'data:image/png;base64,abc', 'a%2fb', 'CON', 'a/NUL.json', 'a/file.', 'a/file ']) {
  test(`artifact confinement rejects ${ref}`, async t => {
    await assert.rejects(readEvidenceArtifact(await directory(t), { ref, sha256: '0'.repeat(64), byteLength: 1 }));
  });
}

test('artifact reader rejects directory junction/symlink escape even with matching bytes', async t => {
  const root = await directory(t); const outside = await directory(t);
  const target = await artifact(outside, 'outside.json', { private: 'synthetic offline test' });
  await symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readEvidenceArtifact(root, { ...target, ref: 'escape/outside.json' }), /link|confinement/i);
});

test('saved record pins bind real bytes to a separately selected purpose', async t => {
  const root = await directory(t); const policy = await trust(); const data = { kind: 'test', scope: scoped, facts: [1, 2] };
  const ref = await artifact(root, 'observed.json', data); policy.records.capture.push(ref.sha256);
  assert.deepEqual(await readTrustedEvidence(root, ref, policy, 'capture'), data);
  await assert.rejects(readTrustedEvidence(root, ref, policy, 'cleanup'));
  const forged = await artifact(root, ref.ref, { actual: true, expected: true });
  await assert.rejects(readTrustedEvidence(root, forged, policy, 'capture'));
  await assert.rejects(readTrustedEvidence(root, ref, policy, 'capture'));
});

test('empty/offline bundle never becomes green and cannot self-approve human gates', async t => {
  const result = await verifyWmsEvidence({ root: await directory(t), trust: await trust(),
    index: { version: 1, kind: 'wms-signoff-evidence-index', scope, entries: [], humanGates: [] } });
  assert.equal(result.requiredCount, 88); assert.equal(result.acceptedCount, 0);
  assert.equal(result.automatedPassed, false); assert.equal(result.productionReady, false);
  assert.deepEqual(result.pendingHumanGates, ['hardware', 'pilot']);
  assert.equal(result.unsupported.length, 88);
});

const at = minute => `2026-09-13T00:${String(minute).padStart(2, '0')}:00.000Z`;
function png(width = 640, height = 360) {
  const shell = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
  const pw = createRequire(createRequire(shell.resolve('@playwright/test')).resolve('playwright'));
  const { PNG } = pw(path.join(path.dirname(pw.resolve('playwright-core')), 'lib/utilsBundle.js'));
  const image = new PNG({ width, height }); image.data.fill(255); image.data[0] = 0;
  return PNG.sync.write(image);
}

// Entirely synthetic on-disk test material. No credential, fixture or live assertion
// is created. Coordinator pins below are TEST trust, never deployment attestations.
async function packet(t, view = 'desktop1440') {
  const root = await directory(t); const policy = await trust();
  const m = createManifest({ runId: scope.runId, commit: scope.buildId, orderDate: '2026-09-13' });
  const ids = ['c1000000-0000-4000-8000-000000000001', 'c2000000-0000-4000-8000-000000000001',
    'c3000000-0000-4000-8000-000000000001', 'c4000000-0000-4000-8000-000000000001'];
  const roles = ['operations_associate', 'operations_lead', 'marketing_events_lead', 'procurement_lead'];
  const assignments = [['warehouse_operator', 'operations'], ['warehouse_supervisor'], ['marketing'], ['procurement']];
  const actors = roles.map((role, i) => ({ role, id: ids[i], authoritativeActor: `synthetic-${i}@example.invalid`,
    source: 'core.my_capability_snapshot', capabilities: { roleCapabilities: { warehouse: i === 0 ? ['request_fulfillment', 'reserve_allocate', 'issue_items'] : i === 1 ? ['issue_items'] : [] },
      userCapabilities: { warehouse: i === 0 ? ['request_fulfillment', 'reserve_allocate', 'issue_items'] : i === 1 ? ['issue_items'] : [] } } }));
  const identities = { creator: ids[0], picker: ids[0], releaser: ids[1], releaserLabel: actors[1].authoritativeActor };
  const bindings = m.cases.map((c, i) => ({ view: c.viewport, orderId: `b${i + 1}000000-0000-4000-8000-000000000001`, productId: c.productId, reference: c.reference }));
  const fixtures = Object.fromEntries(m.cases.map(c => [c.viewport, png()]));
  const paths = bindings.map(b => `delivery-${b.orderId}/0/d1000000-0000-4000-8000-000000000001.png`);
  const fixture = c => ({ ref: `${c.viewport}-synthetic-pod.png`, sha256: hash(fixtures[c.viewport]), byteLength: fixtures[c.viewport].length });
  const proof = (c, i) => ({ status: 'verified', runId: m.runId, project: m.project, view: c.viewport, orderId: bindings[i].orderId,
    bucket: 'evidence', path: paths[i], fixture: fixture(c),
    upload: { method: 'POST', requestUrl: `https://${m.project}.supabase.co/storage/v1/object/evidence/${paths[i]}`,
      bucket: 'evidence', path: paths[i], actorId: ids[1], httpStatus: 200 },
    publicRead: { method: 'GET', url: `https://${m.project}.supabase.co/storage/v1/object/public/evidence/${paths[i]}`, anonymous: true, status: 400 },
    downloads: [ids[1], ids[0]].map(actorId => ({ actorId, bucket: 'evidence', path: paths[i], source: 'authenticated-storage-download', sha256: fixture(c).sha256, byteLength: fixture(c).byteLength })), verifiedAt: at(5) });
  function state(c, i, completed) {
    const id = bindings[i].orderId;
    return { order: { id, source: 'ecommerce', delivery_method: 'shipment', external_reference: c.reference, source_location_id: c.locationId,
      source_bin_id: null, order_notes: c.notes, created_by: ids[0], status: completed ? 'completed' : 'released', shipment_status: completed ? 'delivered' : 'dispatched',
      lines: [{ productId: c.productId, quantity: 2, pickedQuantity: 2, pickBinId: c.binId }], packaging: [], picked_by: ids[0], packed_by: ids[0], released_by: ids[1],
      courier: c.courier, waybill_number: c.waybill, delivery_link: c.deliveryLink, proof_of_delivery_reference: completed ? c.podReference : null,
      proof_of_delivery_evidence_url: completed ? paths[i] : null, delivered_at: completed ? '2026-09-13T00:04:00.123456+00:00' : null,
      shipment_events: completed ? [{ status: 'delivered', actor: actors[1].authoritativeActor, reference: c.podReference, evidenceUrl: paths[i] }] : [] },
      products: [{ id: c.productId, sku: c.sku, attributes: { signoffRun: m.runId, synthetic: true }, serialized: false, item_class: 'sellable_sku' }],
      stock: [{ id: `${i}-stock`, product_id: c.productId, location_id: c.locationId, bin_id: c.binId, lot_id: null, quantity: 8 }],
      reservations: [{ id: `${i}-reservation`, order_id: id, product_id: c.productId, quantity: 2, location_id: null, bin_id: null, status: 'released' }],
      movements: [{ id: `${i}-movement`, product_id: c.productId, reference: id, type: 'fulfillment_release', quantity: 2, from_location_id: c.locationId,
        from_bin_id: c.binId, to_location_id: null, to_bin_id: null, lot_id: null, serial_number: null, actor: actors[1].authoritativeActor }],
      activity: completed ? [{ id: i + 1, module: 'warehouse', entity_type: 'fulfillment_order', entity_id: id, action: 'confirm_delivery', actor: ids[1] }] : [],
      holds: [], allocations: [], units: [], podFixture: fixture(c), privateStorageEvidence: completed ? proof(c, i) : null };
  }
  const report = { runId: m.runId, commit: m.commit, environment: 'uat', complete: true, failures: [], startedAt: at(1), finishedAt: at(7),
    endHealth: { status: 'ok', commit: m.commit, deployment: { appEnv: 'uat', supabaseProjectRef: m.project } }, bindings, actors, checks: [], commands: [],
    privateStorageEvidence: m.cases.map(proof), storageAttempts: m.cases.map((c, i) => proof(c, i).upload) };
  const reportFiles = {};
  for (const [i, c] of m.cases.entries()) {
    for (const completed of [false, true]) {
      const snapshot = state(c, i, completed); const ref = `${c.viewport}-${completed ? 'completed' : 'released'}.png`;
      reportFiles[ref] = await artifact(root, `attempt/${ref}`, png(c.viewport === 'desktop1440' ? 1440 : 390, 30));
      report.checks.push({ checkpoint: completed ? 'delivered-completed-reconciled' : 'released-not-delivered', view: c.viewport,
        actor: { id: ids[1], configuredRoles: ['warehouse_supervisor'] }, kind: 'live',
        readback: { source: 'persisted-requery', snapshot, inventory: reconcile(m, c, snapshot, identities) },
        screenshot: { ref, width: c.viewport === 'desktop1440' ? 1440 : 390, contentWidth: c.viewport === 'desktop1440' ? 1440 : 390, sessionActorId: ids[1], reviewed: false },
        ...(completed ? { operation: { rpc: 'warehouse.update_shipment_tracking', action: 'confirm_delivery' } } : {}) });
    }
    const command = { name: 'update_shipment_tracking', payload: { order_id: bindings[i].orderId, action: 'confirm_delivery', tracking_reference: c.podReference,
      evidence_url: paths[i], idempotency_key: `${m.runId}-${c.viewport}-tracking` } };
    const ref = `${c.viewport}-command.json`; reportFiles[ref] = await artifact(root, `attempt/${ref}`, command);
    report.commands.push({ ref, name: command.name, action: command.payload.action, orderId: bindings[i].orderId });
  }
  const selected = m.cases.findIndex(c => c.viewport === view); const c = m.cases[selected];
  const capture = { kind: 'wms-ecommerce-receipt-capture', scope: { ...scope, view }, project: m.project, origin: m.origin, observedAt: at(8), sources: {},
    reportFiles,
    manifest: await artifact(root, 'attempt/manifest.json', m), report: await artifact(root, 'attempt/results.json', report),
    command: reportFiles[`${view}-command.json`],
    authorities: await artifact(root, 'authority.json', actors.map((a, i) => ({ actorId: a.id, queriedAt: at(2), profile: { id: a.id, email: a.authoritativeActor },
      userRoles: assignments[i].map(role => ({ user_id: a.id, module: 'warehouse', role })), capabilitySnapshot: a.capabilities }))),
    reads: [], screenshots: [reportFiles[`${view}-released.png`], reportFiles[`${view}-completed.png`]], fixtures: {}, downloads: [] };
  const queryMap = { order: ['warehouse', 'fulfillment_orders', 'external_reference'], products: ['warehouse', 'products', 'id'], stock: ['warehouse', 'stock_levels', 'product_id'],
    movements: ['warehouse', 'movements', 'product_id'], reservations: ['warehouse', 'fulfillment_reservations', 'product_id'], holds: ['warehouse', 'inventory_holds', 'product_id'],
    allocations: ['warehouse', 'allocations', 'product_id'], units: ['warehouse', 'inventory_units', 'product_id'], activity: ['core', 'activity_log', 'entity_id'] };
  for (const [i, checkIndex] of [selected * 2, selected * 2 + 1].entries()) {
    const s = report.checks[checkIndex].readback.snapshot;
    capture.reads.push({ checkIndex, actorId: ids[1], queriedAt: at(i === 0 ? 3 : 6), queries: Object.fromEntries(Object.entries(queryMap).map(([key, [schema, table, column]]) => {
      const count = key === 'order' ? 1 : s[key].length;
      return [key, { schema, table, column, value: key === 'order' ? c.reference : key === 'activity' ? s.order.id : c.productId, returnedCount: count, totalCount: count }];
    })) });
  }
  for (const file of EVIDENCE_SOURCE_FILES) capture.sources[file] = await artifact(root, `source/${file}`, await readFile(new URL(`../../${file}`, import.meta.url)));
  for (const item of m.cases) capture.fixtures[item.viewport] = await artifact(root, `attempt/${item.viewport}-synthetic-pod.png`, fixtures[item.viewport]);
  for (const actorId of [ids[1], ids[0]]) capture.downloads.push({ actorId, bucket: 'evidence', path: paths[selected], bytes: await artifact(root, `downloads/${actorId}.png`, fixtures[view]) });
  const principal = { kind: 'service_role', project: m.project, credentialSource: 'authenticated-supabase-cli' };
  const receipt = { version: 2, kind: 'wms-ecommerce-storage-cleanup', runId: m.runId, project: m.project, commit: m.commit,
    runStopped: true, bindingsComplete: true, inventoryComplete: true, evidenceRef: 'storage-verification.json',
    inventory: { source: 'authenticated-storage-list', principal, prefixes: bindings.flatMap(b => [`delivery-${b.orderId}/`, `fulfillment/${b.orderId}/`, `acknowledgment-${b.orderId}/`]), remainingPaths: [], verifiedAt: at(13) },
    objects: m.cases.map((item, i) => ({ view: item.viewport, orderId: bindings[i].orderId, bucket: 'evidence', path: paths[i], status: 'deleted-and-verified', fixture: fixture(item),
      downloads: [ids[1], ids[0]].map(actorId => ({ actorId, source: 'authenticated-storage-download', sha256: fixture(item).sha256, byteLength: fixture(item).byteLength, verifiedAt: at(5) })),
      deletion: { source: 'authenticated-storage-remove', principal, httpStatus: 200, deletedAt: at(12) },
      absence: { source: 'authenticated-storage-download', principal, httpStatus: 400, storageErrorCode: 'NoSuchKey', storageStatusCode: '404', verifiedAt: at(13) } })),
    databaseVerification: { source: 'independent-readonly-sql', runId: m.runId, project: m.project, commit: m.commit, verifiedAt: at(14), evidenceRef: 'storage-db.json',
      apiReceiptSha256: 'f'.repeat(64), expectedPaths: paths, remainingObjects: [] } };
  const isolation = { version: 1, kind: 'wms-ecommerce-cleanup-isolation', runId: m.runId, project: m.project, commit: m.commit, orderIds: bindings.map(b => b.orderId),
    scopeWritersStopped: true, inFlightWorkDrained: true, schemaChangesPaused: true, holdThroughPostcleanup: true, evidenceRef: 'operator-isolation.json', verifiedAt: at(10) };
  const finalStates = report.checks.filter(r => r.checkpoint === 'delivered-completed-reconciled').map(r => r.readback.snapshot);
  const storageApi = { version: 1, kind: 'wms-ecommerce-storage-progress', status: 'api-verified-awaiting-independent-db', isolationReceipt: isolation,
    apiVerifiedAt: at(13), expectedPaths: paths, objects: receipt.objects.map(o => ({ path: o.path, status: 'api-absent', deletion: o.deletion, absence: o.absence })),
    orders: finalStates.map(s => s.order), products: finalStates.flatMap(s => s.products) };
  receipt.databaseVerification.apiReceiptSha256 = hash(JSON.stringify(storageApi));
  const storageDb = { version: 1, kind: 'wms-ecommerce-storage-db-verification', ...receipt.databaseVerification,
    orders: storageApi.orders, products: storageApi.products };
  const generated = generateEcommerceCleanup(m, { bindings, fixtures, storageReceipt: receipt, isolationReceipt: isolation });
  const post = { runId: m.runId, project: m.project, manifestCommit: m.commit, receiptSha256: hash(JSON.stringify(receipt)), isolationReceiptSha256: hash(JSON.stringify(isolation)),
    allResidueVerified: false, databaseRowsRemaining: 0, evidence: [], storageObjects: [], counts: Object.fromEntries(['core.activity_log', 'core.notifications', 'warehouse.command_log',
      'warehouse.fulfillment_orders', 'warehouse.fulfillment_reservations', 'warehouse.movements', 'warehouse.stock_levels', 'warehouse.products', 'warehouse.storage_areas', 'warehouse.locations'].map(key => [key, 0])) };
  const cleanup = { kind: 'wms-cleanup-observation', scope: { ...scope, view }, project: m.project, origin: m.origin, observedAt: at(15), captureSha256: null,
    receipt: await artifact(root, 'cleanup/receipt.json', receipt), isolation: await artifact(root, 'cleanup/isolation.json', isolation),
    storageApi: await artifact(root, 'cleanup/storage-api.json', storageApi), storageDb: await artifact(root, 'cleanup/storage-db.json', storageDb), execution: null,
    postcleanupSql: await artifact(root, 'cleanup/post.sql', Buffer.from(generated.postcleanupSql)), postcleanup: await artifact(root, 'cleanup/post.json', post), archives: [] };
  const execution = { source: 'independent-readonly-sql', project: m.project, sqlSha256: cleanup.postcleanupSql.sha256, resultSha256: cleanup.postcleanup.sha256,
    startedAt: at(14), finishedAt: at(15), exitCode: 0, errors: [], warnings: [] };
  cleanup.execution = await artifact(root, 'cleanup/execution.json', execution);
  for (const [i, item] of m.cases.entries()) cleanup.archives.push({ path: paths[i], bytes: await artifact(root, `cleanup/${item.viewport}-archive.png`, fixtures[item.viewport]) });
  const visual = { kind: 'wms-visual-review', scope: { ...scope, view }, project: m.project, origin: m.origin, observedAt: at(9), captureSha256: null,
    reviewer: 'offline-test-reviewer', screenshots: capture.screenshots.map(artifact => ({ artifact, actorId: ids[1], outcome: 'passed', notes: 'Synthetic test pixels, not live UI review.' })) };
  const index = { version: 1, kind: 'wms-signoff-evidence-index', scope, entries: [], humanGates: [] };
  const entry = { checkpoint: 'ecommerce.receipt', view, capture: null, visualReview: null, cleanup: null }; index.entries.push(entry);
  const refresh = async () => {
    entry.capture = await artifact(root, 'capture.json', capture); visual.captureSha256 = cleanup.captureSha256 = entry.capture.sha256;
    entry.visualReview = await artifact(root, 'visual-review.json', visual); entry.cleanup = await artifact(root, 'cleanup-observation.json', cleanup);
    policy.records = { capture: [entry.capture.sha256], review: [entry.visualReview.sha256], cleanup: [entry.cleanup.sha256] };
  };
  await refresh();
  return { root, trust: policy, index, m, report, capture, cleanup, receipt, isolation, post, visual, entry, refresh, reportFiles, execution, storageApi, storageDb,
    saveReport: async () => {
      for (const screenshot of capture.screenshots) capture.reportFiles[path.posix.basename(screenshot.ref)] = screenshot;
      capture.report = await artifact(root, capture.report.ref, report); await refresh();
    },
    saveCleanup: async () => {
      cleanup.receipt = await artifact(root, cleanup.receipt.ref, receipt);
      post.receiptSha256 = hash(JSON.stringify(receipt));
      cleanup.postcleanup = await artifact(root, cleanup.postcleanup.ref, post);
      cleanup.postcleanupSql = await artifact(root, cleanup.postcleanupSql.ref, Buffer.from(generateEcommerceCleanup(m,
        { bindings, fixtures, storageReceipt: receipt, isolationReceipt: isolation }).postcleanupSql));
      execution.sqlSha256 = cleanup.postcleanupSql.sha256; execution.resultSha256 = cleanup.postcleanup.sha256;
      cleanup.execution = await artifact(root, cleanup.execution.ref, execution);
      await refresh();
    } };
}

for (const view of ['desktop1440', 'mobile390']) test(`real offline ${view} bytes recompute receipt without claiming contract or production passage`, async t => {
  const p = await packet(t, view); const result = await verifyWmsEvidence(p);
  assert.deepEqual(result.artifactFailures, []);
  assert.equal(result.verifiedArtifacts.length, 1); assert.equal(result.verifiedArtifacts[0].view, view);
  assert.equal(result.verifiedArtifacts[0].contractCredit, false);
  assert.equal(result.automatedPassed, false); assert.equal(result.productionReady, false); assert.equal(result.acceptedCount, 0);
});

const faults = [
  ['historical manifest build', async p => { p.capture.manifest = await artifact(p.root, p.capture.manifest.ref, { ...p.m, commit: 'b'.repeat(40) }); }, /equal|build/i],
  ['historical report build', p => { p.report.commit = 'b'.repeat(40); }, /equal/i],
  ['wrong report run', p => { p.report.runId = 'a2000000-0000-4000-8000-000000000001'; }, /equal/i],
  ['incomplete report', p => { p.report.complete = false; }, /Incomplete source/],
  ['failure hidden behind complete', p => { p.report.failures = [{ message: 'failed' }]; }, /equal/i],
  ['cross-attempt continuation', p => { p.report.continuation = { freshEndToEndRun: false }; }, /continuation/],
  ['missing other viewport outcome', p => { p.report.checks.pop(); }, /Both viewport|Unexpected/],
  ['foreign product UUID ownership', p => { p.report.checks[1].readback.snapshot.products[0].attributes.signoffRun = 'foreign'; }, /equal/],
  ['inventory summary true while stock wrong', p => { p.report.checks[1].readback.snapshot.stock[0].quantity = 9; }, /equal/],
  ['duplicate inventory issue', p => { p.report.checks[1].readback.snapshot.movements.push(p.report.checks[1].readback.snapshot.movements[0]); }, /counts|issue/],
  ['wrong release actor', p => { p.report.checks[1].readback.snapshot.order.released_by = p.report.actors[0].id; }, /equal/],
  ['wrong actual delivery audit actor', p => { p.report.checks[1].readback.snapshot.activity[0].actor = p.report.actors[0].id; }, /Delivery audit/],
  ['unbound boolean readback', p => { p.report.checks[1].readback = { source: 'persisted-requery', assertions: [{ expected: true, actual: true }] }; }, /undefined|snapshot|properties/],
  ['wrong authenticated readback actor', p => { p.capture.reads[1].actorId = p.report.actors[0].id; }, /equal/],
  ['incomplete query count', p => { p.capture.reads[1].queries.holds.totalCount = 1; }, /counts/],
  ['foreign query filter', p => { p.capture.reads[1].queries.order.value = 'another-reference'; }, /counts/],
  ['read before delivered mutation', p => { p.capture.reads[1].queriedAt = at(3); }, /chronology|timestamp|assert/i],
  ['wrong completion RPC', p => { p.report.checks[1].operation.rpc = 'warehouse.advance_fulfillment_order'; }, /equal/],
  ['release treated as delivery', p => { p.report.checks[0].readback.snapshot.order.delivered_at = at(3); }, /equal/],
  ['inline POD', p => { p.report.checks[1].readback.snapshot.order.proof_of_delivery_evidence_url = 'data:image/png;base64,AA=='; }, /inline|foreign/],
  ['foreign Storage path', p => { p.report.checks[1].readback.snapshot.privateStorageEvidence.path += '-foreign'; }, /Storage path/],
  ['unverified hash', p => { p.report.checks[1].readback.snapshot.privateStorageEvidence.downloads[0].sha256 = '0'.repeat(64); }, /hash|sha256/],
  ['forged authorized download actor', p => { p.capture.downloads[0].actorId = p.report.actors[2].id; }, /equal/],
  ['same actor for both downloads', p => { p.capture.downloads[1].actorId = p.capture.downloads[0].actorId; }, /equal/],
  ['fabricated screenshot session actor', p => { p.report.checks[1].screenshot.sessionActorId = p.report.actors[0].id; }, /equal/],
  ['missing actual role assignments', async p => {
    const facts = JSON.parse(await readFile(path.join(p.root, p.capture.authorities.ref))); facts[1].userRoles = [];
    p.capture.authorities = await artifact(p.root, p.capture.authorities.ref, facts);
  }, /falsy|role/],
  ['missing live authority despite configured role', async p => {
    p.report.actors[1].capabilities.userCapabilities.warehouse = [];
    const facts = JSON.parse(await readFile(path.join(p.root, p.capture.authorities.ref))); facts[1].capabilitySnapshot = p.report.actors[1].capabilities;
    p.capture.authorities = await artifact(p.root, p.capture.authorities.ref, facts);
  }, /governed live/],
  ['wrong viewport pixels', async p => { p.capture.screenshots[0] = await artifact(p.root, p.capture.screenshots[0].ref, png(390, 30)); }, /equal/],
  ['corrupt PNG with recomputed hash', async p => { p.capture.screenshots[0] = await artifact(p.root, p.capture.screenshots[0].ref, Buffer.from('not a screenshot')); }, /PNG/],
  ['review of different capture', p => { p.visual.scope.buildId = 'b'.repeat(40); }, /mismatch/],
  ['unreviewed image', p => { p.visual.screenshots[0].outcome = 'pending'; }, /equal/],
  ['copied review with no observations', p => { p.visual.screenshots[0].notes = ''; }, /reviewer observations/],
  ['claimed all residue clean', async p => { p.post.allResidueVerified = true; await p.saveCleanup(); }, /universal residue/],
  ['missing cleanup count', async p => { delete p.post.counts['warehouse.movements']; await p.saveCleanup(); }, /equal/],
  ['nonzero cleanup count', async p => { p.post.counts['warehouse.movements'] = 1; await p.saveCleanup(); }, /residue/],
  ['wrong saved archive bytes', async p => { p.cleanup.archives[0].bytes = await artifact(p.root, p.cleanup.archives[0].bytes.ref, png(2, 2)); }, /archive bytes/],
  ['missing Storage API source', async p => { await rm(path.join(p.root, p.cleanup.storageApi.ref)); }, /ENOENT/],
  ['different Storage API bytes with self-updated file hash', async p => {
    p.storageApi.apiVerifiedAt = at(2); p.cleanup.storageApi = await artifact(p.root, p.cleanup.storageApi.ref, p.storageApi);
  }, /API receipt hash/],
  ['missing independent Storage DB source', async p => { await rm(path.join(p.root, p.cleanup.storageDb.ref)); }, /ENOENT/],
  ['independent SQL warning hidden by zero counts', async p => {
    p.execution.warnings = ['Unreviewed reference']; p.cleanup.execution = await artifact(p.root, p.cleanup.execution.ref, p.execution);
  }, /equal/],
  ['independent SQL timeout hidden by zero counts', async p => {
    p.execution.exitCode = 1; p.cleanup.execution = await artifact(p.root, p.cleanup.execution.ref, p.execution);
  }, /equal/],
  ['old independent SQL result hash', async p => {
    p.execution.resultSha256 = '0'.repeat(64); p.cleanup.execution = await artifact(p.root, p.cleanup.execution.ref, p.execution);
  }, /equal/],
  ['substituted cleanup SQL', async p => {
    p.cleanup.postcleanupSql = await artifact(p.root, p.cleanup.postcleanupSql.ref, Buffer.from('select 0;'));
  }, /exact reviewed generator/],
];
for (const [name, mutate, reason] of faults) test(`receipt adapter rejects ${name} even if coordinator pins the revised outer record`, async t => {
  const p = await packet(t); await mutate(p); await p.saveReport();
  const result = await verifyWmsEvidence(p);
  assert.equal(result.verifiedArtifacts.length, 0); assert.equal(result.artifactFailures.length, 1);
  assert.match(result.artifactFailures[0].reason, reason); assert.equal(result.automatedPassed, false);
});

test('completed POD receipt cannot be replaced with a zero-object no-POD attestation', async t => {
  const p = await packet(t); p.receipt.objects = []; p.receipt.databaseVerification.expectedPaths = [];
  await p.saveCleanup();
  const result = await verifyWmsEvidence(p);
  assert.equal(result.verifiedArtifacts.length, 0);
});

test('cleanup object must be the actual persisted POD, not another path under the owned order', async t => {
  const p = await packet(t); const foreign = p.receipt.objects[0].path.replace('d1000000', 'd2000000');
  p.receipt.objects[0].path = foreign; p.receipt.databaseVerification.expectedPaths[0] = foreign; p.cleanup.archives[0].path = foreign;
  await p.saveCleanup(); assert.equal((await verifyWmsEvidence(p)).verifiedArtifacts.length, 0);
});

test('missing nonselected screenshot still makes the original report incomplete', async t => {
  const p = await packet(t); await rm(path.join(p.root, 'attempt/mobile390-completed.png'));
  assert.equal((await verifyWmsEvidence(p)).verifiedArtifacts.length, 0);
});

test('cleanup cannot cite nonexistent independent DB proof even with a zero-count summary', async t => {
  const p = await packet(t); p.receipt.databaseVerification.evidenceRef = 'not-observed.json'; await p.saveCleanup();
  assert.equal((await verifyWmsEvidence(p)).verifiedArtifacts.length, 0);
});

for (const variant of ['foreign-query-and-row', 'owned-query-foreign-row', 'owned-query-mixed-rows']) {
  test(`released activity rejects ${variant} even with revised capture pins and exact counts`, async t => {
    const p = await packet(t); const snapshot = p.report.checks[0].readback.snapshot;
    const owned = snapshot.order.id; const foreign = 'b9000000-0000-4000-8000-000000000001';
    const row = entity_id => ({ id: entity_id === owned ? 98 : 99, entity_id,
      entity_type: 'fulfillment_order', module: 'warehouse', action: 'release', actor: p.report.actors[1].id });
    snapshot.activity = variant === 'owned-query-mixed-rows' ? [row(owned), row(foreign)] : [row(foreign)];
    const query = p.capture.reads[0].queries.activity;
    query.value = variant === 'foreign-query-and-row' ? foreign : owned;
    query.returnedCount = query.totalCount = snapshot.activity.length;
    await p.saveReport();
    const result = await verifyWmsEvidence(p);
    assert.equal(result.verifiedArtifacts.length, 0);
    assert.equal(result.artifactFailures.length, 1);
    assert.match(result.artifactFailures[0].reason, /exact-filter|Activity row.*owned order/);
    assert.equal(result.automatedPassed, false);
  });
}

test('released activity permits exact owned-order rows with matching complete-query counts', async t => {
  const p = await packet(t); const snapshot = p.report.checks[0].readback.snapshot;
  snapshot.activity = [{ id: 98, entity_id: snapshot.order.id, entity_type: 'fulfillment_order', module: 'warehouse', action: 'release', actor: p.report.actors[1].id }];
  p.capture.reads[0].queries.activity.returnedCount = p.capture.reads[0].queries.activity.totalCount = 1;
  await p.saveReport();
  const result = await verifyWmsEvidence(p);
  assert.deepEqual(result.artifactFailures, []); assert.equal(result.verifiedArtifacts.length, 1); assert.equal(result.automatedPassed, false);
});

for (const [name, mutate] of [
  ['self-approved human gates', p => { p.index.humanGates = [{ id: 'hardware', status: 'passed' }]; }],
  ['unbound assertion booleans', p => { p.entry.assertions = [{ expected: true, actual: true }]; }],
  ['unknown checkpoint alias', p => { p.entry.checkpoint = 'ecommerce.delivered'; }],
  ['duplicate checkpoint view', p => { p.index.entries.push(structuredClone(p.entry)); }],
  ['unreviewed executable source revision', p => { p.trust.sourceHashes[EVIDENCE_SOURCE_FILES[0]] = '0'.repeat(64); }],
  ['cross-environment coordinator scope', p => { p.trust.scope = { ...scope, environment: 'production' }; }],
]) test(`bundle rejects ${name}`, async t => {
  const p = await packet(t); mutate(p); await assert.rejects(verifyWmsEvidence(p));
});

test('unsupported role/return/race checks do not acquire credit through all-true claims', async t => {
  const p = await packet(t);
  p.index.entries = ['roles.multi', 'returns.intake', 'concurrency.races'].map(checkpoint => ({ ...p.entry, checkpoint,
    view: checkpoint === 'concurrency.races' ? 'service' : 'desktop1440' }));
  const r = await verifyWmsEvidence(p);
  assert.equal(r.artifactFailures.length, 3); assert.equal(r.verifiedArtifacts.length, 0); assert.equal(r.acceptedCount, 0);
});

test('verifier never invokes fetch and produces no new artifact files', async t => {
  const p = await packet(t); const previous = globalThis.fetch;
  const inventory = async (dir, prefix = '') => {
    const result = [];
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const ref = `${prefix}${item.name}`;
      if (item.isDirectory()) result.push(...await inventory(path.join(dir, item.name), `${ref}/`));
      else result.push([ref, hash(await readFile(path.join(dir, item.name)))]);
    }
    return result.sort((a, b) => a[0].localeCompare(b[0]));
  };
  const before = await inventory(p.root);
  globalThis.fetch = () => { throw new Error('Network is forbidden in offline verifier'); };
  t.after(() => { globalThis.fetch = previous; });
  assert.equal((await verifyWmsEvidence(p)).verifiedArtifacts.length, 1);
  assert.deepEqual(await inventory(p.root), before);
});

test('CLI requires independently pinned coordinator bytes and cannot print a green partial suite', async t => {
  const p = await packet(t); const script = fileURLToPath(new URL('./wms-signoff-evidence.mjs', import.meta.url));
  const policy = await artifact(p.root, 'coordinator.json', p.trust); await artifact(p.root, 'index.json', p.index);
  const run = expected => spawnSync(process.execPath, [script, 'verify', p.root, 'index.json', path.join(p.root, policy.ref), expected], { encoding: 'utf8' });
  const wrong = run('0'.repeat(64)); assert.equal(wrong.status, 1); assert.match(wrong.stderr, /trust-file hash mismatch/);
  const good = run(policy.sha256); assert.equal(good.status, 1); assert.equal(good.stderr, '');
  const output = JSON.parse(good.stdout); assert.equal(output.verifiedArtifacts.length, 1); assert.equal(output.automatedPassed, false);
  assert.equal(output.requiredCount, 88); assert.deepEqual(output.pendingHumanGates, ['hardware', 'pilot']);
});

test('CLI index cannot escape through a directory junction', async t => {
  const root = await directory(t); const outside = await directory(t);
  const policy = await artifact(root, 'coordinator.json', await trust());
  await artifact(outside, 'index.json', { secret: 'synthetic-external-data-must-not-be-reported' });
  await symlink(outside, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./wms-signoff-evidence.mjs', import.meta.url)), 'verify', root,
    'escape/index.json', path.join(root, policy.ref), policy.sha256], { encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /links\/junctions/); assert.doesNotMatch(result.stderr, /synthetic-external-data/);
});

test('decoder rejects empty, uniform, truncated and forged oversized PNG bytes', () => {
  assert.throws(() => decodeEvidencePng(Buffer.alloc(0)));
  const one = png(1, 1); assert.throws(() => decodeEvidencePng(one), /Blank/);
  assert.throws(() => decodeEvidencePng(png().subarray(0, 30)));
  const huge = png(); huge.writeUInt32BE(1_000_000, 16); assert.throws(() => decodeEvidencePng(huge), /bounds/);
});
