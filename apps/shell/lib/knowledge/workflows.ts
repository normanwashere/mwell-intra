import type { KnowledgeFlow, KnowledgeFlowNode } from "./types";

const node = (
  id: string,
  type: KnowledgeFlowNode["type"],
  title: string,
  owners: string[],
  body: string,
  outcome?: string,
  exception?: string,
): KnowledgeFlowNode => ({
  id,
  type,
  title,
  ownerRoleIds: owners,
  body,
  outcome,
  exception,
});

interface DecisionRoute {
  primaryLabel: string;
  primaryTo?: string;
  alternatives: Array<{
    label: string;
    to?: string;
    title?: string;
    outcome: "success" | "exception" | "neutral";
  }>;
}

const DECISION_ROUTES: Record<string, DecisionRoute> = {
  "access-decision": {
    primaryLabel: "Access correct",
    primaryTo: "access-end",
    alternatives: [
      { label: "Access incorrect", to: "access-fix", outcome: "neutral" },
    ],
  },
  "p2p-approve": {
    primaryLabel: "Approved",
    alternatives: [
      {
        label: "Rejected or returned",
        title: "Request stopped for correction",
        outcome: "exception",
      },
    ],
  },
  "vendor-review": {
    primaryLabel: "Evidence complete",
    alternatives: [
      {
        label: "Correction required",
        title: "Application returned to vendor",
        outcome: "exception",
      },
    ],
  },
  "vendor-decide": {
    primaryLabel: "Approved",
    alternatives: [
      {
        label: "Conditional",
        title: "Conditional accreditation recorded",
        outcome: "neutral",
      },
      {
        label: "Rejected",
        title: "Accreditation rejected",
        outcome: "exception",
      },
    ],
  },
  "receive-inspect": {
    primaryLabel: "Accept",
    alternatives: [
      {
        label: "Hold",
        title: "Stock placed on quality hold",
        outcome: "exception",
      },
      {
        label: "Damaged or unavailable",
        title: "Stock recorded as non-available",
        outcome: "exception",
      },
      {
        label: "Return to vendor",
        title: "Return disposition recorded",
        outcome: "exception",
      },
    ],
  },
  "event-return": {
    primaryLabel: "Fully reconciled",
    alternatives: [
      {
        label: "Variance found",
        title: "Inventory exception opened",
        outcome: "exception",
      },
    ],
  },
  "count-review": {
    primaryLabel: "Approval required",
    alternatives: [
      { label: "No variance", to: "count-end", outcome: "success" },
    ],
  },
  "price-review": {
    primaryLabel: "Approved",
    alternatives: [
      {
        label: "Rejected",
        title: "Price proposal rejected",
        outcome: "exception",
      },
    ],
  },
  "doa-validate": {
    primaryLabel: "Valid",
    alternatives: [
      {
        label: "Invalid",
        title: "DOA draft returned for correction",
        outcome: "exception",
      },
    ],
  },
  "recover-check": {
    primaryLabel: "Not saved",
    alternatives: [
      { label: "Already saved", to: "recover-end", outcome: "success" },
    ],
  },
};

const governed = (
  id: string,
  title: string,
  summary: string,
  roles: string[],
  nodes: KnowledgeFlowNode[],
): KnowledgeFlow => {
  const expandedNodes: KnowledgeFlowNode[] = [...nodes];
  const edges: KnowledgeFlow["edges"] = [];
  for (const [index, item] of nodes.entries()) {
    if (item.type === "terminal") continue;
    const next = nodes[index + 1];
    const decision = DECISION_ROUTES[item.id];
    if (!decision) {
      if (next) edges.push({ from: item.id, to: next.id });
      continue;
    }
    const primaryTo = decision.primaryTo ?? next?.id;
    if (primaryTo)
      edges.push({
        from: item.id,
        to: primaryTo,
        label: decision.primaryLabel,
        outcome: "success",
      });
    for (const [
      alternativeIndex,
      alternative,
    ] of decision.alternatives.entries()) {
      let target = alternative.to;
      if (!target) {
        target = `${item.id}-outcome-${alternativeIndex + 1}`;
        expandedNodes.push({
          id: target,
          type: "terminal",
          title: alternative.title ?? alternative.label,
          ownerRoleIds: item.ownerRoleIds,
          body:
            item.exception ??
            `The ${alternative.label.toLowerCase()} outcome is recorded with its reason and evidence.`,
        });
      }
      edges.push({
        from: item.id,
        to: target,
        label: alternative.label,
        outcome: alternative.outcome,
      });
    }
  }
  return {
    id,
    title,
    summary,
    roles,
    startNodeId: nodes[0]!.id,
    nodes: expandedNodes.map((item) => ({
      ...item,
      evidenceId: `ev-${item.id}`,
    })),
    edges,
  };
};

export const KNOWLEDGE_FLOWS: KnowledgeFlow[] = [
  governed(
    "identity-and-access",
    "Identity and access",
    "From sign-in through role resolution, denied access, and administrator correction.",
    ["core_staff_only", "platform_admin", "vendor_portal"],
    [
      node(
        "access-start",
        "start",
        "User signs in",
        ["core_staff_only", "vendor_portal"],
        "Enter the approved Mwell identity and password.",
      ),
      node(
        "access-resolve",
        "system",
        "Intra resolves profile and roles",
        ["platform_admin"],
        "Supabase Auth restores the session and scoped role metadata.",
        "Only permitted modules appear.",
      ),
      node(
        "access-decision",
        "decision",
        "Access correct?",
        ["core_staff_only", "vendor_portal"],
        "Confirm the expected module and task are visible.",
        undefined,
        "If denied, capture the route and contact the platform administrator.",
      ),
      node(
        "access-fix",
        "action",
        "Administrator corrects assignment",
        ["platform_admin"],
        "Review the user profile, role scope, status, and audit trail.",
        "A new session receives corrected access.",
      ),
      node(
        "access-end",
        "terminal",
        "User resumes work",
        ["core_staff_only", "vendor_portal"],
        "Return to the intended task and verify access.",
      ),
    ],
  ),
  governed(
    "procure-to-pay",
    "Procure to pay",
    "Request, sourcing, approval, PO, receiving, acceptance, and payment readiness.",
    [
      "procurement_requester",
      "procurement_officer",
      "procurement_approver",
      "procurement_finance",
      "procurement_admin",
      "legal_reviewer",
      "warehouse_procurement",
      "warehouse_logistics_supervisor",
    ],
    [
      node(
        "p2p-start",
        "start",
        "Requester drafts purchase request",
        ["procurement_requester"],
        "Enter category, line items, justification, cost context, dates, and evidence.",
      ),
      node(
        "p2p-route",
        "action",
        "Procurement confirms sourcing route",
        ["procurement_officer"],
        "Validate competition, exception pack, vendor accreditation, and policy route.",
        undefined,
        "Return incomplete or unsupported requests for clarification.",
      ),
      node(
        "p2p-approve",
        "decision",
        "Approvers decide",
        ["procurement_approver", "procurement_finance"],
        "Review only the assigned DOA step and supporting record.",
        "Approved requests become eligible for PO authoring.",
        "A rejection or return records the reason and stops progression.",
      ),
      node(
        "p2p-po",
        "action",
        "Procurement authors and issues PO",
        ["procurement_officer", "procurement_admin"],
        "Use the approved request and accredited vendor; preserve line and value controls.",
      ),
      node(
        "p2p-receive",
        "handoff",
        "Warehouse receives supply",
        ["warehouse_procurement", "warehouse_logistics_supervisor"],
        "Match the PO, quantities, serials/lots, and delivery evidence.",
      ),
      node(
        "p2p-accept",
        "action",
        "Business and Finance confirm acceptance",
        ["procurement_finance", "procurement_requester"],
        "Confirm delivery, inspection, and acceptance evidence.",
      ),
      node(
        "p2p-end",
        "terminal",
        "Payment readiness established",
        ["procurement_finance"],
        "The governed record contains approved request, PO, receipt, and acceptance evidence.",
      ),
    ],
  ),
  governed(
    "vendor-accreditation",
    "Vendor accreditation",
    "Invitation through application, evidence, instruments, decision, and renewal.",
    [
      "legal_admin",
      "legal_reviewer",
      "legal_compliance",
      "vendor_portal",
      "procurement_officer",
    ],
    [
      node(
        "vendor-start",
        "start",
        "Legal invites vendor",
        ["legal_admin"],
        "Create the case with verified company and contact details.",
      ),
      node(
        "vendor-apply",
        "action",
        "Vendor completes application",
        ["vendor_portal"],
        "Submit entity, ownership, risk, data-handling, documentary, and technology information.",
      ),
      node(
        "vendor-review",
        "decision",
        "Legal reviews evidence",
        ["legal_reviewer", "legal_compliance"],
        "Approve, reject, or request correction for each governed requirement.",
        undefined,
        "Missing or expired evidence returns to the vendor with a specific reason.",
      ),
      node(
        "vendor-sign",
        "action",
        "Parties execute required instruments",
        ["vendor_portal", "legal_reviewer"],
        "Complete MNDA and applicable service-provider instruments with lifecycle evidence.",
      ),
      node(
        "vendor-decide",
        "decision",
        "Legal records accreditation decision",
        ["legal_reviewer", "legal_admin"],
        "Confirm checklist completion, risk disposition, and decision authority.",
        "Approved status unblocks eligible procurement awards.",
        "Rejected or conditional cases retain reasons and remediation.",
      ),
      node(
        "vendor-end",
        "terminal",
        "Vendor monitored for renewal",
        ["legal_compliance", "vendor_portal"],
        "Track expiry, renewal evidence, and material changes.",
      ),
    ],
  ),
  governed(
    "warehouse-setup",
    "Warehouse setup",
    "Create locations, storage areas, bins, and permitted operation routes.",
    ["warehouse_admin", "warehouse_logistics_supervisor"],
    [
      node(
        "setup-start",
        "start",
        "Create warehouse location",
        ["warehouse_admin"],
        "Define the site and operational identity.",
      ),
      node(
        "setup-area",
        "action",
        "Create storage area",
        ["warehouse_admin"],
        "Set area type, restrictions, and capacity context.",
      ),
      node(
        "setup-bin",
        "action",
        "Create bins",
        ["warehouse_admin"],
        "Create scannable bins with location and area ownership.",
      ),
      node(
        "setup-route",
        "action",
        "Configure operation routes",
        ["warehouse_admin"],
        "Permit valid source and destination location types.",
      ),
      node(
        "setup-end",
        "terminal",
        "Warehouse ready for controlled stock",
        ["warehouse_logistics_supervisor"],
        "Verify scan, receive, transfer, and putaway destinations.",
      ),
    ],
  ),
  governed(
    "receive-to-putaway",
    "Receive to putaway",
    "PO matching, receipt, inspection, hold, putaway, and inventory availability.",
    [
      "warehouse_procurement",
      "warehouse_logistics_supervisor",
      "warehouse_operations",
      "warehouse_finance",
    ],
    [
      node(
        "receive-start",
        "start",
        "Select receivable PO",
        ["warehouse_procurement", "warehouse_logistics_supervisor"],
        "Confirm supplier, site, lines, and remaining quantity.",
      ),
      node(
        "receive-record",
        "action",
        "Record receipt lines",
        ["warehouse_logistics_supervisor"],
        "Scan or enter product, quantity, serial/lot, and evidence.",
      ),
      node(
        "receive-inspect",
        "decision",
        "Inspect quality",
        ["warehouse_logistics_supervisor"],
        "Accept, hold, mark damaged, unavailable, or return to vendor.",
        "Accepted units proceed to putaway.",
        "Non-accepted outcomes require reason and evidence.",
      ),
      node(
        "receive-putaway",
        "action",
        "Put away accepted stock",
        ["warehouse_logistics_supervisor", "warehouse_operations"],
        "Move units into valid bins and preserve custody.",
      ),
      node(
        "receive-post",
        "system",
        "Inventory and valuation update",
        ["warehouse_finance"],
        "The ledger, units, lots, and stock levels reflect the governed receipt.",
      ),
      node(
        "receive-end",
        "terminal",
        "Stock available for allocation",
        ["warehouse_operations"],
        "Available, non-held stock can be reserved and issued.",
      ),
    ],
  ),
  governed(
    "allocation-event-return",
    "Allocation, event, and return",
    "Request, reserve, issue, consume, return, inspect, and reconcile stock.",
    [
      "warehouse_business_unit",
      "warehouse_marketing",
      "warehouse_operations",
      "warehouse_logistics_supervisor",
    ],
    [
      node(
        "event-start",
        "start",
        "Business creates event or demand",
        ["warehouse_business_unit", "warehouse_marketing"],
        "Provide dates, owner, location, purpose, and requested products.",
      ),
      node(
        "event-reserve",
        "action",
        "Operations allocates stock",
        ["warehouse_operations"],
        "Reserve available quantities against the event or request.",
      ),
      node(
        "event-issue",
        "action",
        "Warehouse issues stock",
        ["warehouse_operations", "warehouse_logistics_supervisor"],
        "Scan custody out and record recipient evidence.",
      ),
      node(
        "event-return",
        "decision",
        "Unused stock returned?",
        ["warehouse_marketing", "warehouse_operations"],
        "Record returned, consumed, lost, or damaged quantities.",
        undefined,
        "Variance requires an exception and accountable review.",
      ),
      node(
        "event-reconcile",
        "action",
        "Inspect and reconcile",
        ["warehouse_logistics_supervisor", "warehouse_operations"],
        "Restock accepted returns and route damaged stock appropriately.",
      ),
      node(
        "event-end",
        "terminal",
        "Event inventory closed",
        ["warehouse_marketing", "warehouse_operations"],
        "Issued, consumed, returned, and variance totals reconcile.",
      ),
    ],
  ),
  governed(
    "cycle-count-adjustment",
    "Cycle count and adjustment",
    "Count, variance, approval, and controlled stock correction.",
    ["warehouse_finance", "warehouse_operations", "warehouse_admin"],
    [
      node(
        "count-start",
        "start",
        "Create count draft",
        ["warehouse_finance", "warehouse_operations"],
        "Select location/bin and freeze the expected count context.",
      ),
      node(
        "count-enter",
        "action",
        "Record physical count",
        ["warehouse_operations"],
        "Enter observed quantities with evidence.",
      ),
      node(
        "count-review",
        "decision",
        "Variance requires approval?",
        ["warehouse_finance"],
        "Review value, cause, evidence, and segregation of duties.",
      ),
      node(
        "count-adjust",
        "action",
        "Approve and post adjustment",
        ["warehouse_finance", "warehouse_admin"],
        "Use the governed stock-change request; never edit stock directly.",
      ),
      node(
        "count-end",
        "terminal",
        "Count reconciled",
        ["warehouse_finance"],
        "Ledger and physical count agree with an auditable reason.",
      ),
    ],
  ),
  governed(
    "pricing-and-costing",
    "Pricing and costing",
    "Landed-cost review, controlled price proposal, approval, and reporting.",
    ["warehouse_pricing", "warehouse_finance", "warehouse_procurement"],
    [
      node(
        "price-start",
        "start",
        "Review purchase and landed cost",
        ["warehouse_pricing", "warehouse_finance"],
        "Confirm source PO, freight, duties, and allocation basis.",
      ),
      node(
        "price-propose",
        "action",
        "Propose price change",
        ["warehouse_pricing"],
        "Record basis, effective date, and evidence.",
      ),
      node(
        "price-review",
        "decision",
        "Finance reviews impact",
        ["warehouse_finance"],
        "Validate margin, valuation, and effective controls.",
      ),
      node(
        "price-post",
        "system",
        "Approved price becomes effective",
        ["warehouse_pricing"],
        "The controlled price record updates without rewriting historical values.",
      ),
      node(
        "price-end",
        "terminal",
        "Pricing report available",
        ["warehouse_pricing", "warehouse_bi_analyst"],
        "Current and historical basis can be reported.",
      ),
    ],
  ),
  governed(
    "doa-governance",
    "DOA governance",
    "Draft, validate, activate, supersede, and use department approval matrices.",
    [
      "platform_admin",
      "legal_admin",
      "procurement_admin",
      "procurement_approver",
    ],
    [
      node(
        "doa-start",
        "start",
        "Load active department DOA",
        ["platform_admin", "legal_admin"],
        "Review source document, tiers, amounts, categories, and named approvers.",
      ),
      node(
        "doa-revise",
        "action",
        "Create immutable revision",
        ["platform_admin", "legal_admin"],
        "Copy the active matrix, update assignments, and save a new draft version.",
      ),
      node(
        "doa-validate",
        "decision",
        "Draft valid?",
        ["platform_admin", "legal_admin"],
        "Confirm no gaps/overlaps and at least one final approver.",
      ),
      node(
        "doa-activate",
        "action",
        "Activate revision",
        ["platform_admin", "legal_admin"],
        "Supersede the prior matrix deliberately and retain history.",
      ),
      node(
        "doa-end",
        "terminal",
        "New requests use active DOA",
        ["procurement_admin", "procurement_approver"],
        "Approval routing resolves named users from the effective matrix.",
      ),
    ],
  ),
  governed(
    "exception-and-recovery",
    "Exception and recovery",
    "Detect failures, preserve data, retry safely, and escalate with evidence.",
    KNOWLEDGE_ROLE_IDS(),
    [
      node(
        "recover-start",
        "start",
        "User encounters failure",
        ["core_staff_only"],
        "Do not repeat destructive actions or expose credentials.",
      ),
      node(
        "recover-check",
        "decision",
        "Did the operation save?",
        ["core_staff_only"],
        "Refresh the record and inspect status, activity, and notifications.",
      ),
      node(
        "recover-retry",
        "action",
        "Retry only an idempotent action",
        ["core_staff_only"],
        "Use the same workflow after confirming no completed transaction exists.",
      ),
      node(
        "recover-escalate",
        "handoff",
        "Escalate with evidence",
        ["platform_admin"],
        "Provide route, time, role, record ID, expected result, and safe screenshot.",
      ),
      node(
        "recover-end",
        "terminal",
        "Issue resolved and audited",
        ["platform_admin"],
        "Record correction, owner, and prevention action.",
      ),
    ],
  ),
];

function KNOWLEDGE_ROLE_IDS() {
  return [
    "core_staff_only",
    "platform_admin",
    "vendor_portal",
    "warehouse_logistics_supervisor",
    "warehouse_operations",
    "warehouse_finance",
    "warehouse_bi_analyst",
    "warehouse_business_unit",
    "warehouse_marketing",
    "warehouse_procurement",
    "warehouse_pricing",
    "warehouse_admin",
    "procurement_requester",
    "procurement_officer",
    "procurement_approver",
    "procurement_finance",
    "procurement_admin",
    "legal_reviewer",
    "legal_compliance",
    "legal_admin",
  ];
}
