import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPaymentAuditEvidence } from './payment-audit-evidence.mjs';

function harness() {
  const calls = [];
  const po = { id: 'po_partial', request_id: 'req_real_12345678', status: 'issued', core_vendor_id: 'vendor-1', acceptance_evidence_version: 3 };
  const page = {};
  const options = {
    page, purchaseOrderId: po.id, marker: 'CI153_audit', browserUser: { id: 'user-1', role: 'authenticated' },
    async readPurchaseOrderAsBrowserUser(actualPage, id) {
      assert.equal(actualPage, page);
      assert.equal(id, options.purchaseOrderId);
      calls.push({ type: 'read' });
      return po;
    },
    async uploadAsBrowserUser(actualPage, upload) {
      assert.equal(actualPage, page);
      calls.push({ type: 'upload', ...upload });
      return { ok: true, status: 200, body: '{}' };
    },
    async callRpcAsBrowserUser(actualPage, schema, fn, payload) {
      assert.equal(actualPage, page);
      assert.equal(schema, 'procurement');
      assert.equal(fn, 'register_payment_document');
      calls.push({ type: 'rpc', payload });
      return { ok: true, status: 200, body: JSON.stringify({
        ...payload.attachment, request_id: po.request_id,
        payment_po_id: po.id, payment_vendor_id: po.core_vendor_id,
        payment_purpose: payload.purpose, payment_evidence_version: po.acceptance_evidence_version,
        uploaded_by: 'user-1',
      }) };
    },
  };
  return { options, calls, po };
}

test('uploads actual PDF bytes before registration and returns document IDs, not paths', async () => {
  const { options, calls, po } = harness();
  const result = await createPaymentAuditEvidence(options);
  assert.deepEqual(calls.map(call => call.type), ['read', 'upload', 'rpc', 'upload', 'rpc', 'upload', 'rpc']);
  assert.equal(result.requestId, po.request_id);
  assert.equal(result.evidenceVersion, 3);
  assert.deepEqual(Object.values(result.references), result.documents.map(doc => doc.id));
  assert.deepEqual(Object.keys(result.references), ['invoice_or_si_storage_path', 'milestone_support_storage_path', 'tax_withholding_support_storage_path']);
  assert.deepEqual(result.cleanup.documentIds, result.documents.map(doc => doc.id));
  assert.deepEqual(result.cleanup.storagePaths, result.documents.map(doc => doc.storage_path));
  assert.equal(result.cleanup.bucket, 'procurement-requests');
  for (const upload of calls.filter(call => call.type === 'upload')) {
    assert.equal(upload.bucket, result.cleanup.bucket);
    assert.equal(upload.upsert, false);
    assert.equal(upload.contentType, 'application/pdf');
    assert.ok(upload.path.startsWith(`request/${po.request_id}/att_`));
    const doc = result.documents.find(row => row.storage_path === upload.path);
    assert.equal(doc.size_bytes, upload.bytes.length);
    assert.equal(doc.sha256, createHash('sha256').update(upload.bytes).digest('hex'));
    const pdf = upload.bytes.toString();
    assert.ok(pdf.startsWith('%PDF-1.4\n'));
    assert.match(pdf, /QA ONLY - CI153_audit/);
    const xref = Number(pdf.match(/startxref\n(\d+)/)[1]);
    assert.equal(pdf.slice(xref, xref + 4), 'xref');
    const offsets = pdf.slice(xref).match(/\d{10} 00000 n /g);
    offsets.forEach((offset, index) => assert.ok(pdf.slice(Number(offset.slice(0, 10))).startsWith(`${index + 1} 0 obj`)));
  }
});

test('foreign evidence is opt-in and repeated invocations have disjoint cleanup paths', async () => {
  const { options } = harness();
  const first = await createPaymentAuditEvidence({ ...options, includeForeign: true });
  const second = await createPaymentAuditEvidence(options);
  assert.equal(first.documents.length, 4);
  assert.equal(first.references.foreign_vendor_evidence_storage_path, first.documents[3].id);
  assert.ok(second.cleanup.storagePaths.every(path => !first.cleanup.storagePaths.includes(path)));
});

for (const [label, change] of [
  ['missing PO', h => { h.options.readPurchaseOrderAsBrowserUser = async () => null; }],
  ['wrong PO', h => { h.po.id = 'po_other'; }],
  ['unissued PO', h => { h.po.status = 'draft'; }],
  ['fabricated request path', h => { h.po.request_id = 'audit/CI153'; }],
  ['missing vendor', h => { h.po.core_vendor_id = null; }],
  ['missing version', h => { delete h.po.acceptance_evidence_version; }],
  ['service role', h => { h.options.browserUser.role = 'service_role'; }],
  ['missing browser user', h => { h.options.browserUser = null; }],
  ['unsafe marker', h => { h.options.marker = '../CI153'; }],
]) {
  test(`rejects ${label} before uploading`, async () => {
    const h = harness();
    change(h);
    await assert.rejects(createPaymentAuditEvidence(h.options), error => {
      assert.deepEqual(error.cleanup, { bucket: 'procurement-requests', storagePaths: [], documentIds: [] });
      return true;
    });
    assert.equal(h.calls.filter(call => call.type === 'upload').length, 0);
  });
}

for (const field of ['uploaded_by', 'request_id', 'payment_po_id', 'payment_vendor_id', 'payment_purpose', 'payment_evidence_version', 'storage_path', 'id', 'sha256', 'size_bytes', 'mime_type', 'filename']) {
  test(`rejects registration with mismatched ${field} and preserves exact cleanup`, async () => {
    const { options, calls } = harness();
    const rpc = options.callRpcAsBrowserUser;
    options.callRpcAsBrowserUser = async (...args) => {
      const result = await rpc(...args);
      const body = JSON.parse(result.body);
      body[field] = 'wrong';
      return { ...result, body: JSON.stringify(body) };
    };
    await assert.rejects(createPaymentAuditEvidence(options), error => {
      assert.match(error.message, /does not match/);
      assert.deepEqual(error.cleanup.storagePaths, calls.filter(call => call.type === 'upload').map(call => call.path));
      assert.deepEqual(error.cleanup.documentIds, calls.filter(call => call.type === 'rpc').map(call => call.payload.attachment.id));
      return true;
    });
    assert.equal(calls.filter(call => call.type === 'upload').length, 1);
  });
}

for (const stage of ['upload rejection', 'upload transport', 'rpc rejection', 'rpc transport', 'malformed registration']) {
  test(`${stage} on second document retains completed and uncertain writes`, async () => {
    const { options, calls } = harness();
    const key = stage.startsWith('upload') ? 'uploadAsBrowserUser' : 'callRpcAsBrowserUser';
    const original = options[key];
    let count = 0;
    options[key] = async (...args) => {
      const result = await original(...args);
      if (++count === 2) {
        if (stage.includes('transport')) throw new Error('Connection lost');
        if (stage.includes('malformed')) return { ok: true, body: 'not-json' };
        return { ok: false, status: 403, body: 'RLS denied' };
      }
      return result;
    };
    await assert.rejects(createPaymentAuditEvidence(options), error => {
      assert.equal(error.cleanup.storagePaths.length, 2);
      assert.deepEqual(error.cleanup.storagePaths, calls.filter(call => call.type === 'upload').map(call => call.path));
      assert.deepEqual(error.cleanup.documentIds, calls.filter(call => call.type === 'rpc').map(call => call.payload.attachment.id));
      return true;
    });
  });
}
