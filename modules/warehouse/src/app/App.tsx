import { Route, Routes, useNavigate } from "react-router-dom";
import { Suspense, lazy, useEffect, useRef } from "react";
import { AppShell } from "@/components/AppShell";
import { useWarehouse } from "./store";
import { can, type Capability } from "@/auth/roles";
import {
  EmptyState,
  Skeleton,
  SkeletonList,
  SkeletonStats,
  useToast,
} from "@/components/ui";
// Dashboard is the landing route — keep it eager so first paint has no chunk
// wait. Every other page is code-split so the initial bundle stays lean on the
// warehouse floor's mobile connections.
import { DashboardPage } from "@/pages/DashboardPage";
import type { ReactNode } from "react";
import { WAREHOUSE_ROUTE_BY_ID } from "./modules";

const InventoryPage = lazy(() =>
  import("@/pages/InventoryPage").then((m) => ({ default: m.InventoryPage })),
);
const ProductDetailPage = lazy(() =>
  import("@/pages/ProductDetailPage").then((m) => ({
    default: m.ProductDetailPage,
  })),
);
const ReceivingPage = lazy(() =>
  import("@/pages/ReceivingPage").then((m) => ({ default: m.ReceivingPage })),
);
const AllocationsPage = lazy(() =>
  import("@/pages/AllocationsPage").then((m) => ({
    default: m.AllocationsPage,
  })),
);
const CycleCountsPage = lazy(() =>
  import("@/pages/CycleCountsPage").then((m) => ({
    default: m.CycleCountsPage,
  })),
);
const ReturnsPage = lazy(() =>
  import("@/pages/ReturnsPage").then((m) => ({ default: m.ReturnsPage })),
);
const ProcurementPage = lazy(() =>
  import("@/pages/ProcurementPage").then((m) => ({
    default: m.ProcurementPage,
  })),
);
const PurchaseOrdersPage = lazy(() =>
  import("@/pages/PurchaseOrdersPage").then((m) => ({
    default: m.PurchaseOrdersPage,
  })),
);
const SuppliersPage = lazy(() =>
  import("@/pages/SuppliersPage").then((m) => ({ default: m.SuppliersPage })),
);
const LocationsPage = lazy(() =>
  import("@/pages/LocationsPage").then((m) => ({ default: m.LocationsPage })),
);
const StorageAreasPage = lazy(() =>
  import("@/pages/StorageAreasPage").then((m) => ({
    default: m.StorageAreasPage,
  })),
);
const FinancePage = lazy(() =>
  import("@/pages/FinancePage").then((m) => ({ default: m.FinancePage })),
);
const PricingPage = lazy(() =>
  import("@/pages/PricingPage").then((m) => ({ default: m.PricingPage })),
);
const EventsPage = lazy(() =>
  import("@/pages/EventsPage").then((m) => ({ default: m.EventsPage })),
);
const EventDetailPage = lazy(() =>
  import("@/pages/EventDetailPage").then((m) => ({
    default: m.EventDetailPage,
  })),
);
const DataPage = lazy(() =>
  import("@/pages/DataPage").then((m) => ({ default: m.DataPage })),
);
const ScanPage = lazy(() =>
  import("@/pages/ScanPage").then((m) => ({ default: m.ScanPage })),
);
const TasksPage = lazy(() =>
  import("@/pages/TasksPage").then((m) => ({ default: m.TasksPage })),
);
const QualityPage = lazy(() =>
  import("@/pages/QualityPage").then((m) => ({ default: m.QualityPage })),
);
const ApprovalsPage = lazy(() =>
  import("@/pages/ApprovalsPage").then((m) => ({ default: m.ApprovalsPage })),
);
const ExceptionsPage = lazy(() =>
  import("@/pages/ExceptionsPage").then((m) => ({ default: m.ExceptionsPage })),
);
const ImportsPage = lazy(() =>
  import("@/pages/ImportsPage").then((m) => ({ default: m.ImportsPage })),
);
const ReportsPage = lazy(() =>
  import("@/pages/ReportsPage").then((m) => ({ default: m.ReportsPage })),
);
const OperationRoutesPage = lazy(() =>
  import("@/pages/OperationRoutesPage").then((m) => ({
    default: m.OperationRoutesPage,
  })),
);

function AccessDenied() {
  const navigate = useNavigate();
  return (
    <EmptyState
      icon="lock"
      title="You don't have access to this page"
      message="This tool isn't part of your role. Head back to your dashboard to keep working."
      action={
        <button
          type="button"
          className="btn-primary"
          onClick={() => navigate("/")}
        >
          Back to dashboard
        </button>
      }
    />
  );
}

function Guard({
  anyOf,
  children,
}: {
  anyOf: Capability[];
  children: ReactNode;
}) {
  const { role } = useWarehouse();
  const toast = useToast();
  const toasted = useRef(false);
  const allowed = anyOf.some((c) => can(role, c));
  useEffect(() => {
    if (!allowed && !toasted.current) {
      toasted.current = true;
      toast.toast("That tool is not available for your role.", "info");
    }
  }, [allowed, toast]);
  // Render an explicit, friendly access-denied page rather than silently
  // redirecting (a blank flash) — the user always gets clear feedback.
  if (!allowed) return <AccessDenied />;
  return <>{children}</>;
}

function NotFound() {
  const navigate = useNavigate();
  return (
    <EmptyState
      icon="search"
      title="Page not found"
      message="The page you're looking for doesn't exist."
      action={
        <button
          type="button"
          className="btn-primary"
          onClick={() => navigate("/")}
        >
          Back to dashboard
        </button>
      }
    />
  );
}

function LoadingShell() {
  return (
    <AppShell>
      <div className="space-y-6">
        <Skeleton className="h-28 rounded-3xl sm:h-32" />
        <SkeletonStats />
        <div className="grid gap-4 lg:grid-cols-2">
          <SkeletonList rows={5} />
          <SkeletonList rows={5} />
        </div>
      </div>
    </AppShell>
  );
}

export function App() {
  const { loading, error } = useWarehouse();

  if (loading) return <LoadingShell />;
  if (error) {
    return (
      <div className="grid min-h-screen place-items-center p-6 text-center">
        <div>
          <h1 className="text-lg font-bold text-rose-600 dark:text-rose-300">
            Could not load data
          </h1>
          <p className="mt-2 max-w-sm text-sm text-muted">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <AppShell>
      <Suspense
        fallback={
          <div
            className="space-y-6"
            role="status"
            aria-live="polite"
            aria-label="Loading warehouse page"
            aria-busy="true"
          >
            <Skeleton className="h-28 rounded-3xl sm:h-32" />
            <SkeletonStats />
            <SkeletonList rows={5} />
          </div>
        }
      >
        <Routes>
          <Route
            path={WAREHOUSE_ROUTE_BY_ID.dashboard.path}
            element={<DashboardPage />}
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID.inventory.path}
            element={<InventoryPage />}
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID["product-detail"].path}
            element={<ProductDetailPage />}
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID.scan.path}
            element={
              <Guard anyOf={WAREHOUSE_ROUTE_BY_ID.scan.gateCapabilityIds}>
                <ScanPage />
              </Guard>
            }
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID.tasks.path}
            element={
              <Guard anyOf={WAREHOUSE_ROUTE_BY_ID.tasks.gateCapabilityIds}>
                <TasksPage />
              </Guard>
            }
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID.quality.path}
            element={
              <Guard anyOf={WAREHOUSE_ROUTE_BY_ID.quality.gateCapabilityIds}>
                <QualityPage />
              </Guard>
            }
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID.approvals.path}
            element={
              <Guard anyOf={WAREHOUSE_ROUTE_BY_ID.approvals.gateCapabilityIds}>
                <ApprovalsPage />
              </Guard>
            }
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID.exceptions.path}
            element={
              <Guard anyOf={WAREHOUSE_ROUTE_BY_ID.exceptions.gateCapabilityIds}>
                <ExceptionsPage />
              </Guard>
            }
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID.imports.path}
            element={
              <Guard anyOf={WAREHOUSE_ROUTE_BY_ID.imports.gateCapabilityIds}>
                <ImportsPage />
              </Guard>
            }
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID.reports.path}
            element={
              <Guard anyOf={WAREHOUSE_ROUTE_BY_ID.reports.gateCapabilityIds}>
                <ReportsPage />
              </Guard>
            }
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID["operation-routes"].path}
            element={
              <Guard
                anyOf={
                  WAREHOUSE_ROUTE_BY_ID["operation-routes"].gateCapabilityIds
                }
              >
                <OperationRoutesPage />
              </Guard>
            }
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID.receiving.path}
            element={
              <Guard anyOf={WAREHOUSE_ROUTE_BY_ID.receiving.gateCapabilityIds}>
                <ReceivingPage />
              </Guard>
            }
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID.allocations.path}
            element={
              <Guard
                anyOf={WAREHOUSE_ROUTE_BY_ID.allocations.gateCapabilityIds}
              >
                <AllocationsPage />
              </Guard>
            }
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID.events.path}
            element={
              <Guard anyOf={WAREHOUSE_ROUTE_BY_ID.events.gateCapabilityIds}>
                <EventsPage />
              </Guard>
            }
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID["event-detail"].path}
            element={
              <Guard
                anyOf={WAREHOUSE_ROUTE_BY_ID["event-detail"].gateCapabilityIds}
              >
                <EventDetailPage />
              </Guard>
            }
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID["cycle-counts"].path}
            element={
              <Guard
                anyOf={WAREHOUSE_ROUTE_BY_ID["cycle-counts"].gateCapabilityIds}
              >
                <CycleCountsPage />
              </Guard>
            }
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID.returns.path}
            element={
              <Guard anyOf={WAREHOUSE_ROUTE_BY_ID.returns.gateCapabilityIds}>
                <ReturnsPage />
              </Guard>
            }
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID.procurement.path}
            element={
              <Guard
                anyOf={WAREHOUSE_ROUTE_BY_ID.procurement.gateCapabilityIds}
              >
                <ProcurementPage />
              </Guard>
            }
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID["purchase-orders"].path}
            element={
              <Guard
                anyOf={
                  WAREHOUSE_ROUTE_BY_ID["purchase-orders"].gateCapabilityIds
                }
              >
                <PurchaseOrdersPage />
              </Guard>
            }
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID.suppliers.path}
            element={
              <Guard anyOf={WAREHOUSE_ROUTE_BY_ID.suppliers.gateCapabilityIds}>
                <SuppliersPage />
              </Guard>
            }
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID.storage.path}
            element={
              <Guard anyOf={WAREHOUSE_ROUTE_BY_ID.storage.gateCapabilityIds}>
                <StorageAreasPage />
              </Guard>
            }
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID.locations.path}
            element={
              <Guard anyOf={WAREHOUSE_ROUTE_BY_ID.locations.gateCapabilityIds}>
                <LocationsPage />
              </Guard>
            }
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID.finance.path}
            element={
              <Guard anyOf={WAREHOUSE_ROUTE_BY_ID.finance.gateCapabilityIds}>
                <FinancePage />
              </Guard>
            }
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID.pricing.path}
            element={
              <Guard anyOf={WAREHOUSE_ROUTE_BY_ID.pricing.gateCapabilityIds}>
                <PricingPage />
              </Guard>
            }
          />
          <Route
            path={WAREHOUSE_ROUTE_BY_ID.data.path}
            element={
              <Guard anyOf={WAREHOUSE_ROUTE_BY_ID.data.gateCapabilityIds}>
                <DataPage />
              </Guard>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
