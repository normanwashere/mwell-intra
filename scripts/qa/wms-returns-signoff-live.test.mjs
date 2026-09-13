import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, mkdtemp, cp, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const url = new URL('./wms-returns-signoff-live.mjs', import.meta.url);
test('dedicated executable returns contract exists', () => assert(existsSync(url), 'Returns runner must be implemented'));
if (existsSync(url)) {
  const api = await import(url.href);
  test('journey audit reads use each ordinary actor own RLS-scoped events with explicit provenance', async () => {
    assert.equal(typeof api.readJourneyActivity, 'function');
    const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
    const { createClient } = require('@supabase/supabase-js');
    const ids = ['f662a626-b57d-4990-961c-a086472efddb', '93a08670-c110-4244-97ec-477afcec759c'];
    const entity = '61f3a8c3-97d2-4590-a3a7-4f98eac33d65'; const requests = [];
    let corrupt = false;
    const actors = ids.map((id, index) => ({ id, client: createClient('https://example.invalid', 'synthetic-public-key', {
      auth: { persistSession: false }, global: { fetch: async (url, options) => {
        const query = new URL(url); requests.push(query);
        assert.equal(query.searchParams.get('entity_id'), `eq.${entity}`);
        assert.equal(query.searchParams.get('actor'), `eq.${id}`);
        assert.equal(query.searchParams.get('limit'), '200');
        assert.match(new Headers(options.headers).get('prefer'), /count=exact/);
        const rows = index === 0 ? [{ id: 141948, actor: corrupt ? ids[1] : id, module: 'warehouse', entity_type: 'customer_return_case', entity_id: entity, action: 'submitted' }] : [];
        return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json', 'content-range': rows.length ? '0-0/1' : '*/0' } });
      } },
    }) }));
    const result = await api.readJourneyActivity(actors, entity);
    assert.equal(result.rows.length, 1); assert.equal(result.rows[0].actor, ids[0]);
    assert.deepEqual(result.readbacks.map(r => [r.actorId, r.entityId, r.rows.length]), [[ids[0], entity, 1], [ids[1], entity, 0]]);
    assert.equal(requests.length, 2);
    corrupt = true; await assert.rejects(() => api.readJourneyActivity(actors, entity), /actor/);
    await assert.rejects(() => api.readJourneyActivity([actors[0], actors[0]], entity), /distinct/);
  });
  test('scoped JSON-line reads use JSON containment rather than PostgreSQL array syntax', async () => {
    assert.equal(typeof api.readScopedRows, 'function');
    const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
    const { createClient } = require('@supabase/supabase-js');
    const requests = [];
    const client = createClient('https://example.invalid', 'synthetic-public-key', {
      auth: { persistSession: false },
      global: { fetch: async (url, options) => {
        requests.push({ url: new URL(url), headers: new Headers(options?.headers) });
        return new Response(JSON.stringify([{ id: 'owned' }]), { status: 200, headers: { 'content-type': 'application/json', 'content-range': '0-0/1' } });
      } },
    });
    const lines = [{ productId: 'owned-product' }];
    assert.deepEqual(await api.readScopedRows(client, 'warehouse', 'fulfillment_orders', 'lines', lines, true), [{ id: 'owned' }]);
    assert.equal(requests[0].url.searchParams.get('lines'), `cs.${JSON.stringify(lines)}`);
    assert.equal(requests[0].url.searchParams.get('limit'), '200');
    assert.match(requests[0].headers.get('prefer'), /count=exact/);
    await api.readScopedRows(client, 'warehouse', 'products', 'id', 'owned-product');
    assert.equal(requests[1].url.searchParams.get('id'), 'eq.owned-product');
  });
  test('source report comparison uses its persisted JSON representation for undefined command action', () => {
    const report = { commands: [{ ref: 'desktop1440-command-0.json', name: 'create_fulfillment_order', action: undefined, orderId: 'eeb2a86f-e464-4bf6-a052-56a157aad39d' }] };
    const bytes = Buffer.from(JSON.stringify(report, null, 2));
    assert.throws(() => assert.deepEqual(JSON.parse(bytes), report), 'Original direct comparison reproduces the undefined-action defect');
    assert.deepEqual(api.assertSavedSourceReport(bytes, report), JSON.parse(bytes));
    assert.throws(() => api.assertSavedSourceReport(bytes, { ...report, commands: [] }));
  });
  const retainedFolder = new URL('../../outputs/wms-signoff/sep13-physical-returns-live/', import.meta.url);
  const retainedFailed = 'attempt-2026-09-13T14-03-47-166Z-ed58e179'; const retainedSource = 'source/attempt-2026-09-13T14-03-52-102Z-ff60a215';
  const haveRetained = existsSync(new URL(`${retainedSource}/results.json`, retainedFolder));
  const retained = haveRetained ? {
    m: JSON.parse(await readFile(new URL('manifest.json', retainedFolder))),
    failed: JSON.parse(await readFile(new URL(`${retainedFailed}/results.json`, retainedFolder))),
    source: JSON.parse(await readFile(new URL(`${retainedSource}/results.json`, retainedFolder))),
  } : null;

  async function copyRetainedBoundary(sourceFolder = fileURLToPath(retainedFolder)) {
    const folder = await mkdtemp(path.join(tmpdir(), 'returns-original-boundary-'));
    await mkdir(path.join(folder, 'source'));
    for (const ref of ['manifest.json', 'source/manifest.json', retainedFailed, retainedSource]) {
      await cp(path.join(sourceFolder, ref), path.join(folder, ref), { recursive: true });
    }
    return folder;
  }

  test('retained actual32-checkpoint source validates only its terminal zero-return boundary', { skip: !haveRetained }, () => {
    api.validatePreReturnContinuation(retained.m, retained.failed, retained.source);
    const real = structuredClone(retained.source); real.commands.filter(c => c.name === 'create_fulfillment_order').forEach(c => c.action = undefined);
    api.assertSavedSourceReport(Buffer.from(JSON.stringify(retained.source)), real);
    for (const key of ['bindings', 'checks', 'formEvidence', 'negatives', 'commands', 'bootstrapCommands', 'storageAttempts', 'previews', 'browserActors', 'negativeAttempts']) {
      const bad = structuredClone(retained.failed); bad[key] = [{}]; assert.throws(() => api.validatePreReturnContinuation(retained.m, bad, retained.source), key);
    }
    for (const change of [r => r.complete = true, r => delete r.finishedAt, r => r.sourceAttempt = {}, r => r.continuation = {},
      r => r.failures[0].message = 'network timeout', r => r.actors[0].id = r.actors[1].id, r => r.commit = 'c'.repeat(40)]) {
      const bad = structuredClone(retained.failed); change(bad); assert.throws(() => api.validatePreReturnContinuation(retained.m, bad, retained.source));
    }
    for (const change of [r => r.checks.pop(), r => r.checks[1] = r.checks[0], r => r.checks[15].readback.snapshot.stock[0].quantity++,
      r => r.checks[15].readback.snapshot.order.proof_of_delivery_evidence_url = 'foreign', r => r.commands.pop(), r => r.actors[1].id = r.actors[2].id,
      r => r.complete = false, r => r.failures = [{}], r => r.commit = 'c'.repeat(40), r => r.checks[15].replayUnchanged = false]) {
      const bad = structuredClone(retained.source); change(bad); assert.throws(() => api.validatePreReturnContinuation(retained.m, retained.failed, bad));
    }
  });

  test('fresh continuation checks both exact delivered sources and rejects any return or stock/audit change', { skip: !haveRetained }, () => {
    const identities = api.validatePreReturnContinuation(retained.m, retained.failed, retained.source);
    for (const c of retained.m.cases) {
      const baseline = retained.source.checks.find(x => x.view === c.viewport && x.checkpoint === 'delivered-completed-reconciled').readback.snapshot;
      const fresh = { ...structuredClone(baseline), orders: [structuredClone(baseline.order)], cases: [], physicalReturns: [], inspections: [], linkedCases: [], linkedPhysicalReturns: [] };
      api.assertFreshPreReturnSource(retained.m, c, fresh, baseline, identities);
      for (const change of [s => s.cases.push({}), s => s.physicalReturns.push({}), s => s.inspections.push({}), s => s.linkedCases.push({}),
        s => s.linkedPhysicalReturns.push({}), s => s.orders.push(s.order), s => s.stock[0].quantity--, s => s.activity.push({}),
        s => s.order.customer_name = 'changed', s => s.movements[0].actor = 'foreign', s => s.order.status = 'released']) {
        const bad = structuredClone(fresh); change(bad); assert.throws(() => api.assertFreshPreReturnSource(retained.m, c, bad, baseline, identities));
      }
    }
  });

  test('offline continuation inventory pins actual manifests/reports/commands/screenshots/POD without writes', { skip: !haveRetained }, async () => {
    const folder = await copyRetainedBoundary();
    const prior = globalThis.fetch; globalThis.fetch = () => { throw new Error('Offline only'); };
    let inspection; try { inspection = await api.inspectPreReturnContinuation(folder, retainedFailed, retainedSource); } finally { globalThis.fetch = prior; }
    assert.equal(inspection.pins.failedSha256, '76760be85caaae4f5d0020ad84f6a0307e46de8d9ad4dae34f849e985189ade6');
    assert.equal(inspection.pins.sourceSha256, 'b1d40b92d1e3c1e290863d20a222c0ec5d16dfb8025ade470fd17ebe98f8269a');
    assert(inspection.archive.length >= 78); api.assertContinuationPins(inspection.pins, inspection.pins);
    for (const key of Object.keys(inspection.pins)) assert.throws(() => api.assertContinuationPins(inspection.pins, { ...inspection.pins, [key]: 'changed' }));
    await assert.rejects(api.inspectPreReturnContinuation(folder, '../outside', retainedSource));
    await assert.rejects(api.inspectPreReturnContinuation(folder, retainedFailed, `source/../${retainedFailed}`));
    const copy = path.join(await mkdtemp(path.join(tmpdir(), 'returns-continuation-')), 'run');
    await cp(folder, copy, { recursive: true });
    const commandPath = path.join(copy, retainedSource, 'desktop1440-command-0.json'); const commandBytes = await readFile(commandPath); const command = JSON.parse(commandBytes);
    command.payload.source_location_id = 'foreign'; await writeFile(commandPath, JSON.stringify(command));
    await assert.rejects(api.inspectPreReturnContinuation(copy, retainedFailed, retainedSource));
    await writeFile(commandPath, commandBytes);
    const screenshot = path.join(copy, retainedSource, 'desktop1440-0-ecommerce-intake.png'); const imageBytes = await readFile(screenshot);
    await writeFile(screenshot, Buffer.concat([imageBytes, Buffer.from('changed')]));
    const changed = await api.inspectPreReturnContinuation(copy, retainedFailed, retainedSource);
    assert.throws(() => api.assertContinuationPins(changed.pins, inspection.pins), /changed/);
    await writeFile(screenshot, imageBytes);
    await writeFile(path.join(copy, 'run.lock'), 'test-existing-owner');
    await assert.rejects(api.inspectPreReturnContinuation(copy, retainedFailed, retainedSource), /locked/);
  });

  test('pre-return archive rejects contradictory files in the failed root attempt', { skip: !haveRetained }, async () => {
    const folder = await copyRetainedBoundary();
    await writeFile(path.join(folder, retainedFailed, 'desktop1440-command-0.json'), JSON.stringify({ name: 'record_return_v2', payload: {} }));
    await assert.rejects(api.inspectPreReturnContinuation(folder, retainedFailed, retainedSource), /failed.*inventory/i);
  });

  test('retained artifact tests isolate the original boundary from later live attempts', { skip: !haveRetained }, async () => {
    const liveCopy = await copyRetainedBoundary();
    await mkdir(path.join(liveCopy, 'attempt-2026-09-13T15-00-00-000Z-aaaaaaaa'));
    await assert.rejects(api.inspectPreReturnContinuation(liveCopy, retainedFailed, retainedSource), /additional attempts/i);
    const fixture = await copyRetainedBoundary(liveCopy);
    const inspected = await api.inspectPreReturnContinuation(fixture, retainedFailed, retainedSource);
    assert.equal(inspected.pins.sourceSha256, 'b1d40b92d1e3c1e290863d20a222c0ec5d16dfb8025ade470fd17ebe98f8269a');
  });

  test('continuation requires every independent pin and does not enable ecommerce resume', () => {
    assert.equal(api.continuationPinsFromEnv({}), null);
    const env = { WMS_RETURNS_RESUME_FAILED_ATTEMPT: retainedFailed, WMS_RETURNS_RESUME_SOURCE_ATTEMPT: retainedSource,
      WMS_RETURNS_RESUME_FAILED_SHA256: 'a'.repeat(64), WMS_RETURNS_RESUME_SOURCE_SHA256: 'b'.repeat(64), WMS_RETURNS_RESUME_ARCHIVE_SHA256: 'c'.repeat(64) };
    assert(api.continuationPinsFromEnv(env));
    for (const key of Object.keys(env)) { const bad = { ...env }; delete bad[key]; assert.throws(() => api.continuationPinsFromEnv(bad)); }
  });
  const options = { runId: 'd1000000-0000-4000-8000-000000000001', commit: 'a'.repeat(40), orderDate: '2026-09-13' };
  const m = api.createManifest(options); const c = m.cases[0];
  const sourceId = 'b1000000-0000-4000-8000-000000000001';
  const caseId = 'b2000000-0000-4000-8000-000000000001';
  const actors = { creator: 'c1000000-0000-4000-8000-000000000001', resolver: 'c2000000-0000-4000-8000-000000000001',
    picker: 'c1000000-0000-4000-8000-000000000001', releaser: 'c2000000-0000-4000-8000-000000000001', releaserLabel: 'operator@example.invalid', creatorLabel: 'associate@example.invalid' };
  const physicalBinding = { physicalReturnId: 'ret-d2000000-0000-4000-8000-000000000001', inspectionId: 'd3000000-0000-4000-8000-000000000001',
    holdId: 'd4000000-0000-4000-8000-000000000001', relocationId: 'mv-d5000000-0000-4000-8000-000000000001' };
  const binding = { view: c.viewport, sourceOrderId: sourceId, caseId, replacementOrderId: caseId, ...physicalBinding };
  const creation = { idempotency_key: `create_customer_return-${caseId}`, return_case_id: caseId, source_order_id: sourceId,
    product_id: c.productId, serial_number: null, defect_description: c.defect };
  const resolution = { idempotency_key: `resolve_replacement-${caseId}`, return_case_id: caseId, resolution: 'replacement',
    quarantine_bin_id: c.quarantineBinId, replacement_order_id: null, replacement_delivery: c.delivery,
    refund_reference: null, supplier_reference: null, finance_evidence_url: null };

  test('physical checkpoints precede resolution and retain untested disposition/human gaps', () => {
    assert.deepEqual(api.CHECKPOINTS.slice(1, 7), ['case-submitted', 'physical-intake', 'physical-inspected-held', 'physical-hold-released', 'physical-relocated', 'replacement-resolved']);
    assert(!m.gaps.includes('physical-return-intake-and-QC')); assert(m.gaps.includes('write-off'));
    assert.match(m.scope, /synthetic/i); assert.match(m.scope, /human/i);
  });

  test('physical command guard binds exact lineage, actors, quantity, evidence and bins', () => {
    const b = { ...binding, physicalReturnId: 'ret-d2000000-0000-4000-8000-000000000001', holdId: 'd3000000-0000-4000-8000-000000000001' };
    const proof = { intake: { path: 'intake/photo.png' }, inspection: { path: 'inspection/photo.png' }, release: { path: 'hold/photo.png' } };
    const intake = { idempotency_key: 'return-intake-123456', allocation_id: null, return: { source: 'customer', source_order_id: sourceId,
      return_case_id: caseId, event_id: null, lines: [{ productId: c.productId, quantity: 1, reason: 'defective', locationId: c.locationId,
        binId: c.quarantineBinId, disposition: 'quarantine' }], evidence_urls: [proof.intake.path] } };
    api.assertPhysicalPayload(c, b, 'operations_lead', 'record_return_v2', intake, proof);
    for (const change of [p => p.return.source_order_id = caseId, p => p.return.return_case_id = sourceId,
      p => p.return.lines[0].quantity = 2, p => p.return.lines[0].binId = c.binId, p => p.return.evidence_urls = [], p => p.extra = true]) {
      const bad = structuredClone(intake); change(bad); assert.throws(() => api.assertPhysicalPayload(c, b, 'operations_lead', 'record_return_v2', bad, proof));
    }
    assert.throws(() => api.assertPhysicalPayload(c, b, 'operations_associate', 'record_return_v2', intake, proof));
    const inspection = { idempotency_key: 'inspect-quality-123456', source_type: 'return', source_id: b.physicalReturnId, product_id: c.productId,
      procurement_po_line_id: null, bin_id: c.quarantineBinId, lot_id: null, serial_number: null, quantity: 1, disposition: 'hold', reason: c.inspectionReason, evidence_urls: [proof.inspection.path] };
    api.assertPhysicalPayload(c, b, 'operations_associate', 'inspect_quality', inspection, proof);
    assert.throws(() => api.assertPhysicalPayload(c, b, 'operations_lead', 'inspect_quality', inspection, proof));
    assert.throws(() => api.assertPhysicalPayload(c, b, 'operations_associate', 'inspect_quality', { ...inspection, disposition: 'accepted' }, proof));
    const release = { idempotency_key: 'release-hold-123456', hold_id: b.holdId, target_disposition: 'accepted', reason: c.releaseReason, evidence_urls: [proof.release.path] };
    api.assertPhysicalPayload(c, b, 'operations_lead', 'release_quality_hold', release, proof);
    assert.throws(() => api.assertPhysicalPayload(c, b, 'operations_associate', 'release_quality_hold', release, proof));
    assert.throws(() => api.assertPhysicalPayload(c, b, 'operations_lead', 'release_quality_hold', { ...release, hold_id: sourceId }, proof));
  });

  test('manifest freezes new isolated sources and both actual delivery-address branches', () => {
    assert.deepEqual(api.validateManifest(m), m); assert(Object.isFrozen(m.cases[0]));
    assert.deepEqual(m.cases.map(c => c.delivery.mode), ['original', 'new']);
    assert.equal(m.source.runId, m.runId); assert.equal(m.source.cases[0].openingQuantity, 10);
    assert.equal(m.smtpIndependent, true); assert(m.gaps.includes('direct-accepted-without-hold'));
    for (const runId of ['acd6711b-6480-4bf9-83f0-896c5174974f', 'fbceedf7-9ffd-49dd-be36-f1d7ff4f66f3', '55b66a58-a9e9-4866-ac61-27789182d48b']) {
      assert.throws(() => api.createManifest({ ...options, runId }), /reserved/i);
    }
    assert.throws(() => api.createManifest({ ...options, runId: 'fbceedf7-0000-4000-8000-000000000001' }), /reserved/i);
    for (const change of [x => x.origin = 'https://production.invalid', x => x.cases[0].productId = 'foreign', x => x.source.cases[0].openingQuantity++]) {
      const bad = structuredClone(m); change(bad); assert.throws(() => api.validateManifest(bad));
    }
  });

  test('default import and run permission cannot authorize live writes, external sources or continuation', () => {
    assert.throws(() => api.assertRunPermission(m, {}));
    const env = { APP_ENV: 'uat', AUDIT_MUTATIONS: 'true', WMS_RETURNS_RUN_ID: m.runId, AUDIT_PASSWORD: 'offline-placeholder' };
    api.assertRunPermission(m, env);
    for (const patch of [{ WMS_RETURNS_RUN_ID: sourceId }, { APP_ENV: 'production' }, { AUDIT_MUTATIONS: 'false' }, { WMS_ECOMMERCE_RESUME_ATTEMPT: 'historical' }]) {
      assert.throws(() => api.assertRunPermission(m, { ...env, ...patch }));
    }
  });

  test('prepare is exclusive and creates fixture-only SQL, never case/order/training/role data', async () => {
    const root = path.join(await mkdtemp(path.join(tmpdir(), 'returns-prepare-')), 'run');
    await api.prepare(root, options);
    const sql = await readFile(path.join(root, 'prepare.sql'), 'utf8');
    assert.match(sql, /insert into warehouse.products/); assert.match(sql, /return-qbin/);
    assert.doesNotMatch(sql, /insert into warehouse\.(fulfillment_orders|customer_return_cases|returns)|grant |update |delete |certification/i);
    assert.equal(JSON.parse(await readFile(path.join(root, 'source', 'manifest.json'))).runId, m.runId);
    await assert.rejects(api.prepare(root, options));
  });

  test('prepare generates one shared default UUID and date for root and source artifacts', async () => {
    const root = path.join(await mkdtemp(path.join(tmpdir(), 'returns-default-')), 'run');
    const prepared = await api.prepare(root, { commit: options.commit });
    const manifest = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
    const source = JSON.parse(await readFile(path.join(root, 'source', 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest, prepared);
    assert.deepEqual(source, prepared.source);
    assert.equal(source.runId, prepared.runId);
    assert.equal(source.orderDate, prepared.orderDate);
    for (const relative of ['prepare.sql', 'source/prepare.sql', 'cleanup-inventory.sql', 'source/cleanup-inventory.sql']) {
      assert((await readFile(path.join(root, relative), 'utf8')).includes(prepared.runId), relative);
    }
  });

  test('case command boundary accepts only exact UI-generated scoped payloads and correct actors', () => {
    api.assertUiPayload(m, c, { ...binding, caseId: null, replacementOrderId: null }, 'operations_associate', 'create_customer_return_case', creation);
    api.assertUiPayload(m, c, binding, 'operations_lead', 'resolve_customer_return_case', resolution);
    for (const patch of [{ source_order_id: caseId }, { product_id: 'foreign' }, { serial_number: 'foreign' }, { defect_description: 'changed' }, { extra: true }]) {
      assert.throws(() => api.assertUiPayload(m, c, binding, 'operations_associate', 'create_customer_return_case', { ...creation, ...patch }));
    }
    for (const patch of [{ replacement_order_id: sourceId }, { resolution: 'refund' }, { quarantine_bin_id: c.binId }, { replacement_delivery: { mode: 'new' } }]) {
      assert.throws(() => api.assertUiPayload(m, c, binding, 'operations_lead', 'resolve_customer_return_case', { ...resolution, ...patch }));
    }
    assert.throws(() => api.assertUiPayload(m, c, binding, 'operations_associate', 'resolve_customer_return_case', resolution));
    assert.throws(() => api.assertUiPayload(m, c, binding, 'operations_lead', 'record_return', resolution));
    assert.throws(() => api.assertUiPayload(m, c, binding, 'operations_associate', 'create_customer_return_case', creation), /second|bound/i);
  });

  test('replacement mutation boundary never permits source order writes or extra stock consumption', () => {
    const p = { idempotency_key: 'ui-command-123456', order_id: caseId, action: 'allocate' };
    api.assertUiPayload(m, c, binding, 'operations_associate', 'advance_fulfillment_order', p);
    assert.throws(() => api.assertUiPayload(m, c, binding, 'operations_associate', 'advance_fulfillment_order', { ...p, order_id: sourceId }));
    assert.throws(() => api.assertUiPayload(m, c, binding, 'operations_associate', 'advance_fulfillment_order', { ...p, action: 'release' }));
    assert.throws(() => api.assertUiPayload(m, c, binding, 'operations_lead', 'create_fulfillment_order', p));
  });

  test('reserved historical order UUID cannot be reused as a new case/replacement UUID', () => {
    for (const id of ['80cb6afb-5e97-4448-96fe-619a7c66cebe', '309bf7db-7265-41fc-a558-55a972809dce',
      'ab9c70a4-869b-48ab-990d-272c82d881bb', 'a903be33-47ee-413a-b4f7-b874ea1afc2a']) {
      assert.throws(() => api.assertUiPayload(m, c, { ...binding, caseId: null, replacementOrderId: null }, 'operations_associate', 'create_customer_return_case',
        { ...creation, return_case_id: id, idempotency_key: `create_customer_return-${id}` }), /reserved/i);
    }
  });

  test('unapproved live entry point stops before browser/network or execution-lock creation', async () => {
    const folder = path.join(await mkdtemp(path.join(tmpdir(), 'returns-no-live-')), 'run'); await api.prepare(folder, options);
    const previous = globalThis.fetch; let calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('No network authorized'); };
    try { await assert.rejects(api.run(folder, {})); } finally { globalThis.fetch = previous; }
    assert.equal(calls, 0); assert(!existsSync(path.join(folder, 'run.lock')));
  });

  function fixture(status = 'submitted', replacementStatus = 'received', item = c, source = sourceId, id = caseId) {
    const c = item; const sourceId = source; const caseId = id;
    const sourceOrder = { id: sourceId, status: 'completed', source: 'ecommerce', delivery_method: 'shipment', external_reference: c.sourceReference,
      source_location_id: c.locationId, lines: [{ productId: c.productId, quantity: 2 }], customer_name: c.customerName, customer_contact: c.customerContact, delivery_address: c.address };
    const baseline = { order: sourceOrder, reservations: [{ id: 'source-reservation', order_id: sourceId, product_id: c.productId, quantity: 2, status: 'released' }],
      movements: [{ id: 'source-movement', reference: sourceId, product_id: c.productId, quantity: 2, type: 'fulfillment_release' }] };
    const record = { id: caseId, source_order_id: sourceId, product_id: c.productId, serial_number: null, defect_description: c.defect,
      status, resolution: status === 'submitted' ? 'pending' : 'replacement', created_by: actors.creator };
    const s = { sourceOrder, cases: [record], orders: [], products: [{ id: c.productId, sku: c.sku, attributes: { signoffRun: m.runId, synthetic: true }, serialized: false, item_class: 'sellable_sku' }],
      stock: [{ id: 'stock', product_id: c.productId, location_id: c.locationId, bin_id: c.binId, lot_id: null, quantity: 8 }],
      reservations: structuredClone(baseline.reservations), movements: structuredClone(baseline.movements), holds: [], inspections: [], physicalExceptions: [], holdActivity: [], physicalEvidence: {}, units: [], allocations: [], physicalReturns: [],
      caseActivity: [{ action: 'submitted', actor: actors.creator, entity_id: caseId, module: 'warehouse', entity_type: 'customer_return_case' }], activity: [], privateStorageEvidence: null, podFixture: null };
    if (status !== 'submitted') {
      addPhysical(s, 'relocated', item, bindFor(item, source, id));
      Object.assign(record, { quarantine_bin_id: c.quarantineBinId, replacement_order_id: caseId, replacement_delivery: c.delivery, resolved_by: actors.resolver, resolved_at: '2026-09-13T01:00:00Z' });
      s.caseActivity.push(...['resolved', 'replacement_delivery_confirmed'].map(action => ({ action, actor: actors.resolver, entity_id: caseId, module: 'warehouse', entity_type: 'customer_return_case' })));
      s.orders.push({ id: caseId, source: 'ecommerce', delivery_method: 'shipment', external_reference: api.replacementReference(caseId), status: replacementStatus,
        source_location_id: c.locationId, order_notes: null, lines: [{ productId: c.productId, quantity: 1, pickedQuantity: 0, pickedSerialNumbers: [] }], packaging: [],
        created_by: actors.resolver, customer_name: c.delivery.mode === 'new' ? c.delivery.customerName : c.customerName,
        customer_contact: c.delivery.mode === 'new' ? c.delivery.customerContactNumber : c.customerContact,
        delivery_address: c.delivery.mode === 'new' ? c.delivery.deliveryAddress : c.address });
    }
    return { s: structuredClone(s), baseline: structuredClone(baseline) };
  }

  function bindFor(item, source, id) {
    return { view: item.viewport, sourceOrderId: source, caseId: id, replacementOrderId: id,
      ...Object.fromEntries(Object.entries(physicalBinding).map(([key, value]) => [key, item.viewport === 'mobile390' ? value.slice(0, -1) + '2' : value])) };
  }

  function addPhysical(s, stage, item = c, b = binding) {
    const r = { id: b.physicalReturnId, source: 'customer', source_order_id: b.sourceOrderId, return_case_id: b.caseId, event_id: null,
      actor: actors.releaserLabel, created_at: '2026-09-13T01:00:00Z',
      lines: [{ productId: item.productId, quantity: 1, reason: 'defective', locationId: item.locationId, binId: item.quarantineBinId, disposition: 'quarantine' }] };
    const proof = (purpose, actorId) => {
      const objectPath = `${purpose === 'intake' ? 'ref-d6000000-0000-4000-8000-000000000001' : purpose === 'inspection' ? 'inspection/ref-d7000000-0000-4000-8000-000000000001' : `hold/${b.holdId}/release`}/0/d8000000-0000-4000-8000-000000000001.png`;
      return { purpose, view: item.viewport, runId: m.runId, actorId, bucket: 'evidence', path: objectPath,
        fixture: { ref: `${item.viewport}-${purpose}-synthetic.png`, sha256: 'a'.repeat(64), byteLength: 100 }, upload: { httpStatus: 200, path: objectPath },
        download: { actorId, source: 'authenticated-storage-download', sha256: 'a'.repeat(64), byteLength: 100 }, publicReadStatus: 400 };
    };
    s.physicalEvidence = { intake: proof('intake', actors.resolver) }; r.evidence_urls = [s.physicalEvidence.intake.path];
    s.physicalReturns = [r]; s.stock.push({ id: 'return-stock', product_id: item.productId, location_id: item.locationId, bin_id: item.quarantineBinId, lot_id: null, quantity: stage === 'relocated' ? 0 : 1 });
    s.movements.push({ id: 'return-movement', type: 'return', reference: r.id, product_id: item.productId, quantity: 1, to_location_id: item.locationId, to_bin_id: item.quarantineBinId,
      actor: actors.releaserLabel, reason: 'defective (quarantine)', evidence_urls: r.evidence_urls });
    const common = { product_id: item.productId, location_id: item.locationId, bin_id: item.quarantineBinId, lot_id: null, serial_number: null, quantity: 1 };
    const i = { ...common, id: b.inspectionId, source_type: 'return', source_id: r.id, inspected_by: actors.resolver, disposition: 'pending', reason: 'Awaiting independent quality inspection', evidence_urls: r.evidence_urls };
    const h = { ...common, id: b.holdId, inspection_id: i.id, created_by: actors.resolver, status: 'active', reason: i.reason, evidence_urls: r.evidence_urls };
    if (stage === 'intake') { i.id = 'd9000000-0000-4000-8000-000000000001'; h.id = 'da000000-0000-4000-8000-000000000001'; h.inspection_id = i.id; }
    s.inspections = [i]; s.holds = [h];
    if (stage !== 'intake') {
      s.physicalEvidence.inspection = proof('inspection', actors.creator);
      Object.assign(i, { disposition: 'hold', inspected_by: actors.creator, reason: item.inspectionReason, evidence_urls: [s.physicalEvidence.inspection.path] });
      Object.assign(h, { created_by: actors.creator, reason: item.inspectionReason, evidence_urls: i.evidence_urls });
      s.physicalExceptions = [{ id: 'exception', exception_type: 'quality', source_type: 'quality_inspection', source_id: i.id, created_by: actors.creator, status: 'open' }];
    }
    if (['released', 'relocated'].includes(stage)) {
      s.physicalEvidence.release = proof('release', actors.resolver); const evidence = [s.physicalEvidence.release.path];
      Object.assign(h, { status: 'released', released_by: actors.resolver, released_at: '2026-09-13T01:01:00Z', release_reason: item.releaseReason, release_evidence_urls: evidence });
      Object.assign(i, { disposition: 'accepted', reason: item.releaseReason, evidence_urls: evidence });
      Object.assign(s.physicalExceptions[0], { status: 'resolved', resolution: item.releaseReason, evidence_urls: evidence });
      s.holdActivity = [{ action: 'released', entity_id: h.id, entity_type: 'inventory_hold', module: 'warehouse', actor: actors.resolver }];
    }
    if (stage === 'relocated') {
      s.stock[0].quantity = 9;
      s.movements.push({ id: b.relocationId, type: 'transfer', product_id: item.productId, quantity: 1, from_location_id: item.locationId, to_location_id: item.locationId,
        from_bin_id: item.quarantineBinId, to_bin_id: item.binId, reason: 'bin relocation', actor: actors.creatorLabel });
    }
  }

  test('case resolution is not physical intake/restock or replacement delivery completion', () => {
    const { s, baseline } = fixture();
    const result = api.reconcile(m, c, s, binding, baseline, actors);
    assert.equal(result.onHand, 8); assert.equal(result.physicalReturnVerified, false); assert.equal(result.replacementDelivered, false);
    const noPhysical = fixture('resolved');
    Object.assign(noPhysical.s, { physicalReturns: [], inspections: [], holds: [], physicalExceptions: [], holdActivity: [], stock: s.stock, movements: s.movements });
    assert.throws(() => api.reconcile(m, c, noPhysical.s, binding, noPhysical.baseline, actors), /Physical intake/);
    for (const change of [s => s.sourceOrder.customer_name = 'changed', s => s.stock[0].quantity = 8,
      s => s.physicalReturns.push({ id: 'intake' }), s => s.cases.push({ ...s.cases[0] }), s => s.cases[0].resolved_by = actors.creator,
      s => s.orders[0].lines[0].quantity = 2, s => s.orders[0].delivery_address.city = 'changed', s => s.caseActivity.pop()]) {
      const { s, baseline } = fixture('resolved'); const before = structuredClone(baseline); change(s);
      assert.throws(() => api.reconcile(m, c, s, binding, before, actors));
    }
  });

  for (const [stage, held, available, verified] of [['intake', 1, 8, false], ['held', 1, 8, false], ['released', 0, 9, false], ['relocated', 0, 9, true]]) {
    test(`physical ${stage} requires real custody/QC rows and reconciles held vs available stock`, () => {
      const { s, baseline } = fixture(); addPhysical(s, stage);
      const result = api.reconcile(m, c, s, binding, baseline, actors);
      assert.equal(result.physicalStage, stage); assert.equal(result.held, held); assert.equal(result.available, available);
      assert.equal(result.physicalReturnVerified, verified); assert.equal(result.onHand, 9); assert.equal(result.replacementDelivered, false);
      assert.equal(s.stock[0].quantity, stage === 'relocated' ? 9 : 8);
    });
  }

  const physicalFaults = {
    'foreign source/case pair': s => s.physicalReturns[0].source_order_id = caseId,
    'foreign customer case': s => s.physicalReturns[0].return_case_id = sourceId,
    'foreign product': s => s.physicalReturns[0].lines[0].productId = 'foreign',
    'duplicate physical intake': s => s.physicalReturns.push(structuredClone(s.physicalReturns[0])),
    'same actor inspection': s => s.inspections[0].inspected_by = actors.resolver,
    'self hold release': s => s.holds[0].released_by = actors.creator,
    'premature physical relocation': s => s.holds[0].status = 'active',
    'missing persisted inspection': s => s.inspections = [],
    'unresolved quality exception': s => s.physicalExceptions[0].status = 'open',
    'wrong release audit actor': s => s.holdActivity[0].actor = actors.creator,
    'duplicate relocation': s => s.movements.push(structuredClone(s.movements.at(-1))),
    'wrong relocation actor': s => s.movements.at(-1).actor = actors.releaserLabel,
    'uncredited destination': s => s.stock[0].quantity = 8,
    'undepleted return bin': s => s.stock[1].quantity = 1,
    'unknown custody bin': s => s.stock.push({ ...s.stock[1], id: 'other', bin_id: 'foreign' }),
    'forged evidence readback': s => s.physicalEvidence.release.download.sha256 = 'b'.repeat(64),
    'persisted foreign intake evidence': s => s.physicalReturns[0].evidence_urls = ['foreign/photo.png'],
    'public evidence': s => s.physicalEvidence.intake.publicReadStatus = 200,
    'incorrect view evidence': s => s.physicalEvidence.inspection.view = 'mobile390',
    'surface-only release evidence': s => delete s.physicalEvidence.release.download,
  };
  for (const [name, change] of Object.entries(physicalFaults)) test(`physical readback rejects ${name}`, () => {
    const { s, baseline } = fixture(); addPhysical(s, 'relocated'); change(s);
    assert.throws(() => api.reconcile(m, c, s, binding, baseline, actors));
  });

  test('physical command sequencing is a runner check, never a new application policy', () => {
    for (const [name, stage] of Object.entries({ record_return_v2: 'none', inspect_quality: 'intake', release_quality_hold: 'held', transfer: 'released', resolve_customer_return_case: 'relocated' })) {
      api.assertPhysicalStage(name, stage);
      for (const wrong of ['none', 'intake', 'held', 'released', 'relocated'].filter(x => x !== stage)) assert.throws(() => api.assertPhysicalStage(name, wrong));
    }
  });

  test('relocation permits the exact repository replay probe and one-unit physical transfer only', () => {
    const p = { idempotency_key: 'relocate-ui-123456', command_input: { productId: c.productId, locationId: c.locationId, fromBinId: c.quarantineBinId, toBinId: c.binId, quantity: 1 }, replay_only: true };
    api.assertPhysicalPayload(c, binding, 'operations_associate', 'transfer', p);
    const actual = { ...p, replay_only: undefined, unit_ids: [], from_location_id: c.locationId, to_location_id: c.locationId, to_bin_id: c.binId,
      from_stock_delta: { product_id: c.productId, location_id: c.locationId, bin_id: c.quarantineBinId, delta: -1 },
      to_stock_delta: { product_id: c.productId, location_id: c.locationId, bin_id: c.binId, delta: 1 },
      movement: { id: physicalBinding.relocationId, type: 'transfer', product_id: c.productId, quantity: 1, from_location_id: c.locationId,
        to_location_id: c.locationId, from_bin_id: c.quarantineBinId, to_bin_id: c.binId, reason: 'bin relocation', evidence_urls: [] } };
    api.assertPhysicalPayload(c, binding, 'operations_associate', 'transfer', actual);
    for (const change of [p => p.command_input.quantity = 2, p => p.from_stock_delta.bin_id = c.binId, p => p.to_stock_delta.delta = 2,
      p => p.movement.type = 'write_off', p => p.unit_ids = ['foreign'], p => p.command_input.serialNumbers = ['foreign'], p => p.extra = true]) {
      const bad = structuredClone(actual); change(bad); assert.throws(() => api.assertPhysicalPayload(c, binding, 'operations_associate', 'transfer', bad));
    }
    assert.throws(() => api.assertPhysicalPayload(c, binding, 'operations_lead', 'transfer', actual));
    assert.throws(() => api.assertPhysicalPayload(c, binding, 'operations_associate', 'transfer', { ...p, unit_ids: [] }));
  });

  test('physical evidence path guard rejects traversal, wrong hold, bucket and extension', () => {
    const { s } = fixture(); addPhysical(s, 'relocated');
    for (const purpose of ['intake', 'inspection', 'release']) {
      const p = s.physicalEvidence[purpose]; const actor = purpose === 'inspection' ? actors.creator : actors.resolver;
      api.assertPhysicalEvidence(m, c, purpose, p, actor, binding);
      for (const change of [x => x.path = '../' + x.path, x => x.path = x.path.replace('.png', '.html'), x => x.bucket = 'public',
        x => x.runId = sourceId, x => x.actorId = caseId, x => x.upload.httpStatus = 403, x => x.fixture.ref = '../fixture.png']) {
        const bad = structuredClone(p); change(bad); assert.throws(() => api.assertPhysicalEvidence(m, c, purpose, bad, actor, binding));
      }
    }
    assert.throws(() => api.assertPhysicalStoragePath('release', s.physicalEvidence.release.path, { ...binding, holdId: sourceId }));
  });

  test('pre-submit preview requires actual decoded whole image, exact scope and unchanged unsent state', () => {
    const { s } = fixture(); addPhysical(s, 'intake'); const path = s.physicalEvidence.intake.path;
    const p = { view: c.viewport, runId: m.runId, commit: m.commit, actorId: actors.resolver, path,
      framing: { naturalWidth: 640, naturalHeight: 360, fit: 'contain', x: 10, y: 50, width: 600, height: 338, viewportWidth: 1440, viewportHeight: 900 },
      restoredUnsentForm: true, restoredFocus: true, unchangedCommands: true, unchangedUploads: true, unchangedReadback: true };
    api.assertIntakePreview(m, c, p, binding, actors.resolver, path);
    for (const change of [p => p.framing.naturalWidth = 0, p => p.framing.fit = 'cover', p => p.framing.y = -50,
      p => p.framing.width = 1500, p => p.restoredFocus = false, p => p.restoredUnsentForm = false, p => p.unchangedCommands = false,
      p => p.unchangedUploads = false, p => p.unchangedReadback = false, p => p.commit = 'b'.repeat(40), p => p.view = 'mobile390']) {
      const bad = structuredClone(p); change(bad); assert.throws(() => api.assertIntakePreview(m, c, bad, binding, actors.resolver, path));
    }
    const signed = `https://${m.project}.supabase.co/storage/v1/object/sign/evidence/${path}?token=not-persisted`;
    assert(api.isOwnedEvidenceImage(signed, path));
    for (const wrong of ['', 'not-a-url', signed.replace(m.project, 'foreign'), signed.replace('/sign/', '/public/'), signed.replace(path, 'foreign.png')]) assert.equal(api.isOwnedEvidenceImage(wrong, path), false);
  });

  test('physical denial probes target real held custody and existing unauthorized release capability only', () => {
    const { s } = fixture(); addPhysical(s, 'relocated');
    for (const kind of ['provisional-held-transfer', 'inspected-held-transfer']) {
      const probe = api.physicalDenial(c, binding, kind, s.physicalEvidence, actors.creatorLabel, caseId);
      assert.equal(probe.role, 'operations_associate'); assert.equal(probe.name, 'transfer');
      assert.equal(probe.expected, 'Inventory covered by an active hold cannot be transferred');
      api.assertPhysicalPayload(c, binding, probe.role, probe.name, probe.payload);
      assert.equal(probe.payload.from_stock_delta.bin_id, c.quarantineBinId);
      assert(!probe.payload.replay_only, 'Negative must exercise backend hold guard, not a null replay probe');
    }
    const deniedRelease = api.physicalDenial(c, binding, 'unauthorized-hold-release', s.physicalEvidence, actors.creatorLabel, caseId);
    assert.equal(deniedRelease.role, 'operations_associate'); assert.equal(deniedRelease.payload.hold_id, binding.holdId);
    assert.equal(deniedRelease.expected, 'Not authorized: warehouse.release_quality_hold');
    assert.deepEqual(deniedRelease.payload.evidence_urls, [s.physicalEvidence.release.path]);
    assert.throws(() => api.physicalDenial(c, binding, 'invented-same-actor-inspection', s.physicalEvidence, actors.creatorLabel));
  });

  test('browser identity mismatch never formats either live token into error or persisted failure', () => {
    const token = 'private-first-test-access-token', other = 'private-second-test-access-token';
    const login = { user: { id: actors.creator }, access_token: token };
    api.assertBrowserIdentity(login, { id: actors.creator }, `Bearer ${token}`, actors.creator);
    for (const [user, header] of [[{ id: actors.creator }, `Bearer ${other}`], [{ id: actors.resolver }, `Bearer ${token}`]]) {
      let error; try { api.assertBrowserIdentity(login, user, header, actors.creator); } catch (caught) { error = caught; }
      assert(error); const serialized = JSON.stringify({ failure: api.safeFailure(error), rawMessage: error.message });
      assert(!serialized.includes(token)); assert(!serialized.includes(other));
    }
  });

  test('backend denial verifier rejects unrelated error, success and any changed persisted readback', async () => {
    const { s } = fixture(); addPhysical(s, 'held');
    const expected = 'Inventory covered by an active hold cannot be transferred'; let reads = 0;
    const proof = await api.assertPhysicalDeniedUnchanged(async () => { reads++; return structuredClone(s); }, async () => ({ error: { message: expected } }), expected);
    assert.equal(reads, 2); assert.equal(proof.unchanged, true); assert.deepEqual(proof.readback.before, proof.readback.after);
    await assert.rejects(api.assertPhysicalDeniedUnchanged(async () => structuredClone(s), async () => ({ data: {} }), expected), /unexpectedly allowed/);
    await assert.rejects(api.assertPhysicalDeniedUnchanged(async () => structuredClone(s), async () => ({ error: { message: 'Network error' } }), expected));
    let after = false;
    await assert.rejects(api.assertPhysicalDeniedUnchanged(async () => { const result = structuredClone(s); if (after) result.stock[0].quantity++; return result; },
      async () => { after = true; return { error: { message: expected } }; }, expected), /changed persisted/);
  });

  test('failure reporting redacts signed URLs, bearer headers, JWTs and supplied password', () => {
    const signed = 'https://storage.invalid/object/sign/evidence/a.png?token=secret-signature';
    const error = new Error(`Failed locator src=${signed} Authorization: Bearer secret-token password private-password eyJhbGciOiJIUzI1NiJ9.abc123.signature123`);
    const message = api.safeFailure(error, ['private-password']);
    for (const secret of ['secret-signature', 'secret-token', 'private-password', 'eyJhbGciOiJIUzI1NiJ9.abc123.signature123']) assert(!message.includes(secret));
    assert(message.includes('Failed locator')); assert(message.includes('[redacted'));
  });

  test('completion rejects surface-only, duplicate, wrong-build, missing-readback and premature-closure evidence', () => {
    assert.throws(() => api.assertComplete(m, { complete: true, checks: [], failures: [] }));
    const { s, baseline } = fixture('closed');
    assert.throws(() => api.reconcile(m, c, s, binding, baseline, actors));
    const report = { runId: m.runId, commit: m.commit, failures: [], bindings: m.cases.map(c => ({ view: c.viewport })),
      checks: m.cases.flatMap(c => api.CHECKPOINTS.map(checkpoint => ({ checkpoint, view: c.viewport, runId: m.runId, commit: m.commit,
        actor: { id: actors.creator }, readback: { source: 'persisted-requery', snapshot: { cases: [] } }, screenshot: { ref: 'capture.png', sha256: 'a'.repeat(64), byteLength: 10 }, result: { replacementDelivered: true } }))) };
    assert.throws(() => api.assertComplete(m, report), /binding|evidence|readback|closure|scope/i);
  });

  test('release reconciles one replacement unit, preserves original issue, and rejects duplicate consumption', () => {
    const { s, baseline } = fixture('resolved', 'released');
    const o = s.orders[0]; const line = o.lines[0];
    Object.assign(line, { pickedQuantity: 1, pickBinId: c.binId });
    Object.assign(o, { picked_by: actors.picker, packed_by: actors.picker, released_by: actors.releaser,
      courier: c.courier, waybill_number: c.replacementWaybill, delivery_link: c.deliveryLink });
    s.stock[0].quantity = 8;
    s.reservations.push({ id: 'replacement-reservation', order_id: caseId, product_id: c.productId, quantity: 1, location_id: null, bin_id: null, status: 'released' });
    s.movements.push({ id: 'replacement-movement', reference: caseId, product_id: c.productId, type: 'fulfillment_release', quantity: 1,
      from_location_id: c.locationId, from_bin_id: c.binId, to_location_id: null, to_bin_id: null, lot_id: null, serial_number: null, actor: actors.releaserLabel });
    assert.equal(api.reconcile(m, c, s, binding, baseline, actors).onHand, 8);
    for (const change of [s => s.stock[0].quantity = 7, s => s.movements.push({ ...s.movements.at(-1) }), s => s.orders[0].released_by = actors.picker,
      s => s.movements.at(-1).reference = sourceId, s => s.reservations[1].quantity = 2]) {
      const bad = structuredClone(s); change(bad); assert.throws(() => api.reconcile(m, c, bad, binding, baseline, actors));
    }
  });

  test('completion validates stage readbacks rather than caller-supplied success flags', () => {
    const { s, baseline } = fixture('resolved');
    const report = { runId: m.runId, commit: m.commit, failures: [], bindings: [binding, { ...binding, view: 'mobile390' }],
      actors: [{ role: 'operations_associate', id: actors.creator }, { role: 'operations_lead', id: actors.resolver, authoritativeActor: actors.releaserLabel }],
      baselines: { desktop1440: baseline, mobile390: baseline },
      checks: m.cases.flatMap(c => api.CHECKPOINTS.map((checkpoint, i) => ({ checkpoint, view: c.viewport, runId: m.runId, commit: m.commit,
        actor: { id: actors.creator }, readback: { source: 'persisted-requery', snapshot: s },
        screenshot: { ref: `${c.viewport}-${i}.png`, sha256: 'a'.repeat(64), byteLength: 10, sessionActorId: actors.creator },
        result: { replacementDelivered: true, customerClosed: true } }))) };
    assert.throws(() => api.assertComplete(m, report), /stage|checkpoint|actor|source|readback|order|binding/i);
  });

  test('complete original/new-destination sequence requires exact persisted delivery and closure, independently attributed', () => {
    const report = { runId: m.runId, commit: m.commit, failures: [], bindings: [], baselines: {}, checks: [], previews: [], formEvidence: [], browserActors: [], negatives: [],
      actors: [{ role: 'operations_associate', id: actors.creator, authoritativeActor: actors.creatorLabel }, { role: 'operations_lead', id: actors.resolver, authoritativeActor: actors.releaserLabel }] };
    for (const [viewIndex, item] of m.cases.entries()) {
      const source = viewIndex ? 'b3000000-0000-4000-8000-000000000001' : sourceId;
      const id = viewIndex ? 'b4000000-0000-4000-8000-000000000001' : caseId;
      report.bindings.push(bindFor(item, source, id));
      report.browserActors.push(...[['operations_associate', actors.creator], ['operations_lead', actors.resolver]].map(([role, actorId]) => ({ view: item.viewport, role, actorId, source: 'browser-password-login-and-auth.getUser' })));
      report.negatives.push(...[['record_return_v2', actors.resolver], ['inspect_quality', actors.creator], ['release_quality_hold', actors.resolver], ['transfer', actors.creator]]
        .map(([name, actorId]) => ({ view: item.viewport, runId: m.runId, commit: m.commit, kind: 'exact-successful-command-replay', name, actorId, unchanged: true })));
      for (const [i, checkpoint] of api.CHECKPOINTS.entries()) {
        const j = i < 2 ? i : i < 6 ? 1 : i - 4;
        const orderStatus = [null, null, 'received', 'allocated', 'picking', 'packing', 'ready', 'released', 'completed', 'completed'][j];
        const caseStatus = j <= 1 ? 'submitted' : j === 9 ? 'closed' : 'resolved';
        const { s, baseline } = fixture(caseStatus, orderStatus, item, source, id); report.baselines[item.viewport] = baseline;
        if (i === 0) { s.cases = []; s.caseActivity = []; }
        if (i >= 2 && i <= 5) addPhysical(s, ['intake', 'held', 'released', 'relocated'][i - 2], item, report.bindings.at(-1));
        const o = s.orders[0];
        if (j >= 3) s.reservations.push({ id: 'new-reservation', order_id: id, product_id: item.productId, quantity: 1, status: j >= 7 ? 'released' : 'active' });
        if (j >= 5) { o.picked_by = actors.picker; Object.assign(o.lines[0], { pickedQuantity: 1, pickBinId: item.binId }); }
        if (j >= 6) Object.assign(o, { packed_by: actors.picker, courier: item.courier, waybill_number: item.replacementWaybill, delivery_link: item.deliveryLink });
        if (j >= 7) {
          o.released_by = actors.releaser; s.stock[0].quantity = 8;
          s.movements.push({ id: 'replacement-movement', reference: id, product_id: item.productId, type: 'fulfillment_release', quantity: 1,
            from_location_id: item.locationId, from_bin_id: item.binId, to_location_id: null, to_bin_id: null, lot_id: null, serial_number: null, actor: actors.releaserLabel });
        }
        if (j >= 8) {
          const objectPath = `delivery-${id}/0/d2000000-0000-4000-8000-000000000001.png`;
          const base = `https://${m.project}.supabase.co/storage/v1/object`;
          Object.assign(o, { shipment_status: 'delivered', proof_of_delivery_reference: item.replacementPodReference, proof_of_delivery_evidence_url: objectPath,
            delivered_at: '2026-09-13T01:00:00Z', shipment_events: [{ status: 'delivered', actor: actors.releaserLabel, reference: item.replacementPodReference, evidenceUrl: objectPath }] });
          s.activity = [{ action: 'confirm_delivery', module: 'warehouse', entity_type: 'fulfillment_order', entity_id: id, actor: actors.releaser }];
          s.podFixture = { ref: `${item.viewport}-synthetic-pod.png`, sha256: 'a'.repeat(64), byteLength: 100 };
          s.privateStorageEvidence = { status: 'verified', runId: m.runId, project: m.project, view: item.viewport, orderId: id, bucket: 'evidence', path: objectPath,
            fixture: s.podFixture, verifiedAt: '2026-09-13T01:01:00Z', upload: { method: 'POST', requestUrl: `${base}/evidence/${objectPath}`, bucket: 'evidence', path: objectPath, actorId: actors.releaser, httpStatus: 200 },
            publicRead: { method: 'GET', url: `${base}/public/evidence/${objectPath}`, anonymous: true, status: 400 },
            downloads: [actors.releaser, actors.picker].map(actorId => ({ actorId, bucket: 'evidence', path: objectPath, source: 'authenticated-storage-download', sha256: 'a'.repeat(64), byteLength: 100 })) };
          if (j === 9) {
            Object.assign(s.cases[0], { customer_closed_by: actors.creator, customer_closed_at: '2026-09-13T01:02:00Z', customer_resolution_reference: item.closureReference,
              customer_closure_evidence_url: `${base}/authenticated/evidence/${objectPath}` });
            s.caseActivity.push({ action: 'customer_closed', actor: actors.creator, entity_id: id, module: 'warehouse', entity_type: 'customer_return_case' });
          }
        }
        const actor = [2, 4, 6, 11, 12].includes(i) ? actors.resolver : actors.creator;
        const result = api.reconcile(m, item, s, report.bindings.at(-1), baseline, actors);
        report.checks.push({ checkpoint, view: item.viewport, runId: m.runId, commit: m.commit, actor: { id: actor },
          readback: { source: 'persisted-requery', snapshot: s }, result,
          screenshot: { ref: `${item.viewport}-${i}.png`, sha256: 'a'.repeat(64), byteLength: 100, sessionActorId: actor } });
        if (i === 2) {
          const objectPath = s.physicalEvidence.intake.path;
          report.previews.push({ view: item.viewport, runId: m.runId, commit: m.commit, actorId: actors.resolver, path: objectPath,
            framing: { naturalWidth: 640, naturalHeight: 360, fit: 'contain', x: 10, y: 50, width: 300, height: 180, viewportWidth: viewIndex ? 390 : 1440, viewportHeight: 844 },
            restoredUnsentForm: true, restoredFocus: true, unchangedCommands: true, unchangedUploads: true, unchangedReadback: true });
          const unsent = fixture('submitted', null, item, source, id).s; unsent.physicalEvidence = s.physicalEvidence;
          for (const name of ['physical-intake-evidence-preview', 'physical-intake-preview-closed-unsent']) report.formEvidence.push({ checkpoint: name, view: item.viewport,
            runId: m.runId, commit: m.commit, actor: { id: actors.resolver }, readback: { source: 'persisted-requery', snapshot: unsent },
            result: api.reconcile(m, item, unsent, report.bindings.at(-1), baseline, actors), screenshot: { ref: `${item.viewport}-${name}.png`, sha256: 'a'.repeat(64), byteLength: 100, sessionActorId: actors.resolver } });
        }
      }
      const checks = report.checks.filter(x => x.view === item.viewport);
      for (const [kind, index] of [['provisional-held-transfer', 2], ['inspected-held-transfer', 3], ['unauthorized-hold-release', 3]]) {
        const before = structuredClone(checks[index].readback.snapshot);
        if (kind === 'unauthorized-hold-release') before.physicalEvidence.release = checks[4].readback.snapshot.physicalEvidence.release;
        const probe = api.physicalDenial(item, report.bindings.at(-1), kind, before.physicalEvidence, actors.creatorLabel);
        report.negatives.push({ kind, name: probe.name, payload: probe.payload, error: probe.expected, view: item.viewport, runId: m.runId, commit: m.commit, actorId: actors.creator, unchanged: true,
          readback: { source: 'persisted-requery-before-and-after', before, after: structuredClone(before) } });
      }
    }
    api.assertComplete(m, report);
    for (const change of [r => r.checks.pop(), r => r.checks.push(r.checks[0]), r => r.checks[4].commit = 'b'.repeat(40),
      r => r.checks[12].readback.snapshot.privateStorageEvidence.downloads.pop(), r => r.checks[12].readback.snapshot.activity[0].actor = actors.creator,
      r => r.checks[8].screenshot.ref = r.checks[7].screenshot.ref, r => r.checks[13].readback.snapshot.cases[0].customer_closed_by = actors.resolver,
      r => r.previews.pop(), r => r.previews[0].unchangedUploads = false, r => r.formEvidence.pop(), r => r.browserActors.pop(), r => r.browserActors[0].actorId = actors.resolver,
      r => r.negatives.pop(), r => r.negatives[0].unchanged = false,
      r => r.negatives.find(x => x.kind === 'provisional-held-transfer').readback.after.stock[0].quantity++,
      r => r.negatives.find(x => x.kind === 'unauthorized-hold-release').error = 'Unrelated failure',
      r => r.negatives.find(x => x.kind === 'unauthorized-hold-release').payload.hold_id = sourceId,
      r => r.negatives.find(x => x.kind === 'provisional-held-transfer').payload.from_stock_delta.delta = -2,
      r => r.negatives.find(x => x.kind === 'provisional-held-transfer').commit = 'b'.repeat(40),
      r => r.negatives = r.negatives.filter(x => x.kind !== 'inspected-held-transfer'),
      r => r.checks[2].readback.snapshot.inspections[0].id = r.checks[3].readback.snapshot.inspections[0].id]) {
      const bad = structuredClone(report); change(bad); assert.throws(() => api.assertComplete(m, bad));
    }
  });
}
