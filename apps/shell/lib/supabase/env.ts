// Central, side-effect-free resolution of the public Supabase env (spec §9).
//
// The shell must build and run with NO live backend (memory fallback), so every
// consumer treats these as optional. `hasSupabaseEnv` gates whether we attempt
// the live JWT contract at all.

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** The default schema for shell-level (core) reads (spec §9, invariant §6.4). */
export const DEFAULT_SCHEMA = 'core' as const;

/** True only when both public Supabase vars are present and non-empty. */
export function hasSupabaseEnv(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
