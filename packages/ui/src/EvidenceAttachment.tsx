'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './Icon';

export interface EvidenceDocument {
  reference: string;
  filename: string;
  documentId?: string;
  preview?: () => Promise<string>;
}

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const REGISTERED = /^evidence:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function openRegistered(reference: string): Promise<string> {
  const response = await fetch('/api/evidence', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'open', reference }) });
  const result = await response.json();
  if (!response.ok || typeof result.url !== 'string') throw new Error(result.error || 'Evidence access was denied. Try again.');
  return result.url;
}

async function uploadScoped(file: File, scope: { sourceType: string; sourceId: string }): Promise<EvidenceDocument> {
  const body = new FormData();
  body.set('file', file);
  body.set('source_type', scope.sourceType);
  body.set('source_id', scope.sourceId);
  const response = await fetch('/api/evidence', { method: 'POST', credentials: 'same-origin', body });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Evidence upload failed. Try again.');
  if (typeof result.reference !== 'string' || !REGISTERED.test(result.reference)
    || result.reference !== `evidence://${result.document_id}`) throw new Error('The upload did not return registered evidence. Retry the upload.');
  return { reference: result.reference, documentId: result.document_id, filename: file.name,
    preview: () => openRegistered(result.reference) };
}

function linkError(value: string): string {
  if (!value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol === 'https:' && url.hostname && !url.username && !url.password
      && !/\/storage\/v1\/object\/(sign|public)\//i.test(decodeURIComponent(url.pathname))
      && ![...url.searchParams.keys()].some((key) => /^(token|signature|sig|expires|x-amz-.+|x-goog-.+)$/i.test(key))) return '';
  } catch { /* Report invalid links next to the field. */ }
  return 'Enter a secure HTTPS link without credentials or an expiring Storage preview URL.';
}

interface AttachmentState {
  target: string;
  reference: string;
  document?: EvidenceDocument;
  pending: boolean;
  error: string;
  file?: File;
  options?: EvidenceDocument[];
}

export function useEvidenceAttachment(target: string, initialReference = '', initialDocument?: EvidenceDocument) {
  const initial = (): AttachmentState => ({ target, reference: initialReference, pending: false,
    error: REGISTERED.test(initialReference) || initialDocument && !/^https?:/i.test(initialReference) ? '' : linkError(initialReference),
    document: initialDocument ?? (REGISTERED.test(initialReference) ? { reference: initialReference, documentId: initialReference.slice(11),
      filename: 'Registered evidence', preview: () => openRegistered(initialReference) } : undefined) });
  const [, setState] = useState<AttachmentState>(initial);
  const current = useRef(initial());
  const mounted = useRef(true);
  // Replace the operation identity synchronously, including A -> B -> A and close/reopen.
  if (current.current.target !== target) current.current = initial();
  const active = current.current;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const update = (next: AttachmentState) => {
    current.current = next;
    setState(next);
  };
  const clear = () => update({ target, reference: '', pending: false, error: '' });
  const setLink = (reference: string) => update({ target, reference, pending: false, error: linkError(reference) });
  const choose = (document: EvidenceDocument) => update({ target, reference: document.reference, document, pending: false,
    error: !document.reference.trim() || /^https?:/i.test(document.reference) && linkError(document.reference)
      ? 'Choose a durable registered document, not an expiring preview URL.' : '' });
  const upload = async (file: File, send: (file: File) => Promise<EvidenceDocument>) => {
    if (current.current.pending) return;
    const error = !ACCEPT.split(',').includes(file.type)
      ? 'Unsupported file type. Choose JPEG, PNG, WebP or PDF.'
      : file.size <= 0 ? 'The selected file is empty.'
        : file.size > 4 * 1024 * 1024 ? 'File is larger than the 4 MB limit.' : '';
    const operation: AttachmentState = { target, reference: '', pending: !error, error, file };
    update(operation);
    if (error) return;
    try {
      const document = await send(file);
      if (!document.reference.trim()) throw new Error('The upload did not return registered evidence. Retry the upload.');
      if (mounted.current && current.current === operation) choose(document);
    } catch (cause) {
      if (mounted.current && current.current === operation) update({ ...operation, pending: false, error: cause instanceof Error ? cause.message : 'Upload failed. Retry or choose another document.' });
    }
  };
  const loadDocuments = async (load: () => Promise<EvidenceDocument[]>) => {
    if (current.current.pending) return;
    const operation = { ...current.current, pending: true, error: '' };
    update(operation);
    try {
      const options = await load();
      if (mounted.current && current.current === operation) update({ ...operation, pending: false, options });
    } catch (cause) {
      if (mounted.current && current.current === operation) update({ ...operation, pending: false, error: cause instanceof Error ? cause.message : 'Documents could not be loaded. Try again.' });
    }
  };
  return {
    ...active, clear, setLink, choose, upload, loadDocuments,
    canSubmit(required = false) {
      const latest = current.current;
      return latest.target === target && !latest.pending && !latest.error && (!required || Boolean(latest.reference.trim()));
    },
  };
}

export function EvidenceAttachment({ attachment, upload: customUpload, uploadScope, loadDocuments, recordLabel, disabled = false, readOnly = false, unavailableReason, id }: {
  attachment: ReturnType<typeof useEvidenceAttachment>;
  upload?: (file: File) => Promise<EvidenceDocument>;
  uploadScope?: { sourceType: string; sourceId: string };
  loadDocuments?: () => Promise<EvidenceDocument[]>;
  recordLabel: string;
  disabled?: boolean;
  readOnly?: boolean;
  unavailableReason?: string;
  id?: string;
}) {
  const upload = customUpload ?? (uploadScope ? (file: File) => uploadScoped(file, uploadScope) : undefined);
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const [previewError, setPreviewError] = useState('');
  const [previewing, setPreviewing] = useState(false);
  const [previewLink, setPreviewLink] = useState('');
  useEffect(() => {
    if (!previewLink) return;
    const timer = window.setTimeout(() => setPreviewLink(''), 55_000);
    return () => window.clearTimeout(timer);
  }, [previewLink]);
  const previewOperation = useRef<object | null>(null);
  useEffect(() => {
    previewOperation.current = null;
    setPreviewError('');
    setPreviewLink('');
    setPreviewing(false);
    return () => { previewOperation.current = null; };
  }, [attachment.target, attachment.reference]);
  const openPreview = async () => {
    const operation = {};
    previewOperation.current = operation;
    setPreviewing(true);
    setPreviewError('');
    setPreviewLink('');
    try {
      const url = attachment.document?.preview
        ? await attachment.document.preview()
        : attachment.reference;
      // Signed links are resolved on demand, never stored as evidence.
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Evidence preview is unavailable. Try opening it again.');
      if (previewOperation.current === operation) {
        setPreviewLink(url);
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    } catch (cause) {
      if (previewOperation.current === operation) setPreviewError(cause instanceof Error ? cause.message : 'Evidence preview failed. Try again.');
    } finally {
      if (previewOperation.current === operation) setPreviewing(false);
    }
  };
  return <div className="min-w-0 space-y-2" aria-label="Evidence attachment">
    <p className="break-words text-xs text-muted">Evidence for {recordLabel}</p>
    {!readOnly && <div className="flex flex-wrap items-center gap-2">
      {upload && <label className="btn-outline btn-sm relative">
        <Icon name="upload" className="h-4 w-4" /> Upload document
        <input type="file" aria-label="Upload evidence" accept={ACCEPT}
          className="absolute inset-0 w-full cursor-pointer opacity-0"
          disabled={disabled || attachment.pending}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void attachment.upload(file, upload);
          }} />
      </label>}
      {loadDocuments && <button type="button" className="btn-outline btn-sm"
        disabled={disabled || attachment.pending} onClick={() => void attachment.loadDocuments(loadDocuments)}>
        <Icon name="clipboard" className="h-4 w-4" /> Choose registered document
      </button>}
      {(attachment.reference || attachment.file || attachment.error || attachment.pending) && !disabled && <button type="button" className="btn-ghost btn-sm"
        title="Remove evidence" aria-label="Remove evidence" onClick={attachment.clear}>
        <Icon name="trash" className="h-4 w-4" />
      </button>}
    </div>}
    {unavailableReason && <p className="text-xs text-muted">{unavailableReason}</p>}
    {!readOnly && attachment.options && <label className="block text-xs font-semibold text-muted">Registered document
      <select className="input mt-1 w-full" value="" disabled={disabled || attachment.pending}
        onChange={(event) => {
          if (event.target.value === '') return;
          const document = attachment.options?.[Number(event.target.value)];
          if (document) attachment.choose(document);
        }}>
        <option value="">{attachment.options.length ? 'Select a document' : 'No documents available for this record'}</option>
        {attachment.options.map((document, index) => <option key={document.reference} value={index}>{document.filename}</option>)}
      </select>
    </label>}
    {attachment.document ? <div className="flex min-w-0 items-center justify-between gap-2">
      <span className="min-w-0 break-all text-sm text-ink">{attachment.document.filename}</span>
      {attachment.document.preview && <button type="button" className="btn-ghost btn-sm shrink-0" disabled={previewing || Boolean(attachment.error)}
        title="Open evidence" aria-label="Open evidence" onClick={() => void openPreview()}><Icon name="download" className="h-4 w-4" /></button>}
    </div> : readOnly ? <p className="break-all text-sm text-ink">{attachment.reference}</p> : <label htmlFor={inputId} className="block text-xs font-semibold text-muted">Evidence URL (optional secure link)
      <input id={inputId} type="url" aria-label="Evidence URL" className="input mt-1 w-full" value={attachment.reference}
        disabled={disabled || attachment.pending} aria-invalid={Boolean(attachment.error)}
        aria-describedby={attachment.error ? `${inputId}-error` : undefined}
        onChange={(event) => attachment.setLink(event.target.value)} />
    </label>}
    {!attachment.document && attachment.reference && !attachment.error && <button type="button" className="btn-ghost btn-sm"
      disabled={previewing || attachment.pending} title="Open evidence" aria-label="Open evidence" onClick={() => void openPreview()}>
      <Icon name="download" className="h-4 w-4" />
    </button>}
    {attachment.pending && <p role="status" className="text-sm text-muted">{attachment.file ? 'Uploading evidence...' : 'Loading documents...'}</p>}
    {attachment.error && <p id={`${inputId}-error`} role="alert" className="text-sm text-rose-700 dark:text-rose-300">{attachment.error}</p>}
    {attachment.error && attachment.file && upload && <button type="button" className="btn-outline btn-sm"
      disabled={disabled || attachment.pending} onClick={() => void attachment.upload(attachment.file!, upload)}>
      <Icon name="rotate" className="h-4 w-4" /> Retry upload
    </button>}
    {previewLink && <a href={previewLink} target="_blank" rel="noopener noreferrer" className="btn-ghost btn-sm">
      <Icon name="download" className="h-4 w-4" /> Open document
    </a>}
    {previewError && <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{previewError}</p>}
  </div>;
}
