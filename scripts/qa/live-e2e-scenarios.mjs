export const CURRENT_LIVE_ROLES = [
  ["core_staff_only", "intra.test.staff@mwell.com.ph"],
  ["platform_admin", "intra.test.admin@mwell.com.ph"],
  ["vendor_portal", "intra.test.vendor@mwell.com.ph"],
  ["warehouse_logistics_supervisor", "intra.test.wh.logistics@mwell.com.ph"],
  ["warehouse_operations", "intra.test.wh.operations@mwell.com.ph"],
  ["warehouse_finance", "intra.test.wh.finance@mwell.com.ph"],
  ["warehouse_bi_analyst", "intra.test.wh.bi@mwell.com.ph"],
  ["warehouse_business_unit", "intra.test.wh.business.unit@mwell.com.ph"],
  ["warehouse_marketing", "intra.test.wh.marketing@mwell.com.ph"],
  ["warehouse_procurement", "intra.test.wh.procurement@mwell.com.ph"],
  ["warehouse_pricing", "intra.test.wh.pricing@mwell.com.ph"],
  ["warehouse_admin", "intra.test.wh.warehouse.admin@mwell.com.ph"],
  ["procurement_requester", "intra.test.proc.requester@mwell.com.ph"],
  ["procurement_officer", "intra.test.proc.officer@mwell.com.ph"],
  ["procurement_approver", "intra.test.proc.approver@mwell.com.ph"],
  ["procurement_finance", "intra.test.proc.finance@mwell.com.ph"],
  ["procurement_admin", "intra.test.proc.admin@mwell.com.ph"],
  ["legal_reviewer", "intra.test.legal.reviewer@mwell.com.ph"],
  ["legal_compliance", "intra.test.legal.compliance@mwell.com.ph"],
  ["legal_admin", "intra.test.legal.admin@mwell.com.ph"],
].map(([role, email]) => ({ role, email }));

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
    ["legal.vendor_invites", "legal.accreditation_cases", "legal.vendors"],
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
    ["warehouse.bins", "warehouse.receipts", "warehouse.stock_ledger"],
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
    ["procurement.doa_matrices", "procurement.doa_tiers", "procurement.doa_assignments"],
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
