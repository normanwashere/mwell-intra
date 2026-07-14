import type { Module, RoleCapabilityRow, UserRoles } from './contracts';
import { MODULE_LIST } from './contracts';
import type { CoreCapability, CoreRole } from './modules/core';
import { coreModule } from './modules/core';
import type {
  WarehouseCapability,
  WarehouseRegistryRole,
} from './modules/warehouse';
import { warehouseModule } from './modules/warehouse';
import type {
  ProcurementCapability,
  ProcurementRole,
} from './modules/procurement';
import { procurementModule } from './modules/procurement';
import type { LegalCapability, LegalRole } from './modules/legal';
import { legalModule } from './modules/legal';
import type { EventsCapability, EventsRole } from './modules/events';
import { eventsModule } from './modules/events';
import type { InsightsCapability, InsightsRole } from './modules/insights';
import { insightsModule } from './modules/insights';

/** Maps each module to its own capability union (used for type-safe `can()`). */
export interface ModuleCapabilityMap {
  core: CoreCapability;
  warehouse: WarehouseCapability;
  procurement: ProcurementCapability;
  legal: LegalCapability;
  events: EventsCapability;
  insights: InsightsCapability;
}

/** Maps each module to its own role union. */
export interface ModuleRoleMap {
  core: CoreRole;
  warehouse: WarehouseRegistryRole;
  procurement: ProcurementRole;
  legal: LegalRole;
  events: EventsRole;
  insights: InsightsRole;
}

/** The capability union valid within a given module. */
export type CapabilityFor<M extends Module> = ModuleCapabilityMap[M];
/** The role union valid within a given module. */
export type RoleFor<M extends Module> = ModuleRoleMap[M];
/** Every capability across every module. */
export type Capability = ModuleCapabilityMap[Module];
/** Every role across every module. */
export type Role = ModuleRoleMap[Module];

/** The registry of all module matrices, keyed by module. */
export const MODULES = {
  core: coreModule,
  warehouse: warehouseModule,
  procurement: procurementModule,
  legal: legalModule,
  events: eventsModule,
  insights: insightsModule,
} as const;

/**
 * Flatten every module's role → capability matrix into DB-shaped rows.
 * This is the single source of truth for seeding `core.role_capabilities`
 * (spec §4.2, §6.6). Order is stable: module order (`core` first), then
 * declaration order of roles and capabilities.
 */
export function toRoleCapabilityRows(): RoleCapabilityRow[] {
  const rows: RoleCapabilityRow[] = [];
  for (const module of MODULE_LIST) {
    const definition = MODULES[module];
    for (const [role, roleDefinition] of Object.entries(definition.roles)) {
      for (const cap of roleDefinition.capabilities) {
        rows.push({ module, role, cap });
      }
    }
  }
  return rows;
}

/**
 * Pre-computed flattened grants — mirror this into `core.role_capabilities`.
 * Shape: `{ module, role, cap }[]`.
 */
export const roleCapabilities: readonly RoleCapabilityRow[] =
  toRoleCapabilityRows();

const GRANT_INDEX: ReadonlySet<string> = new Set(
  roleCapabilities.map((row) => grantKey(row.module, row.role, row.cap)),
);

function grantKey(module: string, role: string, cap: string): string {
  // NUL separator avoids collisions between value boundaries.
  return `${module}\u0000${role}\u0000${cap}`;
}

/**
 * Does a specific `role` (within `module`) grant `capability`?
 * Unknown roles/capabilities simply return `false`.
 */
export function hasCapInModule<M extends Module>(
  module: M,
  role: string,
  capability: CapabilityFor<M>,
): boolean {
  return GRANT_INDEX.has(grantKey(module, role, capability));
}

/**
 * Scoped capability check (spec §4.2): does the user hold ANY role in `module`
 * that grants `capability`? Roles in OTHER modules are irrelevant — this is the
 * per-module scoping that distinguishes the suite RBAC from the warehouse app's
 * flat single-role model.
 *
 * Client-side gate only; the authoritative check is `core.has_cap()` server-side.
 */
export function can<M extends Module>(
  userRoles: Partial<UserRoles>,
  module: M,
  capability: CapabilityFor<M>,
): boolean {
  const rolesInModule = userRoles[module];
  if (!rolesInModule || rolesInModule.length === 0) return false;
  return rolesInModule.some((role) =>
    hasCapInModule(module, role, capability),
  );
}

/** The declared role names for a module (handy for UI role pickers). */
export function listModuleRoles<M extends Module>(module: M): RoleFor<M>[] {
  return Object.keys(MODULES[module].roles) as RoleFor<M>[];
}

/** An empty, fully-keyed `UserRoles` record (every module → `[]`). */
export function emptyUserRoles(): UserRoles {
  return {
    core: [],
    warehouse: [],
    procurement: [],
    legal: [],
    events: [],
    insights: [],
  };
}
