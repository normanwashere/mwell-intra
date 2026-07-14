import type { Capability } from "@/auth/roles";
import type { Role } from "@/domain/types";
import { can, ROLES } from "@/auth/roles";

export type WarehouseUiRole = Role | "warehouse_operator" | "warehouse_supervisor";

const CANONICAL_ROLE_ALIASES = {
  warehouse_operator: "operations",
  warehouse_supervisor: "logistics_supervisor",
} as const satisfies Record<string, Role>;

export function normalizeWarehouseRole(role: WarehouseUiRole): Role {
  if (role === "warehouse_operator" || role === "warehouse_supervisor") {
    return CANONICAL_ROLE_ALIASES[role];
  }
  return role;
}

export function warehouseRolePresentation(role: WarehouseUiRole): {
  label: string;
  description: string;
} {
  if (role === "warehouse_operator" || role === "operations") {
    return {
      label: "Warehouse Operator",
      description: "Routine receiving, putaway, issue, returns, and count work.",
    };
  }
  if (
    role === "warehouse_supervisor" ||
    role === "logistics_supervisor"
  ) {
    return {
      label: "Warehouse Supervisor",
      description: "Controlled exceptions, approvals, quality, and floor oversight.",
    };
  }
  return ROLES[normalizeWarehouseRole(role)];
}

export type ModuleGroup =
  "operate" | "plan" | "control" | "analyze" | "configure";
export type MobileSlot = "home" | "scan" | "tasks" | "inventory";
export type WarehouseRouteId =
  | "dashboard"
  | "scan"
  | "tasks"
  | "inventory"
  | "product-detail"
  | "receiving"
  | "allocations"
  | "returns"
  | "storage"
  | "events"
  | "event-detail"
  | "procurement"
  | "purchase-orders"
  | "cycle-counts"
  | "quality"
  | "approvals"
  | "exceptions"
  | "pricing"
  | "data"
  | "reports"
  | "suppliers"
  | "locations"
  | "imports"
  | "operation-routes";
export type WarehouseModuleId = Exclude<
  WarehouseRouteId,
  "product-detail" | "event-detail"
>;

export interface ModuleDef {
  id: WarehouseModuleId;
  label: string;
  shortLabel?: string;
  path: string;
  capabilities: Capability[];
  description: string;
  icon: string;
  group: ModuleGroup;
  mobile?: MobileSlot;
}

export interface WarehouseRouteContract {
  id: WarehouseRouteId;
  path: string;
  gateCapabilityIds: Capability[];
  capabilityIds: Capability[];
  minimumControls: number;
  minimumFields: number;
}

export const MODULE_GROUP_LABELS: Record<ModuleGroup, string> = {
  operate: "Operate",
  plan: "Plan",
  control: "Control",
  analyze: "Analyze",
  configure: "Configure",
};

export const MODULES: ModuleDef[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    shortLabel: "Home",
    path: "/",
    capabilities: ["view_dashboard"],
    description: "KPIs, alerts and utilization.",
    icon: "grid",
    group: "analyze",
    mobile: "home",
  },
  {
    id: "scan",
    label: "Scan",
    path: "/scan",
    capabilities: [
      "receive_stock",
      "issue_items",
      "manage_returns",
      "cycle_count",
      "transfer_stock",
    ],
    description: "Scan stock operations and lookup.",
    icon: "scan",
    group: "operate",
    mobile: "scan",
  },
  {
    id: "tasks",
    label: "Tasks",
    path: "/tasks",
    capabilities: ["inspect_quality", "view_exceptions", "cycle_count"],
    description: "Due, blocked and completed control work.",
    icon: "clipboard",
    group: "control",
    mobile: "tasks",
  },
  {
    id: "inventory",
    label: "Inventory",
    path: "/inventory",
    capabilities: ["manage_inventory"],
    description: "Browse SKUs, serials, batches and locations.",
    icon: "box",
    group: "operate",
    mobile: "inventory",
  },
  {
    id: "receiving",
    label: "Receiving",
    path: "/receiving",
    capabilities: ["receive_stock"],
    description: "Scan and tag incoming inventory.",
    icon: "truck",
    group: "operate",
  },
  {
    id: "allocations",
    label: "Allocations",
    path: "/allocations",
    capabilities: ["reserve_allocate", "issue_items"],
    description: "Reserve, issue and track event stock.",
    icon: "tag",
    group: "operate",
  },
  {
    id: "returns",
    label: "Returns",
    path: "/returns",
    capabilities: ["manage_returns"],
    description: "Record returns and disposition.",
    icon: "rotate",
    group: "operate",
  },
  {
    id: "storage",
    label: "Storage areas",
    path: "/storage",
    capabilities: [
      "manage_locations",
      "transfer_stock",
      "cycle_count",
    ],
    description: "Scannable bins and shelves.",
    icon: "pin",
    group: "operate",
  },
  {
    id: "events",
    label: "Events",
    path: "/events",
    capabilities: ["reserve_allocate", "view_finance"],
    description: "Activation planning and reporting.",
    icon: "calendar",
    group: "plan",
  },
  {
    id: "procurement",
    label: "Procurement",
    path: "/procurement",
    capabilities: ["view_procurement"],
    description: "Reorder and supplier planning.",
    icon: "cart",
    group: "plan",
  },
  {
    id: "purchase-orders",
    label: "Purchase Orders",
    shortLabel: "POs",
    path: "/purchase-orders",
    capabilities: ["view_procurement", "receive_stock", "inspect_quality"],
    description: "Approved supply and receiving.",
    icon: "list",
    group: "plan",
  },
  {
    id: "cycle-counts",
    label: "Cycle Counts",
    shortLabel: "Counts",
    path: "/cycle-counts",
    capabilities: ["cycle_count"],
    description: "Count and reconcile variances.",
    icon: "clipboard",
    group: "control",
  },
  {
    id: "quality",
    label: "Quality Control",
    shortLabel: "Quality",
    path: "/quality",
    capabilities: ["inspect_quality", "release_quality_hold", "manage_returns"],
    description: "Inspect receipts and control held stock.",
    icon: "shield",
    group: "control",
  },
  {
    id: "approvals",
    label: "Stock Approvals",
    shortLabel: "Approvals",
    path: "/approvals",
    capabilities: ["approve_stock_adjustment", "approve_stock_adjustment_finance"],
    description: "Decide governed inventory changes.",
    icon: "check",
    group: "control",
  },
  {
    id: "exceptions",
    label: "Exceptions",
    path: "/exceptions",
    capabilities: ["view_exceptions"],
    description: "Investigate operational risk and resolution.",
    icon: "alert",
    group: "control",
  },
  {
    id: "pricing",
    label: "Pricing",
    path: "/pricing",
    capabilities: ["view_pricing"],
    description: "Cost variance and pricing.",
    icon: "trend",
    group: "analyze",
  },
  {
    id: "data",
    label: "Data & Reports",
    path: "/data",
    capabilities: ["view_analytics"],
    description: "Exports, definitions and metrics.",
    icon: "history",
    group: "analyze",
  },
  {
    id: "reports",
    label: "Inventory Reports",
    shortLabel: "Reports",
    path: "/reports",
    capabilities: ["view_analytics", "view_finance"],
    description: "Committed inventory positions and governed exports.",
    icon: "history",
    group: "analyze",
  },
  {
    id: "suppliers",
    label: "Suppliers",
    path: "/suppliers",
    capabilities: ["view_procurement"],
    description: "Supplier master and lead times.",
    icon: "building",
    group: "configure",
  },
  {
    id: "locations",
    label: "Locations",
    path: "/locations",
    capabilities: ["manage_locations"],
    description: "Warehouses and event sites.",
    icon: "building",
    group: "configure",
  },
  {
    id: "imports",
    label: "Warehouse Imports",
    shortLabel: "Imports",
    path: "/imports",
    capabilities: ["import_warehouse_data"],
    description: "Controlled master-data and opening-balance imports.",
    icon: "download",
    group: "configure",
  },
  {
    id: "operation-routes",
    label: "Operation Routes",
    shortLabel: "Routes",
    path: "/operation-routes",
    capabilities: ["manage_operation_routes"],
    description: "Movement path, evidence, approval, and online policy.",
    icon: "transfer",
    group: "configure",
  },
];

const ROUTE_ACTION_CAPABILITIES: Partial<
  Record<WarehouseRouteId, Capability[]>
> = {
  dashboard: ["view_analytics", "view_finance"],
  inventory: ["manage_products"],
  allocations: ["manage_returns"],
  exceptions: ["resolve_exceptions"],
  pricing: ["set_pricing"],
};

const ROUTE_CONTENT_DEPTH: Record<WarehouseModuleId, [number, number]> = {
  dashboard: [6, 3],
  scan: [3, 2],
  tasks: [3, 3],
  inventory: [5, 5],
  receiving: [5, 10],
  allocations: [5, 8],
  returns: [4, 7],
  storage: [5, 7],
  events: [4, 5],
  procurement: [4, 4],
  "purchase-orders": [5, 6],
  "cycle-counts": [5, 5],
  quality: [5, 5],
  approvals: [4, 3],
  exceptions: [4, 4],
  pricing: [4, 5],
  data: [6, 3],
  reports: [5, 6],
  suppliers: [4, 5],
  locations: [4, 6],
  imports: [5, 6],
  "operation-routes": [5, 8],
};

export const WAREHOUSE_DETAIL_ROUTES: WarehouseRouteContract[] = [
  {
    id: "product-detail",
    path: "/inventory/:id",
    gateCapabilityIds: ["manage_inventory"],
    capabilityIds: [
      "manage_inventory",
      "manage_products",
      "transfer_stock",
      "set_pricing",
      "cycle_count",
      "approve_stock_adjustment",
      "view_finance",
      "view_pricing",
      "view_procurement",
      "receive_stock",
      "manage_locations",
    ],
    minimumControls: 8,
    minimumFields: 8,
  },
  {
    id: "event-detail",
    path: "/events/:id",
    gateCapabilityIds: ["reserve_allocate", "view_finance"],
    capabilityIds: [
      "reserve_allocate",
      "view_finance",
      "issue_items",
      "manage_returns",
    ],
    minimumControls: 6,
    minimumFields: 7,
  },
];

export const WAREHOUSE_ROUTE_CONTRACTS: WarehouseRouteContract[] = [
  ...MODULES.map((module) => {
    const [minimumControls, minimumFields] = ROUTE_CONTENT_DEPTH[module.id] ?? [
      2, 2,
    ];
    return {
      id: module.id,
      path: module.path,
      gateCapabilityIds: [...module.capabilities],
      capabilityIds: [
        ...new Set([
          ...module.capabilities,
          ...(ROUTE_ACTION_CAPABILITIES[module.id] ?? []),
        ]),
      ],
      minimumControls,
      minimumFields,
    };
  }),
  ...WAREHOUSE_DETAIL_ROUTES,
];

export const WAREHOUSE_ROUTE_BY_ID = Object.fromEntries(
  WAREHOUSE_ROUTE_CONTRACTS.map((entry) => [entry.id, entry]),
) as Record<WarehouseRouteId, WarehouseRouteContract>;

export function isWarehouseOperatorRole(role: WarehouseUiRole): boolean {
  return role === "warehouse_operator" || role === "operations";
}

export function isWarehouseSupervisorRole(role: WarehouseUiRole): boolean {
  return role === "warehouse_supervisor" || role === "logistics_supervisor" || role === "warehouse_admin";
}

const OPERATOR_MODULES: ModuleDef[] = [
  { ...MODULES.find((module) => module.id === "dashboard")!, label: "Home", group: "operate" },
  { ...MODULES.find((module) => module.id === "purchase-orders")!, label: "Receive and inspect", group: "operate" },
  { ...MODULES.find((module) => module.id === "storage")!, label: "Put away", group: "operate" },
  { ...MODULES.find((module) => module.id === "allocations")!, label: "Pick or issue", group: "operate" },
  { ...MODULES.find((module) => module.id === "returns")!, label: "Returns and counts", group: "operate" },
];

export function modulesForRole(role: WarehouseUiRole): ModuleDef[] {
  if (isWarehouseOperatorRole(role)) return OPERATOR_MODULES;
  const capabilityRole = normalizeWarehouseRole(role);
  return MODULES.filter((module) =>
    module.capabilities.some((capability) => can(capabilityRole, capability)),
  );
}

export function primaryModulesForRole(role: WarehouseUiRole): ModuleDef[] {
  if (isWarehouseOperatorRole(role)) return OPERATOR_MODULES.slice(0, 4);
  const order: MobileSlot[] = ["home", "scan", "tasks", "inventory"];
  return modulesForRole(role)
    .filter((module): module is ModuleDef & { mobile: MobileSlot } =>
      Boolean(module.mobile),
    )
    .sort((a, b) => order.indexOf(a.mobile) - order.indexOf(b.mobile));
}

type CapabilityPredicate = (capability: Capability) => boolean;

function modulesForCapabilities(canAccess: CapabilityPredicate): ModuleDef[] {
  return MODULES.filter((module) => module.capabilities.some(canAccess));
}

export function modulesForWarehouseAccess(
  source: "memory" | "supabase",
  role: WarehouseUiRole,
  canAccess: CapabilityPredicate,
): ModuleDef[] {
  if (source === "memory") return modulesForRole(role);
  if (isWarehouseOperatorRole(role)) {
    return OPERATOR_MODULES.filter((module) => module.capabilities.some(canAccess));
  }
  return modulesForCapabilities(canAccess);
}

export function primaryModulesForWarehouseAccess(
  source: "memory" | "supabase",
  role: WarehouseUiRole,
  canAccess: CapabilityPredicate,
): ModuleDef[] {
  if (source === "memory") return primaryModulesForRole(role);
  if (isWarehouseOperatorRole(role)) {
    return OPERATOR_MODULES.slice(0, 4).filter((module) => module.capabilities.some(canAccess));
  }
  const order: MobileSlot[] = ["home", "scan", "tasks", "inventory"];
  return modulesForCapabilities(canAccess)
    .filter((module): module is ModuleDef & { mobile: MobileSlot } =>
      Boolean(module.mobile),
    )
    .sort((left, right) => order.indexOf(left.mobile) - order.indexOf(right.mobile));
}
