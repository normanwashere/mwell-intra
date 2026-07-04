// @intra/warehouse — full-parity port of mwell-intra-warehouse as a mountable
// client module (spec §12 step 2, ADR-003).
//
// The Next.js shell imports `WarehouseApp` and renders it under a catch-all
// route inside its <SessionProvider>. The data layer (offline outbox +
// optimistic overlay), design system, RBAC, and auth all come from the shared
// @intra/* foundation packages — this module contributes the warehouse-specific
// domain, store binding, pages, and composite components.

export { WarehouseApp } from './WarehouseApp';
export type { WarehouseAppProps } from './WarehouseApp';

// React binding over @intra/data-kit's pipeline, exposed for the shell/tests.
export { WarehouseProvider, useWarehouse, ROLE_KEY } from './app/store';

// Navigation metadata + role adapter (mirrors @intra/rbac; single source of truth).
export { MODULES, modulesForRole, primaryModulesForRole } from './app/modules';
export type { ModuleDef } from './app/modules';
export { ROLES, ROLE_LIST, can } from './auth/roles';
export type { Capability, RoleProfile } from './auth/roles';
