// Supabase SSR session refresh (spec §5). Runs on every matched request to keep
// the auth cookies fresh so Server Components see a valid session. This is the
// standard @supabase/ssr middleware pattern, made safe for the memory fallback:
// when the public env is absent it is a no-op passthrough (never hard-fails).

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // No live backend configured — the shell runs in memory/demo mode.
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return response;

  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Touch the user to trigger a token refresh + cookie rotation when needed.
  // Errors (offline, bad env) must not break navigation.
  try {
    await supabase.auth.getUser();
  } catch {
    // Ignore — treat as unauthenticated; routes gate access themselves.
  }

  return response;
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
