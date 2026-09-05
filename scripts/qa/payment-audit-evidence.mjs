import { createHash, randomUUID } from 'node:crypto';

const bucket = 'procurement-requests';
const fields = {
  invoice: 'invoice_or_si_storage_path',
  acceptance: 'milestone_support_storage_path',
  tax: 'tax_withholding_support_storage_path',
  foreign: 'foreign_vendor_evidence_storage_path',
};

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

// A real, readable PDF explicitly identifying this as synthetic QA evidence.
export function evidencePdf(marker, purpose, poId) {
  const label = `QA ONLY - ${marker} - ${purpose} - ${poId}`
    .replace(/[^\x20-\x7e]/g, '_').replace(/[\\()]/g, '\\$&');
  const stream = `BT /F1 10 Tf 24 740 Td (${label}) Tj ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

/**
 * No auth discovery or service client: all callbacks MUST use the same current
 * browser user's JWT and public anon key. browserUser is the verified session
 * { id, role: 'authenticated' }, not a service principal.
 * readPurchaseOrderAsBrowserUser(page, id) returns the actual DB row with
 * id, request_id, status, core_vendor_id, acceptance_evidence_version.
 * uploadAsBrowserUser(page, {bucket,path,bytes,contentType,upsert}) performs a
 * Storage upload, returning {ok,status,body}; no signed/service-key upload.
 * callRpcAsBrowserUser uses the parent's (page,schema,fn,payload) contract.
 *
 * Persist cleanup on success OR error.cleanup. Attempted paths are recorded
 * before I/O because a transport failure may follow a committed write. Remove
 * registered attachment rows before objects (owner DELETE RLS excludes them).
 * This helper never deletes anything and does not clean payment_readiness_packs
 * or vendor_invoice_identities: the parent must handle those dependencies.
 */
export async function createPaymentAuditEvidence({
  page, purchaseOrderId, marker, browserUser,
  readPurchaseOrderAsBrowserUser, uploadAsBrowserUser, callRpcAsBrowserUser,
  includeForeign = false,
}) {
  const cleanup = { bucket, storagePaths: [], documentIds: [] };
  try {
    requireValue(browserUser?.role === 'authenticated' && browserUser.id,
      'A verified authenticated browser user is required; service-role uploads are forbidden');
    requireValue(typeof purchaseOrderId === 'string' && purchaseOrderId.length > 0, 'Purchase order ID required');
    requireValue(typeof marker === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(marker), 'Safe nonempty QA marker required');
    for (const fn of [readPurchaseOrderAsBrowserUser, uploadAsBrowserUser, callRpcAsBrowserUser]) {
      requireValue(typeof fn === 'function', 'Browser-user read, upload and RPC callbacks required');
    }
    const po = await readPurchaseOrderAsBrowserUser(page, purchaseOrderId);
    requireValue(po?.id === purchaseOrderId && ['issued', 'closed'].includes(po.status),
      `Actual issued or fully received purchase order required (expected id=${purchaseOrderId}, received id=${po?.id ?? 'missing'}, status=${po?.status ?? 'missing'})`);
    requireValue(typeof po.request_id === 'string' && /^req_[A-Za-z0-9_-]{8,}$/.test(po.request_id), 'PO must have a real storage-compatible request_id');
    requireValue(typeof po.core_vendor_id === 'string' && po.core_vendor_id.length > 0, 'Vendor-bound purchase order required');
    requireValue(Number.isSafeInteger(po.acceptance_evidence_version) && po.acceptance_evidence_version >= 0, 'PO acceptance evidence version required');
    const references = {};
    const documents = [];
    for (const purpose of includeForeign ? Object.keys(fields) : ['invoice', 'acceptance', 'tax']) {
      const id = `att_${randomUUID().replaceAll('-', '')}`;
      const filename = `${marker}-${purpose}.pdf`;
      const path = `request/${po.request_id}/${id}-${filename}`;
      const bytes = evidencePdf(marker, purpose, purchaseOrderId);
      const attachment = {
        id, filename, mime_type: 'application/pdf', size_bytes: bytes.length,
        storage_path: path, sha256: createHash('sha256').update(bytes).digest('hex'), kind: 'other',
      };
      cleanup.storagePaths.push(path);
      const uploaded = await uploadAsBrowserUser(page, {
        bucket, path, bytes, contentType: attachment.mime_type, upsert: false,
      });
      requireValue(uploaded?.ok === true, `Payment evidence upload failed (${uploaded?.status}): ${uploaded?.body ?? ''}`);
      // Include the exact attempted ID even if the registration response is lost.
      cleanup.documentIds.push(id);
      const result = await callRpcAsBrowserUser(page, 'procurement', 'register_payment_document', {
        purchase_order_id: purchaseOrderId, purpose, attachment,
      });
      requireValue(result?.ok === true, `Payment document registration failed (${result?.status}): ${result?.body ?? ''}`);
      const document = JSON.parse(result.body);
      requireValue(document?.id === id && document.request_id === po.request_id &&
        document.payment_po_id === purchaseOrderId && document.payment_vendor_id === po.core_vendor_id &&
        document.payment_purpose === purpose && document.payment_evidence_version === po.acceptance_evidence_version &&
        document.uploaded_by === browserUser.id && document.storage_path === path &&
        document.sha256 === attachment.sha256 && document.filename === filename &&
        document.mime_type === attachment.mime_type && Number(document.size_bytes) === bytes.length,
      'Registered payment evidence does not match PO, upload owner, metadata or evidence version');
      references[fields[purpose]] = document.id;
      documents.push(document);
    }
    return { references, documents, cleanup, requestId: po.request_id, evidenceVersion: po.acceptance_evidence_version };
  } catch (cause) {
    const error = new Error(`Payment audit evidence: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    error.cleanup = cleanup;
    throw error;
  }
}
