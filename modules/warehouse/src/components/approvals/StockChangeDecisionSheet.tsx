import { useEffect, useState } from 'react';
import type { DecideStockChangeInput, StockChangeRequest } from '@intra/data-kit';
import { Field, Sheet } from '@/components/ui';

interface StockChangeDecisionSheetProps {
  request: StockChangeRequest | null;
  actor: string;
  online: boolean;
  onOpenChange: (open: boolean) => void;
  onDecision: (input: Omit<DecideStockChangeInput, 'actor'>) => Promise<boolean>;
}

const number = new Intl.NumberFormat('en-PH', {
  maximumFractionDigits: 0,
});

const money = (value: number) => `PHP ${number.format(value)}`;

function commandKey(requestId: string, decision: string) {
  return `stock-change-${requestId}-${decision}-${Date.now()}`;
}

export function StockChangeDecisionSheet({
  request,
  actor,
  online,
  onOpenChange,
  onDecision,
}: StockChangeDecisionSheetProps) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => setNote(''), [request]);

  const ownRequest = request?.requestedBy === actor;
  const blocked = !request || !online || ownRequest || submitting;

  const decide = async (decision: DecideStockChangeInput['decision']) => {
    if (!request || blocked || (decision === 'rejected' && !note.trim())) return;
    setSubmitting(true);
    try {
      const ok = await onDecision({
        idempotencyKey: commandKey(request.id, decision),
        requestId: request.id,
        decision,
        approvalTier: request.status === 'pending_finance' ? 'finance' : 'logistics_supervisor',
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      if (ok) onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      open={Boolean(request)}
      onOpenChange={onOpenChange}
      title="Review stock change"
      description={request ? `${request.quantityDelta > 0 ? '+' : ''}${request.quantityDelta} units · ${money(request.financialImpact)}` : undefined}
      footer={
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            className="btn-ghost justify-center text-rose-600"
            disabled={blocked || !note.trim()}
            onClick={() => void decide('rejected')}
          >
            Reject change
          </button>
          <button
            type="button"
            className="btn-primary justify-center"
            disabled={blocked}
            onClick={() => void decide('approved')}
          >
            Approve change
          </button>
        </div>
      }
    >
      {request && (
        <div className="space-y-4">
          <div className="rounded-lg border border-line bg-inset/50 p-3 text-sm">
            <p className="font-semibold text-ink">Separation of duties</p>
            <p className="mt-1 text-muted">
              The person who requested a stock change cannot approve it. Every decision is recorded in the audit trail.
            </p>
          </div>
          {ownRequest && (
            <p role="alert" className="rounded-lg bg-rose-500/10 p-3 text-sm font-medium text-rose-700 dark:text-rose-300">
              You requested this change. A different authorized approver must decide it.
            </p>
          )}
          {!online && (
            <p role="alert" className="rounded-lg bg-amber-500/10 p-3 text-sm font-medium text-amber-800 dark:text-amber-200">
              Connect to the network before approving or rejecting inventory changes.
            </p>
          )}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div><dt className="text-faint">Requested by</dt><dd className="mt-1 break-all font-medium text-ink">{request.requestedBy}</dd></div>
            <div><dt className="text-faint">Reason</dt><dd className="mt-1 font-medium text-ink">{request.reason}</dd></div>
            <div><dt className="text-faint">Unit cost</dt><dd className="mt-1 font-medium text-ink">{money(request.unitCost)}</dd></div>
            <div><dt className="text-faint">Financial impact</dt><dd className="mt-1 font-semibold text-ink">{money(request.financialImpact)}</dd></div>
          </dl>
          <Field label="Decision note" htmlFor="stock-change-note" hint="Required when rejecting; recommended for approvals.">
            <textarea
              id="stock-change-note"
              className="input min-h-24 resize-y"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        </div>
      )}
    </Sheet>
  );
}
