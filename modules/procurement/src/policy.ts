// Procurement policy helpers — pure, deterministic derivations aligned with
// the mWell Procurement Policy and Procedures (revised visual draft, May
// 2026). Kept side-effect-free so both React components and Node vitest
// specs can consume them.
//
// Policy references throughout use the numbered sections in the source doc:
//   §5   Sourcing Strategy (solicitation, mode, and governance controls)
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
  ProcurementRequestLine,
  RequirementKind,
  SourcingMethod,
  AcceptancePack,
  PaymentReadinessPack,
  ProcurementRequest,
  PurchaseOrderStatus,
  FailedBidReason,
  ProcurementPolicyProfile,
  ProcurementRoute,
} from './types';
import { MWELL_OPERATING_PROFILE } from './policyProfile';
import {
  deriveProcurementRoute,
  inferLegacyRequirementKind,
  legacySourcingMethod,
  routeFromLegacy,
} from './policyRoute';
export { evaluateProcurementException } from './procurementExceptions';
export type { ProcurementExceptionEvaluation, ProcurementExceptionInput } from './procurementExceptions';

export interface AwardRecommendationValidationInput {
  evaluatedVendorId?: string;
  recommendedVendorId?: string;
  rationale?: string;
  commercialTabulationId?: string;
  technicalEvaluationId?: string;
  riskEvidenceReference?: string;
  riskEvidenceRequired?: boolean;
  varianceJustification?: string;
}

/**
 * Scorecards rank a best-value recommendation; they never select or award a
 * vendor by themselves. The database repeats these checks before persistence.
 */
export function validateAwardRecommendation(input: AwardRecommendationValidationInput): string[] {
  const blockers: string[] = [];
  if (!input.evaluatedVendorId) blockers.push('Evaluated vendor is required.');
  if (!input.recommendedVendorId) blockers.push('Recommended vendor is required.');
  if (!input.rationale?.trim()) blockers.push('Recommendation rationale is required.');
  if (!input.commercialTabulationId) blockers.push('Commercial tabulation is required.');
  if (!input.technicalEvaluationId) blockers.push('Technical evaluation is required.');
  if (input.riskEvidenceRequired !== false && !input.riskEvidenceReference?.trim()) {
    blockers.push('Applicable risk evidence is required.');
  }
  if (
    input.evaluatedVendorId &&
    input.recommendedVendorId &&
    input.evaluatedVendorId !== input.recommendedVendorId &&
    !input.varianceJustification?.trim()
  ) {
    blockers.push('Written variance justification is required.');
  }
  return blockers;
}

// ---------------------------------------------------------------------------
// Thresholds (in PHP)
// ---------------------------------------------------------------------------

/**
 * @deprecated Amount is a formal-bid governance threshold, not an RFQ/RFP
 * boundary. New route derivation reads the active policy profile instead.
 */
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
  {
    code: 'goods',
    label: 'Goods',
    description: 'Physical items, consumables, supplies.',
  },
  {
    code: 'services',
    label: 'Services',
    description: 'Professional services, consulting, engagements.',
    requiresLegal: true,
  },
  {
    code: 'subscription',
    label: 'Subscriptions / SaaS',
    description: 'Recurring software, tools, memberships.',
    requiresLegal: true,
  },
  {
    code: 'capex',
    label: 'CapEx / Equipment',
    description: 'Fixed assets, equipment, machinery.',
    highRisk: true,
  },
  {
    code: 'construction',
    label: 'Construction / Works',
    description: 'Civil, fit-out, engineering works.',
    highRisk: true,
    requiresLegal: true,
  },
  {
    code: 'manpower',
    label: 'Manpower / Labor',
    description: 'Labor-intensive service contracts.',
    highRisk: true,
    requiresLegal: true,
  },
  {
    code: 'marketing',
    label: 'Marketing collateral',
    description: 'Print, signage, campaigns, events.',
  },
  {
    code: 'it_software',
    label: 'IT / Software',
    description: 'Hardware, licenses, integrations, data access.',
    requiresLegal: true,
  },
  {
    code: 'medical',
    label: 'Medical / Clinical',
    description: 'Medical devices, pharma, clinical supplies.',
    highRisk: true,
  },
  {
    code: 'petty_cash',
    label: 'Petty cash',
    description: 'Ad-hoc reimbursement, minor expenses.',
  },
  { code: 'other', label: 'Other', description: 'Anything not covered above.' },
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
  /** New callers must supply this. Missing values are handled only as legacy compatibility. */
  requirementKind?: RequirementKind;
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
  importation?: boolean;
}

/** @deprecated Read-only explanation strings from the legacy method projection. */
export type SourcingReason = string;

export interface SourcingRecommendation {
  method: SourcingMethod;
  reasons: SourcingReason[];
  requiresProcurementConfirmation: true;
}

/**
 * @deprecated New request intake must call deriveProcurementRoute with an
 * explicit requirementKind. This compatibility wrapper projects the route for
 * legacy screens and reads; it never treats amount as an RFQ/RFP boundary.
 */
export function deriveSourcingRecommendation(input: SuggestSourcingInput): SourcingRecommendation {
  const requestedMode = input.emergency
    ? 'emergency_purchase'
    : input.repeat
      ? 'repeat_order'
      : input.category === 'petty_cash'
        ? 'petty_cash'
        : undefined;
  const requirementKind = input.requirementKind ?? inferLegacyRequirementKind(input.category);

  if (requirementKind) {
    const recommendation = deriveProcurementRoute({
      requirementKind,
      category: input.category,
      amount: input.amount,
      requestedMode,
      complex: input.complex,
      technical: input.technical,
      strategic: input.strategic,
      highRisk: input.highRisk ?? categoryMeta(input.category)?.highRisk,
      dataSensitive: input.dataSensitive,
      importation: input.importation,
    }, MWELL_OPERATING_PROFILE);
    return {
      method: legacySourcingMethod(recommendation.route),
      reasons: recommendation.route.reasons,
      requiresProcurementConfirmation: true,
    };
  }

  // Old, under-classified records remain legible, but carry a remediation
  // signal. New requests use deriveProcurementRoute and cannot reach here.
  const legacyMethod: SourcingMethod = requestedMode === 'emergency_purchase'
    ? 'emergency'
    : requestedMode === 'repeat_order'
      ? 'repeat_order'
      : requestedMode === 'petty_cash'
        ? 'petty_cash'
        : input.complex || input.technical || input.strategic || input.highRisk || input.dataSensitive || categoryMeta(input.category)?.highRisk
          ? 'rfp'
          : 'rfq';
  const route = routeFromLegacy(legacyMethod, input.category, input.amount, MWELL_OPERATING_PROFILE);
  return {
    method: legacySourcingMethod(route),
    reasons: [...route.reasons, 'procurement_confirmation_required'],
    requiresProcurementConfirmation: true,
  };
}

/** @deprecated Use deriveProcurementRoute and store its three route axes. */
export function suggestSourcingMethod(input: SuggestSourcingInput): SourcingMethod {
  return deriveSourcingRecommendation(input).method;
}

export function sourcingMethodLabel(m: SourcingMethod): string {
  switch (m) {
    case 'petty_cash':
      return 'Petty cash';
    case 'small_purchase':
      return 'Small purchase';
    case 'rfq':
      return 'RFQ / Canvassing';
    case 'rfp':
      return 'RFP / Bidding';
    case 'direct_award':
      return 'Direct Award';
    case 'repeat_order':
      return 'Repeat Order';
    case 'emergency':
      return 'Emergency Purchase';
  }
}

/** Per-method minimum quote count from policy §5. Used to surface a warning
 *  on the request-detail page when the officer can't yet demonstrate a
 *  quorum. `null` means "no explicit minimum — Procurement judgement". */
export interface SourcingReadinessInput {
  /** Legacy callers may supply the historic method while live sourcing uses a
   * confirmed three-axis route. */
  method?: SourcingMethod;
  route?: ProcurementRoute;
  invited: number;
  responses?: number;
  usableResponses?: number;
  failedBidReason?: FailedBidReason;
  /** This value is a server projection of an approved exception pack. */
  exceptionApproved?: boolean;
  profile?: ProcurementPolicyProfile;
}

export interface SourcingReadiness {
  ready: boolean;
  state: 'draft' | 'failed_bid' | 'evaluation';
  blocker?: string;
}

export function evaluateSourcingReadiness(input: SourcingReadinessInput): SourcingReadiness {
  const profile = input.profile ?? MWELL_OPERATING_PROFILE;
  const usableResponses = input.usableResponses ?? input.responses ?? 0;
  const competitive = input.route
    ? input.route.procurementMode === 'competitive_bidding' && input.route.solicitationType !== 'none'
    : input.method === 'rfq' || input.method === 'rfp';
  if (!competitive) {
    return { ready: true, state: 'evaluation' };
  }
  if (input.invited < profile.controls.inviteTargetMin) {
    return {
      ready: false,
      state: 'draft',
      blocker: `At least ${profile.controls.inviteTargetMin} accredited vendors are required before issue.`,
    };
  }
  if (usableResponses < profile.controls.sealedBidMinimumResponses && !input.exceptionApproved) {
    return {
      ready: false,
      state: 'failed_bid',
      blocker: `${profile.controls.sealedBidMinimumResponses === 3 ? 'Three' : profile.controls.sealedBidMinimumResponses} usable responses are required before sealed-bid opening.`,
    };
  }
  return {
    ready: true,
    state: 'evaluation',
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
  dept_head: 'Department Head',
  procurement_head: 'Procurement Head',
  finance: 'Finance',
  legal: 'Legal',
  final_approver: 'Final Approver (DOA)',
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
export function nextPendingStep(
  steps: ApprovalStep[] | undefined | null,
): ApprovalStep | undefined {
  if (!steps || steps.length === 0) return undefined;
  return [...steps].sort((a, b) => a.order - b.order).find((s) => s.status === 'pending');
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
    {
      key: 'spec',
      label: 'Technical description / spec',
      why: 'Allows comparable vendor responses.',
    },
    {
      key: 'budget',
      label: 'Approved budget evidence',
      why: 'Confirms funding before sourcing.',
    },
    {
      key: 'previous',
      label: 'Previous purchase cost',
      why: 'Supports price reasonableness.',
    },
  ];
  if (sourcingMethod === 'rfp') {
    docs.push({
      key: 'ar',
      label: 'Award Recommendation draft',
      why: 'Required for RFP / bidding (Annex A).',
    });
    docs.push({
      key: 'bids',
      label: 'Vendor proposals',
      why: 'Supports the documented RFP evaluation and sourcing effort.',
    });
  }
  if (sourcingMethod === 'rfq') {
    docs.push({
      key: 'quotes',
      label: 'Comparable quotations',
      why: 'Supports documented RFQ comparison where practicable.',
    });
  }
  if (sourcingMethod === 'direct_award' || sourcingMethod === 'emergency') {
    docs.push({
      key: 'da_justification',
      label: 'Direct-award justification',
      why: 'Annex C — sole supplier / emergency basis.',
    });
  }
  if (category === 'construction' || category === 'manpower') {
    docs.push({
      key: 'bond',
      label: 'Bond / insurance plan',
      why: 'Financial protection matrix (policy §12).',
    });
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
  const kinds = new Set((attachments ?? []).map((a) => a.kind ?? 'other'));
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
  department?: string;
  costCenter?: string;
  neededBy?: string;
  budgetCode?: string;
  projectCode?: string;
  lines?: readonly Pick<ProcurementRequestLine, 'description' | 'quantity'>[];
}): SubmitReadiness {
  const input: BuildLadderInput = {
    category: req.category,
    amount: req.estimatedAmount,
    sourcingMethod: req.sourcingMethod,
  };
  const missingDocs = requiredDocumentsStatus(input, req.attachments)
    .filter((d) => !d.attached)
    .map((d) => d.label);
  if (!req.department?.trim()) missingDocs.unshift('Department');
  if (!req.costCenter?.trim()) missingDocs.unshift('Cost center');
  if (!req.neededBy || Number.isNaN(Date.parse(req.neededBy))) {
    missingDocs.unshift('Needed-by date');
  } else {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (new Date(`${req.neededBy}T00:00:00`).getTime() < today.getTime()) {
      missingDocs.unshift('Needed-by date');
    }
  }
  if (!req.budgetCode?.trim() && !req.projectCode?.trim()) {
    missingDocs.unshift('Budget context');
  }
  if (!Number.isFinite(req.estimatedAmount) || Number(req.estimatedAmount) <= 0) {
    missingDocs.unshift('Positive estimated amount');
  }
  if (!(req.lines ?? []).some((line) => line.description.trim() && Number(line.quantity) > 0)) {
    missingDocs.unshift('At least one valid line item');
  }
  if (!req.compliance?.routeConfirmed) {
    missingDocs.unshift('Procurement-confirmed sourcing route');
  }
  return {
    ok: missingDocs.length === 0,
    missingDocs,
  };
}

/** Keep the disabled submit CTA and submit mutation on the same policy gate. */
export function canSubmitRequest(
  req: Pick<
    ProcurementRequest,
    | 'category'
    | 'estimatedAmount'
    | 'sourcingMethod'
    | 'attachments'
    | 'compliance'
    | 'department'
    | 'costCenter'
    | 'neededBy'
    | 'budgetCode'
    | 'projectCode'
    | 'lines'
  >,
): { allowed: boolean; blockers: string[] } {
  const readiness = evaluateSubmitReadiness(req);
  return { allowed: readiness.ok, blockers: readiness.missingDocs };
}

export function validatePurchaseOrderCancellation(
  status: PurchaseOrderStatus,
  reason: string,
): { allowed: boolean; reason?: string } {
  if (!['draft', 'approved', 'issued'].includes(status)) {
    return {
      allowed: false,
      reason: 'Only draft, approved, or issued POs can be cancelled.',
    };
  }
  if (reason.trim().length < 8) {
    return {
      allowed: false,
      reason: 'Enter a cancellation reason of at least 8 characters.',
    };
  }
  return { allowed: true };
}

export function validateRejectionReason(reason: string | undefined): string | undefined {
  return reason?.trim().length && reason.trim().length >= 8
    ? undefined
    : 'Enter a rejection reason of at least 8 characters.';
}

export interface CommitmentReadinessInput {
  /** Legacy projection retained for existing PO drafts. Route wins when present. */
  sourcingMethod?: SourcingMethod;
  route?: ProcurementRoute;
  policyProfile?: ProcurementPolicyProfile;
  /** Authoritative package kinds, projected by the governed PO-readiness RPC. */
  evidenceKinds?: string[];
  /** Approved ladder tiers projected by the server; client booleans cannot authorize issue. */
  approvedApprovalTiers?: ApproverTier[];
  vendorEligible: boolean;
  category?: RequestCategory;
  exceptionPack?: ProcurementExceptionPack;
  foreignVendor?: boolean;
  importationRequired?: boolean;
  importationPlan?: ImportationPlan;
  downPayment?: boolean;
  construction?: boolean;
  equipmentInstallation?: boolean;
  protections?: {
    downPaymentBondApproved?: boolean;
    manpowerProtectionReviewed?: boolean;
    constructionProtectionsApproved?: boolean;
    installationProtectionsApproved?: boolean;
  };
}

export interface CommitmentEvidenceRequirement {
  kind: string;
  label: string;
  status: 'present' | 'missing';
  basis: string;
  source: string;
  owner: string;
  recovery: string;
}

/**
 * The array shape is deliberately retained for legacy callers. Named fields
 * are non-enumerable so older equality checks still see the original array.
 */
export type CommitmentReadinessResult = string[] & {
  blockers: string[];
  requiredEvidence: CommitmentEvidenceRequirement[];
  ready: boolean;
};

/** Binding controls that must be satisfied before a PO can be issued. */
export function evaluateCommitmentReadiness(input: CommitmentReadinessInput): CommitmentReadinessResult {
  const blockers: string[] = [];
  const requiredEvidence: CommitmentEvidenceRequirement[] = [];
  const route = input.route;
  const sourcingMethod = input.sourcingMethod ?? (route ? legacySourcingMethod(route) : 'rfq');
  const evidenceKinds = new Set(input.evidenceKinds ?? []);
  const requireEvidence = (kind: string, label: string, blocker: string, basis = 'Commitment route', owner = 'Procurement') => {
    const present = evidenceKinds.has(kind);
    requiredEvidence.push({
      kind,
      label,
      status: present ? 'present' : 'missing',
      basis,
      source: route?.policyProfileId ? `Policy profile ${route.policyProfileId}` : 'Procurement policy',
      owner,
      recovery: present ? 'No action required.' : `Provide and govern ${label.toLowerCase()} before issue.`,
    });
    if (!present) blockers.push(blocker);
  };

  if (route) {
    requireEvidence('approved_requisition', 'Approved requisition', 'Approved requisition is required.');
    if (route.solicitationType !== 'none') {
      requireEvidence(route.solicitationType, route.solicitationType.toUpperCase(), `${route.solicitationType.toUpperCase()} solicitation is required.`);
      requireEvidence(route.solicitationType === 'rfq' ? 'quotation' : 'proposal', route.solicitationType === 'rfq' ? 'Quotation' : 'Proposal', `${route.solicitationType === 'rfq' ? 'Quotation' : 'Proposal'} evidence is required.`);
      requireEvidence('commercial_tabulation', 'Commercial tabulation', 'Commercial tabulation is required.');
      requireEvidence('award_recommendation', 'Award recommendation', 'Award recommendation is required.');
    }
    if (route.governanceTier !== 'standard') {
      requireEvidence('technical_evaluation', 'Technical evaluation', 'Technical evaluation is required.');
    }
    if (input.approvedApprovalTiers && input.approvedApprovalTiers.length === 0) {
      blockers.push('Complete approval ladder is required.');
    }
  }
  const pack = input.exceptionPack;
  const validPettyCashException =
    sourcingMethod === 'petty_cash' &&
    pack?.type === 'petty_cash_non_accredited' &&
    Boolean(pack.justification?.trim()) &&
    pack.financeEligibilityConfirmed === true &&
    pack.nonRecurringNonSplitAttested === true;

  if (!input.vendorEligible && !validPettyCashException) {
    blockers.push('current full accreditation or approved scoped temporary clearance');
  }

  if (sourcingMethod === 'direct_award') {
    if (!pack?.directAwardBasis) blockers.push('allowed Direct Award basis');
    if (!pack?.supplierSelected) blockers.push('identified supplier');
    if (!pack?.justification?.trim()) blockers.push('business justification');
    if (!pack?.priceReasonableness?.trim()) blockers.push('price-reasonableness support');
    if (!pack?.procurementHeadReviewed) blockers.push('Procurement Head review');
    if (!pack?.doaApproved) blockers.push('final DOA approval');
  }
  if (sourcingMethod === 'repeat_order' && pack?.type !== 'repeat_continuity') {
    blockers.push('repeat-order continuity evidence and approval');
  }
  if (sourcingMethod === 'emergency' && pack?.type !== 'emergency') {
    blockers.push('documented emergency authority');
  }
  if (sourcingMethod === 'petty_cash') {
    if (!pack?.justification?.trim()) blockers.push('one-time low-value petty-cash justification');
    if (!pack?.financeEligibilityConfirmed)
      blockers.push('Finance petty-cash eligibility confirmation');
    if (!pack?.nonRecurringNonSplitAttested) {
      blockers.push('non-recurring and non-split petty-cash attestation');
    }
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

  if (input.downPayment && !input.protections?.downPaymentBondApproved) {
    blockers.push('down-payment bond equal to the down payment');
  }
  if (input.category === 'manpower' && !input.protections?.manpowerProtectionReviewed) {
    blockers.push('manpower payment-bond or equivalent review');
  }
  if (
    (input.construction || input.category === 'construction') &&
    !input.protections?.constructionProtectionsApproved
  ) {
    blockers.push('construction performance, warranty, insurance, and regulatory review');
  }
  if (input.equipmentInstallation && !input.protections?.installationProtectionsApproved) {
    blockers.push('installation commissioning, defects, warranty, and acceptance controls');
  }
  const result = blockers as CommitmentReadinessResult;
  Object.defineProperties(result, {
    blockers: { value: blockers, enumerable: false },
    requiredEvidence: { value: requiredEvidence, enumerable: false },
    ready: { value: blockers.length === 0, enumerable: false },
  });
  return result;
}

export interface PaymentReadinessInput {
  poOrAgreementApproved: boolean;
  invoiceOrOfficialReceipt: boolean;
  acceptedWarehouseQuantity: number;
  serviceAcceptance: boolean;
  paymentTermsRecorded: boolean;
  taxWithholdingSupport: boolean;
  pettyCashLiquidationRecorded?: boolean;
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
  if (input.pettyCashLiquidationRecorded === false) blockers.push('petty-cash liquidation record');
  return blockers;
}

export function acceptanceTypeForCategory(
  category: RequestCategory | undefined,
): AcceptancePack['acceptanceType'] {
  if (category === 'services' || category === 'subscription' || category === 'manpower') {
    return 'service';
  }
  if (category === 'construction' || category === 'capex') return 'milestone';
  return 'goods';
}

export function calculateInvoiceMatch(input: {
  purchaseOrderAmount: number;
  acceptedAmount: number;
  invoiceAmount: number;
}): { matched: boolean; variance: number } {
  const variance = Number((input.acceptedAmount - input.invoiceAmount).toFixed(2));
  return {
    matched:
      input.invoiceAmount > 0 &&
      input.invoiceAmount <= input.purchaseOrderAmount &&
      Math.abs(variance) < 0.01,
    variance,
  };
}

export function evaluateIssueReadiness(input: {
  poApproved: boolean;
  sourceAwardApproved: boolean;
  vendorEligible: boolean;
}): string[] {
  const blockers: string[] = [];
  if (!input.poApproved) blockers.push('PO award approval');
  if (!input.sourceAwardApproved) blockers.push('approved source request');
  if (!input.vendorEligible)
    blockers.push('current vendor accreditation or scoped temporary clearance');
  return blockers;
}

export function evaluatePaymentPackReadiness(
  acceptance: AcceptancePack | AcceptancePack[] | undefined,
  pack: PaymentReadinessPack | undefined,
): string[] {
  const blockers: string[] = [];
  const acceptances = (
    Array.isArray(acceptance) ? acceptance : acceptance ? [acceptance] : []
  ).filter((item) => item.status !== 'superseded');
  if (acceptances.length === 0) blockers.push('requester or Warehouse acceptance');
  if (acceptances.some((item) => item.exceptions.length > 0))
    blockers.push('unresolved acceptance exceptions');
  if (acceptances.length > 0 && pack) {
    const activeIds = acceptances.map((item) => item.id).sort();
    const boundIds = [
      ...(pack.acceptancePackIds ?? (pack.acceptancePackId ? [pack.acceptancePackId] : [])),
    ].sort();
    if (
      activeIds.length !== boundIds.length ||
      activeIds.some((id, index) => id !== boundIds[index])
    ) {
      blockers.push('complete active acceptance evidence set');
    }
  }
  if (!pack?.poMatch) blockers.push('PO/receipt/invoice match');
  if (!pack?.invoiceOrSiReference) blockers.push('invoice, OR, or SI');
  if (!pack?.milestoneSupportReference) blockers.push('delivery or milestone evidence');
  if (!pack?.taxWithholdingSupportReference) blockers.push('tax and withholding support');
  return blockers;
}
