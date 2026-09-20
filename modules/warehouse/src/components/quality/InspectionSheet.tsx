import { useLayoutEffect, useRef, useState } from 'react';
import type { InspectQualityInput, InspectQualityBatchInput, InspectionOutcome, QualityDisposition } from '@intra/data-kit';
import { userFacingError } from '@intra/ui';
import { EvidenceCapture } from '@/components/camera/EvidenceCapture';
import { Field, Sheet } from '@/components/ui';
import { Icon } from '@/components/Icon';

interface InspectionTarget {
  sourceType: InspectQualityInput['sourceType'];
  sourceId: string;
  productId: string;
  productName: string;
  quantity: number;
  binId?: string;
  lotId?: string;
  serialNumber?: string;
  procurementPoLineId?: string;
}

interface InspectionSheetProps {
  target: InspectionTarget | null;
  requiresEvidence: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: InspectQualityInput) => Promise<boolean | InspectionOutcome>;
  batchTargets?: InspectionTarget[];
  onSubmitBatch?: (input: InspectQualityBatchInput) => Promise<boolean | InspectionOutcome>;
  /** True while a submitted command is unresolved, including closed/uncertain states. */
  onPendingChange?: (pending: boolean) => void;
}

const DISPOSITIONS: Array<{ value: Exclude<QualityDisposition, 'pending'>; label: string }> = [
  { value: 'accepted', label: 'Accepted for putaway' },
  { value: 'hold', label: 'Place on hold' },
  { value: 'damaged', label: 'Damaged / unavailable' },
  { value: 'vendor_return', label: 'Return to vendor' },
  { value: 'unavailable', label: 'Unavailable' },
];

function commandKey(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type PendingInspection = {
  target: InspectionTarget;
  targetKey: string;
} & (
  | { kind: 'single'; input: InspectQualityInput }
  | { kind: 'batch'; input: InspectQualityBatchInput; targets: InspectionTarget[] }
);

export function InspectionSheet({
  target,
  requiresEvidence,
  onOpenChange,
  onSubmit,
  batchTargets,
  onSubmitBatch,
  onPendingChange,
}: InspectionSheetProps) {
  const [disposition, setDisposition] = useState<Exclude<QualityDisposition, 'pending'>>('accepted');
  const [reason, setReason] = useState('');
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [reviewPending, setReviewPending] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const retry = useRef<PendingInspection | null>(null);
  const inFlight = useRef(false);
  const visibleTarget = retry.current?.target ?? target;
  const visibleBatch = retry.current ? (retry.current.kind === 'batch' ? retry.current.targets : undefined) : batchTargets;
  const isBatch = Boolean(visibleBatch?.length);
  const locked = Boolean(retry.current);
  const targetKey = target ? JSON.stringify((batchTargets ?? [target]).map(item => [item.sourceType, item.sourceId, item.productId, item.procurementPoLineId, item.binId, item.lotId, item.serialNumber, item.quantity])) : 'closed';

  useLayoutEffect(() => {
    onPendingChange?.(locked);
  }, [locked, onPendingChange]);

  useLayoutEffect(() => {
    // Queue refreshes and closing the sheet cannot retire an uncertain command.
    if (!target || retry.current) return;
    setDisposition('accepted');
    setReason('');
    setEvidenceUrls([]);
    setEvidenceBusy(false);
    setConfirmed(false);
    setUnconfirmed(false);
    setRejection(null);
  }, [targetKey]);

  const reasonRequired = disposition !== 'accepted';
  const invalid =
    !target || evidenceBusy ||
    (reasonRequired && !reason.trim()) ||
    ((requiresEvidence || isBatch) && evidenceUrls.length === 0) ||
    (isBatch && (!confirmed || !onSubmitBatch));

  const submit = async () => {
    if (inFlight.current || (!retry.current && (!target || invalid))) return;
    if (!retry.current && target) {
      const common = { idempotencyKey: commandKey('inspect-quality'), disposition, reason: reason.trim() || undefined, evidenceUrls: [...evidenceUrls] };
      retry.current = batchTargets?.length && onSubmitBatch ? {
        kind: 'batch', target: { ...target }, targetKey,
        targets: batchTargets.map(item => ({ ...item })),
        input: { ...common, items: batchTargets.map(({ productName: _name, ...item }) => ({ ...item })) },
      } : {
        kind: 'single', target: { ...target }, targetKey,
        input: {
          ...common,
          sourceType: target.sourceType, sourceId: target.sourceId, productId: target.productId, quantity: target.quantity,
          ...(target.binId ? { binId: target.binId } : {}),
          ...(target.lotId ? { lotId: target.lotId } : {}),
          ...(target.serialNumber ? { serialNumber: target.serialNumber } : {}),
          ...(target.procurementPoLineId ? { procurementPoLineId: target.procurementPoLineId } : {}),
        },
      };
    }
    const command = retry.current;
    if (!command || (command.kind === 'batch' && !onSubmitBatch)) return;
    inFlight.current = true;
    setSubmitting(true);
    setRejection(null);
    try {
      // Each transport call gets a copy; the original intent stays immutable.
      const ok = command.kind === 'batch'
        ? await onSubmitBatch!({ ...command.input, evidenceUrls: [...(command.input.evidenceUrls ?? [])], items: command.input.items.map(item => ({ ...item })) })
        : await onSubmit({ ...command.input, evidenceUrls: [...(command.input.evidenceUrls ?? [])] });
      if (ok === true || (typeof ok === 'object' && ok.status === 'committed')) {
        retry.current = null;
        setUnconfirmed(false);
        setReviewPending(false);
        onOpenChange(false);
      } else if (typeof ok === 'object' && ok.status === 'rejected' && !unconfirmed) {
        // A first-attempt rejection proves no save; allow correction. A later
        // denial cannot disprove an earlier uncertain commit, so keep that pin.
        retry.current = null;
        setConfirmed(false);
        setRejection(userFacingError(ok.message));
      } else {
        setUnconfirmed(true);
        if (typeof ok === 'object' && ok.status === 'rejected') setRejection(userFacingError(ok.message));
      }
    } catch {
      setUnconfirmed(true);
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  return (
    <>
    {!target && !reviewPending && unconfirmed && <div role="alert" className="flex flex-wrap items-center gap-3 border-y border-line py-3 text-sm">
      <p>The original inspection save is still unconfirmed.</p>
      <button type="button" className="btn-ghost min-h-11 gap-2" onClick={() => setReviewPending(true)}><Icon name="rotate" />Review unconfirmed inspection</button>
    </div>}
    <Sheet
      open={Boolean(target) || reviewPending}
      onOpenChange={(open) => { if (!inFlight.current) { setReviewPending(open); onOpenChange(open); } }}
      title={isBatch ? 'Review selected inspections' : 'Inspect stock'}
      description={visibleTarget ? `${visibleTarget.productName} · ${visibleBatch?.reduce((total, item) => total + item.quantity, 0) ?? visibleTarget.quantity} unit(s)${!isBatch && visibleTarget.serialNumber ? ` · Serial ${visibleTarget.serialNumber}` : ''}` : undefined}
      footer={
        <button
          type="button"
          className="btn-primary min-h-11 w-full justify-center gap-2"
          disabled={submitting || (locked ? retry.current?.kind === 'batch' && !onSubmitBatch : invalid)}
          onClick={() => void submit()}
        >
          <Icon name={unconfirmed ? 'rotate' : 'check'} />
          {submitting ? 'Submitting...' : unconfirmed ? 'Retry original inspection' : isBatch ? `Submit ${visibleBatch!.length} inspection${visibleBatch!.length === 1 ? '' : 's'}` : 'Submit inspection'}
        </button>
      }
    >
      <div className="space-y-4">
        {unconfirmed && <p role="alert" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">We could not confirm the save. The original selection, details, and evidence are locked. Retry the original inspection to confirm it before starting another command.</p>}
        {rejection && <p role="alert" className="rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-950">{unconfirmed ? 'This retry was blocked. The original save still needs confirmation. ' : 'This inspection was not saved. '}{rejection}</p>}
        <fieldset disabled={locked || submitting} className="min-w-0 space-y-4">
        {isBatch && <section className="border-b border-line pb-4" aria-label="Selected inspections">
          <ul tabIndex={0} aria-label="Selected inspection items" className="max-h-48 overflow-y-auto divide-y divide-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-500">
            {visibleBatch!.map((item, index) => <li key={index} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 break-all">{item.serialNumber ? `Serial ${item.serialNumber}` : item.productName}</span><span className="shrink-0">{item.quantity} unit(s)</span>
            </li>)}
          </ul>
          <label className="mt-3 flex min-h-11 items-center gap-3 text-sm font-semibold">
            <input type="checkbox" checked={confirmed} disabled={locked || submitting} onChange={e => { if (!retry.current) setConfirmed(e.target.checked); }} />
            {visibleBatch!.length === 1 ? 'I inspected the selected item' : `I inspected all ${visibleBatch!.length} selected items`}
          </label>
        </section>}
        <Field label="Disposition" htmlFor="quality-disposition">
          <select
            id="quality-disposition"
            className="input"
            value={disposition}
            onChange={(event) => { if (!retry.current) setDisposition(event.target.value as Exclude<QualityDisposition, 'pending'>); }}
          >
            {DISPOSITIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </Field>
        {reasonRequired && (
          <Field label="Reason" htmlFor="quality-reason" hint="Required for every non-accepted outcome.">
            <textarea
              id="quality-reason"
              className="input min-h-24 resize-y"
              value={reason}
              onChange={(event) => { if (!retry.current) setReason(event.target.value); }}
            />
          </Field>
        )}
        <EvidenceCapture reference={`inspection/${encodeURIComponent(retry.current?.targetKey ?? targetKey)}`} value={evidenceUrls} onChange={urls => { if (!retry.current) setEvidenceUrls(urls); }} onBusyChange={setEvidenceBusy} label="Attach inspection evidence" />
        {(requiresEvidence || isBatch) && evidenceUrls.length === 0 && (
          <p className="text-xs font-medium text-amber-700 dark:text-amber-300" role="status">
            Attach evidence before submitting this inspection.
          </p>
        )}
        </fieldset>
      </div>
    </Sheet>
    </>
  );
}
