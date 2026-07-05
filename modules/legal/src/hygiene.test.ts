// Specs for demo-data hygiene (F1.2): vendorId-collision detection is
// deterministic, idempotent, keeps the oldest case, reassigns via invites,
// and drops unrecoverable rows.

import { describe, expect, it } from 'vitest';
import type { AccreditationCase, VendorInvite } from './types';
import { cleanupCases } from './hygiene';

function kase(over: Partial<AccreditationCase>): AccreditationCase {
  return {
    id: 'case_x',
    vendorId: 'ven-acme',
    vendorName: 'Acme Medical Supplies, Inc.',
    status: 'submitted',
    openedAt: '2026-07-01T00:00:00.000Z',
    ...over,
  };
}

function invite(over: Partial<VendorInvite>): VendorInvite {
  return {
    id: 'inv_1',
    email: 'hello@thames.co.uk',
    companyName: 'Thames Digital Systems Ltd.',
    createdAt: '2026-07-02T00:00:00.000Z',
    status: 'sent',
    ...over,
  };
}

const acme = kase({ id: 'case_acme', openedAt: '2026-06-01T00:00:00.000Z' });
const thamesOnAcme = kase({
  id: 'case_thames',
  vendorName: 'Thames Digital Systems Ltd.',
  openedAt: '2026-07-03T00:00:00.000Z',
});

describe('cleanupCases', () => {
  it('leaves consistent data untouched (changed=false)', () => {
    const other = kase({ id: 'case_2', vendorId: 'ven-inv_9', vendorName: 'Other Co.' });
    const result = cleanupCases([acme, other], []);
    expect(result.changed).toBe(false);
    expect(result.cases).toEqual([acme, other]);
  });

  it('keeps the oldest case on a contested vendorId', () => {
    const result = cleanupCases([thamesOnAcme, acme], []);
    expect(result.cases.map((c) => c.id)).toContain('case_acme');
    expect(result.cases.find((c) => c.id === 'case_acme')!.vendorId).toBe('ven-acme');
  });

  it('reassigns the contaminated case to its invite\u2019s ven-<inviteId>', () => {
    const result = cleanupCases([acme, thamesOnAcme], [invite({})]);
    const thames = result.cases.find((c) => c.id === 'case_thames');
    expect(thames?.vendorId).toBe('ven-inv_1');
    expect(result.reassigned.map((c) => c.id)).toEqual(['case_thames']);
    expect(result.dropped).toHaveLength(0);
  });

  it('drops the contaminated case when no matching invite exists', () => {
    const result = cleanupCases([acme, thamesOnAcme], []);
    expect(result.cases.map((c) => c.id)).toEqual(['case_acme']);
    expect(result.dropped.map((c) => c.id)).toEqual(['case_thames']);
  });

  it('is idempotent: a second pass over the output changes nothing', () => {
    const first = cleanupCases([acme, thamesOnAcme], [invite({})]);
    expect(first.changed).toBe(true);
    const second = cleanupCases(first.cases, [invite({})]);
    expect(second.changed).toBe(false);
    expect(second.cases).toEqual(first.cases);
  });

  it('is deterministic on openedAt ties (id tie-break)', () => {
    const a = kase({ id: 'case_a', vendorName: 'A Co.', openedAt: '2026-07-01T00:00:00.000Z' });
    const b = kase({ id: 'case_b', vendorName: 'B Co.', openedAt: '2026-07-01T00:00:00.000Z' });
    const r1 = cleanupCases([a, b], []);
    const r2 = cleanupCases([b, a], []);
    expect(r1.cases.map((c) => c.id)).toEqual(['case_a']);
    expect(r2.cases.map((c) => c.id).sort()).toEqual(['case_a']);
  });

  it('picks the newest invite when several match the company', () => {
    const older = invite({ id: 'inv_old', createdAt: '2026-06-01T00:00:00.000Z' });
    const newer = invite({ id: 'inv_new', createdAt: '2026-07-04T00:00:00.000Z' });
    const result = cleanupCases([acme, thamesOnAcme], [older, newer]);
    expect(result.cases.find((c) => c.id === 'case_thames')?.vendorId).toBe('ven-inv_new');
  });
});
