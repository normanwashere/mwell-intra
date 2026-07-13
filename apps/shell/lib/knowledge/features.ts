import { KNOWLEDGE_ROLES } from "./roles";
import { EXPLICIT_FEATURE_DETAILS } from "./featureDetails";
import { LIVE_ROUTE_MANIFEST } from "./coverage";
import type { KnowledgeFeature, KnowledgeModule } from "./types";

interface FeatureDefinition {
  id: string;
  title: string;
  module: KnowledgeModule;
  route: string;
  purpose: string;
  reads: string;
  writes: string;
  statuses: string;
  exception: string;
  completionEvidence: string;
  roleIds?: string[];
}

interface FeatureRelationship {
  policyBasis: string[];
  relatedFlowIds: string[];
}

const POLICY = {
  identity:
    "Identity and access policy requires active attributable identities and least-privilege scoped access.",
  knowledge:
    "Knowledge governance requires owned, reviewed, current guidance that does not grant operational authority.",
  resilience:
    "Operational resilience requires clear saved-state, connectivity, retry, and escalation behavior.",
  doa: "Delegation of Authority governance requires effective-dated, complete, non-conflicting approval coverage.",
  warehouse:
    "Warehouse control policy requires attributable stock movement, valid source records, traceability, evidence, and controlled destinations.",
  quality:
    "Warehouse quality policy requires documented inspection and authorized hold, release, return, or rejection disposition.",
  inventory:
    "Inventory integrity policy requires physical and ledger reconciliation before an approved stock adjustment.",
  event:
    "Warehouse custody policy requires attributable reservation, issue, transfer, consumption, return, and event reconciliation.",
  pricing:
    "Pricing and valuation policy requires supported cost basis, effective dating, independent review, and immutable price history.",
  procurement:
    "Procurement policy requires threshold- and risk-appropriate sourcing, competition evidence, vendor eligibility, budget evidence, and active approval authority.",
  payment:
    "Payment-readiness policy requires approved demand, eligible supplier, receipt, inspection, requester acceptance, invoice, and amount reconciliation.",
  accreditation:
    "Vendor accreditation policy requires scoped requirements, sufficient evidence, residual-risk review, required instruments, and authorized disposition.",
  vendorScope:
    "Vendor portal policy restricts every read and write to the authenticated vendor's own case and applicable requirements.",
} as const;

const FEATURE_RELATIONSHIPS: Record<string, FeatureRelationship> = {
  "shell-home": {
    policyBasis: [POLICY.identity],
    relatedFlowIds: ["identity-and-access"],
  },
  "sign-in": {
    policyBasis: [POLICY.identity],
    relatedFlowIds: ["identity-and-access"],
  },
  "reset-password": {
    policyBasis: [POLICY.identity],
    relatedFlowIds: ["identity-and-access"],
  },
  "knowledge-library": {
    policyBasis: [POLICY.knowledge],
    relatedFlowIds: [],
  },
  "offline-status": {
    policyBasis: [POLICY.resilience],
    relatedFlowIds: ["exception-and-recovery"],
  },
  "admin-users": {
    policyBasis: [POLICY.identity],
    relatedFlowIds: ["identity-and-access", "administration"],
  },
  "admin-doa": {
    policyBasis: [POLICY.doa],
    relatedFlowIds: ["doa-governance", "administration", "procure-to-pay"],
  },
  "warehouse-dashboard": {
    policyBasis: [POLICY.warehouse],
    relatedFlowIds: [
      "warehouse-setup",
      "receive-to-putaway",
      "quality-disposition",
      "event-fulfillment",
      "returns-reconciliation",
      "cycle-count-adjustment",
      "pricing-and-costing",
      "exception-and-recovery",
    ],
  },
  "warehouse-scan": {
    policyBasis: [POLICY.warehouse],
    relatedFlowIds: [
      "receive-to-putaway",
      "event-fulfillment",
      "returns-reconciliation",
      "cycle-count-adjustment",
    ],
  },
  "warehouse-tasks": {
    policyBasis: [POLICY.warehouse],
    relatedFlowIds: [
      "receive-to-putaway",
      "quality-disposition",
      "event-fulfillment",
      "returns-reconciliation",
      "cycle-count-adjustment",
      "exception-and-recovery",
    ],
  },
  "warehouse-inventory": {
    policyBasis: [POLICY.warehouse, POLICY.inventory],
    relatedFlowIds: [
      "receive-to-putaway",
      "quality-disposition",
      "event-fulfillment",
      "returns-reconciliation",
      "cycle-count-adjustment",
    ],
  },
  "warehouse-product-detail": {
    policyBasis: [POLICY.warehouse, POLICY.inventory, POLICY.pricing],
    relatedFlowIds: [
      "receive-to-putaway",
      "quality-disposition",
      "returns-reconciliation",
      "cycle-count-adjustment",
      "pricing-and-costing",
    ],
  },
  "warehouse-receiving": {
    policyBasis: [POLICY.warehouse, POLICY.quality],
    relatedFlowIds: ["receive-to-putaway", "quality-disposition"],
  },
  "warehouse-allocations": {
    policyBasis: [POLICY.event, POLICY.inventory],
    relatedFlowIds: [
      "event-fulfillment",
      "returns-reconciliation",
      "allocation-event-return",
    ],
  },
  "warehouse-returns": {
    policyBasis: [POLICY.event, POLICY.inventory],
    relatedFlowIds: ["returns-reconciliation", "allocation-event-return"],
  },
  "warehouse-storage": {
    policyBasis: [POLICY.warehouse],
    relatedFlowIds: ["warehouse-setup", "receive-to-putaway"],
  },
  "warehouse-events": {
    policyBasis: [POLICY.event],
    relatedFlowIds: ["event-fulfillment", "allocation-event-return"],
  },
  "warehouse-event-detail": {
    policyBasis: [POLICY.event, POLICY.inventory],
    relatedFlowIds: [
      "event-fulfillment",
      "returns-reconciliation",
      "allocation-event-return",
    ],
  },
  "warehouse-procurement-planning": {
    policyBasis: [POLICY.procurement, POLICY.warehouse],
    relatedFlowIds: ["procure-to-pay", "receive-to-putaway"],
  },
  "warehouse-purchase-orders": {
    policyBasis: [POLICY.procurement, POLICY.warehouse],
    relatedFlowIds: ["procure-to-pay", "receive-to-putaway"],
  },
  "warehouse-cycle-counts": {
    policyBasis: [POLICY.inventory],
    relatedFlowIds: ["cycle-count-adjustment"],
  },
  "warehouse-quality": {
    policyBasis: [POLICY.quality, POLICY.inventory],
    relatedFlowIds: [
      "quality-disposition",
      "receive-to-putaway",
      "returns-reconciliation",
    ],
  },
  "warehouse-approvals": {
    policyBasis: [POLICY.inventory, POLICY.quality, POLICY.pricing],
    relatedFlowIds: [
      "cycle-count-adjustment",
      "quality-disposition",
      "pricing-and-costing",
    ],
  },
  "warehouse-exceptions": {
    policyBasis: [POLICY.resilience, POLICY.warehouse],
    relatedFlowIds: [
      "exception-and-recovery",
      "receive-to-putaway",
      "quality-disposition",
      "returns-reconciliation",
      "cycle-count-adjustment",
    ],
  },
  "warehouse-finance": {
    policyBasis: [POLICY.inventory, POLICY.pricing],
    relatedFlowIds: [
      "receive-to-putaway",
      "returns-reconciliation",
      "cycle-count-adjustment",
      "pricing-and-costing",
    ],
  },
  "warehouse-pricing": {
    policyBasis: [POLICY.pricing],
    relatedFlowIds: ["pricing-and-costing"],
  },
  "warehouse-data": {
    policyBasis: [
      POLICY.warehouse,
      POLICY.event,
      POLICY.resilience,
      POLICY.inventory,
      POLICY.pricing,
    ],
    relatedFlowIds: [
      "receive-to-putaway",
      "event-fulfillment",
      "exception-and-recovery",
      "returns-reconciliation",
      "cycle-count-adjustment",
      "pricing-and-costing",
    ],
  },
  "warehouse-reports": {
    policyBasis: [
      POLICY.warehouse,
      POLICY.event,
      POLICY.resilience,
      POLICY.inventory,
      POLICY.pricing,
    ],
    relatedFlowIds: [
      "receive-to-putaway",
      "event-fulfillment",
      "exception-and-recovery",
      "returns-reconciliation",
      "cycle-count-adjustment",
      "pricing-and-costing",
    ],
  },
  "warehouse-suppliers": {
    policyBasis: [POLICY.procurement, POLICY.warehouse, POLICY.accreditation],
    relatedFlowIds: [
      "procure-to-pay",
      "vendor-accreditation",
      "warehouse-setup",
      "receive-to-putaway",
    ],
  },
  "warehouse-locations": {
    policyBasis: [POLICY.warehouse, POLICY.event],
    relatedFlowIds: [
      "warehouse-setup",
      "receive-to-putaway",
      "event-fulfillment",
    ],
  },
  "warehouse-imports": {
    policyBasis: [POLICY.warehouse, POLICY.resilience],
    relatedFlowIds: ["warehouse-setup", "administration"],
  },
  "warehouse-operation-routes": {
    policyBasis: [POLICY.warehouse],
    relatedFlowIds: ["warehouse-setup", "administration"],
  },
  "procurement-requests": {
    policyBasis: [POLICY.procurement],
    relatedFlowIds: ["procure-to-pay"],
  },
  "procurement-request-create": {
    policyBasis: [POLICY.procurement, POLICY.doa, POLICY.accreditation],
    relatedFlowIds: ["procure-to-pay", "vendor-accreditation"],
  },
  "procurement-request-detail": {
    policyBasis: [POLICY.procurement, POLICY.doa, POLICY.accreditation],
    relatedFlowIds: ["procure-to-pay", "vendor-accreditation"],
  },
  "procurement-approvals": {
    policyBasis: [POLICY.procurement, POLICY.doa, POLICY.accreditation],
    relatedFlowIds: [
      "procure-to-pay",
      "doa-governance",
      "vendor-accreditation",
    ],
  },
  "procurement-purchase-orders": {
    policyBasis: [POLICY.procurement, POLICY.payment, POLICY.accreditation],
    relatedFlowIds: [
      "procure-to-pay",
      "vendor-accreditation",
      "receive-to-putaway",
    ],
  },
  "procurement-po-detail": {
    policyBasis: [POLICY.procurement, POLICY.payment, POLICY.accreditation],
    relatedFlowIds: [
      "procure-to-pay",
      "vendor-accreditation",
      "receive-to-putaway",
    ],
  },
  "legal-cases": {
    policyBasis: [POLICY.accreditation],
    relatedFlowIds: ["vendor-accreditation"],
  },
  "legal-case-detail": {
    policyBasis: [POLICY.accreditation],
    relatedFlowIds: ["vendor-accreditation"],
  },
  "legal-case-application": {
    policyBasis: [POLICY.accreditation],
    relatedFlowIds: ["vendor-accreditation"],
  },
  "legal-sign-instrument": {
    policyBasis: [POLICY.accreditation],
    relatedFlowIds: ["vendor-accreditation"],
  },
  "legal-invite-vendor": {
    policyBasis: [POLICY.accreditation, POLICY.identity],
    relatedFlowIds: ["vendor-accreditation"],
  },
  "vendor-cases": {
    policyBasis: [POLICY.vendorScope, POLICY.accreditation],
    relatedFlowIds: ["vendor-accreditation"],
  },
  "vendor-case-detail": {
    policyBasis: [POLICY.vendorScope, POLICY.accreditation],
    relatedFlowIds: ["vendor-accreditation"],
  },
  "vendor-application": {
    policyBasis: [POLICY.vendorScope, POLICY.accreditation],
    relatedFlowIds: ["vendor-accreditation"],
  },
  "vendor-sign-instrument": {
    policyBasis: [POLICY.vendorScope, POLICY.accreditation],
    relatedFlowIds: ["vendor-accreditation"],
  },
  "vendor-invite-unavailable": {
    policyBasis: [POLICY.vendorScope, POLICY.identity],
    relatedFlowIds: ["vendor-accreditation", "identity-and-access"],
  },
  cms: { policyBasis: [POLICY.knowledge], relatedFlowIds: [] },
  context: { policyBasis: [POLICY.knowledge], relatedFlowIds: [] },
  analytics: { policyBasis: [POLICY.knowledge], relatedFlowIds: [] },
  feedback: { policyBasis: [POLICY.knowledge], relatedFlowIds: [] },
  traceability: { policyBasis: [POLICY.knowledge], relatedFlowIds: [] },
  walkthrough: { policyBasis: [POLICY.knowledge], relatedFlowIds: [] },
  language: { policyBasis: [POLICY.knowledge], relatedFlowIds: [] },
  offline: {
    policyBasis: [POLICY.knowledge, POLICY.resilience],
    relatedFlowIds: ["exception-and-recovery"],
  },
  learning: { policyBasis: [POLICY.knowledge], relatedFlowIds: [] },
  release: { policyBasis: [POLICY.knowledge], relatedFlowIds: [] },
};

const CURRENT_ROLE_IDS = KNOWLEDGE_ROLES.filter(
  (role) => role.availability !== "coming_soon",
).map((role) => role.id);

const rolesFor = (
  module: KnowledgeModule,
  capabilityIds: string[],
): string[] => {
  const matches = KNOWLEDGE_ROLES.filter(
    (role) =>
      role.availability !== "coming_soon" &&
      role.module === module &&
      (capabilityIds.length === 0 ||
        capabilityIds.some((capability) =>
          role.authority.capabilities.includes(capability),
        )),
  ).map((role) => role.id);
  return matches.length > 0 ? matches : CURRENT_ROLE_IDS;
};

const ownerFor: Record<KnowledgeModule, string> = {
  core: "Platform",
  admin: "Platform",
  warehouse: "Warehouse",
  procurement: "Procurement",
  legal: "Legal",
  vendor: "Legal",
};

const auditedNotification = (definition: FeatureDefinition): string => {
  if (definition.id === "shell-home")
    return "The shell reads core.notifications and marks an opened item read; manage_notifications broadens the stream according to database policy.";
  if (definition.id === "legal-invite-vendor")
    return "The page shows a success or error toast, while the protected invitation API invokes the delivery Edge Function; it does not write core.notifications directly.";
  if (definition.module === "warehouse")
    return `${definition.title} uses page-level toast or inline feedback where its controls mutate data; it does not write core.notifications.`;
  if (definition.module === "procurement")
    return `${definition.title} uses local success or error feedback for implemented actions; procurement localStore and page RPC calls do not write core.notifications.`;
  if (definition.module === "legal" || definition.module === "vendor")
    return `${definition.title} uses local success or error feedback for implemented actions; Legal localStore and page RPC calls do not write core.notifications.`;
  const coreFeedback: Record<string, string> = {
    "sign-in":
      "Authentication and recovery results appear inline; sign-in itself does not create an operational notification record.",
    "reset-password":
      "Password update success or provider failure appears inline; the page does not write core.notifications.",
    "knowledge-library":
      "Search and filter states appear in the page and URL; the library does not write notification records.",
    "offline-status":
      "The fallback presents connectivity guidance only and does not write notification records.",
    "admin-users":
      "Role assignment and revocation use local success or error toasts; the page does not write core.notifications.",
    "admin-doa":
      "Revision load, draft save, activation, and failures use local toasts; the page does not write core.notifications.",
  };
  return (
    coreFeedback[definition.id] ??
    "This page does not write an operational notification record."
  );
};

const defineFeature = (definition: FeatureDefinition): KnowledgeFeature => {
  const details = EXPLICIT_FEATURE_DETAILS[definition.id];
  if (!details)
    throw new Error(`missing explicit feature details for ${definition.id}`);
  const routeContract = LIVE_ROUTE_MANIFEST.find(
    (entry) => entry.route === definition.route,
  );
  if (!routeContract)
    throw new Error(`missing route contract for feature ${definition.id}`);
  const relationship = FEATURE_RELATIONSHIPS[definition.id];
  if (!relationship)
    throw new Error(
      `missing explicit feature relationship for ${definition.id}`,
    );
  const capabilityIds = [...routeContract.capabilityIds];
  return {
    id: definition.id,
    title: definition.title,
    module: definition.module,
    availability: "live",
    routes: [definition.route],
    roleIds: definition.roleIds ?? rolesFor(definition.module, capabilityIds),
    capabilityIds,
    purpose: definition.purpose,
    policyBasis: relationship.policyBasis,
    relatedFlowIds: relationship.relatedFlowIds,
    controls: details.controls,
    fields: details.fields,
    reads: [definition.reads],
    writes: [definition.writes],
    statuses: [definition.statuses],
    notifications: [auditedNotification(definition)],
    exceptions: [definition.exception],
    completionEvidence: [definition.completionEvidence],
    owner: ownerFor[definition.module],
    reviewedAt: "2026-07-12",
  };
};

const definitions: FeatureDefinition[] = [
  {
    id: "shell-home",
    title: "Intra home",
    module: "core",
    route: "/",
    roleIds: ["core_staff_only", "platform_admin"],
    purpose:
      "Shows an authenticated employee the modules and shared work areas available through current role assignments.",
    reads:
      "Current profile, role assignments, module navigation, and unread notification summaries.",
    writes:
      "No operational record is changed; opening a destination changes navigation state only.",
    statuses:
      "Signed out, loading, authorized, partially authorized, or access denied.",
    exception:
      "If an expected module is absent, refresh the session and ask a platform administrator to review role scope.",
    completionEvidence:
      "The intended authorized module or work item opens under the employee identity.",
  },
  {
    id: "sign-in",
    title: "Sign in",
    module: "core",
    route: "/login",
    roleIds: ["core_staff_only", "platform_admin", "vendor_portal"],
    purpose:
      "Creates a secure employee or vendor session and returns the user to an approved destination.",
    reads:
      "Authentication configuration, requested return path, and the identity returned by the provider.",
    writes:
      "Creates an authenticated session; it does not change business records or role assignments.",
    statuses:
      "Preparing, signed out, authenticating, authenticated, or authentication failed.",
    exception:
      "Use password recovery for forgotten credentials and contact Platform for an inactive or incorrectly typed account.",
    completionEvidence:
      "The user reaches the approved home or deep-linked page with the correct profile visible.",
  },
  {
    id: "reset-password",
    title: "Password reset",
    module: "core",
    route: "/reset-password",
    roleIds: ["core_staff_only", "platform_admin", "vendor_portal"],
    purpose:
      "Lets a user with a valid recovery session replace a forgotten password and resume approved work.",
    reads: "Recovery session, safe local return path, and authentication mode.",
    writes:
      "Replaces the authenticated account password; no operational data is changed.",
    statuses:
      "Preparing, unavailable in preview, ready, updating, complete, or failed.",
    exception:
      "Request a new recovery link if the session expired; preview mode cannot change passwords.",
    completionEvidence:
      "Password updated is shown and the user is redirected to the safe requested page.",
  },
  {
    id: "knowledge-library",
    title: "Knowledge Base",
    module: "core",
    route: "/knowledge",
    roleIds: CURRENT_ROLE_IDS,
    purpose:
      "Provides searchable role guidance, feature references, workflows, glossary definitions, and governed future recommendations.",
    reads:
      "Governed knowledge content, route filters, workflow graph, and reviewed evidence metadata.",
    writes:
      "No business data is changed; query parameters preserve the selected documentation view.",
    statuses:
      "Library, search results, article detail, workflow detail, glossary detail, or no results.",
    exception:
      "Clear filters or search a plain-language synonym when no result appears; escalate stale guidance to its owner.",
    completionEvidence:
      "The relevant article or workflow opens with owner, review date, route, and completion guidance.",
  },
  {
    id: "offline-status",
    title: "Offline status",
    module: "core",
    route: "/~offline",
    roleIds: CURRENT_ROLE_IDS,
    purpose:
      "Explains that the shell cannot load live data while disconnected and protects users from assuming a transaction completed.",
    reads: "Browser connectivity and service-worker fallback state.",
    writes:
      "No record is written; queued warehouse commands remain in their existing outbox state.",
    statuses:
      "Offline, reconnecting through the browser, or online after a fresh navigation.",
    exception:
      "Do not repeat uncertain transactions; reconnect, open the record, and verify activity before retrying.",
    completionEvidence:
      "A fresh navigation loads the live page and any queued command shows an explicit synchronized outcome.",
  },
  {
    id: "admin-users",
    title: "User and role administration",
    module: "admin",
    route: "/admin/users",
    roleIds: ["platform_admin"],
    purpose:
      "Allows the platform administrator to review profiles and assign the minimum approved module roles.",
    reads:
      "Core profiles, active user_roles assignments, and shared module role definitions.",
    writes:
      "Adds or removes scoped role assignments through the governed administration service.",
    statuses:
      "Loading, ready, role change pending, saved, failed, active profile, or inactive profile.",
    exception:
      "Stop if identity kind or approved responsibility is unclear and obtain authorization before changing access.",
    completionEvidence:
      "The intended role appears on the profile after the live assignments reload; the RPC owns any database audit side effect.",
  },
  {
    id: "admin-doa",
    title: "Delegation of Authority administration",
    module: "admin",
    route: "/admin/doa",
    roleIds: ["platform_admin", "legal_admin"],
    purpose:
      "Creates immutable department approval-matrix revisions and deliberately activates a validated version.",
    reads:
      "DOA matrices, active assignments, and active employee profiles eligible for named authority.",
    writes:
      "Saves a new draft matrix or activates it while superseding the previous active revision.",
    statuses:
      "Draft, active, superseded, expired, loading revision, saving, or validation failed.",
    exception:
      "Preview mode is read-only; resolve threshold gaps, missing owners, and ambiguous source authority before activation.",
    completionEvidence:
      "The department card shows the intended version as active and the previous version as superseded.",
  },

  {
    id: "warehouse-dashboard",
    title: "Warehouse dashboard",
    module: "warehouse",
    route: "/warehouse",
    purpose:
      "Summarizes inventory health, urgent controls, utilization, and operational work requiring attention.",
    reads:
      "Stock balances, alerts, tasks, receipts, events, and utilization aggregates.",
    writes:
      "No operational record changes; selected dashboard filters remain local view state.",
    statuses:
      "Loading, current, warning, critical, empty, or data unavailable.",
    exception:
      "Open the source record before acting when an aggregate appears stale or inconsistent.",
    completionEvidence:
      "Each selected alert opens the governed source queue or record with current status.",
  },
  {
    id: "warehouse-scan",
    title: "Warehouse scan",
    module: "warehouse",
    route: "/warehouse/scan",
    purpose:
      "Starts an authorized stock operation from a scanned barcode while preserving product and custody identity.",
    reads:
      "Product, lot or serial, bin, operation-route, and outstanding work context.",
    writes:
      "Routes the resolved identity into receiving, issue, return, count, transfer, or product detail workflows.",
    statuses:
      "Camera unavailable, scanning, resolved, ambiguous, not found, or operation blocked.",
    exception:
      "Use manual lookup when camera permission fails; never choose an arbitrary match for an ambiguous code.",
    completionEvidence:
      "The resolved product and intended operation appear before any stock command is committed.",
  },
  {
    id: "warehouse-tasks",
    title: "Warehouse tasks",
    module: "warehouse",
    route: "/warehouse/tasks",
    purpose:
      "Combines due, blocked, and completed warehouse control work into one actionable queue.",
    reads:
      "Quality inspections, exceptions, cycle counts, due dates, assignment, and completion activity.",
    writes:
      "No task is completed from the list; opening a row navigates to its governed action page.",
    statuses: "Due, overdue, blocked, completed, empty, or unavailable.",
    exception:
      "Refresh before acting on a task whose status changed or whose linked record cannot be opened.",
    completionEvidence:
      "The selected task opens at the exact record and control needed to resolve it.",
  },
  {
    id: "warehouse-inventory",
    title: "Inventory browser",
    module: "warehouse",
    route: "/warehouse/inventory",
    purpose:
      "Finds stock-keeping units and compares available, reserved, held, and location-level balances.",
    reads:
      "Products, units, lots, serials, stock levels, reservations, holds, and locations.",
    writes:
      "Authorized product edits may update master data; balance changes require a separate governed stock command.",
    statuses:
      "Available, reserved, held, low stock, out of stock, inactive, or loading.",
    exception:
      "Investigate the ledger and source transaction rather than directly editing a disputed balance.",
    completionEvidence:
      "The selected product shows a traceable balance and opens its detail record.",
  },
  {
    id: "warehouse-product-detail",
    title: "Warehouse product detail",
    module: "warehouse",
    route: "/warehouse/inventory/:id",
    purpose:
      "Explains one product's master data, stock positions, traceability records, and recent movement history.",
    reads:
      "Product master, warehouse balances, bins, lots, serials, valuation context, and movement history.",
    writes:
      "Updates product master data and invokes governed transfer, relocation, count-adjustment, and price-revision repository methods; quantity changes remain ledger-controlled.",
    statuses:
      "Active, inactive, tracked by lot, tracked by serial, available, held, or not found.",
    exception:
      "Return to inventory if the product was removed or access changed; escalate conflicting identifiers.",
    completionEvidence:
      "The saved master-data values and current traceable balances are visible on the same product record.",
  },
  {
    id: "warehouse-receiving",
    title: "Warehouse receiving",
    module: "warehouse",
    route: "/warehouse/receiving",
    purpose:
      "Receives approved purchase-order quantities with traceability, evidence, inspection routing, and destination control.",
    reads:
      "Approved purchase orders, remaining lines, products, suppliers, warehouses, bins, and operation routes.",
    writes:
      "Creates receipt, unit or lot, evidence, movement, stock-ledger, and quality-control records atomically.",
    statuses:
      "Receivable, partial, complete, pending inspection, held, rejected, or failed.",
    exception:
      "Stop for over-delivery, missing PO, damaged goods, invalid route, or duplicate serial and record evidence.",
    completionEvidence:
      "Receipt number, accepted quantity, traceability identity, destination, and ledger activity are visible.",
  },
  {
    id: "warehouse-allocations",
    title: "Stock allocations",
    module: "warehouse",
    route: "/warehouse/allocations",
    purpose:
      "Reserves available stock for approved demand and records custody when items are issued.",
    reads:
      "Events, demand lines, stock availability, existing reservations, recipients, and custody history.",
    writes:
      "Creates or updates reservations and records governed issue movements to the named recipient.",
    statuses:
      "Requested, reserved, partially reserved, issued, cancelled, returned, or short.",
    exception:
      "Resolve insufficient stock, overlapping reservations, missing recipient, or stale demand before retrying.",
    completionEvidence:
      "Allocation status, quantity, source stock, recipient, and movement reference reconcile to the event demand.",
  },
  {
    id: "warehouse-returns",
    title: "Warehouse returns",
    module: "warehouse",
    route: "/warehouse/returns",
    purpose:
      "Records returned custody and routes each unit to restock, hold, repair, loss, damage, or vendor return.",
    reads:
      "Open issues, event allocations, products, traceability identity, prior returns, and valid destinations.",
    writes:
      "Creates return, inspection or disposition movements and updates custody and stock according to the decision.",
    statuses:
      "Expected, received, inspected, restocked, held, damaged, lost, or returned to vendor.",
    exception:
      "Quarantine unidentified or unsafe items and escalate quantity or serial mismatches instead of forcing a return.",
    completionEvidence:
      "Every returned quantity has a condition, final disposition, evidence reference, and reconciled custody balance.",
  },
  {
    id: "warehouse-storage",
    title: "Warehouse storage areas and bins",
    module: "warehouse",
    route: "/warehouse/storage",
    purpose:
      "Defines scannable storage areas and bins used by receiving, transfer, counting, and putaway controls.",
    reads:
      "Warehouses, storage areas, bins, occupancy, restrictions, and related operation routes.",
    writes:
      "Adds, updates, or removes storage master records and invokes governed putaway movements through repository methods.",
    statuses:
      "Active, inactive, restricted, occupied, empty, or configuration invalid.",
    exception:
      "Do not deactivate an occupied bin or create a route that bypasses quarantine and evidence rules.",
    completionEvidence:
      "The area and unique scannable bin appear under the intended warehouse with correct restrictions.",
  },
  {
    id: "warehouse-events",
    title: "Warehouse events",
    module: "warehouse",
    route: "/warehouse/events",
    purpose:
      "Plans activation demand and summarizes inventory commitments, dates, owners, and reconciliation state.",
    reads:
      "Events, demand, reservations, issues, returns, consumption, and summarized cost.",
    writes:
      "Creates or updates authorized event planning records; stock changes occur through allocation and return commands.",
    statuses:
      "Draft, confirmed, active, reconciling, complete, cancelled, or overdue.",
    exception:
      "Do not close an event while issued quantities lack consumed, returned, lost, or damaged outcomes.",
    completionEvidence:
      "The selected event opens with owner, schedule, committed quantity, and current reconciliation status.",
  },
  {
    id: "warehouse-event-detail",
    title: "Warehouse event detail",
    module: "warehouse",
    route: "/warehouse/events/:id",
    purpose:
      "Tracks one event from demand and reservation through issue, consumption, return, and financial reconciliation.",
    reads:
      "Event header, demand lines, reservations, issues, returns, outcomes, evidence, and cost summary.",
    writes:
      "Updates event demand and records authorized allocation or outcome actions through governed controls.",
    statuses:
      "Draft, confirmed, allocated, issued, reconciling, complete, cancelled, or exception.",
    exception:
      "Investigate missing custody, over-consumption, damaged stock, or duplicate outcome records before closure.",
    completionEvidence:
      "Demand, issued quantity, every outcome, return disposition, and cost reconcile to zero outstanding custody.",
  },
  {
    id: "warehouse-procurement-planning",
    title: "Warehouse procurement planning",
    module: "warehouse",
    route: "/warehouse/procurement",
    purpose:
      "Prioritizes reorder needs using availability, demand, lead time, safety stock, and supplier context.",
    reads:
      "Stock, reorder settings, open demand, open POs, suppliers, lead times, and consumption trends.",
    writes:
      "Creates one or more draft warehouse purchase orders through the repository; filtering and product review do not write data.",
    statuses:
      "Healthy, monitor, reorder, stockout risk, inbound, or data incomplete.",
    exception:
      "Validate unusual demand, missing lead time, or stale inbound status before raising procurement action.",
    completionEvidence:
      "The recommendation can be traced to current stock, demand, lead time, and open supply.",
  },
  {
    id: "warehouse-purchase-orders",
    title: "Warehouse purchase orders",
    module: "warehouse",
    route: "/warehouse/purchase-orders",
    purpose:
      "Shows approved supply orders and remaining quantities available for warehouse receiving.",
    reads:
      "Purchase orders, suppliers, lines, ordered and received quantities, expected dates, and linked receipts.",
    writes:
      "Creates, cancels, and receives warehouse purchase orders through repository methods; opening and filtering are read-only.",
    statuses:
      "Draft, approved, issued, partially received, received, cancelled, or overdue.",
    exception:
      "Escalate cancelled, unapproved, over-received, or mismatched supply to Procurement before receipt.",
    completionEvidence:
      "Ordered, received, and remaining quantities reconcile and the linked receiving action uses the correct PO.",
  },
  {
    id: "warehouse-cycle-counts",
    title: "Cycle counts",
    module: "warehouse",
    route: "/warehouse/cycle-counts",
    purpose:
      "Captures a physical bin count, calculates variance, and routes material adjustments for approval.",
    reads:
      "Expected bin balances, products, traceability identities, open counts, and prior adjustments.",
    writes:
      "Creates count and variance records; approved adjustments post through the stock-change workflow.",
    statuses:
      "Draft, counting, submitted, no variance, approval required, approved, posted, or rejected.",
    exception:
      "Freeze the scope and recount when stock moved during counting or a serial identity is missing.",
    completionEvidence:
      "Physical count, expected count, variance, evidence, decision, and any ledger adjustment are linked.",
  },
  {
    id: "warehouse-quality",
    title: "Quality control",
    module: "warehouse",
    route: "/warehouse/quality",
    purpose:
      "Inspects received or returned stock and controls release, hold, rejection, or vendor-return disposition.",
    reads:
      "Pending inspections, receipt or return context, product rules, evidence, holds, and prior decisions.",
    writes:
      "Records inspection results and creates, releases, rejects, or routes quality-held stock.",
    statuses:
      "Pending, in inspection, accepted, held, released, rejected, or vendor return.",
    exception:
      "Keep stock unavailable when evidence is incomplete, contamination is suspected, or release authority is absent.",
    completionEvidence:
      "Inspection checklist, actor, time, evidence, decision, and resulting stock status are linked.",
  },
  {
    id: "warehouse-approvals",
    title: "Stock approvals",
    module: "warehouse",
    route: "/warehouse/approvals",
    purpose:
      "Lets an authorized approver decide material inventory changes without allowing direct balance edits.",
    reads:
      "Proposed stock changes, variance value, source count or exception, evidence, and prior decisions.",
    writes:
      "Records approve, reject, or return decisions and posts only eligible approved adjustments.",
    statuses:
      "Pending, approved, rejected, returned for revision, posted, or stale.",
    exception:
      "Refresh stale requests and abstain when the approver created the change or lacks required authority.",
    completionEvidence:
      "Named decision, reason, source evidence, posting reference, and final ledger effect are visible.",
  },
  {
    id: "warehouse-exceptions",
    title: "Warehouse exceptions",
    module: "warehouse",
    route: "/warehouse/exceptions",
    purpose:
      "Investigates operational failures and records a controlled resolution without hiding the original event.",
    reads:
      "Failed commands, stock discrepancies, blocked routes, related records, retries, and activity history.",
    writes:
      "Assigns, annotates, resolves, or escalates exception records; source records change only through governed commands.",
    statuses:
      "Open, assigned, investigating, blocked, resolved, escalated, or reopened.",
    exception:
      "Do not retry a non-idempotent command until source status and activity prove that no effect was recorded.",
    completionEvidence:
      "Root cause, owner, resolution, evidence, source-record outcome, and closure time are recorded.",
  },
  {
    id: "warehouse-finance",
    title: "Warehouse finance",
    module: "warehouse",
    route: "/warehouse/finance",
    purpose:
      "Reviews inventory valuation, receipt costing, reconciliation, write-offs, and asset-register context.",
    reads:
      "Stock ledger, landed cost, receipts, adjustments, write-offs, assets, and reconciliation aggregates.",
    writes:
      "No ledger entry is created from this analytical page; exports record governed download activity where enabled.",
    statuses:
      "Current, unreconciled, variance, pending cost, written off, exported, or data unavailable.",
    exception:
      "Trace a discrepancy to source receipts and movements before approving any correcting transaction.",
    completionEvidence:
      "Displayed valuation reconciles to posted quantity and cost sources for the selected period.",
  },
  {
    id: "warehouse-pricing",
    title: "Warehouse pricing",
    module: "warehouse",
    route: "/warehouse/pricing",
    purpose:
      "Reviews landed cost and margin context and governs authorized product price changes.",
    reads:
      "Products, current and prior prices, landed cost, valuation, turnover, and margin context.",
    writes:
      "Authorized users create a dated price revision without changing historical transactions.",
    statuses:
      "Current, proposed, scheduled, effective, superseded, or save failed.",
    exception:
      "Escalate anomalous cost or margin rather than overriding source valuation to force a target price.",
    completionEvidence:
      "The dated revision, actor, reason, previous value, and effective price appear in history.",
  },
  {
    id: "warehouse-data",
    title: "Warehouse data and analytics",
    module: "warehouse",
    route: "/warehouse/data",
    purpose:
      "Explains operational metrics and provides governed analytical views and exports for authorized users.",
    reads:
      "Inventory, movement, event, receipt, utilization, exception, and metric-definition datasets.",
    writes:
      "No operational data changes; governed export requests may record actor, scope, and time.",
    statuses:
      "Loading, ready, filtered, empty, export preparing, exported, or failed.",
    exception:
      "Do not combine or redistribute exports beyond the approved purpose; report undefined metrics to the owner.",
    completionEvidence:
      "The view or export identifies metric definition, period, scope, generation time, and source context.",
  },
  {
    id: "warehouse-reports",
    title: "Inventory reports",
    module: "warehouse",
    route: "/warehouse/reports",
    purpose:
      "Produces committed inventory-position reports with explicit scope, definitions, and governed export controls.",
    reads:
      "Committed stock positions, reservations, valuation, receipts, movements, and report definitions.",
    writes:
      "Creates a governed report artifact and export audit event; source inventory remains unchanged.",
    statuses:
      "Preparing, ready, empty, exported, expired, or generation failed.",
    exception:
      "Regenerate rather than editing exported totals and escalate source discrepancies to the owning workflow.",
    completionEvidence:
      "Report title, filters, as-of time, row count, actor, and export reference accompany the artifact.",
  },
  {
    id: "warehouse-suppliers",
    title: "Warehouse suppliers",
    module: "warehouse",
    route: "/warehouse/suppliers",
    purpose:
      "Reviews supplier master, product associations, lead times, and supply performance used in warehouse planning.",
    reads:
      "Vendors, accreditation summary, supplier-product links, lead times, purchase orders, and receipt performance.",
    writes:
      "Adds, updates, or removes warehouse supplier records through repository methods; it does not change Legal accreditation.",
    statuses:
      "Active, inactive, accredited, conditional, expired, blocked, or data incomplete.",
    exception:
      "Do not select or promise business to a blocked, expired, duplicate, or unverified supplier.",
    completionEvidence:
      "Supplier identity, accreditation state, planning parameters, and source records agree.",
  },
  {
    id: "warehouse-locations",
    title: "Warehouse locations",
    module: "warehouse",
    route: "/warehouse/locations",
    purpose:
      "Maintains warehouse sites and event locations used by custody, movement, and reporting workflows.",
    reads:
      "Warehouse and event location master, usage, active routes, and stock occupancy summary.",
    writes:
      "Adds, updates, or removes warehouse and event-location records through repository methods without moving stock.",
    statuses:
      "Active, inactive, warehouse, event site, in use, or configuration conflict.",
    exception:
      "Do not deactivate a location with stock, open events, or active routes until those dependencies are resolved.",
    completionEvidence:
      "The unique location appears with intended type and status and is available only to valid workflows.",
  },
  {
    id: "warehouse-imports",
    title: "Warehouse imports",
    module: "warehouse",
    route: "/warehouse/imports",
    purpose:
      "Loads controlled master data or opening balances through preview, validation, confirmation, and auditable execution.",
    reads:
      "Import schema, existing products and locations, validation rules, and prior import jobs.",
    writes:
      "Creates validated master or opening-balance records and an immutable import job and error log.",
    statuses:
      "Selected, parsing, preview, invalid, ready, importing, complete, partial failure, or failed.",
    exception:
      "Correct the source file and start a new job; never rerun an uncertain import without checking its job result.",
    completionEvidence:
      "Job ID, file hash, actor, row counts, validation errors, created records, and completion time are retained.",
  },
  {
    id: "warehouse-operation-routes",
    title: "Warehouse operation routes",
    module: "warehouse",
    route: "/warehouse/operation-routes",
    purpose:
      "Configures allowed stock movements, evidence requirements, approvals, and online-only safeguards between states and locations.",
    reads:
      "Locations, storage restrictions, operation types, active routes, and route usage.",
    writes:
      "Creates or revises operation-route policy used by future warehouse commands.",
    statuses:
      "Draft, active, inactive, blocked, evidence required, approval required, or online only.",
    exception:
      "Do not create a route that bypasses quarantine, segregation, named approval, or traceability controls.",
    completionEvidence:
      "The active route displays source, destination, operation, safeguards, actor, and review context.",
  },

  {
    id: "procurement-requests",
    title: "Purchase requests",
    module: "procurement",
    route: "/procurement",
    purpose:
      "Lists governed purchase requests and exposes their owner, value, sourcing route, approval stage, and next action.",
    reads:
      "Purchase requests, totals, owners, sourcing classification, approval progress, and vendor context.",
    writes:
      "No request changes from the list; authorized users navigate to create or detail controls.",
    statuses:
      "Draft, submitted, in review, approved, rejected, cancelled, converted to PO, or empty.",
    exception:
      "Refresh before opening a request whose status changed and escalate access that exceeds business responsibility.",
    completionEvidence:
      "The selected request opens with current status, owner, value, route, and activity history.",
  },
  {
    id: "procurement-request-create",
    title: "Create purchase request",
    module: "procurement",
    route: "/procurement/requests/new",
    roleIds: [
      "procurement_requester",
      "procurement_officer",
      "procurement_admin",
    ],
    purpose:
      "Captures a complete business need, line value, sourcing facts, justification, and evidence for governed review.",
    reads:
      "Categories, policy thresholds, DOA preview, vendor accreditation context, and attachment rules.",
    writes:
      "Creates a draft purchase request and, on submit, freezes a governed snapshot and approval route.",
    statuses:
      "Draft, validation failed, route preview, submitted, attachment failed, or save failed.",
    exception:
      "Save a draft and resolve missing budget, competition, exception basis, evidence, or approver coverage before submit.",
    completionEvidence:
      "Request number, submitted snapshot, line total, sourcing route, evidence, and first approval step are visible.",
  },
  {
    id: "procurement-request-detail",
    title: "Purchase request detail",
    module: "procurement",
    route: "/procurement/requests/:id",
    roleIds: [
      "procurement_requester",
      "procurement_officer",
      "procurement_approver",
      "procurement_finance",
      "procurement_admin",
      "legal_reviewer",
      "legal_compliance",
      "legal_admin",
    ],
    purpose:
      "Presents the authoritative request snapshot, sourcing work, approvals, evidence, comments, and resulting award or PO readiness.",
    reads:
      "Request snapshot, lines, route, approvals, vendors, accreditation, attachments, comments, and activity.",
    writes:
      "Authorized actions update sourcing artifacts, comments, approval decisions, award, or eligible conversion state.",
    statuses:
      "Draft, submitted, sourcing, awaiting approval, returned, approved, rejected, awarded, or converted.",
    exception:
      "Do not decide stale, incomplete, unassigned, conflicted, or out-of-authority requests; refresh and escalate.",
    completionEvidence:
      "Every material action shows named actor, reason, time, evidence, policy route, and resulting status.",
  },
  {
    id: "procurement-approvals",
    title: "Procurement approval inbox",
    module: "procurement",
    route: "/procurement/approvals",
    roleIds: [
      "procurement_officer",
      "procurement_approver",
      "procurement_finance",
      "procurement_admin",
      "legal_reviewer",
      "legal_compliance",
      "legal_admin",
    ],
    purpose:
      "Shows named approval steps assigned to the current user or eligible policy tier for a controlled decision.",
    reads:
      "Assigned steps, request snapshots, sourcing evidence, accreditation, amount, DOA authority, and prior decisions.",
    writes:
      "Records approve, reject, or return decisions and advances only the governed next tier.",
    statuses:
      "Pending, due, overdue, approved, rejected, returned, skipped by policy, or stale.",
    exception:
      "Abstain for conflict, missing authority, incomplete evidence, or stale assignment and escalate to the process owner.",
    completionEvidence:
      "The inbox item clears and decision history records tier, named actor, reason, time, and next state.",
  },
  {
    id: "procurement-purchase-orders",
    title: "Procurement purchase orders",
    module: "procurement",
    route: "/procurement/purchase-orders",
    roleIds: [
      "procurement_officer",
      "procurement_approver",
      "procurement_finance",
      "procurement_admin",
    ],
    purpose:
      "Lists controlled purchase orders created from approved requests and tracks issue, receipt, and payment-readiness progress.",
    reads:
      "Purchase orders, source requests, vendors, accreditation, receipts, acceptance, invoice, and payment controls.",
    writes:
      "No order changes from the list; authorized users open an order to perform governed actions.",
    statuses:
      "Draft, approval ready, approved, issued, partial receipt, received, accepted, payment ready, or cancelled.",
    exception:
      "Stop when source approval, vendor eligibility, amounts, or receipt evidence do not reconcile.",
    completionEvidence:
      "The selected PO opens with source request, supplier, value, status, receipt, acceptance, and finance trail.",
  },
  {
    id: "procurement-po-detail",
    title: "Purchase order detail",
    module: "procurement",
    route: "/procurement/purchase-orders/:id",
    roleIds: [
      "procurement_requester",
      "procurement_officer",
      "procurement_approver",
      "procurement_finance",
      "procurement_admin",
    ],
    purpose:
      "Authors and controls one purchase order from approved demand through supplier issue and payment readiness.",
    reads:
      "PO, request, award, vendor, accreditation, receipts, inspections, acceptance, invoice, and decision history.",
    writes:
      "Updates draft terms and records approval, issue, receipt linkage, acceptance, and payment-readiness evidence.",
    statuses:
      "Draft, blocked, approved, issued, partially received, received, accepted, disputed, payment ready, or cancelled.",
    exception:
      "Do not issue or mark ready when accreditation, approval, receipt, inspection, acceptance, invoice, or amount match fails.",
    completionEvidence:
      "Controlled PO, issue record, three-way evidence, named actions, and final readiness or exception status are linked.",
  },

  {
    id: "legal-cases",
    title: "Legal accreditation cases",
    module: "legal",
    route: "/legal",
    purpose:
      "Queues vendor accreditation cases by risk, owner, completeness, policy state, and required legal action.",
    reads:
      "Vendors, cases, submissions, risk facts, checklist progress, instruments, decisions, and expiry dates.",
    writes:
      "No case decision is made from the list; assignment or navigation uses governed case controls.",
    statuses:
      "Invited, in progress, submitted, under review, correction required, approved, rejected, expired, or suspended.",
    exception:
      "Investigate duplicate vendor identity or missing policy version before opening a decision path.",
    completionEvidence:
      "The selected case opens with vendor identity, current policy, status, owner, and required next action.",
  },
  {
    id: "legal-case-detail",
    title: "Legal accreditation case detail",
    module: "legal",
    route: "/legal/cases/:id",
    purpose:
      "Reviews submitted vendor facts, requirement evidence, technology qualification, instruments, decisions, and lifecycle controls.",
    reads:
      "Case snapshot, vendor, application, documents, checklist, risk, instruments, signatures, decisions, and activity.",
    writes:
      "Records evidence reviews, corrections, instruments, signatures, approval or rejection, and lifecycle events.",
    statuses:
      "Submitted, reviewing, correction required, instrument pending, approval ready, approved, rejected, expired, or suspended.",
    exception:
      "Do not approve missing, expired, inconsistent, unverifiable, or unauthorized evidence; return or reject with reason.",
    completionEvidence:
      "Policy version, complete checklist, reviewed evidence, signed instruments, named decision, reason, and lifecycle status are retained.",
  },
  {
    id: "legal-case-application",
    title: "Legal vendor application review",
    module: "legal",
    route: "/legal/cases/:id/application",
    purpose:
      "Displays the vendor-submitted application snapshot exactly as Legal must assess it against current requirements.",
    reads:
      "Submitted company, ownership, regulatory, service, technology, privacy, risk, and declaration facts.",
    writes:
      "The internal application view performs no write; corrections and reviewer decisions are recorded only from case detail controls.",
    statuses:
      "Not started, in progress, submitted, superseded snapshot, correction required, or accepted for review.",
    exception:
      "Treat inconsistent or unreadable facts as review issues and preserve the original submission snapshot.",
    completionEvidence:
      "The reviewed snapshot identifies submission time, policy version, declarations, evidence, and linked review outcome.",
  },
  {
    id: "legal-sign-instrument",
    title: "Legal instrument signature",
    module: "legal",
    route: "/legal/cases/:id/sign/:code",
    purpose:
      "Presents a controlled legal instrument and records an authorized signature against its immutable content hash.",
    reads:
      "Instrument text, version, hash, case parties, signature state, and signer profile.",
    writes:
      "Creates an immutable signature event and advances the instrument only when all required parties complete.",
    statuses:
      "Prepared, awaiting vendor, awaiting Mwell, fully executed, declined, expired, or invalidated.",
    exception:
      "Do not sign changed, expired, wrong-party, or unauthorized content; return to the case and regenerate correctly.",
    completionEvidence:
      "Executed instrument shows content hash, version, signer identities, capacities, timestamps, and final state.",
  },
  {
    id: "legal-invite-vendor",
    title: "Invite vendor",
    module: "legal",
    route: "/legal/invites/new",
    purpose:
      "Creates a vendor identity, accreditation case, and secure invitation from verified onboarding facts.",
    reads:
      "Existing profiles, vendors, categories, requirement policy, duplicate checks, and invitation configuration.",
    writes:
      "Creates vendor, case, vendor-profile link, and invitation audit records through the governed API.",
    statuses:
      "Ready, validating, sending, invited, duplicate blocked, delivery failed, or creation failed.",
    exception:
      "Stop for employee email, duplicate vendor, uncertain legal entity, or missing risk facts and correct the source data.",
    completionEvidence:
      "Vendor ID, case ID, invitation recipient, policy version, actor, and delivery result are recorded.",
  },

  {
    id: "vendor-cases",
    title: "Vendor portal cases",
    module: "vendor",
    route: "/vendor",
    roleIds: ["vendor_portal"],
    purpose:
      "Shows an enrolled vendor only its own accreditation case, required actions, documents, instruments, and status.",
    reads:
      "Vendor-scoped cases, requirements, submissions, corrections, documents, instruments, and decisions.",
    writes:
      "No case decision is made from the list; the vendor opens the assigned application, upload, or signature action.",
    statuses:
      "Invited, in progress, submitted, correction required, under review, approved, rejected, expired, or suspended.",
    exception:
      "Sign out and contact the Mwell account manager if the company or case shown is not the vendor's own.",
    completionEvidence:
      "The vendor sees its case status and opens the exact outstanding action without access to another vendor.",
  },
  {
    id: "vendor-case-detail",
    title: "Vendor portal case detail",
    module: "vendor",
    route: "/vendor/cases/:id",
    roleIds: ["vendor_portal"],
    purpose:
      "Guides the vendor through its own evidence, correction, declaration, instrument, and submission obligations.",
    reads:
      "Vendor-scoped case, application, checklist, documents, corrections, instruments, and decision status.",
    writes:
      "Uploads vendor evidence, updates draft responses, acknowledges declarations, and submits the governed application snapshot.",
    statuses:
      "Draft, incomplete, ready to submit, submitted, correction required, under review, approved, or rejected.",
    exception:
      "Do not upload secrets or another company's documents; replace invalid files and contact Legal for incorrect requirements.",
    completionEvidence:
      "Every requirement shows evidence or explanation and submission records snapshot, declaration, actor, and time.",
  },
  {
    id: "vendor-application",
    title: "Vendor application",
    module: "vendor",
    route: "/vendor/cases/:id/application",
    roleIds: ["vendor_portal"],
    purpose:
      "Captures the vendor's company, ownership, regulatory, service, technology, privacy, risk, and declaration facts.",
    reads:
      "Vendor-scoped draft, applicable requirement policy, prior corrections, and saved evidence references.",
    writes:
      "Saves vendor-scoped draft answers and creates an immutable submitted snapshot when all gates pass.",
    statuses:
      "Not started, draft, incomplete, ready, submitting, submitted, correction required, or save failed.",
    exception:
      "Preserve truthful facts, explain unavailable evidence, and ask Legal to correct an inapplicable or erroneous requirement.",
    completionEvidence:
      "Submitted snapshot contains policy version, all required facts, declarations, evidence links, vendor actor, and time.",
  },
  {
    id: "vendor-sign-instrument",
    title: "Vendor instrument signature",
    module: "vendor",
    route: "/vendor/cases/:id/sign/:code",
    roleIds: ["vendor_portal"],
    purpose:
      "Lets an authorized vendor representative review and sign the exact instrument assigned to its own case.",
    reads:
      "Vendor-scoped instrument text, version, hash, parties, and signature status.",
    writes:
      "Records the vendor representative's immutable signature event against the displayed instrument hash.",
    statuses:
      "Awaiting vendor, signed by vendor, awaiting Mwell, fully executed, declined, expired, or invalidated.",
    exception:
      "Do not sign under the wrong company or capacity, or after content changes; contact Legal to regenerate.",
    completionEvidence:
      "Signature record shows vendor signer, capacity, exact hash, version, timestamp, and resulting state.",
  },
  {
    id: "vendor-invite-unavailable",
    title: "Vendor invite route protection",
    module: "vendor",
    route: "/vendor/invites/new",
    roleIds: ["vendor_portal"],
    purpose:
      "Protects the internally mounted invitation route from being used by an external vendor account.",
    reads: "Current profile kind, vendor role, and route access decision.",
    writes:
      "No vendor, case, profile, or invitation record is created from the protected vendor route.",
    statuses:
      "Authenticated vendor, access denied, redirected to own case, or signed out.",
    exception:
      "Return to the vendor case or contact the Mwell account manager when onboarding assistance is required.",
    completionEvidence:
      "The vendor remains unable to create invitations and no invitation audit event exists.",
  },
];

interface RoadmapFeatureDefinition {
  id: string;
  title: string;
  module: KnowledgeModule;
  purpose: string;
  roleIds: string[];
  owner: string;
  plannedControl: string;
}

const roadmapDefinitions: RoadmapFeatureDefinition[] = [
  {
    id: "cms",
    title: "Admin article drafting and publishing",
    module: "admin",
    purpose:
      "Department-owned review, approval, effective dating, and version history.",
    roleIds: ["platform_admin"],
    owner: "Platform",
    plannedControl: "Draft and publish governed article revisions",
  },
  {
    id: "context",
    title: "Contextual in-screen help",
    module: "core",
    purpose:
      "Open the exact procedure from the operational control being used.",
    roleIds: ["core_staff_only", "platform_admin"],
    owner: "Platform",
    plannedControl: "Open guidance for the current control",
  },
  {
    id: "analytics",
    title: "Knowledge search analytics",
    module: "admin",
    purpose:
      "Identify unsuccessful searches and documentation gaps without storing sensitive query data.",
    roleIds: ["platform_admin"],
    owner: "Platform",
    plannedControl: "Review privacy-safe search gap metrics",
  },
  {
    id: "feedback",
    title: "Article correction requests",
    module: "core",
    purpose:
      "Let authenticated users report unclear or outdated guidance to its owner.",
    roleIds: ["core_staff_only", "platform_admin"],
    owner: "Platform",
    plannedControl: "Submit an attributable correction request",
  },
  {
    id: "traceability",
    title: "Policy-to-procedure traceability",
    module: "admin",
    purpose: "Show which policy clause governs each workflow control.",
    roleIds: ["platform_admin"],
    owner: "Platform",
    plannedControl: "Link a governed policy clause to a control",
  },
  {
    id: "walkthrough",
    title: "Guided sandbox walkthroughs",
    module: "core",
    purpose: "Practice workflows with disposable data and progress checks.",
    roleIds: ["core_staff_only", "platform_admin"],
    owner: "Platform",
    plannedControl: "Start a disposable guided practice session",
  },
  {
    id: "language",
    title: "Multilingual documentation",
    module: "admin",
    purpose: "Publish governed translations with the same effective version.",
    roleIds: ["platform_admin"],
    owner: "Platform",
    plannedControl: "Review and publish a version-matched translation",
  },
  {
    id: "offline",
    title: "Offline Knowledge Base",
    module: "core",
    purpose: "Precache approved guidance for resilient warehouse access.",
    roleIds: ["core_staff_only", "platform_admin"],
    owner: "Platform",
    plannedControl: "Make approved guidance available offline",
  },
  {
    id: "learning",
    title: "Role onboarding curricula",
    module: "admin",
    purpose: "Assign role-specific learning paths and completion records.",
    roleIds: ["platform_admin"],
    owner: "Platform",
    plannedControl: "Assign a governed role curriculum",
  },
  {
    id: "release",
    title: "Workflow-linked release notes",
    module: "core",
    purpose: "Explain changed screens and procedures after each release.",
    roleIds: ["core_staff_only", "platform_admin"],
    owner: "Platform",
    plannedControl: "Open release guidance for a changed workflow",
  },
];

const defineRoadmapFeature = (
  definition: RoadmapFeatureDefinition,
): KnowledgeFeature => {
  const relationship = FEATURE_RELATIONSHIPS[definition.id];
  if (!relationship)
    throw new Error(
      `missing explicit feature relationship for ${definition.id}`,
    );
  return {
    id: definition.id,
    title: definition.title,
    module: definition.module,
    availability: "coming_soon",
    routes: [],
    roleIds: definition.roleIds,
    capabilityIds: [],
    purpose: definition.purpose,
    policyBasis: relationship.policyBasis,
    relatedFlowIds: relationship.relatedFlowIds,
    controls: [
      {
        name: definition.plannedControl,
        behavior: `Planned behavior: ${definition.purpose}`,
        validation:
          "Unavailable until the roadmap feature, RBAC scope, data contract, and release approval are complete.",
        result: "No live action occurs while this feature remains coming soon.",
      },
    ],
    fields: [],
    reads: ["Approved roadmap scope and future governance requirements."],
    writes: ["No live record is written while this feature is coming soon."],
    statuses: ["Proposed, planned, in progress, or released."],
    notifications: ["No live notification is emitted."],
    exceptions: [
      "Use the current handbook and escalate the unmet need to the feature owner.",
    ],
    completionEvidence: [
      "A future release record must identify the approved route, RBAC, data, test, and owner contracts.",
    ],
    owner: definition.owner,
    reviewedAt: "2026-07-12",
  };
};

export const ROADMAP_KNOWLEDGE_FEATURES =
  roadmapDefinitions.map(defineRoadmapFeature);

export const KNOWLEDGE_FEATURES: KnowledgeFeature[] = [
  ...definitions.map(defineFeature),
  ...ROADMAP_KNOWLEDGE_FEATURES,
];
