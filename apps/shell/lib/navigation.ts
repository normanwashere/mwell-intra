// Shell navigation model.
// Supabase sessions use live capabilities; memory-mode demos use the static
// role registry. `core` is the shared foundation and has no hosted route of its
// own, so it is intentionally excluded from the nav.

import type { AuthMode, UserCapabilities } from "@intra/auth";
import {
  can,
  type CapabilityFor,
  type Module,
  type UserRoles,
} from "@intra/rbac";
import type { IconName, Tone } from "@intra/ui";

export interface ModuleNav {
  readonly module: Module;
  readonly href: string;
  readonly label: string;
  readonly description: string;
  readonly icon: IconName;
  readonly tone: Tone;
}

export type ShellNavItem = Omit<ModuleNav, "module">;

export interface ShellAccess {
  readonly mode: AuthMode;
  readonly userRoles: Partial<UserRoles>;
  readonly userCapabilities?: UserCapabilities;
}

export function memoryAccess(userRoles: Partial<UserRoles>): ShellAccess {
  return { mode: "memory", userRoles, userCapabilities: {} };
}

export function hasCapability<M extends Module>(
  access: ShellAccess,
  module: M,
  capability: CapabilityFor<M>,
): boolean {
  return access.mode === "supabase"
    ? access.userCapabilities?.[module]?.includes(capability) === true
    : can(access.userRoles, module, capability);
}

/** Internal, employee-facing module routes (in nav order). */
export const MODULE_NAV: readonly ModuleNav[] = [
  {
    module: "events",
    href: "/events",
    label: "Events",
    description: "Activation planning, readiness, and fulfillment handoffs.",
    icon: "calendar",
    tone: "cyan",
  },
  {
    module: "warehouse",
    href: "/warehouse",
    label: "Warehouse",
    description: "Inventory, receiving, allocations & returns.",
    icon: "box",
    tone: "brand",
  },
  {
    module: "procurement",
    href: "/procurement",
    label: "Procurement",
    description: "Requests, RFPs, purchase orders & approvals.",
    icon: "cart",
    tone: "accent",
  },
  {
    module: "legal",
    href: "/legal",
    label: "Legal",
    description: "Vendor accreditation & document review.",
    icon: "clipboard",
    tone: "amber",
  },
  {
    module: "insights",
    href: "/insights",
    label: "Insights",
    description: "Role-scoped operational and executive indicators.",
    icon: "trend",
    tone: "slate",
  },
];

export const WORK_NAV = {
  href: "/work",
  label: "My Work",
  description: "Assignments and approvals across every accessible area.",
  icon: "check",
  tone: "brand",
} as const satisfies ShellNavItem;

/** External vendor-tier route (visibility keys off `profile.kind === 'vendor'`). */
export const VENDOR_NAV = {
  href: "/vendor",
  label: "Vendor Portal",
  description: "Submit accreditation & documents for your organization.",
  icon: "building",
  tone: "emerald",
} as const satisfies ShellNavItem;

/** Cross-module Finance control center. */
export const FINANCE_NAV = {
  href: "/finance",
  label: "Finance",
  description:
    "Procurement commitments, payment readiness, inventory value, and reconciliation.",
  icon: "coins",
  tone: "emerald",
} as const satisfies ShellNavItem;

/** Platform administration route, visible to users with core:manage_rbac. */
export const ADMIN_NAV = {
  href: "/admin",
  label: "Administration",
  description:
    "Provision profiles, assign scoped module roles, review audit trail.",
  icon: "list",
  tone: "rose",
} as const satisfies ShellNavItem;

export const DEPARTMENTS_NAV = {
  href: "/admin/departments",
  label: "Departments",
  description: "Maintain the organization hierarchy and effective user scopes.",
  icon: "building",
  tone: "cyan",
} as const satisfies ShellNavItem;

export const DOA_NAV = {
  href: "/admin/doa",
  label: "Delegation of Authority",
  description: "Configure department approval matrices and named approvers.",
  icon: "clipboard",
  tone: "amber",
} as const satisfies ShellNavItem;

/** Universal authenticated guidance. Documentation visibility grants no operational access. */
export const KNOWLEDGE_NAV = {
  href: "/knowledge",
  label: "Knowledge Base",
  description:
    "Search role guides, workflows, troubleshooting, and recommendations.",
  icon: "search",
  tone: "cyan",
} as const satisfies ShellNavItem;

/** Does the user hold at least one role in `module`? */
export function hasModuleAccess(access: ShellAccess, module: Module): boolean {
  return access.mode === "supabase"
    ? (access.userCapabilities?.[module]?.length ?? 0) > 0
    : (access.userRoles[module]?.length ?? 0) > 0;
}

/** The internal module routes the user can see, in nav order. */
export function accessibleModules(access: ShellAccess): readonly ModuleNav[] {
  return MODULE_NAV.filter((item) => hasModuleAccess(access, item.module));
}

/** Finance is an Intra-wide area backed by scoped module capabilities. */
export function canAccessFinance(access: ShellAccess): boolean {
  return (
    hasCapability(access, "warehouse", "view_finance") ||
    hasCapability(access, "procurement", "view_finance")
  );
}

/**
 * Resolve a requested post-login destination without sending the user into an
 * area their new session cannot open. Unknown paths fail closed to Home.
 */
export function authorizedPostLoginPath(
  requestedPath: string,
  access: ShellAccess,
  profileKind: "employee" | "vendor",
): string {
  if (requestedPath === "/") return "/";
  if (requestedPath === "/knowledge" || requestedPath.startsWith("/knowledge/"))
    return requestedPath;
  if (requestedPath === "/work" || requestedPath.startsWith("/work/"))
    return profileKind === "employee" ? requestedPath : "/";
  if (requestedPath === "/vendor" || requestedPath.startsWith("/vendor/"))
    return profileKind === "vendor" ? requestedPath : "/";
  if (requestedPath === "/finance" || requestedPath.startsWith("/finance/"))
    return canAccessFinance(access) ? requestedPath : "/";
  if (requestedPath === "/admin/doa" || requestedPath.startsWith("/admin/doa/"))
    return hasCapability(access, "core", "manage_rbac") ||
      hasCapability(access, "legal", "manage_doa")
      ? requestedPath
      : "/";
  if (requestedPath === "/admin" || requestedPath.startsWith("/admin/"))
    return hasCapability(access, "core", "manage_rbac") ? requestedPath : "/";

  const requestedModule = MODULE_NAV.find(
    (item) =>
      requestedPath === item.href || requestedPath.startsWith(`${item.href}/`),
  );
  return requestedModule && hasModuleAccess(access, requestedModule.module)
    ? requestedPath
    : "/";
}

/**
 * Every first-class destination shown on the signed-in dashboard and shell.
 * Keeping this composition in one place prevents the access count, quick links,
 * cards, and navigation from describing different permission sets.
 */
export function dashboardAreas(
  access: ShellAccess,
  profileKind: "employee" | "vendor",
): readonly ShellNavItem[] {
  const areas: ShellNavItem[] = [];

  if (profileKind === "employee") areas.push(WORK_NAV);
  areas.push(...accessibleModules(access));

  if (profileKind === "vendor") areas.push(VENDOR_NAV);
  if (canAccessFinance(access)) areas.push(FINANCE_NAV);
  if (hasCapability(access, "core", "manage_rbac")) {
    areas.push(ADMIN_NAV, DEPARTMENTS_NAV);
  }
  if (
    hasCapability(access, "core", "manage_rbac") ||
    hasCapability(access, "legal", "manage_doa")
  ) {
    areas.push(DOA_NAV);
  }
  areas.push(KNOWLEDGE_NAV);

  return areas.filter(
    (area, index) =>
      areas.findIndex((candidate) => candidate.href === area.href) === index,
  );
}

export interface MobileContextAction {
  href: string;
  label: string;
  icon: IconName;
}

export function mobileCenterAction(
  pathname: string,
  access: ShellAccess,
): MobileContextAction | null {
  if (
    pathname.startsWith("/procurement") &&
    hasCapability(access, "procurement", "create_request")
  )
    return {
      href: "/procurement/requests/new",
      label: "New request",
      icon: "plus",
    };
  if (pathname.startsWith("/legal") && hasCapability(access, "legal", "admin"))
    return {
      href: "/legal/invites/new",
      label: "Invite vendor",
      icon: "plus",
    };
  if (
    pathname.startsWith("/events") &&
    hasCapability(access, "events", "create_event")
  )
    return { href: "/events?create=1", label: "New event", icon: "plus" };
  if (
    pathname.startsWith("/admin") &&
    hasCapability(access, "core", "manage_rbac")
  )
    return { href: "/admin/users", label: "Users", icon: "list" };
  return null;
}
