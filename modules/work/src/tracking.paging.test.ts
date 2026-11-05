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

function serverPages(pages: string[][]) {
  const calls: { schema: string; table: string; ownerColumn: string; owner: string; after: string; limit: number; filter: string; closed: string[]; orders: unknown[] }[] = [];
  let page = 0;
  const client = { schema: (schema: string) => ({ from: (table: string) => {
    const call = { schema, table, ownerColumn: '', owner: '', after: '', limit: 0, filter: '', closed: [] as string[], orders: [] as unknown[] };
    calls.push(call);
    const query = {
      select: () => query,
      eq: (column: string, owner: string) => { call.ownerColumn = column; call.owner = owner; return query; },
      or: (filter: string) => { call.filter = filter; return query; },
      gt: (_column: string, after: string) => { call.after = after; return query; },
      in: (_column: string, statuses: string[]) => { call.closed = statuses; return query; },
      order: (column: string, options: unknown) => { call.orders.push([column, options]); return query; },
      limit: async (limit: number) => {
        call.limit = limit;
        const ids = call.closed.length ? [] : pages[page++];
        if (!ids) throw new Error('Unexpected continuation after supplied pages');
        return { data: ids.map(id => ({ id, status: 'approved', requester_id: 'actor', updated_at: '2026-09-20' })), error: null };
      },
    };
    return query;
  } }) };
  return { client, calls };
}

it('retains all 104 requests when a database-ordered cursor sorts earlier in JavaScript', async () => {
  // Match the live page boundary without imposing JavaScript order on the second page.
  const first = Array.from({ length: 100 }, (_, i) => `perf-sep12-request-${i + 1}`).sort();
  const second = ['req_9b26a575109949debb74ac92329d71ca', 'UAT-AUG24-REQ-0001', 'UAT-AUG24-REQ-0002', 'UAT-AUG24-REQ-0003'];
  const { client, calls } = serverPages([first, second, []]);
  const result = await readTrackingSource(client as never, 'procurement', 'actor');
  expect(result.errors).toEqual([]);
  expect(result.items).toHaveLength(104);
  expect(new Set(result.items.map(item => item.id))).toEqual(new Set([...first, ...second].map(id => `procurement:${id}`)));
  expect(result.items.every(item => item.bucket === 'waiting')).toBe(true);
  expect(calls.map(call => call.after)).toEqual(['', 'perf-sep12-request-99', 'UAT-AUG24-REQ-0003', '']);
  expect(calls.every(call => call.schema === 'procurement' && call.table === 'requests' && call.ownerColumn === 'requester_id' && call.owner === 'actor' && call.limit === 100)).toBe(true);
  expect(calls.slice(0, 3).every(call => call.filter === 'status.is.null,status.not.in.(rejected,cancelled)')).toBe(true);
  expect(calls.slice(0, 3).map(call => call.orders)).toEqual(Array.from({ length: 3 }, () => [['id', { ascending: true }]]));
  expect(calls[3]).toMatchObject({ closed: ['rejected', 'cancelled'], orders: [['updated_at', { ascending: false, nullsFirst: false }], ['id', { ascending: false }]] });
});

it.each([
  { name: 'immediately repeated', pages: [['cursor-a'], ['cursor-a']] },
  { name: 'previously seen', pages: [['cursor-a'], ['cursor-b'], ['cursor-a']] },
])('rejects a $name cursor without publishing a partial result or continuing the loop', async ({ pages }) => {
  const { client, calls } = serverPages([...pages, []]);
  const result = await readTrackingSource(client as never, 'procurement', 'actor');
  expect(result.items).toEqual([]);
  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]).toContain('Procurement requests tracking unavailable');
  expect(calls).toHaveLength(pages.length);
  expect(calls.every(call => call.closed.length === 0)).toBe(true);
});
