// Pure, unit-testable JWT-claim parsing (spec §5).
//
// SECURITY: authorization roles come ONLY from the trusted `app_metadata` claim
// on the verified session/JWT — never from client-provided fields or localStorage.
// Everything here is tolerant of partial/garbage input and coerces to a valid
// `Partial<UserRoles>`; unknown modules and non-string roles are dropped.

import type { User } from '@supabase/supabase-js';
import type { UserRoles } from '@intra/rbac';
import { MODULE_LIST } from '@intra/rbac';
import type {
  ProfileKind,
  SessionProfile,
  UserCapabilities,
} from './contracts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Coerce an arbitrary value into a clean, de-duplicated list of role strings. */
function coerceRoleList(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    const roles = value
      .filter((role): role is string => typeof role === 'string')
      .map((role) => role.trim())
      .filter((role) => role.length > 0);
    return Array.from(new Set(roles));
  }
  return [];
}

function resolveCapabilitiesSource(
  claims: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (isRecord(claims.capabilities)) return claims.capabilities;
  if (
    isRecord(claims.app_metadata) &&
    isRecord(claims.app_metadata.capabilities)
  ) {
    return claims.app_metadata.capabilities;
  }
  return MODULE_LIST.some((module) => module in claims) ? claims : undefined;
}

/** Parse a claim or core.my_capabilities() projection without trusting unknown modules. */
export function parseUserCapabilitiesFromClaims(
  claims: unknown,
): UserCapabilities {
  if (!isRecord(claims)) return {};
  const source = resolveCapabilitiesSource(claims);
  if (!source) return {};

  const result: UserCapabilities = {};
  for (const module of MODULE_LIST) {
    const capabilities = coerceRoleList(source[module]);
    if (capabilities.length > 0) result[module] = capabilities;
  }
  return result;
}

/**
 * Locate the `roles` object whether we were handed the whole JWT payload/user
 * (has `app_metadata.roles`) or the `app_metadata` object directly (has `roles`).
 */
function resolveRolesSource(claims: Record<string, unknown>): unknown {
  if (isRecord(claims.roles)) return claims.roles;
  if (isRecord(claims.app_metadata) && isRecord(claims.app_metadata.roles)) {
    return claims.app_metadata.roles;
  }
  return undefined;
}

/**
 * Parse the scoped `app_metadata.roles` snapshot into a validated
 * `Partial<UserRoles>` (spec §5). Tolerant of missing/partial/garbage claims:
 * only known modules (`MODULE_LIST`) with at least one non-empty string role are
 * included. Accepts either the full claims object or the `app_metadata` object.
 */
export function parseUserRolesFromClaims(claims: unknown): Partial<UserRoles> {
  if (!isRecord(claims)) return {};
  const source = resolveRolesSource(claims);
  if (!isRecord(source)) return {};

  const result: Partial<UserRoles> = {};
  for (const module of MODULE_LIST) {
    const roles = coerceRoleList(source[module]);
    if (roles.length > 0) {
      result[module] = roles;
    }
  }
  return result;
}

/**
 * Parse the profile tier from claims. Defaults to `'employee'` (matches
 * `core.profiles.kind` default, spec §4.1) for anything but an explicit
 * `'vendor'`. Accepts either the full claims object or `app_metadata`.
 */
export function parseKindFromClaims(claims: unknown): ProfileKind {
  if (!isRecord(claims)) return 'employee';
  let kind: unknown = claims.kind;
  if (kind === undefined && isRecord(claims.app_metadata)) {
    kind = claims.app_metadata.kind;
  }
  return kind === 'vendor' ? 'vendor' : 'employee';
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Project a verified Supabase `User` into a `SessionProfile`. Identity/tier come
 * from the trusted `app_metadata`; display fields come from `user_metadata`
 * (best-effort). Roles are parsed separately via `parseUserRolesFromClaims`.
 */
export function profileFromUser(user: User): SessionProfile {
  const appMeta: Record<string, unknown> = isRecord(user.app_metadata)
    ? user.app_metadata
    : {};
  const userMeta: Record<string, unknown> = isRecord(user.user_metadata)
    ? user.user_metadata
    : {};

  return {
    id: user.id,
    email: user.email ?? '',
    kind: parseKindFromClaims(appMeta),
    name: stringOrUndefined(userMeta.name) ?? stringOrUndefined(userMeta.full_name),
    title: stringOrUndefined(userMeta.title),
    vendorId: stringOrUndefined(appMeta.vendor_id),
  };
}
