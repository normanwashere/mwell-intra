import { useEffect, useState } from 'react';
import type { InspectQualityInput, QualityDisposition } from '@intra/data-kit';
import { EvidenceCapture } from '@/components/camera/EvidenceCapture';
import { Field, Sheet } from '@/components/ui';

interface InspectionTarget {
  sourceType: InspectQualityInput['sourceType'];
  sourceId: string;
  productId: string;
  productName: string;
  quantity: number;
  binId?: string;
  lotId?: string;
  serialNumber?: string;
}

interface InspectionSheetProps {
  target: InspectionTarget | null;
  requiresEvidence: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: InspectQualityInput) => Promise<boolean>;
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

export function InspectionSheet({
  target,
  requiresEvidence,
  onOpenChange,
  onSubmit,
}: InspectionSheetProps) {
  const [disposition, setDisposition] = useState<Exclude<QualityDisposition, 'pending'>>('accepted');
  const [reason, setReason] = useState('');
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!target) return;
    setDisposition('accepted');
    setReason('');
    setEvidenceUrls([]);
  }, [target]);

  const reasonRequired = disposition !== 'accepted';
  const invalid =
    !target ||
    (reasonRequired && !reason.trim()) ||
    (requiresEvidence && evidenceUrls.length === 0);

  const submit = async () => {
    if (!target || invalid) return;
    setSubmitting(true);
    try {
      const ok = await onSubmit({
        idempotencyKey: commandKey('inspect-quality'),
        sourceType: target.sourceType,
        sourceId: target.sourceId,
        productId: target.productId,
        quantity: target.quantity,
        disposition,
        ...(target.binId ? { binId: target.binId } : {}),
        ...(target.lotId ? { lotId: target.lotId } : {}),
        ...(target.serialNumber ? { serialNumber: target.serialNumber } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        evidenceUrls,
      });
      if (ok) onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      open={Boolean(target)}
      onOpenChange={onOpenChange}
      title="Inspect stock"
      description={target ? `${target.productName} · ${target.quantity} unit(s)` : undefined}
      footer={
        <button
          type="button"
          className="btn-primary w-full justify-center"
          disabled={invalid || submitting}
          onClick={() => void submit()}
        >
          {submitting ? 'Submitting...' : 'Submit inspection'}
        </button>
      }
    >
      <div className="space-y-4">
        <Field label="Disposition" htmlFor="quality-disposition">
          <select
            id="quality-disposition"
            className="input"
            value={disposition}
            onChange={(event) => setDisposition(event.target.value as Exclude<QualityDisposition, 'pending'>)}
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
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        )}
        <EvidenceCapture onChange={setEvidenceUrls} label="Attach inspection evidence" />
        {requiresEvidence && evidenceUrls.length === 0 && (
          <p className="text-xs font-medium text-amber-700 dark:text-amber-300" role="status">
            This receiving route requires evidence before inspection can be submitted.
          </p>
        )}
      </div>
    </Sheet>
  );
}
