import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWarehouse } from '@/app/store';
import { toStockState } from '@/data/repository';
import {
  availableForProduct,
  inventoryValuation,
  lowStockProducts,
  onHand,
} from '@/domain/stock';
import {
  consumptionByEventType,
  deviceUtilization,
  fastMovingSkus,
  returnRate,
} from '@/domain/analytics';
import {
  consumptionRatePerDay,
  projectedStockout,
} from '@/domain/procurementAnalytics';
import { eventCosting } from '@/domain/events';
import { reconciliationRows } from '@/domain/reconciliation';
import { serializedAssetRegister } from '@/domain/assets';
import { inventoryTurnover, landedCost } from '@/domain/pricing';
import {
  allocationsToCsv,
  inventoryToCsv,
  movementsToCsv,
} from '@/domain/export';
import { downloadText } from '@/app/download';
import { ROLES, can } from '@/auth/roles';
import type { Role } from '@/domain/types';
import { Logo } from '@/components/Logo';
import { Icon, type IconName } from '@/components/Icon';
import {
  BarRow,
  Badge,
  Card,
  DataTable,
  EmptyState,
  SectionTitle,
  SegmentedControl,
  Sheet,
  Sparkline,
  StatCard,
  compactMoney,
  money,
  relativeTime,
  useToast,
  type Column,
  type Tone,
} from '@/components/ui';
import type { Movement } from '@/domain/types';
import type { DeviceUtilizationRow } from '@/domain/analytics';

const EVENT_TYPE_LABELS: Record<string, string> = {
  corporate: 'Corporate',
  government_lgu: 'Government / LGU',
  medical_mission: 'Medical Mission',
  vip_activation: 'VIP Activation',
  b2c: 'B2C',
  b2b: 'B2B',
};

function issuedSeries(
  movements: { type: string; quantity: number; createdAt: string }[],
  days = 10,
): number[] {
  const today = new Date();
  const buckets: number[] = Array(days).fill(0);
  for (const m of movements) {
    if (m.type !== 'issue') continue;
    const d = new Date(m.createdAt);
    const idx = days - 1 - Math.floor((today.getTime() - d.getTime()) / 86_400_000);
    if (idx >= 0 && idx < days) buckets[idx] = (buckets[idx] ?? 0) + m.quantity;
  }
  return buckets;
}

type Window = '30' | '90' | 'all';

interface Kpi {
  label: string;
  value: string | number;
  icon: IconName;
  tone?: Tone;
  /** Route the card drills into (capability-appropriate for the role). */
  to: string;
  /** One-line description of what the metric counts. */
  hint: string;
}

/** Panels available to compose role dashboards. */
type PanelId =
  | 'lowStock'
  | 'reconciliation'
  | 'recentActivity'
  | 'reservations'
  | 'events'
  | 'consumption'
  | 'fastMoving'
  | 'utilization'
  | 'valuation'
  | 'assets'
  | 'reorder'
  | 'openPOs'
  | 'topValue';

const ROLE_PANELS: Record<Role, PanelId[]> = {
  logistics_supervisor: ['lowStock', 'reconciliation', 'recentActivity'],
  operations: ['reservations', 'events', 'consumption'],
  finance: ['valuation', 'reconciliation', 'assets'],
  bi_analyst: ['fastMoving', 'consumption', 'utilization'],
  business_unit: ['lowStock', 'reservations', 'events'],
  marketing: ['consumption', 'events', 'fastMoving'],
  procurement: ['reorder', 'openPOs', 'lowStock'],
  pricing: ['topValue', 'valuation', 'fastMoving'],
};

/** Roles whose dashboard is analytics-driven get the date-window control. */
const WINDOWED_ROLES: Role[] = ['bi_analyst', 'marketing'];

export function DashboardPage() {
  const { data, role } = useWarehouse();
  const navigate = useNavigate();
  const toast = useToast();
  const [exportOpen, setExportOpen] = useState(false);
  const [window, setWindow] = useState<Window>('all');
  if (!data) return null;
  const state = toStockState(data);
  const showWindow = WINDOWED_ROLES.includes(role);

  const exportCsv = (name: string, content: string) => {
    downloadText(name, content);
    toast.success(`Exported ${name}`);
    setExportOpen(false);
  };

  const mv: Movement[] =
    window === 'all' || !showWindow
      ? data.movements
      : data.movements.filter(
          (m) =>
            Date.now() - new Date(m.createdAt).getTime() <=
            Number(window) * 86_400_000,
        );

  // --- shared metrics ---
  const low = lowStockProducts(state);
  const value = inventoryValuation(state);
  const devicesValue = inventoryValuation(state, 'device');
  const merchValue = inventoryValuation(state, 'merchandise');
  const util = deviceUtilization(mv, data.products);
  const totalIssued = util.reduce((s, u) => s + u.issued, 0);
  const totalReturned = util.reduce((s, u) => s + u.returned, 0);
  const fast = fastMovingSkus(mv, data.products, 5);
  const maxFast = fast[0]?.issued ?? 0;
  const consumption = consumptionByEventType(mv, data.events);
  const maxConsumption = Math.max(1, ...consumption.map((c) => c.issued));
  const series = issuedSeries(data.movements);

  const reserved = data.allocations.filter((a) => a.status === 'reserved');
  const reservedCount = reserved.length;
  const reconciliation = reconciliationRows(
    data.cycleCounts,
    data.products,
    data.movements,
  );
  const assets = serializedAssetRegister(data.units, data.products);
  const promoSpend = data.movements
    .filter((m) => m.type === 'issue')
    .reduce((sum, m) => {
      const p = data.products.find((x) => x.id === m.productId);
      return p?.promotional ? sum + m.quantity * p.unitCost : sum;
    }, 0);
  const inStockSkus = data.products.filter(
    (p) => availableForProduct(state, p.id) > 0,
  ).length;
  const openPOs = data.purchaseOrders.filter(
    (po) => po.status !== 'received' && po.status !== 'cancelled',
  );
  const recent = data.movements
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);

  const reorderRows = data.products
    .map((p) => {
      const available = availableForProduct(state, p.id);
      const supplier = data.suppliers.find((s) =>
        data.lots.some((l) => l.productId === p.id && l.supplierId === s.id),
      );
      const rate = consumptionRatePerDay(data.movements, p.id, 90);
      const lead = supplier?.leadTimeDays ?? data.suppliers[0]?.leadTimeDays ?? 14;
      const { atRisk } = projectedStockout({ available, ratePerDay: rate, leadTimeDays: lead });
      return { product: p, available, deficit: Math.max(0, p.reorderPoint - available), atRisk };
    })
    .filter((r) => r.deficit > 0 || r.atRisk)
    .sort((a, b) => Number(b.atRisk) - Number(a.atRisk) || b.deficit - a.deficit);
  const stockoutRisk = reorderRows.filter((r) => r.atRisk).length;
  const avgLead = Math.round(
    data.suppliers.reduce((s, x) => s + x.leadTimeDays, 0) /
      Math.max(1, data.suppliers.length),
  );

  const priceRows = data.products
    .map((p) => {
      const oh = onHand(state, p.id);
      const landed = landedCost(p, data.lots);
      return {
        product: p,
        landed,
        value: oh * landed,
        turnover: inventoryTurnover(data.movements, oh, p.id, 90),
      };
    })
    .sort((a, b) => b.value - a.value);
  const totalLanded = priceRows.reduce((s, r) => s + r.value, 0);
  const turnovers = priceRows.filter((r) => r.turnover > 0);
  const avgTurnover =
    Math.round(
      (turnovers.reduce((s, r) => s + r.turnover, 0) / Math.max(1, turnovers.length)) * 100,
    ) / 100;
  const multiSupplier = data.products.filter(
    (p) => data.lots.filter((l) => l.productId === p.id).length > 1,
  ).length;

  const productName = (id: string) => data.products.find((p) => p.id === id)?.name ?? id;
  const eventName = (id?: string) =>
    id ? (data.events.find((e) => e.id === id)?.name ?? id) : '—';

  // --- per-role hero + KPIs ---
  const HERO: Record<Role, { label: string; value: string | number }> = {
    logistics_supervisor: { label: 'Low-stock items', value: low.length },
    operations: { label: 'Pending reservations', value: reservedCount },
    finance: { label: 'Inventory value', value: compactMoney(value) },
    bi_analyst: { label: 'Inventory value', value: compactMoney(value) },
    business_unit: { label: 'Available SKUs', value: inStockSkus },
    marketing: { label: 'Promo give-aways', value: compactMoney(promoSpend) },
    procurement: { label: 'SKUs to reorder', value: low.length },
    pricing: { label: 'Inventory at landed cost', value: compactMoney(totalLanded) },
  };

  const KPIS: Record<Role, Kpi[]> = {
    logistics_supervisor: [
      { label: 'Low-stock items', value: low.length, icon: 'alert', tone: low.length ? 'amber' : 'emerald', to: '/inventory?filter=low', hint: 'At or below reorder point' },
      { label: 'Serialized in field', value: assets.length, icon: 'tag', tone: 'brand', to: '/inventory?filter=device', hint: 'Serialized devices issued' },
      { label: 'Open variances', value: reconciliation.length, icon: 'clipboard', tone: reconciliation.length ? 'rose' : 'emerald', to: '/cycle-counts?filter=variances', hint: 'Variance from last count' },
      { label: 'Active SKUs', value: data.products.length, icon: 'box', to: '/inventory', hint: 'Products in the catalog' },
    ],
    operations: [
      { label: 'Pending reservations', value: reservedCount, icon: 'tag', tone: 'amber', to: '/allocations', hint: 'Reserved, awaiting issue' },
      { label: 'Events', value: data.events.length, icon: 'calendar', tone: 'brand', to: '/events', hint: 'Activations & campaigns' },
      { label: 'Units issued', value: totalIssued, icon: 'truck', tone: 'accent', to: '/allocations', hint: 'Issued to events' },
      { label: 'Device return rate', value: `${returnRate(totalIssued, totalReturned)}%`, icon: 'trend', to: '/returns', hint: 'Returned vs issued' },
    ],
    finance: [
      { label: 'Inventory Value', value: compactMoney(value), icon: 'coins', tone: 'emerald', to: '/finance', hint: 'Valuation at cost' },
      { label: 'Promo give-aways', value: compactMoney(promoSpend), icon: 'trend', tone: 'amber', to: '/finance', hint: 'Promotional issuance cost' },
      { label: 'Open variances', value: reconciliation.length, icon: 'clipboard', tone: reconciliation.length ? 'rose' : 'emerald', to: '/finance', hint: 'Reconciliation needed' },
      { label: 'Assets in field', value: assets.length, icon: 'tag', tone: 'brand', to: '/finance', hint: 'Serialized devices issued' },
    ],
    bi_analyst: [
      { label: 'Active SKUs', value: data.products.length, icon: 'box', to: '/inventory', hint: 'Products in the catalog' },
      { label: 'Inventory Value', value: compactMoney(value), icon: 'coins', tone: 'emerald', to: '/data', hint: 'Valuation at cost' },
      { label: 'Device return rate', value: `${returnRate(totalIssued, totalReturned)}%`, icon: 'trend', tone: 'accent', to: '/data', hint: 'Returned vs issued' },
      { label: 'Units issued', value: totalIssued, icon: 'truck', tone: 'brand', to: '/data', hint: 'Total issued' },
    ],
    business_unit: [
      { label: 'Available SKUs', value: inStockSkus, icon: 'box', tone: 'emerald', to: '/inventory', hint: 'With stock on hand' },
      { label: 'Pending reservations', value: reservedCount, icon: 'tag', tone: 'amber', to: '/allocations', hint: 'Reserved, awaiting issue' },
      { label: 'Low-stock items', value: low.length, icon: 'alert', tone: low.length ? 'amber' : 'emerald', to: '/inventory?filter=low', hint: 'At or below reorder point' },
      { label: 'Events', value: data.events.length, icon: 'calendar', tone: 'brand', to: '/events', hint: 'Activations & campaigns' },
    ],
    marketing: [
      { label: 'Events', value: data.events.length, icon: 'calendar', tone: 'brand', to: '/events', hint: 'Activations & campaigns' },
      { label: 'Promo give-aways', value: compactMoney(promoSpend), icon: 'trend', tone: 'amber', to: '/allocations', hint: 'Promotional issuance' },
      { label: 'Units issued', value: totalIssued, icon: 'truck', tone: 'accent', to: '/allocations', hint: 'Issued to events' },
      { label: 'Device return rate', value: `${returnRate(totalIssued, totalReturned)}%`, icon: 'rotate', to: '/returns', hint: 'Returned vs issued' },
    ],
    procurement: [
      { label: 'SKUs to reorder', value: low.length, icon: 'cart', tone: 'amber', to: '/procurement', hint: 'Below reorder point' },
      { label: 'Stockout risk', value: stockoutRisk, icon: 'alert', tone: stockoutRisk ? 'rose' : 'emerald', to: '/procurement', hint: 'Projected to run out' },
      { label: 'Open POs', value: openPOs.length, icon: 'list', tone: 'brand', to: '/purchase-orders', hint: 'In progress' },
      { label: 'Avg lead time', value: `${avgLead}d`, icon: 'calendar', tone: 'accent', to: '/suppliers', hint: 'Across suppliers' },
    ],
    pricing: [
      { label: 'Landed value', value: compactMoney(totalLanded), icon: 'coins', tone: 'emerald', to: '/pricing', hint: 'Inventory at landed cost' },
      { label: 'Avg turnover', value: `${avgTurnover}×`, icon: 'trend', tone: 'accent', to: '/pricing', hint: 'Inventory turns (90d)' },
      { label: 'Multi-supplier SKUs', value: multiSupplier, icon: 'building', tone: 'amber', to: '/pricing', hint: 'Sourced from 2+ suppliers' },
      { label: 'Promo spend', value: compactMoney(promoSpend), icon: 'tag', tone: 'brand', to: '/pricing', hint: 'Promotional cost' },
    ],
  };

  const utilColumns: Column<DeviceUtilizationRow>[] = [
    { key: 'name', header: 'Device', primary: true, render: (r) => r.name },
    { key: 'issued', header: 'Issued', align: 'right', render: (r) => r.issued },
    { key: 'returned', header: 'Ret.', align: 'right', render: (r) => r.returned },
    { key: 'out', header: 'Out', align: 'right', render: (r) => r.outstanding },
    {
      key: 'rate',
      header: 'Rate',
      align: 'right',
      render: (r) => (
        <Badge tone={r.returnRate > 30 ? 'amber' : 'emerald'}>{r.returnRate}%</Badge>
      ),
    },
  ];

  const upcomingEvents = data.events.slice().sort((a, b) => a.startDate.localeCompare(b.startDate));

  const PANELS: Record<PanelId, ReactNode> = {
    lowStock: (
      <Card key="lowStock">
        <SectionTitle
          title="Low-stock alerts"
          subtitle="At or below reorder point"
          action={low.length > 0 ? <Badge tone="amber">{low.length}</Badge> : undefined}
        />
        {low.length === 0 ? (
          <EmptyState icon="check" title="All stocked up" message="No SKUs below reorder threshold." />
        ) : (
          <ul className="divide-y divide-line">
            {low.slice(0, 6).map(({ product, available }) => (
              <li key={product.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/inventory/${product.id}`)}
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition hover:opacity-80"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{product.name}</p>
                    <p className="font-mono text-xs text-faint">{product.sku}</p>
                  </div>
                  <Badge tone={available === 0 ? 'rose' : 'amber'}>{available} left</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    ),
    reconciliation: (
      <Card key="reconciliation">
        <SectionTitle
          title="Reconciliation"
          subtitle="Variances from latest counts"
          action={
            reconciliation.length > 0 ? (
              <Badge tone="amber">{reconciliation.length}</Badge>
            ) : (
              <Badge tone="emerald">clean</Badge>
            )
          }
        />
        {reconciliation.length === 0 ? (
          <EmptyState icon="check" title="No open variances" />
        ) : (
          <ul className="divide-y divide-line">
            {reconciliation.slice(0, 6).map((r) => (
              <li key={r.productId}>
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      can(role, 'view_finance')
                        ? '/finance'
                        : '/cycle-counts?filter=variances',
                    )
                  }
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition hover:opacity-80"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{r.name}</p>
                    <p className="font-mono text-xs text-faint">{r.sku}</p>
                  </div>
                  <Badge tone={r.variance < 0 ? 'rose' : 'amber'}>
                    {r.variance > 0 ? `+${r.variance}` : r.variance}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    ),
    recentActivity: (
      <Card key="recentActivity">
        <SectionTitle title="Recent activity" subtitle="Latest stock movements" />
        {recent.length === 0 ? (
          <EmptyState icon="history" title="No activity yet" />
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    <span className="uppercase text-brand-700 dark:text-brand-300">{m.type}</span>{' '}
                    {productName(m.productId)}
                  </p>
                  <p className="text-xs text-faint">{relativeTime(m.createdAt)}</p>
                </div>
                <span className="tnum text-sm font-semibold text-ink">
                  {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    ),
    reservations: (
      <Card key="reservations">
        <SectionTitle
          title="Pending reservations"
          subtitle="Awaiting issue"
          action={reservedCount > 0 ? <Badge tone="amber">{reservedCount}</Badge> : undefined}
        />
        {reserved.length === 0 ? (
          <EmptyState icon="tag" title="No pending reservations" />
        ) : (
          <ul className="divide-y divide-line">
            {reserved.slice(0, 6).map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{productName(a.productId)}</p>
                  <p className="text-xs text-faint">{eventName(a.eventId)}</p>
                </div>
                <Badge tone="amber">{a.quantity}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Card>
    ),
    events: (
      <Card key="events">
        <SectionTitle title="Events" subtitle="Consumption & costing" />
        {upcomingEvents.length === 0 ? (
          <EmptyState icon="calendar" title="No events" />
        ) : (
          <ul className="divide-y divide-line">
            {upcomingEvents.slice(0, 6).map((ev) => {
              const c = eventCosting(data.movements, data.products, ev.id);
              return (
                <li key={ev.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/events/${ev.id}`)}
                    className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition hover:opacity-80"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">{ev.name}</p>
                      <p className="text-xs text-faint">{EVENT_TYPE_LABELS[ev.type] ?? ev.type}</p>
                    </div>
                    <span className="tnum text-sm font-semibold text-ink">
                      {money(c.consumedValue)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    ),
    consumption: (
      <Card key="consumption">
        <SectionTitle title="Consumption by event type" subtitle="Issued units per engagement" />
        {consumption.length === 0 ? (
          <EmptyState icon="calendar" title="No events recorded" />
        ) : (
          <div className="space-y-3">
            {consumption.map((c) => (
              <BarRow
                key={c.eventType}
                label={EVENT_TYPE_LABELS[c.eventType] ?? c.eventType}
                value={c.issued}
                max={maxConsumption}
                tone="accent"
                suffix=" pcs"
              />
            ))}
          </div>
        )}
      </Card>
    ),
    fastMoving: (
      <Card key="fastMoving">
        <SectionTitle title="Fast-moving SKUs" subtitle="By quantity issued" />
        {fast.length === 0 ? (
          <EmptyState title="No issuance yet" />
        ) : (
          <div className="space-y-3">
            {fast.map((f) => (
              <BarRow key={f.productId} label={f.name} value={f.issued} max={maxFast} suffix=" pcs" />
            ))}
          </div>
        )}
      </Card>
    ),
    utilization: (
      <Card key="utilization">
        <SectionTitle title="Device utilization" subtitle="Issued vs returned" />
        {util.length === 0 ? (
          <EmptyState icon="trend" title="No device activity" />
        ) : (
          <DataTable
            columns={utilColumns}
            rows={util}
            keyOf={(r) => r.productId}
            ariaLabel="Device utilization"
            onRowClick={(r) => navigate(`/inventory/${r.productId}`)}
          />
        )}
      </Card>
    ),
    valuation: (
      <Card key="valuation">
        <SectionTitle title="Valuation by category" subtitle="Devices vs merchandise" />
        <div className="space-y-3">
          <BarRow
            label="Wearable devices"
            value={devicesValue}
            max={value}
            valueLabel={money(devicesValue)}
          />
          <BarRow
            label="Marketing merchandise"
            value={merchValue}
            max={value}
            tone="accent"
            valueLabel={money(merchValue)}
          />
        </div>
        <p className="mt-3 text-xs text-faint">
          Devices {money(devicesValue)} • Merchandise {money(merchValue)}
        </p>
      </Card>
    ),
    assets: (
      <Card key="assets">
        <SectionTitle
          title="Asset register"
          subtitle="Serialized devices in the field"
          action={<Badge tone="slate">{assets.length}</Badge>}
        />
        {assets.length === 0 ? (
          <EmptyState icon="tag" title="No serialized devices issued" />
        ) : (
          <ul className="divide-y divide-line">
            {assets.slice(0, 6).map((a) => (
              <li key={a.serialNumber}>
                <button
                  type="button"
                  onClick={() => navigate(`/inventory/${a.productId}`)}
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition hover:opacity-80"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{a.productName}</p>
                    <p className="font-mono text-xs text-faint">{a.serialNumber}</p>
                  </div>
                  <span className="text-sm text-ink">{a.assignedTo ?? 'Unassigned'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    ),
    reorder: (
      <Card key="reorder">
        <SectionTitle
          title="Reorder worklist"
          subtitle="At-risk first"
          action={
            <button type="button" className="text-xs font-semibold text-brand-700 dark:text-brand-300" onClick={() => navigate('/procurement')}>
              View all
            </button>
          }
        />
        {reorderRows.length === 0 ? (
          <EmptyState icon="check" title="Nothing to reorder" />
        ) : (
          <ul className="divide-y divide-line">
            {reorderRows.slice(0, 6).map((r) => (
              <li key={r.product.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/inventory/${r.product.id}`)}
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition hover:opacity-80"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{r.product.name}</p>
                    <p className="font-mono text-xs text-faint">{r.product.sku}</p>
                  </div>
                  <Badge tone={r.atRisk ? 'rose' : 'amber'}>{r.available} left</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    ),
    openPOs: (
      <Card key="openPOs">
        <SectionTitle
          title="Open purchase orders"
          subtitle="In progress"
          action={
            <button type="button" className="text-xs font-semibold text-brand-700 dark:text-brand-300" onClick={() => navigate('/purchase-orders')}>
              View all
            </button>
          }
        />
        {openPOs.length === 0 ? (
          <EmptyState icon="list" title="No open POs" />
        ) : (
          <ul className="divide-y divide-line">
            {openPOs.slice(0, 6).map((po) => (
              <li key={po.id}>
                <button
                  type="button"
                  onClick={() => navigate('/purchase-orders')}
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition hover:opacity-80"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {data.suppliers.find((s) => s.id === po.supplierId)?.name ?? po.supplierId}
                    </p>
                    <p className="text-xs text-faint">{po.lines.length} line(s)</p>
                  </div>
                  <Badge tone={po.status === 'partially_received' ? 'amber' : 'brand'}>
                    {po.status.replace('_', ' ')}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    ),
    topValue: (
      <Card key="topValue">
        <SectionTitle title="Top SKUs by value" subtitle="Landed cost × on hand" />
        <ul className="divide-y divide-line">
          {priceRows.slice(0, 6).map((r) => (
            <li key={r.product.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{r.product.name}</p>
                <p className="text-xs text-faint">{r.turnover}× turnover</p>
              </div>
              <span className="tnum text-sm font-semibold text-ink">{money(r.value)}</span>
            </li>
          ))}
        </ul>
      </Card>
    ),
  };

  const panels = ROLE_PANELS[role];
  const hero = HERO[role];

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-brand-grad p-5 text-white shadow-navy sm:p-6">
        <div className="absolute -right-8 -top-10 opacity-10">
          <Logo className="h-40 w-auto" variant="light" />
        </div>
        <div className="relative">
          <p className="text-sm text-brand-100/80">Welcome back,</p>
          <h1 className="font-display text-2xl font-extrabold sm:text-3xl">{ROLES[role].label}</h1>
          <p className="mt-1 max-w-md text-sm text-brand-100/70">{ROLES[role].description}</p>
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/25"
          >
            <Icon name="download" className="h-4 w-4" /> Export data
          </button>
          <div className="mt-4 flex items-end justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-brand-100/70">{hero.label}</p>
              <p className="tnum text-2xl font-extrabold">{hero.value}</p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase tracking-wide text-brand-100/70">Issued (10d)</p>
              <Sparkline values={series} className="text-accent-soft" width={120} />
            </div>
          </div>
        </div>
      </div>

      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPIS[role].map((k) => (
          <StatCard
            key={k.label}
            label={k.label}
            value={k.value}
            icon={k.icon}
            tone={k.tone}
            hint={k.hint}
            onClick={() => navigate(k.to)}
          />
        ))}
      </div>

      <div className="flex items-center justify-between gap-3">
        <h2 className="font-display text-base font-bold text-ink sm:text-lg">
          {ROLES[role].label} overview
        </h2>
        {showWindow && (
          <div className="w-44">
            <SegmentedControl<Window>
              ariaLabel="Analytics window"
              value={window}
              onChange={setWindow}
              options={[
                { value: '30', label: '30d' },
                { value: '90', label: '90d' },
                { value: 'all', label: 'All' },
              ]}
            />
          </div>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {panels.map((id) => PANELS[id])}
      </div>

      <Sheet
        open={exportOpen}
        onOpenChange={setExportOpen}
        title="Export raw data"
        description="Download CSVs for offline analysis & reconciliation."
      >
        <div className="space-y-2">
          <button type="button" className="btn-outline w-full justify-between" onClick={() => exportCsv('inventory.csv', inventoryToCsv(state))}>
            Inventory snapshot <Icon name="download" className="h-4 w-4" />
          </button>
          <button type="button" className="btn-outline w-full justify-between" onClick={() => exportCsv('movements.csv', movementsToCsv(data.movements, data.products))}>
            Movement ledger <Icon name="download" className="h-4 w-4" />
          </button>
          <button type="button" className="btn-outline w-full justify-between" onClick={() => exportCsv('allocations.csv', allocationsToCsv(data.allocations, data.products, data.events))}>
            Allocations <Icon name="download" className="h-4 w-4" />
          </button>
        </div>
      </Sheet>
    </div>
  );
}
