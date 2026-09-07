import type { SimulationDefinition } from "./types";

// Review candidates only; not registered or assigned. No answer keys in this module.
export const SCOPED_READINESS_CANDIDATES: readonly SimulationDefinition[] = [
  {
    id: "warehouse-quality-inspection-review-v1", version: 1,
    audience: "internal", module: "warehouse", title: "Inspect source-bound stock and route exceptions",
    capabilityOutcomes: [{ module: "warehouse", capability: "inspect_quality" }],
    checkpointIds: ["confirm-source", "hold-with-evidence", "confirm-handoff"],
    embeddedSteps: [
      { checkpointId: "confirm-source", outcomeId: "confirm-source", title: "Confirm the inspection source",
        instruction: "Inspect the selected pending source and its units. A similar product name is not evidence that another receipt or return is the same source.",
        context: "Two pending sources contain the same SKU. The damaged unit belongs to the second receipt.", question: "Which source should receive the inspection?",
        choices: [{ id: "first-sku", label: "Inspect the first matching SKU" }, { id: "exact-source", label: "Match the source record and affected units before inspecting" }, { id: "edit-receipt", label: "Rewrite the receipt so the units match" }] },
      { checkpointId: "hold-with-evidence", outcomeId: "hold-with-evidence", title: "Record a supported quality hold",
        instruction: "A non-accepted disposition requires a reason. Supply required evidence before submitting; an upload still in progress is not captured evidence.",
        context: "The unit is damaged. Place on hold is selected, the reason is empty and required evidence has not finished uploading.", question: "What is the valid next action?",
        choices: [{ id: "accept-urgent", label: "Accept the unit because the requester needs it urgently" }, { id: "submit-empty", label: "Submit the hold now and add evidence later" }, { id: "complete-hold", label: "Record the defect reason, finish required evidence and submit the hold" }] },
      { checkpointId: "confirm-handoff", outcomeId: "confirm-handoff", title: "Confirm the result and retain custody",
        instruction: "A failed or lost response does not establish whether the decision was recorded; read back the exact source before retrying or handing off. Retain its custody restrictions; release or vendor return follows its own authorized workflow.",
        context: "The submission response failed or was lost. A colleague proposes moving the held stock to available inventory or dispatching a vendor return immediately.", question: "What should happen?",
        choices: [{ id: "release-anyway", label: "Release the units because the inspection was attempted" }, { id: "dispatch-return", label: "Dispatch a return without its separate authority" }, { id: "verify-route", label: "Read back the exact source before retry or handoff, retaining custody restrictions and separate disposition authority" }] },
    ],
  },
  {
    id: "procurement-payment-readiness-review-v1", version: 1,
    audience: "internal", module: "procurement", title: "Review the current payment pack independently",
    capabilityOutcomes: [{ module: "procurement", capability: "review_payment_readiness" }],
    checkpointIds: ["separate-decisions", "return-stale-pack", "review-not-release"],
    embeddedSteps: [
      { checkpointId: "separate-decisions", outcomeId: "separate-decisions", title: "Verify independent source evidence",
        instruction: "Warehouse custody, requester acceptance, Procurement evidence and Finance review remain separate attributable decisions. An approved PO or warehouse receipt alone is not payment readiness.",
        context: "The PO and invoice quantities match, but requester acceptance is missing and the pack preparer offers to approve their own review.", question: "What is the correct response?",
        choices: [{ id: "po-enough", label: "Accept because the PO was approved" }, { id: "self-review", label: "Let the preparer approve their own pack" }, { id: "return-owner", label: "Return the incomplete pack with a reason to the responsible owner and preserve independent review" }] },
      { checkpointId: "return-stale-pack", outcomeId: "return-stale-pack", title: "Review the current evidence version",
        instruction: "Use the pack's source-bound evidence and current readiness blockers. Earlier acceptance is not proof that revised or stale evidence is ready.",
        context: "A formerly accepted pack now shows stale evidence after a source change; the new invoice no longer matches accepted quantities.", question: "What should Finance do?",
        choices: [{ id: "reuse-acceptance", label: "Reuse the old accepted state" }, { id: "rewrite-custody", label: "Change Warehouse acceptance to match the invoice" }, { id: "return-current", label: "Return the current pack with the mismatch reason for correction and resubmission" }] },
      { checkpointId: "review-not-release", outcomeId: "review-not-release", title: "Separate review acceptance from payment release",
        instruction: "Accept only the current supported pack through independent review. Payment release is a separate authorized action. A rejected or lost response is not proof of either action succeeding.",
        context: "Corrected evidence is now supported. After submitting acceptance, the response fails and a colleague asks you to mark the payment released.", question: "Which handoff is safe?",
        choices: [{ id: "mark-paid", label: "Mark the payment released because the evidence looked correct" }, { id: "assume-accepted", label: "Assume review succeeded and proceed" }, { id: "readback-handoff", label: "Read back the current review, resolve any failure and leave release to its separately authorized action" }] },
    ],
  },
];
