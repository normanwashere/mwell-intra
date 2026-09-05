"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "@intra/auth";
import {
  Badge,
  Card,
  EmptyState,
  HeroChipButton,
  Icon,
  ModuleHero,
  SegmentedControl,
  Sheet,
  SignInPrompt,
  SkeletonStats,
} from "@intra/ui";
import {
  canShowGovernedExport,
  getSnapshotTruth,
  metricStatusPresentation,
  prioritizeMetrics,
  resolveRequestedInsightArea,
  resolveGovernedSource,
  safeInsightFollowupPayload,
  useInsightsData,
  useOnlineStatus,
} from "./data";
import type { FollowupReasonCode, FollowupRequestType } from "./data";
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
  const {
    profile,
    userRoles,
    userCapabilities,
    mode,
    supabaseClient,
    loading: sessionLoading,
  } = useSession();
  const { data, loading, error, refresh, areas } = useInsightsData();
  const online = useOnlineStatus();
  const [area, setArea] = useState<InsightArea | "all">("all");
  const [exporting, setExporting] = useState(false);
  const [commandMessage, setCommandMessage] = useState<string | null>(null);
  const [selectedMetric, setSelectedMetric] = useState<InsightMetric | null>(
    null,
  );
  const [followupType, setFollowupType] =
    useState<FollowupRequestType>("validation");
  const [followupReason, setFollowupReason] =
    useState<FollowupReasonCode>("stale_source");
  const [submittingFollowup, setSubmittingFollowup] = useState(false);
  const followupLock = useRef(false);
  const followupKeys = useRef<Record<string,string>>({});

  useEffect(() => {
    setArea((current) =>
      resolveRequestedInsightArea(initialArea, areas, current),
    );
  }, [areas.join("|"), initialArea]);

  const mayExport = canShowGovernedExport(mode, userRoles, userCapabilities);

  async function exportSnapshot() {
    if (exporting) return;
    setExporting(true);
    setCommandMessage(null);
    try {
      const response = await fetch("/api/insights/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const result = (await response.json()) as {
        error?: string;
        download_url?: string;
        row_count?: number;
      };
      if (!response.ok || !result.download_url)
        throw new Error(result.error ?? "Insights export failed.");
      setCommandMessage(
        `Governed snapshot prepared with ${result.row_count ?? 0} rows. Download started.`,
      );
      window.location.assign(result.download_url);
    } catch (cause) {
      setCommandMessage(
        cause instanceof Error ? cause.message : "Insights export failed.",
      );
    } finally {
      setExporting(false);
    }
  }

  async function submitFollowup() {
    if (followupLock.current) return;
    if (!selectedMetric || !supabaseClient) {
      setCommandMessage("A connected governed session is required.");
      return;
    }
    followupLock.current = true;
    setSubmittingFollowup(true);
    setCommandMessage(null);
    const command = `${profile?.id}:${selectedMetric.id}:${followupType}:${followupReason}`;
    const storageKey = `intra.insight-followup.${command}`;
    let key = followupKeys.current[command];
    try { key ??= sessionStorage.getItem(storageKey) ?? undefined; } catch { /* Memory key still protects retries. */ }
    key ??= crypto.randomUUID();
    followupKeys.current[command] = key;
    try { sessionStorage.setItem(storageKey,key); } catch { /* Storage may be disabled. */ }
    const payload = safeInsightFollowupPayload(
      selectedMetric,
      followupType,
      followupReason,
      key,
    );
    try {
    const { data: result, error: followupError } = await supabaseClient
      .schema("core")
      .rpc("request_insight_followup", { payload });
    if (followupError) {
      setCommandMessage(followupError.message);
    } else {
      const handoff = result as unknown as {
        id?: string;
        assigned_module?: string;
      };
      setCommandMessage(
        `Follow-up ${handoff.id ?? "created"} routed to ${handoff.assigned_module ?? "the accountable owner"}.`,
      );
      setSelectedMetric(null);
      delete followupKeys.current[command];
      try { sessionStorage.removeItem(storageKey); } catch { /* No sensitive payload is stored. */ }
    }
    } catch (cause) { setCommandMessage((cause as Error).message || 'Follow-up response unavailable. Retry uses the same request.'); }
    finally { followupLock.current = false; setSubmittingFollowup(false); }
  }
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
  const snapshot = getSnapshotTruth(online, visible);
  const summary = {
    critical: visible.filter((metric) => metric.status === "critical").length,
    stale: visible.filter((metric) => metric.status === "stale").length,
    review: visible.filter((metric) =>
      ["review", "incomplete", "no_data"].includes(metric.status),
    ).length,
    current: visible.filter((metric) =>
      ["on_target", "informational"].includes(metric.status),
    ).length,
  };
  const options = [
    { value: "all", label: "All available" },
    ...areas.map((value) => ({ value, label: LABELS[value] })),
  ];
  return (
    <div className="space-y-6">
      <ModuleHero
        eyebrow="Decision support"
        title="Operational and executive insights"
        description="Role-scoped indicators with explicit targets, coverage, reporting periods, and source freshness."
        icon="trend"
        action={
          <>
            <HeroChipButton href="/work" icon="clipboard">
              Open My Work
            </HeroChipButton>
            {mayExport && (
              <HeroChipButton
                icon="download"
                onClick={() => void exportSnapshot()}
              >
                {exporting ? "Preparing..." : "Export governed snapshot"}
              </HeroChipButton>
            )}
          </>
        }
        accessory={
          <div className="flex flex-wrap gap-2">
            <Badge tone="slate">Read-only</Badge>
            <Badge tone="brand">{areas.length} views available</Badge>
            <Badge tone={snapshot.tone}>{snapshot.label}</Badge>
          </div>
        }
      />
      {commandMessage && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-muted"
        >
          <Icon
            name="info"
            className="mt-0.5 h-4 w-4 shrink-0 text-brand-700"
          />
          <span>{commandMessage} <a className="underline" href="/work">Track follow-ups in My Work</a></span>
        </div>
      )}
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
      <section
        aria-labelledby="insights-summary-title"
        className="border-y border-line py-4"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase text-brand-700">
              Decision summary
            </p>
            <h2
              id="insights-summary-title"
              className="font-display text-lg font-bold text-ink"
            >
              What needs attention
            </h2>
          </div>
          <p className="text-xs text-faint">
            {visible.length} visible indicators
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line lg:grid-cols-4">
          {[
            ["Critical", summary.critical, "text-rose-700"],
            ["Stale source", summary.stale, "text-amber-700"],
            ["Review", summary.review, "text-amber-700"],
            ["Current", summary.current, "text-emerald-700"],
          ].map(([label, value, tone]) => (
            <div key={String(label)} className="min-w-0 bg-surface px-4 py-3">
              <dt className="text-xs font-semibold text-faint">{label}</dt>
              <dd
                className={`mt-1 font-display text-2xl font-extrabold ${tone}`}
              >
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </section>
      {visible.length === 0 ? (
        <EmptyState
          icon="trend"
          title="No indicators available"
          message="No governed metrics are available for this view yet."
        />
      ) : (
        <section
          aria-label="Operational indicators"
          className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3"
        >
          {visible.map((metric) => {
            const presentation = metricStatusPresentation(metric.status);
            const source = resolveGovernedSource(metric, userRoles, mode === 'supabase' ? userCapabilities ?? {} : undefined);
            return (
              <Card
                key={metric.id}
                data-insight-metric={metric.id}
                className="flex min-h-56 flex-col gap-4"
              >
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
                {metric.drillDownContext && (
                  <p className="text-xs text-faint">
                    <strong>Definition:</strong> {metric.drillDownContext}
                  </p>
                )}
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
                <div className="mt-auto grid gap-2 sm:grid-cols-2">
                  {source.accessible ? (
                    <a
                      href={source.href ?? undefined}
                      className="btn-ghost min-h-11 justify-between"
                    >
                      {source.label}{" "}
                      <Icon name="arrowRight" className="h-4 w-4" />
                    </a>
                  ) : (
                    <div className="flex min-h-11 items-center gap-2 rounded-lg bg-inset px-3 text-sm font-semibold text-faint">
                      <Icon name="lock" className="h-4 w-4" />
                      {source.label}
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn-secondary min-h-11 justify-center"
                    onClick={() => {
                      setFollowupType(
                        userRoles.insights?.includes("executive")
                          ? "escalation"
                          : "validation",
                      );
                      setFollowupReason(
                        metric.status === "stale"
                          ? "stale_source"
                          : "target_breach",
                      );
                      setSelectedMetric(metric);
                    }}
                  >
                    {userRoles.insights?.includes("executive")
                      ? "Escalate indicator"
                      : "Request validation"}
                  </button>
                </div>
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
      <Sheet
        open={Boolean(selectedMetric)}
        onOpenChange={(open) => {
          if (!open) setSelectedMetric(null);
        }}
        title={
          followupType === "validation"
            ? "Request validation"
            : "Escalate indicator"
        }
        description="Send only the indicator reference and a controlled reason. Protected values and source details stay in their owning workflow."
        footer={
          <button
            type="button"
            className="btn-primary w-full justify-center"
            disabled={submittingFollowup}
            onClick={() => void submitFollowup()}
          >
            {submittingFollowup ? "Routing..." : "Create accountable follow-up"}
          </button>
        }
      >
        <div className="space-y-5">
          <div className="rounded-lg border border-line bg-inset px-4 py-3">
            <p className="text-xs font-semibold uppercase text-faint">
              Indicator reference
            </p>
            <p className="mt-1 font-semibold text-ink">
              {selectedMetric?.label}
            </p>
            <p className="mt-1 text-xs text-muted">
              No metric value, detail, or protected source location will be
              copied.
            </p>
          </div>
          <label className="block space-y-1.5" htmlFor="insight-followup-type">
            <span className="label">Handoff type</span>
            <select
              id="insight-followup-type"
              className="input min-h-11"
              value={followupType}
              onChange={(event) =>
                setFollowupType(event.target.value as FollowupRequestType)
              }
            >
              <option value="validation">Request source validation</option>
              <option value="escalation">
                Escalate for accountable review
              </option>
            </select>
          </label>
          <label
            className="block space-y-1.5"
            htmlFor="insight-followup-reason"
          >
            <span className="label">Reason</span>
            <select
              id="insight-followup-reason"
              className="input min-h-11"
              value={followupReason}
              onChange={(event) =>
                setFollowupReason(event.target.value as FollowupReasonCode)
              }
            >
              <option value="stale_source">Source activity is stale</option>
              <option value="definition_question">
                Metric definition needs validation
              </option>
              <option value="target_breach">
                Target requires accountable review
              </option>
              <option value="access_issue">
                Governed source access is unavailable
              </option>
            </select>
          </label>
        </div>
      </Sheet>
    </div>
  );
}
