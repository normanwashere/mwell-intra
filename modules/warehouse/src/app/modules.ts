import type { Capability } from "@/auth/roles";
import type { Role } from "@/domain/types";
import { can } from "@/auth/roles";

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
  | "finance"
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
      "receive_stock",
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
    capabilities: ["view_procurement", "receive_stock"],
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
    capabilities: ["inspect_quality", "release_quality_hold"],
    description: "Inspect receipts and control held stock.",
    icon: "shield",
    group: "control",
  },
  {
    id: "approvals",
    label: "Stock Approvals",
    shortLabel: "Approvals",
    path: "/approvals",
    capabilities: ["approve_stock_adjustment"],
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
    id: "finance",
    label: "Finance",
    path: "/finance",
    capabilities: ["view_finance"],
    description: "Valuation and reconciliation.",
    icon: "coins",
    group: "analyze",
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
  finance: [4, 4],
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

export function modulesForRole(role: Role): ModuleDef[] {
  return MODULES.filter((module) =>
    module.capabilities.some((capability) => can(role, capability)),
  );
}

export function primaryModulesForRole(role: Role): ModuleDef[] {
  const order: MobileSlot[] = ["home", "scan", "tasks", "inventory"];
  return modulesForRole(role)
    .filter((module): module is ModuleDef & { mobile: MobileSlot } =>
      Boolean(module.mobile),
    )
    .sort((a, b) => order.indexOf(a.mobile) - order.indexOf(b.mobile));
}
