import { describe, it, expect } from 'vitest';
import {
  consumptionRatePerDay,
  daysOfCover,
  projectedStockout,
} from './procurementAnalytics';
import type { Movement } from './types';

const NOW = new Date('2026-06-30T00:00:00.000Z');

function mv(over: Partial<Movement>): Movement {
  return {
    id: crypto.randomUUID(),
    type: 'issue',
    productId: 'p-ring',
    quantity: 1,
    actor: 'ops@mwell',
    createdAt: '2026-06-20T00:00:00.000Z',
    ...over,
  };
}

describe('consumptionRatePerDay', () => {
  it('averages issued quantity within the window over windowDays', () => {
    const movements = [
      mv({ productId: 'p-ring', quantity: 10, createdAt: '2026-06-25T00:00:00.000Z' }),
      mv({ productId: 'p-ring', quantity: 20, createdAt: '2026-06-28T00:00:00.000Z' }),
    ];
    // 30 issued over 30 days => 1/day
    expect(consumptionRatePerDay(movements, 'p-ring', 30, NOW)).toBe(1);
  });

  it('excludes movements older than the window and non-issues', () => {
    const movements = [
      mv({ productId: 'p-ring', quantity: 30, createdAt: '2026-01-01T00:00:00.000Z' }),
      mv({ productId: 'p-ring', quantity: 5, type: 'return', createdAt: '2026-06-29T00:00:00.000Z' }),
      mv({ productId: 'p-ring', quantity: 10, createdAt: '2026-06-29T00:00:00.000Z' }),
    ];
    expect(consumptionRatePerDay(movements, 'p-ring', 10, NOW)).toBe(1);
  });

  it('returns 0 for a non-positive window', () => {
    expect(consumptionRatePerDay([mv({})], 'p-ring', 0, NOW)).toBe(0);
  });
});

describe('daysOfCover', () => {
  it('divides available by rate', () => {
    expect(daysOfCover(20, 4)).toBe(5);
  });
  it('is Infinity when the rate is zero or negative', () => {
    expect(daysOfCover(20, 0)).toBe(Infinity);
    expect(daysOfCover(20, -1)).toBe(Infinity);
  });
});

describe('projectedStockout', () => {
  it('flags at risk when cover is shorter than lead time', () => {
    expect(
      projectedStockout({ available: 10, ratePerDay: 2, leadTimeDays: 10 }),
    ).toEqual({ daysOfCover: 5, atRisk: true });
  });

  it('is not at risk when cover meets or exceeds lead time', () => {
    expect(
      projectedStockout({ available: 100, ratePerDay: 2, leadTimeDays: 10 }),
    ).toEqual({ daysOfCover: 50, atRisk: false });
  });

  it('is never at risk when there is no demand', () => {
    expect(
      projectedStockout({ available: 0, ratePerDay: 0, leadTimeDays: 30 }),
    ).toEqual({ daysOfCover: Infinity, atRisk: false });
  });
});
