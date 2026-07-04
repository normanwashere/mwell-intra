import { describe, it, expect } from 'vitest';
import {
  returnRate,
  deviceUtilization,
  fastMovingSkus,
  consumptionByEventType,
} from './analytics';
import type { Movement, Product, WarehouseEvent } from './types';

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
const watch: Product = {
  id: 'p-watch',
  sku: 'WATCH-1',
  name: 'Smart Watch',
  category: 'device',
  deviceType: 'smart_watch',
  serialized: true,
  attributes: {},
  unitCost: 3000,
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

describe('returnRate', () => {
  it('computes returned / issued as a percentage', () => {
    expect(returnRate(10, 4)).toBe(40);
  });
  it('returns 0 when nothing was issued', () => {
    expect(returnRate(0, 0)).toBe(0);
  });
  it('rounds to one decimal place', () => {
    expect(returnRate(3, 1)).toBe(33.3);
  });
});

describe('deviceUtilization', () => {
  it('reports issued, returned and return rate per device product', () => {
    const movements = [
      mv({ type: 'issue', productId: 'p-ring', quantity: 10 }),
      mv({ type: 'return', productId: 'p-ring', quantity: 4 }),
      mv({ type: 'issue', productId: 'p-watch', quantity: 5 }),
    ];
    const util = deviceUtilization(movements, [ring, watch, shirt]);
    const ringRow = util.find((u) => u.productId === 'p-ring')!;
    expect(ringRow.issued).toBe(10);
    expect(ringRow.returned).toBe(4);
    expect(ringRow.returnRate).toBe(40);
    expect(ringRow.outstanding).toBe(6);
  });

  it('excludes non-device products', () => {
    const movements = [mv({ type: 'issue', productId: 'p-shirt', quantity: 3 })];
    const util = deviceUtilization(movements, [ring, watch, shirt]);
    expect(util.some((u) => u.productId === 'p-shirt')).toBe(false);
  });
});

describe('fastMovingSkus', () => {
  it('ranks products by issued quantity descending and limits results', () => {
    const movements = [
      mv({ type: 'issue', productId: 'p-shirt', quantity: 50 }),
      mv({ type: 'issue', productId: 'p-ring', quantity: 10 }),
      mv({ type: 'issue', productId: 'p-watch', quantity: 30 }),
      mv({ type: 'return', productId: 'p-shirt', quantity: 5 }),
    ];
    const ranked = fastMovingSkus(movements, [ring, watch, shirt], 2);
    expect(ranked.map((r) => r.productId)).toEqual(['p-shirt', 'p-watch']);
    expect(ranked[0]?.issued).toBe(50);
  });
});

describe('consumptionByEventType', () => {
  it('sums issued quantity grouped by event type', () => {
    const events: WarehouseEvent[] = [
      { id: 'e1', name: 'Corp A', type: 'corporate', startDate: '2026-01-01' },
      {
        id: 'e2',
        name: 'LGU Mission',
        type: 'medical_mission',
        startDate: '2026-01-02',
      },
    ];
    const movements = [
      mv({ type: 'issue', eventId: 'e1', quantity: 20 }),
      mv({ type: 'issue', eventId: 'e2', quantity: 35 }),
      mv({ type: 'return', eventId: 'e1', quantity: 5 }),
      mv({ type: 'issue', quantity: 99 }), // no event — ignored
    ];
    const result = consumptionByEventType(movements, events);
    expect(result).toEqual([
      { eventType: 'corporate', issued: 20 },
      { eventType: 'medical_mission', issued: 35 },
    ]);
  });
});
