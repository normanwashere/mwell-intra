import { describe, it, expect } from 'vitest';
import { buildNotifications } from './notifications';
import type { WarehouseData } from '@/data/repository';
import type { Capability } from '@/auth/roles';

function data(): WarehouseData {
  return {
    products: [
      {
        id: 'ring',
        sku: 'RING',
        name: 'Ring',
        category: 'device',
        deviceType: 'ecg_ring',
        serialized: true,
        attributes: {},
        unitCost: 2500,
        reorderPoint: 3,
      },
      {
        id: 'shirt',
        sku: 'SHIRT',
        name: 'Shirt',
        category: 'merchandise',
        merchandiseType: 'shirt',
        serialized: false,
        attributes: {},
        unitCost: 200,
        reorderPoint: 10,
      },
    ],
    locations: [{ id: 'loc-wh', name: 'WH', type: 'warehouse' }],
    storageAreas: [],
    suppliers: [],
    lots: [],
    units: [
      { id: 'u1', productId: 'ring', serialNumber: 'SN1', locationId: 'loc-wh', status: 'in_stock' },
    ],
    stockLevels: [{ productId: 'shirt', locationId: 'loc-wh', quantity: 100 }],
    movements: [],
    allocations: [
      {
        id: 'a1',
        eventId: 'e1',
        productId: 'shirt',
        quantity: 5,
        status: 'reserved',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    events: [{ id: 'e1', name: 'Expo', type: 'corporate', startDate: '2026-01-01' }],
    returns: [],
    cycleCounts: [],
    receipts: [],
    purchaseOrders: [],
  };
}

describe('buildNotifications', () => {
  const allow = (...capabilities: Capability[]) => (capability: Capability) =>
    capabilities.includes(capability);

  it('flags low-stock SKUs and pending reservations', () => {
    const notes = buildNotifications(
      data(),
      allow('manage_inventory', 'reserve_allocate', 'issue_items'),
    );
    expect(notes.some((n) => n.id === 'low-ring')).toBe(true);
    expect(notes.some((n) => n.id === 'reserved-a1')).toBe(true);
  });

  it('marks zero-stock as out of stock (rose tone)', () => {
    const d = data();
    d.units = []; // ring now 0 available
    const ring = buildNotifications(d, allow('manage_inventory')).find(
      (n) => n.id === 'low-ring',
    )!;
    expect(ring.tone).toBe('rose');
    expect(ring.title).toMatch(/out of stock/i);
  });

  it('omits reservation link for roles that cannot open events or allocations', () => {
    const note = buildNotifications(data(), allow('manage_inventory')).find(
      (n) => n.id === 'reserved-a1',
    )!;
    expect(note.to).toBeUndefined();
  });

  it('links reservations to the event for roles that can open events', () => {
    const note = buildNotifications(data(), allow('reserve_allocate')).find(
      (n) => n.id === 'reserved-a1',
    )!;
    expect(note.to).toBe('/events/e1');
  });

  it('uses the supplied live capability predicate for notification targets', () => {
    const notes = buildNotifications(data(), allow('issue_items'));
    expect(notes.find((note) => note.id === 'low-ring')?.to).toBeUndefined();
    expect(notes.find((note) => note.id === 'reserved-a1')?.to).toBe('/allocations');
  });
});
