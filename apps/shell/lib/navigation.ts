// Shell navigation model (spec §1: the shell hosts modules as routes; §4.2:
// scoped RBAC). A module is VISIBLE when the signed-in user holds ANY role in
// it (`userRoles[module]?.length`). `core` is the shared foundation and has no
// hosted route of its own, so it is intentionally excluded from the nav.

import { can, type Module, type UserRoles } from "@intra/rbac";
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

/** Internal, employee-facing module routes (in nav order). */
export const MODULE_NAV: readonly ModuleNav[] = [
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
];

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
export function hasModuleAccess(
  userRoles: Partial<UserRoles>,
  module: Module,
): boolean {
  return (userRoles[module]?.length ?? 0) > 0;
}

/** The internal module routes the user can see, in nav order. */
export function accessibleModules(
  userRoles: Partial<UserRoles>,
): readonly ModuleNav[] {
  return MODULE_NAV.filter((item) => hasModuleAccess(userRoles, item.module));
}

/** Finance is an Intra-wide area backed by scoped module capabilities. */
export function canAccessFinance(userRoles: Partial<UserRoles>): boolean {
  return (
    can(userRoles, "warehouse", "view_finance") ||
    can(userRoles, "procurement", "view_finance")
  );
}

/**
 * Every first-class destination shown on the signed-in dashboard and shell.
 * Keeping this composition in one place prevents the access count, quick links,
 * cards, and navigation from describing different permission sets.
 */
export function dashboardAreas(
  userRoles: Partial<UserRoles>,
  profileKind: "employee" | "vendor",
): readonly ShellNavItem[] {
  const areas: ShellNavItem[] = [...accessibleModules(userRoles)];

  if (profileKind === "vendor") areas.push(VENDOR_NAV);
  if (canAccessFinance(userRoles)) areas.push(FINANCE_NAV);
  if (can(userRoles, "core", "manage_rbac")) areas.push(ADMIN_NAV);
  if (
    can(userRoles, "core", "manage_rbac") ||
    can(userRoles, "legal", "manage_doa")
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
  userRoles: Partial<UserRoles>,
): MobileContextAction | null {
  if (
    pathname.startsWith("/procurement") &&
    can(userRoles, "procurement", "create_request")
  )
    return {
      href: "/procurement/requests/new",
      label: "New request",
      icon: "plus",
    };
  if (pathname.startsWith("/legal") && can(userRoles, "legal", "admin"))
    return {
      href: "/legal/invites/new",
      label: "Invite vendor",
      icon: "plus",
    };
  if (pathname.startsWith("/admin") && can(userRoles, "core", "manage_rbac"))
    return { href: "/admin/users", label: "Users", icon: "list" };
  return null;
}
