import type { ProcurementPolicyProfile } from './types';

export type VendorEligibilityStatus =
  | 'approved'
  | 'probation'
  | 'provisional'
  | 'expired'
  | 'suspended'
  | 'rejected'
  | 'temporary_clearance';

export type VendorEligibilityAction = 'invite' | 'issue_purchase_order' | 'prepare_payment';

export interface TemporaryClearance {
  approved: boolean;
  scope: string;
  effectiveAt: string;
  expiresAt: string;
  authority: 'Legal/VMO';
}

export interface VendorProbationReview {
  status: 'open' | 'completed' | 'overdue' | 'cancelled';
  decision?: 'pass' | 'extend' | 'revoke' | 'suspend';
  poWinRate?: number;
  deliveryCommitmentRate?: number;
  returnOrRejectionCount?: number;
  documentTimelinessRate?: number;
  evidenceReference?: string;
  noticeReference?: string;
}

export interface VendorEligibilityInput {
  status: VendorEligibilityStatus;
  asOf: string;
  accreditationExpiresAt?: string;
  intendedScope?: string;
  temporaryClearance?: TemporaryClearance;
  probationReview?: VendorProbationReview;
}

export interface VendorEligibilityResult {
  status: VendorEligibilityStatus;
  eligible: boolean;
  allowedActions: VendorEligibilityAction[];
  authority: 'Legal/VMO';
  blockers: string[];
  probation?: {
    meetsTargets: boolean;
    missingEvidence: string[];
  };
}

export interface PaymentEvidenceInput {
  invoiceAmount: number;
  policyProfile: ProcurementPolicyProfile;
  invoicePresent: boolean;
  poPresent: boolean;
  acceptancePresent: boolean;
  taxEvidencePresent: boolean;
  amountQuantityMatch: boolean;
  foreignVendor?: boolean;
  foreignVendorEvidencePresent?: boolean;
}

export interface PaymentEvidenceResult {
  ready: boolean;
  threshold: number;
  thresholdSource: string;
  blockers: string[];
  items: Array<{
    label: string;
    present: boolean;
  }>;
}

const isCurrent = (from: string, to: string, asOf: string): boolean => from <= asOf && asOf <= to;

function evaluateProbation(review: VendorProbationReview | undefined) {
  const missingEvidence: string[] = [];
  if (review?.status !== 'completed') missingEvidence.push('Completed six-month probation review');
  if (!review?.decision) missingEvidence.push('Written Legal/VMO decision');
  if (!review?.evidenceReference) missingEvidence.push('Review evidence');
  if (!review?.noticeReference) missingEvidence.push('Certification, extension, revocation, or suspension notice');

  const meetsTargets = review?.poWinRate !== undefined
    && review.poWinRate >= 0.2
    && review.deliveryCommitmentRate === 1
    && review.returnOrRejectionCount === 0
    && review.documentTimelinessRate === 1;

  return { meetsTargets, missingEvidence };
}

/**
 * A read-only procurement projection of Legal/VMO vendor authority. Callers
 * cannot convert a UI selection or an asserted status into eligibility.
 */
export function evaluateVendorEligibility(input: VendorEligibilityInput): VendorEligibilityResult {
  const blockers: string[] = [];
  const accreditationExpired = Boolean(
    input.accreditationExpiresAt && input.accreditationExpiresAt < input.asOf,
  );
  const probation = input.status === 'probation'
    ? evaluateProbation(input.probationReview)
    : undefined;
  let eligible = false;

  if (['expired', 'suspended', 'rejected'].includes(input.status) || accreditationExpired) {
    blockers.push('Legal/VMO eligibility is not current.');
  } else if (input.status === 'approved') {
    eligible = true;
  } else if (input.status === 'probation') {
    if (input.probationReview?.decision === 'revoke' || input.probationReview?.decision === 'suspend') {
      blockers.push('The latest Legal/VMO probation decision blocks engagement.');
    } else {
      eligible = true;
    }
  } else if (input.status === 'temporary_clearance') {
    const clearance = input.temporaryClearance;
    if (!clearance?.approved || clearance.authority !== 'Legal/VMO') {
      blockers.push('An approved Legal/VMO temporary clearance is required.');
    } else if (!isCurrent(clearance.effectiveAt, clearance.expiresAt, input.asOf)) {
      blockers.push('The temporary clearance is not effective on the transaction date.');
    } else if (!input.intendedScope || clearance.scope.trim().toLocaleLowerCase() !== input.intendedScope.trim().toLocaleLowerCase()) {
      blockers.push('The temporary clearance does not cover this request scope.');
    } else {
      eligible = true;
    }
  } else {
    blockers.push('Provisional vendor status does not authorize invitation or PO issue without scoped temporary clearance.');
  }

  return {
    status: input.status,
    eligible,
    allowedActions: eligible ? ['invite', 'issue_purchase_order', 'prepare_payment'] : [],
    authority: 'Legal/VMO',
    blockers,
    probation,
  };
}

/**
 * Produces a transparent client-side explanation only. The governed payment
 * RPC independently recomputes every item from request, PO, receipt, and tax
 * records before Finance may accept or release a payment.
 */
export function evaluatePaymentEvidence(input: PaymentEvidenceInput): PaymentEvidenceResult {
  const threshold = input.policyProfile.controls.poInvoiceThreshold;
  const thresholdSource = input.policyProfile.controlSources.poInvoiceThreshold
    ?? input.policyProfile.name;
  const items = [
    { label: 'Invoice, OR, or SI evidence', present: input.invoicePresent },
    { label: 'Purchase order or agreement evidence', present: input.poPresent },
    { label: 'Receipt or acceptance evidence', present: input.acceptancePresent },
    { label: 'Amount and quantity match', present: input.amountQuantityMatch },
    { label: 'Tax and withholding support', present: input.taxEvidencePresent },
    ...(input.foreignVendor
      ? [{ label: 'Foreign-vendor tax, withholding, and payment controls', present: Boolean(input.foreignVendorEvidencePresent) }]
      : []),
  ];
  const blockers: string[] = [];

  if (!input.invoicePresent) blockers.push('Invoice, OR, or SI evidence is required.');
  if (!input.poPresent && input.invoiceAmount >= threshold) {
    blockers.push(`Purchase order evidence is required at or above PHP ${threshold.toLocaleString('en-PH')}.`);
  }
  if (!input.acceptancePresent) blockers.push('Receipt or acceptance evidence is required.');
  if (!input.amountQuantityMatch) blockers.push('Amount and quantity must match governed PO and acceptance records.');
  if (!input.taxEvidencePresent) blockers.push('Tax and withholding support is required.');
  if (input.foreignVendor && !input.foreignVendorEvidencePresent) {
    blockers.push('Foreign-vendor tax, withholding, and payment-control evidence is required.');
  }

  return {
    ready: blockers.length === 0,
    threshold,
    thresholdSource,
    blockers,
    items,
  };
}
