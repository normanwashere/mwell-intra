function persona(role, email, assignments, departmentCode, options = {}) {
  return {
    role,
    email,
    assignments,
    departmentCode,
    kind: options.kind ?? "employee",
    title: options.title ?? role.replaceAll("_", " "),
  };
}

// UAT exposes job-based personas, while the assignments retain the granular
// roles used by the authorization engine. This keeps the test roster lean
// without weakening module boundaries or governed handoffs.
export const CURRENT_LIVE_ROLES = [
  persona(
    "platform_administrator",
    "intra.test.admin@mwell.com.ph",
    { core: ["staff", "platform_admin"] },
    "technology",
    { title: "Platform Administrator" },
  ),
  persona(
    "general_employee",
    "intra.test.employee@mwell.com.ph",
    {
      core: ["staff"],
      procurement: ["requester"],
      events: ["requester"],
      warehouse: ["business_unit"],
    },
    "operations",
    { title: "General Employee" },
  ),
  persona(
    "operations_associate",
    "intra.test.operations.associate@mwell.com.ph",
    {
      core: ["staff"],
      warehouse: ["warehouse_operator", "operations"],
    },
    "operations.warehouse_logistics",
    { title: "Operations Associate" },
  ),
  persona(
    "operations_lead",
    "intra.test.operations.lead@mwell.com.ph",
    {
      core: ["staff"],
      procurement: ["approver"],
      warehouse: ["warehouse_supervisor", "logistics_supervisor"],
    },
    "operations.warehouse_logistics",
    { title: "Operations Lead" },
  ),
  persona(
    "procurement_lead",
    "intra.test.procurement.lead@mwell.com.ph",
    {
      core: ["staff"],
      procurement: ["procurement_officer", "admin"],
      warehouse: ["procurement"],
    },
    "procurement",
    { title: "Procurement Lead" },
  ),
  persona(
    "finance_controller",
    "intra.test.finance@mwell.com.ph",
    {
      core: ["staff"],
      procurement: ["finance"],
      warehouse: ["finance"],
    },
    "finance",
    { title: "Finance Controller" },
  ),
  persona(
    "legal_compliance_lead",
    "intra.test.legal.lead@mwell.com.ph",
    {
      core: ["staff"],
      legal: ["legal_reviewer", "compliance", "admin"],
    },
    "legal_compliance",
    { title: "Legal & Compliance Lead" },
  ),
  persona(
    "marketing_events_lead",
    "intra.test.marketing.events@mwell.com.ph",
    {
      core: ["staff"],
      events: ["coordinator", "admin"],
      warehouse: ["marketing"],
    },
    "marketing",
    { title: "Marketing & Events Lead" },
  ),
  persona(
    "product_owner",
    "intra.test.product.owner@mwell.com.ph",
    {
      core: ["staff"],
      events: ["viewer"],
      product: ["product_owner"],
    },
    "product",
    { title: "Product Owner" },
  ),
  persona(
    "leadership_insights",
    "intra.test.leadership@mwell.com.ph",
    {
      core: ["staff"],
      insights: ["analyst", "manager", "executive"],
      warehouse: ["bi_analyst"],
    },
    "technology",
    { title: "Leadership / Insights" },
  ),
  persona(
    "vendor_representative",
    "intra.test.vendor@mwell.com.ph",
    { core: ["vendor_portal"] },
    null,
    { kind: "vendor", title: "Vendor Representative" },
  ),
];

export const REQUIRED_TRANSACTION_VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "mobile-390", width: 390, height: 844 },
];

const requiredCases = [
  "authorized",
  "unauthorized",
  "validation",
  "duplicate",
  "correction",
  "refresh",
  "handoff",
];

function scenario(id, actors, checkpoints, cleanup) {
  return {
    id,
    actors,
    viewports: REQUIRED_TRANSACTION_VIEWPORTS.map((item) => item.name),
    cases: [...requiredCases],
    checkpoints,
    cleanup,
  };
}

export const CURRENT_LIVE_SCENARIOS = [
  scenario(
    "identity-access",
    ["general_employee", "platform_administrator", "vendor_representative"],
    ["session-restored", "least-privilege-route-result", "refresh-restored"],
    ["browser-session"],
  ),
  scenario(
    "vendor-accreditation",
    ["legal_compliance_lead", "vendor_representative", "procurement_lead"],
    ["invite-created", "case-visible", "application-readback", "legal-handoff"],
    ["legal.vendor_invites", "legal.accreditation_cases", "core.vendors"],
  ),
  scenario(
    "procurement-request-to-po",
    [
      "general_employee",
      "procurement_lead",
      "operations_lead",
      "finance_controller",
    ],
    ["draft-created", "route-recorded", "approval-readback", "po-readback"],
    ["procurement.requests"],
  ),
  scenario(
    "warehouse-setup-receive-putaway",
    ["operations_lead", "procurement_lead", "operations_associate"],
    [
      "bin-created",
      "receipt-created",
      "stock-ledger-posted",
      "putaway-visible",
    ],
    ["warehouse.storage_areas", "warehouse.receipts", "warehouse.movements"],
  ),
  scenario(
    "warehouse-quality-and-return",
    ["operations_lead", "operations_associate", "procurement_lead"],
    ["inspection-created", "hold-or-release-recorded", "vendor-return-visible"],
    [
      "warehouse.quality_inspections",
      "warehouse.inventory_holds",
      "warehouse.vendor_returns",
    ],
  ),
  scenario(
    "warehouse-cycle-count",
    ["operations_associate", "operations_lead", "finance_controller"],
    [
      "count-submitted",
      "supervisor-approved",
      "finance-approved",
      "ledger-posted",
    ],
    ["warehouse.cycle_counts", "warehouse.stock_change_requests"],
  ),
  scenario(
    "warehouse-allocation-event-return",
    ["marketing_events_lead", "general_employee", "operations_associate"],
    [
      "event-created",
      "reservation-created",
      "issue-recorded",
      "return-reconciled",
    ],
    ["warehouse.events", "warehouse.allocations", "warehouse.returns"],
  ),
  scenario(
    "admin-doa",
    ["platform_administrator", "legal_compliance_lead"],
    ["draft-tier-created", "matrix-activated", "procurement-readback"],
    ["procurement.doa_matrices", "procurement.doa_assignments"],
  ),
  scenario(
    "events-request-to-warehouse-handoff",
    [
      "general_employee",
      "marketing_events_lead",
      "product_owner",
      "operations_associate",
    ],
    [
      "event-created",
      "event-database-readback",
      "duplicate-replay-denied",
      "viewer-mutation-denied",
      "coordinator-refresh-readback",
      "warehouse-handoff-visible",
    ],
    ["warehouse.events", "warehouse.allocations", "warehouse.returns"],
  ),
  scenario(
    "insights-read-only-governance",
    ["leadership_insights"],
    [
      "role-scoped-snapshot",
      "cross-module-source-link",
      "mutation-denied",
      "refresh-consistent",
    ],
    ["browser-session"],
  ),
  scenario(
    "unified-finance-control-center",
    ["finance_controller"],
    [
      "procurement-commitment-visible",
      "payment-readiness-visible",
      "warehouse-valuation-visible",
      "source-record-linked",
    ],
    ["browser-session"],
  ),
];

export function createAuditRunId(now = new Date(), random = Math.random) {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  const suffix = Math.floor(random() * 0xffffffff)
    .toString(16)
    .padStart(8, "0")
    .toUpperCase();
  return `QA-${date}-${suffix}`;
}

export function assertAuditRunId(value) {
  if (!/^QA-\d{8}-[A-F0-9]{8}$/.test(value))
    throw new Error("AUDIT_RUN_ID must use QA-YYYYMMDD-8HEX format.");
  return value;
}
