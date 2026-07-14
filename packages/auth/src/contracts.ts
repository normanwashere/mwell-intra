// Structural contracts for @intra/auth (spec §5, ADR-003).
//
// These are runtime-agnostic types (no React, no Supabase construction) so they
// are safe to import from server components, client components, and tests.

import type { Module, UserRoles } from '@intra/rbac';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Which auth backend the SessionProvider resolved. */
export type AuthMode = 'supabase' | 'memory';

/** Profile tier — internal employee vs external vendor contact (spec §4.1). */
export type ProfileKind = 'employee' | 'vendor';

/** Effective capabilities projected by core.my_capabilities() for live UX gates. */
export type UserCapabilities = Partial<Record<Module, readonly string[]>>;

/**
 * The signed-in identity, projected from the verified session/JWT. Roles are
 * intentionally NOT on the profile — authorization lives in `userRoles` so it is
 * always sourced from the trusted `app_metadata`, never from a spoofable field.
 */
export interface SessionProfile {
  readonly id: string;
  readonly email: string;
  readonly kind: ProfileKind;
  readonly name?: string;
  readonly title?: string;
  /** Set when `kind === 'vendor'`; scopes vendor-tier RLS (spec §5). */
  readonly vendorId?: string;
}

/**
 * A demo/tests-only identity for `memory` mode. Mirrors the warehouse role-tile
 * intent (LLD §10): a static profile plus the roles it should carry. NEVER used
 * for the live contract — it never establishes a real session.
 */
export interface MemoryProfile extends SessionProfile {
  /** Scoped roles by module that drive `can()` while in memory/demo mode. */
  readonly roles: Partial<UserRoles>;
}

/** The value exposed by `useSession()`. */
export interface SessionValue {
  /** The signed-in identity, or `null` when unauthenticated. */
  profile: SessionProfile | null;
  /**
   * Scoped roles parsed from the trusted `app_metadata.roles` claim (spec §5).
   * Partial because real JWTs only carry the modules a user participates in.
   */
  userRoles: Partial<UserRoles>;
  /** Fresh database projection used for Supabase-mode UX gates. */
  userCapabilities?: UserCapabilities;
  /** The resolved auth backend. */
  mode: AuthMode;
  /**
   * Authenticated Supabase browser client when `mode === 'supabase'`.
   * Module data adapters use this client to call their schema-scoped RLS/RPC
   * contract instead of falling back to browser storage.
   */
  supabaseClient: SupabaseClient<Record<string, unknown>, string> | null;
  /** True while the initial session is being restored (supabase mode). */
  loading: boolean;
  /** True while an interactive sign-in is in flight. */
  signingIn: boolean;
  /** Last auth error message, surfaced on the login/reset screens. */
  authError: string | null;
  /** Demo tiles for memory mode (empty in supabase mode). */
  memoryProfiles: MemoryProfile[];
  /** Establish a session with email + password. Resolves true when verified. */
  signInWithPassword: (email: string, password: string) => Promise<boolean>;
  /** Clear the session locally and on the server. */
  signOut: () => Promise<void>;
  /** Send a password-reset email (supabase mode only). */
  resetPassword: (email: string) => Promise<void>;
  /** Change the signed-in user's password (supabase mode only). */
  changePassword: (password: string) => Promise<void>;
}
