import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRepository } from './SupabaseRepository';

const item = { sourceType: 'receipt' as const, sourceId: 'receipt', productId: 'device', quantity: 1, serialNumber: 'S1' };
const single = { ...item, idempotencyKey: 'inspection-outcome-01', disposition: 'accepted' as const, evidenceUrls: ['stored/photo.jpg'] };
const batch = { ...single, items: [item] };
const row = { id: 'inspection-1', source_type: 'receipt', source_id: 'receipt', product_id: 'device', quantity: 1,
  serial_number: 'S1', disposition: 'accepted', evidence_urls: single.evidenceUrls, inspected_by: 'inspector', inspected_at: '2026-09-20' };
const kinds = ['single', 'batch'] as const;
const invoke = (repo: SupabaseRepository, kind: typeof kinds[number]) => kind === 'single' ? repo.inspectQuality(single) : repo.inspectQualityBatch(batch);

it.each(kinds)('types only returned PostgreSQL rejection codes for the current %s attempt', async kind => {
  const rpc = vi.fn();
  const repo = new SupabaseRepository({ rpc } as unknown as SupabaseClient);
  for (const code of ['P0001', '23502', '23503', '23505', '23514', '22003', '22P02', '22023', '42501', '40001', '40P01']) {
    rpc.mockResolvedValue({ data: null, error: { message: 'Inspection rejected', code } });
    await expect(invoke(repo, kind)).rejects.toMatchObject({ name: 'InspectionRejectedError', code, stage: 'rolled-back' });
  }
});

it.each(kinds)('keeps transport, connection, generic 400 and unlisted %s errors uncertain', async kind => {
  const rpc = vi.fn();
  const repo = new SupabaseRepository({ rpc } as unknown as SupabaseClient);
  for (const code of ['', '400', 'PGRST000', '08006', '57P01', 'XX000', 'not-a-code']) {
    rpc.mockResolvedValue({ data: null, error: { message: 'Result unavailable', code }, status: 400 });
    await expect(invoke(repo, kind)).rejects.not.toHaveProperty('outcome', 'rejected');
  }
  rpc.mockRejectedValue(Object.assign(new Error('Transport threw'), { code: '42501' }));
  await expect(invoke(repo, kind)).rejects.not.toHaveProperty('outcome', 'rejected');
});

it.each(kinds)('does not treat malformed or unmappable successful %s responses as committed or rejected', async kind => {
  const rpc = vi.fn();
  const repo = new SupabaseRepository({ rpc } as unknown as SupabaseClient);
  for (const malformed of [null, {}, { ...row, id: '' }, { ...row, quantity: 'invalid' }, { ...row, inspected_by: null }]) {
    rpc.mockResolvedValue({ data: kind === 'single' ? { inspection: malformed } : { inspections: [malformed] }, error: null });
    await expect(invoke(repo, kind)).rejects.not.toHaveProperty('outcome', 'rejected');
  }
  const unmap = { ...row, quantity: { valueOf() { throw Object.assign(new Error('Mapping failed'), { code: 'P0001' }); } } };
  rpc.mockResolvedValue({ data: kind === 'single' ? { inspection: unmap } : { inspections: [unmap] }, error: null });
  await expect(invoke(repo, kind)).rejects.not.toHaveProperty('outcome', 'rejected');
});

it('identifies local validation as not sent and preserves complete successful confirmations', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: { inspection: row }, error: null });
  const repo = new SupabaseRepository({ rpc } as unknown as SupabaseClient);
  await expect(repo.inspectQuality({ ...single, idempotencyKey: 'bad' })).rejects.toMatchObject({ name: 'InspectionRejectedError', stage: 'not-sent' });
  await expect(repo.inspectQualityBatch({ ...batch, items: [] })).rejects.toMatchObject({ name: 'InspectionRejectedError', stage: 'not-sent' });
  expect(rpc).not.toHaveBeenCalled();
  expect(await repo.inspectQuality(single)).toMatchObject({ id: row.id });
  rpc.mockResolvedValue({ data: { inspections: [row] }, error: null });
  expect(await repo.inspectQualityBatch(batch)).toHaveLength(1);
});
