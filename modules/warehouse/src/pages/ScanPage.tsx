import { Link, useNavigate } from 'react-router-dom';
import { useWarehouse } from '@/app/store';
import type { WarehouseRouteId } from '@/app/modules';
import { WarehouseScanFlow } from '@/components/camera/WarehouseScanFlow';
import { PageHeader } from '@/components/ui';
import { Icon, type IconName } from '@/components/Icon';

const ACTIONS: Array<{ label: string; to: string; icon: IconName; routeId: WarehouseRouteId }> = [
  { label: 'Receive', to: '/receiving', icon: 'truck', routeId: 'receiving' },
  { label: 'Issue', to: '/allocations', icon: 'tag', routeId: 'allocations' },
  { label: 'Return', to: '/returns', icon: 'rotate', routeId: 'returns' },
  { label: 'Count', to: '/cycle-counts', icon: 'clipboard', routeId: 'cycle-counts' },
  { label: 'Put away', to: '/storage', icon: 'pin', routeId: 'storage' },
  { label: 'Transfer', to: '/inventory', icon: 'rotate', routeId: 'inventory' },
  { label: 'Lookup', to: '/inventory', icon: 'search', routeId: 'inventory' },
];

export function ScanPage() {
  const { data, canOpenRoute } = useWarehouse();
  const navigate = useNavigate();
  const actions = ACTIONS.filter((action) => canOpenRoute(action.routeId));
  return (
    <div className="space-y-5">
      <PageHeader title="Scan" icon="scan" subtitle="Choose an operation or find stock" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Scan operations">
        {actions.map((action) => (
          <Link key={action.label} to={action.to} className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-xl border border-line bg-surface p-3 text-sm font-semibold text-ink">
            <Icon name={action.icon} className="h-5 w-5 text-brand-600" />{action.label}
          </Link>
        ))}
      </div>
      {data && canOpenRoute('product-detail') && (
        <WarehouseScanFlow
          data={data}
          context="lookup"
          label="Scan product or unit"
          onResolved={(resolution) => navigate(`/inventory/${resolution.productId}`)}
        />
      )}
    </div>
  );
}
