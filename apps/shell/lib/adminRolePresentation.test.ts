import { describe, expect, it } from 'vitest';
import {
  getAdminModulePresentation,
  getAdminRolePresentation,
} from './adminRolePresentation';

describe('admin role presentation', () => {
  it('explains modules as user-facing workspaces', () => {
    expect(getAdminModulePresentation('warehouse')).toMatchObject({
      label: 'Warehouse operations',
      shortLabel: 'Warehouse',
    });
    expect(getAdminModulePresentation('core').label).toBe('Shared access');
  });

  it('clarifies ambiguous and cross-module role labels', () => {
    expect(getAdminRolePresentation('warehouse', 'bi_analyst').label).toBe(
      'Warehouse Inventory Analyst',
    );
    expect(getAdminRolePresentation('warehouse', 'finance').label).toBe(
      'Inventory Finance Reviewer',
    );
    expect(getAdminRolePresentation('procurement', 'finance').label).toBe(
      'Procurement Finance Reviewer',
    );
    expect(getAdminRolePresentation('events', 'finance_reviewer').label).toBe(
      'Event Finance Reviewer',
    );
  });

  it('keeps catalog descriptions while applying clearer labels', () => {
    expect(
      getAdminRolePresentation('warehouse', 'business_unit', {
        label: 'Business Unit',
        description: 'Requests approved inventory for department work.',
      }),
    ).toEqual({
      label: 'Department Inventory Requester',
      description: 'Requests approved inventory for department work.',
    });
  });
});
