import { describe, expect, it } from 'vitest';
import { sortReplenishmentCandidates, type ReplenishmentCandidate } from './ReplenishmentControlPanel';

function candidate(
  productId: string,
  stockoutRisk: ReplenishmentCandidate['stockoutRisk'],
  onHand: number,
  reorderPoint: number,
  leadTimeDays: number,
): ReplenishmentCandidate {
  return {
    productId,
    productName: productId,
    recommendedQuantity: Math.max(1, reorderPoint - onHand),
    onHand,
    reorderPoint,
    leadTimeDays,
    stockoutRisk,
    rationale: 'Test',
  };
}

describe('sortReplenishmentCandidates', () => {
  it('orders by risk, shortfall, then supplier lead time', () => {
    const rows = sortReplenishmentCandidates([
      candidate('medium', 'medium', 2, 8, 30),
      candidate('critical-small', 'critical', 4, 6, 7),
      candidate('critical-large', 'critical', 0, 10, 14),
      candidate('high', 'high', 0, 5, 60),
    ]);
    expect(rows.map((row) => row.productId)).toEqual([
      'critical-large',
      'critical-small',
      'high',
      'medium',
    ]);
  });
});
