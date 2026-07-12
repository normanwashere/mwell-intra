import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Movement, StockChangeRequest } from '@intra/data-kit';
import { useWarehouse } from '@/app/store';
import { toStockState } from '@/data/repository';
import { inventoryValuation } from '@/domain/stock';
import { serializedAssetRegister } from '@/domain/assets';
import { reconciliationRows } from '@/domain/reconciliation';
import { actorName, formatWhen, movementTypeLabel, signedQuantity } from '@/domain/format';
import {
  BarRow,
  Badge,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  SectionTitle,
  StatCard,
  money,
  type Column,
} from '@/components/ui';

const phpNumber = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 });
const formatPhp = (value: number) => `PHP ${phpNumber.format(value)}`;

function changeStatus(request: StockChangeRequest) {
  if (request.status === 'pending_finance') return 'Awaiting Finance';
  if (request.status === 'pending_supervisor') return 'Awaiting Warehouse Supervisor';
  return request.status === 'approved' ? 'Approved' : 'Rejected';
}

export function FinancePage() {
  const { data, loadStockChangeRequests } = useWarehouse();
  const [stockChanges, setStockChanges] = useState<StockChangeRequest[]>([]);

  useEffect(() => {
    void loadStockChangeRequests({ limit: 100 }).then((page) => setStockChanges(page.rows));
  }, [loadStockChangeRequests]);

  if (!data) return null;
  const state = toStockState(data);
  const total = inventoryValuation(state);
  const devices = inventoryValuation(state, 'device');
  const merch = inventoryValuation(state, 'merchandise');
  const reconciliation = reconciliationRows(data.cycleCounts, data.products, data.movements);
  const assets = serializedAssetRegister(data.units, data.products);
  const highValueChanges = stockChanges.filter((request) => request.financialImpact > 10_000);
  const productName = (id: string) => data.products.find((product) => product.id === id)?.name ?? id;
  const auditTrail = [...data.movements]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12);
  const promoSpend = data.movements
    .filter((movement) => movement.type === 'issue')
    .reduce((sum, movement) => {
      const product = data.products.find((row) => row.id === movement.productId);
      return product?.promotional ? sum + movement.quantity * product.unitCost : sum;
    }, 0);

  const columns: Column<Movement>[] = [
    {
      key: 'item',
      header: 'Movement',
      primary: true,
      render: (movement) => (
        <span><span className="font-semibold text-brand-700 dark:text-brand-300">{movementTypeLabel(movement.type)}</span>{' '}{productName(movement.productId)}</span>
      ),
    },
    { key: 'actor', header: 'By', render: (movement) => actorName(movement.actor) },
    { key: 'when', header: 'When', render: (movement) => formatWhen(movement.createdAt) },
    {
      key: 'qty',
      header: 'Qty',
      align: 'right',
      render: (movement) => <span className="tabular-nums font-semibold">{signedQuantity(movement.type, movement.quantity)}</span>,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Finance & Valuation" icon="coins" subtitle="Costing, controlled stock changes, and audit trail" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total value" value={money(total)} icon="coins" tone="emerald" />
        <StatCard label="Promo give-aways" value={money(promoSpend)} icon="trend" tone="amber" />
        <StatCard label="Open variances" value={reconciliation.length} icon="clipboard" tone={reconciliation.length > 0 ? 'rose' : 'emerald'} />
        <StatCard label="Movements" value={data.movements.length} icon="history" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <Card>
          <SectionTitle
            title="Stock-change controls"
            subtitle="High-value pending and completed decisions"
            action={<Link className="btn-ghost btn-sm" to="/approvals">Open approvals</Link>}
          />
          {highValueChanges.length === 0 ? (
            <EmptyState icon="check" title="No high-value stock changes" />
          ) : (
            <ul className="divide-y divide-line" aria-label="Finance stock-change controls">
              {highValueChanges.map((request) => (
                <li key={request.id} className="flex min-h-16 items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{productName(request.productId)}</p>
                    <p className="text-xs text-faint">{request.quantityDelta > 0 ? '+' : ''}{request.quantityDelta} units · {formatPhp(request.financialImpact)}</p>
                  </div>
                  <Badge tone={request.status === 'approved' ? 'emerald' : request.status === 'rejected' ? 'rose' : 'amber'}>{changeStatus(request)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle title="Valuation by category" />
          <div className="space-y-3">
            <BarRow label="Wearable devices" value={devices} max={total} valueLabel={money(devices)} />
            <BarRow label="Marketing merchandise" value={merch} max={total} tone="accent" valueLabel={money(merch)} />
          </div>
          <p className="mt-3 text-xs text-faint">Total inventory value {money(total)}</p>
        </Card>

        <Card>
          <SectionTitle
            title="Reconciliation"
            subtitle="Read-only status from governed cycle counts"
            action={reconciliation.length > 0 ? <Badge tone="amber">{reconciliation.length} variance(s)</Badge> : <Badge tone="emerald">reconciled</Badge>}
          />
          {reconciliation.length === 0 ? (
            <EmptyState icon="check" title="No open variances" message="Counts match system records." />
          ) : (
            <ul className="divide-y divide-line" aria-label="Reconciliation">
              {reconciliation.map((row) => (
                <li key={`${row.productId}|${row.locationId}|${row.binId ?? ''}`} className="flex items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{row.name}</p><p className="font-mono text-xs text-faint">{row.sku}</p></div>
                  <div className="flex items-center gap-3 text-right"><span className="text-xs text-faint">{row.counted}/{row.expected}</span><Badge tone={row.variance < 0 ? 'rose' : 'amber'}>{row.variance > 0 ? `+${row.variance}` : row.variance}</Badge></div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle title="Asset register" subtitle="Serialized devices in the field" action={<Badge tone="slate">{assets.length}</Badge>} />
          {assets.length === 0 ? <EmptyState icon="tag" title="No serialized devices issued" /> : (
            <ul className="divide-y divide-line" aria-label="Asset register">
              {assets.slice(0, 20).map((asset) => (
                <li key={asset.serialNumber} className="flex items-center justify-between gap-3 py-2.5"><span className="truncate text-sm text-ink">{asset.productName}</span><span className="font-mono text-xs text-faint">{asset.serialNumber}</span></li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <SectionTitle title="Audit trail" subtitle="Most recent inventory movements" />
          {auditTrail.length === 0 ? <EmptyState icon="clipboard" title="No movements yet" /> : <DataTable columns={columns} rows={auditTrail} keyOf={(movement) => movement.id} ariaLabel="Audit trail" />}
        </Card>
      </div>
    </div>
  );
}
