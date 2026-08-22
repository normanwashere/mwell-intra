import type { ProcurementPolicyProfile } from './types';

export type SoleSourceBasis =
  | 'only_acceptable_source'
  | 'compatibility'
  | 'specialization'
  | 'unique_capability'
  | 'manufacturer'
  | 'authorized_distributor';

export type EmergencyBasis =
  | 'life_safety'
  | 'environmental'
  | 'serious_disruption';

interface ExceptionBase {
  amount: number;
  procurementReviewed: boolean;
  doaApproved: boolean;
}

export type ProcurementExceptionInput =
  | (ExceptionBase & {
      mode: 'sole_source';
      basis?: SoleSourceBasis;
      evidenceReferences: string[];
      priceReasonableness: string;
    })
  | (ExceptionBase & {
      mode: 'repeat_order';
      samePrice: boolean;
      sameTerms: boolean;
      sameVendor: boolean;
      sameConsiderations: boolean;
      priorCompetitiveAward: boolean;
      priorAwardAgeDays?: number;
      materialScopeChange: boolean;
      priorRequestId?: string;
      priorSourcingEventId?: string;
      priorAwardId?: string;
      priorPurchaseOrderId?: string;
    })
  | (ExceptionBase & {
      mode: 'emergency_purchase';
      basis?: EmergencyBasis;
      authorityRecorded: boolean;
      commitmentTimestamp?: string;
      minimizedVerbalCommitment: boolean;
      retrospectivePoDueAt?: string;
    })
  | (ExceptionBase & {
      mode: 'petty_cash';
      splitPurchase: boolean;
      recurring: boolean;
      financeEligible: boolean;
      receiptPresent: boolean;
      liquidationRecorded: boolean;
    })
  | (ExceptionBase & {
      mode: 'approved_exception';
      approvedExceptionPackId?: string;
      evidenceReferences: string[];
    });

export interface ProcurementExceptionEvaluation {
  eligible: boolean;
  blockers: string[];
  requiredEvidence: string[];
}

const REVIEW_BLOCKERS = (input: ExceptionBase): string[] => {
  const blockers: string[] = [];
  if (!input.procurementReviewed) blockers.push('Procurement review is required.');
  if (!input.doaApproved) blockers.push('Active DOA approval is required.');
  return blockers;
};

function hasText(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function hasReferences(references: readonly string[]): boolean {
  return references.some((reference) => hasText(reference));
}

/**
 * Client guidance only. Live transitions repeat this policy against persisted
 * evidence and the current profile in Supabase.
 */
export function evaluateProcurementException(
  input: ProcurementExceptionInput,
  profile: ProcurementPolicyProfile,
): ProcurementExceptionEvaluation {
  const blockers = REVIEW_BLOCKERS(input);
  let requiredEvidence: string[] = [];

  switch (input.mode) {
    case 'sole_source':
      requiredEvidence = ['Enumerated sole-source basis', 'Evidence references', 'Price reasonableness', 'Procurement review', 'Active DOA approval'];
      if (!input.basis) blockers.push('An evidence-backed sole-source basis is required.');
      if (!hasReferences(input.evidenceReferences)) blockers.push('Evidence references are required.');
      if (!hasText(input.priceReasonableness)) blockers.push('Price reasonableness is required.');
      break;
    case 'repeat_order': {
      requiredEvidence = ['Prior competitive request, event, award, and PO', 'Same price, terms, vendor, and considerations', 'No material scope change', 'Procurement review', 'Active DOA approval'];
      if (!input.samePrice) blockers.push('Same price is required.');
      if (!input.sameTerms) blockers.push('Same terms are required.');
      if (!input.sameVendor) blockers.push('Same vendor is required.');
      if (!input.sameConsiderations) blockers.push('Same considerations are required.');
      if (!input.priorCompetitiveAward) blockers.push('A prior competitive award is required.');
      if (input.priorAwardAgeDays == null || input.priorAwardAgeDays > profile.controls.repeatOrderMaxAgeDays) {
        blockers.push(`Prior competitive source must be no older than ${profile.controls.repeatOrderMaxAgeDays} days.`);
      }
      if (input.amount > profile.controls.repeatOrderMaxAmount) blockers.push('Amount exceeds the active repeat-order limit.');
      if (input.materialScopeChange) blockers.push('Material scope changes are not eligible for repeat order.');
      if (!input.priorRequestId || !input.priorSourcingEventId || !input.priorAwardId || !input.priorPurchaseOrderId) {
        blockers.push('Link the prior competitive request, event, award, and PO.');
      }
      break;
    }
    case 'emergency_purchase':
      requiredEvidence = ['Qualifying emergency basis', 'Emergency authority', 'Commitment timestamp', 'Minimal verbal commitment record', 'Retrospective PO due date', 'Procurement review', 'Active DOA approval'];
      if (!input.basis) blockers.push('A qualifying emergency basis is required.');
      if (!input.authorityRecorded) blockers.push('Emergency authority is required.');
      if (!hasText(input.commitmentTimestamp)) blockers.push('Commitment timestamp is required.');
      if (!input.minimizedVerbalCommitment) blockers.push('A minimized verbal commitment record is required.');
      if (!hasText(input.retrospectivePoDueAt)) blockers.push('A retrospective PO due date is required.');
      break;
    case 'petty_cash':
      requiredEvidence = ['Finance eligibility decision', 'Receipt or invoice', 'Liquidation record', 'Procurement review', 'Active DOA approval'];
      if (input.amount > profile.controls.pettyCashMaxAmount) blockers.push('Amount exceeds the active petty-cash limit.');
      if (input.splitPurchase) blockers.push('Split purchases are not eligible for petty cash.');
      if (input.recurring) blockers.push('Recurring purchases are not eligible for petty cash.');
      if (!input.financeEligible) blockers.push('Governed Finance eligibility is required.');
      if (!input.receiptPresent) blockers.push('Receipt or invoice is required.');
      if (!input.liquidationRecorded) blockers.push('Liquidation record is required.');
      break;
    case 'approved_exception':
      requiredEvidence = ['Approved exception pack', 'Evidence references', 'Procurement review', 'Active DOA approval'];
      if (!hasText(input.approvedExceptionPackId)) blockers.push('An approved exception pack is required.');
      if (!hasReferences(input.evidenceReferences)) blockers.push('Evidence references are required.');
      break;
  }

  return { eligible: blockers.length === 0, blockers, requiredEvidence };
}
