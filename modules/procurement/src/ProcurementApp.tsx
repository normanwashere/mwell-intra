"use client";

import { useEffect, useMemo } from "react";
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import { SignInPrompt, SkeletonList, SkeletonStats } from "@intra/ui";
import { useSession } from "@intra/auth";
import { can } from "@intra/rbac";
import { ProcurementTabs } from "./components/ProcurementTabs";
import { RequestsPage } from "./pages/RequestsPage";
import { CreateRequestPage } from "./pages/CreateRequestPage";
import { RequestDetailPage } from "./pages/RequestDetailPage";
import { ApprovalInboxPage } from "./pages/ApprovalInboxPage";
import { PurchaseOrdersPage } from "./pages/PurchaseOrdersPage";
import { PODetailPage } from "./pages/PODetailPage";
import { resolveTiers, type UserRolesShape } from "./tiers";
import { PROCUREMENT_ROUTE_BY_ID } from "./routes";

export interface ProcurementAppProps {
  /** Path prefix the shell mounts this module under (default `/procurement`). */
  basename?: string;
}

// See WarehouseApp for the react-router basename normalization rationale.
function useNormalizeBasenamePath(basename: string): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.pathname === basename) {
      const next = `${basename}/${window.location.search}${window.location.hash}`;
      window.history.replaceState(window.history.state, "", next);
    }
  }, [basename]);
}

function ScrollToTopOnRouteChange() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname, search]);
  return null;
}

export function ProcurementApp({
  basename = "/procurement",
}: ProcurementAppProps) {
  useNormalizeBasenamePath(basename);
  const { profile, userRoles, loading } = useSession();
  // PR-11 (P0): the module previously gated on procurement.view_dashboard,
  // which locked out ladder-tier approvers with NO procurement role (the
  // Legal tier is held by legal:legal_reviewer). Tier-eligible users are now
  // admitted, but routed to /approvals only — Requests / POs stay hidden.
  const myTiers = useMemo(
    () => resolveTiers(userRoles as UserRolesShape),
    [userRoles],
  );
  const canViewDashboard = can(userRoles, "procurement", "view_dashboard");
  const hasAccess = canViewDashboard || myTiers.length > 0;
  const approvalsOnly = !canViewDashboard && myTiers.length > 0;
  const canApprove =
    can(userRoles, "procurement", "approve_request") || myTiers.length > 0;
  const canViewPurchaseOrders =
    can(userRoles, "procurement", "author_po") ||
    can(userRoles, "procurement", "approve_award") ||
    can(userRoles, "procurement", "view_finance") ||
    can(userRoles, "procurement", "admin");
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
      <ScrollToTopOnRouteChange />
      <ProcurementTabs
        canApprove={canApprove}
        showRequests={!approvalsOnly}
        showPurchaseOrders={!approvalsOnly && canViewPurchaseOrders}
      />
      <Routes>
        {approvalsOnly ? (
          <>
            {/* Tier-only entrants (e.g. Legal) land on the approvals surface.
                Request detail stays reachable — it's the "Review" step of an
                approval — but the list/create/PO surfaces are off-limits. */}
            <Route
              path={PROCUREMENT_ROUTE_BY_ID.requests.path}
              element={<Navigate to="/approvals" replace />}
            />
            <Route
              path={PROCUREMENT_ROUTE_BY_ID.approvals.path}
              element={<ApprovalInboxPage />}
            />
            <Route
              path={PROCUREMENT_ROUTE_BY_ID["request-detail"].path}
              element={<RequestDetailPage />}
            />
            <Route path="*" element={<Navigate to="/approvals" replace />} />
          </>
        ) : (
          <>
            <Route
              path={PROCUREMENT_ROUTE_BY_ID.requests.path}
              element={<RequestsPage />}
            />
            <Route
              path={PROCUREMENT_ROUTE_BY_ID["create-request"].path}
              element={<CreateRequestPage />}
            />
            <Route
              path={PROCUREMENT_ROUTE_BY_ID["request-detail"].path}
              element={<RequestDetailPage />}
            />
            <Route
              path={PROCUREMENT_ROUTE_BY_ID.approvals.path}
              element={<ApprovalInboxPage />}
            />
            <Route
              path={PROCUREMENT_ROUTE_BY_ID["purchase-orders"].path}
              element={<PurchaseOrdersPage />}
            />
            <Route
              path={PROCUREMENT_ROUTE_BY_ID["po-detail"].path}
              element={<PODetailPage />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}
