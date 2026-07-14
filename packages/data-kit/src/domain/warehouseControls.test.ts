import { describe, expect, it } from 'vitest';
import {
  approvalTiersForStockChange,
  availableAfterControls,
  canActorApproveStockChange,
  canTransitionInspection,
  cycleCountSubmissionStatus,
  expiryRisk,
  normalizePageQuery,
  stockChangeStatusAfterDecision,
} from './warehouseControls';

describe('warehouse control calculations', () => {
  it('removes commitments and unavailable stock from availability', () => {
    expect(
      availableAfterControls({
        onHand: 40,
        committed: 9,
        held: 3,
        unavailable: 2,
      }),
    ).toBe(26);
  });

  it('never reports negative available stock', () => {
    expect(
      availableAfterControls({
        onHand: 4,
        committed: 3,
        held: 2,
        unavailable: 1,
      }),
    ).toBe(0);
  });

  it('requires supervisor then finance above PHP 10,000', () => {
    expect(approvalTiersForStockChange({ quantityDelta: -2, unitCost: 6_000 })).toEqual([
      'logistics_supervisor',
      'finance',
    ]);
  });

  it('requires only supervisor at exactly PHP 10,000', () => {
    expect(approvalTiersForStockChange({ quantityDelta: -2, unitCost: 5_000 })).toEqual([
      'logistics_supervisor',
    ]);
  });

  it('prevents the requester from approving a stock change', () => {
    expect(canActorApproveStockChange('user-1', 'user-1')).toBe(false);
    expect(canActorApproveStockChange('user-1', 'user-2')).toBe(true);
  });
});

describe('warehouse control state transitions', () => {
  it('allows a pending inspection to reach a disposition', () => {
    expect(canTransitionInspection('pending', 'accepted')).toBe(true);
    expect(canTransitionInspection('pending', 'hold')).toBe(true);
  });

  it('allows a hold to be released or terminally disposed', () => {
    expect(canTransitionInspection('hold', 'accepted')).toBe(true);
    expect(canTransitionInspection('hold', 'vendor_return')).toBe(true);
  });

  it('does not reopen a terminal disposition', () => {
    expect(canTransitionInspection('vendor_return', 'accepted')).toBe(false);
    expect(canTransitionInspection('damaged', 'hold')).toBe(false);
  });

  it('auto-completes a zero-variance cycle count', () => {
    expect(cycleCountSubmissionStatus([{ expected: 8, counted: 8 }])).toBe('approved');
    expect(cycleCountSubmissionStatus([{ expected: 8, counted: 7 }])).toBe(
      'pending_approval',
    );
  });

  it('finishes at Supervisor approval when impact is PHP 10,000', () => {
    expect(
      stockChangeStatusAfterDecision({
        currentStatus: 'pending_supervisor',
        decision: 'approved',
        financialImpact: 10_000,
        requestedBy: 'counter-1',
        actor: 'supervisor-1',
        actorTier: 'logistics_supervisor',
      }),
    ).toBe('approved');
  });

  it('advances above PHP 10,000 from Supervisor to Finance', () => {
    expect(
      stockChangeStatusAfterDecision({
        currentStatus: 'pending_supervisor',
        decision: 'approved',
        financialImpact: 10_001,
        requestedBy: 'counter-1',
        actor: 'supervisor-1',
        actorTier: 'logistics_supervisor',
      }),
    ).toBe('pending_finance');
    expect(
      stockChangeStatusAfterDecision({
        currentStatus: 'pending_finance',
        decision: 'approved',
        financialImpact: 10_001,
        requestedBy: 'counter-1',
        actor: 'finance-1',
        actorTier: 'finance',
      }),
    ).toBe('approved');
  });

  it('rejects without changing stock and requires a note', () => {
    expect(
      stockChangeStatusAfterDecision({
        currentStatus: 'pending_supervisor',
        decision: 'rejected',
        financialImpact: 500,
        requestedBy: 'counter-1',
        actor: 'supervisor-1',
        actorTier: 'logistics_supervisor',
        note: 'Count evidence is incomplete.',
      }),
    ).toBe('rejected');
    expect(() =>
      stockChangeStatusAfterDecision({
        currentStatus: 'pending_supervisor',
        decision: 'rejected',
        financialImpact: 500,
        requestedBy: 'counter-1',
        actor: 'supervisor-1',
        actorTier: 'logistics_supervisor',
      }),
    ).toThrow(/note/i);
  });

  it('prevents a cycle-count requester from approving the change', () => {
    expect(() =>
      stockChangeStatusAfterDecision({
        currentStatus: 'pending_supervisor',
        decision: 'approved',
        financialImpact: 500,
        requestedBy: 'counter-1',
        actor: 'counter-1',
        actorTier: 'logistics_supervisor',
      }),
    ).toThrow(/requester/i);
  });

  it('enforces exact Supervisor and Finance tiers', () => {
    expect(() => stockChangeStatusAfterDecision({
      currentStatus: 'pending_supervisor', decision: 'approved', financialImpact: 20_000,
      requestedBy: 'counter-1', actor: 'finance-1', actorTier: 'finance',
    })).toThrow(/warehouse supervisor/i);
    expect(() => stockChangeStatusAfterDecision({
      currentStatus: 'pending_finance', decision: 'approved', financialImpact: 20_000,
      requestedBy: 'counter-1', actor: 'supervisor-1', actorTier: 'logistics_supervisor',
    })).toThrow(/finance/i);
  });
});

describe('expiry visibility', () => {
  const today = '2026-07-10T00:00:00.000Z';

  it('distinguishes untracked, expired, warning, and healthy stock', () => {
    expect(expiryRisk(undefined, 30, today)).toBe('not_tracked');
    expect(expiryRisk('2026-07-09', 30, today)).toBe('expired');
    expect(expiryRisk('2026-07-25', 30, today)).toBe('warning');
    expect(expiryRisk('2026-09-30', 30, today)).toBe('ok');
  });
});

describe('bounded control queries', () => {
  it('defaults to 50 rows and caps requests at 100', () => {
    expect(normalizePageQuery({})).toEqual({ limit: 50 });
    expect(normalizePageQuery({ limit: 500, cursor: 'next' })).toEqual({
      cursor: 'next',
      limit: 100,
    });
  });

  it('rejects non-positive page sizes', () => {
    expect(() => normalizePageQuery({ limit: 0 })).toThrow(/between 1 and 100/i);
    expect(() => normalizePageQuery({ limit: -1 })).toThrow(/between 1 and 100/i);
  });
});
