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
import type { ProductCapability, ProductRole } from './modules/product';
import { productModule } from './modules/product';

/** Maps each module to its own capability union (used for type-safe `can()`). */
export interface ModuleCapabilityMap {
  core: CoreCapability;
  warehouse: WarehouseCapability;
  procurement: ProcurementCapability;
  legal: LegalCapability;
  events: EventsCapability;
  insights: InsightsCapability;
  product: ProductCapability;
}

/** Maps each module to its own role union. */
export interface ModuleRoleMap {
  core: CoreRole;
  warehouse: WarehouseRegistryRole;
  procurement: ProcurementRole;
  legal: LegalRole;
  events: EventsRole;
  insights: InsightsRole;
  product: ProductRole;
}

/** The capability union valid within a given module. */
export type CapabilityFor<M extends Module> = ModuleCapabilityMap[M];
/** The role union valid within a given module. */
export type RoleFor<M extends Module> = ModuleRoleMap[M];
/** Every capability across every module. */
export type Capability = ModuleCapabilityMap[Module];
/** Every role across every module. */
export type Role = ModuleRoleMap[Module];

export type CapabilityAccess = 'read' | 'mutation';

/**
 * The authoritative onboarding/enforcement classification for every RBAC
 * capability. Keeping it next to the registry prevents learning from making
 * an independent access decision and preserves ungated read-only exploration.
 */
export interface CapabilityClassification {
  readonly module: Module;
  readonly capability: string;
  readonly access: CapabilityAccess;
}

/** The registry of all module matrices, keyed by module. */
export const MODULES = {
  core: coreModule,
  warehouse: warehouseModule,
  procurement: procurementModule,
  legal: legalModule,
  events: eventsModule,
  insights: insightsModule,
  product: productModule,
} as const;

const readCapability = (
  module: Module,
  capability: string,
): CapabilityClassification => ({ module, capability, access: 'read' });

const mutationCapability = (
  module: Module,
  capability: string,
): CapabilityClassification => ({ module, capability, access: 'mutation' });

export const CAPABILITY_CLASSIFICATIONS: readonly CapabilityClassification[] = [
  readCapability('core', 'view_directory'),
  mutationCapability('core', 'manage_rbac'),
  readCapability('core', 'view_vendors'),
  mutationCapability('core', 'manage_vendors'),
  mutationCapability('core', 'manage_accreditation'),
  readCapability('core', 'view_documents'),
  mutationCapability('core', 'manage_documents'),
  mutationCapability('core', 'submit_documents'),
  mutationCapability('core', 'submit_accreditation'),
  readCapability('core', 'view_own_accreditation'),
  readCapability('core', 'view_approvals'),
  mutationCapability('core', 'manage_approvals'),
  mutationCapability('core', 'record_approval'),
  readCapability('core', 'view_audit'),
  mutationCapability('core', 'manage_notifications'),
  readCapability('warehouse', 'view_dashboard'),
  readCapability('warehouse', 'view_inventory'),
  mutationCapability('warehouse', 'receive_stock'),
  mutationCapability('warehouse', 'manage_inventory'),
  mutationCapability('warehouse', 'manage_products'),
  mutationCapability('warehouse', 'manage_locations'),
  mutationCapability('warehouse', 'cycle_count'),
  mutationCapability('warehouse', 'manage_returns'),
  mutationCapability('warehouse', 'request_fulfillment'),
  mutationCapability('warehouse', 'request_stock'),
  mutationCapability('warehouse', 'submit_return_case'),
  mutationCapability('warehouse', 'reserve_allocate'),
  mutationCapability('warehouse', 'issue_items'),
  mutationCapability('warehouse', 'transfer_stock'),
  readCapability('warehouse', 'view_finance'),
  mutationCapability('warehouse', 'manage_finance_close'),
  readCapability('warehouse', 'view_analytics'),
  readCapability('warehouse', 'view_procurement'),
  readCapability('warehouse', 'view_pricing'),
  mutationCapability('warehouse', 'set_pricing'),
  mutationCapability('warehouse', 'manage_operation_routes'),
  mutationCapability('warehouse', 'inspect_quality'),
  mutationCapability('warehouse', 'release_quality_hold'),
  mutationCapability('warehouse', 'approve_stock_adjustment'),
  mutationCapability('warehouse', 'approve_stock_adjustment_finance'),
  readCapability('warehouse', 'view_exceptions'),
  mutationCapability('warehouse', 'resolve_exceptions'),
  mutationCapability('warehouse', 'import_warehouse_data'),
  readCapability('procurement', 'view_dashboard'),
  mutationCapability('procurement', 'create_request'),
  mutationCapability('procurement', 'manage_rfp'),
  mutationCapability('procurement', 'author_po'),
  mutationCapability('procurement', 'approve_request'),
  mutationCapability('procurement', 'approve_award'),
  mutationCapability('procurement', 'manage_vendors'),
  readCapability('procurement', 'view_finance'),
  mutationCapability('procurement', 'admin'),
  readCapability('legal', 'view_dashboard'),
  mutationCapability('legal', 'review_accreditation'),
  mutationCapability('legal', 'manage_checklist'),
  mutationCapability('legal', 'approve_accreditation'),
  mutationCapability('legal', 'manage_documents'),
  mutationCapability('legal', 'manage_doa'),
  mutationCapability('legal', 'admin'),
  readCapability('events', 'view_events'),
  mutationCapability('events', 'create_event'),
  mutationCapability('events', 'manage_events'),
  mutationCapability('events', 'request_fulfillment'),
  mutationCapability('events', 'close_event'),
  mutationCapability('events', 'approve_settlement'),
  mutationCapability('events', 'admin'),
  readCapability('insights', 'view_warehouse'),
  readCapability('insights', 'view_procurement'),
  readCapability('insights', 'view_legal'),
  readCapability('insights', 'view_finance'),
  readCapability('insights', 'view_executive'),
  readCapability('insights', 'prepare_exports'),
  mutationCapability('insights', 'admin'),
  readCapability('product', 'view_readiness'),
  mutationCapability('product', 'prepare_readiness'),
  mutationCapability('product', 'decide_go_live'),
  mutationCapability('product', 'acknowledge_operations_handoff'),
  readCapability('product', 'view_pricing'),
  mutationCapability('product', 'propose_pricing'),
  mutationCapability('product', 'approve_pricing'),
];

function capabilityKey(module: Module, capability: string): string {
  return `${module}:${capability}`;
}

function validateCapabilityClassifications(): void {
  const registryKeys = new Set(
    MODULE_LIST.flatMap((module) =>
      MODULES[module].capabilities.map((capability) =>
        capabilityKey(module, capability),
      ),
    ),
  );
  const classificationKeys = CAPABILITY_CLASSIFICATIONS.map((item) =>
    capabilityKey(item.module, item.capability),
  );

  if (new Set(classificationKeys).size !== classificationKeys.length) {
    throw new Error('RBAC capability classifications must be unique.');
  }
  if (
    classificationKeys.length !== registryKeys.size ||
    classificationKeys.some((key) => !registryKeys.has(key))
  ) {
    throw new Error(
      'RBAC capability classifications must cover every declared capability exactly once.',
    );
  }
}

validateCapabilityClassifications();

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
    product: [],
  };
}
