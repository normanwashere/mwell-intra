import { describe, expect, it } from 'vitest';
import { canAccessFinanceRoles } from './access';

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
