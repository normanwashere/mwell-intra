export interface OperatingPersona {
  id: string;
  label: string;
  department: string;
  responsibility: string;
}

export const OPERATING_PERSONAS: readonly OperatingPersona[] = [
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

export const OPERATING_PERSONA_IDS = OPERATING_PERSONAS.map((persona) => persona.id);
