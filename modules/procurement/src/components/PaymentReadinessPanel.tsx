'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSession } from '@intra/auth';
import { PaymentDocumentField, PaymentDocumentLink, type PaymentDocument } from './PaymentDocumentField';
import { Badge, Icon, money } from '@intra/ui';
import type {
  AcceptancePack,
  PaymentReadinessPack,
  PaymentReadinessStalenessEvent,
  ProcurementPolicyProfile,
} from '../types';
import { evaluatePaymentPackReadiness } from '../policy';
import { evaluatePaymentEvidence } from '../vendorEligibility';

export interface PaymentReadinessDraft {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  invoiceAmount: number;
  taxAmount: number;
  withholdingAmount: number;
  invoiceOrSiReference: string;
  milestoneSupportReference: string;
  taxWithholdingSupportReference: string;
  foreignVendorEvidenceReference?: string;
}

export interface PaymentReleaseDraft {
  amount: number;
  paymentReference: string;
  paymentMethod: string;
  paidAt: string;
}

export interface AcceptanceLineDraft {
  poLineId: string;
  description: string;
  qcAcceptedQuantity: number;
}

export function PaymentReadinessPanel({
  purchaseOrderId,
  requestId,
  acceptance,
  acceptances,
  acceptanceLines = [],
  pack,
  stalenessEvents = [],
  canAccept,
  canPrepare,
  canReview,
  canRelease,
  purchaseOrderAmount,
  acceptanceType,
  policyProfile,
  foreignVendor: suppliedForeignVendor = false,
  onAccept,
  onPrepare,
  onReview,
  onRelease,
}: {
  purchaseOrderId?: string;
  requestId?: string;
  acceptance?: AcceptancePack;
  acceptances?: AcceptancePack[];
  acceptanceLines?: AcceptanceLineDraft[];
  pack?: PaymentReadinessPack;
  stalenessEvents?: PaymentReadinessStalenessEvent[];
  canAccept: boolean;
  canPrepare: boolean;
  canReview: boolean;
  canRelease: boolean;
  purchaseOrderAmount: number;
  acceptanceType: AcceptancePack['acceptanceType'];
  /** The request-bound active profile returned by the governed PO projection. */
  policyProfile?: ProcurementPolicyProfile;
  foreignVendor?: boolean;
  onAccept: (
    scope: string,
    exceptions: string[],
    acceptedLines: Array<{ poLineId: string; quantity: number }>,
    acceptedAmount?: number,
  ) => Promise<void>;
  onPrepare: (draft: PaymentReadinessDraft) => Promise<void>;
  onReview: (status: 'returned' | 'accepted', note: string) => Promise<void>;
  onRelease: (draft: PaymentReleaseDraft) => Promise<void>;
}) {
  const { mode, supabaseClient } = useSession();
  const [documents, setDocuments] = useState<PaymentDocument[]>([]);
  const [packDocuments, setPackDocuments] = useState<PaymentDocument[]>([]);
  const [foreignVendor, setForeignVendor] = useState(suppliedForeignVendor);
  const [evidenceReady, setEvidenceReady] = useState(mode !== 'supabase');
  const [prepareError, setPrepareError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const refreshDocuments = useCallback(async () => {
    if (mode !== 'supabase' || !supabaseClient || !purchaseOrderId) return;
    setEvidenceReady(false);
    const result = await supabaseClient.schema('procurement').rpc('payment_evidence_options', { payload: { purchase_order_id: purchaseOrderId, pack_id: pack?.id } });
    if (result.error) { setPrepareError(result.error.message); return; }
    setDocuments(result.data.documents); setPackDocuments(result.data.packDocuments ?? []); setForeignVendor(result.data.foreignVendor); setEvidenceReady(true);
  }, [mode, supabaseClient, purchaseOrderId, pack?.id]);
  useEffect(() => { void refreshDocuments().catch(cause => setPrepareError(String(cause))); }, [refreshDocuments, pack?.id]);
  const [scope, setScope] = useState('Delivered scope matches the approved PO and request.');
  const [exceptionsText, setExceptionsText] = useState('');
  const [acceptedQuantities, setAcceptedQuantities] = useState<Record<string, number>>({});
  const [financeNote, setFinanceNote] = useState('');
  const [acceptedAmount, setAcceptedAmount] = useState(purchaseOrderAmount);
  const [release, setRelease] = useState<PaymentReleaseDraft>({
    amount: Math.max((pack?.invoiceAmount ?? 0) - (pack?.releasedAmount ?? 0), 0),
    paymentReference: '',
    paymentMethod: 'bank_transfer',
    paidAt: new Date().toISOString().slice(0, 10),
  });
  const [draft, setDraft] = useState<PaymentReadinessDraft>({
    invoiceNumber: pack?.invoiceNumber ?? '',
    invoiceDate: pack?.invoiceDate ?? '',
    dueDate: pack?.dueDate ?? '',
    invoiceAmount: pack?.invoiceAmount ?? 0,
    taxAmount: pack?.taxAmount ?? 0,
    withholdingAmount: pack?.withholdingAmount ?? 0,
    invoiceOrSiReference: pack?.invoiceOrSiReference ?? '',
    milestoneSupportReference: pack?.milestoneSupportReference ?? '',
    taxWithholdingSupportReference: pack?.taxWithholdingSupportReference ?? '',
    foreignVendorEvidenceReference: '',
  });
  useEffect(() => {
    if (pack && ['accepted','released'].includes(pack.status) && !pack.evidenceStale) {
      setDraft({ invoiceNumber: '', invoiceDate: '', dueDate: '', invoiceAmount: 0, taxAmount: 0, withholdingAmount: 0, invoiceOrSiReference: '', milestoneSupportReference: '', taxWithholdingSupportReference: '', foreignVendorEvidenceReference: '' });
      return;
    }
    setDraft({
      invoiceNumber: pack?.invoiceNumber ?? '',
      invoiceDate: pack?.invoiceDate ?? '',
      dueDate: pack?.dueDate ?? '',
      invoiceAmount: pack?.invoiceAmount ?? 0,
      taxAmount: pack?.taxAmount ?? 0,
      withholdingAmount: pack?.withholdingAmount ?? 0,
      invoiceOrSiReference: pack?.invoiceOrSiReference ?? '',
      milestoneSupportReference: pack?.milestoneSupportReference ?? '',
      taxWithholdingSupportReference: pack?.taxWithholdingSupportReference ?? '',
      foreignVendorEvidenceReference: '',
    });
  }, [pack?.id]);
  useEffect(() => {
    setRelease((current) => ({
      ...current,
      amount: Math.max((pack?.invoiceAmount ?? 0) - (pack?.releasedAmount ?? 0), 0),
    }));
  }, [pack?.id, pack?.invoiceAmount, pack?.releasedAmount]);
  useEffect(() => {
    setAcceptedQuantities(
      Object.fromEntries(acceptanceLines.map((line) => [line.poLineId, line.qcAcceptedQuantity])),
    );
  }, [acceptanceLines]);
  const activeAcceptances = useMemo(
    () =>
      (acceptances ?? (acceptance ? [acceptance] : [])).filter(
        (item) => item.status !== 'superseded',
      ),
    [acceptance, acceptances],
  );
  const preview = useMemo<PaymentReadinessPack>(
    () => ({
      id: pack?.id ?? 'draft',
      purchaseOrderId: pack?.purchaseOrderId ?? '',
      acceptancePackId: pack?.acceptancePackId ?? activeAcceptances[0]?.id ?? '',
      acceptancePackIds: activeAcceptances.map((item) => item.id),
      acceptedQuantity:
        pack?.acceptedQuantity ??
        activeAcceptances.reduce((sum, item) => sum + (item.acceptedQuantity ?? 0), 0),
      ...draft,
      poMatch: pack?.poMatch ?? false,
      status: pack?.status ?? 'draft',
      preparedAt: pack?.preparedAt ?? '',
    }),
    [activeAcceptances, draft, pack],
  );
  const blockers = evaluatePaymentPackReadiness(activeAcceptances, preview);
  const evidence = useMemo(
    () =>
      policyProfile
        ? evaluatePaymentEvidence({
            invoiceAmount: draft.invoiceAmount,
            policyProfile,
            invoicePresent: Boolean(draft.invoiceNumber.trim() && draft.invoiceOrSiReference.trim()),
            poPresent: Boolean(pack?.purchaseOrderId),
            acceptancePresent: activeAcceptances.length > 0 && Boolean(draft.milestoneSupportReference.trim()),
            taxEvidencePresent: Boolean(draft.taxWithholdingSupportReference.trim()),
            amountQuantityMatch: Boolean(pack?.poMatch),
            foreignVendor,
            foreignVendorEvidencePresent: !foreignVendor || Boolean(draft.foreignVendorEvidenceReference?.trim()),
          })
        : undefined,
    [activeAcceptances.length, draft, foreignVendor, pack?.poMatch, pack?.purchaseOrderId, policyProfile],
  );
  const exceptions = exceptionsText
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
  const remainingPayment = Math.max((pack?.invoiceAmount ?? 0) - (pack?.releasedAmount ?? 0), 0);
  const acceptanceLabel = acceptanceType === 'goods' ? 'technical' : acceptanceType;

  return (
    <div className="space-y-4">
      {packDocuments.length > 0 && <section aria-label="Payment pack documents" className="space-y-2">{packDocuments.map(document => <PaymentDocumentLink key={document.id} document={document} />)}</section>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-ink">Acceptance and payment readiness</h3>
          <p className="text-xs text-muted">
            Warehouse custody, requester acceptance, Procurement evidence, and Finance review remain
            separate auditable decisions.
          </p>
        </div>
        <Badge tone={blockers.length === 0 ? 'emerald' : 'amber'}>
          {pack?.status === 'accepted' || pack?.status === 'released'
            ? `Finance ${pack.status}`
            : blockers.length === 0
              ? 'Ready for Finance'
              : `${blockers.length} blocker${blockers.length === 1 ? '' : 's'}`}
        </Badge>
      </div>

      {evidence && (
        <section className="space-y-2 rounded-lg border border-line bg-inset p-3" aria-label="Itemized Finance payment evidence">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink">Itemized Finance payment evidence</p>
            <Badge tone={evidence.ready ? 'emerald' : 'amber'}>
              Active Mwell threshold: PHP {evidence.threshold.toLocaleString('en-PH')}
            </Badge>
          </div>
          <p className="text-xs text-muted">
            Source: {evidence.thresholdSource}. Server recomputes payment readiness from governed
            request, PO, acceptance, invoice, tax, and payment records.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {evidence.items.map((item) => (
              <li key={item.label} className="flex items-center gap-2 text-xs text-ink">
                <Icon name={item.present ? 'check' : 'alert'} className={item.present ? 'h-4 w-4 text-emerald-600' : 'h-4 w-4 text-amber-600'} />
                {item.label}
              </li>
            ))}
          </ul>
        </section>
      )}

      {canAccept && (
        <section className="space-y-3 rounded-lg border border-line p-4">
          {acceptanceLines.map((line) => (
            <label key={line.poLineId} className="block text-sm font-semibold text-ink">
              QC-accepted quantity for {line.description}
              <input
                type="number"
                min={0}
                max={line.qcAcceptedQuantity}
                step={1}
                className="input mt-1.5"
                value={acceptedQuantities[line.poLineId] ?? 0}
                onChange={(event) =>
                  setAcceptedQuantities((current) => ({
                    ...current,
                    [line.poLineId]: Math.min(
                      line.qcAcceptedQuantity,
                      Math.max(0, Number(event.target.value) || 0),
                    ),
                  }))
                }
              />
            </label>
          ))}
          {acceptanceType !== 'goods' && (
            <label className="block text-sm font-semibold text-ink">
              Accepted {acceptanceType === 'service' ? 'service' : 'milestone'} value
              <input
                type="number"
                min={0.01}
                max={purchaseOrderAmount}
                step="0.01"
                className="input mt-1.5"
                value={acceptedAmount}
                onChange={(event) =>
                  setAcceptedAmount(
                    Math.min(purchaseOrderAmount, Math.max(0, Number(event.target.value) || 0)),
                  )
                }
              />
              <span className="mt-1 block text-xs font-normal text-muted">
                Maximum {money(purchaseOrderAmount)}
              </span>
            </label>
          )}
          <label className="block text-sm font-semibold text-ink">
            Accepted scope
            <textarea
              className="input mt-1.5"
              rows={3}
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            />
          </label>
          <label className="block text-sm font-semibold text-ink">
            Exceptions or defects, one per line
            <textarea
              className="input mt-1.5"
              rows={3}
              value={exceptionsText}
              onChange={(event) => setExceptionsText(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-primary w-full sm:w-auto"
            disabled={!scope.trim() || (acceptanceType !== 'goods' && acceptedAmount <= 0)}
            onClick={() =>
              void onAccept(
                scope.trim(),
                exceptions,
                acceptanceLines
                  .map((line) => ({
                    poLineId: line.poLineId,
                    quantity: acceptedQuantities[line.poLineId] ?? 0,
                  }))
                  .filter((line) => line.quantity > 0),
                acceptanceType === 'goods' ? undefined : acceptedAmount,
              )
            }
          >
            <Icon name="check" className="h-4 w-4" />
            Record {acceptanceLabel} acceptance
          </button>
        </section>
      )}

      {activeAcceptances.length > 0 && (
        <section className="space-y-2" aria-label="Active acceptance packs">
          <p className="text-sm font-semibold text-ink">
            {activeAcceptances.length} active acceptance pack
            {activeAcceptances.length === 1 ? '' : 's'} · {preview.acceptedQuantity ?? 0} accepted
            unit(s)
          </p>
          <ul className="divide-y divide-line rounded-lg border border-line bg-inset px-3">
            {activeAcceptances.map((item) => (
              <li key={item.id} className="py-2 text-sm">
                <p className="font-semibold text-ink">
                  {item.warehouseReceiptReference ?? item.acceptanceType}
                </p>
                <p className="text-xs text-muted">{item.acceptedScope}</p>
                {item.exceptions.length > 0 && (
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                    {item.exceptions.length} exception(s) must be resolved before Finance
                    acceptance.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(pack?.evidenceStale || stalenessEvents.length > 0) && (
        <section
          className="space-y-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-sm text-amber-900 dark:text-amber-200"
          aria-label="Finance evidence staleness history"
        >
          <p className="font-semibold">Finalized Finance decision preserved</p>
          <p>
            Later acceptance evidence changed. Prepare a linked replacement; this decision remains
            immutable for audit.
          </p>
          {pack?.correctedFrom && (
            <p className="font-semibold">Replacement for {pack.correctedFrom}</p>
          )}
          {stalenessEvents.length > 0 && (
            <ol className="space-y-3 border-t border-amber-500/20 pt-2">
              {stalenessEvents.map((event) => (
                <li key={event.id} className="space-y-0.5">
                  <span className="font-semibold">
                    Evidence v{event.priorAcceptanceEvidenceVersion} to v
                    {event.acceptanceEvidenceVersion}
                  </span>
                  <span className="block text-xs">
                    Prior decision:{' '}
                    {event.priorStatus.charAt(0).toUpperCase() + event.priorStatus.slice(1)}
                  </span>
                  {event.financeReviewedByEmail && (
                    <span className="block text-xs">
                      Reviewed by {event.financeReviewedByEmail}
                      {event.financeReviewedAt
                        ? ` / ${new Date(event.financeReviewedAt).toLocaleString()}`
                        : ''}
                    </span>
                  )}
                  {event.financeNote && (
                    <span className="block text-xs">Review note: {event.financeNote}</span>
                  )}
                  <span className="block text-xs">
                    {event.reason} / {new Date(event.recordedAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {canPrepare && activeAcceptances.length > 0 && (
        <section className="space-y-3 rounded-lg border border-line p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-ink">
              Invoice / SI number
              <input
                className="input mt-1.5"
                value={draft.invoiceNumber}
                onChange={(event) => setDraft({ ...draft, invoiceNumber: event.target.value })}
              />
            </label>
            <label className="block text-sm font-semibold text-ink">
              Invoice amount
              <input
                type="number"
                min={0.01}
                step="0.01"
                className="input mt-1.5"
                value={draft.invoiceAmount}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    invoiceAmount: Math.max(0, Number(event.target.value) || 0),
                  })
                }
              />
            </label>
            <label className="block text-sm font-semibold text-ink">
              Invoice date
              <input
                type="date"
                className="input mt-1.5"
                value={draft.invoiceDate}
                onChange={(event) => setDraft({ ...draft, invoiceDate: event.target.value })}
              />
            </label>
            <label className="block text-sm font-semibold text-ink">
              Due date
              <input
                type="date"
                className="input mt-1.5"
                value={draft.dueDate}
                onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })}
              />
            </label>
            <label className="block text-sm font-semibold text-ink">
              Tax amount
              <input
                type="number"
                min={0}
                step="0.01"
                className="input mt-1.5"
                value={draft.taxAmount}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    taxAmount: Math.max(0, Number(event.target.value) || 0),
                  })
                }
              />
            </label>
            <label className="block text-sm font-semibold text-ink">
              Withholding amount
              <input
                type="number"
                min={0}
                step="0.01"
                className="input mt-1.5"
                value={draft.withholdingAmount}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    withholdingAmount: Math.max(0, Number(event.target.value) || 0),
                  })
                }
              />
            </label>
          </div>
          {(
            [
              ['invoiceOrSiReference', 'Invoice, OR, or SI private reference'],
              ['milestoneSupportReference', 'Delivery or milestone private reference'],
              ['taxWithholdingSupportReference', 'Tax and withholding private reference'],
              ...(foreignVendor
                ? [['foreignVendorEvidenceReference', 'Foreign-vendor tax and payment-control reference'] as const]
                : []),
            ] as const
          ).map(([key, label]) => (
            mode === 'supabase' && purchaseOrderId && requestId ? <PaymentDocumentField
              key={key} label={label.replace('private reference','document').replace('reference','document')}
              purpose={key === 'invoiceOrSiReference' ? 'invoice' : key === 'milestoneSupportReference' ? 'acceptance' : key === 'taxWithholdingSupportReference' ? 'tax' : 'foreign'}
              value={draft[key] ?? ''} documents={documents} poId={purchaseOrderId} requestId={requestId}
              onChange={value => setDraft(current => ({ ...current, [key]: value }))} refresh={refreshDocuments}
            /> : <label key={key} className="block text-sm font-semibold text-ink">
              {label}
              <input
                className="input mt-1.5"
                value={draft[key]}
                onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}
              />
            </label>
          ))}
          {prepareError && <p role="alert" className="text-sm text-rose-700 [overflow-wrap:anywhere]">{prepareError}</p>}
          <button
            type="button"
            className="btn-primary w-full sm:w-auto"
            disabled={
              !evidenceReady || preparing ||
              !draft.invoiceNumber.trim() ||
              !draft.invoiceDate ||
              draft.invoiceAmount <= 0 ||
              !draft.invoiceOrSiReference.trim() ||
              !draft.milestoneSupportReference.trim() ||
              !draft.taxWithholdingSupportReference.trim() ||
              (foreignVendor && !draft.foreignVendorEvidenceReference?.trim())
            }
            onClick={async () => {
              setPreparing(true); setPrepareError('');
              try { await onPrepare(draft); }
              catch (cause) { setPrepareError(cause instanceof Error ? cause.message : 'Payment preparation failed. Review the evidence.'); }
              finally { setPreparing(false); }
            }}
          >
            <Icon name="check" className="h-4 w-4" />
            Validate match and send to Finance
          </button>
        </section>
      )}

      {canReview && pack?.status === 'ready_for_finance' && (
        <section className="space-y-3 rounded-lg border border-line p-4">
          <label className="block text-sm font-semibold text-ink">
            Finance review note
            <textarea
              className="input mt-1.5"
              rows={3}
              value={financeNote}
              onChange={(event) => setFinanceNote(event.target.value)}
            />
          </label>
          <div className="grid gap-2 sm:flex sm:flex-wrap">
            <button
              type="button"
              className="btn-outline"
              disabled={!financeNote.trim()}
              onClick={() => void onReview('returned', financeNote.trim())}
            >
              <Icon name="rotate" className="h-4 w-4" />
              Return for correction
            </button>
            <button
              type="button"
              className="btn-primary"
              disabled={blockers.length > 0}
              onClick={() => void onReview('accepted', financeNote)}
            >
              <Icon name="check" className="h-4 w-4" />
              Accept for payment
            </button>
          </div>
        </section>
      )}

      {canRelease && pack?.status === 'accepted' && (
        <section className="space-y-3 rounded-lg border border-line p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="font-semibold text-ink">Record payment release</h4>
              <p className="text-xs text-muted">
                Invoice {pack.invoiceNumber ?? 'reference pending'} / remaining{' '}
                {money(remainingPayment)}
              </p>
            </div>
            <Badge tone="cyan">{money(pack.releasedAmount ?? 0)} released</Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm font-semibold text-ink">
              Release amount
              <input
                type="number"
                min={0.01}
                max={remainingPayment}
                step="0.01"
                className="input mt-1.5"
                value={release.amount}
                onChange={(event) =>
                  setRelease({
                    ...release,
                    amount: Math.min(
                      remainingPayment,
                      Math.max(0, Number(event.target.value) || 0),
                    ),
                  })
                }
              />
            </label>
            <label className="block text-sm font-semibold text-ink">
              Payment date
              <input
                type="date"
                className="input mt-1.5"
                value={release.paidAt}
                onChange={(event) => setRelease({ ...release, paidAt: event.target.value })}
              />
            </label>
            <label className="block text-sm font-semibold text-ink">
              Payment reference
              <input
                className="input mt-1.5"
                value={release.paymentReference}
                onChange={(event) =>
                  setRelease({
                    ...release,
                    paymentReference: event.target.value,
                  })
                }
              />
            </label>
            <label className="block text-sm font-semibold text-ink">
              Payment method
              <select
                className="input mt-1.5"
                value={release.paymentMethod}
                onChange={(event) => setRelease({ ...release, paymentMethod: event.target.value })}
              >
                <option value="bank_transfer">Bank transfer</option>
                <option value="check">Check</option>
                <option value="corporate_card">Corporate card</option>
                <option value="other">Other</option>
              </select>
            </label>
          </div>
          <button
            type="button"
            className="btn-primary w-full sm:w-auto"
            disabled={release.amount <= 0 || !release.paymentReference.trim() || !release.paidAt}
            onClick={() =>
              void onRelease({
                ...release,
                paymentReference: release.paymentReference.trim(),
              })
            }
          >
            <Icon name="check" className="h-4 w-4" />
            Post payment release
          </button>
        </section>
      )}

      {blockers.length > 0 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {blockers.map((blocker) => (
            <li
              key={blocker}
              className="flex min-h-11 items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-ink"
            >
              <Icon name="alert" className="h-4 w-4 shrink-0 text-amber-600" />
              {blocker}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
