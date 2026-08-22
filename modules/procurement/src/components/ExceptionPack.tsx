'use client';

import type { ProcurementExceptionPack, ProcurementMode, SourcingMethod } from '../types';

export function ExceptionPack({
  method,
  mode,
  amount,
  value,
  onChange,
}: {
  method: SourcingMethod;
  mode: Exclude<ProcurementMode, 'competitive_bidding'>;
  amount: number;
  value: ProcurementExceptionPack;
  onChange: (value: ProcurementExceptionPack) => void;
}) {
  const patch = (next: Partial<ProcurementExceptionPack>) => onChange({ ...value, ...next });
  const references = value.evidenceReferences ?? [];
  const repeat = value.repeatOrder ?? {
    samePrice: false, sameTerms: false, sameVendor: false, sameConsiderations: false,
    priorCompetitiveAward: false, materialScopeChange: false,
  };
  const emergency = value.emergency ?? {};
  const pettyCash = mode === 'petty_cash';
  const updateReference = (next: string) => patch({ evidenceReferences: next.split('\n').map((item) => item.trim()).filter(Boolean) });
  const updateRepeat = (next: Partial<NonNullable<ProcurementExceptionPack['repeatOrder']>>) => patch({ repeatOrder: { ...repeat, ...next } });
  const updateEmergency = (next: Partial<NonNullable<ProcurementExceptionPack['emergency']>>) => patch({ emergency: { ...emergency, ...next } });
  return (
    <section className="space-y-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <div>
        <h3 className="font-semibold text-ink">Exception control pack</h3>
        <p className="text-xs text-muted">This is requester evidence only. The governed request workspace independently validates the route, policy profile, linked records, and reviewers after the draft is saved.</p>
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
      {mode === 'sole_source' && <>
        <label className="block text-sm font-semibold text-ink">Sole-source basis
          <select className="input mt-1.5" value={value.soleSourceBasis ?? ''} onChange={(event) => patch({ soleSourceBasis: event.target.value as ProcurementExceptionPack['soleSourceBasis'] || undefined })}>
            <option value="">Select a policy basis</option><option value="only_acceptable_source">Only acceptable source</option><option value="compatibility">Compatibility</option><option value="specialization">Specialization</option><option value="unique_capability">Unique capability</option><option value="manufacturer">Manufacturer</option><option value="authorized_distributor">Authorized distributor</option>
          </select>
        </label>
        <label className="block text-sm font-semibold text-ink">Evidence references (one per line)<textarea className="input mt-1.5" rows={3} value={references.join('\n')} onChange={(event) => updateReference(event.target.value)} /></label>
      </>}
      {mode === 'repeat_order' && <section className="space-y-3 rounded-md border border-line bg-surface p-3" aria-label="Repeat-order evidence">
        <p className="text-sm font-semibold text-ink">Prior competitive award continuity</p>
        <p className="text-xs text-muted">Give Procurement the four record IDs. Price, terms, vendor, scope, age, and competitive-award status are resolved and locked by the server; checkboxes cannot certify them.</p>
        <div className="grid gap-3 sm:grid-cols-2">{([
          ['priorRequestId', 'Prior request ID'], ['priorSourcingEventId', 'Prior sourcing event ID'], ['priorAwardId', 'Prior award recommendation ID'], ['priorPurchaseOrderId', 'Prior PO ID'],
        ] as const).map(([key, label]) => <label key={key} className="block text-sm font-semibold text-ink">{label}<input className="input mt-1.5" value={repeat[key] ?? ''} onChange={(event) => updateRepeat({ [key]: event.target.value })} /></label>)}</div>
      </section>}
      {mode === 'emergency_purchase' && <section className="grid gap-3 rounded-md border border-line bg-surface p-3 sm:grid-cols-2" aria-label="Emergency purchase evidence">
        <label className="block text-sm font-semibold text-ink">Emergency basis<select className="input mt-1.5" value={emergency.basis ?? ''} onChange={(event) => updateEmergency({ basis: event.target.value as NonNullable<ProcurementExceptionPack['emergency']>['basis'] || undefined })}><option value="">Select basis</option><option value="life_safety">Life safety</option><option value="environmental">Environmental risk</option><option value="serious_disruption">Serious operational disruption</option></select></label>
        <label className="block text-sm font-semibold text-ink">Authority reference<input className="input mt-1.5" value={emergency.authorityReference ?? ''} onChange={(event) => updateEmergency({ authorityReference: event.target.value })} /></label>
        <label className="block text-sm font-semibold text-ink">Commitment timestamp<input className="input mt-1.5" type="datetime-local" value={emergency.commitmentTimestamp ?? ''} onChange={(event) => updateEmergency({ commitmentTimestamp: event.target.value })} /></label>
        <label className="block text-sm font-semibold text-ink">Retrospective PO due<input className="input mt-1.5" type="datetime-local" value={emergency.retrospectivePoDueAt ?? ''} onChange={(event) => updateEmergency({ retrospectivePoDueAt: event.target.value })} /></label>
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink sm:col-span-2"><input type="checkbox" checked={emergency.minimizedVerbalCommitment === true} onChange={(event) => updateEmergency({ minimizedVerbalCommitment: event.target.checked })} />The verbal commitment was limited to what was necessary to contain the emergency.</label>
      </section>}
      <label className="block text-sm font-semibold text-ink">
        Operational, legal, financial, delivery, and data risks with mitigation
        <textarea className="input mt-1.5" rows={4} value={value.risksAndMitigations ?? ''} onChange={(event) => patch({ risksAndMitigations: event.target.value })} />
      </label>
      {pettyCash && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex min-h-11 items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"><input type="checkbox" className="h-5 w-5" checked={value.nonRecurringNonSplitAttested ?? false} onChange={(event) => patch({ nonRecurringNonSplitAttested: event.target.checked })} />One-time, non-recurring, and not split</label>
          <label className="flex min-h-11 items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"><input type="checkbox" className="h-5 w-5" checked={value.receiptOrInvoiceSupported ?? false} onChange={(event) => patch({ receiptOrInvoiceSupported: event.target.checked })} />Receipt or invoice is available</label>
          <label className="flex min-h-11 items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"><input type="checkbox" className="h-5 w-5" checked={value.liquidationRecorded ?? false} onChange={(event) => patch({ liquidationRecorded: event.target.checked })} />Liquidation will be recorded</label>
        </div>
      )}
      {mode === 'approved_exception' && <><label className="block text-sm font-semibold text-ink">Approved exception pack ID<input className="input mt-1.5" value={value.approvedExceptionPackId ?? ''} onChange={(event) => patch({ approvedExceptionPackId: event.target.value })} /></label><label className="block text-sm font-semibold text-ink">Evidence references (one per line)<textarea className="input mt-1.5" rows={3} value={references.join('\n')} onChange={(event) => updateReference(event.target.value)} /></label></>}
      <section aria-live="polite" className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-950 dark:text-amber-100"><p className="font-semibold">What happens next</p><p className="mt-1">Save the draft, then open its governed exception workspace. Only server-returned blockers and independent Procurement, Finance (petty cash), and DOA decisions can move the request forward.</p></section>
    </section>
  );
}
