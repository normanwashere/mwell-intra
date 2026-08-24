function target(controlRole, names, landmark, options = {}) {
  return Object.freeze({ controlRole, names: Object.freeze(names), landmark, ...options });
}

export const HANDBOOK_EVIDENCE_TARGETS = Object.freeze({
  "procurement-request-approval:step-1": target("button", ["Continue"], "request validation action"),
  "procurement-request-approval:step-2": target("link", ["New request"], "request submission entry"),
  "procurement-request-approval:step-3": target("button", ["Approve", "Review request"], "assigned approval decision", { nameMode: "prefix" }),
  "procurement-request-approval:step-4": target("button", ["Open HANDBOOK-T7-R1-PO"], "governed purchase-order handoff"),

  "vendor-accreditation-renewal:step-1": target("button", ["Continue"], "vendor invitation progression"),
  "vendor-accreditation-renewal:step-2": target("link", ["Continue application"], "vendor application continuation"),
  "vendor-accreditation-renewal:step-3": target("button", ["Open review"], "accreditation case review"),
  "vendor-accreditation-renewal:step-4": target("button", ["Record governed decision", "Record independent clearance decision", "Approve outcome"], "accreditation decision action"),

  "warehouse-location-bin-setup:step-1": target("textbox", ["Bin code"], "storage-area bin identity", { prepare: "open-storage-area" }),
  "warehouse-location-bin-setup:step-2": target("button", ["Add location", "Import locations"], "location and bin creation action"),
  "warehouse-location-bin-setup:step-3": target("button", ["Edit route"], "location route validation action"),
  "warehouse-location-bin-setup:step-4": target("link", [], "receiving-ready inbound purchase order", { selector: "main a[href^='/warehouse/purchase-orders?po=']" }),

  "stock-receiving-putaway:step-1": target("link", [], "eligible inbound purchase-order receipt", { selector: "main a[href^='/warehouse/purchase-orders?po=']" }),
  "stock-receiving-putaway:step-2": target("button", ["Add to receipt"], "physical receipt-line action", { prepare: "prepare-receipt-line" }),
  "stock-receiving-putaway:step-3": target("button", ["Inspect"], "quality inspection action"),
  "stock-receiving-putaway:step-4": target("button", ["Put away"], "putaway action"),

  "ecommerce-order-intake:step-1": target("button", ["New order / demand", "Import existing tracker"], "order intake choice"),
  "ecommerce-order-intake:step-2": target("textbox", ["Order reference"], "required order identity field", { prepare: "open-new-order" }),
  "ecommerce-order-intake:step-3": target("button", ["Import existing tracker"], "tracker validation entry"),
  "ecommerce-order-intake:step-4": target("button", [], "fulfillment queue record", {
    selector: "section[aria-labelledby='orders-title'] li:has-text('Ecommerce') button:has-text('View order details')",
    sourceContext: "ecommerce",
  }),

  "ecommerce-fulfillment-delivery:step-1": target("button", ["Allocate stock", "Start picking"], "allocation and pick action"),
  "ecommerce-fulfillment-delivery:step-2": target("button", ["Confirm scanned pick", "Pack and add waybill", "Prepare accountable handover"], "actual scan-and-pack action"),
  "ecommerce-fulfillment-delivery:step-3": target("button", ["Release shipment", "Release handover"], "dispatch action"),
  "ecommerce-fulfillment-delivery:step-4": target("button", ["Update delivery"], "delivery outcome action"),

  "returns-replacements-refunds-rma:step-1": target("textbox", ["Serial number"], "serial-to-original-release lookup", { prepare: "select-serialized-return" }),
  "returns-replacements-refunds-rma:step-2": target("button", ["Record return"], "controlled return receipt action", { prepare: "prepare-return-form" }),
  "returns-replacements-refunds-rma:step-3": target("combobox", ["Disposition"], "governed return disposition", { prepare: "open-first-quality-inspection" }),
  "returns-replacements-refunds-rma:step-4": target("button", ["Submit inspection"], "final return disposition action", { prepare: "prepare-quality-disposition" }),

  "department-inventory-release:step-1": target("button", ["New stock request"], "department stock request action", { prepare: "open-department-requests" }),
  "department-inventory-release:step-2": target("button", ["Approve"], "actual department release approval", { prepare: "open-department-requests" }),
  "department-inventory-release:step-3": target("button", ["Allocate stock", "Start picking", "Release handover"], "department release execution", { prepare: "open-orders-events" }),
  "department-inventory-release:step-4": target("button", ["Acknowledge receipt"], "recipient custody acknowledgement", { prepare: "open-orders-events" }),

  "event-stock-custody:step-1": target("button", ["Create event", "New event", "Plan event"], "event demand creation"),
  "event-stock-custody:step-2": target("button", ["Allocate stock", "Start picking"], "event stock transfer action", { prepare: "open-orders-events" }),
  "event-stock-custody:step-3": target("button", ["Start reconciliation", "Edit outcomes"], "event outcome and return action", { prepare: "open-first-event", observedRoutePattern: "^/events/[^/]+$" }),
  "event-stock-custody:step-4": target("button", ["Approve settlement"], "event reconciliation decision", { prepare: "open-first-event", observedRoutePattern: "^/events/[^/]+$" }),

  "inventory-count-variance:step-1": target("combobox", ["Location"], "cycle-count scope control"),
  "inventory-count-variance:step-2": target("button", ["Submit count"], "observed quantity submission", { nameMode: "prefix", prepare: "prepare-count-entry" }),
  "inventory-count-variance:step-3": target("button", ["Approve change", "Review"], "variance decision action", { nameMode: "prefix" }),
  "inventory-count-variance:step-4": target("tab", ["Recently decided"], "posted count readback action"),

  "department-doa-activation:step-1": target("button", ["Create revision", "Create department matrix"], "versioned DOA draft action"),
  "department-doa-activation:step-2": target("button", ["Add tier", "Save draft"], "DOA tier definition action", { prepare: "open-doa-draft" }),
  "department-doa-activation:step-3": target("button", ["Activate"], "DOA activation action"),
  "department-doa-activation:step-4": target("combobox", ["Department"], "Procurement DOA readback control", { prepare: "open-procurement-department-step" }),

  "finance-readiness-evidence:step-1": target("link", ["Review next payment pack"], "Finance control-center next-work action"),
  "finance-readiness-evidence:step-2": target("link", [], "source-record trace with financial context", { selector: "section[aria-labelledby='finance-activity-title'] a" }),
  "finance-readiness-evidence:step-3": target("link", [], "payment-readiness source action", { selector: "section[aria-label='Payment readiness'] a" }),
  "finance-readiness-evidence:step-4": target("button", ["Prepare close entry"], "governed Finance close preparation"),

  "product-readiness-pricing-go-live:step-1": target("button", ["New readiness package"], "readiness package submission"),
  "product-readiness-pricing-go-live:step-2": target("button", ["Approve go-live", "Reject go-live"], "current Product package review action"),
  "product-readiness-pricing-go-live:step-3": target("button", ["Approve go-live", "Reject go-live"], "actual Product go-live decision", { prepare: "open-product-decision" }),
  "product-readiness-pricing-go-live:step-4": target("button", ["Acknowledge Operations handoff"], "Operations handoff acknowledgement"),
});
