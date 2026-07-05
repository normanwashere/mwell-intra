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

import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { SignInPrompt, SkeletonList, SkeletonStats } from '@intra/ui';
import type { Role } from '@intra/data-kit';
import { useSession } from '@/auth/session';
import { ThemeProvider } from '@/app/theme';
import { WarehouseProvider } from '@/app/store';
import { App } from '@/app/App';
import { PwaPrompts } from '@/components/PwaPrompts';

/**
 * React Router v6 refuses to match "/" against a basename when the URL exactly
 * equals the basename with no trailing slash (browser normalizes it to "").
 * Bare visits to `/warehouse` render BLANK with a console warning:
 *   `<Router basename="/warehouse"> is not able to match the URL "/"`.
 * We normalize by appending a trailing slash BEFORE the router mounts, which
 * makes the effective internal URL `/` (the Dashboard route).
 */
function useNormalizeBasenamePath(basename: string): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const current = window.location.pathname;
    if (current === basename) {
      const next = `${basename}/${window.location.search}${window.location.hash}`;
      window.history.replaceState(window.history.state, '', next);
    }
  }, [basename]);
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
  useNormalizeBasenamePath(basename);
  const { profile, userRoles, loading } = useSession();
  const warehouseRoles = (userRoles.warehouse ?? []) as Role[];
  const initialRole = warehouseRoles[0];

  // Session still restoring → paint a lightweight skeleton instead of a
  // blank frame (or, worse, a flash of the access-denied notice).
  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6" aria-busy="true">
        <SkeletonStats />
        <SkeletonList rows={5} />
      </div>
    );
  }

  // Signed out entirely → prompt to sign in (deep-links back here).
  if (!profile) {
    return <SignInPrompt module="Warehouse" basename={basename} />;
  }

  // No warehouse role on the session → the module isn't part of this user's
  // access. Render a friendly notice rather than a blank screen.
  if (!initialRole) {
    return (
      <div
        role="alert"
        className="grid min-h-[60vh] place-items-center bg-app p-6 text-center"
      >
        <div className="max-w-sm space-y-3">
          <h1 className="text-lg font-bold text-ink">No warehouse access</h1>
          <p className="text-sm text-muted">
            Your account doesn&apos;t include a warehouse role. If you think this
            is a mistake, contact your administrator.
          </p>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-app"
          >
            Back to dashboard
          </a>
        </div>
      </div>
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
        >
          <App />
          <PwaPrompts />
        </WarehouseProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
