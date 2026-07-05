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
// TODO(policy-owner): three thresholds below (petty cash, small purchase,
// finance escalation) are internal defaults — they are not spelled out in the
// source doc. The RFQ ↔ RFP boundary at PHP 1,000,000 IS in policy §5. Adjust
// the internal amounts here once the Delegation of Authority document lands.

import type {
  ApprovalStep,
  ApproverTier,
  RequestCategory,
  SourcingMethod,
} from './types';

// ---------------------------------------------------------------------------
// Thresholds (in PHP)
// ---------------------------------------------------------------------------

/** Policy §5: RFP / bidding kicks in at PHP 1,000,000 and above. */
export const RFP_THRESHOLD = 1_000_000;

/** Internal default — petty cash covers ad-hoc, low-value operational buys.
 *  Awaits DOA confirmation. */
export const PETTY_CASH_MAX = 15_000;

/** Internal default — small-purchase "one quote is enough" band, sitting
 *  between petty cash and full RFQ. Awaits DOA confirmation. */
export const SMALL_PURCHASE_MAX = 100_000;

/** Internal default — Finance tier joins the ladder at PHP 200,000+ or when
 *  category is capex / construction / manpower (regardless of amount). */
export const FINANCE_TIER_MIN = 200_000;

/** Policy §12: construction contracts at PHP 5M+ trigger performance bonds. */
export const CONSTRUCTION_BOND_TRIGGER = 5_000_000;

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
}

/**
 * Suggest a sourcing path per policy §5 + §11. The rules:
 *   1. Emergency overrides everything → 'emergency'.
 *   2. Repeat order flag → 'repeat_order'.
 *   3. Petty cash category or amount ≤ PETTY_CASH_MAX → 'petty_cash'.
 *   4. High-risk categories (capex/construction/manpower/medical) escalate to
 *      RFP regardless of amount (policy §5 "complex, technical, strategic,
 *      or high-risk work regardless of amount").
 *   5. Amount ≥ RFP_THRESHOLD (PHP 1,000,000) → 'rfp'.
 *   6. Amount ≥ SMALL_PURCHASE_MAX → 'rfq'.
 *   7. Amount < SMALL_PURCHASE_MAX → 'small_purchase'.
 *   8. Amount unknown → 'rfq' (safe default for the officer to override).
 *
 * The officer can override any suggestion with a justification stored in
 * `compliance.directAwardReason` + `compliance.priceReasonableness`.
 */
export function suggestSourcingMethod(input: SuggestSourcingInput): SourcingMethod {
  const { category, amount, emergency, repeat } = input;
  if (emergency) return 'emergency';
  if (repeat) return 'repeat_order';
  if (category === 'petty_cash') return 'petty_cash';
  if (typeof amount === 'number' && amount > 0 && amount <= PETTY_CASH_MAX) {
    return 'petty_cash';
  }
  const meta = categoryMeta(category);
  if (meta?.highRisk) return 'rfp';
  if (typeof amount !== 'number' || amount <= 0) return 'rfq';
  if (amount >= RFP_THRESHOLD) return 'rfp';
  if (amount >= SMALL_PURCHASE_MAX) return 'rfq';
  return 'small_purchase';
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
export function minimumQuotes(m: SourcingMethod): number | null {
  switch (m) {
    case 'petty_cash':
    case 'small_purchase':
    case 'direct_award':
    case 'repeat_order':
    case 'emergency':
      return null;
    case 'rfq':
      return 2;
    case 'rfp':
      return 3;
  }
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
 *   finance — inserted before final_approver when amount ≥ FINANCE_TIER_MIN
 *             OR category ∈ {capex, construction, manpower}.
 *   legal   — inserted after procurement_head when the category loops Legal
 *             in (services, subscription, construction, manpower, it_software)
 *             OR sourcing method ∈ {direct_award, emergency, rfp} (§11 + §9).
 */
export function buildApprovalLadder(input: BuildLadderInput): ApproverTier[] {
  const { category, amount, sourcingMethod } = input;
  const tiers: ApproverTier[] = ['dept_head', 'procurement_head'];

  const meta = categoryMeta(category);
  const highValue = typeof amount === 'number' && amount >= FINANCE_TIER_MIN;
  const categoryNeedsFinance =
    category === 'capex' || category === 'construction' || category === 'manpower';

  const legalTriggered =
    !!meta?.requiresLegal ||
    sourcingMethod === 'direct_award' ||
    sourcingMethod === 'emergency' ||
    sourcingMethod === 'rfp';

  if (legalTriggered) tiers.push('legal');
  if (highValue || categoryNeedsFinance) tiers.push('finance');

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
    label: tierLabel(tier),
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
  actor: { email?: string; note?: string; at: string },
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
    docs.push({ key: 'bids', label: 'Vendor proposals (≥3)', why: 'RFP quorum per policy §5.' });
  }
  if (sourcingMethod === 'rfq') {
    docs.push({ key: 'quotes', label: 'Comparable quotations (≥2)', why: 'RFQ / canvassing per policy §5.' });
  }
  if (sourcingMethod === 'direct_award' || sourcingMethod === 'emergency') {
    docs.push({ key: 'da_justification', label: 'Direct-award justification', why: 'Annex C — sole supplier / emergency basis.' });
  }
  if (category === 'construction' || category === 'manpower') {
    docs.push({ key: 'bond', label: 'Bond / insurance plan', why: 'Financial protection matrix (policy §12).' });
  }
  return docs;
}
