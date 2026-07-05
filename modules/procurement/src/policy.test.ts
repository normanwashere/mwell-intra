import { describe, expect, it } from 'vitest';
import {
  FINANCE_TIER_MIN,
  PETTY_CASH_MAX,
  RFP_THRESHOLD,
  SMALL_PURCHASE_MAX,
  applyStepDecision,
  buildApprovalLadder,
  buildApprovalSteps,
  categoryMeta,
  minimumQuotes,
  nextApprover,
  nextPendingStep,
  requiredDocuments,
  suggestSourcingMethod,
  tierLabel,
} from './policy';
import type { ApprovalStep } from './types';

// ---------------------------------------------------------------------------
// suggestSourcingMethod — policy §5 + §11
// ---------------------------------------------------------------------------
describe('suggestSourcingMethod', () => {
  it('emergency flag overrides everything', () => {
    expect(
      suggestSourcingMethod({ category: 'goods', amount: 5_000_000, emergency: true }),
    ).toBe('emergency');
  });

  it('repeat flag returns repeat_order (unless emergency)', () => {
    expect(suggestSourcingMethod({ category: 'goods', amount: 50_000, repeat: true })).toBe(
      'repeat_order',
    );
    expect(
      suggestSourcingMethod({ category: 'goods', amount: 50_000, repeat: true, emergency: true }),
    ).toBe('emergency');
  });

  it('routes petty_cash category regardless of amount', () => {
    expect(suggestSourcingMethod({ category: 'petty_cash', amount: 50_000 })).toBe('petty_cash');
  });

  it('routes tiny amounts (<=PETTY_CASH_MAX) to petty_cash', () => {
    expect(suggestSourcingMethod({ category: 'goods', amount: PETTY_CASH_MAX })).toBe(
      'petty_cash',
    );
    expect(suggestSourcingMethod({ category: 'goods', amount: PETTY_CASH_MAX + 1 })).not.toBe(
      'petty_cash',
    );
  });

  it('escalates high-risk categories to RFP even below PHP 1M', () => {
    expect(suggestSourcingMethod({ category: 'construction', amount: 100_000 })).toBe('rfp');
    expect(suggestSourcingMethod({ category: 'capex', amount: 500_000 })).toBe('rfp');
    expect(suggestSourcingMethod({ category: 'manpower', amount: 200_000 })).toBe('rfp');
    expect(suggestSourcingMethod({ category: 'medical', amount: 400_000 })).toBe('rfp');
  });

  it('picks RFP at PHP 1,000,000+ per policy §5', () => {
    expect(suggestSourcingMethod({ category: 'goods', amount: RFP_THRESHOLD })).toBe('rfp');
    expect(suggestSourcingMethod({ category: 'services', amount: 5_000_000 })).toBe('rfp');
  });

  it('picks RFQ in the mid band', () => {
    expect(suggestSourcingMethod({ category: 'goods', amount: SMALL_PURCHASE_MAX })).toBe('rfq');
    expect(suggestSourcingMethod({ category: 'goods', amount: 800_000 })).toBe('rfq');
  });

  it('picks small_purchase below the internal cutoff', () => {
    expect(suggestSourcingMethod({ category: 'goods', amount: PETTY_CASH_MAX + 1 })).toBe(
      'small_purchase',
    );
    expect(suggestSourcingMethod({ category: 'goods', amount: SMALL_PURCHASE_MAX - 1 })).toBe(
      'small_purchase',
    );
  });

  it('defaults to rfq when amount is unknown', () => {
    expect(suggestSourcingMethod({ category: 'goods' })).toBe('rfq');
    expect(suggestSourcingMethod({})).toBe('rfq');
    expect(suggestSourcingMethod({ amount: 0 })).toBe('rfq');
  });
});

// ---------------------------------------------------------------------------
// minimumQuotes — policy §5
// ---------------------------------------------------------------------------
describe('minimumQuotes', () => {
  it('matches policy §5: RFQ needs ≥2, RFP needs ≥3', () => {
    expect(minimumQuotes('rfq')).toBe(2);
    expect(minimumQuotes('rfp')).toBe(3);
  });
  it('returns null for petty / small / direct / emergency', () => {
    expect(minimumQuotes('petty_cash')).toBeNull();
    expect(minimumQuotes('small_purchase')).toBeNull();
    expect(minimumQuotes('direct_award')).toBeNull();
    expect(minimumQuotes('emergency')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildApprovalLadder — policy §3 + §9 + §11
// ---------------------------------------------------------------------------
describe('buildApprovalLadder', () => {
  it('always includes dept_head → procurement_head → final_approver', () => {
    const ladder = buildApprovalLadder({ category: 'goods', amount: 10_000 });
    expect(ladder[0]).toBe('dept_head');
    expect(ladder[1]).toBe('procurement_head');
    expect(ladder[ladder.length - 1]).toBe('final_approver');
  });

  it('inserts finance when amount ≥ FINANCE_TIER_MIN', () => {
    const ladder = buildApprovalLadder({
      category: 'goods',
      amount: FINANCE_TIER_MIN,
      sourcingMethod: 'small_purchase',
    });
    expect(ladder).toContain('finance');
  });

  it('inserts finance for capex / construction / manpower regardless of amount', () => {
    expect(buildApprovalLadder({ category: 'capex', amount: 10_000 })).toContain('finance');
    expect(buildApprovalLadder({ category: 'construction', amount: 10_000 })).toContain('finance');
    expect(buildApprovalLadder({ category: 'manpower', amount: 10_000 })).toContain('finance');
  });

  it('inserts legal for legal-loop categories', () => {
    expect(
      buildApprovalLadder({ category: 'services', amount: 20_000, sourcingMethod: 'small_purchase' }),
    ).toContain('legal');
    expect(
      buildApprovalLadder({ category: 'it_software', amount: 20_000, sourcingMethod: 'small_purchase' }),
    ).toContain('legal');
    expect(
      buildApprovalLadder({ category: 'subscription', amount: 20_000, sourcingMethod: 'small_purchase' }),
    ).toContain('legal');
  });

  it('inserts legal for RFP / direct_award / emergency regardless of category', () => {
    expect(
      buildApprovalLadder({ category: 'goods', amount: 20_000, sourcingMethod: 'rfp' }),
    ).toContain('legal');
    expect(
      buildApprovalLadder({ category: 'goods', amount: 20_000, sourcingMethod: 'direct_award' }),
    ).toContain('legal');
    expect(
      buildApprovalLadder({ category: 'goods', amount: 20_000, sourcingMethod: 'emergency' }),
    ).toContain('legal');
  });

  it('does not add legal for low-risk small purchases', () => {
    const ladder = buildApprovalLadder({
      category: 'goods',
      amount: 20_000,
      sourcingMethod: 'small_purchase',
    });
    expect(ladder).not.toContain('legal');
  });

  it('preserves ladder ordering: legal after procurement_head; finance before final_approver', () => {
    const ladder = buildApprovalLadder({
      category: 'construction',
      amount: 6_000_000,
      sourcingMethod: 'rfp',
    });
    const idxProc = ladder.indexOf('procurement_head');
    const idxLegal = ladder.indexOf('legal');
    const idxFin = ladder.indexOf('finance');
    const idxFinal = ladder.indexOf('final_approver');
    expect(idxProc).toBeGreaterThan(-1);
    expect(idxLegal).toBeGreaterThan(idxProc);
    expect(idxFin).toBeGreaterThan(idxLegal);
    expect(idxFinal).toBe(ladder.length - 1);
  });
});

// ---------------------------------------------------------------------------
// buildApprovalSteps + nextPendingStep
// ---------------------------------------------------------------------------
describe('buildApprovalSteps', () => {
  it('emits one pending step per ladder tier in order', () => {
    let n = 0;
    const steps = buildApprovalSteps(
      { category: 'services', amount: 250_000, sourcingMethod: 'rfq' },
      () => `id-${++n}`,
    );
    expect(steps).toHaveLength(5); // dept_head, procurement_head, legal, finance, final_approver
    expect(steps.map((s) => s.tier)).toEqual([
      'dept_head',
      'procurement_head',
      'legal',
      'finance',
      'final_approver',
    ]);
    expect(steps.every((s) => s.status === 'pending')).toBe(true);
    expect(steps.map((s) => s.order)).toEqual([1, 2, 3, 4, 5]);
    // Labels default to the tier's canonical label.
    expect(steps[0]?.label).toBe(tierLabel('dept_head'));
  });
});

describe('nextPendingStep + nextApprover', () => {
  const steps: ApprovalStep[] = [
    { id: 's1', order: 1, tier: 'dept_head', status: 'approved' },
    { id: 's2', order: 2, tier: 'procurement_head', status: 'pending' },
    { id: 's3', order: 3, tier: 'final_approver', status: 'pending' },
  ];

  it('returns the lowest-order pending step', () => {
    expect(nextPendingStep(steps)?.id).toBe('s2');
    expect(nextApprover(steps)).toBe('procurement_head');
  });

  it('returns undefined when no steps are pending', () => {
    const done: ApprovalStep[] = steps.map((s) => ({ ...s, status: 'approved' }));
    expect(nextPendingStep(done)).toBeUndefined();
    expect(nextApprover(done)).toBeUndefined();
  });

  it('handles empty / null inputs', () => {
    expect(nextPendingStep([])).toBeUndefined();
    expect(nextPendingStep(undefined)).toBeUndefined();
    expect(nextPendingStep(null)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// applyStepDecision — ladder advancement + termination
// ---------------------------------------------------------------------------
describe('applyStepDecision', () => {
  const now = '2026-07-05T00:00:00.000Z';
  const three: ApprovalStep[] = [
    { id: 's1', order: 1, tier: 'dept_head',        status: 'pending' },
    { id: 's2', order: 2, tier: 'procurement_head', status: 'pending' },
    { id: 's3', order: 3, tier: 'final_approver',   status: 'pending' },
  ];

  it('advances one step at a time when actor matches next tier', () => {
    const res = applyStepDecision(three, 'dept_head', 'approved', { at: now, email: 'a@x' });
    expect(res).not.toBeNull();
    expect(res!.terminal).toBe(false);
    expect(res!.outcome).toBe('in_progress');
    expect(res!.steps[0]?.status).toBe('approved');
    expect(res!.steps[0]?.decidedByEmail).toBe('a@x');
    expect(res!.steps[1]?.status).toBe('pending');
  });

  it('flips terminal=approved on final tier', () => {
    const advanced: ApprovalStep[] = three.map((s, i) =>
      i < 2 ? { ...s, status: 'approved' } : s,
    );
    const res = applyStepDecision(advanced, 'final_approver', 'approved', {
      at: now,
      email: 'cfo@x',
    });
    expect(res!.terminal).toBe(true);
    expect(res!.outcome).toBe('approved');
  });

  it('terminates the whole ladder on rejection at any tier', () => {
    const res = applyStepDecision(three, 'dept_head', 'rejected', {
      at: now,
      email: 'a@x',
      note: 'over budget',
    });
    expect(res!.terminal).toBe(true);
    expect(res!.outcome).toBe('rejected');
    expect(res!.steps[0]?.note).toBe('over budget');
    expect(res!.steps[1]?.status).toBe('pending'); // untouched
  });

  it('refuses when actor tier is out of turn', () => {
    // final_approver tries to skip ahead while dept_head is still pending.
    const res = applyStepDecision(three, 'final_approver', 'approved', { at: now });
    expect(res).toBeNull();
  });

  it('refuses when there is no pending step left', () => {
    const done: ApprovalStep[] = three.map((s) => ({ ...s, status: 'approved' }));
    const res = applyStepDecision(done, 'final_approver', 'approved', { at: now });
    expect(res).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// requiredDocuments + categoryMeta sanity
// ---------------------------------------------------------------------------
describe('requiredDocuments', () => {
  it('always demands spec + budget + previous cost', () => {
    const keys = requiredDocuments({ sourcingMethod: 'small_purchase' }).map((d) => d.key);
    expect(keys).toEqual(expect.arrayContaining(['spec', 'budget', 'previous']));
  });

  it('adds AR + bids for RFP flow', () => {
    const keys = requiredDocuments({ sourcingMethod: 'rfp' }).map((d) => d.key);
    expect(keys).toEqual(expect.arrayContaining(['ar', 'bids']));
  });

  it('adds ≥2 quotes for RFQ', () => {
    const keys = requiredDocuments({ sourcingMethod: 'rfq' }).map((d) => d.key);
    expect(keys).toContain('quotes');
  });

  it('adds direct-award justification for direct_award or emergency', () => {
    expect(
      requiredDocuments({ sourcingMethod: 'direct_award' }).map((d) => d.key),
    ).toContain('da_justification');
    expect(requiredDocuments({ sourcingMethod: 'emergency' }).map((d) => d.key)).toContain(
      'da_justification',
    );
  });

  it('adds bond/insurance for construction + manpower', () => {
    expect(
      requiredDocuments({ category: 'construction', sourcingMethod: 'rfp' }).map((d) => d.key),
    ).toContain('bond');
    expect(
      requiredDocuments({ category: 'manpower', sourcingMethod: 'rfq' }).map((d) => d.key),
    ).toContain('bond');
  });
});

describe('categoryMeta', () => {
  it('resolves every declared code', () => {
    expect(categoryMeta('goods')?.label).toBe('Goods');
    expect(categoryMeta('services')?.requiresLegal).toBe(true);
    expect(categoryMeta('capex')?.highRisk).toBe(true);
  });
  it('returns undefined for unknown code', () => {
    expect(categoryMeta(undefined)).toBeUndefined();
  });
});
