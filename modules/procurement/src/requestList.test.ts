import { describe, expect, it } from 'vitest';
import { filterRequests, readRequestList, requestDetailPath, requestReturnPath } from './requestList';
import type { ProcurementRequest } from './types';

const row = (id: string, extra = {}) => ({ id, title: id, status: 'approved', createdAt: '2026-08-24', requesterId: 'actor', vendorName: 'Vendor One', lines: [], approvalSteps: [], ...extra }) as ProcurementRequest;
describe('request list context and full-record search', () => {
  it('finds an older visible PO reference independently of display continuation', () => {
    const old = row('old', { references: ['PO-0001'] });
    const rows = [...Array.from({ length: 120 }, (_, i) => row(`draft-${i}`, { status: 'draft' })), old];
    expect(filterRequests(rows, readRequestList(new URLSearchParams('q=PO+0001&filter=approved')), 'actor')).toEqual([old]);
    expect(filterRequests(rows, readRequestList(new URLSearchParams('q=vendor+one&filter=approved&owner=mine&from=2026-08-01&to=2026-08-31')), 'other')).toEqual([]);
  });
  it('preserves only supported list context in exact deep links and return paths', () => {
    const params = new URLSearchParams('q=0001&filter=approved&owner=mine&from=2026-08-01&to=2026-09-01&sort=createdAt&dir=desc&shown=100&uat=1&records=all&evil=https://evil.test');
    const path = requestDetailPath('id/with slash', params);
    expect(path).toContain('/requests/id%2Fwith%20slash?');
    const back = requestReturnPath(path.slice(path.indexOf('?')));
    const restored = readRequestList(new URLSearchParams(back.slice(back.indexOf('?'))));
    expect(restored).toEqual(readRequestList(params));
    expect(back).not.toContain('evil');
    expect(requestReturnPath('?returnTo=https://evil.test')).toBe('/procurement');
  });
  it('clamps malformed filters, dates and huge display counts', () => {
    expect(readRequestList(new URLSearchParams('filter=constructor&sort=__proto__&from=2026-99-99&shown=Infinity'))).toMatchObject({ filter: 'all', sort: 'createdAt', from: '', shown: 50, records: 'all' });
    expect(readRequestList(new URLSearchParams('uat=1')).records).toBe('operational');
  });
});
