import type { ModuleDefinition } from '../contracts';

// Warehouse module RBAC — ported faithfully from the source single-scope model
// in mwell-intra-warehouse `src/auth/roles.ts` (8 roles, 15 capabilities).
// This is the CANONICAL matrix and must stay in sync with warehouse RPC guards
// and `core.role_capabilities` (spec §6.6).

/** The 15 warehouse capabilities (verbatim from source `roles.ts`). */
export type WarehouseCapability =
  | 'view_dashboard'
  | 'receive_stock'
  | 'manage_inventory'
  | 'manage_products'
  | 'manage_locations'
  | 'cycle_count'
  | 'manage_returns'
  | 'reserve_allocate'
  | 'issue_items'
  | 'transfer_stock'
  | 'view_finance'
  | 'view_analytics'
  | 'view_procurement'
  | 'view_pricing'
  | 'set_pricing';

/** The 8 warehouse roles (verbatim from source `roles.ts`). */
export type WarehouseRole =
  | 'logistics_supervisor'
  | 'operations'
  | 'finance'
  | 'bi_analyst'
  | 'business_unit'
  | 'marketing'
  | 'procurement'
  | 'pricing';

const ALL_INVENTORY = [
  'view_dashboard',
  'manage_inventory',
] as const satisfies readonly WarehouseCapability[];

const WAREHOUSE_CAPABILITIES = [
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
] as const satisfies readonly WarehouseCapability[];

export const warehouseModule: ModuleDefinition<
  'warehouse',
  WarehouseRole,
  WarehouseCapability
> = {
  module: 'warehouse',
  label: 'Warehouse',
  capabilities: WAREHOUSE_CAPABILITIES,
  roles: {
    logistics_supervisor: {
      label: 'Logistics Supervisor',
      description:
        'Receiving, tagging, serialized tracking, cycle counts & returns.',
      capabilities: [
        ...ALL_INVENTORY,
        'receive_stock',
        'manage_products',
        'manage_locations',
        'cycle_count',
        'manage_returns',
        'issue_items',
        'transfer_stock',
      ],
    },
    operations: {
      label: 'eCommerce / Operations',
      description:
        'Allocate inventory to events, issue & track returns across sites.',
      capabilities: [
        ...ALL_INVENTORY,
        'reserve_allocate',
        'issue_items',
        'manage_returns',
        'transfer_stock',
      ],
    },
    finance: {
      label: 'Finance Manager',
      description:
        'Inventory valuation, costing, reconciliation & audit trails.',
      capabilities: [...ALL_INVENTORY, 'view_finance', 'cycle_count'],
    },
    bi_analyst: {
      label: 'BI Analyst',
      description: 'Utilization, fast-moving SKUs & consumption analytics.',
      capabilities: [...ALL_INVENTORY, 'view_analytics'],
    },
    business_unit: {
      label: 'Business Unit',
      description: 'View availability and reserve SKUs for confirmed events.',
      capabilities: [...ALL_INVENTORY, 'reserve_allocate'],
    },
    marketing: {
      label: 'Marketing',
      description: 'Request & allocate items for campaigns; track distribution.',
      capabilities: [...ALL_INVENTORY, 'reserve_allocate', 'manage_returns'],
    },
    procurement: {
      label: 'Procurement',
      description: 'Reorder thresholds, stockout risk & supplier planning.',
      capabilities: [...ALL_INVENTORY, 'view_procurement', 'manage_products'],
    },
    pricing: {
      label: 'Pricing',
      description: 'Landed cost, valuation, turnover & bundle pricing.',
      capabilities: [
        ...ALL_INVENTORY,
        'view_pricing',
        'set_pricing',
        'view_finance',
      ],
    },
  },
};
