import { describe, expect, it } from "vitest";
import {
  canAcknowledgeOperationsHandoff,
  canDecidePriceProposal,
  canLaunchFromReadiness,
  validatePriceProposal,
  validateReadinessSubmission,
} from "./domain";
import type { PriceProposal, ReadinessPackage } from "./types";

const readiness: ReadinessPackage = {
  id: "ready-1",
  productId: "product-1",
  title: "Remote care launch",
  version: 3,
  status: "approved",
  evidence: [
    {
      id: "evidence-1",
      label: "Security review",
      reference: "SEC-241",
      required: true,
      verified: true,
    },
  ],
  conditions: "Operations must confirm the launch window.",
  preparedBy: "contributor-1",
  submittedBy: "contributor-1",
  submittedAt: "2026-07-22T01:00:00.000Z",
  decidedBy: "owner-1",
  decidedAt: "2026-07-22T02:00:00.000Z",
  decisionNote: "Approved for the controlled launch window.",
  operationsAcknowledgedBy: null,
  operationsAcknowledgedAt: null,
  createdAt: "2026-07-22T00:00:00.000Z",
  updatedAt: "2026-07-22T02:00:00.000Z",
};

describe("Product readiness governance", () => {
  it("requires identified and verified evidence before submission", () => {
    expect(
      validateReadinessSubmission({
        productId: "product-1",
        title: "Remote care launch",
        evidence: [],
      }),
    ).toEqual(["Add at least one readiness evidence item."]);

    expect(
      validateReadinessSubmission({
        productId: "product-1",
        title: "Remote care launch",
        evidence: [
          {
            id: "evidence-1",
            label: "Security review",
            reference: "SEC-241",
            required: true,
            verified: false,
          },
        ],
      }),
    ).toEqual(["Verify every required readiness evidence item."]);
  });

  it("opens the Operations gate only after approval and acknowledgement", () => {
    expect(canAcknowledgeOperationsHandoff(readiness)).toBe(true);
    expect(canLaunchFromReadiness(readiness)).toBe(false);
    expect(
      canLaunchFromReadiness({
        ...readiness,
        operationsAcknowledgedBy: "operations-1",
        operationsAcknowledgedAt: "2026-07-22T03:00:00.000Z",
      }),
    ).toBe(true);
    expect(
      canAcknowledgeOperationsHandoff({ ...readiness, status: "rejected" }),
    ).toBe(false);
  });
});

describe("price revision governance", () => {
  const proposal: PriceProposal = {
    id: "price-1",
    productId: "product-1",
    productName: "Remote care kit",
    version: 2,
    status: "submitted",
    currentPrice: 1000,
    proposedPrice: 1200,
    costBasis: 750,
    reason: "Reflect the approved supplier cost revision.",
    effectiveAt: "2026-08-01T00:00:00.000Z",
    proposedBy: "contributor-1",
    submittedAt: "2026-07-22T01:00:00.000Z",
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    createdAt: "2026-07-22T00:00:00.000Z",
  };

  it("requires a reason, cost basis, positive price, and valid effective date", () => {
    expect(
      validatePriceProposal({
        productId: "product-1",
        proposedPrice: 0,
        costBasis: -1,
        reason: "short",
        effectiveAt: "not-a-date",
      }),
    ).toEqual([
      "Proposed price must be greater than zero.",
      "Cost basis must be zero or more.",
      "Reason must contain at least 12 characters.",
      "Effective date is invalid.",
    ]);
  });

  it("requires an independent approver and a submitted version", () => {
    expect(canDecidePriceProposal(proposal, "contributor-1")).toBe(false);
    expect(canDecidePriceProposal(proposal, "owner-1")).toBe(true);
    expect(
      canDecidePriceProposal({ ...proposal, status: "approved" }, "owner-1"),
    ).toBe(false);
  });
});
