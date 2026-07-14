import { useState } from 'react';
import { Badge, Field, ProductSelect, Sheet } from '@/components/ui';

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
  products?: Array<{ id: string; name: string; sku: string }>;
  onDecision: (input: ReceiptExceptionDecisionInput) => Promise<boolean>;
}

export function ReceiptExceptionDecisionPanel({ items, products = [], onDecision }: ReceiptExceptionDecisionPanelProps) {
  const [selected, setSelected] = useState<ReceiptExceptionDecisionItem | null>(null);
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [identifications, setIdentifications] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    setSelected(null);
    setReason('');
    setEvidence('');
    setIdentifications({});
  };

  const decide = async (decision: ReceiptExceptionDecisionInput['decision']) => {
    if (!selected || !reason.trim() || !evidence.trim() || submitting) return;
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
        evidenceUrls: [evidence.trim()],
        ...(governedIdentifications.length > 0 ? { identifications: governedIdentifications } : {}),
      })) close();
    } finally {
      setSubmitting(false);
    }
  };

  if (items.length === 0) return null;
  const unidentifiedLines = selected?.lines.filter((line) => !line.productId) ?? [];
  const identificationComplete = unidentifiedLines.every((line) => Boolean(identifications[line.poLineId]));
  const commonDisabled = !reason.trim() || !evidence.trim() || submitting;

  return (
    <section className="space-y-2" aria-label="Controlled receipt decisions">
      <h2 className="text-sm font-semibold text-ink">Controlled receipt decisions</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {items.map((item) => (
          <li key={item.decisionId} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold text-ink">{item.poNumber}</p>
                {item.status === 'escalated' && <Badge tone="amber">Escalated</Badge>}
              </div>
              <p className="text-xs text-muted">{item.requestedDisposition} · {item.reason}</p>
            </div>
            <button type="button" className="btn-outline btn-sm" onClick={() => setSelected(item)}>
              Review controlled receipt
            </button>
          </li>
        ))}
      </ul>
      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => { if (!open) close(); }}
        title="Supervisor receipt decision"
        description={selected ? `${selected.poNumber} · ${selected.requestedDisposition}` : undefined}
        footer={(
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-outline justify-center" disabled={commonDisabled || !identificationComplete} onClick={() => void decide('accept')}>
              Accept receipt
            </button>
            <button type="button" className="btn-ghost justify-center text-rose-600" disabled={commonDisabled} onClick={() => void decide('reject')}>
              Reject receipt
            </button>
            <button type="button" className="btn-primary justify-center" disabled={commonDisabled || !identificationComplete} onClick={() => void decide('quarantine')}>
              Quarantine receipt
            </button>
            <button type="button" className="btn-outline justify-center" disabled={commonDisabled} onClick={() => void decide('escalate')}>
              Escalate receipt
            </button>
          </div>
        )}
      >
        <div className="space-y-3">
          <p className="rounded-lg bg-inset p-3 text-sm text-muted">
            The receiving Operator cannot decide this exception. This decision preserves unavailable custody and its audit evidence.
          </p>
          <Field label="Decision reason" htmlFor="receipt-decision-reason">
            <textarea id="receipt-decision-reason" className="input min-h-24" value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
          <Field label="Decision evidence" htmlFor="receipt-decision-evidence">
            <input id="receipt-decision-evidence" className="input" value={evidence} onChange={(event) => setEvidence(event.target.value)} />
          </Field>
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
