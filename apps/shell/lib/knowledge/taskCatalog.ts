import type { LearningCapability } from "@intra/learning";
import type { KnowledgeAvailability, KnowledgeContent, KnowledgeModule } from "./types";
import { knowledgeContentForAudience } from "./audience";

export interface TaskDefinition {
  id: string;
  title: string;
  outcome: string;
  audience: "internal" | "vendor";
  roleIds: readonly string[];
  featureId: string;
  flowId?: string;
  actionCapabilities: readonly LearningCapability[];
  availability: KnowledgeAvailability;
  priority: number;
  guideHref: string;
  actionHref: string;
  module: KnowledgeModule;
  moduleLabel: string;
  personaIds: readonly string[];
  aliases: readonly string[];
}

export type TaskRoleAssignments = Readonly<Record<string, readonly string[] | undefined>>;

interface TaskSeed extends Omit<TaskDefinition, "roleIds" | "guideHref" | "module" | "moduleLabel" | "availability"> {
  allowedRoleIds?: readonly string[];
}

// Presentation inventory only. Record eligibility, certification, and command
// authorization remain with the existing source APIs and action guards.
const TASK_SEEDS: readonly TaskSeed[] = [
  {
    "id": "review-access-request",
    "title": "Review an access request",
    "outcome": "Confirm the approved identity and least-privilege assignment before changing access.",
    "personaIds": [
      "platform_administrator"
    ],
    "featureId": "admin-users",
    "actionHref": "/admin/users",
    "priority": 10,
    "actionCapabilities": [
      {
        "module": "core",
        "capability": "manage_rbac"
      }
    ],
    "aliases": [
      "access request",
      "fix permissions",
      "missing access",
      "role assignment policy"
    ],
    "audience": "internal"
  },
  {
    "id": "inspect-audit-history",
    "title": "Inspect audit history",
    "outcome": "Find the actor, time, and source record for an access or governance change.",
    "personaIds": [
      "platform_administrator"
    ],
    "featureId": "admin-audit",
    "actionHref": "/admin/audit",
    "priority": 20,
    "actionCapabilities": [],
    "aliases": [
      "audit log",
      "who changed access",
      "access investigation"
    ],
    "audience": "internal"
  },
  {
    "id": "maintain-approved-assignments",
    "title": "Maintain approved assignments",
    "outcome": "Record only the department owner's approved scoped role changes.",
    "personaIds": [
      "platform_administrator"
    ],
    "featureId": "admin-users",
    "actionHref": "/admin/users",
    "priority": 30,
    "actionCapabilities": [
      {
        "module": "core",
        "capability": "manage_rbac"
      }
    ],
    "aliases": [
      "assign roles",
      "approved assignment",
      "revoked access"
    ],
    "audience": "internal"
  },
  {
    "id": "request-stock",
    "title": "Request stock",
    "outcome": "Send an attributable stock request to Warehouse for allocation and issue.",
    "personaIds": [
      "general_employee"
    ],
    "featureId": "warehouse-fulfillment",
    "actionHref": "/warehouse/fulfillment",
    "priority": 10,
    "actionCapabilities": [
      {
        "module": "warehouse",
        "capability": "request_stock"
      }
    ],
    "aliases": [
      "need supplies",
      "stock request",
      "request inventory",
      "missing request evidence"
    ],
    "audience": "internal"
  },
  {
    "id": "create-purchase-request",
    "title": "Create a purchase request",
    "outcome": "Record the business need, budget, lines, and evidence for Procurement review.",
    "personaIds": [
      "general_employee"
    ],
    "featureId": "procurement-request-create",
    "actionHref": "/procurement",
    "priority": 20,
    "actionCapabilities": [
      {
        "module": "procurement",
        "capability": "create_request"
      }
    ],
    "aliases": [
      "buy something",
      "purchase requisition",
      "raise a PR",
      "request budget policy"
    ],
    "audience": "internal"
  },
  {
    "id": "track-submitted-work",
    "title": "Track submitted work",
    "outcome": "Locate the submitted record, current status, and next owner in My Work.",
    "personaIds": [
      "general_employee"
    ],
    "featureId": "my-work",
    "actionHref": "/work",
    "priority": 30,
    "actionCapabilities": [],
    "aliases": [
      "where is my request",
      "returned request",
      "track approval",
      "approver handoff"
    ],
    "audience": "internal"
  },
  {
    "id": "receive-inspect-stock",
    "title": "Receive and inspect stock",
    "outcome": "Record the approved delivery and inspection evidence without releasing held stock.",
    "personaIds": [
      "operations_associate"
    ],
    "featureId": "warehouse-purchase-orders",
    "actionHref": "/warehouse/purchase-orders",
    "priority": 10,
    "actionCapabilities": [
      {
        "module": "warehouse",
        "capability": "receive_stock"
      },
      {
        "module": "warehouse",
        "capability": "inspect_quality"
      }
    ],
    "aliases": [
      "receive delivery",
      "goods receipt",
      "duplicate serial",
      "quantity variance",
      "delivery inspection policy"
    ],
    "audience": "internal",
    "flowId": "receive-to-putaway"
  },
  {
    "id": "put-away-stock",
    "title": "Put away stock",
    "outcome": "Move accepted stock into its confirmed warehouse, rack, and bin.",
    "personaIds": [
      "operations_associate"
    ],
    "featureId": "warehouse-storage",
    "actionHref": "/warehouse/storage",
    "priority": 20,
    "actionCapabilities": [
      {
        "module": "warehouse",
        "capability": "transfer_stock"
      }
    ],
    "aliases": [
      "putaway",
      "shelve accepted stock",
      "accepted stock handoff",
      "scan destination bin"
    ],
    "audience": "internal"
  },
  {
    "id": "pick-pack-order",
    "title": "Pick and pack an assigned order",
    "outcome": "Verify allocated items and packaging, then hand the order to the release owner.",
    "personaIds": [
      "operations_associate"
    ],
    "featureId": "warehouse-fulfillment",
    "actionHref": "/warehouse/fulfillment",
    "priority": 30,
    "actionCapabilities": [
      {
        "module": "warehouse",
        "capability": "reserve_allocate"
      },
      {
        "module": "warehouse",
        "capability": "issue_items"
      }
    ],
    "aliases": [
      "pick pack",
      "pack an order",
      "picking queue",
      "dispatch handoff"
    ],
    "audience": "internal"
  },
  {
    "id": "resolve-quality-hold",
    "title": "Resolve a quality hold",
    "outcome": "Review operator evidence and record the supported hold or release decision.",
    "personaIds": [
      "operations_lead"
    ],
    "featureId": "warehouse-quality",
    "actionHref": "/warehouse/quality",
    "priority": 10,
    "actionCapabilities": [
      {
        "module": "warehouse",
        "capability": "release_quality_hold"
      }
    ],
    "aliases": [
      "quarantine release",
      "held stock",
      "quality disposition",
      "quality hold policy"
    ],
    "audience": "internal",
    "flowId": "quality-disposition"
  },
  {
    "id": "review-count-variance",
    "title": "Review count variance",
    "outcome": "Compare physical count evidence before approving a controlled stock adjustment.",
    "personaIds": [
      "operations_lead"
    ],
    "featureId": "warehouse-approvals",
    "actionHref": "/warehouse/approvals",
    "priority": 20,
    "actionCapabilities": [
      {
        "module": "warehouse",
        "capability": "approve_stock_adjustment"
      }
    ],
    "aliases": [
      "count mismatch",
      "inventory variance",
      "rejected stock adjustment",
      "count separation of duties"
    ],
    "audience": "internal",
    "flowId": "cycle-count-adjustment"
  },
  {
    "id": "maintain-storage-setup",
    "title": "Maintain storage setup",
    "outcome": "Keep locations and bins valid for current warehouse stock and movements.",
    "personaIds": [
      "operations_lead"
    ],
    "featureId": "warehouse-locations",
    "actionHref": "/warehouse/locations",
    "priority": 30,
    "actionCapabilities": [
      {
        "module": "warehouse",
        "capability": "manage_locations"
      }
    ],
    "aliases": [
      "warehouse setup",
      "storage locations",
      "bin setup",
      "operator putaway handoff"
    ],
    "audience": "internal",
    "flowId": "warehouse-setup"
  },
  {
    "id": "progress-purchase-request",
    "title": "Progress a purchase request",
    "outcome": "Review submitted need and evidence before routing the next sourcing step.",
    "personaIds": [
      "procurement_lead"
    ],
    "featureId": "procurement-request-detail",
    "actionHref": "/procurement",
    "priority": 10,
    "actionCapabilities": [
      {
        "module": "procurement",
        "capability": "manage_rfp"
      }
    ],
    "aliases": [
      "process PR",
      "review purchase requests",
      "returned sourcing",
      "budget DOA"
    ],
    "audience": "internal",
    "flowId": "procure-to-pay"
  },
  {
    "id": "source-eligible-vendor",
    "title": "Source an eligible vendor",
    "outcome": "Check sourcing evidence and accreditation before recommending a supplier.",
    "personaIds": [
      "procurement_lead"
    ],
    "featureId": "procurement-request-detail",
    "actionHref": "/procurement",
    "priority": 20,
    "actionCapabilities": [
      {
        "module": "procurement",
        "capability": "manage_rfp"
      }
    ],
    "aliases": [
      "find eligible supplier",
      "vendor eligibility",
      "supplier accreditation",
      "rejected quotation",
      "sourcing policy"
    ],
    "audience": "internal",
    "flowId": "procure-to-pay"
  },
  {
    "id": "author-purchase-order",
    "title": "Author a purchase order",
    "outcome": "Prepare the PO from an approved sourcing outcome and verify issue readiness.",
    "personaIds": [
      "procurement_lead"
    ],
    "featureId": "procurement-purchase-orders",
    "actionHref": "/procurement/purchase-orders",
    "priority": 30,
    "actionCapabilities": [
      {
        "module": "procurement",
        "capability": "author_po"
      }
    ],
    "aliases": [
      "issue PO",
      "prepare purchase order",
      "receiving handoff",
      "supplier commitment"
    ],
    "audience": "internal",
    "flowId": "procure-to-pay"
  },
  {
    "id": "review-payment-readiness",
    "title": "Review matching and payment readiness",
    "outcome": "Check receipt, acceptance, invoice, and matching evidence before Finance review.",
    "personaIds": [
      "finance_controller"
    ],
    "featureId": "procurement-purchase-orders",
    "actionHref": "/procurement/purchase-orders",
    "priority": 10,
    "actionCapabilities": [
      {
        "module": "procurement",
        "capability": "review_payment_readiness"
      }
    ],
    "aliases": [
      "three way match",
      "3 way match",
      "invoice mismatch",
      "missing receipt",
      "payment readiness policy"
    ],
    "audience": "internal",
    "flowId": "procure-to-pay"
  },
  {
    "id": "review-inventory-close",
    "title": "Review inventory close",
    "outcome": "Reconcile inventory valuation and supported close entries in Finance.",
    "personaIds": [
      "finance_controller"
    ],
    "featureId": "warehouse-finance",
    "actionHref": "/finance",
    "priority": 20,
    "actionCapabilities": [
      {
        "module": "warehouse",
        "capability": "manage_finance_close"
      }
    ],
    "aliases": [
      "month end inventory",
      "valuation close",
      "COGS reconciliation",
      "inventory close"
    ],
    "audience": "internal"
  },
  {
    "id": "review-event-settlement",
    "title": "Review event settlement",
    "outcome": "Independently review event balances and return unsupported evidence to its preparer.",
    "personaIds": [
      "finance_controller"
    ],
    "featureId": "events-workspace",
    "actionHref": "/events",
    "priority": 30,
    "actionCapabilities": [
      {
        "module": "events",
        "capability": "approve_settlement"
      }
    ],
    "aliases": [
      "approve event settlement",
      "event finance review",
      "event settlement handoff",
      "settlement variance"
    ],
    "audience": "internal",
    "flowId": "event-fulfillment"
  },
  {
    "id": "review-accreditation",
    "title": "Review accreditation",
    "outcome": "Inspect vendor evidence, risk, and instruments within the assigned Legal review.",
    "personaIds": [
      "legal_compliance_lead"
    ],
    "featureId": "legal-case-detail",
    "actionHref": "/legal",
    "priority": 10,
    "actionCapabilities": [
      {
        "module": "legal",
        "capability": "review_accreditation"
      }
    ],
    "aliases": [
      "vendor accreditation review",
      "review vendor case",
      "expired documents",
      "accreditation policy"
    ],
    "audience": "internal",
    "flowId": "vendor-accreditation"
  },
  {
    "id": "request-vendor-correction",
    "title": "Request corrected vendor evidence",
    "outcome": "Open a versioned correction request and retain the submitted vendor snapshot.",
    "personaIds": [
      "legal_compliance_lead"
    ],
    "featureId": "legal-case-detail",
    "actionHref": "/legal",
    "priority": 20,
    "actionCapabilities": [
      {
        "module": "legal",
        "capability": "review_accreditation"
      }
    ],
    "aliases": [
      "return vendor evidence",
      "corrected documents",
      "request correction",
      "vendor response handoff"
    ],
    "audience": "internal",
    "flowId": "vendor-accreditation"
  },
  {
    "id": "manage-doa-revision",
    "title": "Manage a controlled DOA revision",
    "outcome": "Validate and activate an authorized effective-dated delegation revision.",
    "personaIds": [
      "legal_compliance_lead"
    ],
    "featureId": "admin-doa",
    "actionHref": "/admin/doa",
    "priority": 30,
    "actionCapabilities": [
      {
        "module": "legal",
        "capability": "manage_doa"
      }
    ],
    "aliases": [
      "delegation of authority",
      "DOA revision",
      "approval matrix policy",
      "publish authority"
    ],
    "audience": "internal",
    "flowId": "doa-governance"
  },
  {
    "id": "create-event",
    "title": "Create an event",
    "outcome": "Record event dates, purpose, and owner for an accountable activation.",
    "personaIds": [
      "marketing_events_lead"
    ],
    "featureId": "events-workspace",
    "actionHref": "/events",
    "priority": 10,
    "actionCapabilities": [
      {
        "module": "events",
        "capability": "create_event"
      }
    ],
    "aliases": [
      "plan event",
      "new campaign event",
      "invalid event dates"
    ],
    "audience": "internal"
  },
  {
    "id": "request-event-inventory",
    "title": "Request event inventory",
    "outcome": "Send complete event demand to Warehouse without changing physical custody.",
    "personaIds": [
      "marketing_events_lead"
    ],
    "featureId": "events-workspace",
    "actionHref": "/events",
    "priority": 20,
    "actionCapabilities": [
      {
        "module": "events",
        "capability": "request_fulfillment"
      }
    ],
    "aliases": [
      "event stock request",
      "campaign supplies",
      "Warehouse allocation handoff",
      "event custody policy"
    ],
    "audience": "internal",
    "flowId": "event-fulfillment"
  },
  {
    "id": "reconcile-event-outcomes",
    "title": "Reconcile event outcomes",
    "outcome": "Record consumption, returns, losses, and evidence before Finance settlement.",
    "personaIds": [
      "marketing_events_lead"
    ],
    "featureId": "events-workspace",
    "actionHref": "/events",
    "priority": 30,
    "actionCapabilities": [
      {
        "module": "events",
        "capability": "manage_events"
      }
    ],
    "aliases": [
      "event reconciliation",
      "event losses",
      "return event stock",
      "Finance settlement handoff"
    ],
    "audience": "internal",
    "flowId": "event-fulfillment"
  },
  {
    "id": "review-product-readiness",
    "title": "Review product readiness",
    "outcome": "Inspect current launch criteria, evidence, and unresolved operating conditions.",
    "personaIds": [
      "product_owner"
    ],
    "featureId": "product-governance",
    "actionHref": "/product",
    "priority": 10,
    "actionCapabilities": [],
    "aliases": [
      "launch readiness",
      "product blockers",
      "Operations launch handoff"
    ],
    "audience": "internal",
    "flowId": "product-launch-governance"
  },
  {
    "id": "inspect-pricing-context",
    "title": "Inspect pricing context",
    "outcome": "Read current price proposals and their documented commercial basis.",
    "personaIds": [
      "product_owner"
    ],
    "featureId": "product-governance",
    "actionHref": "/product",
    "priority": 20,
    "actionCapabilities": [],
    "aliases": [
      "pricing context",
      "price proposal basis",
      "pricing policy"
    ],
    "audience": "internal",
    "allowedRoleIds": [
      "product_owner",
      "product_contributor"
    ]
  },
  {
    "id": "review-product-decisions",
    "title": "Review assigned product decisions",
    "outcome": "Make the assigned go-live decision only after readiness evidence is complete.",
    "personaIds": [
      "product_owner"
    ],
    "featureId": "product-governance",
    "actionHref": "/product",
    "priority": 30,
    "actionCapabilities": [
      {
        "module": "product",
        "capability": "decide_go_live"
      }
    ],
    "aliases": [
      "go live decision",
      "approve product launch",
      "unsupported launch decision",
      "launch authority policy"
    ],
    "audience": "internal",
    "flowId": "product-launch-governance"
  },
  {
    "id": "inspect-source-report",
    "title": "Inspect a source-linked report",
    "outcome": "Read an authorized indicator and follow its source record for validation.",
    "personaIds": [
      "leadership_insights"
    ],
    "featureId": "insights-workspace",
    "actionHref": "/insights",
    "priority": 10,
    "actionCapabilities": [],
    "aliases": [
      "source linked report",
      "show dashboard",
      "source drill down",
      "report provenance"
    ],
    "audience": "internal"
  },
  {
    "id": "review-insight-exceptions",
    "title": "Review insight exceptions",
    "outcome": "Identify material risks and their accountable source owners without editing evidence.",
    "personaIds": [
      "leadership_insights"
    ],
    "featureId": "insights-workspace",
    "actionHref": "/insights",
    "priority": 20,
    "actionCapabilities": [],
    "aliases": [
      "performance exceptions",
      "executive risks",
      "exception owner",
      "source owner handoff"
    ],
    "audience": "internal"
  },
  {
    "id": "validate-data-freshness",
    "title": "Validate data freshness",
    "outcome": "Check scope and freshness before using an indicator for a decision.",
    "personaIds": [
      "leadership_insights"
    ],
    "featureId": "insights-workspace",
    "actionHref": "/insights",
    "priority": 30,
    "actionCapabilities": [],
    "aliases": [
      "stale report",
      "old dashboard data",
      "data freshness",
      "governed reporting policy"
    ],
    "audience": "internal"
  },
  {
    "id": "prepare-vendor-evidence",
    "title": "Prepare application evidence",
    "outcome": "Complete the vendor's own company facts and attach the required documents.",
    "personaIds": [
      "vendor_representative"
    ],
    "featureId": "vendor-application",
    "actionHref": "/vendor",
    "priority": 10,
    "actionCapabilities": [
      {
        "module": "core",
        "capability": "manage_own_accreditation_draft"
      },
      {
        "module": "core",
        "capability": "submit_documents"
      }
    ],
    "aliases": [
      "upload company documents",
      "vendor application",
      "missing vendor evidence",
      "accreditation evidence policy"
    ],
    "audience": "vendor"
  },
  {
    "id": "respond-vendor-corrections",
    "title": "Respond to corrections",
    "outcome": "Revise only the vendor's requested version and resubmit evidence to Legal.",
    "personaIds": [
      "vendor_representative"
    ],
    "featureId": "vendor-case-detail",
    "actionHref": "/vendor",
    "priority": 20,
    "actionCapabilities": [
      {
        "module": "core",
        "capability": "manage_own_accreditation_draft"
      },
      {
        "module": "core",
        "capability": "submit_accreditation"
      }
    ],
    "aliases": [
      "fix returned application",
      "Legal correction notice",
      "Legal resubmission handoff",
      "rejected vendor submission"
    ],
    "audience": "vendor"
  },
  {
    "id": "acknowledge-vendor-po",
    "title": "Acknowledge an awarded PO",
    "outcome": "Review the current awarded PO revision and submit a traceable acknowledgement.",
    "personaIds": [
      "vendor_representative"
    ],
    "featureId": "vendor-purchase-orders",
    "actionHref": "/vendor/purchase-orders",
    "priority": 30,
    "actionCapabilities": [
      {
        "module": "core",
        "capability": "submit_accreditation"
      }
    ],
    "aliases": [
      "confirm awarded order",
      "vendor PO acknowledgement",
      "purchase order revision changed",
      "acknowledgement reference"
    ],
    "audience": "vendor"
  }
];

const MODULE_LABELS: Record<KnowledgeModule, string> = {
  core: "Shared work", admin: "Platform", warehouse: "Warehouse",
  procurement: "Procurement", finance: "Finance", legal: "Legal",
  vendor: "Vendor", events: "Events", insights: "Insights", product: "Product",
};

export function taskCatalog(content: KnowledgeContent, audience: "internal" | "vendor" = "internal"): TaskDefinition[] {
  const scoped = knowledgeContentForAudience(content, audience === "vendor" ? "vendor" : "employee");
  return TASK_SEEDS.flatMap((seed): TaskDefinition[] => {
    if (seed.audience !== audience) return [];
    const feature = scoped.features.find(item => item.id === seed.featureId && item.availability === "live");
    const flow = seed.flowId ? scoped.flows.find(item => item.id === seed.flowId && (item.availability ?? "live") === "live") : undefined;
    if (!feature || (seed.flowId && !flow)) return [];
    // The action target must exist as a live list/workspace in the supplied catalog.
    if (!scoped.features.some(item => item.availability === "live" && item.routes.includes(seed.actionHref))) return [];
    const roleIds = scoped.roles.filter(role =>
      role.availability === "live" &&
      (audience === "vendor" ? role.id === "vendor_portal" : role.id !== "vendor_portal") &&
      (feature.roleIds.includes(role.id) || flow?.roles.includes(role.id)) &&
      (!seed.allowedRoleIds || seed.allowedRoleIds.includes(role.id)) &&
      seed.actionCapabilities.every(ref => role.rbacModule === ref.module && role.authority.capabilities.includes(ref.capability))
    ).map(role => role.id);
    if (!roleIds.length) return [];
    const { allowedRoleIds: _allowedRoleIds, ...definition } = seed;
    return [{
      ...definition, roleIds, availability: "live", module: feature.module,
      moduleLabel: MODULE_LABELS[feature.module],
      guideHref: flow
        ? `/knowledge?flow=${encodeURIComponent(flow.id)}&view=flow`
        : `/knowledge?article=${encodeURIComponent(`feature-${feature.id}`)}`,
    }];
  }).sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
}

/** Recommendations for current role scopes, not a certification or record grant. */
export function tasksForRoles(content: KnowledgeContent, userRoles: TaskRoleAssignments, audience: "internal" | "vendor"): TaskDefinition[] {
  // A vendor identity must not be converted to an internal audience by mixed claims.
  if (audience === "internal" && userRoles.core?.includes("vendor_portal")) return [];
  const assigned = new Set(content.roles.filter(role =>
    role.availability === "live" && role.rbacModule && role.rbacRole &&
    Array.isArray(userRoles[role.rbacModule]) &&
    userRoles[role.rbacModule]?.includes(role.rbacRole) &&
    (audience === "vendor" ? role.id === "vendor_portal" : role.id !== "vendor_portal")
  ).map(role => role.id));
  return taskCatalog(content, audience).filter(task => task.roleIds.some(id => assigned.has(id)));
}
