import { useEffect, useRef, useState } from 'react';
import { Badge, Field, ProductSelect, Sheet } from '@/components/ui';
import { EvidenceGallery } from './EvidenceGallery';
import { EvidenceCapture } from './camera/EvidenceCapture';

export interface ReceiptExceptionDecisionItem {
  decisionId: string;
  receiptId: string;
  purchaseOrderId: string;
  poNumber: string;
  requestedDisposition: 'short' | 'excess' | 'damaged' | 'unidentified';
  status?: 'pending' | 'escalated';
  requestedBy: string;
  requestedAt: string;
  reason: string;
  evidenceUrls?: string[];
  lines: Array<{
    poLineId: string;
    productId?: string;
    actualQuantity: number;
    expectedQuantity: number;
    rawDescription: string;
  }>;
}

export interface ReceiptExceptionDecisionInput {
  decisionId: string;
  decision: 'accept' | 'reject' | 'quarantine' | 'escalate';
  reason: string;
  evidenceUrls: string[];
  identifications?: Array<{ poLineId: string; productId: string }>;
}

interface ReceiptExceptionDecisionPanelProps {
  items: ReceiptExceptionDecisionItem[];
  reviewerId?: string;
  receiptId?: string | null;
  loadEvidence?: (receiptId: string) => Promise<string[]>;
  products?: Array<{ id: string; name: string; sku: string }>;
  onDecision: (input: ReceiptExceptionDecisionInput) => Promise<boolean>;
}

export function ReceiptExceptionDecisionPanel({ items, reviewerId, receiptId, loadEvidence, products = [], onDecision }: ReceiptExceptionDecisionPanelProps) {
  const [selected, setSelected] = useState<ReceiptExceptionDecisionItem | null>(null);
  const [reason, setReason] = useState('');
  const [existingEvidence, setExistingEvidence] = useState<string[]>([]);
  const [evidence, setEvidence] = useState<string[]>([]);
  const [uploads, setUploads] = useState<string[]>([]);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [error, setError] = useState('');
  const [identifications, setIdentifications] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const openedReceipt = useRef<string | null>(null);
  const evidenceLoader = useRef(loadEvidence);
  evidenceLoader.current = loadEvidence;
  const visibleItems = receiptId ? items.filter(item => item.receiptId === receiptId) : items;

  useEffect(() => {
    if (submitting || evidenceBusy) return;
    if (!receiptId) { openedReceipt.current = null; return; }
    const matching = items.filter(item => item.receiptId === receiptId);
    if (matching.length === 1 && openedReceipt.current !== receiptId) {
      openedReceipt.current = receiptId;
      setSelected(matching[0]!);
    }
  }, [items, receiptId, submitting, evidenceBusy]);

  useEffect(() => {
    let active = true;
    const load = evidenceLoader.current;
    setReason(''); setEvidence([]); setUploads([]); setIdentifications({}); setError('');
    setExistingEvidence(selected?.evidenceUrls ?? []);
    setEvidenceLoading(Boolean(selected && load));
    if (selected && load) {
      void load(selected.receiptId).then(urls => {
        if (active) setExistingEvidence([...new Set(urls)]);
      }).catch(() => {
        if (active) setError('Receipt evidence could not be loaded. Reopen this decision to retry.');
      }).finally(() => { if (active) setEvidenceLoading(false); });
    }
    return () => { active = false; };
  }, [selected]);

  const independentReviewer = Boolean(reviewerId && selected && reviewerId !== selected.requestedBy);
  const evidenceUrls = [...new Set([...evidence, ...uploads])];

  const close = () => {
    setSelected(null);
    setReason('');
    setEvidence([]);
    setUploads([]);
    setIdentifications({});
  };

  const decide = async (decision: ReceiptExceptionDecisionInput['decision']) => {
    if (!selected || !independentReviewer || !reason.trim() || !evidenceUrls.length || submitting || evidenceBusy || evidenceLoading) return;
    const unidentifiedLines = selected.lines.filter((line) => !line.productId);
    if (
      (decision === 'accept' || decision === 'quarantine')
      && unidentifiedLines.some((line) => !identifications[line.poLineId])
    ) return;
    const governedIdentifications = unidentifiedLines
      .map((line) => ({ poLineId: line.poLineId, productId: identifications[line.poLineId] ?? '' }))
      .filter((identification) => identification.productId);
    setSubmitting(true);
    try {
      if (await onDecision({
        decisionId: selected.decisionId,
        decision,
        reason: reason.trim(),
        evidenceUrls,
        ...(governedIdentifications.length > 0 ? { identifications: governedIdentifications } : {}),
      })) close();
      else setError('Decision was not recorded. Review the rejection and retry.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Decision was not recorded.');
    } finally {
      setSubmitting(false);
    }
  };

  if (visibleItems.length === 0) return receiptId ? <p role="status">No pending controlled decision for this receipt, or it is outside your access.</p> : null;
  const unidentifiedLines = selected?.lines.filter((line) => !line.productId) ?? [];
  const identificationComplete = unidentifiedLines.every((line) => Boolean(identifications[line.poLineId]));
  const commonDisabled = !independentReviewer || !reason.trim() || !evidenceUrls.length || submitting || evidenceBusy || evidenceLoading;
  const shortage = selected?.requestedDisposition === 'short';

  return (
    <section className="space-y-2" aria-label="Controlled receipt decisions">
      <h2 className="text-sm font-semibold text-ink">Controlled receipt decisions</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {visibleItems.map((item) => (
          <li key={item.decisionId} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-ink">{item.poNumber}</p>
                {item.status === 'escalated' && <Badge tone="amber">Escalated</Badge>}
              </div>
              <p className="text-xs text-muted">{item.requestedDisposition} · {item.reason}</p>
            </div>
            <button type="button" className="btn-outline btn-sm" disabled={submitting || evidenceBusy} onClick={() => setSelected(item)}>
              Review controlled receipt
            </button>
          </li>
        ))}
      </ul>
      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open && !submitting && !evidenceBusy) close(); }}
        title="Supervisor receipt decision"
        description={selected ? `${selected.poNumber} · ${selected.requestedDisposition}` : undefined}
        footer={(
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-outline justify-center" disabled={commonDisabled || !identificationComplete} onClick={() => void decide('accept')}>
              {shortage ? 'Accept partial receipt' : 'Accept receipt'}
            </button>
            <button type="button" className="btn-ghost justify-center text-rose-600" disabled={commonDisabled} onClick={() => void decide('reject')}>
              {shortage ? 'Reject shortage decision' : 'Reject receipt'}
            </button>
            <button type="button" className="btn-primary justify-center" disabled={commonDisabled || !identificationComplete} onClick={() => void decide('quarantine')}>
              {shortage ? 'Record shortage for follow-up' : 'Quarantine receipt'}
            </button>
            <button type="button" className="btn-outline justify-center" disabled={commonDisabled} onClick={() => void decide('escalate')}>
              {shortage ? 'Escalate shortage' : 'Escalate receipt'}
            </button>
          </div>
        )}
      >
        <div className="space-y-3">
          <p className="rounded-lg bg-inset p-3 text-sm text-muted">
            The receiving Operator cannot decide this exception. This decision preserves unavailable custody and its audit evidence.
          </p>
          {!independentReviewer && <p role="alert">Another authorized Lead must decide this receipt. The receiving actor cannot review their own delivery.</p>}
          {shortage && <p className="text-sm">Missing goods remain outstanding and are not recorded as received. A final shortage decision releases the line for the next delivery; escalation keeps it blocked.</p>}
          {error && <p role="alert">{error}</p>}
          <Field label="Decision reason" htmlFor="receipt-decision-reason">
            <textarea id="receipt-decision-reason" className="input min-h-24" disabled={submitting} value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
          <fieldset className="space-y-3" disabled={submitting || !independentReviewer}>
            <legend className="text-sm font-semibold">Decision evidence</legend>
            {evidenceLoading && <p role="status">Loading receipt evidence...</p>}
            {existingEvidence.map((url, index) => <div key={url} className="space-y-2">
              <EvidenceGallery urls={[url]} />
              <label className="flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" checked={evidence.includes(url)} onChange={event => setEvidence(current => event.target.checked ? [...current, url] : current.filter(item => item !== url))} />
                Use receipt evidence {index + 1}
              </label>
            </div>)}
            {selected && <EvidenceCapture key={selected.decisionId} reference={`receipt-decision/${selected.decisionId}`} value={uploads} onChange={setUploads} onBusyChange={setEvidenceBusy} label="Upload supporting evidence" />}
          </fieldset>
          {unidentifiedLines.map((line) => {
            const inputId = `receipt-identification-${line.poLineId}`;
            return (
              <Field key={line.poLineId} label={`Identify ${line.rawDescription}`} htmlFor={inputId}>
                <ProductSelect
                  id={inputId}
                  aria-label={`Identify ${line.rawDescription}`}
                  products={products}
                  value={identifications[line.poLineId] ?? ''}
                  onChange={(productId) => setIdentifications((current) => ({
                    ...current,
                    [line.poLineId]: productId,
                  }))}
                  placeholder="Select governed product identity"
                />
              </Field>
            );
          })}
        </div>
      </Sheet>
    </section>
  );
}
