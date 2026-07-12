import { describe, expect, it } from 'vitest';
import { can, warehouseModule, type UserRoles } from '../index';

const roles = (warehouse: string[]): UserRoles => ({
  core: [],
  warehouse,
  procurement: [],
  legal: [],
});

describe('warehouse W1 capabilities', () => {
  it('adds the Warehouse Administrator role', () => {
    expect(Object.keys(warehouseModule.roles)).toContain('warehouse_admin');
    expect(warehouseModule.roles.warehouse_admin.capabilities).toEqual(
      warehouseModule.capabilities,
    );
  });

  it('allows logistics to inspect, release, resolve, import, and route', () => {
    const user = roles(['logistics_supervisor']);
    expect(can(user, 'warehouse', 'inspect_quality')).toBe(true);
    expect(can(user, 'warehouse', 'release_quality_hold')).toBe(true);
    expect(can(user, 'warehouse', 'approve_stock_adjustment')).toBe(true);
    expect(can(user, 'warehouse', 'view_exceptions')).toBe(true);
    expect(can(user, 'warehouse', 'resolve_exceptions')).toBe(true);
    expect(can(user, 'warehouse', 'import_warehouse_data')).toBe(true);
    expect(can(user, 'warehouse', 'manage_operation_routes')).toBe(true);
  });

  it('allows Operations to inspect and view but not release holds', () => {
    const user = roles(['operations']);
    expect(can(user, 'warehouse', 'inspect_quality')).toBe(true);
    expect(can(user, 'warehouse', 'view_exceptions')).toBe(true);
    expect(can(user, 'warehouse', 'release_quality_hold')).toBe(false);
    expect(can(user, 'warehouse', 'resolve_exceptions')).toBe(false);
  });

  it('allows Finance to approve and BI to view without control access', () => {
    const finance = roles(['finance']);
    const bi = roles(['bi_analyst']);
    expect(can(finance, 'warehouse', 'approve_stock_adjustment')).toBe(true);
    expect(can(finance, 'warehouse', 'release_quality_hold')).toBe(false);
    expect(can(bi, 'warehouse', 'view_exceptions')).toBe(true);
    expect(can(bi, 'warehouse', 'resolve_exceptions')).toBe(false);
  });

  it('does not grant import access to a Business Unit user', () => {
    expect(can(roles(['business_unit']), 'warehouse', 'import_warehouse_data')).toBe(false);
  });

  it('does not infer Warehouse access from Core Platform Admin', () => {
    expect(
      can(
        {
          core: ['platform_admin'],
          warehouse: [],
          procurement: [],
          legal: [],
        },
        'warehouse',
        'manage_operation_routes',
      ),
    ).toBe(false);
  });
});
