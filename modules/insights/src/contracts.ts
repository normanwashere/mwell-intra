export type SnapshotMetric = {
  dataStatus: string;
  sourceUpdatedAt: string | null;
};

export type SnapshotTruth = {
  label:
    | "Offline snapshot"
    | "Awaiting data"
    | "Stale source activity"
    | "Current source activity";
  tone: "amber" | "slate" | "emerald";
  detail: string;
};

export type CapabilityProjection = Record<
  string,
  readonly string[] | undefined
>;

export type FollowupRequestType = "validation" | "escalation";
export type FollowupReasonCode =
  "stale_source" | "definition_question" | "target_breach" | "access_issue";

const SOURCE_ACTIVITY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function getSourceActivityFreshness(
  value: string | null,
  now = new Date(),
): {
  stale: boolean;
  label: "Current source" | "Stale source" | "Awaiting source activity";
} {
  if (!value) return { stale: true, label: "Awaiting source activity" };
  const updatedAt = Date.parse(value);
  if (!Number.isFinite(updatedAt))
    return { stale: true, label: "Awaiting source activity" };
  const stale = now.getTime() - updatedAt > SOURCE_ACTIVITY_MAX_AGE_MS;
  return { stale, label: stale ? "Stale source" : "Current source" };
}

export function getSnapshotTruth(
  online: boolean,
  metrics: readonly SnapshotMetric[],
  now = new Date(),
): SnapshotTruth {
  if (!online)
    return {
      label: "Offline snapshot",
      tone: "amber",
      detail:
        "Showing the last available extraction. Reconnect before making a decision.",
    };

  if (
    metrics.length === 0 ||
    metrics.every(
      (metric) => metric.dataStatus === "no_data" && !metric.sourceUpdatedAt,
    )
  )
    return {
      label: "Awaiting data",
      tone: "slate",
      detail: "No governed source activity is available yet.",
    };

  if (
    metrics.some(
      (metric) =>
        metric.dataStatus === "stale" ||
        getSourceActivityFreshness(metric.sourceUpdatedAt, now).label ===
          "Stale source",
    )
  )
    return {
      label: "Stale source activity",
      tone: "amber",
      detail:
        "At least one visible indicator has source activity older than 24 hours. Validate the source before deciding.",
    };

  return {
    label: "Current source activity",
    tone: "emerald",
    detail: "Connected. Source activity freshness is shown on each indicator.",
  };
}

export function resolveRequestedInsightArea<T extends string>(
  requestedArea: T | undefined,
  accessibleAreas: readonly T[],
  currentArea: T | "all",
): T | "all" {
  if (currentArea !== "all" && accessibleAreas.includes(currentArea))
    return currentArea;
  return requestedArea && accessibleAreas.includes(requestedArea)
    ? requestedArea
    : "all";
}

export function canShowGovernedExport(
  mode: string,
  roles: Record<string, unknown> | readonly string[],
  capabilities: CapabilityProjection | undefined,
) {
  const roleValues = Array.isArray(roles)
    ? roles
    : Object.entries(roles).flatMap(([module, role]) =>
        Array.isArray(role)
          ? role.map((value) => `${module}:${String(value)}`)
          : role
            ? [`${module}:${String(role)}`]
            : [],
      );
  const isAnalyst = roleValues.includes("insights:analyst");
  if (!isAnalyst) return false;
  return mode === "supabase"
    ? capabilities?.insights?.includes("prepare_exports") === true
    : true;
}

export function safeInsightFollowupPayload(
  metric: { id: string },
  requestType: FollowupRequestType,
  reasonCode: FollowupReasonCode,
  idempotencyKey: string,
) {
  return {
    metric_id: metric.id,
    request_type: requestType,
    reason_code: reasonCode,
    idempotency_key: idempotencyKey,
  } as const;
}
