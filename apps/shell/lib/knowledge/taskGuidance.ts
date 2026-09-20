import type { KnowledgeFeature, KnowledgeFlow, KnowledgeRole } from "./types";

type TaskGuidance =
  | { readonly kind: "flow" | "feature"; readonly id: string }
  | { readonly kind: "written"; readonly guidance: string };

// Exact task text is intentional: edits to responsibilities require a mapping review.
// Never derive destinations from task order, keywords, or the global content catalog.
export const ROLE_TASK_GUIDANCE: Readonly<
  Record<string, Readonly<Record<string, TaskGuidance>>>
> = {
  core_staff_only: {
    "Locate assigned work from the Intra home and department queues.": {
      kind: "feature",
      id: "shell-home",
    },
    "Verify the owning department before handing off a shared record.": {
      kind: "feature",
      id: "my-work",
    },
  },
  events_seller: {
    "Confirm your own named, time-limited event assignment and acknowledged issued custody.": {
      kind: "written",
      guidance: "Open Events with your own account. Confirm the event and assignment dates, then check its acknowledged custody. Ask the event owner about missing or expired assignments; never use another seller's login or unacknowledged stock.",
    },
    "Complete required onboarding and the event-seller-custody-v1 challenge before recording actual sales or zero-amount giveaways.": {
      kind: "written",
      guidance: "Open Onboarding, complete Role orientation if it is still required, then start Record your event sales and giveaways. Finish all six practice decisions and check that the requirement shows complete before returning to Events. Do not repeat a completed orientation. Enter the actual sale amount, or choose giveaway with a zero amount. Select the exact serials where required. Completing training does not assign stock, enable an event or extend event access.",
    },
    "Read back uncertain submissions, retry the same intent, and use your own attributable reversal for a correction.": {
      kind: "written",
      guidance: "Check your saved event entries before resubmitting. Retry an uncertain entry with the same reference and details. Reverse your own incorrect entry instead of erasing it, and hand the correction to independent Finance. If the event or assignment is closed, ask the event owner for the authorized correction path.",
    },
  },
  platform_admin: {
    "Review identity, role-scope, and access-correction requests.": {
      kind: "feature",
      id: "admin-users",
    },
    "Inspect audit history and maintain shared platform controls.": {
      kind: "feature",
      id: "admin-audit",
    },
  },
  vendor_portal: {
    "Complete outstanding company, risk, and declaration sections for the vendor's own case.":
      { kind: "feature", id: "vendor-application" },
    "Upload requested evidence and respond to Legal correction notices.": {
      kind: "feature",
      id: "vendor-case-detail",
    },
    "Review purchase orders awarded to the vendor and record a traceable acknowledgement before the due time.":
      { kind: "feature", id: "vendor-purchase-orders" },
  },
  warehouse_operator: {
    "Complete assigned receiving, inspection, putaway, reservation, picking, issue, transfer, return, and count work.":
      { kind: "feature", id: "warehouse-tasks" },
    "Record quantities, traceability, destinations, and exception evidence, then stop for a Warehouse Supervisor when a controlled decision is required.":
      { kind: "feature", id: "warehouse-tasks" },
  },
  warehouse_supervisor: {
    "Review operator evidence for quality holds, count variances, stock adjustments, and warehouse exceptions.":
      { kind: "feature", id: "warehouse-approvals" },
    "Maintain products, locations, operation routes, and governed imports with a second named warehouse person for controlled changes.":
      { kind: "flow", id: "warehouse-setup" },
  },
  warehouse_logistics_supervisor: {
    "Review inbound receipts, quality holds, count variances, and warehouse exceptions.":
      { kind: "feature", id: "warehouse-exceptions" },
    "Approve supported stock adjustments and coordinate putaway or return disposition.":
      { kind: "flow", id: "cycle-count-adjustment" },
  },
  warehouse_operations: {
    "Submit ecommerce demand, stock requests, customer return cases, and replenishment recommendations.": {
      kind: "written",
      guidance:
        "Record the source, item, quantity, recipient, and reason in the governed request or customer case. Hand the record to warehouse operators for physical custody; the Operations role alone does not authorize stock movement or Quality decisions.",
    },
    "Prepare governed warehouse exports and follow the handoff to warehouse operators and Procurement.": {
      kind: "written",
      guidance:
        "Prepare exports only through the governed export action with its current certification and source-access checks. Track the linked request: Procurement decides replenishment outcomes, warehouse operators perform physical work, and separately authorized Finance reviews exports.",
    },
  },
  warehouse_finance: {
    "Review valuation, landed-cost, reconciliation, and material variance queues.":
      { kind: "feature", id: "warehouse-finance" },
    "Confirm finance evidence before certifying an adjustment or reconciliation outcome.":
      { kind: "flow", id: "finance-export-reconciliation" },
  },
  warehouse_bi_analyst: {
    "Validate inventory, service-level, exception, and movement datasets before analysis.":
      { kind: "feature", id: "warehouse-data" },
    "Publish governed reports with filters, freshness, and source context intact.":
      { kind: "feature", id: "warehouse-reports" },
  },
  warehouse_business_unit: {
    "Submit stock requests for approved business needs and follow the warehouse allocation decision.": {
      kind: "written",
      guidance:
        "Submit the item, quantity, business purpose, and recipient in a stock request, then follow its status. Authorized warehouse staff control allocation and issue; the Business Unit role does not grant reservation or allocation authority.",
    },
    "Confirm receipt, consumption, return, or discrepancy for issued items.": {
      kind: "flow",
      id: "allocation-event-return",
    },
  },
  warehouse_marketing: {
    "Plan campaign and event inventory demand with dates and responsible recipients.":
      { kind: "flow", id: "event-fulfillment" },
    "Reconcile event consumption, returns, damage, and supporting evidence.": {
      kind: "flow",
      id: "returns-reconciliation",
    },
  },
  warehouse_procurement: {
    "Review replenishment needs, supplier context, and receivable purchase orders.":
      { kind: "feature", id: "warehouse-procurement-planning" },
    "Coordinate shortages and inbound timing with Procurement and warehouse supervisors.":
      { kind: "flow", id: "receive-to-putaway" },
  },
  warehouse_pricing: {
    "Review landed-cost inputs and pending price proposals.": {
      kind: "flow",
      id: "pricing-and-costing",
    },
    "Check recorded prices and raise discrepancies with the authorized Product and Finance owners.": {
      kind: "written",
      guidance:
        "Compare the recorded price, cost basis, effective date, and supporting evidence. Send discrepancies to the authorized Product and Finance owners; the Pricing role is read-only and does not authorize proposing, approving, or activating prices.",
    },
  },
  warehouse_admin: {
    "Maintain warehouse master data, locations, operation routes, and import controls.":
      { kind: "flow", id: "warehouse-setup" },
    "Review warehouse access, configuration exceptions, and audit history.": {
      kind: "flow",
      id: "administration",
    },
  },
  procurement_requester: {
    "Prepare purchase requests with complete need, value, budget, sourcing, and evidence facts.":
      { kind: "feature", id: "procurement-request-create" },
    "Respond to returned requests and confirm business acceptance after delivery.":
      { kind: "flow", id: "procure-to-pay" },
  },
  procurement_officer: {
    "Review submitted requests, sourcing routes, vendor eligibility, and competition evidence.":
      { kind: "flow", id: "procure-to-pay" },
    "Prepare awards and purchase orders only after required approvals and policy gates pass.":
      { kind: "feature", id: "procurement-purchase-orders" },
  },
  procurement_approver: {
    "Review assigned purchase-request and award decisions within delegated authority.":
      { kind: "feature", id: "procurement-approvals" },
    "Approve, reject, return, or abstain with an attributable reason.": {
      kind: "feature",
      id: "procurement-approvals",
    },
  },
  procurement_finance: {
    "Review budget evidence, financial approval steps, and payment-readiness packs.":
      { kind: "flow", id: "procure-to-pay" },
    "Return mismatched amounts, receipts, acceptance, or invoice evidence with a reason.":
      { kind: "flow", id: "procure-to-pay" },
  },
  procurement_admin: {
    "Maintain procurement governance, route configuration, and Delegation of Authority coverage.":
      { kind: "flow", id: "doa-governance" },
    "Review procurement access, stale workflows, and policy exceptions.": {
      kind: "flow",
      id: "administration",
    },
  },
  legal_reviewer: {
    "Review assigned accreditation checklist evidence and vendor corrections.":
      { kind: "feature", id: "legal-case-application" },
    "Record item-level approval or correction reasons without making unauthorized final dispositions.":
      { kind: "feature", id: "legal-case-detail" },
  },
  legal_compliance: {
    "Assess accreditation residual risk, required instruments, and compliance exceptions.":
      { kind: "flow", id: "vendor-accreditation" },
    "Record compliance recommendations and monitor remediation or renewal obligations.":
      { kind: "flow", id: "vendor-accreditation" },
  },
  legal_admin: {
    "Invite vendors, oversee case queues, and make authorized final accreditation dispositions.":
      { kind: "flow", id: "vendor-accreditation" },
    "Maintain Legal workflow, instrument, and requirement governance with audit history.":
      { kind: "flow", id: "vendor-accreditation" },
  },
  events_requester: {
    "Create complete event intent with dates and purpose.": {
      kind: "feature",
      id: "events-workspace",
    },
    "Monitor the Warehouse fulfillment handoff without changing physical stock.":
      { kind: "flow", id: "event-fulfillment" },
  },
  events_coordinator: {
    "Coordinate planned and active event lifecycles.": {
      kind: "feature",
      id: "events-workspace",
    },
    "Reconcile readiness, issue, return, and closure dependencies with Warehouse.":
      { kind: "flow", id: "event-fulfillment" },
  },
  events_viewer: {
    "Review authorized event plans and lifecycle status.": {
      kind: "feature",
      id: "events-workspace",
    },
    "Route questions to the coordinator or Warehouse owner.": {
      kind: "written",
      guidance:
        "Send the event reference and question to the named coordinator; Warehouse owns physical stock and custody.",
    },
  },
  events_finance_reviewer: {
    "Review submitted event outcomes, custody totals, financial evidence, and unresolved variances.":
      { kind: "flow", id: "event-fulfillment" },
    "Approve or return a balanced settlement independently from its preparer.":
      { kind: "flow", id: "event-fulfillment" },
  },
  events_admin: {
    "Administer event lifecycle access and recover controlled event failures.":
      { kind: "feature", id: "events-workspace" },
    "Review event-to-Warehouse ownership and audit consistency.": {
      kind: "flow",
      id: "event-intent-and-fulfillment",
    },
  },
  insights_analyst: {
    "Validate source freshness and review authorized operational indicators.": {
      kind: "feature",
      id: "insights-workspace",
    },
    "Prepare a certified governed export without changing source records.": {
      kind: "feature",
      id: "insights-workspace",
    },
  },
  insights_manager: {
    "Review department summaries and cross-functional risks.": {
      kind: "feature",
      id: "insights-workspace",
    },
    "Request validation from a source owner through an accountable follow-up.":
      { kind: "feature", id: "insights-workspace" },
  },
  insights_executive: {
    "Review executive indicators and priority exceptions.": {
      kind: "feature",
      id: "insights-workspace",
    },
    "Escalate an indicator through accountable follow-up without editing operational evidence.":
      { kind: "feature", id: "insights-workspace" },
  },
  insights_admin: {
    "Administer Insights access and governed metric availability.": {
      kind: "feature",
      id: "insights-workspace",
    },
    "Review failed projections, export controls, and source ownership.": {
      kind: "feature",
      id: "insights-workspace",
    },
  },
  product_contributor: {
    "Prepare launch criteria and attach current readiness evidence.": {
      kind: "flow",
      id: "product-launch-governance",
    },
    "Submit effective-dated price proposals with a documented commercial basis.":
      { kind: "flow", id: "pricing-and-costing" },
  },
  product_owner: {
    "Review launch readiness and make the final Product go-live decision.": {
      kind: "flow",
      id: "product-launch-governance",
    },
    "Independently approve or reject submitted price proposals.": {
      kind: "flow",
      id: "pricing-and-costing",
    },
  },
  product_operations_partner: {
    "Review Product-approved launch conditions and operational dependencies.": {
      kind: "flow",
      id: "product-launch-governance",
    },
    "Acknowledge the Operations handoff or return a concrete operational blocker.":
      { kind: "flow", id: "product-launch-governance" },
  },
  strategic_sourcing_lead: {
    "Define the planned category-strategy and complex-sourcing governance model.":
      {
        kind: "written",
        guidance:
          "Planned responsibility only. Route current work to the authorized department owner; this profile grants no live authority.",
      },
    "Document proposed award-oversight boundaries for Procurement approval.": {
      kind: "written",
      guidance:
        "Planned responsibility only. Route current work to the authorized department owner; this profile grants no live authority.",
    },
  },
  vendor_relationship_manager: {
    "Define the planned supplier-performance and relationship-governance model.":
      {
        kind: "written",
        guidance:
          "Planned responsibility only. Route current work to the authorized department owner; this profile grants no live authority.",
      },
    "Route current supplier relationship issues to Procurement and Legal owners.":
      {
        kind: "written",
        guidance:
          "Planned responsibility only. Route current work to the authorized department owner; this profile grants no live authority.",
      },
  },
  inventory_planner: {
    "Define the planned demand, replenishment, and inventory-policy analysis process.":
      {
        kind: "written",
        guidance:
          "Planned responsibility only. Route current work to the authorized department owner; this profile grants no live authority.",
      },
    "Route current replenishment recommendations to Warehouse Procurement.": {
      kind: "written",
      guidance:
        "Planned responsibility only. Route current work to the authorized department owner; this profile grants no live authority.",
    },
  },
  internal_auditor: {
    "Define the planned read-only audit scope and evidence-access controls.": {
      kind: "written",
      guidance:
        "Planned responsibility only. Route current work to the authorized department owner; this profile grants no live authority.",
    },
    "Route current audit inquiries to department owners and Platform administration.":
      {
        kind: "written",
        guidance:
          "Planned responsibility only. Route current work to the authorized department owner; this profile grants no live authority.",
      },
  },
  department_budget_owner: {
    "Define the planned departmental funding-confirmation and spend-oversight model.":
      {
        kind: "written",
        guidance:
          "Planned responsibility only. Route current work to the authorized department owner; this profile grants no live authority.",
      },
    "Route current budget questions to assigned Finance and Procurement approvers.":
      {
        kind: "written",
        guidance:
          "Planned responsibility only. Route current work to the authorized department owner; this profile grants no live authority.",
      },
  },
  security_reviewer: {
    "Define the planned security due-diligence evidence and review model.": {
      kind: "written",
      guidance:
        "Planned responsibility only. Route current work to the authorized department owner; this profile grants no live authority.",
    },
    "Route current material security concerns to Platform and Legal authorities.":
      {
        kind: "written",
        guidance:
          "Planned responsibility only. Route current work to the authorized department owner; this profile grants no live authority.",
      },
  },
};

export interface ResolvedRoleTask {
  task: string;
  guidance: string;
  destination?: { kind: "flow" | "feature"; id: string; title: string };
}

export function resolveRoleTasks(
  role: KnowledgeRole,
  features: readonly KnowledgeFeature[],
  flows: readonly KnowledgeFlow[],
): ResolvedRoleTask[] {
  return role.dailyTasks.map((task) => {
    const mapping = ROLE_TASK_GUIDANCE[role.id]?.[task];
    const fallback = {
      task,
      guidance:
        role.availability === "coming_soon"
          ? "Planned responsibility only. No live work is available for this profile."
          : mapping?.kind === "written"
            ? mapping.guidance
            : "Follow the responsibility and authority below. If ownership or evidence is unclear, use the named escalation contact before acting.",
    };
    if (
      !mapping ||
      mapping.kind === "written" ||
      role.availability === "coming_soon"
    )
      return fallback;

    // Only resolve within the audience-scoped candidates supplied by the caller.
    const target =
      mapping.kind === "flow"
        ? flows.find(
            (item) => item.id === mapping.id && item.roles.includes(role.id),
          )
        : features.find(
            (item) => item.id === mapping.id && item.roleIds.includes(role.id),
          );
    if (!target || target.availability === "coming_soon") return fallback;
    return {
      task,
      guidance: "",
      destination: { kind: mapping.kind, id: target.id, title: target.title },
    };
  });
}
