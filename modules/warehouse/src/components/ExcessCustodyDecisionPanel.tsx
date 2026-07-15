import { useEffect, useState } from 'react';
import { Badge, Field, Sheet } from '@/components/ui';

export interface ExcessCustodyWorkItem {
  custodyId: string;
  receiptId: string;
  purchaseOrderId: string;
  poLineId: string;
  poNumber: string;
  productName?: string;
  orderedQuantity: number;
  excessQuantity: number;
  status: 'pending' | 'held';
}

export interface ExcessCustodyDecisionInput {
  custodyId: string;
  outcome: 'accepted_amendment' | 'vendor_return' | 'written_off';
  approvedAmendmentId?: string;
  reason: string;
  evidenceUrls: string[];
}

export function ExcessCustodyDecisionPanel({
  items,
  onDecision,
}: {
  items: ExcessCustodyWorkItem[];
  onDecision: (input: ExcessCustodyDecisionInput) => Promise<boolean>;
}) {
  const [selected, setSelected] = useState<ExcessCustodyWorkItem | null>(null);
  const [outcome, setOutcome] = useState<ExcessCustodyDecisionInput['outcome']>('vendor_return');
  const [approvedAmendmentId, setApprovedAmendmentId] = useState('');
  const [reason, setReason] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!selected) return;
    setOutcome('vendor_return');
    setApprovedAmendmentId('');
    setReason('');
    setEvidenceUrl('');
  }, [selected]);

  if (items.length === 0) return null;
  const invalid = !selected || !reason.trim() || !evidenceUrl.trim()
    || (outcome === 'accepted_amendment' && !approvedAmendmentId.trim());

  const submit = async () => {
    if (!selected || invalid) return;
    setSubmitting(true);
    try {
      const ok = await onDecision({
        custodyId: selected.custodyId,
        outcome,
        ...(outcome === 'accepted_amendment' ? { approvedAmendmentId: approvedAmendmentId.trim() } : {}),
        reason: reason.trim(),
        evidenceUrls: [evidenceUrl.trim()],
      });
      if (ok) setSelected(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="space-y-3" aria-label="Excess custody work items">
      <div>
        <h2 className="text-base font-bold text-ink">Excess custody</h2>
        <p className="text-xs text-muted">Physical overages remain isolated until a governed final disposition.</p>
      </div>
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {items.map((item) => (
          <li key={item.custodyId} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-ink">{item.poNumber}</p>
                <Badge tone="amber">{item.status}</Badge>
              </div>
              <p className="text-sm text-muted">{item.productName ?? 'Unidentified item'} · {item.excessQuantity} excess unit(s)</p>
            </div>
            <button type="button" className="btn-ghost btn-sm" onClick={() => setSelected(item)}>Review excess custody</button>
          </li>
        ))}
      </ul>
      <Sheet open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}
        title="Resolve excess custody" description={selected ? `${selected.poNumber} · line ${selected.poLineId}` : undefined}
        footer={<button type="button" className="btn-primary w-full justify-center" disabled={invalid || submitting}
          onClick={() => void submit()}>{submitting ? 'Recording...' : 'Record final disposition'}</button>}>
        {selected && <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 rounded-lg bg-inset p-3 text-sm">
            <div><dt className="text-xs text-faint">Ordered at receipt</dt><dd className="font-semibold text-ink">{selected.orderedQuantity}</dd></div>
            <div><dt className="text-xs text-faint">Excess custody</dt><dd className="font-semibold text-ink">{selected.excessQuantity}</dd></div>
          </dl>
          <Field label="Governed outcome" htmlFor="excess-outcome">
            <select id="excess-outcome" className="input" value={outcome}
              onChange={(event) => setOutcome(event.target.value as ExcessCustodyDecisionInput['outcome'])}>
              <option value="accepted_amendment">Accept under approved amendment</option>
              <option value="vendor_return">Return to vendor</option>
              <option value="written_off">Write off</option>
            </select>
          </Field>
          {outcome === 'accepted_amendment' && <Field label="Approved amendment ID" htmlFor="approved-amendment-id">
            <input id="approved-amendment-id" className="input" value={approvedAmendmentId}
              onChange={(event) => setApprovedAmendmentId(event.target.value)} />
          </Field>}
          <Field label="Decision reason" htmlFor="excess-decision-reason">
            <textarea id="excess-decision-reason" className="input min-h-24 resize-y" value={reason}
              onChange={(event) => setReason(event.target.value)} />
          </Field>
          <Field label="Evidence URL" htmlFor="excess-evidence-url">
            <input id="excess-evidence-url" className="input" value={evidenceUrl}
              onChange={(event) => setEvidenceUrl(event.target.value)} />
          </Field>
        </div>}
      </Sheet>
    </section>
  );
}
