import { describe, expect, it, vi } from 'vitest';
import type { QualityInspection } from '@intra/data-kit';
import { makeRepo } from '@/test/renderWithProviders';
import { loadCompleteControlQueue, pendingQualityWork } from './controlQueues';

describe('complete control queues', () => {
  it('follows every cursor instead of dropping the older queue', async () => {
    const load = vi.fn().mockResolvedValueOnce({ rows: Array.from({ length: 100 }, (_, i) => i), nextCursor: 'older' })
      .mockResolvedValueOnce({ rows: [100, 101] });
    expect(await loadCompleteControlQueue(load)).toHaveLength(102);
    expect(load).toHaveBeenLastCalledWith({ limit: 100, cursor: 'older' });
  });
  it('fails closed for a cycling cursor or a failed later page', async () => {
    await expect(loadCompleteControlQueue(vi.fn().mockResolvedValue({ rows: [], nextCursor: 'same' }))).rejects.toThrow('completely');
    await expect(loadCompleteControlQueue(vi.fn().mockResolvedValueOnce({ rows: [1], nextCursor: 'older' }).mockRejectedValueOnce(new Error('offline')))).rejects.toThrow('offline');
  });
});

describe('inspection line identity', () => {
  const inspection = (overrides: Partial<QualityInspection> = {}): QualityInspection => ({
    id: 'inspection', sourceType: 'receipt', sourceId: 'receipt', productId: 'shirt-l', quantity: 5,
    disposition: 'accepted', inspectedAt: '2026-09-01T00:00:00Z', evidenceUrls: [], inspectedBy: 'other', ...overrides,
  });
  it('consumes a legacy inspection once across repeated SKU lines', async () => {
    const data = await makeRepo().getData();
    data.receipts = [{ id: 'receipt', locationId: 'main', actor: 'receiver', createdAt: '2026-09-01', lines: [
      { productId: 'shirt-l', quantity: 5 }, { productId: 'shirt-l', quantity: 5 },
    ] }];
    data.returns = [];
    const pending = pendingQualityWork(data, [inspection()]);
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ quantity: 5, id: 'receipt-shirt-l-1' });
  });
  it('keeps different procurement lines independent', async () => {
    const data = await makeRepo().getData();
    data.receipts = [{ id: 'receipt', locationId: 'main', actor: 'receiver', createdAt: '2026-09-01', lines: [
      { productId: 'shirt-l', quantity: 5, procurementLineId: 'A' },
      { productId: 'shirt-l', quantity: 5, procurementLineId: 'B' },
    ] }];
    data.returns = [];
    expect(pendingQualityWork(data, [inspection({ procurementPoLineId: 'A' })])).toMatchObject([{ quantity: 5, procurementPoLineId: 'B' }]);
  });
  it('retains direct pending inspections even when their receipt is not in the base snapshot', async () => {
    const data = await makeRepo().getData(); data.receipts = []; data.returns = [];
    expect(pendingQualityWork(data, [inspection({ disposition: 'pending', serialNumber: 'UNIT-101' })]))
      .toMatchObject([{ id: 'inspection', serialNumber: 'UNIT-101' }]);
  });
});
