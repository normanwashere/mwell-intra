import { describe, expect, it } from "vitest";
import { canLaunchFromReadiness } from "./domain";
import type { ReadinessPackage } from "./types";

describe("Product remediation contract", () => {
  it("keeps kit approval as an explicit go-live dependency", () => {
    const readiness: ReadinessPackage = {
      id: "ready-kit-1",
      productId: "kit-demo-001",
      title: "Demo care kit launch",
      version: 1,
      status: "approved",
      evidence: [{ id: "kit-approval", label: "Kit approval", reference: "KIT-APR-001", required: true, verified: true }],
      conditions: "Operations acknowledgement is still required.",
      preparedBy: "product-contributor",
      submittedBy: "product-contributor",
      submittedAt: "2026-08-14T00:00:00.000Z",
      decidedBy: "product-owner",
      decidedAt: "2026-08-14T01:00:00.000Z",
      decisionNote: "Approved with the kit dependency.",
      operationsAcknowledgedBy: "operations-owner",
      operationsAcknowledgedAt: "2026-08-14T02:00:00.000Z",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T02:00:00.000Z",
    };

    expect(canLaunchFromReadiness({ ...readiness, kitApproved: false })).toBe(false);
    expect(canLaunchFromReadiness(readiness)).toBe(true);
  });
});
