import { NextResponse } from "next/server";
import { scoreServerAssessment } from "../../../../../../modules/learning/src/assessmentAuthority.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PreviewAssessmentCommand {
  requirementId: string;
  assignmentRequirementId: string;
  attemptId: string;
  answers: readonly { questionId: string; answerId: string }[];
  idempotencyKey?: string;
}

const REQUIRED_KEYS = [
  "requirementId",
  "assignmentRequirementId",
  "attemptId",
  "answers",
] as const;
const ALLOWED_KEYS = new Set([...REQUIRED_KEYS, "idempotencyKey"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

function requiredIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function parseCommand(value: unknown): PreviewAssessmentCommand {
  if (!isRecord(value)) {
    throw new Error("A preview assessment command object is required.");
  }
  if (
    Object.keys(value).some((key) => !ALLOWED_KEYS.has(key)) ||
    REQUIRED_KEYS.some((key) => !(key in value))
  ) {
    throw new Error("Preview assessment command fields are invalid.");
  }
  if (!Array.isArray(value.answers) || value.answers.length > 25) {
    throw new Error("Preview assessment answers are invalid.");
  }
  const answers = value.answers.map((answer) => {
    if (
      !isRecord(answer) ||
      Object.keys(answer).length !== 2 ||
      !("questionId" in answer) ||
      !("answerId" in answer)
    ) {
      throw new Error("Preview assessment answer fields are invalid.");
    }
    return {
      questionId: requiredIdentifier(answer.questionId, "questionId"),
      answerId: requiredIdentifier(answer.answerId, "answerId"),
    };
  });
  if (
    value.idempotencyKey !== undefined &&
    (typeof value.idempotencyKey !== "string" ||
      !value.idempotencyKey.trim() ||
      value.idempotencyKey.length > 200)
  ) {
    throw new Error("idempotencyKey is invalid.");
  }
  return {
    requirementId: requiredIdentifier(value.requirementId, "requirementId"),
    assignmentRequirementId: requiredIdentifier(
      value.assignmentRequirementId,
      "assignmentRequirementId",
    ),
    attemptId: requiredIdentifier(value.attemptId, "attemptId"),
    answers,
    ...(typeof value.idempotencyKey === "string"
      ? { idempotencyKey: value.idempotencyKey }
      : {}),
  };
}

function json(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (origin && origin !== requestUrl.origin) {
    return json(
      { error: "Cross-origin assessment commands are not allowed." },
      403,
    );
  }
  if (
    process.env.NODE_ENV === "production" ||
    process.env.NEXT_PUBLIC_DATA_SOURCE !== "memory"
  ) {
    return json({ error: "Preview assessment scoring is unavailable." }, 404);
  }
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > 8192) {
    return json({ error: "Preview assessment command is too large." }, 413);
  }

  try {
    const command = parseCommand(await request.json());
    return json(
      scoreServerAssessment({
        requirementId: command.requirementId,
        answers: command.answers,
      }),
    );
  } catch {
    return json({ error: "Preview assessment could not be scored." }, 400);
  }
}
