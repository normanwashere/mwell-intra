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
  it('values issued/returned/consumed and splits promo from sold', () => {
    const movements = [
      mv({ eventId: 'e1', productId: 'p-ring', type: 'issue', quantity: 4 }),
      mv({ eventId: 'e1', productId: 'p-ring', type: 'return', quantity: 1 }),
      mv({ eventId: 'e1', productId: 'p-shirt', type: 'issue', quantity: 10 }),
    ];
    const costing = eventCosting(movements, [ring, shirt], 'e1');
    // ring: issued 4*2500=10000, returned 1*2500=2500, consumed 3*2500=7500
    // shirt: issued 10*200=2000, consumed 10*200=2000 (promotional)
    expect(costing.issuedValue).toBe(12000);
    expect(costing.returnedValue).toBe(2500);
    expect(costing.consumedValue).toBe(9500);
    expect(costing.promoValue).toBe(2000);
    expect(costing.soldValue).toBe(7500);
  });

  it('clamps per-product consumed value at zero', () => {
    const movements = [
      mv({ eventId: 'e1', productId: 'p-ring', type: 'issue', quantity: 1 }),
      mv({ eventId: 'e1', productId: 'p-ring', type: 'return', quantity: 3 }),
    ];
    expect(eventCosting(movements, [ring], 'e1').consumedValue).toBe(0);
  });
});
