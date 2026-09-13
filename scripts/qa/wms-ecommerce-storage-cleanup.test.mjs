import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, realpath, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createManifest, reconcile } from './wms-ecommerce-signoff-live.mjs';
import { generateEcommerceCleanup } from './wms-ecommerce-cleanup.mjs';
const url = new URL('./wms-ecommerce-storage-cleanup.mjs', import.meta.url);
assert(existsSync(url), 'Ecommerce Storage cleanup module must exist');
const api = await import(url.href);
const hash = x => createHash('sha256').update(x).digest('hex');
const m = createManifest({ runId: 'a1000000-0000-4000-8000-000000000001', commit: 'a'.repeat(40), orderDate: '2026-09-13' });
const ids = ['b1000000-0000-4000-8000-000000000001', 'b2000000-0000-4000-8000-000000000001'];
const picker = 'c1000000-0000-4000-8000-000000000001'; const releaser = 'c2000000-0000-4000-8000-000000000001';
const label = 'synthetic-releaser@example.invalid';
const actors = { creator: picker, picker, releaser, releaserLabel: label };
const bindings = m.cases.map((c, i) => ({ view: c.viewport, orderId: ids[i], productId: c.productId, reference: c.reference }));
const isolation = { version: 1, kind: 'wms-ecommerce-cleanup-isolation', runId: m.runId, project: m.project, commit: m.commit,
  orderIds: ids, scopeWritersStopped: true, inFlightWorkDrained: true, schemaChangesPaused: true, holdThroughPostcleanup: true,
  evidenceRef: 'operator-isolation.json', verifiedAt: '2026-09-13T04:00:00.000Z' };

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'ecom-storage-')));
  const attemptName = 'attempt-2026-09-13T01-00-00-000Z-aaaaaaaa'; const attempt = path.join(root, attemptName); await mkdir(attempt);
  const report = { runId: m.runId, commit: m.commit, environment: 'uat', complete: true, failures: [], bindings,
    startedAt: '2026-09-13T01:00:00.000Z', finishedAt: '2026-09-13T03:00:00.000Z',
    endHealth: { status: 'ok', commit: m.commit, deployment: { appEnv: 'uat', supabaseProjectRef: m.project } },
    actors: [{ role: 'operations_associate', id: picker }, { role: 'operations_lead', id: releaser, authoritativeActor: label }],
    checks: [], privateStorageEvidence: [], storageAttempts: [] };
  const states = []; const objects = new Map();
  for (const [i, c] of m.cases.entries()) {
    const bytes = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(`offline synthetic ${c.viewport}`)]);
    const objectPath = `delivery-${ids[i]}/0/d${i + 1}000000-0000-4000-8000-000000000001.png`;
    const podFixture = { ref: `${c.viewport}-synthetic-pod.png`, sha256: hash(bytes), byteLength: bytes.length };
    const upload = { view: c.viewport, orderId: ids[i], bucket: 'evidence', path: objectPath, status: 'uploaded-not-cleaned',
      actorId: releaser, method: 'POST', httpStatus: 200, requestUrl: `https://${m.project}.supabase.co/storage/v1/object/evidence/${objectPath}` };
    const proof = { status: 'verified', runId: m.runId, project: m.project, view: c.viewport, orderId: ids[i], bucket: 'evidence',
      path: objectPath, fixture: podFixture, upload, verifiedAt: '2026-09-13T02:00:00.000Z',
      publicRead: { method: 'GET', anonymous: true, status: 400, url: `https://${m.project}.supabase.co/storage/v1/object/public/evidence/${objectPath}` },
      downloads: [releaser, picker].map(actorId => ({ actorId, bucket: 'evidence', path: objectPath, source: 'authenticated-storage-download', sha256: hash(bytes), byteLength: bytes.length })) };
    const s = { order: { id: ids[i], source: 'ecommerce', delivery_method: 'shipment', external_reference: c.reference,
      source_location_id: c.locationId, source_bin_id: null, order_notes: c.notes, created_by: picker, status: 'completed', shipment_status: 'delivered',
      lines: [{ productId: c.productId, quantity: 2, pickedQuantity: 2, pickBinId: c.binId }], packaging: [],
      picked_by: picker, packed_by: picker, released_by: releaser, courier: c.courier, waybill_number: c.waybill, delivery_link: c.deliveryLink,
      proof_of_delivery_reference: c.podReference, proof_of_delivery_evidence_url: objectPath, delivered_at: '2026-09-13T02:00:00Z',
      shipment_events: [{ status: 'delivered', actor: label, reference: c.podReference, evidenceUrl: objectPath }] },
      products: [{ id: c.productId, sku: c.sku, serialized: false, item_class: 'sellable_sku', attributes: { signoffRun: m.runId, synthetic: true } }],
      stock: [{ id: `stock${i}`, product_id: c.productId, location_id: c.locationId, bin_id: c.binId, lot_id: null, quantity: 8 }],
      reservations: [{ id: `reservation${i}`, order_id: ids[i], product_id: c.productId, location_id: null, bin_id: null, quantity: 2, status: 'released' }],
      movements: [{ id: `movement${i}`, product_id: c.productId, reference: ids[i], type: 'fulfillment_release', quantity: 2,
        from_location_id: c.locationId, from_bin_id: c.binId, to_location_id: null, to_bin_id: null, lot_id: null, serial_number: null, actor: label }],
      holds: [], allocations: [], units: [], activity: [{ id: i, module: 'warehouse', entity_type: 'fulfillment_order', entity_id: ids[i], action: 'confirm_delivery', actor: releaser }],
      privateStorageEvidence: proof, podFixture };
    reconcile(m, c, s, actors); states.push(s);
    report.checks.push({ view: c.viewport, readback: { snapshot: s } }); report.privateStorageEvidence.push(proof); report.storageAttempts.push(upload);
    await writeFile(path.join(attempt, podFixture.ref), bytes);
    await writeFile(path.join(attempt, `${c.viewport}-pod-fixture.json`), JSON.stringify(podFixture));
    await writeFile(path.join(attempt, `${c.viewport}-private-storage.json`), JSON.stringify(proof));
    objects.set(objectPath, { bytes, id: `e${i + 1}000000-0000-4000-8000-000000000001`, created_at: '2026-09-13T02:00:00Z', updated_at: '2026-09-13T02:00:00Z' });
  }
  await writeFile(path.join(root, 'manifest.json'), JSON.stringify(m)); await writeFile(path.join(attempt, 'results.json'), JSON.stringify(report));
  const calls = [];
  const backend = {
    getBucket: async () => ({ id: 'evidence', public: false }),
    readSnapshot: async c => { calls.push('lineage'); return structuredClone(states[m.cases.findIndex(x => x.viewport === c.viewport)]); },
    list: async prefix => {
      calls.push(`list:${prefix}`); const entries = new Map();
      for (const [name, o] of objects) if (name.startsWith(prefix + '/')) {
        const rest = name.slice(prefix.length + 1); const child = rest.split('/')[0];
        entries.set(child, rest.includes('/') ? { name: child, id: null } : { name: child, id: o.id, created_at: o.created_at, updated_at: o.updated_at, metadata: { size: o.bytes.length, mimetype: 'image/png' } });
      }
      return [...entries.values()];
    },
    download: async name => { calls.push(`download:${name}`); assert(objects.has(name)); return { httpStatus: 200, bytes: objects.get(name).bytes }; },
    remove: async name => { calls.push(`remove:${name}`); objects.delete(name); return { httpStatus: 200, names: [name] }; },
    absence: async name => { calls.push(`absence:${name}`); return objects.has(name) ? { httpStatus: 200 } : { httpStatus: 404, storageErrorCode: 'NoSuchKey' }; },
  };
  const f = { root, attempt, attemptName, report, states, objects, backend, calls };
  const input = await api.loadEcommerceStorageInputs(root, attemptName);
  f.referenceVerification = referenceFor(f, input);
  return f;
}
const approve = { apply: true, allowCliCredential: true, confirmRun: m.runId };
const approved = f => ({ ...approve, referenceVerification: f.referenceVerification });
function referenceFor(f, input) {
  const { context } = api.prepareEcommerceStoragePreflight(input, isolation);
  const tables = ['core.notifications', 'core.activity_log', 'warehouse.command_log', 'warehouse.fulfillment_reservations',
    'warehouse.fulfillment_orders', 'warehouse.movements', 'warehouse.stock_levels', 'warehouse.storage_areas', 'warehouse.locations', 'warehouse.products',
    'public.attachments', 'private.action_evidence'];
  const ownedRows = Object.fromEntries(tables.map(table => [table, []]));
  for (const [key, table] of Object.entries({ products: 'warehouse.products', stock: 'warehouse.stock_levels', reservations: 'warehouse.fulfillment_reservations',
    movements: 'warehouse.movements', activity: 'core.activity_log' })) ownedRows[table] = structuredClone(f.states.flatMap(s => s[key]));
  ownedRows['warehouse.fulfillment_orders'] = structuredClone(f.states.map(s => s.order));
  const scannedSchemas = ['core','private','public','warehouse'];
  const schemaInventory = scannedSchemas.map(schema => ({ schema, classification: 'business', relations: tables.filter(t => t.startsWith(schema + '.'))
    .map(t => ({ name: t.slice(schema.length + 1), kind: 'r' })) }));
  schemaInventory.push({ schema: 'storage', classification: 'storage', relations: [{ name: 'objects', kind: 'r' }] });
  return { ...context, verifiedAt: new Date().toISOString(), schemaInventory, scannedSchemas, scannedRelations: tables, ownedRows,
    storageObjects: [...f.objects].map(([name, o]) => ({ path: name, bucket: 'evidence', id: o.id,
      created_at: o.created_at, updated_at: o.updated_at, size: o.bytes.length, mimetype: 'image/png' })) };
}

test('default is offline; completed attempt proof, binding and actual bytes are mandatory', async () => {
  const f = await fixture(); const input = await api.loadEcommerceStorageInputs(f.root, f.attemptName);
  assert.equal(input.objects.length, 2);
  await assert.rejects(api.cleanupEcommerceStorage({ input, isolationReceipt: isolation, backend: f.backend }), /apply|approval/i);
  assert.deepEqual(f.calls, []);
  await writeFile(path.join(f.attempt, 'desktop1440-synthetic-pod.png'), 'foreign bytes');
  await assert.rejects(api.loadEcommerceStorageInputs(f.root, f.attemptName), /fixture|hash/i);
});

test('archives both objects before exact removal; API success alone cannot produce DB-delete receipt', async () => {
  const f = await fixture(); const input = await api.loadEcommerceStorageInputs(f.root, f.attemptName);
  const result = await api.cleanupEcommerceStorage({ input, isolationReceipt: isolation, backend: f.backend, ...approved(f) });
  assert.equal(result.status, 'api-verified-awaiting-independent-db'); assert.equal(result.inventoryComplete, false);
  assert.equal(f.objects.size, 0); assert.equal(f.calls.filter(c => c.startsWith('remove:')).length, 2);
  const firstRemove = f.calls.findIndex(c => c.startsWith('remove:'));
  for (const o of input.objects) {
    assert(f.calls.slice(0, firstRemove).includes(`download:${o.path}`));
    assert.equal(hash(await readFile(path.join(input.outputRoot, 'archived-evidence', o.fixture.sha256 + '.png'))), o.fixture.sha256);
  }
  assert(!existsSync(path.join(input.outputRoot, 'storage-verification.json')));
  const sql = await readFile(path.join(input.outputRoot, 'storage-postdelete-readback.sql'), 'utf8');
  assert.match(sql, /begin read only/i); assert.doesNotMatch(sql, /delete from|truncate|update storage/i);
  const db = { version: 1, kind: 'wms-ecommerce-storage-db-verification', runId: m.runId, project: m.project, commit: m.commit,
    source: 'independent-readonly-sql', verifiedAt: new Date(Date.now() + 1000).toISOString(), apiReceiptSha256: result.apiReceiptSha256,
    expectedPaths: input.objects.map(o => o.path), remainingObjects: [], orders: f.states.map(s => s.order), products: f.states.flatMap(s => s.products) };
  for (const bad of [{ ...db, remainingObjects: [{ name: input.objects[0].path }] }, { ...db, apiReceiptSha256: '0'.repeat(64) }, { ...db, verifiedAt: '2026-09-13T00:00:00Z' }]) {
    await assert.rejects(api.finalizeEcommerceStorage({ input, dbVerification: bad }), /verification|absence|subsequent|receipt/i);
  }
  const staleLock = path.join(input.outputRoot, 'executor.lock');
  await writeFile(staleLock, 'retained-crash-lock');
  await mkdir(path.join(input.outputRoot, 'cleanup-context.json'));
  await assert.rejects(api.finalizeEcommerceStorage({ input, dbVerification: db }));
  assert(existsSync(path.join(input.outputRoot, 'storage-verification.json')));
  await rmdir(path.join(input.outputRoot, 'cleanup-context.json'));
  const beforeFinalize = [...f.calls];
  const receipt = await api.finalizeEcommerceStorage({ input, dbVerification: db });
  assert.deepEqual(await api.finalizeEcommerceStorage({ input, dbVerification: db }), receipt);
  assert.deepEqual(f.calls, beforeFinalize);
  assert.equal(await readFile(staleLock, 'utf8'), 'retained-crash-lock');
  await assert.rejects(api.finalizeEcommerceStorage({ input, dbVerification: { ...db, verifiedAt: new Date(Date.now() + 2000).toISOString() } }), /Conflicting/);
  assert.equal(receipt.inventoryComplete, true);
  for (const op of [receipt.inventory, ...receipt.objects.flatMap(o => [o.deletion, o.absence])]) {
    assert.deepEqual(op.principal, { kind: 'service_role', project: m.project, credentialSource: 'authenticated-supabase-cli' });
    assert.equal(op.actorId, undefined);
  }
  assert.deepEqual(receipt.objects[0].downloads.map(d => d.actorId), [releaser, picker]);
  assert.equal(generateEcommerceCleanup(m, { bindings, storageReceipt: receipt, isolationReceipt: isolation, fixtures: input.fixtures }).readyForIndependentExecution, true);
});

test('unexpected inventory, version/content changes, partial listing, public bucket and foreign lineage refuse deletion', async t => {
  for (const scenario of ['unknown', 'partial', 'public', 'foreign', 'hash']) await t.test(scenario, async () => {
    const f = await fixture(); const input = await api.loadEcommerceStorageInputs(f.root, f.attemptName);
    if (scenario === 'unknown') f.objects.set(`delivery-${ids[0]}/0/foreign.png`, [...f.objects.values()][0]);
    if (scenario === 'partial') f.backend.list = async () => Array(100).fill({ name: 'x', id: null });
    if (scenario === 'public') f.backend.getBucket = async () => ({ id: 'evidence', public: true });
    if (scenario === 'foreign') f.states[0].products[0].attributes.signoffRun = ids[0];
    if (scenario === 'hash') [...f.objects.values()][0].bytes = Buffer.from('89504e470d0a1a0a000000000000000000', 'hex');
    await assert.rejects(api.cleanupEcommerceStorage({ input, isolationReceipt: isolation, backend: f.backend, ...approved(f) }));
    assert.equal(f.calls.filter(c => c.startsWith('remove:')).length, 0);
    assert(!existsSync(path.join(input.outputRoot, 'storage-verification.json')));
  });
});

test('access denial is not absence and a failed operation never claims cleanup', async () => {
  const f = await fixture(); const input = await api.loadEcommerceStorageInputs(f.root, f.attemptName);
  f.backend.absence = async () => ({ httpStatus: 403 });
  await assert.rejects(api.cleanupEcommerceStorage({ input, isolationReceipt: isolation, backend: f.backend, ...approved(f) }));
  assert(!existsSync(path.join(input.outputRoot, 'storage-verification.json')));
});

test('credential acquisition is explicit, target-bound and never echoes CLI stderr or key material', async () => {
  let invoked = false;
  await assert.rejects(api.acquireAdministrativeCredential(m, {}, async () => { invoked = true; }), /approval/i); assert.equal(invoked, false);
  const secret = 'NEVER-PERSIST-SECRET';
  await assert.rejects(api.acquireAdministrativeCredential(m, approve, async () => { throw new Error(secret); }), error => !error.message.includes(secret));
  const token = payload => `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
  const own = token({ role: 'service_role', ref: m.project });
  assert.equal(await api.acquireAdministrativeCredential(m, approve, async args => {
    assert.deepEqual(args, ['projects', 'api-keys', '--project-ref', m.project, '--reveal', '--output', 'json', '--log-level', 'none']);
    return JSON.stringify([{ name: 'service_role', api_key: own }]);
  }), own);
  for (const data of [[{ name: 'service_role', api_key: token({ role: 'service_role', ref: 'foreign' }) }],
    [{ name: 'service_role', api_key: token({ role: 'authenticated', ref: m.project }) }],
    [{ name: 'service_role', api_key: own }, { name: 'service_role', api_key: own }],
    [{ name: 'secret', api_key: 'sb_secret_unreviewed' }]]) {
    await assert.rejects(api.acquireAdministrativeCredential(m, approve, async () => JSON.stringify(data)), /acquisition failed/);
  }
});

test('rejects department, partial, foreign binding and inline/foreign-path proof inputs offline', async t => {
  for (const scenario of ['department', 'partial', 'binding', 'inline', 'foreign-path']) await t.test(scenario, async () => {
    const f = await fixture();
    if (scenario === 'department') await writeFile(path.join(f.root, 'manifest.json'), JSON.stringify({ ...m, kind: 'wms-department' }));
    if (scenario === 'partial') f.report.complete = false;
    if (scenario === 'binding') f.report.bindings = [{ ...bindings[0], orderId: releaser }, bindings[1]];
    if (['inline', 'foreign-path'].includes(scenario)) {
      const proof = f.report.privateStorageEvidence[0];
      proof.path = scenario === 'inline' ? 'data:image/png;base64,aGVsbG8=' : `delivery-${releaser}/0/d1000000-0000-4000-8000-000000000001.png`;
      await writeFile(path.join(f.attempt, 'desktop1440-private-storage.json'), JSON.stringify(proof));
    }
    await writeFile(path.join(f.attempt, 'results.json'), JSON.stringify(f.report));
    await assert.rejects(api.loadEcommerceStorageInputs(f.root, f.attemptName));
    assert.deepEqual(f.calls, []);
  });
});

test('explicit resume accepts observed removal, never re-deletes absent objects, and rejects uncertain success', async t => {
  for (const scenario of ['confirmed', 'legacy-wrapper', 'uncertain', 'archive-tamper', 'reappeared', 'stale-inventory']) await t.test(scenario, async () => {
    const f = await fixture(); const input = await api.loadEcommerceStorageInputs(f.root, f.attemptName);
    const absence = f.backend.absence; const remove = f.backend.remove;
    const original = structuredClone(f.objects.get(input.objects[0].path));
    if (scenario === 'uncertain') f.backend.remove = async name => { await remove(name); throw new Error('lost response'); };
    else f.backend.absence = async () => { throw new Error('interrupted absence read'); };
    await assert.rejects(api.cleanupEcommerceStorage({ input, isolationReceipt: isolation, backend: f.backend, ...approved(f) }));
    assert.equal(f.calls.filter(c => c.startsWith('remove:')).length, 1);
    f.backend.absence = absence; f.backend.remove = remove;
    if (scenario === 'reappeared') f.objects.set(input.objects[0].path, original);
    f.referenceVerification = referenceFor(f, input);
    assert.equal(f.referenceVerification.expectedPaths.length, 2);
    if (scenario !== 'reappeared') assert.equal(f.referenceVerification.storageObjects.length, 1);
    if (scenario === 'legacy-wrapper') f.backend.absence = async name => {
      const result = await absence(name); assert.equal(result.httpStatus, 404);
      return { httpStatus: 400, storageErrorCode: 'NoSuchKey', storageStatusCode: '404' };
    };
    const progressPath = path.join(input.outputRoot, 'progress.json');
    const progress = JSON.parse(await readFile(progressPath));
    if (scenario === 'stale-inventory') f.referenceVerification = progress.referenceVerifications[0];
    const deleted = progress.objects.find(o => o.path === input.objects[0].path);
    if (scenario === 'archive-tamper') await writeFile(path.join(input.outputRoot, 'archived-evidence', input.objects[0].fixture.sha256 + '.png'), 'tampered');
    if (['confirmed', 'legacy-wrapper'].includes(scenario)) {
      const result = await api.cleanupEcommerceStorage({ input, isolationReceipt: isolation, backend: f.backend, resume: true, ...approved(f) });
      assert.equal(result.inventoryComplete, false);
      assert.equal(f.calls.filter(c => c.startsWith('remove:')).length, 2);
      for (const o of input.objects) assert.equal(f.calls.filter(c => c === `remove:${o.path}`).length, 1);
      const saved = JSON.parse(await readFile(progressPath));
      assert.deepEqual(saved.objects.find(o => o.path === deleted.path).deletion, deleted.deletion);
      if (scenario === 'legacy-wrapper') for (const o of saved.objects) {
        assert.equal(o.absence.httpStatus, 400); assert.equal(o.absence.storageStatusCode, '404');
      }
    } else {
      await assert.rejects(api.cleanupEcommerceStorage({ input, isolationReceipt: isolation, backend: f.backend, resume: true, ...approved(f) }));
      assert.equal(f.calls.filter(c => c.startsWith('remove:')).length, 1);
      assert(!existsSync(path.join(input.outputRoot, 'storage-cleanup-api.json')));
    }
    assert(!existsSync(path.join(input.outputRoot, 'storage-verification.json')));
  });
});

test('resume validates saved removal proof before any backend call or additional deletion', async t => {
  for (const [name, corrupt] of [
    ['empty receipt', r => { r.deletion = {}; }],
    ['failed removal', r => { r.deletion.httpStatus = 403; }],
    ['wrong principal', r => { r.deletion.principal.project = 'foreign'; }],
    ['fabricated actor', r => { r.deletion.actorId = picker; }],
    ['foreign path', r => { r.path = 'delivery-foreign/0/foreign.png'; }],
    ['invalid timestamp', r => { r.deletion.deletedAt = 'invalid'; }],
    ['reversed chronology', r => { r.deletion.deletedAt = '2026-09-13T01:00:00Z'; }],
    ['future removal', r => { r.deletion.deletedAt = '9999-01-01T00:00:00Z'; }],
    ['wrong preflight hash', r => { r.referencePreflightSha256 = '0'.repeat(64); }],
    ['wrong archive binding', r => { r.archiveSha256 = '0'.repeat(64); }],
    ['wrong original version', (r, s) => { s.initialInventory.find(o => o.path === r.path).id = picker; }],
    ['corrupt archived preflight', () => {}],
  ]) await t.test(name, async () => {
    const f = await fixture(); const input = await api.loadEcommerceStorageInputs(f.root, f.attemptName);
    const absence = f.backend.absence;
    f.backend.absence = async () => { throw new Error('interrupted absence read'); };
    await assert.rejects(api.cleanupEcommerceStorage({ input, isolationReceipt: isolation, backend: f.backend, ...approved(f) }));
    assert.equal(f.calls.filter(c => c.startsWith('remove:')).length, 1);
    f.backend.absence = absence; f.referenceVerification = referenceFor(f, input);
    const progressPath = path.join(input.outputRoot, 'progress.json');
    const state = JSON.parse(await readFile(progressPath));
    const record = state.objects.find(o => o.path === input.objects[0].path);
    corrupt(record, state);
    if (name === 'corrupt archived preflight') await writeFile(path.join(input.outputRoot, `reference-preflight-${record.referencePreflightSha256}.json`), '{}');
    await writeFile(progressPath, JSON.stringify(state));
    const before = await readFile(progressPath); f.calls.length = 0;
    await assert.rejects(api.cleanupEcommerceStorage({ input, isolationReceipt: isolation, backend: f.backend, resume: true, ...approved(f) }));
    assert.deepEqual(f.calls, [], 'Invalid saved removal must fail before all resumed backend calls, including DELETE');
    assert.deepEqual(await readFile(progressPath), before, 'Rejected progress must not be rewritten');
    assert(f.objects.has(input.objects[1].path));
    assert(!existsSync(path.join(input.outputRoot, 'storage-cleanup-api.json')));
  });
});

test('replacement after archival fails before first removal even with unchanged metadata', async t => {
  for (const scenario of ['version', 'same-version-bytes']) await t.test(scenario, async () => {
    const f = await fixture(); const input = await api.loadEcommerceStorageInputs(f.root, f.attemptName);
    const download = f.backend.download; let reads = 0;
    f.backend.download = async name => {
      const result = await download(name);
      if (++reads === 2) {
        const o = f.objects.get(input.objects[0].path);
        if (scenario === 'version') o.updated_at = '2026-09-13T03:00:00Z';
        else { o.bytes = Buffer.from(o.bytes); o.bytes[o.bytes.length - 1] ^= 1; }
      }
      return result;
    };
    await assert.rejects(api.cleanupEcommerceStorage({ input, isolationReceipt: isolation, backend: f.backend, ...approved(f) }));
    assert.equal(f.calls.filter(c => c.startsWith('remove:')).length, 0);
  });
});

test('HTTP adapter uses only exact owned Storage routes, rejects redirects and preserves actual absence status', async () => {
  const f = await fixture(); const input = await api.loadEcommerceStorageInputs(f.root, f.attemptName); const calls = [];
  let response;
  const backend = api.createAdministrativeBackend(input, 'offline-key', async (url, options) => {
    calls.push({ url, options });
    assert.equal(new URL(url).origin, `https://${m.project}.supabase.co`);
    assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, 'Bearer offline-key');
    return response;
  });
  const object = input.objects[0];
  response = new Response(JSON.stringify([{ name: object.path }]), { status: 200 });
  assert.deepEqual(await backend.remove(object.path), { httpStatus: 200, names: [object.path] });
  assert.equal(calls[0].url, `https://${m.project}.supabase.co/storage/v1/object/evidence`);
  assert.equal(calls[0].options.method, 'DELETE'); assert.deepEqual(JSON.parse(calls[0].options.body), { prefixes: [object.path] });
  await assert.rejects(backend.remove(`delivery-${releaser}/0/foreign.png`));
  await assert.rejects(backend.list('')); assert.equal(calls.length, 1);
  response = new Response('[]', { status: 200 });
  await backend.list(`delivery-${ids[0]}/0`);
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { prefix: `delivery-${ids[0]}/0`, limit: 100, offset: 0, sortBy: { column: 'name', order: 'asc' } });
  response = new Response(input.fixtures.desktop1440, { status: 200, headers: { 'content-type': 'image/png' } });
  assert.equal(hash((await backend.download(object.path)).bytes), object.fixture.sha256);
  assert.equal(calls.at(-1).url, `https://${m.project}.supabase.co/storage/v1/object/authenticated/evidence/${object.path}`);
  for (const status of [400, 403, 404]) {
    response = new Response(JSON.stringify({ code: 'NoSuchKey', statusCode: 404 }), { status });
    assert.equal((await backend.absence(object.path)).httpStatus, status);
  }
  const failing = api.createAdministrativeBackend(input, 'offline-key', async () => { throw new Error('offline-key'); });
  await assert.rejects(failing.getBucket(), error => !error.message.includes('offline-key'));
});

test('generated independent SQL executes locally and detects scoped objects across buckets without mutations', async t => {
  const f = await fixture(); const input = await api.loadEcommerceStorageInputs(f.root, f.attemptName);
  await api.cleanupEcommerceStorage({ input, isolationReceipt: isolation, backend: f.backend, ...approved(f) });
  const sql = await readFile(path.join(input.outputRoot, 'storage-postdelete-readback.sql'), 'utf8');
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create schema storage; create schema warehouse;
    create table storage.objects(id text,bucket_id text,name text);
    create table warehouse.fulfillment_orders(id uuid);
    create table warehouse.products(id text);`);
  await db.query('insert into storage.objects values ($1,$2,$3),($4,$5,$6)', ['owned', 'other-bucket', input.objects[0].path, 'unrelated', 'evidence', 'unrelated.png']);
  await db.query('insert into warehouse.fulfillment_orders values ($1),($2)', [ids[0], releaser]);
  await db.query('insert into warehouse.products values ($1),($2)', [m.cases[0].productId, 'foreign-product']);
  const results = await db.exec(sql); const row = results.flatMap(r => r.rows).find(r => r.verification).verification;
  assert.equal(row.runId, m.runId); assert.equal(row.commit, m.commit);
  assert.deepEqual(row.remainingObjects, [{ id: 'owned', bucket: 'other-bucket', name: input.objects[0].path }]);
  assert.deepEqual(row.orders, [{ id: ids[0] }]); assert.deepEqual(row.products, [{ id: m.cases[0].productId }]);
  assert.equal((await db.query('select count(*)::int as n from storage.objects')).rows[0].n, 2);
});

test('missing independent foreign-reference preflight refuses before all backend calls', async () => {
  const f = await fixture(); const input = await api.loadEcommerceStorageInputs(f.root, f.attemptName);
  await assert.rejects(api.cleanupEcommerceStorage({ input, isolationReceipt: isolation, backend: f.backend, ...approve }), /reference|preflight/i);
  assert.deepEqual(f.calls, []);
});

test('preflight SQL names bind content and do not reuse the retained legacy artifact name', async () => {
  const f = await fixture(); const input = await api.loadEcommerceStorageInputs(f.root, f.attemptName);
  const prepared = api.prepareEcommerceStoragePreflight(input, isolation);
  assert.equal(prepared.filename, `storage-reference-preflight-${hash(prepared.sql).slice(0, 16)}.sql`);
  assert.notEqual(prepared.filename, 'storage-reference-preflight.sql');
  const renewed = api.prepareEcommerceStoragePreflight(input, { ...isolation, verifiedAt: '2026-09-13T04:01:00.000Z' });
  assert.notEqual(renewed.filename, prepared.filename);
  assert.deepEqual(f.calls, []);
});

test('completed API progress can republish after receipt and SQL publication failures without new deletes', async t => {
  for (const filename of ['storage-cleanup-api.json', 'storage-postdelete-readback.sql']) await t.test(filename, async () => {
    const f = await fixture(); const input = await api.loadEcommerceStorageInputs(f.root, f.attemptName);
    const absence = f.backend.absence;
    f.backend.absence = async name => {
      const result = await absence(name);
      if (f.objects.size === 0) await mkdir(path.join(input.outputRoot, filename));
      return result;
    };
    await assert.rejects(api.cleanupEcommerceStorage({ input, isolationReceipt: isolation, backend: f.backend, ...approved(f) }));
    const state = JSON.parse(await readFile(path.join(input.outputRoot, 'progress.json')));
    assert.equal(state.status, 'api-verified-awaiting-independent-db'); assert.equal(f.objects.size, 0);
    await rmdir(path.join(input.outputRoot, filename));
    const before = [...f.calls];
    // A crash that left completed progress but no final artifact must also be
    // recoverable through --resume, without fetching a key or using a backend.
    await api.cleanupEcommerceStorage({ input, isolationReceipt: isolation, resume: true, ...approve });
    const staleLock = path.join(input.outputRoot, 'executor.lock'); await writeFile(staleLock, 'retained-crash-lock');
    const progressBytes = await readFile(path.join(input.outputRoot, 'progress.json'));
    await api.publishEcommerceStorage({ input });
    await api.publishEcommerceStorage({ input });
    assert.equal(await readFile(staleLock, 'utf8'), 'retained-crash-lock');
    assert.deepEqual(await readFile(path.join(input.outputRoot, 'progress.json')), progressBytes);
    assert.deepEqual(f.calls, before);
    assert(existsSync(path.join(input.outputRoot, 'storage-cleanup-api.json')));
    assert(existsSync(path.join(input.outputRoot, 'storage-postdelete-readback.sql')));
  });
});

test('independent reference preflight rejects foreign records, stale scope, partial scans and changed live lineage before removal', async t => {
  const probes = {
    'foreign order': r => { r.foreignReferences = [{ entity: 'warehouse.fulfillment_orders', path: 'owned POD' }]; },
    'foreign document': r => { r.foreignReferences = [{ entity: 'core.documents', path: 'owned POD' }]; },
    'foreign action evidence': r => { r.foreignReferences = [{ entity: 'private.action_evidence', path: 'owned POD' }]; },
    'failed scan': r => { r.referenceChecksPassed = false; },
    'stale': r => { r.verifiedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString(); },
    'future': r => { r.verifiedAt = new Date(Date.now() + 60000).toISOString(); },
    'scope': r => { r.scopeSha256 = 'f'.repeat(64); },
    'project': r => { r.project = 'foreign'; },
    'policy': r => { r.policySha256 = 'f'.repeat(64); },
    'isolation': r => { r.isolationReceiptSha256 = 'f'.repeat(64); },
    'paths': r => { r.expectedPaths.reverse(); },
    'schemas': r => { r.scannedSchemas.pop(); },
    'relations': r => { r.scannedRelations = []; },
    'omitted public': r => { r.scannedSchemas = r.scannedSchemas.filter(s => s !== 'public'); },
    'omitted public table': r => { r.scannedRelations = r.scannedRelations.filter(s => s !== 'public.attachments'); },
    'unreviewed catalog schema': r => { r.schemaInventory.push({ schema: 'unknown_business', classification: 'business', relations: [] }); },
    'unreviewed infrastructure table': r => { r.schemaInventory.push({ schema: 'graphql', classification: 'infrastructure', relations: [{ name: 'hidden_refs', kind: 'r' }] }); },
    'missing mandatory catalog': r => { r.schemaInventory = r.schemaInventory.filter(s => s.schema !== 'core'); },
    'lineage': r => { r.ownedRows['warehouse.fulfillment_orders'][0].status = 'released'; },
    'object version': r => { r.storageObjects[0].id = picker; },
  };
  for (const [name, mutate] of Object.entries(probes)) await t.test(name, async () => {
    const f = await fixture(); const input = await api.loadEcommerceStorageInputs(f.root, f.attemptName);
    mutate(f.referenceVerification);
    await assert.rejects(api.cleanupEcommerceStorage({ input, isolationReceipt: isolation, backend: f.backend, ...approved(f) }));
    assert.equal(f.calls.filter(c => c.startsWith('remove:')).length, 0);
  });
});

test('receipt must remain fresh through each removal and is archived before the first DELETE', async () => {
  const f = await fixture(); const input = await api.loadEcommerceStorageInputs(f.root, f.attemptName);
  const remove = f.backend.remove;
  f.backend.remove = async name => {
    const state = JSON.parse(await readFile(path.join(input.outputRoot, 'progress.json')));
    const record = state.objects.find(o => o.path === name);
    const archived = JSON.parse(await readFile(path.join(input.outputRoot, `reference-preflight-${record.referencePreflightSha256}.json`)));
    assert.deepEqual(archived, f.referenceVerification);
    const result = await remove(name);
    f.referenceVerification.verifiedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
    return result;
  };
  await assert.rejects(api.cleanupEcommerceStorage({ input, isolationReceipt: isolation, backend: f.backend, ...approved(f) }));
  assert.equal(f.calls.filter(c => c.startsWith('remove:')).length, 1);
});

test('publication rejects corrupt progress, archives, partial and conflicting output without backend activity', async t => {
  for (const scenario of ['incomplete', 'lineage', 'principal', 'archive', 'preflight', 'partial-receipt', 'conflicting-sql']) await t.test(scenario, async () => {
    const f = await fixture(); const input = await api.loadEcommerceStorageInputs(f.root, f.attemptName);
    await api.cleanupEcommerceStorage({ input, isolationReceipt: isolation, backend: f.backend, ...approved(f) });
    const file = path.join(input.outputRoot, 'progress.json'); const progress = JSON.parse(await readFile(file));
    if (scenario === 'incomplete') { progress.status = 'archiving'; await writeFile(file, JSON.stringify(progress)); }
    if (scenario === 'lineage') { progress.lineageSha256 = '0'.repeat(64); await writeFile(file, JSON.stringify(progress)); }
    if (scenario === 'principal') { progress.objects[0].deletion.principal.project = 'foreign'; await writeFile(file, JSON.stringify(progress)); }
    if (scenario === 'archive') await writeFile(path.join(input.outputRoot, 'archived-evidence', input.objects[0].fixture.sha256 + '.png'), 'corrupt');
    if (scenario === 'preflight') await writeFile(path.join(input.outputRoot, `reference-preflight-${progress.objects[0].referencePreflightSha256}.json`), '{}');
    if (scenario === 'partial-receipt') await writeFile(path.join(input.outputRoot, 'storage-cleanup-api.json'), '{');
    if (scenario === 'conflicting-sql') await writeFile(path.join(input.outputRoot, 'storage-postdelete-readback.sql'), '-- user file; must not overwrite');
    const before = [...f.calls];
    await assert.rejects(api.publishEcommerceStorage({ input }));
    assert.deepEqual(f.calls, before); assert.equal(f.calls.filter(c => c.startsWith('remove:')).length, 2);
  });
});
