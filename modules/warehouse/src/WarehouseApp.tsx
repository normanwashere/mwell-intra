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

import { BrowserRouter } from 'react-router-dom';
import { ToastProvider } from '@intra/ui';
import type { Role } from '@intra/data-kit';
import { useSession } from '@/auth/session';
import { ThemeProvider } from '@/app/theme';
import { WarehouseProvider } from '@/app/store';
import { App } from '@/app/App';
import { PwaPrompts } from '@/components/PwaPrompts';

export interface WarehouseAppProps {
  /** Path prefix the shell mounts this module under (default `/warehouse`). */
  basename?: string;
}

/**
 * Mount point for the entire warehouse experience. Assumes it is rendered inside
 * the shell's `<SessionProvider>` (that is where the identity + roles come from).
 */
export function WarehouseApp({ basename = '/warehouse' }: WarehouseAppProps) {
  const { profile, userRoles } = useSession();
  const warehouseRoles = (userRoles.warehouse ?? []) as Role[];
  const initialRole = warehouseRoles[0];

  // No warehouse role on the session → the module isn't part of this user's
  // access. Render a friendly notice rather than a blank screen.
  if (!initialRole) {
    return (
      <div
        role="alert"
        className="grid min-h-[40vh] place-items-center p-6 text-center"
      >
        <div>
          <h1 className="text-lg font-bold text-ink">No warehouse access</h1>
          <p className="mt-2 max-w-sm text-sm text-muted">
            Your account doesn&apos;t include a warehouse role. If you think this is
            a mistake, contact your administrator.
          </p>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter
      basename={basename}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <ThemeProvider>
        <ToastProvider>
          <WarehouseProvider
            key={profile?.id ?? initialRole}
            initialRole={initialRole}
            actor={profile?.email}
          >
            <App />
            <PwaPrompts />
          </WarehouseProvider>
        </ToastProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}
