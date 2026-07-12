import {
  MODULE_LIST,
  roleCapabilities,
  type Module as RbacModule,
} from "@intra/rbac";
import { MODULES as WAREHOUSE_MODULES } from "@intra/warehouse";
import type { KnowledgeAuthority, KnowledgeRole } from "./types";

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
  { route: "/warehouse/inventory/:id", parentPath: "/inventory" },
  { route: "/warehouse/events/:id", parentPath: "/events" },
] as const;

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

type LiveRoleDefinition = Omit<KnowledgeRole, "availability" | "authority"> & {
  rbacModule: RbacModule;
  rbacRole: string;
  authority: RoleAuthority;
};

type ComingSoonRoleDefinition = Omit<
  KnowledgeRole,
  "availability" | "authority" | "rbacModule" | "rbacRole"
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
  return {
    ...definition,
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
  return { ...definition, availability: "coming_soon" };
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
      accessibleRoutes: ["/", "/knowledge"],
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
        "Maintain and validate the procurement department DOA through the governed administration path.",
      ],
      cannotDo: [
        "Do not use administrative capability to bypass a named approval, accreditation gate, competition rule, finance control, or audit trail.",
        "Do not approve an unsupported record you created when segregation of duties requires an independent decision.",
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
