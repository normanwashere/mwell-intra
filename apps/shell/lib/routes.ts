export interface ShellPageRouteContract {
  route: string;
  module: "core" | "warehouse" | "procurement" | "legal" | "vendor" | "admin";
  capabilityIds: string[];
  administratorRoleIds?: string[];
  minimumControls: number;
  minimumFields: number;
}

export const SHELL_PAGE_ROUTE_CONTRACTS: ShellPageRouteContract[] = [
  {
    route: "/",
    module: "core",
    capabilityIds: ["manage_notifications"],
    minimumControls: 2,
    minimumFields: 2,
  },
  {
    route: "/login",
    module: "core",
    capabilityIds: [],
    minimumControls: 3,
    minimumFields: 2,
  },
  {
    route: "/reset-password",
    module: "core",
    capabilityIds: [],
    minimumControls: 2,
    minimumFields: 2,
  },
  {
    route: "/knowledge",
    module: "core",
    capabilityIds: [],
    minimumControls: 4,
    minimumFields: 4,
  },
  {
    route: "/~offline",
    module: "core",
    capabilityIds: [],
    minimumControls: 2,
    minimumFields: 2,
  },
  {
    route: "/admin",
    module: "admin",
    capabilityIds: ["manage_rbac"],
    administratorRoleIds: ["platform_admin"],
    minimumControls: 3,
    minimumFields: 0,
  },
  {
    route: "/admin/users",
    module: "admin",
    capabilityIds: ["manage_rbac"],
    administratorRoleIds: ["platform_admin"],
    minimumControls: 3,
    minimumFields: 3,
  },
  {
    route: "/admin/doa",
    module: "admin",
    capabilityIds: ["manage_rbac", "manage_doa"],
    administratorRoleIds: ["platform_admin", "legal_admin"],
    minimumControls: 5,
    minimumFields: 9,
  },
  {
    route: "/warehouse",
    module: "warehouse",
    capabilityIds: [],
    minimumControls: 0,
    minimumFields: 0,
  },
  {
    route: "/procurement",
    module: "procurement",
    capabilityIds: [],
    minimumControls: 0,
    minimumFields: 0,
  },
  {
    route: "/legal",
    module: "legal",
    capabilityIds: [],
    minimumControls: 0,
    minimumFields: 0,
  },
  {
    route: "/vendor",
    module: "vendor",
    capabilityIds: [],
    minimumControls: 0,
    minimumFields: 0,
  },
];
