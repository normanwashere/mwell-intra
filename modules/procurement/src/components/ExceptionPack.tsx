'use client';

import type { ProcurementExceptionPack, SourcingMethod } from '../types';

export function ExceptionPack({
  method,
  value,
  onChange,
}: {
  method: SourcingMethod;
  value: ProcurementExceptionPack;
  onChange: (value: ProcurementExceptionPack) => void;
}) {
  const patch = (next: Partial<ProcurementExceptionPack>) => onChange({ ...value, ...next });
  const pettyCash = method === 'petty_cash';
  return (
    <section className="space-y-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <div>
        <h3 className="font-semibold text-ink">Exception control pack</h3>
        <p className="text-xs text-muted">The exception cannot proceed until its basis, evidence, risks, and required reviews are complete.</p>
      </div>
      <label className="block text-sm font-semibold text-ink">
        Business justification
        <textarea className="input mt-1.5" rows={4} value={value.justification} onChange={(event) => patch({ justification: event.target.value })} />
      </label>
      {!pettyCash && (
        <label className="block text-sm font-semibold text-ink">
          Price reasonableness
          <textarea className="input mt-1.5" rows={3} value={value.priceReasonableness ?? ''} onChange={(event) => patch({ priceReasonableness: event.target.value })} />
        </label>
      )}
      <label className="block text-sm font-semibold text-ink">
        Operational, legal, financial, delivery, and data risks with mitigation
        <textarea className="input mt-1.5" rows={4} value={value.risksAndMitigations ?? ''} onChange={(event) => patch({ risksAndMitigations: event.target.value })} />
      </label>
      {pettyCash && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex min-h-11 items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"><input type="checkbox" className="h-5 w-5" checked={value.financeEligibilityConfirmed ?? false} onChange={(event) => patch({ financeEligibilityConfirmed: event.target.checked })} />I attest this request is eligible for Finance review</label>
          <label className="flex min-h-11 items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"><input type="checkbox" className="h-5 w-5" checked={value.nonRecurringNonSplitAttested ?? false} onChange={(event) => patch({ nonRecurringNonSplitAttested: event.target.checked })} />One-time, non-recurring, and not split</label>
        </div>
      )}
      {pettyCash && <p role="status" className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-200">Finance review is pending. This attestation is not Finance approval and cannot authorize petty cash.</p>}
    </section>
  );
}
