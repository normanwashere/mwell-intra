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

export function Providers({ children }: { children: ReactNode }) {
  // Build once per mount. `createSupabaseBrowserClient` returns null with no env.
  const config = useMemo<AuthConfig>(() => {
    const client = createSupabaseBrowserClient();
    if (client) {
      return {
        mode: 'supabase',
        client,
        resetRedirectPath: '/reset-password',
      };
    }
    return { mode: 'memory', profiles: DEMO_PROFILES };
  }, []);

  return (
    <SerwistProvider swUrl="/serwist/sw.js">
      <SessionProvider config={config}>
        <ToastProvider>{children}</ToastProvider>
      </SessionProvider>
    </SerwistProvider>
  );
}
