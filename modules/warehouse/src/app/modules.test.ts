import { describe, expect, it } from 'vitest';
import { MODULES, modulesForRole, primaryModulesForRole } from './modules';
import { ROLE_LIST } from '@/auth/roles';

describe('warehouse navigation metadata', () => {
  it('assigns every route to exactly one desktop group', () => {
    expect(MODULES.every((module) => Boolean(module.group))).toBe(true);
    expect(new Set(MODULES.map((module) => module.id)).size).toBe(MODULES.length);
  });

  it('uses the exact logistics mobile primary order', () => {
    expect(primaryModulesForRole('logistics_supervisor').map((module) => module.mobile)).toEqual([
      'home', 'scan', 'tasks', 'inventory',
    ]);
  });

  it('gives every role a Home destination', () => {
    for (const role of ROLE_LIST) {
      expect(primaryModulesForRole(role.id)[0]?.mobile).toBe('home');
    }
  });

  it('shows scan and tasks only to roles with actionable capabilities', () => {
    expect(primaryModulesForRole('business_unit').map((module) => module.id)).not.toContain('scan');
    expect(primaryModulesForRole('business_unit').map((module) => module.id)).not.toContain('tasks');
    expect(primaryModulesForRole('logistics_supervisor').map((module) => module.id)).toEqual(
      expect.arrayContaining(['scan', 'tasks']),
    );
  });

  it('only includes modules authorized for the role', () => {
    const visible = new Set(modulesForRole('operations').map((module) => module.id));
    for (const module of primaryModulesForRole('operations')) expect(visible.has(module.id)).toBe(true);
  });
});
