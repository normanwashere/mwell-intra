import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupPaymentEvidenceStorage, cleanupExcessCustodyStorage } from './cleanup-uat-live-run.mjs';

const requestId = 'req_QA-20260905-00003C1F-desktop-1440-receipt-request';
const custodyId = '11111111-2222-4333-8444-555555555555';
const uuid = n => `aaaaaaaa-bbbb-4ccc-8ddd-${String(n).padStart(12, '0')}`;
function storageFixture(initial) {
  const objects = new Map(Object.entries(initial));
  const calls = [];
  const api = {
    async list(folder, { offset, limit, sortBy }) {
      calls.push({ type: 'list', folder, offset, limit });
      assert.deepEqual(sortBy, { column: 'name', order: 'asc' });
      return { data: (objects.get(folder) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)).slice(offset, offset + limit), error: null };
    },
    async remove(paths) {
      calls.push({ type: 'remove', paths });
      for (const [folder, rows] of objects) objects.set(folder, rows.filter(row => !paths.includes(`${folder}/${row.name}`)));
      return { error: null };
    },
  };
  const database = { storage: { from(bucket) { calls.push({ type: 'bucket', bucket }); return api; } } };
  return { database, api, objects, calls };
}

test('payment cleanup discovers registered and orphan uploads, removes exact paths and verifies; ordinary folders survive', async () => {
  const folder = `request/${requestId}`;
  const h = storageFixture({ [folder]: [{ id: '1', name: 'att_abc-run-invoice.pdf' }, { id: '2', name: 'att_def-run-tax.pdf' }],
    [`${folder}-ordinary`]: [{ id: '3', name: 'att_ghi-ordinary.pdf' }] });
  const result = await cleanupPaymentEvidenceStorage(h.database, [requestId], [{ request_id: requestId, storage_path: `${folder}/att_abc-run-invoice.pdf` }], [`${folder}/att_uncertain-run.pdf`]);
  assert.deepEqual(result.storagePaths.sort(), ['att_abc-run-invoice.pdf', 'att_def-run-tax.pdf', 'att_uncertain-run.pdf'].map(name => `${folder}/${name}`).sort());
  assert.equal(h.objects.get(`${folder}-ordinary`).length, 1);
  assert.equal(result.remaining, 0);
  assert.equal((await cleanupPaymentEvidenceStorage(h.database, [requestId], [])).removed, 0);
  assert.ok(h.calls.filter(call => call.type === 'bucket').every(call => call.bucket === 'procurement-requests'));
});

test('custody cleanup paginates before removal, batches deletes and only touches exact custody folder', async () => {
  const folder = `excess-custody/${custodyId}`;
  const h = storageFixture({ [folder]: Array.from({ length: 205 }, (_, n) => ({ id: uuid(n), name: `${uuid(n)}.png` })),
    [`excess-custody/${uuid(999)}`]: [{ id: uuid(999), name: `${uuid(999)}.png` }] });
  const result = await cleanupExcessCustodyStorage(h.database, [custodyId]);
  assert.equal(result.removed, 205);
  assert.deepEqual(h.calls.filter(call => call.type === 'list').map(call => call.offset), [0, 100, 200, 0]);
  assert.deepEqual(h.calls.filter(call => call.type === 'remove').map(call => call.paths.length), [100, 100, 5]);
  assert.equal(h.objects.get(`excess-custody/${uuid(999)}`).length, 1);
  assert.equal((await cleanupExcessCustodyStorage(h.database, [custodyId])).removed, 0);
});

for (const entry of [{ id: null, name: 'nested' }, { id: 'x', name: '../outside.png' }, { id: 'x', name: 'nested/file.png' }, { id: 'x', name: `${uuid(1)}.pdf` }]) {
  test(`rejects unexpected custody entry ${entry.name} without deletes`, async () => {
    const h = storageFixture({ [`excess-custody/${custodyId}`]: [entry] });
    await assert.rejects(cleanupExcessCustodyStorage(h.database, [custodyId]), /Unexpected nested or unsafe/);
    assert.ok(!h.calls.some(call => call.type === 'remove'));
  });
}

test('rejects foreign attachment paths, path traversal and unsafe scope before any delete', async () => {
  for (const args of [
    [[requestId], [{ request_id: 'req_other_12345678', storage_path: 'request/req_other_12345678/att_x-file.pdf' }]],
    [[requestId], [{ request_id: requestId, storage_path: `request/${requestId}/nested/att_x-file.pdf` }]],
    [[requestId], [], ['request/req_other_12345678/att_x-file.pdf']],
    [['../outside'], []],
  ]) {
    const h = storageFixture({});
    await assert.rejects(cleanupPaymentEvidenceStorage(h.database, ...args), /scope|Unsafe|outside/);
    assert.ok(!h.calls.some(call => call.type === 'remove'));
  }
  const h = storageFixture({});
  await assert.rejects(cleanupExcessCustodyStorage(h.database, ['../outside']), /Unsafe custody/);
  assert.equal(h.calls.length, 0);
});

for (const stage of ['list', 'remove', 'verify', 'residue', 'missing list']) {
  test(`storage ${stage} failure is surfaced, never falsely certified`, async () => {
    const folder = `excess-custody/${custodyId}`;
    const h = storageFixture({ [folder]: [{ id: uuid(1), name: `${uuid(1)}.png` }] });
    const original = h.api.list;
    let lists = 0;
    h.api.list = async (...args) => {
      lists++;
      if (stage === 'list' || (stage === 'verify' && lists > 1)) return { error: { message: 'denied' } };
      if (stage === 'missing list') return { data: null, error: null };
      return original(...args);
    };
    if (stage === 'remove') h.api.remove = async () => ({ error: { message: 'denied' } });
    if (stage === 'residue') h.api.remove = async () => ({ error: null });
    await assert.rejects(cleanupExcessCustodyStorage(h.database, [custodyId]), /Storage/);
  });
}
