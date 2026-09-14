import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as cleanupTools from './cleanup-uat-live-run.mjs';
import { cleanupAndVerifyRun as actualCleanupAndVerifyRun } from './cleanup-uat-live-run.mjs';

const runId = 'QA-20260905-00003C1F';
const viewport = 'desktop-1440';
const marker = `${runId}-${viewport}`;
const requestId = `req_${marker}-receipt-request`;
const custodyId = '11111111-2222-4333-8444-555555555555';
const custodyPath = `excess-custody/${custodyId}/aaaaaaaa-bbbb-4ccc-8ddd-000000000001.png`;
const paymentPath = `request/${requestId}/att_abc-${marker}-invoice.pdf`;
// Only passed to the target guard with an in-memory client; no network calls.
const env = { APP_ENV: 'uat', NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_PROJECT_REF: 'abcdefghijklmnopqrst', PRODUCTION_SUPABASE_PROJECT_REF: 'zyxwvutsrqponmlkjihg', POLICY_ALLOW_TEST_MUTATIONS: 'true', GITHUB_SHA: 'a'.repeat(40) };

const membershipFiles = new WeakMap(), membershipRoots = [];
test.after(async () => {
  for (const root of membershipRoots) {
    assert(path.resolve(root).startsWith(path.join(tmpdir(), 'payment-cleanup-membership-')));
    await rm(root, { recursive: true, force: true });
  }
});
async function cleanupAndVerifyRun(options) {
  if (!membershipFiles.has(options.client)) {
    const root = await mkdtemp(path.join(tmpdir(), 'payment-cleanup-membership-'));
    membershipRoots.push(root);
    const file = path.join(root, 'intent.json');
    await cleanupTools.prepareTask3ApprovalMembership({ client: options.client, file,
      scope: { runId, viewport, project: env.SUPABASE_PROJECT_REF, buildId: env.GITHUB_SHA } });
    membershipFiles.set(options.client, file);
  }
  return actualCleanupAndVerifyRun({ ...options, approvalMembershipFile: membershipFiles.get(options.client) });
}

function fixture({ storageFailure = false, discoveryFailure = false, draft = false, requestDiscoveryFailure = false } = {}) {
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
  const draftId = 'req_random_draft_12345678';
  if (draft) {
    tables.get('procurement.requests').push({ id: draftId, title: `${marker} Procurement draft` },
      { id: 'req_tester_12345678', title: `${marker} Procurement draft extra` });
    for (const kind of ['spec', 'budget', 'previous-cost', 'quote']) {
      const storage_path = `request/${draftId}/att_${kind}-${marker}-${kind}.pdf`;
      tables.get('procurement.request_attachments').push({ id: `att_${kind}`, request_id: draftId, storage_path });
      blobs.add(storage_path);
    }
    blobs.add('request/req_tester_12345678/att_tester-file.pdf');
  }
  const calls = [];
  const client = {
    schema(schema) {
      return {
        from(table) {
          const key = `${schema}.${table}`;
          const filters = [];
          let remove = false, single = false;
          let range;
          const query = {
            select() { return query; }, delete() { remove = true; return query; },
            single() { single = true; return query; }, abortSignal() { return query; },
            order() { return query; }, range(start, end) { range = [start, end]; return query; },
            eq(field, value) { filters.push(row => row[field] === value); return query; },
            in(field, values) { filters.push(row => values.includes(row[field])); return query; },
            like(field, pattern) { filters.push(row => String(row[field] ?? '').startsWith(pattern.replace(/%$/, ''))); return query; },
            then(resolve, reject) {
              return Promise.resolve().then(() => {
                if (table === 'approval_groups') {
                  const group = { entity_type: 'warehouse_stock_change', group_code: 'logistics_supervisor', member_roles: ['warehouse_supervisor'] };
                  return { data: single ? group : [group], error: null, count: 1 };
                }
                if (discoveryFailure && table === 'procurement_receipt_excess_custody' && !remove)
                  return { data: null, error: { message: 'discovery denied' } };
                if (requestDiscoveryFailure && table === 'requests' && !remove)
                  return { data: null, error: { message: 'request discovery denied' } };
                const rows = tables.get(key) ?? [];
                let matched = rows.filter(row => filters.every(fn => fn(row)));
                if (range) matched = matched.slice(range[0], range[1] + 1);
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
            const scoped = tables.get('procurement.requests').filter(row => row.id.startsWith(`${marker}-`) || row.id === requestId || row.title === `${marker} Procurement draft`);
            const ids = scoped.map(row => row.id);
            tables.set('procurement.requests', tables.get('procurement.requests').filter(row => !ids.includes(row.id)));
            tables.set('procurement.request_attachments', tables.get('procurement.request_attachments').filter(row => !ids.includes(row.request_id)));
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
  return { client, tables, blobs, calls, draftId };
}

test('independent cleanup never infers ownership of a reusable vendor from its run case', async () => {
  const h = fixture();
  h.tables.set('legal.accreditation_cases', [{ id: `${marker}-temporary-clearance-case`,
    vendor_id: 'shared-vendor', vendor_name: `${marker} Vendor` }]);
  h.tables.set('core.vendors', [{ id: 'shared-vendor', legal_name: 'MWELL UAT Test Vendor' }]);
  h.tables.set('procurement.suppliers', [{ id: 'proc-shared-vendor' }]);
  h.tables.set('core.profiles', [{ id: 'ordinary-vendor-user', email: 'intra.test.vendor@mwell.com.ph', vendor_id: 'shared-vendor' }]);
  const report = await cleanupAndVerifyRun({ runId, viewport, env, client: h.client });
  assert.equal(report.complete, true);
  assert.equal(h.tables.get('core.vendors').length, 1);
  assert.equal(h.tables.get('procurement.suppliers').length, 1);
  assert.equal(h.tables.get('core.profiles').length, 1);
  assert.ok(!h.calls.some(call => call.type === 'delete' && call.matched.some(row =>
    ['shared-vendor', 'proc-shared-vendor', 'ordinary-vendor-user'].includes(row.id))));
});

test('a run-like vendor name cannot put an existing ordinary account parent into generic deletion', async () => {
  const h = fixture();
  h.tables.set('core.vendors', [{ id: 'shared-vendor', legal_name: `${marker} Vendor` }]);
  h.tables.set('procurement.suppliers', [{ id: 'proc-shared-vendor' }]);
  h.tables.set('core.profiles', [{ id: 'ordinary-vendor-user', email: 'intra.test.vendor@mwell.com.ph', vendor_id: 'shared-vendor' }]);
  await assert.rejects(cleanupAndVerifyRun({ runId, viewport, env, client: h.client }), /discovery failed/);
  assert.equal(h.tables.get('core.vendors').length, 1);
  assert.equal(h.tables.get('procurement.suppliers').length, 1);
  assert.equal(h.tables.get('core.profiles').length, 1);
});

test('explicit missing vendor-case provenance fails independent cleanup instead of legacy omission credit', async () => {
  const h = fixture();
  await assert.rejects(cleanupAndVerifyRun({ runId, viewport, env, client: h.client,
    vendorApplicationFile: 'does-not-exist-vendor-application.json' }), /discovery failed/);
  assert.ok(!h.calls.some(call => call.type === 'delete' || call.type === 'storage-remove'));
});

// Run the actual in-process evidence block without starting the live harness.
async function inProcessRequestCleanup(h) {
  const source = readFileSync(new URL('./full-intra-live-e2e.mjs', import.meta.url), 'utf8');
  const narrow = source.slice(source.indexOf('async function cleanupTask3ReceiptFixture('));
  const start = narrow.search(/  const (?:\{ data: attachmentRows|requestEvidence)/);
  const end = narrow.indexOf('  await remove("procurement", "acceptance_packs"', start);
  assert.ok(start >= 0 && end > start);
  const remove = async (schema, table, configure) => {
    const { error } = await configure(h.client.schema(schema).from(table).delete());
    if (error) throw new Error(error.message);
  };
  await new Function('client', 'ids', 'fixture', 'marker', 'remove', ...Object.keys(cleanupTools),
    `return (async () => { ${narrow.slice(start, end)} })();`)(
    h.client, { request: requestId }, {}, marker, remove, ...Object.values(cleanupTools));
  // The intervening harness cleanup removes its PO before the real request RPC.
  h.tables.set('procurement.purchase_orders', h.tables.get('procurement.purchase_orders').filter(row => row.request_id !== requestId));
  const rpcStart = narrow.indexOf('  const { data: requestCleanup, error: requestCleanupError }');
  const rpcEnd = narrow.indexOf('  const { data: departmentMatrices', rpcStart);
  await new Function('client', 'marker', `return (async () => { ${narrow.slice(rpcStart, rpcEnd)} })();`)(h.client, marker);
}

test('successful UI draft PDFs are removed before in-process request cascade and independent cleanup remains safe', async () => {
  const h = fixture({ draft: true });
  await inProcessRequestCleanup(h);
  assert.ok(!h.tables.get('procurement.requests').some(row => row.id === h.draftId));
  assert.ok(![...h.blobs].some(path => path.startsWith(`request/${h.draftId}/`)), 'in-process cleanup must remove the four draft PDFs before their discovery rows cascade');
  const report = await cleanupAndVerifyRun({ runId, viewport, env, client: h.client });
  assert.equal(report.complete, true);
  assert.ok(![...h.blobs].some(path => path.startsWith(`request/${h.draftId}/`)));
  assert.ok(h.blobs.has('request/req_tester_12345678/att_tester-file.pdf'));
  assert.ok(h.tables.get('procurement.requests').some(row => row.id === 'req_tester_12345678'));
});

for (const options of [{ requestDiscoveryFailure: true }, { storageFailure: true }]) {
  test(`in-process request cleanup blocks deletion on ${Object.keys(options)[0]}`, async () => {
    const h = fixture({ draft: true, ...options });
    await assert.rejects(inProcessRequestCleanup(h), /discovery|Storage/);
    assert.ok(!h.calls.some(call => call.type === 'delete' || call.type === 'rpc'));
    assert.ok(h.tables.get('procurement.requests').some(row => row.id === h.draftId));
    assert.equal(h.tables.get('procurement.request_attachments').length, 6);
  });
}

test('generic request cleanup cannot bypass a failed evidence gate', async () => {
  const h = fixture({ draft: true, storageFailure: true });
  const targets = [{ schema: 'procurement', table: 'requests', filters: { title: `${marker} Procurement draft` } },
    { schema: 'warehouse', table: 'events' }];
  const gate = await cleanupTools.gateCertificationRequestCleanup(h.client, [marker], targets);
  assert.equal(gate.complete, false);
  assert.deepEqual(gate.targets, [targets[1]]);
  assert.ok(gate.results[0].error);
  assert.equal(h.tables.get('procurement.request_attachments').length, 6);
});

test('independent cleanup alone discovers the successful UI draft and leaves tester PDFs untouched', async () => {
  const h = fixture({ draft: true });
  const report = await cleanupAndVerifyRun({ runId, viewport, env, client: h.client });
  assert.equal(report.complete, true);
  assert.ok(![...h.blobs].some(path => path.startsWith(`request/${h.draftId}/`)));
  assert.ok(h.blobs.has('request/req_tester_12345678/att_tester-file.pdf'));
  assert.ok(h.tables.get('procurement.requests').some(row => row.id === 'req_tester_12345678'));
});

test('successful fallback gate cleans draft evidence before allowing generic request deletion', async () => {
  const h = fixture({ draft: true });
  const targets = [{ schema: 'procurement', table: 'requests', filters: { title: `${marker} Procurement draft` } }];
  const gate = await cleanupTools.gateCertificationRequestCleanup(h.client, [marker], targets);
  assert.equal(gate.complete, true);
  assert.deepEqual(gate.targets, targets);
  assert.ok(![...h.blobs].some(path => path.startsWith(`request/${h.draftId}/`)));
  assert.equal(h.tables.get('procurement.request_attachments').length, 6);
});

test('attachment discovery checks later pages before removing any object', async () => {
  const h = fixture();
  for (let index = 0; index < 101; index++) h.tables.get('procurement.request_attachments').push({
    id: `att_extra_${index}`, request_id: requestId, storage_path: `request/${requestId}/att_extra_${index}-file.pdf`,
  });
  h.tables.get('procurement.request_attachments').push({ id: 'att_foreign', request_id: requestId,
    storage_path: 'request/req_tester_12345678/att_tester-file.pdf' });
  await assert.rejects(cleanupTools.cleanupCertificationRequestEvidence(h.client, marker), /outside exact request scope/);
  assert.ok(!h.calls.some(call => call.type === 'storage-remove' || call.type === 'delete' || call.type === 'rpc'));
});

test('request evidence discovery paginates full title scope and retains legacy and ordinary boundaries', async () => {
  const h = fixture();
  for (let index = 0; index < 103; index++) {
    const id = `req_draft_${String(index).padStart(8, '0')}`;
    h.tables.get('procurement.requests').push({ id, title: `${marker} Procurement draft` });
    const storage_path = `request/${id}/att_${index}-spec.pdf`;
    h.tables.get('procurement.request_attachments').push({ id: `att_${index}`, request_id: id, storage_path });
    h.blobs.add(storage_path);
  }
  h.tables.get('procurement.requests').push({ id: `${marker}-legacy`, title: 'Legacy audit' },
    { id: `req_${runId}-mobile-390-receipt-request`, title: 'Other viewport' });
  const result = await cleanupTools.cleanupCertificationRequestEvidence(h.client, marker);
  assert.equal(result.requestIds.length, 105);
  assert.ok(result.requestIds.includes(`${marker}-legacy`));
  assert.ok(!result.requestIds.includes(`req_${runId}-mobile-390-receipt-request`));
  assert.equal([...h.blobs].filter(path => path.startsWith('request/req_draft_')).length, 0);
  assert.ok(!h.calls.some(call => call.type === 'delete' || call.type === 'rpc'));
});

test('invalid markers fail before any discovery or storage operation', async () => {
  for (const invalid of ['', null, marker + '-extra', 'QA-%', marker.toLowerCase()]) {
    const h = fixture({ draft: true });
    await assert.rejects(cleanupTools.cleanupCertificationRequestEvidence(h.client, invalid), /Invalid certification/);
    assert.equal(h.calls.length, 0);
  }
});

for (const failure of ['attachment discovery', 'missing discovery rows', 'foreign attachment', 'storage verification']) {
  test(`request cleanup blocks deletion on ${failure}`, async () => {
    const h = fixture({ draft: true });
    if (failure === 'storage verification') {
      const from = h.client.storage.from;
      h.client.storage.from = bucket => ({ ...from(bucket), remove: async () => ({ error: null }) });
    } else {
      const schema = h.client.schema;
      h.client.schema = name => {
        const original = schema(name);
        return { ...original, from(table) {
          const query = original.from(table);
          if (table === 'request_attachments') query.then = (resolve, reject) => Promise.resolve(
            failure === 'attachment discovery' ? { error: { message: 'attachment denied' } } :
              failure === 'missing discovery rows' ? { data: null } :
                { data: [{ id: 'foreign', request_id: 'req_tester_12345678', storage_path: 'request/req_tester_12345678/att_tester-file.pdf' }] },
          ).then(resolve, reject);
          return query;
        } };
      };
    }
    await assert.rejects(inProcessRequestCleanup(h), /discovery|Storage cleanup left/);
    assert.ok(!h.calls.some(call => call.type === 'delete' || call.type === 'rpc'));
    assert.equal(h.tables.get('procurement.request_attachments').length, 6);
  });
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

test('independent cleanup discovers receiving crash orphans without seeds or receipt rows', async () => {
  const h = fixture();
  for (const key of h.tables.keys()) h.tables.set(key, []);
  h.blobs.clear();
  const folder = `audit/${marker}/receiving`;
  const orphans = Array.from({ length: 205 }, (_, i) => `${folder}/orphan-${i}.png`);
  const neighbors = [`${folder}-ordinary/photo.png`, `audit/${marker}/other.png`,
    `audit/${runId}-mobile-390/receiving/photo.png`];
  [...orphans, ...neighbors].forEach(path => h.blobs.add(path));
  const report = await cleanupAndVerifyRun({ runId, viewport, env, client: h.client });
  const storage = report.results.find(result => result.entity === 'storage.evidence:receiving');
  assert.ok(storage, 'Receiving storage must appear in the independent cleanup report');
  assert.equal(storage.removed, orphans.length);
  assert.equal(storage.remaining, 0);
  assert.equal(report.complete, true);
  assert.deepEqual([...h.blobs], neighbors);
  const removes = h.calls.filter(call => call.type === 'storage-remove' && call.paths.some(path => path.startsWith(`${folder}/`)));
  assert.deepEqual(removes.map(call => call.paths.length), [100, 100, 5]);
  assert.ok(h.calls.indexOf(removes.at(-1)) < h.calls.findIndex(call => call.type === 'delete' || call.type === 'rpc'));
  const repeat = await cleanupAndVerifyRun({ runId, viewport, env, client: h.client });
  assert.equal(repeat.complete, true);
  assert.equal(repeat.results.find(result => result.entity === 'storage.evidence:receiving').removed, 0);
});

for (const failure of ['list error', 'missing list', 'remove error', 'remove throw', 'verification error', 'missing verification', 'residue', 'unsafe entry']) {
  test(`independent receiving cleanup retains rows and reports unknown residue on ${failure}`, async () => {
    const h = fixture();
    const folder = `audit/${marker}/receiving`;
    const orphan = `${folder}/crash-orphan.png`;
    h.blobs.add(orphan);
    const originalFrom = h.client.storage.from;
    let lists = 0;
    h.client.storage.from = bucket => {
      const storage = originalFrom(bucket);
      return { ...storage,
        async list(prefix, options) {
          if (bucket !== 'evidence' || prefix !== folder) return storage.list(prefix, options);
          lists++;
          if (failure === 'list error' || (failure === 'verification error' && lists > 1)) return { error: { message: 'list denied' } };
          if (failure === 'missing list' || (failure === 'missing verification' && lists > 1)) return { data: null, error: null };
          if (failure === 'unsafe entry') return { data: [{ id: 'outside', name: '../outside.png' }], error: null };
          return storage.list(prefix, options);
        },
        async remove(paths) {
          if (bucket === 'evidence' && paths.includes(orphan)) {
            if (failure === 'remove error') return { error: { message: 'remove denied' } };
            if (failure === 'remove throw') throw new Error('connection lost');
            if (failure === 'residue') return { error: null };
          }
          return storage.remove(paths);
        },
      };
    };
    const report = await cleanupAndVerifyRun({ runId, viewport, env, client: h.client });
    assert.equal(report.complete, false);
    const storage = report.results.find(result => result.entity === 'storage.evidence:receiving');
    assert.equal(storage.remaining, null);
    assert.ok(storage.error);
    assert.throws(() => cleanupTools.assertZeroResidue(report), /cleanup certification failed/);
    assert.ok(!h.calls.some(call => call.type === 'delete' || call.type === 'rpc'));
    assert.equal(h.tables.get('warehouse.receipts').length, 1);
    assert.equal(h.tables.get('warehouse.procurement_receipt_excess_custody').length, 1);
    assert.equal(h.tables.get('procurement.request_attachments').length, 2);
    h.client.storage.from = originalFrom;
    const retry = await cleanupAndVerifyRun({ runId, viewport, env, client: h.client });
    assert.equal(retry.complete, true);
    assert.equal(h.blobs.has(orphan), false);
  });
}
