import { describe, expect, it } from 'vitest';
import { InMemoryRepository } from './inMemoryRepository';
import { buildSeed } from './seed';
import { validateQualityBatch } from './domain/warehouseControls';
import type { InspectQualityBatchInput, QualityBatchItem } from './domain/warehouseControls';

const item = { sourceType: 'receipt' as const, sourceId: 'receipt-batch', productId: 'quality-device',
  quantity: 1, binId: 'bin-batch', serialNumber: 'QC-001' };
const batch = { idempotencyKey: 'quality-batch-0001', disposition: 'accepted' as const,
  evidenceUrls: ['https://example.test/quality.jpg'], items: [item, { ...item, serialNumber: 'QC-002' }] };

function repositoryData() {
  const data = structuredClone(buildSeed());
  const product = { ...data.products.find(p => p.serialized)!, id: item.productId };
  data.products.push(product);
  data.receipts.push({ id: item.sourceId, locationId: 'loc-batch', actor: 'receiver', createdAt: '2026-09-20',
    lines: [{ productId: item.productId, quantity: 2, binId: item.binId, serialNumbers: ['QC-001', 'QC-002'] }] });
  data.units.push(...['QC-001', 'QC-002'].map(serialNumber => ({ id: serialNumber, productId: item.productId,
    serialNumber, locationId: 'loc-batch', binId: item.binId, status: 'pending_inspection' as const })));
  return data;
}
function repository() { return new InMemoryRepository(repositoryData()); }

function custodyFixture() {
  const data = repositoryData();
  const receipt = data.receipts.find(row => row.id === item.sourceId)!;
  receipt.procurementPoId = 'po-batch';
  Object.assign(receipt.lines[0]!, { procurementLineId: 'line-a', lotCode: 'LOT-A' });
  data.lots.push({ id: 'lot-a', productId: item.productId, lotCode: 'LOT-A', receivedAt: '2026-09-20', unitCost: 1 });
  data.lots.push({ id: 'lot-b', productId: item.productId, lotCode: 'LOT-B', receivedAt: '2026-09-20', unitCost: 1 });
  for (const unit of data.units.filter(unit => unit.productId === item.productId)) unit.lotId = 'lot-a';
  receipt.lines.push({ productId: item.productId, quantity: 1, binId: item.binId, procurementLineId: 'line-b', lotCode: 'LOT-B', serialNumbers: ['QC-003'] });
  data.units.push({ id: 'QC-003', productId: item.productId, serialNumber: 'QC-003', locationId: 'loc-batch', binId: item.binId, lotId: 'lot-b', status: 'pending_inspection' });
  data.receipts.push({ id: 'other-receipt', locationId: 'loc-batch', actor: 'receiver', createdAt: '2026-09-20',
    lines: [{ productId: item.productId, quantity: 1, binId: item.binId, serialNumbers: ['QC-FOREIGN'] }] });
  data.units.push({ id: 'QC-FOREIGN', productId: item.productId, serialNumber: 'QC-FOREIGN', locationId: 'loc-batch', binId: item.binId, lotId: 'lot-a', status: 'pending_inspection' });
  const input: InspectQualityBatchInput = { ...batch, items: batch.items.map(row => ({ ...row, lotId: 'lot-a', procurementPoLineId: 'line-a' })) };
  return { data, input };
}

describe('explicit quality batch', () => {
  it('rejects empty, oversized, duplicate and mixed-custody selections', () => {
    expect(() => validateQualityBatch(batch)).not.toThrow();
    for (const invalid of [[], Array.from({ length: 51 }, (_, i) => ({ ...item, serialNumber: `S-${i}` })),
      [item, { ...item, serialNumber: ' qc-001 ' }], [item, { ...item, sourceId: 'other' }],
      [item, { ...item, procurementPoLineId: 'other' }], [item, { ...item, binId: 'other' }],
      [item, { ...item, lotId: 'other' }], [{ ...item, quantity: 2 }]]) {
      expect(() => validateQualityBatch({ ...batch, items: invalid })).toThrow();
    }
    expect(() => validateQualityBatch({ ...batch, evidenceUrls: [] })).toThrow(/evidence/i);
    expect(() => validateQualityBatch({ ...batch, disposition: 'hold', reason: ' ' })).toThrow(/reason/i);
  });
  it('records each selected serial and replays without duplicate inspection', async () => {
    const repo = repository();
    const first = await repo.inspectQualityBatch(batch);
    expect(first).toHaveLength(2);
    expect(first.map(i => i.serialNumber)).toEqual(['QC-001', 'QC-002']);
    expect(await repo.inspectQualityBatch(batch)).toEqual(first);
    expect((await repo.listQualityInspections({})).rows).toHaveLength(2);
    await expect(repo.inspectQualityBatch({ ...batch, disposition: 'hold', reason: 'Changed' })).rejects.toThrow(/different payload/);
  });
  it('rolls back the whole batch if a later item is no longer eligible', async () => {
    const repo = repository();
    const before = await repo.getData();
    await expect(repo.inspectQualityBatch({ ...batch, items: [item, { ...item, serialNumber: 'MISSING' }] })).rejects.toThrow();
    expect(await repo.getData()).toEqual(before);
    expect((await repo.listQualityInspections({})).rows).toHaveLength(0);
    expect((await repo.inspectQualityBatch(batch))).toHaveLength(2);
  });

  it.each(['accepted', 'hold'] as const)('durably restores %s inspections, evidence, holds, exceptions and the root retry receipt', async disposition => {
    let saved: string | null = null;
    const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; } };
    const repo = new InMemoryRepository(repositoryData(), { storage });
    const input = { ...batch, disposition, reason: disposition === 'hold' ? 'Seal damaged' : undefined };
    const result = await repo.inspectQualityBatch(input);
    const before = { data: await repo.getData(), inspections: await repo.listQualityInspections({}), holds: await repo.listHolds({}), exceptions: await repo.listExceptions({}) };
    expect(before.holds.rows).toHaveLength(disposition === 'hold' ? 2 : 0);
    expect(before.exceptions.rows).toHaveLength(disposition === 'hold' ? 2 : 0);
    const restored = new InMemoryRepository(undefined, { storage });
    expect(await restored.listQualityInspections({})).toEqual(before.inspections);
    expect(await restored.listHolds({})).toEqual(before.holds);
    expect(await restored.listExceptions({})).toEqual(before.exceptions);
    expect(await restored.getData()).toEqual(before.data);
    expect(await restored.inspectQualityBatch(input)).toEqual(result);
    await expect(restored.inspectQualityBatch({ ...input, reason: 'Changed' })).rejects.toThrow(/different payload/);
    expect((await restored.listQualityInspections({})).rows).toHaveLength(2);
    expect(await restored.getQualityInspectionEvidence(result[0]!.id)).toEqual(input.evidenceUrls);
  });

  it('rolls back stock, quality state and retry receipts if durable storage fails, then retries cleanly', async () => {
    let saved: string | null = null;
    let fail = true;
    const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { if (fail) throw new Error('Storage unavailable'); saved = value; } };
    const repo = new InMemoryRepository(repositoryData(), { storage });
    const before = await repo.getData();
    await expect(repo.inspectQualityBatch(batch)).rejects.toThrow(/Storage unavailable/);
    expect(await repo.getData()).toEqual(before);
    expect((await repo.listQualityInspections({})).rows).toHaveLength(0);
    expect(saved).toBeNull();
    fail = false;
    const result = await repo.inspectQualityBatch(batch);
    expect(await new InMemoryRepository(undefined, { storage }).inspectQualityBatch(batch)).toEqual(result);
  });

  it.each<[string, Partial<QualityBatchItem>]>([
    ['foreign source serial', { serialNumber: 'QC-FOREIGN' }],
    ['another PO line serial', { serialNumber: 'QC-003' }],
    ['missing PO line', { procurementPoLineId: undefined }],
    ['invented lot', { lotId: 'invented-lot' }],
    ['omitted known lot', { lotId: undefined }],
    ['another lot', { lotId: 'lot-b' }],
    ['omitted known bin', { binId: undefined }],
    ['missing serialized identity', { serialNumber: undefined }],
  ])('rejects %s without any partial inspection or stock change', async (_name, patch) => {
    const { data, input } = custodyFixture();
    const repo = new InMemoryRepository(data);
    const before = await repo.getData();
    await expect(repo.inspectQualityBatch({ ...input, items: [{ ...input.items[0]!, ...patch }] })).rejects.toThrow(/custody|source|line|serial|lot|bin/i);
    expect(await repo.getData()).toEqual(before);
    expect((await repo.listQualityInspections({})).rows).toHaveLength(0);
  });

  it('rejects a source-bin mismatch even when eligible stock exists in the claimed bin', async () => {
    const { data, input } = custodyFixture();
    data.units.find(unit => unit.serialNumber === 'QC-001')!.binId = 'other-bin';
    const repo = new InMemoryRepository(data);
    await expect(repo.inspectQualityBatch({ ...input, items: [{ ...input.items[0]!, binId: 'other-bin' }] })).rejects.toThrow(/custody|bin/i);
  });

  it('accepts exact source, PO line, bin, lot and serial, but rejects a stale replay under a new key', async () => {
    const { data, input } = custodyFixture();
    const repo = new InMemoryRepository(data);
    expect(await repo.inspectQualityBatch(input)).toHaveLength(2);
    await expect(repo.inspectQualityBatch({ ...input, idempotencyKey: 'another-quality-batch' })).rejects.toThrow();
  });

  it('rolls back the first item when a later serial has moved to another lot', async () => {
    const { data, input } = custodyFixture();
    data.units.find(unit => unit.serialNumber === 'QC-002')!.lotId = 'lot-b';
    const repo = new InMemoryRepository(data);
    const before = await repo.getData();
    await expect(repo.inspectQualityBatch(input)).rejects.toThrow(/custody/);
    expect(await repo.getData()).toEqual(before);
    expect((await repo.listQualityInspections({})).rows).toHaveLength(0);
  });

  it('rejects duplicate canonical stock identity instead of choosing the first unit', async () => {
    const { data, input } = custodyFixture();
    const unit = data.units.find(row => row.serialNumber === 'QC-001')!;
    data.units.push({ ...unit, id: 'duplicate', serialNumber: ' qc-001 ' });
    await expect(new InMemoryRepository(data).inspectQualityBatch(input)).rejects.toThrow(/custody/);
  });

  it('rejects an unresolved lot reference even when the input matches the unit reference', async () => {
    const data = repositoryData();
    data.units.find(unit => unit.serialNumber === 'QC-001')!.lotId = 'missing-lot';
    await expect(new InMemoryRepository(data).inspectQualityBatch({ ...batch, items: [{ ...item, lotId: 'missing-lot' }] })).rejects.toThrow(/custody|lot/);
  });

  it('accepts normalized serial input only when the source and unique pending unit agree', async () => {
    const repo = repository();
    const result = await repo.inspectQualityBatch({ ...batch, items: [{ ...item, serialNumber: ' qc-001 ' }] });
    expect(result[0]!.serialNumber).toBe('QC-001');
  });

  it('resolves the exact return line location and refuses an unrelated pending serial', async () => {
    const data = repositoryData();
    const unit = data.units.find(row => row.serialNumber === 'QC-002')!;
    unit.locationId = 'other-location'; unit.binId = 'other-bin';
    data.returns.push({ id: 'quality-return', source: 'event', actor: 'receiver', createdAt: '2026-09-20', lines: [
      { productId: item.productId, quantity: 1, serialNumber: 'QC-001', locationId: 'loc-batch', binId: item.binId, disposition: 'quarantine', reason: 'Returned' },
      { productId: item.productId, quantity: 1, serialNumber: 'QC-002', locationId: 'other-location', binId: 'other-bin', disposition: 'quarantine', reason: 'Returned' },
    ] });
    const input: InspectQualityBatchInput = { ...batch, items: [{ ...item, sourceType: 'return', sourceId: 'quality-return', serialNumber: 'QC-002', binId: 'other-bin' }] };
    const repo = new InMemoryRepository(data);
    await expect(repo.inspectQualityBatch({ ...input, items: [{ ...input.items[0]!, serialNumber: 'QC-001' }] })).rejects.toThrow(/custody/);
    expect(await repo.inspectQualityBatch(input)).toHaveLength(1);
    const result = await repo.getData();
    expect(result.units.find(row => row.serialNumber === 'QC-001')!.status).toBe('pending_inspection');
    expect(result.units.find(row => row.serialNumber === 'QC-002')!.status).toBe('in_stock');
    expect(result.returns.find(row => row.id === 'quality-return')!.lines.map(line => line.disposition)).toEqual(['quarantine', 'restock']);
  });

  it('refuses ambiguous repeated bulk source lines rather than choosing one', async () => {
    const data = repositoryData();
    data.products.find(product => product.id === item.productId)!.serialized = false;
    const receipt = data.receipts.find(row => row.id === item.sourceId)!;
    delete receipt.lines[0]!.serialNumbers;
    receipt.lines.push({ ...receipt.lines[0]! });
    data.stockLevels.push({ productId: item.productId, locationId: 'loc-batch', binId: item.binId, quantity: 4, unavailable: 4 });
    await expect(new InMemoryRepository(data).inspectQualityBatch({ ...batch, items: [{ ...item, serialNumber: undefined }] })).rejects.toThrow(/custody/);
  });

  it('changes only the exact bulk lot and rejects a lot outside the selected source line', async () => {
    const { data, input } = custodyFixture();
    data.products.find(product => product.id === item.productId)!.serialized = false;
    const receipt = data.receipts.find(row => row.id === item.sourceId)!;
    for (const line of receipt.lines) { delete line.serialNumbers; line.quantity = 2; }
    data.stockLevels.push(...['lot-a', 'lot-b'].map(lotId => ({ productId: item.productId, locationId: 'loc-batch', binId: item.binId, lotId, quantity: 2, unavailable: 2 })));
    const repo = new InMemoryRepository(data);
    const bulk = { ...input, items: [{ ...input.items[0]!, serialNumber: undefined, quantity: 2, procurementPoLineId: 'line-b', lotId: 'lot-b' }] };
    await expect(repo.inspectQualityBatch({ ...bulk, items: [{ ...bulk.items[0]!, lotId: 'lot-a' }] })).rejects.toThrow(/custody|lot/i);
    await repo.inspectQualityBatch(bulk);
    expect((await repo.getData()).stockLevels.filter(row => row.productId === item.productId).map(row => [row.lotId, row.unavailable])).toEqual([['lot-a', 2], ['lot-b', 0]]);
  });
});
