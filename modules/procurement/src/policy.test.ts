import { describe, expect, it } from 'vitest';
import {
  RFP_THRESHOLD,
  applyStepDecision,
  buildApprovalLadder,
  buildApprovalSteps,
  categoryMeta,
  deriveSourcingRecommendation,
  evaluateSourcingReadiness,
  evaluateSubmitReadiness,
  nextApprover,
  nextPendingStep,
  requiredDocuments,
  requiredDocumentsStatus,
  resolveDoaAssignment,
  suggestSourcingMethod,
  tierLabel,
  evaluateCommitmentReadiness,
  evaluatePaymentReadiness,
} from './policy';
import type { ApprovalStep } from './types';

describe('sourcing policy', () => {
  it('routes emergencies and repeat-continuity cases explicitly', () => {
    expect(suggestSourcingMethod({ amount: 5_000_000, emergency: true })).toBe('emergency');
    expect(suggestSourcingMethod({ amount: 50_000, repeat: true })).toBe('repeat_order');
  });

  it('allows petty cash only when the request explicitly uses that category', () => {
    expect(suggestSourcingMethod({ category: 'petty_cash', amount: 50_000 })).toBe('petty_cash');
    expect(suggestSourcingMethod({ category: 'goods', amount: 1 })).toBe('rfq');
    expect(suggestSourcingMethod({ category: 'goods', amount: 99_999 })).toBe('rfq');
  });

  it('uses the sourced PHP 1,000,000 RFQ/RFP boundary', () => {
    expect(suggestSourcingMethod({ category: 'goods', amount: RFP_THRESHOLD - 0.01 })).toBe('rfq');
    expect(suggestSourcingMethod({ category: 'goods', amount: RFP_THRESHOLD })).toBe('rfp');
  });

  it('escalates complex and data-sensitive work regardless of amount', () => {
    expect(suggestSourcingMethod({ category: 'construction', amount: 10_000 })).toBe('rfp');
    expect(
      deriveSourcingRecommendation({ amount: 10_000, comparable: true, dataSensitive: true }),
    ).toMatchObject({ method: 'rfp', reasons: ['data_sensitive'] });
  });

  it('defaults incomplete intake to an RFQ recommendation pending Procurement confirmation', () => {
    expect(suggestSourcingMethod({})).toBe('rfq');
  });
});

describe('binding vendor-to-pay controls', () => {
  it.each([
    ['simple comparable below threshold', { amount: RFP_THRESHOLD - 0.01, comparable: true }, 'rfq'],
    ['threshold amount', { amount: RFP_THRESHOLD, comparable: true }, 'rfp'],
    ['low-value complex work', { amount: 25_000, comparable: true, complex: true }, 'rfp'],
    ['low-value technical work', { amount: 25_000, comparable: true, technical: true }, 'rfp'],
    ['low-value high-risk work', { amount: 25_000, comparable: true, highRisk: true }, 'rfp'],
    ['low-value data-sensitive work', { amount: 25_000, comparable: true, dataSensitive: true }, 'rfp'],
  ])('routes %s through the sourced method', (_label, input, expected) => {
    expect(deriveSourcingRecommendation(input).method).toBe(expected);
  });

  it('blocks unsupported Direct Award, repeat-order, emergency, and petty-cash exceptions', () => {
    expect(evaluateCommitmentReadiness({
      sourcingMethod: 'direct_award',
      vendorEligible: true,
      exceptionPack: {
        type: 'direct_award', justification: '', priceReasonableness: '',
        procurementHeadReviewed: false, doaApproved: false,
      },
    })).toEqual(expect.arrayContaining([
      'allowed Direct Award basis',
      'business justification',
      'price-reasonableness support',
      'Procurement Head review',
      'final DOA approval',
    ]));
    expect(evaluateCommitmentReadiness({
      sourcingMethod: 'repeat_order', vendorEligible: true,
    })).toContain('repeat-order continuity evidence and approval');
    expect(evaluateCommitmentReadiness({
      sourcingMethod: 'emergency', vendorEligible: true,
    })).toContain('documented emergency authority');
    expect(evaluateCommitmentReadiness({
      sourcingMethod: 'petty_cash', vendorEligible: false,
      exceptionPack: {
        type: 'petty_cash_non_accredited', justification: 'One-time office need',
        financeEligibilityConfirmed: true, nonRecurringNonSplitAttested: false,
      },
    })).toContain('non-recurring and non-split petty-cash attestation');
  });

  it('permits the narrow non-accredited petty-cash path only with Finance, OR/SI, and liquidation controls', () => {
    const base = {
      sourcingMethod: 'petty_cash' as const,
      vendorEligible: false,
      exceptionPack: {
        type: 'petty_cash_non_accredited' as const,
        justification: 'One-time low-value office need',
        financeEligibilityConfirmed: true,
        nonRecurringNonSplitAttested: true,
      },
    };
    expect(evaluateCommitmentReadiness(base)).toEqual(expect.arrayContaining([
      'official receipt or sales invoice support',
      'petty-cash liquidation record',
    ]));
    expect(evaluateCommitmentReadiness({
      ...base,
      exceptionPack: {
        ...base.exceptionPack,
        receiptOrInvoiceSupported: true,
        liquidationRecorded: true,
      },
    })).toEqual([]);
  });

  it('requires the complete foreign-vendor and importation control record', () => {
    expect(evaluateCommitmentReadiness({
      sourcingMethod: 'rfp', vendorEligible: true, foreignVendor: true,
      importationRequired: true,
      importationPlan: {
        incoterms: 'DAP', importerOfRecord: '', permitsAndRegistrations: '',
        customsBrokerAndLogistics: '', dutiesTaxesFreightInsurance: '',
        foreignPaymentTiming: '', deliveryAcceptanceAndWarranty: '',
      },
    })).toEqual(expect.arrayContaining([
      'importer of record',
      'import permits and registrations',
      'landed cost, duties, taxes, freight, and insurance',
      'currency and foreign-payment risk',
      'delivery, acceptance, and warranty point',
    ]));
  });

  it('blocks issue when accreditation is expired or temporary clearance lacks approved scope', () => {
    expect(evaluateCommitmentReadiness({ sourcingMethod: 'rfq', vendorEligible: false }))
      .toContain('current full accreditation or approved scoped temporary clearance');
  });

  it('applies sourced down-payment, manpower, construction, and installation protections', () => {
    expect(evaluateCommitmentReadiness({
      sourcingMethod: 'rfp', vendorEligible: true, downPayment: true,
      category: 'manpower', construction: true, equipmentInstallation: true,
    })).toEqual(expect.arrayContaining([
      'down-payment bond equal to the down payment',
      'manpower payment-bond or equivalent review',
      'construction performance, warranty, insurance, and regulatory review',
      'installation commissioning, defects, warranty, and acceptance controls',
    ]));
  });

  it('denies payment readiness without accepted receipt or service evidence', () => {
    expect(evaluatePaymentReadiness({
      poOrAgreementApproved: true,
      invoiceOrOfficialReceipt: true,
      acceptedWarehouseQuantity: 0,
      serviceAcceptance: false,
      paymentTermsRecorded: true,
      taxWithholdingSupport: true,
    })).toContain('accepted Warehouse receipt or service acceptance');
  });
});

describe('sourcing response readiness', () => {
  it('does not fabricate a fixed quote shortfall', () => {
    expect(evaluateSourcingReadiness({ method: 'rfq', invited: 3, responses: 1 })).toEqual({
      ready: true,
      insufficientBidsExceptionRequired: false,
    });
  });

  it('requires an exception when Procurement recorded a higher intended response count', () => {
    expect(
      evaluateSourcingReadiness({ method: 'rfp', intendedResponses: 3, invited: 4, responses: 1 }),
    ).toEqual({ ready: false, insufficientBidsExceptionRequired: true });
  });
});

describe('DOA resolution', () => {
  it('fails closed without an active approved assignment', () => {
    expect(resolveDoaAssignment([], 500_000)).toEqual({
      status: 'policy_decision_required',
      assignment: undefined,
    });
  });

  it('returns the active versioned assignment that covers the amount', () => {
    const assignment = {
      id: 'doa-1',
      matrixVersion: '2026-07-approved',
      minAmount: 0,
      maxAmount: 1_000_000,
      approverUserId: 'user-1',
      approverName: 'Approved BU Head',
      active: true,
    } as const;
    expect(resolveDoaAssignment([assignment], 500_000)).toEqual({
      status: 'resolved',
      assignment,
    });
  });
});

describe('approval ladder', () => {
  it('keeps the policy process tiers and does not infer Finance from amount alone', () => {
    expect(buildApprovalLadder({ category: 'goods', amount: 900_000, sourcingMethod: 'rfq' })).toEqual([
      'dept_head',
      'procurement_head',
      'final_approver',
    ]);
  });

  it('adds Finance for policy categories with financial-protection exposure', () => {
    expect(buildApprovalLadder({ category: 'construction', amount: 10_000 })).toContain('finance');
    expect(buildApprovalLadder({ category: 'manpower', amount: 10_000 })).toContain('finance');
  });

  it('adds Legal for contractual or exception routes', () => {
    expect(buildApprovalLadder({ category: 'services', amount: 20_000, sourcingMethod: 'rfq' })).toContain('legal');
    expect(buildApprovalLadder({ category: 'goods', amount: 20_000, sourcingMethod: 'direct_award' })).toContain('legal');
  });

  it('builds ordered pending steps with an unresolved DOA label', () => {
    let n = 0;
    const steps = buildApprovalSteps(
      { category: 'services', amount: 250_000, sourcingMethod: 'rfq' },
      () => `id-${++n}`,
    );
    expect(steps.map((step) => step.tier)).toEqual([
      'dept_head',
      'procurement_head',
      'legal',
      'final_approver',
    ]);
    expect(steps.at(-1)?.label).toContain('Policy decision required');
    expect(steps[0]?.label).toBe(tierLabel('dept_head'));
  });
});

describe('approval progression', () => {
  const now = '2026-07-05T00:00:00.000Z';
  const steps: ApprovalStep[] = [
    { id: 's1', order: 1, tier: 'dept_head', status: 'pending' },
    { id: 's2', order: 2, tier: 'procurement_head', status: 'pending' },
    { id: 's3', order: 3, tier: 'final_approver', status: 'pending' },
  ];

  it('selects the lowest-order pending step', () => {
    expect(nextPendingStep(steps)?.id).toBe('s1');
    expect(nextApprover(steps)).toBe('dept_head');
  });

  it('advances only the active tier', () => {
    expect(applyStepDecision(steps, 'final_approver', 'approved', { at: now })).toBeNull();
    const result = applyStepDecision(steps, 'dept_head', 'approved', { at: now, email: 'head@mwell.com.ph' });
    expect(result?.steps[0]?.status).toBe('approved');
    expect(result?.outcome).toBe('in_progress');
  });

  it('terminates on rejection', () => {
    expect(applyStepDecision(steps, 'dept_head', 'rejected', { at: now })?.outcome).toBe('rejected');
  });
});

describe('required evidence', () => {
  it('requires common intake evidence', () => {
    expect(requiredDocuments({ sourcingMethod: 'rfq' }).map((doc) => doc.key)).toEqual(
      expect.arrayContaining(['spec', 'budget', 'previous', 'quotes']),
    );
  });

  it('uses count-neutral RFQ/RFP labels', () => {
    expect(requiredDocuments({ sourcingMethod: 'rfq' }).find((doc) => doc.key === 'quotes')?.label).toBe('Comparable quotations');
    expect(requiredDocuments({ sourcingMethod: 'rfp' }).find((doc) => doc.key === 'bids')?.label).toBe('Vendor proposals');
  });

  it('matches uploaded evidence kinds', () => {
    const status = requiredDocumentsStatus({ sourcingMethod: 'rfq' }, [
      { kind: 'spec' },
      { kind: 'budget' },
      { kind: 'quote' },
    ]);
    expect(status.find((doc) => doc.key === 'quotes')?.attached).toBe(true);
    expect(status.find((doc) => doc.key === 'previous')?.attached).toBe(false);
  });

  it('blocks approval submission until Procurement confirms the route', () => {
    const input = {
      sourcingMethod: 'rfq' as const,
      attachments: [
        { kind: 'spec' as const },
        { kind: 'budget' as const },
        { kind: 'previous_cost' as const },
        { kind: 'quote' as const },
      ],
    };
    expect(evaluateSubmitReadiness(input).missingDocs).toContain('Procurement-confirmed sourcing route');
    expect(evaluateSubmitReadiness({ ...input, compliance: { routeConfirmed: true } }).ok).toBe(true);
  });
});

describe('category metadata', () => {
  it('retains policy risk metadata', () => {
    expect(categoryMeta('services')?.requiresLegal).toBe(true);
    expect(categoryMeta('capex')?.highRisk).toBe(true);
  });
});
