import { useMemo, useState } from 'react';
import { useWarehouse } from '@/app/store';
import { toStockState } from '@/data/repository';
import { onHand } from '@/domain/stock';
import {
  costVarianceBySupplier,
  inventoryTurnover,
  landedCost,
} from '@/domain/pricing';
import type { Product } from '@/domain/types';
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  Field,
  PageHeader,
  ProductSelect,
  SectionTitle,
  StatCard,
  money,
  type Column,
} from '@/components/ui';
import { PriceEditorSheet } from '@/components/PriceEditorSheet';

interface PriceRow {
  product: Product;
  landed: number;
  onHandUnits: number;
  value: number;
  turnover: number;
}

const BUNDLES: { name: string; productIds: string[]; markup: number }[] = [
  { name: 'Wellness Starter Kit', productIds: ['smart-watch', 'shirt-l', 'doctor-token'], markup: 1.35 },
  { name: 'Doctor VIP Kit', productIds: ['ecg-ring-10', 'jacket-l', 'doctor-token'], markup: 1.4 },
];

export function PricingPage() {
  const { data } = useWarehouse();
  const [varianceProduct, setVarianceProduct] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);

  const rows = useMemo<PriceRow[]>(() => {
    if (!data) return [];
    const state = toStockState(data);
    return data.products
      .map((product) => {
        const landed = landedCost(product, data.lots);
        const onHandUnits = onHand(state, product.id);
        return {
          product,
          landed,
          onHandUnits,
          value: onHandUnits * landed,
          turnover: inventoryTurnover(data.movements, onHandUnits, product.id, 90),
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [data]);

  if (!data) return null;

  const totalLanded = rows.reduce((s, r) => s + r.value, 0);
  const avgTurnover =
    rows.filter((r) => r.turnover > 0).reduce((s, r) => s + r.turnover, 0) /
    Math.max(1, rows.filter((r) => r.turnover > 0).length);
  const multiLot = data.products.filter(
    (p) => data.lots.filter((l) => l.productId === p.id).length > 1,
  ).length;
  const promoSpend = data.movements
    .filter((m) => m.type === 'issue')
    .reduce((sum, m) => {
      const p = data.products.find((x) => x.id === m.productId);
      return p?.promotional ? sum + m.quantity * p.unitCost : sum;
    }, 0);

  const firstWithLots = data.products.find((p) =>
    data.lots.some((l) => l.productId === p.id),
  )?.id;
  const selected = varianceProduct || firstWithLots || rows[0]?.product.id || '';
  const variance = costVarianceBySupplier(data.lots, data.suppliers, selected);

  const columns: Column<PriceRow>[] = [
    {
      key: 'name',
      header: 'Product',
      primary: true,
      render: (r) => (
        <span>
          {r.product.name}{' '}
          <span className="font-mono text-xs text-faint">{r.product.sku}</span>
        </span>
      ),
    },
    { key: 'landed', header: 'Landed', align: 'right', render: (r) => money(r.landed) },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      render: (r) =>
        r.product.price != null ? (
          money(r.product.price)
        ) : (
          <span className="font-semibold text-brand-700 dark:text-brand-300">Set</span>
        ),
    },
    { key: 'onhand', header: 'On hand', align: 'right', render: (r) => r.onHandUnits },
    { key: 'value', header: 'Value', align: 'right', render: (r) => money(r.value) },
    {
      key: 'turn',
      header: 'Turnover',
      align: 'right',
      render: (r) => (
        <Badge tone={r.turnover >= 1 ? 'emerald' : r.turnover > 0 ? 'amber' : 'slate'}>
          {r.turnover}×
        </Badge>
      ),
    },
  ];

  const productName = (id: string) => data.products.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pricing"
        icon="trend"
        subtitle="Landed cost, cost variance, turnover & bundles"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Inventory at landed cost" value={money(totalLanded)} icon="coins" tone="emerald" />
        <StatCard label="Avg turnover (90d)" value={`${Math.round(avgTurnover * 100) / 100}×`} icon="trend" tone="accent" />
        <StatCard label="Multi-supplier SKUs" value={multiLot} icon="building" tone="amber" />
        <StatCard label="Promo spend" value={money(promoSpend)} icon="tag" tone="brand" />
      </div>

      <Card>
        <SectionTitle
          title="Landed cost & turnover"
          subtitle="Tap a row to set the sell price"
        />
        <DataTable
          columns={columns}
          rows={rows.slice(0, 12)}
          keyOf={(r) => r.product.id}
          ariaLabel="Pricing table"
          onRowClick={(r) => setEditing(r.product)}
        />
      </Card>

      <Card className="space-y-3">
        <SectionTitle title="Cost variance by supplier" subtitle="Per received lot" />
        <Field label="Product" htmlFor="pricing-product">
          <ProductSelect
            id="pricing-product"
            products={data.products}
            value={selected}
            onChange={setVarianceProduct}
            includeBlank={false}
          />
        </Field>
        {variance.length === 0 ? (
          <EmptyState icon="building" title="No lots received for this product" />
        ) : (
          <ul className="space-y-2" aria-label="Cost variance">
            {variance.map((v, i) => (
              <li key={i} className="flex items-center justify-between rounded-xl bg-inset p-3">
                <span className="font-medium text-ink">{v.supplierName}</span>
                <span className="tnum font-semibold text-ink">{money(v.unitCost)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle title="Bundle pricing" subtitle="Kit cost vs suggested price" />
        <ul className="space-y-2" aria-label="Bundles">
          {BUNDLES.map((b) => {
            const items = b.productIds
              .map((id) => data.products.find((p) => p.id === id))
              .filter((p): p is Product => Boolean(p));
            const cost = items.reduce((s, p) => s + landedCost(p, data.lots), 0);
            const price = Math.round((cost * b.markup) / 10) * 10;
            return (
              <li key={b.name} className="rounded-xl bg-inset p-3">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-ink">{b.name}</span>
                  <span className="tnum font-bold text-brand-600 dark:text-brand-300">
                    {money(price)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {items.map((p) => productName(p.id)).join(' + ')}
                </p>
                <p className="mt-0.5 text-xs text-faint">
                  Kit cost {money(cost)} · margin {Math.round((b.markup - 1) * 100)}%
                </p>
              </li>
            );
          })}
        </ul>
      </Card>

      <PriceEditorSheet
        product={editing}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
      />
    </div>
  );
}
