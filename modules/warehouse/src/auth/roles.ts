// Warehouse capability/role matrix — THIN ADAPTER over the canonical @intra/rbac
// matrix (spec §4.2, ADR-003). The source app owned its own single-scope RBAC in
// `src/auth/roles.ts`; that table was ported verbatim into
// `@intra/rbac` `warehouseModule`, which is now the single source of truth. This
// adapter preserves the source's `can(role, cap)` / `ROLES` / `ROLE_LIST` surface
// so every ported page/component keeps compiling, while delegating the actual
// capability decision to `@intra/rbac`.

import {
  can as rbacCan,
  warehouseModule,
  type WarehouseCapability,
  type WarehouseRegistryRole,
} from '@intra/rbac';
import type { Role } from '@/domain/types';

/** Warehouse capabilities (identical union to the source `roles.ts`). */
export type Capability = WarehouseCapability;

export interface RoleProfile {
  id: Role;
  label: string;
  description: string;
  capabilities: Capability[];
}

type RbacRoleDef = (typeof warehouseModule.roles)[WarehouseRegistryRole];

/** Role metadata projected from the canonical @intra/rbac matrix. */
export const ROLES: Record<Role, RoleProfile> = Object.fromEntries(
  (
    Object.entries(warehouseModule.roles) as [
      WarehouseRegistryRole,
      RbacRoleDef,
    ][]
  ).map(([id, def]) => [
    id,
    {
      id,
      label: def.label,
      description: def.description,
      capabilities: [...def.capabilities],
    } satisfies RoleProfile,
  ]),
) as Record<Role, RoleProfile>;

export const ROLE_LIST: RoleProfile[] = Object.values(ROLES);

const CAPABILITY_SET = new Set<string>(warehouseModule.capabilities);

export function isWarehouseCapability(value: unknown): value is Capability {
  return typeof value === 'string' && CAPABILITY_SET.has(value);
}

/**
 * Does `role` grant `capability`? Delegates to the scoped @intra/rbac predicate
 * by projecting the single warehouse role onto a `UserRoles` shape — so there is
 * exactly ONE authorization source of truth (spec §6.6).
 */
export function can(role: Role, capability: Capability): boolean {
  return rbacCan({ warehouse: [role] }, 'warehouse', capability);
}
