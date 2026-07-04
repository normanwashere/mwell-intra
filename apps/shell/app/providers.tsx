'use client';

// Client provider tree for the shell (spec §5, ADR-003). Owns Supabase browser
// client construction + env resolution (the @intra/auth package never builds a
// client itself). When the public Supabase env is present we run the live JWT
// contract; otherwise we fall back to `memory` mode with demo profiles so the
// app builds and runs with NO live backend.

import { useMemo, type ReactNode } from 'react';
import { SerwistProvider } from '@serwist/turbopack/react';
import { SessionProvider, type AuthConfig } from '@intra/auth';
import { ToastProvider } from '@intra/ui';
import { createSupabaseBrowserClient } from '@shell/lib/supabase/client';
import { DEMO_PROFILES } from '@shell/lib/demoProfiles';

// Prod-safety guard: if a production build somehow ships without Supabase env
// (spec §9), we render a hard error instead of silently using demo profiles.
// Escape hatch: NEXT_PUBLIC_ALLOW_DEMO_IN_PROD=true for staging previews.
function isDemoAllowed(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.NEXT_PUBLIC_ALLOW_DEMO_IN_PROD === 'true';
}

function MissingSupabaseConfig() {
  return (
    <div
      role="alert"
      className="grid min-h-screen place-items-center bg-app px-6 text-center"
    >
      <div>
        <h1 className="text-2xl font-bold text-ink">Configuration missing</h1>
        <p className="mt-3 max-w-md text-sm text-muted">
          This production build is missing NEXT_PUBLIC_SUPABASE_URL /
          NEXT_PUBLIC_SUPABASE_ANON_KEY. The suite cannot start without a live
          backend. Contact your administrator.
        </p>
      </div>
    </div>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  // Build once per mount. `createSupabaseBrowserClient` returns null with no env.
  const config = useMemo<AuthConfig | null>(() => {
    const client = createSupabaseBrowserClient();
    if (client) {
      return {
        mode: 'supabase',
        client,
        resetRedirectPath: '/reset-password',
      };
    }
    if (!isDemoAllowed()) return null;
    return { mode: 'memory', profiles: DEMO_PROFILES };
  }, []);

  if (config === null) return <MissingSupabaseConfig />;

  return (
    <SerwistProvider swUrl="/serwist/sw.js">
      <SessionProvider config={config}>
        <ToastProvider>{children}</ToastProvider>
      </SessionProvider>
    </SerwistProvider>
  );
}
