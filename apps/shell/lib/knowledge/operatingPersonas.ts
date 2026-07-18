export interface OperatingPersona {
  id: string;
  label: string;
  department: string;
  responsibility: string;
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
