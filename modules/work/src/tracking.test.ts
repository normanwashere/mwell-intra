import { describe, expect, it, vi } from 'vitest';
import { projectTrackingRows, TRACKING_LIMIT } from './tracking';

vi.mock('@intra/auth', () => ({ useSession: vi.fn() }));

const row = (status: unknown, extra = {}) => ({
  id: 'request/one', title: 'My purchase', purpose: 'Department supplies',
  requester_id: 'actor', requested_by: 'actor', status,
  updated_at: '2026-09-11T10:00:00Z', requested_at: '2026-09-10T10:00:00Z', ...extra,
});

describe('owner-only tracking projection', () => {
  it.each(['procurement', 'warehouse'] as const)('rejects foreign, missing-owner and malformed %s records', source => {
    const foreign = { requester_id: 'other', requested_by: 'other' };
    const missing = { requester_id: undefined, requested_by: undefined };
    expect(projectTrackingRows(source, [null, [], 'bad', row('approved', foreign), row('approved', missing), row('approved', { id: '' }), row('approved')], 'actor')).toHaveLength(1);
    expect(projectTrackingRows(source, [row('approved')], '')).toEqual([]);
  });

  it.each(['issued', 'released', 'approved', 'allocated', 'paid', 'completed', 'future_state', null, 'constructor', '__proto__'])('does not infer completion from %s', status => {
    for (const source of ['procurement', 'warehouse'] as const) {
      expect(projectTrackingRows(source, [row(status)], 'actor')[0]!.bucket).not.toBe('completed');
    }
  });

  it.each(['procurement', 'warehouse'] as const)('describes final %s rejection/cancellation without claiming fulfillment', source => {
    for (const status of ['rejected', 'cancelled']) {
      const item = projectTrackingRows(source, [row(status)], 'actor')[0]!;
      expect(item.bucket).toBe('completed');
      expect(item.nextStep).toContain('not proof of fulfillment');
      expect(item.status.toLowerCase()).toContain(status);
    }
  });

  it('accepts only the warehouse closed contract, not an unknown procurement closed status', () => {
    const warehouse = projectTrackingRows('warehouse', [row('closed')], 'actor')[0]!;
    expect(warehouse.bucket).toBe('completed');
    expect(warehouse.nextStep).toContain('receipt evidence');
    expect(projectTrackingRows('procurement', [row('closed')], 'actor')[0]).toMatchObject({ bucket: 'action', status: 'Unknown request status: closed' });
  });

  it('uses encoded source links and never relies on a row-supplied href or owner', () => {
    const input = row('approved', { href: 'https://evil.example', owner: 'Other person' });
    expect(projectTrackingRows('procurement', [input], 'actor')[0]).toMatchObject({
      id: 'procurement:request/one', source: 'procurement', title: 'My purchase',
      href: '/procurement/requests/request%2Fone', owner: 'Procurement', updatedAt: input.updated_at,
    });
    const warehouse = projectTrackingRows('warehouse', [input], 'actor')[0]!;
    expect(warehouse.href).toBe('/warehouse/fulfillment?tab=requests&request=request%2Fone');
    expect(warehouse.title).toBe('Department supplies');
    expect(warehouse.updatedAt).toBeUndefined();
  });

  it('sorts newest first with stable ID ties without dropping cursor-loaded open rows', () => {
    const rows = Array.from({ length: TRACKING_LIMIT + 5 }, (_, i) => row('draft', { id: String(i).padStart(3, '0') }));
    const projected = projectTrackingRows('procurement', rows, 'actor');
    expect(projected).toHaveLength(TRACKING_LIMIT + 5);
    expect(projected[0]!.id).toBe('procurement:104');
    const sorted = projectTrackingRows('procurement', [row('draft', { id: 'old', updated_at: 'bad' }), row('draft', { id: 'new' })], 'actor');
    expect(sorted.map(item => item.id)).toEqual(['procurement:new', 'procurement:old']);
    expect(sorted[1]!.updatedAt).toBeUndefined();
  });

  it('keeps three older approved requests reachable behind 120 newer drafts', () => {
    const rows = Array.from({ length: 120 }, (_, i) => row('draft', { id: `draft-${i}` }));
    rows.push(...Array.from({ length: 3 }, (_, i) => row('approved', { id: `august-${i}`, updated_at: '2026-08-24T00:00:00Z' })));
    expect(projectTrackingRows('procurement', rows, 'actor').filter(item => item.bucket === 'waiting')).toHaveLength(3);
  });

  it.each(['procurement', 'warehouse'] as const)('puts %s drafts and unknown states in own action, not waiting on another person', source => {
    for (const status of ['draft', 'future_state', '', null]) {
      expect(projectTrackingRows(source, [row(status)], 'actor')[0]).toMatchObject({ bucket: 'action', owner: 'Requester' });
    }
  });

  it('keeps issued stock waiting with an unverified receipt label and no named assignee', () => {
    expect(projectTrackingRows('warehouse', [row('issued')], 'actor')[0]).toMatchObject({
      bucket: 'waiting', status: 'Issued; receipt unverified', owner: 'Warehouse / recipient',
    });
  });
});
