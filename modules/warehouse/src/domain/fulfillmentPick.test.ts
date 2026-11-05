import { describe, expect, it } from 'vitest';
import type { InventoryHold, InventoryPosition } from '@intra/data-kit';
import { makeRepo } from '@/test/renderWithProviders';
import { recommendedFulfillmentBin } from './fulfillmentPick';

async function fixture(serialized = true) {
  const seed = makeRepo();
  const productId = serialized ? 'smart-watch' : 'shirt-l';
  const order = await seed.createFulfillmentOrder({ source: 'department_request', externalReference: 'BIN-BOUNDARY',
    sourceLocationId: 'loc-wh', lines: [{ productId, quantity: 2 }], actor: 'requester' });
  const data = await seed.getData();
  data.fulfillmentReservations = [];
  data.storageAreas = [
    { id: 'a', code: 'A', locationId: 'loc-wh', active: true },
    { id: 'b', code: 'B', locationId: 'loc-wh', active: true },
  ];
  data.units = ['a', 'b'].flatMap(binId => [1, 2].map(number => ({
    id: `${binId}${number}`, productId, serialNumber: `${binId}${number}`, locationId: 'loc-wh', binId,
    status: 'in_stock' as const, lotId: 'lot-1',
  })));
  data.stockLevels = ['a', 'b'].map(binId => ({ productId, locationId: 'loc-wh', binId, lotId: 'lot-1', quantity: 2 }));
  const hold: InventoryHold = { id: 'h', inspectionId: 'i', productId, locationId: 'loc-wh', binId: 'a', lotId: 'lot-1',
    quantity: 1, status: 'active', reason: 'Damaged', createdBy: 'quality', createdAt: '2026-11-05T00:00:00Z' };
  const pick = (holds: InventoryHold[] = []) => recommendedFulfillmentBin(data, order, productId, holds)?.id;
  return { data, order, productId, hold, pick };
}

describe('single-bin fulfillment recommendation boundaries', () => {
  it('skips a serial on active hold even while its status remains in_stock', async () => {
    const { pick, hold } = await fixture();
    expect(pick([{ ...hold, serialNumber: 'a1' }])).toBe('b');
  });
  it('does not treat released serial holds as active', async () => {
    const { pick, hold } = await fixture();
    expect(pick([{ ...hold, serialNumber: 'a1', status: 'released' }])).toBe('a');
  });
  it('excludes nonaccepted units from a bin quantity', async () => {
    const { data, pick } = await fixture();
    data.units[0]!.status = 'pending_inspection';
    expect(pick()).toBe('b');
  });
  it('subtracts active bulk holds at the exact lot', async () => {
    const { pick, hold } = await fixture(false);
    expect(pick([hold])).toBe('b');
    expect(pick([{ ...hold, lotId: 'other-lot' }])).toBe('a');
  });
  it('excludes unavailable bulk quantity', async () => {
    const { data, pick } = await fixture(false);
    data.stockLevels[0]!.unavailable = 1;
    expect(pick()).toBe('b');
  });
  it('sums separate eligible receipt lots within the same bin', async () => {
    const { data, pick } = await fixture(false);
    data.stockLevels[0]!.quantity = 1;
    data.stockLevels[1]!.quantity = 1;
    data.stockLevels.push({ ...data.stockLevels[1]!, lotId: 'lot-2' });
    expect(pick()).toBe('b');
  });
  it('skips inactive bins without changing stored custody', async () => {
    const { data, pick } = await fixture();
    data.storageAreas[0]!.active = false;
    expect(pick()).toBe('b');
    expect(data.units[0]!.binId).toBe('a');
  });
  it('does not recommend a bin belonging to a different warehouse', async () => {
    const { data, pick } = await fixture();
    data.storageAreas[0]!.locationId = 'other';
    expect(pick()).toBe('b');
  });
  it('honors the explicitly restricted order bin even when another bin is sufficient', async () => {
    const { data, order, pick } = await fixture();
    order.sourceBinId = 'a';
    data.units.shift();
    expect(pick()).toBe('a');
    order.sourceBinId = 'b';
    expect(pick()).toBe('b');
  });
  it('does not count this order own reservation as competing demand', async () => {
    const { data, order, productId, pick } = await fixture();
    data.fulfillmentReservations = [{ id: 'r', orderId: order.id, productId, quantity: 2, binId: 'a', locationId: 'loc-wh',
      status: 'active', createdBy: 'requester', createdAt: '2026-11-05T00:00:00Z' }];
    expect(pick()).toBe('a');
  });
  it('excludes other active bin-scoped reservations but not cancelled ones', async () => {
    const { data, productId, pick } = await fixture();
    data.fulfillmentReservations = [{ id: 'r', orderId: 'other', productId, quantity: 1, binId: 'a', locationId: 'loc-wh',
      status: 'active', createdBy: 'requester', createdAt: '2026-11-05T00:00:00Z' }];
    expect(pick()).toBe('b');
    data.fulfillmentReservations[0]!.status = 'cancelled';
    expect(pick()).toBe('a');
  });
  it('does not assign unscoped commitments to every bin', async () => {
    const { data, productId, pick } = await fixture();
    data.fulfillmentReservations = [{ id: 'r', orderId: 'other', productId, quantity: 1, locationId: 'loc-wh',
      status: 'active', createdBy: 'requester', createdAt: '2026-11-05T00:00:00Z' }];
    expect(pick()).toBe('a');
  });
  it('does not merge insufficient bins or silently fall back to general-area custody', async () => {
    const { data, pick } = await fixture();
    data.units = data.units.filter(unit => unit.serialNumber.endsWith('1'));
    expect(pick()).toBe('a');
  });
  it('preserves general-area picking when no binned stock exists', async () => {
    const { data, pick } = await fixture();
    data.units.forEach(unit => { unit.binId = undefined; });
    expect(pick()).toBeUndefined();
  });
  it('uses the public position hold quantity without a private hold read', async () => {
    const { data, order, productId } = await fixture();
    const position = { productId, locationId: 'loc-wh', binId: 'a', onHand: 2, held: 1, unavailable: 0 } as InventoryPosition;
    expect(recommendedFulfillmentBin(data, order, productId, [], [position])?.id).toBe('b');
  });
});
