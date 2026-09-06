export const EXPERIENCE_ARTICLE_IDS = [
  "sign-in-and-access", "feature-knowledge-library", "feature-vendor-application", "feature-warehouse-tasks",
] as const;
export const EXPERIENCE_BASELINE = {
  collection: "disabled_pending_approval",
  retentionDays: 90,
  reporting: "unavailable_pending_access_and_small_cohort_review",
  businessCompletion: "unavailable_no_reviewed_server_integration",
  vendorEvidencePublication: "blocked_missing_live_requirement_and_reviewed_publication",
  taskAndStepEvents: "unavailable_pending_stable_catalog_ids",
} as const;

export type ExperienceEventName = "task_selected" | "guide_opened" | "step_viewed" | "recovery_opened" | "search_outcome" | "guide_feedback";
export interface ExperienceEventInput {
  eventId: string;
  name: ExperienceEventName;
  taskId?: string;
  articleId?: string;
  stepId?: string;
  result?: "found" | "empty" | "helpful" | "needs_improvement" | "outdated";
  viewport: "mobile" | "tablet" | "desktop";
}
const fields = new Set(["eventId", "name", "articleId", "result", "viewport"]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateExperienceEvent(input: unknown):
  { ok: true; value: ExperienceEventInput } | { ok: false; reason: string } {
  const invalid = { ok: false, reason: "Invalid experience event." } as const;
  if (!input || typeof input !== "object" || Array.isArray(input)) return invalid;
  const row = input as Record<string, unknown>;
  if (Object.keys(row).some(key => !fields.has(key)) ||
    Object.values(row).some(value => typeof value !== "string" || value.length > 100)) return invalid;
  if (typeof row.eventId !== "string" || !uuid.test(row.eventId) ||
    !["mobile", "tablet", "desktop"].includes(String(row.viewport))) return invalid;
  if (row.name === "search_outcome") {
    if (row.articleId !== undefined || !["found", "empty"].includes(String(row.result))) return invalid;
  } else if (["guide_opened", "recovery_opened", "guide_feedback"].includes(String(row.name))) {
    if (!(EXPERIENCE_ARTICLE_IDS as readonly unknown[]).includes(row.articleId)) return invalid;
    if (row.name === "guide_feedback" ? !["helpful", "needs_improvement", "outdated"].includes(String(row.result)) : row.result !== undefined) return invalid;
  } else return invalid;
  return { ok: true, value: { eventId: row.eventId.toLowerCase(), name: row.name as ExperienceEventName,
    viewport: row.viewport as ExperienceEventInput["viewport"],
    ...(row.articleId === undefined ? {} : { articleId: row.articleId as string }),
    ...(row.result === undefined ? {} : { result: row.result as ExperienceEventInput["result"] }) } };
}
