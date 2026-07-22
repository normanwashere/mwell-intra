import type {
  PriceProposal,
  PriceProposalDraft,
  ReadinessPackage,
  ReadinessSubmission,
} from "./types";

export function validateReadinessSubmission(
  input: ReadinessSubmission,
): string[] {
  const errors: string[] = [];
  if (!input.productId.trim()) errors.push("Select a product.");
  if (input.title.trim().length < 6)
    errors.push("Readiness title must contain at least 6 characters.");
  if (input.evidence.length === 0) {
    errors.push("Add at least one readiness evidence item.");
  } else if (
    input.evidence.some(
      (item) => item.required && (!item.verified || !item.reference.trim()),
    )
  ) {
    errors.push("Verify every required readiness evidence item.");
  }
  return errors;
}

export function canAcknowledgeOperationsHandoff(
  readiness: ReadinessPackage,
): boolean {
  return (
    readiness.status === "approved" &&
    readiness.evidence.every((item) => !item.required || item.verified) &&
    readiness.operationsAcknowledgedAt === null
  );
}

export function canLaunchFromReadiness(readiness: ReadinessPackage): boolean {
  return (
    readiness.status === "approved" &&
    readiness.evidence.every((item) => !item.required || item.verified) &&
    Boolean(
      readiness.operationsAcknowledgedBy &&
        readiness.operationsAcknowledgedAt,
    )
  );
}

export function validatePriceProposal(input: PriceProposalDraft): string[] {
  const errors: string[] = [];
  if (!Number.isFinite(input.proposedPrice) || input.proposedPrice <= 0)
    errors.push("Proposed price must be greater than zero.");
  if (!Number.isFinite(input.costBasis) || input.costBasis < 0)
    errors.push("Cost basis must be zero or more.");
  if (input.reason.trim().length < 12)
    errors.push("Reason must contain at least 12 characters.");
  if (Number.isNaN(Date.parse(input.effectiveAt)))
    errors.push("Effective date is invalid.");
  return errors;
}

export function canDecidePriceProposal(
  proposal: PriceProposal,
  actorId: string,
): boolean {
  return proposal.status === "submitted" && proposal.proposedBy !== actorId;
}
