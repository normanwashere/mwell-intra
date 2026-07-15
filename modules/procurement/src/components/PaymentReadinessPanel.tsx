'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Icon } from '@intra/ui';
import type { AcceptancePack, PaymentReadinessPack } from '../types';
import { evaluatePaymentPackReadiness } from '../policy';

export interface PaymentReadinessDraft {
  poMatch: boolean;
  invoiceOrSiReference: string;
  milestoneSupportReference: string;
  taxWithholdingSupportReference: string;
}

export interface AcceptanceLineDraft {
  poLineId: string;
  description: string;
  qcAcceptedQuantity: number;
}

export function PaymentReadinessPanel({
  acceptance,
  acceptances,
  acceptanceLines = [],
  pack,
  canAccept,
  canPrepare,
  canReview,
  onAccept,
  onPrepare,
  onReview,
}: {
  acceptance?: AcceptancePack;
  acceptances?: AcceptancePack[];
  acceptanceLines?: AcceptanceLineDraft[];
  pack?: PaymentReadinessPack;
  canAccept: boolean;
  canPrepare: boolean;
  canReview: boolean;
  onAccept: (scope: string, exceptions: string[], acceptedLines: Array<{ poLineId: string; quantity: number }>) => Promise<void>;
  onPrepare: (draft: PaymentReadinessDraft) => Promise<void>;
  onReview: (status: 'returned' | 'accepted', note: string) => Promise<void>;
}) {
  const [scope, setScope] = useState('Delivered scope matches the approved PO and request.');
  const [exceptionsText, setExceptionsText] = useState('');
  const [acceptedQuantities, setAcceptedQuantities] = useState<Record<string, number>>({});
  const [financeNote, setFinanceNote] = useState('');
  const [draft, setDraft] = useState<PaymentReadinessDraft>({
    poMatch: pack?.poMatch ?? false,
    invoiceOrSiReference: pack?.invoiceOrSiReference ?? '',
    milestoneSupportReference: pack?.milestoneSupportReference ?? '',
    taxWithholdingSupportReference: pack?.taxWithholdingSupportReference ?? '',
  });
  useEffect(() => {
    setDraft({
      poMatch: pack?.poMatch ?? false,
      invoiceOrSiReference: pack?.invoiceOrSiReference ?? '',
      milestoneSupportReference: pack?.milestoneSupportReference ?? '',
      taxWithholdingSupportReference: pack?.taxWithholdingSupportReference ?? '',
    });
  }, [pack?.id]);
  useEffect(() => {
    setAcceptedQuantities(Object.fromEntries(
      acceptanceLines.map((line) => [line.poLineId, line.qcAcceptedQuantity]),
    ));
  }, [acceptanceLines]);
  const activeAcceptances = useMemo(() => (acceptances ?? (acceptance ? [acceptance] : []))
    .filter((item) => item.status !== 'superseded'), [acceptance, acceptances]);
  const preview = useMemo<PaymentReadinessPack>(() => ({
    id: pack?.id ?? 'draft', purchaseOrderId: pack?.purchaseOrderId ?? '',
    acceptancePackId: pack?.acceptancePackId ?? activeAcceptances[0]?.id ?? '',
    ...draft, status: pack?.status ?? 'draft', preparedAt: pack?.preparedAt ?? '',
  }), [activeAcceptances, draft, pack]);
  const blockers = evaluatePaymentPackReadiness(activeAcceptances, preview);
  const exceptions = exceptionsText.split('\n').map((value) => value.trim()).filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink">Acceptance and payment readiness</h3>
          <p className="text-xs text-muted">Warehouse custody, requester acceptance, Procurement evidence, and Finance review remain separate auditable decisions.</p>
        </div>
        <Badge tone={blockers.length === 0 ? 'emerald' : 'amber'}>
          {pack?.status === 'accepted' || pack?.status === 'released'
            ? `Finance ${pack.status}`
            : blockers.length === 0 ? 'Ready for Finance' : `${blockers.length} blocker${blockers.length === 1 ? '' : 's'}`}
        </Badge>
      </div>

      {canAccept && (
        <section className="space-y-3 rounded-lg border border-line p-4">
          {acceptanceLines.map((line) => (
            <label key={line.poLineId} className="block text-sm font-semibold text-ink">
              QC-accepted quantity for {line.description}
              <input
                type="number" min={0} max={line.qcAcceptedQuantity} step={1}
                className="input mt-1.5" value={acceptedQuantities[line.poLineId] ?? 0}
                onChange={(event) => setAcceptedQuantities((current) => ({
                  ...current,
                  [line.poLineId]: Math.min(line.qcAcceptedQuantity, Math.max(0, Number(event.target.value) || 0)),
                }))}
              />
            </label>
          ))}
          <label className="block text-sm font-semibold text-ink">Accepted scope<textarea className="input mt-1.5" rows={3} value={scope} onChange={(event) => setScope(event.target.value)} /></label>
          <label className="block text-sm font-semibold text-ink">Exceptions or defects, one per line<textarea className="input mt-1.5" rows={3} value={exceptionsText} onChange={(event) => setExceptionsText(event.target.value)} /></label>
          <button type="button" className="btn-primary" disabled={!scope.trim()} onClick={() => void onAccept(scope.trim(), exceptions, acceptanceLines.map((line) => ({ poLineId: line.poLineId, quantity: acceptedQuantities[line.poLineId] ?? 0 })).filter((line) => line.quantity > 0))}><Icon name="check" className="h-4 w-4" />Record technical acceptance</button>
        </section>
      )}

      {activeAcceptances.length > 0 && <section className="space-y-2" aria-label="Active acceptance packs">
        <p className="text-sm font-semibold text-ink">{activeAcceptances.length} active acceptance pack{activeAcceptances.length === 1 ? '' : 's'}</p>
        <ul className="divide-y divide-line rounded-lg border border-line bg-inset px-3">
          {activeAcceptances.map((item) => <li key={item.id} className="py-2 text-sm">
            <p className="font-semibold text-ink">{item.warehouseReceiptReference ?? item.acceptanceType}</p>
            <p className="text-xs text-muted">{item.acceptedScope}</p>
            {item.exceptions.length > 0 && <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{item.exceptions.length} exception(s) must be resolved before Finance acceptance.</p>}
          </li>)}
        </ul>
      </section>}

      {canPrepare && activeAcceptances.length > 0 && (
        <section className="space-y-3 rounded-lg border border-line p-4">
          <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-ink"><input type="checkbox" className="h-5 w-5" checked={draft.poMatch} onChange={(event) => setDraft({ ...draft, poMatch: event.target.checked })} />PO, receipt/acceptance, and invoice amounts match</label>
          {([
            ['invoiceOrSiReference', 'Invoice, OR, or SI private reference'],
            ['milestoneSupportReference', 'Delivery or milestone private reference'],
            ['taxWithholdingSupportReference', 'Tax and withholding private reference'],
          ] as const).map(([key, label]) => <label key={key} className="block text-sm font-semibold text-ink">{label}<input className="input mt-1.5" value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} /></label>)}
          <button type="button" className="btn-primary" disabled={blockers.length > 0} onClick={() => void onPrepare(draft)}><Icon name="check" className="h-4 w-4" />Send to Finance</button>
        </section>
      )}

      {canReview && pack?.status === 'ready_for_finance' && (
        <section className="space-y-3 rounded-lg border border-line p-4">
          <label className="block text-sm font-semibold text-ink">Finance review note<textarea className="input mt-1.5" rows={3} value={financeNote} onChange={(event) => setFinanceNote(event.target.value)} /></label>
          <div className="flex flex-wrap gap-2"><button type="button" className="btn-outline" onClick={() => void onReview('returned', financeNote)}><Icon name="rotate" className="h-4 w-4" />Return for correction</button><button type="button" className="btn-primary" disabled={blockers.length > 0} onClick={() => void onReview('accepted', financeNote)}><Icon name="check" className="h-4 w-4" />Accept for payment</button></div>
        </section>
      )}

      {blockers.length > 0 && <ul className="grid gap-2 sm:grid-cols-2">{blockers.map((blocker) => <li key={blocker} className="flex min-h-11 items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-ink"><Icon name="alert" className="h-4 w-4 shrink-0 text-amber-600" />{blocker}</li>)}</ul>}
    </div>
  );
}
