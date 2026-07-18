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

export const CURRENT_LIVE_ROLES = [
  persona("core_staff_only", "intra.test.staff@mwell.com.ph", { core: ["staff"] }, "operations"),
  persona("platform_admin", "intra.test.admin@mwell.com.ph", { core: ["staff", "platform_admin"] }, "technology"),
  persona("vendor_portal", "intra.test.vendor@mwell.com.ph", { core: ["vendor_portal"] }, null, { kind: "vendor", title: "Vendor portal representative" }),
  persona("warehouse_operator", "intra.test.wh.operator@mwell.com.ph", { core: ["staff"], warehouse: ["warehouse_operator"] }, "operations.warehouse_logistics"),
  persona("warehouse_supervisor", "intra.test.wh.supervisor@mwell.com.ph", { core: ["staff"], warehouse: ["warehouse_supervisor"] }, "operations.warehouse_logistics"),
  persona("warehouse_logistics_supervisor", "intra.test.wh.logistics@mwell.com.ph", { core: ["staff"], warehouse: ["logistics_supervisor"] }, "operations.warehouse_logistics"),
  persona("warehouse_operations", "intra.test.wh.operations@mwell.com.ph", { core: ["staff"], warehouse: ["operations"] }, "operations.warehouse_logistics"),
  persona("warehouse_finance", "intra.test.wh.finance@mwell.com.ph", { core: ["staff"], warehouse: ["finance"] }, "finance"),
  persona("warehouse_bi_analyst", "intra.test.wh.bi@mwell.com.ph", { core: ["staff"], warehouse: ["bi_analyst"], insights: ["analyst"] }, "technology"),
  persona("warehouse_business_unit", "intra.test.wh.business.unit@mwell.com.ph", { core: ["staff"], warehouse: ["business_unit"], events: ["requester"] }, "operations"),
  persona("warehouse_marketing", "intra.test.wh.marketing@mwell.com.ph", { core: ["staff"], warehouse: ["marketing"], events: ["coordinator"] }, "marketing"),
  persona("warehouse_procurement", "intra.test.wh.procurement@mwell.com.ph", { core: ["staff"], warehouse: ["procurement"] }, "procurement"),
  persona("warehouse_pricing", "intra.test.wh.pricing@mwell.com.ph", { core: ["staff"], warehouse: ["pricing"] }, "product"),
  persona("warehouse_admin", "intra.test.wh.warehouse.admin@mwell.com.ph", { core: ["staff"], warehouse: ["warehouse_admin"] }, "operations.warehouse_logistics"),
  persona("procurement_requester", "intra.test.proc.requester@mwell.com.ph", { core: ["staff"], procurement: ["requester"] }, "operations"),
  persona("procurement_officer", "intra.test.proc.officer@mwell.com.ph", { core: ["staff"], procurement: ["procurement_officer"] }, "procurement"),
  persona("procurement_approver", "intra.test.proc.approver@mwell.com.ph", { core: ["staff"], procurement: ["approver"] }, "operations"),
  persona("procurement_finance", "intra.test.proc.finance@mwell.com.ph", { core: ["staff"], procurement: ["finance"] }, "finance"),
  persona("procurement_admin", "intra.test.proc.admin@mwell.com.ph", { core: ["staff"], procurement: ["admin"] }, "procurement"),
  persona("finance_unified", "intra.test.finance@mwell.com.ph", { core: ["staff"], procurement: ["finance"], warehouse: ["finance"] }, "finance", { title: "Unified finance controller" }),
  persona("legal_reviewer", "intra.test.legal.reviewer@mwell.com.ph", { core: ["staff"], legal: ["legal_reviewer"] }, "legal_compliance"),
  persona("legal_compliance", "intra.test.legal.compliance@mwell.com.ph", { core: ["staff"], legal: ["compliance"] }, "legal_compliance"),
  persona("legal_admin", "intra.test.legal.admin@mwell.com.ph", { core: ["staff"], legal: ["admin"] }, "legal_compliance"),
  persona("events_requester", "intra.test.events.requester@mwell.com.ph", { core: ["staff"], events: ["requester"] }, "marketing"),
  persona("events_coordinator", "intra.test.events.coordinator@mwell.com.ph", { core: ["staff"], events: ["coordinator"] }, "marketing"),
  persona("events_viewer", "intra.test.events.viewer@mwell.com.ph", { core: ["staff"], events: ["viewer"] }, "marketing"),
  persona("events_admin", "intra.test.events.admin@mwell.com.ph", { core: ["staff"], events: ["admin"] }, "marketing"),
  persona("insights_analyst", "intra.test.insights.analyst@mwell.com.ph", { core: ["staff"], insights: ["analyst"] }, "technology"),
  persona("insights_manager", "intra.test.insights.manager@mwell.com.ph", { core: ["staff"], insights: ["manager"] }, "technology"),
  persona("insights_executive", "intra.test.insights.executive@mwell.com.ph", { core: ["staff"], insights: ["executive"] }, "technology"),
  persona("insights_admin", "intra.test.insights.admin@mwell.com.ph", { core: ["staff"], insights: ["admin"] }, "technology"),
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
    ["core_staff_only", "platform_admin", "vendor_portal"],
    ["session-restored", "least-privilege-route-result", "refresh-restored"],
    ["browser-session"],
  ),
  scenario(
    "vendor-accreditation",
    ["legal_admin", "vendor_portal", "legal_reviewer", "legal_compliance"],
    ["invite-created", "case-visible", "application-readback", "legal-handoff"],
    ["legal.vendor_invites", "legal.accreditation_cases", "core.vendors"],
  ),
  scenario(
    "procurement-request-to-po",
    [
      "procurement_requester",
      "procurement_officer",
      "procurement_approver",
      "procurement_finance",
      "warehouse_procurement",
    ],
    ["draft-created", "route-recorded", "approval-readback", "po-readback"],
    ["procurement.requests"],
  ),
  scenario(
    "warehouse-setup-receive-putaway",
    ["warehouse_admin", "warehouse_procurement", "warehouse_logistics_supervisor"],
    ["bin-created", "receipt-created", "stock-ledger-posted", "putaway-visible"],
    ["warehouse.storage_areas", "warehouse.receipts", "warehouse.movements"],
  ),
  scenario(
    "warehouse-quality-and-return",
    ["warehouse_logistics_supervisor", "warehouse_operations", "warehouse_procurement"],
    ["inspection-created", "hold-or-release-recorded", "vendor-return-visible"],
    ["warehouse.quality_inspections", "warehouse.inventory_holds", "warehouse.vendor_returns"],
  ),
  scenario(
    "warehouse-cycle-count",
    ["warehouse_operations", "warehouse_logistics_supervisor", "warehouse_finance"],
    ["count-submitted", "supervisor-approved", "finance-approved", "ledger-posted"],
    ["warehouse.cycle_counts", "warehouse.stock_change_requests"],
  ),
  scenario(
    "warehouse-allocation-event-return",
    ["warehouse_marketing", "warehouse_business_unit", "warehouse_operations"],
    ["event-created", "reservation-created", "issue-recorded", "return-reconciled"],
    ["warehouse.events", "warehouse.allocations", "warehouse.returns"],
  ),
  scenario(
    "admin-doa",
    ["platform_admin", "legal_admin", "procurement_admin"],
    ["draft-tier-created", "matrix-activated", "procurement-readback"],
    ["procurement.doa_matrices", "procurement.doa_assignments"],
  ),
  scenario(
    "events-request-to-warehouse-handoff",
    ["events_requester", "events_coordinator", "warehouse_operations", "warehouse_supervisor"],
    ["event-created", "event-database-readback", "duplicate-replay-denied", "viewer-mutation-denied", "coordinator-refresh-readback", "warehouse-handoff-visible"],
    ["warehouse.events", "warehouse.allocations", "warehouse.returns"],
  ),
  scenario(
    "insights-read-only-governance",
    ["insights_analyst", "insights_manager", "insights_executive", "insights_admin"],
    ["role-scoped-snapshot", "cross-module-source-link", "mutation-denied", "refresh-consistent"],
    ["browser-session"],
  ),
  scenario(
    "unified-finance-control-center",
    ["finance_unified", "procurement_finance", "warehouse_finance"],
    ["procurement-commitment-visible", "payment-readiness-visible", "warehouse-valuation-visible", "source-record-linked"],
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
