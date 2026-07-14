import { useState } from 'react';
import { Field, Sheet } from '@/components/ui';

export interface ReceiptExceptionDecisionItem {
  decisionId: string;
  receiptId: string;
  purchaseOrderId: string;
  poNumber: string;
  requestedDisposition: 'damaged' | 'quarantine';
  requestedBy: string;
  requestedAt: string;
  reason: string;
}

export interface ReceiptExceptionDecisionInput {
  decisionId: string;
  decision: 'quarantine' | 'reject';
  reason: string;
  evidenceUrls: string[];
}

interface ReceiptExceptionDecisionPanelProps {
  items: ReceiptExceptionDecisionItem[];
  onDecision: (input: ReceiptExceptionDecisionInput) => Promise<boolean>;
}

export function ReceiptExceptionDecisionPanel({ items, onDecision }: ReceiptExceptionDecisionPanelProps) {
  const [selected, setSelected] = useState<ReceiptExceptionDecisionItem | null>(null);
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const close = () => {
    setSelected(null);
    setReason('');
    setEvidence('');
  };

  const decide = async (decision: ReceiptExceptionDecisionInput['decision']) => {
    if (!selected || !reason.trim() || !evidence.trim() || submitting) return;
    setSubmitting(true);
    try {
      if (await onDecision({
        decisionId: selected.decisionId,
        decision,
        reason: reason.trim(),
        evidenceUrls: [evidence.trim()],
      })) close();
    } finally {
      setSubmitting(false);
    }
  };

  if (items.length === 0) return null;

  return (
    <section className="space-y-2" aria-label="Controlled receipt decisions">
      <h2 className="text-sm font-semibold text-ink">Controlled receipt decisions</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {items.map((item) => (
          <li key={item.decisionId} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div>
              <p className="text-sm font-semibold text-ink">{item.poNumber}</p>
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
            <button type="button" className="btn-ghost justify-center text-rose-600" disabled={!reason.trim() || !evidence.trim() || submitting} onClick={() => void decide('reject')}>
              Reject receipt
            </button>
            <button type="button" className="btn-primary justify-center" disabled={!reason.trim() || !evidence.trim() || submitting} onClick={() => void decide('quarantine')}>
              Confirm quarantine
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
        </div>
      </Sheet>
    </section>
  );
}
