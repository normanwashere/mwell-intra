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
  it('reconciles canonical inspections with mixed-case receipt evidence without crossing line or bin identity', async () => {
    const data = await makeRepo().getData();
    data.receipts = [{ id: 'receipt', locationId: 'main', actor: 'receiver', createdAt: '2026-09-01', lines: [
      { productId: 'shirt-l', quantity: 1, procurementLineId: 'A', binId: 'bin-A', serialNumbers: [' Mixed-Serial '] },
    ] }];
    data.returns = [];
    const evidence = JSON.stringify(data.receipts);
    const resolved = inspection({ quantity: 1, serialNumber: 'MIXED-SERIAL', procurementPoLineId: 'A', binId: 'bin-A' });
    expect(pendingQualityWork(data, [resolved])).toEqual([]);
    for (const change of [{ serialNumber: 'FOREIGN' }, { procurementPoLineId: 'B' }, { binId: 'bin-B' }]) {
      expect(pendingQualityWork(data, [{ ...resolved, ...change }])).toHaveLength(1);
    }
    expect(JSON.stringify(data.receipts)).toBe(evidence);
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
  it.each([[true, false], [false, false], [true, true], [false, true]])('reserves exact consumption (legacy first=%s, reversed lines=%s)', async (legacyFirst, reverseLines) => {
    const data = await makeRepo().getData();
    data.receipts = [{ id: 'receipt', locationId: 'main', actor: 'receiver', createdAt: '2026-09-01', lines: [
      { productId: 'shirt-l', quantity: 5, procurementLineId: 'A' },
      { productId: 'shirt-l', quantity: 5, procurementLineId: 'B' },
    ] }];
    data.returns = [];
    if (reverseLines) data.receipts[0]!.lines.reverse();
    const exact = inspection({ id: 'exact-A', procurementPoLineId: 'A' });
    const legacy = inspection({ id: 'legacy' });
    expect(pendingQualityWork(data, legacyFirst ? [legacy, exact] : [exact, legacy])).toEqual([]);
  });
  it('retains ambiguous legacy custody instead of choosing a procurement line', async () => {
    const data = await makeRepo().getData();
    data.receipts = [{ id: 'receipt', locationId: 'main', actor: 'receiver', createdAt: '2026-09-01', lines: [
      { productId: 'shirt-l', quantity: 5, procurementLineId: 'A' },
      { productId: 'shirt-l', quantity: 5, procurementLineId: 'B' },
    ] }];
    data.returns = [];
    const pending = pendingQualityWork(data, [inspection()]);
    expect(pending).toHaveLength(2);
    expect(pending.map(row => row.quantity)).toEqual([5, 5]);
  });
  it.each([true, false])('matches exact serials before fallback and consumes repeated records once (reverse=%s)', async reverse => {
    const data = await makeRepo().getData();
    data.receipts = [{ id: 'receipt', locationId: 'main', actor: 'receiver', createdAt: '2026-09-01', lines: [
      { productId: 'shirt-l', quantity: 3, procurementLineId: 'A', serialNumbers: ['S1', 'S2', 'S3'] },
    ] }];
    data.returns = [];
    const exact = inspection({ id: 'exact', quantity: 1, procurementPoLineId: 'A', serialNumber: 'S1' });
    const wrongLine = inspection({ id: 'wrong-line', quantity: 1, procurementPoLineId: 'B', serialNumber: 'S2' });
    const wrongSerial = inspection({ id: 'wrong-serial', quantity: 1, procurementPoLineId: 'A', serialNumber: 'OTHER' });
    const records = [exact, exact, wrongLine, wrongSerial];
    const pending = pendingQualityWork(data, reverse ? records.reverse() : records);
    expect(pending.map(row => [row.serialNumber, row.quantity])).toEqual([['S2', 1], ['S3', 1]]);
    const legacy = inspection({ id: 'legacy', quantity: 1 });
    expect(pendingQualityWork(data, [...records, legacy])).toEqual(pending);
  });
  it('does not let a serial inspection consume a line without serial identity or the wrong bin', async () => {
    const data = await makeRepo().getData();
    data.receipts = [{ id: 'receipt', locationId: 'main', actor: 'receiver', createdAt: '2026-09-01', lines: [
      { productId: 'shirt-l', quantity: 1, procurementLineId: 'A', binId: 'B1' },
    ] }];
    data.returns = [];
    expect(pendingQualityWork(data, [inspection({ quantity: 1, serialNumber: 'S1' })])).toHaveLength(1);
    expect(pendingQualityWork(data, [inspection({ quantity: 1, procurementPoLineId: 'A', binId: 'B2' })])).toHaveLength(1);
  });
  it('accounts for strong identities with missing receipt bin metadata without guessing distinct bins', async () => {
    const data = await makeRepo().getData();
    data.returns = [];
    data.receipts = [{ id: 'receipt', locationId: 'main', actor: 'receiver', createdAt: '2026-09-01', lines: [
      { productId: 'shirt-l', quantity: 1, procurementLineId: 'A', serialNumbers: ['S1'] },
    ] }];
    expect(pendingQualityWork(data, [inspection({ quantity: 1, procurementPoLineId: 'A', serialNumber: 'S1', binId: 'B1' })])).toEqual([]);
    data.receipts[0]!.lines = [{ productId: 'shirt-l', quantity: 5, procurementLineId: 'A' }];
    expect(pendingQualityWork(data, [inspection({ procurementPoLineId: 'A', binId: 'B1' })])).toEqual([]);
    expect(pendingQualityWork(data, [inspection({ binId: 'B1' })])).toHaveLength(1);
    data.receipts[0]!.lines.push({ productId: 'shirt-l', quantity: 5, procurementLineId: 'A', binId: 'B1' });
    expect(pendingQualityWork(data, [inspection({ procurementPoLineId: 'A', binId: 'B1' })])).toHaveLength(2);
  });
  it.each([true, false])('rejects conflicting duplicate IDs regardless of order (reverse=%s)', async reverse => {
    const data = await makeRepo().getData();
    for (const change of [{ quantity: 4 }, { procurementPoLineId: 'B' }, { serialNumber: 'OTHER' }, { disposition: 'pending' as const }]) {
      const rows = [inspection(), inspection(change)];
      expect(() => pendingQualityWork(data, reverse ? rows.reverse() : rows)).toThrow('Conflicting inspection records');
    }
  });
  it('does not count a split pending inspection twice and retains current total beyond 100', async () => {
    const data = await makeRepo().getData();
    data.receipts = [{ id: 'receipt', locationId: 'main', actor: 'receiver', createdAt: '2026-09-01', lines: [
      { productId: 'shirt-l', quantity: 3, procurementLineId: 'A' },
      { productId: 'shirt-l', quantity: 7, procurementLineId: 'A' },
    ] }];
    data.returns = [];
    const history = Array.from({ length: 101 }, (_, index) => inspection({
      id: `old-${index}`, sourceId: `old-receipt-${index}`, quantity: 1,
      disposition: 'pending', inspectedAt: '2026-01-01T00:00:00Z',
    }));
    const pending = pendingQualityWork(data, [...history,
      inspection({ id: 'accepted', quantity: 4, procurementPoLineId: 'A' }),
      inspection({ id: 'pending', quantity: 2, procurementPoLineId: 'A', disposition: 'pending' }),
    ]);
    expect(pending).toHaveLength(103);
    expect(pending.filter(row => row.sourceId === 'receipt').reduce((sum, row) => sum + row.quantity, 0)).toBe(6);
    expect(pending[0]?.recordedAt).toBe('2026-01-01T00:00:00Z');
    expect(pending.filter(row => row.sourceId === 'receipt')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'pending', quantity: 2 }),
      expect.objectContaining({ id: 'receipt-shirt-l-1', quantity: 4 }),
    ]));
  });
  it('retains direct pending inspections even when their receipt is not in the base snapshot', async () => {
    const data = await makeRepo().getData(); data.receipts = []; data.returns = [];
    expect(pendingQualityWork(data, [inspection({ disposition: 'pending', serialNumber: 'UNIT-101' })]))
      .toMatchObject([{ id: 'inspection', serialNumber: 'UNIT-101' }]);
  });
});
