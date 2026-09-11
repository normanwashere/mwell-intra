"use client";

import { useState } from 'react';

export function isGovernedReadinessReference(reference: string): boolean {
  return /^evidence:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference);
}

export function ReadinessEvidenceLink({ reference }: { reference: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isGovernedReadinessReference(reference)) return <span className="break-all">{reference} <span className="text-xs">(Reference only - request the document from Product)</span></span>;
  const open = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/evidence', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'open', reference }),
      });
      const result = await response.json();
      if (!response.ok || typeof result.url !== 'string') throw new Error('Evidence access unavailable. Ask Product to confirm your access, then retry.');
      const url = new URL(result.url);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Evidence preview unavailable.');
      // Same-tab delivery avoids popup blocking; Back restores the source record.
      window.location.assign(url.href);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Evidence could not be opened. Retry.');
    } finally { setPending(false); }
  };
  return <span className="inline-flex flex-col gap-1 break-all">
    <span>{reference}</span>
    <button type="button" className="btn-ghost min-h-11" disabled={pending} onClick={() => void open()}>{pending ? 'Opening evidence...' : 'Open governed evidence'}</button>
    {error && <span role="alert" className="text-rose-700">{error}</span>}
  </span>;
}
