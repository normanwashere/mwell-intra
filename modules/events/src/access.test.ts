import { describe, expect, it } from 'vitest';
import type { UserRoles } from '@intra/rbac';
import {
  canAccessEvents,
  canApproveEventSettlement,
  canManageEvents,
} from './access';

describe('event settlement access', () => {
  it('gives the narrow Finance reviewer read and approval access only', () => {
    const roles = { events: ['finance_reviewer'] } satisfies Partial<UserRoles>;
    expect(canAccessEvents(roles)).toBe(true);
    expect(canApproveEventSettlement(roles)).toBe(true);
    expect(canManageEvents(roles)).toBe(false);
  });

  it('does not infer settlement approval from read-only Finance access', () => {
    expect(canApproveEventSettlement({ warehouse: ['pricing'] })).toBe(false);
    expect(canApproveEventSettlement({ warehouse: ['finance'] })).toBe(false);
    expect(canApproveEventSettlement({ procurement: ['finance'] })).toBe(false);
  });
});
