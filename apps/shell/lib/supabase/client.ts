// Browser Supabase client factory (spec §5, §9). Thin: constructs a cookie-aware
// browser client via @supabase/ssr so the SSR middleware and the client share
// one session. Schema is pinned per-call (`core` for shell-level reads; modules
// pass their own domain schema later).

import { createBrowserClient } from '@supabase/ssr';
import {
  DEFAULT_SCHEMA,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  forceMemoryMode,
} from './env';
import type { ShellDatabase, ShellSupabaseClient } from './types';

const NETWORK_ERROR_RESPONSE = JSON.stringify({
  message: 'Network request failed. Please check your connection and try again.',
  error: 'network_error',
});

async function supabaseFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'AbortError' || error instanceof TypeError) {
      return new Response(NETWORK_ERROR_RESPONSE, {
        status: 503,
        statusText: 'Supabase network unavailable',
        headers: { 'Content-Type': 'application/json' },
      });
    }
    throw error;
  }
}

/**
 * Construct the browser Supabase client. Returns `null` when the public env is
 * absent so callers can fall back to memory/demo mode without throwing — the
 * shell must work with no live backend (build/dev requirement).
 */
export function createSupabaseBrowserClient(
  schema: string = DEFAULT_SCHEMA,
): ShellSupabaseClient | null {
  if (forceMemoryMode()) return null;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  return createBrowserClient<ShellDatabase, string>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema },
    global: { fetch: supabaseFetch },
  });
}
