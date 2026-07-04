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
} as const satisfies { href: string; label: string; description: string; icon: IconName; tone: Tone };

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
