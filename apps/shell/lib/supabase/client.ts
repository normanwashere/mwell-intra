// Browser Supabase client factory (spec §5, §9). Thin: constructs a cookie-aware
// browser client via @supabase/ssr so the SSR middleware and the client share
// one session. Schema is pinned per-call (`core` for shell-level reads; modules
// pass their own domain schema later).

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_SCHEMA, SUPABASE_ANON_KEY, SUPABASE_URL } from './env';

/**
 * Construct the browser Supabase client. Returns `null` when the public env is
 * absent so callers can fall back to memory/demo mode without throwing — the
 * shell must work with no live backend (build/dev requirement).
 */
export function createSupabaseBrowserClient(
  schema: string = DEFAULT_SCHEMA,
): SupabaseClient<any, string> | null {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema },
  });
}
