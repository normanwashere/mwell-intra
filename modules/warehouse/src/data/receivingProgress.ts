import type { ReceivingDraftBody } from "./receivingDrafts";

export type ReceivingProgress = ReceivingDraftBody & {
  locationId: string;
  binId: string;
  evidenceLink: string;
  evidencePhotos: string[];
  reason: string;
  lines: Array<{
    id: string;
    expected: number;
    selected: boolean;
    productId: string;
    description: string;
    identifiers: string;
    outcomes: Record<
      "clean" | "damaged" | "unidentified" | "short" | "excess",
      number
    >;
    serials: Record<"clean" | "damaged" | "unidentified" | "excess", string>;
  }>;
};

/** A draft is user input, not trusted receipt authority or a guaranteed UI shape. */
export function readReceivingProgress(
  body: ReceivingDraftBody,
): ReceivingProgress {
  const strings = ["locationId", "binId", "evidenceLink", "reason"];
  const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  if (
    strings.some((key) => typeof body[key] !== "string") ||
    !Array.isArray(body.evidencePhotos) ||
    !body.evidencePhotos.every((value) => typeof value === "string") ||
    !Array.isArray(body.lines) ||
    !body.lines.every(
      (line) =>
        object(line) &&
        ["id", "productId", "description", "identifiers"].every(
          (key) => typeof line[key] === "string",
        ) &&
        typeof line.selected === "boolean" &&
        Number.isSafeInteger(line.expected) &&
        Number(line.expected) >= 0 &&
        object(line.outcomes) &&
        ["clean", "damaged", "unidentified", "short", "excess"].every(
          (key) =>
            Number.isSafeInteger(
              (line.outcomes as Record<string, unknown>)[key],
            ) && Number((line.outcomes as Record<string, unknown>)[key]) >= 0,
        ) &&
        object(line.serials) &&
        ["clean", "damaged", "unidentified", "excess"].every(
          (key) =>
            typeof (line.serials as Record<string, unknown>)[key] === "string",
        ),
    )
  ) {
    throw new Error(
      "Saved receiving progress has an unsupported format. Contact support before discarding it.",
    );
  }
  return body as ReceivingProgress;
}
