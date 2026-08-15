import type { AssessmentSubmission } from "./types";

export interface PreviewAssessmentScoringInput extends AssessmentSubmission {
  requirementId: string;
}

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export async function requestPreviewAssessmentScore(
  input: PreviewAssessmentScoringInput,
  fetcher: Fetcher = fetch,
): Promise<{ score: number }> {
  const response = await fetcher("/api/learning/assessment-preview", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      isRecord(value) && typeof value.error === "string"
        ? value.error
        : "Preview assessment could not be scored.";
    throw new Error(message);
  }
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 1 ||
    typeof value.score !== "number" ||
    !Number.isInteger(value.score) ||
    value.score < 0 ||
    value.score > 100
  ) {
    throw new Error("Server returned an invalid assessment score.");
  }
  return { score: value.score };
}
