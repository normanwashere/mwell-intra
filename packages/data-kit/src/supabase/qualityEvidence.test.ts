import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseRepository } from './SupabaseRepository';

function clientWith(data: unknown, error: unknown = null) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), or: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data, error })), then: (resolve: (value: unknown) => void) => Promise.resolve({ data, error }).then(resolve) };
  const client = { from: vi.fn(() => query) };
  return { repo: new SupabaseRepository(client as unknown as SupabaseClient), client, query };
}
describe('Lightweight inspection reads', () => {
  it('retains cursor ordering, count and identity without requesting photo payloads', async () => {
    const { repo, client, query } = clientWith([
      { id: 'b', source_id: 'receipt-exact', evidence_count: 2, inspected_at: '2026-09-12T00:00:00Z' },
      { id: 'a', evidence_count: 0, inspected_at: '2026-09-11T00:00:00Z' },
    ]);
    const page = await repo.listQualityInspectionSummaries({ limit: 1, status: 'accepted' });
    expect(client.from).toHaveBeenCalledWith('quality_inspection_queue');
    expect(query.select.mock.calls[0]?.[0]).not.toContain('evidence_urls');
    expect(query.eq).toHaveBeenCalledWith('disposition', 'accepted');
    expect(query.order.mock.calls).toEqual([['inspected_at', { ascending: false }], ['id', { ascending: false }]]);
    expect(page.rows[0]).toMatchObject({ id: 'b', sourceId: 'receipt-exact', evidenceCount: 2 });
    expect(page.rows[0]).not.toHaveProperty('evidenceUrls');
    expect(page.nextCursor).toBe(encodeURIComponent(JSON.stringify(['2026-09-12T00:00:00Z', 'b'])));
  });
  it('reads exact photos from the original protected table', async () => {
    const { repo, client, query } = clientWith({ evidence_urls: ['quality/exact.png'] });
    expect(await repo.getQualityInspectionEvidence('inspection-exact')).toEqual(['quality/exact.png']);
    expect(client.from).toHaveBeenCalledWith('quality_inspections');
    expect(query.select).toHaveBeenCalledWith('evidence_urls');
    expect(query.eq).toHaveBeenCalledWith('id', 'inspection-exact');
  });
  it.each([[null, null], [null, { message: 'denied' }], [{ evidence_urls: 'bad' }, null]])('does not hide denied or corrupt evidence as empty (%j)', async (data, error) => {
    const { repo } = clientWith(data, error);
    await expect(repo.getQualityInspectionEvidence('hidden')).rejects.toThrow();
  });
});
