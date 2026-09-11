import type { ComponentProps } from "react";
import { WorkflowSummary } from "@intra/ui";
import type { AccreditationCase, CaseStatus } from "./types";
import { CASE_STATUS_LABEL } from "./labels";

export interface CaseWorkflowInput {
  kase?: Pick<
    AccreditationCase,
    "decisionPending" | "correctionRequest" | "decisionNote"
  >;
  status?: CaseStatus;
  loading?: boolean;
  readFailed?: boolean;
  requiredCount?: number;
  outstandingCount?: number;
  awaitingReviewCount?: number;
  readyForDecision?: boolean;
}

export function caseWorkflowSummary(
  input: CaseWorkflowInput,
): ComponentProps<typeof WorkflowSummary> {
  const { kase, status } = input;
  if (input.readFailed || input.loading || !kase || !status)
    return {
      status: input.loading
        ? "Checking case requirements"
        : "Case status unavailable",
      owner: "Not determined",
      nextStep: input.loading
        ? "Wait for the case evidence to load."
        : "Retry case data or return to the case list.",
      blocker: "The current case and evidence could not be verified.",
      tone: "warning",
    };
  const label = CASE_STATUS_LABEL[status];
  if (!label)
    return {
      status: "Unknown case status",
      owner: "Not determined",
      nextStep: "Refresh the case and confirm its status with Legal.",
      blocker: "This status is not recognized.",
      tone: "warning",
    };
  if (kase.decisionPending)
    return {
      status: "Independent confirmation pending",
      owner: "Independent Legal approver",
      nextStep:
        "Review the proposed decision and record independent confirmation.",
      blocker: "The proposed decision is not final.",
      tone: "warning",
    };
  switch (status) {
    case "approved":
      return {
        status: label,
        owner: "Legal (renewal monitoring)",
        nextStep:
          "Retain the approval and scope; monitor the expiry date. Procurement checks remain separate.",
        tone: "success",
      };
    case "provisional":
      return {
        status: label,
        owner: "Legal / vendor",
        nextStep:
          "Review the temporary scope, expiry, and outstanding conditions.",
        blocker: "Temporary clearance is not full accreditation.",
        tone: "warning",
      };
    case "rejected":
      return {
        status: label,
        owner: "Vendor / Legal",
        nextStep:
          "Review the recorded decision with Legal before any further application.",
        blocker: kase.decisionNote || "No decision reason recorded.",
        tone: "warning",
      };
    case "expired":
    case "renewal_due":
      return {
        status: label,
        owner: "Legal / vendor",
        nextStep:
          "Review renewal requirements and the linked accreditation cycle.",
        blocker:
          status === "expired"
            ? "Accreditation has expired."
            : "Accreditation renewal is due.",
        tone: "warning",
      };
    case "correction_requested":
      return {
        status: label,
        owner: kase.correctionRequest ? "Vendor" : "Legal",
        nextStep: kase.correctionRequest
          ? "Update the requested correction revision and resubmit for Legal review."
          : "Confirm the missing correction request before editing the application.",
        blocker:
          kase.correctionRequest?.note || "Correction details are unavailable.",
        tone: "warning",
      };
  }
  const countsVerified = [
    input.requiredCount,
    input.outstandingCount,
    input.awaitingReviewCount,
  ].every(
    (count) =>
      typeof count === "number" && Number.isSafeInteger(count) && count >= 0,
  );
  if (!countsVerified || !input.requiredCount)
    return {
      status: label,
      owner: "Legal",
      nextStep:
        "Confirm the applicable checklist before submission or decision.",
      blocker: "Required checklist coverage is unknown.",
      tone: "warning",
    };
  if (status === "draft")
    return {
      status: label,
      owner: "Vendor",
      nextStep: input.outstandingCount
        ? "Complete the outstanding evidence, then submit for Legal review."
        : "Review the application and sign the completeness attestation to submit.",
      blocker: input.outstandingCount
        ? `${input.outstandingCount} required item(s) still need evidence or correction.`
        : undefined,
      tone: input.outstandingCount ? "warning" : "neutral",
    };
  if (input.readyForDecision)
    return {
      status: label,
      owner: "Legal approver",
      nextStep: "Review the evidence and record the accreditation decision.",
      tone: "neutral",
    };
  return {
    status: label,
    owner: "Legal reviewer",
    nextStep: input.outstandingCount
      ? "Review the outstanding requirements and request vendor corrections where needed."
      : "Review the submitted evidence before the accreditation decision.",
    blocker: input.outstandingCount
      ? `${input.outstandingCount} required item(s) remain outstanding.`
      : input.awaitingReviewCount
        ? `${input.awaitingReviewCount} item(s) await Legal review.`
        : "Required evidence is not yet ready for decision.",
    tone: "warning",
  };
}

export function CaseWorkflowSummary(props: CaseWorkflowInput) {
  return <WorkflowSummary {...caseWorkflowSummary(props)} />;
}
