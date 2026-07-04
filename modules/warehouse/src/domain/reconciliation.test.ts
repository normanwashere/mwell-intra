import { describe, it, expect } from 'vitest';
import { reconciliationRows } from './reconciliation';
import type { CycleCount, Movement, Product } from './types';

const shirt: Product = {
  id: 'p-shirt',
  sku: 'SHIRT-L',
  name: 'Shirt L',
  category: 'merchandise',
  merchandiseType: 'shirt',
  serialized: false,
  attributes: {},
  unitCost: 200,
  reorderPoint: 50,
};
const token: Product = {
  id: 'p-token',
  sku: 'TOKEN',
  name: 'Doctor Token',
  category: 'merchandise',
  merchandiseType: 'token',
  serialized: false,
  attributes: {},
  unitCost: 350,
  reorderPoint: 100,
};

function count(over: Partial<CycleCount>): CycleCount {
  return {
    id: crypto.randomUUID(),
    locationId: 'loc-wh',
    lines: [],
    actor: 'finance@mwell',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('reconciliationRows', () => {
  it('uses the most recent count per product and drops zero variances, newest first', () => {
    const counts = [
      count({
        createdAt: '2026-06-01T00:00:00.000Z',
        lines: [{ productId: 'p-shirt', expected: 100, counted: 90 }],
      }),
      count({
        createdAt: '2026-06-10T00:00:00.000Z',
        lines: [
          { productId: 'p-shirt', expected: 100, counted: 100 }, // newer, zero variance -> dropped
          { productId: 'p-token', expected: 80, counted: 75 },
        ],
      }),
    ];
    const rows = reconciliationRows(counts, [shirt, token]);
    expect(rows).toEqual([
      {
        productId: 'p-token',
        sku: 'TOKEN',
        name: 'Doctor Token',
        expected: 80,
        counted: 75,
        variance: -5,
        countedAt: '2026-06-10T00:00:00.000Z',
        locationId: 'loc-wh',
      },
    ]);
  });

  it('drops a variance once a later adjustment movement resolves it', () => {
    const counts = [
      count({
        createdAt: '2026-06-10T00:00:00.000Z',
        lines: [{ productId: 'p-token', expected: 80, counted: 75 }],
      }),
    ];
    const movements: Movement[] = [
      {
        id: 'mv-adj',
        type: 'adjustment',
        productId: 'p-token',
        quantity: -5,
        toLocationId: 'loc-wh',
        reason: 'variance reconciled',
        actor: 'finance@mwell',
        createdAt: '2026-06-11T00:00:00.000Z',
      },
    ];
    expect(reconciliationRows(counts, [shirt, token], movements)).toEqual([]);
    // Without the movement it is still open.
    expect(reconciliationRows(counts, [shirt, token])).toHaveLength(1);
  });

  it('carries the counted bin so finance reconciles per-bin, not per-location', () => {
    const counts = [
      count({
        binId: 'bin-A1',
        createdAt: '2026-06-10T00:00:00.000Z',
        lines: [{ productId: 'p-token', expected: 20, counted: 18 }],
      }),
    ];
    const rows = reconciliationRows(counts, [shirt, token]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.binId).toBe('bin-A1');
  });

  it('keeps the latest non-zero variance and sorts newest first', () => {
    const counts = [
      count({
        createdAt: '2026-05-01T00:00:00.000Z',
        lines: [{ productId: 'p-shirt', expected: 50, counted: 40 }],
      }),
      count({
        createdAt: '2026-05-20T00:00:00.000Z',
        lines: [{ productId: 'p-token', expected: 30, counted: 35 }],
      }),
    ];
    const rows = reconciliationRows(counts, [shirt, token]);
    expect(rows.map((r) => r.productId)).toEqual(['p-token', 'p-shirt']);
    expect(rows[0]?.variance).toBe(5);
    expect(rows[1]?.variance).toBe(-10);
  });
});
