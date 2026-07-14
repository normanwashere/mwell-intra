import { describe, expect, it } from 'vitest';

import { isWarehouseRole, type Role } from './types';

describe('Warehouse role contract', () => {
  it('accepts canonical roles and preserves legacy aliases', () => {
    const roles: Role[] = [
      'warehouse_operator',
      'warehouse_supervisor',
      'operations',
      'logistics_supervisor',
    ];

    expect(roles.every(isWarehouseRole)).toBe(true);
  });

  it('rejects untrusted role claim values', () => {
    expect(isWarehouseRole('warehouse_operator')).toBe(true);
    expect(isWarehouseRole('platform_admin')).toBe(false);
    expect(isWarehouseRole('made_up_role')).toBe(false);
    expect(isWarehouseRole(null)).toBe(false);
  });
});
