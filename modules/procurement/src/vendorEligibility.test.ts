import { describe, expect, it } from 'vitest';

import { MWELL_OPERATING_PROFILE } from './policyProfile';
import { evaluatePaymentEvidence, evaluateVendorEligibility } from './vendorEligibility';

describe('vendor eligibility projection', () => {
  it.each(['expired', 'suspended', 'rejected'] as const)(
    'blocks a %s vendor from invitation and PO issue',
    (status) => {
      const eligibility = evaluateVendorEligibility({ status, asOf: '2026-08-22' });

      expect(eligibility.eligible).toBe(false);
      expect(eligibility.allowedActions).toEqual([]);
    },
  );

  it('permits a temporary clearance only for its active approved scope', () => {
    const input = {
      status: 'temporary_clearance' as const,
      asOf: '2026-08-22',
      intendedScope: 'diagnostic consumables',
      temporaryClearance: {
        approved: true,
        scope: 'diagnostic consumables',
        effectiveAt: '2026-08-01',
        expiresAt: '2026-08-31',
        authority: 'Legal/VMO' as const,
      },
    };

    expect(evaluateVendorEligibility(input).eligible).toBe(true);
    expect(evaluateVendorEligibility({ ...input, intendedScope: 'laboratory equipment' }).eligible).toBe(false);
    expect(evaluateVendorEligibility({ ...input, asOf: '2026-09-01' }).eligible).toBe(false);
  });

  it('reports the complete Legal/VMO probation decision pack before a pass', () => {
    const eligibility = evaluateVendorEligibility({
      status: 'probation',
      asOf: '2026-08-22',
      probationReview: {
        status: 'completed',
        decision: 'pass',
        poWinRate: 0.2,
        deliveryCommitmentRate: 1,
        returnOrRejectionCount: 0,
        documentTimelinessRate: 1,
        evidenceReference: 'private/vendor-review.pdf',
        noticeReference: 'private/vendor-pass-notice.pdf',
      },
    });

    expect(eligibility.probation?.meetsTargets).toBe(true);
    expect(eligibility.eligible).toBe(true);
  });
});

describe('payment evidence projection', () => {
  it('uses the request-bound active profile and requires separate invoice, PO, acceptance, and tax evidence', () => {
    const result = evaluatePaymentEvidence({
      invoiceAmount: 50_000,
      policyProfile: MWELL_OPERATING_PROFILE,
      invoicePresent: true,
      poPresent: false,
      acceptancePresent: true,
      taxEvidencePresent: false,
      amountQuantityMatch: true,
    });

    expect(result.threshold).toBe(50_000);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'Purchase order evidence is required at or above PHP 50,000.',
      'Tax and withholding support is required.',
    ]));
  });

  it('requires foreign-vendor and match support without trusting caller payment readiness', () => {
    const result = evaluatePaymentEvidence({
      invoiceAmount: 75_000,
      policyProfile: MWELL_OPERATING_PROFILE,
      invoicePresent: true,
      poPresent: true,
      acceptancePresent: true,
      taxEvidencePresent: true,
      amountQuantityMatch: false,
      foreignVendor: true,
      foreignVendorEvidencePresent: false,
    });

    expect(result.ready).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining([
      'Amount and quantity must match governed PO and acceptance records.',
      'Foreign-vendor tax, withholding, and payment-control evidence is required.',
    ]));
  });
});
