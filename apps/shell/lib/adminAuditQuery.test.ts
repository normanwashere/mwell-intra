import { describe, expect, it } from 'vitest';
import { AUDIT_BATCH_SIZE, auditPageCsv, parseAuditQuery, readAuditPage, type AuditReader, type AuditRow } from './adminAuditQuery';

const base = parseAuditQuery(new URLSearchParams());
const fixture: AuditRow[] = Array.from({ length: 620 }, (_, index) => ({
  id: 620 - index, module: index % 2 ? 'core' : 'legal', entity_type: 'user',
  entity_id: `ref-${index}`, action: 'updated', actor: index === 500 ? 'older-actor' : 'visible-actor',
  detail: index === 500 ? { reference: 'IAM-OLD-500', text: '%,_.*"),actor.eq.secret' } : {},
  created_at: '2026-09-10T00:00:00Z',
}));
function reader(rows = fixture) {
  const requests: typeof base[] = [];
  const api: AuditReader = {
    events: async query => {
      requests.push(query);
      return rows.filter(row => (!query.module || row.module === query.module) &&
        (query.before === null || row.id < query.before) && (query.snapshot === null || row.id <= query.snapshot)).slice(0, AUDIT_BATCH_SIZE);
    },
    actors: async ids => Object.fromEntries(ids.map(id => [id, id === 'older-actor' ? 'Archived Person | archived@example.test' : 'Visible Person'])),
  };
  return { api, requests };
}

describe('retained authorized audit search', () => {
  it.each(['IAM-OLD-500', 'Archived Person', 'archived@example.test', 'ref-500', '%,_.*"),actor.eq.secret'])('finds %s beyond the first 250 events', async query => {
    const { api, requests } = reader();
    const page = await readAuditPage(api, { ...base, query });
    expect(page.rows.map(row => row.id)).toEqual([120]);
    expect(requests.length).toBeGreaterThan(2);
    expect(page.next).toBeNull();
  });
  it('paginates without duplicates and excludes later inserts via snapshot', async () => {
    const { api } = reader();
    const first = await readAuditPage(api, base);
    expect(first.rows).toHaveLength(50);
    expect(first.next).toBe(571);
    const second = await readAuditPage(reader([{ ...fixture[0]!, id: 999 }, ...fixture]).api,
      { ...base, before: first.next, snapshot: first.snapshot });
    expect(second.rows[0]?.id).toBe(570);
    expect(new Set([...first.rows, ...second.rows].map(row => row.id)).size).toBe(100);
  });
  it('bounds unmatched scans and continues beyond the request budget without false empty', async () => {
    const history = Array.from({ length: 2601 }, (_, i) => ({ ...fixture[0]!, id: 2601 - i, detail: i === 2500 ? { note: 'oldest target' } : {} }));
    const { api, requests } = reader(history);
    const first = await readAuditPage(api, { ...base, query: 'oldest target' });
    expect(first.rows).toEqual([]);
    expect(first.searchPending).toBe(true);
    expect(first.scanned).toBe(2000);
    expect(requests).toHaveLength(8);
    expect(first.next).toBe(602);
    const continued = await readAuditPage(api, { ...base, query: 'oldest target', before: first.next, snapshot: first.snapshot });
    expect(continued.rows.map(row => row.id)).toEqual([101]);
    expect(continued.searchPending).toBe(false);
    expect(continued.next).toBeNull();
  });
  it('never widens the authorized reader scope to find a hidden event', async () => {
    const page = await readAuditPage(reader(fixture.filter(row => row.actor !== 'older-actor')).api, { ...base, query: 'IAM-OLD-500' });
    expect(page.rows).toEqual([]);
    expect(page.actors).toEqual({});
  });
  it('does not convert an actor-read failure or later batch failure into empty history', async () => {
    const { api } = reader();
    await expect(readAuditPage({ ...api, actors: async () => { throw new Error('actor denied'); } }, base)).rejects.toThrow('actor denied');
    await expect(readAuditPage({ ...api, events: async query => {
      if (query.before !== null) throw new Error('timeout');
      return api.events(query);
    } }, { ...base, query: 'old' })).rejects.toThrow('timeout');
  });
  it('exports only this page, quotes CSV, and neutralizes formulas', async () => {
    const page = await readAuditPage(reader([{ ...fixture[0]!, action: '=2+2', entity_id: 'a,"b' }]).api, base);
    const csv = auditPageCsv(page);
    expect(csv.split('\r\n')).toHaveLength(2);
    expect(csv).toContain('"\'=2+2"');
    expect(csv).toContain('a,""b');
  });
  it.each(['before=-1', 'snapshot=1%29%2Cor%28id.gt.0', 'before=9007199254740992', 'from=2026-02-30', 'from=2026-09-12&to=2026-09-01', `q=${'x'.repeat(201)}`])('rejects invalid filter %s', value => {
    expect(() => parseAuditQuery(new URLSearchParams(value))).toThrow();
  });
});
