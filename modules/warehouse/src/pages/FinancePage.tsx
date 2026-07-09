import { useWarehouse } from '@/app/store';
import { can } from '@/auth/roles';
import { toStockState } from '@/data/repository';
import { availableForProduct, inventoryValuation } from '@/domain/stock';
import { serializedAssetRegister } from '@/domain/assets';
import { reconciliationRows } from '@/domain/reconciliation';
import {
  actorName,
  formatWhen,
  movementTypeLabel,
  signedQuantity,
} from '@/domain/format';
import type { Movement } from '@/domain/types';
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
  useToast,
  type Column,
} from '@/components/ui';
import { Icon } from '@/components/Icon';

export function FinancePage() {
  const { data, role, adjustStock } = useWarehouse();
  const toast = useToast();
  if (!data) return null;
  const state = toStockState(data);
  const canAdjust = can(role, 'cycle_count');

  const total = inventoryValuation(state);
  const devices = inventoryValuation(state, 'device');
  const merch = inventoryValuation(state, 'merchandise');

  const promoSpend = data.movements
    .filter((m) => m.type === 'issue')
    .reduce((sum, m) => {
      const p = data.products.find((x) => x.id === m.productId);
      return p?.promotional ? sum + m.quantity * p.unitCost : sum;
    }, 0);

  const auditTrail = data.movements
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 12);

  const assets = serializedAssetRegister(data.units, data.products);
  const reconciliation = reconciliationRows(
    data.cycleCounts,
    data.products,
    data.movements,
  );

  const productName = (id: string) =>
    data.products.find((p) => p.id === id)?.name ?? id;
  const eventName = (id?: string) =>
    id ? (data.events.find((e) => e.id === id)?.name ?? id) : '—';

  const postAdjustment = async (row: (typeof reconciliation)[number]) => {
    // Bring book stock in line with the physical count and clear the variance
    // via an `adjustment` movement (idempotent — usually a no-op on quantity
    // because the cycle count already set the level). Scope the comparison to
    // the counted bin so per-bin counts don't reconcile against location totals.
    const product = data.products.find((p) => p.id === row.productId);
    // Serialized surplus can't be reconciled by a number — you can't fabricate
    // serials. The found units must be received/registered individually.
    if (product?.serialized && row.variance > 0) {
      toast.error(
        `Found ${row.variance} extra ${row.name} — receive/register the serial(s) instead of a numeric adjustment.`,
      );
      return;
    }
    const current = availableForProduct(
      state,
      row.productId,
      row.locationId,
      row.binId,
    );
    const ok = await adjustStock({
      productId: row.productId,
      locationId: row.locationId,
      binId: row.binId,
      quantityDelta: row.counted - current,
      reason: `Variance reconciled (${row.variance > 0 ? '+' : ''}${row.variance})`,
    });
    if (!ok) return;
    toast.success(`Variance cleared for ${row.name}`);
  };

  const columns: Column<Movement>[] = [
    {
      key: 'item',
      header: 'Movement',
      primary: true,
      render: (m) => (
        <span>
          <span className="font-semibold text-brand-700 dark:text-brand-300">
            {movementTypeLabel(m.type)}
          </span>{' '}
          {productName(m.productId)}
        </span>
      ),
    },
    { key: 'actor', header: 'By', render: (m) => actorName(m.actor) },
    { key: 'when', header: 'When', render: (m) => formatWhen(m.createdAt) },
    {
      key: 'qty',
      header: 'Qty',
      align: 'right',
      render: (m) => (
        <span className="tabular-nums font-semibold">
          {signedQuantity(m.type, m.quantity)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Finance & Valuation"
        icon="coins"
        subtitle="Costing, promo spend & audit trail"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Total value" value={money(total)} icon="coins" tone="emerald" />
        <StatCard label="Promo give-aways" value={money(promoSpend)} icon="trend" tone="amber" />
        <StatCard
          label="Open variances"
          value={reconciliation.length}
          icon="clipboard"
          tone={reconciliation.length > 0 ? 'rose' : 'emerald'}
        />
        <StatCard label="Movements" value={data.movements.length} icon="history" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <Card>
        <SectionTitle title="Valuation by category" />
        <div className="space-y-3">
          <BarRow
            label="Wearable devices"
            value={devices}
            max={total}
            valueLabel={money(devices)}
          />
          <BarRow
            label="Marketing merchandise"
            value={merch}
            max={total}
            tone="accent"
            valueLabel={money(merch)}
          />
        </div>
        <p className="mt-3 text-xs text-faint">
          Total inventory value {money(total)}
        </p>
      </Card>

      <Card>
        <SectionTitle
          title="Reconciliation"
          subtitle="Variances from the latest cycle counts"
          action={
            reconciliation.length > 0 ? (
              <Badge tone="amber">{reconciliation.length} variance(s)</Badge>
            ) : (
              <Badge tone="emerald">reconciled</Badge>
            )
          }
        />
        {reconciliation.length === 0 ? (
          <EmptyState icon="check" title="No open variances" message="Counts match system records." />
        ) : (
          <ul className="divide-y divide-line" aria-label="Reconciliation">
            {reconciliation.map((r) => (
              <li
                key={`${r.productId}|${r.locationId}|${r.binId ?? ''}`}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{r.name}</p>
                  <p className="font-mono text-xs text-faint">{r.sku}</p>
                </div>
                <div className="flex items-center gap-3 text-right">
                  <span className="text-xs text-faint">
                    {r.counted}/{r.expected}
                  </span>
                  <Badge tone={r.variance < 0 ? 'rose' : 'amber'}>
                    {r.variance > 0 ? `+${r.variance}` : r.variance}
                  </Badge>
                  {canAdjust && (
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => void postAdjustment(r)}
                    >
                      Post adjustment
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle
          title="Asset register"
          subtitle="Serialized devices in the field"
          action={<Badge tone="slate">{assets.length}</Badge>}
        />
        {assets.length === 0 ? (
          <EmptyState icon="tag" title="No serialized devices issued" />
        ) : (
          /* Grouped by product with a per-serial disclosure — 15 identical
             flat cards were an undifferentiated scroll on mobile (WH-29). */
          <ul className="space-y-2" aria-label="Asset register">
            {Array.from(
              assets.reduce((map, a) => {
                const group = map.get(a.productId) ?? {
                  name: a.productName,
                  rows: [] as typeof assets,
                };
                group.rows.push(a);
                map.set(a.productId, group);
                return map;
              }, new Map<string, { name: string; rows: typeof assets }>()),
            ).map(([productId, group]) => (
              <li key={productId}>
                <details className="group rounded-xl bg-inset/60">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3 py-2.5">
                    <span className="min-w-0 truncate text-sm font-medium text-ink">
                      {group.name}
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge tone="brand">{group.rows.length} in field</Badge>
                      <Icon
                        name="chevron"
                        className="h-4 w-4 text-faint transition group-open:rotate-90"
                      />
                    </span>
                  </summary>
                  <ul className="divide-y divide-line px-3 pb-2">
                    {group.rows.map((a) => (
                      <li
                        key={a.serialNumber}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <p className="min-w-0 truncate font-mono text-xs text-faint">
                          {a.serialNumber}
                        </p>
                        <div className="text-right">
                          <p className="text-sm text-ink">{a.assignedTo ?? 'Unassigned'}</p>
                          <p className="text-xs text-faint">{eventName(a.eventId)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle title="Audit trail" subtitle="Most recent movements" />
        {auditTrail.length === 0 ? (
          <EmptyState icon="clipboard" title="No movements yet" />
        ) : (
          <DataTable
            columns={columns}
            rows={auditTrail}
            keyOf={(m) => m.id}
            ariaLabel="Audit trail"
          />
        )}
      </Card>
      </div>
    </div>
  );
}
