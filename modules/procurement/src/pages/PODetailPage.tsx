'use client';

import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import {
  Badge,
  Card,
  DataTable,
  HeroChipButton,
  HeroStat,
  Icon,
  InfoTip,
  ModuleHero,
  SectionTitle,
  Sheet,
  SignaturePad,
  money,
  useToast,
  type Column,
  type SignaturePayload,
} from '@intra/ui';
import { Guard, useCan, useSession } from '@intra/auth';
import type { PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatus } from '../types';
import {
  isAccredited,
  useProcurementRequests,
  useProcurementVendors,
  usePurchaseOrders,
} from '../localStore';
import { evaluateIssueReadiness } from '../policy';
import { evaluateCommitmentReadiness } from '../policy';
import { PaymentReadinessPanel, type PaymentReadinessDraft } from '../components/PaymentReadinessPanel';
import { ProcurementAccessDenied } from '../components/ProcurementAccessDenied';
import {
  accreditationLabel,
  formatDate,
  formatDateTime,
  poStatusLabel,
} from '../labels';
import { makeTypedSignature } from '../signature';

const PO_TONE: Record<PurchaseOrderStatus, 'slate' | 'cyan' | 'amber' | 'emerald' | 'rose'> = {
  draft: 'slate',
  pending_approval: 'amber',
  approved: 'cyan',
  issued: 'cyan',
  closed: 'emerald',
  cancelled: 'rose',
};

const lineColumns: Column<PurchaseOrderLine>[] = [
  { key: 'description', header: 'Description', render: (r) => r.description },
  { key: 'quantity', header: 'Ordered', render: (r) => `${r.quantity} ${r.uom ?? 'ea'}` },
  { key: 'received', header: 'Received', render: (r) => `${r.receivedQuantity} / ${r.quantity}` },
  {
    key: 'unitPrice',
    header: 'Unit price',
    render: (r) => (r.unitPrice != null ? money(r.unitPrice) : '—'),
  },
  {
    key: 'lineTotal',
    header: 'Line total',
    render: (r) => (r.unitPrice != null ? money(r.unitPrice * r.quantity) : '—'),
  },
];

export function PODetailPage() {
  const { id = '' } = useParams();
  const {
    rows, approve, issue, cancel, recordAcceptance,
    createPolicyEvidence, reviewPolicyEvidence, supersedePolicyEvidence,
    createFinancialProtection, reviewFinancialProtection, supersedeFinancialProtection,
    preparePayment, reviewPayment, loading,
  } = usePurchaseOrders();
  const { rows: requests } = useProcurementRequests();
  const vendors = useProcurementVendors();
  const { profile } = useSession();
  const { success, error } = useToast();
  const canApproveAward = useCan('procurement', 'approve_award');
  const canAuthorPo = useCan('procurement', 'author_po');
  const canViewFinance = useCan('procurement', 'view_finance');
  const canAdmin = useCan('procurement', 'admin');
  const canReceiveInWarehouse = useCan('warehouse', 'receive_stock');
  const po: PurchaseOrder | undefined = useMemo(() => rows.find((r) => r.id === id), [rows, id]);
  const vendor = useMemo(
    () => (po ? vendors.find((v) => v.id === po.vendorId) : undefined),
    [po, vendors],
  );
  const sourceRequest = useMemo(
    () => (po?.requestId ? requests.find((r) => r.id === po.requestId) : undefined),
    [po, requests],
  );
  const isSourceRequester = Boolean(
    profile?.email && sourceRequest?.requesterEmail === profile.email,
  );
  const canViewPurchaseOrders =
    canAuthorPo || canApproveAward || canViewFinance || canAdmin || isSourceRequester;

  // Signature-capture sheet state for the award approval flow.
  const [signOpen, setSignOpen] = useState(false);
  const [signature, setSignature] = useState<SignaturePayload | null>(null);
  const [approvalNote, setApprovalNote] = useState('');
  const [evidenceControlCode, setEvidenceControlCode] = useState('');
  const [evidenceType, setEvidenceType] = useState('document');
  const [evidenceFacts, setEvidenceFacts] = useState('{}');
  const [protectionType, setProtectionType] = useState('performance_bond');
  const [protectionBasis, setProtectionBasis] = useState('Contract commitment');
  const [protectionAmount, setProtectionAmount] = useState('');

  // PR-15 parity with the approval inbox: a prefilled signer name arms the
  // confirm button; the pad can still replace the seeded typed signature.
  const seededSignature = useMemo(
    () => (signOpen ? makeTypedSignature(profile?.name) : null),
    [signOpen, profile?.name],
  );
  const effectiveSignature = signature ?? seededSignature;

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="h-40 animate-pulse rounded-3xl bg-inset" />
        <div className="h-32 animate-pulse rounded-2xl bg-inset" />
      </div>
    );
  }
  if (!canViewPurchaseOrders) {
    return (
      <ProcurementAccessDenied
        title="No purchase order access"
        message="Purchase order details are restricted to procurement officers, approvers, finance, and procurement admins."
      />
    );
  }
  if (!po) return <Navigate to="/purchase-orders" replace />;

  const accreditationOk = vendor ? isAccredited(vendor) : false;
  const sourceAwardOk = sourceRequest?.status === 'approved';
  const databaseCommitmentBlockers = po.commitmentReadiness?.blockers;
  const issueBlockers = [...evaluateIssueReadiness({
    poApproved: po.status === 'approved',
    sourceAwardApproved: sourceAwardOk,
    vendorEligible: accreditationOk,
  }), ...(databaseCommitmentBlockers ?? evaluateCommitmentReadiness({
    sourcingMethod: sourceRequest?.sourcingMethod ?? 'rfq',
    vendorEligible: accreditationOk,
    category: sourceRequest?.category,
    exceptionPack: sourceRequest?.exceptionPack ?? sourceRequest?.compliance?.exceptionPack,
    importationRequired: sourceRequest?.riskFacts?.importation ?? sourceRequest?.compliance?.riskFacts?.importation,
    importationPlan: sourceRequest?.importationPlan ?? sourceRequest?.compliance?.importationPlan,
    construction: sourceRequest?.category === 'construction',
  }))];
  const fullyReceived = po.receiptStatus
    ? po.receiptStatus.outstandingQuantity <= 0
    : po.lines.every((line) => line.receivedQuantity >= line.quantity);

  function openApprovalSheet() {
    if (databaseCommitmentBlockers?.length) {
      error(`Cannot approve yet: ${databaseCommitmentBlockers.join(', ')}.`);
      return;
    }
    if (!accreditationOk) {
      error('Vendor accreditation or scoped temporary clearance must be current to approve this PO.');
      return;
    }
    if (!sourceAwardOk) {
      error('The source request must complete its approval ladder before the PO award can be approved.');
      return;
    }
    setSignature(null);
    setApprovalNote('');
    setSignOpen(true);
  }

  async function confirmApproval() {
    if (!po) return;
    const sig = signature ?? makeTypedSignature(profile?.name);
    if (!sig) return;
    const next = await approve(po.id, {
      email: profile?.email,
      note: approvalNote || undefined,
      signature: sig,
    });
    if (next) {
      success(`PO ${next.poNumber} approved`);
      setSignOpen(false);
      setSignature(null);
      setApprovalNote('');
    } else {
      error('Could not save the approval.');
    }
  }
  async function handleIssue() {
    if (!po) return;
    if (issueBlockers.length > 0) {
      error(`Cannot issue yet: ${issueBlockers.join(', ')}.`);
      return;
    }
    const next = await issue(po.id, {
      sourceAwardApproved: sourceAwardOk,
      vendorEligible: accreditationOk,
    });
    if (next) success(`PO ${next.poNumber} issued`);
    else error('Could not issue the PO because a policy prerequisite changed. Refresh and review the blockers.');
  }
  async function handleCancel() {
    if (!po) return;
    const next = await cancel(po.id);
    if (next) success(`PO ${next.poNumber} cancelled`);
  }

  async function handleAcceptance(scope: string, exceptions: string[], acceptedLines: Array<{ poLineId: string; quantity: number }>) {
    if (!po) return;
    const next = await recordAcceptance(po.id, {
      acceptanceType: sourceRequest?.category === 'services' || sourceRequest?.category === 'subscription'
        ? 'service' : 'goods',
      acceptedScope: scope,
      acceptedLines,
      exceptions,
      actorEmail: profile?.email,
    });
    if (next) success('Technical acceptance recorded');
    else error('Could not record acceptance. A goods receipt or authorized requester is required.');
  }

  async function handleAddEvidence() {
    if (!po?.requestId || !evidenceControlCode.trim()) return;
    let facts: Record<string, unknown>;
    try {
      const parsed = JSON.parse(evidenceFacts) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
      facts = parsed as Record<string, unknown>;
    } catch { error('Evidence facts must be valid JSON.'); return; }
    await createPolicyEvidence(po.requestId, { controlCode: evidenceControlCode.trim(), evidenceType: evidenceType.trim(), facts });
    setEvidenceControlCode('');
    success('Policy evidence submitted for review');
  }

  async function handleAddProtection() {
    if (!po?.requestId || !protectionType.trim() || !protectionBasis.trim()) return;
    await createFinancialProtection(po.requestId, { protectionType: protectionType.trim(), triggerBasis: protectionBasis.trim(), requiredAmount: protectionAmount ? Number(protectionAmount) : undefined });
    success('Financial protection requirement added');
  }

  async function handlePreparePayment(draft: PaymentReadinessDraft) {
    if (!po) return;
    const next = await preparePayment(po.id, { ...draft, actorEmail: profile?.email });
    if (next) success('Payment evidence sent to Finance');
    else error('Could not prepare payment readiness. Record acceptance first.');
  }

  async function handleReviewPayment(status: 'returned' | 'accepted', note: string) {
    if (!po) return;
    const next = await reviewPayment(po.id, { status, note, actorEmail: profile?.email });
    if (next) success(status === 'accepted' ? 'Payment pack accepted' : 'Payment pack returned for correction');
    else error('Could not save the Finance review.');
  }

  // PR-27: hero primary action = the PO's current lifecycle action.
  const heroAction =
    po.status === 'draft' && canApproveAward && accreditationOk && sourceAwardOk ? (
      <HeroChipButton icon="signature" onClick={openApprovalSheet}>
        Sign & approve award
      </HeroChipButton>
    ) : po.status === 'approved' && issueBlockers.length === 0 ? (
      <HeroChipButton icon="rotate" onClick={handleIssue}>
        Issue to vendor
      </HeroChipButton>
    ) : po.status === 'issued' && !fullyReceived && canReceiveInWarehouse ? (
      <HeroChipButton icon="box" href={`/warehouse/purchase-orders/${po.id}`}>
        Open Warehouse handoff
      </HeroChipButton>
    ) : (
      <HeroChipButton href="/procurement/purchase-orders" icon="arrowRight">
        Back to POs
      </HeroChipButton>
    );

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ModuleHero
        eyebrow={`Purchase order · ${po.poNumber}`}
        title={po.vendorName}
        description={po.notes || undefined}
        icon="cart"
        action={heroAction}
        accessory={
          <div className="flex flex-wrap items-end gap-3">
            <HeroStat label="Status">
              <Badge tone={PO_TONE[po.status]}>{poStatusLabel(po.status)}</Badge>
            </HeroStat>
            <HeroStat label="Total" align="right">
              <p className="tnum font-display text-2xl font-extrabold text-ink">{money(po.total)}</p>
            </HeroStat>
          </div>
        }
      />

      {/* PR-20 treatment: one muted meta line instead of a tile grid. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        {vendor && (
          <Badge tone={accreditationOk ? 'emerald' : 'rose'}>
            {accreditationLabel(vendor.accreditationStatus)}
            {vendor.accreditationExpiresAt
              ? ` · expires ${formatDate(vendor.accreditationExpiresAt)}`
              : ''}
          </Badge>
        )}
        <span>
          Authored by{' '}
          <span className="font-medium text-ink">{po.actorEmail ?? '—'}</span>
          {sourceRequest && (
            <>
              {' '}· from a request by{' '}
              <span className="font-medium text-ink">
                {sourceRequest.requesterName ?? sourceRequest.requesterEmail ?? '—'}
              </span>
            </>
          )}
        </span>
        <InfoTip
          label="Full PO record"
          content={
            <span className="block space-y-0.5">
              <span className="block">Created {formatDateTime(po.createdAt)}</span>
              <span className="block">Updated {formatDateTime(po.updatedAt)}</span>
              {po.expectedDate && (
                <span className="block">Expected {formatDate(po.expectedDate)}</span>
              )}
              <span className="block">Origin: {po.origin === 'procurement' ? 'Procurement' : 'Warehouse'}</span>
            </span>
          }
        />
      </div>

      {!accreditationOk && (po.status === 'draft' || po.status === 'pending_approval') && (
        <Card className="border-rose-500/30 bg-rose-500/5">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-rose-500/15 text-rose-800 dark:text-rose-300">
              <Icon name="alert" className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-ink">Award blocked — vendor accreditation isn&apos;t current.</p>
              <p className="mt-0.5 text-sm text-muted">
                Ask Legal to close the accreditation case (status must be
                <span className="mx-1 font-semibold">Accredited</span>
                and not expired) before this PO can be approved.
              </p>
            </div>
          </div>
        </Card>
      )}

      {!sourceAwardOk && (po.status === 'draft' || po.status === 'pending_approval' || po.status === 'approved') && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <div className="flex items-start gap-3">
            <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div>
              <p className="font-semibold text-ink">PO blocked - source award is not approved.</p>
              <p className="text-sm text-muted">Complete the request approval ladder and preserve the Award Recommendation before approval or issue.</p>
            </div>
          </div>
        </Card>
      )}

      <div>
        <SectionTitle title="Line items" subtitle={`${po.lines.length} line${po.lines.length === 1 ? '' : 's'}`} />
        <DataTable rows={po.lines} columns={lineColumns} keyOf={(r) => r.id} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {po.status === 'draft' && (
          <Guard module="procurement" cap="approve_award" fallback={null}>
            <button
              type="button"
              onClick={openApprovalSheet}
              disabled={!accreditationOk || !sourceAwardOk}
              className="btn-primary"
            >
              <Icon name="signature" className="h-4 w-4" />
              Sign & approve award
            </button>
          </Guard>
        )}
        {po.status === 'approved' && (
          <button
            type="button"
            onClick={handleIssue}
            disabled={issueBlockers.length > 0}
            className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Icon name="rotate" className="h-4 w-4" />
            Issue to vendor
          </button>
        )}
        {(po.status === 'draft' || po.status === 'approved' || po.status === 'issued') && (
          <button type="button" onClick={handleCancel} className="btn-outline">
            Cancel PO
          </button>
        )}
        {po.requestId && (
          <Link to={`/requests/${po.requestId}`} className="btn-ghost">
            <Icon name="clipboard" className="h-4 w-4" />
            Source request
          </Link>
        )}
      </div>

      {po.commitmentReadiness ? (
        <div>
          <SectionTitle
            title="Commitment controls"
            subtitle="Transactional policy evidence evaluated by the database for this PO."
          />
          <Card>
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold text-ink">
                {po.commitmentReadiness.ready ? 'Ready to commit' : 'Commitment blocked'}
              </span>
              <span className={po.commitmentReadiness.ready ? 'chip bg-emerald-500/15 text-emerald-700' : 'chip bg-rose-500/15 text-rose-700'}>
                {po.commitmentReadiness.phase}
              </span>
            </div>
            {po.commitmentReadiness.blockers.length ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-rose-700">
                {po.commitmentReadiness.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
            ) : null}
            {po.commitmentReadiness.evidence.length ? (
              <div className="mt-4 divide-y divide-line border-t border-line">
                {po.commitmentReadiness.evidence.map((evidence) => (
                  <div key={evidence.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="font-medium text-ink">{evidence.controlCode}</span>
                    <span className="text-muted">{evidence.evidenceType} · {evidence.reviewStatus}</span>
                    <div className="flex gap-2">
                      {canApproveAward && evidence.reviewStatus === 'submitted' ? <><button type="button" className="btn-ghost btn-sm" onClick={() => void reviewPolicyEvidence(evidence.id, 'approved')}>Approve</button><button type="button" className="btn-ghost btn-sm" onClick={() => void reviewPolicyEvidence(evidence.id, 'rejected')}>Reject</button></> : null}
                      {canAuthorPo && evidence.reviewStatus !== 'superseded' ? <button type="button" className="btn-ghost btn-sm" onClick={() => void supersedePolicyEvidence(evidence.id)}>Supersede</button> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {po.commitmentReadiness.protections.length ? (
              <div className="mt-4 divide-y divide-line border-t border-line">
                {po.commitmentReadiness.protections.map((protection) => (
                  <div key={protection.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                    <span className="font-medium text-ink">{protection.protectionType}</span>
                    <span className="text-muted">{protection.triggerBasis} · {protection.status}</span>
                    <div className="flex gap-2">
                      {(canApproveAward || canViewFinance) && ['required', 'provided'].includes(protection.status) ? <><button type="button" className="btn-ghost btn-sm" onClick={() => void reviewFinancialProtection(protection.id, 'approved')}>Approve</button><button type="button" className="btn-ghost btn-sm" onClick={() => void reviewFinancialProtection(protection.id, 'waived')}>Waive</button></> : null}
                      {canAuthorPo && protection.status !== 'superseded' ? <button type="button" className="btn-ghost btn-sm" onClick={() => void supersedeFinancialProtection(protection.id)}>Supersede</button> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {canAuthorPo && po.requestId ? (
              <div className="mt-4 grid gap-4 border-t border-line pt-4 lg:grid-cols-2">
                <section className="space-y-2">
                  <label className="block text-sm font-semibold text-ink">Control code<input className="input mt-1" value={evidenceControlCode} onChange={(event) => setEvidenceControlCode(event.target.value)} /></label>
                  <label className="block text-sm font-semibold text-ink">Evidence type<input className="input mt-1" value={evidenceType} onChange={(event) => setEvidenceType(event.target.value)} /></label>
                  <label className="block text-sm font-semibold text-ink">Evidence facts (JSON)<textarea className="input mt-1" rows={3} value={evidenceFacts} onChange={(event) => setEvidenceFacts(event.target.value)} /></label>
                  <button type="button" className="btn-outline" disabled={!evidenceControlCode.trim()} onClick={() => void handleAddEvidence()}><Icon name="plus" className="h-4 w-4" />Add policy evidence</button>
                </section>
                <section className="space-y-2">
                  <label className="block text-sm font-semibold text-ink">Protection type<input className="input mt-1" value={protectionType} onChange={(event) => setProtectionType(event.target.value)} /></label>
                  <label className="block text-sm font-semibold text-ink">Trigger basis<input className="input mt-1" value={protectionBasis} onChange={(event) => setProtectionBasis(event.target.value)} /></label>
                  <label className="block text-sm font-semibold text-ink">Required amount<input className="input mt-1" type="number" min={0} value={protectionAmount} onChange={(event) => setProtectionAmount(event.target.value)} /></label>
                  <button type="button" className="btn-outline" onClick={() => void handleAddProtection()}><Icon name="plus" className="h-4 w-4" />Add financial protection</button>
                </section>
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}

      {(po.status === 'issued' || po.status === 'closed') && (
        <div>
          <SectionTitle
            title="Warehouse receiving"
            subtitle="Read-only receipt and quality status from the Warehouse authority."
          />
          <Card>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs font-semibold uppercase text-faint">Accepted</p>
                <p className="tnum mt-1 text-xl font-bold text-ink">
                  {po.receiptStatus?.acceptedQuantity ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-faint">Rejected or quarantined</p>
                <p className="tnum mt-1 text-xl font-bold text-ink">
                  {po.receiptStatus?.rejectedOrQuarantinedQuantity ?? 0}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-faint">Outstanding</p>
                <p className="tnum mt-1 text-xl font-bold text-ink">
                  {po.receiptStatus?.outstandingQuantity ?? po.lines.reduce(
                    (sum, line) => sum + Math.max(line.quantity - line.receivedQuantity, 0),
                    0,
                  )}
                </p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-sm text-muted">
              <span>
                QC: <strong className="text-ink">{po.receiptStatus?.latestQcStatus ?? 'not_received'}</strong>
                {po.receiptStatus?.latestReceiptReference
                  ? ` · Latest receipt ${po.receiptStatus.latestReceiptReference}`
                  : ''}
              </span>
              {canReceiveInWarehouse && po.status === 'issued' && !fullyReceived ? (
              <Link to={`/warehouse/purchase-orders?po=${encodeURIComponent(po.id)}`} className="btn-outline">
                  Open Warehouse handoff
                </Link>
              ) : null}
            </div>
          </Card>
        </div>
      )}

      {(po.status === 'issued' || po.status === 'closed') && (
        <div>
          <SectionTitle
            title="Payment handoff"
            subtitle="Acceptance and three-way evidence are required before Finance release."
          />
          <Card>
            <PaymentReadinessPanel
              acceptance={po.acceptancePack}
              acceptanceLines={(po.receiptStatus?.acceptedLines ?? []).map((line) => ({
                poLineId: line.poLineId,
                description: po.lines.find((poLine) => poLine.id === line.poLineId)?.description ?? line.poLineId,
                qcAcceptedQuantity: line.acceptedQuantity,
              }))}
              pack={po.paymentReadiness}
              canAccept={Boolean(po.commitmentReadiness?.canRecordAcceptance ?? isSourceRequester) && !po.acceptancePack}
              canPrepare={canAuthorPo}
              canReview={canViewFinance}
              onAccept={handleAcceptance}
              onPrepare={handlePreparePayment}
              onReview={handleReviewPayment}
            />
          </Card>
        </div>
      )}

      {po.approvalSignature && (
        <div>
          <SectionTitle
            title="Award signature"
            subtitle="Legally-binding electronic signature captured at approval time (RA 8792)."
          />
          <SignatureBlock
            sig={po.approvalSignature}
            approvedByEmail={po.approvedByEmail}
            approvedAt={po.approvedAt}
          />
        </div>
      )}

      {/* ---------------- Award approval sheet ---------------- */}
      <Sheet
        open={signOpen}
        onOpenChange={setSignOpen}
        title="Sign & approve award"
        description={`PO ${po.poNumber} — ${po.vendorName}`}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setSignOpen(false)}
              className="btn-ghost"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirmApproval}
              disabled={!effectiveSignature}
              className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Icon name="signature" className="h-4 w-4" />
              Sign & approve
            </button>
          </div>
        }
      >
        <div className="space-y-4 p-1">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">{po.vendorName}</p>
              <p className="text-xs text-muted">
                {po.lines.length} line{po.lines.length === 1 ? '' : 's'}
                {vendor ? ` · ${accreditationLabel(vendor.accreditationStatus)}` : ''}
              </p>
            </div>
            <p className="tnum shrink-0 font-display text-xl font-extrabold text-ink">
              {money(po.total)}
            </p>
          </div>
          <p className="text-sm text-muted">
            Approving this award authorises PO {po.poNumber} to be issued to{' '}
            <span className="font-semibold text-ink">{po.vendorName}</span>. Your
            signature is stored on the audit trail alongside the approval.
          </p>
          <div className="space-y-1">
            <label
              htmlFor="po-approval-note"
              className="text-xs font-semibold uppercase tracking-wide text-faint"
            >
              Note (optional)
            </label>
            <textarea
              id="po-approval-note"
              value={approvalNote}
              onChange={(e) => setApprovalNote(e.target.value)}
              rows={3}
              className="input"
              placeholder="Add context that should live on the audit trail…"
            />
          </div>
          <div className="space-y-2 rounded-2xl border border-line bg-inset/60 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-faint">
              <Icon name="signature" className="h-4 w-4" />
              Electronic signature (required)
            </div>
            <SignaturePad
              defaultSignerName={profile?.name ?? ''}
              onChange={setSignature}
              consentLabel="Your e-signature is logged on the approval audit trail (RA 8792)."
            />
            {!signature && seededSignature && (
              <p className="rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-800 dark:text-emerald-300">
                <Icon name="check" className="mr-1 inline h-3.5 w-3.5" />
                Ready to sign as{' '}
                <span className="font-semibold">{seededSignature.signerName}</span>{' '}
                (typed signature) — or draw / re-type to replace it.
              </p>
            )}
          </div>
        </div>
      </Sheet>

    </div>
  );
}

function SignatureBlock({
  sig,
  approvedByEmail,
  approvedAt,
}: {
  sig: NonNullable<PurchaseOrder['approvalSignature']>;
  approvedByEmail?: string;
  approvedAt?: string;
}) {
  return (
    <Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold text-ink">
            {sig.signerName}
            {approvedByEmail ? (
              <span className="ml-1.5 text-xs font-normal text-muted">
                &lt;{approvedByEmail}&gt;
              </span>
            ) : null}
          </p>
          <p className="text-xs text-muted">
            Signed {formatDateTime(sig.signedAt)}
            {' · '}
            <span className="uppercase tracking-wide">{sig.method}</span>
            {approvedAt && approvedAt !== sig.signedAt
              ? ` · Approved ${formatDateTime(approvedAt)}`
              : ''}
            {/* PR-25: the raw user-agent string stays in the data record —
                it is never rendered. */}
            <InfoTip
              label="Signature evidence"
              className="ml-0.5 align-middle"
              content="A browser fingerprint (user agent + timezone offset) was captured at signing time and lives on the audit record — it is intentionally not displayed here."
            />
          </p>
        </div>
        <div className="shrink-0 rounded-xl border border-line bg-white p-2">
          <img
            src={sig.dataUrl}
            alt={`Signature of ${sig.signerName}`}
            className="h-16 w-56 object-contain"
          />
        </div>
      </div>
    </Card>
  );
}
