import { describe, expect, it } from 'vitest';
import { inventoryPosition, warehouseMetrics } from './metrics';

describe('warehouse metrics contract', () => {
  it('subtracts only active commitments, holds, and unavailable stock', () => {
    expect(inventoryPosition({
      onHand: 40,
      allocations: [{ quantity: 9, status: 'reserved' }, { quantity: 5, status: 'cancelled' }],
      holds: [{ quantity: 3, status: 'active' }, { quantity: 7, status: 'released' }],
      unavailable: 2,
    })).toEqual({ onHand: 40, committed: 9, held: 3, unavailable: 2, available: 26 });
  });

  it('defines unique owned metrics with source fields', () => {
    expect(new Set(warehouseMetrics.map((metric) => metric.id)).size).toBe(warehouseMetrics.length);
    for (const metric of warehouseMetrics) {
      expect(metric.owner).toBeTruthy();
      expect(metric.sourceFields.length).toBeGreaterThan(0);
      expect(metric.formula).toBeTruthy();
    }
  });
});
