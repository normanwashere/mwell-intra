'use client';

import { useEffect, useState } from 'react';
import { money } from '@intra/ui';
import type { CloseSource, CloseEvidenceOption, SearchCloseSources, LoadCloseEvidence } from '../sourceSelection';
import type { FinanceCloseEntry } from '../types';

export function ReceiptSourceView({ id, searchSources, loadEvidenceOptions, entries, openEvidence }: {
  id: string; searchSources?: SearchCloseSources; loadEvidenceOptions?: LoadCloseEvidence;
  entries: FinanceCloseEntry[]; openEvidence: (entry: FinanceCloseEntry) => Promise<string>;
}) {
  const [source, setSource] = useState<CloseSource>();
  const [options, setOptions] = useState<CloseEvidenceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [preview, setPreview] = useState('');
  const [opening, setOpening] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setSource(undefined); setOptions([]); setError(''); setPreview('');
    void (async () => {
      if (!searchSources) throw new Error('Receipt source lookup is unavailable.');
      const rows = await searchSources('', 'warehouse_receipt', id);
      const receipt = rows.find(row => row.type === 'warehouse_receipt' && row.id === id);
      if (!receipt) throw new Error('This receipt is not available in your scope.');
      const evidence = await loadEvidenceOptions?.('warehouse_receipt', id) ?? [];
      if (active) { setSource(receipt); setOptions(evidence); }
    })().catch(() => { if (active) setError('Receipt evidence is unavailable or outside your scope. Please retry.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, searchSources, loadEvidenceOptions, attempt]);
  useEffect(() => { if (!preview) return; const timer = setTimeout(() => setPreview(''), 240000); return () => clearTimeout(timer); }, [preview]);
  const linked = entries.filter(entry => entry.sourceRecordType === 'warehouse_receipt' && entry.sourceRecordId === id);
  return <section className="space-y-4" aria-label="Read-only receipt source">
    <a className="btn-outline" href={`/finance?${new URLSearchParams({ close_source_type: 'warehouse_receipt', close_source_id: id })}`}>Back to close draft</a>
    <h1 className="text-xl font-semibold">Receipt evidence</h1>
    {loading ? <p role="status" aria-busy="true">Loading receipt evidence...</p> : error ? <div role="alert"><p>{error}</p><button className="btn-outline" type="button" onClick={() => setAttempt(value => value + 1)}>Retry receipt</button></div> : source && <>
      <dl className="grid gap-3 border-y border-line py-4 sm:grid-cols-2">
        <div><dt className="text-sm text-muted">Receipt</dt><dd className="font-semibold break-words">{source.reference}</dd></div>
        <div><dt className="text-sm text-muted">Source identity</dt><dd className="break-all">{source.id}</dd></div>
        <div><dt className="text-sm text-muted">Party</dt><dd>{source.party ?? 'Not recorded'}</dd></div>
        <div><dt className="text-sm text-muted">Recorded on</dt><dd>{source.occurred_at.slice(0, 10)}</dd></div>
        <div><dt className="text-sm text-muted">Amount</dt><dd>{source.amount == null ? 'Not recorded' : money(source.amount)}</dd></div>
      </dl>
      <h2 className="text-base font-semibold">Registered evidence</h2>
      {options.length ? <ul className="space-y-2">{options.map(option => <li key={option.id}>{option.label}</li>)}</ul> : <p>No registered evidence is available for this receipt.</p>}
      {linked.map(entry => <button key={entry.id} className="btn-outline" type="button" disabled={opening} onClick={async () => {
        setOpening(true); setError(''); setPreview('');
        try { setPreview(await openEvidence(entry)); } catch { setError('Protected evidence could not be opened. Please retry.'); } finally { setOpening(false); }
      }}>Open protected evidence for {entry.sourceReference}</button>)}
      {preview && <a href={preview} target="_blank" rel="noopener noreferrer" className="btn-outline">View protected evidence</a>}
      <p className="text-sm text-muted">Warehouse owns receiving, inspection and corrections. For receipt-line or quality details beyond this Finance source summary, request the receipt pack from Warehouse with reference {source.reference}.</p>
    </>}
  </section>;
}
