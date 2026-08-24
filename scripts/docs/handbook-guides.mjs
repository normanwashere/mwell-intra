import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HANDBOOK_DOCUMENTS } from "./handbook-catalog.mjs";
import { EVIDENCE_APPROVAL_CONTRACT } from "./handbook-evidence-approval.mjs";
import {
  HANDBOOK_STAGE_CONTRACTS,
  ROLE_SIMULATION_STAGE_CONTRACTS,
  ROLE_SIMULATION_CONTRACTS,
} from "./handbook-stage-contracts.mjs";
import { validateAttestation } from "./verify-handbook-ci-attestation.mjs";

export { HANDBOOK_STAGE_CONTRACTS, ROLE_SIMULATION_STAGE_CONTRACTS, ROLE_SIMULATION_CONTRACTS };
export { EVIDENCE_APPROVAL_CONTRACT };

const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const OWNER = "Mwell Intra Product and Operations";
const EFFECTIVE_DATE = "2026-08-24";
const APPLICABLE_BUILD = "2026-08-23 UAT baseline";
const EVIDENCE_MANIFEST_PATH = path.join(
  root,
  "docs/manual/assets/knowledge-base/task-stage-evidence.json",
);
const CI_ATTESTATION_CONTRACT_PATH = path.join(
  root,
  "docs/manual/assets/knowledge-base/task-stage-ci-attestation.json",
);
const EVIDENCE_MANIFEST = existsSync(EVIDENCE_MANIFEST_PATH)
  ? JSON.parse(readFileSync(EVIDENCE_MANIFEST_PATH, "utf8"))
  : { schemaVersion: 1, stages: [] };
export { EVIDENCE_MANIFEST };
const CI_ATTESTATION_CONTRACT = JSON.parse(readFileSync(CI_ATTESTATION_CONTRACT_PATH, "utf8"));
export { CI_ATTESTATION_CONTRACT };
const EVIDENCE_BY_BINDING = new Map(
  (EVIDENCE_MANIFEST.stages ?? []).map((contract) => [contract.bindingId, contract]),
);

const TASK_FIELDS = [
  "id", "outcome", "summary", "participatingRoles", "module",
  "startCondition", "requiredAccess", "inputsAndEvidence", "steps",
  "decisionPoints", "denialChecks", "recovery", "handoff",
  "completionCriteria", "completionEvidence", "governingSources",
  "relatedTasks", "keywords", "owner", "effectiveDate",
  "lastReviewedDate", "applicableBuild", "status", "availability",
];

const ROLE_FIELDS = [
  "id", "canonicalName", "displayedAliases", "purpose",
  "departmentAndScope", "assignmentOwner", "requiredAccess",
  "workQueueOrStartConditions", "linkedTasks", "permittedActions",
  "prohibitedActions", "authorityLimits", "handoffs", "denialChecks",
  "escalationAndRecovery", "evidenceResponsibilities", "trainingReadiness",
  "governingSources", "owner", "effectiveDate", "lastReviewedDate",
  "applicableBuild", "status", "availability", "workspaceMap",
  "guidedSimulation",
];

const TASK_STAGE_FIELDS = [
  "id", "label", "performingRole", "module", "route", "instruction",
  "screenshot", "expectedResult", "dataRead", "dataWritten",
  "evidenceRetained", "nextHandoff",
];

const TASK_DECISION_FIELDS = [
  "id", "placement", "ownerRole", "question", "yesBranch", "noBranch",
];
const TASK_DECISION_PLACEMENT_FIELDS = ["position", "stageId"];
const TASK_DECISION_BRANCH_FIELDS = [
  "label", "condition", "target", "outcome", "recoveryAction", "terminal",
];
const TASK_DECISION_TARGET_FIELDS = ["type", "id"];
const TASK_DECISION_OUTCOMES = new Set([
  "completion", "rejection", "cancellation", "escalation", "controlled-hold",
]);

const ROLE_WORKSPACE_FIELDS = ["id", "module", "landingRoute"];
const ROLE_SIMULATION_FIELDS = [
  "id", "title", "linkedTaskId", "linkedStageId", "startRoute",
  "workspaceId", "actorRole", "mode", "scenario", "successCriteria",
  "negativeScenario", "recovery",
];

const PRESENTATION_PURPOSES = new Set([
  "canonical-guide-body",
  "policy-basis",
  "system-record",
  "downloadable-resource",
  "governed-reference",
  "role-summary",
]);

const TASK_SECTION_IDS = [
  "outcome",
  "flow",
  "who-is-involved",
  "before-you-start",
  "steps",
  "decisions-and-exceptions",
  "completion-checklist",
  "related-tasks",
  "policy-basis",
  "document-controls",
];

const ROLE_SECTION_IDS = [
  "role-purpose-and-department",
  "your-workspace",
  "work-queue-and-priorities",
  "permitted-actions",
  "decisions-and-approval-authority",
  "prohibited-actions",
  "handoffs-received-and-sent",
  "guided-simulation",
  "negative-and-recovery-scenario",
  "escalation-and-support",
  "completion-evidence-and-training-sign-off",
  "capability-codes-and-document-controls",
];

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function section(id, source, heading, purpose = "canonical-guide-body") {
  return { id, source, heading, purpose };
}

function guideSections(ids) {
  return ids.map((id) => ({ id }));
}

function unique(values) {
  return [...new Set(values)];
}

export const HANDBOOK_MODES = deepFreeze([
  {
    id: "home",
    label: "Home",
    summary: "Find an outcome, role, or specialist guide.",
    order: 1,
  },
  {
    id: "tasks",
    label: "Tasks",
    summary: "Complete implemented operational journeys end to end.",
    order: 2,
  },
  {
    id: "roles",
    label: "Roles",
    summary: "Understand persona workspaces, authority, and handoffs.",
    order: 3,
  },
  {
    id: "system",
    label: "System",
    summary: "Manage, govern, support, and release Mwell Intra.",
    order: 4,
  },
]);

const TASK_DEFINITIONS = [
  {
    id: "procurement-request-approval",
    title: "Create and approve a procurement request",
    outcome: "An approved, policy-routed procurement request is ready for sourcing or purchase-order processing.",
    summary: "Create a request, resolve validation, complete approval routing, and retain the decision evidence.",
    roles: ["general_employee", "operations_lead", "procurement_lead", "finance_controller"],
    module: "Procurement",
    start: "A requester has a defined business need, department, budget context, and supporting evidence.",
    access: ["Procurement requester access", "Department approval access where assigned"],
    inputs: ["Business justification", "Line items and estimates", "Required attachments", "Department and cost context"],
    steps: ["Create and validate the request", "Submit for the derived route", "Complete each approval handoff", "Open the governed purchase-order handoff"],
    decisions: ["Is the request complete and eligible?", "Does the route require correction, competition, exception, or escalation?", "Has every required approver decided?"],
    denial: ["A requester cannot approve their own request", "Missing route evidence blocks progression"],
    recovery: "Correct the rejected or stale record, retain the reason, and resubmit through the current effective route.",
    handoff: "The accountable closer hands the approved request to Procurement for sourcing or purchase-order execution.",
    completion: ["Approved status is visible", "The effective approval route is retained", "No required decision remains pending"],
    evidence: ["Request identifier", "Approval decisions", "Attachments and route evidence"],
    related: ["vendor-accreditation-renewal", "department-doa-activation", "stock-receiving-putaway", "finance-readiness-evidence"],
    keywords: ["procurement", "request", "approval", "route", "purchase order"],
    sources: [
      section("procure-to-payment", "docs/manual/MWELL_INTRA_USER_MANUAL.md", "Procurement to Payment"),
      section("procurement-policy-extract", "docs/PROCESS_REFERENCE_LIBRARY.md", "Procurement Policy Operating Extract", "policy-basis"),
      section("canonical-procurement-spine", "docs/policy/MWELL_CANONICAL_POLICY_ALIGNMENT.md", "Canonical 13-Step Spine", "policy-basis"),
    ],
    screenshots: [
      "docs/manual/assets/knowledge-base/flowchart-procure-to-pay-desktop.png",
      "docs/manual/assets/live-20260711/06-procurement-request-mobile-320.png",
      "docs/manual/assets/live-20260711/07-procurement-created-desktop.png",
    ],
  },
  {
    id: "vendor-accreditation-renewal",
    title: "Accredit or renew a vendor",
    outcome: "A vendor has a governed accreditation decision with current evidence and an explicit next action.",
    summary: "Invite a vendor, collect the correct evidence branch, review declarations, and decide accreditation or renewal.",
    roles: ["legal_compliance_lead", "vendor_representative", "procurement_lead"],
    module: "Legal and Vendor Portal",
    start: "A legitimate vendor engagement or renewal need has been identified.",
    access: ["Legal accreditation access", "Vendor portal invitation"],
    inputs: ["Vendor identity", "Entity evidence", "Declarations", "Technology-provider evidence when applicable"],
    steps: ["Create or verify the vendor invitation", "Submit the applicable evidence branch", "Review declarations and qualifications", "Record the accreditation decision"],
    decisions: ["Is this a new application or renewal?", "Which entity and technology evidence branch applies?", "Is correction, rejection, expiry, or approval required?"],
    denial: ["A vendor cannot review another vendor's case", "Incomplete declarations cannot be approved"],
    recovery: "Return the case with specific missing evidence, then resume review against the retained application.",
    handoff: "Legal and Compliance makes the accreditation decision and exposes the current vendor state to Procurement.",
    completion: ["Decision and validity are visible", "Evidence is retained", "Procurement can verify current eligibility"],
    evidence: ["Case identifier", "Submitted files and declarations", "Reviewer decision and validity dates"],
    related: ["procurement-request-approval"],
    keywords: ["vendor", "accreditation", "renewal", "legal", "compliance"],
    sources: [
      section("vendor-accreditation", "docs/manual/MWELL_INTRA_USER_MANUAL.md", "Vendor Accreditation"),
      section("vendor-operating-extract", "docs/PROCESS_REFERENCE_LIBRARY.md", "LGL004 Vendor Accreditation Operating Extract", "policy-basis"),
      section("vendor-control-matrix", "docs/policy/VENDOR_TO_PAY_CONTROL_MATRIX.md", "Vendor accreditation controls", "policy-basis"),
    ],
    screenshots: [
      "docs/manual/assets/live-20260711/08-legal-cases-desktop.png",
      "docs/manual/assets/live-20260711/09-legal-invite-mobile.png",
      "docs/manual/assets/live-20260711/10-vendor-portal-mobile.png",
    ],
  },
  {
    id: "warehouse-location-bin-setup",
    title: "Create warehouse locations and bins",
    outcome: "Active warehouse locations and bins are ready for governed stock movement.",
    summary: "Create the physical storage hierarchy and verify identifiers before stock is received.",
    roles: ["operations_lead", "operations_associate"],
    module: "Warehouse",
    start: "A warehouse or storage area has been approved for operational use.",
    access: ["Warehouse setup administration"],
    inputs: ["Location codes", "Bin labels", "Storage attributes", "Import template when used"],
    steps: ["Define the scannable storage bin", "Create or import warehouse locations", "Validate the active operation route", "Confirm availability for receiving"],
    decisions: ["Should setup be manual or imported?", "Are codes unique and correctly scoped?"],
    denial: ["Duplicate or cross-warehouse identifiers are rejected"],
    recovery: "Correct the invalid hierarchy or template row and rerun validation before activation.",
    handoff: "Operations Lead makes the validated storage structure available to receiving operators.",
    completion: ["Locations and bins are active", "Identifiers are unique", "Receiving can select the destination"],
    evidence: ["Location and bin records", "Import validation result when applicable"],
    related: ["stock-receiving-putaway", "imports"],
    keywords: ["warehouse", "location", "bin", "storage", "import"],
    sources: [
      section("setup-and-bins", "docs/manual/MWELL_INTRA_USER_MANUAL.md", "Setup and Bins"),
      section("warehouse-location-import", "docs/import-templates/warehouse-locations-bins-v1.csv", null, "downloadable-resource"),
    ],
    screenshots: [],
  },
  {
    id: "stock-receiving-putaway",
    title: "Receive, inspect, and put away stock",
    outcome: "Accepted stock is posted to the correct location and any exception remains visibly controlled.",
    summary: "Receive against authority, inspect quality, post the ledger movement, and complete putaway.",
    roles: ["operations_associate", "operations_lead", "procurement_lead"],
    module: "Warehouse",
    start: "An eligible purchase order or governed inbound record is ready for physical receipt.",
    access: ["Warehouse receiving access", "Supervisor disposition access for exceptions"],
    inputs: ["Purchase order", "Delivery records", "Counts", "Inspection and discrepancy evidence"],
    steps: ["Verify inbound authority", "Record physical receipt", "Inspect and classify exceptions", "Post stock and complete putaway"],
    decisions: ["Does delivered stock match the authorized inbound record?", "Is stock accepted, held, rejected, or returned?", "Is supervisor disposition required?"],
    denial: ["Procurement cannot post physical receipt", "Duplicate receipt posting is denied"],
    recovery: "Retain the discrepancy, correct the receipt or obtain supervisor disposition, and resume from the controlled state.",
    handoff: "The receiving operator hands exceptions to the Operations Lead and accepted stock to inventory custody.",
    completion: ["Receipt and ledger movement are posted", "Putaway location is visible", "Exceptions have an owner and disposition"],
    evidence: ["Receipt identifier", "Inspection result", "Movement ledger entry", "Putaway destination"],
    related: ["warehouse-location-bin-setup", "returns-replacements-refunds-rma", "inventory-count-variance"],
    keywords: ["warehouse", "receive", "inspect", "putaway", "quality"],
    sources: [
      section("receiving-putaway", "docs/manual/MWELL_INTRA_USER_MANUAL.md", "Receiving and Putaway"),
      section("receiving-contract", "docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md", "Receiving", "system-record"),
      section("receiving-quality-rma", "docs/PROCESS_REFERENCE_LIBRARY.md", "Receiving, quality and RMA", "policy-basis"),
    ],
    screenshots: [
      "docs/manual/assets/knowledge-base/flowchart-receive-to-putaway-mobile.png",
      "docs/manual/assets/knowledge-base/step-receiving-desktop.png",
      "docs/manual/assets/knowledge-base/step-receiving-mobile.png",
    ],
  },
  {
    id: "ecommerce-order-intake",
    title: "Import or create ecommerce orders",
    outcome: "Validated ecommerce orders are available for governed fulfillment without duplicate intake.",
    summary: "Create or import orders, validate products and quantities, and resolve duplicates or malformed rows.",
    roles: ["operations_associate", "operations_lead"],
    module: "Warehouse Ecommerce",
    start: "A customer order or governed tracker extract is ready for intake.",
    access: ["Ecommerce order intake access"],
    inputs: ["Order identifier", "Customer delivery data", "Product lines", "Import evidence"],
    steps: ["Choose manual or import intake", "Validate order and line data", "Resolve duplicates and invalid products", "Confirm the fulfillment queue entry"],
    decisions: ["Is the order new, duplicate, or corrective?", "Are products and quantities fulfillable?"],
    denial: ["Duplicate external order identifiers are denied", "Invalid products cannot enter fulfillment"],
    recovery: "Correct rejected rows or the source order, then retry with the same governed external identity.",
    handoff: "Validated orders enter the warehouse fulfillment queue.",
    completion: ["Order is visible once", "Lines are validated", "Fulfillment owns the next action"],
    evidence: ["Order identifier", "Intake result", "Rejected-row evidence when applicable"],
    related: ["ecommerce-fulfillment-delivery"],
    keywords: ["ecommerce", "order", "import", "intake", "duplicate"],
    sources: [
      section("ecommerce-fulfillment", "docs/manual/MWELL_INTRA_USER_MANUAL.md", "Ecommerce Fulfillment"),
      section("ecommerce-order-intake-contract", "docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md", "Ecommerce order intake", "system-record"),
      section("tracker-mapping", "docs/PROCESS_REFERENCE_LIBRARY.md", "Ecommerce Tracker-to-Intra Mapping", "governed-reference"),
    ],
    screenshots: [],
  },
  {
    id: "ecommerce-fulfillment-delivery",
    title: "Pick, pack, dispatch, and confirm delivery",
    outcome: "The correct order is dispatched and delivery completion is recorded with retained evidence.",
    summary: "Move a validated ecommerce order through picking, packing, dispatch, and delivery confirmation.",
    roles: ["operations_associate", "operations_lead"],
    module: "Warehouse Ecommerce",
    start: "A validated order is queued and stock is available for allocation.",
    access: ["Warehouse fulfillment access"],
    inputs: ["Validated order", "Allocated stock", "Packing and carrier details", "Delivery evidence"],
    steps: ["Allocate and pick stock", "Validate and pack the order", "Record dispatch", "Confirm delivery or route an exception"],
    decisions: ["Is stock sufficient and releasable?", "Did packing validation pass?", "Was delivery completed, failed, or returned?"],
    denial: ["Held or unavailable stock cannot be picked", "Dispatch cannot bypass packing validation"],
    recovery: "Release invalid allocation, correct the order or package, and resume from the last retained state.",
    handoff: "Warehouse hands the dispatched package to the carrier and retains delivery or failure evidence.",
    completion: ["Delivery status is terminal", "Stock movement is reconciled", "Evidence is retained"],
    evidence: ["Pick and pack records", "Dispatch record", "Delivery confirmation or failure reason"],
    related: ["ecommerce-order-intake", "returns-replacements-refunds-rma"],
    keywords: ["pick", "pack", "dispatch", "delivery", "ecommerce"],
    sources: [
      section("pick-pack-dispatch", "docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md", "Pick, pack, and dispatch"),
      section("fulfillment-drill", "docs/USER_TRAINING_AND_OPERATIONS_MANUAL.md", "Ecommerce Fulfillment Drill", "role-summary"),
    ],
    screenshots: [],
  },
  {
    id: "returns-replacements-refunds-rma",
    title: "Process a return, replacement, refund, or supplier RMA",
    outcome: "Returned stock and the associated customer or supplier resolution are reconciled to the original release.",
    summary: "Validate the original release, inspect returned stock, and complete the correct customer or supplier branch.",
    roles: ["operations_associate", "operations_lead", "procurement_lead", "finance_controller"],
    module: "Warehouse",
    start: "A customer return, replacement, refund request, or supplier quality return has been raised.",
    access: ["Warehouse returns access", "Supervisor or Finance decision access where required"],
    inputs: ["Original release", "Returned stock", "Reason and inspection evidence", "Customer or supplier resolution"],
    steps: ["Match the original release", "Receive and inspect the return", "Choose the governed resolution branch", "Post and confirm the final disposition"],
    decisions: ["Does the return match an original release?", "Is stock reusable, held, written off, refunded, replaced, or sent by RMA?"],
    denial: ["Unmatched returns cannot post reusable stock", "Refund or write-off authority cannot be bypassed"],
    recovery: "Hold unmatched stock, obtain the missing source record or authority, and resume without duplicating movements.",
    handoff: "Warehouse retains physical custody while the accountable commercial owner completes the selected resolution.",
    completion: ["Original and reverse movements reconcile", "Disposition is terminal", "Commercial evidence is retained"],
    evidence: ["Return identifier", "Original release link", "Inspection", "Disposition and financial evidence"],
    related: ["ecommerce-fulfillment-delivery", "stock-receiving-putaway"],
    keywords: ["return", "replacement", "refund", "RMA", "reconcile"],
    sources: [
      section("returns-replacements", "docs/manual/MWELL_INTRA_USER_MANUAL.md", "Returns and Replacements"),
      section("returns-contract", "docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md", "Returns", "system-record"),
      section("returns-drill", "docs/USER_TRAINING_AND_OPERATIONS_MANUAL.md", "Returns Drill", "role-summary"),
    ],
    screenshots: [],
  },
  {
    id: "department-inventory-release",
    title: "Request and release department inventory",
    outcome: "Department inventory is released to an authorized recipient with custody evidence and no unfinished allocation.",
    summary: "Request department stock, approve where required, release it from Warehouse, and retain recipient evidence.",
    roles: ["general_employee", "operations_lead"],
    module: "Warehouse",
    start: "A department has an approved operational need for available stock.",
    access: ["Business-unit request access", "Warehouse allocation and release access"],
    inputs: ["Department request", "Stock lines", "Recipient", "Approval evidence where required"],
    steps: ["Create the department request", "Validate authority and availability", "Allocate and release stock", "Confirm recipient custody"],
    decisions: ["Is department authority sufficient?", "Is releasable stock available?", "Was custody accepted?"],
    denial: ["A requester cannot release stock", "Held or unavailable stock cannot be allocated"],
    recovery: "Correct authority or quantity, release invalid allocation, and requeue the request with its evidence.",
    handoff: "Warehouse hands physical custody to the named department recipient.",
    completion: ["Release is posted", "Recipient and department are visible", "No stale allocation remains"],
    evidence: ["Request and release identifiers", "Approval where required", "Recipient confirmation"],
    related: ["event-stock-custody", "inventory-count-variance"],
    keywords: ["department", "inventory", "request", "release", "allocation"],
    sources: [
      section("inventory-release", "docs/manual/MWELL_INTRA_USER_MANUAL.md", "Inventory Release"),
      section("allocation-events-returns", "docs/manual/MWELL_INTRA_USER_MANUAL.md", "Allocation, Events, and Returns"),
    ],
    screenshots: [],
  },
  {
    id: "event-stock-custody",
    title: "Transfer, use, return, and reconcile event stock",
    outcome: "Event stock is fully reconciled across transfer, use, return, and final custody.",
    summary: "Coordinate event demand, warehouse transfer, event custody, returns, and variance resolution.",
    roles: ["general_employee", "marketing_events_lead", "operations_associate", "finance_controller"],
    module: "Events and Warehouse",
    start: "An approved event requires stock from Warehouse.",
    access: ["Events request or coordination access", "Warehouse event custody access"],
    inputs: ["Event record", "Requested stock", "Custodian", "Use and return evidence"],
    steps: ["Create and approve the event need", "Transfer stock to event custody", "Record use and return", "Reconcile quantity and disposition"],
    decisions: ["Is the event authorized?", "Was stock used, returned, damaged, lost, or unresolved?"],
    denial: ["View-only roles cannot mutate event custody", "Duplicate event requests are denied"],
    recovery: "Retain unresolved custody, correct stale or duplicate data, and escalate any variance before closure.",
    handoff: "Marketing and Events accepts custody from Warehouse, submits reconciled outcomes, and hands the completed settlement evidence to Finance for independent approval.",
    completion: ["All issued quantities have a terminal disposition", "Custody handoffs are visible", "Variance has an owner"],
    evidence: ["Event and allocation identifiers", "Custody handoffs", "Use, return, and variance evidence"],
    related: ["department-inventory-release", "inventory-count-variance"],
    keywords: ["event", "stock", "custody", "transfer", "return"],
    sources: [
      section("event-custody", "docs/manual/MWELL_INTRA_USER_MANUAL.md", "Event Custody"),
      section("event-role-procedures", "docs/manual/MWELL_INTRA_USER_MANUAL.md", "Allocation, Events, and Returns"),
    ],
    screenshots: [],
  },
  {
    id: "inventory-count-variance",
    title: "Count inventory and resolve a variance",
    outcome: "The count is approved or corrected and every posted variance has governed evidence.",
    summary: "Perform a count, compare expected and observed stock, route variance authority, and post the controlled result.",
    roles: ["operations_associate", "operations_lead", "finance_controller"],
    module: "Warehouse",
    start: "A scheduled or exception count is ready and stock movement is controlled for the count scope.",
    access: ["Warehouse count access", "Supervisor variance authority"],
    inputs: ["Count scope", "Observed quantities", "Variance reason", "Approval and Finance evidence where applicable"],
    steps: ["Define scope and begin the count", "Submit observed quantities", "Review and decide the variance", "Post or correct the approved result"],
    decisions: ["Does observed stock match the position?", "Is recount, rejection, supervisor approval, or Finance review required?"],
    denial: ["The counter cannot self-approve a governed variance", "Negative-stock outcomes are denied"],
    recovery: "Recount or correct the evidence, retain the rejection reason, and resubmit without overwriting history.",
    handoff: "The counter hands variance evidence to the Operations Lead, who closes or escalates the controlled adjustment.",
    completion: ["Count is terminal", "Approved movement is posted once", "Variance evidence and owner are visible"],
    evidence: ["Count record", "Observed quantities", "Decision", "Movement ledger entry"],
    related: ["stock-receiving-putaway", "department-inventory-release", "event-stock-custody", "finance-readiness-evidence"],
    keywords: ["inventory", "count", "variance", "recount", "adjustment"],
    sources: [
      section("inventory-integrity", "docs/manual/MWELL_INTRA_USER_MANUAL.md", "Inventory Integrity"),
      section("counts-adjustments", "docs/manual/MWELL_INTRA_USER_MANUAL.md", "Counts and Adjustments"),
      section("warehouse-control-model", "docs/policy/VENDOR_TO_PAY_CONTROL_MATRIX.md", "Two-person Warehouse control model", "policy-basis"),
    ],
    screenshots: [],
  },
  {
    id: "department-doa-activation",
    title: "Configure and activate a department DOA matrix",
    outcome: "A versioned department DOA matrix is active and procurement reads the same effective authority.",
    summary: "Create, validate, and activate department approval tiers without bypassing canonical authority.",
    roles: ["platform_administrator", "legal_compliance_lead", "operations_lead"],
    module: "Administration and Procurement",
    start: "An authorized control owner has approved a department authority change.",
    access: ["Platform administration", "DOA governance authority"],
    inputs: ["Department", "Effective dates", "Approval tiers", "Control-owner evidence"],
    steps: ["Create a versioned draft", "Define and validate tiers", "Activate the approved matrix", "Verify procurement readback"],
    decisions: ["Is the matrix complete and non-overlapping?", "Is activation authorized and effective?"],
    denial: ["Department claims cannot override canonical authority", "Invalid or overlapping tiers cannot activate"],
    recovery: "Keep the prior effective version active, correct the draft, and repeat controlled activation.",
    handoff: "The assignment owner activates the approved version and hands readback evidence to Procurement and Legal.",
    completion: ["One effective matrix is active", "Procurement resolves the same tiers", "Prior versions remain traceable"],
    evidence: ["Matrix version", "Tier assignments", "Activation decision", "Procurement readback"],
    related: ["procurement-request-approval"],
    keywords: ["DOA", "department", "authority", "matrix", "activation"],
    sources: [
      section("doa-administration", "docs/manual/MWELL_INTRA_USER_MANUAL.md", "DOA Administration"),
      section("department-authority-change", "docs/releases/2026-08-23-CANONICAL-DEPARTMENT-AUTHORITY.md", "What changed", "system-record"),
      section("authority-contract", "docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md", "Security and authority", "policy-basis"),
    ],
    screenshots: ["docs/manual/assets/live-20260711/03-command-center-admin-desktop.png"],
  },
  {
    id: "finance-readiness-evidence",
    title: "Review cross-module Finance readiness and evidence",
    outcome: "Finance can trace each readiness decision to the underlying procurement, warehouse, event, or payment evidence.",
    summary: "Review commitments, acceptance, valuation, and payment readiness without mutating operational source records.",
    roles: ["finance_controller", "leadership_insights", "procurement_lead", "operations_lead"],
    module: "Finance and Insights",
    start: "A governed cross-module record requires Finance review or readiness confirmation.",
    access: ["Finance controller access", "Authorized source-record read access"],
    inputs: ["Procurement commitment", "Warehouse acceptance and valuation", "Event evidence", "Payment readiness evidence"],
    steps: ["Open the Finance control center", "Trace each source record", "Review payment-readiness blockers", "Prepare a governed close entry or correction handoff"],
    decisions: ["Is operational acceptance complete?", "Is evidence sufficient and internally consistent?", "Does a source owner need to correct the record?"],
    denial: ["Finance cannot substitute for Warehouse receipt authority", "Readiness cannot bypass missing acceptance evidence"],
    recovery: "Return the blocker to the source owner and refresh the read model after the governed correction.",
    handoff: "Finance returns source corrections to the accountable module owner and records the final readiness evidence.",
    completion: ["Every readiness line has a source link", "Blockers have owners", "The decision is retained"],
    evidence: ["Source identifiers", "Readiness state", "Blocker or decision evidence"],
    related: ["procurement-request-approval", "stock-receiving-putaway", "inventory-count-variance"],
    keywords: ["finance", "readiness", "evidence", "valuation", "payment"],
    sources: [
      section("finance-role-procedure", "docs/manual/MWELL_INTRA_USER_MANUAL.md", "Finance Controller", "role-summary"),
      section("payment-evidence", "docs/PROCESS_REFERENCE_LIBRARY.md", "Payment evidence and file closure", "policy-basis"),
      section("finance-workspace-review", "docs/UX-REVIEW-FULL-APP.md", "Finance (`/warehouse/finance`, Rina)", "governed-reference"),
    ],
    screenshots: [],
  },
  {
    id: "product-readiness-pricing-go-live",
    title: "Submit and decide Product readiness, pricing, and go-live",
    outcome: "Product readiness and pricing decisions are approved, current, and acknowledged for operational go-live.",
    summary: "Submit readiness and pricing evidence, decide as Product Owner, and complete the Operations handoff.",
    roles: ["general_employee", "product_owner", "operations_lead"],
    module: "Product",
    start: "A product has a readiness or pricing package ready for governed review.",
    access: ["Product contributor or owner access", "Operations partner acknowledgement access"],
    inputs: ["Readiness package", "Pricing proposal", "Supporting evidence", "Operations handoff data"],
    steps: ["Submit readiness and pricing", "Review the current package", "Approve, reject, or return for correction", "Acknowledge the Operations handoff"],
    decisions: ["Is the package complete and current?", "Are readiness and pricing approved?", "Has Operations acknowledged go-live?"],
    denial: ["Stale or duplicate decisions are denied", "A contributor cannot make the owner decision"],
    recovery: "Correct the current package, resubmit with retained history, and repeat the pending decision or acknowledgement.",
    handoff: "Product Owner hands approved readiness to Operations for acknowledgement and go-live execution.",
    completion: ["Readiness and pricing are terminal", "Operations acknowledgement is visible", "Go-live state is explainable"],
    evidence: ["Readiness package", "Pricing proposal", "Decision events", "Operations acknowledgement"],
    related: ["ecommerce-order-intake", "finance-readiness-evidence"],
    keywords: ["product", "readiness", "pricing", "go-live", "approval"],
    sources: [
      section("required-role-journeys", "docs/UAT_AND_ISSUE_MANAGEMENT.md", "Required Role Journeys", "system-record"),
      section("role-modules", "docs/USER_TRAINING_AND_OPERATIONS_MANUAL.md", "Role Modules", "role-summary"),
    ],
    screenshots: [],
  },
];

const TASK_STAGE_ROLES = {
  "procurement-request-approval": ["general_employee", "general_employee", "operations_lead", "procurement_lead"],
  "vendor-accreditation-renewal": ["legal_compliance_lead", "vendor_representative", "legal_compliance_lead", "legal_compliance_lead"],
  "warehouse-location-bin-setup": ["operations_lead", "operations_lead", "operations_lead", "operations_associate"],
  "stock-receiving-putaway": ["operations_associate", "operations_associate", "operations_lead", "operations_associate"],
  "ecommerce-order-intake": ["operations_associate", "operations_associate", "operations_associate", "operations_associate"],
  "ecommerce-fulfillment-delivery": ["operations_associate", "operations_associate", "operations_associate", "operations_lead"],
  "returns-replacements-refunds-rma": ["operations_associate", "operations_associate", "operations_lead", "operations_lead"],
  "department-inventory-release": ["general_employee", "operations_lead", "operations_lead", "general_employee"],
  "event-stock-custody": ["general_employee", "operations_associate", "marketing_events_lead", "finance_controller"],
  "inventory-count-variance": ["operations_associate", "operations_associate", "operations_lead", "operations_lead"],
  "department-doa-activation": ["platform_administrator", "platform_administrator", "legal_compliance_lead", "procurement_lead"],
  "finance-readiness-evidence": ["finance_controller", "finance_controller", "finance_controller", "finance_controller"],
  "product-readiness-pricing-go-live": ["general_employee", "product_owner", "product_owner", "operations_lead"],
};

const TASK_STAGE_ROUTES = {
  "procurement-request-approval": ["/procurement/requests/new", "/procurement/requests", "/procurement/approvals", "/procurement/purchase-orders"],
  "vendor-accreditation-renewal": ["/legal/invites/new", "/vendor/", "/legal/", "/legal/"],
  "warehouse-location-bin-setup": ["/warehouse/storage", "/warehouse/locations", "/warehouse/operation-routes", "/warehouse/purchase-orders"],
  "stock-receiving-putaway": ["/warehouse/purchase-orders", "/warehouse/receiving", "/warehouse/quality", "/warehouse/storage"],
  "ecommerce-order-intake": ["/warehouse/fulfillment", "/warehouse/fulfillment", "/warehouse/fulfillment", "/warehouse/fulfillment"],
  "ecommerce-fulfillment-delivery": ["/warehouse/fulfillment", "/warehouse/fulfillment", "/warehouse/fulfillment", "/warehouse/fulfillment"],
  "returns-replacements-refunds-rma": ["/warehouse/returns", "/warehouse/returns", "/warehouse/quality", "/warehouse/quality"],
  "department-inventory-release": ["/warehouse/fulfillment", "/warehouse/fulfillment", "/warehouse/fulfillment", "/warehouse/fulfillment"],
  "event-stock-custody": ["/events", "/warehouse/fulfillment", "/events", "/events"],
  "inventory-count-variance": ["/warehouse/cycle-counts", "/warehouse/cycle-counts", "/warehouse/approvals", "/warehouse/approvals"],
  "department-doa-activation": ["/admin/doa", "/admin/doa", "/admin/doa", "/procurement/requests/new"],
  "finance-readiness-evidence": ["/finance", "/finance", "/finance", "/finance"],
  "product-readiness-pricing-go-live": ["/product", "/product", "/product", "/product"],
};

function decisionBranch(label, condition, targetType, targetId, outcome, recoveryAction, terminal = false) {
  return {
    label,
    condition,
    target: { type: targetType, id: targetId },
    outcome,
    recoveryAction,
    terminal,
  };
}

function taskDecision(id, position, stageId, ownerRole, question, yesBranch, noBranch) {
  return {
    id,
    placement: { position, stageId },
    ownerRole,
    question,
    yesBranch,
    noBranch,
  };
}

const TASK_DECISION_TREES = {
  "procurement-request-approval": [
    taskDecision("decision-1", "after", "step-1", "general_employee", "Is the request complete and eligible for submission?",
      decisionBranch("Complete", "Required data, justification, and evidence are present.", "stage", "step-2", "The request can enter the effective route.", "Continue without correction."),
      decisionBranch("Incomplete", "Required data, eligibility, or evidence is missing.", "stage", "step-1", "The request remains a draft and cannot be submitted.", "Correct the missing or ineligible request content, then repeat validation.")),
    taskDecision("decision-2", "after", "step-2", "operations_lead", "Is the derived approval route valid and ready for decisions?",
      decisionBranch("Route valid", "The current route, assignments, and required evidence resolve without a blocker.", "stage", "step-3", "Assigned approvers can decide the request.", "Continue without correction."),
      decisionBranch("Route blocked", "The route is stale, incomplete, conflicting, or requires an unresolved exception.", "stage", "step-1", "Approval cannot begin on the invalid route.", "Return the request for correction or resolve the exception, then derive the route again.")),
    taskDecision("decision-3", "after", "step-3", "operations_lead", "Has every required approver approved the current request?",
      decisionBranch("Approved", "Every required current-route decision is an approval.", "stage", "step-4", "The approved record can be confirmed for Procurement.", "Continue without recovery."),
      decisionBranch("Not approved", "A required decision is rejected, returned, stale, or still unresolved.", "decision", "decision-4", "The request cannot be completed as approved.", "Classify whether correction and resubmission remain allowed.")),
    taskDecision("decision-4", "after", "step-3", "operations_lead", "Can the failed approval condition be corrected and resubmitted through the current effective route?",
      decisionBranch("Correctable", "The rejection, return, or stale decision has an actionable correction path.", "stage", "step-1", "The request returns to draft correction with history retained.", "Correct the cited issue and resubmit through a newly derived current route."),
      decisionBranch("Rejected", "The decision is terminal or the request is no longer eligible.", "outcome", "rejection", "The request ends rejected and is not handed to Procurement.", "Retain the terminal reason and start a new request only if a new eligible need exists.", true)),
  ],
  "vendor-accreditation-renewal": [
    taskDecision("decision-1", "after", "step-1", "legal_compliance_lead", "Is the case a renewal of an existing vendor record?",
      decisionBranch("Renewal", "An existing accreditation is approaching or has reached renewal.", "decision", "decision-2", "Use the renewal evidence and validity branch.", "Retain the existing vendor identity and continue to evidence scoping."),
      decisionBranch("New application", "No existing accreditation is being renewed.", "decision", "decision-2", "Use the new-application identity and evidence branch.", "Continue to evidence scoping with the new case identity.")),
    taskDecision("decision-2", "before", "step-2", "legal_compliance_lead", "Does the technology-provider qualification branch apply?",
      decisionBranch("Technology branch", "The vendor will process, host, integrate, or otherwise provide covered technology services.", "stage", "step-2", "Technology qualification evidence is required with the entity evidence.", "Request the technology evidence set before submission."),
      decisionBranch("Standard branch", "The covered technology-provider conditions do not apply.", "stage", "step-2", "Only the applicable entity and common declaration evidence is required.", "Continue with the standard evidence set.")),
    taskDecision("decision-3", "after", "step-3", "legal_compliance_lead", "Is the submitted evidence complete, current, and eligible?",
      decisionBranch("Eligible", "All applicable declarations, entity evidence, and qualifications pass review.", "stage", "step-4", "Legal and Compliance can record the accreditation decision.", "Continue without correction."),
      decisionBranch("Deficient", "Evidence is missing, expired, contradictory, or ineligible.", "decision", "decision-4", "Approval is blocked pending correction or rejection.", "Determine whether the deficiency can be corrected.")),
    taskDecision("decision-4", "after", "step-3", "legal_compliance_lead", "Can the evidence deficiency be corrected within the case?",
      decisionBranch("Correction allowed", "The deficiency is specific and the case remains eligible for correction.", "stage", "step-2", "The case returns to the vendor with retained review history.", "Request the exact correction and resume review after resubmission."),
      decisionBranch("Reject or expire", "The case is ineligible, abandoned, or cannot be corrected within validity rules.", "outcome", "rejection", "The application ends rejected or expired.", "Retain the reason and require a new eligible application when appropriate.", true)),
  ],
  "warehouse-location-bin-setup": [
    taskDecision("decision-1", "after", "step-1", "operations_lead", "Should the approved storage hierarchy be created by governed import?",
      decisionBranch("Import", "The approved setup is available in the current versioned template.", "stage", "step-2", "Create the records through the validated import path.", "Validate the template before submission."),
      decisionBranch("Manual", "The setup is small or no governed import is required.", "stage", "step-2", "Create the records through the manual setup path.", "Enter each approved identifier directly.")),
    taskDecision("decision-2", "after", "step-3", "operations_lead", "Are all location and bin codes unique, valid, and correctly scoped?",
      decisionBranch("Valid", "Every identifier is unique and belongs to the intended warehouse hierarchy.", "stage", "step-4", "The storage structure can be exposed to receiving.", "Continue without correction."),
      decisionBranch("Invalid", "A duplicate, malformed, or cross-warehouse identifier exists.", "stage", "step-2", "Activation remains blocked.", "Correct the hierarchy or rejected import rows, then validate again.")),
  ],
  "stock-receiving-putaway": [
    taskDecision("decision-1", "after", "step-1", "operations_associate", "Does the delivery match an authorized inbound record?",
      decisionBranch("Authorized", "The supplier, purchase order, lines, and open quantities support receipt.", "stage", "step-2", "Physical receipt can be recorded.", "Continue without correction."),
      decisionBranch("Mismatch", "The delivery lacks authority or differs from the eligible inbound record.", "stage", "step-1", "Receipt posting remains blocked while custody is controlled.", "Hold the delivery, obtain corrected authority or resolve the mismatch, then verify again.")),
    taskDecision("decision-2", "after", "step-3", "operations_lead", "Is the inspected stock acceptable for inventory custody?",
      decisionBranch("Acceptable", "Inspection supports acceptance, including any approved disposition.", "decision", "decision-3", "The receipt may proceed toward posting and putaway.", "Confirm whether supervisor disposition is still required."),
      decisionBranch("Held or rejected", "Damage, quantity, quality, or compliance exceptions prevent acceptance.", "decision", "decision-4", "The stock remains held, rejected, or return-bound.", "Determine whether the exception can be resolved within this receipt.")),
    taskDecision("decision-3", "after", "step-3", "operations_lead", "Has every required supervisor disposition been recorded?",
      decisionBranch("Disposition complete", "All required exception decisions are attributable and current.", "stage", "step-4", "Accepted stock can be posted and put away.", "Continue without correction."),
      decisionBranch("Disposition pending", "A required supervisor decision is absent or stale.", "stage", "step-3", "Posting remains blocked.", "Obtain and retain the current disposition before reclassification.")),
    taskDecision("decision-4", "after", "step-3", "operations_lead", "Can the held or rejected stock be resolved within the current receipt?",
      decisionBranch("Resolvable", "Correction, recount, or an authorized disposition can resolve the exception.", "stage", "step-3", "The exception returns to inspection and classification.", "Apply the correction or disposition and inspect the controlled stock again."),
      decisionBranch("Escalate or return", "The stock cannot be accepted or resolved under current authority.", "outcome", "escalation", "The receipt ends in controlled hold, rejection, or supplier-return escalation.", "Retain custody and discrepancy evidence for the accountable owner.", true)),
  ],
  "ecommerce-order-intake": [
    taskDecision("decision-1", "after", "step-1", "operations_associate", "Is the external order identity new?",
      decisionBranch("New", "No existing order uses the governed external identity.", "stage", "step-2", "The order can be validated for intake.", "Continue without correction."),
      decisionBranch("Existing", "The external identity already exists.", "decision", "decision-2", "The intake must be classified as corrective or duplicate.", "Inspect the existing record before any retry.")),
    taskDecision("decision-2", "after", "step-1", "operations_associate", "Is the existing order a permitted corrective retry?",
      decisionBranch("Corrective retry", "The retained rejected intake is eligible for correction under the same identity.", "stage", "step-2", "The corrected order can be revalidated without duplication.", "Apply only the rejected corrections and preserve the external identity."),
      decisionBranch("Duplicate", "A current or completed order already owns the identity.", "outcome", "rejection", "The duplicate intake is rejected without creating another order.", "Use the existing order or raise an identity correction outside duplicate intake.", true)),
    taskDecision("decision-3", "after", "step-2", "operations_associate", "Are all products, quantities, and delivery fields valid for fulfillment?",
      decisionBranch("Valid", "Every required field and line passes intake validation.", "stage", "step-4", "The order can enter the fulfillment queue.", "Continue without correction."),
      decisionBranch("Invalid", "One or more rows, products, quantities, or delivery fields fail validation.", "stage", "step-3", "The order remains outside fulfillment.", "Correct or remove the rejected data before revalidation.")),
    taskDecision("decision-4", "after", "step-3", "operations_associate", "Can every rejected line be corrected from governed source data?",
      decisionBranch("Corrected", "The source order now supplies valid replacement data.", "stage", "step-2", "The order returns to validation.", "Revalidate the complete corrected order."),
      decisionBranch("Unresolved", "Required valid source data is unavailable.", "outcome", "controlled-hold", "The intake remains rejected and controlled outside fulfillment.", "Retain rejected-row evidence and return the issue to the source owner.", true)),
  ],
  "ecommerce-fulfillment-delivery": [
    taskDecision("decision-1", "after", "step-1", "operations_associate", "Is sufficient releasable stock allocated to the order?",
      decisionBranch("Sufficient", "All required stock is available, releasable, and correctly allocated.", "stage", "step-2", "Packing validation can begin.", "Continue without correction."),
      decisionBranch("Insufficient or held", "Stock is short, held, stale, or otherwise unavailable.", "outcome", "controlled-hold", "Fulfillment stops before packing or dispatch.", "Release invalid allocations and route shortage resolution to the accountable owner.", true)),
    taskDecision("decision-2", "after", "step-2", "operations_associate", "Did packing validation pass?",
      decisionBranch("Pass", "Picked lines, quantities, package, and labels match the order.", "stage", "step-3", "The package can be dispatched.", "Continue without correction."),
      decisionBranch("Fail", "The package or picked stock does not match the validated order.", "stage", "step-2", "Dispatch remains blocked.", "Correct the pick or package and repeat packing validation.")),
    taskDecision("decision-3", "after", "step-4", "operations_lead", "Was delivery completed with acceptable evidence?",
      decisionBranch("Delivered", "The carrier or recipient evidence supports completed delivery.", "outcome", "completion", "The order reaches delivered completion and stock remains reconciled.", "Retain delivery evidence.", true),
      decisionBranch("Not delivered", "Delivery failed, was refused, or returned.", "decision", "decision-4", "The order cannot close as delivered.", "Classify the failed or returned package.")),
    taskDecision("decision-4", "after", "step-4", "operations_lead", "Was the undelivered package returned to controlled warehouse custody?",
      decisionBranch("Returned", "Warehouse custody and reverse movement are recorded.", "outcome", "controlled-hold", "The order moves to the returns or redelivery process.", "Open the related return or controlled redelivery action.", true),
      decisionBranch("Missing or failed", "Custody or final carrier disposition is unresolved.", "outcome", "escalation", "The delivery remains failed with an accountable exception owner.", "Escalate carrier, custody, and customer resolution with retained evidence.", true)),
  ],
  "returns-replacements-refunds-rma": [
    taskDecision("decision-1", "after", "step-1", "operations_associate", "Does the returned item match an original governed release?",
      decisionBranch("Matched", "The serial, product, quantity, and recipient trace to an original release.", "stage", "step-2", "The return can be received and inspected.", "Continue without correction."),
      decisionBranch("Unmatched", "No reliable original release can be established.", "outcome", "controlled-hold", "The item remains controlled and cannot post as reusable stock.", "Hold the item and obtain the missing release evidence or escalate ownership.", true)),
    taskDecision("decision-2", "after", "step-2", "operations_lead", "Is the returned stock reusable without a controlled commercial disposition?",
      decisionBranch("Reusable", "Inspection supports return to usable inventory under current authority.", "stage", "step-3", "Select the governed restock resolution.", "Continue to the resolution branch."),
      decisionBranch("Not reusable", "Damage, quality, customer, or supplier conditions require another disposition.", "decision", "decision-3", "Refund, replacement, write-off, hold, or supplier RMA authority is required.", "Confirm accountable disposition authority.")),
    taskDecision("decision-3", "after", "step-2", "operations_lead", "Is the required refund, replacement, write-off, or supplier RMA authority available?",
      decisionBranch("Authorized", "The accountable commercial or control owner has approved the selected disposition.", "stage", "step-3", "The governed resolution can be selected and evidenced.", "Continue with the authorized branch."),
      decisionBranch("Authority missing", "Required Finance, Procurement, or supervisor authority is absent.", "outcome", "escalation", "The return remains held with no unsupported posting.", "Escalate to the required owner while retaining physical custody.", true)),
    taskDecision("decision-4", "after", "step-3", "operations_lead", "Is the selected resolution fully approved and evidenced?",
      decisionBranch("Ready", "The branch, authority, financial evidence, and physical disposition agree.", "stage", "step-4", "The final reverse movement and disposition can post.", "Continue without correction."),
      decisionBranch("Incomplete", "The selected branch lacks evidence, authority, or a consistent disposition.", "stage", "step-3", "Final posting remains blocked.", "Correct the resolution package and repeat the branch check.")),
  ],
  "department-inventory-release": [
    taskDecision("decision-1", "after", "step-2", "operations_lead", "Is department authority sufficient for the requested release?",
      decisionBranch("Authorized", "The requester, department, purpose, and approvals satisfy the release rule.", "decision", "decision-2", "Availability can be evaluated.", "Continue without correction."),
      decisionBranch("Unauthorized", "Required department authority or approval is missing.", "stage", "step-1", "The request returns without allocation.", "Correct the requester, department, quantity, or approval evidence and resubmit.")),
    taskDecision("decision-2", "after", "step-2", "operations_lead", "Is sufficient releasable stock available?",
      decisionBranch("Available", "Eligible stock can satisfy the authorized quantity.", "stage", "step-3", "Warehouse can allocate and release stock.", "Continue without correction."),
      decisionBranch("Unavailable", "Stock is short, held, or already committed.", "outcome", "controlled-hold", "The request remains queued or is cancelled without stale allocation.", "Release invalid allocations and return shortage ownership to the requester and Operations Lead.", true)),
    taskDecision("decision-3", "after", "step-4", "general_employee", "Did the authorized recipient accept custody?",
      decisionBranch("Accepted", "Recipient identity and custody acknowledgement are retained.", "outcome", "completion", "The department release is complete.", "Retain recipient evidence.", true),
      decisionBranch("Not accepted", "The recipient refused, was unavailable, or custody evidence is missing.", "stage", "step-3", "The release must be reversed or reassigned before closure.", "Restore controlled custody, correct the recipient handoff, and repeat release confirmation.")),
  ],
  "event-stock-custody": [
    taskDecision("decision-1", "after", "step-1", "marketing_events_lead", "Is the event need authorized and non-duplicate?",
      decisionBranch("Authorized", "The event, requester, quantity, dates, and approval are current and unique.", "stage", "step-2", "Warehouse can transfer stock to event custody.", "Continue without correction."),
      decisionBranch("Denied or duplicate", "Authority is missing, stale, or a duplicate event request exists.", "outcome", "cancellation", "No stock transfers and the event request ends cancelled or returned.", "Correct and submit a new valid request only when an authorized need remains.", true)),
    taskDecision("decision-2", "after", "step-3", "marketing_events_lead", "Does every issued quantity have a recorded use, return, damage, loss, or unresolved state?",
      decisionBranch("Recorded", "All event custody quantities have attributable disposition records.", "stage", "step-4", "Finance can independently review the submitted settlement.", "Continue without correction."),
      decisionBranch("Missing disposition", "One or more issued quantities lack a current custody outcome.", "stage", "step-3", "Reconciliation remains blocked.", "Recover or document the missing custody outcome, then submit the event return again.")),
    taskDecision("decision-3", "after", "step-4", "finance_controller", "Is every event variance resolved or assigned to an accountable owner?",
      decisionBranch("Resolved", "Returned, used, damaged, and lost quantities reconcile with evidence and ownership.", "outcome", "completion", "The event custody record reaches explainable completion.", "Retain the custody and variance evidence.", true),
      decisionBranch("Unresolved", "A quantity or custody discrepancy has no accepted disposition or owner.", "outcome", "escalation", "The event remains open under variance escalation.", "Retain custody history and escalate the discrepancy before closure.", true)),
  ],
  "inventory-count-variance": [
    taskDecision("decision-1", "after", "step-2", "operations_associate", "Does the observed count match the recorded stock position?",
      decisionBranch("Match", "Observed and recorded quantities agree with no unresolved exception.", "outcome", "completion", "The count closes with no adjustment.", "Retain the completed count evidence.", true),
      decisionBranch("Variance", "Observed quantity differs from the recorded position.", "stage", "step-3", "A separate supervisor must review the variance.", "Submit the variance without overwriting the original count.")),
    taskDecision("decision-2", "after", "step-3", "operations_lead", "Is the variance supported by evidence and within assigned authority?",
      decisionBranch("Supported", "Recount, movement history, cause, and authority support the proposed result.", "stage", "step-4", "The approved result can be posted or corrected.", "Continue without correction."),
      decisionBranch("Unsupported", "Evidence, recount, cause, or authority is insufficient.", "decision", "decision-3", "Posting remains blocked.", "Determine whether recount or correction can resolve the variance.")),
    taskDecision("decision-3", "after", "step-3", "operations_lead", "Can recount or evidence correction resolve the rejected variance?",
      decisionBranch("Recoverable", "A controlled recount or evidence correction is available.", "stage", "step-1", "A new retained count cycle begins.", "Recount or correct the evidence and resubmit for independent review."),
      decisionBranch("Escalate", "The variance cannot be resolved under current authority or evidence.", "outcome", "escalation", "The count remains controlled under accountable escalation.", "Escalate to the required operational or Finance owner.", true)),
    taskDecision("decision-4", "after", "step-4", "operations_lead", "Would the approved posting create an invalid negative-stock result?",
      decisionBranch("Invalid result", "The proposed movement would violate the negative-stock control.", "outcome", "controlled-hold", "Posting is denied and the count remains unresolved.", "Correct the source movement or escalate the stock integrity issue.", true),
      decisionBranch("Valid result", "The approved movement preserves a valid stock position.", "outcome", "completion", "The movement posts once and the count closes.", "Retain approval and movement evidence.", true)),
  ],
  "department-doa-activation": [
    taskDecision("decision-1", "after", "step-2", "platform_administrator", "Is the draft matrix complete, non-overlapping, and internally valid?",
      decisionBranch("Valid", "All tiers, ranges, assignments, and effective rules validate without gaps or overlap.", "stage", "step-3", "The draft can proceed to controlled activation.", "Continue without correction."),
      decisionBranch("Invalid", "A gap, overlap, missing assignment, or malformed tier exists.", "stage", "step-1", "The prior effective matrix remains active.", "Correct the versioned draft and validate every tier again.")),
    taskDecision("decision-2", "after", "step-3", "legal_compliance_lead", "Is activation authorized and effective for the intended department and date?",
      decisionBranch("Authorized", "Approval, scope, version, and effective date support activation.", "stage", "step-4", "The new matrix can be checked through Procurement readback.", "Continue without correction."),
      decisionBranch("Unauthorized", "Approval, scope, date, or activation evidence is missing or invalid.", "stage", "step-1", "Activation is rejected and the prior matrix remains effective.", "Correct the draft or authority package before another activation attempt.")),
    taskDecision("decision-3", "after", "step-4", "platform_administrator", "Does Procurement resolve exactly the activated tiers and assignments?",
      decisionBranch("Readback matches", "Procurement derives the same effective matrix version and tier results.", "outcome", "completion", "The matrix activation is complete and traceable.", "Retain activation and readback evidence.", true),
      decisionBranch("Readback mismatch", "Procurement resolves a different version, tier, or assignment.", "stage", "step-1", "The new activation is not accepted as operationally effective.", "Restore or retain the prior effective version, correct the draft, and repeat controlled activation.")),
  ],
  "finance-readiness-evidence": [
    taskDecision("decision-1", "after", "step-2", "finance_controller", "Is operational acceptance complete in every applicable source record?",
      decisionBranch("Accepted", "Warehouse, Procurement, Events, or other source owners have completed required acceptance.", "decision", "decision-2", "Finance can evaluate evidence sufficiency.", "Continue without correction."),
      decisionBranch("Acceptance missing", "A required operational acceptance is absent, stale, or unresolved.", "stage", "step-3", "Financial readiness is blocked.", "Record the blocker and return it to the operational source owner.")),
    taskDecision("decision-2", "after", "step-2", "finance_controller", "Is the cross-module evidence sufficient and internally consistent?",
      decisionBranch("Sufficient", "Amounts, source links, acceptance, valuation, and supporting evidence reconcile.", "stage", "step-4", "Finance can record the readiness decision.", "Continue without correction."),
      decisionBranch("Insufficient", "Evidence is missing, contradictory, or cannot be traced to its source.", "stage", "step-3", "Readiness remains blocked.", "Identify the exact missing or inconsistent source evidence.")),
    taskDecision("decision-3", "after", "step-3", "finance_controller", "Does a source owner need to correct the blocked record?",
      decisionBranch("Source correction", "The blocker originates in an operational source record or acceptance.", "stage", "step-4", "Finance records a blocked handoff to the source owner.", "Assign the correction, then refresh evidence after the source owner completes it."),
      decisionBranch("No source correction", "The evidence is current and the remaining issue is a Finance decision or escalation.", "decision", "decision-4", "Finance determines whether it can decide within authority.", "Review Finance authority and unresolved control conflicts.")),
    taskDecision("decision-4", "after", "step-3", "finance_controller", "Can Finance resolve the remaining issue without substituting for source authority?",
      decisionBranch("Within Finance authority", "The issue is an assigned Finance readiness decision supported by complete source evidence.", "stage", "step-4", "Finance can record the decision.", "Continue without correction."),
      decisionBranch("Outside authority", "Resolution would replace operational, Legal, Procurement, or other source authority.", "outcome", "escalation", "The readiness review ends escalated with the blocker retained.", "Escalate to the accountable control owner without mutating source evidence.", true)),
    taskDecision("decision-5", "after", "step-4", "finance_controller", "Is the recorded readiness result approved rather than blocked?",
      decisionBranch("Ready", "The retained decision confirms complete and consistent readiness evidence.", "outcome", "completion", "Finance readiness is complete.", "Retain the source-linked decision evidence.", true),
      decisionBranch("Blocked handoff", "The retained decision identifies an owned source correction or unresolved blocker.", "outcome", "controlled-hold", "The review completes as blocked with an accountable next owner.", "Resume a new readiness review after governed correction.", true)),
  ],
  "product-readiness-pricing-go-live": [
    taskDecision("decision-1", "after", "step-2", "product_owner", "Is the submitted readiness and pricing package complete and current?",
      decisionBranch("Complete", "The package version, evidence, pricing, and readiness inputs are current and complete.", "stage", "step-3", "The Product Owner can make the decision.", "Continue without correction."),
      decisionBranch("Incomplete or stale", "Required inputs are missing, stale, duplicated, or superseded.", "stage", "step-1", "No owner decision is recorded on the invalid package.", "Correct and resubmit a new current package with history retained.")),
    taskDecision("decision-2", "after", "step-3", "product_owner", "Are readiness and pricing approved for Operations handoff?",
      decisionBranch("Approved", "The current package satisfies Product readiness and pricing authority.", "stage", "step-4", "Operations can review and acknowledge go-live handoff.", "Continue without correction."),
      decisionBranch("Not approved", "The owner returned or rejected one or both decisions.", "decision", "decision-3", "The package cannot proceed to Operations.", "Classify correction versus terminal rejection.")),
    taskDecision("decision-3", "after", "step-3", "product_owner", "Was the package returned for correction rather than rejected?",
      decisionBranch("Return for correction", "The owner identified an actionable package correction.", "stage", "step-1", "The contributor can prepare a new current package.", "Correct the cited issue and resubmit without overwriting history."),
      decisionBranch("Rejected", "The current package has a terminal Product decision.", "outcome", "rejection", "Readiness or pricing ends rejected with no go-live handoff.", "Retain the decision reason and submit a new package only for a materially new proposal.", true)),
    taskDecision("decision-4", "after", "step-4", "operations_lead", "Has Operations acknowledged the approved go-live handoff?",
      decisionBranch("Acknowledged", "Operations accepted the current approved readiness and pricing handoff.", "outcome", "completion", "The go-live state is complete and explainable.", "Retain Product decisions and Operations acknowledgement.", true),
      decisionBranch("Not acknowledged", "Operations identified an unresolved dependency or has not accepted the handoff.", "outcome", "controlled-hold", "Go-live remains blocked with Operations ownership visible.", "Resolve the dependency and repeat acknowledgement against the current approved package.", true)),
  ],
};

function taskStage(definition, label, index) {
  const roles = TASK_STAGE_ROLES[definition.id];
  const routes = TASK_STAGE_ROUTES[definition.id];
  const performingRole = roles[index];
  const bindingId = `${definition.id}:step-${index + 1}`;
  const operatingContract = HANDBOOK_STAGE_CONTRACTS[bindingId];
  if (!operatingContract) throw new Error(`Missing stage operating contract for ${bindingId}.`);
  const evidence = EVIDENCE_BY_BINDING.get(bindingId);
  const desktop = evidence?.variants?.find(({ viewport }) => viewport === "desktop");
  const mobile = evidence?.variants?.find(({ viewport }) => viewport === "mobile");
  return {
    id: `step-${index + 1}`,
    label,
    performingRole,
    module: definition.module,
    route: routes[index],
    instruction: `${label}.`,
    screenshot: {
      bindingId,
      status: evidence?.status ?? "pending",
      path: desktop?.path ?? null,
      mobilePath: mobile?.path ?? null,
      target: evidence?.target ?? null,
      host: evidence?.host ?? null,
      route: evidence?.route ?? null,
      role: evidence?.role ?? null,
      capturedAt: evidence?.capturedAt ?? null,
      sourceCommit: evidence?.sourceCommit ?? null,
      certificationRun: evidence?.certificationRun ?? null,
      assertions: evidence?.assertions ?? null,
      variants: evidence?.variants ?? [],
    },
    expectedResult: operatingContract.expectedResult,
    dataRead: operatingContract.dataRead,
    dataWritten: operatingContract.dataWritten,
    evidenceRetained: operatingContract.evidenceRetained,
    nextHandoff: operatingContract.nextHandoff,
  };
}

function taskGuide(definition) {
  const decisionPoints = TASK_DECISION_TREES[definition.id];
  const decisionLabels = decisionPoints.map(({ question }) => question);
  const steps = definition.steps.map((label, index) => taskStage(definition, label, index));
  return {
    id: definition.id,
    type: "task",
    modeId: "tasks",
    title: definition.title,
    label: definition.title,
    outcome: definition.outcome,
    summary: definition.summary,
    participatingRoles: definition.roles,
    module: definition.module,
    startCondition: definition.start,
    requiredAccess: definition.access,
    inputsAndEvidence: definition.inputs,
    prerequisites: {
      startCondition: definition.start,
      requiredAccess: definition.access,
      inputsAndEvidence: definition.inputs,
    },
    steps,
    decisionLabels,
    decisionPoints,
    denialChecks: definition.denial,
    recovery: definition.recovery,
    handoff: definition.handoff,
    completionCriteria: definition.completion,
    completionEvidence: definition.evidence,
    governingSources: unique(definition.sources.map(({ source }) => source)),
    relatedTasks: definition.related.filter((id) => id !== "imports"),
    relatedGuides: definition.related,
    keywords: definition.keywords,
    owner: OWNER,
    effectiveDate: EFFECTIVE_DATE,
    lastReviewedDate: EFFECTIVE_DATE,
    applicableBuild: APPLICABLE_BUILD,
    status: "current",
    availability: "implemented",
    sourceSections: definition.sources,
    screenshotReferences: unique([
      ...definition.screenshots,
      ...steps.flatMap(({ screenshot }) =>
        (screenshot.variants ?? []).map(({ path: screenshotPath }) => screenshotPath),
      ),
    ]),
    sections: guideSections(TASK_SECTION_IDS),
  };
}

const ROLE_DEFINITIONS = [
  {
    id: "platform_administrator", name: "Platform Administrator", aliases: ["Platform Admin"],
    purpose: "Administer platform identities, configuration, and governed authority without assuming business approval rights.",
    department: "Technology; platform-wide administrative scope.", owner: "Technology platform owner",
    access: ["Core staff", "Platform administration"], queue: ["Identity and access requests", "Configuration and DOA activation", "Release support"],
    tasks: ["department-doa-activation"], permitted: ["Manage users and assignments", "Activate authorized configuration", "Support controlled release operations"],
    prohibited: ["Self-approve business requests", "Override canonical department authority", "Use administrative access as operational authority"],
    authority: ["May administer only approved configuration", "Business decisions remain with assigned control owners"],
    handoffs: ["Receives approved access and configuration requests", "Sends activation and audit evidence to requesters and control owners"],
    denial: ["Least-privilege route denial remains effective without a business assignment"], escalation: "Escalate unclear authority to the application owner and relevant control owner; roll back to the last effective configuration.",
    evidence: ["Identity and assignment audit records", "Configuration activation evidence"], training: ["Complete platform administration orientation", "Prove a denied business action"],
  },
  {
    id: "general_employee", name: "General Employee", aliases: ["Employee", "Requester"],
    purpose: "Initiate authorized business requests and contribute evidence for Procurement, Events, Warehouse, and Product workflows.",
    department: "Assigned business department; request and contributor scope.", owner: "Department manager",
    access: ["Core staff", "Assigned requester and contributor roles"], queue: ["Draft and returned requests", "Department inventory and event needs", "Product contributions"],
    tasks: ["procurement-request-approval", "department-inventory-release", "event-stock-custody", "product-readiness-pricing-go-live"],
    permitted: ["Create and correct own requests", "Submit supporting evidence", "Track governed handoffs"],
    prohibited: ["Approve own requests", "Release warehouse stock", "Make owner or Finance decisions"], authority: ["May attest only to submitted business facts and evidence"],
    handoffs: ["Sends complete requests to approvers and operators", "Receives correction, denial, and completion outcomes"], denial: ["Self-approval and unauthorized module mutations are denied"],
    escalation: "Correct returned work first; escalate access or policy questions to the department manager or owning module.", evidence: ["Request content", "Attachments", "Acknowledgements and correction history"],
    training: ["Complete role orientation", "Submit and recover one representative request"],
  },
  {
    id: "operations_associate", name: "Operations Associate", aliases: ["Warehouse Operator"],
    purpose: "Execute physical warehouse transactions and preserve accurate custody and ledger evidence.", department: "Operations, Warehouse and Logistics; operator scope.", owner: "Operations Lead",
    access: ["Warehouse operator workspace"], queue: ["Inbound receipts", "Fulfillment", "Counts", "Allocations, events, and returns"],
    tasks: ["warehouse-location-bin-setup", "stock-receiving-putaway", "ecommerce-order-intake", "ecommerce-fulfillment-delivery", "returns-replacements-refunds-rma", "event-stock-custody", "inventory-count-variance"],
    permitted: ["Record authorized physical transactions", "Submit counts and exceptions", "Complete assigned custody handoffs"], prohibited: ["Approve own variances", "Perform Procurement receipt", "Release held stock without disposition"],
    authority: ["May attest to observed quantities and physical state; supervisor decisions remain separate"], handoffs: ["Receives authorized inbound, orders, and requests", "Sends exceptions and variances to Operations Lead"],
    denial: ["Duplicate posting, negative stock, and supervisor-only decisions are denied"], escalation: "Stop the affected movement, retain physical custody, and escalate discrepancies to the Operations Lead.",
    evidence: ["Receipts", "Movements", "Counts", "Inspection and custody records"], training: ["Complete Warehouse orientation and receiving certification", "Prove duplicate and exception recovery"],
  },
  {
    id: "operations_lead", name: "Operations Lead", aliases: ["Warehouse Supervisor", "Logistics Supervisor"],
    purpose: "Supervise Warehouse and operational handoffs, decide controlled exceptions, and approve assigned Procurement work.", department: "Operations, Warehouse and Logistics; supervisory scope.", owner: "Head of Operations",
    access: ["Warehouse supervisor", "Logistics supervisor", "Assigned Procurement approver", "Product operations partner"], queue: ["Warehouse exceptions and variances", "Approval inbox", "Product handoffs"],
    tasks: ["procurement-request-approval", "warehouse-location-bin-setup", "stock-receiving-putaway", "ecommerce-fulfillment-delivery", "returns-replacements-refunds-rma", "department-inventory-release", "event-stock-custody", "inventory-count-variance", "product-readiness-pricing-go-live"],
    permitted: ["Decide assigned operational exceptions", "Approve assigned requests", "Acknowledge Product operational readiness"], prohibited: ["Self-approve own initiated work", "Override Finance or Legal authority", "Post unsupported stock adjustments"],
    authority: ["Decisions are limited to the effective assignment, DOA, and Warehouse control model"], handoffs: ["Receives operator exceptions and assigned approvals", "Sends financial, legal, procurement, and product outcomes to their owners"],
    denial: ["Out-of-scope approvals and stale decisions are denied"], escalation: "Keep the transaction controlled and escalate policy, Finance, or Legal questions to the assigned owner.", evidence: ["Approval decisions", "Exception dispositions", "Variance and handoff evidence"],
    training: ["Complete supervisor orientation", "Decide one positive and one recovery scenario"],
  },
  {
    id: "procurement_lead", name: "Procurement Lead", aliases: ["Procurement Officer"],
    purpose: "Operate governed sourcing and purchase-order work while respecting separate receiving and approval authority.", department: "Procurement; sourcing and administration scope.", owner: "Head of Procurement",
    access: ["Procurement officer and administration", "Warehouse procurement read context"], queue: ["Approved requests", "Vendor eligibility", "Sourcing and award work", "Purchase-order follow-up"],
    tasks: ["procurement-request-approval", "vendor-accreditation-renewal", "stock-receiving-putaway", "returns-replacements-refunds-rma", "finance-readiness-evidence"],
    permitted: ["Operate sourcing and purchase-order processes", "Verify vendor eligibility", "Coordinate supplier RMA"], prohibited: ["Post physical receipt", "Approve outside assigned authority", "Treat pending policy as active"],
    authority: ["May make only assigned Procurement decisions under the effective route and policy"], handoffs: ["Receives approved requests and vendor decisions", "Sends purchase orders to suppliers and authorized inbound records to Warehouse"],
    denial: ["Warehouse receipt and unassigned approval mutations are denied"], escalation: "Return incomplete requests or vendor evidence to the source owner; escalate policy exceptions to the designated approver.", evidence: ["Sourcing record", "Award and route evidence", "Purchase-order pack"],
    training: ["Complete Procurement orientation", "Demonstrate receiving-authority denial"],
  },
  {
    id: "finance_controller", name: "Finance Controller", aliases: ["Finance"],
    purpose: "Review cross-module financial readiness, valuation, and evidence without replacing operational source authority.", department: "Finance; controller and review scope.", owner: "Head of Finance",
    access: ["Procurement Finance", "Warehouse Finance", "Events Finance review"], queue: ["Commitments and payment readiness", "Warehouse valuation", "Event financial review", "Variance evidence"],
    tasks: ["procurement-request-approval", "returns-replacements-refunds-rma", "inventory-count-variance", "finance-readiness-evidence"],
    permitted: ["Review financial evidence", "Make assigned Finance decisions", "Trace source records across modules"], prohibited: ["Post Warehouse receipt", "Approve physical stock as Finance", "Mutate read-only Insights evidence"],
    authority: ["Finance decisions require complete operational acceptance and effective assigned authority"], handoffs: ["Receives commitments, acceptance, valuation, and exception evidence", "Returns blockers to source owners and sends readiness outcomes"],
    denial: ["Payment readiness without acceptance and negative-stock approval are denied"], escalation: "Return incomplete evidence to its source owner and escalate unresolved control conflicts to Finance leadership.",
    evidence: ["Source-linked readiness decision", "Financial review evidence", "Blocker history"], training: ["Complete Finance orientation", "Prove source tracing and one authority denial"],
  },
  {
    id: "legal_compliance_lead", name: "Legal & Compliance Lead", aliases: ["Legal Lead", "Compliance Lead"],
    purpose: "Govern vendor accreditation, compliance evidence, and assigned authority controls.", department: "Legal and Compliance; review and administration scope.", owner: "Head of Legal and Compliance",
    access: ["Legal reviewer", "Compliance", "Legal administration"], queue: ["Vendor applications and renewals", "Evidence corrections", "Compliance and DOA governance handoffs"],
    tasks: ["vendor-accreditation-renewal", "department-doa-activation"], permitted: ["Invite and review vendors", "Decide assigned accreditation cases", "Review governed authority evidence"],
    prohibited: ["Submit evidence as the vendor", "Make Procurement or Warehouse transactions", "Activate unapproved authority"], authority: ["Accreditation and compliance decisions are limited to assigned cases and effective policy"],
    handoffs: ["Receives vendor declarations and control-owner requests", "Sends vendor eligibility and correction outcomes to vendors and Procurement"], denial: ["Cross-vendor access and unsupported approval are denied"],
    escalation: "Return deficient evidence with a specific reason; escalate policy conflicts to the accountable legal or compliance owner.", evidence: ["Vendor case evidence", "Review and validity decision", "Governance sign-off"],
    training: ["Complete Legal and Compliance orientation", "Review a negative and recovery case"],
  },
  {
    id: "marketing_events_lead", name: "Marketing & Events Lead", aliases: ["Events Coordinator"],
    purpose: "Coordinate events and accept accountable custody handoffs for event stock.", department: "Marketing; events coordination and administration scope.", owner: "Head of Marketing",
    access: ["Events coordinator and administration", "Warehouse marketing context"], queue: ["Event requests", "Warehouse handoffs", "Custody returns and reconciliation"],
    tasks: ["event-stock-custody"], permitted: ["Coordinate authorized events", "Accept and return event custody", "Resolve event data corrections"],
    prohibited: ["Post Warehouse stock movements", "Override Warehouse availability", "Mutate another event outside scope"], authority: ["May administer event records and custody attestations within assigned scope"],
    handoffs: ["Receives event needs and Warehouse allocations", "Sends approved demand, custody acknowledgement, and return evidence"], denial: ["Duplicate requests and out-of-scope event mutations are denied"],
    escalation: "Keep unresolved event custody open and escalate stock discrepancies to Operations Lead.", evidence: ["Event record", "Custody acceptance", "Use and return evidence"],
    training: ["Complete Events orientation", "Reconcile one event stock recovery scenario"],
  },
  {
    id: "product_owner", name: "Product Owner", aliases: ["Product Decision Owner"],
    purpose: "Decide product readiness and pricing and hand approved work to Operations.", department: "Product; product-owner decision scope.", owner: "Head of Product",
    access: ["Product owner", "Product contributor", "Events viewer"], queue: ["Readiness packages", "Pricing proposals", "Returned or stale decisions"],
    tasks: ["product-readiness-pricing-go-live"], permitted: ["Review and decide readiness", "Review and decide pricing", "Track operational acknowledgement"],
    prohibited: ["Make Operations acknowledgement", "Mutate Events as a viewer", "Decide stale or duplicate submissions"], authority: ["May decide current Product packages within assigned ownership"],
    handoffs: ["Receives contributor packages", "Sends approved readiness and pricing to Operations"], denial: ["Viewer mutation and stale or duplicate decisions are denied"],
    escalation: "Return incomplete packages to the contributor and escalate unresolved go-live dependencies to Product leadership.", evidence: ["Readiness and pricing decisions", "Package version", "Operations handoff"],
    training: ["Complete Product Owner orientation", "Decide current and stale scenarios"],
  },
  {
    id: "leadership_insights", name: "Leadership / Insights", aliases: ["Insights", "Leadership Viewer"],
    purpose: "Review role-scoped cross-module insights while preserving read-only governance and source traceability.", department: "Leadership and Technology; governed Insights scope.", owner: "Executive sponsor and Insights owner",
    access: ["Insights analyst, manager, or executive", "Warehouse BI read access"], queue: ["Role-scoped snapshots", "Cross-module readiness and trend review", "Source-record follow-up"],
    tasks: ["finance-readiness-evidence"], permitted: ["Read authorized insights", "Trace aggregates to source records", "Escalate data-quality concerns"],
    prohibited: ["Mutate operational records", "Use Insights to bypass source RLS", "Present stale data as current"], authority: ["Insights is advisory and read-only; business decisions remain with source owners"],
    handoffs: ["Receives governed read models", "Sends questions and data-quality findings to source owners"], denial: ["Operational mutations and unauthorized source access are denied"],
    escalation: "Record the affected metric and source link, then escalate to the data and module owners.", evidence: ["Snapshot identity", "Source links", "Data-quality escalation"],
    training: ["Complete Insights orientation", "Prove read-only denial and source tracing"],
  },
  {
    id: "vendor_representative", name: "Vendor Representative", aliases: ["Vendor Portal User"],
    purpose: "Submit and maintain evidence for the representative's own vendor accreditation case.", department: "External vendor; own-organization portal scope.", owner: "Vendor account owner and Legal administrator",
    access: ["Vendor portal for the assigned vendor"], queue: ["Invitations", "Draft or returned applications", "Renewal and correction requests"],
    tasks: ["vendor-accreditation-renewal"], permitted: ["View own case", "Submit declarations and evidence", "Correct returned application data"],
    prohibited: ["View another vendor", "Make accreditation decisions", "Access internal modules"], authority: ["May attest only to the represented vendor's facts and submissions"],
    handoffs: ["Receives invitation and correction requests", "Sends complete evidence to Legal and Compliance"], denial: ["Cross-vendor and internal route access are denied"],
    escalation: "Use the case support path for identity or upload issues and respond to the exact reviewer correction request.", evidence: ["Submitted declarations", "Attachments", "Correction and acknowledgement history"],
    training: ["Complete vendor accreditation orientation", "Submit and recover a returned application"],
  },
];

const ROLE_WORKSPACE_ROUTES = {
  platform_administrator: ["/admin/users", "/admin/departments", "/admin/doa", "/admin/audit"],
  general_employee: ["/procurement/requests/new", "/warehouse/fulfillment", "/events", "/work"],
  operations_associate: ["/warehouse/purchase-orders", "/warehouse/receiving", "/warehouse/quality", "/warehouse/storage", "/warehouse/fulfillment", "/warehouse/returns", "/warehouse/cycle-counts"],
  operations_lead: ["/warehouse/quality", "/warehouse/approvals", "/warehouse/exceptions", "/warehouse/locations", "/procurement/approvals", "/product"],
  procurement_lead: ["/procurement/requests", "/procurement/approvals", "/procurement/purchase-orders", "/warehouse/procurement"],
  finance_controller: ["/finance", "/procurement/purchase-orders", "/events"],
  legal_compliance_lead: ["/legal/", "/legal/invites/new", "/admin/doa"],
  marketing_events_lead: ["/events"],
  product_owner: ["/product", "/events"],
  leadership_insights: ["/insights", "/work"],
  vendor_representative: ["/vendor/"],
};

const WORKSPACE_MODULE_LABELS = {
  admin: "Administration",
  procurement: "Procurement",
  warehouse: "Warehouse",
  events: "Events",
  work: "My Work",
  finance: "Finance",
  legal: "Legal and Compliance",
  product: "Product",
  insights: "Insights",
  vendor: "Vendor Portal",
};

function roleWorkspaceMap(roleId) {
  return ROLE_WORKSPACE_ROUTES[roleId].map((landingRoute, index) => {
    const routeRoot = landingRoute.split("/").filter(Boolean)[0];
    return {
      id: `workspace-${index + 1}`,
      module: WORKSPACE_MODULE_LABELS[routeRoot],
      landingRoute,
    };
  });
}

function guidedSimulation(definition, workspaceMap) {
  const simulation = ROLE_SIMULATION_CONTRACTS[definition.id];
  if (!simulation) throw new Error(`Missing role simulation contract for ${definition.id}.`);
  const workspace = workspaceMap.find(({ id }) => id === simulation.workspaceId);
  if (!workspace) throw new Error(`Missing simulation workspace ${simulation.workspaceId} for ${definition.id}.`);
  return {
    id: `${definition.id}-guided-simulation`,
    title: `${definition.name} guided practice`,
    linkedTaskId: simulation.linkedTaskId,
    linkedStageId: simulation.linkedStageId,
    startRoute: workspace.landingRoute,
    workspaceId: simulation.workspaceId,
    actorRole: definition.id,
    mode: simulation.mode,
    scenario: simulation.scenario,
    successCriteria: definition.training,
    negativeScenario: definition.denial[0],
    recovery: definition.escalation,
  };
}

const ROLE_SOURCE_SECTIONS = [
  section("role-modules", "docs/USER_TRAINING_AND_OPERATIONS_MANUAL.md", "Role Modules", "role-summary"),
  section("role-procedure-checks", "docs/TRAINING_AND_HANDOVER_CONTENT.md", "Role procedure checks", "role-summary"),
];

function roleGuide(definition) {
  const workspaceMap = roleWorkspaceMap(definition.id);
  return {
    id: definition.id,
    type: "role",
    modeId: "roles",
    title: definition.name,
    label: definition.name,
    canonicalName: definition.name,
    displayedAliases: definition.aliases,
    purpose: definition.purpose,
    summary: definition.purpose,
    departmentAndScope: definition.department,
    assignmentOwner: definition.owner,
    requiredAccess: definition.access,
    workQueueOrStartConditions: definition.queue,
    linkedTasks: definition.tasks,
    permittedActions: definition.permitted,
    prohibitedActions: definition.prohibited,
    authorityLimits: definition.authority,
    handoffs: definition.handoffs,
    denialChecks: definition.denial,
    escalationAndRecovery: definition.escalation,
    evidenceResponsibilities: definition.evidence,
    trainingReadiness: definition.training,
    governingSources: unique(ROLE_SOURCE_SECTIONS.map(({ source }) => source)),
    owner: OWNER,
    effectiveDate: EFFECTIVE_DATE,
    lastReviewedDate: EFFECTIVE_DATE,
    applicableBuild: APPLICABLE_BUILD,
    status: "current",
    availability: "implemented",
    workspaceMap,
    guidedSimulation: guidedSimulation(definition, workspaceMap),
    relatedGuides: definition.tasks,
    sourceSections: ROLE_SOURCE_SECTIONS,
    screenshotReferences: [],
    sections: guideSections(ROLE_SECTION_IDS),
    keywords: unique([definition.name, ...definition.aliases, ...definition.tasks]),
  };
}

const SOURCE_ROOT_HEADINGS = {
  "user-manual": "Mwell Intra Standalone Operating Handbook",
  "process-reference-library": "Mwell Intra Process Reference Library",
  "migration-cutover-hypercare": "Migration, Cutover And Hypercare Runbook",
  "requirements-traceability": "Mwell Intra Launch Traceability Matrix",
  "retention-policy": "Mwell Intra — Data Retention & Privacy Policy (RA 10173)",
  "technical-functional-specification": "Mwell Intra Technical and Functional Specification",
  "training-handover": "Mwell Intra Training and Handover Content",
  "uat-issue-management": "UAT And Issue Management",
  "user-training-operations-manual": "User Training And Operations Manual",
  "ux-review-full-app": "UX / Layout / Information-Hierarchy Review — Full App",
  "ux-review-vendor-legal": "UX & Data-Scoping Review — Vendor Portal + Legal Accreditation",
  "warehouse-data-dictionary": "Warehouse W1 ERD and Data Dictionary",
  "warehouse-w1-release-evidence": "Warehouse W1 Release Evidence",
  "import-templates-guide": "Import Template Contract (v1)",
  "users-import-template": null,
  "vendors-import-template": null,
  "warehouse-locations-bins-import-template": null,
  "warehouse-opening-stock-import-template": null,
  "mwell-canonical-procurement-policy": "Mwell Canonical Procurement Policy Alignment",
  "mpic-procurement-policy": "MPIC Procurement Policy February 2025 - Maintained Extract",
  "vendor-to-pay-control-matrix": "Vendor-to-Pay Control Matrix",
  "wms-feedback-release": "WMS Feedback Release",
  "canonical-department-authority-remediation-release": "Canonical Department Authority Remediation",
  "mwell-canonical-procurement-policy-alignment-release": "Canonical Mwell Procurement Policy Alignment",
  "uat-transaction-certification-remediation-release": "UAT Transaction Certification Remediation",
  "policy-alignment-cutover": "Policy Alignment Cutover",
  "supabase-security-controls": "Supabase Security Controls",
  "uat-live-certification": "UAT Live Certification",
};

const SOURCE_REFERENCE_SECTIONS = HANDBOOK_DOCUMENTS.map((document) =>
  section(
    `source-${document.id}`,
    document.source,
    SOURCE_ROOT_HEADINGS[document.id],
    document.source.endsWith(".csv") ? "downloadable-resource" : "governed-reference",
  ));

const SYSTEM_GUIDES = [
  {
    id: "administration-configuration",
    title: "Administration and configuration",
    summary: "Identity, organization, delegated authority, and controlled platform configuration.",
    audience: ["administrator", "control-owner", "auditor"],
    related: ["department-doa-activation", "security-governance", "source-references"],
    sources: [
      section("doa-administration-system", "docs/manual/MWELL_INTRA_USER_MANUAL.md", "DOA Administration"),
      section("administrative-authority", "docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md", "Security and authority", "policy-basis"),
      section("platform-admin-procedure", "docs/manual/MWELL_INTRA_USER_MANUAL.md", "Platform Admin", "role-summary"),
    ],
    keywords: ["administration", "configuration", "users", "departments", "DOA"],
  },
  {
    id: "training-operational-readiness",
    title: "Training and operational readiness",
    summary: "Role learning, guided practice, negative scenarios, handover, and sign-off.",
    audience: ["trainer", "operator", "approver"],
    related: ["general_employee", "release-qa", "source-references"],
    sources: [
      section("training-outcomes", "docs/TRAINING_AND_HANDOVER_CONTENT.md", "Training outcomes", "role-summary"),
      section("training-format", "docs/USER_TRAINING_AND_OPERATIONS_MANUAL.md", "Training Format", "role-summary"),
      section("training-negative-scenarios", "docs/TRAINING_AND_HANDOVER_CONTENT.md", "Negative scenarios", "role-summary"),
      section("handover-evidence", "docs/TRAINING_AND_HANDOVER_CONTENT.md", "Handover evidence", "governed-reference"),
    ],
    keywords: ["training", "readiness", "simulation", "handover", "sign-off"],
  },
  {
    id: "architecture-data",
    title: "Architecture and data design",
    summary: "Runtime boundaries, functional contracts, data relationships, and traceability.",
    audience: ["architect", "developer", "auditor"],
    related: ["source-references", "security-governance"],
    sources: [
      section("runtime-architecture", "docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md", "Runtime architecture", "system-record"),
      section("warehouse-entity-relationships", "docs/WAREHOUSE_ERD_AND_DATA_DICTIONARY.md", "Entity relationships", "system-record"),
      section("traceability-evidence-rules", "docs/REQUIREMENTS_TRACEABILITY_MATRIX.md", "Evidence Rules", "governed-reference"),
    ],
    keywords: ["architecture", "data", "ERD", "traceability"],
  },
  {
    id: "infrastructure-continuity",
    title: "Infrastructure and continuity",
    summary: "Migration, cutover, rollback, continuity, and hypercare operations.",
    audience: ["infrastructure", "release-reviewer", "operator"],
    related: ["release-qa", "security-governance"],
    sources: [
      section("migration-preflight", "docs/MIGRATION_CUTOVER_HYPERCARE_RUNBOOK.md", "Preflight"),
      section("migration-cutover", "docs/MIGRATION_CUTOVER_HYPERCARE_RUNBOOK.md", "Cutover Sequence"),
      section("policy-release-preconditions", "docs/runbooks/POLICY-ALIGNMENT-CUTOVER.md", "Release Preconditions"),
      section("policy-rollback", "docs/runbooks/POLICY-ALIGNMENT-CUTOVER.md", "Rollback"),
    ],
    keywords: ["infrastructure", "migration", "cutover", "rollback", "hypercare"],
  },
  {
    id: "security-governance",
    title: "Security, privacy, governance, and retention",
    summary: "Access controls, policy authority, privacy, retention, and auditable evidence.",
    audience: ["control-owner", "security", "auditor", "infrastructure"],
    related: ["architecture-data", "release-qa"],
    sources: [
      section("retention-access-audit", "docs/RETENTION.md", "4. Access audit trail (`core.activity_log`)", "policy-basis"),
      section("security-release-controls", "docs/runbooks/SUPABASE-SECURITY-CONTROLS.md", "Required before production release", "system-record"),
      section("mwell-policy-authority", "docs/policy/MWELL_CANONICAL_POLICY_ALIGNMENT.md", "Authority", "policy-basis"),
      section("mpic-active-profile", "docs/policy/MPIC_PROCUREMENT_POLICY_FEBRUARY_2025.md", "Active profile", "policy-basis"),
      section("vendor-governing-sources", "docs/policy/VENDOR_TO_PAY_CONTROL_MATRIX.md", "Governing sources", "policy-basis"),
      section("vendor-functional-findings", "docs/UX-REVIEW-VENDOR-LEGAL.md", "Part 1 — Functional findings", "governed-reference"),
    ],
    keywords: ["security", "privacy", "governance", "retention", "policy"],
  },
  {
    id: "release-qa",
    title: "Release, QA, traceability, and evidence",
    summary: "UAT, issue management, certification, release history, and evidence controls.",
    audience: ["release-reviewer", "tester", "trainer", "auditor"],
    related: ["infrastructure-continuity", "source-references"],
    sources: [
      section("uat-entry-criteria", "docs/UAT_AND_ISSUE_MANAGEMENT.md", "Entry Criteria"),
      section("warehouse-local-proof", "docs/WAREHOUSE_W1_RELEASE_EVIDENCE.md", "Proven Locally", "governed-reference"),
      section("full-app-review", "docs/UX-REVIEW-FULL-APP.md", "1. Executive summary — the 5 highest-ROI changes", "governed-reference"),
      section("wms-release-verification", "docs/releases/2026-08-21-WMS-FEEDBACK-RELEASE.md", "Verification", "governed-reference"),
      section("department-release-verification", "docs/releases/2026-08-23-CANONICAL-DEPARTMENT-AUTHORITY.md", "Verification", "governed-reference"),
      section("policy-release-evidence", "docs/releases/2026-08-23-MWELL-CANONICAL-PROCUREMENT-POLICY-ALIGNMENT.md", "Verification evidence", "governed-reference"),
      section("uat-remediation-condition", "docs/releases/2026-08-23-UAT-TRANSACTION-CERTIFICATION-REMEDIATION.md", "Launch condition", "governed-reference"),
      section("live-release-decision", "docs/runbooks/UAT-LIVE-CERTIFICATION.md", "Release decision"),
    ],
    keywords: ["release", "QA", "UAT", "certification", "evidence"],
  },
  {
    id: "imports",
    title: "Governed imports and templates",
    summary: "Versioned user, vendor, location, bin, product, and opening-stock templates.",
    audience: ["operator", "trainer", "infrastructure"],
    related: ["warehouse-location-bin-setup", "source-references"],
    sources: [
      section("import-template-contract", "docs/import-templates/README.md", "Import Template Contract (v1)", "governed-reference"),
      section("users-import", "docs/import-templates/users-v1.csv", null, "downloadable-resource"),
      section("vendors-import", "docs/import-templates/vendors-v1.csv", null, "downloadable-resource"),
      section("warehouse-locations-import", "docs/import-templates/warehouse-locations-bins-v1.csv", null, "downloadable-resource"),
      section("warehouse-opening-stock-import", "docs/import-templates/warehouse-products-opening-stock-v1.csv", null, "downloadable-resource"),
    ],
    keywords: ["import", "template", "CSV", "users", "vendors", "warehouse"],
  },
  {
    id: "source-references",
    title: "Governed source register",
    summary: "The authoritative maintained source set and its presentation lineage.",
    audience: ["auditor", "release-reviewer", "control-owner"],
    related: ["architecture-data", "release-qa", "imports"],
    sources: SOURCE_REFERENCE_SECTIONS,
    keywords: ["source", "reference", "lineage", "document controls"],
  },
];

function systemGuide(definition) {
  return {
    id: definition.id,
    type: "system",
    modeId: "system",
    title: definition.title,
    label: definition.title,
    summary: definition.summary,
    audience: definition.audience,
    relatedGuides: definition.related,
    sourceSections: definition.sources,
    governingSources: unique(definition.sources.map(({ source }) => source)),
    screenshotReferences: [],
    keywords: definition.keywords,
    owner: OWNER,
    effectiveDate: EFFECTIVE_DATE,
    lastReviewedDate: EFFECTIVE_DATE,
    applicableBuild: APPLICABLE_BUILD,
    status: "current",
    availability: "implemented",
    sections: guideSections(["overview", "source-references", "document-controls"]),
  };
}

const HOME_GUIDE = {
  id: "home",
  type: "home",
  modeId: "home",
  title: "Mwell Intra",
  label: "Home",
  summary: "Start from the outcome you need, the role you perform, or the system responsibility you support.",
  relatedGuides: [
    "procurement-request-approval",
    "stock-receiving-putaway",
    "ecommerce-fulfillment-delivery",
    "general_employee",
    "source-references",
  ],
  sourceSections: [
    section("start-here", "docs/manual/MWELL_INTRA_USER_MANUAL.md", "Start Here", "canonical-guide-body"),
  ],
  governingSources: ["docs/manual/MWELL_INTRA_USER_MANUAL.md"],
  screenshotReferences: [
    "docs/manual/assets/knowledge-base/knowledge-home-desktop.png",
    "docs/manual/assets/knowledge-base/knowledge-home-mobile.png",
  ],
  keywords: ["home", "start", "task", "role", "system"],
  status: "current",
  availability: "implemented",
  sections: guideSections(["start-a-task", "learn-my-role", "manage-support", "recent-guides", "document-controls"]),
};

export const HANDBOOK_GUIDES = deepFreeze([
  HOME_GUIDE,
  ...TASK_DEFINITIONS.map(taskGuide),
  ...ROLE_DEFINITIONS.map(roleGuide),
  ...SYSTEM_GUIDES.map(systemGuide),
]);

export const APPROVED_SCREENSHOT_CONTRACTS = deepFreeze(
  EVIDENCE_APPROVAL_CONTRACT.stages.map((contract) => ({ ...contract })),
);

function stepInvariant(step) {
  const screenshot = step.screenshot ?? {};
  return {
    id: step.id,
    performingRole: step.performingRole,
    module: step.module,
    route: step.route,
    instruction: step.instruction,
    screenshot: {
      bindingId: screenshot.bindingId,
      status: screenshot.status,
      path: screenshot.path,
      mobilePath: screenshot.mobilePath,
      target: screenshot.target == null ? null : { ...screenshot.target },
      host: screenshot.host,
      route: screenshot.route,
      role: screenshot.role,
      capturedAt: screenshot.capturedAt,
      sourceCommit: screenshot.sourceCommit,
      certificationRun: screenshot.certificationRun,
      assertions: screenshot.assertions == null ? null : { ...screenshot.assertions },
      variants: (screenshot.variants ?? []).map((variant) => ({
        ...variant,
        targetBox: variant.targetBox == null ? null : { ...variant.targetBox },
      })),
    },
    expectedResult: step.expectedResult,
    dataRead: [...(step.dataRead ?? [])],
    dataWritten: [...(step.dataWritten ?? [])],
    evidenceRetained: [...(step.evidenceRetained ?? [])],
    nextHandoff: step.nextHandoff,
  };
}

function decisionBranchInvariant(branch) {
  return {
    label: branch.label,
    condition: branch.condition,
    target: { ...branch.target },
    outcome: branch.outcome,
    recoveryAction: branch.recoveryAction,
    terminal: branch.terminal,
  };
}

function decisionInvariant(decision) {
  return {
    id: decision.id,
    placement: { ...decision.placement },
    ownerRole: decision.ownerRole,
    question: decision.question,
    yesBranch: decisionBranchInvariant(decision.yesBranch),
    noBranch: decisionBranchInvariant(decision.noBranch),
  };
}

function invariantProjection(guide) {
  return {
    id: guide.id,
    type: guide.type,
    status: guide.status,
    availability: guide.availability,
    relatedGuides: [...guide.relatedGuides],
    relatedTasks: [...(guide.relatedTasks ?? [])],
    participatingRoles: [...(guide.participatingRoles ?? [])],
    linkedTasks: [...(guide.linkedTasks ?? [])],
    sourceSections: guide.sourceSections.map(
      ({ id, source, heading, purpose }) => ({ id, source, heading, purpose }),
    ),
    screenshotReferences: [...guide.screenshotReferences],
    steps: (guide.steps ?? []).map(stepInvariant),
    decisionPoints: (guide.decisionPoints ?? []).map(decisionInvariant),
    workspaceMap: (guide.workspaceMap ?? []).map(
      ({ id, module, landingRoute }) => ({ id, module, landingRoute }),
    ),
    guidedSimulation: guide.guidedSimulation
      ? { ...guide.guidedSimulation }
      : null,
  };
}

// The validator compares caller-supplied guide data with this immutable
// canonical projection, rather than accepting any structurally valid target.
export const HANDBOOK_GUIDE_INVARIANTS = deepFreeze(Object.fromEntries(
  HANDBOOK_GUIDES.map((guide) => [guide.id, invariantProjection(guide)]),
));

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "document";
}

function legacyArticleId(source) {
  return `doc-${slug(source.replace(/^docs\//, ""))}`;
}

function markdownHeadingRecords(source) {
  return [...source.matchAll(/^(#{1,6})\s+(.+?)\s*$/gm)].map((match) => ({
    depth: match[1].length,
    heading: match[2],
  }));
}

function markdownHeadings(source) {
  return markdownHeadingRecords(source).map(({ heading }) => heading);
}

const LEGACY_TARGET_BY_SOURCE_ID = {
  "user-manual": ["home", "home", "document-controls"],
  "process-reference-library": ["tasks", "procurement-request-approval", "document-controls"],
  "migration-cutover-hypercare": ["system", "infrastructure-continuity", "source-references"],
  "requirements-traceability": ["system", "architecture-data", "source-references"],
  "retention-policy": ["system", "security-governance", "source-references"],
  "technical-functional-specification": ["system", "architecture-data", "source-references"],
  "training-handover": ["roles", "general_employee", "capability-codes-and-document-controls"],
  "uat-issue-management": ["system", "release-qa", "source-references"],
  "user-training-operations-manual": ["roles", "general_employee", "capability-codes-and-document-controls"],
  "ux-review-full-app": ["system", "release-qa", "source-references"],
  "ux-review-vendor-legal": ["system", "security-governance", "source-references"],
  "warehouse-data-dictionary": ["system", "architecture-data", "source-references"],
  "warehouse-w1-release-evidence": ["system", "release-qa", "source-references"],
  "import-templates-guide": ["system", "imports", "source-references"],
  "users-import-template": ["system", "imports", "source-references"],
  "vendors-import-template": ["system", "imports", "source-references"],
  "warehouse-locations-bins-import-template": ["system", "imports", "source-references"],
  "warehouse-opening-stock-import-template": ["system", "imports", "source-references"],
  "mwell-canonical-procurement-policy": ["system", "security-governance", "source-references"],
  "mpic-procurement-policy": ["system", "security-governance", "source-references"],
  "vendor-to-pay-control-matrix": ["system", "security-governance", "source-references"],
  "wms-feedback-release": ["system", "release-qa", "source-references"],
  "canonical-department-authority-remediation-release": ["system", "release-qa", "source-references"],
  "mwell-canonical-procurement-policy-alignment-release": ["system", "release-qa", "source-references"],
  "uat-transaction-certification-remediation-release": ["system", "release-qa", "source-references"],
  "policy-alignment-cutover": ["system", "infrastructure-continuity", "source-references"],
  "supabase-security-controls": ["system", "security-governance", "source-references"],
  "uat-live-certification": ["system", "release-qa", "source-references"],
};

const EXPLICIT_LEGACY_HEADING_TARGETS = {
  "user-manual#Comprehensive Launch Flow": ["tasks", "procurement-request-approval", "flow"],
  "user-manual#Procurement Flow": ["tasks", "procurement-request-approval", "flow"],
  "user-manual#Procurement Role Procedures": ["tasks", "procurement-request-approval", "who-is-involved"],
  "user-manual#Requester": ["roles", "general_employee", "role-purpose-and-department"],
  "user-manual#Department Head": ["roles", "operations_lead", "role-purpose-and-department"],
  "user-manual#Procurement Lead": ["roles", "procurement_lead", "role-purpose-and-department"],
  "user-manual#Legal/Compliance": ["roles", "legal_compliance_lead", "role-purpose-and-department"],
  "user-manual#Technical Reviewer": ["tasks", "procurement-request-approval", "who-is-involved"],
  "user-manual#Warehouse/Operations": ["roles", "operations_associate", "role-purpose-and-department"],
  "user-manual#Finance Controller": ["roles", "finance_controller", "role-purpose-and-department"],
  "user-manual#Vendor Representative": ["roles", "vendor_representative", "role-purpose-and-department"],
  "user-manual#Platform Admin": ["roles", "platform_administrator", "role-purpose-and-department"],
  "user-manual#Vendor Accreditation Flow": ["tasks", "vendor-accreditation-renewal", "flow"],
  "user-manual#Warehouse Flow": ["tasks", "stock-receiving-putaway", "flow"],
  "user-manual#Receiving and Inspection": ["tasks", "stock-receiving-putaway", "steps"],
  "user-manual#Allocation, Events, and Returns": ["tasks", "event-stock-custody", "steps"],
  "user-manual#Ecommerce Fulfillment and Pick & Pack": ["tasks", "ecommerce-fulfillment-delivery", "steps"],
  "user-manual#Customer Returns and Original Release Matching": ["tasks", "returns-replacements-refunds-rma", "steps"],
  "user-manual#Troubleshooting and Recovery": ["system", "training-operational-readiness", "overview"],
  "user-manual#Flow-First Operational Journeys": ["system", "training-operational-readiness", "overview"],
  "user-manual#Ecommerce Fulfillment": ["tasks", "ecommerce-fulfillment-delivery", "steps"],
  "process-reference-library#Canonical 13-step procurement-to-payment overview": ["tasks", "procurement-request-approval", "flow"],
  "process-reference-library#Solicitation document and type classification": ["tasks", "procurement-request-approval", "decisions-and-exceptions"],
  "process-reference-library#Bid quorum and failed-bid recovery": ["tasks", "procurement-request-approval", "decisions-and-exceptions"],
  "process-reference-library#Exception eligibility": ["tasks", "procurement-request-approval", "decisions-and-exceptions"],
  "process-reference-library#Best-value award and recommendation variance": ["tasks", "procurement-request-approval", "decisions-and-exceptions"],
  "process-reference-library#Operating rules": ["tasks", "procurement-request-approval", "policy-basis"],
  "process-reference-library#Common vendor facts and declarations": ["tasks", "vendor-accreditation-renewal", "decisions-and-exceptions"],
  "process-reference-library#Entity evidence branches": ["tasks", "vendor-accreditation-renewal", "decisions-and-exceptions"],
  "process-reference-library#Technology-provider qualification": ["tasks", "vendor-accreditation-renewal", "decisions-and-exceptions"],
  "process-reference-library#Technology Provider MNDA Operating Extract": ["tasks", "vendor-accreditation-renewal", "decisions-and-exceptions"],
  "user-training-operations-manual#Role Modules": ["roles", "general_employee", "your-workspace"],
  "training-handover#Role procedure checks": ["roles", "general_employee", "guided-simulation"],
};

function exactLegacyHeadingTarget(document, heading) {
  const explicit = EXPLICIT_LEGACY_HEADING_TARGETS[`${document.id}#${heading}`];
  if (explicit) return explicit;
  for (const guide of HANDBOOK_GUIDES) {
    const sourceSection = guide.sourceSections.find(
      (item) => item.source === document.source && item.heading === heading,
    );
    if (sourceSection) return [guide.modeId, guide.id, sourceSection.id];
  }
  return null;
}

function legacySystemTarget(document) {
  const target = LEGACY_TARGET_BY_SOURCE_ID[document.id];
  if (target?.[0] === "system") return target;
  if (["training-handover", "user-training-operations-manual"].includes(document.id)) {
    return ["system", "training-operational-readiness", "source-references"];
  }
  return ["system", "source-references", "source-references"];
}

function buildLegacyRoutes(documents = HANDBOOK_DOCUMENTS, rootDirectory = root) {
  return documents.flatMap((document) => {
    const target = LEGACY_TARGET_BY_SOURCE_ID[document.id];
    if (!target) return [];
    const [modeId, guideId, headingId] = target;
    const articleId = legacyArticleId(document.source);
    const base = {
      legacyTabId: document.primaryTab,
      legacyArticleId: articleId,
      modeId,
      guideId,
      headingId,
    };
    const routes = [{ ...base, legacyHeadingId: null }];
    if (!document.source.endsWith(".md")) return routes;
    const absolute = path.join(rootDirectory, document.source);
    if (!existsSync(absolute)) return routes;
    const hierarchy = [];
    for (const { depth, heading } of markdownHeadingRecords(readFileSync(absolute, "utf8"))) {
      while (hierarchy.length && hierarchy.at(-1).depth >= depth) hierarchy.pop();
      const headingTarget =
        exactLegacyHeadingTarget(document, heading) ??
        hierarchy.at(-1)?.target ??
        legacySystemTarget(document);
      routes.push({
        ...base,
        modeId: headingTarget[0],
        guideId: headingTarget[1],
        headingId: headingTarget[2],
        legacyHeadingId: `${articleId}-${slug(heading)}`,
      });
      hierarchy.push({ depth, target: headingTarget });
    }
    return routes;
  });
}

export const LEGACY_ROUTES = deepFreeze(buildLegacyRoutes());

function isPopulated(value) {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "string" ? value.trim().length > 0 : value != null;
}

function duplicateValues(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([value]) => value);
}

function sameContract(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function screenshotContractKey(taskId, stageId) {
  return `${taskId}#${stageId}`;
}

function screenshotProjection(screenshot) {
  return {
    bindingId: screenshot?.bindingId,
    status: screenshot?.status,
    path: screenshot?.path,
    mobilePath: screenshot?.mobilePath,
      target: screenshot?.target,
    host: screenshot?.host,
    route: screenshot?.route,
    role: screenshot?.role,
    capturedAt: screenshot?.capturedAt,
    sourceCommit: screenshot?.sourceCommit,
    certificationRun: screenshot?.certificationRun,
    assertions: screenshot?.assertions,
    variants: screenshot?.variants,
  };
}

function approvedScreenshotProjection(contract) {
  return {
    bindingId: contract?.bindingId,
    path: contract?.path,
    mobilePath: contract?.mobilePath,
    route: contract?.route,
    role: contract?.role,
    target: contract?.target,
  };
}

function screenshotMatchesApproval(screenshot, contract) {
  if (!screenshot || !contract) return false;
  const target = screenshot.target ?? {};
  const approvedTarget = contract.target ?? {};
  let labelMatches = false;
  try {
    labelMatches = new RegExp(approvedTarget.labelPattern, "i").test(target.label ?? "");
  } catch {
    labelMatches = false;
  }
  return (
    screenshot.bindingId === contract.bindingId &&
    screenshot.path === contract.path &&
    screenshot.mobilePath === contract.mobilePath &&
    screenshot.route === contract.route &&
    screenshot.role === contract.role &&
    target.controlRole === approvedTarget.controlRole &&
    target.landmark === approvedTarget.landmark &&
    (approvedTarget.sourceContext == null || target.sourceContext === approvedTarget.sourceContext) &&
    labelMatches
  );
}

function fileSha256(absolutePath) {
  return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
}

function routeKey(route) {
  return JSON.stringify([
    route.legacyTabId,
    route.legacyArticleId,
    route.legacyHeadingId ?? null,
  ]);
}

export function validateHandbookGuides({
  modes = HANDBOOK_MODES,
  guides = HANDBOOK_GUIDES,
  legacyRoutes = LEGACY_ROUTES,
  documents = HANDBOOK_DOCUMENTS,
  invariants = HANDBOOK_GUIDE_INVARIANTS,
  approvedScreenshotContracts = APPROVED_SCREENSHOT_CONTRACTS,
  rootDirectory = root,
} = {}) {
  const errors = [];
  const warnings = [];
  const expectedModes = ["home", "tasks", "roles", "system"];
  const modeIds = modes.map(({ id }) => id);
  const modeIdSet = new Set(modeIds);

  if (JSON.stringify(modeIds) !== JSON.stringify(expectedModes)) {
    errors.push(`handbook modes must be exactly ${expectedModes.join(", ")} in order.`);
  }
  const modeCounts = new Map();
  for (const id of modeIds) modeCounts.set(id, (modeCounts.get(id) ?? 0) + 1);
  for (const [id, count] of modeCounts) {
    if (count > 1) errors.push(`mode ID ${id} is duplicated.`);
  }

  const guideCounts = new Map();
  for (const { id } of guides) guideCounts.set(id, (guideCounts.get(id) ?? 0) + 1);
  for (const [id, count] of guideCounts) {
    if (count > 1) errors.push(`guide ID ${id} is duplicated.`);
  }

  const guideById = new Map(guides.map((guide) => [guide.id, guide]));
  const documentSources = new Set(documents.map(({ source }) => source));
  const mappedSources = new Set();
  const selectorPurposes = new Map();
  const screenshotBindingCounts = new Map();
  const approvedScreenshotByStage = new Map(
    approvedScreenshotContracts.map((contract) => [
      screenshotContractKey(contract.taskId, contract.stageId),
      contract,
    ]),
  );

  for (const guide of guides) {
    if (!modeIdSet.has(guide.modeId)) {
      errors.push(`${guide.id} references missing mode ${guide.modeId}.`);
    }
    const expectedMode = guide.type === "task" ? "tasks"
      : guide.type === "role" ? "roles"
        : guide.type === "system" ? "system"
          : guide.type === "home" ? "home"
            : null;
    if (!expectedMode) errors.push(`${guide.id} has invalid guide type ${guide.type}.`);
    else if (guide.modeId !== expectedMode) {
      errors.push(`${guide.id} must use mode ${expectedMode}, not ${guide.modeId}.`);
    }
    if (guide.availability === "implemented" && guide.status !== "current") {
      errors.push(`implemented guide ${guide.id} cannot have ${guide.status} status.`);
    }

    const requiredFields = guide.type === "task" ? TASK_FIELDS
      : guide.type === "role" ? ROLE_FIELDS
        : [];
    for (const field of requiredFields) {
      if (!isPopulated(guide[field])) {
        errors.push(`${guide.type} ${guide.id} is missing required field ${field}.`);
      }
    }

    if (guide.type === "task") {
      for (const roleId of duplicateValues(guide.participatingRoles ?? [])) {
        errors.push(`task ${guide.id} has duplicate participating role ${roleId}.`);
      }
      for (const roleId of guide.participatingRoles ?? []) {
        const roleGuide = guideById.get(roleId);
        if (!roleGuide) {
          errors.push(`task ${guide.id} references missing role ${roleId}.`);
        } else if (roleGuide.type !== "role") {
          errors.push(`task ${guide.id} references non-role guide ${roleId}.`);
        }
      }
      for (const taskId of duplicateValues(guide.relatedTasks ?? [])) {
        errors.push(`task ${guide.id} has duplicate related task ${taskId}.`);
      }
      for (const taskId of guide.relatedTasks ?? []) {
        const relatedTask = guideById.get(taskId);
        if (!relatedTask) {
          errors.push(`task ${guide.id} references missing related task ${taskId}.`);
        } else if (relatedTask.type !== "task") {
          errors.push(`task ${guide.id} links to non-task guide ${taskId}.`);
        }
      }
      for (const stageId of duplicateValues((guide.steps ?? []).map(({ id }) => id))) {
        errors.push(`task ${guide.id} has duplicate stage ID ${stageId}.`);
      }
      for (const [index, stage] of (guide.steps ?? []).entries()) {
        const stageId = stage.id ?? `step-${index + 1}`;
        const stageContract = HANDBOOK_STAGE_CONTRACTS[`${guide.id}:${stageId}`];
        for (const field of TASK_STAGE_FIELDS) {
          if (!isPopulated(stage[field])) {
            errors.push(`task ${guide.id} stage ${stageId} is missing required field ${field}.`);
          }
        }
        const performingGuide = guideById.get(stage.performingRole);
        if (stage.performingRole && performingGuide?.type !== "role") {
          errors.push(`task ${guide.id} stage ${stageId} references invalid performing role ${stage.performingRole}.`);
        }
        if (stage.route && !stage.route.startsWith("/")) {
          errors.push(`task ${guide.id} stage ${stageId} has invalid route ${stage.route}.`);
        }
        if (!stageContract || !sameContract({
          expectedResult: stage.expectedResult,
          dataRead: stage.dataRead,
          dataWritten: stage.dataWritten,
          evidenceRetained: stage.evidenceRetained,
          nextHandoff: stage.nextHandoff,
        }, stageContract)) {
          errors.push(`task ${guide.id} stage ${stageId} violates its stage semantic contract.`);
        }
        if (stage.screenshot) {
          for (const field of ["bindingId", "status", "path", "mobilePath", "target", "host", "route", "role", "capturedAt", "sourceCommit", "certificationRun", "assertions", "variants"]) {
            if (!Object.hasOwn(stage.screenshot, field)) {
              errors.push(`task ${guide.id} stage ${stageId} screenshot is missing required field ${field}.`);
            }
          }
          if (isPopulated(stage.screenshot.bindingId)) {
            screenshotBindingCounts.set(
              stage.screenshot.bindingId,
              (screenshotBindingCounts.get(stage.screenshot.bindingId) ?? 0) + 1,
            );
          }
          if (!["pending", "certified"].includes(stage.screenshot.status)) {
            errors.push(`task ${guide.id} stage ${stageId} has invalid screenshot status ${stage.screenshot.status}.`);
          }
          if (
            stage.screenshot.status === "certified" &&
            (!isPopulated(stage.screenshot.path) || !isPopulated(stage.screenshot.target))
          ) {
            errors.push(`task ${guide.id} stage ${stageId} has incomplete certified screenshot evidence.`);
          }
          if (stage.screenshot.status === "certified") {
            const approved = approvedScreenshotByStage.get(
              screenshotContractKey(guide.id, stageId),
            );
            if (!approved) {
              errors.push(`task ${guide.id} stage ${stageId} has no approved screenshot contract.`);
            } else if (!screenshotMatchesApproval(stage.screenshot, approved)) {
              errors.push(`task ${guide.id} stage ${stageId} does not match its approved screenshot contract.`);
            }
            if (!guide.screenshotReferences.includes(stage.screenshot.path)) {
              errors.push(`task ${guide.id} stage ${stageId} certified screenshot is not bound to the guide.`);
            } else if (!existsSync(path.join(rootDirectory, stage.screenshot.path))) {
              errors.push(`task ${guide.id} stage ${stageId} certified screenshot file is missing.`);
            }
            if (!guide.screenshotReferences.includes(stage.screenshot.mobilePath)) {
              errors.push(`task ${guide.id} stage ${stageId} certified mobile screenshot is not bound to the guide.`);
            } else if (!existsSync(path.join(rootDirectory, stage.screenshot.mobilePath))) {
              errors.push(`task ${guide.id} stage ${stageId} certified mobile screenshot file is missing.`);
            }
          }
        }
      }

      const stageIds = new Set((guide.steps ?? []).map(({ id }) => id));
      const decisions = guide.decisionPoints ?? [];
      const decisionIds = new Set(decisions.map(({ id }) => id));
      for (const decisionId of duplicateValues(decisions.map(({ id }) => id))) {
        errors.push(`task ${guide.id} has duplicate decision ID ${decisionId}.`);
      }
      for (const [index, decision] of decisions.entries()) {
        const decisionId = decision.id ?? `decision-${index + 1}`;
        for (const field of TASK_DECISION_FIELDS) {
          if (!isPopulated(decision[field])) {
            errors.push(`task ${guide.id} decision ${decisionId} is missing required field ${field}.`);
          }
        }

        const placement = decision.placement ?? {};
        for (const field of TASK_DECISION_PLACEMENT_FIELDS) {
          if (!isPopulated(placement[field])) {
            errors.push(`task ${guide.id} decision ${decisionId} placement is missing required field ${field}.`);
          }
        }
        if (placement.position && !["before", "after"].includes(placement.position)) {
          errors.push(`task ${guide.id} decision ${decisionId} has invalid placement position ${placement.position}.`);
        }
        if (placement.stageId && !stageIds.has(placement.stageId)) {
          errors.push(`task ${guide.id} decision ${decisionId} uses missing placement stage ${placement.stageId}.`);
        }

        const ownerGuide = guideById.get(decision.ownerRole);
        if (decision.ownerRole && ownerGuide?.type !== "role") {
          errors.push(`task ${guide.id} decision ${decisionId} references invalid owner role ${decision.ownerRole}.`);
        } else if (decision.ownerRole && !(guide.participatingRoles ?? []).includes(decision.ownerRole)) {
          errors.push(`task ${guide.id} decision ${decisionId} owner ${decision.ownerRole} is not a participating role.`);
        }

        for (const branchName of ["yesBranch", "noBranch"]) {
          const branch = decision[branchName] ?? {};
          for (const field of TASK_DECISION_BRANCH_FIELDS) {
            if (!isPopulated(branch[field])) {
              errors.push(`task ${guide.id} decision ${decisionId} ${branchName} is missing required field ${field}.`);
            }
          }
          const target = branch.target ?? {};
          for (const field of TASK_DECISION_TARGET_FIELDS) {
            if (!isPopulated(target[field])) {
              errors.push(`task ${guide.id} decision ${decisionId} ${branchName} target is missing required field ${field}.`);
            }
          }
          if (target.type && !["stage", "decision", "outcome"].includes(target.type)) {
            errors.push(`task ${guide.id} decision ${decisionId} ${branchName} has invalid target type ${target.type}.`);
          } else if (target.type === "stage" && target.id && !stageIds.has(target.id)) {
            errors.push(`task ${guide.id} decision ${decisionId} ${branchName} targets missing stage ${target.id}.`);
          } else if (target.type === "decision" && target.id && !decisionIds.has(target.id)) {
            errors.push(`task ${guide.id} decision ${decisionId} ${branchName} targets missing decision ${target.id}.`);
          } else if (target.type === "outcome" && target.id && !TASK_DECISION_OUTCOMES.has(target.id)) {
            errors.push(`task ${guide.id} decision ${decisionId} ${branchName} targets invalid outcome ${target.id}.`);
          }
          if (target.type === "outcome" && branch.terminal !== true) {
            errors.push(`task ${guide.id} decision ${decisionId} ${branchName} outcome target must be terminal.`);
          }
          if (["stage", "decision"].includes(target.type) && branch.terminal !== false) {
            errors.push(`task ${guide.id} decision ${decisionId} ${branchName} resume target cannot be terminal.`);
          }
        }
      }
    }
    if (guide.type === "role") {
      for (const taskId of guide.linkedTasks ?? []) {
        const linkedTask = guideById.get(taskId);
        if (!linkedTask) {
          errors.push(`role ${guide.id} references missing task ${taskId}.`);
        } else if (linkedTask.type !== "task") {
          errors.push(`role ${guide.id} links to non-task guide ${taskId}.`);
        }
      }
      for (const [index, workspace] of (guide.workspaceMap ?? []).entries()) {
        const workspaceId = workspace.id ?? `workspace-${index + 1}`;
        for (const field of ROLE_WORKSPACE_FIELDS) {
          if (!isPopulated(workspace[field])) {
            errors.push(`role ${guide.id} workspace ${workspaceId} is missing required field ${field}.`);
          }
        }
        if (workspace.landingRoute && !workspace.landingRoute.startsWith("/")) {
          errors.push(`role ${guide.id} workspace ${workspaceId} has invalid landing route ${workspace.landingRoute}.`);
        }
      }
      const simulation = guide.guidedSimulation ?? {};
      for (const field of ROLE_SIMULATION_FIELDS) {
        if (!isPopulated(simulation[field])) {
          errors.push(`role ${guide.id} guided simulation is missing required field ${field}.`);
        }
      }
      const roleSimulationStage = ROLE_SIMULATION_STAGE_CONTRACTS[guide.id];
      const simulationUsesRoleStage = simulation.mode === "read-only-insight";
      if (
        simulation.linkedTaskId &&
        !simulationUsesRoleStage &&
        guideById.get(simulation.linkedTaskId)?.type !== "task"
      ) {
        errors.push(`role ${guide.id} guided simulation links to invalid task ${simulation.linkedTaskId}.`);
      }
      if (simulation.actorRole && simulation.actorRole !== guide.id) {
        errors.push(`role ${guide.id} guided simulation uses invalid actor ${simulation.actorRole}.`);
      }
      const workspaceRoutes = new Set((guide.workspaceMap ?? []).map(({ landingRoute }) => landingRoute));
      if (simulation.startRoute && !workspaceRoutes.has(simulation.startRoute)) {
        errors.push(`role ${guide.id} guided simulation starts outside its workspace map at ${simulation.startRoute}.`);
      }
      const simulationWorkspace = (guide.workspaceMap ?? []).find(({ id }) => id === simulation.workspaceId);
      if (simulation.workspaceId && !simulationWorkspace) {
        errors.push(`role ${guide.id} guided simulation references missing workspace ${simulation.workspaceId}.`);
      } else if (simulationWorkspace && simulationWorkspace.landingRoute !== simulation.startRoute) {
        errors.push(`role ${guide.id} guided simulation workspace does not match start route ${simulation.startRoute}.`);
      }
      const simulationTask = guideById.get(simulation.linkedTaskId);
      const simulationStage = simulationUsesRoleStage
        ? roleSimulationStage
        : simulationTask?.steps?.find(({ id }) => id === simulation.linkedStageId);
      if (simulation.linkedStageId && !simulationStage) {
        errors.push(`role ${guide.id} guided simulation links to invalid stage ${simulation.linkedStageId}.`);
      }
      if (!['performed-action', 'read-only-insight'].includes(simulation.mode)) {
        errors.push(`role ${guide.id} guided simulation has invalid mode ${simulation.mode}.`);
      } else if (simulation.mode === "performed-action" && simulationStage?.performingRole !== guide.id) {
        errors.push(`role ${guide.id} guided simulation action belongs to ${simulationStage?.performingRole ?? "no role"}.`);
      } else if (simulation.mode === "performed-action" && simulationStage?.route !== simulation.startRoute) {
        errors.push(`role ${guide.id} guided simulation does not start on stage route ${simulationStage?.route ?? "unknown"}.`);
      } else if (simulation.mode === "read-only-insight") {
        const expected = ROLE_SIMULATION_STAGE_CONTRACTS[guide.id];
        if (!expected) {
          errors.push(`role ${guide.id} guided simulation is missing a role-specific read-only stage contract.`);
        } else if (
          simulation.linkedTaskId !== expected.linkedTaskId ||
          simulation.linkedStageId !== expected.linkedStageId ||
          simulation.actorRole !== expected.actorRole ||
          simulation.startRoute !== expected.route ||
          simulation.workspaceId !== expected.workspaceId ||
          !sameContract(expected.dataWritten, ["None - read-only insight review"])
        ) {
          errors.push(`role ${guide.id} guided simulation does not match its read-only stage contract.`);
        } else if (!/read-only/i.test(guide.authorityLimits?.join(" ") ?? "")) {
          errors.push(`role ${guide.id} guided simulation is not an authorized read-only insight simulation.`);
        }
      }
    }

    if (!Array.isArray(guide.relatedGuides)) {
      errors.push(`${guide.id} must declare relatedGuides.`);
    } else {
      for (const relatedId of duplicateValues(guide.relatedGuides)) {
        errors.push(`${guide.id} has duplicate related guide ${relatedId}.`);
      }
      for (const relatedId of guide.relatedGuides) {
        if (!guideById.has(relatedId)) {
          errors.push(`${guide.id} references missing related guide ${relatedId}.`);
        }
      }
    }

    if (!Array.isArray(guide.sourceSections)) {
      errors.push(`${guide.id} must declare sourceSections.`);
    } else {
      const sectionCounts = new Map();
      const selectorCounts = new Map();
      for (const sourceSection of guide.sourceSections) {
        sectionCounts.set(sourceSection.id, (sectionCounts.get(sourceSection.id) ?? 0) + 1);
        const source = sourceSection.source;
        const selector = `${source}#${sourceSection.heading ?? ""}`;
        selectorCounts.set(selector, (selectorCounts.get(selector) ?? 0) + 1);
        if (!documentSources.has(source)) {
          errors.push(`${guide.id} references unclassified source ${source}.`);
          continue;
        }
        mappedSources.add(source);
        const absolute = path.join(rootDirectory, source);
        if (!existsSync(absolute)) {
          errors.push(`${guide.id} references missing source file ${source}.`);
          continue;
        }
        if (source.endsWith(".md")) {
          if (!isPopulated(sourceSection.heading)) {
            errors.push(`${guide.id} source section ${sourceSection.id} must declare an exact heading in ${source}.`);
          } else {
            const headings = markdownHeadings(readFileSync(absolute, "utf8"));
            if (!headings.includes(sourceSection.heading)) {
              errors.push(`${guide.id} references missing heading ${sourceSection.heading} in ${source}.`);
            }
          }
        } else if (sourceSection.heading != null) {
          errors.push(`${guide.id} must not declare a heading for non-Markdown source ${source}.`);
        }
        if (!isPopulated(sourceSection.purpose)) {
          errors.push(`${guide.id} source section ${sourceSection.id} is missing its presentation purpose.`);
        } else if (!PRESENTATION_PURPOSES.has(sourceSection.purpose)) {
          errors.push(`${guide.id} source section ${sourceSection.id} has invalid presentation purpose ${sourceSection.purpose}.`);
        }
        const purposes = selectorPurposes.get(selector) ?? new Set();
        purposes.add(sourceSection.purpose);
        selectorPurposes.set(selector, purposes);
      }
      for (const [id, count] of sectionCounts) {
        if (count > 1) errors.push(`${guide.id} has duplicate source section ID ${id}.`);
      }
      for (const [selector, count] of selectorCounts) {
        if (count > 1) errors.push(`${guide.id} has duplicate source selector ${selector}.`);
      }
    }

    for (const source of guide.governingSources ?? []) {
      if (!documentSources.has(source)) {
        errors.push(`${guide.id} references unclassified governing source ${source}.`);
      } else {
        mappedSources.add(source);
      }
    }

    if (!Array.isArray(guide.screenshotReferences)) {
      errors.push(`${guide.id} must declare screenshotReferences.`);
    } else {
      for (const screenshot of duplicateValues(guide.screenshotReferences)) {
        errors.push(`${guide.id} has duplicate screenshot reference ${screenshot}.`);
      }
      for (const screenshot of guide.screenshotReferences) {
        const absolute = path.resolve(rootDirectory, screenshot);
        const relative = path.relative(rootDirectory, absolute);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          errors.push(`${guide.id} references screenshot outside the handbook root: ${screenshot}.`);
        } else if (!existsSync(absolute)) {
          errors.push(`${guide.id} references missing screenshot ${screenshot}.`);
        }
      }
    }

    const canonicalSectionCounts = new Map();
    for (const canonicalSection of guide.sections ?? []) {
      canonicalSectionCounts.set(canonicalSection.id, (canonicalSectionCounts.get(canonicalSection.id) ?? 0) + 1);
    }
    for (const [id, count] of canonicalSectionCounts) {
      if (count > 1) errors.push(`${guide.id} has duplicate canonical section ID ${id}.`);
    }

    const invariant = invariants[guide.id];
    if (invariant) {
      if (!sameContract(guide.relatedGuides, invariant.relatedGuides)) {
        errors.push(`${guide.id} violates its related guide contract.`);
      }
      if (!sameContract(guide.relatedTasks ?? [], invariant.relatedTasks)) {
        errors.push(`${guide.id} violates its related task contract.`);
      }
      if (!sameContract(guide.participatingRoles ?? [], invariant.participatingRoles)) {
        errors.push(`${guide.id} violates its participating role contract.`);
      }
      if (!sameContract(guide.linkedTasks ?? [], invariant.linkedTasks)) {
        errors.push(`${guide.id} violates its linked task contract.`);
      }
      const sourceContract = (guide.sourceSections ?? []).map(
        ({ id, source, heading, purpose }) => ({ id, source, heading, purpose }),
      );
      if (!sameContract(sourceContract, invariant.sourceSections)) {
        errors.push(`${guide.id} violates its source section contract.`);
      }
      if (!sameContract(guide.screenshotReferences, invariant.screenshotReferences)) {
        errors.push(`${guide.id} violates its screenshot reference contract.`);
      }
      const stepContract = (guide.steps ?? []).map(stepInvariant);
      if (!sameContract(stepContract, invariant.steps)) {
        errors.push(`${guide.id} violates its step contract.`);
      }
      const decisionContract = (guide.decisionPoints ?? []).map(decisionInvariant);
      if (!sameContract(decisionContract, invariant.decisionPoints)) {
        errors.push(`${guide.id} violates its decision contract.`);
      }
      if (!sameContract(guide.workspaceMap ?? [], invariant.workspaceMap)) {
        errors.push(`${guide.id} violates its workspace map contract.`);
      }
      if (!sameContract(guide.guidedSimulation ?? null, invariant.guidedSimulation)) {
        errors.push(`${guide.id} violates its guided simulation contract.`);
      }
      if (guide.status !== invariant.status || guide.availability !== invariant.availability) {
        errors.push(`${guide.id} violates its implementation status contract.`);
      }
    }
  }

  for (const [bindingId, count] of screenshotBindingCounts) {
    if (count > 1) errors.push(`duplicate screenshot binding ${bindingId}.`);
  }

  for (const [selector, purposes] of selectorPurposes) {
    if (purposes.size > 1) {
      errors.push(`source fragment ${selector} has conflicting presentation purposes: ${[...purposes].sort().join(", ")}.`);
    }
  }
  for (const { source } of documents) {
    if (!mappedSources.has(source)) {
      errors.push(`maintained source ${source} is not mapped to a guide.`);
    }
  }

  const legacyCounts = new Map();
  for (const route of legacyRoutes) {
    const key = routeKey(route);
    legacyCounts.set(key, (legacyCounts.get(key) ?? 0) + 1);
    const targetGuide = guideById.get(route.guideId);
    if (!targetGuide) {
      errors.push(`legacy route ${key} targets missing guide ${route.guideId}.`);
      continue;
    }
    if (route.modeId !== targetGuide.modeId) {
      errors.push(`legacy route ${key} targets ${route.guideId} through invalid mode ${route.modeId}.`);
    }
    const targetHeadings = new Set([
      ...(targetGuide.sections ?? []).map(({ id }) => id),
      ...(targetGuide.sourceSections ?? []).map(({ id }) => id),
    ]);
    if (!targetHeadings.has(route.headingId)) {
      errors.push(`legacy route ${key} targets missing heading ${route.headingId} in ${route.guideId}.`);
    }
  }
  for (const [key, count] of legacyCounts) {
    if (count > 1) errors.push(`legacy route ${key} is duplicated.`);
  }

  const expectedLegacyRoutes = buildLegacyRoutes(documents, rootDirectory);
  const expectedLegacyByKey = new Map(
    expectedLegacyRoutes.map((route) => [routeKey(route), route]),
  );
  const expectedLegacyKeys = new Set(expectedLegacyByKey.keys());
  const actualLegacyKeys = new Set(legacyRoutes.map(routeKey));
  for (const key of expectedLegacyKeys) {
    if (!actualLegacyKeys.has(key)) errors.push(`legacy route ${key} is missing.`);
  }
  for (const key of actualLegacyKeys) {
    if (!expectedLegacyKeys.has(key)) errors.push(`legacy route ${key} does not match a maintained article or heading.`);
  }
  for (const route of legacyRoutes) {
    const key = routeKey(route);
    const expected = expectedLegacyByKey.get(key);
    if (!expected) continue;
    if (
      route.modeId !== expected.modeId ||
      route.guideId !== expected.guideId ||
      route.headingId !== expected.headingId
    ) {
      errors.push(
        `legacy route ${key} must target ${expected.modeId}/${expected.guideId}#${expected.headingId}.`,
      );
    }
  }

  return { warnings, errors };
}

export function validateHandbookEvidenceProvenance({
  manifest = EVIDENCE_MANIFEST,
  approval = EVIDENCE_APPROVAL_CONTRACT,
  ciAttestation = CI_ATTESTATION_CONTRACT,
  sourceCommit = manifest.sourceCommit,
  rootDirectory = root,
  now = new Date(),
} = {}) {
  const errors = [];
  const captureTime = Date.parse(manifest.generatedAt ?? "");
  const reviewTime = Date.parse(approval.reviewedAt ?? "");
  const currentTime = now instanceof Date ? now.getTime() : Date.parse(now);
  const maximumAgeMs = 7 * 24 * 60 * 60 * 1000;
  const futureToleranceMs = 5 * 60 * 1000;
  if (
    !Number.isFinite(captureTime) || !Number.isFinite(currentTime) ||
    captureTime > currentTime + futureToleranceMs || currentTime - captureTime > maximumAgeMs
  ) {
    errors.push("handbook evidence has future or stale capture metadata.");
  }
  if (!Number.isFinite(reviewTime) || reviewTime < captureTime || reviewTime > currentTime + futureToleranceMs) {
    errors.push("handbook evidence approval timestamp is missing, pre-capture, or future-dated.");
  }
  if (!/^[a-f0-9]{40}$/.test(sourceCommit ?? "")) {
    errors.push("handbook evidence source commit metadata is invalid.");
  } else {
    try {
      execFileSync("git", ["cat-file", "-e", `${sourceCommit}^{commit}`], { cwd: rootDirectory, stdio: "ignore" });
    } catch {
      errors.push(`handbook evidence source commit ${sourceCommit} is not a local commit.`);
    }
  }
  errors.push(...validateAttestation(ciAttestation));
  if (ciAttestation.headSha !== sourceCommit || ciAttestation.headSha !== manifest.sourceCommit || ciAttestation.headSha !== approval.sourceCommit) {
    errors.push("handbook evidence source commit must match the exact attested head SHA.");
  }
  if (ciAttestation.runUrl !== manifest.certificationRun || ciAttestation.runUrl !== approval.certificationRun) {
    errors.push("handbook evidence certification run must match the exact CI attestation.");
  }
  if (manifest.sourceCommit !== approval.sourceCommit || sourceCommit !== approval.sourceCommit) {
    errors.push("handbook evidence source commit is not independently approved for this capture.");
  }
  if (manifest.certificationRun !== approval.certificationRun) {
    errors.push("handbook evidence certification run is not independently approved.");
  }
  if (approval.verificationMode === "ci-run") {
    if (!/^https:\/\/github\.com\/normanwashere\/mwell-intra\/actions\/runs\/32653705717$/.test(approval.certificationRun ?? "")) {
      errors.push("handbook evidence CI run is not independently verifiable by the CI attestation.");
    }
  } else if (approval.verificationMode !== "local-governed-evidence") {
    errors.push("handbook evidence verification mode is not governed.");
  }
  const manifestAbsolute = path.join(rootDirectory, "docs/manual/assets/knowledge-base/task-stage-evidence.json");
  if (!existsSync(manifestAbsolute) || fileSha256(manifestAbsolute) !== approval.manifestSha256) {
    errors.push("handbook evidence manifest does not match the independently reviewed digest.");
  }
  return { warnings: [], errors };
}

export function validateHandbookEvidenceCoverage({
  guides = HANDBOOK_GUIDES,
  approvedScreenshotContracts = APPROVED_SCREENSHOT_CONTRACTS,
  rootDirectory = root,
} = {}) {
  const errors = [];
  const warnings = [];
  const expectedHost = "https://mwell-intra-uat.vercel.app";
  const earliestCapture = Date.parse("2026-08-23T00:00:00.000Z");
  const usedPaths = new Map();
  const approvedScreenshotByStage = new Map(
    approvedScreenshotContracts.map((contract) => [
      screenshotContractKey(contract.taskId, contract.stageId),
      contract,
    ]),
  );
  const canonicalApprovalByStage = new Map(
    EVIDENCE_APPROVAL_CONTRACT.stages.map((contract) => [contract.bindingId, contract]),
  );

  errors.push(...validateHandbookEvidenceProvenance({ rootDirectory }).errors);

  for (const guide of guides.filter(({ type }) => type === "task")) {
    const references = new Set(guide.screenshotReferences ?? []);
    for (const stage of guide.steps ?? []) {
      const screenshot = stage.screenshot ?? {};
      const target = screenshot.target ?? {};
      const approved = approvedScreenshotByStage.get(
        screenshotContractKey(guide.id, stage.id),
      );
      const canonicalApproval = canonicalApprovalByStage.get(screenshot.bindingId);
      const prefix = `task ${guide.id} stage ${stage.id}`;
      if (screenshot.status !== "certified" || !approved) {
        errors.push(
          `${prefix} has pending certified screenshot evidence.`,
        );
        continue;
      }
      if (!canonicalApproval || !sameContract(approvedScreenshotProjection(approved), approvedScreenshotProjection(canonicalApproval))) {
        errors.push(`${prefix} does not match its canonical actionable target approval.`);
      }
      if (
        approved.target?.sourceContext != null &&
        target.sourceContext !== approved.target.sourceContext
      ) {
        errors.push(`${prefix} has wrong source context for its certified evidence.`);
      }
      if (!screenshotMatchesApproval(screenshot, approved)) {
        errors.push(`${prefix} does not match its approved screenshot evidence contract.`);
      }
      if (
        approved.taskId !== guide.id ||
        approved.stageId !== stage.id ||
        screenshot.bindingId !== `${guide.id}:${stage.id}`
      ) {
        errors.push(`${prefix} has mismatched task or stage binding metadata.`);
      }
      if (screenshot.host !== expectedHost || screenshot.host !== approved.host) {
        errors.push(`${prefix} has an invalid UAT evidence host.`);
      }
      if (screenshot.route !== stage.route || screenshot.route !== approved.route) {
        errors.push(`${prefix} has mismatched route evidence.`);
      }
      if (screenshot.role !== stage.performingRole || screenshot.role !== approved.role) {
        errors.push(`${prefix} has mismatched persona evidence.`);
      }
      if (
        !isPopulated(target.label) ||
        !isPopulated(target.landmark) ||
        !isPopulated(target.controlRole) ||
        !screenshotMatchesApproval(screenshot, approved)
      ) {
        errors.push(`${prefix} has invalid target evidence.`);
      }
      const screenshotTime = Date.parse(screenshot.capturedAt);
      const currentTime = Date.now();
      if (
        !Number.isFinite(screenshotTime) || screenshotTime < earliestCapture ||
        screenshotTime > currentTime + 5 * 60 * 1000 || currentTime - screenshotTime > 7 * 24 * 60 * 60 * 1000
      ) {
        errors.push(`${prefix} has future or stale capture metadata; stale or invalid capture metadata is rejected.`);
      }
      if (!/^[a-f0-9]{40}$/.test(screenshot.sourceCommit ?? "")) {
        errors.push(`${prefix} has invalid source commit metadata.`);
      }
      if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(screenshot.certificationRun ?? "")) {
        errors.push(`${prefix} has invalid certification run metadata.`);
      }
      const assertions = screenshot.assertions ?? {};
      const assertionContract = {
        hostMatched: true,
        routeMatched: true,
        roleMatched: true,
        targetVisible: true,
        loginBounce: false,
        browserErrors: 0,
        horizontalOverflow: false,
        sensitiveData: "synthetic-uat-only",
        numberedCallout: true,
      };
      if (!sameContract(assertions, assertionContract)) {
        errors.push(`${prefix} does not retain the required live-capture assertions.`);
      }
      const variants = screenshot.variants ?? [];
      const variantIds = variants.map(({ viewport }) => viewport).sort();
      if (!sameContract(variantIds, ["desktop", "mobile"])) {
        errors.push(`${prefix} must retain exactly one desktop and one mobile capture.`);
      }
      for (const variant of variants) {
        const expectedSize = variant.viewport === "desktop"
          ? { width: 1440, height: 900 }
          : { width: 390, height: 844 };
        if (variant.width !== expectedSize.width || variant.height !== expectedSize.height) {
          errors.push(`${prefix} ${variant.viewport} capture has invalid dimensions.`);
        }
        if (!isPopulated(variant.targetLabel) || !isPopulated(variant.targetBox)) {
          errors.push(`${prefix} ${variant.viewport} capture has no visible target binding.`);
        }
        const box = variant.targetBox ?? {};
        if (
          ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
          box.width <= 0 || box.height <= 0 || box.x < 0 || box.y < 0 ||
          box.x + box.width > variant.width + 1 ||
          box.y + box.height > variant.height + 1
        ) {
          errors.push(`${prefix} ${variant.viewport} capture has an invalid target box.`);
        }
        if (!references.has(variant.path)) {
          errors.push(`${prefix} ${variant.viewport} capture is not bound to the guide.`);
          continue;
        }
        const absolute = path.resolve(rootDirectory, variant.path ?? "");
        const relative = path.relative(rootDirectory, absolute);
        if (relative.startsWith("..") || path.isAbsolute(relative) || !existsSync(absolute)) {
          errors.push(`${prefix} ${variant.viewport} capture file is missing or outside the handbook root.`);
          continue;
        }
        if (!/^[a-f0-9]{64}$/.test(variant.sha256 ?? "") || fileSha256(absolute) !== variant.sha256) {
          errors.push(`${prefix} ${variant.viewport} capture hash does not match the certified image.`);
        }
        const previous = usedPaths.get(variant.path);
        if (previous && previous !== screenshot.bindingId) {
          errors.push(`${prefix} duplicates screenshot path already bound to ${previous}.`);
        } else {
          usedPaths.set(variant.path, screenshot.bindingId);
        }
      }
    }
  }

  if (approvedScreenshotContracts.length !== 52) {
    errors.push(`approved screenshot registry contains ${approvedScreenshotContracts.length} contracts instead of 52.`);
  }

  return { warnings, errors };
}
