import { KNOWLEDGE_ROLES } from "./roles";
import type { KnowledgeFeature, KnowledgeModule } from "./types";

interface FeatureDefinition {
  id: string;
  title: string;
  module: KnowledgeModule;
  route: string;
  capabilityIds: string[];
  purpose: string;
  field: string;
  fieldRequired?: boolean;
  validation: string;
  reads: string;
  writes: string;
  statuses: string;
  notification: string;
  exception: string;
  completionEvidence: string;
  control?: string;
  behavior?: string;
  roleIds?: string[];
}

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

const defineFeature = (definition: FeatureDefinition): KnowledgeFeature => ({
  id: definition.id,
  title: definition.title,
  module: definition.module,
  availability: "live",
  routes: [definition.route],
  roleIds:
    definition.roleIds ?? rolesFor(definition.module, definition.capabilityIds),
  capabilityIds: definition.capabilityIds,
  purpose: definition.purpose,
  controls: [
    {
      name: definition.control ?? definition.title,
      behavior:
        definition.behavior ??
        `Use the ${definition.title.toLowerCase()} controls only for the governed record shown on this page.`,
      validation: definition.validation,
      result: definition.completionEvidence,
    },
  ],
  fields: [
    {
      name: definition.field,
      purpose: `Identifies or refines the ${definition.title.toLowerCase()} record being handled.`,
      required: definition.fieldRequired ?? false,
      validation: definition.validation,
    },
  ],
  reads: [definition.reads],
  writes: [definition.writes],
  statuses: [definition.statuses],
  notifications: [definition.notification],
  exceptions: [definition.exception],
  completionEvidence: [definition.completionEvidence],
  owner: ownerFor[definition.module],
  reviewedAt: "2026-07-12",
});

const definitions: FeatureDefinition[] = [
  {
    id: "shell-home",
    title: "Intra home",
    module: "core",
    route: "/",
    capabilityIds: [
      "view_directory",
      "view_vendors",
      "view_documents",
      "view_approvals",
      "manage_notifications",
    ],
    roleIds: ["core_staff_only", "platform_admin"],
    purpose:
      "Shows an authenticated employee the modules and shared work areas available through current role assignments.",
    field: "Module and command search",
    validation:
      "Only destinations authorized by the signed-in profile are shown or opened.",
    reads:
      "Current profile, role assignments, module navigation, and unread notification summaries.",
    writes:
      "No operational record is changed; opening a destination changes navigation state only.",
    statuses:
      "Signed out, loading, authorized, partially authorized, or access denied.",
    notification:
      "The notification bell shows unread work items and records when an item is marked read.",
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
    capabilityIds: [],
    roleIds: ["core_staff_only", "platform_admin", "vendor_portal"],
    purpose:
      "Creates a secure employee or vendor session and returns the user to an approved destination.",
    field: "Email and password",
    fieldRequired: true,
    validation:
      "Email must be assigned to the account, password must be present, and the return path must be local.",
    reads:
      "Authentication configuration, requested return path, and the identity returned by the provider.",
    writes:
      "Creates an authenticated session; it does not change business records or role assignments.",
    statuses:
      "Preparing, signed out, authenticating, authenticated, or authentication failed.",
    notification:
      "Inline status reports invalid credentials; successful sign-in redirects without sending a business notification.",
    exception:
      "Use password recovery for forgotten credentials and contact Platform for an inactive or incorrectly typed account.",
    completionEvidence:
      "The user reaches the approved home or deep-linked page with the correct profile visible.",
    control: "Sign in button",
    behavior:
      "Submits credentials once and prevents duplicate submission while authentication is in progress.",
  },
  {
    id: "reset-password",
    title: "Password reset",
    module: "core",
    route: "/reset-password",
    capabilityIds: [],
    roleIds: ["core_staff_only", "platform_admin", "vendor_portal"],
    purpose:
      "Lets a user with a valid recovery session replace a forgotten password and resume approved work.",
    field: "New password and confirmation",
    fieldRequired: true,
    validation:
      "Both values are required, must match, and the authentication provider enforces the minimum password policy.",
    reads: "Recovery session, safe local return path, and authentication mode.",
    writes:
      "Replaces the authenticated account password; no operational data is changed.",
    statuses:
      "Preparing, unavailable in preview, ready, updating, complete, or failed.",
    notification:
      "Inline success confirms the update before redirect; provider errors remain visible without exposing secrets.",
    exception:
      "Request a new recovery link if the session expired; preview mode cannot change passwords.",
    completionEvidence:
      "Password updated is shown and the user is redirected to the safe requested page.",
    control: "Update password button",
  },
  {
    id: "knowledge-library",
    title: "Knowledge Base",
    module: "core",
    route: "/knowledge",
    capabilityIds: [],
    roleIds: CURRENT_ROLE_IDS,
    purpose:
      "Provides searchable role guidance, feature references, workflows, glossary definitions, and governed future recommendations.",
    field: "Search, role, module, and content-type filters",
    validation:
      "Filters accept known registry values and documentation links never grant operational permissions.",
    reads:
      "Governed knowledge content, route filters, workflow graph, and reviewed evidence metadata.",
    writes:
      "No business data is changed; query parameters preserve the selected documentation view.",
    statuses:
      "Library, search results, article detail, workflow detail, glossary detail, or no results.",
    notification:
      "No operational notification is sent; missing results are reported inline as a documentation state.",
    exception:
      "Clear filters or search a plain-language synonym when no result appears; escalate stale guidance to its owner.",
    completionEvidence:
      "The relevant article or workflow opens with owner, review date, route, and completion guidance.",
    control: "Knowledge search and filters",
  },
  {
    id: "offline-status",
    title: "Offline status",
    module: "core",
    route: "/~offline",
    capabilityIds: [],
    roleIds: CURRENT_ROLE_IDS,
    purpose:
      "Explains that the shell cannot load live data while disconnected and protects users from assuming a transaction completed.",
    field: "Network connection",
    validation:
      "The page is shown only when navigation cannot reach the live application through the service worker.",
    reads: "Browser connectivity and service-worker fallback state.",
    writes:
      "No record is written; queued warehouse commands remain in their existing outbox state.",
    statuses:
      "Offline, reconnecting through the browser, or online after a fresh navigation.",
    notification:
      "The page itself sends no notification; normal synchronization feedback resumes after reconnection.",
    exception:
      "Do not repeat uncertain transactions; reconnect, open the record, and verify activity before retrying.",
    completionEvidence:
      "A fresh navigation loads the live page and any queued command shows an explicit synchronized outcome.",
    control: "Browser reconnect and reload",
  },
  {
    id: "admin-users",
    title: "User and role administration",
    module: "admin",
    route: "/admin/users",
    capabilityIds: [
      "manage_rbac",
      "view_audit",
      "manage_approvals",
      "record_approval",
    ],
    roleIds: ["platform_admin"],
    purpose:
      "Allows the platform administrator to review profiles and assign the minimum approved module roles.",
    field: "Profile search and role checkboxes",
    validation:
      "Only known roles may be assigned, vendor and employee boundaries remain enforced, and self-lockout is blocked.",
    reads:
      "Core profiles, active role assignments, module role definitions, and role-change audit history.",
    writes:
      "Adds or removes scoped role assignments through the governed administration service.",
    statuses:
      "Loading, ready, role change pending, saved, failed, active profile, or inactive profile.",
    notification:
      "Success or failure is shown after each assignment change; the affected user verifies access in a new session.",
    exception:
      "Stop if identity kind or approved responsibility is unclear and obtain authorization before changing access.",
    completionEvidence:
      "The intended role appears on the profile and the audit record identifies actor, target, scope, and time.",
    control: "Role assignment checkbox",
  },
  {
    id: "admin-doa",
    title: "Delegation of Authority administration",
    module: "admin",
    route: "/admin/doa",
    capabilityIds: ["manage_doa"],
    roleIds: ["platform_admin", "legal_admin"],
    purpose:
      "Creates immutable department approval-matrix revisions and deliberately activates a validated version.",
    field:
      "Department, version, source, effective date, tiers, thresholds, and named approvers",
    fieldRequired: true,
    validation:
      "Department and version are required, every row needs an approver, and at least one final approver is mandatory.",
    reads:
      "DOA matrices, active assignments, and active employee profiles eligible for named authority.",
    writes:
      "Saves a new draft matrix or activates it while superseding the previous active revision.",
    statuses:
      "Draft, active, superseded, expired, loading revision, saving, or validation failed.",
    notification:
      "Toasts confirm draft save, revision load, activation, or exact database failure.",
    exception:
      "Preview mode is read-only; resolve threshold gaps, missing owners, and ambiguous source authority before activation.",
    completionEvidence:
      "The department card shows the intended version as active and the previous version as superseded.",
    control: "Save draft, create revision, and activate",
  },

  {
    id: "warehouse-dashboard",
    title: "Warehouse dashboard",
    module: "warehouse",
    route: "/warehouse",
    capabilityIds: ["view_dashboard"],
    purpose:
      "Summarizes inventory health, urgent controls, utilization, and operational work requiring attention.",
    field: "Warehouse and period filters",
    validation:
      "Only warehouses and periods visible to the current role may be selected.",
    reads:
      "Stock balances, alerts, tasks, receipts, events, and utilization aggregates.",
    writes:
      "No operational record changes; selected dashboard filters remain local view state.",
    statuses:
      "Loading, current, warning, critical, empty, or data unavailable.",
    notification:
      "Alert cards and the module notification feed surface assigned or overdue work.",
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
    capabilityIds: [
      "receive_stock",
      "issue_items",
      "manage_returns",
      "cycle_count",
      "transfer_stock",
    ],
    purpose:
      "Starts an authorized stock operation from a scanned barcode while preserving product and custody identity.",
    field: "Barcode, scan mode, quantity, and destination",
    validation:
      "Barcode must resolve uniquely and the selected operation must be permitted for the role and route.",
    reads:
      "Product, lot or serial, bin, operation-route, and outstanding work context.",
    writes:
      "Routes the resolved identity into receiving, issue, return, count, transfer, or product detail workflows.",
    statuses:
      "Camera unavailable, scanning, resolved, ambiguous, not found, or operation blocked.",
    notification:
      "Inline scan feedback confirms resolution or explains why the code cannot proceed.",
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
    capabilityIds: ["inspect_quality", "view_exceptions", "cycle_count"],
    purpose:
      "Combines due, blocked, and completed warehouse control work into one actionable queue.",
    field: "Task state, type, due date, and assignee filters",
    validation:
      "Only tasks within the current capability scope are displayed or opened.",
    reads:
      "Quality inspections, exceptions, cycle counts, due dates, assignment, and completion activity.",
    writes:
      "No task is completed from the list; opening a row navigates to its governed action page.",
    statuses: "Due, overdue, blocked, completed, empty, or unavailable.",
    notification:
      "Assigned and overdue tasks may also appear in the notification feed; list filters send no notification.",
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
    capabilityIds: ["manage_inventory", "manage_products"],
    purpose:
      "Finds stock-keeping units and compares available, reserved, held, and location-level balances.",
    field: "Search, category, warehouse, stock state, and sort",
    validation:
      "Quantities are read from the ledger and filters do not permit negative or unauthorized adjustments.",
    reads:
      "Products, units, lots, serials, stock levels, reservations, holds, and locations.",
    writes:
      "Authorized product edits may update master data; balance changes require a separate governed stock command.",
    statuses:
      "Available, reserved, held, low stock, out of stock, inactive, or loading.",
    notification:
      "Product-save feedback is shown inline; browsing and filtering send no notification.",
    exception:
      "Investigate the ledger and source transaction rather than directly editing a disputed balance.",
    completionEvidence:
      "The selected product shows a traceable balance and opens its detail record.",
  },
  {
    id: "warehouse-product-detail",
    title: "Product detail",
    module: "warehouse",
    route: "/warehouse/inventory/:id",
    capabilityIds: ["manage_inventory", "manage_products"],
    purpose:
      "Explains one product's master data, stock positions, traceability records, and recent movement history.",
    field: "Product identity and editable master-data fields",
    validation:
      "The route identifier must resolve and editable codes, units, and tracking rules must remain unique and valid.",
    reads:
      "Product master, warehouse balances, bins, lots, serials, valuation context, and movement history.",
    writes:
      "Authorized users update product master data; stock quantity remains ledger-controlled.",
    statuses:
      "Active, inactive, tracked by lot, tracked by serial, available, held, or not found.",
    notification:
      "A save toast confirms master-data changes; read-only inspection sends no notification.",
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
    capabilityIds: ["receive_stock"],
    purpose:
      "Receives approved purchase-order quantities with traceability, evidence, inspection routing, and destination control.",
    field:
      "PO, product, quantity, lot or serial, expiry, evidence, and destination bin",
    fieldRequired: true,
    validation:
      "Quantity cannot exceed receivable balance; traceability and valid destination are required when configured.",
    reads:
      "Approved purchase orders, remaining lines, products, suppliers, warehouses, bins, and operation routes.",
    writes:
      "Creates receipt, unit or lot, evidence, movement, stock-ledger, and quality-control records atomically.",
    statuses:
      "Receivable, partial, complete, pending inspection, held, rejected, or failed.",
    notification:
      "Success confirms the receipt; holds and failures notify the responsible warehouse control queue.",
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
    capabilityIds: ["reserve_allocate", "issue_items"],
    purpose:
      "Reserves available stock for approved demand and records custody when items are issued.",
    field: "Event, product, quantity, source, recipient, and evidence",
    fieldRequired: true,
    validation:
      "Requested quantity must be positive and no greater than available stock for the chosen source.",
    reads:
      "Events, demand lines, stock availability, existing reservations, recipients, and custody history.",
    writes:
      "Creates or updates reservations and records governed issue movements to the named recipient.",
    statuses:
      "Requested, reserved, partially reserved, issued, cancelled, returned, or short.",
    notification:
      "Reservation or issue confirmation is shown and blocked demand appears in task or exception queues.",
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
    capabilityIds: ["manage_returns"],
    purpose:
      "Records returned custody and routes each unit to restock, hold, repair, loss, damage, or vendor return.",
    field:
      "Issue reference, product, quantity, condition, disposition, reason, and evidence",
    fieldRequired: true,
    validation:
      "Return quantity cannot exceed outstanding custody and non-restock dispositions require reason and evidence.",
    reads:
      "Open issues, event allocations, products, traceability identity, prior returns, and valid destinations.",
    writes:
      "Creates return, inspection or disposition movements and updates custody and stock according to the decision.",
    statuses:
      "Expected, received, inspected, restocked, held, damaged, lost, or returned to vendor.",
    notification:
      "Completion confirms disposition; loss, damage, or hold creates visible control work for the owner.",
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
    capabilityIds: [
      "receive_stock",
      "manage_locations",
      "transfer_stock",
      "cycle_count",
    ],
    purpose:
      "Defines scannable storage areas and bins used by receiving, transfer, counting, and putaway controls.",
    field: "Warehouse, area, bin code, purpose, restriction, and active state",
    validation:
      "Codes must be unique within the warehouse and restricted bins require compatible operation routes.",
    reads:
      "Warehouses, storage areas, bins, occupancy, restrictions, and related operation routes.",
    writes:
      "Authorized users create or update area and bin master records; stock moves use separate commands.",
    statuses:
      "Active, inactive, restricted, occupied, empty, or configuration invalid.",
    notification:
      "Save feedback confirms configuration changes; conflicts or occupied-bin deactivation are reported inline.",
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
    capabilityIds: ["reserve_allocate", "view_finance"],
    purpose:
      "Plans activation demand and summarizes inventory commitments, dates, owners, and reconciliation state.",
    field: "Event search, owner, date, site, and lifecycle filters",
    validation:
      "Dates and ownership must identify a valid event before demand or financial review proceeds.",
    reads:
      "Events, demand, reservations, issues, returns, consumption, and summarized cost.",
    writes:
      "Creates or updates authorized event planning records; stock changes occur through allocation and return commands.",
    statuses:
      "Draft, confirmed, active, reconciling, complete, cancelled, or overdue.",
    notification:
      "Event milestones and unresolved reconciliation may appear as assigned work; filtering sends no notification.",
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
    capabilityIds: ["reserve_allocate", "view_finance"],
    purpose:
      "Tracks one event from demand and reservation through issue, consumption, return, and financial reconciliation.",
    field:
      "Demand lines, requested quantity, allocation, outcome, and reconciliation notes",
    validation:
      "The event must exist and all final quantities must sum to the quantity issued before completion.",
    reads:
      "Event header, demand lines, reservations, issues, returns, outcomes, evidence, and cost summary.",
    writes:
      "Updates event demand and records authorized allocation or outcome actions through governed controls.",
    statuses:
      "Draft, confirmed, allocated, issued, reconciling, complete, cancelled, or exception.",
    notification:
      "Status changes and unresolved outcomes are surfaced to event and warehouse owners.",
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
    capabilityIds: ["view_procurement"],
    purpose:
      "Prioritizes reorder needs using availability, demand, lead time, safety stock, and supplier context.",
    field: "Warehouse, supplier, stock-risk, and planning-horizon filters",
    validation:
      "Recommendations use current stock and demand; they do not create a purchase commitment by themselves.",
    reads:
      "Stock, reorder settings, open demand, open POs, suppliers, lead times, and consumption trends.",
    writes:
      "No purchase order is written; authorized master-data changes use product or supplier controls.",
    statuses:
      "Healthy, monitor, reorder, stockout risk, inbound, or data incomplete.",
    notification:
      "Planning alerts identify urgent stock risk; filtering or export does not notify suppliers.",
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
    capabilityIds: ["view_procurement", "receive_stock"],
    purpose:
      "Shows approved supply orders and remaining quantities available for warehouse receiving.",
    field: "PO search, supplier, status, date, and receivable filter",
    validation:
      "Only approved and issued supply lines may be presented as receivable.",
    reads:
      "Purchase orders, suppliers, lines, ordered and received quantities, expected dates, and linked receipts.",
    writes:
      "No PO is authored here; selecting a receivable order opens the governed receiving flow.",
    statuses:
      "Draft, approved, issued, partially received, received, cancelled, or overdue.",
    notification:
      "Overdue and newly receivable orders may appear in warehouse work queues; list filters send none.",
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
    capabilityIds: ["cycle_count"],
    purpose:
      "Captures a physical bin count, calculates variance, and routes material adjustments for approval.",
    field:
      "Warehouse, bin, count scope, physical quantity, reason, and evidence",
    fieldRequired: true,
    validation:
      "Count scope must be unambiguous; physical quantity cannot be negative and variance evidence is required.",
    reads:
      "Expected bin balances, products, traceability identities, open counts, and prior adjustments.",
    writes:
      "Creates count and variance records; approved adjustments post through the stock-change workflow.",
    statuses:
      "Draft, counting, submitted, no variance, approval required, approved, posted, or rejected.",
    notification:
      "Variance requiring approval is assigned to the approver queue; posting or rejection is confirmed to the counter.",
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
    capabilityIds: ["inspect_quality", "release_quality_hold"],
    purpose:
      "Inspects received or returned stock and controls release, hold, rejection, or vendor-return disposition.",
    field: "Inspection item, result, reason, evidence, hold, and disposition",
    validation:
      "A decision requires the applicable checklist; adverse outcomes require reason and supporting evidence.",
    reads:
      "Pending inspections, receipt or return context, product rules, evidence, holds, and prior decisions.",
    writes:
      "Records inspection results and creates, releases, rejects, or routes quality-held stock.",
    statuses:
      "Pending, in inspection, accepted, held, released, rejected, or vendor return.",
    notification:
      "Holds and rejected outcomes notify the responsible control queue; successful disposition is confirmed.",
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
    capabilityIds: ["approve_stock_adjustment"],
    purpose:
      "Lets an authorized approver decide material inventory changes without allowing direct balance edits.",
    field: "Approval item, decision, reason, and supporting evidence",
    validation:
      "The item must be pending and assigned within authority; rejection or return requires a specific reason.",
    reads:
      "Proposed stock changes, variance value, source count or exception, evidence, and prior decisions.",
    writes:
      "Records approve, reject, or return decisions and posts only eligible approved adjustments.",
    statuses:
      "Pending, approved, rejected, returned for revision, posted, or stale.",
    notification:
      "The requester receives the decision and posted adjustments appear in the warehouse activity stream.",
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
    capabilityIds: ["view_exceptions", "resolve_exceptions"],
    purpose:
      "Investigates operational failures and records a controlled resolution without hiding the original event.",
    field: "Exception type, owner, severity, resolution, reason, and evidence",
    validation:
      "Closure requires an authorized resolver, a concrete disposition, and evidence for material exceptions.",
    reads:
      "Failed commands, stock discrepancies, blocked routes, related records, retries, and activity history.",
    writes:
      "Assigns, annotates, resolves, or escalates exception records; source records change only through governed commands.",
    statuses:
      "Open, assigned, investigating, blocked, resolved, escalated, or reopened.",
    notification:
      "Assignment, escalation, and resolution notify the responsible operational owner.",
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
    capabilityIds: ["view_finance"],
    purpose:
      "Reviews inventory valuation, receipt costing, reconciliation, write-offs, and asset-register context.",
    field:
      "Warehouse, valuation date, product, category, and reconciliation filter",
    validation:
      "Financial values derive from posted ledger events and the selected valuation period cannot be ambiguous.",
    reads:
      "Stock ledger, landed cost, receipts, adjustments, write-offs, assets, and reconciliation aggregates.",
    writes:
      "No ledger entry is created from this analytical page; exports record governed download activity where enabled.",
    statuses:
      "Current, unreconciled, variance, pending cost, written off, exported, or data unavailable.",
    notification:
      "Material variance remains visible in control queues; viewing analysis sends no notification.",
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
    capabilityIds: ["view_pricing", "set_pricing"],
    purpose:
      "Reviews landed cost and margin context and governs authorized product price changes.",
    field: "Product, proposed price, effective date, and change reason",
    validation:
      "Price must be non-negative, effective date valid, and change reason present before an authorized save.",
    reads:
      "Products, current and prior prices, landed cost, valuation, turnover, and margin context.",
    writes:
      "Authorized users create a dated price revision without changing historical transactions.",
    statuses:
      "Current, proposed, scheduled, effective, superseded, or save failed.",
    notification:
      "A toast confirms the revision; failed validation or persistence is shown without altering the current price.",
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
    capabilityIds: ["view_analytics"],
    purpose:
      "Explains operational metrics and provides governed analytical views and exports for authorized users.",
    field: "Metric, warehouse, period, grouping, and export scope",
    validation:
      "Date range and scope must be valid and exported columns remain limited to the user's authorization.",
    reads:
      "Inventory, movement, event, receipt, utilization, exception, and metric-definition datasets.",
    writes:
      "No operational data changes; governed export requests may record actor, scope, and time.",
    statuses:
      "Loading, ready, filtered, empty, export preparing, exported, or failed.",
    notification:
      "Export completion or failure is shown to the requester; analytical filtering sends no notification.",
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
    capabilityIds: ["view_analytics", "view_finance"],
    purpose:
      "Produces committed inventory-position reports with explicit scope, definitions, and governed export controls.",
    field: "Report type, warehouse, as-of date, status, and format",
    validation:
      "A report type and valid as-of date are required and finance columns require finance authority.",
    reads:
      "Committed stock positions, reservations, valuation, receipts, movements, and report definitions.",
    writes:
      "Creates a governed report artifact and export audit event; source inventory remains unchanged.",
    statuses:
      "Preparing, ready, empty, exported, expired, or generation failed.",
    notification:
      "The requester sees report readiness or exact generation failure; no external recipient is contacted automatically.",
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
    capabilityIds: ["view_procurement"],
    purpose:
      "Reviews supplier master, product associations, lead times, and supply performance used in warehouse planning.",
    field: "Supplier search, accreditation, product, and lead-time filters",
    validation:
      "Supplier identity must remain linked to the governed core vendor record and current accreditation state.",
    reads:
      "Vendors, accreditation summary, supplier-product links, lead times, purchase orders, and receipt performance.",
    writes:
      "No legal accreditation changes occur here; authorized planning fields may be updated through governed controls.",
    statuses:
      "Active, inactive, accredited, conditional, expired, blocked, or data incomplete.",
    notification:
      "Accreditation or supply-risk changes may surface as planning alerts; browsing sends no notification.",
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
    capabilityIds: ["manage_locations"],
    purpose:
      "Maintains warehouse sites and event locations used by custody, movement, and reporting workflows.",
    field: "Location name, code, type, address, time zone, and active state",
    validation:
      "Location code must be unique and inactive locations cannot receive new movements.",
    reads:
      "Warehouse and event location master, usage, active routes, and stock occupancy summary.",
    writes:
      "Creates or updates location master records without moving existing stock.",
    statuses:
      "Active, inactive, warehouse, event site, in use, or configuration conflict.",
    notification:
      "Save confirmation or validation failure is shown; location changes do not notify external parties automatically.",
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
    capabilityIds: ["import_warehouse_data"],
    purpose:
      "Loads controlled master data or opening balances through preview, validation, confirmation, and auditable execution.",
    field: "Import type, CSV file, mapping, confirmation, and reason",
    validation:
      "Headers, identifiers, quantities, duplicates, and references must pass preview before execution.",
    reads:
      "Import schema, existing products and locations, validation rules, and prior import jobs.",
    writes:
      "Creates validated master or opening-balance records and an immutable import job and error log.",
    statuses:
      "Selected, parsing, preview, invalid, ready, importing, complete, partial failure, or failed.",
    notification:
      "Completion and row-level failures are reported to the importer; no supplier is contacted.",
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
    capabilityIds: ["manage_operation_routes"],
    purpose:
      "Configures allowed stock movements, evidence requirements, approvals, and online-only safeguards between states and locations.",
    field:
      "Operation, source, destination, evidence, approval, online policy, and active state",
    validation:
      "Source and destination must differ and restricted transitions must retain required evidence and approval gates.",
    reads:
      "Locations, storage restrictions, operation types, active routes, and route usage.",
    writes:
      "Creates or revises operation-route policy used by future warehouse commands.",
    statuses:
      "Draft, active, inactive, blocked, evidence required, approval required, or online only.",
    notification:
      "Save feedback confirms policy changes; affected future commands enforce the new active route immediately.",
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
    capabilityIds: ["view_dashboard"],
    purpose:
      "Lists governed purchase requests and exposes their owner, value, sourcing route, approval stage, and next action.",
    field: "Request search, status, owner, category, and date filters",
    validation:
      "The signed-in user sees only requests allowed by role and row-level policy.",
    reads:
      "Purchase requests, totals, owners, sourcing classification, approval progress, and vendor context.",
    writes:
      "No request changes from the list; authorized users navigate to create or detail controls.",
    statuses:
      "Draft, submitted, in review, approved, rejected, cancelled, converted to PO, or empty.",
    notification:
      "Assigned approval and returned requests may appear in notifications; list filtering sends none.",
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
    capabilityIds: ["create_request", "manage_rfp"],
    purpose:
      "Captures a complete business need, line value, sourcing facts, justification, and evidence for governed review.",
    field:
      "Category, title, lines, quantities, budget, required date, justification, sourcing facts, and attachments",
    fieldRequired: true,
    validation:
      "Required facts and positive line values must be complete; route-specific evidence is required before submission.",
    reads:
      "Categories, policy thresholds, DOA preview, vendor accreditation context, and attachment rules.",
    writes:
      "Creates a draft purchase request and, on submit, freezes a governed snapshot and approval route.",
    statuses:
      "Draft, validation failed, route preview, submitted, attachment failed, or save failed.",
    notification:
      "Save and submission feedback is shown; submission assigns the next governed review step.",
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
    capabilityIds: [
      "view_dashboard",
      "approve_request",
      "approve_award",
      "view_finance",
      "manage_rfp",
    ],
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
    field:
      "Request identifier, sourcing decision, evaluation, comment, attachment, and decision reason",
    validation:
      "The record must exist and each action is enabled only for the assigned role, tier, and current state.",
    reads:
      "Request snapshot, lines, route, approvals, vendors, accreditation, attachments, comments, and activity.",
    writes:
      "Authorized actions update sourcing artifacts, comments, approval decisions, award, or eligible conversion state.",
    statuses:
      "Draft, submitted, sourcing, awaiting approval, returned, approved, rejected, awarded, or converted.",
    notification:
      "Comments, assignment, return, decision, and award changes notify the next responsible participant.",
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
    capabilityIds: ["approve_request", "approve_award"],
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
    field: "Tier, request, amount, due state, decision, and reason",
    validation:
      "Only the current pending tier may decide and authority, separation, and required evidence must pass.",
    reads:
      "Assigned steps, request snapshots, sourcing evidence, accreditation, amount, DOA authority, and prior decisions.",
    writes:
      "Records approve, reject, or return decisions and advances only the governed next tier.",
    statuses:
      "Pending, due, overdue, approved, rejected, returned, skipped by policy, or stale.",
    notification:
      "The decision notifies the requester and next owner; overdue assignments remain visible in work alerts.",
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
    capabilityIds: ["author_po", "approve_award", "view_finance", "admin"],
    purpose:
      "Lists controlled purchase orders created from approved requests and tracks issue, receipt, and payment-readiness progress.",
    field:
      "PO search, supplier, status, request, issue date, and payment-readiness filter",
    validation:
      "Only approved request and accredited-vendor combinations may become issue-ready purchase orders.",
    reads:
      "Purchase orders, source requests, vendors, accreditation, receipts, acceptance, invoice, and payment controls.",
    writes:
      "No order changes from the list; authorized users open an order to perform governed actions.",
    statuses:
      "Draft, approval ready, approved, issued, partial receipt, received, accepted, payment ready, or cancelled.",
    notification:
      "Issue, receipt, acceptance, and readiness milestones notify responsible roles through governed work items.",
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
    capabilityIds: ["author_po", "approve_award", "view_finance", "admin"],
    purpose:
      "Authors and controls one purchase order from approved demand through supplier issue and payment readiness.",
    field:
      "PO terms, supplier, lines, dates, issue action, receipt match, acceptance, invoice, and finance evidence",
    validation:
      "Source approval, accredited supplier, line totals, required terms, and segregation gates must pass before issue or readiness.",
    reads:
      "PO, request, award, vendor, accreditation, receipts, inspections, acceptance, invoice, and decision history.",
    writes:
      "Updates draft terms and records approval, issue, receipt linkage, acceptance, and payment-readiness evidence.",
    statuses:
      "Draft, blocked, approved, issued, partially received, received, accepted, disputed, payment ready, or cancelled.",
    notification:
      "Issue and downstream milestones notify the responsible supplier-facing, receiving, business, and finance owners.",
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
    capabilityIds: [
      "view_dashboard",
      "review_accreditation",
      "manage_accreditation",
      "view_vendors",
    ],
    purpose:
      "Queues vendor accreditation cases by risk, owner, completeness, policy state, and required legal action.",
    field: "Case search, status, risk, category, owner, and due-state filters",
    validation:
      "Only internal Legal users may view the queue and each case remains scoped to its governed vendor.",
    reads:
      "Vendors, cases, submissions, risk facts, checklist progress, instruments, decisions, and expiry dates.",
    writes:
      "No case decision is made from the list; assignment or navigation uses governed case controls.",
    statuses:
      "Invited, in progress, submitted, under review, correction required, approved, rejected, expired, or suspended.",
    notification:
      "New submissions, corrections, expiry risk, and assigned reviews appear in Legal notifications.",
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
    capabilityIds: [
      "review_accreditation",
      "manage_checklist",
      "approve_accreditation",
      "manage_documents",
      "manage_accreditation",
      "manage_approvals",
      "record_approval",
    ],
    purpose:
      "Reviews submitted vendor facts, requirement evidence, technology qualification, instruments, decisions, and lifecycle controls.",
    field:
      "Checklist decision, correction request, risk assessment, document action, instrument, and final disposition",
    validation:
      "Every applicable requirement and instrument gate must be resolved before an authorized final decision.",
    reads:
      "Case snapshot, vendor, application, documents, checklist, risk, instruments, signatures, decisions, and activity.",
    writes:
      "Records evidence reviews, corrections, instruments, signatures, approval or rejection, and lifecycle events.",
    statuses:
      "Submitted, reviewing, correction required, instrument pending, approval ready, approved, rejected, expired, or suspended.",
    notification:
      "Correction, signature, decision, expiry, and material-change actions notify the vendor and assigned Legal owner.",
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
    capabilityIds: ["review_accreditation", "manage_checklist"],
    purpose:
      "Displays the vendor-submitted application snapshot exactly as Legal must assess it against current requirements.",
    field:
      "Application section, declared fact, evidence reference, and reviewer note",
    validation:
      "The route case must exist and submitted facts are read-only; corrections use the governed case action.",
    reads:
      "Submitted company, ownership, regulatory, service, technology, privacy, risk, and declaration facts.",
    writes:
      "No submitted fact is silently edited; reviewer notes and correction requests are recorded through case controls.",
    statuses:
      "Not started, in progress, submitted, superseded snapshot, correction required, or accepted for review.",
    notification:
      "Opening the snapshot sends none; a correction request from the case notifies the vendor.",
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
    capabilityIds: ["manage_documents", "approve_accreditation"],
    purpose:
      "Presents a controlled legal instrument and records an authorized signature against its immutable content hash.",
    field:
      "Case, instrument code, signer name, capacity, consent, and signature action",
    fieldRequired: true,
    validation:
      "Instrument, case, signer authority, content hash, and required signing order must all be valid.",
    reads:
      "Instrument text, version, hash, case parties, signature state, and signer profile.",
    writes:
      "Creates an immutable signature event and advances the instrument only when all required parties complete.",
    statuses:
      "Prepared, awaiting vendor, awaiting Mwell, fully executed, declined, expired, or invalidated.",
    notification:
      "Signature completion or decline notifies the next required party and Legal case owner.",
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
    capabilityIds: ["manage_checklist", "manage_vendors"],
    purpose:
      "Creates a vendor identity, accreditation case, and secure invitation from verified onboarding facts.",
    field:
      "Company, vendor email, category, jurisdiction, entity, risk, contract, and data-handling facts",
    fieldRequired: true,
    validation:
      "Email must be external and unique; required company and risk facts must be complete before invite.",
    reads:
      "Existing profiles, vendors, categories, requirement policy, duplicate checks, and invitation configuration.",
    writes:
      "Creates vendor, case, vendor-profile link, and invitation audit records through the governed API.",
    statuses:
      "Ready, validating, sending, invited, duplicate blocked, delivery failed, or creation failed.",
    notification:
      "A secure invitation is sent to the vendor and success or exact failure is shown to Legal.",
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
    capabilityIds: ["view_own_accreditation"],
    roleIds: ["vendor_portal"],
    purpose:
      "Shows an enrolled vendor only its own accreditation case, required actions, documents, instruments, and status.",
    field: "Own case and required-action selection",
    validation:
      "Vendor identity and row-level vendor link must match every displayed case and document.",
    reads:
      "Vendor-scoped cases, requirements, submissions, corrections, documents, instruments, and decisions.",
    writes:
      "No case decision is made from the list; the vendor opens the assigned application, upload, or signature action.",
    statuses:
      "Invited, in progress, submitted, correction required, under review, approved, rejected, expired, or suspended.",
    notification:
      "Corrections, signature requests, decisions, and expiry actions appear in the vendor's governed notifications.",
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
    capabilityIds: [
      "view_own_accreditation",
      "submit_documents",
      "submit_accreditation",
    ],
    roleIds: ["vendor_portal"],
    purpose:
      "Guides the vendor through its own evidence, correction, declaration, instrument, and submission obligations.",
    field:
      "Requirement response, document, declaration, correction, and submission action",
    validation:
      "Required items must be complete, files valid, declarations accepted, and the case must belong to the vendor.",
    reads:
      "Vendor-scoped case, application, checklist, documents, corrections, instruments, and decision status.",
    writes:
      "Uploads vendor evidence, updates draft responses, acknowledges declarations, and submits the governed application snapshot.",
    statuses:
      "Draft, incomplete, ready to submit, submitted, correction required, under review, approved, or rejected.",
    notification:
      "Submission and corrections notify Legal; vendor-facing success and errors remain visible on the case.",
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
    capabilityIds: ["submit_accreditation", "view_own_accreditation"],
    roleIds: ["vendor_portal"],
    purpose:
      "Captures the vendor's company, ownership, regulatory, service, technology, privacy, risk, and declaration facts.",
    field:
      "Application sections, required facts, explanations, declarations, and supporting references",
    fieldRequired: true,
    validation:
      "Required fields, formats, conditional questions, and declarations must pass before the snapshot can be submitted.",
    reads:
      "Vendor-scoped draft, applicable requirement policy, prior corrections, and saved evidence references.",
    writes:
      "Saves vendor-scoped draft answers and creates an immutable submitted snapshot when all gates pass.",
    statuses:
      "Not started, draft, incomplete, ready, submitting, submitted, correction required, or save failed.",
    notification:
      "Autosave or submit feedback is shown; final submission notifies the assigned Legal reviewer.",
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
    capabilityIds: ["submit_documents", "view_own_accreditation"],
    roleIds: ["vendor_portal"],
    purpose:
      "Lets an authorized vendor representative review and sign the exact instrument assigned to its own case.",
    field: "Instrument, signer name, capacity, consent, and signature action",
    fieldRequired: true,
    validation:
      "Case ownership, signer authority, content hash, consent, and signing order must be valid.",
    reads:
      "Vendor-scoped instrument text, version, hash, parties, and signature status.",
    writes:
      "Records the vendor representative's immutable signature event against the displayed instrument hash.",
    statuses:
      "Awaiting vendor, signed by vendor, awaiting Mwell, fully executed, declined, expired, or invalidated.",
    notification:
      "Vendor signature notifies the Legal owner and the portal confirms the next instrument state.",
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
    capabilityIds: ["view_own_accreditation"],
    roleIds: ["vendor_portal"],
    purpose:
      "Protects the internally mounted invitation route from being used by an external vendor account.",
    field: "Authenticated vendor identity and requested route",
    validation:
      "External vendor roles never satisfy the internal manage-checklist authority required to create invitations.",
    reads: "Current profile kind, vendor role, and route access decision.",
    writes:
      "No vendor, case, profile, or invitation record is created from the protected vendor route.",
    statuses:
      "Authenticated vendor, access denied, redirected to own case, or signed out.",
    notification:
      "No invitation is sent; the portal explains that internal onboarding must be handled by Mwell Legal.",
    exception:
      "Return to the vendor case or contact the Mwell account manager when onboarding assistance is required.",
    completionEvidence:
      "The vendor remains unable to create invitations and no invitation audit event exists.",
  },
];

export const KNOWLEDGE_FEATURES: KnowledgeFeature[] =
  definitions.map(defineFeature);
