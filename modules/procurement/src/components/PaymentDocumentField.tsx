'use client';
import { useState } from 'react';
import { useSession } from '@intra/auth';
import { attachmentMetadataForRpc, createGovernedAttachmentUrl, uploadRequestAttachments, type GovernedAccessClient } from '../attachments';

export type PaymentDocument = { id: string; filename: string; purpose: string };
export function PaymentDocumentLink({ document }: { document: PaymentDocument }) {
  const { supabaseClient } = useSession();
  const [error, setError] = useState('');
  return <div className="text-sm [overflow-wrap:anywhere]"><button type="button" className="btn-outline btn-sm max-w-full whitespace-normal" onClick={async () => {
    if (!supabaseClient) return;
    try {
      const link = await createGovernedAttachmentUrl(supabaseClient as unknown as GovernedAccessClient, document.id);
      window.open(link.url, '_blank', 'noopener,noreferrer');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Document unavailable'); }
  }}>Open {document.purpose}: {document.filename}</button>{error && <p role="alert">{error}</p>}</div>;
}
export function PaymentDocumentField({ label, purpose, value, documents, poId, requestId, onChange, refresh }: {
  label: string; purpose: string; value: string; documents: PaymentDocument[];
  poId: string; requestId: string; onChange: (value: string) => void; refresh: () => Promise<void>;
}) {
  const { supabaseClient } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function upload(file?: File) {
    if (!file || !supabaseClient) return;
    setBusy(true); setError('');
    try {
      const [attachment] = await uploadRequestAttachments(supabaseClient, requestId, [{ file, filename: file.name, mimeType: file.type, sizeBytes: file.size, kind: 'other' }]);
      const result = await supabaseClient.schema('procurement').rpc('register_payment_document', { payload: { purchase_order_id: poId, purpose, attachment: attachmentMetadataForRpc(attachment!) } });
      if (result.error) throw new Error(result.error.message);
      await refresh(); onChange(result.data.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Upload failed'); }
    finally { setBusy(false); }
  }
  async function open() {
    if (!supabaseClient) return;
    try {
      const link = await createGovernedAttachmentUrl(supabaseClient as unknown as GovernedAccessClient, value);
      const a = document.createElement('a'); a.href = link.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.click();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Document unavailable'); }
  }
  return <div className="space-y-2">
    <label className="block text-sm font-semibold">{label}<select className="input mt-1" value={value} onChange={e => onChange(e.target.value)}><option value="">Select uploaded evidence</option>{documents.filter(d => d.purpose === purpose).map(d => <option key={d.id} value={d.id}>{d.filename}</option>)}</select></label>
    <div className="flex min-w-0 flex-wrap items-center gap-2"><input aria-label={`Upload ${label}`} type="file" accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy} className="w-full min-w-0 text-sm sm:w-auto" onChange={e => void upload(e.target.files?.[0])} /><button type="button" className="btn-outline btn-sm" disabled={!value || busy} onClick={() => void open()}>Open document</button></div>
    {error && <p role="alert" className="text-sm text-rose-700 [overflow-wrap:anywhere]">{error}</p>}
  </div>;
}
