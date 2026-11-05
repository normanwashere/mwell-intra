import { useEffect, useState } from 'react';
import type { DecideStockChangeInput, StockChangeRequest } from '@intra/data-kit';
import { Field, Sheet } from '@/components/ui';
import { Link } from 'react-router-dom';
import { EvidenceGallery } from '@/components/EvidenceGallery';

interface StockChangeDecisionSheetProps {
  request: StockChangeRequest | null;
  actor: string;
  online: boolean;
  contextLoading?: boolean;
  contextError?: string | null;
  onRetryContext?: () => void;
  onOpenChange: (open: boolean) => void;
  onDecision: (input: DecideStockChangeInput) => Promise<boolean>;
  context?: {
    product: string; sku: string; location: string; bin?: string;
    expected?: number; counted?: number; requester: string;
    lotCounts?: { lotId: string | null; label: string; expected?: number; counted?: number; delta?: number }[];
  };
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
  context,
  contextLoading,
  contextError,
  onRetryContext,
}: StockChangeDecisionSheetProps) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => setNote(''), [request]);

  const ownRequest = request?.requestedBy === actor;
  const blocked = !request || !online || ownRequest || submitting;
  const lotCounts = context?.lotCounts ?? [];
  const incompleteLots = lotCounts.some(lot =>
    !Number.isFinite(lot.expected) || !Number.isFinite(lot.counted) || !Number.isFinite(lot.delta));
  const approvalBlocked = blocked || !context || incompleteLots;

  const decide = async (decision: DecideStockChangeInput['decision']) => {
    if (!request || blocked || (decision === 'approved' && approvalBlocked) || (decision === 'rejected' && !note.trim())) return;
    setSubmitting(true);
    try {
      const ok = await onDecision({
        idempotencyKey: commandKey(request.id, decision),
        requestId: request.id,
        decision,
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
      onOpenChange={open => { if (!submitting) onOpenChange(open); }}
      title="Review stock change"
      description={request ? `${request.quantityDelta > 0 ? '+' : ''}${request.quantityDelta} ${request.sourceType === 'cycle_count' ? 'net units' : 'units'} · ${money(request.approvalExposure ?? request.financialImpact)} ${request.sourceType === 'cycle_count' ? 'gross approval exposure' : 'approval exposure'}` : undefined}
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
            disabled={approvalBlocked}
            onClick={() => void decide('approved')}
          >
            Approve change
          </button>
        </div>
      }
    >
      {request && (
        <div className="space-y-4">
          {context ? <section aria-label="Stock change identity" className="border-b border-line pb-4">
            <h3 className="break-words font-semibold">{context.product}</h3>
            <p className="break-all text-sm text-muted">{context.sku} · {context.location}{context.bin ? ` / ${context.bin}` : ''}</p>
            <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
              <div><dt>Expected</dt><dd>{context.expected ?? 'Unavailable'}</dd></div>
              <div><dt>Counted</dt><dd>{context.counted ?? 'Unavailable'}</dd></div>
              <div><dt>{request.sourceType === 'cycle_count' ? 'Net change' : 'Change'}</dt><dd>{request.quantityDelta > 0 ? '+' : ''}{request.quantityDelta}</dd></div>
            </dl>
            <p className="mt-2 break-all text-xs text-muted">{request.sourceType.replace('_', ' ')}: {request.sourceId} · {request.evidenceUrls.length} evidence attachment(s)</p>
            {request.sourceType === 'cycle_count' && <Link className="btn-ghost btn-sm mt-2" to={`/cycle-counts?count=${encodeURIComponent(request.sourceId)}`}>Open source count</Link>}
          </section> : contextLoading ? <p role="status">Loading source count...</p> : <div role="alert"><p>{contextError ?? 'Required product, location, or source-count context is unavailable. Approval is blocked; reload the source record before deciding.'}</p>{contextError && onRetryContext && <button type="button" className="btn-ghost mt-2" onClick={onRetryContext}>Retry source count</button>}</div>}
          {lotCounts.length > 0 && <section aria-label="Lot count review" className="border-b border-line pb-4">
            <h3 className="text-sm font-semibold text-ink">Lot count review</h3>
            <ul aria-label="Lot count rows" className="mt-2 divide-y divide-line">
              {lotCounts.map(lot => <li key={JSON.stringify(lot.lotId)} className="min-w-0 py-3">
                <p className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{lot.label}</p>
                <dl className="mt-2 grid grid-cols-3 gap-3 text-sm">
                  <div className="min-w-0"><dt className="text-muted">Expected</dt><dd className="break-all font-medium tabular-nums">{lot.expected ?? 'Unavailable'}</dd></div>
                  <div className="min-w-0"><dt className="text-muted">Counted</dt><dd className="break-all font-medium tabular-nums">{lot.counted ?? 'Unavailable'}</dd></div>
                  <div className="min-w-0"><dt className="text-muted">Delta</dt><dd className="break-all font-medium tabular-nums">{lot.delta === undefined ? 'Unavailable' : `${lot.delta > 0 ? '+' : ''}${lot.delta}`}</dd></div>
                </dl>
              </li>)}
            </ul>
            {incompleteLots && <p role="alert" className="mt-2 text-sm text-rose-700 dark:text-rose-300">Lot review facts are incomplete. Reload the source count before approving.</p>}
          </section>}
          {request.evidenceUrls.length > 0 && <section aria-label="Stock change evidence"><h3 className="mb-2 text-sm font-semibold text-ink">Supporting evidence</h3><EvidenceGallery urls={request.evidenceUrls} /></section>}
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
            <div><dt className="text-faint">Requested by</dt><dd className="mt-1 break-all font-medium text-ink">{context?.requester ?? request.requestedBy}</dd></div>
            <div><dt className="text-faint">Reason</dt><dd className="mt-1 font-medium text-ink">{request.reason}</dd></div>
            <div><dt className="text-faint">Unit cost</dt><dd className="mt-1 font-medium text-ink">{money(request.unitCost)}</dd></div>
            <div><dt className="text-faint">{request.sourceType === 'cycle_count' ? 'Approval exposure (gross)' : 'Approval exposure'}</dt><dd className="mt-1 font-semibold text-ink">{money(request.approvalExposure ?? request.financialImpact)}</dd></div>
            {request.grossQuantity != null && <div><dt className="text-faint">Gross quantity</dt><dd className="mt-1 font-medium tabular-nums text-ink">{request.grossQuantity}</dd></div>}
            <div><dt className="text-faint">{request.sourceType === 'cycle_count' ? 'Net financial impact' : 'Financial impact'}</dt><dd className="mt-1 font-medium text-ink">{money(request.financialImpact)}</dd></div>
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
