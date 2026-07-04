'use client';

import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ToastProvider } from '@intra/ui';
import { useSession } from '@intra/auth';
import { can } from '@intra/rbac';
import { RequestsPage } from './pages/RequestsPage';
import { CreateRequestPage } from './pages/CreateRequestPage';

export interface ProcurementAppProps {
  /** Path prefix the shell mounts this module under (default `/procurement`). */
  basename?: string;
}

export function ProcurementApp({ basename = '/procurement' }: ProcurementAppProps) {
  const { userRoles } = useSession();
  const hasAccess = can(userRoles, 'procurement', 'view_dashboard');

  if (!hasAccess) {
    return (
      <div
        role="alert"
        className="grid min-h-[40vh] place-items-center p-6 text-center"
      >
        <div>
          <h1 className="text-lg font-bold">No procurement access</h1>
          <p className="mt-2 max-w-sm text-sm opacity-70">
            Your account doesn&apos;t include a procurement role. Contact your
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
          <Route path="/" element={<RequestsPage />} />
          <Route path="/requests/new" element={<CreateRequestPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
