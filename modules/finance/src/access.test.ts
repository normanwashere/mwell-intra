import { describe, expect, it } from 'vitest';
import { canAccessFinanceRoles, canManageFinanceCloseRoles } from './access';

describe('canAccessFinanceRoles', () => {
  it('accepts either scoped Finance role and their combination', () => {
    expect(canAccessFinanceRoles({ warehouse: ['finance'] })).toBe(true);
    expect(canAccessFinanceRoles({ procurement: ['finance'] })).toBe(true);
    expect(
      canAccessFinanceRoles({
        warehouse: ['finance'],
        procurement: ['finance'],
      }),
    ).toBe(true);
  });

  it('does not treat unrelated module roles as Finance', () => {
    expect(
      canAccessFinanceRoles({
        warehouse: ['operations'],
        procurement: ['requester'],
      }),
    ).toBe(false);
  });
});

describe('canManageFinanceCloseRoles', () => {
  it('allows the Warehouse Finance controller role', () => {
    expect(canManageFinanceCloseRoles({ warehouse: ['finance'] })).toBe(true);
  });

  it('keeps read-only and procurement-only Finance access outside close mutations', () => {
    expect(canManageFinanceCloseRoles({ warehouse: ['pricing'] })).toBe(false);
    expect(canManageFinanceCloseRoles({ procurement: ['finance'] })).toBe(false);
  });
});
