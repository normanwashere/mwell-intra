import { createElement } from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  EventWorkflowSummary,
  eventWorkflowSummary,
} from "./EventWorkflowSummary";
import { eventReconciliationHandoff } from "./data";
import type { EventRecord, EventReconciliation } from "./types";

const event: EventRecord = {
  id: "event-1",
  name: "Activation",
  type: "b2c",
  startDate: "2026-09-11",
  lifecycle: "planned",
  reservedUnits: 0,
  issuedUnits: 0,
  returnedUnits: 0,
  ownerEmail: "recorded.owner@example.com",
};
const reconciliation: EventReconciliation = {
  eventId: event.id,
  status: "draft",
  soldUnits: 3,
  giveawayUnits: 0,
  returnedUnits: 0,
  lostUnits: 0,
  damagedUnits: 0,
  rekitUnits: 0,
  grossSalesAmount: 100,
  evidenceUrl: "https://example.com/evidence",
  updatedAt: "2026-09-11",
};
const access = { mayManage: false, mayApprove: false };

describe("event workflow summary", () => {
  it.each(["planned", "active", "completed", "closed", "cancelled"] as const)(
    "covers the %s lifecycle without claiming financial completion",
    (lifecycle) => {
      const result = eventWorkflowSummary({ event: { ...event, lifecycle } });
      expect(result.status.toLowerCase()).toContain(lifecycle);
      expect(result.nextStep).toBeTruthy();
      expect(result.owner).not.toContain("@");
      expect(result.tone).not.toBe("success");
    },
  );
  it.each(["closed", "cancelled"] as const)(
    "keeps custody follow-up visible for %s with issued stock",
    (lifecycle) => {
      expect(
        eventWorkflowSummary({
          event: { ...event, lifecycle, issuedUnits: 3 },
        }),
      ).toMatchObject({
        owner: "Event operations / Warehouse",
        tone: "warning",
      });
    },
  );
  it.each(["draft", "submitted", "approved"] as const)(
    "reuses the existing %s reconciliation handoff",
    (status) => {
      const record = { ...reconciliation, status };
      const handoff = eventReconciliationHandoff(record, 3, access);
      const summary = eventWorkflowSummary({
        event,
        reconciliation: record,
        handoff,
      });
      expect(summary.owner).toBe(handoff.owner);
      if (status === "approved")
        expect(summary.nextStep).toContain("If still pending");
      else expect(summary.nextStep).toBe(handoff.nextAction);
    },
  );
  it("preserves Finance close follow-up even after event closure", () => {
    const record = { ...reconciliation, status: "approved" as const };
    const result = eventWorkflowSummary({
      event: { ...event, lifecycle: "closed" },
      reconciliation: record,
      handoff: eventReconciliationHandoff(record, 3, access),
    });
    expect(result.owner).toBe("Finance close manager");
    expect(result.nextStep).toContain("different Finance actor");
    expect(result.tone).not.toBe("success");
  });
  it("retains negative and recovery gates from existing outcome validation", () => {
    const broken = { ...reconciliation, evidenceUrl: undefined };
    const blocked = eventWorkflowSummary({
      event,
      reconciliation: broken,
      handoff: eventReconciliationHandoff(broken, 4, access),
    });
    expect(blocked.tone).toBe("warning");
    expect(blocked.blocker).toContain("evidence");
    const fixed = eventWorkflowSummary({
      event,
      reconciliation,
      handoff: eventReconciliationHandoff(reconciliation, 3, access),
    });
    expect(fixed.blocker).toBeUndefined();
  });
  it("does not conceal a missing Finance reference after submission", () => {
    const record = { ...reconciliation, status: "submitted" as const };
    expect(
      eventWorkflowSummary({
        event,
        reconciliation: record,
        handoff: eventReconciliationHandoff(record, 3, access),
      }).blocker,
    ).toContain("Finance settlement reference is missing");
  });
  it("reports unknown lifecycle, unknown settlement, and missing handoff explicitly", () => {
    expect(
      eventWorkflowSummary({
        event: { ...event, lifecycle: "future" as EventRecord["lifecycle"] },
      }).owner,
    ).toBe("Not determined");
    expect(
      eventWorkflowSummary({
        event,
        reconciliation: {
          ...reconciliation,
          status: "future" as EventReconciliation["status"],
        },
      }).owner,
    ).toBe("Not determined");
    expect(eventWorkflowSummary({ event, reconciliation }).owner).toBe(
      "Not determined",
    );
  });
  it("renders an explicit stale state, recovers, and adds no duplicate action or named assignment", () => {
    const view = render(
      createElement(EventWorkflowSummary, { event, readFailed: true }),
    );
    const summary = screen.getByRole("region", { name: "Workflow status" });
    expect(
      within(summary).getByText("Next responsibility"),
    ).toBeInTheDocument();
    expect(summary).toHaveTextContent("Event workflow unavailable");
    expect(within(summary).queryByRole("button")).not.toBeInTheDocument();
    view.rerender(createElement(EventWorkflowSummary, { event }));
    expect(summary).not.toHaveTextContent("Event workflow unavailable");
    expect(summary).not.toHaveTextContent(event.ownerEmail!);
  });
});
