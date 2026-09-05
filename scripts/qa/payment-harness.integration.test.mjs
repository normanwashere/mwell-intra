import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createPaymentAuditEvidence, evidencePdf } from './payment-audit-evidence.mjs';

const source = readFileSync(new URL('./full-intra-live-e2e.mjs', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const cleanupSource = readFileSync(new URL('./cleanup-uat-live-run.mjs', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
// Exercise actual parent-owned-file functions without executing the live CLI.
function loadFunction(name, next, dependencies) {
  const start = source.indexOf(`async function ${name}(`);
  const end = source.indexOf(`async function ${next}(`, start);
  assert.ok(start >= 0 && end > start);
  return new Function(...Object.keys(dependencies), `${source.slice(start, end)}\nreturn ${name};`)(...Object.values(dependencies));
}
function adapterFixture() {
  const page = {};
  const fixture = { marker: 'QA-20260905-00003C1F-desktop-1440' };
  const po = { id: 'po-1', status: 'issued', request_id: `req_${fixture.marker}-receipt-request`, core_vendor_id: 'vendor-1', acceptance_evidence_version: 4 };
  const calls = [];
  const dependencies = {
    createPaymentAuditEvidence,
    browserAccessToken: async actualPage => { assert.equal(actualPage, page); return 'browser-jwt'; },
    process: { env: { NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-key', NEXT_PUBLIC_SUPABASE_URL: 'https://mock.invalid/', SUPABASE_SERVICE_ROLE_KEY: 'must-never-be-used' } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      assert.equal(options.headers.apikey, 'public-key');
      assert.equal(options.headers.authorization, 'Bearer browser-jwt');
      if (url.endsWith('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'user-1', role: 'authenticated' }) };
      if (url.includes('/rest/v1/purchase_orders?')) return { ok: true, json: async () => [po] };
      assert.ok(url.startsWith('https://mock.invalid/storage/v1/object/procurement-requests/request/req_'));
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['x-upsert'], 'false');
      assert.equal(options.headers['content-type'], 'application/pdf');
      assert.ok(Buffer.isBuffer(options.body));
      assert.ok(options.body.toString().startsWith('%PDF-1.4'));
      return { ok: true, status: 200, text: async () => '{}' };
    },
    callRpcAsBrowserUser: async (actualPage, schema, fn, payload) => {
      assert.equal(actualPage, page);
      assert.equal(schema, 'procurement');
      assert.equal(fn, 'register_payment_document');
      calls.push({ rpc: payload });
      return { ok: true, status: 200, body: JSON.stringify({ ...payload.attachment, request_id: po.request_id,
        payment_po_id: po.id, payment_vendor_id: po.core_vendor_id, payment_evidence_version: po.acceptance_evidence_version,
        uploaded_by: 'user-1', payment_purpose: payload.purpose }) };
    },
  };
  return { dependencies, page, fixture, po, calls, run() {
    return loadFunction('task3UploadPaymentEvidence', 'task3PaymentReadinessWithoutAcceptance', dependencies)(page, fixture, po.id);
  } };
}

test('actual integration verifies auth endpoint before browser PO read, upload and RPC; persists exact cleanup', async () => {
  const h = adapterFixture();
  const references = await h.run();
  assert.ok(h.calls[0].url.endsWith('/auth/v1/user'));
  assert.equal(Object.keys(references).length, 3);
  assert.deepEqual(Object.values(references), h.fixture.paymentEvidenceCleanup[0].documentIds);
  assert.deepEqual(h.fixture.paymentEvidenceCleanup[0].storagePaths,
    h.calls.filter(call => call.rpc).map(call => call.rpc.attachment.storage_path));
});

test('browser adapter preserves a fully received closed PO and registers actual evidence', async () => {
  const h = adapterFixture();
  h.po.status = 'closed';
  const references = await h.run();
  assert.equal(Object.keys(references).length, 3);
  assert.equal(h.calls.filter(call => call.rpc).length, 3);
});

for (const failure of ['expired user', 'service role', 'missing token', 'changed session', 'hidden PO', 'upload RLS', 'registration RLS']) {
  test(`actual browser adapter fails closed on ${failure}`, async () => {
    const h = adapterFixture();
    const fetch = h.dependencies.fetch;
    h.dependencies.fetch = async (url, options) => {
      if (failure === 'expired user' && url.endsWith('/auth/v1/user')) return { ok: false, status: 401 };
      if (failure === 'service role' && url.endsWith('/auth/v1/user')) return { ok: true, json: async () => ({ id: 'service', role: 'service_role' }) };
      if (failure === 'hidden PO' && url.includes('/rest/v1/')) return { ok: true, json: async () => [] };
      if (failure === 'upload RLS' && url.includes('/storage/')) return { ok: false, status: 403, text: async () => 'RLS denied' };
      return fetch(url, options);
    };
    if (failure === 'missing token') h.dependencies.browserAccessToken = async () => null;
    if (failure === 'changed session') {
      let count = 0;
      h.dependencies.browserAccessToken = async () => ++count === 1 ? 'browser-jwt' : 'other-jwt';
    }
    if (failure === 'registration RLS') h.dependencies.callRpcAsBrowserUser = async () => ({ ok: false, status: 403, body: 'not owned' });
    await assert.rejects(h.run());
    if (failure === 'upload RLS' || failure === 'registration RLS') assert.equal(h.fixture.paymentEvidenceCleanup[0].storagePaths.length, 1);
    else assert.equal(h.calls.filter(call => call.options?.method === 'POST').length, 0);
  });
}

test('no-acceptance probe supplies real IDs and rejects unrelated errors, including malformed data', async () => {
  const references = { invoice_or_si_storage_path: 'invoice-id', milestone_support_storage_path: 'acceptance-id', tax_withholding_support_storage_path: 'tax-id' };
  for (const body of ['Receipt or acceptance evidence is required', 'invalid input syntax', 'foreign key violation', 'Private uploaded evidence not found or not owned']) {
    const fixture = { marker: 'marker', ids: { cleanPo: 'clean-po' } };
    const fn = loadFunction('task3PaymentReadinessWithoutAcceptance', 'task3GoodsAcceptance', {
      task3UploadPaymentEvidence: async (_page, actualFixture, poId) => { assert.equal(actualFixture, fixture); assert.equal(poId, 'clean-po'); return references; },
      callRpcAsBrowserUser: async (_page, schema, name, payload) => {
        assert.equal(schema, 'procurement'); assert.equal(name, 'prepare_payment_readiness');
        for (const [field, id] of Object.entries(references)) assert.equal(payload[field], id);
        assert.equal(payload.acceptance_pack_id, undefined);
        assert.ok(payload.invoice_number && payload.invoice_date && payload.invoice_amount > 0);
        return { ok: false, body };
      },
      requireRpcFailure: (result, pattern) => { assert.equal(result.ok, false); assert.match(result.body, pattern); },
    });
    if (body.startsWith('Receipt')) assert.equal((await fn({}, fixture)).ok, true);
    else await assert.rejects(fn({}, fixture));
  }
});

test('cumulative payment binds uploaded IDs to the real partial PO and retains acceptance assertions', async () => {
  for (const acceptedQuantity of [3, 2]) {
    const fixture = { marker: 'marker', ids: { partialPo: 'partial-po' }, cumulativeAcceptancePackIds: ['b', 'a'], client: {} };
    let checkpoint = false;
    const fn = loadFunction('task3CumulativePaymentAcceptanceBinding', 'task3InvalidateReadinessWithAcceptanceChange', {
      task3UploadPaymentEvidence: async (_page, actualFixture, id) => {
        assert.equal(actualFixture, fixture); assert.equal(id, 'partial-po');
        return { invoice_or_si_storage_path: 'uploaded-invoice-id', milestone_support_storage_path: 'uploaded-acceptance-id', tax_withholding_support_storage_path: 'uploaded-tax-id' };
      },
      callRpcAsBrowserUser: async (_page, schema, name, payload) => {
        assert.equal(schema, 'procurement'); assert.equal(name, 'prepare_payment_readiness');
        assert.equal(payload.purchase_order_id, 'partial-po');
        assert.equal(payload.invoice_or_si_storage_path, 'uploaded-invoice-id');
        assert.equal(payload.milestone_support_storage_path, 'uploaded-acceptance-id');
        assert.equal(payload.tax_withholding_support_storage_path, 'uploaded-tax-id');
        assert.equal(payload.invoice_amount, 300);
        return { ok: true, body: JSON.stringify({ id: 'pack', acceptance_pack_ids: ['a', 'b'], accepted_quantity: acceptedQuantity }) };
      },
      verifyCheckpoint: async (spec, client) => { assert.equal(client, fixture.client); assert.equal(spec.expected.accepted_quantity, 3); checkpoint = true; },
    });
    if (acceptedQuantity === 3) { assert.equal((await fn({}, fixture)).ok, true); assert.equal(checkpoint, true); }
    else { await assert.rejects(fn({}, fixture), /binding mismatch/); assert.equal(checkpoint, false); }
  }
});

test('draft PDFs use exported generator with real xref and safe string escaping', () => {
  const pdf = evidencePdf('QA-test', 'quote (QA)', 'request\\id').toString();
  assert.match(pdf, /quote \\\(QA\\\)/);
  assert.match(pdf, /request\\\\id/);
  assert.ok(pdf.endsWith('%%EOF\n'));
  assert.equal((source.match(/buffer: evidencePdf\(marker,/g) ?? []).length, 4);
  assert.doesNotMatch(source, /Buffer\.from\("UAT (technical|approved|previous|vendor)/);
  assert.match(source, /request: `req_\$\{marker\}-receipt-request`/);
  assert.match(source, /title: `\$\{marker\} Receipt authority request`/);
});

test('both cleanup paths order exact evidence discovery and storage before rows and identities before packs', () => {
  const narrow = source.slice(source.indexOf('async function cleanupTask3ReceiptFixture('), source.indexOf('async function cleanupGovernedWorkflowActivity('));
  assert.ok(narrow.indexOf('await cleanupExcessCustodyStorage') < narrow.indexOf('await remove("warehouse", "procurement_receipt_excess_custody"'));
  assert.ok(narrow.indexOf('await cleanupCertificationRequestEvidence') < narrow.indexOf('await remove("procurement", "request_attachments"'));
  assert.match(source, /cleanupRun\(auditRunId, requestEvidenceGate\.targets,/);
  assert.match(source, /cleanup\.complete &&\s+requestEvidenceGate\.complete &&/);
  assert.ok(narrow.indexOf('await remove("procurement", "vendor_invoice_identities"') < narrow.indexOf('await remove("procurement", "payment_readiness_packs"'));
  assert.ok(narrow.indexOf('await remove("procurement", "request_attachments"') < narrow.indexOf('await remove("procurement", "purchase_orders"'));
  assert.match(narrow, /\.rpc\("cleanup_certification_requests", \{ p_marker: marker \}\)/);
  assert.match(cleanupSource, /query\.eq\("id", `req_\$\{scope.marker\}-receipt-request`\)/);
  assert.match(cleanupSource, /query\.like\("id", `\$\{scope.marker\}-%`\)/);
  assert.ok(cleanupSource.indexOf('results.push(await cleanupExcessCustodyStorage') < cleanupSource.indexOf('await removeWhen(\n    decisionIds,'));
  assert.ok(cleanupSource.indexOf('await removeWhen(paymentPackIds, "procurement", "vendor_invoice_identities"') < cleanupSource.indexOf('"payment_readiness_packs",\n    "purchase_order_id"'));
  assert.doesNotMatch(cleanupSource, /schema\(["']storage["']\)/);
});
