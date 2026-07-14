import type { ModuleDefinition } from '../contracts';

// Warehouse module RBAC: the source single-scope model plus the W1 control
// capabilities and explicit Warehouse Administrator role.
// This is the CANONICAL matrix and must stay in sync with warehouse RPC guards
// and `core.role_capabilities` (spec §6.6).

/** Warehouse capability catalogue mirrored by `core.role_capabilities`. */
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
  | 'set_pricing'
  | 'manage_operation_routes'
  | 'inspect_quality'
  | 'release_quality_hold'
  | 'approve_stock_adjustment'
  | 'approve_stock_adjustment_finance'
  | 'view_exceptions'
  | 'resolve_exceptions'
  | 'import_warehouse_data';

/** Warehouse operating roles, including the explicit configuration role. */
export type WarehouseRole =
  | 'logistics_supervisor'
  | 'operations'
  | 'finance'
  | 'bi_analyst'
  | 'business_unit'
  | 'marketing'
  | 'procurement'
  | 'pricing'
  | 'warehouse_admin';

export type CanonicalWarehouseRole =
  | 'warehouse_operator'
  | 'warehouse_supervisor';

export type WarehouseRegistryRole = WarehouseRole | CanonicalWarehouseRole;

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
  'manage_operation_routes',
  'inspect_quality',
  'release_quality_hold',
  'approve_stock_adjustment',
  'approve_stock_adjustment_finance',
  'view_exceptions',
  'resolve_exceptions',
  'import_warehouse_data',
] as const satisfies readonly WarehouseCapability[];

const WAREHOUSE_OPERATOR_CAPABILITIES = [
  'view_dashboard',
  'receive_stock',
  'manage_inventory',
  'cycle_count',
  'manage_returns',
  'reserve_allocate',
  'issue_items',
  'transfer_stock',
  'inspect_quality',
  'view_exceptions',
] as const satisfies readonly WarehouseCapability[];

const WAREHOUSE_SUPERVISOR_CAPABILITIES = [
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
  'manage_operation_routes',
  'inspect_quality',
  'release_quality_hold',
  'approve_stock_adjustment',
  'view_exceptions',
  'resolve_exceptions',
  'import_warehouse_data',
] as const satisfies readonly WarehouseCapability[];

export const warehouseModule: ModuleDefinition<
  'warehouse',
  WarehouseRegistryRole,
  WarehouseCapability
> = {
  module: 'warehouse',
  label: 'Warehouse',
  capabilities: WAREHOUSE_CAPABILITIES,
  roles: {
    warehouse_operator: {
      label: 'Warehouse Operator',
      description:
        'Routine receiving, inspection, putaway, picking, issue, returns, and counts.',
      capabilities: WAREHOUSE_OPERATOR_CAPABILITIES,
    },
    warehouse_supervisor: {
      label: 'Warehouse Supervisor',
      description:
        'Controlled exceptions, quality disposition, adjustments, configuration, and imports.',
      capabilities: WAREHOUSE_SUPERVISOR_CAPABILITIES,
    },
    logistics_supervisor: {
      label: 'Logistics Supervisor',
      description:
        'Receiving, tagging, serialized tracking, cycle counts & returns.',
      capabilities: WAREHOUSE_SUPERVISOR_CAPABILITIES,
    },
    operations: {
      label: 'eCommerce / Operations',
      description:
        'Allocate inventory to events, issue & track returns across sites.',
      capabilities: WAREHOUSE_OPERATOR_CAPABILITIES,
    },
    finance: {
      label: 'Finance Manager',
      description:
        'Inventory valuation, costing, reconciliation & audit trails.',
      capabilities: [
        ...ALL_INVENTORY,
        'view_finance',
        'cycle_count',
        'approve_stock_adjustment',
        'approve_stock_adjustment_finance',
        'view_exceptions',
      ],
    },
    bi_analyst: {
      label: 'BI Analyst',
      description: 'Utilization, fast-moving SKUs & consumption analytics.',
      capabilities: [...ALL_INVENTORY, 'view_analytics', 'view_exceptions'],
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
    warehouse_admin: {
      label: 'Warehouse Administrator',
      description:
        'Warehouse configuration, controls, imports, quality and operational oversight.',
      capabilities: WAREHOUSE_CAPABILITIES,
    },
  },
};
