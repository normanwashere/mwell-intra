import { describe, expect, it } from 'vitest';
import { MWELL_OPERATING_PROFILE } from './policyProfile';
import { evaluateProcurementException, type ProcurementExceptionInput } from './procurementExceptions';

const repeat = (changes: Partial<Extract<ProcurementExceptionInput, { mode: 'repeat_order' }>> = {}): Extract<ProcurementExceptionInput, { mode: 'repeat_order' }> => ({
  mode: 'repeat_order', amount: 100_000, procurementReviewed: true, doaApproved: true,
  samePrice: true, sameTerms: true, sameVendor: true, sameConsiderations: true,
  priorCompetitiveAward: true, priorAwardAgeDays: 100, materialScopeChange: false,
  priorRequestId: 'REQ-1', priorSourcingEventId: 'EVENT-1', priorAwardId: 'AWARD-1', priorPurchaseOrderId: 'PO-1', ...changes,
});
const petty = (changes: Partial<Extract<ProcurementExceptionInput, { mode: 'petty_cash' }>> = {}): Extract<ProcurementExceptionInput, { mode: 'petty_cash' }> => ({
  mode: 'petty_cash', amount: 1_000, procurementReviewed: true, doaApproved: true,
  splitPurchase: false, recurring: false, financeEligible: true, receiptPresent: true, liquidationRecorded: true, ...changes,
});
const emergency = (changes: Partial<Extract<ProcurementExceptionInput, { mode: 'emergency_purchase' }>> = {}): Extract<ProcurementExceptionInput, { mode: 'emergency_purchase' }> => ({
  mode: 'emergency_purchase', amount: 20_000, procurementReviewed: true, doaApproved: true,
  basis: 'life_safety', authorityRecorded: true, commitmentTimestamp: '2026-08-23T00:00:00Z', minimizedVerbalCommitment: true, retrospectivePoDueAt: '2026-08-24T00:00:00Z', ...changes,
});
const sole = (changes: Partial<Extract<ProcurementExceptionInput, { mode: 'sole_source' }>> = {}): Extract<ProcurementExceptionInput, { mode: 'sole_source' }> => ({
  mode: 'sole_source', amount: 20_000, procurementReviewed: true, doaApproved: true,
  basis: 'only_acceptable_source', evidenceReferences: ['evidence-1'], priceReasonableness: 'Prior purchase and market benchmark.', ...changes,
});

describe('procurement exception eligibility', () => {
  it.each([
    ['repeat changed price', repeat({ samePrice: false }), 'Same price is required.'],
    ['repeat stale source', repeat({ priorAwardAgeDays: 366 }), 'Prior competitive source must be no older than 365 days.'],
    ['repeat over limit', repeat({ amount: 250_001 }), 'Amount exceeds the active repeat-order limit.'],
    ['petty cash split', petty({ splitPurchase: true }), 'Split purchases are not eligible for petty cash.'],
    ['petty cash over limit', petty({ amount: 2_001 }), 'Amount exceeds the active petty-cash limit.'],
    ['emergency convenience', emergency({ basis: undefined }), 'A qualifying emergency basis is required.'],
    ['sole source no basis', sole({ basis: undefined }), 'An evidence-backed sole-source basis is required.'],
  ])('%s', (_name, input, blocker) => {
    expect(evaluateProcurementException(input, MWELL_OPERATING_PROFILE).blockers).toContain(blocker);
  });

  it('requires all prior competitive links and server-recorded approvals for repeat orders', () => {
    const result = evaluateProcurementException(repeat({ priorAwardId: undefined, procurementReviewed: false, doaApproved: false }), MWELL_OPERATING_PROFILE);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'Link the prior competitive request, event, award, and PO.',
      'Procurement review is required.',
      'Active DOA approval is required.',
    ]));
  });

  it('describes evidence without treating client fields as authorization', () => {
    const result = evaluateProcurementException(sole({ procurementReviewed: false, doaApproved: false }), MWELL_OPERATING_PROFILE);
    expect(result.eligible).toBe(false);
    expect(result.requiredEvidence).toContain('Active DOA approval');
  });
});
