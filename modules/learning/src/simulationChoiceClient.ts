import type {
  SimulationChoiceEvaluation,
  SimulationChoiceSubmission,
} from "./types";

export interface SimulationChoiceCommandResult {
  evaluation: SimulationChoiceEvaluation;
  recorded: boolean;
}

type Fetcher = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function parseResult(value: unknown): SimulationChoiceCommandResult {
  if (!isRecord(value))
    throw new Error("Server returned an invalid choice evaluation.");
  const allowedKeys = new Set(["accepted", "feedback", "recorded"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new Error("Server returned an invalid choice evaluation.");
  }
  if (
    typeof value.accepted !== "boolean" ||
    typeof value.recorded !== "boolean"
  ) {
    throw new Error("Server returned an invalid choice evaluation.");
  }
  if (value.accepted) {
    if (value.feedback !== undefined) {
      throw new Error("Server returned an invalid choice evaluation.");
    }
    return { evaluation: { accepted: true }, recorded: value.recorded };
  }
  if (typeof value.feedback !== "string" || !value.feedback.trim()) {
    throw new Error("Server returned an invalid choice evaluation.");
  }
  return {
    evaluation: { accepted: false, feedback: value.feedback },
    recorded: value.recorded,
  };
}

export async function requestSimulationChoiceEvaluation(
  input: SimulationChoiceSubmission,
  fetcher: Fetcher = fetch,
): Promise<SimulationChoiceCommandResult> {
  const response = await fetcher("/api/learning/simulation-choice", {
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
        : "This choice could not be checked.";
    throw new Error(message);
  }
  return parseResult(value);
}
