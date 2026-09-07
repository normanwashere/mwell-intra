// Proposed evaluation rules only. Not imported by the active evaluator.
// Source: InspectionSheet validation and PaymentReadinessPanel's separate decisions.
export const SCOPED_READINESS_CANDIDATE_RULES = {
  "warehouse-quality-inspection-review-v1:confirm-source": {
    acceptedChoiceId: "exact-source",
    rejectedFeedback: {
      "first-sku": "A matching SKU does not identify the receipt or return being inspected. Confirm the source and affected units.",
      "edit-receipt": "Inspection must reference the actual source record, not rewrite receipt evidence to fit another source.",
    },
  },
  "warehouse-quality-inspection-review-v1:hold-with-evidence": {
    acceptedChoiceId: "complete-hold",
    rejectedFeedback: {
      "accept-urgent": "Urgency does not resolve a damaged unit's quality disposition. Record the supported hold and retain custody controls.",
      "submit-empty": "A non-accepted disposition requires a reason, and required evidence must finish uploading before submission.",
    },
  },
  "warehouse-quality-inspection-review-v1:confirm-handoff": {
    acceptedChoiceId: "verify-route",
    rejectedFeedback: {
      "release-anyway": "A failed or lost response does not establish whether the decision was recorded; read back the exact source before retrying or handing off. Retain custody restrictions until the separately authorized disposition permits movement.",
      "dispatch-return": "Inspection does not authorize vendor-return dispatch. Follow the separate authorized return workflow.",
    },
  },
  "procurement-payment-readiness-review-v1:separate-decisions": {
    acceptedChoiceId: "return-owner",
    rejectedFeedback: {
      "po-enough": "PO approval does not replace requester acceptance or the other payment-pack evidence. Return the incomplete pack to its responsible owner.",
      "self-review": "Pack preparation and independent Finance review are separate decisions. The preparer must not substitute self-approval for independent review.",
    },
  },
  "procurement-payment-readiness-review-v1:return-stale-pack": {
    acceptedChoiceId: "return-current",
    rejectedFeedback: {
      "reuse-acceptance": "Earlier acceptance does not establish readiness after source evidence changes. Review the current pack and return the mismatch for correction.",
      "rewrite-custody": "Finance must not rewrite Warehouse acceptance to match an invoice. Return the mismatch to its source owner and preserve the evidence.",
    },
  },
  "procurement-payment-readiness-review-v1:review-not-release": {
    acceptedChoiceId: "readback-handoff",
    rejectedFeedback: {
      "mark-paid": "Review acceptance and payment release are separate authorized actions. A failed response is not evidence that either succeeded.",
      "assume-accepted": "A failed response does not establish an accepted review. Read back the current pack and resolve the failure before the separate release handoff.",
    },
  },
} as const;
