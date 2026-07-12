import { useEffect, useState } from 'react';
import type {
  CreateVendorReturnInput,
  InventoryHold,
  ReleaseHoldInput,
  Supplier,
} from '@intra/data-kit';
import { EvidenceCapture } from '@/components/camera/EvidenceCapture';
import { Badge, Field, Sheet } from '@/components/ui';

interface HoldReleaseSheetProps {
  hold: InventoryHold | null;
  actor: string;
  productName: string;
  mode: 'release' | 'vendor_return';
  suppliers: Supplier[];
  defaultSupplierId?: string;
  onOpenChange: (open: boolean) => void;
  onRelease: (input: ReleaseHoldInput) => Promise<boolean>;
  onCreateVendorReturn: (input: CreateVendorReturnInput) => Promise<boolean>;
}

export function HoldReleaseSheet({
  hold,
  actor,
  productName,
  mode,
  suppliers,
  defaultSupplierId,
  onOpenChange,
  onRelease,
  onCreateVendorReturn,
}: HoldReleaseSheetProps) {
  const [reason, setReason] = useState('');
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [reference, setReference] = useState('');
  const [vendorReason, setVendorReason] = useState('');
  const [vendorEvidenceUrls, setVendorEvidenceUrls] = useState<string[]>([]);

  useEffect(() => {
    if (!hold) return;
    setReason('');
    setEvidenceUrls([]);
    setSupplierId(defaultSupplierId ?? '');
    setReference('');
    setVendorReason('');
    setVendorEvidenceUrls([]);
  }, [defaultSupplierId, hold]);

  const selfRelease = Boolean(hold && hold.createdBy === actor);
  const invalid = !hold || selfRelease || !reason.trim() || evidenceUrls.length === 0;
  const vendorInvalid = !hold || selfRelease || !supplierId || !reference.trim()
    || !vendorReason.trim() || vendorEvidenceUrls.length === 0;

  const release = async () => {
    if (!hold || invalid) return;
    setSubmitting(true);
    try {
      const ok = await onRelease({
        idempotencyKey: `release-hold-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        holdId: hold.id,
        targetDisposition: 'accepted',
        reason: reason.trim(),
        evidenceUrls,
      });
      if (ok) onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const createVendorReturn = async () => {
    if (!hold || vendorInvalid) return;
    setSubmitting(true);
    try {
      const ok = await onCreateVendorReturn({
        idempotencyKey: `vendor-return-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        holdId: hold.id,
        supplierId,
        reason: vendorReason.trim(),
        reference: reference.trim(),
        evidenceUrls: vendorEvidenceUrls,
      });
      if (ok) onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      open={Boolean(hold)}
      onOpenChange={onOpenChange}
      title="Review inventory hold"
      description={hold ? `${productName} · ${hold.quantity} unit(s)` : undefined}
      footer={
        mode === 'vendor_return' ? (
          <button
            type="button"
            className="btn-primary w-full justify-center"
            disabled={vendorInvalid || submitting}
            onClick={() => void createVendorReturn()}
          >
            {submitting ? 'Creating...' : 'Create vendor return'}
          </button>
        ) : (
          <button
            type="button"
            className="btn-primary w-full justify-center"
            disabled={invalid || submitting}
            onClick={() => void release()}
          >
            {submitting ? 'Releasing...' : 'Release as accepted'}
          </button>
        )
      }
    >
      {hold && (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 rounded-xl bg-inset p-3 text-sm">
            <div><dt className="text-xs text-faint">Status</dt><dd><Badge tone="amber">On hold</Badge></dd></div>
            <div><dt className="text-xs text-faint">Created</dt><dd className="font-medium text-ink">{hold.createdAt.slice(0, 10)}</dd></div>
            <div className="col-span-2"><dt className="text-xs text-faint">Created by</dt><dd className="break-all font-medium text-ink">{hold.createdBy}</dd></div>
            <div className="col-span-2"><dt className="text-xs text-faint">Hold reason</dt><dd className="font-medium text-ink">{hold.reason}</dd></div>
          </dl>
          <p className="rounded-xl border border-line px-3 py-2 text-xs text-muted">
            Separation of duties applies: the person who created a hold cannot release it.
          </p>
          {selfRelease && (
            <p role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-700 dark:text-rose-300">
              Ask another authorized supervisor to review this hold.
            </p>
          )}
          {mode === 'vendor_return' ? (
            <>
              <Field label="Supplier" htmlFor="vendor-return-supplier">
                <select id="vendor-return-supplier" className="input" value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                  <option value="">Select supplier</option>
                  {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </select>
              </Field>
              <Field label="Vendor return reference" htmlFor="vendor-return-reference" hint="RMA, rejection, or courier reference.">
                <input id="vendor-return-reference" className="input" value={reference} onChange={(event) => setReference(event.target.value)} />
              </Field>
              <Field label="Vendor return reason" htmlFor="vendor-return-reason">
                <textarea id="vendor-return-reason" className="input min-h-24 resize-y" value={vendorReason} onChange={(event) => setVendorReason(event.target.value)} />
              </Field>
              <EvidenceCapture onChange={setVendorEvidenceUrls} label="Attach vendor return evidence" />
            </>
          ) : (
            <>
              <Field label="Release reason" htmlFor="hold-release-reason">
                <textarea
                  id="hold-release-reason"
                  className="input min-h-24 resize-y"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </Field>
              <EvidenceCapture onChange={setEvidenceUrls} label="Attach release evidence" />
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}
