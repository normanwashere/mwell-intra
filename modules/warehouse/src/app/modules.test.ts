import { describe, it, expect } from 'vitest';
import { primaryModulesForRole, modulesForRole } from './modules';

describe('primaryModulesForRole', () => {
  it('keeps Returns and Cycle Counts in the logistics primary nav', () => {
    const ids = primaryModulesForRole('logistics_supervisor').map((m) => m.id);
    expect(ids).toContain('returns');
    expect(ids).toContain('cycle-counts');
    expect(ids.length).toBeLessThanOrEqual(4);
  });

  it('surfaces Returns for operations instead of burying it', () => {
    const ids = primaryModulesForRole('operations').map((m) => m.id);
    expect(ids).toContain('returns');
    expect(ids.length).toBeLessThanOrEqual(4);
  });

  it('only includes modules the role can actually see', () => {
    const visible = new Set(modulesForRole('operations').map((m) => m.id));
    for (const m of primaryModulesForRole('operations')) {
      expect(visible.has(m.id)).toBe(true);
    }
  });

  it('returns all modules when a role has four or fewer', () => {
    const all = modulesForRole('business_unit');
    expect(primaryModulesForRole('business_unit')).toHaveLength(
      Math.min(all.length, 4),
    );
  });
});
