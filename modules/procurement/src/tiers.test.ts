import { describe, expect, it } from 'vitest';
import { canEnterProcurement, resolveTiers } from './tiers';

describe('resolveTiers', () => {
  it('maps legal:legal_reviewer to the Legal tier with no procurement role (PR-11)', () => {
    expect(resolveTiers({ legal: ['legal_reviewer'] })).toEqual(['legal']);
  });

  it('maps procurement roles onto their ladder tiers', () => {
    expect(resolveTiers({ procurement: ['approver'] })).toEqual(['dept_head']);
    expect(resolveTiers({ procurement: ['procurement_officer'] })).toEqual([
      'procurement_head',
    ]);
    expect(resolveTiers({ procurement: ['finance'] })).toEqual(['finance']);
  });

  it('procurement:admin covers procurement_head + final_approver', () => {
    const tiers = resolveTiers({ procurement: ['admin'] });
    expect(tiers).toContain('procurement_head');
    expect(tiers).toContain('final_approver');
    expect(tiers).toHaveLength(2);
  });

  it('warehouse:finance is the legacy fallback for the finance tier', () => {
    expect(resolveTiers({ warehouse: ['finance'] })).toEqual(['finance']);
  });

  it('does not grant department approval authority to platform administrators', () => {
    expect(resolveTiers({ core: ['platform_admin'] })).toEqual([]);
  });

  it('returns [] for empty / null / role-less sessions', () => {
    expect(resolveTiers(null)).toEqual([]);
    expect(resolveTiers(undefined)).toEqual([]);
    expect(resolveTiers({ core: ['staff'] })).toEqual([]);
    expect(resolveTiers({ warehouse: ['logistics_supervisor'] })).toEqual([]);
  });
});

describe('canEnterProcurement (module gate, PR-11)', () => {
  it('admits any procurement role holder', () => {
    expect(canEnterProcurement({ procurement: ['requester'] })).toBe(true);
    expect(canEnterProcurement({ procurement: ['procurement_officer'] })).toBe(true);
  });

  it('admits tier-eligible users without a procurement role (Andre the legal reviewer)', () => {
    expect(canEnterProcurement({ legal: ['legal_reviewer'], core: ['staff'] })).toBe(true);
    expect(canEnterProcurement({ core: ['platform_admin'] })).toBe(false);
    expect(canEnterProcurement({ warehouse: ['finance'] })).toBe(true);
  });

  it('rejects users with neither a procurement role nor a tier', () => {
    expect(canEnterProcurement({ core: ['staff'] })).toBe(false);
    expect(canEnterProcurement({ warehouse: ['operations'] })).toBe(false);
    expect(canEnterProcurement(null)).toBe(false);
    expect(canEnterProcurement(undefined)).toBe(false);
  });
});
