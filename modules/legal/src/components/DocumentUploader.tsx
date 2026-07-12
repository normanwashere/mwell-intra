'use client';

// DocumentUploader — preview build: reads the file with FileReader, stores
// base64 in localStorage via useAccreditationDocs.upload. In the live version
// this will POST to a Storage bucket and pass just the object path to the
// core.register_document RPC.
//
// Guards: MIME whitelist (image/pdf) + 10MB cap, matching the SQL
// core.assert_document_valid function in migration 20260706160000.

import { useState, type ChangeEvent } from 'react';
import { Icon, useToast } from '@intra/ui';
import type { RequirementChecklistItem } from '../types';
import { useAccreditationDocs } from '../localStore';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);
const MAX_BYTES = 10 * 1024 * 1024;

export function DocumentUploader({
  caseId,
  vendorId,
  requirement,
  actorEmail,
  onDone,
}: {
  caseId: string;
  vendorId: string;
  requirement: RequirementChecklistItem;
  actorEmail?: string;
  onDone: (doc: { id: string; filename: string }) => void;
}) {
  const { upload } = useAccreditationDocs();
  const { error } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    setFile(f ?? null);
  }

  async function handleUpload() {
    if (!file) {
      error('Pick a file to upload first.');
      return;
    }
    if (!ALLOWED_MIME.has(file.type)) {
      error(`Unsupported file type (${file.type || 'unknown'}). Allowed: JPEG, PNG, WebP, PDF.`);
      return;
    }
    if (file.size > MAX_BYTES) {
      error(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 10 MB.`);
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      const doc = await upload({
        caseId,
        vendorId,
        requirementId: requirement.id,
        docType: requirement.requirement.toLowerCase().replace(/\s+/g, '_'),
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        dataUrl,
        expiresAt: expiresAt || undefined,
        uploadedByEmail: actorEmail,
      });
      onDone({ id: doc.id, filename: doc.filename });
    } catch (e) {
      error(e instanceof Error ? e.message : 'Could not read the file.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 p-1">
      <div className="rounded-xl border border-dashed border-line bg-inset/50 p-4 text-center">
        <Icon name="plus" className="mx-auto h-6 w-6 text-faint" />
        <p className="mt-2 text-sm font-semibold text-ink">
          {file ? file.name : 'Choose a document'}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          {file
            ? `${(file.size / 1024).toFixed(1)} KB · ${file.type || 'unknown'}`
            : 'JPEG, PNG, WebP or PDF up to 10 MB.'}
        </p>
        <label className="btn-outline btn-sm mt-3 inline-flex cursor-pointer">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="sr-only"
            onChange={onPick}
          />
          <Icon name="clipboard" className="h-4 w-4" />
          Browse…
        </label>
      </div>

      <div>
        <label htmlFor="expiresAt" className="text-xs font-semibold uppercase tracking-wide text-faint">
          Expires on (optional)
        </label>
        <input
          id="expiresAt"
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
          className="input"
        />
        <p className="mt-1 text-xs text-muted">
          We&apos;ll remind you 30 days before this document expires.
        </p>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={() => setFile(null)}
          disabled={busy || !file}
          className="btn-ghost"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={handleUpload}
          disabled={busy || !file}
          className="btn-primary"
        >
          {busy ? 'Uploading…' : 'Upload document'}
        </button>
      </div>
    </div>
  );
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}
