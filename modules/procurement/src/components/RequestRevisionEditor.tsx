'use client';

import { useState } from 'react';
import { useSession } from '@intra/auth';
import type { ProcurementRequest, RequestAttachment } from '../types';
import { attachmentMetadataForRpc, uploadRequestAttachments } from '../attachments';
import { useProcurementVendors } from '../localStore';

export function RequestRevisionEditor({ request, onSaved }: { request: ProcurementRequest; onSaved: () => Promise<void> }) {
  const { supabaseClient, mode, profile } = useSession();
  const vendors = useProcurementVendors();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(request.title);
  const [need, setNeed] = useState(request.justification?.need ?? '');
  const [vendorId, setVendorId] = useState(request.vendorId ?? '');
  const [lines, setLines] = useState(request.lines);
  const [kind, setKind] = useState<RequestAttachment['kind']>('spec');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  async function save() {
    if (!supabaseClient || mode !== 'supabase') { setMessage('Versioned editing requires the live draft service.'); return; }
    setBusy(true);
    try {
      const attachments = await uploadRequestAttachments(supabaseClient, request.id, files.map(file => ({ file, filename: file.name, mimeType: file.type, sizeBytes: file.size, kind, uploadedByEmail: profile?.email })));
      const { error } = await supabaseClient.schema('procurement').rpc('revise_request', { payload: {
        id: request.id, expected_revision: request.revision ?? 0, title, lines,
        vendor_id: vendorId || null, justification: { ...request.justification, need },
        attachments: attachments.map(attachmentMetadataForRpc),
      } });
      if (error) throw new Error(error.message);
      setFiles([]); setOpen(false); setMessage('Revision saved. Procurement must reconfirm the route before submission.');
      await onSaved();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : 'Revision could not be saved.'); }
    finally { setBusy(false); }
  }
  return <section className="space-y-3">
    <button type="button" className="btn-outline" onClick={() => setOpen(!open)}>{request.status === 'rejected' ? 'Revise rejected request' : 'Edit draft / add evidence'}</button>
    {message && <p role="status" className="text-sm [overflow-wrap:anywhere]">{message}</p>}
    {open && <div className="space-y-3">
      <label className="block text-sm">Title<input className="input" value={title} onChange={e => setTitle(e.target.value)} /></label>
      <label className="block text-sm">Business need<textarea className="input" value={need} onChange={e => setNeed(e.target.value)} /></label>
      <label className="block text-sm">Vendor<select className="input" value={vendorId} onChange={e => setVendorId(e.target.value)}><option value="">Not selected</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.legalName}</option>)}</select></label>
      {lines.map((line, i) => <div key={line.id} className="grid min-w-0 gap-2 sm:grid-cols-3">
        <label className="text-sm">Line {i + 1}<input className="input" value={line.description} onChange={e => setLines(lines.map((l, n) => n === i ? { ...l, description: e.target.value } : l))} /></label>
        <label className="text-sm">Quantity<input type="number" min="1" step="1" className="input" value={line.quantity} onChange={e => setLines(lines.map((l, n) => n === i ? { ...l, quantity: Number(e.target.value) } : l))} /></label>
        <label className="text-sm">Unit price<input type="number" min="0" className="input" value={line.unitPrice ?? ''} onChange={e => setLines(lines.map((l, n) => n === i ? { ...l, unitPrice: Number(e.target.value) } : l))} /></label>
      </div>)}
      <label className="block text-sm">Evidence type<select className="input" value={kind} onChange={e => setKind(e.target.value as RequestAttachment['kind'])}>{['budget','previous_cost','spec','quote','award_recommendation','justification','bond','brochure','other'].map(k => <option key={k} value={k}>{k.replaceAll('_', ' ')}</option>)}</select></label>
      <label className="block text-sm">Add evidence<input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" className="block w-full text-sm" onChange={e => setFiles(Array.from(e.target.files ?? []))} /></label>
      <button type="button" disabled={busy || !title.trim() || !need.trim()} className="btn-primary" onClick={() => void save()}>{busy ? 'Saving...' : 'Save revision'}</button>
    </div>}
  </section>;
}
