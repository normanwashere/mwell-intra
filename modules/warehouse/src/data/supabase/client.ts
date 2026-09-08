import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Env adaptation (spec §12 step 2): the source read Vite's `import.meta.env`.
// The module must run under Next.js (and vitest/node), so config is read from
// `process.env` with both the Next.js (`NEXT_PUBLIC_*`) and legacy Vite
// (`VITE_*`) prefixes. In memory/demo mode none are set → `hasSupabaseConfig()`
// is false and no client is ever constructed.
//
// Legacy standalone adapter only. Evidence uses the authenticated client from
// @intra/auth and must never construct a second auth client here.

let cached: SupabaseClient | null = null;

export function getSupabaseConfig() {
  // Next only inlines literal public environment property accesses.
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
    anonKey:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY,
    // The app's tables live in a dedicated `warehouse` schema so they never
    // collide with other apps sharing the same Supabase project.
    schema:
      process.env.NEXT_PUBLIC_SUPABASE_SCHEMA ??
      process.env.VITE_SUPABASE_SCHEMA ??
      'warehouse',
  };
}

export function hasSupabaseConfig(): boolean {
  const { url, anonKey } = getSupabaseConfig();
  return Boolean(url && anonKey);
}

/** Returns a singleton Supabase client, or throws if env is missing. */
export function getSupabaseClient(): SupabaseClient {
  if (cached) return cached;
  const { url, anonKey, schema } = getSupabaseConfig();
  if (!url || !anonKey) {
    throw new Error(
      'Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.',
    );
  }
  cached = createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
    db: { schema },
  }) as SupabaseClient;
  return cached;
}
