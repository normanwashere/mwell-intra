import { describe, expect, it } from 'vitest';
import {
  MODULES,
  MODULE_LIST,
  can,
  emptyUserRoles,
  hasCapInModule,
  listModuleRoles,
  roleCapabilities,
  toRoleCapabilityRows,
  warehouseModule,
  type UserRoles,
} from './index';

describe('warehouse parity vs source roles.ts', () => {
  it('has the 8 source roles', () => {
    expect(Object.keys(warehouseModule.roles).sort()).toEqual(
      [
        'bi_analyst',
        'business_unit',
        'finance',
        'logistics_supervisor',
        'marketing',
        'operations',
        'pricing',
        'procurement',
      ].sort(),
    );
  });

  it('has the 15 source capabilities', () => {
    expect(warehouseModule.capabilities).toHaveLength(15);
    expect([...warehouseModule.capabilities].sort()).toEqual(
      [
        'view_dashboard',
        'receive_stock',
        'manage_inventory',
        'manage_products',
        'manage_locations',
        'cycle_count',
        'manage_returns',
        'reserve_allocate',
        'issue_items',
        'transfer_stock',
        'view_finance',
        'view_analytics',
        'view_procurement',
        'view_pricing',
        'set_pricing',
      ].sort(),
    );
  });

  // Exact capability sets copied from mwell-intra-warehouse src/auth/roles.ts.
  const EXPECTED: Record<string, string[]> = {
    logistics_supervisor: [
      'view_dashboard',
      'manage_inventory',
      'receive_stock',
      'manage_products',
      'manage_locations',
      'cycle_count',
      'manage_returns',
      'issue_items',
      'transfer_stock',
    ],
    operations: [
      'view_dashboard',
      'manage_inventory',
      'reserve_allocate',
      'issue_items',
      'manage_returns',
      'transfer_stock',
    ],
    finance: ['view_dashboard', 'manage_inventory', 'view_finance', 'cycle_count'],
    bi_analyst: ['view_dashboard', 'manage_inventory', 'view_analytics'],
    business_unit: ['view_dashboard', 'manage_inventory', 'reserve_allocate'],
    marketing: [
      'view_dashboard',
      'manage_inventory',
      'reserve_allocate',
      'manage_returns',
    ],
    procurement: [
      'view_dashboard',
      'manage_inventory',
      'view_procurement',
      'manage_products',
    ],
    pricing: [
      'view_dashboard',
      'manage_inventory',
      'view_pricing',
      'set_pricing',
      'view_finance',
    ],
  };

  it.each(Object.entries(EXPECTED))(
    'role %s grants exactly the source capabilities',
    (role, caps) => {
      const roleDef = Object.entries(warehouseModule.roles).find(
        ([name]) => name === role,
      )?.[1];
      expect(roleDef).toBeDefined();
      expect([...(roleDef?.capabilities ?? [])].sort()).toEqual([...caps].sort());
    },
  );
});

describe('can() — capability checks', () => {
  const roles: UserRoles = {
    ...emptyUserRoles(),
    warehouse: ['logistics_supervisor'],
  };

  it('grants a capability the role has', () => {
    expect(can(roles, 'warehouse', 'receive_stock')).toBe(true);
    expect(can(roles, 'warehouse', 'view_dashboard')).toBe(true);
  });

  it('denies a capability the role lacks', () => {
    expect(can(roles, 'warehouse', 'set_pricing')).toBe(false);
    expect(can(roles, 'warehouse', 'view_analytics')).toBe(false);
  });

  it('unions capabilities across multiple roles in the same module', () => {
    const multi: UserRoles = {
      ...emptyUserRoles(),
      warehouse: ['bi_analyst', 'pricing'],
    };
    expect(can(multi, 'warehouse', 'view_analytics')).toBe(true); // from bi_analyst
    expect(can(multi, 'warehouse', 'set_pricing')).toBe(true); // from pricing
    expect(can(multi, 'warehouse', 'receive_stock')).toBe(false); // neither
  });
});

describe('can() — per-module scoping (spec §4.2)', () => {
  // A user with different roles per module.
  const roles: UserRoles = {
    core: ['staff'],
    warehouse: ['logistics_supervisor'],
    procurement: ['approver'],
    legal: [],
  };

  it('applies warehouse roles only in the warehouse module', () => {
    expect(can(roles, 'warehouse', 'receive_stock')).toBe(true);
    // receive_stock is a warehouse capability; procurement scope must not grant it.
    expect(can(roles, 'procurement', 'approve_award')).toBe(true);
    expect(can(roles, 'procurement', 'author_po')).toBe(false); // approver can't author
  });

  it('does not leak capabilities across modules', () => {
    // The user is an approver in procurement but holds no legal role.
    expect(can(roles, 'legal', 'approve_accreditation')).toBe(false);
    expect(can(roles, 'legal', 'review_accreditation')).toBe(false);
  });

  it('returns false for a module the user has no roles in', () => {
    const partial: Partial<UserRoles> = { warehouse: ['finance'] };
    expect(can(partial, 'procurement', 'view_dashboard')).toBe(false);
    expect(can(partial, 'legal', 'view_dashboard')).toBe(false);
  });

  it('handles empty/partial UserRoles safely', () => {
    expect(can({}, 'warehouse', 'view_dashboard')).toBe(false);
    expect(can(emptyUserRoles(), 'warehouse', 'view_dashboard')).toBe(false);
  });
});

describe('hasCapInModule()', () => {
  it('checks a concrete role directly', () => {
    expect(hasCapInModule('warehouse', 'pricing', 'set_pricing')).toBe(true);
    expect(hasCapInModule('warehouse', 'pricing', 'receive_stock')).toBe(false);
  });

  it('returns false for an unknown role', () => {
    expect(hasCapInModule('warehouse', 'ghost_role', 'view_dashboard')).toBe(
      false,
    );
  });

  it('respects the external vendor tier in legal', () => {
    expect(hasCapInModule('legal', 'vendor', 'upload_document')).toBe(true);
    expect(hasCapInModule('legal', 'vendor', 'approve_accreditation')).toBe(
      false,
    );
  });
});

describe('provisional procurement/legal/core matrices', () => {
  it('exposes the chosen procurement roles', () => {
    expect(listModuleRoles('procurement').sort()).toEqual(
      ['admin', 'approver', 'finance', 'procurement_officer', 'requester'].sort(),
    );
    expect(MODULES.procurement.provisional).toBe(true);
  });

  it('exposes the chosen legal roles incl. vendor tier', () => {
    expect(listModuleRoles('legal').sort()).toEqual(
      ['admin', 'compliance', 'legal_reviewer', 'vendor'].sort(),
    );
    expect(MODULES.legal.provisional).toBe(true);
  });

  it('exposes the core foundation roles', () => {
    expect(listModuleRoles('core').sort()).toEqual(
      ['platform_admin', 'staff', 'vendor_portal'].sort(),
    );
  });
});

describe('toRoleCapabilityRows() — DB seed shape', () => {
  const rows = toRoleCapabilityRows();

  it('matches the pre-computed roleCapabilities export', () => {
    expect(rows).toEqual(roleCapabilities);
  });

  it('emits { module, role, cap } rows for every module', () => {
    for (const row of rows) {
      expect(row).toEqual({
        module: expect.any(String),
        role: expect.any(String),
        cap: expect.any(String),
      });
      expect(MODULE_LIST).toContain(row.module);
    }
  });

  it('orders core first (matches migration order)', () => {
    expect(rows[0]?.module).toBe('core');
  });

  it('contains no duplicate (module, role, cap) grants', () => {
    const keys = rows.map((r) => `${r.module}/${r.role}/${r.cap}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('accounts for every declared grant across all modules', () => {
    const declared = MODULE_LIST.reduce((sum, module) => {
      const definition = MODULES[module];
      return (
        sum +
        Object.values(definition.roles).reduce(
          (n, role) => n + role.capabilities.length,
          0,
        )
      );
    }, 0);
    expect(rows).toHaveLength(declared);
  });

  it('includes the canonical warehouse grants (e.g. logistics_supervisor/receive_stock)', () => {
    expect(rows).toContainEqual({
      module: 'warehouse',
      role: 'logistics_supervisor',
      cap: 'receive_stock',
    });
  });
});
