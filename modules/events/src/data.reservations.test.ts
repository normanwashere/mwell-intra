import { expect, it } from 'vitest';
import { loadLiveEvents } from './data';

type Row = Record<string, unknown>;
function fixture({ activeRows = [{ id: 'master-allocation', event_id: 'shared-event', quantity: 1, status: 'reserved' }],
  pageSize = 1000, fail = false, events = [{ id: 'shared-event', name: 'Shared event', start_date: '2026-08-24' }] }:
  { activeRows?: Row[]; pageSize?: number; fail?: boolean; events?: Row[] } = {}) {
  const history = {
    allocations: [{ id: 'sample-allocation', event_id: 'shared-event', quantity: 10, status: 'reserved' }, ...activeRows],
    totals: [{ event_id: 'shared-event', reserved_units: 11, issued_units: 4, returned_units: 1, outstanding_units: 3 }],
  };
  const before = JSON.stringify(history);
  const reads: string[] = [];
  const eventFilters: string[][] = [];
  const client = { schema: () => ({ from: (table: string) => {
    reads.push(table);
    let rows: Row[] = table === 'events' ? events
      : table === 'event_custody_totals' ? history.totals
        : table === 'active_allocations' ? activeRows : [];
    const query = {
      select: () => query,
      order: () => query,
      eq: () => query,
      in: (key: string, values: string[]) => {
        if (table === 'active_allocations' && key === 'event_id') eventFilters.push(values);
        rows = rows.filter(row => values.includes(String(row[key]))); return query;
      },
      gt: (key: string, value: string) => { rows = rows.filter(row => String(row[key]) > value); return query; },
      limit: async (limit: number) => ({ data: rows.slice(0, table === 'active_allocations' ? Math.min(limit, pageSize) : limit),
        error: fail && table === 'active_allocations' ? { message: 'Archive view unavailable' } : null }),
    };
    return query;
  } }) };
  return { client, reads, history, before, eventFilters };
}

it('excludes the archived ten from active reservations without rewriting lifetime custody or raw history', async () => {
  const f = fixture(); const result = await loadLiveEvents(f.client as never);
  expect(result.events[0]).toMatchObject({ id: 'shared-event', reservedUnits: 1, issuedUnits: 4, returnedUnits: 1 });
  expect(JSON.stringify(f.history)).toBe(f.before);
  expect(f.reads).toContain('event_custody_totals');
  expect(f.reads).toContain('active_allocations');
  expect(f.reads).not.toContain('allocations');
  expect(f.eventFilters.every(ids => ids.length === 1 && ids[0] === 'shared-event')).toBe(true);
  expect(f.eventFilters).toHaveLength(2);
});

it('paginates active reservations even when the server caps pages below the requested size', async () => {
  const f = fixture({ pageSize: 2, activeRows: [
    { id: 'a1', event_id: 'shared-event', quantity: 1, status: 'reserved' },
    { id: 'a2', event_id: 'shared-event', quantity: 2, status: 'allocated' },
    { id: 'a3', event_id: 'shared-event', quantity: 3, status: 'reserved' },
    { id: 'a4', event_id: 'other-event', quantity: 20, status: 'reserved' },
    { id: 'a5', event_id: 'shared-event', quantity: 99, status: 'issued' },
    { id: 'a6', event_id: 'shared-event', quantity: 99, status: 'cancelled' },
  ] });
  expect((await loadLiveEvents(f.client as never)).events[0]).toMatchObject({ reservedUnits: 6, issuedUnits: 4, returnedUnits: 1 });
  expect(f.reads.filter(table => table === 'active_allocations')).toHaveLength(3);
});

it('shows zero active reservations when all reservations are archived, retaining issued and returned history', async () => {
  const f = fixture({ activeRows: [] });
  expect((await loadLiveEvents(f.client as never)).events[0]).toMatchObject({ reservedUnits: 0, issuedUnits: 4, returnedUnits: 1 });
  expect(JSON.stringify(f.history)).toBe(f.before);
});

it('fails the summary read instead of falling back to raw or invented zero reservations', async () => {
  const f = fixture({ fail: true });
  await expect(loadLiveEvents(f.client as never)).rejects.toThrow('Event reservations unavailable: Archive view unavailable');
});
it('does not query tenant reservations when no events are visible', async () => {
  const f = fixture({ events: [] });
  expect((await loadLiveEvents(f.client as never)).events).toEqual([]);
  expect(f.reads).not.toContain('active_allocations');
});
it('bounds reservation filters to small batches of loaded event IDs', async () => {
  const events = Array.from({ length: 101 }, (_, i) => ({ id: `event-${i}`, start_date: '2026-08-24' }));
  const f = fixture({ events, activeRows: [] });
  await loadLiveEvents(f.client as never);
  expect(f.eventFilters.map(ids => ids.length)).toEqual([50, 50, 1]);
  expect(f.eventFilters.flat()).toEqual(events.map(e => e.id));
});
