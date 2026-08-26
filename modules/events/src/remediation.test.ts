import { describe, expect, it } from "vitest";
import { applyMemoryEventReconciliation } from "./data";
import { EVENTS_DEMO_DATA } from "./seed";

describe("Event remediation contract", () => {
  it("walks a memory reconciliation through submit and correction without claiming a live handoff", () => {
    const submitted = applyMemoryEventReconciliation(EVENTS_DEMO_DATA, {
      eventId: "evt-demo-lgu",
      action: "submit",
      soldUnits: 275,
      giveawayUnits: 4,
      returnedUnits: 1,
      lostUnits: 0,
      damagedUnits: 0,
      rekitUnits: 0,
      grossSalesAmount: 5_000,
      financeReference: "FIN-EVT-001",
      evidenceUrl: "memory://event-settlement/evt-demo-lgu",
      note: "Demo settlement ready for Finance review.",
    });
    expect(submitted.reconciliations).toContainEqual(
      expect.objectContaining({ eventId: "evt-demo-lgu", status: "submitted" }),
    );

    const corrected = applyMemoryEventReconciliation(submitted, {
      eventId: "evt-demo-lgu",
      action: "save",
      soldUnits: 10,
      giveawayUnits: 4,
      returnedUnits: 4,
      lostUnits: 0,
      damagedUnits: 0,
      rekitUnits: 0,
      grossSalesAmount: 5_000,
      financeReference: "FIN-EVT-001",
      evidenceUrl: "memory://event-settlement/evt-demo-lgu-v2",
      note: "Demo correction after count reconciliation.",
    });
    expect(corrected.reconciliations).toContainEqual(
      expect.objectContaining({ eventId: "evt-demo-lgu", status: "draft", returnedUnits: 4 }),
    );
  });
});
