import { describe, expect, it } from "vitest";
import { canSubmitRequest, validatePurchaseOrderCancellation, validateRejectionReason } from "./policy";
import type { ProcurementRequest } from "./types";

describe("Procurement remediation contract", () => {
  it("blocks submission until required sourcing evidence is attached", () => {
    const request: ProcurementRequest = {
      id: "req-remediation",
      title: "Mobile clinic supplies",
      status: "draft",
      createdAt: "2026-08-14T00:00:00.000Z",
      category: "goods",
      sourcingMethod: "rfq",
      lines: [{ id: "line-1", description: "Supplies", quantity: 1, unitPrice: 50_000 }],
    };

    expect(canSubmitRequest(request)).toEqual({
      allowed: false,
      blockers: [
        "Procurement-confirmed sourcing route",
        "Technical description / spec",
        "Approved budget evidence",
        "Previous purchase cost",
        "Comparable quotations",
      ],
    });
  });

  it("requires a governed cancellation reason for an active PO", () => {
    expect(validatePurchaseOrderCancellation("issued", "")).toEqual({
      allowed: false,
      reason: "Enter a cancellation reason of at least 8 characters.",
    });
    expect(validatePurchaseOrderCancellation("closed", "Supplier default")).toEqual({
      allowed: false,
      reason: "Only draft, approved, or issued POs can be cancelled.",
    });
  });

  it("requires a rejection reason before a decision can be recorded", () => {
    expect(validateRejectionReason(" ")).toBe("Enter a rejection reason of at least 8 characters.");
  });
});
