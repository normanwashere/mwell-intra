import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanupAndVerifyRun } from './cleanup-uat-live-run.mjs';

const runId = 'QA-20260905-00003C1F';
const viewport = 'desktop-1440';
const marker = `${runId}-${viewport}`;
const requestId = `req_${marker}-receipt-request`;
const custodyId = '11111111-2222-4333-8444-555555555555';
const custodyPath = `excess-custody/${custodyId}/aaaaaaaa-bbbb-4ccc-8ddd-000000000001.png`;
const paymentPath = `request/${requestId}/att_abc-${marker}-invoice.pdf`;
// Only passed to the target guard with an in-memory client; no network calls.
const env = { APP_ENV: 'uat', NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst', PRODUCTION_SUPABASE_PROJECT_REF: 'zyxwvutsrqponmlkjihg', POLICY_ALLOW_TEST_MUTATIONS: 'true' };

function fixture({ storageFailure = false, discoveryFailure = false } = {}) {
  const tables = new Map(Object.entries({
    'procurement.requests': [{ id: requestId, title: `${marker} Receipt authority request` }, { id: `${requestId}-ordinary`, title: 'Ordinary' }],
    'procurement.purchase_orders': [{ id: `${marker}-po`, request_id: requestId }, { id: 'ordinary-po', request_id: `${requestId}-ordinary` }],
    'procurement.payment_readiness_packs': [{ id: 'run-pack', purchase_order_id: `${marker}-po` }, { id: 'ordinary-pack', purchase_order_id: 'ordinary-po' }],
    'procurement.vendor_invoice_identities': [{ current_pack_id: 'run-pack' }, { current_pack_id: 'ordinary-pack' }],
    'procurement.request_attachments': [{ id: 'att_abc', request_id: requestId, storage_path: paymentPath },
      { id: 'att_seed', request_id: `${requestId}-ordinary`, storage_path: `request/${requestId}-ordinary/att_seed-file.pdf` }],
    'warehouse.receipts': [{ id: 'run-receipt', procurement_po_id: `${marker}-po` }],
    'warehouse.procurement_receipt_exception_decisions': [{ id: 'run-decision', receipt_id: 'run-receipt' }],
    'warehouse.procurement_receipt_excess_custody': [{ id: custodyId, decision_id: 'run-decision' }],
  }));
  const blobs = new Set([custodyPath, paymentPath, `request/${requestId}-ordinary/att_seed-file.pdf`]);
  const calls = [];
  const client = {
    schema(schema) {
      return {
        from(table) {
          const key = `${schema}.${table}`;
          const filters = [];
          let remove = false;
          const query = {
            select() { return query; }, delete() { remove = true; return query; },
            eq(field, value) { filters.push(row => row[field] === value); return query; },
            in(field, values) { filters.push(row => values.includes(row[field])); return query; },
            like(field, pattern) { filters.push(row => String(row[field] ?? '').startsWith(pattern.replace(/%$/, ''))); return query; },
            then(resolve, reject) {
              return Promise.resolve().then(() => {
                if (discoveryFailure && table === 'procurement_receipt_excess_custody' && !remove)
                  return { data: null, error: { message: 'discovery denied' } };
                const rows = tables.get(key) ?? [];
                const matched = rows.filter(row => filters.every(fn => fn(row)));
                if (remove) {
                  calls.push({ type: 'delete', key, matched });
                  if (table === 'payment_readiness_packs') assert.ok(!(tables.get('procurement.vendor_invoice_identities') ?? []).some(identity => matched.some(pack => identity.current_pack_id === pack.id)), 'identity FK');
                  if (table === 'purchase_orders') assert.ok(!(tables.get('procurement.request_attachments') ?? []).some(doc => matched.some(po => doc.request_id === po.request_id)), 'attachment PO FK');
                  if (table === 'procurement_receipt_excess_custody') assert.ok(!blobs.has(custodyPath));
                  if (table === 'request_attachments') assert.ok(!blobs.has(paymentPath));
                  tables.set(key, rows.filter(row => !matched.includes(row)));
                }
                return { data: matched, error: null, count: matched.length };
              }).then(resolve, reject);
            },
          };
          return query;
        },
        async rpc(name, { p_marker }) {
          assert.equal(p_marker, marker);
          calls.push({ type: 'rpc', name });
          if (name === 'cleanup_certification_requests') {
            assert.ok(!tables.get('procurement.purchase_orders').some(po => po.request_id === requestId));
            tables.set('procurement.requests', tables.get('procurement.requests').filter(row => row.id !== requestId));
          }
          return { data: { marker, removed: 1, remaining: 0 }, error: null };
        },
      };
    },
    storage: { from(bucket) { return {
      async list(folder, { offset, limit }) {
        calls.push({ type: 'list', bucket, folder });
        return { data: [...blobs].filter(path => path.startsWith(`${folder}/`)).slice(offset, offset + limit).map(path => ({ id: path, name: path.slice(folder.length + 1) })), error: null };
      },
      async remove(paths) {
        calls.push({ type: 'storage-remove', bucket, paths });
        if (storageFailure) return { error: { message: 'storage denied' } };
        paths.forEach(path => blobs.delete(path));
        return { error: null };
      },
    }; } },
    auth: { admin: { async listUsers() { return { data: { users: [] }, error: null }; } } },
  };
  return { client, tables, blobs, calls };
}

test('permanent cleanup discovers exact request/custody, removes blobs first, honors payment FKs and preserves ordinary records', async () => {
  const h = fixture();
  const report = await cleanupAndVerifyRun({ runId, viewport, env, client: h.client });
  assert.equal(report.complete, true, JSON.stringify(report.results.filter(row => row.error)));
  assert.deepEqual(h.tables.get('procurement.vendor_invoice_identities'), [{ current_pack_id: 'ordinary-pack' }]);
  assert.equal(h.tables.get('procurement.payment_readiness_packs')[0].id, 'ordinary-pack');
  assert.equal(h.tables.get('procurement.requests')[0].id, `${requestId}-ordinary`);
  assert.deepEqual([...h.blobs], [`request/${requestId}-ordinary/att_seed-file.pdf`]);
  assert.ok(h.calls.some(call => call.type === 'rpc' && call.name === 'cleanup_certification_requests'));
  assert.ok(h.calls.filter(call => call.type === 'list').every(call => !call.folder.endsWith('-ordinary')));
  const repeat = await cleanupAndVerifyRun({ runId, viewport, env, client: h.client });
  assert.equal(repeat.complete, true);
});

for (const options of [{ storageFailure: true }, { discoveryFailure: true }]) {
  test(`permanent cleanup retains evidence discoverability on ${Object.keys(options)[0]}`, async () => {
    const h = fixture(options);
    await assert.rejects(cleanupAndVerifyRun({ runId, viewport, env, client: h.client }), /Storage cleanup failed|Cleanup discovery failed/);
    assert.ok(!h.calls.some(call => call.type === 'delete' || call.type === 'rpc'));
    assert.equal(h.tables.get('warehouse.procurement_receipt_excess_custody').length, 1);
    assert.equal(h.tables.get('procurement.request_attachments').length, 2);
  });
}
