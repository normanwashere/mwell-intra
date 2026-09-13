import { describe, expect, it } from 'vitest';
import { capabilityClassificationFor, roleCapabilities } from './index';

// Exact grants introduced by the July 21 and August 13 authority migrations.
// Keep this expectation independent of the generated role catalogue.
const expected: Record<string, string[]> = {
  'warehouse:register_exports': ['bi_analyst', 'finance', 'operations'],
  'warehouse:review_exports': ['finance'],
  'warehouse:recommend_replenishment': ['operations'],
  'warehouse:submit_return_case': ['logistics_supervisor', 'operations', 'warehouse_admin', 'warehouse_operator', 'warehouse_supervisor'],
  'procurement:manage_replenishment': ['admin', 'procurement_officer'],
  'procurement:cancel_purchase_order': ['admin', 'procurement_officer'],
};

describe('migration-defined warehouse handoff authority', () => {
  it.each(Object.entries(expected))('%s preserves the exact existing role grant set', (key, roles) => {
    const [module, cap] = key.split(':');
    expect(roleCapabilities.filter(row => row.module === module && row.cap === cap)
      .map(row => row.role).sort()).toEqual(roles);
  });

  it('classifies all migration-defined commands as governed mutations', () => {
    for (const key of Object.keys(expected)) {
      const [module, cap] = key.split(':') as ['warehouse' | 'procurement', string];
      expect(capabilityClassificationFor(module, cap)?.access).toBe('mutation');
    }
  });
});
