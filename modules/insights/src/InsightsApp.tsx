"use client";

import { useState } from "react";
import { useSession } from "@intra/auth";
import {
  Badge,
  Card,
  EmptyState,
  HeroChipButton,
  Icon,
  ModuleHero,
  SegmentedControl,
  SignInPrompt,
  SkeletonStats,
} from "@intra/ui";
import {
  getSnapshotTruth,
  metricStatusPresentation,
  prioritizeMetrics,
  resolveGovernedSource,
  useInsightsData,
  useOnlineStatus,
} from "./data";
import type { InsightArea, InsightMetric } from "./types";

const LABELS: Record<InsightArea, string> = {
  warehouse: "Warehouse",
  procurement: "Procurement",
  legal: "Legal",
  finance: "Finance",
  executive: "Executive",
};
const dateTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-PH", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "No source activity";
const dateOnly = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-PH", { dateStyle: "medium" }).format(
        new Date(value),
      )
    : "Not available";

function targetLabel(metric: InsightMetric) {
  if (metric.targetDirection === "informational") return "Informational";
  if (metric.targetDirection === "minimum")
    return `Minimum ${metric.targetMin}${metric.unit ?? ""}`;
  if (metric.targetDirection === "maximum")
    return `Maximum ${metric.targetMax}${metric.unit ?? ""}`;
  return `Range ${metric.targetMin}-${metric.targetMax}${metric.unit ?? ""}`;
}

export function InsightsApp({ initialArea }: { initialArea?: InsightArea }) {
  const { profile, userRoles, loading: sessionLoading } = useSession();
  const { data, loading, error, refresh, areas } = useInsightsData();
  const online = useOnlineStatus();
  const [area, setArea] = useState<InsightArea | "all">(
    initialArea && areas.includes(initialArea) ? initialArea : "all",
  );
  if (sessionLoading || (profile && loading))
    return (
      <div aria-busy="true">
        <SkeletonStats />
      </div>
    );
  if (!profile) return <SignInPrompt module="Insights" basename="/insights" />;
  if (areas.length === 0)
    return (
      <div
        role="alert"
        className="grid min-h-[60vh] place-items-center text-center"
      >
        <div className="max-w-sm space-y-3">
          <Icon name="lock" className="mx-auto h-8 w-8 text-faint" />
          <h1 className="font-display text-lg font-bold text-ink">
            No Insights access
          </h1>
          <p className="text-sm text-muted">
            Ask an administrator for an Insights analyst, manager, executive, or
            administrator role.
          </p>
        </div>
      </div>
    );
  const visible = prioritizeMetrics(
    area === "all"
      ? data.metrics
      : data.metrics.filter((metric) => metric.area === area),
  );
  const snapshot = getSnapshotTruth(online, data.extractedAt);
  const options = [
    { value: "all", label: "All available" },
    ...areas.map((value) => ({ value, label: LABELS[value] })),
  ];
  return (
    <div className="space-y-6">
      <ModuleHero
        eyebrow="Decision support"
        title="Insights"
        description="Role-scoped indicators with explicit targets, coverage, reporting periods, and source freshness."
        icon="trend"
        action={
          <HeroChipButton href="/work" icon="clipboard">
            Open My Work
          </HeroChipButton>
        }
        accessory={
          <div className="flex flex-wrap gap-2">
            <Badge tone="brand">{areas.length} views available</Badge>
            <Badge tone={snapshot.tone}>{snapshot.label}</Badge>
          </div>
        }
      />
      {!online && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          <Icon name="info" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>Offline.</strong> {snapshot.detail}
          </span>
        </div>
      )}
      {error && (
        <div
          role="status"
          className="flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
        >
          <span>
            <strong>Insights unavailable.</strong> {error}
          </span>
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => void refresh()}
          >
            <Icon name="rotate" className="h-4 w-4" /> Retry
          </button>
        </div>
      )}
      <div className="sm:hidden">
        <label htmlFor="insights-area" className="label">
          Insight view
        </label>
        <select
          id="insights-area"
          className="input min-h-11"
          value={area}
          onChange={(event) =>
            setArea(event.target.value as InsightArea | "all")
          }
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      <div className="hidden overflow-x-auto pb-1 sm:block">
        <SegmentedControl
          ariaLabel="Choose insight view"
          options={options}
          value={area}
          onChange={(value) => setArea(value as InsightArea | "all")}
        />
      </div>
      {visible.length === 0 ? (
        <EmptyState
          icon="trend"
          title="No indicators available"
          message="No governed metrics are available for this view yet."
        />
      ) : (
        <section
          aria-label="Operational indicators"
          className="grid gap-3 md:grid-cols-2 xl:grid-cols-3"
        >
          {visible.map((metric) => {
            const presentation = metricStatusPresentation(metric.status);
            const source = resolveGovernedSource(metric, userRoles);
            return (
              <Card key={metric.id} className="flex min-h-56 flex-col gap-4">
                <div className="flex items-center justify-between gap-2">
                  <Badge tone="slate">{LABELS[metric.area]}</Badge>
                  <Badge tone={presentation.tone}>{presentation.label}</Badge>
                </div>
                <div>
                  <p className="text-sm font-semibold text-muted">
                    {metric.label}
                  </p>
                  <p className="mt-1 font-display text-3xl font-extrabold text-ink">
                    {metric.value == null
                      ? "—"
                      : `${metric.value}${metric.unit ?? ""}`}
                  </p>
                  <p className="mt-1 text-xs text-faint">
                    {targetLabel(metric)}
                  </p>
                </div>
                <p className="text-sm text-muted">{metric.detail}</p>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line pt-3 text-xs">
                  <div>
                    <dt className="text-faint">Sample</dt>
                    <dd className="font-semibold text-muted">
                      {metric.sampleCount} records
                    </dd>
                  </div>
                  <div>
                    <dt className="text-faint">Source updated</dt>
                    <dd className="font-semibold text-muted">
                      {dateTime(metric.sourceUpdatedAt)}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-faint">Reporting period</dt>
                    <dd className="font-semibold text-muted">
                      {dateOnly(metric.reportingPeriodStart)} to{" "}
                      {dateOnly(metric.reportingPeriodEnd)}
                    </dd>
                  </div>
                </dl>
                {source.accessible ? (
                  <a
                    href={source.href ?? undefined}
                    className="btn-ghost mt-auto justify-between"
                  >
                    {source.label}{" "}
                    <Icon name="arrowRight" className="h-4 w-4" />
                  </a>
                ) : (
                  <div className="mt-auto flex min-h-11 items-center gap-2 rounded-xl bg-inset px-3 text-sm font-semibold text-faint">
                    <Icon name="lock" className="h-4 w-4" />
                    {source.label}
                  </div>
                )}
              </Card>
            );
          })}
        </section>
      )}
      {data.extractedAt && (
        <p className="text-xs text-faint">
          Extracted: {dateTime(data.extractedAt)}. Source freshness is shown per
          indicator.
        </p>
      )}
    </div>
  );
}
