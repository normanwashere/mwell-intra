import type { ComponentProps } from "react";
import { WorkflowSummary } from "@intra/ui";
import { kitReadiness } from "./domain";
import type { ReadinessPackage } from "./types";

export function readinessWorkflowSummary(
  item: ReadinessPackage,
  readFailed = false,
): ComponentProps<typeof WorkflowSummary> {
  if (readFailed)
    return {
      status: "Readiness status unavailable",
      owner: "Not determined",
      nextStep:
        "Refresh the workspace and verify the latest record before acting.",
      blocker: "Displayed readiness data may be stale.",
      tone: "warning",
    };
  switch (item.status) {
    case "draft":
      return {
        status: "Draft readiness",
        owner: "Product preparer",
        nextStep:
          "Complete required evidence and submit the readiness package.",
        blocker: "Go-live has not been approved.",
        tone: "neutral",
      };
    case "submitted":
      return {
        status: "Go-live decision pending",
        owner: "Product decision maker",
        nextStep:
          "Review the evidence and conditions, then approve or reject go-live.",
        blocker: "Operations handoff awaits Product approval.",
        tone: "neutral",
      };
    case "rejected":
      return {
        status: "Go-live rejected",
        owner: "Product preparer",
        nextStep:
          "Review the decision reason and prepare a corrected readiness package.",
        blocker: item.decisionNote || "No decision reason recorded.",
        tone: "warning",
      };
    case "superseded":
      return {
        status: "Superseded readiness",
        owner: "Product",
        nextStep: "Open the current readiness package for the next handoff.",
        blocker: "This version is no longer current.",
        tone: "neutral",
      };
    case "approved":
      break;
    default:
      return {
        status: "Unknown readiness status",
        owner: "Not determined",
        nextStep: "Refresh and confirm the package status with Product.",
        blocker: "This status is not recognized.",
        tone: "warning",
      };
  }
  if (item.isCurrent !== true)
    return {
      status: "Approved; current version not confirmed",
      owner: "Product",
      nextStep:
        "Verify and open the current approved package before the Operations handoff.",
      blocker:
        item.isCurrent === false
          ? "This is not the current approved package."
          : "Current-version information is unavailable.",
      tone: "warning",
    };
  const kit = kitReadiness(item);
  if (!kit.ready)
    return {
      status: "Approved; handoff blocked",
      owner: "Product",
      nextStep: "Confirm the kit requirement and record any required approval.",
      blocker: kit.label,
      tone: "warning",
    };
  if (item.evidence.some((evidence) => evidence.required && !evidence.verified))
    return {
      status: "Approved; evidence incomplete",
      owner: "Product preparer",
      nextStep:
        "Resolve required evidence verification before the Operations handoff.",
      blocker: "Required evidence remains unverified.",
      tone: "warning",
    };
  // Publication follows acknowledgment; a missing or draft kit must not reverse this handoff.
  if (!item.operationsAcknowledgedAt)
    return {
      status: "Approved; Operations handoff pending",
      owner: "Operations partner",
      nextStep:
        "Review the approved conditions and acknowledge the Operations handoff. WMS kit publication follows, where applicable.",
      tone: "neutral",
    };
  if (!item.operationsAcknowledgedBy)
    return {
      status: "Operations acknowledgment incomplete",
      owner: "Not determined",
      nextStep: "Refresh and verify the recorded Operations acknowledgment.",
      blocker: "The acknowledgment actor is unavailable.",
      tone: "warning",
    };
  const publication = item.kitPublication;
  if (!publication || publication.status === "unavailable")
    return {
      status: "Operations acknowledged; publication unknown",
      owner: "Product / Operations",
      nextStep:
        "Refresh the kit publication readback and confirm WMS requirements.",
      blocker: "Kit publication could not be verified.",
      tone: "warning",
    };
  if (publication.status === "not_visible")
    return {
      status: "Operations acknowledged; WMS applicability unconfirmed",
      owner: "Product / Operations",
      nextStep:
        "Confirm whether WMS applies to this product or client go-live; involve Warehouse only if applicable.",
      tone: "neutral",
    };
  if (publication.status === "active")
    return {
      status: "Operations acknowledged; active kit recorded",
      owner: "Warehouse",
      nextStep:
        "Verify the kit approval reference and launch conditions before fulfillment.",
      tone: "neutral",
    };
  return {
    status: "Operations acknowledged; WMS follow-up",
    owner: "Warehouse",
    nextStep:
      "Review the kit definition and publish the approved version in WMS.",
    blocker: `The recorded kit is ${publication.status}, not active.`,
    tone: "warning",
  };
}

export function ReadinessWorkflowSummary({
  item,
  readFailed,
}: {
  item: ReadinessPackage;
  readFailed?: boolean;
}) {
  return <WorkflowSummary {...readinessWorkflowSummary(item, readFailed)} />;
}
