export interface SimulationChoiceAuthorityInput {
  simulationId: string;
  checkpointId: string;
  choiceId: string;
}

export type SimulationChoiceAuthorityResult =
  { accepted: true } | { accepted: false; feedback: string };

interface ChoiceRule {
  acceptedChoiceId: string;
  rejectedFeedback: Readonly<Record<string, string>>;
}

const rule = (
  acceptedChoiceId: string,
  rejectedFeedback: Readonly<Record<string, string>>,
): ChoiceRule => ({ acceptedChoiceId, rejectedFeedback });

const CHOICE_RULES: Readonly<Record<string, ChoiceRule>> = {
  "platform-access-governance-v1:review-access-scope": rule("verify-role", {
    "grant-admin":
      "Platform Administrator does not provide operational approval authority and would violate least privilege.",
    "share-account":
      "Shared accounts remove attribution and are not an acceptable recovery path.",
  }),
  "platform-access-governance-v1:confirm-independent-review": rule(
    "independent-review",
    {
      "self-approve":
        "A correct role mapping does not remove the independent-review requirement.",
      "grant-first":
        "Access must not become effective before the required review.",
    },
  ),
  "employee-request-handoff-v1:draft-source-request": rule("complete-request", {
    "submit-now":
      "Chat is not the authoritative request record and leaves the handoff incomplete.",
    "place-order":
      "A requester cannot bypass sourcing, approval, and purchase-order controls.",
  }),
  "employee-request-handoff-v1:confirm-accountable-handoff": rule(
    "submit-owner",
    {
      "mark-approved":
        "Request preparation and approval are separate responsibilities.",
      duplicate:
        "Duplicate records create competing sources of truth and may cause duplicate spend.",
    },
  ),
  "warehouse-receiving-v1:draft-saved": rule("record-actual", {
    "record-document":
      "Recording the document quantity would overstate custody and corrupt serialized inventory.",
    "reject-offline":
      "The discrepancy and custody event still require an attributable system record.",
  }),
  "warehouse-receiving-v1:complete": rule("hold-for-quality", {
    "release-one": "Pending-inspection stock cannot be allocated or released.",
    "accept-all":
      "The operator must not replace the independent inspection decision.",
  }),
  "operations-exception-review-v1:review-custody-evidence": rule(
    "return-recount",
    {
      "edit-count":
        "Rewriting the observed count destroys the evidence needed to investigate the variance.",
      "approve-loss":
        "Materiality does not remove evidence and approval controls.",
    },
  ),
  "operations-exception-review-v1:record-independent-disposition": rule(
    "route-correction",
    {
      "write-off":
        "A known unposted transfer is a correction issue, not evidence of loss.",
      "delete-count":
        "The original count is part of the audit trail and must remain attributable.",
    },
  ),
  "operations-exception-review-v1:review-procurement-handoff": rule(
    "return-incomplete-handoff",
    {
      "receive-then-fix":
        "Receiving first bypasses the governed Procurement-to-Operations handoff.",
      "approve-procurement":
        "Operations cannot replace Procurement, Finance, Legal, or DOA authority.",
    },
  ),
  "operations-exception-review-v1:acknowledge-product-handoff": rule(
    "acknowledge-with-blocker",
    {
      "override-product":
        "Operations does not own Product's go-live authority.",
      "ignore-route-risk":
        "A go-live decision does not remove Operations' duty to report and resolve execution risk.",
    },
  ),
  "procurement-evidence-routing-v1:validate-sourcing-evidence": rule(
    "return-evidence",
    {
      "draft-po":
        "Requester preference is not sourcing evidence or approval authority.",
      "split-order": "Order splitting to avoid controls is prohibited.",
    },
  ),
  "procurement-evidence-routing-v1:route-independent-approval": rule(
    "effective-doa",
    {
      "lower-amount":
        "Changing the amount to fit authority would falsify the governed record.",
      "self-approve-procurement":
        "Sourcing completion does not grant final spending authority.",
    },
  ),
  "finance-independent-review-v1:reconcile-source-evidence": rule(
    "hold-mismatch",
    {
      "pay-po": "PO approval does not prove receipt and acceptance.",
      "edit-receipt": "Finance must not rewrite warehouse custody evidence.",
    },
  ),
  "finance-independent-review-v1:record-finance-decision": rule(
    "approve-nine",
    {
      "approve-original":
        "The original mismatch remains unsupported and must not be paid.",
      "delete-hold":
        "The hold and its resolution are part of the audit history.",
    },
  ),
  "legal-controlled-review-v1:validate-controlled-evidence": rule(
    "request-current-privacy",
    {
      "approve-commercial":
        "Commercial completeness does not satisfy applicable privacy requirements.",
      "replace-document": "Legal must not replace applicant-owned evidence.",
    },
  ),
  "legal-controlled-review-v1:record-legal-determination": rule(
    "return-signature",
    {
      "sign-for-vendor": "A reviewer cannot execute the vendor's instrument.",
      "approve-pending":
        "A mandatory executed instrument cannot be deferred after approval.",
    },
  ),
  "event-fulfillment-reconciliation-v1:plan-event-fulfillment": rule(
    "assign-custody",
    {
      "release-all":
        "Release without accountable custody creates an avoidable event variance.",
      "mark-giveaway":
        "Reusable event materials must remain returnable inventory.",
    },
  ),
  "event-fulfillment-reconciliation-v1:reconcile-event-custody": rule(
    "record-variance",
    {
      "close-expected":
        "Planned quantities cannot replace actual custody outcomes.",
      "expense-kit":
        "Changing the classification would conceal the custody loss.",
    },
  ),
  "product-governance-decision-v1:review-launch-evidence": rule(
    "return-readiness",
    {
      "approve-anyway": "Inventory alone does not prove operational readiness.",
      "acknowledge-ops":
        "Product cannot act as the independent Operations owner.",
    },
  ),
  "product-governance-decision-v1:record-product-decision": rule(
    "return-effective-date",
    {
      backdate: "Backdating weakens chronology and auditability.",
      "edit-date":
        "Return the submitted version rather than rewrite its evidence.",
    },
  ),
  "leadership-indicator-review-v1:interpret-indicator-freshness": rule(
    "qualify-indicator",
    {
      "approve-writeoff": "A KPI is not source evidence or approval authority.",
      ignore: "Stale data still warrants an accountable follow-up.",
    },
  ),
  "leadership-indicator-review-v1:route-accountable-follow-up": rule(
    "assign-source-owner",
    {
      "edit-dashboard":
        "Presentation-layer edits would not correct the authoritative source.",
      "close-alert":
        "The issue remains open until the source is corrected and the indicator is refreshed.",
    },
  ),
  "vendor-accreditation-submission-v1:prepare-accreditation-evidence": rule(
    "replace-and-align",
    {
      "submit-old":
        "Email promises do not satisfy required accreditation evidence.",
      "change-review-status": "Vendors cannot change reviewer-owned status.",
    },
  ),
  "vendor-accreditation-submission-v1:confirm-vendor-submission": rule(
    "answer-declaration",
    {
      "leave-blank":
        "A mandatory unanswered declaration makes the submission incomplete.",
      "ask-legal-answer":
        "Applicant declarations must remain vendor-owned and attributable.",
    },
  ),
};

export function evaluateSimulationChoice(
  input: SimulationChoiceAuthorityInput,
): SimulationChoiceAuthorityResult {
  const rule = CHOICE_RULES[`${input.simulationId}:${input.checkpointId}`];
  if (!rule) {
    throw new Error(
      "Simulation checkpoint is not published for choice evaluation.",
    );
  }
  if (input.choiceId === rule.acceptedChoiceId) return { accepted: true };
  const feedback = rule.rejectedFeedback[input.choiceId];
  if (!feedback) {
    throw new Error(
      "Choice is not part of the published simulation checkpoint.",
    );
  }
  return { accepted: false, feedback };
}

export async function recordAuthorizedSimulationChoice(
  input: SimulationChoiceAuthorityInput,
  recordCheckpoint: () => Promise<void>,
): Promise<SimulationChoiceAuthorityResult> {
  const result = evaluateSimulationChoice(input);
  if (!result.accepted) return result;
  await recordCheckpoint();
  return result;
}
