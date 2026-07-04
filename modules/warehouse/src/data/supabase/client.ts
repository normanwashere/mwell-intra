import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Env adaptation (spec §12 step 2): the source read Vite's `import.meta.env`.
// The module must run under Next.js (and vitest/node), so config is read from
// `process.env` with both the Next.js (`NEXT_PUBLIC_*`) and legacy Vite
// (`VITE_*`) prefixes. In memory/demo mode none are set → `hasSupabaseConfig()`
// is false and no client is ever constructed.
//
// NOTE (parent/next agent): when the shell mounts this module it should own
// Supabase client construction and inject it (see @intra/auth + data-kit's
// `createSupabaseRepository` seam). This standalone client is retained only so
// the evidence-upload path keeps parity for the module's own live mode.

let cached: SupabaseClient | null = null;

function readEnv(key: string): string | undefined {
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key];
  }
  return undefined;
}

export function getSupabaseConfig() {
  return {
    url: readEnv('NEXT_PUBLIC_SUPABASE_URL') ?? readEnv('VITE_SUPABASE_URL'),
    anonKey:
      readEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY') ?? readEnv('VITE_SUPABASE_ANON_KEY'),
    // The app's tables live in a dedicated `warehouse` schema so they never
    // collide with other apps sharing the same Supabase project.
    schema:
      readEnv('NEXT_PUBLIC_SUPABASE_SCHEMA') ??
      readEnv('VITE_SUPABASE_SCHEMA') ??
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
