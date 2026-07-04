// Structural contracts for scoped, multi-role RBAC (spec §4.2, ADR-003).
//
// Unlike the warehouse app's flat single-role model (`src/auth/roles.ts` in
// mwell-intra-warehouse), the suite RBAC is scoped PER MODULE: a user can hold
// different roles in different modules. These base types carry NO module-specific
// unions so module matrices can import them without a circular dependency.

/** A department schema/module in the suite (spec §3, §4.2). */
export type Module = 'core' | 'warehouse' | 'procurement' | 'legal';

/** Ordered list of every module; `core` first to match migration order (§6.8). */
export const MODULE_LIST = [
  'core',
  'warehouse',
  'procurement',
  'legal',
] as const satisfies readonly Module[];

/** One role's capability grant within a module. */
export interface RoleDefinition<Cap extends string> {
  /** Human-readable label for UI (role picker, admin screens). */
  readonly label: string;
  /** Short description of what the role can do. */
  readonly description: string;
  /**
   * Marks a starter matrix that is expected to change once the owning module's
   * feature MVP lands. Provisional roles/caps must not be treated as frozen API.
   */
  readonly provisional?: boolean;
  /** The capabilities granted to this role (a subset of the module catalogue). */
  readonly capabilities: readonly Cap[];
}

/** A module's full capability catalogue + its role → capability matrix. */
export interface ModuleDefinition<
  Mod extends Module,
  RoleName extends string,
  Cap extends string,
> {
  readonly module: Mod;
  readonly label: string;
  /** True while the whole module matrix is a provisional starter set. */
  readonly provisional?: boolean;
  /** Every capability this module recognises. */
  readonly capabilities: readonly Cap[];
  /** role → { label, description, capabilities }. */
  readonly roles: Readonly<Record<RoleName, RoleDefinition<Cap>>>;
}

/**
 * A single flattened grant, mirrored 1:1 into the DB `core.role_capabilities`
 * table (spec §4.2). `role`/`cap` are widened to `string` here because this
 * shape spans all modules; per-module type-safety is enforced by `can()`.
 */
export interface RoleCapabilityRow {
  readonly module: Module;
  readonly role: string;
  readonly cap: string;
}

/**
 * The roles a user holds, keyed by module — matches the JWT
 * `app_metadata.roles` snapshot (spec §5). Real JWTs are often partial (only the
 * modules a user participates in), so predicates accept `Partial<UserRoles>`.
 */
export type UserRoles = Record<Module, string[]>;
