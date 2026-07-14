// @intra/rbac — suite-wide scoped, multi-role RBAC (spec §4.2, ADR-003).
//
// Capabilities are defined per MODULE; a user can hold different roles in
// different modules. This matrix is the single source of truth and is mirrored
// into the DB `core.role_capabilities` table via `toRoleCapabilityRows()`
// (platform invariant §6.6: "RBAC defined once — change both").

// Structural contracts + shared types.
export type {
  Module,
  ModuleDefinition,
  RoleDefinition,
  RoleCapabilityRow,
  UserRoles,
} from './contracts';
export { MODULE_LIST } from './contracts';

// Per-module capability + role unions and matrices.
export type { CoreCapability, CoreRole } from './modules/core';
export { coreModule } from './modules/core';
export type {
  WarehouseCapability,
  WarehouseRole,
  CanonicalWarehouseRole,
  WarehouseRegistryRole,
} from './modules/warehouse';
export { warehouseModule } from './modules/warehouse';
export type {
  ProcurementCapability,
  ProcurementRole,
} from './modules/procurement';
export { procurementModule } from './modules/procurement';
export type { LegalCapability, LegalRole } from './modules/legal';
export { legalModule } from './modules/legal';
export type { EventsCapability, EventsRole } from './modules/events';
export { eventsModule } from './modules/events';
export type { InsightsCapability, InsightsRole } from './modules/insights';
export { insightsModule } from './modules/insights';

// Registry, predicates, and DB-seed helpers.
export type {
  Capability,
  Role,
  CapabilityFor,
  RoleFor,
  ModuleCapabilityMap,
  ModuleRoleMap,
} from './registry';
export {
  MODULES,
  can,
  hasCapInModule,
  roleCapabilities,
  toRoleCapabilityRows,
  listModuleRoles,
  emptyUserRoles,
} from './registry';
