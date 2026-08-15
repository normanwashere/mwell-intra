import { CAPABILITY_CLASSIFICATIONS, roleCapabilities } from "@intra/rbac";

import { OPERATING_PERSONA_IDS } from "./personas";
import type {
  CurriculumDefinition,
  LearningCapability,
  RequirementDefinition,
  RoleCurriculumDefinition,
  SimulationDefinition,
} from "./types";
import {
  WAREHOUSE_RECEIVING_ASSESSMENT_ID,
  WAREHOUSE_RECEIVING_POLICY_ID,
} from "./content";

export function capabilityKey(capability: LearningCapability): string {
  return `${capability.module}:${capability.capability}`;
}

export const MUTATING_CAPABILITIES: readonly LearningCapability[] =
  CAPABILITY_CLASSIFICATIONS.filter((item) => item.access === "mutation").map(
    ({ module, capability }) => ({ module, capability }),
  );

export const ROLE_PERSONAS: Readonly<Record<string, string>> = {
  "core:platform_admin": "platform_administrator",
  "core:staff": "general_employee",
  "core:vendor_portal": "vendor_representative",
  "warehouse:warehouse_operator": "operations_associate",
  "warehouse:warehouse_supervisor": "operations_lead",
  "warehouse:logistics_supervisor": "operations_lead",
  "warehouse:operations": "general_employee",
  "warehouse:finance": "finance_controller",
  "warehouse:bi_analyst": "leadership_insights",
  "warehouse:business_unit": "general_employee",
  "warehouse:marketing": "marketing_events_lead",
  "warehouse:procurement": "procurement_lead",
  "warehouse:pricing": "product_owner",
  "warehouse:warehouse_admin": "operations_lead",
  "procurement:requester": "general_employee",
  "procurement:procurement_officer": "procurement_lead",
  "procurement:approver": "operations_lead",
  "procurement:finance": "finance_controller",
  "procurement:admin": "procurement_lead",
  "legal:legal_reviewer": "legal_compliance_lead",
  "legal:compliance": "legal_compliance_lead",
  "legal:admin": "legal_compliance_lead",
  "events:requester": "general_employee",
  "events:coordinator": "marketing_events_lead",
  "events:viewer": "leadership_insights",
  "events:finance_reviewer": "finance_controller",
  "events:admin": "marketing_events_lead",
  "insights:analyst": "leadership_insights",
  "insights:manager": "leadership_insights",
  "insights:executive": "leadership_insights",
  "insights:admin": "leadership_insights",
  "product:contributor": "product_owner",
  "product:product_owner": "product_owner",
  "product:operations_partner": "operations_lead",
};

const audienceForPersona = (personaId: string): "internal" | "vendor" =>
  personaId === "vendor_representative" ? "vendor" : "internal";

const orientationRequirement = (personaId: string): RequirementDefinition => {
  const audience = audienceForPersona(personaId);
  const id = `${audience}.${personaId}.orientation.v1`;
  return {
    id,
    version: 1,
    audience,
    kind: "orientation",
    title:
      audience === "vendor"
        ? "Vendor accreditation orientation"
        : "Role orientation",
    mandatory: true,
    prerequisiteIds: [],
    capabilityOutcomes: [],
    simulationId: id,
  };
};

const baselineRequirements = OPERATING_PERSONA_IDS.map(orientationRequirement);

const VENDOR_EVIDENCE_REQUIREMENT_ID =
  "vendor.vendor_representative.evidence-and-acknowledgments.v1";

const vendorJourneyRequirements: readonly RequirementDefinition[] = [
  {
    id: VENDOR_EVIDENCE_REQUIREMENT_ID,
    version: 1,
    audience: "vendor",
    kind: "attestation",
    title: "Vendor evidence and acknowledgments",
    mandatory: true,
    prerequisiteIds: ["vendor.vendor_representative.orientation.v1"],
    capabilityOutcomes: [],
  },
];

const warehouseReceivingRequirements: readonly RequirementDefinition[] = [
  {
    id: WAREHOUSE_RECEIVING_POLICY_ID,
    version: 1,
    audience: "internal",
    kind: "policy",
    title: "Warehouse receiving and custody policy",
    mandatory: true,
    prerequisiteIds: ["internal.operations_associate.orientation.v1"],
    capabilityOutcomes: [],
  },
  {
    id: WAREHOUSE_RECEIVING_ASSESSMENT_ID,
    version: 1,
    audience: "internal",
    kind: "assessment",
    title: "Warehouse receiving controls knowledge check",
    mandatory: true,
    prerequisiteIds: [WAREHOUSE_RECEIVING_POLICY_ID],
    capabilityOutcomes: [],
    passingScore: 80,
    maxAttempts: 3,
  },
];

const capabilityClassificationByKey = new Map(
  CAPABILITY_CLASSIFICATIONS.map((item) => [capabilityKey(item), item]),
);

const titleCaseIdentifier = (value: string): string =>
  value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const choice = (
  id: string,
  label: string,
  correct: boolean,
  feedback: string,
) => ({ id, label, correct, feedback });

const decision = (
  context: string,
  question: string,
  choices: readonly ReturnType<typeof choice>[],
) => ({ context, question, choices });

const ROLE_PRACTICE_CONTENT = {
  platform_administrator: {
    simulationId: "platform-access-governance-v1",
    title: "Govern access without operational authority",
    module: "core",
    steps: [
      [
        "review-access-scope",
        "Review requested access",
        "Identify the smallest role bundle that supports the employee's actual duties.",
        decision(
          "A warehouse employee requests Platform Administrator because they cannot approve a stock adjustment.",
          "What should you do first?",
          [
            choice(
              "verify-role",
              "Verify the job need and map it to the warehouse approval role",
              true,
              "Correct. Platform access must be scoped to the business duty.",
            ),
            choice(
              "grant-admin",
              "Grant Platform Administrator so the employee can continue",
              false,
              "Platform Administrator does not provide operational approval authority and would violate least privilege.",
            ),
            choice(
              "share-account",
              "Ask a supervisor to share an account temporarily",
              false,
              "Shared accounts remove attribution and are not an acceptable recovery path.",
            ),
          ],
        ),
      ],
      [
        "confirm-independent-review",
        "Confirm independent review",
        "Preserve separation between the requester, administrator, and accountable module owner.",
        decision(
          "The role mapping is valid, but you are also listed as the requester for this access change.",
          "How should the change proceed?",
          [
            choice(
              "independent-review",
              "Route the change to a different authorized reviewer",
              true,
              "Correct. The access decision remains attributable and independently reviewed.",
            ),
            choice(
              "self-approve",
              "Approve it yourself because the mapping is correct",
              false,
              "A correct role mapping does not remove the independent-review requirement.",
            ),
            choice(
              "grant-first",
              "Grant access now and document the review later",
              false,
              "Access must not become effective before the required review.",
            ),
          ],
        ),
      ],
    ],
  },
  general_employee: {
    simulationId: "employee-request-handoff-v1",
    title: "Create a governed request and handoff",
    module: "procurement",
    steps: [
      [
        "draft-source-request",
        "Draft the source request",
        "Create a complete source record that another team can evaluate without guessing.",
        decision(
          "Your team needs 20 event kits next month. The request has a quantity but no purpose, required date, cost center, or owner.",
          "What is the best next action?",
          [
            choice(
              "complete-request",
              "Add the missing purpose, date, cost center, owner, and evidence",
              true,
              "Correct. A complete source request prevents avoidable returns and informal approvals.",
            ),
            choice(
              "submit-now",
              "Submit now and explain the details through chat",
              false,
              "Chat is not the authoritative request record and leaves the handoff incomplete.",
            ),
            choice(
              "place-order",
              "Contact a vendor and place the order directly",
              false,
              "A requester cannot bypass sourcing, approval, and purchase-order controls.",
            ),
          ],
        ),
      ],
      [
        "confirm-accountable-handoff",
        "Confirm the accountable handoff",
        "Send the request to the owning workflow while keeping approval with its designated authority.",
        decision(
          "The request is complete and the required date is approaching.",
          "How do you move it forward?",
          [
            choice(
              "submit-owner",
              "Submit it to Procurement and monitor the recorded status",
              true,
              "Correct. The request is handed to its accountable owner without changing authority.",
            ),
            choice(
              "mark-approved",
              "Mark the request approved to save time",
              false,
              "Request preparation and approval are separate responsibilities.",
            ),
            choice(
              "duplicate",
              "Create a second request so one is processed faster",
              false,
              "Duplicate records create competing sources of truth and may cause duplicate spend.",
            ),
          ],
        ),
      ],
    ],
  },
  operations_associate: {
    simulationId: "warehouse-receiving-v1",
    title: "Receive and inspect controlled stock",
    module: "warehouse",
    steps: [
      [
        "draft-saved",
        "Capture receipt evidence",
        "Record delivery and custody facts before stock can move to inspection.",
        decision(
          "A delivery states 10 serialized rings, but only 9 units are present and one carton is damaged.",
          "What should you record?",
          [
            choice(
              "record-actual",
              "Record 9 received, capture every serial, photograph the damage, and raise the variance",
              true,
              "Correct. Receiving records actual custody and preserves the discrepancy for independent disposition.",
            ),
            choice(
              "record-document",
              "Record 10 because that is the delivery quantity",
              false,
              "Recording the document quantity would overstate custody and corrupt serialized inventory.",
            ),
            choice(
              "reject-offline",
              "Refuse the delivery without creating an Intra record",
              false,
              "The discrepancy and custody event still require an attributable system record.",
            ),
          ],
        ),
      ],
      [
        "complete",
        "Submit for independent disposition",
        "Keep received stock unavailable until the required quality and putaway decisions are complete.",
        decision(
          "The nine captured units are pending inspection, and a requester asks for one urgently.",
          "What is the correct action?",
          [
            choice(
              "hold-for-quality",
              "Submit the receipt and keep all units unavailable for independent quality review",
              true,
              "Correct. Receiving does not grant quality disposition or release authority.",
            ),
            choice(
              "release-one",
              "Release one unit and inspect the rest later",
              false,
              "Pending-inspection stock cannot be allocated or released.",
            ),
            choice(
              "accept-all",
              "Mark every unit accepted because most cartons look intact",
              false,
              "The operator must not replace the independent inspection decision.",
            ),
          ],
        ),
      ],
    ],
  },
  operations_lead: {
    simulationId: "operations-exception-review-v1",
    title: "Review custody exceptions independently",
    module: "warehouse",
    steps: [
      [
        "review-custody-evidence",
        "Review custody evidence",
        "Evaluate the complete source record without changing the operator's observations.",
        decision(
          "A cycle count shows two missing units, but there is no recount and the counter asks you to correct the quantity directly.",
          "What should you do?",
          [
            choice(
              "return-recount",
              "Return the count for an independent recount and supporting evidence",
              true,
              "Correct. The source facts stay attributable and the variance is verified before adjustment.",
            ),
            choice(
              "edit-count",
              "Change the count to match the ledger",
              false,
              "Rewriting the observed count destroys the evidence needed to investigate the variance.",
            ),
            choice(
              "approve-loss",
              "Approve the loss immediately because two units is small",
              false,
              "Materiality does not remove evidence and approval controls.",
            ),
          ],
        ),
      ],
      [
        "record-independent-disposition",
        "Record an independent disposition",
        "Choose a controlled outcome with a reason, owner, and recovery route.",
        decision(
          "The recount confirms the shortage and identifies an unposted event transfer.",
          "Which disposition is appropriate?",
          [
            choice(
              "route-correction",
              "Return for a linked transfer correction, then re-evaluate the variance",
              true,
              "Correct. The known source transaction should be corrected before any write-off decision.",
            ),
            choice(
              "write-off",
              "Approve a write-off immediately",
              false,
              "A known unposted transfer is a correction issue, not evidence of loss.",
            ),
            choice(
              "delete-count",
              "Delete the count and start over",
              false,
              "The original count is part of the audit trail and must remain attributable.",
            ),
          ],
        ),
      ],
      [
        "review-procurement-handoff",
        "Review the Procurement handoff",
        "Verify the approved budget, DOA route, sourcing evidence, and vendor accreditation before Operations accepts custody.",
        decision(
          "A delivery is due today, but the handoff has no approved budget, DOA decision, sourcing evidence, or current vendor accreditation.",
          "What should the Operations Lead do?",
          [
            choice(
              "return-incomplete-handoff",
              "Return the handoff to Procurement and keep the delivery outside accepted stock custody",
              true,
              "Correct. Procurement must complete the budget, DOA, sourcing, and vendor-accreditation controls before Operations accepts custody.",
            ),
            choice(
              "receive-then-fix",
              "Receive the stock now and ask Procurement to complete the documents later",
              false,
              "Receiving first bypasses the governed Procurement-to-Operations handoff.",
            ),
            choice(
              "approve-procurement",
              "Approve the missing Procurement controls as Operations Lead",
              false,
              "Operations cannot replace Procurement, Finance, Legal, or DOA authority.",
            ),
          ],
        ),
      ],
      [
        "acknowledge-product-handoff",
        "Acknowledge the Product handoff",
        "Confirm Product's go-live decision while Operations records execution readiness and blockers.",
        decision(
          "Product has approved go-live with current evidence, but Operations finds that the fulfillment route is not ready.",
          "What is the correct handoff response?",
          [
            choice(
              "acknowledge-with-blocker",
              "Acknowledge Product's decision and record the operational blocker for resolution before execution",
              true,
              "Correct. Product owns go-live; Operations owns readiness and must make its blocker visible without silently overriding Product.",
            ),
            choice(
              "override-product",
              "Cancel Product's go-live decision",
              false,
              "Operations does not own Product's go-live authority.",
            ),
            choice(
              "ignore-route-risk",
              "Proceed because Product already approved go-live",
              false,
              "A go-live decision does not remove Operations' duty to report and resolve execution risk.",
            ),
          ],
        ),
      ],
    ],
  },
  procurement_lead: {
    simulationId: "procurement-evidence-routing-v1",
    title: "Validate sourcing evidence and route approval",
    module: "procurement",
    steps: [
      [
        "validate-sourcing-evidence",
        "Validate sourcing evidence",
        "Confirm that the sourcing pack supports the proposed award and policy route.",
        decision(
          "A high-value request names one preferred vendor but contains no comparison, exception basis, or active accreditation evidence.",
          "What should Procurement do?",
          [
            choice(
              "return-evidence",
              "Return the pack for competition or a documented exception and active accreditation",
              true,
              "Correct. Award routing starts only after required sourcing and vendor evidence is complete.",
            ),
            choice(
              "draft-po",
              "Draft the purchase order because the requester selected the vendor",
              false,
              "Requester preference is not sourcing evidence or approval authority.",
            ),
            choice(
              "split-order",
              "Split the order into smaller values",
              false,
              "Order splitting to avoid controls is prohibited.",
            ),
          ],
        ),
      ],
      [
        "route-independent-approval",
        "Route independent approval",
        "Use the effective DOA and preserve separation between preparation and decision.",
        decision(
          "The corrected pack exceeds the department head's temporary approval limit.",
          "Where should it go next?",
          [
            choice(
              "effective-doa",
              "Route it to the next effective DOA tier with the complete evidence pack",
              true,
              "Correct. Approval follows the effective authority configuration and recorded amount.",
            ),
            choice(
              "lower-amount",
              "Lower the recorded amount so the department head can approve",
              false,
              "Changing the amount to fit authority would falsify the governed record.",
            ),
            choice(
              "self-approve-procurement",
              "Approve it as Procurement because sourcing is complete",
              false,
              "Sourcing completion does not grant final spending authority.",
            ),
          ],
        ),
      ],
    ],
  },
  finance_controller: {
    simulationId: "finance-independent-review-v1",
    title: "Perform an independent finance review",
    module: "procurement",
    steps: [
      [
        "reconcile-source-evidence",
        "Reconcile source evidence",
        "Perform the three-way match against current authority and acceptance evidence.",
        decision(
          "The invoice bills 10 devices, the PO orders 10, but only 9 were received and accepted.",
          "What is Finance's correct response?",
          [
            choice(
              "hold-mismatch",
              "Place the invoice on hold and return the mismatch for resolution",
              true,
              "Correct. Payment must follow accepted quantity and resolved evidence.",
            ),
            choice(
              "pay-po",
              "Pay 10 because the PO was approved",
              false,
              "PO approval does not prove receipt and acceptance.",
            ),
            choice(
              "edit-receipt",
              "Change the receipt to 10 so the records match",
              false,
              "Finance must not rewrite warehouse custody evidence.",
            ),
          ],
        ),
      ],
      [
        "record-finance-decision",
        "Record the finance decision",
        "Make an attributable decision without preparing or rewriting the source pack.",
        decision(
          "The vendor issues a corrected invoice for 9 accepted units and all references now match.",
          "How should Finance close the review?",
          [
            choice(
              "approve-nine",
              "Approve the matched amount with the reconciliation evidence",
              true,
              "Correct. The payment decision is tied to the corrected, fully matched pack.",
            ),
            choice(
              "approve-original",
              "Approve the original amount to avoid payment delay",
              false,
              "The original mismatch remains unsupported and must not be paid.",
            ),
            choice(
              "delete-hold",
              "Delete the earlier hold record",
              false,
              "The hold and its resolution are part of the audit history.",
            ),
          ],
        ),
      ],
    ],
  },
  legal_compliance_lead: {
    simulationId: "legal-controlled-review-v1",
    title: "Review controlled legal evidence",
    module: "legal",
    steps: [
      [
        "validate-controlled-evidence",
        "Validate controlled evidence",
        "Confirm the applicant's current, signed, and applicable accreditation evidence.",
        decision(
          "A technology vendor submitted complete commercial documents, but its privacy evidence is expired and the service handles personal data.",
          "What should Legal do?",
          [
            choice(
              "request-current-privacy",
              "Request current privacy evidence and keep the case incomplete",
              true,
              "Correct. Conditional privacy requirements apply because the service handles personal data.",
            ),
            choice(
              "approve-commercial",
              "Approve because the commercial documents are complete",
              false,
              "Commercial completeness does not satisfy applicable privacy requirements.",
            ),
            choice(
              "replace-document",
              "Upload a template on the vendor's behalf",
              false,
              "Legal must not replace applicant-owned evidence.",
            ),
          ],
        ),
      ],
      [
        "record-legal-determination",
        "Record the legal determination",
        "Issue a reasoned decision while preserving applicant and reviewer ownership.",
        decision(
          "The vendor uploads current evidence, but the MNDA remains unsigned by its authorized signatory.",
          "Which outcome is correct?",
          [
            choice(
              "return-signature",
              "Return the case with the exact signature correction required",
              true,
              "Correct. The decision identifies the deficiency without altering vendor evidence.",
            ),
            choice(
              "sign-for-vendor",
              "Add the missing signature so review can finish",
              false,
              "A reviewer cannot execute the vendor's instrument.",
            ),
            choice(
              "approve-pending",
              "Approve now and collect the signature after onboarding",
              false,
              "A mandatory executed instrument cannot be deferred after approval.",
            ),
          ],
        ),
      ],
    ],
  },
  marketing_events_lead: {
    simulationId: "event-fulfillment-reconciliation-v1",
    title: "Plan and reconcile event fulfillment",
    module: "events",
    steps: [
      [
        "plan-event-fulfillment",
        "Plan event fulfillment",
        "Translate approved event demand into accountable stock and return expectations.",
        decision(
          "An event requests 50 giveaway items and 5 reusable display kits, but no custodian or return date is assigned.",
          "What should be completed before fulfillment?",
          [
            choice(
              "assign-custody",
              "Assign the custodian, issue quantities, event dates, and return expectations",
              true,
              "Correct. Consumables and reusable materials need explicit custody outcomes.",
            ),
            choice(
              "release-all",
              "Ask Warehouse to release everything and reconcile later",
              false,
              "Release without accountable custody creates an avoidable event variance.",
            ),
            choice(
              "mark-giveaway",
              "Classify all items as giveaways",
              false,
              "Reusable event materials must remain returnable inventory.",
            ),
          ],
        ),
      ],
      [
        "reconcile-event-custody",
        "Reconcile event custody",
        "Close only after sales, giveaways, returns, losses, and settlement agree.",
        decision(
          "After the event, 48 giveaways were issued, 2 remain, and only 4 of 5 display kits were returned.",
          "What is the correct closeout action?",
          [
            choice(
              "record-variance",
              "Return the two items, record the missing kit variance, and route investigation before closure",
              true,
              "Correct. Every outcome is recorded and the unresolved loss remains visible.",
            ),
            choice(
              "close-expected",
              "Close the event using the planned quantities",
              false,
              "Planned quantities cannot replace actual custody outcomes.",
            ),
            choice(
              "expense-kit",
              "Mark the missing kit as a giveaway",
              false,
              "Changing the classification would conceal the custody loss.",
            ),
          ],
        ),
      ],
    ],
  },
  product_owner: {
    simulationId: "product-governance-decision-v1",
    title: "Make an evidence-bound product decision",
    module: "product",
    steps: [
      [
        "review-launch-evidence",
        "Review launch evidence",
        "Evaluate launch readiness against the submitted version and independent evidence.",
        decision(
          "A product launch has approved pricing and inventory, but the required Operations readiness acknowledgement is missing.",
          "What should the Product Owner do?",
          [
            choice(
              "return-readiness",
              "Return the launch for the missing Operations acknowledgement",
              true,
              "Correct. Product owns the go-live decision but must rely on complete independent readiness evidence.",
            ),
            choice(
              "approve-anyway",
              "Approve because inventory is available",
              false,
              "Inventory alone does not prove operational readiness.",
            ),
            choice(
              "acknowledge-ops",
              "Record the Operations acknowledgement personally",
              false,
              "Product cannot act as the independent Operations owner.",
            ),
          ],
        ),
      ],
      [
        "record-product-decision",
        "Record the product decision",
        "Decide the submitted version without rewriting preparer-owned facts.",
        decision(
          "Operations supplies the missing acknowledgement, but the proposed effective date is already in the past.",
          "Which decision is appropriate?",
          [
            choice(
              "return-effective-date",
              "Return the version for a valid future effective date",
              true,
              "Correct. The approved version must have a controlled, usable effective date.",
            ),
            choice(
              "backdate",
              "Approve and backdate the decision",
              false,
              "Backdating weakens chronology and auditability.",
            ),
            choice(
              "edit-date",
              "Change the preparer's date and approve",
              false,
              "Return the submitted version rather than rewrite its evidence.",
            ),
          ],
        ),
      ],
    ],
  },
  leadership_insights: {
    simulationId: "leadership-indicator-review-v1",
    title: "Interpret and escalate decision indicators",
    module: "insights",
    steps: [
      [
        "interpret-indicator-freshness",
        "Interpret indicator freshness",
        "Validate whether the indicator is current and suitable for the decision at hand.",
        decision(
          "The dashboard shows a sharp inventory variance, but its last refresh was seven days ago and two source feeds are delayed.",
          "How should Leadership interpret it?",
          [
            choice(
              "qualify-indicator",
              "Treat it as a warning, disclose the stale sources, and request current validation",
              true,
              "Correct. A stale indicator can trigger investigation but not support a final decision.",
            ),
            choice(
              "approve-writeoff",
              "Use the chart to approve a stock write-off",
              false,
              "A KPI is not source evidence or approval authority.",
            ),
            choice(
              "ignore",
              "Ignore the variance because the data is stale",
              false,
              "Stale data still warrants an accountable follow-up.",
            ),
          ],
        ),
      ],
      [
        "route-accountable-follow-up",
        "Route accountable follow-up",
        "Send the investigation to the source owner without editing operational records.",
        decision(
          "Warehouse confirms one feed is missing an event transfer posted yesterday.",
          "What should Leadership do next?",
          [
            choice(
              "assign-source-owner",
              "Assign Warehouse to reconcile the source transaction and refresh the indicator",
              true,
              "Correct. The accountable owner fixes the source before the dashboard is relied upon.",
            ),
            choice(
              "edit-dashboard",
              "Manually change the dashboard value",
              false,
              "Presentation-layer edits would not correct the authoritative source.",
            ),
            choice(
              "close-alert",
              "Close the alert because the cause is known",
              false,
              "The issue remains open until the source is corrected and the indicator is refreshed.",
            ),
          ],
        ),
      ],
    ],
  },
  vendor_representative: {
    simulationId: "vendor-accreditation-submission-v1",
    title: "Prepare a complete accreditation submission",
    module: "core",
    steps: [
      [
        "prepare-accreditation-evidence",
        "Prepare accreditation evidence",
        "Assemble a current, consistent submission for the vendor organization.",
        decision(
          "Your company profile is complete, but the business registration has expired and the declared signatory differs from the attached authorization.",
          "What should you do before submitting?",
          [
            choice(
              "replace-and-align",
              "Upload the current registration and align the authorized signatory evidence",
              true,
              "Correct. Submitted evidence must be current and internally consistent.",
            ),
            choice(
              "submit-old",
              "Submit now and promise replacements by email",
              false,
              "Email promises do not satisfy required accreditation evidence.",
            ),
            choice(
              "change-review-status",
              "Mark the application reviewed so Legal sees it faster",
              false,
              "Vendors cannot change reviewer-owned status.",
            ),
          ],
        ),
      ],
      [
        "confirm-vendor-submission",
        "Confirm the vendor submission",
        "Make the final declaration and hand the version to independent review.",
        decision(
          "All required evidence is current, but one declaration is unanswered.",
          "How should you proceed?",
          [
            choice(
              "answer-declaration",
              "Answer the declaration truthfully, review the pack, and submit",
              true,
              "Correct. The submitted version is complete and ready for independent Legal review.",
            ),
            choice(
              "leave-blank",
              "Submit with the declaration blank",
              false,
              "A mandatory unanswered declaration makes the submission incomplete.",
            ),
            choice(
              "ask-legal-answer",
              "Ask Legal to complete the declaration for you",
              false,
              "Applicant declarations must remain vendor-owned and attributable.",
            ),
          ],
        ),
      ],
    ],
  },
} as const;

const rolePracticeTitle = (module: string, role: string): string => {
  if (module === "warehouse" && role === "warehouse_operator") {
    return "Receive and inspect controlled stock";
  }
  if (module === "core" && role === "vendor_portal") {
    return "Vendor accreditation submission practice";
  }
  const moduleLabel = module === "core" ? "Intra" : titleCaseIdentifier(module);
  return `${moduleLabel} ${titleCaseIdentifier(role)} guided practice`;
};

const roleDefinitions = Object.values(
  roleCapabilities.reduce<
    Record<
      string,
      { module: LearningCapability["module"]; role: string; personaId: string }
    >
  >((roles, grant) => {
    const key = `${grant.module}:${grant.role}`;
    const personaId = ROLE_PERSONAS[key];
    if (!personaId) {
      throw new Error(
        `Missing canonical persona mapping for RBAC role ${key}.`,
      );
    }
    roles[key] ??= { module: grant.module, role: grant.role, personaId };
    return roles;
  }, {}),
);

const capabilityRequirements = roleDefinitions.flatMap((roleDefinition) => {
  const capabilities = roleCapabilities
    .filter(
      (grant) =>
        grant.module === roleDefinition.module &&
        grant.role === roleDefinition.role,
    )
    .filter(
      (grant) =>
        capabilityClassificationByKey.get(`${grant.module}:${grant.cap}`)
          ?.access === "mutation",
    )
    .map((grant) => ({ module: grant.module, capability: grant.cap }));
  if (capabilities.length === 0) return [];

  const audience = audienceForPersona(roleDefinition.personaId);
  const id = `${audience}.role.${roleDefinition.module}.${roleDefinition.role}.capability-practice.v1`;
  const simulationId =
    ROLE_PRACTICE_CONTENT[
      roleDefinition.personaId as keyof typeof ROLE_PRACTICE_CONTENT
    ].simulationId;
  const prerequisiteIds = [
    `${audience}.${roleDefinition.personaId}.orientation.v1`,
    ...(roleDefinition.module === "warehouse" &&
    roleDefinition.role === "warehouse_operator"
      ? [WAREHOUSE_RECEIVING_POLICY_ID, WAREHOUSE_RECEIVING_ASSESSMENT_ID]
      : []),
    ...(roleDefinition.module === "core" &&
    roleDefinition.role === "vendor_portal"
      ? [VENDOR_EVIDENCE_REQUIREMENT_ID]
      : []),
  ];
  return [
    {
      id,
      version: 1,
      audience,
      kind: "scenario",
      title: rolePracticeTitle(roleDefinition.module, roleDefinition.role),
      mandatory: true,
      prerequisiteIds,
      capabilityOutcomes: capabilities,
      simulationId,
    } satisfies RequirementDefinition,
  ];
});

const personaPracticeRequirements: readonly RequirementDefinition[] =
  OPERATING_PERSONA_IDS.map((personaId) => {
    const audience = audienceForPersona(personaId);
    return {
      id: `${audience}.${personaId}.guided-practice.v1`,
      version: 1,
      audience,
      kind: "scenario",
      title:
        ROLE_PRACTICE_CONTENT[personaId as keyof typeof ROLE_PRACTICE_CONTENT]
          .title,
      mandatory: true,
      prerequisiteIds: [`${audience}.${personaId}.orientation.v1`],
      capabilityOutcomes: [],
      simulationId:
        ROLE_PRACTICE_CONTENT[personaId as keyof typeof ROLE_PRACTICE_CONTENT]
          .simulationId,
    } satisfies RequirementDefinition;
  });

const grantedMutationKeys = new Set(
  roleCapabilities
    .filter(
      (grant) =>
        capabilityClassificationByKey.get(`${grant.module}:${grant.cap}`)
          ?.access === "mutation",
    )
    .map((grant) => `${grant.module}:${grant.cap}`),
);

const unassignedCapabilityRequirements = MUTATING_CAPABILITIES.filter(
  (capability) => !grantedMutationKeys.has(capabilityKey(capability)),
).map((capability) => {
  const id = `internal.unassigned.${capability.module}.${capability.capability}.capability-practice.v1`;
  return {
    id,
    version: 1,
    audience: "internal",
    kind: "scenario",
    title: `${titleCaseIdentifier(capability.module)} ${titleCaseIdentifier(capability.capability)} capability coverage`,
    mandatory: true,
    prerequisiteIds: [],
    capabilityOutcomes: [capability],
  } satisfies RequirementDefinition;
});

const requirements: readonly RequirementDefinition[] = [
  ...baselineRequirements,
  ...vendorJourneyRequirements,
  ...warehouseReceivingRequirements,
  ...capabilityRequirements,
  ...personaPracticeRequirements,
  ...unassignedCapabilityRequirements,
];

const curricula: readonly CurriculumDefinition[] = OPERATING_PERSONA_IDS.map(
  (personaId) => {
    const audience =
      personaId === "vendor_representative" ? "vendor" : "internal";
    const prefix = audience === "vendor" ? "vendor" : "internal";
    return {
      id: `${prefix}.${personaId}.baseline.v1`,
      version: 1,
      personaId,
      audience,
      requirementIds: [`${prefix}.${personaId}.orientation.v1`],
    };
  },
);

export const ROLE_CURRICULA: readonly RoleCurriculumDefinition[] =
  roleDefinitions.map((roleDefinition) => {
    const audience = audienceForPersona(roleDefinition.personaId);
    const capabilityRequirementId = `${audience}.role.${roleDefinition.module}.${roleDefinition.role}.capability-practice.v1`;
    const personaPracticeRequirementId = `${audience}.${roleDefinition.personaId}.guided-practice.v1`;
    const hasCapabilityPractice = requirements.some(
      (requirement) => requirement.id === capabilityRequirementId,
    );
    return {
      id: `${audience}.role.${roleDefinition.module}.${roleDefinition.role}.v1`,
      version: 1,
      personaId: roleDefinition.personaId,
      audience,
      module: roleDefinition.module,
      role: roleDefinition.role,
      requirementIds: [
        `${audience}.${roleDefinition.personaId}.orientation.v1`,
        ...(roleDefinition.module === "warehouse" &&
        roleDefinition.role === "warehouse_operator"
          ? [WAREHOUSE_RECEIVING_POLICY_ID, WAREHOUSE_RECEIVING_ASSESSMENT_ID]
          : []),
        ...(roleDefinition.module === "core" &&
        roleDefinition.role === "vendor_portal"
          ? [VENDOR_EVIDENCE_REQUIREMENT_ID]
          : []),
        ...(hasCapabilityPractice ? [capabilityRequirementId] : []),
        ...(!hasCapabilityPractice &&
        requirements.some(
          (requirement) => requirement.id === personaPracticeRequirementId,
        )
          ? [personaPracticeRequirementId]
          : []),
      ],
    };
  });

export const CAPABILITY_COVERAGE_CURRICULA: readonly CurriculumDefinition[] =
  unassignedCapabilityRequirements.map((requirement) => ({
    id: requirement.id.replace(".capability-practice", ""),
    version: 1,
    personaId: "capability_coverage",
    audience: requirement.audience,
    requirementIds: [requirement.id],
  }));

const orientationSimulations: readonly SimulationDefinition[] =
  baselineRequirements.map((requirement) => ({
    id: requirement.simulationId!,
    version: 1,
    audience: requirement.audience,
    module: "core",
    title: requirement.title,
    checkpointIds: ["complete"],
    capabilityOutcomes: [],
  }));

const rolePractices = OPERATING_PERSONA_IDS.map((personaId) => {
  const content =
    ROLE_PRACTICE_CONTENT[personaId as keyof typeof ROLE_PRACTICE_CONTENT];
  const capabilityOutcomes = capabilityRequirements
    .filter((requirement) => requirement.simulationId === content.simulationId)
    .flatMap((requirement) => requirement.capabilityOutcomes)
    .filter(
      (capability, index, all) =>
        all.findIndex(
          (candidate) => capabilityKey(candidate) === capabilityKey(capability),
        ) === index,
    );
  const simulation: SimulationDefinition = {
    id: content.simulationId,
    version: 1,
    audience: audienceForPersona(personaId),
    module: content.module,
    title: content.title,
    checkpointIds: content.steps.map(([checkpointId]) => checkpointId),
    capabilityOutcomes,
    embeddedSteps: content.steps.map(
      ([checkpointId, title, instruction, decision]) => ({
        checkpointId,
        title,
        instruction,
        outcomeId: checkpointId,
        ...decision,
      }),
    ),
  };
  return { personaId, simulation };
});

const simulations: readonly SimulationDefinition[] = [
  ...orientationSimulations,
  ...rolePractices.map((practice) => practice.simulation),
];

export const LEARNING_CATALOG = {
  curricula,
  roleCurricula: ROLE_CURRICULA,
  capabilityCoverageCurricula: CAPABILITY_COVERAGE_CURRICULA,
  requirements,
  simulations,
  rolePractices,
} as const;

export function simulationForRequirement(
  requirement: RequirementDefinition,
): SimulationDefinition | undefined {
  if (!requirement.simulationId) return undefined;
  return LEARNING_CATALOG.simulations.find(
    (simulation) => simulation.id === requirement.simulationId,
  );
}

export function supportsEmbeddedTraining(
  requirement: RequirementDefinition,
): boolean {
  if (
    requirement.kind === "orientation" &&
    requirement.capabilityOutcomes.length === 0
  )
    return true;
  return Boolean(simulationForRequirement(requirement)?.embeddedSteps?.length);
}

export function roleCurriculumFor(
  module: LearningCapability["module"],
  role: string,
): RoleCurriculumDefinition | undefined {
  return ROLE_CURRICULA.find(
    (curriculum) => curriculum.module === module && curriculum.role === role,
  );
}

export function requiredCurriculaFor(
  capability: LearningCapability,
): readonly CurriculumDefinition[] {
  const requirementIds = new Set(
    LEARNING_CATALOG.requirements
      .filter(
        (requirement) =>
          requirement.mandatory &&
          requirement.capabilityOutcomes.some(
            (outcome) => capabilityKey(outcome) === capabilityKey(capability),
          ),
      )
      .map((requirement) => requirement.id),
  );

  return [
    ...LEARNING_CATALOG.curricula,
    ...ROLE_CURRICULA,
    ...CAPABILITY_COVERAGE_CURRICULA,
  ].filter((curriculum) =>
    curriculum.requirementIds.some((id) => requirementIds.has(id)),
  );
}

export function internalRequirementIds(): readonly string[] {
  return LEARNING_CATALOG.requirements
    .filter((requirement) => requirement.audience === "internal")
    .map((requirement) => requirement.id);
}

export function vendorRequirementIds(): readonly string[] {
  return LEARNING_CATALOG.requirements
    .filter((requirement) => requirement.audience === "vendor")
    .map((requirement) => requirement.id);
}
