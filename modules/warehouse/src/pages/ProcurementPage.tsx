import { useWarehouse } from '@/app/store';
import { toStockState } from '@/data/repository';
import { availableForProduct, lowStockProducts } from '@/domain/stock';
import {
  consumptionRatePerDay,
  projectedStockout,
} from '@/domain/procurementAnalytics';
import type { Product, Supplier } from '@/domain/types';
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  PageHeader,
  SectionTitle,
  StatCard,
  StaggerGrid,
  StaggerItem,
  useToast,
  type Column,
} from '@/components/ui';
import { Icon } from '@/components/Icon';

interface ReorderRow {
  product: Product;
  available: number;
  deficit: number;
  suggest: number;
  supplier?: Supplier;
  daysOfCover: number;
  atRisk: boolean;
}

export function ProcurementPage() {
  const { data, createPurchaseOrder } = useWarehouse();
  const toast = useToast();
  if (!data) return null;
  const state = toStockState(data);
  const low = lowStockProducts(state);
  const fallbackSupplier = data.suppliers[0];

  const reorderRows: ReorderRow[] = data.products
    .map((p) => {
      const available = availableForProduct(state, p.id);
      const supplier = data.suppliers.find((s) =>
        data.lots.some((l) => l.productId === p.id && l.supplierId === s.id),
      );
      const ratePerDay = consumptionRatePerDay(data.movements, p.id, 90);
      const leadTimeDays = supplier?.leadTimeDays ?? fallbackSupplier?.leadTimeDays ?? 14;
      const { daysOfCover, atRisk } = projectedStockout({
        available,
        ratePerDay,
        leadTimeDays,
      });
      return {
        product: p,
        available,
        deficit: Math.max(0, p.reorderPoint - available),
        suggest: Math.max(Math.max(0, p.reorderPoint - available), p.reorderPoint),
        supplier,
        daysOfCover,
        atRisk,
      };
    })
    .filter((r) => r.deficit > 0 || r.atRisk)
    .sort((a, b) => Number(b.atRisk) - Number(a.atRisk) || b.deficit - a.deficit);

  const atRiskCount = reorderRows.filter((r) => r.atRisk).length;
  const openPOs = data.purchaseOrders.filter(
    (po) => po.status !== 'received' && po.status !== 'cancelled',
  ).length;

  const reorder = async (row: ReorderRow) => {
    const supplier = row.supplier ?? fallbackSupplier;
    if (!supplier) {
      toast.error('Add a supplier first.');
      return;
    }
    const ok = await createPurchaseOrder({
      supplierId: supplier.id,
      lines: [{ productId: row.product.id, quantityOrdered: row.suggest }],
    });
    if (!ok) return;
    toast.success(`PO drafted: ${row.suggest}× ${row.product.name}`);
  };

  const draftAll = async () => {
    const bySupplier = new Map<
      string,
      { productId: string; quantityOrdered: number }[]
    >();
    for (const r of reorderRows) {
      const sup = r.supplier ?? fallbackSupplier;
      if (!sup) continue;
      const lines = bySupplier.get(sup.id) ?? [];
      lines.push({ productId: r.product.id, quantityOrdered: r.suggest });
      bySupplier.set(sup.id, lines);
    }
    if (bySupplier.size === 0) {
      toast.error('Add a supplier first.');
      return;
    }
    let drafted = 0;
    for (const [supplierId, lines] of bySupplier) {
      const ok = await createPurchaseOrder({ supplierId, lines });
      if (ok) drafted++;
    }
    if (drafted === 0) return;
    toast.success(`Drafted ${drafted} PO(s) for ${reorderRows.length} item(s)`);
  };

  const cover = (r: ReorderRow) =>
    r.daysOfCover === Infinity ? '∞' : `${Math.round(r.daysOfCover)}d`;

  const columns: Column<ReorderRow>[] = [
    {
      key: 'item',
      header: 'Item',
      primary: true,
      render: (r) => (
        <span>
          {r.product.name}{' '}
          <span className="font-mono text-xs text-faint">{r.product.sku}</span>
        </span>
      ),
    },
    {
      key: 'supplier',
      header: 'Supplier',
      render: (r) => (
        <span className="text-faint">{(r.supplier ?? fallbackSupplier)?.name ?? '—'}</span>
      ),
    },
    { key: 'avail', header: 'Avail.', align: 'right', render: (r) => r.available },
    {
      key: 'cover',
      header: 'Cover',
      align: 'right',
      render: (r) => (
        <Badge tone={r.atRisk ? 'rose' : 'slate'}>{cover(r)}</Badge>
      ),
    },
    {
      key: 'suggest',
      header: 'Suggest',
      align: 'right',
      render: (r) => <Badge tone="amber">+{r.suggest}</Badge>,
    },
    {
      key: 'action',
      header: '',
      align: 'right',
      render: (r) => (
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={(e) => {
            e.stopPropagation();
            void reorder(r);
          }}
        >
          Reorder
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Procurement" icon="cart" subtitle="Reorder, stockout risk & lead times" />

      <StaggerGrid className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StaggerItem>
          <StatCard label="SKUs to reorder" value={low.length} icon="cart" tone="amber" />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Stockout risk" value={atRiskCount} icon="alert" tone={atRiskCount ? 'rose' : 'emerald'} />
        </StaggerItem>
        <StaggerItem>
          <StatCard label="Open POs" value={openPOs} icon="list" tone="brand" />
        </StaggerItem>
        <StaggerItem>
          <StatCard
            label="Avg lead time"
            value={`${Math.round(
              data.suppliers.reduce((s, x) => s + x.leadTimeDays, 0) /
                Math.max(1, data.suppliers.length),
            )}d`}
            icon="calendar"
            tone="accent"
          />
        </StaggerItem>
      </StaggerGrid>

      <Card>
        <SectionTitle
          title="Reorder worklist"
          subtitle="At-risk first; cover = days until stockout"
          action={
            reorderRows.length > 0 ? (
              <button type="button" className="btn-primary btn-sm" onClick={() => void draftAll()}>
                <Icon name="cart" className="h-4 w-4" /> Draft all
              </button>
            ) : undefined
          }
        />
        {reorderRows.length === 0 ? (
          <EmptyState icon="check" title="Nothing to reorder" />
        ) : (
          <DataTable
            columns={columns}
            rows={reorderRows}
            keyOf={(r) => r.product.id}
            ariaLabel="Reorder worklist"
          />
        )}
      </Card>
    </div>
  );
}
