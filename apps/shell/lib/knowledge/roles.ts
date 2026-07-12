import type { KnowledgeRole } from "./types";

const ROLE_DEFINITIONS: Array<
  Omit<KnowledgeRole, "availability" | "authority">
> = [
  {
    id: "core_staff_only",
    label: "Core staff",
    module: "core",
    purpose:
      "Use shared Intra services and find the correct department workflow.",
  },
  {
    id: "platform_admin",
    label: "Platform administrator",
    module: "admin",
    purpose:
      "Manage identities, scoped roles, access review, and DOA administration.",
  },
  {
    id: "vendor_portal",
    label: "Vendor portal user",
    module: "vendor",
    purpose:
      "Complete accreditation, submit evidence, sign instruments, and monitor decisions.",
  },
  {
    id: "warehouse_logistics_supervisor",
    label: "Warehouse logistics supervisor",
    module: "warehouse",
    purpose:
      "Receive, inspect, tag, put away, and coordinate warehouse execution.",
  },
  {
    id: "warehouse_operations",
    label: "Warehouse operations",
    module: "warehouse",
    purpose: "Allocate, issue, transfer, return, and reconcile inventory.",
  },
  {
    id: "warehouse_finance",
    label: "Warehouse finance",
    module: "warehouse",
    purpose:
      "Review valuation, cycle-count variance, reconciliation, and financial controls.",
  },
  {
    id: "warehouse_bi_analyst",
    label: "Warehouse BI analyst",
    module: "warehouse",
    purpose: "Analyze governed warehouse data and reports.",
  },
  {
    id: "warehouse_business_unit",
    label: "Warehouse business unit",
    module: "warehouse",
    purpose: "Request and track inventory support for business activity.",
  },
  {
    id: "warehouse_marketing",
    label: "Warehouse marketing",
    module: "warehouse",
    purpose:
      "Plan events, request promotional stock, and return unused inventory.",
  },
  {
    id: "warehouse_procurement",
    label: "Warehouse procurement",
    module: "warehouse",
    purpose:
      "Coordinate receivable purchase orders, suppliers, and replenishment.",
  },
  {
    id: "warehouse_pricing",
    label: "Warehouse pricing",
    module: "warehouse",
    purpose: "Review landed cost and controlled price changes.",
  },
  {
    id: "warehouse_admin",
    label: "Warehouse administrator",
    module: "warehouse",
    purpose:
      "Configure warehouses, locations, routes, storage areas, bins, and imports.",
  },
  {
    id: "procurement_requester",
    label: "Procurement requester",
    module: "procurement",
    purpose: "Draft justified requests and respond to clarification.",
  },
  {
    id: "procurement_officer",
    label: "Procurement officer",
    module: "procurement",
    purpose:
      "Confirm sourcing route, competition, vendor readiness, and PO authoring.",
  },
  {
    id: "procurement_approver",
    label: "Procurement approver",
    module: "procurement",
    purpose:
      "Review need, route, evidence, budget context, and approve or return.",
  },
  {
    id: "procurement_finance",
    label: "Procurement finance",
    module: "procurement",
    purpose: "Review financial approval, acceptance, and payment readiness.",
  },
  {
    id: "procurement_admin",
    label: "Procurement administrator",
    module: "procurement",
    purpose:
      "Oversee procurement controls, PO states, and exception governance.",
  },
  {
    id: "legal_reviewer",
    label: "Legal reviewer",
    module: "legal",
    purpose:
      "Review vendor evidence, instruments, risk, and accreditation readiness.",
  },
  {
    id: "legal_compliance",
    label: "Legal compliance",
    module: "legal",
    purpose:
      "Review compliance evidence, dispositions, expiry, and renewal controls.",
  },
  {
    id: "legal_admin",
    label: "Legal administrator",
    module: "legal",
    purpose:
      "Invite vendors, administer Legal workflow, and maintain department DOA.",
  },
];

export const KNOWLEDGE_ROLES: KnowledgeRole[] = ROLE_DEFINITIONS.map(
  (role) => ({
    ...role,
    availability: "live",
    authority: {
      capabilities: [`knowledge.${role.id}.view`],
      accessibleRoutes: ["/knowledge"],
      canDo: ["Access the governed Knowledge Base."],
      cannotDo: ["Do not bypass governed workflow controls."],
      decisions: [],
      upstreamRoleIds: [],
      downstreamRoleIds: [],
      escalation: "Escalate through the owning department.",
    },
  }),
);
