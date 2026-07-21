import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useWarehouse } from "@/app/store";
import { toStockState } from "@/data/repository";
import {
  availableForProduct,
  inventoryValuation,
  lowStockProducts,
  onHand,
} from "@/domain/stock";
import {
  consumptionByEventType,
  deviceUtilization,
  fastMovingSkus,
  returnRate,
} from "@/domain/analytics";
import {
  consumptionRatePerDay,
  projectedStockout,
} from "@/domain/procurementAnalytics";
import { eventCosting } from "@/domain/events";
import { reconciliationRows } from "@/domain/reconciliation";
import { serializedAssetRegister } from "@/domain/assets";
import { inventoryTurnover, landedCost } from "@/domain/pricing";
import {
  allocationsToCsv,
  inventoryToCsv,
  movementsToCsv,
} from "@/domain/export";
import type { WarehouseExportKind } from "@/domain/export";
import { downloadText, downloadUrl } from "@/app/download";
import { prepareWarehouseExport } from "@/app/governedExports";
import {
  PO_STATUS_LABELS,
  formatWhen,
  movementTypeLabel,
  signedQuantity,
} from "@/domain/format";
import { normalizeWarehouseRole, type WarehouseRouteId } from "@/app/modules";
import { warehouseRouteIdForPath } from "@/app/authorization";
import { useSession } from "@/auth/session";
import type { Role } from "@/domain/types";
import { Icon, type IconName } from "@/components/Icon";
import {
  BarRow,
  Badge,
  Card,
  DataTable,
  DonutChart,
  EmptyState,
  HeroChipButton,
  SectionTitle,
  SegmentedControl,
  Sheet,
  StatCard,
  StaggerGrid,
  StaggerItem,
  compactMoney,
  money,
  useToast,
  type Column,
  type Tone,
} from "@/components/ui";
import type { Movement } from "@/domain/types";
import type { DeviceUtilizationRow } from "@/domain/analytics";

const EVENT_TYPE_LABELS: Record<string, string> = {
  corporate: "Corporate",
  government_lgu: "Government / LGU",
  medical_mission: "Medical Mission",
  vip_activation: "VIP Activation",
  b2c: "B2C",
  b2b: "B2B",
};

function issuedSeries(
  movements: { type: string; quantity: number; createdAt: string }[],
  days = 10,
): number[] {
  const today = new Date();
  const buckets: number[] = Array(days).fill(0);
  for (const m of movements) {
    if (m.type !== "issue") continue;
    const d = new Date(m.createdAt);
    const idx =
      days - 1 - Math.floor((today.getTime() - d.getTime()) / 86_400_000);
    if (idx >= 0 && idx < days) buckets[idx] = (buckets[idx] ?? 0) + m.quantity;
  }
  return buckets;
}

function IssuedComparison({
  recent,
  prior,
}: {
  recent: number;
  prior: number;
}) {
  const max = Math.max(recent, prior, 1);
  const rows = [
    { label: "Last 5d", value: recent, tone: "bg-brand-600" },
    { label: "Prior 5d", value: prior, tone: "bg-brand-300" },
  ];

  return (
    <div
      className="mt-2 space-y-1.5 rounded-xl bg-surface/70 p-2 ring-1 ring-line/70"
      aria-label={`Issued comparison: last 5 days ${recent}, prior 5 days ${prior}`}
    >
      {rows.map(({ label, value, tone }) => {
        const ratio = value / max;

        return (
          <div
            key={label}
            className="grid grid-cols-[3.25rem_minmax(0,1fr)_2.25rem] items-center gap-2 text-[0.65rem]"
          >
            <span className="font-semibold text-faint">{label}</span>
            <span className="h-1.5 overflow-hidden rounded-full bg-inset">
              <span
                className={`block h-full rounded-full ${tone}`}
                style={{
                  width: value === 0 ? "0%" : `${Math.max(8, ratio * 100)}%`,
                }}
              />
            </span>
            <span className="tnum text-right font-bold text-ink">{value}</span>
          </div>
        );
      })}
    </div>
  );
}

function DashboardHero({
  eyebrow,
  title,
  description,
  roleLabel,
  icon,
  action,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  roleLabel: string;
  icon: IconName;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className="hero-surface relative overflow-hidden rounded-3xl p-5 sm:p-6"
      data-testid="warehouse-dashboard-hero"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-1 rounded-l-3xl bg-gradient-to-b from-brand-500 to-brand-700"
      />
      <div
        aria-hidden
        data-testid="warehouse-dashboard-hero-watermark"
        className="pointer-events-none absolute bottom-4 right-4 z-0 text-brand-700 dark:text-brand-300"
        style={{ opacity: 0.05 }}
      >
        <Icon name={icon} className="h-32 w-32 sm:h-44 sm:w-44" />
      </div>

      <div className="relative z-10 grid min-w-0 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(17rem,20rem)] md:items-end">
        <div className="min-w-0">
          <p className="text-caption font-semibold uppercase tracking-wide text-faint">
            {eyebrow}
          </p>
          <h1 className="mt-1 font-display text-title text-ink sm:text-display">
            {title}
          </h1>
          <p className="mt-1.5 max-w-xl text-body text-muted">{description}</p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {action}
            <span className="chip bg-inset text-muted">{roleLabel}</span>
          </div>
        </div>

        <div className="min-w-0">{children}</div>
      </div>
    </section>
  );
}

function IssuedMetricDock({
  total,
  recent,
  prior,
  trendPct,
}: {
  total: number;
  recent: number;
  prior: number;
  trendPct: number;
}) {
  return (
    <div
      className="rounded-2xl border border-line/70 bg-inset/85 p-3 shadow-e1 backdrop-blur-sm sm:p-4"
      data-testid="warehouse-dashboard-hero-metric"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-caption font-semibold uppercase tracking-wide text-faint">
            10-day issued
          </p>
          <div className="mt-1 flex items-baseline gap-1">
            <span className="tnum text-2xl font-extrabold text-ink">
              {total}
            </span>
            <span className="text-xs font-medium text-faint">units</span>
          </div>
        </div>
        <span
          className={
            trendPct >= 0
              ? "chip bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
              : "chip bg-rose-500/15 text-rose-700 dark:text-rose-300"
          }
        >
          {trendPct >= 0 ? "+" : ""}
          {trendPct}%
        </span>
      </div>

      <IssuedComparison recent={recent} prior={prior} />
      <p className="mt-2 text-xs font-medium text-faint">
        Last 5 days compared with the previous 5.
      </p>
    </div>
  );
}

type Window = "30" | "90" | "all";

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
  | "lowStock"
  | "reconciliation"
  | "recentActivity"
  | "reservations"
  | "events"
  | "consumption"
  | "fastMoving"
  | "utilization"
  | "valuation"
  | "assets"
  | "reorder"
  | "openPOs"
  | "topValue";

const ROLE_PANELS: Record<Role, PanelId[]> = {
  logistics_supervisor: ["lowStock", "reconciliation", "recentActivity"],
  warehouse_supervisor: ["lowStock", "reconciliation", "recentActivity"],
  operations: ["reservations", "events", "consumption"],
  warehouse_operator: ["reservations", "events", "consumption"],
  finance: ["valuation", "reconciliation", "assets"],
  bi_analyst: ["fastMoving", "consumption", "utilization"],
  business_unit: ["lowStock", "reservations", "events"],
  marketing: ["consumption", "events", "fastMoving"],
  procurement: ["reorder", "openPOs", "lowStock"],
  pricing: ["topValue", "valuation", "fastMoving"],
  warehouse_admin: ["lowStock", "reconciliation", "recentActivity"],
};

/** Roles whose dashboard is analytics-driven get the date-window control. */
const WINDOWED_ROLES: Role[] = ["bi_analyst", "marketing"];

function OperatorDashboard({
  name,
  canOpenRoute,
}: {
  name?: string;
  canOpenRoute: (routeId: WarehouseRouteId) => boolean;
}) {
  const actions: Array<{
    label: string;
    to: string;
    icon: IconName;
    secondary?: { label: string; to: string };
  }> = [
    {
      label: "Receive and inspect",
      to: "/purchase-orders",
      icon: "truck" as const,
    },
    { label: "Put away", to: "/storage", icon: "pin" as const },
    { label: "Pick or issue", to: "/allocations", icon: "tag" as const },
    {
      label: "Returns and counts",
      to: "/returns",
      icon: "rotate",
      secondary: { label: "Cycle counts", to: "/cycle-counts" },
    },
  ];
  const canOpenPath = (path: string) => {
    const routeId = warehouseRouteIdForPath(path);
    return routeId ? canOpenRoute(routeId) : false;
  };
  const availableActions = actions
    .filter((action) => canOpenPath(action.to))
    .map((action) => ({
      ...action,
      secondary:
        action.secondary && canOpenPath(action.secondary.to)
          ? action.secondary
          : undefined,
    }));
  return (
    <div className="space-y-6">
      <section className="border-b border-line pb-5">
        <p className="text-caption font-semibold uppercase text-faint">
          Warehouse floor
        </p>
        <h1 className="mt-1 font-display text-title text-ink">
          {name ?? "Warehouse Operator"}
        </h1>
        <p className="mt-1 text-sm text-muted">
          Routine work ready for this shift.
        </p>
      </section>
      <section aria-labelledby="operator-overview">
        <h2
          id="operator-overview"
          className="font-display text-lg font-bold text-ink"
        >
          Overview
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {availableActions.map((action) => (
            <div
              key={action.label}
              className="rounded-lg border border-line bg-surface shadow-e1"
            >
              <Link
                to={action.to}
                className="flex min-h-20 items-center gap-3 px-4 py-3 transition hover:bg-inset"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-700">
                  <Icon name={action.icon} className="h-5 w-5" />
                </span>
                <span className="font-semibold text-ink">{action.label}</span>
                <Icon name="chevron" className="ml-auto h-4 w-4 text-faint" />
              </Link>
              {action.secondary ? (
                <Link
                  to={action.secondary.to}
                  className="flex min-h-11 items-center justify-between border-t border-line px-4 text-sm font-semibold text-brand-700 hover:bg-inset"
                >
                  {action.secondary.label}
                  <Icon name="chevron" className="h-4 w-4" />
                </Link>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export function DashboardPage() {
  const { data, role, roleLabel, source, can, canOpenRoute } = useWarehouse();
  const { profile } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<WarehouseExportKind | null>(null);
  const [window, setWindow] = useState<Window>("all");
  if (!data) return null;
  const operatorExperience =
    can("receive_stock") &&
    can("issue_items") &&
    !can("approve_stock_adjustment");
  if (operatorExperience) {
    return (
      <OperatorDashboard
        name={profile?.name?.split(/\s+/)[0]}
        canOpenRoute={canOpenRoute}
      />
    );
  }
  const liveDashboardRole: Role =
    can("manage_operation_routes") || can("resolve_exceptions")
      ? "logistics_supervisor"
      : can("set_pricing") || can("view_pricing")
        ? "pricing"
        : can("view_procurement")
          ? "procurement"
          : can("view_analytics")
            ? "bi_analyst"
            : can("view_finance")
              ? "finance"
              : can("reserve_allocate")
                ? "operations"
                : "business_unit";
  const dashboardRole =
    source === "memory" ? normalizeWarehouseRole(role) : liveDashboardRole;
  const rolePresentation = { label: roleLabel };
  const state = toStockState(data);
  const showWindow = WINDOWED_ROLES.includes(dashboardRole);

  const canExport = can("view_analytics") || can("view_finance");
  const exportCsv = async (kind: WarehouseExportKind, content: string) => {
    setExporting(kind);
    try {
      const prepared = await prepareWarehouseExport({
        source,
        kind,
        demoContent: content,
      });
      if (prepared.downloadUrl)
        downloadUrl(prepared.filename, prepared.downloadUrl);
      else downloadText(prepared.filename, prepared.demoContent ?? "");
      toast.success(
        source === "memory"
          ? `Downloaded demo export ${prepared.filename}`
          : `Recorded and downloaded ${prepared.filename}`,
      );
      setExportOpen(false);
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Export failed.");
    } finally {
      setExporting(null);
    }
  };

  const mv: Movement[] =
    window === "all" || !showWindow
      ? data.movements
      : data.movements.filter(
          (m) =>
            Date.now() - new Date(m.createdAt).getTime() <=
            Number(window) * 86_400_000,
        );

  // --- shared metrics ---
  const low = lowStockProducts(state);
  const value = inventoryValuation(state);
  const devicesValue = inventoryValuation(state, "device");
  const merchValue = inventoryValuation(state, "merchandise");
  const util = deviceUtilization(mv, data.products);
  const totalIssued = util.reduce((s, u) => s + u.issued, 0);
  const totalReturned = util.reduce((s, u) => s + u.returned, 0);
  const fast = fastMovingSkus(mv, data.products, 5);
  const maxFast = fast[0]?.issued ?? 0;
  const consumption = consumptionByEventType(mv, data.events);
  const maxConsumption = Math.max(1, ...consumption.map((c) => c.issued));
  const series = issuedSeries(data.movements);
  // Simple momentum trend (last 5 days vs prior 5).
  const recentIssuedTotal = series.reduce((sum, value) => sum + value, 0);
  const recentHalf = series.slice(-5).reduce((s, v) => s + v, 0);
  const priorHalf = series.slice(-10, -5).reduce((s, v) => s + v, 0);
  const issuedTrendPct =
    priorHalf === 0
      ? recentHalf > 0
        ? 100
        : 0
      : Math.round(((recentHalf - priorHalf) / priorHalf) * 100);
  const valuationSlices = [
    { label: "Devices", value: devicesValue, tone: "brand" as const },
    { label: "Merchandise", value: merchValue, tone: "accent" as const },
  ].filter((s) => s.value > 0);
  const consumptionSlices = consumption.map((c, i) => ({
    label: EVENT_TYPE_LABELS[c.eventType] ?? c.eventType,
    value: c.issued,
    tone: (["accent", "brand", "amber", "emerald", "rose", "slate"] as const)[
      i % 6
    ],
  }));

  const reserved = data.allocations.filter((a) => a.status === "reserved");
  const reservedCount = reserved.length;
  const reconciliation = reconciliationRows(
    data.cycleCounts,
    data.products,
    data.movements,
  );
  const assets = serializedAssetRegister(data.units, data.products);
  const promoSpend = data.movements
    .filter((m) => m.type === "issue")
    .reduce((sum, m) => {
      const p = data.products.find((x) => x.id === m.productId);
      return p?.promotional ? sum + m.quantity * p.unitCost : sum;
    }, 0);
  const inStockSkus = data.products.filter(
    (p) => availableForProduct(state, p.id) > 0,
  ).length;
  const openPOs = data.purchaseOrders.filter(
    (po) => po.status !== "received" && po.status !== "cancelled",
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
      const lead =
        supplier?.leadTimeDays ?? data.suppliers[0]?.leadTimeDays ?? 14;
      const { atRisk } = projectedStockout({
        available,
        ratePerDay: rate,
        leadTimeDays: lead,
      });
      return {
        product: p,
        available,
        deficit: Math.max(0, p.reorderPoint - available),
        atRisk,
      };
    })
    .filter((r) => r.deficit > 0 || r.atRisk)
    .sort(
      (a, b) => Number(b.atRisk) - Number(a.atRisk) || b.deficit - a.deficit,
    );
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
      (turnovers.reduce((s, r) => s + r.turnover, 0) /
        Math.max(1, turnovers.length)) *
        100,
    ) / 100;
  const multiSupplier = data.products.filter(
    (p) => data.lots.filter((l) => l.productId === p.id).length > 1,
  ).length;

  const productName = (id: string) =>
    data.products.find((p) => p.id === id)?.name ?? id;
  const eventName = (id?: string) =>
    id ? (data.events.find((e) => e.id === id)?.name ?? id) : "—";

  // --- per-role hero ---
  // One KPI surface (WH-8): the StatCards below are THE numbers; the hero
  // carries a live one-line status (WH-9) + the role's primary verb (WH-10)
  // + the "Issued (10d)" sparkline, which is not duplicated by any StatCard.
  const HERO_STATUS: Record<Role, string> = {
    logistics_supervisor: `${low.length} SKU${low.length === 1 ? "" : "s"} need reorder · ${reconciliation.length} variance${reconciliation.length === 1 ? "" : "s"} open`,
    warehouse_supervisor: `${low.length} SKU${low.length === 1 ? "" : "s"} need reorder · ${reconciliation.length} variance${reconciliation.length === 1 ? "" : "s"} open`,
    operations: `${reservedCount} reservation${reservedCount === 1 ? "" : "s"} pending · ${data.events.length} event${data.events.length === 1 ? "" : "s"}`,
    warehouse_operator: `${reservedCount} reservation${reservedCount === 1 ? "" : "s"} pending · ${data.events.length} event${data.events.length === 1 ? "" : "s"}`,
    finance: `${compactMoney(value)} on hand · ${reconciliation.length} variance${reconciliation.length === 1 ? "" : "s"} open`,
    bi_analyst: `${data.products.length} active SKUs · ${totalIssued} units issued`,
    business_unit: `${inStockSkus} SKUs in stock · ${reservedCount} reservation${reservedCount === 1 ? "" : "s"} pending`,
    marketing: `${compactMoney(promoSpend)} promo spend · ${data.events.length} event${data.events.length === 1 ? "" : "s"}`,
    procurement: `${reorderRows.length} SKU${reorderRows.length === 1 ? "" : "s"} to reorder · ${openPOs.length} open PO${openPOs.length === 1 ? "" : "s"}`,
    pricing: `${compactMoney(totalLanded)} at landed cost · ${multiSupplier} multi-supplier SKUs`,
    warehouse_admin: `${low.length} SKU${low.length === 1 ? "" : "s"} need reorder · ${reconciliation.length} variance${reconciliation.length === 1 ? "" : "s"} open`,
  };

  const HERO_CTA: Record<Role, { label: string; icon: IconName; to: string }> =
    {
      logistics_supervisor: {
        label: "Receive stock",
        icon: "truck",
        to: "/receiving",
      },
      warehouse_supervisor: {
        label: "Receive stock",
        icon: "truck",
        to: "/receiving",
      },
      operations: { label: "New demand", icon: "list", to: "/fulfillment" },
      warehouse_operator: {
        label: "Receive and inspect",
        icon: "truck",
        to: "/purchase-orders",
      },
      finance: { label: "Finance workspace", icon: "coins", to: "/finance" },
      bi_analyst: { label: "Data & reports", icon: "history", to: "/data" },
      business_unit: {
        label: "Request stock",
        icon: "list",
        to: "/fulfillment",
      },
      marketing: {
        label: "Request campaign stock",
        icon: "list",
        to: "/fulfillment",
      },
      procurement: {
        label: "Reorders & POs",
        icon: "cart",
        to: "/procurement",
      },
      pricing: { label: "Pricing workspace", icon: "trend", to: "/pricing" },
      warehouse_admin: {
        label: "Receive stock",
        icon: "truck",
        to: "/receiving",
      },
    };

  const KPIS: Record<Role, Kpi[]> = {
    logistics_supervisor: [
      {
        label: "Low-stock items",
        value: low.length,
        icon: "alert",
        tone: low.length ? "amber" : "emerald",
        to: "/inventory?filter=low",
        hint: "At or below reorder point",
      },
      {
        label: "Serialized in field",
        value: assets.length,
        icon: "tag",
        tone: "brand",
        to: "/inventory?filter=device",
        hint: "Serialized devices issued",
      },
      {
        label: "Open variances",
        value: reconciliation.length,
        icon: "clipboard",
        tone: reconciliation.length ? "rose" : "emerald",
        to: "/cycle-counts?filter=variances",
        hint: "Variance from last count",
      },
      {
        label: "Active SKUs",
        value: data.products.length,
        icon: "box",
        to: "/inventory",
        hint: "Products in the catalog",
      },
    ],
    warehouse_supervisor: [
      {
        label: "Low-stock items",
        value: low.length,
        icon: "alert",
        tone: low.length ? "amber" : "emerald",
        to: "/inventory?filter=low",
        hint: "At or below reorder point",
      },
      {
        label: "Serialized in field",
        value: assets.length,
        icon: "tag",
        tone: "brand",
        to: "/inventory?filter=device",
        hint: "Serialized devices issued",
      },
      {
        label: "Open variances",
        value: reconciliation.length,
        icon: "clipboard",
        tone: reconciliation.length ? "rose" : "emerald",
        to: "/cycle-counts?filter=variances",
        hint: "Variance from last count",
      },
      {
        label: "Active SKUs",
        value: data.products.length,
        icon: "box",
        to: "/inventory",
        hint: "Products in the catalog",
      },
    ],
    operations: [
      {
        label: "Pending reservations",
        value: reservedCount,
        icon: "tag",
        tone: "amber",
        to: "/allocations",
        hint: "Reserved, awaiting issue",
      },
      {
        label: "Events",
        value: data.events.length,
        icon: "calendar",
        tone: "brand",
        to: "/events",
        hint: "Activations & campaigns",
      },
      {
        label: "Units issued",
        value: totalIssued,
        icon: "truck",
        tone: "accent",
        to: "/allocations",
        hint: "Issued to events",
      },
      {
        label: "Device return rate",
        value: `${returnRate(totalIssued, totalReturned)}%`,
        icon: "trend",
        to: "/returns",
        hint: "Returned vs issued",
      },
    ],
    warehouse_operator: [
      {
        label: "Pending reservations",
        value: reservedCount,
        icon: "tag",
        tone: "amber",
        to: "/allocations",
        hint: "Reserved, awaiting issue",
      },
      {
        label: "Events",
        value: data.events.length,
        icon: "calendar",
        tone: "brand",
        to: "/events",
        hint: "Activations & campaigns",
      },
      {
        label: "Units issued",
        value: totalIssued,
        icon: "truck",
        tone: "accent",
        to: "/allocations",
        hint: "Issued to events",
      },
      {
        label: "Device return rate",
        value: `${returnRate(totalIssued, totalReturned)}%`,
        icon: "trend",
        to: "/returns",
        hint: "Returned vs issued",
      },
    ],
    finance: [
      {
        label: "Inventory Value",
        value: compactMoney(value),
        icon: "coins",
        tone: "emerald",
        to: "/finance",
        hint: "Valuation at cost",
      },
      {
        label: "Promo give-aways",
        value: compactMoney(promoSpend),
        icon: "trend",
        tone: "amber",
        to: "/finance",
        hint: "Promotional issuance cost",
      },
      {
        label: "Open variances",
        value: reconciliation.length,
        icon: "clipboard",
        tone: reconciliation.length ? "rose" : "emerald",
        to: "/finance",
        hint: "Reconciliation needed",
      },
      {
        label: "Assets in field",
        value: assets.length,
        icon: "tag",
        tone: "brand",
        to: "/finance",
        hint: "Serialized devices issued",
      },
    ],
    bi_analyst: [
      {
        label: "Active SKUs",
        value: data.products.length,
        icon: "box",
        to: "/inventory",
        hint: "Products in the catalog",
      },
      {
        label: "Inventory Value",
        value: compactMoney(value),
        icon: "coins",
        tone: "emerald",
        to: "/data",
        hint: "Valuation at cost",
      },
      {
        label: "Device return rate",
        value: `${returnRate(totalIssued, totalReturned)}%`,
        icon: "trend",
        tone: "accent",
        to: "/data",
        hint: "Returned vs issued",
      },
      {
        label: "Units issued",
        value: totalIssued,
        icon: "truck",
        tone: "brand",
        to: "/data",
        hint: "Total issued",
      },
    ],
    business_unit: [
      {
        label: "Available SKUs",
        value: inStockSkus,
        icon: "box",
        tone: "emerald",
        to: "/inventory",
        hint: "With stock on hand",
      },
      {
        label: "Pending reservations",
        value: reservedCount,
        icon: "tag",
        tone: "amber",
        to: "/allocations",
        hint: "Reserved, awaiting issue",
      },
      {
        label: "Low-stock items",
        value: low.length,
        icon: "alert",
        tone: low.length ? "amber" : "emerald",
        to: "/inventory?filter=low",
        hint: "At or below reorder point",
      },
      {
        label: "Events",
        value: data.events.length,
        icon: "calendar",
        tone: "brand",
        to: "/events",
        hint: "Activations & campaigns",
      },
    ],
    marketing: [
      {
        label: "Events",
        value: data.events.length,
        icon: "calendar",
        tone: "brand",
        to: "/events",
        hint: "Activations & campaigns",
      },
      {
        label: "Promo give-aways",
        value: compactMoney(promoSpend),
        icon: "trend",
        tone: "amber",
        to: "/allocations",
        hint: "Promotional issuance",
      },
      {
        label: "Units issued",
        value: totalIssued,
        icon: "truck",
        tone: "accent",
        to: "/allocations",
        hint: "Issued to events",
      },
      {
        label: "Device return rate",
        value: `${returnRate(totalIssued, totalReturned)}%`,
        icon: "rotate",
        to: "/returns",
        hint: "Returned vs issued",
      },
    ],
    procurement: [
      {
        label: "SKUs to reorder",
        value: low.length,
        icon: "cart",
        tone: "amber",
        to: "/procurement",
        hint: "Below reorder point",
      },
      {
        label: "Stockout risk",
        value: stockoutRisk,
        icon: "alert",
        tone: stockoutRisk ? "rose" : "emerald",
        to: "/procurement",
        hint: "Projected to run out",
      },
      {
        label: "Open POs",
        value: openPOs.length,
        icon: "list",
        tone: "brand",
        to: "/purchase-orders",
        hint: "In progress",
      },
      {
        label: "Avg lead time",
        value: `${avgLead}d`,
        icon: "calendar",
        tone: "accent",
        to: "/suppliers",
        hint: "Across suppliers",
      },
    ],
    pricing: [
      {
        label: "Landed value",
        value: compactMoney(totalLanded),
        icon: "coins",
        tone: "emerald",
        to: "/pricing",
        hint: "Inventory at landed cost",
      },
      {
        label: "Avg turnover",
        value: `${avgTurnover}×`,
        icon: "trend",
        tone: "accent",
        to: "/pricing",
        hint: "Inventory turns (90d)",
      },
      {
        label: "Multi-supplier SKUs",
        value: multiSupplier,
        icon: "building",
        tone: "amber",
        to: "/pricing",
        hint: "Sourced from 2+ suppliers",
      },
      {
        label: "Promo spend",
        value: compactMoney(promoSpend),
        icon: "tag",
        tone: "brand",
        to: "/pricing",
        hint: "Promotional cost",
      },
    ],
    warehouse_admin: [
      {
        label: "Low-stock items",
        value: low.length,
        icon: "alert",
        tone: low.length ? "amber" : "emerald",
        to: "/inventory?filter=low",
        hint: "At or below reorder point",
      },
      {
        label: "Serialized in field",
        value: assets.length,
        icon: "tag",
        tone: "brand",
        to: "/inventory?filter=device",
        hint: "Serialized devices issued",
      },
      {
        label: "Open variances",
        value: reconciliation.length,
        icon: "clipboard",
        tone: reconciliation.length ? "rose" : "emerald",
        to: "/cycle-counts?filter=variances",
        hint: "Variance from last count",
      },
      {
        label: "Active SKUs",
        value: data.products.length,
        icon: "box",
        to: "/inventory",
        hint: "Products in the catalog",
      },
    ],
  };

  const utilColumns: Column<DeviceUtilizationRow>[] = [
    { key: "name", header: "Device", primary: true, render: (r) => r.name },
    {
      key: "issued",
      header: "Issued",
      align: "right",
      render: (r) => r.issued,
    },
    {
      key: "returned",
      header: "Ret.",
      align: "right",
      render: (r) => r.returned,
    },
    { key: "out", header: "Out", align: "right", render: (r) => r.outstanding },
    {
      key: "rate",
      header: "Rate",
      align: "right",
      render: (r) => (
        <Badge tone={r.returnRate > 30 ? "amber" : "emerald"}>
          {r.returnRate}%
        </Badge>
      ),
    },
  ];

  const upcomingEvents = data.events
    .slice()
    .sort((a, b) => a.startDate.localeCompare(b.startDate));

  const PANELS: Record<PanelId, ReactNode> = {
    lowStock: (
      <Card key="lowStock">
        <SectionTitle
          title="Low-stock alerts"
          subtitle="At or below reorder point"
          action={
            low.length > 0 ? (
              <Badge tone="amber">{low.length}</Badge>
            ) : undefined
          }
        />
        {low.length === 0 ? (
          <EmptyState
            icon="check"
            title="All stocked up"
            message="No SKUs below reorder threshold."
          />
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
                    <p className="truncate text-sm font-medium text-ink">
                      {product.name}
                    </p>
                    <p className="font-mono text-xs text-faint">
                      {product.sku}
                    </p>
                  </div>
                  <Badge tone={available === 0 ? "rose" : "amber"}>
                    {available} left
                  </Badge>
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
              <li key={`${r.productId}|${r.locationId}|${r.binId ?? ""}`}>
                <button
                  type="button"
                  onClick={() => navigate("/cycle-counts?filter=variances")}
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition hover:opacity-80"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {r.name}
                    </p>
                    <p className="font-mono text-xs text-faint">{r.sku}</p>
                  </div>
                  <Badge tone={r.variance < 0 ? "rose" : "amber"}>
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
        <SectionTitle
          title="Recent activity"
          subtitle="Latest stock movements"
        />
        {recent.length === 0 ? (
          <EmptyState icon="history" title="No activity yet" />
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    <span className="font-semibold text-brand-700 dark:text-brand-300">
                      {movementTypeLabel(m.type)}
                    </span>{" "}
                    {productName(m.productId)}
                  </p>
                  <p className="text-xs text-faint">
                    {formatWhen(m.createdAt)}
                  </p>
                </div>
                <span className="tnum text-sm font-semibold text-ink">
                  {signedQuantity(m.type, m.quantity)}
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
          action={
            reservedCount > 0 ? (
              <Badge tone="amber">{reservedCount}</Badge>
            ) : undefined
          }
        />
        {reserved.length === 0 ? (
          <EmptyState icon="tag" title="No pending reservations" />
        ) : (
          <ul className="divide-y divide-line">
            {reserved.slice(0, 6).map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {productName(a.productId)}
                  </p>
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
                      <p className="truncate text-sm font-medium text-ink">
                        {ev.name}
                      </p>
                      <p className="text-xs text-faint">
                        {EVENT_TYPE_LABELS[ev.type] ?? ev.type}
                      </p>
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
        <SectionTitle
          title="Consumption by event type"
          subtitle="Issued units per engagement"
        />
        {consumption.length === 0 ? (
          <EmptyState icon="calendar" title="No events recorded" />
        ) : (
          <div className="flex items-center gap-4">
            {consumptionSlices.length > 0 && (
              <DonutChart
                slices={consumptionSlices}
                size={96}
                className="shrink-0"
              />
            )}
            <div className="min-w-0 flex-1 space-y-3">
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
              <BarRow
                key={f.productId}
                label={f.name}
                value={f.issued}
                max={maxFast}
                suffix=" pcs"
              />
            ))}
          </div>
        )}
      </Card>
    ),
    utilization: (
      <Card key="utilization">
        <SectionTitle
          title="Device utilization"
          subtitle="Issued vs returned"
        />
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
        <SectionTitle
          title="Valuation by category"
          subtitle="Devices vs merchandise"
        />
        <div className="flex items-center gap-4">
          {valuationSlices.length > 0 && (
            <DonutChart
              slices={valuationSlices}
              size={96}
              className="shrink-0"
            />
          )}
          <div className="min-w-0 flex-1 space-y-3">
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
                    <p className="truncate text-sm font-medium text-ink">
                      {a.productName}
                    </p>
                    <p className="font-mono text-xs text-faint">
                      {a.serialNumber}
                    </p>
                  </div>
                  <span className="text-sm text-ink">
                    {a.assignedTo ?? "Unassigned"}
                  </span>
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
            <button
              type="button"
              className="min-h-11 rounded-lg px-2 text-xs font-semibold text-brand-700 dark:text-brand-300"
              onClick={() => navigate("/procurement")}
            >
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
                    <p className="truncate text-sm font-medium text-ink">
                      {r.product.name}
                    </p>
                    <p className="font-mono text-xs text-faint">
                      {r.product.sku}
                    </p>
                  </div>
                  <Badge tone={r.atRisk ? "rose" : "amber"}>
                    {r.available} left
                  </Badge>
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
            <button
              type="button"
              className="min-h-11 rounded-lg px-2 text-xs font-semibold text-brand-700 dark:text-brand-300"
              onClick={() => navigate("/purchase-orders")}
            >
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
                  onClick={() => navigate("/purchase-orders")}
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition hover:opacity-80"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {data.suppliers.find((s) => s.id === po.supplierId)
                        ?.name ?? po.supplierId}
                    </p>
                    <p className="text-xs text-faint">
                      {po.lines.length} line(s)
                    </p>
                  </div>
                  <Badge
                    tone={
                      po.status === "partially_received" ? "amber" : "brand"
                    }
                  >
                    {PO_STATUS_LABELS[po.status]}
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
        <SectionTitle
          title="Top SKUs by value"
          subtitle="Landed cost × on hand"
        />
        <ul className="divide-y divide-line">
          {priceRows.slice(0, 6).map((r) => (
            <li
              key={r.product.id}
              className="flex items-center justify-between gap-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">
                  {r.product.name}
                </p>
                <p className="text-xs text-faint">{r.turnover}× turnover</p>
              </div>
              <span className="tnum text-sm font-semibold text-ink">
                {money(r.value)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    ),
  };

  const PANEL_ROUTE_REQUIREMENTS: Partial<Record<PanelId, WarehouseRouteId[]>> =
    {
      lowStock: ["product-detail"],
      reconciliation: ["cycle-counts"],
      events: ["event-detail"],
      utilization: ["product-detail"],
      assets: ["product-detail"],
      reorder: ["procurement", "product-detail"],
      openPOs: ["purchase-orders"],
    };
  const panels = ROLE_PANELS[dashboardRole].filter((panel) =>
    (PANEL_ROUTE_REQUIREMENTS[panel] ?? []).every(canOpenRoute),
  );
  // Greet by name like the shell home does (WH-7/J3-3); the role already
  // shows in the sidebar caption + account menu.
  const firstName = profile?.name?.split(/\s+/)[0];
  const heroCta = HERO_CTA[dashboardRole];
  const canOpenPath = (path: string) => {
    if (path === "/finance") return can("view_finance");
    const routeId = warehouseRouteIdForPath(path);
    return routeId ? canOpenRoute(routeId) : false;
  };
  const canOpenHeroCta = canOpenPath(heroCta.to);
  const visibleKpis = KPIS[dashboardRole].filter((kpi) => canOpenPath(kpi.to));

  return (
    <div className="space-y-6">
      <DashboardHero
        eyebrow="Warehouse dashboard"
        title={firstName ?? rolePresentation.label}
        description={HERO_STATUS[dashboardRole]}
        roleLabel={rolePresentation.label}
        icon={heroCta.icon}
        action={
          canOpenHeroCta ? (
            heroCta.to === "/finance" ? (
              <HeroChipButton icon={heroCta.icon} href="/finance">
                {heroCta.label}
              </HeroChipButton>
            ) : (
              <HeroChipButton
                icon={heroCta.icon}
                onClick={() => navigate(heroCta.to)}
              >
                {heroCta.label}
              </HeroChipButton>
            )
          ) : null
        }
      >
        <IssuedMetricDock
          total={recentIssuedTotal}
          recent={recentHalf}
          prior={priorHalf}
          trendPct={issuedTrendPct}
        />
      </DashboardHero>

      <StaggerGrid className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {visibleKpis.map((k) => (
          <StaggerItem key={k.label}>
            <StatCard
              label={k.label}
              value={k.value}
              icon={k.icon}
              tone={k.tone}
              hint={k.hint}
              {...(k.to === "/finance"
                ? { href: "/finance" }
                : { onClick: () => navigate(k.to) })}
            />
          </StaggerItem>
        ))}
      </StaggerGrid>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-base font-bold text-ink sm:text-lg">
          Overview
        </h2>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {showWindow && (
            <div className="w-44 max-w-full">
              <SegmentedControl<Window>
                ariaLabel="Analytics window"
                value={window}
                onChange={setWindow}
                options={[
                  { value: "30", label: "30d" },
                  { value: "90", label: "90d" },
                  { value: "all", label: "All" },
                ]}
              />
            </div>
          )}
          {/* Export lives with the data it exports, not as the hero's only
              action (WH-10). */}
          {canExport ? (
            <button
              type="button"
              className="btn-ghost btn-sm shrink-0"
              onClick={() => setExportOpen(true)}
            >
              <Icon name="download" className="h-4 w-4" /> Export data
            </button>
          ) : null}
        </div>
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
          <button
            type="button"
            disabled={exporting !== null}
            className="btn-outline w-full justify-between"
            onClick={() => void exportCsv("inventory", inventoryToCsv(state))}
          >
            {exporting === "inventory" ? "Preparing..." : "Inventory snapshot"}{" "}
            <Icon name="download" className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={exporting !== null}
            className="btn-outline w-full justify-between"
            onClick={() =>
              void exportCsv(
                "movements",
                movementsToCsv(data.movements, data.products),
              )
            }
          >
            {exporting === "movements" ? "Preparing..." : "Movement ledger"}{" "}
            <Icon name="download" className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={exporting !== null}
            className="btn-outline w-full justify-between"
            onClick={() =>
              void exportCsv(
                "allocations",
                allocationsToCsv(data.allocations, data.products, data.events),
              )
            }
          >
            {exporting === "allocations" ? "Preparing..." : "Allocations"}{" "}
            <Icon name="download" className="h-4 w-4" />
          </button>
          <p className="pt-2 text-xs text-faint">
            {source === "memory"
              ? "Demo exports stay on this device."
              : "Live exports are checksummed and recorded before download."}
          </p>
        </div>
      </Sheet>
    </div>
  );
}
