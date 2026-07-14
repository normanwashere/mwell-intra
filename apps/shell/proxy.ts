// Supabase SSR session refresh + live-mode route gate (spec §5).
//
// Runs on every matched request to (1) keep the auth cookies fresh so Server
// Components see a valid session — the standard @supabase/ssr middleware
// pattern — and (2) in LIVE mode, redirect unauthenticated requests for
// protected paths to /login before any page code runs.
//
// Memory/demo mode (no Supabase public env) stays a no-op passthrough: demo
// auth is client-side, so the middleware must never hard-fail or gate there.

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const DATA_SOURCE = process.env.NEXT_PUBLIC_DATA_SOURCE;

// Paths reachable WITHOUT a session in live mode. Everything else is gated.
const PUBLIC_PATHS = [
  '/login',
  '/reset-password',
  '/api/health',
  '/serwist',
  '/manifest.webmanifest',
  '/~offline',
];

function isPublicPath(pathname: string): boolean {
  if (pathname.startsWith('/_next')) return true;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return true;
  }
  // Static assets (the matcher already skips most; belt-and-suspenders for
  // service-worker/scripts and any extension the matcher regex misses).
  return /\.(?:svg|png|jpg|jpeg|gif|webp|ico|js|mjs|css|map|txt|json|woff2?)$/i.test(pathname);
}

// Only a same-origin PATHNAME may round-trip through ?redirect= — never a
// scheme or protocol-relative URL ("//evil.example"), so the login page can
// safely `router.replace(redirect)` without an open-redirect hole.
function sanitizeRedirectPath(pathname: string): string {
  if (!pathname.startsWith('/') || pathname.startsWith('//') || pathname.includes('://')) {
    return '/';
  }
  return pathname;
}

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/warehouse/finance') {
    const destination = request.nextUrl.clone();
    destination.pathname = '/finance';
    return NextResponse.redirect(destination, 308);
  }

  let response = NextResponse.next({ request });

  // No live backend configured — the shell runs in memory/demo mode.
  if (DATA_SOURCE === 'memory') return response;
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
  let user: unknown = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // Ignore — treated as unauthenticated below.
  }

  const { pathname } = request.nextUrl;
  if (!user && !isPublicPath(pathname)) {
    const loginUrl = new URL('/login', request.url);
    const redirectTo = sanitizeRedirectPath(pathname);
    if (redirectTo !== '/') loginUrl.searchParams.set('redirect', redirectTo);
    const redirect = NextResponse.redirect(loginUrl);
    // Carry any freshly-rotated auth cookies onto the redirect response.
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  }

  return response;
}

export const config = {
  // Run on everything except Next internals and static assets.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
