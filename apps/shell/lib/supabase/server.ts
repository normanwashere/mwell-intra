// Server Supabase client factory (spec §5, §9). Reads/writes the session via
// Next 16's async `cookies()`. Kept thin; schema is pinned per-call (`core` for
// shell-level reads). Returns `null` when env is absent so RSC/route handlers
// can degrade gracefully instead of throwing at build/render time.

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { DEFAULT_SCHEMA, SUPABASE_ANON_KEY, SUPABASE_URL } from './env';
import type { ShellDatabase, ShellSupabaseClient } from './types';

export async function createSupabaseServerClient(
  schema: string = DEFAULT_SCHEMA,
): Promise<ShellSupabaseClient | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  const cookieStore = await cookies();

  return createServerClient<ShellDatabase, string>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `setAll` was called from a Server Component (cookies are read-only
          // there). Safe to ignore when middleware refreshes the session.
        }
      },
    },
  });
}
