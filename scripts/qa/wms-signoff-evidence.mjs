import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, realpath, open, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateWmsSignoff } from './wms-signoff-contract.mjs';
import { validateManifest, assertHealth, assertUiPayload, reconcile, TARGET } from './wms-ecommerce-signoff-live.mjs';
import { generateEcommerceCleanup } from './wms-ecommerce-cleanup.mjs';
import { WMS_EVIDENCE_REGISTRY, WMS_EVIDENCE_LIMITS, WMS_EVIDENCE_FORMAT, EVIDENCE_SOURCE_FILES } from './wms-signoff-evidence-registry.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_BYTES = 32 * 1024 * 1024;
const exactKeys = (object, keys) => {
  assert(object && typeof object === 'object' && !Array.isArray(object), 'Object required');
  assert.deepEqual(Object.keys(object).sort(), [...keys].sort(), 'Unexpected/missing fields; unbound claims refused');
};
const timestamp = value => {
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19), 'UTC observation timestamp required');
  return Date.parse(value);
};

function safeRef(ref) {
  assert(typeof ref === 'string' && ref.length <= 600 && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref), 'Artifact confinement: relative portable path required');
  for (const part of ref.split('/')) assert(part && part !== '.' && part !== '..' && !part.endsWith('.')
    && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(part), 'Artifact confinement: unsafe path component');
  return ref;
}

export async function readEvidenceArtifact(root, descriptor) {
  exactKeys(descriptor, ['ref', 'sha256', 'byteLength']);
  safeRef(descriptor.ref);
  assert(HASH.test(descriptor.sha256), 'Artifact SHA256 required');
  assert(Number.isSafeInteger(descriptor.byteLength) && descriptor.byteLength > 0 && descriptor.byteLength <= MAX_BYTES, 'Artifact size bound exceeded');
  const bytes = await readConfined(root, descriptor.ref, descriptor.byteLength);
  assert.equal(sha(bytes), descriptor.sha256, 'Artifact hash mismatch');
  return bytes;
}

async function readConfined(root, ref, expectedSize) {
  safeRef(ref);
  const absoluteRoot = path.resolve(root);
  assert(!(await lstat(absoluteRoot)).isSymbolicLink(), 'Evidence root cannot be a link');
  const canonicalRoot = await realpath(absoluteRoot);
  let file = canonicalRoot;
  for (const [i, component] of ref.split('/').entries()) {
    file = path.join(file, component); const stat = await lstat(file);
    assert(!stat.isSymbolicLink(), 'Artifact confinement: links/junctions refused');
    assert(i === ref.split('/').length - 1 ? stat.isFile() : stat.isDirectory(), 'Regular artifact file required');
  }
  const relative = path.relative(canonicalRoot, await realpath(file));
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Artifact confinement failed');
  const handle = await open(file, 'r');
  try {
    const before = await handle.stat();
    assert(before.isFile() && before.size > 0 && before.size <= MAX_BYTES, 'Artifact size bound exceeded');
    if (expectedSize !== undefined) assert.equal(before.size, expectedSize, 'Artifact size mismatch');
    const bytes = await handle.readFile(); const after = await handle.stat();
    assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs, 'Artifact changed during read');
    assert.equal(bytes.length, before.size);
    return bytes;
  } finally { await handle.close(); }
}

export async function readTrustedEvidence(root, descriptor, trust, purpose) {
  assert(trust.records[purpose]?.includes(descriptor.sha256), 'Saved record not independently pinned for this purpose');
  return JSON.parse((await readEvidenceArtifact(root, descriptor)).toString('utf8'));
}

async function validateTrust(trust) {
  exactKeys(trust, ['version', 'kind', 'scope', 'origin', 'project', 'notBefore', 'notAfter', 'records', 'sourceHashes']);
  assert.equal(trust.version, 1); assert.equal(trust.kind, 'wms-evidence-trust');
  exactKeys(trust.scope, ['runId', 'buildId', 'environment']);
  assert(UUID.test(trust.scope.runId) && /^[a-f0-9]{40}$/.test(trust.scope.buildId));
  assert.equal(trust.scope.environment, 'uat'); assert.equal(trust.origin, TARGET.origin); assert.equal(trust.project, TARGET.project);
  assert(timestamp(trust.notBefore) < timestamp(trust.notAfter));
  exactKeys(trust.records, ['capture', 'review', 'cleanup']);
  const seen = new Set();
  for (const records of Object.values(trust.records)) {
    assert(Array.isArray(records), 'Coordinator-selected saved record hashes required');
    for (const digest of records) {
      assert(HASH.test(digest) && !seen.has(digest), 'Duplicate/invalid observation hash'); seen.add(digest);
    }
  }
  exactKeys(trust.sourceHashes, EVIDENCE_SOURCE_FILES);
  for (const file of EVIDENCE_SOURCE_FILES) {
    assert(HASH.test(trust.sourceHashes[file]));
    assert.equal(sha(await readFile(new URL(`../../${file}`, import.meta.url))), trust.sourceHashes[file], `Unreviewed local verifier/source revision: ${file}`);
  }
}

function scoped(payload, scope, trust) {
  assert.deepEqual(payload.scope, scope, 'Evidence run/build/view/environment mismatch');
  assert.equal(payload.project, trust.project); assert.equal(payload.origin, trust.origin);
  const at = timestamp(payload.observedAt);
  assert(at >= timestamp(trust.notBefore) && at <= timestamp(trust.notAfter), 'Observation outside coordinator-approved window');
  return at;
}

let PNG;
export function decodeEvidencePng(bytes) {
  assert(bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Real PNG required');
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  assert(width > 0 && height > 0 && width <= 8192 && height <= 30000 && width * height <= 24_000_000, 'PNG dimensions exceed inspection bounds');
  if (!PNG) {
    // Use the installed Playwright PNG decoder; no browser or network is started.
    const shell = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
    const playwright = createRequire(createRequire(shell.resolve('@playwright/test')).resolve('playwright'));
    PNG = playwright(path.join(path.dirname(playwright.resolve('playwright-core')), 'lib/utilsBundle.js')).PNG;
  }
  const image = PNG.sync.read(bytes, { checkCRC: true });
  assert.equal(image.width, width); assert.equal(image.height, height);
  assert(image.data.some((value, i) => value !== image.data[i % 4]), 'Blank uniform image cannot be reviewed evidence');
  return { width, height };
}

const QUERIES = {
  order: ['warehouse', 'fulfillment_orders', 'external_reference'], products: ['warehouse', 'products', 'id'],
  stock: ['warehouse', 'stock_levels', 'product_id'], movements: ['warehouse', 'movements', 'product_id'],
  reservations: ['warehouse', 'fulfillment_reservations', 'product_id'], holds: ['warehouse', 'inventory_holds', 'product_id'],
  allocations: ['warehouse', 'allocations', 'product_id'], units: ['warehouse', 'inventory_units', 'product_id'],
  activity: ['core', 'activity_log', 'entity_id'],
};

function completeRead(observation, checkIndex, check, c, actorId, start, end) {
  exactKeys(observation, ['checkIndex', 'actorId', 'queriedAt', 'queries']);
  assert.equal(observation.checkIndex, checkIndex); assert.equal(observation.actorId, actorId);
  const at = timestamp(observation.queriedAt); assert(at >= start && at <= end, 'Readback chronology invalid');
  assert.equal(check.readback?.source, 'persisted-requery');
  exactKeys(observation.queries, Object.keys(QUERIES));
  for (const [key, [schema, table, column]] of Object.entries(QUERIES)) {
    const rows = key === 'order' ? [check.readback.snapshot.order] : check.readback.snapshot[key];
    assert(Array.isArray(rows));
    assert.deepEqual(observation.queries[key], { schema, table, column,
      value: key === 'order' ? c.reference : key === 'activity' ? check.readback.snapshot.order.id : c.productId,
      returnedCount: rows.length, totalCount: rows.length }, 'Complete exact-filter readback counts required');
    if (key === 'activity') for (const row of rows) {
      assert.equal(row?.entity_id, check.readback.snapshot.order.id, 'Activity row must reference the exact owned order');
    }
  }
  return at;
}

async function ecommerceReceipt(root, entry, trust) {
  const json = async ref => JSON.parse((await readEvidenceArtifact(root, ref)).toString('utf8'));
  const capture = await readTrustedEvidence(root, entry.capture, trust, 'capture');
  exactKeys(capture, ['kind', 'scope', 'project', 'origin', 'observedAt', 'sources', 'manifest', 'report', 'reportFiles', 'command', 'authorities', 'reads', 'screenshots', 'fixtures', 'downloads']);
  assert.equal(capture.kind, 'wms-ecommerce-receipt-capture');
  const scope = { ...trust.scope, view: entry.view }; const captureAt = scoped(capture, scope, trust);
  exactKeys(capture.sources, EVIDENCE_SOURCE_FILES);
  for (const file of EVIDENCE_SOURCE_FILES) {
    const bytes = await readEvidenceArtifact(root, capture.sources[file]);
    assert.equal(sha(bytes), trust.sourceHashes[file], 'Captured source does not match reviewed executable');
  }
  const m = validateManifest(await json(capture.manifest));
  assert.equal(m.runId, scope.runId); assert.equal(m.commit, scope.buildId); assert.equal(m.project, trust.project);
  const report = await json(capture.report);
  assert.equal(report.runId, m.runId); assert.equal(report.commit, m.commit); assert.equal(report.environment, scope.environment);
  assert.equal(report.complete, true, 'Incomplete source attempt'); assert.deepEqual(report.failures, []);
  assert(!report.continuation, 'Historical continuation requires a separate reviewed adapter; no splicing');
  assertHealth(report.endHealth, m);
  assert(Array.isArray(report.checks) && Array.isArray(report.commands));
  const refs = [...report.checks.map(r => r.screenshot?.ref), ...report.commands.map(r => r.ref)];
  assert.equal(new Set(refs).size, refs.length, 'Source references must be unique');
  refs.forEach(safeRef); exactKeys(capture.reportFiles, refs);
  for (const ref of refs) {
    assert.equal(capture.reportFiles[ref].ref, path.posix.join(path.posix.dirname(capture.report.ref), ref));
    const bytes = await readEvidenceArtifact(root, capture.reportFiles[ref]);
    const screenshotCheck = report.checks.find(r => r.screenshot.ref === ref);
    if (screenshotCheck) {
      assert(['desktop1440', 'mobile390'].includes(screenshotCheck.view));
      assert.equal(decodeEvidencePng(bytes).width, screenshotCheck.view === 'desktop1440' ? 1440 : 390);
    } else JSON.parse(bytes.toString('utf8'));
  }
  const start = timestamp(report.startedAt); const end = timestamp(report.finishedAt);
  assert(start >= timestamp(trust.notBefore) && end >= start && end <= captureAt, 'Attempt chronology invalid');
  assert.equal(report.bindings.length, 2); assert.equal(new Set(report.bindings.map(b => b.orderId)).size, 2);
  for (const c of m.cases) {
    const b = report.bindings.filter(b => b.view === c.viewport); assert.equal(b.length, 1); assert(UUID.test(b[0].orderId));
    assert.deepEqual(b[0], { view: c.viewport, orderId: b[0].orderId, reference: c.reference, productId: c.productId });
    assert.equal(report.checks.filter(r => r.view === c.viewport && r.checkpoint === 'delivered-completed-reconciled').length, 1, 'Both viewport source outcomes required');
  }
  assert.equal(report.actors.length, 4); assert.equal(new Set(report.actors.map(a => a.id)).size, 4);
  assert.deepEqual(report.actors.map(a => a.role).sort(), ['marketing_events_lead', 'operations_associate', 'operations_lead', 'procurement_lead'].sort());
  const authorities = await json(capture.authorities);
  assert.equal(authorities.length, 4);
  for (const actor of report.actors) {
    assert(UUID.test(actor.id)); assert.equal(actor.source, 'core.my_capability_snapshot');
    const facts = authorities.filter(a => a.actorId === actor.id); assert.equal(facts.length, 1);
    const f = facts[0]; exactKeys(f, ['actorId', 'queriedAt', 'profile', 'userRoles', 'capabilitySnapshot']);
    assert(timestamp(f.queriedAt) >= start && timestamp(f.queriedAt) <= end);
    assert.equal(f.profile.id, actor.id); assert.equal(actor.authoritativeActor, f.profile.email || actor.id);
    assert.deepEqual(f.capabilitySnapshot, actor.capabilities);
    assert(Array.isArray(f.userRoles) && f.userRoles.length > 0);
    for (const row of f.userRoles) {
      exactKeys(row, ['user_id', 'module', 'role']); assert.equal(row.user_id, actor.id); assert.equal(row.module, 'warehouse');
      assert(WMS_EVIDENCE_REGISTRY.some(r => r.checkpoint === `roles.single.${row.role}`));
    }
    assert.equal(new Set(f.userRoles.map(r => r.role)).size, f.userRoles.length);
    const live = actor.capabilities?.userCapabilities?.warehouse; const granted = actor.capabilities?.roleCapabilities?.warehouse;
    assert(Array.isArray(live) && Array.isArray(granted));
    const required = actor.role === 'operations_associate' ? ['request_fulfillment', 'reserve_allocate', 'issue_items']
      : actor.role === 'operations_lead' ? ['issue_items'] : [];
    for (const capability of required) assert(live.includes(capability), 'Missing governed live authority');
    const forbidden = actor.role === 'marketing_events_lead' ? ['request_fulfillment']
      : actor.role === 'procurement_lead' ? ['request_fulfillment', 'reserve_allocate', 'issue_items'] : [];
    for (const capability of forbidden) assert(!live.includes(capability) && !granted.includes(capability));
  }
  const picker = report.actors.find(a => a.role === 'operations_associate'); const lead = report.actors.find(a => a.role === 'operations_lead');
  const identities = { creator: picker.id, picker: picker.id, releaser: lead.id, releaserLabel: lead.authoritativeActor };
  const c = m.cases.find(c => c.viewport === entry.view); assert(c);
  const indices = ['released-not-delivered', 'delivered-completed-reconciled'].map(checkpoint => {
    const found = report.checks.map((r, i) => ({ r, i })).filter(({ r }) => r.view === entry.view && r.checkpoint === checkpoint);
    assert.equal(found.length, 1); return found[0].i;
  });
  assert(indices[0] < indices[1]); assert.equal(capture.reads.length, 2); assert.equal(capture.screenshots.length, 2);
  const checks = indices.map(i => report.checks[i]);
  let previous = start;
  for (const [i, check] of checks.entries()) {
    assert.equal(check.kind, 'live'); assert.equal(check.actor.id, lead.id);
    previous = completeRead(capture.reads[i], indices[i], check, c, lead.id, previous, end);
    const inventory = reconcile(m, c, check.readback.snapshot, identities);
    assert.deepEqual(check.readback.inventory, inventory, 'Recompute inventory, never trust report booleans');
    assert.equal(check.screenshot.sessionActorId, lead.id);
    assert.equal(check.screenshot.width, entry.view === 'desktop1440' ? 1440 : 390);
    assert(check.screenshot.contentWidth <= check.screenshot.width + 1);
    const screenshot = capture.screenshots[i];
    assert.equal(screenshot.ref, path.posix.join(path.posix.dirname(capture.report.ref), check.screenshot.ref));
    const size = decodeEvidencePng(await readEvidenceArtifact(root, screenshot)); assert.equal(size.width, check.screenshot.width);
  }
  const released = checks[0].readback.snapshot.order; const completed = checks[1].readback.snapshot.order;
  assert.equal(released.id, completed.id); assert.equal(completed.id, report.bindings.find(b => b.view === entry.view).orderId);
  assert.equal(released.status, 'released'); assert.equal(released.shipment_status, 'dispatched'); assert.equal(released.delivered_at, null);
  assert.equal(released.proof_of_delivery_evidence_url, null); assert.equal(completed.status, 'completed');
  assert.deepEqual(checks[1].operation, { rpc: 'warehouse.update_shipment_tracking', action: 'confirm_delivery' });
  assert(timestamp(completed.delivered_at) >= timestamp(capture.reads[0].queriedAt)
    && timestamp(completed.delivered_at) <= timestamp(capture.reads[1].queriedAt), 'Delivery/readback chronology invalid');
  const command = await json(capture.command); assert.equal(command.name, 'update_shipment_tracking');
  assert.equal(command.payload.action, 'confirm_delivery'); assertUiPayload(c, completed.id, command.name, command.payload);
  assert.equal(command.payload.evidence_url, completed.proof_of_delivery_evidence_url);
  const recorded = report.commands.filter(r => r.name === command.name && r.orderId === completed.id && r.action === 'confirm_delivery');
  assert.equal(recorded.length, 1);
  assert.equal(capture.command.ref, path.posix.join(path.posix.dirname(capture.report.ref), recorded[0].ref));
  exactKeys(capture.fixtures, m.cases.map(c => c.viewport));
  const fixtures = {};
  for (const item of m.cases) {
    const descriptor = capture.fixtures[item.viewport];
    assert.equal(descriptor.ref, path.posix.join(path.posix.dirname(capture.report.ref), `${item.viewport}-synthetic-pod.png`));
    fixtures[item.viewport] = await readEvidenceArtifact(root, descriptor); decodeEvidencePng(fixtures[item.viewport]);
  }
  const proof = checks[1].readback.snapshot.privateStorageEvidence;
  assert.equal(proof.fixture.sha256, sha(fixtures[entry.view])); assert.equal(proof.fixture.byteLength, fixtures[entry.view].length);
  assert(timestamp(proof.verifiedAt) >= timestamp(completed.delivered_at) && timestamp(proof.verifiedAt) <= timestamp(capture.reads[1].queriedAt));
  assert.equal(capture.downloads.length, 2);
  for (const [i, download] of capture.downloads.entries()) {
    exactKeys(download, ['actorId', 'bucket', 'path', 'bytes']);
    const saved = proof.downloads[i];
    assert.equal(download.actorId, saved.actorId); assert.equal(download.bucket, saved.bucket); assert.equal(download.path, saved.path);
    const bytes = await readEvidenceArtifact(root, download.bytes); assert(bytes.equals(fixtures[entry.view]), 'Actual authorized download bytes differ');
  }
  const visual = await readTrustedEvidence(root, entry.visualReview, trust, 'review');
  exactKeys(visual, ['kind', 'scope', 'origin', 'project', 'observedAt', 'captureSha256', 'reviewer', 'screenshots']);
  assert.equal(visual.kind, 'wms-visual-review'); assert(scoped(visual, scope, trust) >= captureAt);
  assert.equal(visual.captureSha256, entry.capture.sha256); assert(typeof visual.reviewer === 'string' && visual.reviewer.trim());
  assert.equal(visual.screenshots.length, 2);
  for (const [i, reviewed] of visual.screenshots.entries()) {
    exactKeys(reviewed, ['artifact', 'actorId', 'outcome', 'notes']);
    assert.deepEqual(reviewed.artifact, capture.screenshots[i]); assert.equal(reviewed.actorId, lead.id);
    assert.equal(reviewed.outcome, 'passed'); assert(typeof reviewed.notes === 'string' && reviewed.notes.trim(), 'Actual reviewer observations required');
  }
  const cleanup = await readTrustedEvidence(root, entry.cleanup, trust, 'cleanup');
  exactKeys(cleanup, ['kind', 'scope', 'project', 'origin', 'observedAt', 'captureSha256', 'receipt', 'isolation',
    'storageApi', 'storageDb', 'execution', 'postcleanupSql', 'postcleanup', 'archives']);
  assert.equal(cleanup.kind, 'wms-cleanup-observation'); assert(scoped(cleanup, scope, trust) >= captureAt);
  assert.equal(cleanup.captureSha256, entry.capture.sha256);
  const receipt = await json(cleanup.receipt); const isolation = await json(cleanup.isolation);
  assert.equal(receipt.version, 2, 'Independent subsequent DB verification required');
  assert.equal(receipt.objects?.length, 2, 'Completed source requires both actual POD cleanup objects');
  for (const binding of report.bindings) {
    const object = receipt.objects.filter(o => o.view === binding.view && o.orderId === binding.orderId); assert.equal(object.length, 1);
    const final = report.checks.find(r => r.view === binding.view && r.checkpoint === 'delivered-completed-reconciled').readback.snapshot;
    assert.equal(object[0].path, final.order.proof_of_delivery_evidence_url, 'Cleanup must bind actual persisted POD path');
    assert.deepEqual(object[0].fixture, final.podFixture);
    assert.deepEqual(object[0].downloads.map(d => d.actorId), final.privateStorageEvidence.downloads.map(d => d.actorId));
  }
  const generated = generateEcommerceCleanup(m, { bindings: report.bindings, fixtures, storageReceipt: receipt, isolationReceipt: isolation });
  const db = await json(cleanup.storageDb); const api = await json(cleanup.storageApi);
  assert.equal(cleanup.storageDb.ref, path.posix.join(path.posix.dirname(cleanup.receipt.ref), receipt.databaseVerification.evidenceRef));
  assert.equal(sha(JSON.stringify(api)), receipt.databaseVerification.apiReceiptSha256, 'Actual Storage API receipt hash required');
  assert.equal(api.version, 1); assert.equal(api.kind, 'wms-ecommerce-storage-progress');
  assert.equal(api.status, 'api-verified-awaiting-independent-db');
  assert.deepEqual(api.isolationReceipt, isolation); assert.equal(api.apiVerifiedAt, receipt.inventory.verifiedAt);
  assert.deepEqual(api.expectedPaths, receipt.objects.map(o => o.path));
  assert.equal(api.objects.length, 2);
  for (const object of receipt.objects) {
    const actual = api.objects.filter(o => o.path === object.path); assert.equal(actual.length, 1);
    assert.equal(actual[0].status, 'api-absent'); assert.deepEqual(actual[0].deletion, object.deletion); assert.deepEqual(actual[0].absence, object.absence);
  }
  assert.equal(db.version, 1); assert.equal(db.kind, 'wms-ecommerce-storage-db-verification');
  for (const key of ['runId', 'project', 'commit', 'source', 'verifiedAt', 'apiReceiptSha256', 'expectedPaths', 'remainingObjects']) {
    assert.deepEqual(db[key], receipt.databaseVerification[key], `Actual Storage DB readback ${key} differs`);
  }
  const finalStates = m.cases.map(c => report.checks.find(r => r.view === c.viewport && r.checkpoint === 'delivered-completed-reconciled').readback.snapshot);
  const ordered = rows => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(ordered(db.orders), ordered(finalStates.map(s => s.order)), 'Subsequent DB order lineage changed');
  assert.deepEqual(ordered(db.products), ordered(finalStates.flatMap(s => s.products)), 'Subsequent DB product lineage changed');
  assert.deepEqual(api.orders, db.orders); assert.deepEqual(api.products, db.products);
  assert.equal((await readEvidenceArtifact(root, cleanup.postcleanupSql)).toString(), generated.postcleanupSql, 'Cleanup SQL must bind exact reviewed generator and scope');
  const post = await json(cleanup.postcleanup);
  const execution = await json(cleanup.execution);
  exactKeys(execution, ['source', 'project', 'sqlSha256', 'resultSha256', 'startedAt', 'finishedAt', 'exitCode', 'errors', 'warnings']);
  assert.equal(execution.source, 'independent-readonly-sql'); assert.equal(execution.project, m.project);
  assert.equal(execution.sqlSha256, cleanup.postcleanupSql.sha256); assert.equal(execution.resultSha256, cleanup.postcleanup.sha256);
  assert.equal(execution.exitCode, 0); assert.deepEqual(execution.errors, []); assert.deepEqual(execution.warnings, []);
  assert(timestamp(execution.startedAt) >= timestamp(db.verifiedAt) && timestamp(execution.finishedAt) >= timestamp(execution.startedAt)
    && timestamp(execution.finishedAt) <= timestamp(cleanup.observedAt), 'Independent postcleanup execution chronology invalid');
  for (const [key, value] of Object.entries({ runId: m.runId, project: m.project, manifestCommit: m.commit })) assert.equal(post[key], value);
  assert.equal(post.receiptSha256, sha(JSON.stringify(receipt))); assert.equal(post.isolationReceiptSha256, sha(JSON.stringify(isolation)));
  assert.equal(post.allResidueVerified, false, 'Cannot claim universal residue coverage');
  assert.deepEqual(Object.keys(post.counts).sort(), ['core.activity_log', 'core.notifications', 'warehouse.command_log', 'warehouse.fulfillment_orders',
    'warehouse.fulfillment_reservations', 'warehouse.movements', 'warehouse.stock_levels', 'warehouse.products', 'warehouse.storage_areas', 'warehouse.locations'].sort());
  for (const value of Object.values(post.counts)) assert.equal(value, 0, 'Cleanup residue remains');
  assert.equal(post.databaseRowsRemaining, 0); assert.deepEqual(post.storageObjects, []); assert.deepEqual(post.evidence, []);
  assert.equal(cleanup.archives.length, 2);
  for (const object of receipt.objects) {
    const archives = cleanup.archives.filter(a => a.path === object.path); assert.equal(archives.length, 1);
    exactKeys(archives[0], ['path', 'bytes']);
    assert((await readEvidenceArtifact(root, archives[0].bytes)).equals(fixtures[object.view]), 'Cleanup archive bytes differ');
    assert(timestamp(receipt.databaseVerification.verifiedAt) <= timestamp(cleanup.observedAt));
  }
  return { checkpoint: entry.checkpoint, view: entry.view, actorId: lead.id, orderId: completed.id,
    captureSha256: entry.capture.sha256, artifactStatus: 'verified', contractCredit: false,
    recomputedChecks: WMS_EVIDENCE_REGISTRY.find(r => r.checkpoint === entry.checkpoint).checks,
    limitation: 'Receipt and scoped cleanup material only; injected-failure cleanup and full journey adapters remain unimplemented.' };
}

export async function verifyWmsEvidence({ root, index, trust }) {
  await validateTrust(trust);
  exactKeys(index, ['version', 'kind', 'scope', 'entries', 'humanGates']);
  assert.equal(index.version, 1); assert.equal(index.kind, 'wms-signoff-evidence-index'); assert.deepEqual(index.scope, trust.scope);
  assert(Array.isArray(index.entries) && index.entries.length <= 88);
  assert.deepEqual(index.humanGates, [], 'Human attestations require a separate reviewed adapter; cannot self-approve');
  const seen = new Set(); const verifiedArtifacts = []; const artifactFailures = [];
  for (const entry of index.entries) {
    exactKeys(entry, ['checkpoint', 'view', 'capture', 'visualReview', 'cleanup']);
    const key = `${entry.checkpoint}:${entry.view}`; assert(!seen.has(key), 'Duplicate checkpoint/view'); seen.add(key);
    const registered = WMS_EVIDENCE_REGISTRY.find(r => r.checkpoint === entry.checkpoint && r.views.includes(entry.view));
    assert(registered, 'Unknown checkpoint/view; aliases refused');
    if (!registered.artifactAdapter) { artifactFailures.push({ key, reason: 'Unsupported artifact adapter' }); continue; }
    try { verifiedArtifacts.push(await ecommerceReceipt(root, entry, trust)); }
    catch (error) { artifactFailures.push({ key, reason: error.message.split('\n')[0] }); }
  }
  // No partial material is promoted to contract rows. In particular normal cleanup
  // is not an injected-failure cleanup test. The unchanged full contract stays red.
  const contract = evaluateWmsSignoff({ scope: trust.scope, evidence: [], humanGates: [] });
  return { ...contract, phase: 'offline-integration', verifiedArtifacts, artifactFailures,
    unsupported: WMS_EVIDENCE_REGISTRY.flatMap(r => r.views.map(view => ({ checkpoint: r.checkpoint, view, blockers: r.blockers }))),
    limits: WMS_EVIDENCE_LIMITS };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, root, indexRef, trustFile, trustSha256, ...extra] = process.argv.slice(2);
    if (command === 'registry' && !root) console.log(JSON.stringify({ registry: WMS_EVIDENCE_REGISTRY, format: WMS_EVIDENCE_FORMAT, limits: WMS_EVIDENCE_LIMITS }, null, 2));
    else {
      assert(command === 'verify' && root && indexRef && trustFile && HASH.test(trustSha256) && !extra.length,
        'Usage: registry | verify EVIDENCE_ROOT INDEX_REF COORDINATOR_TRUST_FILE TRUST_SHA256');
      const policy = await readFile(path.resolve(trustFile));
      assert(policy.length <= MAX_BYTES && sha(policy) === trustSha256, 'Independent coordinator trust-file hash mismatch');
      // The index is routing only. Observation hashes are independently selected.
      const bytes = await readConfined(root, indexRef);
      const result = await verifyWmsEvidence({ root, index: JSON.parse(bytes), trust: JSON.parse(policy) });
      console.log(JSON.stringify(result, null, 2)); process.exitCode = result.automatedPassed ? 0 : 1;
    }
  } catch (error) { console.error(`WMS offline evidence rejected: ${error.message.split('\n')[0]}`); process.exitCode = 1; }
}
