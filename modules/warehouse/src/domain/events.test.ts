import { describe, it, expect } from 'vitest';
import { eventSummary, eventCosting } from './events';
import type { Allocation, Movement, Product } from './types';

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
  promotional: true,
};

function mv(over: Partial<Movement>): Movement {
  return {
    id: crypto.randomUUID(),
    type: 'issue',
    productId: 'p-ring',
    quantity: 1,
    actor: 'ops@mwell',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function alloc(over: Partial<Allocation>): Allocation {
  return {
    id: crypto.randomUUID(),
    eventId: 'e1',
    productId: 'p-ring',
    quantity: 1,
    status: 'reserved',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('eventSummary', () => {
  it('reads issued/returned from movements and reserved/allocated from allocations', () => {
    const allocations = [
      alloc({ eventId: 'e1', status: 'reserved', quantity: 10 }),
      alloc({ eventId: 'e1', status: 'allocated', quantity: 4 }),
      alloc({ eventId: 'e2', status: 'reserved', quantity: 99 }),
    ];
    const movements = [
      mv({ eventId: 'e1', type: 'issue', quantity: 20 }),
      mv({ eventId: 'e1', type: 'return', quantity: 5 }),
      mv({ eventId: 'e2', type: 'issue', quantity: 99 }),
    ];
    expect(eventSummary(allocations, movements, 'e1')).toEqual({
      reserved: 10,
      allocated: 4,
      issued: 20,
      returned: 5,
      consumed: 15,
    });
  });

  it('floors consumed at zero', () => {
    const movements = [
      mv({ eventId: 'e1', type: 'issue', quantity: 2 }),
      mv({ eventId: 'e1', type: 'return', quantity: 5 }),
    ];
    expect(eventSummary([], movements, 'e1').consumed).toBe(0);
  });
});

describe('eventCosting', () => {
  it('values actual approved mixed-purpose outcomes at historical cost, never current promotional flags', () => {
    const movements = [mv({ eventId: 'e1', quantity: 10, unitCostAtMovement: 100 }), mv({ eventId: 'e1', type: 'return', quantity: 2, unitCostAtMovement: 100 })];
    const outcomes = { status: 'approved', sold: 4, giveaway: 3, lost: 1, damaged: 0 };
    const costing = eventCosting(movements, [{ ...ring, unitCost: 999, promotional: true }], 'e1', outcomes);
    expect(costing).toMatchObject({ soldValue: 400, promoValue: 300, returnedValue: 200, lostValue: 100, outcomeValuationAvailable: true });
    expect(eventCosting(movements, [ring], 'e1', { ...outcomes, status: 'draft' }).soldValue).toBe(0);
    expect(eventCosting([...movements, mv({ eventId: 'e1', unitCostAtMovement: 200 })], [ring], 'e1', outcomes).outcomeValuationAvailable).toBe(false);
  });
  it('does not turn unreconciled custody into sales or infer historical cost from current products', () => {
    const movements = [
      mv({ eventId: 'e1', productId: 'p-ring', type: 'issue', quantity: 4 }),
      mv({ eventId: 'e1', productId: 'p-ring', type: 'return', quantity: 1 }),
      mv({ eventId: 'e1', productId: 'p-shirt', type: 'issue', quantity: 10 }),
    ];
    const costing = eventCosting(movements, [ring, shirt], 'e1');
    // ring: issued 4*2500=10000, returned 1*2500=2500, consumed 3*2500=7500
    // shirt: issued 10*200=2000, consumed 10*200=2000 (promotional)
    expect(costing.valuationAvailable).toBe(false);
    expect(costing.promoValue).toBe(0);
    expect(costing.soldValue).toBe(0);
    const captured = movements.map(m => ({ ...m, unitCostAtMovement: m.productId === ring.id ? 2500 : 200 }));
    const historical = eventCosting(captured, [{ ...ring, unitCost: 99999, promotional: true }, { ...shirt, unitCost: 1, promotional: false }], 'e1');
    expect(historical.valuationAvailable).toBe(true);
    expect(historical.issuedValue).toBe(12000);
    expect(historical.returnedValue).toBe(2500);
    expect(historical.consumedValue).toBe(9500);
    expect(historical.soldValue).toBe(0);
  });

  it('clamps per-product consumed value at zero', () => {
    const movements = [
      mv({ eventId: 'e1', productId: 'p-ring', type: 'issue', quantity: 1 }),
      mv({ eventId: 'e1', productId: 'p-ring', type: 'return', quantity: 3 }),
    ];
    expect(eventCosting(movements, [ring], 'e1').consumedValue).toBe(0);
  });
});
