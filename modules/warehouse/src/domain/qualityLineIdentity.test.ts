import { describe, expect, it } from 'vitest';
import { InMemoryRepository, type WarehouseData } from '@intra/data-kit';
import { pendingQualityWork } from './controlQueues';

function fixture() {
  const data: WarehouseData = {
    products: [{ id: 'shirt', sku: 'SHIRT', name: 'Shirt', category: 'merchandise', serialized: false, attributes: {}, unitCost: 1, reorderPoint: 0 }],
    locations: [{ id: 'wh', name: 'Warehouse', type: 'warehouse' }],
    storageAreas: [{ id: 'bin', locationId: 'wh', code: 'BIN', active: true }],
    suppliers: [], lots: [], units: [], stockLevels: [{ productId: 'shirt', locationId: 'wh', binId: 'bin', quantity: 10, unavailable: 10 }],
    movements: [], allocations: [], events: [], returns: [], cycleCounts: [],
    receipts: [{ id: 'receipt', locationId: 'wh', actor: 'receiver', createdAt: '2026-09-05', lines: [
      { productId: 'shirt', quantity: 5, binId: 'bin', procurementLineId: 'A' },
      { productId: 'shirt', quantity: 5, binId: 'bin', procurementLineId: 'B' },
    ] }],
    purchaseOrders: [], fulfillmentOrders: [], fulfillmentReservations: [], departmentRequestOptions: [], departmentStockRequests: [], customerReturnCases: [], kitDefinitions: [], reKitWorkOrders: [],
  };
  return new InMemoryRepository(data, { storage: null });
}
const input = { idempotencyKey: 'inspect-line-A-001', sourceType: 'receipt' as const, sourceId: 'receipt', productId: 'shirt', binId: 'bin', procurementPoLineId: 'A', quantity: 5, disposition: 'accepted' as const };

describe('memory quality procurement identity', () => {
  it('rejects an unknown explicit line and cumulative overinspection without changing custody', async () => {
    const repo = fixture();
    const before = await repo.getData();
    await expect(repo.inspectQuality({ ...input, procurementPoLineId: 'OTHER' })).rejects.toThrow('does not belong');
    expect(await repo.getData()).toEqual(before);
    expect((await repo.listQualityInspections({})).rows).toEqual([]);
    await repo.inspectQuality({ ...input, quantity: 3 });
    const partial = await repo.getData();
    await expect(repo.inspectQuality({ ...input, idempotencyKey: 'inspect-line-A-over', quantity: 3 })).rejects.toThrow('procurement line quantity');
    expect(await repo.getData()).toEqual(partial);
    expect((await repo.listQualityInspections({})).rows).toHaveLength(1);
    await repo.inspectQuality({ ...input, idempotencyKey: 'inspect-line-A-rest', quantity: 2 });
    expect(pendingQualityWork(await repo.getData(), (await repo.listQualityInspections({})).rows)).toMatchObject([{ procurementPoLineId: 'B', quantity: 5 }]);
  });
  it('round-trips exact line identity and leaves only same-bin line B pending, including replay', async () => {
    const repo = fixture();
    const result = await repo.inspectQuality(input);
    expect(result.procurementPoLineId).toBe('A');
    expect(await repo.inspectQuality(input)).toEqual(result);
    const rows = (await repo.listQualityInspections({})).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.procurementPoLineId).toBe('A');
    expect(pendingQualityWork(await repo.getData(), rows)).toMatchObject([{ procurementPoLineId: 'B', quantity: 5 }]);
    await repo.inspectQuality({ ...input, idempotencyKey: 'inspect-line-B-001', procurementPoLineId: 'B' });
    expect(pendingQualityWork(await repo.getData(), (await repo.listQualityInspections({})).rows)).toEqual([]);
  });
});
