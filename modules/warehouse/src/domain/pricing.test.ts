import { describe, it, expect } from 'vitest';
import {
  landedCost,
  costVarianceBySupplier,
  inventoryTurnover,
} from './pricing';
import type { Lot, Movement, Product, Supplier } from './types';

const ring: Product = {
  id: 'p-ring',
  sku: 'ECG-RING-10',
  name: 'ECG Ring (10)',
  category: 'device',
  deviceType: 'ecg_ring',
  serialized: true,
  attributes: {},
  unitCost: 2500,
  reorderPoint: 5,
};

const suppliers: Supplier[] = [
  { id: 'sup-a', name: 'Supplier A', leadTimeDays: 30 },
  { id: 'sup-b', name: 'Supplier B', leadTimeDays: 14 },
];

function lot(over: Partial<Lot>): Lot {
  return {
    id: crypto.randomUUID(),
    productId: 'p-ring',
    lotCode: 'LOT',
    unitCost: 2500,
    receivedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function mv(over: Partial<Movement>): Movement {
  return {
    id: crypto.randomUUID(),
    type: 'issue',
    productId: 'p-ring',
    quantity: 1,
    actor: 'ops@mwell',
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe('landedCost', () => {
  it('averages unit cost across the product lots', () => {
    const lots = [
      lot({ productId: 'p-ring', unitCost: 2000 }),
      lot({ productId: 'p-ring', unitCost: 3000 }),
      lot({ productId: 'other', unitCost: 999 }),
    ];
    expect(landedCost(ring, lots)).toBe(2500);
  });

  it('falls back to the product unit cost when there are no lots', () => {
    expect(landedCost(ring, [])).toBe(2500);
  });
});

describe('costVarianceBySupplier', () => {
  it('emits one row per lot with resolved supplier names', () => {
    const lots = [
      lot({ productId: 'p-ring', supplierId: 'sup-a', unitCost: 2400 }),
      lot({ productId: 'p-ring', supplierId: 'sup-b', unitCost: 2600 }),
      lot({ productId: 'other', supplierId: 'sup-a', unitCost: 100 }),
    ];
    const rows = costVarianceBySupplier(lots, suppliers, 'p-ring');
    expect(rows).toEqual([
      { supplierId: 'sup-a', supplierName: 'Supplier A', unitCost: 2400 },
      { supplierId: 'sup-b', supplierName: 'Supplier B', unitCost: 2600 },
    ]);
  });

  it('labels unknown / missing suppliers', () => {
    const lots = [
      lot({ productId: 'p-ring', supplierId: undefined, unitCost: 2400 }),
      lot({ productId: 'p-ring', supplierId: 'ghost', unitCost: 2600 }),
    ];
    const rows = costVarianceBySupplier(lots, suppliers, 'p-ring');
    expect(rows[0]?.supplierName).toBe('Unknown');
    expect(rows[1]?.supplierName).toBe('Unknown');
  });
});

describe('inventoryTurnover', () => {
  it('divides issued-in-window by on-hand units rounded to 2 decimals', () => {
    const movements = [
      mv({ productId: 'p-ring', quantity: 3 }),
      mv({ productId: 'p-ring', quantity: 2 }),
      mv({ productId: 'p-ring', quantity: 5, type: 'return' }),
    ];
    expect(inventoryTurnover(movements, 8, 'p-ring', 30)).toBe(0.63);
  });

  it('excludes movements outside the window', () => {
    const movements = [
      mv({ productId: 'p-ring', quantity: 10, createdAt: '2000-01-01T00:00:00.000Z' }),
    ];
    expect(inventoryTurnover(movements, 10, 'p-ring', 30)).toBe(0);
  });

  it('treats on-hand below 1 as 1', () => {
    const movements = [mv({ productId: 'p-ring', quantity: 4 })];
    expect(inventoryTurnover(movements, 0, 'p-ring', 30)).toBe(4);
  });
});
