import { expect, it, vi } from 'vitest';
import { readTrackingSource } from './tracking';
vi.mock('@intra/auth', () => ({ useSession: vi.fn() }));

function fixture(failAfter = false) {
  const rows = [
    ...Array.from({ length: 120 }, (_, i) => ({ id: `draft-${String(i).padStart(3, '0')}`, status: 'draft', requester_id: 'actor', updated_at: '2026-09-20' })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: `old-${i}`, title: `August PO ${i}`, status: 'approved', requester_id: 'actor', updated_at: '2026-08-24' })),
    ...Array.from({ length: 130 }, (_, i) => ({ id: `closed-${String(i).padStart(3, '0')}`, status: 'rejected', requester_id: 'actor', updated_at: '2026-08-01' })),
    { id: 'private', status: 'approved', requester_id: 'other', updated_at: '2026-09-20' },
  ];
  const calls: { owner: string; closed: boolean; after: string; limit: number; filter: string }[] = [];
  const client = { schema: () => ({ from: () => {
    const call = { owner: '', closed: false, after: '', limit: 0, filter: '' }; calls.push(call);
    const query = {
      select: () => query, eq: (_column: string, actor: string) => { call.owner = actor; return query; },
      or: (filter: string) => { call.filter = filter; return query; },
      in: () => { call.closed = true; return query; }, order: () => query,
      gt: (_column: string, after: string) => { call.after = after; return query; },
      limit: async (limit: number) => {
        call.limit = limit;
        if (failAfter && call.after) return { data: null, error: { message: 'Private backend detail' } };
        const scoped = rows.filter(row => row.requester_id === call.owner && (call.closed ? row.status === 'rejected' : row.status !== 'rejected') && row.id > call.after).sort((a, b) => a.id.localeCompare(b.id));
        return { data: scoped.slice(0, call.closed ? limit : Math.min(17, limit)), error: null };
      },
    }; return query;
  } }) };
  return { client, calls };
}
it('exhausts bounded owner-only open cursors even under a smaller server cap; closes only a separate recent window', async () => {
  const { client, calls } = fixture();
  const result = await readTrackingSource(client as never, 'procurement', 'actor');
  expect(result.errors).toEqual([]);
  expect(result.items.filter(item => item.bucket === 'waiting')).toHaveLength(3);
  expect(result.items.filter(item => item.bucket === 'action')).toHaveLength(120);
  expect(result.items.filter(item => item.bucket === 'completed')).toHaveLength(100);
  expect(result.items.some(item => item.id.endsWith('private'))).toBe(false);
  expect(calls.every(call => call.limit === 100 && call.owner === 'actor')).toBe(true);
  expect(calls.filter(call => !call.closed).every(call => call.filter === 'status.is.null,status.not.in.(rejected,cancelled)')).toBe(true);
  expect(calls.at(-1)?.closed).toBe(true);
});
it('does not publish a partial count or disclose database details after a continuation failure', async () => {
  const { client } = fixture(true);
  const result = await readTrackingSource(client as never, 'procurement', 'actor');
  expect(result.items).toEqual([]);
  expect(result.errors).toHaveLength(1);
  expect(result.errors.join()).not.toContain('Private');
});
