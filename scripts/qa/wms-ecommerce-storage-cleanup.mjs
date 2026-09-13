import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { lstat, mkdir, open, readFile, realpath, rename, unlink, link } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest, reconcile, assertHealth } from './wms-ecommerce-signoff-live.mjs';
import { generateEcommerceCleanup, generateEcommerceStorageReferencePreflight, validateEcommerceSchemaCoverage, isVerifiedStorageAbsence } from './wms-ecommerce-cleanup.mjs';

// Offline imports/default CLI. No env files, stored auth sessions, SQL writes or bucket reset.
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const MAX_BYTES = 8 * 1024 * 1024;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const digest = value => sha(canonical(value));
const now = () => new Date().toISOString();
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const principal = project => ({ kind: 'service_role', project, credentialSource: 'authenticated-supabase-cli' });
const prefixes = input => input.bindings.flatMap(b => [`delivery-${b.orderId}/`, `fulfillment/${b.orderId}/`, `acknowledgment-${b.orderId}/`]);
const json = value => `'${JSON.stringify(value).replaceAll("'", "''")}'::jsonb`;
const sqlString = value => `'${String(value).replaceAll("'", "''")}'`;
const inside = (root, file) => { const relative = path.relative(root, file); assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Path escaped owned directory'); };

async function regular(file) {
  const info = await lstat(file);
  assert(info.isFile() && !info.isSymbolicLink(), 'Unsafe local proof/archive file');
  assert(info.size <= 32 * 1024 * 1024, 'Oversized local proof/archive');
  return readFile(file);
}
async function plainDirectory(dir) {
  assert.equal(await realpath(dir), path.resolve(dir), 'Directory redirected by symlink/junction');
  const info = await lstat(dir); assert(info.isDirectory() && !info.isSymbolicLink(), 'Unsafe directory');
}
async function readJson(file) { return JSON.parse(await regular(file)); }
async function durable(file, bytes) {
  const handle = await open(file, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function publishExact(file, bytes) {
  const expected = Buffer.from(bytes);
  const matches = async () => { assert.deepEqual(await regular(file), expected, 'Conflicting published artifact; never overwrite'); };
  try { await lstat(file); await matches(); return; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Hard-link publication is atomic and exclusive. A partial write remains only in
  // an owned temporary file, never at the final receipt path.
  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await durable(temp, expected);
    try { await link(temp, file); } catch (error) { if (error.code !== 'EEXIST') throw error; await matches(); }
  } finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}
async function persist(file, value) {
  await regular(file); // Only replace our already-validated progress file, never a symlink.
  const temp = `${file}.${randomUUID()}.tmp`;
  await durable(temp, JSON.stringify(value, null, 2)); await rename(temp, file);
}

export async function loadEcommerceStorageInputs(runDirectory, attemptName) {
  assert(/^attempt-[0-9TZ-]+-[a-f0-9]{8}$/.test(attemptName), 'Exact attempt directory basename required');
  const root = path.resolve(runDirectory); await plainDirectory(root);
  const attempt = path.join(root, attemptName); inside(root, attempt); await plainDirectory(attempt);
  const m = validateManifest(await readJson(path.join(root, 'manifest.json')));
  assert.equal(m.kind, 'wms-ecommerce-shipment', 'Department manifests forbidden');
  const reportBytes = await regular(path.join(attempt, 'results.json')); const report = JSON.parse(reportBytes);
  assert.equal(report.runId, m.runId); assert.equal(report.commit, m.commit); assert.equal(report.environment, 'uat');
  assert.equal(report.complete, true, 'Only completed ecommerce attempts with actual POD proofs are supported');
  assert.deepEqual(report.failures, []); assertHealth(report.endHealth, m);
  assert(timestamp(report.startedAt) && timestamp(report.finishedAt), 'Attempt times required');
  assert.equal(report.bindings?.length, m.cases.length, 'Complete exact ecommerce bindings required');
  generateEcommerceCleanup(m, { bindings: report.bindings });
  const bindings = m.cases.map(c => report.bindings.find(b => b.view === c.viewport));
  assert.deepEqual(report.bindings, bindings, 'Bindings must preserve manifest viewport order');
  const actor = role => {
    const rows = report.actors?.filter(a => a.role === role);
    assert(rows?.length === 1 && UUID.test(rows[0].id), 'Real actor UUID proof required'); return rows[0];
  };
  const picker = actor('operations_associate'); const releaser = actor('operations_lead');
  assert.notEqual(picker.id, releaser.id);
  assert(typeof releaser.authoritativeActor === 'string' && releaser.authoritativeActor.length > 0, 'Persisted release label required');
  const actors = { creator: picker.id, picker: picker.id, releaser: releaser.id, releaserLabel: releaser.authoritativeActor };
  assert.equal(report.privateStorageEvidence?.length, m.cases.length); assert.equal(report.storageAttempts?.length, m.cases.length);
  const fixtures = {}; const objects = [];
  for (const [i, c] of m.cases.entries()) {
    const b = bindings[i]; const bytes = await regular(path.join(attempt, `${c.viewport}-synthetic-pod.png`));
    assert(bytes.length > 8 && bytes.length <= MAX_BYTES && bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a', 'Actual PNG fixture required');
    const fixture = { ref: `${c.viewport}-synthetic-pod.png`, sha256: sha(bytes), byteLength: bytes.length };
    assert.deepEqual(await readJson(path.join(attempt, `${c.viewport}-pod-fixture.json`)), fixture, 'Fixture hash metadata mismatch');
    const proof = await readJson(path.join(attempt, `${c.viewport}-private-storage.json`));
    assert.deepEqual(report.privateStorageEvidence[i], proof, 'Attempt/private Storage proof mismatch');
    assert.deepEqual(report.storageAttempts[i], proof.upload, 'Upload attempt/proof mismatch');
    assert.deepEqual(proof.fixture, fixture, 'Private Storage fixture mismatch');
    assert(timestamp(proof.verifiedAt) && Date.parse(proof.verifiedAt) >= Date.parse(report.startedAt)
      && Date.parse(proof.verifiedAt) <= Date.parse(report.finishedAt), 'Proof timestamp outside attempt');
    assert(proof.downloads.every(d => UUID.test(d.actorId) && d.principal === undefined), 'Downloads must remain real user UUIDs');
    const candidates = report.checks.filter(check => check.view === c.viewport && check.readback?.snapshot?.order?.status === 'completed');
    assert(candidates.length, 'Persisted completed-order checkpoint required');
    const snapshot = candidates.at(-1).readback.snapshot;
    assert.equal(snapshot.order.id, b.orderId); assert.deepEqual(snapshot.privateStorageEvidence, proof);
    reconcile(m, c, { ...snapshot, podFixture: fixture, privateStorageEvidence: proof }, actors);
    const parts = proof.path.split('/');
    assert(parts.length === 3 && parts[0] === `delivery-${b.orderId}` && parts[1] === '0'
      && parts[2].endsWith('.png') && UUID.test(parts[2].slice(0, -4)), 'Unreviewed Storage path');
    fixtures[c.viewport] = bytes;
    objects.push({ view: c.viewport, orderId: b.orderId, bucket: 'evidence', path: proof.path, fixture,
      proof, proofSha256: digest(proof), proofRef: `${c.viewport}-private-storage.json` });
  }
  assert.equal(new Set(objects.map(o => o.path)).size, objects.length);
  const scope = { runId: m.runId, project: m.project, commit: m.commit, attemptName, manifestSha256: digest(m), reportSha256: sha(reportBytes),
    bindings, objects: objects.map(({ view, orderId, bucket, path: objectPath, fixture, proofSha256, proofRef }) => ({ view, orderId, bucket, path: objectPath, fixture, proofSha256, proofRef })) };
  return { root, attempt, attemptName, outputRoot: path.join(attempt, 'ecommerce-storage-cleanup'), manifest: m, bindings, actors, fixtures, objects, scope, scopeSha256: digest(scope) };
}

function approval(m, options) {
  validateManifest(m);
  assert(options.apply === true && options.allowCliCredential === true && options.confirmRun === m.runId,
    'Explicit --apply --allow-cli-credential --confirm-run UUID approval required');
}

export async function acquireAdministrativeCredential(manifest, options, invoke) {
  approval(manifest, options);
  try {
    if (!invoke) {
      const require = createRequire(import.meta.url);
      const launcher = require.resolve('supabase/dist/supabase.js');
      invoke = async args => {
        const env = { ...process.env };
        for (const key of ['SUPABASE_CLI_BINARY_OVERRIDE', 'NODE_OPTIONS', 'NODE_DEBUG', 'DEBUG']) delete env[key];
        const result = await promisify(execFile)(process.execPath, [launcher, ...args], { windowsHide: true, timeout: 30000, maxBuffer: 2 * 1024 * 1024, env });
        return result.stdout;
      };
    }
    // stdout exists only in memory. Never print/persist the CLI response or error.
    const rows = JSON.parse(await invoke(['projects', 'api-keys', '--project-ref', manifest.project, '--reveal', '--output', 'json', '--log-level', 'none']));
    assert(Array.isArray(rows), 'Unknown CLI result envelope');
    const keys = rows.filter(r => r.name === 'service_role' && typeof r.api_key === 'string');
    assert.equal(keys.length, 1, 'Exactly one existing service_role credential required');
    const token = keys[0].api_key; const parts = token.split('.'); assert.equal(parts.length, 3);
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    assert.equal(payload.role, 'service_role'); assert.equal(payload.ref, manifest.project);
    return token;
  } catch { throw new Error('Authenticated CLI credential acquisition failed; no key/output persisted'); }
}

export function createAdministrativeBackend(input, credential, fetcher = fetch) {
  const base = `https://${input.manifest.project}.supabase.co`;
  const request = async (route, { method = 'GET', body, schema } = {}) => {
    let response;
    try {
      response = await fetcher(base + route, { method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(20000),
        headers: { apikey: credential, Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json',
          ...(schema ? { 'Accept-Profile': schema, Prefer: 'count=exact' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    } catch { throw new Error('Administrative request failed; response omitted'); }
    return response;
  };
  const rows = async (schema, table, column, value) => {
    const query = new URLSearchParams({ select: '*', [column]: `eq.${value}`, limit: '100', order: 'id.asc' });
    const r = await request(`/rest/v1/${table}?${query}`, { schema }); assert(r.ok, 'Read-only lineage API failed');
    const data = await r.json(); const total = Number(r.headers.get('content-range')?.split('/')[1]);
    assert(Array.isArray(data) && data.length < 100 && total === data.length, 'Incomplete lineage read'); return data;
  };
  const objectRoute = name => {
    assert(input.objects.some(o => o.path === name), 'Foreign Storage object refused');
    return `/storage/v1/object/authenticated/evidence/${name}`;
  };
  return {
    async getBucket() { const r = await request('/storage/v1/bucket/evidence'); assert(r.ok, 'Private bucket read failed'); return r.json(); },
    async readSnapshot(c) {
      assert(input.manifest.cases.some(x => x.productId === c.productId), 'Foreign fixture read refused');
      const orders = await rows('warehouse', 'fulfillment_orders', 'external_reference', c.reference); assert.equal(orders.length, 1);
      const result = { order: orders[0] };
      for (const [key, table] of Object.entries({ products: 'products', stock: 'stock_levels', movements: 'movements', reservations: 'fulfillment_reservations',
        holds: 'inventory_holds', allocations: 'allocations', units: 'inventory_units' })) result[key] = await rows('warehouse', table, key === 'products' ? 'id' : 'product_id', c.productId);
      result.activity = await rows('core', 'activity_log', 'entity_id', result.order.id); return result;
    },
    async list(prefix) {
      assert(prefixes(input).some(p => prefix === p.slice(0, -1) || prefix.startsWith(p)), 'Foreign inventory prefix refused');
      const r = await request('/storage/v1/object/list/evidence', { method: 'POST', body: { prefix, limit: 100, offset: 0, sortBy: { column: 'name', order: 'asc' } } });
      assert(r.ok, 'Storage inventory API failed'); return r.json();
    },
    async download(name) {
      const r = await request(objectRoute(name)); assert(r.ok, 'Archive download failed');
      assert(r.headers.get('content-type')?.split(';')[0] === 'image/png', 'Archive content type mismatch');
      const bytes = Buffer.from(await r.arrayBuffer()); assert(bytes.length <= MAX_BYTES, 'Oversized Storage object'); return { httpStatus: r.status, bytes };
    },
    async remove(name) {
      objectRoute(name);
      const r = await request('/storage/v1/object/evidence', { method: 'DELETE', body: { prefixes: [name] } });
      assert(r.ok, 'Storage removal API failed'); const data = await r.json(); assert(Array.isArray(data), 'Unknown removal result');
      return { httpStatus: r.status, names: data.map(row => row.name) };
    },
    async absence(name) {
      const r = await request(objectRoute(name)); let body;
      try { body = await r.json(); } catch { body = {}; }
      return { httpStatus: r.status, storageErrorCode: body.code ?? body.error, storageStatusCode: body.statusCode };
    },
  };
}

async function freshLineage(input, backend) {
  const snapshots = [];
  for (const [i, c] of input.manifest.cases.entries()) {
    const s = await backend.readSnapshot(c); assert.equal(s.order?.id, input.bindings[i].orderId); assert.equal(s.order.status, 'completed');
    const snapshot = { ...s, podFixture: input.objects[i].fixture, privateStorageEvidence: input.objects[i].proof };
    reconcile(input.manifest, c, snapshot, input.actors); snapshots.push(snapshot);
  }
  return { sha256: digest(snapshots), snapshots, orders: snapshots.map(s => s.order), products: snapshots.flatMap(s => s.products) };
}

export function prepareEcommerceStoragePreflight(input, isolationReceipt) {
  const generated = generateEcommerceStorageReferencePreflight(input.manifest, { bindings: input.bindings, objects: input.objects,
    isolationReceipt, scopeSha256: input.scopeSha256 });
  return { ...generated, filename: `storage-reference-preflight-${sha(generated.sql).slice(0, 16)}.sql` };
}

function validateReferenceVerification(input, isolationReceipt, receipt, requireFresh = true) {
  assert(receipt, 'Fresh independent reference preflight required before Storage cleanup');
  const { context } = prepareEcommerceStoragePreflight(input, isolationReceipt);
  for (const [key, expected] of Object.entries(context)) assert.deepEqual(receipt[key], expected, `Reference preflight ${key} mismatch`);
  validateEcommerceSchemaCoverage(receipt);
  assert(timestamp(receipt.verifiedAt) && Date.parse(receipt.verifiedAt) >= Date.parse(isolationReceipt.verifiedAt), 'Reference preflight must follow scoped isolation');
  if (requireFresh) {
    const age = Date.now() - Date.parse(receipt.verifiedAt);
    assert(age >= 0 && age <= 10 * 60 * 1000, 'Stale/future reference preflight; repeat independent scan under continuous isolation');
  }
  assert(Array.isArray(receipt.scannedRelations) && new Set(receipt.scannedRelations).size === receipt.scannedRelations.length, 'Incomplete reference scan inventory');
  for (const table of ['warehouse.fulfillment_orders', 'warehouse.products', 'warehouse.fulfillment_reservations', 'warehouse.stock_levels',
    'warehouse.movements', 'warehouse.locations', 'warehouse.storage_areas', 'warehouse.command_log', 'core.activity_log', 'core.notifications']) {
    assert(receipt.scannedRelations.includes(table) && Array.isArray(receipt.ownedRows?.[table]), 'Incomplete reference scan/owned lineage');
  }
  assert(Array.isArray(receipt.storageObjects) && new Set(receipt.storageObjects.map(o => o.path)).size === receipt.storageObjects.length);
  for (const o of receipt.storageObjects) assert(o.bucket === 'evidence' && context.expectedPaths.includes(o.path)
    && UUID.test(o.id) && Number.isFinite(Date.parse(o.created_at)) && Number.isFinite(Date.parse(o.updated_at))
    && Number.isSafeInteger(o.size) && o.mimetype === 'image/png', 'Unreviewed preflight Storage object');
  return receipt;
}

function referenceMatchesLive(receipt, lineage, current) {
  const ordered = rows => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const [key, table] of Object.entries({ products: 'warehouse.products', stock: 'warehouse.stock_levels', reservations: 'warehouse.fulfillment_reservations',
    movements: 'warehouse.movements', activity: 'core.activity_log' })) {
    assert.deepEqual(ordered(lineage.snapshots.flatMap(s => s[key])), ordered(receipt.ownedRows[table]), `Reference preflight ${key} lineage changed`);
  }
  assert.deepEqual(ordered(lineage.orders), ordered(receipt.ownedRows['warehouse.fulfillment_orders']), 'Reference preflight order lineage changed');
  const versions = rows => rows.map(o => ({ path: o.path, id: o.id, created: Date.parse(o.created_at), updated: Date.parse(o.updated_at), size: o.size, mimetype: o.mimetype }))
    .sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(versions(current), versions(receipt.storageObjects), 'Reference preflight Storage inventory/version changed');
}

async function inventory(input, backend) {
  const bucket = await backend.getBucket(); assert.equal(bucket.id, 'evidence'); assert.equal(bucket.public, false, 'Private bucket required');
  const found = []; let visited = 0;
  const walk = async (prefix, depth = 0) => {
    assert(depth <= 3 && ++visited <= 30, 'Unexpected inventory depth/volume');
    const entries = await backend.list(prefix); assert(Array.isArray(entries) && entries.length < 100, 'Partial Storage inventory refused');
    const seen = new Set();
    for (const e of entries) {
      assert(e && /^[A-Za-z0-9._-]+$/.test(e.name) && !['.', '..'].includes(e.name) && !seen.has(e.name), 'Unsafe/duplicate inventory entry'); seen.add(e.name);
      const name = `${prefix}/${e.name}`;
      if (e.id === null) await walk(name, depth + 1);
      else {
        assert(UUID.test(e.id) && Number.isFinite(Date.parse(e.created_at)) && Number.isFinite(Date.parse(e.updated_at)), 'Missing Storage object version');
        assert(Number.isSafeInteger(e.metadata?.size) && e.metadata.size > 0 && e.metadata.size <= MAX_BYTES && e.metadata.mimetype === 'image/png', 'Unreviewed Storage metadata');
        found.push({ path: name, id: e.id, created_at: e.created_at, updated_at: e.updated_at, size: e.metadata.size, mimetype: e.metadata.mimetype });
      }
    }
  };
  for (const prefix of prefixes(input)) await walk(prefix.slice(0, -1));
  assert.equal(new Set(found.map(o => o.path)).size, found.length);
  return found.sort((a, b) => a.path.localeCompare(b.path));
}

async function verifyArchive(input, object) {
  await plainDirectory(input.outputRoot); await plainDirectory(path.join(input.outputRoot, 'archived-evidence'));
  const bytes = await regular(path.join(input.outputRoot, 'archived-evidence', object.fixture.sha256 + '.png'));
  assert.equal(sha(bytes), object.fixture.sha256, 'Archive hash mismatch'); assert.equal(bytes.length, object.fixture.byteLength, 'Archive size mismatch');
}

async function validateRecordedRemoval(input, state, object, record) {
  assert.equal(record.path, object.path, 'Foreign removal record');
  assert(['delete-requested', 'api-absent'].includes(record.status), 'Invalid removal state');
  const deletion = record.deletion;
  assert(deletion?.source === 'authenticated-storage-remove' && Number.isInteger(deletion.httpStatus)
    && deletion.httpStatus >= 200 && deletion.httpStatus < 300, 'Successful recorded removal required');
  assert.deepEqual(deletion.principal, principal(input.manifest.project)); assert(!Object.hasOwn(deletion, 'actorId'));
  assert(timestamp(record.requestedAt) && timestamp(deletion.deletedAt)
    && Date.parse(record.requestedAt) <= Date.parse(deletion.deletedAt) && Date.parse(deletion.deletedAt) <= Date.now(), 'Invalid removal chronology');
  const preflight = state.referenceVerifications?.find(v => digest(v) === record.referencePreflightSha256);
  assert(preflight, 'Removal missing archived reference preflight');
  validateReferenceVerification(input, state.isolationReceipt, preflight, false);
  assert.deepEqual(await regular(path.join(input.outputRoot, `reference-preflight-${digest(preflight)}.json`)),
    Buffer.from(JSON.stringify(preflight, null, 2)), 'Archived reference preflight mismatch');
  assert(Date.parse(record.requestedAt) >= Date.parse(preflight.verifiedAt)
    && Date.parse(record.requestedAt) - Date.parse(preflight.verifiedAt) <= 10 * 60 * 1000, 'Removal missing fresh reference preflight');
  const original = state.initialInventory.find(o => o.path === object.path);
  const verified = preflight.storageObjects.find(o => o.path === object.path);
  assert(original && verified, 'Removed object missing from original/preflight inventory');
  const version = o => [o.path, o.id, Date.parse(o.created_at), Date.parse(o.updated_at), o.size, o.mimetype];
  assert.deepEqual(version(original), version(verified), 'Removal preflight object/version mismatch');
  assert.equal(record.archiveSha256, object.fixture.sha256);
  assert(timestamp(record.archivedAt) && Date.parse(record.archivedAt) <= Date.parse(record.requestedAt));
  await verifyArchive(input, object);
}

export async function cleanupEcommerceStorage({ input, isolationReceipt, referenceVerification, backend, resume = false, ...options }) {
  approval(input.manifest, options);
  // Validate isolation before credentials, files or network. No Storage receipt is invented here.
  assert(isolationReceipt, 'Run-specific isolation receipt required');
  generateEcommerceCleanup(input.manifest, { bindings: input.bindings, isolationReceipt });
  const freshInput = await loadEcommerceStorageInputs(input.root, input.attemptName);
  assert.equal(freshInput.scopeSha256, input.scopeSha256, 'Attempt input changed');
  assert.deepEqual(input.objects, freshInput.objects, 'Attempt object scope changed');
  input = freshInput;
  if (!resume) validateReferenceVerification(input, isolationReceipt, referenceVerification);
  if (!resume) await mkdir(input.outputRoot); else await plainDirectory(input.outputRoot);
  const lockPath = path.join(input.outputRoot, 'executor.lock'); const lock = await open(lockPath, 'wx');
  const progressPath = path.join(input.outputRoot, 'progress.json'); let state; let writable = false;
  try {
    if (resume) {
      state = await readJson(progressPath);
      assert.equal(state.kind, 'wms-ecommerce-storage-progress'); assert.equal(state.version, 1); assert.equal(state.scopeSha256, input.scopeSha256);
      assert.deepEqual(state.isolationReceipt, isolationReceipt, 'Isolation changed; independent review required');
      assert.deepEqual(state.expectedPaths, input.objects.map(o => o.path));
      assert.deepEqual(state.initialInventory.map(o => o.path).sort(), [...state.expectedPaths].sort());
      assert(Array.isArray(state.objects) && new Set(state.objects.map(o => o.path)).size === state.objects.length);
      for (const record of state.objects) {
        const object = input.objects.find(o => o.path === record.path); assert(object, 'Foreign progress object');
        assert(['archived', 'delete-requested', 'api-absent'].includes(record.status));
        if (Object.hasOwn(record, 'deletion') || record.status === 'api-absent') await validateRecordedRemoval(input, state, object, record);
        else await verifyArchive(input, object);
      }
      if (existsComplete(state)) return await publishCompleted(input, state);
    }
    validateReferenceVerification(input, isolationReceipt, referenceVerification);
    if (!backend) backend = createAdministrativeBackend(input, await acquireAdministrativeCredential(input.manifest, options));
    const lineage = await freshLineage(input, backend); const lineageSha256 = lineage.sha256;
    if (state) assert.equal(state.lineageSha256, lineageSha256, 'Live lineage changed since archive');
    const initial = await inventory(input, backend);
    referenceMatchesLive(referenceVerification, lineage, initial);
    const check = current => {
      assert(current.every(o => input.objects.some(x => x.path === o.path)), 'Unexpected Storage object; never delete discoveries');
      for (const object of input.objects) {
        const item = current.find(o => o.path === object.path); const record = state?.objects.find(o => o.path === object.path);
        if (!item) assert(record?.deletion && ['delete-requested', 'api-absent'].includes(record.status), 'Missing unproven object; uncertain response needs independent manual review');
        else {
          assert(!record?.deletion && record?.status !== 'api-absent', 'Object present after confirmed removal; independent review required');
          if (state) assert.deepEqual(item, state.initialInventory.find(o => o.path === item.path), 'Storage object version changed');
        }
      }
    };
    check(initial);
    if (!state) {
      state = { version: 1, kind: 'wms-ecommerce-storage-progress', scopeSha256: input.scopeSha256, expectedPaths: input.objects.map(o => o.path),
        isolationReceipt, lineageSha256, lineageSnapshots: lineage.snapshots, orders: lineage.orders, products: lineage.products,
        initialInventory: initial, objects: [], status: 'archiving', inventoryComplete: false, referenceVerifications: [] };
      await durable(progressPath, JSON.stringify(state, null, 2)); await mkdir(path.join(input.outputRoot, 'archived-evidence'));
    }
    writable = true;
    const save = () => persist(progressPath, state);
    const referenceSha256 = digest(referenceVerification);
    await publishExact(path.join(input.outputRoot, `reference-preflight-${referenceSha256}.json`), JSON.stringify(referenceVerification, null, 2));
    state.referenceVerifications ??= [];
    if (!state.referenceVerifications.some(r => digest(r) === referenceSha256)) state.referenceVerifications.push(referenceVerification);
    await save();
    const download = async object => {
      const r = await backend.download(object.path); assert(r.httpStatus >= 200 && r.httpStatus < 300);
      assert(r.bytes instanceof Uint8Array && r.bytes.byteLength === object.fixture.byteLength && sha(r.bytes) === object.fixture.sha256, 'Fresh Storage hash differs from actual synthetic fixture'); return r.bytes;
    };
    // All exact objects are archived and reread from disk before ANY remove.
    for (const item of initial) {
      const object = input.objects.find(o => o.path === item.path); const bytes = await download(object);
      const existing = state.objects.find(o => o.path === item.path);
      if (!existing) {
        await plainDirectory(path.join(input.outputRoot, 'archived-evidence'));
        await durable(path.join(input.outputRoot, 'archived-evidence', object.fixture.sha256 + '.png'), bytes);
        state.objects.push({ path: item.path, status: 'archived', archiveSha256: object.fixture.sha256, archivedAt: now() });
        await save();
      }
      await verifyArchive(input, object);
    }
    assert.equal(state.objects.length, input.objects.length, 'Incomplete archive phase');
    const recheck = async () => {
      assert.equal((await loadEcommerceStorageInputs(input.root, input.attemptName)).scopeSha256, input.scopeSha256, 'Attempt proof changed');
      assert.equal((await freshLineage(input, backend)).sha256, lineageSha256, 'Live lineage changed');
      const current = await inventory(input, backend); check(current);
      for (const object of input.objects) {
        await verifyArchive(input, object);
        if (current.some(x => x.path === object.path)) await download(object);
      }
      return current;
    };
    for (const object of input.objects) {
      const current = await recheck(); const record = state.objects.find(o => o.path === object.path);
      if (current.some(o => o.path === object.path)) {
        validateReferenceVerification(input, isolationReceipt, referenceVerification);
        record.status = 'delete-requested'; record.requestedAt = now(); record.referencePreflightSha256 = referenceSha256; await save();
        validateReferenceVerification(input, isolationReceipt, referenceVerification);
        const removed = await backend.remove(object.path);
        assert(removed.httpStatus >= 200 && removed.httpStatus < 300); assert.deepEqual(removed.names, [object.path], 'Exact removal response required');
        record.deletion = { source: 'authenticated-storage-remove', principal: principal(input.manifest.project), httpStatus: removed.httpStatus, deletedAt: now() }; await save();
      }
      const absence = await backend.absence(object.path); assert(isVerifiedStorageAbsence(absence), 'Authenticated object absence not proven');
      record.absence = { source: 'authenticated-storage-download', principal: principal(input.manifest.project), ...absence, verifiedAt: now() };
      record.status = 'api-absent'; await save();
    }
    assert.equal((await recheck()).length, 0, 'Storage API inventory is not empty');
    state.status = 'api-verified-awaiting-independent-db'; state.apiVerifiedAt = now(); await save();
    return await publishCompleted(input, state);
  } catch {
    if (writable && !existsComplete(state)) { state.inventoryComplete = false; state.lastFailure = { at: now(), code: 'CHECK_FAILED_OR_UNCERTAIN_RESPONSE' }; await persist(progressPath, state); }
    throw new Error('Storage cleanup stopped; no completion claim. Review owned progress/archives before explicit resume.');
  } finally { await lock.close(); await unlink(lockPath); }
}
const existsComplete = state => state.status === 'api-verified-awaiting-independent-db';

async function publishCompleted(input, state) {
  assert.equal(state.version, 1); assert.equal(state.kind, 'wms-ecommerce-storage-progress');
  assert(existsComplete(state) && timestamp(state.apiVerifiedAt), 'Durable API completion required for publication');
  assert.equal(state.scopeSha256, input.scopeSha256); assert.deepEqual(state.expectedPaths, input.objects.map(o => o.path));
  assert.equal(state.objects?.length, input.objects.length); assert.equal(new Set(state.objects.map(o => o.path)).size, input.objects.length);
  assert.equal(state.orders?.length, input.objects.length); assert.equal(state.products?.length, input.objects.length);
  assert.equal(state.lineageSnapshots?.length, input.objects.length); assert.equal(digest(state.lineageSnapshots), state.lineageSha256, 'Corrupt archived lineage');
  for (const [i, c] of input.manifest.cases.entries()) {
    assert.equal(state.lineageSnapshots[i].order?.id, input.bindings[i].orderId);
    reconcile(input.manifest, c, state.lineageSnapshots[i], input.actors);
  }
  assert.deepEqual(state.orders, state.lineageSnapshots.map(s => s.order)); assert.deepEqual(state.products, state.lineageSnapshots.flatMap(s => s.products));
  assert(Array.isArray(state.referenceVerifications) && state.referenceVerifications.length > 0, 'Missing archived reference preflight');
  for (const receipt of state.referenceVerifications) {
    validateReferenceVerification(input, state.isolationReceipt, receipt, false);
    assert.deepEqual(await regular(path.join(input.outputRoot, `reference-preflight-${digest(receipt)}.json`)), Buffer.from(JSON.stringify(receipt, null, 2)), 'Archived reference preflight mismatch');
  }
  for (const object of input.objects) {
    const r = state.objects.find(o => o.path === object.path); assert(r?.status === 'api-absent' && r.deletion && r.absence, 'Unproven object completion');
    await validateRecordedRemoval(input, state, object, r);
    assert.deepEqual(r.absence.principal, principal(input.manifest.project)); assert(!Object.hasOwn(r.absence, 'actorId'));
    assert(r.absence.source === 'authenticated-storage-download' && isVerifiedStorageAbsence(r.absence));
    assert(timestamp(r.absence.verifiedAt) && Date.parse(r.deletion.deletedAt) <= Date.parse(r.absence.verifiedAt)
      && Date.parse(r.absence.verifiedAt) <= Date.parse(state.apiVerifiedAt));
  }
  const apiReceipt = { ...state, scope: input.scope, principal: principal(input.manifest.project), allResidueVerified: false };
  await publishExact(path.join(input.outputRoot, 'storage-cleanup-api.json'), JSON.stringify(apiReceipt, null, 2));
  const apiReceiptSha256 = digest(apiReceipt);
  await publishExact(path.join(input.outputRoot, 'storage-postdelete-readback.sql'), postdeleteSql(input, apiReceiptSha256));
  return { status: state.status, inventoryComplete: false, apiReceiptSha256, allResidueVerified: false };
}

export async function publishEcommerceStorage({ input }) {
  const fresh = await loadEcommerceStorageInputs(input.root, input.attemptName);
  assert.equal(fresh.scopeSha256, input.scopeSha256); input = fresh;
  await plainDirectory(input.outputRoot);
  // Completed progress is immutable. Publication is exact-match/exclusive and
  // cannot delete; leave a crash-left execution lock untouched, without guessing
  // whether its owner is alive. Incomplete progress still refuses publication.
  return publishCompleted(input, await readJson(path.join(input.outputRoot, 'progress.json')));
}

function postdeleteSql(input, apiReceiptSha256) {
  const m = input.manifest; const tokens = [m.runId, ...input.bindings.map(b => b.orderId), ...m.cases.flatMap(c => [c.productId, c.locationId, c.binId])];
  return `-- Execute independently on verified UAT ${m.project}; read-only, no Storage/DB mutation.
-- Connection identity is an external responsibility; project below is the expected target, not discovered proof.
begin read only;
set local row_security=off;
set local statement_timeout='60s';
select jsonb_build_object('version',1,'kind','wms-ecommerce-storage-db-verification',
 'runId',${sqlString(m.runId)},'project',${sqlString(m.project)},'commit',${sqlString(m.commit)},
 'source','independent-readonly-sql','verifiedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'apiReceiptSha256',${sqlString(apiReceiptSha256)},'expectedPaths',${json(input.objects.map(o => o.path))},
 'remainingObjects',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'bucket',bucket_id,'name',name)),'[]'::jsonb)
   from storage.objects where ${tokens.map(t => `strpos(name,${sqlString(t)})>0`).join(' or ')}),
 'orders',(select coalesce(jsonb_agg(to_jsonb(o) order by o.id),'[]'::jsonb) from warehouse.fulfillment_orders o where o.id in (${input.bindings.map(b => `${sqlString(b.orderId)}::uuid`).join(',')})),
 'products',(select coalesce(jsonb_agg(to_jsonb(p) order by p.id),'[]'::jsonb) from warehouse.products p where p.id in (${m.cases.map(c => sqlString(c.productId)).join(',')}))) as verification;
commit;
`;
}

export async function finalizeEcommerceStorage({ input, dbVerification }) {
  const fresh = await loadEcommerceStorageInputs(input.root, input.attemptName);
  assert.equal(input.scopeSha256, fresh.scopeSha256, 'Attempt input changed'); input = fresh;
  await plainDirectory(input.outputRoot);
  await publishEcommerceStorage({ input });
  const apiReceipt = await readJson(path.join(input.outputRoot, 'storage-cleanup-api.json')); const apiReceiptSha256 = digest(apiReceipt);
  assert.equal(apiReceipt.scopeSha256, input.scopeSha256, 'API receipt scope mismatch'); assert(existsComplete(apiReceipt), 'API phase incomplete');
  assert.deepEqual(apiReceipt.scope, input.scope); assert.deepEqual(apiReceipt.expectedPaths, input.objects.map(o => o.path));
  assert.equal(dbVerification?.version, 1); assert.equal(dbVerification.kind, 'wms-ecommerce-storage-db-verification');
  for (const key of ['runId', 'project', 'commit']) assert.equal(dbVerification[key], input.manifest[key], `DB verification ${key} mismatch`);
  assert.equal(dbVerification.source, 'independent-readonly-sql'); assert.equal(dbVerification.apiReceiptSha256, apiReceiptSha256, 'DB verification/API receipt mismatch');
  assert(timestamp(dbVerification.verifiedAt) && Date.parse(dbVerification.verifiedAt) >= Date.parse(apiReceipt.apiVerifiedAt), 'Subsequent DB verification required');
  assert.deepEqual(dbVerification.expectedPaths, input.objects.map(o => o.path)); assert.deepEqual(dbVerification.remainingObjects, [], 'DB Storage absence not proven');
  assert.equal(dbVerification.orders?.length, input.objects.length); assert.equal(dbVerification.products?.length, input.objects.length);
  const ordered = rows => [...rows].sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(ordered(dbVerification.orders), ordered(apiReceipt.orders), 'Subsequent DB verification order lineage changed');
  assert.deepEqual(ordered(dbVerification.products), ordered(apiReceipt.products), 'Subsequent DB verification product lineage changed');
  for (const [i, c] of input.manifest.cases.entries()) {
    const order = dbVerification.orders.find(o => o.id === input.bindings[i].orderId);
    const product = dbVerification.products.find(p => p.id === c.productId);
    assert(order && product && product.attributes?.signoffRun === input.manifest.runId && product.attributes.synthetic === true, 'DB verification ownership mismatch');
    assert.equal(order.source, 'ecommerce'); assert.equal(order.external_reference, c.reference); assert.equal(order.status, 'completed');
    assert.equal(order.proof_of_delivery_evidence_url, input.objects[i].path, 'DB verification POD mismatch');
    await verifyArchive(input, input.objects[i]);
  }
  const receipt = { version: 2, kind: 'wms-ecommerce-storage-cleanup', runId: input.manifest.runId, project: input.manifest.project, commit: input.manifest.commit,
    runStopped: true, bindingsComplete: true, inventoryComplete: true, evidenceRef: 'storage-verification.json', allResidueVerified: false,
    referencePreflightSha256s: apiReceipt.referenceVerifications.map(digest),
    inventory: { source: 'authenticated-storage-list', principal: principal(input.manifest.project), prefixes: prefixes(input), remainingPaths: [], verifiedAt: apiReceipt.apiVerifiedAt },
    objects: input.objects.map(object => {
      const r = apiReceipt.objects.find(o => o.path === object.path); assert(r?.status === 'api-absent' && r.deletion && r.absence, 'Incomplete API object receipt');
      return { view: object.view, orderId: object.orderId, bucket: 'evidence', path: object.path, fixture: object.fixture,
        status: 'deleted-and-verified', archive: `archived-evidence/${object.fixture.sha256}.png`, proofRef: object.proofRef, proofSha256: object.proofSha256,
        downloads: object.proof.downloads.map(d => ({ actorId: d.actorId, source: d.source, sha256: d.sha256, byteLength: d.byteLength,
          verifiedAt: object.proof.verifiedAt, timestampSource: 'enclosing-private-storage-proof' })), deletion: r.deletion, absence: r.absence };
    }),
    databaseVerification: { source: dbVerification.source, runId: input.manifest.runId, project: input.manifest.project, commit: input.manifest.commit,
      verifiedAt: dbVerification.verifiedAt, evidenceRef: 'independent-storage-db.json', apiReceiptSha256, expectedPaths: dbVerification.expectedPaths, remainingObjects: [] } };
  generateEcommerceCleanup(input.manifest, { bindings: input.bindings, fixtures: input.fixtures, storageReceipt: receipt, isolationReceipt: apiReceipt.isolationReceipt });
  await publishExact(path.join(input.outputRoot, 'independent-storage-db.json'), JSON.stringify(dbVerification, null, 2));
  await publishExact(path.join(input.outputRoot, 'storage-verification.json'), JSON.stringify(receipt, null, 2));
  await publishExact(path.join(input.outputRoot, 'cleanup-context.json'), JSON.stringify({ bindings: input.bindings, storageReceipt: receipt, isolationReceipt: apiReceipt.isolationReceipt }, null, 2));
  return receipt;
}

function unwrapVerification(value) {
  if (Array.isArray(value)) { assert.equal(value.length, 1); return unwrapVerification(value[0]); }
  if (value?.verification) return value.verification;
  if (value?.kind === 'wms-ecommerce-storage-db-verification') return value;
  if (value?.kind === 'wms-ecommerce-storage-reference-preflight') return value;
  throw new Error('Expected normalized independent SQL verification JSON object or one-row result');
}

// Credential retrieval is opt-in and isolated to this CLI invocation. Never log errors with API/CLI bodies.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [runDirectory, attemptName, mode = '--prepare', ...args] = process.argv.slice(2);
    assert(runDirectory && attemptName, 'RUN_DIRECTORY and ATTEMPT_NAME required');
    const input = await loadEcommerceStorageInputs(runDirectory, attemptName);
    if (mode === '--prepare') {
      assert.equal(args.length, 0);
      console.log(JSON.stringify({ runId: input.manifest.runId, scopeSha256: input.scopeSha256, expectedPaths: input.objects.map(o => o.path), executed: false }, null, 2));
    } else if (mode === '--preflight') {
      assert.equal(args.length, 1);
      const { sql, filename } = prepareEcommerceStoragePreflight(input, await readJson(path.resolve(args[0])));
      const file = path.join(input.attempt, filename);
      await publishExact(file, sql);
      console.log(JSON.stringify({ file, executed: false, independentSqlExecutionRequired: true }));
    } else if (mode === '--publish') {
      assert.equal(args.length, 0);
      console.log(JSON.stringify(await publishEcommerceStorage({ input })));
    } else if (mode === '--finalize') {
      assert.equal(args.length, 1);
      const receipt = await finalizeEcommerceStorage({ input, dbVerification: unwrapVerification(await readJson(path.resolve(args[0]))) });
      console.log(JSON.stringify({ storageVerified: receipt.inventoryComplete, databaseDeleted: false, allResidueVerified: false }));
    } else {
      assert.equal(mode, '--apply');
      const [isolationPath, referenceFlag, referencePath, approvalFlag, confirmFlag, confirmRun, resumeFlag] = args;
      assert(isolationPath && referenceFlag === '--reference-verification' && referencePath && approvalFlag === '--allow-cli-credential' && confirmFlag === '--confirm-run' && args.length >= 6 && args.length <= 7
        && (resumeFlag === undefined || resumeFlag === '--resume'), 'Explicit credential/run approval required');
      const result = await cleanupEcommerceStorage({ input, isolationReceipt: await readJson(path.resolve(isolationPath)), apply: true,
        referenceVerification: unwrapVerification(await readJson(path.resolve(referencePath))), allowCliCredential: true, confirmRun, resume: resumeFlag === '--resume' });
      console.log(JSON.stringify(result, null, 2));
    }
  } catch { console.error('Ecommerce Storage cleanup refused or stopped. No cleanup claim; inspect scoped inputs/progress. No credential/error bodies logged.'); process.exitCode = 1; }
}
