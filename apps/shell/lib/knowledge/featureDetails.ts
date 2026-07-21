import type { KnowledgeFeatureControl, KnowledgeFeatureField } from "./types";

export interface ExplicitFeatureDetails {
  controls: KnowledgeFeatureControl[];
  fields: KnowledgeFeatureField[];
}

const control = (
  name: string,
  behavior: string,
  validation: string,
  result: string,
): KnowledgeFeatureControl => ({ name, behavior, validation, result });

const field = (
  name: string,
  purpose: string,
  required: boolean,
  validation: string,
): KnowledgeFeatureField => ({ name, purpose, required, validation });

export const EXPLICIT_FEATURE_DETAILS: Record<string, ExplicitFeatureDetails> =
  {
    "shell-home": {
      controls: [
        control(
          "Open module",
          "Opens the selected role-authorized workspace from its home card.",
          "The session must expose the module through current role assignments.",
          "The selected workspace opens without granting any additional permission.",
        ),
        control(
          "Open notification",
          "Navigates to the governed record referenced by a shell notification.",
          "The notification needs a valid internal route visible to this user.",
          "The referenced record opens and unread state can be cleared separately.",
        ),
      ],
      fields: [
        field(
          "Session profile",
          "Shows the identity whose roles drive visible destinations.",
          true,
          "The profile must come from the active authenticated session.",
        ),
        field(
          "Module availability",
          "Shows each workspace authorized for the active profile.",
          false,
          "Availability is derived from role capability checks, never manual selection.",
        ),
      ],
    },
    "sign-in": {
      controls: [
        control(
          "Sign in",
          "Submits the entered credentials through the configured authentication provider.",
          "Email and password must both be present before submission.",
          "A valid session is created and the safe return route opens.",
        ),
        control(
          "Send reset link",
          "Requests a password recovery email for the entered account address.",
          "A syntactically valid email address must be entered first.",
          "The page confirms the recovery request without exposing account existence.",
        ),
        control(
          "Use demo profile",
          "Selects a configured memory-mode persona for local preview access.",
          "This control exists only when memory mode exposes demo profiles.",
          "The selected demo profile becomes the active preview session.",
        ),
      ],
      fields: [
        field(
          "Email",
          "Identifies the employee or vendor account requesting access.",
          true,
          "Use a valid assigned email address with surrounding whitespace removed.",
        ),
        field(
          "Password",
          "Provides the secret used by the authentication provider.",
          true,
          "A non-empty password is required and is never written to handbook content.",
        ),
      ],
    },
    "reset-password": {
      controls: [
        control(
          "Update password",
          "Submits the matching replacement password through the recovery session.",
          "Both password fields must match and provider policy must pass.",
          "The password changes and the safe local destination opens.",
        ),
        control(
          "Back to sign in",
          "Returns to the sign-in page without changing credentials.",
          "Navigation uses the fixed internal login route only.",
          "The sign-in page opens and no password write occurs.",
        ),
      ],
      fields: [
        field(
          "New password",
          "Captures the replacement credential for the recovered account.",
          true,
          "At least eight characters are required before provider validation.",
        ),
        field(
          "Confirm password",
          "Prevents accidental submission of a mistyped replacement credential.",
          true,
          "The confirmation must exactly match the new password.",
        ),
      ],
    },
    "knowledge-library": {
      controls: [
        control(
          "Search handbook",
          "Filters handbook results using indexed titles, summaries, aliases, and instructions.",
          "The query is trimmed and may be empty to show the library.",
          "Matching articles, workflows, glossary terms, and roadmap items appear.",
        ),
        control(
          "Filter role",
          "Limits results to content assigned to the selected operating role.",
          "The role identifier must exist in the governed role registry.",
          "Only content relevant to that role remains visible.",
        ),
        control(
          "Filter module",
          "Limits results to the selected Intra workspace or shared core content.",
          "The module must be one of the supported knowledge modules.",
          "The result list reflects the selected module scope.",
        ),
        control(
          "Filter content type",
          "Limits results to articles, workflows, glossary entries, or future items.",
          "Only recognized content type values are accepted from the URL.",
          "The library displays only the requested content category.",
        ),
        control(
          "Open contextual guidance",
          "Opens the exact Knowledge Base feature guide for the operational page currently in use.",
          "The active route must match a documented implemented feature; unknown routes do not show an unrelated guide.",
          "The matching live guide opens with the page purpose, controls, fields, roles, and related workflows.",
        ),
      ],
      fields: [
        field(
          "Search query",
          "Carries plain-language task terms into deterministic handbook search.",
          false,
          "Whitespace-only queries are treated as an empty library search.",
        ),
        field(
          "Role",
          "Carries the selected role identifier in the knowledge URL.",
          false,
          "Unknown role identifiers are ignored rather than granting visibility.",
        ),
        field(
          "Module",
          "Carries the selected module filter in the knowledge URL.",
          false,
          "Unknown module values are rejected by the filter parser.",
        ),
        field(
          "Content type",
          "Carries the selected result category in the knowledge URL.",
          false,
          "The value must match a supported knowledge result type.",
        ),
      ],
    },
    "offline-status": {
      controls: [
        control(
          "Reconnect application",
          "Relies on browser reconnection before the user navigates back to live work.",
          "Network connectivity must be restored before live records can be verified.",
          "A fresh navigation reaches the live application rather than the fallback.",
        ),
        control(
          "Verify queued work",
          "Directs the user to inspect warehouse outbox results after reconnection.",
          "Uncertain commands must not be repeated before their saved state is checked.",
          "Each queued command has a confirmed synchronized or failed outcome.",
        ),
      ],
      fields: [
        field(
          "Network state",
          "Explains that live application data is currently unreachable.",
          true,
          "The service-worker fallback appears only after navigation fails offline.",
        ),
        field(
          "Outbox warning",
          "Reminds warehouse users that queued commands may still be pending.",
          false,
          "The warning never claims that a queued command completed.",
        ),
      ],
    },
    "admin-governance": {
      controls: [
        control(
          "Open users",
          "Navigates to the governed user and role administration workspace.",
          "The current identity must hold core manage_rbac authority.",
          "The user and role workspace opens without changing access.",
        ),
        control(
          "Open authority",
          "Navigates to the department Delegation of Authority workspace.",
          "The current identity must be authorized for the target administration route.",
          "The DOA workspace opens without changing an active matrix.",
        ),
        control(
          "Open runbook",
          "Navigates to the administration decision flow in the Knowledge Base.",
          "Documentation remains visible but does not grant administration authority.",
          "The governance decision tree opens at its declared start node.",
        ),
      ],
      fields: [
        field(
          "Administration area",
          "Names the governed destination represented by each entry.",
          true,
          "The destination must exist in the released route registry.",
        ),
        field(
          "Availability",
          "Shows whether the destination is a live control or guidance.",
          true,
          "The label must match the released route or documentation state.",
        ),
        field(
          "Authority notice",
          "States the approval and audit expectations for administration changes.",
          true,
          "The notice is informational and cannot be used to bypass a route guard.",
        ),
      ],
    },
    "admin-users": {
      controls: [
        control(
          "Open profile",
          "Opens the selected user sheet with identity and current role grants.",
          "The selected profile must exist in the loaded core profile list.",
          "The profile sheet displays its current scoped assignments.",
        ),
        control(
          "Assign role",
          "Calls the governed role-assignment RPC for the selected profile and scope.",
          "The actor needs manage_rbac and the module-role pair must exist.",
          "The new role grant appears after the live assignments reload.",
        ),
        control(
          "Revoke role",
          "Calls the governed role-revocation RPC for the selected profile and scope.",
          "The actor needs manage_rbac and the existing grant must still be present.",
          "The removed role disappears after the live assignments reload.",
        ),
      ],
      fields: [
        field(
          "Profile",
          "Identifies the employee or vendor whose roles are being reviewed.",
          true,
          "The profile identifier must come from the core profiles query.",
        ),
        field(
          "Account kind",
          "Shows whether employee or vendor boundaries apply to the profile.",
          true,
          "The value is read-only and comes from the profile record.",
        ),
        field(
          "Module role",
          "Represents one canonical module and role assignment checkbox.",
          true,
          "The pair must exist in the shared RBAC module definitions.",
        ),
      ],
    },
    "admin-departments": {
      controls: [
        control(
          "Add department",
          "Opens an empty editor for a new root or child department.",
          "The administrator must have manage_rbac and choose an available parent when creating a child.",
          "An unsaved department form opens without changing the live hierarchy.",
        ),
        control(
          "Edit department",
          "Opens the selected department in the compact editing sheet.",
          "The selected department must still exist in the latest hierarchy response.",
          "Current code, name, parent, order, purpose, and status are displayed for review.",
        ),
        control(
          "Choose parent",
          "Moves the department beneath another active department in the hierarchy.",
          "The department itself and every descendant are excluded to prevent a hierarchy cycle.",
          "The selected valid parent becomes part of the pending department change.",
        ),
        control(
          "Save department",
          "Sends the edited department definition to the governed upsert RPC.",
          "Code and name are required, sort order must be valid, the parent cannot create a cycle, and the editor version must still be current.",
          "The refreshed tree shows the saved hierarchy and audit values, or a stale-editor message asks the administrator to reload.",
        ),
        control(
          "Deactivate department",
          "Opens an impact confirmation, then marks an unused department inactive while keeping its identifier and history.",
          "Active child departments and every current or future profile assignment must be resolved before deactivation.",
          "The confirmed department becomes inactive, or the page explains the dependency or stale version that blocked the change.",
        ),
      ],
      fields: [
        field(
          "Code",
          "Provides the stable short identifier used for organizational scope.",
          true,
          "A non-empty trimmed code must remain unique across all departments.",
        ),
        field(
          "Name",
          "Displays the plain-language department name throughout the hierarchy.",
          true,
          "A non-empty trimmed name is required before the department can be saved.",
        ),
        field(
          "Purpose",
          "Explains the department responsibility represented by this organizational scope.",
          false,
          "Blank is allowed; entered text is trimmed before the governed save.",
        ),
        field(
          "Parent department",
          "Places the department at the root or beneath another department.",
          false,
          "The selected parent must be active and cannot be the department or any descendant.",
        ),
        field(
          "Sort order",
          "Controls the department position among siblings in the compact tree.",
          true,
          "The value must be a whole numeric order accepted by the department RPC.",
        ),
        field(
          "Active status",
          "Shows whether the department can receive current organizational assignments.",
          true,
          "Deactivation is blocked while active children or current or future profile assignments still depend on it.",
        ),
      ],
    },
    "admin-doa": {
      controls: [
        control(
          "Create revision",
          "Loads active assignment rows into a new editable matrix revision.",
          "The selected matrix must have active assignments available to copy.",
          "A new version draft is prepared without changing the active matrix.",
        ),
        control(
          "Activate matrix",
          "Confirms and activates the selected draft through the DOA activation RPC.",
          "Only a draft with valid assignments may be activated after confirmation.",
          "The draft becomes active and the prior active revision is superseded.",
        ),
        control(
          "Add tier",
          "Appends a blank approval-tier assignment row to the draft editor.",
          "The editor must remain within the current unsaved draft revision.",
          "A new tier row appears for completion before saving.",
        ),
        control(
          "Remove tier",
          "Removes the selected unsaved assignment row from the draft editor.",
          "At least one assignment row must remain in the editor.",
          "The selected draft row is removed without changing persisted matrices.",
        ),
        control(
          "Save draft",
          "Calls the governed save_doa_matrix RPC with matrix and assignment data.",
          "Department, version, named approvers, and a final approver are required.",
          "A new immutable draft revision appears in department coverage.",
        ),
      ],
      fields: [
        field(
          "Department",
          "Names the department governed by this matrix revision.",
          true,
          "A non-empty trimmed department name is required.",
        ),
        field(
          "Version",
          "Identifies the immutable revision being created.",
          true,
          "A non-empty version distinct from prior revisions is required.",
        ),
        field(
          "Source document",
          "Records the approved authority source behind the matrix.",
          false,
          "The value is trimmed before persistence and should identify a governed source.",
        ),
        field(
          "Effective date",
          "Sets when the matrix revision becomes applicable.",
          true,
          "A valid date is converted to an Asia Singapore midnight timestamp.",
        ),
        field(
          "Tier",
          "Selects the approval ladder responsibility for one assignment.",
          true,
          "The value must be one of the five supported DOA tiers.",
        ),
        field(
          "Category",
          "Optionally scopes one assignment to a procurement category.",
          false,
          "Blank means all categories and non-blank values are trimmed.",
        ),
        field(
          "Minimum amount",
          "Sets the inclusive lower threshold for one assignment.",
          true,
          "The value must be numeric and cannot be negative.",
        ),
        field(
          "Maximum amount",
          "Optionally sets the upper threshold for one assignment.",
          false,
          "Blank means no limit; otherwise use a non-negative number above minimum.",
        ),
        field(
          "Named approver",
          "Links one assignment to an active employee profile.",
          true,
          "Every assignment requires a selected active employee identifier.",
        ),
      ],
    },
    "warehouse-dashboard": {
      controls: [
        control(
          "Open primary task",
          "Navigates to the role-specific warehouse action selected by the hero.",
          "The destination must be authorized by the active warehouse role.",
          "The relevant operational queue opens without changing stock.",
        ),
        control(
          "Open product alert",
          "Opens product detail from a low-stock or inventory alert row.",
          "The referenced product identifier must still exist in current warehouse data.",
          "Current product balances and history appear for investigation.",
        ),
        control(
          "Open event",
          "Opens event detail from the active-event summary.",
          "The referenced event must remain visible to the current role.",
          "Demand, allocations, and outcomes appear on the event record.",
        ),
        control(
          "Open export menu",
          "Displays the governed CSV export choices available to analytical roles.",
          "The role needs view_analytics or view_finance before exports are enabled.",
          "Available export types appear without starting a download.",
        ),
        control(
          "Export inventory",
          "Generates the current inventory CSV through the governed export helper.",
          "Export authority and current warehouse data are required.",
          "A timestamped inventory file downloads and a success toast appears.",
        ),
        control(
          "Export movements",
          "Generates movement history CSV through the governed export helper.",
          "Export authority and loaded movement records are required.",
          "A timestamped movements file downloads and a success toast appears.",
        ),
      ],
      fields: [
        field(
          "KPI value",
          "Shows a calculated warehouse health measure from loaded state.",
          false,
          "The value is derived from current records and is not editable.",
        ),
        field(
          "Product alert",
          "Identifies a product requiring stock or master-data attention.",
          false,
          "The product link must resolve before navigation is offered.",
        ),
        field(
          "Event summary",
          "Identifies an event and its current fulfillment state.",
          false,
          "Displayed totals must derive from the selected event record.",
        ),
      ],
    },
    "warehouse-scan": {
      controls: [
        control(
          "Start scanner",
          "Requests camera access and begins barcode decoding for warehouse identities.",
          "A supported camera and browser permission are required.",
          "A resolved code is shown before any operation begins.",
        ),
        control(
          "Enter code manually",
          "Resolves a typed barcode when camera scanning is unavailable.",
          "The trimmed code must match exactly one known warehouse identity.",
          "The matching product, unit, lot, or bin is displayed.",
        ),
        control(
          "Choose operation",
          "Navigates from the resolved identity to an authorized warehouse action.",
          "At least one required capability must be held for the chosen operation.",
          "The target workflow opens with the scanned context preserved.",
        ),
      ],
      fields: [
        field(
          "Barcode",
          "Carries the scanned or manually entered warehouse identifier.",
          true,
          "The code must resolve uniquely before navigation is enabled.",
        ),
        field(
          "Operation",
          "Selects receiving, issue, return, count, transfer, or lookup.",
          true,
          "Only operations allowed by current capabilities are displayed.",
        ),
      ],
    },
    "warehouse-tasks": {
      controls: [
        control(
          "Show due tasks",
          "Filters the task board to work that is currently actionable.",
          "Task due state is derived from current status and target date.",
          "Only due control work remains in the list.",
        ),
        control(
          "Show blocked tasks",
          "Filters the task board to work prevented by an exception or prerequisite.",
          "Blocked state must come from the linked control record.",
          "Only blocked work and its reason remain visible.",
        ),
        control(
          "Open task",
          "Navigates to the quality, exception, or cycle-count record behind a task.",
          "The linked route and record must still be visible to this role.",
          "The exact control page opens for completion.",
        ),
      ],
      fields: [
        field(
          "Task status",
          "Classifies work as due, blocked, or completed.",
          false,
          "Status is read from the linked record and cannot be edited here.",
        ),
        field(
          "Task type",
          "Identifies the quality, exception, or count workflow required.",
          false,
          "The type must map to a supported warehouse task route.",
        ),
        field(
          "Due date",
          "Shows when the linked control work should be completed.",
          false,
          "The value is displayed from persisted task context.",
        ),
      ],
    },
    "warehouse-inventory": {
      controls: [
        control(
          "Search inventory",
          "Filters products by SKU, barcode, name, category, or visible identity.",
          "The query is trimmed and never changes product records.",
          "Matching inventory rows remain visible.",
        ),
        control(
          "Filter stock state",
          "Limits rows by active, low-stock, held, or availability state.",
          "The selected state must be supported by inventory filters.",
          "Only products matching the selected state remain.",
        ),
        control(
          "Open product",
          "Navigates to the selected product detail route.",
          "The row must contain a valid product identifier.",
          "Product balances, history, and authorized actions appear.",
        ),
        control(
          "Create product",
          "Opens the product editor for a new master-data record.",
          "The role needs manage_products before the editor is available.",
          "A blank product form opens without creating stock.",
        ),
        control(
          "Edit product",
          "Opens the product editor with the selected master-data values.",
          "The role needs manage_products and the product must still exist.",
          "The authorized master-data form opens for review.",
        ),
      ],
      fields: [
        field(
          "Search query",
          "Matches visible product identifiers and descriptive text.",
          false,
          "Whitespace-only input is treated as no search filter.",
        ),
        field(
          "Stock state",
          "Limits inventory rows by operational availability state.",
          false,
          "The value must match a supported filter option.",
        ),
        field(
          "SKU",
          "Identifies the product in inventory lists and exports.",
          true,
          "SKU must be unique when product master data is saved.",
        ),
        field(
          "Product name",
          "Shows the governed descriptive product name.",
          true,
          "A non-empty name is required for master-data saves.",
        ),
        field(
          "Category",
          "Groups products for inventory browsing and planning.",
          false,
          "The value must use an available category option when edited.",
        ),
      ],
    },
    "warehouse-product-detail": {
      controls: [
        control(
          "Back to inventory",
          "Returns to the inventory list without changing the product.",
          "Navigation uses the fixed inventory route.",
          "The inventory browser opens with no data write.",
        ),
        control(
          "Edit product",
          "Opens master-data editing for the current product.",
          "The role needs manage_products and the product must exist.",
          "Editable product fields appear in the product sheet.",
        ),
        control(
          "Transfer stock",
          "Opens a transfer command for the selected product stock.",
          "The role needs transfer_stock and a valid source balance.",
          "A transfer draft opens without moving stock yet.",
        ),
        control(
          "Relocate stock",
          "Opens bin relocation for the selected product identity.",
          "A valid operation route and destination bin are required.",
          "A relocation draft opens with current source context.",
        ),
        control(
          "Adjust count",
          "Starts a governed count adjustment from current product stock.",
          "The role needs cycle_count and must provide count evidence.",
          "A count record is prepared for variance handling.",
        ),
        control(
          "Set price",
          "Opens the price editor for the selected product.",
          "The role needs set_pricing and the product must have valid cost context.",
          "A price revision form opens without changing history.",
        ),
        control(
          "Open traceability",
          "Selects a visible lot or serial identity for detailed inspection.",
          "The identity must belong to the current product.",
          "Its location and movement history remain visible.",
        ),
        control(
          "Open financial context",
          "Shows authorized valuation, pricing, or procurement facts for the product.",
          "At least one financial or procurement view capability is required.",
          "Sensitive context appears without changing any record.",
        ),
      ],
      fields: [
        field(
          "Product identifier",
          "Resolves the detail route to one product record.",
          true,
          "The route identifier must match an existing product.",
        ),
        field(
          "SKU",
          "Shows the unique product stock-keeping code.",
          true,
          "The code remains unique across product master data.",
        ),
        field(
          "Barcode",
          "Shows the scannable product-level identifier.",
          false,
          "A non-empty edited barcode must remain unique.",
        ),
        field(
          "Tracking mode",
          "Shows whether stock uses none, lot, or serial traceability.",
          true,
          "Tracking changes must remain compatible with existing stock identities.",
        ),
        field(
          "On-hand quantity",
          "Shows the ledger-derived physical product balance.",
          false,
          "The value is read-only and must come from stock records.",
        ),
        field(
          "Reserved quantity",
          "Shows quantity committed to active allocations.",
          false,
          "The value is derived from reservations and cannot be edited.",
        ),
        field(
          "Source bin",
          "Identifies the current storage bin for a movement action.",
          true,
          "The bin must contain eligible product stock.",
        ),
        field(
          "Destination bin",
          "Identifies the target bin for relocation or transfer.",
          true,
          "The destination must differ and satisfy an active operation route.",
        ),
      ],
    },
    "warehouse-receiving": {
      controls: [
        control(
          "Select purchase order",
          "Loads remaining receivable lines from the chosen approved order.",
          "The order must be approved, issued, and not fully received.",
          "Eligible lines and remaining quantities become available.",
        ),
        control(
          "Add receipt line",
          "Adds the selected product and quantity to the receipt draft.",
          "Quantity must be positive and within the remaining order balance.",
          "A validated line appears in the receipt draft.",
        ),
        control(
          "Capture evidence",
          "Attaches camera or file evidence to the pending receipt.",
          "Evidence must meet supported file and size rules.",
          "The evidence reference appears on the receipt draft.",
        ),
        control(
          "Submit receipt",
          "Commits receipt, traceability, movement, and stock updates through the repository.",
          "All required PO, quantity, identity, and destination checks must pass.",
          "The receipt posts once and current inventory reloads.",
        ),
        control(
          "Reset draft",
          "Clears unsubmitted receipt inputs without changing warehouse records.",
          "Only local draft state may be discarded.",
          "The receiving form returns to its initial state.",
        ),
      ],
      fields: [
        field(
          "Purchase order",
          "Identifies the approved supply order being received.",
          true,
          "The order must have a positive receivable balance.",
        ),
        field(
          "Product",
          "Selects one ordered product for the receipt line.",
          true,
          "The product must belong to the selected order.",
        ),
        field(
          "Quantity",
          "Records units physically received for the selected line.",
          true,
          "Use a positive value no greater than remaining quantity.",
        ),
        field(
          "Warehouse",
          "Selects the receiving warehouse site.",
          true,
          "The warehouse must be active and available to the role.",
        ),
        field(
          "Destination bin",
          "Selects the first controlled storage destination.",
          true,
          "The bin must be active and allowed by an operation route.",
        ),
        field(
          "Lot number",
          "Captures lot identity when the product uses lot tracking.",
          false,
          "A tracked lot requires a non-empty lot number.",
        ),
        field(
          "Serial number",
          "Captures unit identity when the product uses serial tracking.",
          false,
          "Each serial must be non-empty and globally unique.",
        ),
        field(
          "Expiry date",
          "Records expiry for products requiring dated traceability.",
          false,
          "When supplied, the value must be a valid future-aware date.",
        ),
        field(
          "Condition",
          "Records the observed condition before quality disposition.",
          true,
          "Use one of the supported receipt condition values.",
        ),
        field(
          "Evidence",
          "Links photographs or files supporting the physical receipt.",
          false,
          "Required evidence rules come from the active operation route.",
        ),
      ],
    },
    "warehouse-allocations": {
      controls: [
        control(
          "Create reservation",
          "Reserves available product quantity for the selected event.",
          "Event, product, and positive available quantity are required.",
          "A reservation appears with reduced available stock.",
        ),
        control(
          "Cancel reservation",
          "Cancels an eligible unissued reservation from the allocation list.",
          "The reservation must still be active and unissued.",
          "Reserved quantity returns to availability.",
        ),
        control(
          "Open issue",
          "Loads the selected reservation into the custody issue sheet.",
          "The role needs issue_items and the reservation must remain issuable.",
          "Recipient and evidence controls appear for confirmation.",
        ),
        control(
          "Confirm issue",
          "Records custody transfer for the selected reserved quantity.",
          "Recipient, quantity, source identity, and required evidence must pass.",
          "Issue movement and custody history are recorded.",
        ),
        control(
          "Open return",
          "Loads an issued allocation into the return disposition sheet.",
          "The role needs manage_returns and outstanding custody must remain.",
          "Return quantity and condition controls become available.",
        ),
      ],
      fields: [
        field(
          "Event",
          "Selects the event receiving reserved warehouse stock.",
          true,
          "The event must exist and remain open for allocation.",
        ),
        field(
          "Product",
          "Selects the product to reserve or issue.",
          true,
          "The product must have eligible available stock.",
        ),
        field(
          "Quantity",
          "Sets the reservation or issue quantity.",
          true,
          "Use a positive value within current availability or reservation.",
        ),
        field(
          "Recipient",
          "Identifies the person accepting issued custody.",
          true,
          "A non-empty recipient is required before issue.",
        ),
        field(
          "Assignee",
          "Optionally links issue custody to an employee profile.",
          false,
          "When selected, the assignee must be a known active profile.",
        ),
        field(
          "Source identity",
          "Selects eligible unit, lot, or bin stock for issue.",
          true,
          "The identity must contain sufficient unheld stock.",
        ),
        field(
          "Return condition",
          "Captures physical condition when issued stock returns.",
          false,
          "A supported condition is required for return completion.",
        ),
        field(
          "Photo evidence",
          "Links optional proof captured during custody issue.",
          false,
          "Uploaded evidence must satisfy file constraints.",
        ),
      ],
    },
    "warehouse-fulfillment": {
      controls: [
        control(
          "Create ecommerce order",
          "Records ecommerce, internal-event, or third-party sales demand with its external order reference and requested products.",
          "The reference must be unique; event demand needs an event, and third-party demand also needs its external location and reported PHP sales value.",
          "A received fulfillment order enters the Warehouse queue.",
        ),
        control(
          "Print barcode sheet",
          "Generates one scannable master label for each quantity-controlled merchandise, event-material, or fulfillment-supply item.",
          "The product must have a barcode and must not be a serialized unit.",
          "A print-ready label sheet opens without exposing serialized-device product labels.",
        ),
        control(
          "Submit department request",
          "Records a department's stock need, business purpose, cost center, required date, and treatment.",
          "The requester must provide all required business context and cannot approve the same request.",
          "A pending request is visible to the requester and decision owner.",
        ),
        control(
          "Decide request",
          "Approves or rejects an eligible department request as a separate accountable action.",
          "A different authorized user must decide a request that is still pending.",
          "Approval creates a linked fulfillment order; rejection records the terminal decision.",
        ),
        control(
          "Allocate stock",
          "Checks unheld available stock at the selected warehouse and bin before reserving the order.",
          "Every order line must remain fully available after other active commitments.",
          "The order advances to Allocated without changing physical stock.",
        ),
        control(
          "Confirm pick",
          "Records picked quantities and required unit serials for every order line.",
          "Every line must be complete; serialized products require one unique eligible serial per unit.",
          "The order advances to Packing with traceable picked identities.",
        ),
        control(
          "Confirm pack",
          "Records courier, waybill, and quantity-controlled fulfillment supplies used for the shipment.",
          "Courier and waybill are required and packaging products must be available fulfillment supplies.",
          "The order becomes Ready and packaging remains reserved for release.",
        ),
        control(
          "Release order",
          "Posts final serialized or quantity stock issue and packaging-consumption movements.",
          "The order must be Ready, fully picked, and still have eligible stock and packaging.",
          "The order becomes Released with attributable warehouse movements.",
        ),
        control(
          "Create return or re-kit work",
          "Records Customer Service intake, warehouse resolution, and Product-approved open-box re-kit lineage.",
          "Returns require a recognized product and serial when applicable; active kits require a Product approval reference.",
          "The return receives a controlled resolution or a traceable re-kit work order.",
        ),
        control(
          "Complete re-kit",
          "Consumes the inspected component identities and posts the approved output serial to an active warehouse rack or bin.",
          "The work order must be under inspection, its Product-approved definition must remain active, and the output serial must be unique.",
          "A completed work order, serialized open-box stock unit, and re-kit movement share the same reference.",
        ),
      ],
      fields: [
        field(
          "External reference",
          "Links ecommerce or source demand to fulfillment.",
          true,
          "It must be non-empty and unique.",
        ),
        field(
          "Event",
          "Links third-party selling demand to the accountable Intra event.",
          false,
          "Required for third-party event sales and must identify an existing event.",
        ),
        field(
          "External location",
          "Names the third-party site that physically holds or sells the event stock.",
          false,
          "Required for third-party event sales so custody and reported sales can be reconciled by site.",
        ),
        field(
          "Gross sales",
          "Records the PHP value reported by a third-party selling channel for reconciliation.",
          false,
          "Required for third-party event sales and cannot be negative.",
        ),
        field(
          "Requesting department",
          "Identifies the department accountable for demand.",
          false,
          "Use an active configured department code for department work.",
        ),
        field(
          "Business purpose",
          "Explains why department stock is needed.",
          false,
          "Required for department requests and must be specific enough for review.",
        ),
        field(
          "Cost center",
          "Routes expense or custody accountability.",
          false,
          "Required for department requests and must match the approved finance structure.",
        ),
        field(
          "Required date",
          "Sets operational due timing.",
          false,
          "Required for department requests and must be a valid date.",
        ),
        field(
          "Product",
          "Identifies the sellable SKU, merchandise, event material, or approved re-kitted item on the demand line.",
          true,
          "The product must exist and be eligible for the selected demand source.",
        ),
        field(
          "Quantity",
          "Sets how many units or customer-facing bundle sets the line requires.",
          true,
          "The quantity must be a positive whole number and must agree with any supplied bundle-set codes.",
        ),
        field(
          "Serial or bundle-set identity",
          "Preserves unit and customer-facing set lineage.",
          false,
          "Required per unit for serialized SKUs and per set when bundle codes are used.",
        ),
        field(
          "Courier",
          "Names the dispatch carrier or accountable courier.",
          true,
          "Required before packing can complete.",
        ),
        field(
          "Waybill number",
          "Links physical dispatch to shipment evidence.",
          true,
          "Required before packing can complete and release can occur.",
        ),
        field(
          "Product approval reference",
          "Proves Product approved the active kit recipe or go-live definition.",
          false,
          "Required before an active kit definition can be published.",
        ),
        field(
          "Return resolution",
          "Records replacement, refund, vendor return, re-kit, or write-off outcome.",
          false,
          "Refund needs Finance authority and reference; replacement, refund, and re-kit need quarantine.",
        ),
      ],
    },
    "warehouse-returns": {
      controls: [
        control(
          "Select issued item",
          "Loads an outstanding issue into the return form.",
          "The issue must retain unreturned custody quantity.",
          "Product, event, and remaining quantity are displayed.",
        ),
        control(
          "Set disposition",
          "Selects restock, hold, damage, loss, or vendor return handling.",
          "Disposition must match observed condition and role authority.",
          "Required reason and destination rules update.",
        ),
        control(
          "Capture return evidence",
          "Attaches proof supporting condition and disposition.",
          "Adverse dispositions require valid evidence before submission.",
          "The evidence reference appears on the return draft.",
        ),
        control(
          "Submit return",
          "Records returned custody and resulting stock movement through the repository.",
          "Quantity, condition, disposition, and required evidence must pass.",
          "Custody decreases and the final stock state is recorded.",
        ),
      ],
      fields: [
        field(
          "Issue reference",
          "Identifies the custody record being returned.",
          true,
          "The issue must exist and remain partly outstanding.",
        ),
        field(
          "Product",
          "Shows the product associated with the selected issue.",
          true,
          "The product is read-only and must match issue custody.",
        ),
        field(
          "Quantity",
          "Records how many issued units are returning.",
          true,
          "Use a positive value within outstanding custody.",
        ),
        field(
          "Condition",
          "Records physical condition observed at return.",
          true,
          "Use a supported return condition value.",
        ),
        field(
          "Disposition",
          "Determines the resulting stock or exception state.",
          true,
          "The disposition must be compatible with condition.",
        ),
        field(
          "Destination bin",
          "Selects the restock or hold destination when applicable.",
          false,
          "The bin must be active and route-compatible.",
        ),
        field(
          "Reason",
          "Explains damage, loss, hold, or vendor-return outcomes.",
          false,
          "Adverse dispositions require a non-empty reason.",
        ),
      ],
    },
    "warehouse-storage": {
      controls: [
        control(
          "Create area",
          "Opens storage-area creation for the selected warehouse.",
          "The role needs manage_locations and an active warehouse.",
          "A blank area form opens without moving stock.",
        ),
        control(
          "Add bin",
          "Creates a scannable bin beneath the selected storage area.",
          "Area, unique code, and active warehouse are required.",
          "The new empty bin appears in the area.",
        ),
        control(
          "Edit storage",
          "Updates area or bin descriptive restrictions.",
          "The role needs manage_locations and the record must exist.",
          "Saved restrictions appear after repository reload.",
        ),
        control(
          "Put away stock",
          "Opens controlled putaway for eligible received stock.",
          "The role needs receiving or transfer authority and a valid route.",
          "A putaway draft opens with source and destination context.",
        ),
        control(
          "Transfer bin stock",
          "Moves eligible stock between valid bins through a governed route.",
          "Source, destination, quantity, and route safeguards must pass.",
          "A movement record posts and both balances refresh.",
        ),
      ],
      fields: [
        field(
          "Warehouse",
          "Selects the site containing the storage area.",
          true,
          "The warehouse must exist and remain active.",
        ),
        field(
          "Area name",
          "Names a controlled storage grouping within the warehouse.",
          true,
          "A non-empty name is required.",
        ),
        field(
          "Area purpose",
          "Describes operational use such as available or quarantine storage.",
          false,
          "Use a supported purpose when restrictions depend on it.",
        ),
        field(
          "Bin code",
          "Provides the unique scannable storage identifier.",
          true,
          "The code must be unique within the warehouse.",
        ),
        field(
          "Bin label",
          "Provides a readable shelf or location description.",
          false,
          "The value is trimmed before saving.",
        ),
        field(
          "Restriction",
          "Controls which stock states may enter the bin.",
          false,
          "Restrictions must remain compatible with operation routes.",
        ),
        field(
          "Active state",
          "Controls whether future movements may use the record.",
          true,
          "Occupied or referenced storage cannot be deactivated unsafely.",
        ),
      ],
    },
    "warehouse-events": {
      controls: [
        control(
          "Create event",
          "Opens event creation for authorized allocation planners.",
          "The role needs reserve_allocate before creation is available.",
          "A blank event form opens without reserving stock.",
        ),
        control(
          "Filter events",
          "Limits event cards by lifecycle or date context.",
          "The filter must match a supported event state.",
          "Only matching event records remain visible.",
        ),
        control(
          "Open event",
          "Navigates to the selected event detail record.",
          "The event identifier must resolve and remain authorized.",
          "Demand, allocations, and reconciliation details appear.",
        ),
        control(
          "Save event",
          "Creates or updates event planning data through the warehouse repository.",
          "Name, owner, dates, and location must pass event validation.",
          "The event appears with its saved lifecycle state.",
        ),
      ],
      fields: [
        field(
          "Event name",
          "Identifies the activation or business event.",
          true,
          "A non-empty event name is required.",
        ),
        field(
          "Owner",
          "Identifies the business owner accountable for demand.",
          true,
          "A non-empty owner value is required.",
        ),
        field(
          "Start date",
          "Sets when event activity begins.",
          true,
          "Use a valid date not after the end date.",
        ),
        field(
          "End date",
          "Sets when event activity ends.",
          true,
          "Use a valid date not before the start date.",
        ),
        field(
          "Location",
          "Links the event to an active event site.",
          true,
          "The selected location must remain active.",
        ),
      ],
    },
    "warehouse-event-detail": {
      controls: [
        control(
          "Back to events",
          "Returns to the event list without changing this event.",
          "Navigation uses the fixed event list route.",
          "The event list opens without a write.",
        ),
        control(
          "Reserve stock",
          "Creates a product reservation for current event demand.",
          "Product and positive available quantity are required.",
          "The new reservation appears on the event.",
        ),
        control(
          "Issue reservation",
          "Opens custody issue for an active event reservation.",
          "Issue authority and outstanding reserved quantity are required.",
          "Recipient and source controls appear.",
        ),
        control(
          "Confirm issue",
          "Commits the event custody issue through the repository.",
          "Recipient, source identity, quantity, and evidence must pass.",
          "Issue movement and custody appear in event history.",
        ),
        control(
          "Cancel reservation",
          "Cancels an active reservation that has not been issued.",
          "The reservation must still be cancellable.",
          "Reserved stock returns to availability.",
        ),
        control(
          "Record return",
          "Opens return disposition for outstanding event custody.",
          "Return authority and outstanding issued quantity are required.",
          "Return controls appear with event context.",
        ),
      ],
      fields: [
        field(
          "Event identifier",
          "Resolves the route to one event record.",
          true,
          "The identifier must match an existing visible event.",
        ),
        field(
          "Product",
          "Selects a product for event reservation.",
          true,
          "The product must have allocatable stock.",
        ),
        field(
          "Reserve quantity",
          "Sets how much stock to reserve.",
          true,
          "Use a positive value within available quantity.",
        ),
        field(
          "Issue quantity",
          "Sets how much reserved stock to issue.",
          true,
          "Use a positive value within remaining reservation.",
        ),
        field(
          "Recipient",
          "Names the person accepting event custody.",
          true,
          "A non-empty recipient is required.",
        ),
        field(
          "Source identity",
          "Selects unit, lot, or bin stock for issue.",
          true,
          "The identity must hold sufficient eligible stock.",
        ),
        field(
          "Assignee",
          "Optionally links event custody to an employee.",
          false,
          "The assignee must be an active profile when selected.",
        ),
      ],
    },
    "warehouse-procurement-planning": {
      controls: [
        control(
          "Filter stock risk",
          "Limits recommendations by current replenishment urgency and availability.",
          "The selected risk state must be supported by planning analytics.",
          "Only matching reorder recommendations remain visible.",
        ),
        control(
          "Open product plan",
          "Opens the selected product record for supply context.",
          "The product identifier must still resolve.",
          "Current stock, supply, and master data appear.",
        ),
        control(
          "Review inbound supply",
          "Opens purchase-order context behind an inbound quantity.",
          "A linked order must exist and remain visible.",
          "Ordered, received, and remaining supply appear.",
        ),
        control(
          "Export planning view",
          "Downloads the authorized planning data currently displayed.",
          "The current role and export scope must be permitted.",
          "A governed planning artifact downloads.",
        ),
      ],
      fields: [
        field(
          "Warehouse",
          "Scopes recommendations to one warehouse site.",
          false,
          "The selected warehouse must be active.",
        ),
        field(
          "Supplier",
          "Limits recommendations to one linked supplier.",
          false,
          "The supplier must exist in planning data.",
        ),
        field(
          "Risk state",
          "Limits products by replenishment urgency.",
          false,
          "Use one supported planning state.",
        ),
        field(
          "Planning horizon",
          "Sets the demand period considered by recommendations.",
          false,
          "Use a positive supported horizon.",
        ),
      ],
    },
    "warehouse-purchase-orders": {
      controls: [
        control(
          "Filter orders",
          "Limits orders by supplier, receipt state, or date.",
          "Filter values must match supported order states.",
          "Only matching purchase orders remain visible.",
        ),
        control(
          "Open order",
          "Opens the selected supply order and its line history.",
          "The order identifier must still resolve.",
          "Current order lines and receipt totals appear.",
        ),
        control(
          "Create order",
          "Opens order creation for warehouse procurement users.",
          "The role needs view_procurement and valid supplier context.",
          "A new order draft form opens.",
        ),
        control(
          "Cancel order",
          "Cancels an eligible unreceived warehouse purchase order.",
          "The order must be cancellable and the actor authorized.",
          "The order status changes to cancelled.",
        ),
        control(
          "Receive order",
          "Opens receiving with the selected eligible order.",
          "The order must be approved with remaining quantity.",
          "Receiving opens with order context selected.",
        ),
      ],
      fields: [
        field(
          "Supplier",
          "Identifies the supplier on the order.",
          true,
          "The supplier must be active and linked.",
        ),
        field(
          "Product",
          "Identifies one ordered product line.",
          true,
          "The product must exist in warehouse master data.",
        ),
        field(
          "Ordered quantity",
          "Records the committed line quantity.",
          true,
          "Use a positive numeric quantity.",
        ),
        field(
          "Expected date",
          "Records expected warehouse arrival.",
          false,
          "Use a valid calendar date.",
        ),
        field(
          "Order status",
          "Shows the controlled order lifecycle state.",
          false,
          "Status changes only through governed actions.",
        ),
        field(
          "Remaining quantity",
          "Shows quantity still eligible for receipt.",
          false,
          "The value is derived from order and receipt lines.",
        ),
      ],
    },
    "warehouse-cycle-counts": {
      controls: [
        control(
          "Select count scope",
          "Loads expected stock for the chosen location and category.",
          "The location must be active and countable.",
          "Eligible count lines appear in the draft.",
        ),
        control(
          "Toggle blind count",
          "Hides expected quantities while physical counts are entered.",
          "The toggle changes display only, not ledger data.",
          "Expected values remain concealed until review.",
        ),
        control(
          "Show variances only",
          "Filters count lines to entries with physical variance.",
          "Physical quantities must exist before variance filtering.",
          "Only mismatched count lines remain.",
        ),
        control(
          "Confirm uncounted lines",
          "Acknowledges submission with lines that lack physical counts.",
          "The user must explicitly confirm the incomplete scope.",
          "Submission may continue with an auditable exception.",
        ),
        control(
          "Submit count",
          "Saves physical counts and routes material variance for approval.",
          "Scope, quantities, and required reasons or evidence must pass.",
          "The count receives its governed next status.",
        ),
      ],
      fields: [
        field(
          "Location",
          "Selects the bin or location being counted.",
          true,
          "The location must be active and visible.",
        ),
        field(
          "Category",
          "Optionally narrows products within count scope.",
          false,
          "The category must be supported when selected.",
        ),
        field(
          "Physical quantity",
          "Records observed stock for one count line.",
          true,
          "Use a non-negative whole or supported decimal quantity.",
        ),
        field(
          "Variance reason",
          "Explains a difference from expected stock.",
          false,
          "A material non-zero variance requires a reason.",
        ),
        field(
          "Evidence",
          "Links proof supporting the physical count.",
          false,
          "Evidence is required when route policy demands it.",
        ),
      ],
    },
    "warehouse-quality": {
      controls: [
        control(
          "Open inspection",
          "Loads a pending receipt or return into the inspection sheet.",
          "The item must still require inspection.",
          "Checklist and disposition controls appear.",
        ),
        control(
          "Accept stock",
          "Records an acceptable inspection outcome for eligible stock.",
          "Required checklist items must pass.",
          "Stock becomes available or continues putaway.",
        ),
        control(
          "Place hold",
          "Records a quality hold and removes stock from availability.",
          "A reason and required evidence must be present.",
          "Held stock appears in the control queue.",
        ),
        control(
          "Release hold",
          "Releases eligible held stock after authorized review.",
          "The role needs release_quality_hold and corrective evidence.",
          "The hold closes and stock state updates.",
        ),
        control(
          "Reject stock",
          "Records rejection or vendor-return disposition.",
          "A reason and supporting evidence are required.",
          "Rejected stock remains unavailable and routed.",
        ),
      ],
      fields: [
        field(
          "Inspection item",
          "Identifies stock requiring a quality decision.",
          true,
          "The item must link to a receipt or return.",
        ),
        field(
          "Checklist result",
          "Records observed compliance for one check.",
          true,
          "Every required check needs an outcome.",
        ),
        field(
          "Disposition",
          "Selects accept, hold, reject, or vendor return.",
          true,
          "The value must match inspection findings.",
        ),
        field(
          "Reason",
          "Explains adverse quality decisions.",
          false,
          "Hold and reject outcomes require a reason.",
        ),
        field(
          "Evidence",
          "Links photographs or files supporting the decision.",
          false,
          "Adverse outcomes require valid evidence.",
        ),
      ],
    },
    "warehouse-approvals": {
      controls: [
        control(
          "Open approval",
          "Loads a pending stock-change request into the decision sheet.",
          "The request must remain pending and visible.",
          "Source count, value, and evidence appear.",
        ),
        control(
          "Approve change",
          "Records approval for an eligible inventory adjustment.",
          "The actor needs approve_stock_adjustment and current authority.",
          "The adjustment may post and history records the decision.",
        ),
        control(
          "Reject change",
          "Records rejection with a specific decision reason.",
          "A non-empty reason is required for rejection.",
          "The request closes without posting the adjustment.",
        ),
        control(
          "Close decision",
          "Dismisses the sheet without recording a decision.",
          "No pending mutation may be in progress.",
          "The approval queue remains unchanged.",
        ),
      ],
      fields: [
        field(
          "Approval request",
          "Identifies the proposed inventory change.",
          true,
          "The request must remain pending.",
        ),
        field(
          "Decision",
          "Selects approval or rejection.",
          true,
          "Only supported terminal decisions are accepted.",
        ),
        field(
          "Decision reason",
          "Explains the approver conclusion.",
          false,
          "Rejection requires a non-empty reason.",
        ),
      ],
    },
    "warehouse-exceptions": {
      controls: [
        control(
          "Filter exceptions",
          "Limits the queue by severity, type, owner, or state.",
          "Filter values must match supported exception metadata.",
          "Only matching exception rows remain.",
        ),
        control(
          "Open exception",
          "Loads the selected exception and linked source context.",
          "The exception must still exist and remain visible.",
          "Failure details and resolution history appear.",
        ),
        control(
          "Resolve exception",
          "Records a controlled resolution for the selected exception.",
          "The role needs resolve_exceptions plus reason and evidence when required.",
          "The exception closes with actor and outcome.",
        ),
        control(
          "Reopen exception",
          "Returns a resolved exception to investigation when the issue persists.",
          "A valid unresolved condition and reason are required.",
          "The exception returns to an open state.",
        ),
      ],
      fields: [
        field(
          "Severity",
          "Classifies operational impact for queue prioritization.",
          false,
          "Use one supported severity value.",
        ),
        field(
          "Exception type",
          "Identifies the failed warehouse control category.",
          true,
          "The type comes from the originating command.",
        ),
        field(
          "Resolution",
          "Records the corrective outcome selected by the resolver.",
          true,
          "A supported resolution is required for closure.",
        ),
        field(
          "Resolution reason",
          "Explains why the selected outcome is correct.",
          true,
          "A non-empty reason is required for closure.",
        ),
      ],
    },
    "warehouse-finance": {
      controls: [
        control(
          "Review next payment pack",
          "Opens the next procurement payment-readiness record awaiting Finance review.",
          "The user needs Procurement Finance scope and the purchase order must remain visible.",
          "The owning procurement record opens with its current evidence and decision state.",
        ),
        control(
          "Filter cross-module activity",
          "Limits the activity table to purchase orders, receipts, returns, or all supported records.",
          "The selected segment must be one of the displayed activity types.",
          "The table updates without changing source records.",
        ),
        control(
          "Open source record",
          "Navigates from a payment or activity row to the procurement or warehouse record that owns the transaction.",
          "The user's scoped role and source-row policy must permit the record.",
          "The source workflow opens for an attributable review or decision.",
        ),
        control(
          "Retry unavailable sources",
          "Reloads the Finance read models when one or more sources report an error.",
          "Retry only after checking whether valid partial data is already visible.",
          "Available sources remain visible and recovered sources rejoin the combined view.",
        ),
      ],
      fields: [
        field(
          "Activity source",
          "Limits the financial trail to all activity, purchase orders, receipts, or returns.",
          false,
          "Use one of the supported source segments shown in the Finance workspace.",
        ),
      ],
    },
    "warehouse-pricing": {
      controls: [
        control(
          "Filter products",
          "Limits pricing rows by product, category, or margin state.",
          "Filter values must match loaded product data.",
          "Only matching pricing rows remain.",
        ),
        control(
          "Open price editor",
          "Loads current price and cost context for one product.",
          "The role needs set_pricing and the product must exist.",
          "A dated price revision form appears.",
        ),
        control(
          "Save price",
          "Persists the proposed dated price revision.",
          "Price, effective date, and reason must pass validation.",
          "The new revision appears in price history.",
        ),
        control(
          "Cancel edit",
          "Closes the price editor without saving changes.",
          "No save request may be in progress.",
          "Current price history remains unchanged.",
        ),
      ],
      fields: [
        field(
          "Product",
          "Identifies the product receiving a price revision.",
          true,
          "The product must exist and remain editable.",
        ),
        field(
          "Current price",
          "Shows the effective price before revision.",
          false,
          "The value is read-only and history-derived.",
        ),
        field(
          "Proposed price",
          "Sets the monetary value for the new revision.",
          true,
          "Use a non-negative numeric amount.",
        ),
        field(
          "Effective date",
          "Sets when the proposed price becomes active.",
          true,
          "Use a valid calendar date.",
        ),
        field(
          "Change reason",
          "Explains the business basis for the revision.",
          true,
          "A non-empty trimmed reason is required.",
        ),
      ],
    },
    "warehouse-data": {
      controls: [
        control(
          "Export inventory",
          "Downloads current inventory through the governed CSV helper.",
          "The role needs view_analytics and loaded inventory data.",
          "A timestamped inventory CSV downloads.",
        ),
        control(
          "Export movements",
          "Downloads current movement history through the governed CSV helper.",
          "The role needs view_analytics and loaded movements.",
          "A timestamped movements CSV downloads.",
        ),
        control(
          "Export allocations",
          "Downloads current allocation history through the governed CSV helper.",
          "The role needs view_analytics and loaded allocations.",
          "A timestamped allocations CSV downloads.",
        ),
        control(
          "Export inventory position",
          "Requests the committed inventory-position report export.",
          "The export endpoint must authorize the selected report.",
          "The governed inventory-position artifact downloads.",
        ),
        control(
          "Export quality",
          "Requests the quality-control report export.",
          "The export endpoint must authorize quality data.",
          "The governed quality artifact downloads.",
        ),
        control(
          "Export cycle counts",
          "Requests the cycle-count report export.",
          "The export endpoint must authorize count data.",
          "The governed cycle-count artifact downloads.",
        ),
      ],
      fields: [
        field(
          "Export type",
          "Identifies the dataset requested by an export button.",
          true,
          "The type must match one supported governed export.",
        ),
        field(
          "Current data scope",
          "Describes records loaded for local CSV generation.",
          false,
          "Only authorized loaded records may be exported.",
        ),
        field(
          "Generation state",
          "Shows whether an export is idle, running, complete, or failed.",
          false,
          "State is controlled by the active export request.",
        ),
      ],
    },
    "warehouse-reports": {
      controls: [
        control(
          "Select report",
          "Chooses the governed inventory report to prepare.",
          "The report type must be available to the current role.",
          "Report-specific filters and columns appear.",
        ),
        control(
          "Apply report filters",
          "Recalculates rows for the selected warehouse and as-of scope.",
          "Required scope fields must contain valid values.",
          "The report preview reflects the selected scope.",
        ),
        control(
          "Generate report",
          "Builds the selected report from current governed records.",
          "Report type and required filters must be complete.",
          "A report preview with generation context appears.",
        ),
        control(
          "Export CSV",
          "Downloads the generated report in comma-separated format.",
          "A current generated report and export authority are required.",
          "A governed CSV artifact downloads.",
        ),
        control(
          "Clear report",
          "Resets report filters and preview without changing source records.",
          "No generation request may still be running.",
          "The report workspace returns to its initial state.",
        ),
      ],
      fields: [
        field(
          "Report type",
          "Selects the inventory report definition.",
          true,
          "The value must match a supported report.",
        ),
        field(
          "Warehouse",
          "Scopes report rows to a warehouse.",
          false,
          "The warehouse must be active when selected.",
        ),
        field(
          "As-of date",
          "Sets the reporting cutoff date.",
          true,
          "Use a valid date within available history.",
        ),
        field(
          "Stock state",
          "Optionally limits report rows by availability state.",
          false,
          "Use one supported stock state.",
        ),
        field(
          "Format",
          "Selects the available artifact format.",
          true,
          "Only enabled report formats may be chosen.",
        ),
        field(
          "Report title",
          "Shows the generated report identity and scope.",
          false,
          "The title is generated and cannot be edited.",
        ),
      ],
    },
    "warehouse-suppliers": {
      controls: [
        control(
          "Search suppliers",
          "Filters supplier rows by name or linked product.",
          "The query is trimmed and does not change supplier data.",
          "Matching supplier rows remain visible.",
        ),
        control(
          "Filter accreditation",
          "Limits suppliers by current accreditation state.",
          "The selected state must be supported by supplier data.",
          "Only matching supplier records remain.",
        ),
        control(
          "Open supplier",
          "Opens the selected supplier planning record.",
          "The supplier identifier must resolve.",
          "Lead time, products, and supply history appear.",
        ),
        control(
          "Save planning values",
          "Persists authorized warehouse planning fields for the supplier.",
          "Lead time and linked values must pass numeric and reference checks.",
          "Updated planning values appear after reload.",
        ),
      ],
      fields: [
        field(
          "Supplier name",
          "Identifies the governed vendor-linked supplier.",
          true,
          "The name is read from the linked supplier record.",
        ),
        field(
          "Accreditation state",
          "Shows current legal eligibility for supply.",
          false,
          "The value is read-only and Legal-owned.",
        ),
        field(
          "Lead time",
          "Records expected supply delay in days.",
          false,
          "Use a non-negative whole number.",
        ),
        field(
          "Linked product",
          "Associates supply planning with a product.",
          false,
          "The product must exist when linked.",
        ),
        field(
          "Active state",
          "Shows whether warehouse planning may use the supplier.",
          true,
          "Blocked or expired suppliers cannot be treated as eligible.",
        ),
      ],
    },
    "warehouse-locations": {
      controls: [
        control(
          "Create location",
          "Opens a blank warehouse or event-location form.",
          "The current role needs manage_locations capability.",
          "A local draft opens without creating a record.",
        ),
        control(
          "Edit location",
          "Loads an existing location into the editor.",
          "The location must exist and remain editable.",
          "Current location fields appear for review.",
        ),
        control(
          "Save location",
          "Persists validated location master data through the repository.",
          "Code, name, type, and required address context must pass.",
          "The location appears with saved values.",
        ),
        control(
          "Deactivate location",
          "Prevents future use of an eligible empty location.",
          "No stock, open event, or active route may depend on it.",
          "The location becomes inactive without moving records.",
        ),
      ],
      fields: [
        field(
          "Location code",
          "Provides the unique operational location identifier.",
          true,
          "The code must be non-empty and unique.",
        ),
        field(
          "Location name",
          "Provides the readable site name.",
          true,
          "A non-empty trimmed name is required.",
        ),
        field(
          "Location type",
          "Classifies warehouse or event-site behavior.",
          true,
          "Use one supported location type.",
        ),
        field(
          "Address",
          "Records the physical location description.",
          false,
          "The value is trimmed before saving.",
        ),
        field(
          "Time zone",
          "Sets local time interpretation for the site.",
          false,
          "Use a supported IANA time-zone value.",
        ),
        field(
          "Active state",
          "Controls future availability in workflows.",
          true,
          "Dependencies must be resolved before deactivation.",
        ),
      ],
    },
    "warehouse-imports": {
      controls: [
        control(
          "Choose file",
          "Loads a CSV file into the local import parser.",
          "The file must meet supported type and size limits.",
          "Headers and rows become available for validation.",
        ),
        control(
          "Validate import",
          "Checks headers, identifiers, references, values, and duplicates.",
          "An import type and parseable file are required.",
          "Row-level errors and valid counts appear.",
        ),
        control(
          "Preview rows",
          "Shows parsed values before any governed write occurs.",
          "The file must parse successfully.",
          "The user can inspect normalized rows and errors.",
        ),
        control(
          "Commit import",
          "Sends the validated payload to the protected import API.",
          "All blocking validation errors and confirmation requirements must pass.",
          "An import job records created rows and failures.",
        ),
        control(
          "Download errors",
          "Downloads row-level validation or import failures.",
          "At least one error row must exist.",
          "A diagnostic CSV downloads without changing data.",
        ),
      ],
      fields: [
        field(
          "Import type",
          "Selects master data or opening-balance schema.",
          true,
          "The type must match a supported import contract.",
        ),
        field(
          "CSV file",
          "Provides the source bytes for parsing and hashing.",
          true,
          "Use a valid CSV within configured size limits.",
        ),
        field(
          "Header mapping",
          "Maps incoming columns to governed fields.",
          true,
          "Every required target field needs one source column.",
        ),
        field(
          "Reason",
          "Explains why the controlled import is required.",
          true,
          "A non-empty reason is required before commit.",
        ),
        field(
          "Confirmation",
          "Acknowledges the validated import impact.",
          true,
          "Commit remains disabled until explicitly confirmed.",
        ),
        field(
          "Row status",
          "Shows valid or failed state for each parsed row.",
          false,
          "Status is validator-derived and read-only.",
        ),
      ],
    },
    "warehouse-operation-routes": {
      controls: [
        control(
          "Create route",
          "Opens a blank movement-policy route editor.",
          "The current role needs manage_operation_routes capability.",
          "A local route draft opens.",
        ),
        control(
          "Edit route",
          "Loads an existing operation route into the editor.",
          "The route must exist and remain editable.",
          "Current safeguards appear for review.",
        ),
        control(
          "Save route",
          "Persists validated movement policy through the repository.",
          "Operation, source, destination, and safeguards must pass.",
          "The route appears with saved policy values.",
        ),
        control(
          "Toggle route",
          "Activates or deactivates an eligible operation route.",
          "The change must not bypass required operational controls.",
          "Future commands use the new active state.",
        ),
        control(
          "Delete draft route",
          "Removes an unused draft route from configuration.",
          "Active or referenced routes cannot be deleted.",
          "The unused draft no longer appears.",
        ),
      ],
      fields: [
        field(
          "Operation",
          "Selects the stock movement type governed by the route.",
          true,
          "Use one supported operation type.",
        ),
        field(
          "Source",
          "Selects the origin state or location.",
          true,
          "Source must exist and differ from destination.",
        ),
        field(
          "Destination",
          "Selects the target state or location.",
          true,
          "Destination must exist and differ from source.",
        ),
        field(
          "Evidence required",
          "Controls whether proof is mandatory before movement.",
          true,
          "Restricted transitions must retain evidence requirements.",
        ),
        field(
          "Approval required",
          "Controls whether named approval precedes movement.",
          true,
          "Material transitions must retain required approval.",
        ),
        field(
          "Online only",
          "Blocks execution while offline for sensitive routes.",
          true,
          "High-risk non-idempotent actions should remain online only.",
        ),
        field(
          "Active state",
          "Controls whether future commands may select the route.",
          true,
          "Only validated routes may be activated.",
        ),
        field(
          "Policy reason",
          "Explains the operational basis for route safeguards.",
          true,
          "A non-empty reason is required for governed changes.",
        ),
      ],
    },
    "procurement-requests": {
      controls: [
        control(
          "Create request",
          "Opens the purchase-request wizard for authorized requesters.",
          "The role needs create_request before the action is visible.",
          "A blank governed request draft opens.",
        ),
        control(
          "Filter status",
          "Filters request rows using the selected KPI status card.",
          "The filter must match a supported request status bucket.",
          "Only matching request rows remain visible.",
        ),
        control(
          "Open request",
          "Navigates to the selected request detail record.",
          "The request must remain visible under row-level access.",
          "Current request facts and activity appear.",
        ),
      ],
      fields: [
        field(
          "Status filter",
          "Selects all, draft, review, approved, or rejected requests.",
          false,
          "The URL value must match a supported filter.",
        ),
        field(
          "Request row",
          "Shows title, status, vendor, amount, need date, and creation date.",
          false,
          "Values are read-only projections of the request record.",
        ),
      ],
    },
    "procurement-request-create": {
      controls: [
        control(
          "Next step",
          "Advances the wizard after current-step validation succeeds.",
          "All required fields on the current step must pass.",
          "The next request section becomes active.",
        ),
        control(
          "Previous step",
          "Returns to the prior wizard section without discarding entered values.",
          "The wizard must not already be on its first step.",
          "The prior section opens with draft values preserved.",
        ),
        control(
          "Add line",
          "Adds a blank purchase line to the draft request.",
          "The current draft must remain editable.",
          "A new line row appears for completion.",
        ),
        control(
          "Save draft",
          "Persists the current request without submitting it for approval.",
          "Minimum draft identity and valid entered values are required.",
          "A draft request record is created or updated.",
        ),
        control(
          "Submit request",
          "Persists and submits the route-confirmed request snapshot.",
          "Wizard readiness, required documents, and confirmed route must pass.",
          "The request enters the approval workflow.",
        ),
      ],
      fields: [
        field(
          "Title",
          "Summarizes the requested business need.",
          true,
          "A non-empty trimmed title is required.",
        ),
        field(
          "Department",
          "Identifies the requesting department.",
          true,
          "A non-empty department is required.",
        ),
        field(
          "Cost center",
          "Links the request to budget ownership context.",
          false,
          "The value is trimmed before saving.",
        ),
        field(
          "Category",
          "Selects the procurement policy category.",
          true,
          "The category must match a supported policy value.",
        ),
        field(
          "Needed date",
          "Records when goods or services are required.",
          false,
          "Use a valid calendar date.",
        ),
        field(
          "Description",
          "Explains the business requirement and scope.",
          true,
          "A meaningful non-empty description is required.",
        ),
        field(
          "Line description",
          "Identifies one requested good or service.",
          true,
          "Every line requires a non-empty description.",
        ),
        field(
          "Quantity",
          "Sets the requested line quantity.",
          true,
          "Use a positive numeric quantity.",
        ),
        field(
          "Unit price",
          "Provides the estimated unit value.",
          false,
          "When entered, use a non-negative amount.",
        ),
        field(
          "Sourcing method",
          "Records the confirmed procurement route.",
          true,
          "The route must match policy or carry an authorized override.",
        ),
        field(
          "Vendor",
          "Optionally identifies the proposed vendor.",
          false,
          "The vendor must exist and satisfy applicable accreditation gates.",
        ),
        field(
          "Attachment",
          "Links evidence required by the selected route.",
          false,
          "Required document kinds must be present before submission.",
        ),
      ],
    },
    "procurement-request-detail": {
      controls: [
        control(
          "Confirm sourcing route",
          "Records the officer-selected route and risk facts.",
          "The actor needs manage_rfp and current request data.",
          "The request stores a confirmed policy route.",
        ),
        control(
          "Submit for approval",
          "Submits an eligible requester-owned draft into the ladder.",
          "Readiness and required-document checks must pass.",
          "The request enters submitted or review state.",
        ),
        control(
          "Cancel request",
          "Cancels an eligible requester-owned draft.",
          "The request must still be draft and owned by the user.",
          "The request closes as cancelled.",
        ),
        control(
          "Author purchase order",
          "Creates a PO draft from an approved request.",
          "The actor needs author_po and an assigned eligible vendor.",
          "A linked PO draft opens.",
        ),
        control(
          "Open attachment",
          "Creates a governed URL for one request attachment.",
          "The attachment must belong to the visible request.",
          "The authorized attachment opens without exposing its storage path.",
        ),
      ],
      fields: [
        field(
          "Request identifier",
          "Resolves the detail route to one request.",
          true,
          "The identifier must match a visible request.",
        ),
        field(
          "Sourcing method",
          "Shows or selects the governed procurement route.",
          true,
          "Changes require manage_rfp and policy validation.",
        ),
        field(
          "Risk facts",
          "Records facts used by sourcing recommendation logic.",
          true,
          "Each boolean fact must reflect the current requirement.",
        ),
        field(
          "Attachment",
          "Shows evidence linked to submit readiness.",
          false,
          "The attachment kind and request ownership must match.",
        ),
      ],
    },
    "procurement-approvals": {
      controls: [
        control(
          "Open decision",
          "Loads the assigned approval step into the decision sheet.",
          "The step must be pending for the current tier or user.",
          "Request evidence and decision controls appear.",
        ),
        control(
          "Approve request",
          "Records approval for the current ladder step.",
          "The actor needs approval capability or resolved tier authority.",
          "The step closes and the next tier may activate.",
        ),
        control(
          "Reject request",
          "Records rejection for the current ladder step.",
          "A specific decision note is required.",
          "The request closes as rejected.",
        ),
        control(
          "Close decision",
          "Dismisses the sheet without recording an approval outcome.",
          "No decision request may be in progress.",
          "The pending inbox item remains unchanged.",
        ),
      ],
      fields: [
        field(
          "Approval item",
          "Identifies the assigned request and ladder tier.",
          true,
          "The item must remain pending and visible.",
        ),
        field(
          "Decision note",
          "Explains the approver decision.",
          false,
          "Rejection requires a non-empty note.",
        ),
      ],
    },
    "procurement-purchase-orders": {
      controls: [
        control(
          "Author purchase order",
          "Opens an eligible approved request for PO authoring.",
          "The actor needs author_po and an approved source request.",
          "A PO draft is created from governed request lines.",
        ),
        control(
          "Filter orders",
          "Limits purchase orders by status or readiness context.",
          "The filter must match a supported PO state.",
          "Only matching purchase orders remain visible.",
        ),
        control(
          "Open purchase order",
          "Navigates to the selected PO detail record.",
          "The order must remain visible under current capabilities.",
          "Terms, lifecycle, and readiness evidence appear.",
        ),
      ],
      fields: [
        field(
          "Order status",
          "Selects or shows the controlled PO lifecycle state.",
          false,
          "Status changes only through governed actions.",
        ),
        field(
          "Purchase-order row",
          "Shows number, supplier, value, source request, and status.",
          false,
          "Values are read-only projections of the PO record.",
        ),
      ],
    },
    "procurement-po-detail": {
      controls: [
        control(
          "Approve award",
          "Approves an eligible draft PO award.",
          "The actor needs approve_award and accreditation and source-award gates must pass.",
          "The PO becomes approved for issue.",
        ),
        control(
          "Issue order",
          "Records supplier issue for an approved PO.",
          "The actor needs author_po and required terms must be complete.",
          "The PO becomes issued with actor and time.",
        ),
        control(
          "Cancel order",
          "Cancels an eligible PO before disallowed downstream activity.",
          "The order must remain cancellable and the actor authorized.",
          "The PO closes as cancelled.",
        ),
        control(
          "Record acceptance",
          "Records requester business acceptance for received supply.",
          "The source requester and receipt evidence are required.",
          "The acceptance pack appears on the PO.",
        ),
        control(
          "Prepare payment",
          "Assembles receipt, acceptance, and invoice readiness evidence.",
          "The actor needs author_po and required matching evidence.",
          "A payment-readiness pack is prepared.",
        ),
        control(
          "Review payment",
          "Records finance review of the prepared readiness pack.",
          "The actor needs view_finance and a complete pack.",
          "Finance review status and reason are recorded.",
        ),
      ],
      fields: [
        field(
          "Purchase-order identifier",
          "Resolves the detail route to one PO.",
          true,
          "The identifier must match a visible order.",
        ),
        field(
          "Supplier",
          "Shows the governed supplier receiving the order.",
          true,
          "The supplier must match the approved request and accreditation.",
        ),
        field(
          "Order line",
          "Shows quantity, unit, price, and description for one line.",
          true,
          "Line values must derive from the approved source request.",
        ),
        field(
          "Acceptance evidence",
          "Records requester confirmation of received value.",
          false,
          "Acceptance requires linked receipt evidence.",
        ),
        field(
          "Payment review note",
          "Explains finance readiness approval or rejection.",
          false,
          "A rejection requires a non-empty note.",
        ),
      ],
    },
    "legal-cases": {
      controls: [
        control(
          "Filter case status",
          "Limits case cards by current accreditation lifecycle state.",
          "The selected filter must match a supported case status.",
          "Only matching cases remain visible.",
        ),
        control(
          "Clear case filter",
          "Returns the case queue to all current records.",
          "The current filter may be any supported value.",
          "All visible legal cases return.",
        ),
        control(
          "Open case",
          "Navigates to the selected legal accreditation record.",
          "The case must remain visible to the internal Legal session.",
          "Checklist, documents, and decision context appear.",
        ),
      ],
      fields: [
        field(
          "Case status",
          "Selects the accreditation lifecycle bucket.",
          false,
          "The value must match a supported case status.",
        ),
        field(
          "Case card",
          "Shows vendor, owner, progress, risk, and due context.",
          false,
          "Values are read-only projections of the legal case.",
        ),
      ],
    },
    "legal-case-detail": {
      controls: [
        control(
          "Open application",
          "Opens the submitted vendor application snapshot for review.",
          "The case must contain a visible application record.",
          "Application facts appear read-only for Legal.",
        ),
        control(
          "Open checklist item",
          "Loads requirement evidence and review controls.",
          "The actor needs review_accreditation and the item must exist.",
          "Evidence, policy guidance, and decision controls appear.",
        ),
        control(
          "Approve evidence",
          "Records acceptance of one checklist evidence item.",
          "The actor needs review_accreditation and evidence must be sufficient.",
          "The item becomes approved with review history.",
        ),
        control(
          "Request correction",
          "Returns one requirement to the vendor with a specific issue.",
          "A non-empty correction reason is required.",
          "The item and case show correction required.",
        ),
        control(
          "Approve case",
          "Records final accreditation approval after all gates pass.",
          "The actor needs approve_accreditation and every required gate must pass.",
          "The case becomes approved with decision history.",
        ),
        control(
          "Reject case",
          "Records final rejection with a governed reason.",
          "The actor needs approve_accreditation and a non-empty reason.",
          "The case becomes rejected without hiding prior evidence.",
        ),
      ],
      fields: [
        field(
          "Case identifier",
          "Resolves the route to one accreditation case.",
          true,
          "The identifier must match a visible case.",
        ),
        field(
          "Checklist decision",
          "Records reviewer acceptance or correction outcome.",
          true,
          "The value must match an allowed review state.",
        ),
        field(
          "Review note",
          "Explains evidence or case decisions.",
          false,
          "Correction and rejection require meaningful notes.",
        ),
        field(
          "Decision status",
          "Shows the governed final accreditation outcome.",
          false,
          "Status is changed only by authorized decision controls.",
        ),
      ],
    },
    "legal-case-application": {
      controls: [
        control(
          "Back to case",
          "Returns to legal case detail without editing vendor facts.",
          "Navigation must retain the current case identifier.",
          "The legal case page opens without a write.",
        ),
        control(
          "Review section",
          "Expands the selected application section for detailed inspection.",
          "The submitted snapshot and section must exist.",
          "Submitted facts and evidence references appear.",
        ),
      ],
      fields: [
        field(
          "Application section",
          "Identifies a submitted company or risk section.",
          true,
          "The section must exist in the immutable snapshot.",
        ),
        field(
          "Declared value",
          "Shows the vendor answer captured at submission.",
          false,
          "The value is read-only for internal Legal users.",
        ),
        field(
          "Submission version",
          "Shows which policy and snapshot version is under review.",
          true,
          "The version must match the case submission record.",
        ),
      ],
    },
    "legal-sign-instrument": {
      controls: [
        control(
          "Back to legal case",
          "Returns to case detail without creating a signature.",
          "Navigation must retain the current case identifier.",
          "The case opens and signature state remains unchanged.",
        ),
        control(
          "Review signed record",
          "Displays existing party signatures and document hash evidence.",
          "The instrument and signature records must match this case and code.",
          "Signer, version, hash, and time are visible.",
        ),
      ],
      fields: [
        field(
          "Instrument code",
          "Resolves the legal template within the case route.",
          true,
          "The code must match a supported instrument.",
        ),
        field(
          "Template version",
          "Shows the exact legal text version under review.",
          true,
          "The version is immutable for existing signatures.",
        ),
        field(
          "Signature status",
          "Shows vendor and MPHTC execution progress.",
          false,
          "Status is derived from valid non-revoked signatures.",
        ),
      ],
    },
    "legal-invite-vendor": {
      controls: [
        control(
          "Send invitation",
          "Calls the protected invitation API with verified vendor facts.",
          "All required identity and risk fields plus manage_checklist authority must pass.",
          "Vendor, case, profile link, and invitation result are recorded.",
        ),
        control(
          "Reset invitation form",
          "Clears unsent vendor facts from local form state.",
          "No invitation request may be in progress.",
          "The blank invitation form remains with no write.",
        ),
        control(
          "Back to cases",
          "Returns to the Legal case queue without sending an invitation.",
          "Navigation uses the fixed internal legal route.",
          "The case queue opens and no vendor is created.",
        ),
      ],
      fields: [
        field(
          "Company name",
          "Records the vendor legal or trading name.",
          true,
          "A non-empty trimmed company name is required.",
        ),
        field(
          "Vendor email",
          "Identifies the external invitation recipient.",
          true,
          "Use a valid non-employee email not already assigned.",
        ),
        field(
          "Category",
          "Selects the vendor service or supply category.",
          true,
          "Use one supported accreditation category.",
        ),
        field(
          "Jurisdiction",
          "Records the vendor legal jurisdiction.",
          true,
          "A non-empty jurisdiction is required.",
        ),
        field(
          "Entity type",
          "Records the vendor legal entity classification.",
          true,
          "Use one supported entity type.",
        ),
        field(
          "Risk level",
          "Records the onboarding risk classification.",
          true,
          "Use one supported risk value.",
        ),
        field(
          "Contract context",
          "Records expected contractual relationship facts.",
          false,
          "Provided values must match supported form options.",
        ),
        field(
          "Data handling",
          "Records whether vendor service processes sensitive data.",
          true,
          "The risk question requires an explicit answer.",
        ),
      ],
    },
    "vendor-cases": {
      controls: [
        control(
          "Open own case",
          "Navigates to the vendor-scoped accreditation case.",
          "The case vendor identifier must match the signed-in vendor profile.",
          "The vendor sees only its own checklist and actions.",
        ),
        control(
          "Sign out vendor",
          "Ends the vendor session and returns to sign in.",
          "The current authentication session must be active.",
          "The session closes without changing accreditation data.",
        ),
      ],
      fields: [
        field(
          "Vendor identity",
          "Shows the company identity bound to the session.",
          true,
          "The profile vendor identifier controls every visible record.",
        ),
        field(
          "Case status",
          "Shows current own-case lifecycle state and next action.",
          false,
          "The value is read-only and case-derived.",
        ),
      ],
    },
    "vendor-case-detail": {
      controls: [
        control(
          "Open application",
          "Opens the vendor-editable application for this own case.",
          "The case must belong to the signed-in vendor and remain editable.",
          "Saved application facts and required sections appear.",
        ),
        control(
          "Upload evidence",
          "Uploads a requirement document through vendor-scoped storage controls.",
          "The actor needs submit_documents and file rules must pass.",
          "The document appears on the own-case checklist.",
        ),
        control(
          "Submit application",
          "Submits the completed own-case application snapshot for Legal review.",
          "Required facts, documents, and declarations must pass.",
          "The case becomes submitted and draft editing closes.",
        ),
        control(
          "Open instrument",
          "Opens an assigned legal instrument for review or signature.",
          "The instrument must belong to this own case.",
          "The exact template and signature state appear.",
        ),
        control(
          "Replace evidence",
          "Uploads a corrected file for a returned requirement.",
          "The case must request correction and file rules must pass.",
          "The corrected evidence becomes the current submission.",
        ),
      ],
      fields: [
        field(
          "Case identifier",
          "Resolves the route to the vendor own case.",
          true,
          "Ownership must match the signed-in vendor profile.",
        ),
        field(
          "Requirement",
          "Identifies one evidence or instrument obligation.",
          true,
          "The requirement must be applicable to this case policy.",
        ),
        field(
          "Evidence file",
          "Provides the document uploaded for one requirement.",
          false,
          "Required file type and size rules must pass.",
        ),
        field(
          "Declaration",
          "Records vendor acknowledgement before submission.",
          true,
          "Every required declaration needs explicit acceptance.",
        ),
      ],
    },
    "vendor-application": {
      controls: [
        control(
          "Save section",
          "Persists the current vendor application section as a draft.",
          "The case must belong to the vendor and entered values must validate.",
          "Draft answers remain available after reload.",
        ),
        control(
          "Previous section",
          "Returns to the prior application section with draft values preserved.",
          "The application must not already be on its first section.",
          "The prior section opens without a write.",
        ),
        control(
          "Next section",
          "Advances after current required facts pass validation.",
          "All required current-section fields must pass.",
          "The next application section opens.",
        ),
        control(
          "Submit application",
          "Creates the immutable vendor submission snapshot.",
          "All required sections, evidence, and declarations must pass.",
          "The application becomes submitted for Legal review.",
        ),
      ],
      fields: [
        field(
          "Company profile",
          "Records legal name, registration, address, and ownership facts.",
          true,
          "Required company identity values must be complete.",
        ),
        field(
          "Regulatory facts",
          "Records licenses and regulatory standing.",
          true,
          "Required regulatory questions need explicit answers.",
        ),
        field(
          "Service facts",
          "Describes products or services offered to Mwell.",
          true,
          "A meaningful scope description is required.",
        ),
        field(
          "Technology facts",
          "Records system access and technical service characteristics.",
          false,
          "Conditional technology questions apply when relevant.",
        ),
        field(
          "Privacy facts",
          "Records personal and sensitive data handling.",
          true,
          "Every applicable privacy question needs an answer.",
        ),
        field(
          "Risk facts",
          "Records security, continuity, and subcontracting risk.",
          true,
          "Required risk questions need explicit answers.",
        ),
        field(
          "Declaration",
          "Captures vendor truthfulness and authorization acknowledgement.",
          true,
          "All required declarations must be accepted.",
        ),
        field(
          "Submission version",
          "Identifies the requirement policy used for the snapshot.",
          true,
          "The version is system-selected and immutable after submission.",
        ),
      ],
    },
    "vendor-sign-instrument": {
      controls: [
        control(
          "Cancel signature",
          "Returns to the own case without saving a signature.",
          "Navigation must retain own-case ownership.",
          "The case opens with signature state unchanged.",
        ),
        control(
          "Enter signature",
          "Captures a typed or drawn signature payload and signer name.",
          "A valid signature payload and signer identity are required.",
          "The signature preview becomes ready for confirmation.",
        ),
        control(
          "Confirm signature",
          "Saves the signature against the exact template version and hash.",
          "Required disclosures, ownership, and signature payload must pass.",
          "The signed record stores party, method, hash, and time.",
        ),
      ],
      fields: [
        field(
          "Instrument code",
          "Resolves the assigned own-case legal instrument.",
          true,
          "The code must match an applicable template.",
        ),
        field(
          "Disclosure answer",
          "Records required pre-signature instrument facts.",
          false,
          "Every template-required disclosure must be non-empty.",
        ),
        field(
          "Signer name",
          "Identifies the authorized vendor representative.",
          true,
          "A non-empty signer name is required.",
        ),
        field(
          "Signature payload",
          "Carries the typed or drawn electronic signature.",
          true,
          "A valid non-empty signature payload is required.",
        ),
      ],
    },
    "my-work": {
      controls: [
        control(
          "Source filter",
          "Shows only work from the selected department.",
          "The source must be one of the released queue sources.",
          "The queue changes without changing any source record.",
        ),
        control(
          "Open source",
          "Navigates to the authoritative record or queue.",
          "The route must be internal and role-authorized.",
          "The source page opens under the same session.",
        ),
        control(
          "Retry",
          "Reloads the governed personal projection after a read failure.",
          "The retry performs no source write.",
          "Current assignments replace the failed state.",
        ),
      ],
      fields: [
        field(
          "Priority",
          "Shows operational urgency assigned by the source projection.",
          true,
          "Critical and high work sort before normal work.",
        ),
        field(
          "Due time",
          "Shows the source-derived target time when available.",
          false,
          "The timestamp remains tied to the source record.",
        ),
      ],
    },
    "events-workspace": {
      controls: [
        control(
          "New event",
          "Opens event-intent creation for authorized roles.",
          "The user needs the events:create_event capability.",
          "A validated event draft form opens.",
        ),
        control(
          "Create event",
          "Persists the event intent through the governed Warehouse RPC.",
          "Name and start date are required; end date cannot precede start.",
          "The event appears in the lifecycle list.",
        ),
        control(
          "View event",
          "Opens dates, lifecycle, and fulfillment totals.",
          "The event must remain in the caller's readable scope.",
          "The event detail view opens.",
        ),
        control(
          "Open Warehouse fulfillment",
          "Hands physical stock work to Warehouse.",
          "The Warehouse role must authorize the requested stock command.",
          "The authoritative fulfillment view opens.",
        ),
      ],
      fields: [
        field(
          "Event name",
          "Identifies the activation in queues and custody records.",
          true,
          "A non-empty attributable name is required.",
        ),
        field(
          "Event type",
          "Classifies the activation for operations and reporting.",
          true,
          "Choose one released event type.",
        ),
        field(
          "Start date",
          "Sets lifecycle timing and readiness due dates.",
          true,
          "A valid date is required.",
        ),
        field(
          "End date",
          "Sets completion timing for multi-day events.",
          false,
          "It cannot be earlier than the start date.",
        ),
      ],
    },
    "insights-workspace": {
      controls: [
        control(
          "Insight view",
          "Filters indicators to an authorized department or executive view.",
          "Only areas granted by the Insights role are offered.",
          "The visible KPI set changes without a data write.",
        ),
        control(
          "Open governed source",
          "Navigates from a KPI to its accountable workflow.",
          "The destination remains independently role-protected.",
          "The source queue opens for investigation.",
        ),
        control(
          "Retry",
          "Reloads the governed snapshot after a read failure.",
          "The retry cannot alter source data.",
          "Current permitted indicators replace the failed state.",
        ),
      ],
      fields: [
        field(
          "Metric value",
          "Shows the current governed aggregate.",
          true,
          "The value is computed in the database projection.",
        ),
        field(
          "Target",
          "Shows the operating threshold when one is defined.",
          false,
          "The target is descriptive and cannot grant approval authority.",
        ),
      ],
    },
    "vendor-invite-unavailable": {
      controls: [
        control(
          "Return to own case",
          "Navigates away from the internal invitation surface to vendor work.",
          "The destination must remain vendor-scoped.",
          "The vendor own-case page opens without an invitation write.",
        ),
        control(
          "Sign out vendor",
          "Ends the vendor session when the wrong account type was used.",
          "An active vendor session must exist.",
          "The session closes and sign-in opens.",
        ),
      ],
      fields: [
        field(
          "Requested route",
          "Identifies the internal invitation route requested by the vendor.",
          true,
          "The route never grants manage_checklist authority.",
        ),
        field(
          "Access result",
          "Shows that vendor authority cannot create invitations.",
          true,
          "The denial is derived from current role and API policy.",
        ),
      ],
    },
  };
