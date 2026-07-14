// Procurement policy helpers — pure, deterministic derivations aligned with
// the mWell Procurement Policy and Procedures (revised visual draft, May
// 2026). Kept side-effect-free so both React components and Node vitest
// specs can consume them.
//
// Policy references throughout use the numbered sections in the source doc:
//   §5   Sourcing Strategy (RFQ / RFP thresholds)
//   §7   Vendor Accreditation
//   §9   Award Recommendation
//   §11  Exceptions (Direct Award, Repeat, Emergency, Insufficient Bids)
//   §12  Financial Protection
//   Annex A  Award Recommendation Form
//   Annex C  Direct Award Justification
//
// Where the source is silent, return a policy-decision-required state instead
// of inventing a threshold, response quorum, or approver.

import type {
  ApprovalSignature,
  ApprovalStep,
  ApproverTier,
  RequestAttachment,
  RequestAttachmentKind,
  RequestCategory,
  ImportationPlan,
  ProcurementExceptionPack,
  SourcingMethod,
} from './types';

// ---------------------------------------------------------------------------
// Thresholds (in PHP)
// ---------------------------------------------------------------------------

/** Policy §5: RFP / bidding kicks in at PHP 1,000,000 and above. */
export const RFP_THRESHOLD = 1_000_000;

/** Policy §12: construction contracts at PHP 5M+ trigger performance bonds. */
export const CONSTRUCTION_BOND_TRIGGER = 5_000_000;

// ---------------------------------------------------------------------------
// Delegation of Authority (DOA) matrix
// ---------------------------------------------------------------------------

export interface DoaAssignment {
  id: string;
  matrixVersion: string;
  minAmount: number;
  maxAmount: number | null;
  approverUserId: string;
  approverName: string;
  active: boolean;
}

export type DoaResolution =
  | { status: 'resolved'; assignment: DoaAssignment }
  | { status: 'policy_decision_required'; assignment: undefined };

export function resolveDoaAssignment(
  assignments: readonly DoaAssignment[],
  amount: number | undefined,
): DoaResolution {
  const value = typeof amount === 'number' && amount >= 0 ? amount : 0;
  const assignment = assignments.find(
    (candidate) =>
      candidate.active &&
      value >= candidate.minAmount &&
      (candidate.maxAmount === null || value <= candidate.maxAmount),
  );
  return assignment
    ? { status: 'resolved', assignment }
    : { status: 'policy_decision_required', assignment: undefined };
}

// ---------------------------------------------------------------------------
// Category metadata
// ---------------------------------------------------------------------------

export interface CategoryMeta {
  code: RequestCategory;
  label: string;
  /** Short description shown in the picker. */
  description: string;
  /** Categories that are "high-risk / complex" per policy §5 escalate to RFP
   *  even below the PHP 1M threshold. */
  highRisk?: boolean;
  /** True when policy expects the request to loop Legal in for review
   *  (contracts, manpower, construction, IT-with-data-access, etc.). */
  requiresLegal?: boolean;
}

export const CATEGORY_META: readonly CategoryMeta[] = [
  { code: 'goods',        label: 'Goods',                  description: 'Physical items, consumables, supplies.' },
  { code: 'services',     label: 'Services',               description: 'Professional services, consulting, engagements.', requiresLegal: true },
  { code: 'subscription', label: 'Subscriptions / SaaS',   description: 'Recurring software, tools, memberships.',        requiresLegal: true },
  { code: 'capex',        label: 'CapEx / Equipment',      description: 'Fixed assets, equipment, machinery.',              highRisk: true },
  { code: 'construction', label: 'Construction / Works',   description: 'Civil, fit-out, engineering works.',               highRisk: true, requiresLegal: true },
  { code: 'manpower',     label: 'Manpower / Labor',       description: 'Labor-intensive service contracts.',               highRisk: true, requiresLegal: true },
  { code: 'marketing',    label: 'Marketing collateral',   description: 'Print, signage, campaigns, events.' },
  { code: 'it_software',  label: 'IT / Software',          description: 'Hardware, licenses, integrations, data access.',   requiresLegal: true },
  { code: 'medical',      label: 'Medical / Clinical',     description: 'Medical devices, pharma, clinical supplies.',      highRisk: true },
  { code: 'petty_cash',   label: 'Petty cash',             description: 'Ad-hoc reimbursement, minor expenses.' },
  { code: 'other',        label: 'Other',                  description: 'Anything not covered above.' },
] as const;

const CATEGORY_INDEX: Record<RequestCategory, CategoryMeta> = Object.fromEntries(
  CATEGORY_META.map((c) => [c.code, c]),
) as Record<RequestCategory, CategoryMeta>;

export function categoryMeta(code: RequestCategory | undefined): CategoryMeta | undefined {
  return code ? CATEGORY_INDEX[code] : undefined;
}

// ---------------------------------------------------------------------------
// Sourcing method derivation
// ---------------------------------------------------------------------------

export interface SuggestSourcingInput {
  category?: RequestCategory;
  /** Estimated PHP total (sum of qty * unit price). */
  amount?: number;
  /** Requester flagged this as an emergency (policy §11). */
  emergency?: boolean;
  /** Requester is renewing a prior contract with the same vendor/terms. */
  repeat?: boolean;
  comparable?: boolean;
  complex?: boolean;
  technical?: boolean;
  strategic?: boolean;
  highRisk?: boolean;
  dataSensitive?: boolean;
}

export type SourcingReason =
  | 'emergency'
  | 'repeat_continuity'
  | 'explicit_petty_cash'
  | 'complex'
  | 'technical'
  | 'strategic'
  | 'high_risk'
  | 'data_sensitive'
  | 'amount_threshold'
  | 'clear_comparable_below_threshold'
  | 'procurement_confirmation_required';

export interface SourcingRecommendation {
  method: SourcingMethod;
  reasons: SourcingReason[];
  requiresProcurementConfirmation: true;
}

/**
 * Suggest a sourcing path per policy §5 + §11. The rules:
 *   1. Emergency overrides everything → 'emergency'.
 *   2. Repeat order flag → 'repeat_order'.
 *   3. Explicit petty-cash category → 'petty_cash', pending Finance confirmation.
 *   4. High-risk categories (capex/construction/manpower/medical) escalate to
 *      RFP regardless of amount (policy §5 "complex, technical, strategic,
 *      or high-risk work regardless of amount").
 *   5. Amount ≥ RFP_THRESHOLD (PHP 1,000,000) → 'rfp'.
 *   6. Amount below the RFP threshold → 'rfq'.
 *   7. Amount unknown → 'rfq', pending Procurement confirmation.
 *
 * The officer can override any suggestion with a justification stored in
 * `compliance.directAwardReason` + `compliance.priceReasonableness`.
 */
export function deriveSourcingRecommendation(input: SuggestSourcingInput): SourcingRecommendation {
  const { category, amount, emergency, repeat } = input;
  const result = (method: SourcingMethod, reasons: SourcingReason[]): SourcingRecommendation => ({
    method,
    reasons,
    requiresProcurementConfirmation: true,
  });
  if (emergency) return result('emergency', ['emergency']);
  if (repeat) return result('repeat_order', ['repeat_continuity']);
  if (category === 'petty_cash') return result('petty_cash', ['explicit_petty_cash']);
  if (input.dataSensitive) return result('rfp', ['data_sensitive']);
  if (input.complex) return result('rfp', ['complex']);
  if (input.technical) return result('rfp', ['technical']);
  if (input.strategic) return result('rfp', ['strategic']);
  if (input.highRisk) return result('rfp', ['high_risk']);
  const meta = categoryMeta(category);
  if (meta?.highRisk) return result('rfp', ['high_risk']);
  if (typeof amount !== 'number' || amount <= 0) {
    return result('rfq', ['procurement_confirmation_required']);
  }
  if (amount >= RFP_THRESHOLD) return result('rfp', ['amount_threshold']);
  return result('rfq', ['clear_comparable_below_threshold']);
}

export function suggestSourcingMethod(input: SuggestSourcingInput): SourcingMethod {
  return deriveSourcingRecommendation(input).method;
}

export function sourcingMethodLabel(m: SourcingMethod): string {
  switch (m) {
    case 'petty_cash':      return 'Petty cash';
    case 'small_purchase':  return 'Small purchase';
    case 'rfq':             return 'RFQ / Canvassing';
    case 'rfp':             return 'RFP / Bidding';
    case 'direct_award':    return 'Direct Award';
    case 'repeat_order':    return 'Repeat Order';
    case 'emergency':       return 'Emergency Purchase';
  }
}

/** Per-method minimum quote count from policy §5. Used to surface a warning
 *  on the request-detail page when the officer can't yet demonstrate a
 *  quorum. `null` means "no explicit minimum — Procurement judgement". */
export interface SourcingReadinessInput {
  method: SourcingMethod;
  invited: number;
  responses: number;
  intendedResponses?: number;
  insufficientBidsExceptionApproved?: boolean;
}

export interface SourcingReadiness {
  ready: boolean;
  insufficientBidsExceptionRequired: boolean;
}

export function evaluateSourcingReadiness(input: SourcingReadinessInput): SourcingReadiness {
  const shortfall =
    typeof input.intendedResponses === 'number' &&
    input.intendedResponses > 0 &&
    input.responses < input.intendedResponses;
  return {
    ready: !shortfall || input.insufficientBidsExceptionApproved === true,
    insufficientBidsExceptionRequired:
      shortfall && input.insufficientBidsExceptionApproved !== true,
  };
}

// ---------------------------------------------------------------------------
// Approval ladder derivation
// ---------------------------------------------------------------------------

export interface BuildLadderInput {
  category?: RequestCategory;
  amount?: number;
  sourcingMethod?: SourcingMethod;
}

const TIER_LABEL: Record<ApproverTier, string> = {
  dept_head:        'Department Head',
  procurement_head: 'Procurement Head',
  finance:          'Finance',
  legal:            'Legal',
  final_approver:   'Final Approver (DOA)',
};

export function tierLabel(t: ApproverTier): string {
  return TIER_LABEL[t];
}

/**
 * Compose the approval ladder from category + amount + sourcing method.
 * The ladder always includes:
 *   dept_head  — the requesting BU's approver.
 *   procurement_head — sourcing strategy + AR review (policy §3, §9).
 *   final_approver — DOA sign-off (policy §9).
 *
 * Then conditional insertions:
 *   finance — inserted before final_approver for categories with explicit
 *             financial-protection exposure.
 *   legal   — inserted after procurement_head when the category loops Legal
 *             in (services, subscription, construction, manpower, it_software)
 *             OR sourcing method ∈ {direct_award, emergency, rfp} (§11 + §9).
 */
export function buildApprovalLadder(input: BuildLadderInput): ApproverTier[] {
  const { category, sourcingMethod } = input;
  const tiers: ApproverTier[] = ['dept_head', 'procurement_head'];

  const meta = categoryMeta(category);
  const categoryNeedsFinance =
    category === 'capex' || category === 'construction' || category === 'manpower';

  const legalTriggered =
    !!meta?.requiresLegal ||
    sourcingMethod === 'direct_award' ||
    sourcingMethod === 'emergency' ||
    sourcingMethod === 'rfp';

  if (legalTriggered) tiers.push('legal');
  if (categoryNeedsFinance) tiers.push('finance');

  tiers.push('final_approver');
  return tiers;
}

/**
 * Build the initial pending-step list. Emits one step per tier in ladder
 * order; the first one is `pending`, the rest are also `pending` but will be
 * kept idle until the previous tier decides.
 *
 * `newStepId` is injected so callers can plug in their own id generator
 * (localStore uses crypto.randomUUID; tests use a counter).
 */
export function buildApprovalSteps(
  input: BuildLadderInput,
  newStepId: () => string,
): ApprovalStep[] {
  return buildApprovalLadder(input).map((tier, i) => ({
    id: newStepId(),
    order: i + 1,
    tier,
    status: 'pending',
    label:
      tier === 'final_approver'
        ? 'Final Approver - Policy decision required (DOA)'
        : tierLabel(tier),
  }));
}

/** Which step, if any, is the next one waiting on a decision. */
export function nextPendingStep(steps: ApprovalStep[] | undefined | null): ApprovalStep | undefined {
  if (!steps || steps.length === 0) return undefined;
  return [...steps]
    .sort((a, b) => a.order - b.order)
    .find((s) => s.status === 'pending');
}

/** Convenience: which tier is next to approve? */
export function nextApprover(steps: ApprovalStep[] | undefined | null): ApproverTier | undefined {
  return nextPendingStep(steps)?.tier;
}

/**
 * Apply a decision to the first pending step matching the actor's tier. If
 * the actor's tier isn't next in line, the mutation is a no-op and we return
 * null — the caller should show an error toast rather than silently
 * approving on someone else's behalf.
 *
 * Returns the updated step list plus a `terminal` flag indicating whether
 * the whole request is now decided (all approved OR one rejected).
 */
export interface ApplyDecisionResult {
  steps: ApprovalStep[];
  terminal: boolean;
  outcome: 'in_progress' | 'approved' | 'rejected';
}

export function applyStepDecision(
  steps: ApprovalStep[],
  actorTier: ApproverTier,
  decision: 'approved' | 'rejected',
  actor: {
    email?: string;
    note?: string;
    at: string;
    /** Optional electronic signature captured at commit (DocuSign-style). */
    signature?: ApprovalSignature;
  },
): ApplyDecisionResult | null {
  const next = nextPendingStep(steps);
  if (!next || next.tier !== actorTier) return null;

  const updated = steps.map((s) =>
    s.id === next.id
      ? {
          ...s,
          status: decision,
          decidedAt: actor.at,
          decidedByEmail: actor.email,
          note: actor.note,
          signature: actor.signature,
        }
      : s,
  );

  if (decision === 'rejected') {
    return { steps: updated, terminal: true, outcome: 'rejected' };
  }
  // All-approved check runs against the mutated list.
  const remaining = updated.find((s) => s.status === 'pending');
  if (!remaining) {
    return { steps: updated, terminal: true, outcome: 'approved' };
  }
  return { steps: updated, terminal: false, outcome: 'in_progress' };
}

// ---------------------------------------------------------------------------
// Documents-required matrix (policy §6 + Annex B)
// ---------------------------------------------------------------------------

export interface RequiredDoc {
  key: string;
  label: string;
  why: string;
}

/** Minimum attachment set for a request, keyed off sourcing method + category.
 *  The RequestDetail page renders these as a checklist so requesters know
 *  what's still missing before submitting for approval. */
export function requiredDocuments(input: BuildLadderInput): RequiredDoc[] {
  const { sourcingMethod, category } = input;
  const docs: RequiredDoc[] = [
    { key: 'spec',     label: 'Technical description / spec', why: 'Allows comparable vendor responses.' },
    { key: 'budget',   label: 'Approved budget evidence',     why: 'Confirms funding before sourcing.' },
    { key: 'previous', label: 'Previous purchase cost',       why: 'Supports price reasonableness.' },
  ];
  if (sourcingMethod === 'rfp') {
    docs.push({ key: 'ar', label: 'Award Recommendation draft', why: 'Required for RFP / bidding (Annex A).' });
    docs.push({ key: 'bids', label: 'Vendor proposals', why: 'Supports the documented RFP evaluation and sourcing effort.' });
  }
  if (sourcingMethod === 'rfq') {
    docs.push({ key: 'quotes', label: 'Comparable quotations', why: 'Supports documented RFQ comparison where practicable.' });
  }
  if (sourcingMethod === 'direct_award' || sourcingMethod === 'emergency') {
    docs.push({ key: 'da_justification', label: 'Direct-award justification', why: 'Annex C — sole supplier / emergency basis.' });
  }
  if (category === 'construction' || category === 'manpower') {
    docs.push({ key: 'bond', label: 'Bond / insurance plan', why: 'Financial protection matrix (policy §12).' });
  }
  return docs;
}

// ---------------------------------------------------------------------------
// Required-documents ↔ attachments matching (PR-19 / J2-5)
// ---------------------------------------------------------------------------

/** Which attachment kind(s) satisfy each required-document key. */
const DOC_KIND_MATCH: Record<string, readonly RequestAttachmentKind[]> = {
  spec: ['spec'],
  budget: ['budget'],
  previous: ['previous_cost'],
  quotes: ['quote'],
  bids: ['quote'],
  ar: ['award_recommendation'],
  da_justification: ['justification'],
  bond: ['bond'],
};

export interface RequiredDocStatus extends RequiredDoc {
  /** True when at least one attachment of a matching kind exists. */
  attached: boolean;
}

/**
 * Join the required-documents checklist against the request's real
 * attachments so surfaces render attached / missing instead of a decorative
 * list. Unknown doc keys (future additions) count as missing until a kind
 * mapping is added.
 */
export function requiredDocumentsStatus(
  input: BuildLadderInput,
  attachments: readonly Pick<RequestAttachment, 'kind'>[] | undefined,
): RequiredDocStatus[] {
  const kinds = new Set(
    (attachments ?? []).map((a) => a.kind ?? 'other'),
  );
  return requiredDocuments(input).map((doc) => {
    const accepted = DOC_KIND_MATCH[doc.key] ?? [];
    return { ...doc, attached: accepted.some((k) => kinds.has(k)) };
  });
}

// ---------------------------------------------------------------------------
// Submit readiness gate (policy §5/§9 — enforce, not just display)
// ---------------------------------------------------------------------------

export interface SubmitReadiness {
  /** True when all required documents are attached. */
  ok: boolean;
  /** Human-readable labels of required documents not yet attached. */
  missingDocs: string[];
}

/**
 * Whether a request satisfies the policy prerequisites to enter the approval
 * ladder: the required-document set is attached. Procurement separately
 * records sourcing effort and any approved insufficient-bids exception.
 */
export function evaluateSubmitReadiness(req: {
  category?: RequestCategory;
  estimatedAmount?: number;
  sourcingMethod?: SourcingMethod;
  attachments?: readonly Pick<RequestAttachment, 'kind'>[];
  compliance?: { routeConfirmed?: boolean };
}): SubmitReadiness {
  const input: BuildLadderInput = {
    category: req.category,
    amount: req.estimatedAmount,
    sourcingMethod: req.sourcingMethod,
  };
  const missingDocs = requiredDocumentsStatus(input, req.attachments)
    .filter((d) => !d.attached)
    .map((d) => d.label);
  if (!req.compliance?.routeConfirmed) {
    missingDocs.unshift('Procurement-confirmed sourcing route');
  }
  return {
    ok: missingDocs.length === 0,
    missingDocs,
  };
}

export interface CommitmentReadinessInput {
  sourcingMethod: SourcingMethod;
  vendorEligible: boolean;
  category?: RequestCategory;
  exceptionPack?: ProcurementExceptionPack;
  foreignVendor?: boolean;
  importationRequired?: boolean;
  importationPlan?: ImportationPlan;
  downPayment?: boolean;
  construction?: boolean;
  equipmentInstallation?: boolean;
}

/** Binding controls that must be satisfied before a PO can be issued. */
export function evaluateCommitmentReadiness(input: CommitmentReadinessInput): string[] {
  const blockers: string[] = [];
  const pack = input.exceptionPack;
  const validPettyCashException =
    input.sourcingMethod === 'petty_cash' &&
    pack?.type === 'petty_cash_non_accredited' &&
    Boolean(pack.justification?.trim()) &&
    pack.financeEligibilityConfirmed === true &&
    pack.nonRecurringNonSplitAttested === true &&
    pack.receiptOrInvoiceSupported === true &&
    pack.liquidationRecorded === true;

  if (!input.vendorEligible && !validPettyCashException) {
    blockers.push('current full accreditation or approved scoped temporary clearance');
  }

  if (input.sourcingMethod === 'direct_award') {
    if (!pack?.directAwardBasis) blockers.push('allowed Direct Award basis');
    if (!pack?.supplierSelected) blockers.push('identified supplier');
    if (!pack?.justification?.trim()) blockers.push('business justification');
    if (!pack?.priceReasonableness?.trim()) blockers.push('price-reasonableness support');
    if (!pack?.procurementHeadReviewed) blockers.push('Procurement Head review');
    if (!pack?.doaApproved) blockers.push('final DOA approval');
  }
  if (input.sourcingMethod === 'repeat_order' && pack?.type !== 'repeat_continuity') {
    blockers.push('repeat-order continuity evidence and approval');
  }
  if (input.sourcingMethod === 'emergency' && pack?.type !== 'emergency') {
    blockers.push('documented emergency authority');
  }
  if (input.sourcingMethod === 'petty_cash') {
    if (!pack?.justification?.trim()) blockers.push('one-time low-value petty-cash justification');
    if (!pack?.financeEligibilityConfirmed) blockers.push('Finance petty-cash eligibility confirmation');
    if (!pack?.nonRecurringNonSplitAttested) {
      blockers.push('non-recurring and non-split petty-cash attestation');
    }
    if (!pack?.receiptOrInvoiceSupported) blockers.push('official receipt or sales invoice support');
    if (!pack?.liquidationRecorded) blockers.push('petty-cash liquidation record');
  }

  if (input.foreignVendor || input.importationRequired) {
    const plan = input.importationPlan;
    const required: Array<[keyof ImportationPlan, string]> = [
      ['incoterms', 'Incoterms and responsibility allocation'],
      ['importerOfRecord', 'importer of record'],
      ['permitsAndRegistrations', 'import permits and registrations'],
      ['customsBrokerAndLogistics', 'customs broker and logistics plan'],
      ['dutiesTaxesFreightInsurance', 'landed cost, duties, taxes, freight, and insurance'],
      ['foreignPaymentTiming', 'currency and foreign-payment risk'],
      ['deliveryAcceptanceAndWarranty', 'delivery, acceptance, and warranty point'],
    ];
    for (const [key, label] of required) {
      if (!plan?.[key]?.trim()) blockers.push(label);
    }
  }

  if (input.downPayment) blockers.push('down-payment bond equal to the down payment');
  if (input.category === 'manpower') blockers.push('manpower payment-bond or equivalent review');
  if (input.construction || input.category === 'construction') {
    blockers.push('construction performance, warranty, insurance, and regulatory review');
  }
  if (input.equipmentInstallation) {
    blockers.push('installation commissioning, defects, warranty, and acceptance controls');
  }
  return blockers;
}

export interface PaymentReadinessInput {
  poOrAgreementApproved: boolean;
  invoiceOrOfficialReceipt: boolean;
  acceptedWarehouseQuantity: number;
  serviceAcceptance: boolean;
  paymentTermsRecorded: boolean;
  taxWithholdingSupport: boolean;
}

export function evaluatePaymentReadiness(input: PaymentReadinessInput): string[] {
  const blockers: string[] = [];
  if (!input.poOrAgreementApproved) blockers.push('approved PO or agreement');
  if (!input.invoiceOrOfficialReceipt) blockers.push('invoice, official receipt, or sales invoice');
  if (input.acceptedWarehouseQuantity <= 0 && !input.serviceAcceptance) {
    blockers.push('accepted Warehouse receipt or service acceptance');
  }
  if (!input.paymentTermsRecorded) blockers.push('recorded payment terms');
  if (!input.taxWithholdingSupport) blockers.push('tax and withholding support');
  return blockers;
}
