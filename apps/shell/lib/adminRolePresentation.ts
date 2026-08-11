import { MODULES, type Module } from '@intra/rbac';
import type { IconName } from '@intra/ui';

export interface AdminModulePresentation {
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly icon: IconName;
}

export interface AdminRolePresentation {
  readonly label: string;
  readonly description: string;
}

export const ADMIN_MODULE_PRESENTATION: Readonly<
  Record<Module, AdminModulePresentation>
> = {
  core: {
    label: 'Shared access',
    shortLabel: 'Shared',
    description:
      'Account-wide access used for administration, internal staff, and the vendor portal.',
    icon: 'shield',
  },
  warehouse: {
    label: 'Warehouse operations',
    shortLabel: 'Warehouse',
    description:
      'Receiving, inventory custody, fulfillment, returns, counts, and replenishment.',
    icon: 'box',
  },
  procurement: {
    label: 'Procurement',
    shortLabel: 'Procurement',
    description:
      'Purchase requests, sourcing, approvals, vendor coordination, and purchase orders.',
    icon: 'cart',
  },
  legal: {
    label: 'Legal & compliance',
    shortLabel: 'Legal',
    description:
      'Vendor accreditation, controlled documents, compliance decisions, and DOA governance.',
    icon: 'signature',
  },
  events: {
    label: 'Events & campaigns',
    shortLabel: 'Events',
    description:
      'Event planning, stock requests, fulfillment handoffs, closure, and settlement.',
    icon: 'calendar',
  },
  insights: {
    label: 'Insights & reporting',
    shortLabel: 'Insights',
    description:
      'Cross-department reporting, operational analysis, executive views, and exports.',
    icon: 'trend',
  },
  product: {
    label: 'Product',
    shortLabel: 'Product',
    description:
      'Launch readiness, pricing proposals, go-live decisions, and Operations handoff.',
    icon: 'tag',
  },
};

const ADMIN_ROLE_LABEL_OVERRIDES: Readonly<Record<string, string>> = {
  'core:staff': 'Internal Staff Baseline',
  'warehouse:bi_analyst': 'Warehouse Inventory Analyst',
  'warehouse:business_unit': 'Department Inventory Requester',
  'warehouse:finance': 'Inventory Finance Reviewer',
  'warehouse:marketing': 'Marketing Inventory Requester',
  'warehouse:operations': 'Operations Inventory Requester',
  'warehouse:procurement': 'Replenishment Planner',
  'warehouse:pricing': 'Inventory Pricing Viewer',
  'procurement:approver': 'Procurement Approver (DOA)',
  'procurement:finance': 'Procurement Finance Reviewer',
  'events:finance_reviewer': 'Event Finance Reviewer',
};

export function getAdminModulePresentation(
  moduleName: Module,
): AdminModulePresentation {
  return ADMIN_MODULE_PRESENTATION[moduleName];
}

export function getAdminRolePresentation(
  moduleName: Module,
  role: string,
  catalog?: {
    readonly label?: string | null;
    readonly description?: string | null;
  },
): AdminRolePresentation {
  const definition = (
    MODULES[moduleName].roles as Readonly<
      Record<string, { readonly label: string; readonly description: string }>
    >
  )[role];
  const key = `${moduleName}:${role}`;

  return {
    label:
      ADMIN_ROLE_LABEL_OVERRIDES[key] ??
      catalog?.label?.trim() ??
      definition?.label ??
      role,
    description:
      catalog?.description?.trim() ||
      definition?.description ||
      'Scoped access for this workspace.',
  };
}
