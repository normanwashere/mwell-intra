import { Route, Routes, useNavigate } from 'react-router-dom';
import { Suspense, lazy, useEffect, useRef } from 'react';
import { AppShell } from '@/components/AppShell';
import { useWarehouse } from './store';
import { can, type Capability } from '@/auth/roles';
import {
  EmptyState,
  Skeleton,
  SkeletonList,
  SkeletonStats,
  useToast,
} from '@/components/ui';
// Dashboard is the landing route — keep it eager so first paint has no chunk
// wait. Every other page is code-split so the initial bundle stays lean on the
// warehouse floor's mobile connections.
import { DashboardPage } from '@/pages/DashboardPage';
import type { ReactNode } from 'react';

const InventoryPage = lazy(() =>
  import('@/pages/InventoryPage').then((m) => ({ default: m.InventoryPage })),
);
const ProductDetailPage = lazy(() =>
  import('@/pages/ProductDetailPage').then((m) => ({ default: m.ProductDetailPage })),
);
const ReceivingPage = lazy(() =>
  import('@/pages/ReceivingPage').then((m) => ({ default: m.ReceivingPage })),
);
const AllocationsPage = lazy(() =>
  import('@/pages/AllocationsPage').then((m) => ({ default: m.AllocationsPage })),
);
const CycleCountsPage = lazy(() =>
  import('@/pages/CycleCountsPage').then((m) => ({ default: m.CycleCountsPage })),
);
const ReturnsPage = lazy(() =>
  import('@/pages/ReturnsPage').then((m) => ({ default: m.ReturnsPage })),
);
const ProcurementPage = lazy(() =>
  import('@/pages/ProcurementPage').then((m) => ({ default: m.ProcurementPage })),
);
const PurchaseOrdersPage = lazy(() =>
  import('@/pages/PurchaseOrdersPage').then((m) => ({ default: m.PurchaseOrdersPage })),
);
const SuppliersPage = lazy(() =>
  import('@/pages/SuppliersPage').then((m) => ({ default: m.SuppliersPage })),
);
const LocationsPage = lazy(() =>
  import('@/pages/LocationsPage').then((m) => ({ default: m.LocationsPage })),
);
const StorageAreasPage = lazy(() =>
  import('@/pages/StorageAreasPage').then((m) => ({ default: m.StorageAreasPage })),
);
const FinancePage = lazy(() =>
  import('@/pages/FinancePage').then((m) => ({ default: m.FinancePage })),
);
const PricingPage = lazy(() =>
  import('@/pages/PricingPage').then((m) => ({ default: m.PricingPage })),
);
const EventsPage = lazy(() =>
  import('@/pages/EventsPage').then((m) => ({ default: m.EventsPage })),
);
const EventDetailPage = lazy(() =>
  import('@/pages/EventDetailPage').then((m) => ({ default: m.EventDetailPage })),
);
const DataPage = lazy(() =>
  import('@/pages/DataPage').then((m) => ({ default: m.DataPage })),
);
const ScanPage = lazy(() =>
  import('@/pages/ScanPage').then((m) => ({ default: m.ScanPage })),
);
const TasksPage = lazy(() =>
  import('@/pages/TasksPage').then((m) => ({ default: m.TasksPage })),
);
const QualityPage = lazy(() =>
  import('@/pages/QualityPage').then((m) => ({ default: m.QualityPage })),
);

function AccessDenied() {
  const navigate = useNavigate();
  return (
    <EmptyState
      icon="lock"
      title="You don't have access to this page"
      message="This tool isn't part of your role. Head back to your dashboard to keep working."
      action={
        <button type="button" className="btn-primary" onClick={() => navigate('/')}>
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
      toast.toast('That tool is not available for your role.', 'info');
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
        <button type="button" className="btn-primary" onClick={() => navigate('/')}>
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
          <div className="space-y-6">
            <Skeleton className="h-28 rounded-3xl sm:h-32" />
            <SkeletonStats />
            <SkeletonList rows={5} />
          </div>
        }
      >
        <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/inventory" element={<InventoryPage />} />
        <Route path="/inventory/:id" element={<ProductDetailPage />} />
        <Route
          path="/scan"
          element={
            <Guard anyOf={['receive_stock', 'issue_items', 'manage_returns', 'cycle_count', 'transfer_stock']}>
              <ScanPage />
            </Guard>
          }
        />
        <Route
          path="/tasks"
          element={
            <Guard anyOf={['inspect_quality', 'view_exceptions', 'cycle_count']}>
              <TasksPage />
            </Guard>
          }
        />
        <Route
          path="/quality"
          element={
            <Guard anyOf={['inspect_quality', 'release_quality_hold']}>
              <QualityPage />
            </Guard>
          }
        />
        <Route
          path="/receiving"
          element={
            <Guard anyOf={['receive_stock']}>
              <ReceivingPage />
            </Guard>
          }
        />
        <Route
          path="/allocations"
          element={
            <Guard anyOf={['reserve_allocate', 'issue_items']}>
              <AllocationsPage />
            </Guard>
          }
        />
        <Route
          path="/events"
          element={
            <Guard anyOf={['reserve_allocate', 'view_finance']}>
              <EventsPage />
            </Guard>
          }
        />
        <Route
          path="/events/:id"
          element={
            <Guard anyOf={['reserve_allocate', 'view_finance']}>
              <EventDetailPage />
            </Guard>
          }
        />
        <Route
          path="/cycle-counts"
          element={
            <Guard anyOf={['cycle_count']}>
              <CycleCountsPage />
            </Guard>
          }
        />
        <Route
          path="/returns"
          element={
            <Guard anyOf={['manage_returns']}>
              <ReturnsPage />
            </Guard>
          }
        />
        <Route
          path="/procurement"
          element={
            <Guard anyOf={['view_procurement']}>
              <ProcurementPage />
            </Guard>
          }
        />
        <Route
          path="/purchase-orders"
          element={
            <Guard anyOf={['view_procurement', 'receive_stock']}>
              <PurchaseOrdersPage />
            </Guard>
          }
        />
        <Route
          path="/suppliers"
          element={
            <Guard anyOf={['view_procurement']}>
              <SuppliersPage />
            </Guard>
          }
        />
        <Route
          path="/storage"
          element={
            <Guard anyOf={['receive_stock', 'manage_locations', 'transfer_stock', 'cycle_count']}>
              <StorageAreasPage />
            </Guard>
          }
        />
        <Route
          path="/locations"
          element={
            <Guard anyOf={['manage_locations']}>
              <LocationsPage />
            </Guard>
          }
        />
        <Route
          path="/finance"
          element={
            <Guard anyOf={['view_finance']}>
              <FinancePage />
            </Guard>
          }
        />
        <Route
          path="/pricing"
          element={
            <Guard anyOf={['view_pricing']}>
              <PricingPage />
            </Guard>
          }
        />
        <Route
          path="/data"
          element={
            <Guard anyOf={['view_analytics']}>
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
