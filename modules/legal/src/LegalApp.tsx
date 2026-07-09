'use client';

import { useEffect, useState } from 'react';
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from 'react-router-dom';
import { useSession } from '@intra/auth';
import { can } from '@intra/rbac';
import { SignInPrompt, SkeletonList, SkeletonStats } from '@intra/ui';
import { AccreditationCasesPage } from './pages/AccreditationCasesPage';
import { CaseDetailPage } from './pages/CaseDetailPage';
import { InviteVendorPage } from './pages/InviteVendorPage';
import { SignInstrumentPage } from './pages/SignInstrumentPage';
import { LegalTabs } from './components/LegalTabs';

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

function ScrollToTopOnRouteChange() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [pathname, search]);
  return null;
}

export function LegalApp({ basename = '/legal' }: LegalAppProps) {
  useNormalizeBasenamePath(basename);
  const { userRoles, profile, loading, signOut } = useSession();
  const isVendorSurface = basename.startsWith('/vendor');
  const isVendor = isVendorSurface && profile?.kind === 'vendor';
  const hasInternalAccess = can(userRoles, 'legal', 'view_dashboard');
  // External vendor tier lives in core (reconciled 2026-07-05, ADR-002 #3).
  const hasVendorAccess =
    isVendorSurface && can(userRoles, 'core', 'view_own_accreditation');
  const canUseVendorSurface = isVendor && hasVendorAccess;
  if (loading) {
    return (
      <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-6" aria-busy="true">
        <SkeletonStats />
        <SkeletonList rows={5} />
      </main>
    );
  }

  // Signed out entirely → invite the user to sign in (with a redirect back
  // here), instead of the misleading "no role" copy meant for signed-in users.
  if (!profile) {
    const prompt = <SignInPrompt module="Legal" basename={basename} />;
    return isVendorSurface ? <main>{prompt}</main> : prompt;
  }

  if (isVendorSurface ? !canUseVendorSurface : !hasInternalAccess) {
    return (
      <main
        role="alert"
        className="grid min-h-[60vh] place-items-center bg-app p-6 text-center"
      >
        <div className="max-w-sm space-y-3">
          <h1 className="text-lg font-bold text-ink">No legal access</h1>
          <p className="text-sm text-muted">
            {isVendorSurface
              ? 'This area is reserved for enrolled vendor accounts. Sign in with a vendor account or contact your Mwell account manager.'
              : "Your account doesn't include a legal role. Contact your administrator if you need access."}
          </p>
          <a
            href={isVendorSurface ? '/login' : '/'}
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-brand-600 px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-app"
          >
            {isVendorSurface ? 'Sign in with a different account' : 'Back to dashboard'}
          </a>
        </div>
      </main>
    );
  }

  const routes = (
    <Routes>
      <Route path="/" element={<AccreditationCasesPage />} />
      <Route path="/cases/:id" element={<CaseDetailPage />} />
      <Route path="/cases/:id/sign/:code" element={<SignInstrumentPage />} />
      <Route path="/invites/new" element={<InviteVendorPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );

  return (
    <BrowserRouter
      basename={basename}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      {/* NOTE: no nested ToastProvider here — the shell's root Providers
          already mounts one. Nesting a second provider rendered a duplicate
          fixed toast viewport (two "Notifications" regions) and was the
          hydration-mismatch surface reported at Toast.tsx on /vendor. */}
      {isVendor ? (
        <VendorChrome
          profileName={profile?.name ?? profile?.email ?? 'Vendor'}
          onSignOut={signOut}
        />
      ) : (
        <LegalTabs canInvite={can(userRoles, 'legal', 'manage_checklist')} />
      )}
      <ScrollToTopOnRouteChange />
      {isVendor ? (
        <main className="mx-auto w-full max-w-5xl px-4 py-5 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:px-6">
          {routes}
        </main>
      ) : (
        <div>{routes}</div>
      )}
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
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const initials = profileName
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? '')
    .join('') || 'V';
  return (
    <header
      className={`safe-top sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur-md transition-shadow ${
        scrolled ? 'shadow-e1' : ''
      }`}
      aria-label="Vendor portal chrome"
    >
      <div
        className={`mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 sm:px-6 transition-[padding] ${
          scrolled ? 'py-2' : 'py-3'
        }`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <a
            href="/vendor"
            className="hidden min-w-0 sm:block"
            title="Vendor portal home"
          >
            <p className="font-display text-lg font-extrabold tracking-tight text-ink">
              m<span className="brand-gradient">well</span>
              <span className="ml-1.5 text-xs font-semibold text-faint">Vendor</span>
            </p>
          </a>
          <span
            aria-hidden
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-600 text-sm font-bold text-white shadow-e2 sm:hidden"
          >
            {initials}
          </span>
          <div className="min-w-0">
            <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300 sm:hidden">
              Vendor portal
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
