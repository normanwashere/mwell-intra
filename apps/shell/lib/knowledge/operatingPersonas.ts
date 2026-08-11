export interface OperatingPersona {
  id: string;
  label: string;
  department: string;
  responsibility: string;
}

export interface OperatingPersonaTask {
  id: string;
  title: string;
  summary: string;
  workspaceHref: string;
  featureId: string;
}

export interface OperatingPersonaGuide {
  roleIds: string[];
  tasks: OperatingPersonaTask[];
}

export interface OperatingWorkflowStep {
  personaId: string;
  action: string;
  decision?: string;
}

export interface OperatingWorkflow {
  id: string;
  label: string;
  summary: string;
  flowId: string;
  steps: OperatingWorkflowStep[];
}

export const OPERATING_PERSONAS: OperatingPersona[] = [
  {
    id: "platform_administrator",
    label: "Platform Administrator",
    department: "Technology",
    responsibility: "Access, user lifecycle, and platform controls",
  },
  {
    id: "general_employee",
    label: "General Employee",
    department: "Any department",
    responsibility: "Requests, events, and business acceptance",
  },
  {
    id: "operations_associate",
    label: "Operations Associate",
    department: "Operations",
    responsibility: "Receiving, movement, issue, returns, and counts",
  },
  {
    id: "operations_lead",
    label: "Operations Lead",
    department: "Operations",
    responsibility: "Warehouse setup, quality, exceptions, and approvals",
  },
  {
    id: "procurement_lead",
    label: "Procurement Lead",
    department: "Procurement",
    responsibility: "Sourcing, vendor coordination, and purchase orders",
  },
  {
    id: "finance_controller",
    label: "Finance Controller",
    department: "Finance",
    responsibility: "Spend approval, valuation, matching, and readiness",
  },
  {
    id: "legal_compliance_lead",
    label: "Legal & Compliance Lead",
    department: "Legal & Compliance",
    responsibility: "Accreditation, instruments, compliance, and DOA",
  },
  {
    id: "marketing_events_lead",
    label: "Marketing & Events Lead",
    department: "Marketing",
    responsibility: "Event planning, fulfillment, and reconciliation",
  },
  {
    id: "product_owner",
    label: "Product Owner",
    department: "Product",
    responsibility: "Pricing visibility and event/product oversight",
  },
  {
    id: "leadership_insights",
    label: "Leadership / Insights",
    department: "Leadership",
    responsibility: "Read-only cross-department decision support",
  },
  {
    id: "vendor_representative",
    label: "Vendor Representative",
    department: "External",
    responsibility: "Accreditation application and evidence",
  },
];

const task = (
  id: string,
  title: string,
  summary: string,
  workspaceHref: string,
  featureId: string,
): OperatingPersonaTask => ({
  id,
  title,
  summary,
  workspaceHref,
  featureId,
});

export const OPERATING_PERSONA_GUIDES: Record<string, OperatingPersonaGuide> = {
  platform_administrator: {
    roleIds: ["platform_admin"],
    tasks: [
      task(
        "manage-users",
        "Manage users and access",
        "Create or maintain an identity and assign only approved scoped roles.",
        "/admin/users",
        "admin-users",
      ),
      task(
        "manage-departments",
        "Maintain departments",
        "Keep the organization directory and ownership structure current.",
        "/admin/departments",
        "admin-departments",
      ),
      task(
        "manage-doa",
        "Maintain delegated authority",
        "Create, review, and activate a department DOA revision.",
        "/admin/doa",
        "admin-doa",
      ),
      task(
        "review-audit",
        "Review platform activity",
        "Investigate attributable access and governance activity.",
        "/admin/audit",
        "admin-audit",
      ),
    ],
  },
  general_employee: {
    roleIds: [
      "core_staff_only",
      "procurement_requester",
      "events_requester",
      "warehouse_business_unit",
      "product_contributor",
    ],
    tasks: [
      task(
        "request-purchase",
        "Request a purchase",
        "Describe the need, budget context, lines, and supporting evidence.",
        "/procurement/requests/new",
        "procurement-request-create",
      ),
      task(
        "request-stock",
        "Request stock",
        "Submit approved business demand for Operations to allocate and issue.",
        "/warehouse/fulfillment",
        "warehouse-fulfillment",
      ),
      task(
        "request-event",
        "Plan an event requirement",
        "Record event demand and hand fulfillment requirements to Operations.",
        "/events",
        "events-workspace",
      ),
      task(
        "track-work",
        "Track assigned work",
        "Review your active requests, decisions, and next handoffs.",
        "/work",
        "my-work",
      ),
    ],
  },
  operations_associate: {
    roleIds: ["warehouse_operator", "warehouse_operations"],
    tasks: [
      task(
        "receive-stock",
        "Receive stock",
        "Match an approved PO, capture quantity and traceability, then attach evidence.",
        "/warehouse/receiving",
        "warehouse-receiving",
      ),
      task(
        "inspect-putaway",
        "Inspect and put away",
        "Record the physical result and move accepted stock to its controlled bin.",
        "/warehouse/quality",
        "warehouse-quality",
      ),
      task(
        "pick-issue",
        "Allocate, pick, and issue",
        "Reserve approved demand, scan the source, and preserve custody evidence.",
        "/warehouse/fulfillment",
        "warehouse-fulfillment",
      ),
      task(
        "process-return",
        "Process a return",
        "Locate the issued identity and route the returned item for inspection.",
        "/warehouse/returns",
        "warehouse-returns",
      ),
      task(
        "count-stock",
        "Perform a cycle count",
        "Count the assigned location and submit supported variance evidence.",
        "/warehouse/cycle-counts",
        "warehouse-cycle-counts",
      ),
    ],
  },
  operations_lead: {
    roleIds: [
      "warehouse_supervisor",
      "warehouse_logistics_supervisor",
      "procurement_approver",
      "product_operations_partner",
    ],
    tasks: [
      task(
        "review-quality",
        "Decide a quality disposition",
        "Review operator evidence and release, retain, or route held stock.",
        "/warehouse/quality",
        "warehouse-quality",
      ),
      task(
        "review-adjustment",
        "Review a stock adjustment",
        "Confirm count evidence and decide the controlled inventory change.",
        "/warehouse/approvals",
        "warehouse-approvals",
      ),
      task(
        "resolve-exception",
        "Resolve an exception",
        "Investigate the source record and record an attributable outcome.",
        "/warehouse/exceptions",
        "warehouse-exceptions",
      ),
      task(
        "maintain-location",
        "Maintain warehouse setup",
        "Create or revise locations, bins, and controlled operation routes.",
        "/warehouse/locations",
        "warehouse-locations",
      ),
    ],
  },
  procurement_lead: {
    roleIds: [
      "procurement_officer",
      "procurement_admin",
      "warehouse_procurement",
    ],
    tasks: [
      task(
        "triage-request",
        "Review purchase requests",
        "Confirm completeness, sourcing route, and the next approval handoff.",
        "/procurement/requests",
        "procurement-requests",
      ),
      task(
        "review-approval",
        "Process procurement approvals",
        "Decide or route the Procurement tier with a recorded reason.",
        "/procurement/approvals",
        "procurement-approvals",
      ),
      task(
        "author-po",
        "Author a purchase order",
        "Convert an approved sourcing outcome into a controlled supplier commitment.",
        "/procurement/purchase-orders",
        "procurement-purchase-orders",
      ),
      task(
        "plan-replenishment",
        "Coordinate replenishment",
        "Review stock risk and connect the warehouse need to Procurement.",
        "/warehouse/procurement",
        "warehouse-procurement-planning",
      ),
    ],
  },
  finance_controller: {
    roleIds: ["procurement_finance", "warehouse_finance"],
    tasks: [
      task(
        "review-finance-work",
        "Run Finance control and close",
        "Review procurement and warehouse activity, then prepare valuation, COGS, expense, write-off, and event-settlement close entries.",
        "/finance",
        "warehouse-finance",
      ),
      task(
        "review-procurement",
        "Review procurement readiness",
        "Check approval, receipt, acceptance, invoice, and payment evidence.",
        "/procurement/purchase-orders",
        "procurement-purchase-orders",
      ),
      task(
        "review-warehouse",
        "Review inventory control",
        "Review valuation, reconciliation, supported warehouse adjustments, and close evidence in the unified Finance workspace.",
        "/finance",
        "warehouse-finance",
      ),
      task(
        "review-count",
        "Investigate count variance",
        "Review the adjustment and its source count evidence in the unified Finance workspace.",
        "/finance",
        "warehouse-finance",
      ),
      task(
        "approve-event-settlement",
        "Approve an event settlement",
        "Independently verify event outcomes, Finance reference, and evidence before approval.",
        "/events",
        "events-workspace",
      ),
    ],
  },
  legal_compliance_lead: {
    roleIds: ["legal_reviewer", "legal_compliance", "legal_admin"],
    tasks: [
      task(
        "review-case",
        "Review vendor accreditation",
        "Check completeness, risk, instruments, and current supporting evidence.",
        "/legal/cases",
        "legal-cases",
      ),
      task(
        "invite-vendor",
        "Invite a vendor",
        "Create a controlled invitation for the correct vendor contact.",
        "/legal/invites/new",
        "legal-invite-vendor",
      ),
      task(
        "sign-instrument",
        "Review and sign an instrument",
        "Complete the governed legal instrument and retain signed evidence.",
        "/legal/cases",
        "legal-sign-instrument",
      ),
      task(
        "maintain-doa",
        "Maintain department DOA",
        "Create and activate an approved department authority revision.",
        "/admin/doa",
        "admin-doa",
      ),
    ],
  },
  marketing_events_lead: {
    roleIds: ["events_coordinator", "events_admin", "warehouse_marketing"],
    tasks: [
      task(
        "plan-event",
        "Plan an event",
        "Record dates, owners, cost context, and inventory demand.",
        "/events",
        "events-workspace",
      ),
      task(
        "reserve-event-stock",
        "Request event stock",
        "Submit approved event demand for Operations to reserve, pick, and issue.",
        "/events",
        "events-workspace",
      ),
      task(
        "track-fulfillment",
        "Track event fulfillment",
        "Follow the Operations handoff and issued quantities from the event record.",
        "/events",
        "events-workspace",
      ),
      task(
        "reconcile-event",
        "Reconcile an event",
        "Record sales, giveaways, returns, losses, damage, and re-kitting, then submit the balanced settlement for independent Finance approval before closure.",
        "/events",
        "events-workspace",
      ),
    ],
  },
  product_owner: {
    roleIds: ["product_owner", "events_viewer"],
    tasks: [
      task(
        "review-product",
        "Review product readiness",
        "Confirm required ownership, evidence, and launch controls.",
        "/product",
        "product-governance",
      ),
      task(
        "decide-launch",
        "Record a go-live decision",
        "Approve or reject launch based on complete readiness evidence and an attributable decision note.",
        "/product",
        "product-governance",
      ),
      task(
        "review-pricing",
        "Review pricing governance",
        "Connect the approved product decision to controlled pricing evidence.",
        "/product",
        "product-governance",
      ),
      task(
        "review-event-use",
        "Review product use in events",
        "Monitor event demand without taking operational custody decisions.",
        "/events",
        "events-workspace",
      ),
    ],
  },
  leadership_insights: {
    roleIds: [
      "insights_analyst",
      "insights_manager",
      "insights_executive",
      "warehouse_bi_analyst",
    ],
    tasks: [
      task(
        "review-insights",
        "Review cross-department insights",
        "Use governed measures to identify operational and financial risk.",
        "/insights",
        "insights-workspace",
      ),
      task(
        "review-inventory-risk",
        "Review inventory risk",
        "Inspect stock, consumption, and exception trends without changing records.",
        "/insights",
        "insights-workspace",
      ),
      task(
        "review-work",
        "Review workflow health",
        "Identify delayed handoffs and send evidence-backed questions to owners.",
        "/work",
        "my-work",
      ),
    ],
  },
  vendor_representative: {
    roleIds: ["vendor_portal"],
    tasks: [
      task(
        "complete-application",
        "Complete accreditation",
        "Provide the vendor profile, declarations, and required evidence.",
        "/vendor",
        "vendor-application",
      ),
      task(
        "correct-requirement",
        "Respond to a correction",
        "Replace or clarify only the requirement returned by Legal.",
        "/vendor",
        "vendor-case-detail",
      ),
      task(
        "sign-instrument",
        "Sign a legal instrument",
        "Review and sign the assigned controlled document.",
        "/vendor",
        "vendor-sign-instrument",
      ),
      task(
        "track-status",
        "Track accreditation status",
        "See the current case state and the next action owned by the vendor.",
        "/vendor",
        "vendor-cases",
      ),
    ],
  },
};

export const OPERATING_WORKFLOWS: OperatingWorkflow[] = [
  {
    id: "procure-to-pay",
    label: "Procure to pay",
    summary:
      "A business need becomes an approved, received, and finance-ready purchase.",
    flowId: "procure-to-pay",
    steps: [
      {
        personaId: "general_employee",
        action: "Raise a complete purchase request",
      },
      {
        personaId: "operations_lead",
        action: "Confirm need and authority",
        decision: "Within delegated authority?",
      },
      {
        personaId: "procurement_lead",
        action: "Source, route, and author the PO",
        decision: "Vendor eligible and route complete?",
      },
      {
        personaId: "legal_compliance_lead",
        action: "Resolve accreditation or legal gates",
      },
      {
        personaId: "finance_controller",
        action: "Review spend and approval tier",
      },
      {
        personaId: "operations_associate",
        action: "Receive and preserve traceability",
      },
      {
        personaId: "finance_controller",
        action: "Match evidence and confirm readiness",
      },
    ],
  },
  {
    id: "vendor-accreditation",
    label: "Vendor accreditation",
    summary:
      "An invited vendor submits evidence for a governed Legal decision.",
    flowId: "vendor-accreditation",
    steps: [
      {
        personaId: "procurement_lead",
        action: "Identify the vendor and sourcing need",
      },
      {
        personaId: "legal_compliance_lead",
        action: "Issue a controlled invitation",
      },
      {
        personaId: "vendor_representative",
        action: "Complete profile, evidence, and declarations",
      },
      {
        personaId: "legal_compliance_lead",
        action: "Review checklist and instruments",
        decision: "Complete, current, and acceptable?",
      },
      {
        personaId: "vendor_representative",
        action: "Correct returned requirements",
      },
      {
        personaId: "legal_compliance_lead",
        action: "Approve, reject, or time-limit eligibility",
      },
      {
        personaId: "procurement_lead",
        action: "Use only the governed eligibility result",
      },
    ],
  },
  {
    id: "receive-to-issue",
    label: "Receive to issue",
    summary:
      "Two Operations users can run the warehouse while approvals stay independent.",
    flowId: "receive-to-putaway",
    steps: [
      { personaId: "procurement_lead", action: "Issue the approved PO" },
      {
        personaId: "operations_associate",
        action: "Receive, scan, and attach evidence",
      },
      {
        personaId: "operations_lead",
        action: "Inspect or review exceptions",
        decision: "Accept, hold, reject, or escalate?",
      },
      { personaId: "operations_associate", action: "Put away accepted stock" },
      {
        personaId: "general_employee",
        action: "Create approved demand or reservation",
      },
      {
        personaId: "operations_associate",
        action: "Pick, issue, and record custody",
      },
      {
        personaId: "finance_controller",
        action: "Review material valuation changes",
      },
    ],
  },
  {
    id: "event-fulfillment",
    label: "Event fulfillment",
    summary:
      "Campaign demand is planned, fulfilled, returned, and reconciled in one record.",
    flowId: "event-fulfillment",
    steps: [
      { personaId: "general_employee", action: "Create the business request" },
      {
        personaId: "marketing_events_lead",
        action: "Plan dates, owner, location, and demand",
      },
      {
        personaId: "product_owner",
        action: "Review product and pricing context",
      },
      {
        personaId: "operations_associate",
        action: "Reserve, pick, and issue stock",
      },
      {
        personaId: "marketing_events_lead",
        action: "Confirm consumption and returns",
        decision: "All custody reconciled?",
      },
      {
        personaId: "operations_lead",
        action: "Resolve loss, damage, or variance",
      },
      {
        personaId: "marketing_events_lead",
        action: "Close the event with evidence",
      },
    ],
  },
  {
    id: "governance-insights",
    label: "Governance and insights",
    summary:
      "Access and authority are controlled; leadership reads governed source records.",
    flowId: "doa-governance",
    steps: [
      {
        personaId: "platform_administrator",
        action: "Assign the minimum job-based access",
      },
      {
        personaId: "legal_compliance_lead",
        action: "Maintain department DOA revisions",
      },
      {
        personaId: "operations_lead",
        action: "Make assigned operational decisions",
      },
      {
        personaId: "finance_controller",
        action: "Certify financial control points",
      },
      {
        personaId: "leadership_insights",
        action: "Review source-linked indicators",
      },
      {
        personaId: "platform_administrator",
        action: "Recertify, suspend, or remove access",
        decision: "Does access still match the job?",
      },
    ],
  },
];
