import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Exercise only the in-memory Playwright fixture, never an HTTP endpoint or database.
const source = readFileSync(new URL('../../apps/shell/tests/helpers/controlled-procurement-rpc.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { ControlledProcurementRpcFixture, actor } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

async function rpc(fixture, name, payload = {}, actorKey = 'vendor', schema = 'procurement') {
  let result;
  await fixture.handle({
    request: () => ({
      method: () => 'POST',
      url: () => `http://controlled.invalid/rest/v1/rpc/${name}`,
      headers: () => ({ authorization: `Bearer controlled-${actor(actorKey).id}`, 'content-profile': schema }),
      postData: () => JSON.stringify({ payload }),
    }),
    fulfill: async ({ status, body }) => { result = { status, body: JSON.parse(body) }; },
    continue: () => { throw new Error('Controlled fixture must not use the network'); },
  });
  return result;
}

function prepared(options) {
  const fixture = new ControlledProcurementRpcFixture();
  fixture.prepareTask9PurchaseOrder(options);
  return fixture;
}

async function acknowledgement(fixture) {
  const { body: [po] } = await rpc(fixture, 'vendor_purchase_order_acknowledgements');
  return { purchase_order_id: po.id, expected_revision: po.lifecycle.revision,
    document_hash: po.documentHash, acknowledgement_reference: 'ACK-CONTROLLED-009' };
}

test('Task 9 explicitly mocks the live capability without granting it to other fixtures', async () => {
  const snapshot = (fixture) => rpc(fixture, 'my_capability_snapshot', {}, 'vendor', 'core');
  const { body } = await snapshot(prepared());
  assert.ok(body.roleCapabilities.core.includes('submit_accreditation'));
  assert.ok(body.userCapabilities.core.includes('submit_accreditation'));
  assert.ok(!(await snapshot(new ControlledProcurementRpcFixture())).body.userCapabilities.core.includes('submit_accreditation'));
  const uncertified = prepared({ certified: false });
  assert.ok(!(await snapshot(uncertified)).body.userCapabilities.core.includes('submit_accreditation'));
  assert.equal((await rpc(uncertified, 'acknowledge_purchase_order', await acknowledgement(uncertified))).status, 403);
});

test('Task 9 projects the complete reviewable document only to its awarded vendor', async () => {
  const fixture = prepared();
  const { body: [po] } = await rpc(fixture, 'vendor_purchase_order_acknowledgements');
  assert.match(po.documentHash, /^[a-f0-9]{64}$/);
  assert.equal(po.lines[0].unitPrice, 1000);
  assert.equal(po.total, 1000);
  assert.equal(po.expectedDate, '2026-09-01');
  for (const key of ['paymentTerms', 'deliveryTerms', 'shippingTerms', 'scopeOfWork', 'acceptanceCriteria', 'validityPeriod']) assert.ok(po.terms[key]);
  assert.deepEqual((await rpc(fixture, 'vendor_purchase_order_acknowledgements', {}, 'unrelatedVendor')).body, []);
  fixture.purchaseOrder.status = 'approved';
  assert.deepEqual((await rpc(fixture, 'vendor_purchase_order_acknowledgements')).body, []);
});

test('Task 9 rejects foreign, stale, hashless and reference-less acknowledgements without mutation', async () => {
  const fixture = prepared();
  const valid = await acknowledgement(fixture);
  const before = structuredClone(fixture.lifecycle);
  for (const patch of [{ document_hash: '' }, { document_hash: '0'.repeat(64) }, { expected_revision: 1 }, { acknowledgement_reference: ' ' }, { purchase_order_id: 'foreign-po' }]) {
    assert.ok((await rpc(fixture, 'acknowledge_purchase_order', { ...valid, ...patch })).status >= 400);
    assert.deepEqual(fixture.lifecycle, before);
  }
  assert.equal((await rpc(fixture, 'acknowledge_purchase_order', valid, 'unrelatedVendor')).status, 403);
  assert.deepEqual(fixture.lifecycle, before);
});

test('Task 9 persists acknowledgement once and permits only the exact replay', async () => {
  const fixture = prepared();
  const payload = await acknowledgement(fixture);
  const first = await rpc(fixture, 'acknowledge_purchase_order', payload);
  assert.equal(first.status, 200);
  assert.equal(first.body.replayed, false);
  assert.equal(first.body.revision, 3);
  assert.equal(first.body.acknowledgementReference, payload.acknowledgement_reference);
  const second = await rpc(fixture, 'acknowledge_purchase_order', payload);
  assert.equal(second.body.replayed, true);
  assert.equal(second.body.revision, 3);
  assert.ok((await rpc(fixture, 'acknowledge_purchase_order', { ...payload, acknowledgement_reference: 'DIFFERENT' })).status >= 400);
  assert.equal(fixture.lifecycle.revision, 3);
  assert.equal(fixture.purchaseOrder.status, 'issued');
});
