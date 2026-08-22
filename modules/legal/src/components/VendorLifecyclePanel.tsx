"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { useSession } from "@intra/auth";
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Icon,
  Sheet,
  useToast,
} from "@intra/ui";
import { lifecyclePresentation } from "../vendorCaseWorkflow";

interface VendorOption {
  id: string;
  name: string;
}

interface LifecycleReview {
  id: string;
  vendorId: string;
  reviewType:
    | "renewal"
    | "document_expiry"
    | "performance"
    | "reassessment"
    | "suspension"
    | "reinstatement"
    | "offboarding";
  status:
    | "open"
    | "under_review"
    | "approved"
    | "rejected"
    | "completed"
    | "cancelled";
  dueDate?: string;
  riskRating?: string;
  score?: number;
  reason: string;
  evidenceUrl?: string;
}

interface LifecycleDecisionDraft {
  rationale: string;
  expiresAt: string;
}

export interface VendorEligibilityProjectionRecord {
  vendorId: string;
  vendorName: string;
  status: 'approved' | 'probation' | 'provisional' | 'expired' | 'suspended' | 'rejected' | 'temporary_clearance';
  eligible: boolean;
  authority: 'Legal/VMO';
  reviewDueAt?: string;
  decision?: 'pass' | 'extend' | 'revoke' | 'suspend';
  poWinRate?: number;
  deliveryCommitmentRate?: number;
  returnOrRejectionCount?: number;
  documentTimelinessRate?: number;
  evidenceReference?: string;
  noticeReference?: string;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function mapReview(row: Record<string, unknown>): LifecycleReview {
  return {
    id: text(row.id),
    vendorId: text(row.vendor_id),
    reviewType: text(row.review_type) as LifecycleReview["reviewType"],
    status: text(row.status) as LifecycleReview["status"],
    dueDate: text(row.due_date) || undefined,
    riskRating: text(row.risk_rating) || undefined,
    score: row.score == null ? undefined : Number(row.score),
    reason: text(row.reason),
    evidenceUrl: text(row.evidence_url) || undefined,
  };
}

function mapEligibilityProjection(row: Record<string, unknown>): VendorEligibilityProjectionRecord {
  return {
    vendorId: text(row.vendorId ?? row.vendor_id),
    vendorName: text(row.vendorName ?? row.vendor_name),
    status: text(row.status) as VendorEligibilityProjectionRecord['status'],
    eligible: row.eligible === true,
    authority: 'Legal/VMO',
    reviewDueAt: text(row.reviewDueAt ?? row.review_due_at) || undefined,
    decision: text(row.decision) as VendorEligibilityProjectionRecord['decision'],
    poWinRate: row.poWinRate == null && row.po_win_rate == null ? undefined : Number(row.poWinRate ?? row.po_win_rate),
    deliveryCommitmentRate: row.deliveryCommitmentRate == null && row.delivery_commitment_rate == null ? undefined : Number(row.deliveryCommitmentRate ?? row.delivery_commitment_rate),
    returnOrRejectionCount: row.returnOrRejectionCount == null && row.return_or_rejection_count == null ? undefined : Number(row.returnOrRejectionCount ?? row.return_or_rejection_count),
    documentTimelinessRate: row.documentTimelinessRate == null && row.document_timeliness_rate == null ? undefined : Number(row.documentTimelinessRate ?? row.document_timeliness_rate),
    evidenceReference: text(row.evidenceReference ?? row.evidence_reference) || undefined,
    noticeReference: text(row.noticeReference ?? row.notice_reference) || undefined,
  };
}

function percentage(value: number | undefined): string {
  return `${Math.round((value ?? 0) * 100)}%`;
}

/** Legal/VMO's authoritative eligibility projection. Procurement only renders it. */
export function VendorEligibilityProjection({
  projection,
}: {
  projection: VendorEligibilityProjectionRecord;
}) {
  return (
    <section className="space-y-2 rounded-lg border border-line bg-inset p-3" aria-label="Vendor eligibility projection">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">{projection.vendorName}</p>
          <p className="text-xs text-muted">Read-only Procurement eligibility projection</p>
        </div>
        <Badge tone={projection.eligible ? 'emerald' : 'rose'}>
          {projection.status.replaceAll('_', ' ')}
        </Badge>
      </div>
      <p className="text-xs text-muted">Authority: {projection.authority}</p>
      {projection.status === 'probation' && (
        <div className="grid gap-1 text-xs text-ink sm:grid-cols-2">
          <span>Six-month probation review{projection.reviewDueAt ? ` / due ${projection.reviewDueAt}` : ''}</span>
          <span>Decision: {projection.decision ?? 'pending'}</span>
          <span>PO win rate {percentage(projection.poWinRate)}</span>
          <span>Delivery commitment {percentage(projection.deliveryCommitmentRate)}</span>
          <span>Returns/rejections {projection.returnOrRejectionCount ?? 0}</span>
          <span>Document timeliness {percentage(projection.documentTimelinessRate)}</span>
        </div>
      )}
      {(projection.evidenceReference || projection.noticeReference) && (
        <div className="grid gap-1 text-xs text-muted sm:grid-cols-2">
          {projection.evidenceReference && <span>Evidence: {projection.evidenceReference}</span>}
          {projection.noticeReference && <span>Notice: {projection.noticeReference}</span>}
        </div>
      )}
    </section>
  );
}

type AuthorityCommand = (payload: Record<string, unknown>) => void | Promise<void>;

/** The only Legal/VMO mutation surface for Task 10 authority records. */
export function VendorEligibilityAuthorityWorkspace({
  vendors,
  probationReviews,
  onRecordProbationReview,
  onRecordEligibilityDecision,
  onRecordTemporaryClearance,
  onDecideTemporaryClearance,
  onRecordSampleCustody,
}: {
  vendors: VendorOption[];
  probationReviews: Array<{ id: string; vendorId: string; revision: number }>;
  onRecordProbationReview: AuthorityCommand;
  onRecordEligibilityDecision: AuthorityCommand;
  onRecordTemporaryClearance: AuthorityCommand;
  onDecideTemporaryClearance?: AuthorityCommand;
  onRecordSampleCustody: AuthorityCommand;
}) {
  const firstVendorId = vendors[0]?.id ?? '';
  const [metrics, setMetrics] = useState({ reviewId: probationReviews[0]?.id ?? '', expectedRevision: probationReviews[0]?.revision ?? 0, poWinRate: '', deliveryCommitmentRate: '', returnOrRejectionCount: '', documentTimelinessRate: '', evidenceReference: '', noticeReference: '' });
  const [decision, setDecision] = useState({ reviewId: probationReviews[0]?.id ?? '', expectedRevision: 0, outcome: 'pass', evidenceReference: '', noticeReference: '' });
  const [clearance, setClearance] = useState({ vendorId: firstVendorId, scope: '', effectiveAt: '', expiresAt: '', amountLimit: '', evidenceReference: '', noticeReference: '' });
  const [clearanceDecision, setClearanceDecision] = useState({ clearanceId: '', expectedRevision: 1, decision: 'approve' });
  const [custody, setCustody] = useState({ vendorId: firstVendorId, purpose: '', custodianId: '', evaluationReference: '', disposition: 'returned', evidenceReference: '', purchaseOrderId: '' });
  return (
    <section className="space-y-4 border-t border-line pt-4" aria-label="Legal VMO eligibility authority workspace">
      <div>
        <p className="text-xs font-semibold uppercase text-faint">Legal/VMO authority</p>
        <h3 className="font-display text-lg font-bold text-ink">Eligibility recovery controls</h3>
      </div>
      <form className="grid gap-3 rounded-lg border border-line p-3" onSubmit={(event) => { event.preventDefault(); void onRecordProbationReview({ probation_review_id: metrics.reviewId, expected_revision: metrics.expectedRevision, po_win_rate: metrics.poWinRate, delivery_commitment_rate: metrics.deliveryCommitmentRate, return_or_rejection_count: metrics.returnOrRejectionCount, document_timeliness_rate: metrics.documentTimelinessRate, evidence_reference: metrics.evidenceReference, notice_reference: metrics.noticeReference }); }}>
        <p className="font-semibold text-ink">Six-month probation metrics</p>
        <Field label="Probation review" htmlFor="probation-review"><select id="probation-review" className="input" value={metrics.reviewId} onChange={(event) => { const review = probationReviews.find((item) => item.id === event.target.value); setMetrics((current) => ({ ...current, reviewId: event.target.value, expectedRevision: review?.revision ?? 0 })); }}>{probationReviews.map((review) => <option key={review.id} value={review.id}>{review.id}</option>)}</select></Field>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Expected revision" htmlFor="probation-revision"><input id="probation-revision" className="input" type="number" min="0" value={metrics.expectedRevision} onChange={(event) => setMetrics((current) => ({ ...current, expectedRevision: Number(event.target.value) }))} /></Field><Field label="PO win rate" htmlFor="probation-win-rate"><input id="probation-win-rate" className="input" type="number" min="0" max="1" step="0.01" value={metrics.poWinRate} onChange={(event) => setMetrics((current) => ({ ...current, poWinRate: event.target.value }))} required /></Field></div>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Delivery commitment rate" htmlFor="probation-delivery-rate"><input id="probation-delivery-rate" className="input" type="number" min="0" max="1" step="0.01" value={metrics.deliveryCommitmentRate} onChange={(event) => setMetrics((current) => ({ ...current, deliveryCommitmentRate: event.target.value }))} required /></Field><Field label="Document timeliness rate" htmlFor="probation-document-rate"><input id="probation-document-rate" className="input" type="number" min="0" max="1" step="0.01" value={metrics.documentTimelinessRate} onChange={(event) => setMetrics((current) => ({ ...current, documentTimelinessRate: event.target.value }))} required /></Field></div>
        <Field label="Returns or rejections" htmlFor="probation-returns"><input id="probation-returns" className="input" type="number" min="0" step="1" value={metrics.returnOrRejectionCount} onChange={(event) => setMetrics((current) => ({ ...current, returnOrRejectionCount: event.target.value }))} required /></Field>
        <Field label="Evidence reference" htmlFor="probation-evidence"><input id="probation-evidence" className="input" value={metrics.evidenceReference} onChange={(event) => setMetrics((current) => ({ ...current, evidenceReference: event.target.value }))} required /></Field>
        <Field label="Notice reference" htmlFor="probation-notice"><input id="probation-notice" className="input" value={metrics.noticeReference} onChange={(event) => setMetrics((current) => ({ ...current, noticeReference: event.target.value }))} required /></Field>
        <button type="submit" className="btn-outline">Record probation evidence</button>
      </form>
      <form className="grid gap-3 rounded-lg border border-line p-3" onSubmit={(event) => { event.preventDefault(); void onRecordEligibilityDecision({ probation_review_id: decision.reviewId, expected_revision: decision.expectedRevision, decision: decision.outcome, evidence_reference: decision.evidenceReference, notice_reference: decision.noticeReference }); }}>
        <p className="font-semibold text-ink">Six-month probation decision</p>
        <Field label="Probation review" htmlFor="eligibility-review"><select id="eligibility-review" className="input" value={decision.reviewId} onChange={(event) => setDecision((current) => ({ ...current, reviewId: event.target.value }))}>{probationReviews.map((review) => <option key={review.id} value={review.id}>{review.id}</option>)}</select></Field>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Expected revision" htmlFor="eligibility-revision"><input id="eligibility-revision" className="input" type="number" min="0" value={decision.expectedRevision} onChange={(event) => setDecision((current) => ({ ...current, expectedRevision: Number(event.target.value) }))} /></Field><Field label="Decision" htmlFor="eligibility-decision"><select id="eligibility-decision" className="input" value={decision.outcome} onChange={(event) => setDecision((current) => ({ ...current, outcome: event.target.value }))}><option value="pass">Pass</option><option value="extend">Extend</option><option value="revoke">Revoke</option><option value="suspend">Suspend</option></select></Field></div>
        <Field label="Evidence reference" htmlFor="eligibility-evidence"><input id="eligibility-evidence" className="input" value={decision.evidenceReference} onChange={(event) => setDecision((current) => ({ ...current, evidenceReference: event.target.value }))} required /></Field>
        <Field label="Notice reference" htmlFor="eligibility-notice"><input id="eligibility-notice" className="input" value={decision.noticeReference} onChange={(event) => setDecision((current) => ({ ...current, noticeReference: event.target.value }))} required /></Field>
        <button type="submit" className="btn-primary">Record governed decision</button>
      </form>
      <form className="grid gap-3 rounded-lg border border-line p-3" onSubmit={(event) => { event.preventDefault(); void onRecordTemporaryClearance({ vendor_id: clearance.vendorId, expected_revision: 0, scope: clearance.scope, effective_at: clearance.effectiveAt, expires_at: clearance.expiresAt, amount_limit: clearance.amountLimit || undefined, evidence_reference: clearance.evidenceReference, notice_reference: clearance.noticeReference }); }}>
        <p className="font-semibold text-ink">Scoped temporary clearance</p>
        <Field label="Vendor" htmlFor="clearance-vendor"><select id="clearance-vendor" className="input" value={clearance.vendorId} onChange={(event) => setClearance((current) => ({ ...current, vendorId: event.target.value }))}>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></Field>
        <Field label="Temporary clearance scope" htmlFor="clearance-scope"><input id="clearance-scope" className="input" value={clearance.scope} onChange={(event) => setClearance((current) => ({ ...current, scope: event.target.value }))} required /></Field>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Effective at" htmlFor="clearance-effective"><input id="clearance-effective" className="input" type="datetime-local" value={clearance.effectiveAt} onChange={(event) => setClearance((current) => ({ ...current, effectiveAt: event.target.value }))} required /></Field><Field label="Expires at" htmlFor="clearance-expires"><input id="clearance-expires" className="input" type="datetime-local" value={clearance.expiresAt} onChange={(event) => setClearance((current) => ({ ...current, expiresAt: event.target.value }))} required /></Field></div>
        <Field label="Amount limit" htmlFor="clearance-amount"><input id="clearance-amount" className="input" type="number" min="0" value={clearance.amountLimit} onChange={(event) => setClearance((current) => ({ ...current, amountLimit: event.target.value }))} /></Field>
        <Field label="Evidence reference" htmlFor="clearance-evidence"><input id="clearance-evidence" className="input" value={clearance.evidenceReference} onChange={(event) => setClearance((current) => ({ ...current, evidenceReference: event.target.value }))} required /></Field>
        <Field label="Notice reference" htmlFor="clearance-notice"><input id="clearance-notice" className="input" value={clearance.noticeReference} onChange={(event) => setClearance((current) => ({ ...current, noticeReference: event.target.value }))} required /></Field>
        <button type="submit" className="btn-outline">Open clearance for independent decision</button>
      </form>
      <form className="grid gap-3 rounded-lg border border-line p-3" onSubmit={(event) => { event.preventDefault(); if (onDecideTemporaryClearance) void onDecideTemporaryClearance({ clearance_id: clearanceDecision.clearanceId, expected_revision: clearanceDecision.expectedRevision, decision: clearanceDecision.decision }); }}>
        <p className="font-semibold text-ink">Independent clearance decision</p>
        <Field label="Clearance ID" htmlFor="clearance-id"><input id="clearance-id" className="input" value={clearanceDecision.clearanceId} onChange={(event) => setClearanceDecision((current) => ({ ...current, clearanceId: event.target.value }))} required /></Field>
        <div className="grid gap-3 sm:grid-cols-2"><Field label="Expected revision" htmlFor="clearance-decision-revision"><input id="clearance-decision-revision" className="input" type="number" min="1" value={clearanceDecision.expectedRevision} onChange={(event) => setClearanceDecision((current) => ({ ...current, expectedRevision: Number(event.target.value) }))} /></Field><Field label="Decision" htmlFor="clearance-decision"><select id="clearance-decision" className="input" value={clearanceDecision.decision} onChange={(event) => setClearanceDecision((current) => ({ ...current, decision: event.target.value }))}><option value="approve">Approve</option><option value="revoke">Revoke</option></select></Field></div>
        <button type="submit" className="btn-primary" disabled={!onDecideTemporaryClearance}>Record independent clearance decision</button>
      </form>
      <form className="grid gap-3 rounded-lg border border-line p-3" onSubmit={(event) => { event.preventDefault(); void onRecordSampleCustody({ vendor_id: custody.vendorId, expected_revision: 0, purpose: custody.purpose, custodian_id: custody.custodianId, evaluation_reference: custody.evaluationReference, disposition: custody.disposition, evidence_reference: custody.evidenceReference, purchase_order_id: custody.purchaseOrderId || undefined, mwell_requested: Boolean(custody.purchaseOrderId) }); }}>
        <p className="font-semibold text-ink">Sample custody evidence</p>
        <Field label="Vendor" htmlFor="custody-vendor"><select id="custody-vendor" className="input" value={custody.vendorId} onChange={(event) => setCustody((current) => ({ ...current, vendorId: event.target.value }))}>{vendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}</select></Field>
        <Field label="Purpose" htmlFor="custody-purpose"><input id="custody-purpose" className="input" value={custody.purpose} onChange={(event) => setCustody((current) => ({ ...current, purpose: event.target.value }))} required /></Field>
        <Field label="Custodian profile ID" htmlFor="custody-owner"><input id="custody-owner" className="input" value={custody.custodianId} onChange={(event) => setCustody((current) => ({ ...current, custodianId: event.target.value }))} required /></Field>
        <Field label="Evaluation reference" htmlFor="custody-evaluation"><input id="custody-evaluation" className="input" value={custody.evaluationReference} onChange={(event) => setCustody((current) => ({ ...current, evaluationReference: event.target.value }))} required /></Field>
        <Field label="Evidence reference" htmlFor="custody-evidence"><input id="custody-evidence" className="input" value={custody.evidenceReference} onChange={(event) => setCustody((current) => ({ ...current, evidenceReference: event.target.value }))} required /></Field>
        <button type="submit" className="btn-outline">Record sample custody</button>
      </form>
    </section>
  );
}

export function VendorLifecyclePanel({ vendors }: { vendors: VendorOption[] }) {
  const { mode, supabaseClient } = useSession();
  const live = mode === "supabase" ? supabaseClient : null;
  const toast = useToast();
  const [reviews, setReviews] = useState<LifecycleReview[]>([]);
  const [eligibilityProjections, setEligibilityProjections] = useState<VendorEligibilityProjectionRecord[]>([]);
  const [probationReviews, setProbationReviews] = useState<Array<{ id: string; vendorId: string; revision: number }>>([]);
  const [open, setOpen] = useState(false);
  const [workingId, setWorkingId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [decisions, setDecisions] = useState<
    Record<string, LifecycleDecisionDraft>
  >({});
  const [draft, setDraft] = useState({
    vendorId: vendors[0]?.id ?? "",
    reviewType: "renewal" as LifecycleReview["reviewType"],
    dueDate: "",
    riskRating: "medium",
    score: "",
    reason: "",
    evidenceUrl: "",
  });

  const vendorName = useMemo(
    () => new Map(vendors.map((vendor) => [vendor.id, vendor.name])),
    [vendors],
  );

  const refresh = useCallback(async () => {
    if (!live) return;
    const { data, error } = await live
      .schema("legal")
      .from("vendor_lifecycle_reviews")
      .select(
        "id,vendor_id,review_type,status,due_date,risk_rating,score,reason,evidence_url",
      )
      .order("opened_at", { ascending: false })
      .limit(200);
    if (error) {
      toast.error(error.message);
      return;
    }
    setReviews(
      (Array.isArray(data) ? data : []).map((row) =>
        mapReview(row as Record<string, unknown>),
      ),
    );
    const { data: projections } = await live
      .schema('legal')
      .rpc('vendor_eligibility_projection', { payload: {} });
    if (Array.isArray(projections)) {
      setEligibilityProjections(
        projections.map((row) => mapEligibilityProjection(row as Record<string, unknown>)),
      );
    }
    const { data: probation } = await live
      .schema('legal')
      .from('vendor_probation_reviews')
      .select('id,vendor_id,revision')
      .order('due_at', { ascending: true });
    if (Array.isArray(probation)) {
      setProbationReviews(probation.map((row) => ({
        id: text((row as Record<string, unknown>).id),
        vendorId: text((row as Record<string, unknown>).vendor_id),
        revision: Number((row as Record<string, unknown>).revision ?? 0),
      })));
    }
  }, [live, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = async (
    review: LifecycleReview,
    action: "start" | "approve" | "reject" | "complete" | "cancel",
  ) => {
    if (!live) return;
    const decision = decisions[review.id] ?? { rationale: "", expiresAt: "" };
    setWorkingId(review.id);
    const { error } = await live
      .schema("legal")
      .rpc("manage_vendor_lifecycle_review", {
        payload: {
          id: review.id,
          action,
          decision_note: decision.rationale.trim() || null,
          expires_at: decision.expiresAt,
        },
      });
    setWorkingId(undefined);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Vendor lifecycle review updated.");
    await refresh();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!live) return;
    setSaving(true);
    const { error } = await live
      .schema("legal")
      .rpc("manage_vendor_lifecycle_review", {
        payload: {
          action: "open",
          vendor_id: draft.vendorId,
          review_type: draft.reviewType,
          due_date: draft.dueDate || null,
          risk_rating: draft.riskRating,
          score: draft.score || null,
          reason: draft.reason,
          evidence_url: draft.evidenceUrl || null,
        },
      });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Vendor lifecycle review opened.");
    setOpen(false);
    setDraft((current) => ({
      ...current,
      reason: "",
      evidenceUrl: "",
      score: "",
    }));
    await refresh();
  };

  const recordAuthority = useCallback(async (rpc: string, payload: Record<string, unknown>) => {
    if (!live) return;
    const { error } = await live.schema('legal').rpc(rpc, { payload });
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success('Legal/VMO authority record saved.');
    await refresh();
  }, [live, refresh, toast]);

  if (!live) return null;

  return (
    <section className="space-y-3" aria-labelledby="vendor-lifecycle-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase text-faint">
            Post-accreditation control
          </p>
          <h2
            id="vendor-lifecycle-title"
            className="font-display text-xl font-bold text-ink"
          >
            Vendor lifecycle
          </h2>
          <p className="text-sm text-muted">
            Renewals, expiry, performance, reassessment, suspension,
            reinstatement, and offboarding.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary w-full sm:w-auto"
          onClick={() => setOpen(true)}
          disabled={vendors.length === 0}
        >
          <Icon name="plus" className="h-4 w-4" /> Open review
        </button>
      </div>
      {reviews.length === 0 ? (
        <EmptyState
          icon="building"
          title="No lifecycle reviews"
          message="Open a renewal, performance, risk, suspension, or offboarding review when required."
        />
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {reviews.map((review) => (
            <Card key={review.id} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-ink">
                    {vendorName.get(review.vendorId) ?? review.vendorId}
                  </p>
                  <p className="text-xs text-muted">
                    {lifecyclePresentation(review.reviewType, review.status).label}
                    {review.dueDate ? " / due " + review.dueDate : ""}
                  </p>
                </div>
                <Badge
                  tone={
                    review.status === "completed" ||
                    review.status === "approved"
                      ? "emerald"
                      : review.status === "rejected"
                        ? "rose"
                        : "brand"
                  }
                >
                  {lifecyclePresentation(review.reviewType, review.status).label}
                </Badge>
              </div>
              <p className="text-sm text-ink">{review.reason}</p>
              <p className="text-xs text-muted">
                {lifecyclePresentation(review.reviewType, review.status).detail}
              </p>
              {review.status === "under_review" && (
                <Field
                  label="Decision rationale"
                  htmlFor={`lifecycle-rationale-${review.id}`}
                >
                  <textarea
                    id={`lifecycle-rationale-${review.id}`}
                    className="input min-h-20"
                    value={decisions[review.id]?.rationale ?? ""}
                    onChange={(event) =>
                      setDecisions((current) => ({
                        ...current,
                        [review.id]: {
                          rationale: event.target.value,
                          expiresAt: current[review.id]?.expiresAt ?? "",
                        },
                      }))
                    }
                    required
                  />
                </Field>
              )}
              {review.status === "approved" &&
                (review.reviewType === "renewal" ||
                  review.reviewType === "reinstatement") && (
                  <Field
                    label="New accreditation expiry"
                    htmlFor={`lifecycle-expiry-${review.id}`}
                  >
                    <input
                      id={`lifecycle-expiry-${review.id}`}
                      className="input"
                      type="date"
                      min={new Date().toISOString().slice(0, 10)}
                      value={decisions[review.id]?.expiresAt ?? ""}
                      onChange={(event) =>
                        setDecisions((current) => ({
                          ...current,
                          [review.id]: {
                            rationale: current[review.id]?.rationale ?? "",
                            expiresAt: event.target.value,
                          },
                        }))
                      }
                      required
                    />
                  </Field>
                )}
              <div className="flex flex-wrap gap-2">
                {review.status === "open" && (
                  <button
                    type="button"
                    className="btn-outline btn-sm"
                    disabled={workingId === review.id}
                    onClick={() => void act(review, "start")}
                  >
                    Start review
                  </button>
                )}
                {review.status === "under_review" && (
                  <>
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      disabled={
                        workingId === review.id ||
                        !(decisions[review.id]?.rationale ?? "").trim()
                      }
                      onClick={() => void act(review, "approve")}
                    >
                      Approve outcome
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm text-rose-700 dark:text-rose-300"
                      disabled={
                        workingId === review.id ||
                        !(decisions[review.id]?.rationale ?? "").trim()
                      }
                      onClick={() => void act(review, "reject")}
                    >
                      Reject
                    </button>
                  </>
                )}
                {review.status === "approved" && (
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    disabled={
                      workingId === review.id ||
                      ((review.reviewType === "renewal" ||
                        review.reviewType === "reinstatement") &&
                        !(decisions[review.id]?.expiresAt ?? ""))
                    }
                    onClick={() => void act(review, "complete")}
                  >
                    Complete review
                  </button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
      {eligibilityProjections.length > 0 && (
        <div className="space-y-2" aria-label="Legal vendor eligibility decisions">
          {eligibilityProjections.map((projection) => (
            <VendorEligibilityProjection key={`${projection.vendorId}:${projection.status}`} projection={projection} />
          ))}
        </div>
      )}
      <VendorEligibilityAuthorityWorkspace
        vendors={vendors}
        probationReviews={probationReviews}
        onRecordProbationReview={(payload) => recordAuthority('record_vendor_probation_review', payload)}
        onRecordEligibilityDecision={(payload) => recordAuthority('record_vendor_eligibility_decision', payload)}
        onRecordTemporaryClearance={(payload) => recordAuthority('open_vendor_temporary_clearance', payload)}
        onDecideTemporaryClearance={(payload) => recordAuthority('decide_vendor_temporary_clearance', payload)}
        onRecordSampleCustody={(payload) => recordAuthority('record_vendor_sample_custody', payload)}
      />
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Open vendor lifecycle review"
        description="Use the smallest review type that matches the control event."
        footer={
          <button
            type="submit"
            form="vendor-lifecycle-form"
            className="btn-primary w-full"
            disabled={saving}
          >
            {saving ? "Opening..." : "Open review"}
          </button>
        }
      >
        <form
          id="vendor-lifecycle-form"
          className="space-y-4"
          onSubmit={(event) => void submit(event)}
        >
          <Field label="Vendor" htmlFor="lifecycle-vendor">
            <select
              id="lifecycle-vendor"
              className="input"
              value={draft.vendorId}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  vendorId: event.target.value,
                }))
              }
              required
            >
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Review type" htmlFor="lifecycle-type">
            <select
              id="lifecycle-type"
              className="input"
              value={draft.reviewType}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  reviewType: event.target
                    .value as LifecycleReview["reviewType"],
                }))
              }
            >
              <option value="renewal">Renewal</option>
              <option value="document_expiry">Document expiry</option>
              <option value="performance">Performance</option>
              <option value="reassessment">Reassessment</option>
              <option value="suspension">Suspension</option>
              <option value="reinstatement">Reinstatement</option>
              <option value="offboarding">Offboarding</option>
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Due date" htmlFor="lifecycle-due">
              <input
                id="lifecycle-due"
                className="input"
                type="date"
                value={draft.dueDate}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    dueDate: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Risk rating" htmlFor="lifecycle-risk">
              <select
                id="lifecycle-risk"
                className="input"
                value={draft.riskRating}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    riskRating: event.target.value,
                  }))
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </Field>
          </div>
          <Field label="Performance score" htmlFor="lifecycle-score">
            <input
              id="lifecycle-score"
              className="input"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={draft.score}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  score: event.target.value,
                }))
              }
            />
          </Field>
          <Field label="Reason" htmlFor="lifecycle-reason">
            <textarea
              id="lifecycle-reason"
              className="input min-h-24"
              value={draft.reason}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  reason: event.target.value,
                }))
              }
              required
            />
          </Field>
          <Field label="Evidence URL" htmlFor="lifecycle-evidence">
            <input
              id="lifecycle-evidence"
              className="input"
              type="url"
              value={draft.evidenceUrl}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  evidenceUrl: event.target.value,
                }))
              }
            />
          </Field>
        </form>
      </Sheet>
    </section>
  );
}
