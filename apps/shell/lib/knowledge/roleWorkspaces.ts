import type { KnowledgeArticle } from "./types";

const reviewedAt = "2026-08-11";

export const ROLE_WORKSPACE_ARTICLES: KnowledgeArticle[] = [
  {
    id: "role-workspace-catalog",
    slug: "roles/events-insights-workspaces",
    title: "Events, My Work, and Insights role catalog",
    summary:
      "Exact released roles, access boundaries, handoffs, and decision authority for the cross-department workspaces.",
    module: "core",
    availability: "live",
    roles: ["platform_admin", "core_staff_only"],
    keywords: [
      "events roles",
      "insights roles",
      "my work",
      "analyst",
      "coordinator",
      "requester",
      "executive",
    ],
    sections: [
      {
        id: "events-roles",
        title: "Events roles",
        body: "Event Requester can view and create events and request fulfillment. Event Coordinator adds lifecycle management and closure. Event Viewer is read-only. Events Administrator has the complete Events capability set. These roles do not by themselves authorize stock reservation, issue, bin selection, inspection, or return commands in Warehouse.",
      },
      {
        id: "insights-roles",
        title: "Insights roles",
        body: "Data Analyst sees Warehouse, Procurement, Legal, and Finance detail and may prepare governed exports. Department Manager sees those department summaries plus executive indicators. Executive sees the executive summary only. Insights Administrator sees every released Insights view and export control. Insights roles never grant source-record writes.",
      },
      {
        id: "my-work-access",
        title: "My Work access",
        body: "Every authenticated employee receives My Work. The queue shows only records selected by the caller identity and source capabilities. It is a read-only router: the source module still decides whether the user may inspect, approve, correct, or execute the record.",
      },
      {
        id: "legacy-role-mapping",
        title: "Current responsibility mapping",
        body: "Marketing maps to Event Coordinator, Business Unit maps to Event Requester, BI Analyst maps to Insights Data Analyst, and Warehouse Administrator plus Platform Administrator receive administrator access for the new workspaces. Administrators can later edit these scoped assignments in Users and Roles.",
      },
    ],
    relatedArticleIds: [
      "feature-events-workspace",
      "feature-my-work",
      "feature-insights-workspace",
      "admin-users-roles",
    ],
    flowIds: ["event-intent-and-fulfillment", "identity-and-access"],
    liveRoutes: ["/work", "/events", "/insights", "/admin/users"],
    owner: "Platform and department control owners",
    reviewedAt,
  },
  {
    id: "source-ownership-model",
    slug: "workflows/source-ownership",
    title: "How shared workspaces and source modules fit together",
    summary:
      "A plain-language ownership map for Events, Finance, My Work, Insights, Procurement, Legal, and Warehouse.",
    module: "core",
    availability: "live",
    roles: ["core_staff_only", "platform_admin"],
    keywords: [
      "source of truth",
      "ownership",
      "handoff",
      "finance",
      "warehouse fulfillment",
    ],
    sections: [
      {
        id: "events-owner",
        title: "Events owns intent",
        body: "Events owns the activation name, type, dates, lifecycle, and request for fulfillment. Warehouse owns every physical quantity, bin, serial, inspection, issue, custody, return, and stock exception.",
      },
      {
        id: "finance-owner",
        title: "Finance combines the trail",
        body: "Finance combines authorized commitment, receipt, return, valuation, and payment-readiness context. Procurement still owns requests, sourcing, approvals, and purchase orders. Warehouse still owns physical receipt and inventory evidence.",
      },
      {
        id: "replenishment-owner",
        title: "Warehouse detects; Procurement commits",
        body: "Warehouse Replenishment planning calculates stock risk, saves a recommendation, and records Operations acceptance. Hand to Procurement creates the linked draft purchase request. Procurement owns sourcing, vendor selection, approval routing, purchase-order authoring, and supplier commitment; Warehouse follows the linked PO and receives only eligible quantities.",
      },
      {
        id: "vendor-owner",
        title: "Vendor provides; Legal decides",
        body: "The vendor owns truthful application facts, required evidence, declarations, and its signatures. Incomplete cases show Complete requirements and cannot be submitted. Legal owns checklist review, correction requests, residual-risk disposition, Mwell countersignature, accreditation, suspension, renewal, and offboarding. Procurement consumes the resulting eligibility state but cannot approve accreditation.",
      },
      {
        id: "work-owner",
        title: "My Work routes the person",
        body: "My Work does not approve or edit. It identifies the next accountable item and opens the source record where the user completes the authorized step.",
      },
      {
        id: "insights-owner",
        title: "Insights explains performance",
        body: "Insights computes read-only indicators under database capability checks. A warning or target miss must be investigated and corrected at its governed source.",
      },
      {
        id: "administration-owner",
        title: "Administration governs structure and evidence",
        body: "Platform administration maintains users, role assignments, departments, and the read-only audit history. Platform or Legal administration maintains department DOA within its authorized route. Human-readable audit summaries are primary; identifiers and raw payloads stay under Technical details for investigation.",
      },
    ],
    relatedArticleIds: [
      "feature-warehouse-finance",
      "feature-warehouse-procurement-planning",
      "feature-vendor-case-detail",
      "feature-admin-departments",
      "feature-admin-audit",
      "feature-events-workspace",
      "feature-my-work",
      "feature-insights-workspace",
    ],
    flowIds: [
      "procure-to-pay",
      "vendor-accreditation",
      "event-intent-and-fulfillment",
      "administration",
      "exception-and-recovery",
    ],
    liveRoutes: [
      "/finance",
      "/warehouse/procurement",
      "/vendor",
      "/admin/departments",
      "/admin/audit",
      "/events",
      "/work",
      "/insights",
    ],
    owner: "Platform Product Governance",
    reviewedAt,
  },
];
