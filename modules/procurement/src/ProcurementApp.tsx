'use client';

import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SignInPrompt, SkeletonList, SkeletonStats } from '@intra/ui';
import { useSession } from '@intra/auth';
import { can } from '@intra/rbac';
import { ProcurementTabs } from './components/ProcurementTabs';
import { RequestsPage } from './pages/RequestsPage';
import { CreateRequestPage } from './pages/CreateRequestPage';
import { RequestDetailPage } from './pages/RequestDetailPage';
import { ApprovalInboxPage } from './pages/ApprovalInboxPage';
import { PurchaseOrdersPage } from './pages/PurchaseOrdersPage';
import { PODetailPage } from './pages/PODetailPage';

export interface ProcurementAppProps {
  /** Path prefix the shell mounts this module under (default `/procurement`). */
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

export function ProcurementApp({ basename = '/procurement' }: ProcurementAppProps) {
  useNormalizeBasenamePath(basename);
  const { profile, userRoles, loading } = useSession();
  const hasAccess = can(userRoles, 'procurement', 'view_dashboard');
  const canApprove = can(userRoles, 'procurement', 'approve_request');
  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6" aria-busy="true">
        <SkeletonStats />
        <SkeletonList rows={5} />
      </div>
    );
  }

  // Signed out entirely → prompt to sign in (deep-links back here) instead of
  // the "no procurement role" copy meant for signed-in users.
  if (!profile) {
    return <SignInPrompt module="Procurement" basename={basename} />;
  }

  if (!hasAccess) {
    return (
      <div
        role="alert"
        className="grid min-h-[60vh] place-items-center bg-app p-6 text-center"
      >
        <div className="max-w-sm space-y-3">
          <h1 className="text-lg font-bold text-ink">No procurement access</h1>
          <p className="text-sm text-muted">
            Your account doesn&apos;t include a procurement role. Contact your
            administrator if you need access.
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
      <ProcurementTabs canApprove={canApprove} />
      <Routes>
        <Route path="/" element={<RequestsPage />} />
        <Route path="/requests/new" element={<CreateRequestPage />} />
        <Route path="/requests/:id" element={<RequestDetailPage />} />
        <Route path="/approvals" element={<ApprovalInboxPage />} />
        <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
        <Route path="/purchase-orders/:id" element={<PODetailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
