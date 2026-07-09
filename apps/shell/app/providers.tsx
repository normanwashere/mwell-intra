'use client';

// Client provider tree for the shell (spec §5, ADR-003). Owns Supabase browser
// client construction + env resolution (the @intra/auth package never builds a
// client itself). When the public Supabase env is present we run the live JWT
// contract; otherwise we fall back to `memory` mode with demo profiles so the
// app builds and runs with NO live backend.

import { useEffect, useMemo, type ReactNode } from 'react';
import { SerwistProvider } from '@serwist/turbopack/react';
import { SessionProvider, type AuthConfig } from '@intra/auth';
import { ToastProvider, MotionProvider } from '@intra/ui';
import { createSupabaseBrowserClient } from '@shell/lib/supabase/client';
import { DEMO_PROFILES } from '@shell/lib/demoProfiles';
import { DemoSeeder } from '@shell/components/DemoSeeder';
import { StorageFullToast } from '@shell/components/StorageFullToast';

// Prod-safety guard: if a production build somehow ships without Supabase env
// (spec §9), we render a hard error instead of silently using demo profiles.
// Escape hatch: NEXT_PUBLIC_ALLOW_DEMO_IN_PROD=true for staging previews.
function isDemoAllowed(): boolean {
  if (process.env.NODE_ENV !== 'production') return true;
  return process.env.NEXT_PUBLIC_ALLOW_DEMO_IN_PROD === 'true';
}

function MissingSupabaseConfig() {
  return (
    <main
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
    </main>
  );
}

// The PWA service worker is only safe when explicitly enabled for a deployed
// build. Local `next start` previews rebuild often, and a stale precache can
// leave auth pages visually present but non-interactive.
function isServiceWorkerEnabled(): boolean {
  return (
    process.env.NODE_ENV === 'production' &&
    process.env.NEXT_PUBLIC_ENABLE_SW === 'true'
  );
}

function ServiceWorkerDevCleanup() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return;
    }
    navigator.serviceWorker.getRegistrations().then((regs) => {
      if (regs.length === 0) return;
      void Promise.all([
        ...regs.map((r) => r.unregister()),
        typeof caches !== 'undefined'
          ? caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k))))
          : Promise.resolve(),
      ]).then(() => {
        // Reload once so the page is served fresh from the dev server instead
        // of the now-removed SW cache.
        window.location.reload();
      });
    });
  }, []);
  return null;
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

  const swEnabled = isServiceWorkerEnabled();

  const tree = (
    <MotionProvider>
      <SessionProvider config={config}>
        <DemoSeeder />
        <ToastProvider>
          <StorageFullToast />
          {children}
        </ToastProvider>
      </SessionProvider>
    </MotionProvider>
  );

  // Register only for explicit PWA deployments; otherwise clear stale local SWs.
  return swEnabled ? (
    <SerwistProvider swUrl="/serwist/sw.js">{tree}</SerwistProvider>
  ) : (
    <>
      <ServiceWorkerDevCleanup />
      {tree}
    </>
  );
}
