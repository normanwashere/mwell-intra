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
      "Select a canonical source record.",
      "Select registered evidence.",
    ]);
    expect(validateFinanceCloseEntry({ action: "exception", id: "close-1" })).toEqual([
      "Provide a correction reason before flagging a close entry.",
    ]);
  });

  it("allows server-resolved canonical evidence but rejects an invalid explicitly supplied URL", () => {
    const input = {
      action: "save" as const,
      amount: 100,
      sourceRecordType: "purchase_order" as const,
      sourceRecordId: "PO-A",
      evidenceRecordType: "payment_release" as const,
      evidenceRecordId: "release-A",
    };
    expect(validateFinanceCloseEntry(input)).toEqual([]);
    expect(validateFinanceCloseEntry({ ...input, evidenceUrl: "arbitrary/private.pdf" })).toEqual([
      "Use a valid HTTPS evidence URL or governed evidence reference.",
    ]);
  });
});
