import { expect, it } from 'vitest';
import { readRequestListRows } from './requestListRead';
import { filterRequests, readRequestList } from './requestList';

it('searches beyond server and display pages using only RLS-backed request/PO projections', async () => {
  const rows = Array.from({ length: 123 }, (_, i) => ({ id: `request-${String(i).padStart(3, '0')}`, title: 'Request', status: i < 120 ? 'draft' : 'approved', requester_id: 'actor', created_at: '2026-08-24', lines: [], purchase_orders: i === 122 ? [{ po_number: 'PO-0001' }] : [] }));
  const calls: { schema: string; table: string; columns: string; after: string; limit: number }[] = [];
  const client = { schema: (schema: string) => ({ from: (table: string) => {
    const call = { schema, table, columns: '', after: '', limit: 0 }; calls.push(call);
    const query = { select: (columns: string) => { call.columns = columns; return query; }, order: () => query,
      gt: (_key: string, after: string) => { call.after = after; return query; },
      limit: async (limit: number) => { call.limit = limit; return { data: rows.filter(row => row.id > call.after).slice(0, 17), error: null }; },
    }; return query;
  } }) };
  const result = await readRequestListRows(client as never);
  expect(result).toHaveLength(123);
  expect(filterRequests(result, readRequestList(new URLSearchParams('q=PO+0001')), 'actor').map(row => row.id)).toEqual(['request-122']);
  expect(calls.every(call => call.schema === 'procurement' && call.table === 'requests' && call.limit === 100 && call.columns.includes('purchase_orders(id,po_number)'))).toBe(true);
  expect(calls.at(-1)?.after).toBe('request-122');
});
it('fails explicitly on a non-advancing cursor instead of returning silently truncated search results', async () => {
  const query = { select: () => query, order: () => query, gt: () => query, limit: async () => ({ data: [{ id: 'same', status: 'draft', title: 'Same', created_at: '2026-09-20' }], error: null }) };
  await expect(readRequestListRows({ schema: () => ({ from: () => query }) } as never)).rejects.toThrow('cursor');
});
