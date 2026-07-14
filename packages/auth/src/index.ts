// @intra/auth — Step 1c (spec §5, ADR-003).
//
// SessionProvider (dual-mode: supabase JWT / memory demo), useSession(), the
// pure `parseUserRolesFromClaims` helper, and the scoped <Guard module cap> +
// useCan(). Client components are marked 'use client'; the pure claim helpers
// and types are safe to import from server components.
//
// The Supabase client is INJECTED via provider config (never constructed here),
// so this package is portable across Next.js RSC/client boundaries — the shell
// (Step 1f) owns client creation, env, and cookie/session strategy.

export { SessionProvider, useSession } from './SessionProvider';
export type {
  AuthConfig,
  SupabaseAuthConfig,
  MemoryAuthConfig,
} from './SessionProvider';

export { Guard, useCan } from './Guard';
export type { GuardProps } from './Guard';

export {
  parseUserRolesFromClaims,
  parseUserCapabilitiesFromClaims,
  parseKindFromClaims,
  profileFromUser,
} from './claims';

export type {
  AuthMode,
  ProfileKind,
  SessionProfile,
  MemoryProfile,
  SessionValue,
  UserCapabilities,
} from './contracts';
