// Procurement domain types (preview build). Mirrors what the eventual Supabase
// adapter (@intra/core-data + procurement.* RPCs) will return, kept camelCase
// on the client per the platform mapper-boundary invariant (spec §6.4).
//
// The shape was widened in Step 3b to align with the mWell Procurement Policy
// and Procedures (revised visual draft, May 2026):
//   • Sourcing paths (RFQ / RFP / Direct Award / Repeat Order / Emergency)
//     with the RFQ<->RFP boundary at PHP 1,000,000 per policy §5.
//   • Request category (goods / services / subscription / capex / …) so any
//     department — not just warehouse — can raise a request.
//   • Multi-tier approval steps (dept head → procurement head → finance →
//     legal → final approver) derived from the amount, category, and sourcing
//     method (policy §3 + §5 + §11).
//   • Structured business justification, attachments, cost center + project
//     code + budget code, and vendor accreditation / bidding quorum flags so
//     the Award Recommendation (policy §9 + Annex A) can be assembled from
//     the request record alone.
//
// All new fields are optional to keep older localStorage drafts loading.

export type RequestStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected'
  | 'cancelled';

/**
 * Policy §2 + §5 + Annex A: procurement covers "goods and services … including
 * purchase orders, service engagements, contracts, subscriptions, project work,
 * manpower services, construction-related works, equipment supply …". The
 * enum below is the working set exposed by the request form; downstream logic
 * (sourcing derivation, financial-protection prompts) branches on it.
 */
export type RequestCategory =
  | 'goods'
  | 'services'
  | 'subscription'
  | 'capex'
  | 'construction'
  | 'manpower'
  | 'marketing'
  | 'it_software'
  | 'medical'
  | 'petty_cash'
  | 'other';

/**
 * Policy §5 + §11 sourcing paths. The system suggests one based on category
 * and estimated total; the officer can override with justification.
 *
 * TODO(policy-owner): confirm the internal "small_purchase" band (default
 * cutoff PHP 100,000). Policy only explicitly names the RFQ↔RFP boundary at
 * PHP 1,000,000; petty-cash and small-purchase amounts are proposed here for
 * operational clarity and need product-owner sign-off before go-live.
 */
export type SourcingMethod =
  | 'petty_cash'
  | 'small_purchase'
  | 'rfq'
  | 'rfp'
  | 'direct_award'
  | 'repeat_order'
  | 'emergency';

/**
 * Multi-tier approval ladder (policy §3 roles + §9 approval matrix). Real DOA
 * mapping lands post-MVP; the enum names the roles the ladder will consult.
 */
export type ApproverTier =
  | 'dept_head'
  | 'procurement_head'
  | 'finance'
  | 'legal'
  | 'final_approver';

export type ApprovalStepStatus = 'pending' | 'approved' | 'rejected' | 'skipped';

export interface ApprovalStep {
  /** Stable id so history + inbox rows can link to a specific step. */
  id: string;
  /** Order in the ladder; lower runs first. */
  order: number;
  tier: ApproverTier;
  status: ApprovalStepStatus;
  /** Free-text label so demo profiles / DOA overrides can rename the tier. */
  label?: string;
  note?: string;
  decidedAt?: string;
  decidedByEmail?: string;
  /** DocuSign-equivalent electronic signature captured at commit
   *  (RA 8792 §6). See @intra/ui `SignaturePayload`. */
  signature?: ApprovalSignature;
}

/**
 * Electronic-signature record persisted alongside an approval / award
 * decision. Mirrors `SignaturePayload` from @intra/ui — duplicated here
 * (rather than imported) to keep the domain package free of UI deps.
 * Any deviation MUST match `SignaturePayload` field-for-field or the
 * capture → persist round-trip will silently drop fields.
 */
export interface ApprovalSignature {
  method: 'drawn' | 'typed';
  /** PNG rendering of the signature (data URL). */
  dataUrl: string;
  /** Full legal name the signer confirmed at capture. */
  signerName: string;
  /** ISO timestamp captured at commit. */
  signedAt: string;
  /** Best-effort audit fingerprint (browser + tzOffset). */
  userAgent: string;
}

export interface ProcurementRequestLine {
  id: string;
  description: string;
  quantity: number;
  uom?: string;
  unitPrice?: number;
}

/**
 * Structured Award-Recommendation justification (policy §9). Splitting this
 * out of the freeform `description` lets the AR template render deterministic
 * sections and lets the approver inbox highlight the "risk if not procured"
 * bullet — the single most-scrutinised field in DOA sign-offs.
 */
export interface BusinessJustification {
  need: string;
  alternatives?: string;
  risk?: string;
}

export interface RequestAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Base64 data URL exists only in explicit memory/demo mode. */
  dataUrl?: string;
  /** Private object path in the procurement-requests Storage bucket. */
  storagePath?: string;
  /** SHA-256 digest of the uploaded bytes for evidence integrity checks. */
  sha256?: string;
  uploadedAt: string;
  uploadedByEmail?: string;
  /** Optional tag so we can render "budget evidence" vs "brochure" etc.
   *  Widened (PR-19) so the required-documents checklist can match real
   *  attachments per sourcing path: award recommendation drafts, direct-award
   *  justifications, and bond/insurance plans get their own kinds. */
  kind?: RequestAttachmentKind;
}

export type RequestAttachmentKind =
  | 'budget'
  | 'previous_cost'
  | 'spec'
  | 'quote'
  | 'award_recommendation'
  | 'justification'
  | 'bond'
  | 'brochure'
  | 'other';

/** Vendor / bidding compliance flags surfaced on the request per policy §7
 *  (accreditation) + §5 (sourcing effort) + §11 (direct-award justification). All
 *  optional so drafts stay valid; the RequestDetail page prompts when they're
 *  missing on submit. */
export interface ComplianceChecks {
  /** True when the request explicitly requires an accredited vendor. */
  vendorAccreditationRequired?: boolean;
  /** Legacy preview field. It cannot authorize a live submission or award. */
  rfpQuorumMet?: boolean;
  intendedResponses?: number;
  vendorsInvited?: number;
  responsesReceived?: number;
  insufficientBidsExceptionApproved?: boolean;
  routeConfirmed?: boolean;
  routeConfirmedByEmail?: string;
  policyVersion?: string;
  riskFacts?: ProcurementRiskFacts;
  exceptionPack?: ProcurementExceptionPack;
  importationPlan?: ImportationPlan;
  /** Free-text reference (e.g. PhilGEPS notice #) captured when applicable. */
  philgepsReference?: string;
  /** Direct-award reason (policy Annex C). Only rendered when sourcing is
   *  `direct_award` or `emergency`. */
  directAwardReason?:
    | 'sole_supplier'
    | 'emergency'
    | 'repeat_continuity'
    | 'other';
  /** Free-text price-reasonableness note; required by Annex C for direct
   *  awards, optional otherwise. */
  priceReasonableness?: string;
}

export interface ProcurementRiskFacts {
  comparable: boolean;
  complex: boolean;
  technical: boolean;
  strategic: boolean;
  highRisk: boolean;
  dataSensitive: boolean;
  importation: boolean;
}

export interface ProcurementExceptionPack {
  type: 'direct_award' | 'emergency' | 'repeat_continuity' | 'insufficient_bids' | 'petty_cash_non_accredited';
  justification: string;
  priceReasonableness?: string;
  risksAndMitigations?: string;
  financeEligibilityConfirmed?: boolean;
  nonRecurringNonSplitAttested?: boolean;
}

export interface ImportationPlan {
  incoterms: string;
  importerOfRecord: string;
  permitsAndRegistrations: string;
  customsBrokerAndLogistics: string;
  dutiesTaxesFreightInsurance: string;
  foreignPaymentTiming: string;
  deliveryAcceptanceAndWarranty: string;
}

export interface ProcurementRequest {
  id: string;
  title: string;
  description?: string;
  department?: string;
  costCenter?: string;
  /** Project ID / capex code — kept separate from cost center so BUs with
   *  multi-project departments can reconcile spend per project. */
  projectCode?: string;
  /** Budget line / GL code the request charges against. */
  budgetCode?: string;
  status: RequestStatus;
  requesterName?: string;
  requesterEmail?: string;
  neededBy?: string; // ISO date
  vendorId?: string;
  vendorName?: string;
  lines: ProcurementRequestLine[];
  createdAt: string;
  submittedAt?: string;
  decidedAt?: string;
  decisionNote?: string;
  decidedByEmail?: string;
  /** Derived: sum(line.quantity * line.unitPrice ?? 0) — computed at write time. */
  estimatedAmount?: number;

  // ── Policy-aligned fields ────────────────────────────────────────────────
  category?: RequestCategory;
  /** Suggested by policy from category + total; officer may override before
   *  submit. Persisted so the AR + PO carry the source of the sourcing
   *  decision (policy §5 + §11). */
  sourcingMethod?: SourcingMethod;
  /** True when the officer overrode the system-suggested method. */
  sourcingOverride?: boolean;
  justification?: BusinessJustification;
  attachments?: RequestAttachment[];
  compliance?: ComplianceChecks;
  riskFacts?: ProcurementRiskFacts;
  exceptionPack?: ProcurementExceptionPack;
  importationPlan?: ImportationPlan;
  /** Multi-tier ladder (policy §3 + §9). Absent for drafts, populated on
   *  submit. Approvals advance one step at a time. */
  approvalSteps?: ApprovalStep[];
}

export type PurchaseOrderStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'issued'
  | 'closed'
  | 'cancelled';

export interface PurchaseOrderLine {
  id: string;
  description: string;
  quantity: number;
  uom?: string;
  unitPrice?: number;
  receivedQuantity: number;
}

/** One line of a goods receipt against a PO. */
export interface PurchaseOrderReceiptLine {
  /** Matches PurchaseOrder.lines[*].id. */
  lineId: string;
  /** Denormalized so the receipt renders standalone (activity feeds,
   *  warehouse bridge) without re-joining the PO lines. */
  description: string;
  /** Units accepted in THIS receipt (already clamped to outstanding). */
  quantity: number;
}

/**
 * A (possibly partial) goods receipt recorded against a PO (PR-24 / J2-7).
 * Receipts are append-only and persisted ON the PurchaseOrder record under
 * `intra.procurement.v2.purchase_orders` so the warehouse module can read
 * procurement-side receipt events from a single key.
 */
export interface PurchaseOrderReceipt {
  id: string;
  /** ISO timestamp the receipt was recorded. */
  receivedAt: string;
  receivedByEmail?: string;
  note?: string;
  lines: PurchaseOrderReceiptLine[];
  /** True when this receipt completed the PO (status flipped to `closed`). */
  closedPo: boolean;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string; // human-friendly (PO-2026-0001)
  requestId?: string; // links back to the PR
  vendorId: string;
  vendorName: string;
  status: PurchaseOrderStatus;
  actorEmail?: string;
  expectedDate?: string;
  notes?: string;
  origin: 'procurement' | 'warehouse';
  lines: PurchaseOrderLine[];
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  approvedByEmail?: string;
  /** Electronic signature captured when the PO award was approved. */
  approvalSignature?: ApprovalSignature;
  /** Append-only goods receipts (partial receipts supported). Optional so
   *  legacy localStorage rows keep loading. */
  receipts?: PurchaseOrderReceipt[];
  /** sum(qty * unitPrice ?? 0). */
  total: number;
}

/** Preview build: a single approval "step" event tied to a request. Replaces
 *  the legacy single-tier record; the localStore keeps writing these rows so
 *  RequestDetail's Activity timeline stays chronological across tiers. */
export interface ApprovalDecision {
  entityType: 'request' | 'purchase_order';
  entityId: string;
  decision: 'approved' | 'rejected';
  note?: string;
  decidedAt: string;
  decidedByEmail?: string;
  /** Tier that recorded the decision — undefined for legacy rows. */
  tier?: ApproverTier;
  /** Step id (matches ProcurementRequest.approvalSteps[*].id). */
  stepId?: string;
  /** Electronic signature captured at commit time. */
  signature?: ApprovalSignature;
}

/** Very light vendor projection used only by procurement UI. In live mode this
 *  comes from `core.vendors`; in demo mode from the seeded list below. */
export interface ProcurementVendor {
  id: string;
  legalName: string;
  category?: string;
  /** From `core.vendors.accreditation_status`. Award is gated on `approved`. */
  accreditationStatus:
    | 'draft'
    | 'submitted'
    | 'under_review'
    | 'approved'
    | 'provisional'
    | 'rejected'
    | 'expired'
    | 'renewal_due';
  accreditationExpiresAt?: string;
}
