import {
  MODULE_LIST,
  roleCapabilities,
  type Module as RbacModule,
} from "@intra/rbac";
import { MODULES as WAREHOUSE_MODULES } from "@intra/warehouse";
import type { KnowledgeAuthority, KnowledgeRole } from "./types";

type RoleOperatingDetails = Pick<
  KnowledgeRole,
  "dailyTasks" | "responsibilityStages"
>;

const stage = (
  title: string,
  responsibility: string,
  outcome: string,
): KnowledgeRole["responsibilityStages"][number] => ({
  title,
  responsibility,
  outcome,
});

const ROLE_OPERATING_DETAILS: Record<string, RoleOperatingDetails> = {
  core_staff_only: {
    dailyTasks: [
      "Locate assigned work from the Intra home and department queues.",
      "Verify the owning department before handing off a shared record.",
    ],
    responsibilityStages: [
      stage(
        "Find accountable work",
        "Open the shared record and identify its owning module and current status.",
        "The responsible queue and next owner are known.",
      ),
      stage(
        "Route without overreach",
        "Hand the record to the accountable department without changing or approving it.",
        "The handoff remains attributable and within baseline staff authority.",
      ),
    ],
  },
  platform_admin: {
    dailyTasks: [
      "Review identity, role-scope, and access-correction requests.",
      "Inspect audit history and maintain shared platform controls.",
    ],
    responsibilityStages: [
      stage(
        "Authorize the change",
        "Confirm the requester, department owner, minimum role, and supporting evidence.",
        "An authorized least-privilege change is ready to apply.",
      ),
      stage(
        "Apply and audit",
        "Provision or revoke access and verify the resulting audit record.",
        "Identity and access state match the approved responsibility.",
      ),
    ],
  },
  vendor_portal: {
    dailyTasks: [
      "Complete outstanding company, risk, and declaration sections for the vendor's own case.",
      "Upload requested evidence and respond to Legal correction notices.",
    ],
    responsibilityStages: [
      stage(
        "Prepare own-case evidence",
        "Enter truthful vendor facts and attach applicable current documents.",
        "Every applicable checklist requirement has an answer or evidence item.",
      ),
      stage(
        "Submit and remediate",
        "Submit the governed snapshot, monitor status, and correct only returned items.",
        "Legal receives a complete attributable submission or correction response.",
      ),
    ],
  },
  warehouse_logistics_supervisor: {
    dailyTasks: [
      "Review inbound receipts, quality holds, count variances, and warehouse exceptions.",
      "Approve supported stock adjustments and coordinate putaway or return disposition.",
    ],
    responsibilityStages: [
      stage(
        "Control inbound execution",
        "Verify PO eligibility, traceability, inspection, quantity, and destination controls.",
        "Accepted stock proceeds to a valid bin and exceptions remain controlled.",
      ),
      stage(
        "Resolve inventory variance",
        "Review counts, returns, and exception evidence before approving a stock change.",
        "Physical stock and the ledger reconcile with an attributable decision.",
      ),
    ],
  },
  warehouse_operations: {
    dailyTasks: [
      "Execute assigned receiving, putaway, allocation, return, and count tasks.",
      "Capture scans, quantities, traceability, photos, and exception reasons at the point of work.",
    ],
    responsibilityStages: [
      stage(
        "Verify the physical task",
        "Match the item, source record, quantity, lot or serial, and destination before movement.",
        "The task is safe to execute against the current record.",
      ),
      stage(
        "Execute and evidence",
        "Record the physical movement or count once and attach required evidence.",
        "The next owner sees current stock state and any controlled exception.",
      ),
    ],
  },
  warehouse_finance: {
    dailyTasks: [
      "Review valuation, landed-cost, reconciliation, and material variance queues.",
      "Confirm finance evidence before certifying an adjustment or reconciliation outcome.",
    ],
    responsibilityStages: [
      stage(
        "Reconcile financial evidence",
        "Compare stock events, PO cost, receipt, return, and valuation records.",
        "The financial effect and unresolved differences are identified.",
      ),
      stage(
        "Certify or return",
        "Approve supported finance treatment or return the record with a reason.",
        "Finance status is attributable and ready for the next governed step.",
      ),
    ],
  },
  warehouse_bi_analyst: {
    dailyTasks: [
      "Validate inventory, service-level, exception, and movement datasets before analysis.",
      "Publish governed reports with filters, freshness, and source context intact.",
    ],
    responsibilityStages: [
      stage(
        "Validate analytical inputs",
        "Check report scope, data freshness, exclusions, and reconciliation status.",
        "The dataset is fit for the stated analytical purpose.",
      ),
      stage(
        "Communicate governed insight",
        "Present trends and anomalies without changing operational records.",
        "Decision owners receive traceable analysis and its limitations.",
      ),
    ],
  },
  warehouse_business_unit: {
    dailyTasks: [
      "Request and reserve stock for approved business needs.",
      "Confirm receipt, consumption, return, or discrepancy for issued items.",
    ],
    responsibilityStages: [
      stage(
        "State the business need",
        "Select the event or purpose, item, quantity, date, and accountable recipient.",
        "Warehouse receives a complete attributable demand request.",
      ),
      stage(
        "Confirm the outcome",
        "Acknowledge issued stock and record use, return, loss, or discrepancy.",
        "The allocation can be reconciled and closed.",
      ),
    ],
  },
  warehouse_marketing: {
    dailyTasks: [
      "Plan campaign and event inventory demand with dates and responsible recipients.",
      "Reconcile event consumption, returns, damage, and supporting evidence.",
    ],
    responsibilityStages: [
      stage(
        "Plan event stock",
        "Create demand with campaign, venue, schedule, item, and quantity context.",
        "Warehouse can reserve and prepare the correct event stock.",
      ),
      stage(
        "Close event custody",
        "Record consumed, returned, damaged, or missing quantities after the event.",
        "Event stock and custody evidence reconcile.",
      ),
    ],
  },
  warehouse_procurement: {
    dailyTasks: [
      "Review replenishment needs, supplier context, and receivable purchase orders.",
      "Coordinate shortages and inbound timing with Procurement and warehouse supervisors.",
    ],
    responsibilityStages: [
      stage(
        "Assess replenishment need",
        "Review available, reserved, inbound, and forecast quantities before sourcing.",
        "A supported replenishment requirement is ready for Procurement.",
      ),
      stage(
        "Coordinate inbound readiness",
        "Track approved order status and communicate expected receipt constraints.",
        "Warehouse has an eligible source record and receiving plan.",
      ),
    ],
  },
  warehouse_pricing: {
    dailyTasks: [
      "Review landed-cost inputs and pending price proposals.",
      "Record effective price changes with basis, date, and approval evidence.",
    ],
    responsibilityStages: [
      stage(
        "Establish cost basis",
        "Verify purchase, freight, duty, allocation, and current-price inputs.",
        "The proposal uses a complete attributable cost basis.",
      ),
      stage(
        "Propose and activate price",
        "Record the value, reason, effective date, and required approval.",
        "The governed price history shows the approved change.",
      ),
    ],
  },
  warehouse_admin: {
    dailyTasks: [
      "Maintain warehouse master data, locations, operation routes, and import controls.",
      "Review warehouse access, configuration exceptions, and audit history.",
    ],
    responsibilityStages: [
      stage(
        "Validate configuration change",
        "Confirm owner, scope, dependency, and evidence for the proposed master-data change.",
        "The change is authorized and will not strand active stock or tasks.",
      ),
      stage(
        "Apply and verify configuration",
        "Update the governed record and inspect dependent routes and audit events.",
        "Warehouse configuration is usable, traceable, and correctly scoped.",
      ),
    ],
  },
  procurement_requester: {
    dailyTasks: [
      "Prepare purchase requests with complete need, value, budget, sourcing, and evidence facts.",
      "Respond to returned requests and confirm business acceptance after delivery.",
    ],
    responsibilityStages: [
      stage(
        "Document the business need",
        "Create line, quantity, budget, justification, timing, and supporting evidence.",
        "A complete draft can be routed under the correct sourcing policy.",
      ),
      stage(
        "Submit and accept",
        "Submit the governed snapshot, answer revisions, and record receipt acceptance.",
        "Procurement and Finance have attributable requester evidence.",
      ),
    ],
  },
  procurement_officer: {
    dailyTasks: [
      "Review submitted requests, sourcing routes, vendor eligibility, and competition evidence.",
      "Prepare awards and purchase orders only after required approvals and policy gates pass.",
    ],
    responsibilityStages: [
      stage(
        "Run the sourcing route",
        "Validate threshold, risk, competition, bids, exceptions, budget, and accreditation.",
        "A policy-complete recommendation is ready for approval.",
      ),
      stage(
        "Convert approved demand",
        "Record the award and author the PO from the approved request snapshot.",
        "The supplier commitment is traceable to approved demand and evidence.",
      ),
    ],
  },
  procurement_approver: {
    dailyTasks: [
      "Review assigned purchase-request and award decisions within delegated authority.",
      "Approve, reject, return, or abstain with an attributable reason.",
    ],
    responsibilityStages: [
      stage(
        "Confirm decision authority",
        "Verify assignment, amount tier, category, conflict status, and evidence completeness.",
        "The decision is within active delegation and independent authority.",
      ),
      stage(
        "Record the decision",
        "Approve, reject, return, or abstain with a clear governed reason.",
        "The request advances or stops with complete decision history.",
      ),
    ],
  },
  procurement_finance: {
    dailyTasks: [
      "Review budget evidence, financial approval steps, and payment-readiness packs.",
      "Return mismatched amounts, receipts, acceptance, or invoice evidence with a reason.",
    ],
    responsibilityStages: [
      stage(
        "Validate financial readiness",
        "Confirm budget, amount, approval, receipt, acceptance, invoice, and matching evidence.",
        "The financial package is complete or has a named blocking exception.",
      ),
      stage(
        "Record finance outcome",
        "Approve the assigned finance step or return the package for correction.",
        "Payment readiness is attributable and does not bypass Treasury execution.",
      ),
    ],
  },
  procurement_admin: {
    dailyTasks: [
      "Maintain procurement governance, route configuration, and Delegation of Authority coverage.",
      "Review procurement access, stale workflows, and policy exceptions.",
    ],
    responsibilityStages: [
      stage(
        "Govern procurement configuration",
        "Validate policy owner, effective date, approver coverage, and affected workflows.",
        "A complete configuration revision is ready for activation.",
      ),
      stage(
        "Activate and monitor",
        "Publish the approved revision and inspect route and audit behavior.",
        "Procurement decisions use current governed configuration.",
      ),
    ],
  },
  legal_reviewer: {
    dailyTasks: [
      "Review assigned accreditation checklist evidence and vendor corrections.",
      "Record item-level approval or correction reasons without making unauthorized final dispositions.",
    ],
    responsibilityStages: [
      stage(
        "Inspect requirement evidence",
        "Compare submitted facts and documents with the applicable requirement and policy version.",
        "Each checklist item has a supported review finding.",
      ),
      stage(
        "Record review outcome",
        "Approve sufficient evidence or request a specific vendor correction.",
        "Compliance or Legal administration receives a traceable reviewed case.",
      ),
    ],
  },
  legal_compliance: {
    dailyTasks: [
      "Assess accreditation residual risk, required instruments, and compliance exceptions.",
      "Record compliance recommendations and monitor remediation or renewal obligations.",
    ],
    responsibilityStages: [
      stage(
        "Assess residual risk",
        "Review evidence sufficiency, risk facts, instruments, exceptions, and mitigations.",
        "The case has a supported compliance position.",
      ),
      stage(
        "Set compliance conditions",
        "Recommend approval, conditional remediation, renewal, suspension, or rejection.",
        "Final Legal authority receives explicit conditions and policy basis.",
      ),
    ],
  },
  legal_admin: {
    dailyTasks: [
      "Invite vendors, oversee case queues, and make authorized final accreditation dispositions.",
      "Maintain Legal workflow, instrument, and requirement governance with audit history.",
    ],
    responsibilityStages: [
      stage(
        "Establish the governed case",
        "Verify vendor identity, category, jurisdiction, risk, and applicable requirements.",
        "The vendor receives a correctly scoped attributable invitation.",
      ),
      stage(
        "Make final disposition",
        "Review checklist, residual risk, instruments, conditions, and independent findings.",
        "Approval, conditional action, suspension, or rejection is fully evidenced.",
      ),
    ],
  },
  events_requester: {
    dailyTasks: ["Create complete event intent with dates and purpose.", "Monitor the Warehouse fulfillment handoff without changing physical stock."],
    responsibilityStages: [
      stage("State event demand", "Create an attributable event and request the needed fulfillment.", "Warehouse receives complete event context."),
      stage("Confirm handoff", "Track readiness and escalate missing fulfillment ownership.", "The event has a named next operational owner."),
    ],
  },
  events_coordinator: {
    dailyTasks: ["Coordinate planned and active event lifecycles.", "Reconcile readiness, issue, return, and closure dependencies with Warehouse."],
    responsibilityStages: [
      stage("Coordinate readiness", "Validate event timing, demand, owner, and fulfillment status.", "The activation is ready or has a named blocker."),
      stage("Close the lifecycle", "Confirm returns and unresolved exceptions before closure.", "Event intent and physical outcomes reconcile."),
    ],
  },
  events_viewer: {
    dailyTasks: ["Review authorized event plans and lifecycle status.", "Route questions to the coordinator or Warehouse owner."],
    responsibilityStages: [
      stage("Review event context", "Read dates, status, and fulfillment totals without editing them.", "The current event state is understood."),
      stage("Route an observation", "Send discrepancies to the accountable role with the event reference.", "No unauthorized source change is made."),
    ],
  },
  events_admin: {
    dailyTasks: ["Administer event lifecycle access and recover controlled event failures.", "Review event-to-Warehouse ownership and audit consistency."],
    responsibilityStages: [
      stage("Validate administration need", "Confirm the requested change, owner, scope, and source impact.", "The least-privilege administrative action is known."),
      stage("Apply and verify", "Complete the authorized event change and inspect the resulting source trail.", "Event governance remains attributable."),
    ],
  },
  insights_analyst: {
    dailyTasks: ["Validate source freshness and review authorized operational indicators.", "Prepare governed exports without changing source records."],
    responsibilityStages: [
      stage("Validate the metric", "Check scope, definition, freshness, target, and source link.", "The indicator is fit for analysis."),
      stage("Communicate analysis", "Explain the finding with source context and limitations.", "Decision owners receive traceable analysis."),
    ],
  },
  insights_manager: {
    dailyTasks: ["Review department summaries and cross-functional risks.", "Assign accountable follow-up through source workflows."],
    responsibilityStages: [
      stage("Assess performance", "Compare authorized indicators with targets and operating context.", "Priority performance gaps are identified."),
      stage("Route corrective work", "Open the source and assign the accountable owner.", "Follow-up occurs in the governed workflow."),
    ],
  },
  insights_executive: {
    dailyTasks: ["Review executive indicators and priority exceptions.", "Request accountable follow-up without editing operational evidence."],
    responsibilityStages: [
      stage("Review enterprise signal", "Assess summary indicators, targets, and known limitations.", "Material risks and trends are understood."),
      stage("Set accountability", "Direct the responsible manager to the governed source workflow.", "Executive attention becomes attributable follow-up."),
    ],
  },
  insights_admin: {
    dailyTasks: ["Administer Insights access and governed metric availability.", "Review failed projections, export controls, and source ownership."],
    responsibilityStages: [
      stage("Validate analytical access", "Confirm approved audience, scope, and least-privilege metric areas.", "The correct Insights role is identified."),
      stage("Verify governed delivery", "Confirm the projection, source link, and access behavior after change.", "Insights remain read-only and traceable."),
    ],
  },
  strategic_sourcing_lead: {
    dailyTasks: [
      "Define the planned category-strategy and complex-sourcing governance model.",
      "Document proposed award-oversight boundaries for Procurement approval.",
    ],
    responsibilityStages: [
      stage(
        "Design planned sourcing governance",
        "Document future category, competition, and complex-sourcing responsibilities.",
        "Procurement has a reviewable roadmap scope without live authority.",
      ),
      stage(
        "Escalate current needs",
        "Route live strategic-sourcing work to Procurement Administration.",
        "No roadmap role is used to execute a current decision.",
      ),
    ],
  },
  vendor_relationship_manager: {
    dailyTasks: [
      "Define the planned supplier-performance and relationship-governance model.",
      "Route current supplier relationship issues to Procurement and Legal owners.",
    ],
    responsibilityStages: [
      stage(
        "Design planned relationship controls",
        "Document future performance, review, and non-transactional coordination responsibilities.",
        "A bounded roadmap role is ready for governance review.",
      ),
      stage(
        "Protect live supplier decisions",
        "Escalate current records to authorized Procurement or Legal roles.",
        "No live vendor record is changed through planned authority.",
      ),
    ],
  },
  inventory_planner: {
    dailyTasks: [
      "Define the planned demand, replenishment, and inventory-policy analysis process.",
      "Route current replenishment recommendations to Warehouse Procurement.",
    ],
    responsibilityStages: [
      stage(
        "Design planned inventory analysis",
        "Document future demand inputs, recommendation controls, and review ownership.",
        "The roadmap separates analysis from stock execution.",
      ),
      stage(
        "Escalate current planning",
        "Send live planning needs to Warehouse Procurement and administration.",
        "Current inventory remains unchanged by the planned role.",
      ),
    ],
  },
  internal_auditor: {
    dailyTasks: [
      "Define the planned read-only audit scope and evidence-access controls.",
      "Route current audit inquiries to department owners and Platform administration.",
    ],
    responsibilityStages: [
      stage(
        "Design planned audit access",
        "Document future read-only evidence, sampling, and finding responsibilities.",
        "The roadmap preserves independence and prohibits operational writes.",
      ),
      stage(
        "Escalate current findings",
        "Send live audit concerns to the accountable owner without altering records.",
        "Current evidence and decision ownership remain intact.",
      ),
    ],
  },
  department_budget_owner: {
    dailyTasks: [
      "Define the planned departmental funding-confirmation and spend-oversight model.",
      "Route current budget questions to assigned Finance and Procurement approvers.",
    ],
    responsibilityStages: [
      stage(
        "Design planned budget accountability",
        "Document future funding evidence, limits, and departmental ownership.",
        "The roadmap role has clear separation from procurement approval and payment.",
      ),
      stage(
        "Escalate current budget decisions",
        "Send live funding questions to authorized Finance and Procurement roles.",
        "No current financial evidence or approval is changed by the planned role.",
      ),
    ],
  },
  security_reviewer: {
    dailyTasks: [
      "Define the planned security due-diligence evidence and review model.",
      "Route current material security concerns to Platform and Legal authorities.",
    ],
    responsibilityStages: [
      stage(
        "Design planned security review",
        "Document future control evidence, risk assessment, and recommendation boundaries.",
        "The roadmap separates security advice from access and vendor approval.",
      ),
      stage(
        "Escalate current security risk",
        "Send live concerns to authorized Platform and Legal decision owners.",
        "No current permission or accreditation decision is executed by the planned role.",
      ),
    ],
  },
};

type RoleAuthority = Omit<
  KnowledgeAuthority,
  "capabilities" | "accessibleRoutes"
> & {
  accessibleRoutes?: string[];
};

interface WarehouseRouteCapabilityEntry {
  route: string;
  capabilities: readonly string[];
}

export const WAREHOUSE_DETAIL_ROUTE_ALIASES = [
  {
    route: "/warehouse/inventory/:id",
    parentPath: "/inventory",
    parentHref: "/warehouse/inventory",
    parentLabel: "Open inventory list",
  },
  {
    route: "/warehouse/events/:id",
    parentPath: "/events",
    parentHref: "/warehouse/events",
    parentLabel: "Open events list",
  },
] as const;

export const ROLE_ROUTE_PARENT_PATHS: Readonly<Record<string, string>> =
  Object.fromEntries(
    WAREHOUSE_DETAIL_ROUTE_ALIASES.map((alias) => [
      alias.route,
      alias.parentHref,
    ]),
  );

export const ROLE_ROUTE_PARENT_LABELS: Readonly<Record<string, string>> =
  Object.fromEntries(
    WAREHOUSE_DETAIL_ROUTE_ALIASES.map((alias) => [
      alias.route,
      alias.parentLabel,
    ]),
  );

function warehouseRoute(path: string): string {
  return path === "/" ? "/warehouse" : `/warehouse${path}`;
}

function detailRouteEntry(
  alias: (typeof WAREHOUSE_DETAIL_ROUTE_ALIASES)[number],
) {
  const parent = WAREHOUSE_MODULES.find(
    (module) => module.path === alias.parentPath,
  );
  if (!parent)
    throw new Error(`Missing warehouse module for detail route ${alias.route}`);
  return { route: alias.route, capabilities: parent.capabilities };
}

export const WAREHOUSE_ROUTE_CAPABILITY_ENTRIES = [
  ...WAREHOUSE_MODULES.map((module) => ({
    route: warehouseRoute(module.path),
    capabilities: module.capabilities,
  })),
  ...WAREHOUSE_DETAIL_ROUTE_ALIASES.map(detailRouteEntry),
] satisfies readonly WarehouseRouteCapabilityEntry[];

type LiveRoleDefinition = Omit<
  KnowledgeRole,
  "availability" | "authority" | "dailyTasks" | "responsibilityStages"
> & {
  rbacModule: RbacModule;
  rbacRole: string;
  authority: RoleAuthority;
};

type ComingSoonRoleDefinition = Omit<
  KnowledgeRole,
  | "availability"
  | "authority"
  | "rbacModule"
  | "rbacRole"
  | "dailyTasks"
  | "responsibilityStages"
> & {
  authority: KnowledgeAuthority;
};

function capabilitiesFor(module: RbacModule, role: string): string[] {
  return roleCapabilities
    .filter((grant) => grant.module === module && grant.role === role)
    .map((grant) => grant.cap);
}

function warehouseRoutesFor(role: string): string[] {
  const capabilities = capabilitiesFor("warehouse", role);
  return WAREHOUSE_ROUTE_CAPABILITY_ENTRIES.filter((route) =>
    route.capabilities.some((capability) => capabilities.includes(capability)),
  ).map((route) => route.route);
}

function liveRole(definition: LiveRoleDefinition): KnowledgeRole {
  const operatingDetails = ROLE_OPERATING_DETAILS[definition.id];
  if (!operatingDetails)
    throw new Error(`missing role operating details for ${definition.id}`);
  return {
    ...definition,
    ...operatingDetails,
    availability: "live",
    authority: {
      ...definition.authority,
      accessibleRoutes:
        definition.rbacModule === "warehouse"
          ? warehouseRoutesFor(definition.rbacRole)
          : (definition.authority.accessibleRoutes ?? []),
      capabilities: capabilitiesFor(definition.rbacModule, definition.rbacRole),
    },
  };
}

function comingSoonRole(definition: ComingSoonRoleDefinition): KnowledgeRole {
  const operatingDetails = ROLE_OPERATING_DETAILS[definition.id];
  if (!operatingDetails)
    throw new Error(`missing role operating details for ${definition.id}`);
  return {
    ...definition,
    ...operatingDetails,
    availability: "coming_soon",
  };
}

export const LIVE_KNOWLEDGE_ROLES: KnowledgeRole[] = [
  liveRole({
    id: "core_staff_only",
    rbacModule: "core",
    rbacRole: "staff",
    label: "Core staff",
    module: "core",
    purpose:
      "Use shared Intra records, locate assigned work, and begin governed department workflows.",
    authority: {
      accessibleRoutes: ["/", "/knowledge", "/login"],
      canDo: [
        "View the directory, vendor master data, shared documents, and approval records assigned through another module role.",
        "Use the Command Center to locate the responsible queue and hand off through the recorded workflow.",
      ],
      cannotDo: [
        "Do not administer identities, roles, vendor master data, documents, or approvals from the baseline staff role.",
        "Do not treat a shared-record view as permission to approve, change, or disclose it.",
      ],
      decisions: [
        "Determine whether a record needs the owning department or platform access review; this role makes no approval decision.",
      ],
      upstreamRoleIds: ["platform_admin"],
      downstreamRoleIds: ["procurement_requester", "warehouse_business_unit"],
      escalation:
        "Escalate missing or excessive access with the route, record reference, and expected responsibility to the platform administrator.",
    },
  }),
  liveRole({
    id: "platform_admin",
    rbacModule: "core",
    rbacRole: "platform_admin",
    label: "Platform administrator",
    module: "admin",
    purpose:
      "Administer identities, scoped roles, shared master data, notification controls, audit review, and governed access changes.",
    authority: {
      accessibleRoutes: ["/", "/admin/users", "/admin/doa"],
      canDo: [
        "Provision users, assign the minimum scoped RBAC roles, manage shared vendor and document records, and review audit history.",
        "Maintain the platform administration required for department workflows to operate.",
      ],
      cannotDo: [
        "Do not approve a procurement award, certify a finance decision, or make a Legal accreditation disposition solely because of platform access.",
        "Do not assign broad roles when a narrower department role meets the approved responsibility.",
      ],
      decisions: [
        "Decide whether identity, role, and shared-data changes are authorized and sufficiently evidenced.",
      ],
      upstreamRoleIds: ["core_staff_only", "legal_admin", "procurement_admin"],
      downstreamRoleIds: [
        "core_staff_only",
        "warehouse_admin",
        "procurement_admin",
        "legal_admin",
      ],
      escalation:
        "Escalate suspected privilege abuse, identity conflicts, or audit anomalies to the accountable security and department owner before changing access.",
    },
  }),
  liveRole({
    id: "vendor_portal",
    rbacModule: "core",
    rbacRole: "vendor_portal",
    label: "Vendor portal user",
    module: "vendor",
    purpose:
      "Complete the vendor-owned accreditation application, submit supporting documents, respond to corrections, and monitor the vendor's own status.",
    authority: {
      accessibleRoutes: ["/vendor"],
      canDo: [
        "Submit accreditation information and documents for the vendor identity linked to the signed-in account.",
        "View the vendor's own accreditation status, requests for correction, and next required action.",
      ],
      cannotDo: [
        "Do not view, submit for, or act on another vendor's records.",
        "Do not approve accreditation, alter Legal checklists, or bypass required instruments and evidence.",
      ],
      decisions: [
        "Decide whether the vendor submission is complete enough to submit; Legal retains every accreditation disposition.",
      ],
      upstreamRoleIds: ["legal_admin"],
      downstreamRoleIds: ["legal_reviewer", "legal_compliance"],
      escalation:
        "Escalate invitation, ownership, upload, or status issues to the Legal contact named on the accreditation case without sharing credentials.",
    },
  }),
  liveRole({
    id: "warehouse_logistics_supervisor",
    rbacModule: "warehouse",
    rbacRole: "logistics_supervisor",
    label: "Warehouse logistics supervisor",
    module: "warehouse",
    purpose:
      "Control receiving, traceability, inspection, storage, counts, returns, approved adjustments, and warehouse exceptions.",
    authority: {
      canDo: [
        "Receive against receivable purchase orders, capture traceability, inspect stock, put away accepted items, and manage returns.",
        "Run cycle counts, approve supported stock adjustments, resolve warehouse exceptions, and maintain operational routes and locations.",
      ],
      cannotDo: [
        "Do not receive stock without a matching source record, inspection evidence, and valid destination.",
        "Do not change pricing, release a finance reconciliation, or author a procurement award.",
      ],
      decisions: [
        "Decide the warehouse quality disposition, movement route, and supported stock-adjustment outcome within the recorded control path.",
      ],
      upstreamRoleIds: ["warehouse_procurement", "warehouse_business_unit"],
      downstreamRoleIds: [
        "warehouse_operations",
        "warehouse_finance",
        "warehouse_admin",
      ],
      escalation:
        "Escalate supplier, quantity, traceability, quality-hold, or unreconciled variance exceptions with the receipt and evidence references to Warehouse Finance and the Warehouse Administrator.",
    },
  }),
  liveRole({
    id: "warehouse_operations",
    rbacModule: "warehouse",
    rbacRole: "operations",
    label: "Warehouse operations",
    module: "warehouse",
    purpose:
      "Allocate, issue, transfer, inspect, return, and reconcile inventory for approved operational demand.",
    authority: {
      canDo: [
        "Reserve available stock, issue it to approved events or operations, record transfers, and receive returned stock for inspection.",
        "Inspect operational stock and surface exceptions for supervised resolution.",
      ],
      cannotDo: [
        "Do not create inventory, alter warehouse configuration, approve stock adjustments, or release a quality hold.",
        "Do not issue stock outside the recorded allocation, custody, and return workflow.",
      ],
      decisions: [
        "Decide whether allocated stock is ready to issue or return for inspection; supervisors decide controlled exceptions.",
      ],
      upstreamRoleIds: [
        "warehouse_business_unit",
        "warehouse_marketing",
        "warehouse_logistics_supervisor",
      ],
      downstreamRoleIds: [
        "warehouse_logistics_supervisor",
        "warehouse_finance",
      ],
      escalation:
        "Escalate unavailable, damaged, excess, or custody-break stock with the allocation or event reference to the logistics supervisor.",
    },
  }),
  liveRole({
    id: "warehouse_finance",
    rbacModule: "warehouse",
    rbacRole: "finance",
    label: "Warehouse finance",
    module: "warehouse",
    purpose:
      "Review inventory valuation, count variance, adjustment evidence, reconciliation, and financial warehouse controls.",
    authority: {
      accessibleRoutes: ["/finance", "/warehouse/cycle-counts"],
      canDo: [
        "Review valuation and inventory evidence, perform count-related control review, and approve supported stock adjustments.",
        "Investigate financial warehouse exceptions and hand the outcome back through the recorded ledger workflow.",
      ],
      cannotDo: [
        "Do not receive, issue, transfer, or price inventory merely to clear a financial exception.",
        "Do not approve an adjustment that lacks a count, reason, and required operational evidence.",
      ],
      decisions: [
        "Decide whether a supported stock adjustment and reconciliation evidence are acceptable for financial control purposes.",
      ],
      upstreamRoleIds: [
        "warehouse_logistics_supervisor",
        "warehouse_operations",
        "warehouse_pricing",
      ],
      downstreamRoleIds: ["warehouse_logistics_supervisor", "warehouse_admin"],
      escalation:
        "Escalate material valuation variance, unsupported adjustment, or unresolved reconciliation to the Warehouse Administrator and the accountable finance owner.",
    },
  }),
  liveRole({
    id: "warehouse_bi_analyst",
    rbacModule: "warehouse",
    rbacRole: "bi_analyst",
    label: "Warehouse BI analyst",
    module: "warehouse",
    purpose:
      "Analyze governed inventory, utilization, consumption, and exception data to support operational decisions.",
    authority: {
      canDo: [
        "Review inventory, analytics, and exception data to identify trends, stock risk, and reporting questions.",
        "Hand evidence-backed findings to the accountable warehouse owner.",
      ],
      cannotDo: [
        "Do not alter inventory, allocation, price, count, supplier, or warehouse configuration data.",
        "Do not resolve operational exceptions from an analytics finding alone.",
      ],
      decisions: [
        "Determine whether a data finding needs operational investigation; operational owners make the corrective decision.",
      ],
      upstreamRoleIds: ["warehouse_operations", "warehouse_finance"],
      downstreamRoleIds: [
        "warehouse_logistics_supervisor",
        "warehouse_procurement",
        "warehouse_pricing",
      ],
      escalation:
        "Escalate suspected data-quality, stockout, or consumption anomalies with the report filters and record references to the relevant warehouse owner.",
    },
  }),
  liveRole({
    id: "warehouse_business_unit",
    rbacModule: "warehouse",
    rbacRole: "business_unit",
    label: "Warehouse business unit",
    module: "warehouse",
    purpose:
      "View available inventory and reserve stock for confirmed business activity through the governed allocation path.",
    authority: {
      canDo: [
        "Review availability and submit or manage reservations for confirmed business demand.",
        "Track the allocation handoff to warehouse operations.",
      ],
      cannotDo: [
        "Do not issue, receive, transfer, adjust, or price stock.",
        "Do not reserve stock without a valid business event or approved demand record.",
      ],
      decisions: [
        "Decide whether the business demand remains valid; warehouse operations decide physical issue and custody.",
      ],
      upstreamRoleIds: ["core_staff_only"],
      downstreamRoleIds: [
        "warehouse_operations",
        "warehouse_logistics_supervisor",
      ],
      escalation:
        "Escalate unavailable, substituted, or delayed inventory with the event and allocation references to Warehouse Operations.",
    },
  }),
  liveRole({
    id: "warehouse_marketing",
    rbacModule: "warehouse",
    rbacRole: "marketing",
    label: "Warehouse marketing",
    module: "warehouse",
    purpose:
      "Reserve campaign stock, track distribution demand, and return unused promotional inventory through controlled custody steps.",
    authority: {
      canDo: [
        "Reserve promotional stock for approved campaigns and record returns of unused items.",
        "Track campaign demand and the warehouse handoff for issue and return.",
      ],
      cannotDo: [
        "Do not issue stock to yourself, change inventory balances, or dispose of unused stock outside the return workflow.",
        "Do not create a campaign reservation without the supporting event or approval reference.",
      ],
      decisions: [
        "Decide whether campaign demand remains required and whether unused stock should be returned; warehouse staff decide the inspection outcome.",
      ],
      upstreamRoleIds: ["core_staff_only"],
      downstreamRoleIds: [
        "warehouse_operations",
        "warehouse_logistics_supervisor",
      ],
      escalation:
        "Escalate campaign changes, shortages, damaged returns, or custody uncertainty with the event reference to Warehouse Operations.",
    },
  }),
  liveRole({
    id: "warehouse_procurement",
    rbacModule: "warehouse",
    rbacRole: "procurement",
    label: "Warehouse procurement",
    module: "warehouse",
    purpose:
      "Review stock risk, supplier and receivable purchase-order data, and product information for replenishment coordination.",
    authority: {
      canDo: [
        "Review procurement visibility, supplier information, product data, and receivable purchase orders for replenishment planning.",
        "Hand approved inbound requirements to the warehouse receiving team.",
      ],
      cannotDo: [
        "Do not receive stock, alter inventory balances, approve awards, or issue a purchase order from the warehouse role.",
        "Do not change product data without the approved replenishment context and audit trail.",
      ],
      decisions: [
        "Determine whether stock risk needs replenishment coordination; Procurement retains sourcing and award authority.",
      ],
      upstreamRoleIds: ["warehouse_bi_analyst", "procurement_officer"],
      downstreamRoleIds: [
        "warehouse_logistics_supervisor",
        "procurement_officer",
      ],
      escalation:
        "Escalate supplier, stockout, product-master, or receivable-PO discrepancies with the affected record references to Procurement and the Warehouse Administrator.",
    },
  }),
  liveRole({
    id: "warehouse_pricing",
    rbacModule: "warehouse",
    rbacRole: "pricing",
    label: "Warehouse pricing",
    module: "warehouse",
    purpose:
      "Review landed cost, valuation context, turnover, and controlled warehouse price changes.",
    authority: {
      canDo: [
        "Review pricing and finance context and set controlled warehouse prices with the required supporting basis.",
        "Hand price-change evidence to finance and warehouse operations.",
      ],
      cannotDo: [
        "Do not change price without the governed basis, valuation review, and audit trail.",
        "Do not approve stock adjustments, receive stock, or alter procurement awards.",
      ],
      decisions: [
        "Decide whether a proposed price change is supported by landed-cost and valuation evidence within the approved pricing remit.",
      ],
      upstreamRoleIds: ["warehouse_procurement", "warehouse_bi_analyst"],
      downstreamRoleIds: ["warehouse_finance", "warehouse_operations"],
      escalation:
        "Escalate conflicting cost, valuation, or approval evidence to Warehouse Finance before publishing a price change.",
    },
  }),
  liveRole({
    id: "warehouse_admin",
    rbacModule: "warehouse",
    rbacRole: "warehouse_admin",
    label: "Warehouse administrator",
    module: "warehouse",
    purpose:
      "Administer warehouse configuration, imports, operational controls, quality oversight, inventory execution, and exception recovery.",
    authority: {
      canDo: [
        "Configure warehouse controls, perform governed imports, oversee quality and exception resolution, and execute the complete warehouse operating model.",
        "Investigate role-boundary failures and restore a controlled workflow with evidence.",
      ],
      cannotDo: [
        "Do not use broad warehouse access to bypass inspection, stock-adjustment, procurement, finance, or segregation-of-duties controls.",
        "Do not approve your own unsupported transaction or remove its audit evidence.",
      ],
      decisions: [
        "Decide configuration, import, operational-route, quality-hold, and warehouse-exception outcomes within the recorded controls.",
      ],
      upstreamRoleIds: [
        "warehouse_logistics_supervisor",
        "warehouse_finance",
        "platform_admin",
      ],
      downstreamRoleIds: [
        "warehouse_logistics_supervisor",
        "warehouse_operations",
        "warehouse_finance",
      ],
      escalation:
        "Escalate material control failure, suspected misuse, or a cross-department dependency to the platform administrator and accountable department owner with the audit references.",
    },
  }),
  liveRole({
    id: "procurement_requester",
    rbacModule: "procurement",
    rbacRole: "requester",
    label: "Procurement requester",
    module: "procurement",
    purpose:
      "Draft purchase requests with a clear need, line items, budget context, sourcing facts, and supporting evidence.",
    authority: {
      accessibleRoutes: [
        "/procurement",
        "/procurement/requests",
        "/procurement/requests/new",
      ],
      canDo: [
        "Create and maintain purchase-request drafts and provide clarification or evidence when the governed route asks for it.",
        "Track the request handoff into sourcing and approval.",
      ],
      cannotDo: [
        "Do not approve your own request, select an award, author a purchase order, or alter approval evidence.",
        "Do not submit a request with missing justification, value, route facts, or required supporting documents.",
      ],
      decisions: [
        "Decide whether the stated business need and request facts are accurate enough to submit; approval and sourcing decisions belong to later roles.",
      ],
      upstreamRoleIds: ["core_staff_only"],
      downstreamRoleIds: ["procurement_officer", "procurement_approver"],
      escalation:
        "Escalate unclear sourcing route, budget context, required evidence, or returned requests to the assigned Procurement Officer.",
    },
  }),
  liveRole({
    id: "procurement_officer",
    rbacModule: "procurement",
    rbacRole: "procurement_officer",
    label: "Procurement officer",
    module: "procurement",
    purpose:
      "Confirm the sourcing route, run competition, coordinate vendor readiness, author purchase orders, and perform the Procurement approval tier.",
    authority: {
      accessibleRoutes: [
        "/procurement",
        "/procurement/requests",
        "/procurement/requests/new",
        "/procurement/approvals",
        "/procurement/purchase-orders",
      ],
      canDo: [
        "Create sourcing activity, manage vendor information, author purchase orders, and decide the Procurement approval step for a complete request.",
        "Return incomplete requests and coordinate accredited vendor readiness before a supplier commitment.",
      ],
      cannotDo: [
        "Do not approve an award outside the designated approval authority or bypass competition, exception, accreditation, or DOA evidence.",
        "Do not approve your own unsupported sourcing outcome solely because you authored the procurement record.",
      ],
      decisions: [
        "Decide the sourcing route, request readiness, Procurement approval outcome, and PO authoring readiness within the approval ladder.",
      ],
      upstreamRoleIds: [
        "procurement_requester",
        "legal_compliance",
        "warehouse_procurement",
      ],
      downstreamRoleIds: [
        "procurement_approver",
        "procurement_finance",
        "warehouse_logistics_supervisor",
      ],
      escalation:
        "Escalate unresolved competition, vendor-accreditation, exception, threshold, or award-authority issues to Procurement Administration before commitment.",
    },
  }),
  liveRole({
    id: "procurement_approver",
    rbacModule: "procurement",
    rbacRole: "approver",
    label: "Procurement approver",
    module: "procurement",
    purpose:
      "Review assigned purchase-request and award decisions against the approved need, sourcing basis, budget context, and delegated authority.",
    authority: {
      accessibleRoutes: ["/procurement", "/procurement/approvals"],
      canDo: [
        "Approve, reject, or return assigned requests and awards that fall within the recorded approval authority.",
        "Record a decision reason that makes the next action and audit trail clear.",
      ],
      cannotDo: [
        "Do not approve outside the assigned DOA tier, approve your own request, or substitute chat approval for the governed decision.",
        "Do not author purchase orders, run sourcing, or alter supplier evidence to make an approval appear complete.",
      ],
      decisions: [
        "Decide whether the request or award is approved, rejected, or returned within the assigned authority and evidence requirements.",
      ],
      upstreamRoleIds: ["procurement_requester", "procurement_officer"],
      downstreamRoleIds: ["procurement_officer", "procurement_finance"],
      escalation:
        "Escalate authority gaps, conflicts of interest, missing evidence, or threshold exceptions to Procurement Administration before deciding.",
    },
  }),
  liveRole({
    id: "procurement_finance",
    rbacModule: "procurement",
    rbacRole: "finance",
    label: "Procurement finance",
    module: "procurement",
    purpose:
      "Review financial approval, commercial evidence, receipt and acceptance context, and payment readiness for procurement records.",
    authority: {
      accessibleRoutes: [
        "/finance",
        "/procurement",
        "/procurement/approvals",
        "/procurement/purchase-orders",
      ],
      canDo: [
        "Review finance context and decide the Finance approval tier on assigned procurement records.",
        "Assess whether purchase-order, receipt, acceptance, and financial evidence are ready for the next controlled handoff.",
      ],
      cannotDo: [
        "Do not create sourcing events, author a purchase order, select a vendor, or approve without complete commercial evidence.",
        "Do not clear a payment-readiness issue by changing receipt or acceptance evidence outside its owning role.",
      ],
      decisions: [
        "Decide the Finance approval outcome and whether financial evidence is sufficiently complete for payment-readiness handoff.",
      ],
      upstreamRoleIds: [
        "procurement_officer",
        "procurement_approver",
        "warehouse_finance",
      ],
      downstreamRoleIds: ["procurement_officer", "procurement_admin"],
      escalation:
        "Escalate budget, commercial, receipt, acceptance, or payment-readiness discrepancies with the procurement record references to Procurement Administration and the accountable finance owner.",
    },
  }),
  liveRole({
    id: "procurement_admin",
    rbacModule: "procurement",
    rbacRole: "admin",
    label: "Procurement administrator",
    module: "procurement",
    purpose:
      "Administer the provisional procurement workflow, control exceptions, and oversee request, award, purchase-order, and approval states.",
    authority: {
      accessibleRoutes: [
        "/procurement",
        "/procurement/requests",
        "/procurement/requests/new",
        "/procurement/approvals",
        "/procurement/purchase-orders",
        "/admin/doa",
      ],
      canDo: [
        "Administer procurement records, sourcing, vendor coordination, approvals, awards, purchase orders, and exception recovery under the current provisional matrix.",
        "Review the active department DOA and report routing gaps to Platform or Legal administration before procurement work proceeds.",
      ],
      cannotDo: [
        "Do not use administrative capability to bypass a named approval, accreditation gate, competition rule, finance control, or audit trail.",
        "Do not approve an unsupported record you created when segregation of duties requires an independent decision.",
        "Do not create, validate, activate, supersede, or otherwise configure a department DOA; only Platform or Legal administrators may change it.",
      ],
      decisions: [
        "Decide procurement control, exception, administrative, and approval outcomes permitted by the active delegated authority.",
      ],
      upstreamRoleIds: [
        "procurement_officer",
        "procurement_approver",
        "procurement_finance",
        "platform_admin",
      ],
      downstreamRoleIds: [
        "procurement_officer",
        "procurement_finance",
        "warehouse_procurement",
      ],
      escalation:
        "Escalate policy conflict, authority collision, material exception, or suspected control bypass to the accountable executive and platform administrator with the audit record.",
    },
  }),
  liveRole({
    id: "legal_reviewer",
    rbacModule: "legal",
    rbacRole: "legal_reviewer",
    label: "Legal reviewer",
    module: "legal",
    purpose:
      "Review vendor accreditation cases, checklist evidence, documents, risk facts, and final accreditation readiness.",
    authority: {
      accessibleRoutes: ["/legal", "/legal/cases"],
      canDo: [
        "Review accreditation cases, manage requirement checklists and documents, and record the Release 1 accreditation decision.",
        "Request correction or additional evidence through the governed vendor case.",
      ],
      cannotDo: [
        "Do not invite vendors, administer department DOA, or decide a case without the required checklist, document, and instrument evidence.",
        "Do not accept undocumented evidence or share one vendor's records with another vendor.",
      ],
      decisions: [
        "Decide whether an accreditation case is approved, rejected, or returned for correction based on the complete Legal checklist and case evidence.",
      ],
      upstreamRoleIds: ["legal_admin", "vendor_portal"],
      downstreamRoleIds: [
        "vendor_portal",
        "legal_compliance",
        "procurement_officer",
      ],
      escalation:
        "Escalate policy interpretation, material risk, conflicting evidence, or decision-authority uncertainty to Legal Compliance before finalizing the case.",
    },
  }),
  liveRole({
    id: "legal_compliance",
    rbacModule: "legal",
    rbacRole: "compliance",
    label: "Legal compliance",
    module: "legal",
    purpose:
      "Review accreditation decisions, compliance evidence, lifecycle status, expiry, renewal, and material vendor changes.",
    authority: {
      accessibleRoutes: ["/legal", "/legal/cases"],
      canDo: [
        "Review cases and documents, decide accreditation status, and monitor lifecycle, expiry, and renewal controls.",
        "Return a case to the vendor or reviewer when compliance evidence is incomplete or stale.",
      ],
      cannotDo: [
        "Do not invite vendors, change Legal DOA, or approve a case based on an expired, incomplete, or unverified record.",
        "Do not use compliance review to override segregation-of-duties or vendor ownership controls.",
      ],
      decisions: [
        "Decide whether accreditation status remains acceptable through approval, rejection, correction, expiry, or renewal review.",
      ],
      upstreamRoleIds: ["legal_reviewer", "vendor_portal"],
      downstreamRoleIds: [
        "vendor_portal",
        "procurement_officer",
        "procurement_admin",
      ],
      escalation:
        "Escalate material compliance risk, policy conflict, sanctions concern, or lifecycle exception to Legal Administration and the accountable Legal authority.",
    },
  }),
  liveRole({
    id: "legal_admin",
    rbacModule: "legal",
    rbacRole: "admin",
    label: "Legal administrator",
    module: "legal",
    purpose:
      "Invite vendors, administer Legal workflow and documents, maintain department DOA, and oversee accredited-vendor controls.",
    authority: {
      accessibleRoutes: [
        "/legal",
        "/legal/cases",
        "/legal/invites/new",
        "/admin/doa",
      ],
      canDo: [
        "Invite vendors, administer accreditation cases and documents, make Legal decisions, and maintain Legal delegated authority.",
        "Recover controlled workflow failures and coordinate the vendor-to-Legal handoff.",
      ],
      cannotDo: [
        "Do not bypass required Legal evidence, instruments, named approval, or vendor-scoped access controls.",
        "Do not approve an unsupported case you configured when an independent review is required by policy.",
      ],
      decisions: [
        "Decide Legal administration, accreditation, checklist, document, and DOA outcomes within the active Legal control framework.",
      ],
      upstreamRoleIds: ["platform_admin", "vendor_portal", "legal_reviewer"],
      downstreamRoleIds: [
        "vendor_portal",
        "legal_reviewer",
        "legal_compliance",
        "procurement_officer",
      ],
      escalation:
        "Escalate a material legal, privacy, security, or policy-control issue to the accountable Legal authority and platform administrator with the case and audit references.",
    },
  }),
  liveRole({
    id: "events_requester", rbacModule: "events", rbacRole: "requester", label: "Event requester", module: "events",
    purpose: "Create event intent and request fulfillment while leaving every physical stock command to Warehouse.",
    authority: {
      accessibleRoutes: ["/events"],
      canDo: ["View events, create event intent, and request Warehouse fulfillment."],
      cannotDo: ["Do not reserve, issue, inspect, move, or return stock without the required Warehouse role."],
      decisions: ["Decide whether event facts are complete enough to create and hand off."],
      upstreamRoleIds: ["core_staff_only"], downstreamRoleIds: ["events_coordinator", "warehouse_operations"],
      escalation: "Escalate fulfillment or custody blockers to the Event Coordinator and Warehouse operations owner.",
    },
  }),
  liveRole({
    id: "events_coordinator", rbacModule: "events", rbacRole: "coordinator", label: "Event coordinator", module: "events",
    purpose: "Coordinate event planning, readiness, fulfillment handoffs, reconciliation, and closure.",
    authority: {
      accessibleRoutes: ["/events"],
      canDo: ["Create and manage events, request fulfillment, and close a reconciled lifecycle."],
      cannotDo: ["Do not close an event with unresolved custody or return exceptions; do not execute Warehouse commands without Warehouse authority."],
      decisions: ["Decide readiness, lifecycle updates, and closure after source reconciliation."],
      upstreamRoleIds: ["events_requester", "warehouse_marketing"], downstreamRoleIds: ["warehouse_operations", "warehouse_logistics_supervisor"],
      escalation: "Escalate stock, custody, or variance blockers to the accountable Warehouse supervisor.",
    },
  }),
  liveRole({
    id: "events_viewer", rbacModule: "events", rbacRole: "viewer", label: "Event viewer", module: "events",
    purpose: "Review authorized event plans, lifecycle, and fulfillment status without changing them.",
    authority: {
      accessibleRoutes: ["/events"], canDo: ["View event intent and read-only fulfillment totals."],
      cannotDo: ["Do not create, manage, close, or fulfill an event."], decisions: ["This role makes no event or stock decision."],
      upstreamRoleIds: ["events_coordinator"], downstreamRoleIds: ["events_coordinator"],
      escalation: "Escalate incorrect event data to the Event Coordinator with the event reference.",
    },
  }),
  liveRole({
    id: "events_admin", rbacModule: "events", rbacRole: "admin", label: "Events administrator", module: "events",
    purpose: "Administer the complete Events workspace while preserving Warehouse custody and source controls.",
    authority: {
      accessibleRoutes: ["/events"], canDo: ["Perform every released Events lifecycle action and recover controlled event failures."],
      cannotDo: ["Do not use Events administration to bypass Warehouse, Finance, Procurement, or Legal controls."], decisions: ["Decide event administration and lifecycle outcomes within released controls."],
      upstreamRoleIds: ["platform_admin", "events_coordinator"], downstreamRoleIds: ["events_coordinator", "warehouse_admin"],
      escalation: "Escalate cross-module control failures to Platform and the accountable department owner.",
    },
  }),
  liveRole({
    id: "insights_analyst", rbacModule: "insights", rbacRole: "analyst", label: "Insights data analyst", module: "insights",
    purpose: "Analyze authorized source-level indicators and prepare governed exports without operational writes.",
    authority: {
      accessibleRoutes: ["/insights"],
      canDo: ["View department indicators and prepare exports within approved scope."], cannotDo: ["Do not edit source records or claim executive-only access."],
      decisions: ["Decide whether an analysis is sufficiently defined, fresh, and supported for communication."],
      upstreamRoleIds: ["warehouse_bi_analyst"], downstreamRoleIds: ["insights_manager"],
      escalation: "Escalate undefined metrics, stale sources, or access concerns to the Insights Administrator.",
    },
  }),
  liveRole({
    id: "insights_manager", rbacModule: "insights", rbacRole: "manager", label: "Insights department manager", module: "insights",
    purpose: "Review department and executive indicators and route accountable corrective action to source owners.",
    authority: {
      accessibleRoutes: ["/insights"],
      canDo: ["View released department summaries and executive indicators."], cannotDo: ["Do not change source data or use a KPI as substitute approval evidence."],
      decisions: ["Decide which source owner must investigate a material indicator."], upstreamRoleIds: ["insights_analyst"], downstreamRoleIds: ["insights_executive", "warehouse_admin", "procurement_admin", "legal_admin"],
      escalation: "Escalate material cross-department risk to the accountable executive and source owner.",
    },
  }),
  liveRole({
    id: "insights_executive", rbacModule: "insights", rbacRole: "executive", label: "Insights executive", module: "insights",
    purpose: "Review executive-only summaries and assign accountable follow-up without source-level access or writes.",
    authority: {
      accessibleRoutes: ["/insights"], canDo: ["View released executive indicators and priority exceptions."],
      cannotDo: ["Do not access source-level department detail unless separately assigned; do not alter operational evidence."], decisions: ["Decide executive follow-up priority and accountable management owner."],
      upstreamRoleIds: ["insights_manager"], downstreamRoleIds: ["insights_manager"], escalation: "Escalate material control risk through the accountable executive governance route.",
    },
  }),
  liveRole({
    id: "insights_admin", rbacModule: "insights", rbacRole: "admin", label: "Insights administrator", module: "insights",
    purpose: "Administer every released Insights view and export permission while preserving read-only source ownership.",
    authority: {
      accessibleRoutes: ["/insights"],
      canDo: ["View every released metric area and administer governed Insights access."], cannotDo: ["Do not bypass source RLS, modify operations, or publish undefined metrics."],
      decisions: ["Decide approved Insights role scope and metric availability."], upstreamRoleIds: ["platform_admin", "insights_manager"], downstreamRoleIds: ["insights_analyst", "insights_manager", "insights_executive"],
      escalation: "Escalate security, definition, or source-integrity failures to Platform and the accountable data owner.",
    },
  }),
];

export const COMING_SOON_ROLES: KnowledgeRole[] = [
  comingSoonRole({
    id: "strategic_sourcing_lead",
    label: "Strategic sourcing lead",
    module: "procurement",
    purpose:
      "Planned role for category strategy, complex sourcing governance, and supplier-award oversight.",
    authority: {
      capabilities: [],
      accessibleRoutes: [],
      canDo: [
        "Plan strategic sourcing governance after its route and RBAC model are approved.",
      ],
      cannotDo: [
        "Do not perform live procurement actions until this planned role receives approved RBAC and routes.",
      ],
      decisions: [
        "Planned decision authority for complex sourcing and category strategy.",
      ],
      upstreamRoleIds: ["procurement_officer"],
      downstreamRoleIds: ["procurement_admin"],
      escalation:
        "Escalate current strategic sourcing needs to Procurement Administration until this role is released.",
    },
  }),
  comingSoonRole({
    id: "vendor_relationship_manager",
    label: "Vendor relationship manager",
    module: "procurement",
    purpose:
      "Planned role for supplier performance, relationship governance, and non-transactional vendor coordination.",
    authority: {
      capabilities: [],
      accessibleRoutes: [],
      canDo: [
        "Plan vendor relationship governance after an approved scope and RBAC model exist.",
      ],
      cannotDo: [
        "Do not access live vendor records or make supplier decisions through this planned role.",
      ],
      decisions: [
        "Planned decision authority for supplier-performance follow-up.",
      ],
      upstreamRoleIds: ["procurement_officer", "legal_compliance"],
      downstreamRoleIds: ["procurement_admin"],
      escalation:
        "Escalate current supplier relationship issues to Procurement Administration and Legal as applicable.",
    },
  }),
  comingSoonRole({
    id: "inventory_planner",
    label: "Inventory planner",
    module: "warehouse",
    purpose:
      "Planned role for demand planning, replenishment recommendations, and inventory-policy analysis.",
    authority: {
      capabilities: [],
      accessibleRoutes: [],
      canDo: [
        "Plan inventory policy and replenishment analysis after the planned workspace is approved.",
      ],
      cannotDo: [
        "Do not alter live inventory, supplier, allocation, or replenishment records through this planned role.",
      ],
      decisions: [
        "Planned decision authority for demand and replenishment recommendations.",
      ],
      upstreamRoleIds: ["warehouse_bi_analyst", "warehouse_procurement"],
      downstreamRoleIds: [
        "warehouse_procurement",
        "warehouse_logistics_supervisor",
      ],
      escalation:
        "Escalate current planning needs to Warehouse Procurement and the Warehouse Administrator.",
    },
  }),
  comingSoonRole({
    id: "internal_auditor",
    label: "Internal auditor",
    module: "core",
    purpose:
      "Planned independent role for cross-module control testing, audit evidence review, and remediation follow-up.",
    authority: {
      capabilities: [],
      accessibleRoutes: [],
      canDo: [
        "Plan independent audit review after the audit scope, evidence rules, and RBAC boundaries are approved.",
      ],
      cannotDo: [
        "Do not modify live records, approve operations, or administer access through this planned role.",
      ],
      decisions: [
        "Planned decision authority for audit findings and remediation recommendations.",
      ],
      upstreamRoleIds: [
        "platform_admin",
        "procurement_admin",
        "warehouse_admin",
        "legal_admin",
      ],
      downstreamRoleIds: [
        "platform_admin",
        "procurement_admin",
        "warehouse_admin",
        "legal_admin",
      ],
      escalation:
        "Escalate current audit concerns to the accountable department owner and platform administrator.",
    },
  }),
  comingSoonRole({
    id: "department_budget_owner",
    label: "Department budget owner",
    module: "procurement",
    purpose:
      "Planned role for budget accountability, funding confirmation, and departmental spend oversight.",
    authority: {
      capabilities: [],
      accessibleRoutes: [],
      canDo: [
        "Plan departmental budget review after the approved budget model and delegated authority are released.",
      ],
      cannotDo: [
        "Do not approve live procurement, alter financial evidence, or release payment through this planned role.",
      ],
      decisions: [
        "Planned decision authority for budget confirmation and spend stewardship.",
      ],
      upstreamRoleIds: ["procurement_requester", "procurement_finance"],
      downstreamRoleIds: ["procurement_approver", "procurement_finance"],
      escalation:
        "Escalate current budget questions to the assigned Finance approver and Procurement Administration.",
    },
  }),
  comingSoonRole({
    id: "security_reviewer",
    label: "Security reviewer",
    module: "core",
    purpose:
      "Planned role for security due diligence, control review, and material-access-risk assessment.",
    authority: {
      capabilities: [],
      accessibleRoutes: [],
      canDo: [
        "Plan security review after the required evidence, workflow, and RBAC scope are approved.",
      ],
      cannotDo: [
        "Do not access live records, change permissions, or approve vendors through this planned role.",
      ],
      decisions: [
        "Planned decision authority for security-review recommendations.",
      ],
      upstreamRoleIds: ["legal_admin", "platform_admin"],
      downstreamRoleIds: ["legal_compliance", "platform_admin"],
      escalation:
        "Escalate current security concerns to the platform administrator and accountable Legal authority.",
    },
  }),
];

export const KNOWLEDGE_ROLES: KnowledgeRole[] = LIVE_KNOWLEDGE_ROLES;

export function knowledgeRoleForRbac(
  module: RbacModule,
  role: string,
): KnowledgeRole | undefined {
  return LIVE_KNOWLEDGE_ROLES.find(
    (profile) => profile.rbacModule === module && profile.rbacRole === role,
  );
}

export function knowledgeRoleIdsForAssignments(
  assignments: Partial<Record<RbacModule, readonly string[]>>,
): string[] {
  return MODULE_LIST.flatMap((module) =>
    (assignments[module] ?? []).flatMap((role) => {
      const handbookRole = knowledgeRoleForRbac(module, role);
      return handbookRole ? [handbookRole.id] : [];
    }),
  );
}
