import { describe, expect, it } from "vitest";
import { FINANCE_DEMO_DATA } from "./seed";
import { validateFinanceCloseEntry } from "./data";

describe("Finance remediation contract", () => {
  it("uses Procurement's canonical demo PO identity and exposes Event settlement", () => {
    expect(FINANCE_DEMO_DATA.payments[0]).toMatchObject({
      purchaseOrderId: "po_seed_004",
      poNumber: "PO-2026-0004",
    });
    expect(FINANCE_DEMO_DATA.closeEntries).toContainEqual(
      expect.objectContaining({
        entryType: "event_settlement",
        sourceModule: "events",
        sourceReference: "evt-demo-lgu",
      }),
    );
  });

  it("rejects zero-value close entries and unexplained correction flags", () => {
    expect(validateFinanceCloseEntry({ action: "save", amount: 0 })).toEqual([
      "Amount must be greater than zero.",
    ]);
    expect(validateFinanceCloseEntry({ action: "exception", id: "close-1" })).toEqual([
      "Provide a correction reason before flagging a close entry.",
    ]);
  });
});
