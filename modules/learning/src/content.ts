import type { AssessmentQuestion } from "./AssessmentRunner";
import type { ControlledPolicyDocument } from "./PolicyAcknowledgment";
import marketingReservationAssessment from "./marketing-reservation-assessment.json";

export const MARKETING_RESERVATION_ASSESSMENT = marketingReservationAssessment;

export const WAREHOUSE_RECEIVING_POLICY_ID =
  "internal.warehouse.receiving-custody-policy.v1";
export const WAREHOUSE_RECEIVING_ASSESSMENT_ID =
  "internal.warehouse.receiving-controls-assessment.v1";

const RECEIVING_QUESTIONS: readonly AssessmentQuestion[] = [
  {
    id: "receiving-identifiers",
    prompt: "What must be recorded before serialized stock can be received?",
    options: [
      {
        id: "capture-identifiers",
        label: "Delivery date, batch, and every unit serial",
      },
      { id: "quantity-only", label: "Only the total delivered quantity" },
      { id: "supplier-only", label: "Only the supplier and courier" },
    ],
    explanation:
      "Delivery, batch, and unit identity preserve end-to-end traceability.",
  },
  {
    id: "receiving-exception",
    prompt:
      "What should happen when received stock is damaged or unidentified?",
    options: [
      { id: "available-stock", label: "Place it in available stock" },
      {
        id: "controlled-quality",
        label: "Keep it in controlled quality custody",
      },
      { id: "discard-immediately", label: "Discard it without a record" },
    ],
    explanation:
      "Exceptions remain in controlled custody until an authorized disposition is recorded.",
  },
];

const RECEIVING_POLICY: ControlledPolicyDocument = {
  id: "OPS-WH-RCV-001",
  version: "4.2",
  title: "Warehouse receiving and custody control",
  owner: "Operations and Legal Compliance",
  effectiveDate: "2026-08-13",
  summary:
    "These controls keep every inbound item attributable, traceable, and unavailable until custody is valid.",
  sections: [
    "Capture the actual delivery date, supplier batch, and each serialized unit before receipt.",
    "Keep damaged, short, rejected, or unidentified stock under controlled quality custody until an authorized disposition.",
    "Attach attributable delivery evidence and use an approved warehouse and bin before stock becomes available.",
  ],
  evidenceHash:
    "9b13c375513649ddab0af15ce7188a22fcbcefe7d861a7002e759cefb88e0cc0",
  href: "/knowledge?article=feature-warehouse-receiving",
};

export function assessmentQuestionsFor(
  requirementId: string,
): readonly AssessmentQuestion[] | null {
  if (requirementId === MARKETING_RESERVATION_ASSESSMENT.id) {
    return MARKETING_RESERVATION_ASSESSMENT.questions;
  }
  return requirementId === WAREHOUSE_RECEIVING_ASSESSMENT_ID
    ? RECEIVING_QUESTIONS
    : null;
}

export function policyDocumentFor(
  requirementId: string,
): ControlledPolicyDocument | null {
  return requirementId === WAREHOUSE_RECEIVING_POLICY_ID
    ? RECEIVING_POLICY
    : null;
}
