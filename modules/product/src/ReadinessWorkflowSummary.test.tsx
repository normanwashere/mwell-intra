import { createElement } from "react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ReadinessWorkflowSummary,
  readinessWorkflowSummary,
} from "./ReadinessWorkflowSummary";
import { canAcknowledgeOperationsHandoff } from "./domain";
import type { ReadinessPackage } from "./types";

const base: ReadinessPackage = {
  id: "ready-1",
  productId: "product-1",
  title: "Release package",
  version: 1,
  status: "approved",
  isCurrent: true,
  kitRequired: false,
  evidence: [],
  conditions: "",
  preparedBy: "preparer-id",
  submittedBy: "preparer-id",
  submittedAt: "2026-09-10",
  decidedBy: "decider-id",
  decidedAt: "2026-09-11",
  decisionNote: null,
  operationsAcknowledgedBy: null,
  operationsAcknowledgedAt: null,
  createdAt: "2026-09-10",
  updatedAt: "2026-09-11",
};
const acknowledged = {
  ...base,
  operationsAcknowledgedBy: "ops-id",
  operationsAcknowledgedAt: "2026-09-11",
};

describe("readiness workflow summary", () => {
  it.each([
    ["draft", "Product preparer"],
    ["submitted", "Product decision maker"],
    ["rejected", "Product preparer"],
    ["superseded", "Product"],
  ] as const)("maps %s without claiming launch readiness", (status, owner) => {
    expect(readinessWorkflowSummary({ ...base, status })).toMatchObject({
      owner,
    });
    expect(readinessWorkflowSummary({ ...base, status }).tone).not.toBe(
      "success",
    );
  });
  it("preserves rejection rationale", () => {
    expect(
      readinessWorkflowSummary({
        ...base,
        status: "rejected",
        decisionNote: "Evidence incomplete",
      }).blocker,
    ).toBe("Evidence incomplete");
  });
  it.each([false, undefined])(
    "requires confirmed current-version metadata: %s",
    (isCurrent) => {
      expect(readinessWorkflowSummary({ ...base, isCurrent })).toMatchObject({
        owner: "Product",
        tone: "warning",
      });
    },
  );
  it.each([
    { kitRequired: undefined, kitApproved: undefined },
    { kitRequired: true, kitApproved: false },
  ])("does not treat unknown or unapproved kit policy as ready: %j", (kit) => {
    expect(readinessWorkflowSummary({ ...base, ...kit })).toMatchObject({
      status: "Approved; handoff blocked",
      owner: "Product",
      tone: "warning",
    });
  });
  it("keeps unverified evidence with Product", () => {
    expect(
      readinessWorkflowSummary({
        ...base,
        evidence: [
          {
            id: "e1",
            label: "Required review",
            required: true,
            verified: false,
            reference: "REF",
          },
        ],
      }),
    ).toMatchObject({ owner: "Product preparer", tone: "warning" });
  });
  it.each([
    "draft",
    "active",
    "retired",
    "not_visible",
    "unavailable",
  ] as const)(
    "does not make %s publication a prerequisite for Ops acknowledgment",
    (status) => {
      const item = { ...base, kitPublication: { status } };
      expect(canAcknowledgeOperationsHandoff(item)).toBe(true);
      expect(readinessWorkflowSummary(item)).toMatchObject({
        owner: "Operations partner",
        status: "Approved; Operations handoff pending",
      });
      expect(readinessWorkflowSummary(item).blocker).toBeUndefined();
    },
  );
  it.each([
    "draft",
    "active",
    "retired",
    "not_visible",
    "unavailable",
  ] as const)(
    "routes %s publication follow-up by visible applicability after acknowledgment",
    (status) => {
      const result = readinessWorkflowSummary({
        ...acknowledged,
        kitPublication: { status },
      });
      expect(result.owner).toBe(
        status === "not_visible" || status === "unavailable"
          ? "Product / Operations"
          : "Warehouse",
      );
      expect(result.status).toContain("Operations acknowledged");
      expect(result.tone).not.toBe("success");
    },
  );
  it("keeps a non-Warehouse client go-live acknowledged when no kit definition is visible", () => {
    const item = {
      ...acknowledged,
      title: "Client go-live",
      kitRequired: false,
      kitPublication: { status: "not_visible" as const },
    };
    const summary = readinessWorkflowSummary(item);
    expect(summary).toMatchObject({
      owner: "Product / Operations",
      tone: "neutral",
    });
    expect(summary.status).toContain("Operations acknowledged");
    expect(summary.blocker).toBeUndefined();
    expect(summary.nextStep).toContain("only if applicable");
    render(createElement(ReadinessWorkflowSummary, { item }));
    const region = screen.getByRole("region", { name: "Workflow status" });
    expect(region).toHaveTextContent("Operations acknowledged");
    expect(region).not.toHaveTextContent("Needs attention");
    expect(
      within(region).getByText("Product / Operations"),
    ).toBeInTheDocument();
  });
  it("reports absent publication and incomplete acknowledgment explicitly", () => {
    expect(readinessWorkflowSummary(acknowledged).blocker).toBe(
      "Kit publication could not be verified.",
    );
    expect(
      readinessWorkflowSummary({
        ...acknowledged,
        operationsAcknowledgedBy: null,
      }),
    ).toMatchObject({ owner: "Not determined", tone: "warning" });
  });
  it("handles unknown record statuses and stale approved records conservatively", () => {
    expect(
      readinessWorkflowSummary({
        ...base,
        status: "future" as ReadinessPackage["status"],
      }),
    ).toMatchObject({ owner: "Not determined", tone: "warning" });
    expect(readinessWorkflowSummary(base, true)).toMatchObject({
      owner: "Not determined",
      tone: "warning",
    });
  });
  it("renders role responsibility without exposing a named assignment or adding buttons; refresh restores the handoff", () => {
    const view = render(
      createElement(ReadinessWorkflowSummary, { item: base, readFailed: true }),
    );
    const summary = screen.getByRole("region", { name: "Workflow status" });
    expect(
      within(summary).getByText("Next responsibility"),
    ).toBeInTheDocument();
    expect(
      within(summary).getByText("Readiness status unavailable"),
    ).toBeInTheDocument();
    expect(within(summary).queryByRole("button")).not.toBeInTheDocument();
    view.rerender(createElement(ReadinessWorkflowSummary, { item: base }));
    expect(within(summary).getByText("Operations partner")).toBeInTheDocument();
    expect(summary).not.toHaveTextContent("preparer-id");
  });
});
