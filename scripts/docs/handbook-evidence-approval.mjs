const REVIEWED_AT = "2026-08-24T20:27:45.000Z";
const UAT_HOST = "https://mwell-intra-uat.vercel.app";

function evidenceSlug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function approval(bindingId, route, role, controlRole, label, labelPattern, landmark, options = {}) {
  const [taskId, stageId] = bindingId.split(":");
  const fileStem = `${evidenceSlug(taskId)}-${stageId}`;
  return Object.freeze({
    taskId,
    stageId,
    bindingId,
    path: `docs/manual/assets/knowledge-base/${fileStem}-desktop.png`,
    mobilePath: `docs/manual/assets/knowledge-base/${fileStem}-mobile.png`,
    host: UAT_HOST,
    route,
    role,
    target: Object.freeze({ controlRole, label, labelPattern, landmark, ...options }),
    reviewedAt: REVIEWED_AT,
  });
}

export const EVIDENCE_APPROVAL_CONTRACT = Object.freeze({
  schemaVersion: 1,
  approvalId: "handbook-task7-round1",
  approvedBy: "Independent Task 7 evidence review",
  reviewedAt: REVIEWED_AT,
  verificationMode: "ci-run",
  sourceCommit: "138e326f05d016d26393841cbf57695787cfe226",
  certificationRun: "https://github.com/normanwashere/mwell-intra/actions/runs/32653705717",
  manifestSha256: "fa1ea1b93e58df7040fe89b4eed1bb0aea0544eb398208e6d6fc805920aadf55",
  stages: Object.freeze([
    approval("procurement-request-approval:step-1", "/procurement/requests/new", "general_employee", "button", "Continue", "^Continue$", "request validation action"),
    approval("procurement-request-approval:step-2", "/procurement/requests", "general_employee", "link", "New request", "^New request$", "request submission entry"),
    approval("procurement-request-approval:step-3", "/procurement/approvals", "operations_lead", "button", "Approve assigned request", "^(Approve|Review request)(\\s|$)", "assigned approval decision"),
    approval("procurement-request-approval:step-4", "/procurement/purchase-orders", "procurement_lead", "button", "Open HANDBOOK-T7-R1-PO", "^Open HANDBOOK-T7-R1-PO$", "governed purchase-order handoff"),

    approval("vendor-accreditation-renewal:step-1", "/legal/invites/new", "legal_compliance_lead", "button", "Continue", "^Continue$", "vendor invitation progression"),
    approval("vendor-accreditation-renewal:step-2", "/vendor/", "vendor_representative", "link", "Continue application", "^Continue application$", "vendor application continuation"),
    approval("vendor-accreditation-renewal:step-3", "/legal/", "legal_compliance_lead", "button", "Open review", "^Open review$", "accreditation case review"),
    approval("vendor-accreditation-renewal:step-4", "/legal/", "legal_compliance_lead", "button", "Record governed decision", "^(Record governed decision|Record independent clearance decision|Approve outcome)$", "accreditation decision action"),

    approval("warehouse-location-bin-setup:step-1", "/warehouse/storage", "operations_lead", "textbox", "Bin code", "^Bin code$", "storage-area bin identity"),
    approval("warehouse-location-bin-setup:step-2", "/warehouse/locations", "operations_lead", "button", "Add location", "^(Add location|Import locations)$", "location and bin creation action"),
    approval("warehouse-location-bin-setup:step-3", "/warehouse/operation-routes", "operations_lead", "button", "Edit route", "^Edit route$", "location route validation action"),
    approval("warehouse-location-bin-setup:step-4", "/warehouse/purchase-orders", "operations_associate", "link", "HANDBOOK-T7-R1-PO", "^HANDBOOK-T7-R1-PO$", "receiving-ready inbound purchase order"),

    approval("stock-receiving-putaway:step-1", "/warehouse/purchase-orders", "operations_associate", "link", "HANDBOOK-T7-R1-PO", "^HANDBOOK-T7-R1-PO$", "eligible inbound purchase-order receipt"),
    approval("stock-receiving-putaway:step-2", "/warehouse/receiving", "operations_associate", "button", "Add to receipt", "^Add to receipt$", "physical receipt-line action"),
    approval("stock-receiving-putaway:step-3", "/warehouse/quality", "operations_lead", "button", "Inspect", "^Inspect(\\s|$)", "quality inspection action"),
    approval("stock-receiving-putaway:step-4", "/warehouse/storage", "operations_associate", "button", "Put away", "^Put away$", "putaway action"),

    approval("ecommerce-order-intake:step-1", "/warehouse/fulfillment", "operations_associate", "button", "New order or import", "^(New order / demand|Import existing tracker)$", "order intake choice"),
    approval("ecommerce-order-intake:step-2", "/warehouse/fulfillment", "operations_associate", "textbox", "Order reference", "^Order reference$", "required order identity field"),
    approval("ecommerce-order-intake:step-3", "/warehouse/fulfillment", "operations_associate", "button", "Import existing tracker", "^Import existing tracker$", "tracker validation entry"),
    approval("ecommerce-order-intake:step-4", "/warehouse/fulfillment", "operations_associate", "button", "View order details", "^View order details$", "fulfillment queue record", { sourceContext: "ecommerce" }),

    approval("ecommerce-fulfillment-delivery:step-1", "/warehouse/fulfillment", "operations_associate", "button", "Allocate or start picking", "^(Allocate stock|Start picking)$", "allocation and pick action"),
    approval("ecommerce-fulfillment-delivery:step-2", "/warehouse/fulfillment", "operations_associate", "button", "Scan and pack", "^(Confirm scanned pick|Pack and add waybill|Prepare accountable handover)$", "actual scan-and-pack action"),
    approval("ecommerce-fulfillment-delivery:step-3", "/warehouse/fulfillment", "operations_associate", "button", "Release shipment or handover", "^(Release shipment|Release handover)$", "dispatch action"),
    approval("ecommerce-fulfillment-delivery:step-4", "/warehouse/fulfillment", "operations_lead", "button", "Update delivery", "^Update delivery$", "delivery outcome action"),

    approval("returns-replacements-refunds-rma:step-1", "/warehouse/returns", "operations_associate", "textbox", "Serial number", "^Serial number$", "serial-to-original-release lookup"),
    approval("returns-replacements-refunds-rma:step-2", "/warehouse/returns", "operations_associate", "button", "Record return", "^Record return$", "controlled return receipt action"),
    approval("returns-replacements-refunds-rma:step-3", "/warehouse/quality", "operations_lead", "combobox", "Disposition", "^Disposition$", "governed return disposition"),
    approval("returns-replacements-refunds-rma:step-4", "/warehouse/quality", "operations_lead", "button", "Submit inspection", "^Submit inspection$", "final return disposition action"),

    approval("department-inventory-release:step-1", "/warehouse/fulfillment", "general_employee", "button", "New stock request", "^New stock request$", "department stock request action"),
    approval("department-inventory-release:step-2", "/warehouse/fulfillment", "operations_lead", "button", "Approve department request", "^Approve$", "actual department release approval"),
    approval("department-inventory-release:step-3", "/warehouse/fulfillment", "operations_lead", "button", "Allocate and release", "^(Allocate stock|Start picking|Release handover)$", "department release execution"),
    approval("department-inventory-release:step-4", "/warehouse/fulfillment", "general_employee", "button", "Acknowledge receipt", "^Acknowledge receipt$", "recipient custody acknowledgement"),

    approval("event-stock-custody:step-1", "/events", "general_employee", "button", "Create event", "^(Create event|New event|Plan event)$", "event demand creation"),
    approval("event-stock-custody:step-2", "/warehouse/fulfillment", "operations_associate", "button", "Allocate event stock", "^(Allocate stock|Start picking)$", "event stock transfer action"),
    approval("event-stock-custody:step-3", "/events", "marketing_events_lead", "button", "Start or edit reconciliation", "^(Start reconciliation|Edit outcomes)$", "event outcome and return action"),
    approval("event-stock-custody:step-4", "/events", "finance_controller", "button", "Approve settlement", "^Approve settlement$", "event reconciliation decision"),

    approval("inventory-count-variance:step-1", "/warehouse/cycle-counts", "operations_associate", "combobox", "Location", "^Location$", "cycle-count scope control"),
    approval("inventory-count-variance:step-2", "/warehouse/cycle-counts", "operations_associate", "button", "Submit count", "^Submit count(?:\\s|$)", "observed quantity submission"),
    approval("inventory-count-variance:step-3", "/warehouse/approvals", "operations_lead", "button", "Approve variance", "^(Approve change|Review)(\\s|$)", "variance decision action"),
    approval("inventory-count-variance:step-4", "/warehouse/approvals", "operations_lead", "tab", "Recently decided", "^Recently decided$", "posted count readback action"),

    approval("department-doa-activation:step-1", "/admin/doa", "platform_administrator", "button", "Create revision", "^(Create revision|Create department matrix)$", "versioned DOA draft action"),
    approval("department-doa-activation:step-2", "/admin/doa", "platform_administrator", "button", "Add tier", "^(Add tier|Save draft)$", "DOA tier definition action"),
    approval("department-doa-activation:step-3", "/admin/doa", "legal_compliance_lead", "button", "Activate", "^Activate$", "DOA activation action"),
    approval("department-doa-activation:step-4", "/procurement/requests/new", "procurement_lead", "combobox", "Department", "^Department$", "Procurement DOA readback control"),

    approval("finance-readiness-evidence:step-1", "/finance", "finance_controller", "link", "Review next payment pack", "^Review next payment pack$", "Finance control-center next-work action"),
    approval("finance-readiness-evidence:step-2", "/finance", "finance_controller", "link", "Source record", ".+", "source-record trace with financial context"),
    approval("finance-readiness-evidence:step-3", "/finance", "finance_controller", "link", "Payment-readiness purchase order", ".+", "payment-readiness source action"),
    approval("finance-readiness-evidence:step-4", "/finance", "finance_controller", "button", "Prepare close entry", "^Prepare close entry$", "governed Finance close preparation"),

    approval("product-readiness-pricing-go-live:step-1", "/product", "general_employee", "button", "New readiness package", "^New readiness package$", "readiness package submission"),
    approval("product-readiness-pricing-go-live:step-2", "/product", "product_owner", "button", "Review current package", "^(Approve go-live|Reject go-live)$", "current Product package review action"),
    approval("product-readiness-pricing-go-live:step-3", "/product", "product_owner", "button", "Decide go-live", "^(Approve go-live|Reject go-live)$", "actual Product go-live decision"),
    approval("product-readiness-pricing-go-live:step-4", "/product", "operations_lead", "button", "Acknowledge Operations handoff", "^Acknowledge Operations handoff$", "Operations handoff acknowledgement"),
  ]),
});
