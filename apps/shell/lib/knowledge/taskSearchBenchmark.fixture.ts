// Fixed intent/answer pairs; expectations are not generated from search results.
export const TASK_SEARCH_BENCHMARK = [
  {
    "persona": "platform_administrator",
    "roleId": "platform_admin",
    "kind": "literal",
    "query": "Review an access request",
    "expectedTaskId": "review-access-request"
  },
  {
    "persona": "platform_administrator",
    "roleId": "platform_admin",
    "kind": "colloquial",
    "query": "fix permissions",
    "expectedTaskId": "review-access-request"
  },
  {
    "persona": "platform_administrator",
    "roleId": "platform_admin",
    "kind": "recovery",
    "query": "missing access",
    "expectedTaskId": "review-access-request"
  },
  {
    "persona": "platform_administrator",
    "roleId": "platform_admin",
    "kind": "handoff",
    "query": "approved assignment",
    "expectedTaskId": "maintain-approved-assignments"
  },
  {
    "persona": "platform_administrator",
    "roleId": "platform_admin",
    "kind": "policy",
    "query": "role assignment policy",
    "expectedTaskId": "review-access-request"
  },
  {
    "persona": "general_employee",
    "roleId": "procurement_requester",
    "kind": "literal",
    "query": "Create a purchase request",
    "expectedTaskId": "create-purchase-request"
  },
  {
    "persona": "general_employee",
    "roleId": "procurement_requester",
    "kind": "colloquial",
    "query": "buy something",
    "expectedTaskId": "create-purchase-request"
  },
  {
    "persona": "general_employee",
    "roleId": "procurement_requester",
    "kind": "recovery",
    "query": "returned request",
    "expectedTaskId": "track-submitted-work"
  },
  {
    "persona": "general_employee",
    "roleId": "procurement_requester",
    "kind": "handoff",
    "query": "approver handoff",
    "expectedTaskId": "track-submitted-work"
  },
  {
    "persona": "general_employee",
    "roleId": "procurement_requester",
    "kind": "policy",
    "query": "request budget policy",
    "expectedTaskId": "create-purchase-request"
  },
  {
    "persona": "operations_associate",
    "roleId": "warehouse_operator",
    "kind": "literal",
    "query": "Receive and inspect stock",
    "expectedTaskId": "receive-inspect-stock"
  },
  {
    "persona": "operations_associate",
    "roleId": "warehouse_operator",
    "kind": "colloquial",
    "query": "pick pack",
    "expectedTaskId": "pick-pack-order"
  },
  {
    "persona": "operations_associate",
    "roleId": "warehouse_operator",
    "kind": "recovery",
    "query": "duplicate serial",
    "expectedTaskId": "receive-inspect-stock"
  },
  {
    "persona": "operations_associate",
    "roleId": "warehouse_operator",
    "kind": "handoff",
    "query": "accepted stock handoff",
    "expectedTaskId": "put-away-stock"
  },
  {
    "persona": "operations_associate",
    "roleId": "warehouse_operator",
    "kind": "policy",
    "query": "delivery inspection policy",
    "expectedTaskId": "receive-inspect-stock"
  },
  {
    "persona": "operations_lead",
    "roleId": "warehouse_supervisor",
    "kind": "literal",
    "query": "Resolve a quality hold",
    "expectedTaskId": "resolve-quality-hold"
  },
  {
    "persona": "operations_lead",
    "roleId": "warehouse_supervisor",
    "kind": "colloquial",
    "query": "quarantine release",
    "expectedTaskId": "resolve-quality-hold"
  },
  {
    "persona": "operations_lead",
    "roleId": "warehouse_supervisor",
    "kind": "recovery",
    "query": "count mismatch",
    "expectedTaskId": "review-count-variance"
  },
  {
    "persona": "operations_lead",
    "roleId": "warehouse_supervisor",
    "kind": "handoff",
    "query": "operator putaway handoff",
    "expectedTaskId": "maintain-storage-setup"
  },
  {
    "persona": "operations_lead",
    "roleId": "warehouse_supervisor",
    "kind": "policy",
    "query": "quality hold policy",
    "expectedTaskId": "resolve-quality-hold"
  },
  {
    "persona": "procurement_lead",
    "roleId": "procurement_officer",
    "kind": "literal",
    "query": "Author a purchase order",
    "expectedTaskId": "author-purchase-order"
  },
  {
    "persona": "procurement_lead",
    "roleId": "procurement_officer",
    "kind": "colloquial",
    "query": "issue PO",
    "expectedTaskId": "author-purchase-order"
  },
  {
    "persona": "procurement_lead",
    "roleId": "procurement_officer",
    "kind": "recovery",
    "query": "rejected quotation",
    "expectedTaskId": "source-eligible-vendor"
  },
  {
    "persona": "procurement_lead",
    "roleId": "procurement_officer",
    "kind": "handoff",
    "query": "receiving handoff",
    "expectedTaskId": "author-purchase-order"
  },
  {
    "persona": "procurement_lead",
    "roleId": "procurement_officer",
    "kind": "policy",
    "query": "budget DOA",
    "expectedTaskId": "progress-purchase-request"
  },
  {
    "persona": "finance",
    "roleId": "procurement_finance",
    "kind": "literal",
    "query": "Review matching and payment readiness",
    "expectedTaskId": "review-payment-readiness"
  },
  {
    "persona": "finance",
    "roleId": "procurement_finance",
    "kind": "colloquial",
    "query": "three way match",
    "expectedTaskId": "review-payment-readiness"
  },
  {
    "persona": "finance",
    "roleId": "procurement_finance",
    "kind": "recovery",
    "query": "invoice mismatch",
    "expectedTaskId": "review-payment-readiness"
  },
  {
    "persona": "finance",
    "roleId": "procurement_finance",
    "kind": "handoff",
    "query": "missing receipt",
    "expectedTaskId": "review-payment-readiness"
  },
  {
    "persona": "finance",
    "roleId": "procurement_finance",
    "kind": "policy",
    "query": "payment readiness policy",
    "expectedTaskId": "review-payment-readiness"
  },
  {
    "persona": "legal",
    "roleId": "legal_admin",
    "kind": "literal",
    "query": "Review accreditation",
    "expectedTaskId": "review-accreditation"
  },
  {
    "persona": "legal",
    "roleId": "legal_admin",
    "kind": "colloquial",
    "query": "vendor accreditation review",
    "expectedTaskId": "review-accreditation"
  },
  {
    "persona": "legal",
    "roleId": "legal_admin",
    "kind": "recovery",
    "query": "expired documents",
    "expectedTaskId": "review-accreditation"
  },
  {
    "persona": "legal",
    "roleId": "legal_admin",
    "kind": "handoff",
    "query": "vendor response handoff",
    "expectedTaskId": "request-vendor-correction"
  },
  {
    "persona": "legal",
    "roleId": "legal_admin",
    "kind": "policy",
    "query": "approval matrix policy",
    "expectedTaskId": "manage-doa-revision"
  },
  {
    "persona": "marketing",
    "roleId": "events_coordinator",
    "kind": "literal",
    "query": "Create an event",
    "expectedTaskId": "create-event"
  },
  {
    "persona": "marketing",
    "roleId": "events_coordinator",
    "kind": "colloquial",
    "query": "campaign supplies",
    "expectedTaskId": "request-event-inventory"
  },
  {
    "persona": "marketing",
    "roleId": "events_coordinator",
    "kind": "recovery",
    "query": "invalid event dates",
    "expectedTaskId": "create-event"
  },
  {
    "persona": "marketing",
    "roleId": "events_coordinator",
    "kind": "handoff",
    "query": "Warehouse allocation handoff",
    "expectedTaskId": "request-event-inventory"
  },
  {
    "persona": "marketing",
    "roleId": "events_coordinator",
    "kind": "policy",
    "query": "event custody policy",
    "expectedTaskId": "request-event-inventory"
  },
  {
    "persona": "product_owner",
    "roleId": "product_owner",
    "kind": "literal",
    "query": "Review product readiness",
    "expectedTaskId": "review-product-readiness"
  },
  {
    "persona": "product_owner",
    "roleId": "product_owner",
    "kind": "colloquial",
    "query": "go live decision",
    "expectedTaskId": "review-product-decisions"
  },
  {
    "persona": "product_owner",
    "roleId": "product_owner",
    "kind": "recovery",
    "query": "product blockers",
    "expectedTaskId": "review-product-readiness"
  },
  {
    "persona": "product_owner",
    "roleId": "product_owner",
    "kind": "handoff",
    "query": "Operations launch handoff",
    "expectedTaskId": "review-product-readiness"
  },
  {
    "persona": "product_owner",
    "roleId": "product_owner",
    "kind": "policy",
    "query": "pricing policy",
    "expectedTaskId": "inspect-pricing-context"
  },
  {
    "persona": "leadership",
    "roleId": "insights_executive",
    "kind": "literal",
    "query": "Inspect a source-linked report",
    "expectedTaskId": "inspect-source-report"
  },
  {
    "persona": "leadership",
    "roleId": "insights_executive",
    "kind": "colloquial",
    "query": "show dashboard",
    "expectedTaskId": "inspect-source-report"
  },
  {
    "persona": "leadership",
    "roleId": "insights_executive",
    "kind": "recovery",
    "query": "stale report",
    "expectedTaskId": "validate-data-freshness"
  },
  {
    "persona": "leadership",
    "roleId": "insights_executive",
    "kind": "handoff",
    "query": "source owner handoff",
    "expectedTaskId": "review-insight-exceptions"
  },
  {
    "persona": "leadership",
    "roleId": "insights_executive",
    "kind": "policy",
    "query": "governed reporting policy",
    "expectedTaskId": "validate-data-freshness"
  },
  {
    "persona": "vendor",
    "roleId": "vendor_portal",
    "kind": "literal",
    "query": "Prepare vendor evidence",
    "expectedTaskId": "prepare-vendor-evidence"
  },
  {
    "persona": "vendor",
    "roleId": "vendor_portal",
    "kind": "colloquial",
    "query": "confirm awarded order",
    "expectedTaskId": "acknowledge-vendor-po"
  },
  {
    "persona": "vendor",
    "roleId": "vendor_portal",
    "kind": "recovery",
    "query": "missing vendor evidence",
    "expectedTaskId": "prepare-vendor-evidence"
  },
  {
    "persona": "vendor",
    "roleId": "vendor_portal",
    "kind": "handoff",
    "query": "Legal resubmission handoff",
    "expectedTaskId": "respond-vendor-corrections"
  },
  {
    "persona": "vendor",
    "roleId": "vendor_portal",
    "kind": "policy",
    "query": "accreditation evidence policy",
    "expectedTaskId": "prepare-vendor-evidence"
  }
] as const;
