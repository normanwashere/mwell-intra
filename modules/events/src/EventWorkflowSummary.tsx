import type { ComponentProps } from "react";
import { WorkflowSummary } from "@intra/ui";
import type { EventRecord, EventReconciliation } from "./types";

export interface EventWorkflowInput {
  event: EventRecord;
  reconciliation?: EventReconciliation;
  handoff?: {
    stage: string;
    owner: string;
    blockers: string[];
    nextAction: string;
  };
  readFailed?: boolean;
}

export function eventWorkflowSummary({
  event,
  reconciliation,
  handoff,
  readFailed,
}: EventWorkflowInput): ComponentProps<typeof WorkflowSummary> {
  if (readFailed)
    return {
      status: "Event workflow unavailable",
      owner: "Not determined",
      nextStep: "Retry event data before acting on the displayed record.",
      blocker: "Event, custody, or reconciliation data may be stale.",
      tone: "warning",
    };
  if (
    !["planned", "active", "completed", "closed", "cancelled"].includes(
      event.lifecycle,
    )
  )
    return {
      status: "Unknown event lifecycle",
      owner: "Not determined",
      nextStep: "Refresh and confirm the event lifecycle.",
      blocker: "This lifecycle is not recognized.",
      tone: "warning",
    };
  if (
    reconciliation &&
    (!["draft", "submitted", "approved"].includes(reconciliation.status) ||
      !handoff)
  )
    return {
      status: `${event.lifecycle}; settlement unknown`,
      owner: "Not determined",
      nextStep: "Refresh and confirm the reconciliation status.",
      blocker: "The settlement handoff could not be determined.",
      tone: "warning",
    };
  if (reconciliation && handoff)
    return {
      status: `${event.lifecycle}; ${handoff.stage}`,
      owner: handoff.owner,
      nextStep:
        reconciliation.status === "approved"
          ? "Check the generated Finance close entry. If still pending, post it and have a different Finance actor reconcile it."
          : handoff.nextAction,
      blocker: handoff.blockers.length ? handoff.blockers.join(" ") : undefined,
      // Settlement approval hands work to Finance close; it does not prove financial closure.
      tone: handoff.blockers.length ? "warning" : "neutral",
    };
  if (event.lifecycle === "cancelled" || event.lifecycle === "closed")
    return {
      status: event.lifecycle === "closed" ? "Event closed" : "Event cancelled",
      owner:
        event.issuedUnits > 0 || event.reservedUnits > 0
          ? "Event operations / Warehouse"
          : "No pending event operation",
      nextStep:
        event.issuedUnits > 0 || event.reservedUnits > 0
          ? "Verify custody and settlement records; reopen through the existing control only when correction is required."
          : "Retain the event record; reopen only when further event work is required.",
      blocker:
        event.issuedUnits > 0 || event.reservedUnits > 0
          ? "Custody activity exists but no reconciliation is visible."
          : undefined,
      tone:
        event.issuedUnits > 0 || event.reservedUnits > 0
          ? "warning"
          : "neutral",
    };
  if (event.issuedUnits > 0 || event.lifecycle === "completed")
    return {
      status: `${event.lifecycle}; reconciliation not started`,
      owner: "Event operations",
      nextStep:
        "Record event outcomes and evidence, then submit reconciliation to Finance.",
      blocker: "Event outcomes and settlement have not been reconciled.",
      tone: "warning",
    };
  return {
    status: `${event.lifecycle}; stock handoff`,
    owner: "Event operations / Warehouse",
    nextStep:
      "Review stock demand and existing warehouse requests. Warehouse handles allocation, issue, and returns.",
    tone: "neutral",
  };
}

export function EventWorkflowSummary(props: EventWorkflowInput) {
  return <WorkflowSummary {...eventWorkflowSummary(props)} />;
}
