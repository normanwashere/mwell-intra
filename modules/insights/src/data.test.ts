import { describe, expect, it } from "vitest";
import {
  canShowGovernedExport,
  evaluateMetricStatus,
  getSnapshotTruth,
  mapInsightRow,
  metricStatusPresentation,
  prioritizeMetrics,
  resolveRequestedInsightArea,
  resolveGovernedSource,
  safeInsightFollowupPayload,
  scopeInsights,
  visibleInsightAreas,
} from "./data";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { INSIGHTS_DEMO_DATA } from "./seed";
import type { InsightMetric } from "./types";

describe("Insights scope", () => {
  it("shows analysts source detail without executive-only indicators", () => {
    const areas = visibleInsightAreas({ insights: ["analyst"] });
    expect(areas).toEqual(["warehouse", "procurement", "legal", "finance"]);
    expect(areas).not.toContain("executive");
  });

  it("keeps executive accounts summary-only", () => {
    const areas = visibleInsightAreas({ insights: ["executive"] });
    expect(areas).toEqual(["executive"]);
    expect(
      scopeInsights(INSIGHTS_DEMO_DATA, areas).metrics.every(
        (metric) => metric.area === "executive",
      ),
    ).toBe(true);
  });
});

describe("Insights KPI semantics", () => {
  it("marks 0% fulfillment against a 95% minimum as critical", () => {
    expect(
      evaluateMetricStatus({
        value: 0,
        targetDirection: "minimum",
        targetMin: 95,
        dataStatus: "current",
        sampleCount: 12,
      }),
    ).toBe("critical");
  });

  it("reports an empty source population as no data instead of on target", () => {
    expect(
      evaluateMetricStatus({
        value: null,
        targetDirection: "maximum",
        targetMax: 0,
        dataStatus: "no_data",
        sampleCount: 0,
      }),
    ).toBe("no_data");
  });

  it("supports maximum, range, and informational target directions", () => {
    expect(
      evaluateMetricStatus({
        value: 3,
        targetDirection: "maximum",
        targetMax: 0,
        dataStatus: "current",
        sampleCount: 20,
      }),
    ).toBe("critical");
    expect(
      evaluateMetricStatus({
        value: 7,
        targetDirection: "range",
        targetMin: 5,
        targetMax: 10,
        dataStatus: "current",
        sampleCount: 8,
      }),
    ).toBe("on_target");
    expect(
      evaluateMetricStatus({
        value: 7,
        targetDirection: "informational",
        dataStatus: "current",
        sampleCount: 8,
      }),
    ).toBe("informational");
  });

  it("preserves reporting and freshness provenance from the governed snapshot", () => {
    expect(
      mapInsightRow({
        id: "wh-fill",
        area: "warehouse",
        label: "Fulfillment rate",
        value: null,
        unit: "%",
        target_direction: "minimum",
        target_min: 95,
        target_max: null,
        data_status: "no_data",
        sample_count: 0,
        detail: "Issued units against approved demand",
        source_href: "/warehouse/analytics",
        reporting_period_start: "2026-06-22T00:00:00Z",
        reporting_period_end: "2026-07-22T00:00:00Z",
        source_updated_at: null,
        extracted_at: "2026-07-22T01:00:00Z",
      }),
    ).toMatchObject({
      value: null,
      targetDirection: "minimum",
      targetMin: 95,
      dataStatus: "no_data",
      sampleCount: 0,
      reportingPeriodStart: "2026-06-22T00:00:00Z",
      reportingPeriodEnd: "2026-07-22T00:00:00Z",
      sourceUpdatedAt: null,
      extractedAt: "2026-07-22T01:00:00Z",
    });
  });

  it("uses explicit status labels instead of a generic on-target badge", () => {
    expect(metricStatusPresentation("critical")).toMatchObject({
      label: "Critical",
      tone: "rose",
    });
    expect(metricStatusPresentation("no_data")).toMatchObject({
      label: "No data",
      tone: "slate",
    });
    expect(metricStatusPresentation("incomplete")).toMatchObject({
      label: "Incomplete",
      tone: "amber",
    });
  });

  it("never describes an offline snapshot as live", () => {
    expect(getSnapshotTruth(false, [])).toEqual({
      label: "Offline snapshot",
      tone: "amber",
      detail:
        "Showing the last available extraction. Reconnect before making a decision.",
    });
  });

  it("derives workspace freshness from source activity, not query time", () => {
    const stale = {
      ...INSIGHTS_DEMO_DATA.metrics[0],
      dataStatus: "current" as const,
      sourceUpdatedAt: "2026-08-12T00:00:00.000Z",
      extractedAt: "2026-08-15T00:00:00.000Z",
    };

    expect(
      getSnapshotTruth(true, [stale], new Date("2026-08-15T00:00:00.000Z")),
    ).toEqual({
      label: "Stale source activity",
      tone: "amber",
      detail:
        "At least one visible indicator has source activity older than 24 hours. Validate the source before deciding.",
    });
  });

  it("labels stale metrics explicitly instead of calling them incomplete", () => {
    expect(
      evaluateMetricStatus({
        value: 8,
        targetDirection: "maximum",
        targetMax: 5,
        dataStatus: "stale",
        sampleCount: 4,
      }),
    ).toBe("stale");
    expect(metricStatusPresentation("stale")).toMatchObject({
      label: "Stale source",
      tone: "amber",
    });
  });
});

describe("Insights role-load and command contracts", () => {
  it("restores an authorized deep-link area after roles finish loading", () => {
    expect(resolveRequestedInsightArea("finance", [], "all")).toBe("all");
    expect(
      resolveRequestedInsightArea("finance", ["warehouse", "finance"], "all"),
    ).toBe("finance");
    expect(
      resolveRequestedInsightArea(
        "finance",
        ["warehouse", "finance"],
        "warehouse",
      ),
    ).toBe("warehouse");
  });

  it("shows export only to a live analyst with the effective certified capability", () => {
    expect(
      canShowGovernedExport(
        "supabase",
        { insights: ["analyst"] },
        { insights: [] },
      ),
    ).toBe(false);
    expect(
      canShowGovernedExport(
        "supabase",
        { insights: ["analyst"] },
        { insights: ["prepare_exports"] },
      ),
    ).toBe(true);
    expect(
      canShowGovernedExport(
        "supabase",
        { insights: ["admin"] },
        { insights: ["prepare_exports"] },
      ),
    ).toBe(false);
  });

  it("builds a controlled follow-up payload without protected metric detail", () => {
    const metric = INSIGHTS_DEMO_DATA.metrics[0]!;
    const payload = safeInsightFollowupPayload(
      metric,
      "validation",
      "stale_source",
      "INS-20260815-001",
    );

    expect(payload).toEqual({
      metric_id: metric.id,
      request_type: "validation",
      reason_code: "stale_source",
      idempotency_key: "INS-20260815-001",
    });
    expect(JSON.stringify(payload)).not.toContain(metric.detail);
    expect(JSON.stringify(payload)).not.toContain(metric.sourceHref);
    expect(JSON.stringify(payload)).not.toContain(String(metric.value));
  });
});

describe("Insights source access and priority", () => {
  it("replaces inaccessible operational drilldowns with a restricted state", () => {
    const metric = mapInsightRow({
      id: "pr-cycle",
      area: "procurement",
      label: "PR cycle",
      value: 4,
      target_direction: "maximum",
      target_max: 5,
      data_status: "current",
      sample_count: 2,
      detail: "Cycle time",
      source_href: "/procurement/purchase-orders",
      reporting_period_start: "2026-06-22T00:00:00Z",
      reporting_period_end: "2026-07-22T00:00:00Z",
      source_updated_at: "2026-07-20T00:00:00Z",
      extracted_at: "2026-07-22T00:00:00Z",
    });

    expect(resolveGovernedSource(metric, { insights: ["executive"] })).toEqual({
      accessible: false,
      href: null,
      label: "Source access restricted",
    });
  });

  it("keeps authorized operational drilldowns available", () => {
    const metric = mapInsightRow({
      id: "wh-fill",
      area: "warehouse",
      label: "Fulfillment",
      value: 98,
      target_direction: "minimum",
      target_min: 95,
      data_status: "current",
      sample_count: 12,
      detail: "Fulfillment rate",
      source_href: "/warehouse/analytics",
      reporting_period_start: "2026-06-22T00:00:00Z",
      reporting_period_end: "2026-07-22T00:00:00Z",
      source_updated_at: "2026-07-20T00:00:00Z",
      extracted_at: "2026-07-22T00:00:00Z",
    });

    expect(
      resolveGovernedSource(metric, { warehouse: ["bi_analyst"] }),
    ).toMatchObject({
      accessible: true,
      href: "/warehouse/data",
    });
  });

  it("sorts critical and incomplete indicators before healthy indicators", () => {
    const metric = (
      id: string,
      status: InsightMetric["status"],
    ): InsightMetric => ({
      id,
      area: "executive",
      label: id,
      value: 1,
      detail: id,
      sourceHref: "/work",
      targetDirection: "informational",
      dataStatus: "current",
      sampleCount: 1,
      reportingPeriodStart: null,
      reportingPeriodEnd: null,
      sourceUpdatedAt: null,
      extractedAt: "2026-07-22T00:00:00Z",
      status,
    });

    expect(
      prioritizeMetrics([
        metric("healthy", "on_target"),
        metric("missing", "no_data"),
        metric("urgent", "critical"),
        metric("check", "review"),
      ]).map(({ id }) => id),
    ).toEqual(["urgent", "missing", "check", "healthy"]);
  });
});

describe("Insights read-only UX contract", () => {
  it("uses a descriptive heading and exposes no client mutation path", () => {
    const app = readFileSync(
      resolve(process.cwd(), "src/InsightsApp.tsx"),
      "utf8",
    );
    const data = readFileSync(resolve(process.cwd(), "src/data.ts"), "utf8");

    expect(app).toContain('title="Operational and executive insights"');
    expect(app).toContain('<Badge tone="slate">Read-only</Badge>');
    expect(data).not.toMatch(/\.(insert|update|delete|upsert)\s*\(/);
  });
});
