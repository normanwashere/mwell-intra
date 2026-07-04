'use client';

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '@intra/ui';
import { useSession } from '@intra/auth';
import { can } from '@intra/rbac';
import { AccreditationCasesPage } from './pages/AccreditationCasesPage';

export interface LegalAppProps {
  /** Path prefix the shell mounts this module under (default `/legal`). */
  basename?: string;
}

export function LegalApp({ basename = '/legal' }: LegalAppProps) {
  const { userRoles, profile } = useSession();
  const isVendor = profile?.kind === 'vendor';
  const hasInternalAccess = can(userRoles, 'legal', 'view_dashboard');
  const hasVendorAccess = can(userRoles, 'legal', 'view_own_accreditation');

  if (isVendor ? !hasVendorAccess : !hasInternalAccess) {
    return (
      <div
        role="alert"
        className="grid min-h-[40vh] place-items-center p-6 text-center"
      >
        <div>
          <h1 className="text-lg font-bold">No legal access</h1>
          <p className="mt-2 max-w-sm text-sm opacity-70">
            Your account doesn&apos;t include a legal role. Contact your
            administrator if you need access.
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
      <ToastProvider>
        <Routes>
          <Route path="/" element={<AccreditationCasesPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
