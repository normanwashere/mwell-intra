import type { ReturnRecord } from "./domain/types";

/** This attempt was rejected before commit; it says nothing about earlier attempts. */
export class ReturnRejectedError extends Error {
  readonly outcome = "rejected";
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "ReturnRejectedError";
  }
}

export type ReturnCommandOutcome =
  | { status: "success"; record: ReturnRecord }
  | { status: "rejected"; code: string; message: string }
  | { status: "unknown"; message: string };
