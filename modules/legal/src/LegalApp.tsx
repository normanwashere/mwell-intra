'use client';

import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '@intra/ui';
import { useSession } from '@intra/auth';
import { can } from '@intra/rbac';
import { AccreditationCasesPage } from './pages/AccreditationCasesPage';

export interface LegalAppProps {
  /** Path prefix the shell mounts this module under (default `/legal`). */
  basename?: string;
}

// See WarehouseApp for the react-router basename normalization rationale.
function useNormalizeBasenamePath(basename: string): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.location.pathname === basename) {
      const next = `${basename}/${window.location.search}${window.location.hash}`;
      window.history.replaceState(window.history.state, '', next);
    }
  }, [basename]);
}

export function LegalApp({ basename = '/legal' }: LegalAppProps) {
  useNormalizeBasenamePath(basename);
  const { userRoles, profile, loading, signOut } = useSession();
  const isVendor = profile?.kind === 'vendor';
  const hasInternalAccess = can(userRoles, 'legal', 'view_dashboard');
  // External vendor tier lives in core (reconciled 2026-07-05, ADR-002 #3).
  const hasVendorAccess = can(userRoles, 'core', 'view_own_accreditation');
  if (loading) return null;

  if (isVendor ? !hasVendorAccess : !hasInternalAccess) {
    return (
      <div
        role="alert"
        className="grid min-h-[60vh] place-items-center bg-app p-6 text-center"
      >
        <div className="max-w-sm space-y-3">
          <h1 className="text-lg font-bold text-ink">No legal access</h1>
          <p className="text-sm text-muted">
            {isVendor
              ? 'This vendor account is not enrolled in accreditation yet. Contact your Mwell account manager.'
              : "Your account doesn't include a legal role. Contact your administrator if you need access."}
          </p>
          <a
            href={isVendor ? '/login' : '/'}
            className="inline-flex items-center justify-center rounded-xl bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-app"
          >
            {isVendor ? 'Sign in with a different account' : 'Back to dashboard'}
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
      <ToastProvider>
        {isVendor && <VendorChrome profileName={profile?.name ?? profile?.email ?? 'Vendor'} onSignOut={signOut} />}
        <Routes>
          <Route path="/" element={<AccreditationCasesPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}

/**
 * Minimal vendor-tier chrome: the shell's AppShell is intentionally hidden for
 * `/vendor/*` (ChromeGate skips it), so this component gives external vendors
 * an identity banner + sign-out. Without it, vendors are stranded with no way
 * to leave their session or navigate.
 */
function VendorChrome({
  profileName,
  onSignOut,
}: {
  profileName: string;
  onSignOut: () => Promise<void>;
}) {
  return (
    <header
      className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 md:px-6"
      aria-label="Vendor portal chrome"
    >
      <div className="min-w-0">
        <p className="text-[0.7rem] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
          Vendor portal
        </p>
        <p className="mt-0.5 truncate text-sm font-semibold text-ink" title={profileName}>
          {profileName}
        </p>
        <p className="mt-0.5 text-xs text-muted">
          You&apos;re seeing only your organization&apos;s data.
        </p>
      </div>
      <button
        type="button"
        onClick={() => void onSignOut().then(() => {
          if (typeof window !== 'undefined') window.location.assign('/login');
        })}
        className="rounded-xl border border-line px-3 py-1.5 text-sm font-semibold text-ink transition hover:bg-inset focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        Sign out
      </button>
    </header>
  );
}
