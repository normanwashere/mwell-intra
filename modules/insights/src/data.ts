"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@intra/auth";
import { can, type UserRoles } from "@intra/rbac";
import { INSIGHTS_DEMO_DATA } from "./seed";
import type {
  InsightArea,
  InsightDataStatus,
  InsightMetric,
  InsightMetricStatus,
  InsightsData,
  InsightTargetDirection,
} from "./types";

type UnknownRow = Record<string, unknown>;
const AREAS: InsightArea[] = [
  "warehouse",
  "procurement",
  "legal",
  "finance",
  "executive",
];
const text = (value: unknown, fallback = "") =>
  typeof value === "string" && value ? value : fallback;
const number = (value: unknown, fallback = 0) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const nullableNumber = (value: unknown) =>
  value == null ? null : number(value);
const nullableText = (value: unknown) =>
  typeof value === "string" && value ? value : null;

const TARGET_DIRECTIONS: InsightTargetDirection[] = [
  "minimum",
  "maximum",
  "range",
  "informational",
];
const DATA_STATUSES: InsightDataStatus[] = ["current", "no_data", "incomplete"];

export function evaluateMetricStatus(
  metric: Pick<
    InsightMetric,
    | "value"
    | "targetDirection"
    | "targetMin"
    | "targetMax"
    | "dataStatus"
    | "sampleCount"
  >,
): InsightMetricStatus {
  if (
    metric.dataStatus === "no_data" ||
    metric.sampleCount === 0 ||
    metric.value == null
  )
    return "no_data";
  if (metric.dataStatus === "incomplete") return "incomplete";
  if (metric.targetDirection === "informational") return "informational";

  if (metric.targetDirection === "minimum") {
    if (metric.targetMin == null) return "informational";
    if (metric.value >= metric.targetMin) return "on_target";
    return metric.targetMin > 0 && metric.value >= metric.targetMin * 0.9
      ? "review"
      : "critical";
  }

  if (metric.targetDirection === "maximum") {
    if (metric.targetMax == null) return "informational";
    if (metric.value <= metric.targetMax) return "on_target";
    return metric.targetMax > 0 && metric.value <= metric.targetMax * 1.1
      ? "review"
      : "critical";
  }

  if (metric.targetMin == null || metric.targetMax == null)
    return "informational";
  if (metric.value >= metric.targetMin && metric.value <= metric.targetMax)
    return "on_target";
  const tolerance = Math.max((metric.targetMax - metric.targetMin) * 0.1, 0);
  return metric.value >= metric.targetMin - tolerance &&
    metric.value <= metric.targetMax + tolerance
    ? "review"
    : "critical";
}

export function mapInsightRow(row: UnknownRow): InsightMetric {
  const targetDirectionText = text(
    row.target_direction,
    "informational",
  ) as InsightTargetDirection;
  const dataStatusText = text(
    row.data_status,
    "incomplete",
  ) as InsightDataStatus;
  const metric = {
    id: text(row.id),
    area: text(row.area) as InsightArea,
    label: text(row.label),
    value: nullableNumber(row.value),
    unit: text(row.unit) || undefined,
    targetDirection: TARGET_DIRECTIONS.includes(targetDirectionText)
      ? targetDirectionText
      : "informational",
    targetMin: row.target_min == null ? undefined : number(row.target_min),
    targetMax: row.target_max == null ? undefined : number(row.target_max),
    dataStatus: DATA_STATUSES.includes(dataStatusText)
      ? dataStatusText
      : "incomplete",
    sampleCount: Math.max(0, number(row.sample_count)),
    detail: text(row.detail),
    sourceHref: text(row.source_href, "/insights"),
    reportingPeriodStart: nullableText(row.reporting_period_start),
    reportingPeriodEnd: nullableText(row.reporting_period_end),
    sourceUpdatedAt: nullableText(row.source_updated_at),
    extractedAt: text(row.extracted_at),
  } satisfies Omit<InsightMetric, "status">;
  return { ...metric, status: evaluateMetricStatus(metric) };
}

export function resolveGovernedSource(
  metric: Pick<InsightMetric, "sourceHref">,
  roles: Partial<UserRoles>,
) {
  const href = metric.sourceHref;
  const accessible =
    href === "/work" ||
    (href === "/warehouse/analytics" &&
      can(roles, "warehouse", "view_analytics")) ||
    (href === "/warehouse/cycle-counts" &&
      (can(roles, "warehouse", "cycle_count") ||
        can(roles, "warehouse", "approve_stock_adjustment"))) ||
    (href === "/warehouse/exceptions" &&
      can(roles, "warehouse", "view_exceptions")) ||
    (href === "/procurement/purchase-orders" &&
      (can(roles, "procurement", "author_po") ||
        can(roles, "procurement", "view_finance"))) ||
    (href === "/procurement/approvals" &&
      can(roles, "procurement", "approve_request")) ||
    (href === "/legal/accreditation" &&
      can(roles, "legal", "review_accreditation")) ||
    (href === "/finance" &&
      (can(roles, "warehouse", "view_finance") ||
        can(roles, "procurement", "view_finance")));
  return accessible
    ? { accessible: true, href, label: "Open governed source" }
    : { accessible: false, href: null, label: "Source access restricted" };
}

const STATUS_PRIORITY: Record<InsightMetricStatus, number> = {
  critical: 0,
  incomplete: 1,
  no_data: 1,
  review: 2,
  informational: 3,
  on_target: 4,
};

export function metricStatusPresentation(status: InsightMetricStatus) {
  const presentations = {
    critical: { label: "Critical", tone: "rose" },
    review: { label: "Review", tone: "amber" },
    on_target: { label: "On target", tone: "emerald" },
    informational: { label: "Information", tone: "cyan" },
    no_data: { label: "No data", tone: "slate" },
    incomplete: { label: "Incomplete", tone: "amber" },
  } as const;
  return presentations[status];
}

export function getSnapshotTruth(online: boolean, extractedAt: string) {
  if (!online)
    return {
      label: "Offline snapshot",
      tone: "amber" as const,
      detail:
        "Showing the last available extraction. Reconnect before making a decision.",
    };
  if (!extractedAt)
    return {
      label: "Awaiting data",
      tone: "slate" as const,
      detail: "No governed extraction is available yet.",
    };
  return {
    label: "Current extraction",
    tone: "emerald" as const,
    detail: "Connected. Metric freshness is shown on each indicator.",
  };
}

export function prioritizeMetrics(
  metrics: readonly InsightMetric[],
): InsightMetric[] {
  return metrics
    .map((metric, index) => ({ metric, index }))
    .sort(
      (left, right) =>
        STATUS_PRIORITY[left.metric.status] -
          STATUS_PRIORITY[right.metric.status] || left.index - right.index,
    )
    .map(({ metric }) => metric);
}

export function useOnlineStatus() {
  const [online, setOnline] = useState(
    () => typeof navigator === "undefined" || navigator.onLine,
  );
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

export function visibleInsightAreas(roles: Partial<UserRoles>): InsightArea[] {
  return AREAS.filter((area) => can(roles, "insights", `view_${area}`));
}

export function scopeInsights(
  data: InsightsData,
  areas: readonly InsightArea[],
): InsightsData {
  return {
    ...data,
    metrics: data.metrics.filter((metric) => areas.includes(metric.area)),
  };
}

export function useInsightsData() {
  const { mode, supabaseClient, userRoles } = useSession();
  const live = mode === "supabase" ? supabaseClient : null;
  const areas = visibleInsightAreas(userRoles);
  const [data, setData] = useState<InsightsData>(
    live
      ? { metrics: [], extractedAt: "", warnings: [] }
      : scopeInsights(INSIGHTS_DEMO_DATA, areas),
  );
  const [loading, setLoading] = useState(Boolean(live));
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    if (!live) {
      setData(scopeInsights(INSIGHTS_DEMO_DATA, areas));
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: rows, error: queryError } = await live
      .schema("core")
      .from("v_insights_snapshot")
      .select(
        "id,area,label,value,unit,target_direction,target_min,target_max,data_status,sample_count,detail,source_href,reporting_period_start,reporting_period_end,source_updated_at,extracted_at",
      )
      .in("area", areas)
      .limit(500);
    if (queryError) {
      setData((current) => ({ ...current, warnings: [queryError.message] }));
      setError(queryError.message);
    } else {
      const mapped = ((rows as UnknownRow[]) ?? []).map(mapInsightRow);
      setData({
        metrics: mapped,
        extractedAt: mapped[0]?.extractedAt ?? "",
        warnings: [],
      });
      setError(null);
    }
    setLoading(false);
  }, [areas.join("|"), live]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { data, loading, error, refresh, areas };
}
