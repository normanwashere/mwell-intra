// Shell navigation model (spec §1: the shell hosts modules as routes; §4.2:
// scoped RBAC). A module is VISIBLE when the signed-in user holds ANY role in
// it (`userRoles[module]?.length`). `core` is the shared foundation and has no
// hosted route of its own, so it is intentionally excluded from the nav.

import type { Module, UserRoles } from '@intra/rbac';
import type { IconName, Tone } from '@intra/ui';

export interface ModuleNav {
  readonly module: Module;
  readonly href: string;
  readonly label: string;
  readonly description: string;
  readonly icon: IconName;
  readonly tone: Tone;
}

export type ShellNavItem = Omit<ModuleNav, 'module'>;

/** Internal, employee-facing module routes (in nav order). */
export const MODULE_NAV: readonly ModuleNav[] = [
  {
    module: 'warehouse',
    href: '/warehouse',
    label: 'Warehouse',
    description: 'Inventory, receiving, allocations & returns.',
    icon: 'box',
    tone: 'brand',
  },
  {
    module: 'procurement',
    href: '/procurement',
    label: 'Procurement',
    description: 'Requests, RFPs, purchase orders & approvals.',
    icon: 'cart',
    tone: 'accent',
  },
  {
    module: 'legal',
    href: '/legal',
    label: 'Legal',
    description: 'Vendor accreditation & document review.',
    icon: 'clipboard',
    tone: 'amber',
  },
];

/** External vendor-tier route (visibility keys off `profile.kind === 'vendor'`). */
export const VENDOR_NAV = {
  href: '/vendor',
  label: 'Vendor Portal',
  description: 'Submit accreditation & documents for your organization.',
  icon: 'building',
  tone: 'emerald',
} as const satisfies ShellNavItem;

/** Cross-module finance landing, hosted by Warehouse until Finance has a shell module. */
export const FINANCE_NAV = {
  href: '/warehouse/finance',
  label: 'Finance',
  description: 'Inventory valuation, costing, reconciliation & asset register.',
  icon: 'coins',
  tone: 'emerald',
} as const satisfies ShellNavItem;

/** Platform administration route, visible to users with core:manage_rbac. */
export const ADMIN_NAV = {
  href: '/admin/users',
  label: 'Admin — Users & Roles',
  description: 'Provision profiles, assign scoped module roles, review audit trail.',
  icon: 'list',
  tone: 'rose',
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
