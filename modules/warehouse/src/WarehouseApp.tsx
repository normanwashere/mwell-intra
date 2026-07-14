'use client';

// WarehouseApp — the single mountable client entry for the warehouse module
// (spec §12 step 2). The Next.js shell renders this under a catch-all route
// (e.g. `/warehouse/[[...slug]]`) inside its own <SessionProvider>; this
// component owns the client-side router (react-router, preserved from the source
// SPA), the theme/toast/data providers, and every warehouse route.
//
// Session → active role: the module READS the shell's session. A user's
// warehouse role(s) come from `useSession().userRoles.warehouse`; the first is
// used as the store's initial role, and (in demo/memory mode) the UserMenu lets
// them switch among the roles their session carries. Authorization is delegated
// to @intra/rbac via the local `can()` adapter — one source of truth.

import { useEffect, useLayoutEffect, useState } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { SignInPrompt, SkeletonList, SkeletonStats } from '@intra/ui';
import { isWarehouseRole } from '@intra/data-kit';
import { useSession } from '@/auth/session';
import { ThemeProvider } from '@/app/theme';
import { WarehouseProvider } from '@/app/store';
import { App } from '@/app/App';
import { PwaPrompts } from '@/components/PwaPrompts';

/**
 * React Router v6 refuses to match an exact basename URL before the trailing
 * slash exists. Bare visits to `/warehouse` render BLANK with a console warning:
 *   `<Router basename="/warehouse"> is not able to match the URL "/"`.
 * Keep BrowserRouter unmounted until the URL is normalized to `/warehouse/`.
 */
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

function useNormalizeBasenamePath(basename: string): boolean {
  const [ready, setReady] = useState(
    () =>
      typeof window === 'undefined' || window.location.pathname !== basename,
  );

  useIsomorphicLayoutEffect(() => {
    if (typeof window === 'undefined') return;
    const current = window.location.pathname;
    if (current === basename) {
      const next = `${basename}/${window.location.search}${window.location.hash}`;
      window.history.replaceState(window.history.state, '', next);
    }
    setReady(true);
  }, [basename]);

  return ready;
}

function WarehouseBootSkeleton() {
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-6" aria-busy="true">
      <SkeletonStats />
      <SkeletonList rows={5} />
    </main>
  );
}

export interface WarehouseAppProps {
  /** Path prefix the shell mounts this module under (default `/warehouse`). */
  basename?: string;
}

/**
 * Mount point for the entire warehouse experience. Assumes it is rendered inside
 * the shell's `<SessionProvider>` (that is where the identity + roles come from).
 */
export function WarehouseApp({ basename = '/warehouse' }: WarehouseAppProps) {
  const basenameReady = useNormalizeBasenamePath(basename);
  const { profile, userRoles, mode, supabaseClient, loading } = useSession();
  const warehouseRoles = (userRoles.warehouse ?? []).filter(isWarehouseRole);
  const initialRole = warehouseRoles[0];

  // Session still restoring → paint a lightweight skeleton instead of a
  // blank frame (or, worse, a flash of the access-denied notice).
  if (!basenameReady || loading) {
    return <WarehouseBootSkeleton />;
  }

  // Signed out entirely → prompt to sign in (deep-links back here).
  if (!profile) {
    return (
      <main>
        <SignInPrompt module="Warehouse" basename={basename} />
      </main>
    );
  }

  // No warehouse role on the session → the module isn't part of this user's
  // access. Render a friendly notice rather than a blank screen.
  if (!initialRole) {
    return (
      <main
        role="alert"
        className="grid min-h-[60vh] place-items-center bg-app p-6 text-center"
      >
        <div className="max-w-sm space-y-3">
          <h1 className="text-lg font-bold text-ink">No warehouse access</h1>
          <p className="text-sm text-muted">
            Your account doesn&apos;t include a warehouse role. If you think
            this is a mistake, contact your administrator.
          </p>
          <a
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-app"
          >
            Back to dashboard
          </a>
        </div>
      </main>
    );
  }

  return (
    <BrowserRouter
      basename={basename}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      {/* No nested ToastProvider — the shell's root Providers already mounts
          one; nesting a second rendered a duplicate toast viewport. */}
      <ThemeProvider>
        <WarehouseProvider
          key={profile?.id ?? initialRole}
          initialRole={initialRole}
          actor={profile?.email}
          identityId={profile?.id}
          source={mode}
          supabaseClient={supabaseClient ?? undefined}
        >
          <App />
          <PwaPrompts />
        </WarehouseProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
