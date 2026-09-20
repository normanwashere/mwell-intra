import { expect, it } from 'vitest';
import { InMemoryRepository } from './inMemoryRepository';
import { buildSeed } from './seed';

const input = { idempotencyKey: 'inspection-outcome-local', sourceType: 'receipt' as const, sourceId: 'missing', productId: 'missing',
  disposition: 'accepted' as const, quantity: 1, evidenceUrls: ['stored/photo.jpg'] };

it('marks known memory validation as rejected and keeps local preparation failures not sent', async () => {
  const repo = new InMemoryRepository(structuredClone(buildSeed()));
  await expect(repo.inspectQuality(input)).rejects.toMatchObject({ name: 'InspectionRejectedError', stage: 'rolled-back' });
  await expect(repo.inspectQualityBatch({ ...input, items: [input] })).rejects.toMatchObject({ name: 'InspectionRejectedError', stage: 'rolled-back' });
  await expect(repo.inspectQuality({ ...input, idempotencyKey: 'bad' })).rejects.toMatchObject({ name: 'InspectionRejectedError', stage: 'not-sent' });
  await expect(repo.inspectQualityBatch({ ...input, items: [] })).rejects.toMatchObject({ name: 'InspectionRejectedError', stage: 'not-sent' });
});

it('rolls back a single inspection before reporting a known return-line rejection', async () => {
  const data = structuredClone(buildSeed());
  const product = data.products.find(row => row.serialized)!;
  data.units.push({ id: 'outcome-unit', productId: product.id, serialNumber: 'OUTCOME-UNIT', locationId: 'outcome-location', status: 'pending_inspection' });
  data.returns.push({ id: 'outcome-return', actor: 'receiver', source: 'event', createdAt: '2026-09-20',
    lines: [{ productId: product.id, serialNumber: 'OTHER-UNIT', quantity: 1, locationId: 'outcome-location', disposition: 'quarantine', reason: 'Return' }] });
  const repo = new InMemoryRepository(data);
  const before = await repo.getData();
  await expect(repo.inspectQuality({ ...input, sourceType: 'return', sourceId: 'outcome-return', productId: product.id, serialNumber: 'OUTCOME-UNIT' })).rejects.toMatchObject({ name: 'InspectionRejectedError', stage: 'rolled-back' });
  expect(await repo.getData()).toEqual(before);
  expect((await repo.listQualityInspections({})).rows).toHaveLength(0);
});
