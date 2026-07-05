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
 * Vendor-tier chrome: the shell's AppShell is intentionally hidden for
 * `/vendor/*` (ChromeGate skips it), so this component gives external vendors
 * a branded identity strip + sign-out. Kept intentionally compact (a strip,
 * not a full sidebar) so the page's own <ModuleHero> is the visual anchor.
 */
function VendorChrome({
  profileName,
  onSignOut,
}: {
  profileName: string;
  onSignOut: () => Promise<void>;
}) {
  const initials = profileName
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('') || 'V';
  return (
    <header
      className="safe-top sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur"
      aria-label="Vendor portal chrome"
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-grad text-sm font-bold text-white shadow-soft"
          >
            {initials}
          </span>
          <div className="min-w-0">
            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">
              Mwell Intra · Vendor portal
            </p>
            <p className="truncate text-sm font-semibold text-ink" title={profileName}>
              {profileName}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            void onSignOut().then(() => {
              if (typeof window !== 'undefined') window.location.assign('/login');
            })
          }
          className="btn-ghost btn-sm"
        >
          Sign out
        </button>
      </div>
    </header>
  );
}
