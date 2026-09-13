import type { LearningCapability } from "./types";

// Reviewed v1 inputs from the pre-10cb745 catalog, protected by the original
// default-catalog goldens. This source baseline is NOT the DB-published catalog
// or proof of live training coverage. Server-published requirements and outcomes
// remain authoritative; these entries never establish current role authority.
// Change outcomes or membership only through a reviewed, versioned curriculum.
export const REVIEWED_V1_ROLE_PRACTICES: readonly {
  module: LearningCapability["module"];
  role: string;
  capabilities: readonly string[];
}[] = [
  {
    module: "core",
    role: "platform_admin",
    capabilities: [
      "manage_rbac",
      "manage_vendors",
      "manage_accreditation",
      "manage_documents",
      "manage_approvals",
      "record_approval",
      "manage_notifications",
    ],
  },
  {
    module: "core",
    role: "staff",
    capabilities: [],
  },
  {
    module: "core",
    role: "vendor_portal",
    capabilities: ["submit_accreditation"],
  },
  {
    module: "warehouse",
    role: "warehouse_operator",
    capabilities: [
      "receive_stock",
      "manage_inventory",
      "cycle_count",
      "manage_returns",
      "reserve_allocate",
      "issue_items",
      "transfer_stock",
      "inspect_quality",
    ],
  },
  {
    module: "warehouse",
    role: "warehouse_supervisor",
    capabilities: [
      "receive_stock",
      "manage_inventory",
      "manage_products",
      "manage_locations",
      "cycle_count",
      "manage_returns",
      "reserve_allocate",
      "issue_items",
      "transfer_stock",
      "manage_operation_routes",
      "inspect_quality",
      "release_quality_hold",
      "approve_stock_adjustment",
      "resolve_exceptions",
      "import_warehouse_data",
    ],
  },
  {
    module: "warehouse",
    role: "logistics_supervisor",
    capabilities: [
      "receive_stock",
      "manage_inventory",
      "manage_products",
      "manage_locations",
      "cycle_count",
      "manage_returns",
      "reserve_allocate",
      "issue_items",
      "transfer_stock",
      "manage_operation_routes",
      "inspect_quality",
      "release_quality_hold",
      "approve_stock_adjustment",
      "resolve_exceptions",
      "import_warehouse_data",
    ],
  },
  {
    module: "warehouse",
    role: "operations",
    capabilities: [
      "request_fulfillment",
      "request_stock",
      "submit_return_case",
    ],
  },
  {
    module: "warehouse",
    role: "finance",
    capabilities: ["manage_finance_close", "approve_stock_adjustment_finance"],
  },
  {
    module: "warehouse",
    role: "bi_analyst",
    capabilities: [],
  },
  {
    module: "warehouse",
    role: "business_unit",
    capabilities: ["request_stock"],
  },
  {
    module: "warehouse",
    role: "marketing",
    capabilities: ["request_stock"],
  },
  {
    module: "warehouse",
    role: "procurement",
    capabilities: ["manage_products"],
  },
  {
    module: "warehouse",
    role: "pricing",
    capabilities: [],
  },
  {
    module: "warehouse",
    role: "warehouse_admin",
    capabilities: [
      "receive_stock",
      "manage_inventory",
      "manage_products",
      "manage_locations",
      "cycle_count",
      "manage_returns",
      "request_fulfillment",
      "request_stock",
      "submit_return_case",
      "reserve_allocate",
      "issue_items",
      "transfer_stock",
      "manage_operation_routes",
      "inspect_quality",
      "release_quality_hold",
      "approve_stock_adjustment",
      "approve_stock_adjustment_finance",
      "resolve_exceptions",
      "import_warehouse_data",
    ],
  },
  {
    module: "procurement",
    role: "requester",
    capabilities: ["create_request", "cancel_request"],
  },
  {
    module: "procurement",
    role: "procurement_officer",
    capabilities: [
      "create_request",
      "manage_rfp",
      "manage_request_collaborators",
      "cancel_request",
      "author_po",
      "manage_vendors",
      "approve_request",
    ],
  },
  {
    module: "procurement",
    role: "approver",
    capabilities: ["approve_request", "approve_award", "final_approve_po"],
  },
  {
    module: "procurement",
    role: "finance",
    capabilities: [
      "approve_request",
      "accept_payment_readiness",
      "review_payment_readiness",
      "release_payment",
    ],
  },
  {
    module: "procurement",
    role: "admin",
    capabilities: [
      "create_request",
      "manage_rfp",
      "manage_request_collaborators",
      "cancel_request",
      "author_po",
      "approve_request",
      "approve_award",
      "final_approve_po",
      "manage_vendors",
      "accept_payment_readiness",
      "review_payment_readiness",
      "release_payment",
      "admin",
    ],
  },
  {
    module: "legal",
    role: "legal_reviewer",
    capabilities: [
      "review_accreditation",
      "manage_checklist",
      "approve_accreditation",
      "manage_documents",
    ],
  },
  {
    module: "legal",
    role: "compliance",
    capabilities: [
      "review_accreditation",
      "approve_accreditation",
      "manage_documents",
    ],
  },
  {
    module: "legal",
    role: "admin",
    capabilities: [
      "review_accreditation",
      "manage_checklist",
      "approve_accreditation",
      "manage_documents",
      "manage_doa",
      "admin",
    ],
  },
  {
    module: "events",
    role: "requester",
    capabilities: ["create_event", "request_fulfillment"],
  },
  {
    module: "events",
    role: "coordinator",
    capabilities: [
      "create_event",
      "manage_events",
      "request_fulfillment",
      "close_event",
    ],
  },
  {
    module: "events",
    role: "viewer",
    capabilities: [],
  },
  {
    module: "events",
    role: "finance_reviewer",
    capabilities: ["approve_settlement"],
  },
  {
    module: "events",
    role: "admin",
    capabilities: [
      "create_event",
      "manage_events",
      "request_fulfillment",
      "close_event",
      "admin",
    ],
  },
  {
    module: "insights",
    role: "analyst",
    capabilities: [],
  },
  {
    module: "insights",
    role: "manager",
    capabilities: [],
  },
  {
    module: "insights",
    role: "executive",
    capabilities: [],
  },
  {
    module: "insights",
    role: "admin",
    capabilities: ["admin"],
  },
  {
    module: "product",
    role: "contributor",
    capabilities: ["prepare_readiness", "propose_pricing"],
  },
  {
    module: "product",
    role: "product_owner",
    capabilities: ["decide_go_live", "approve_pricing"],
  },
  {
    module: "product",
    role: "operations_partner",
    capabilities: ["acknowledge_operations_handoff"],
  },
];

// Preserve the existing non-assigned placeholder; this is not executable training.
export const REVIEWED_V1_UNASSIGNED_CAPABILITIES: readonly LearningCapability[] =
  [
    {
      module: "warehouse",
      capability: "set_pricing",
    },
  ];

// Existing SQL grants aligned in 10cb745, missing from the pinned source outcomes.
// Source-only review backlog, not an inventory of DB-published training coverage.
// This list neither assigns requirements nor certifies any capability.
export const PENDING_ROLE_TRAINING_COVERAGE: readonly (LearningCapability & {
  role: string;
  status: "pending_versioned_review";
})[] = [
  {
    module: "warehouse",
    role: "warehouse_operator",
    capability: "submit_return_case",
    status: "pending_versioned_review",
  },
  {
    module: "warehouse",
    role: "warehouse_supervisor",
    capability: "submit_return_case",
    status: "pending_versioned_review",
  },
  {
    module: "warehouse",
    role: "logistics_supervisor",
    capability: "submit_return_case",
    status: "pending_versioned_review",
  },
  {
    module: "warehouse",
    role: "operations",
    capability: "recommend_replenishment",
    status: "pending_versioned_review",
  },
  {
    module: "warehouse",
    role: "operations",
    capability: "register_exports",
    status: "pending_versioned_review",
  },
  {
    module: "warehouse",
    role: "finance",
    capability: "register_exports",
    status: "pending_versioned_review",
  },
  {
    module: "warehouse",
    role: "finance",
    capability: "review_exports",
    status: "pending_versioned_review",
  },
  {
    module: "warehouse",
    role: "bi_analyst",
    capability: "register_exports",
    status: "pending_versioned_review",
  },
  {
    module: "procurement",
    role: "procurement_officer",
    capability: "cancel_purchase_order",
    status: "pending_versioned_review",
  },
  {
    module: "procurement",
    role: "procurement_officer",
    capability: "manage_replenishment",
    status: "pending_versioned_review",
  },
  {
    module: "procurement",
    role: "admin",
    capability: "cancel_purchase_order",
    status: "pending_versioned_review",
  },
  {
    module: "procurement",
    role: "admin",
    capability: "manage_replenishment",
    status: "pending_versioned_review",
  },
];
