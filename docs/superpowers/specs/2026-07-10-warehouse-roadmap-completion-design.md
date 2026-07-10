# Mwell Intra Warehouse Roadmap Completion Design

**Date:** 2026-07-10
**Status:** Approved design, pending written-spec review
**Product:** Mwell Intra, Warehouse module
**Source roadmap:** `Mwell_Intra_Feature_Roadmap_and_Cost_Analysis_v5_erp_benchmark_adjusted.xlsx`
**Delivery branch:** `codex/production-readiness-remediation`

## 1. Decision Summary

Mwell Intra will extend the existing Warehouse module into the operational inventory system of record. The work covers every Warehouse Backlog+ capability from WH-001 through WH-060 except WH-037 RFID. It also adds a small set of high-value operational capabilities that improve launch safety and floor ergonomics without turning Mwell Intra into a general ERP.

The approved product decisions are:

- Extend the existing Warehouse module and its authenticated Supabase boundary; do not create a separate WMS or rewrite the application.
- Keep all external system handoffs CSV-based. Do not add live ERP, ecommerce, courier, payment, CRM, invoicing, or BI integrations.
- Add a bounded customer/channel order-to-delivery workflow for manual and CSV demand intake, reservation, picking, packing, issuance/shipping, delivery confirmation, cancellation, and returns.
- Use specific cost for serialized and lot-controlled stock and moving weighted average for bulk stock.
- Allocate landed cost by quantity, value, or weight according to an approved cost allocation record.
- Require risk-based approvals. Material stock changes require supervisor approval; financial exceptions above PHP 10,000 also require Finance approval. Every exception requires a reason and supporting evidence when the policy demands it.
- Show expiry and shelf-life risk, but do not enforce FEFO allocation or block issuance in this release.
- Support safe offline floor work only. Approvals, costing changes, imports, shipment confirmation, and other high-risk operations require a live connection.
- Treat visual quality as a release gate. Desktop, tablet, and mobile states receive three complete visual crawls plus human screenshot review.

## 2. Goals

1. Complete the Warehouse roadmap as one coherent operating system for receiving, storage, quality, allocation, fulfillment, returns, counts, costing, planning, reporting, and audit.
2. Preserve an authoritative, append-only stock movement ledger and ensure every business workflow reconciles to it.
3. Make every consequential transition capability-gated, auditable, idempotent, and safe under concurrent use.
4. Provide ergonomic desktop and mobile experiences for every Warehouse role without horizontal scrolling, overlapping controls, unreachable navigation, or illegible charts.
5. Prove database reads, writes, denials, state progression, and reconciliation through repeatable automated and manual production-readiness tests.
6. Keep the architecture ready for later integrations while shipping CSV import/export handoffs now.

## 3. Non-Goals

- RFID hardware or RFID transaction support.
- Live Odoo, ERP, ecommerce, courier, payment, CRM, accounting, or BI integrations.
- Invoicing, accounts receivable, payment collection, route optimization, or general sales CRM.
- Full workforce scheduling or labor-management optimization.
- IoT sensor ingestion or automated environmental monitoring.
- Mandatory FEFO allocation or expiry-based issuance blocking.
- Autonomous purchasing. Replenishment produces recommendations and governed PO handoffs, not unattended orders.
- A second inventory ledger or a parallel advanced-WMS application.

## 4. Product Principles

### 4.1 Ledger First

The existing Warehouse stock movement ledger remains authoritative for on-hand quantity, location, reservation, issue, return, adjustment, and cost movement. New workflow records reference ledger entries rather than maintaining independent quantity totals.

### 4.2 Server-Authorized State Changes

The browser may request an action, but Supabase RPCs authorize the actor, lock relevant records, validate state and quantity, write the business transition, create movement entries, and append activity evidence atomically.

### 4.3 Exceptions Are Work, Not Warnings

Over-allocation, quantity variance, mismatched returns, damaged stock, late deliveries, import failures, approval delays, and reconciliation differences create owned exception records. Exceptions appear in a common inbox until resolved, waived by an authorized role, or cancelled with evidence.

### 4.4 Floor Work Must Be Fast

Mobile flows prioritize scanning, a single clear next action, large controls, safe-area clearance, and resumable tasks. Dense analysis and batch administration remain desktop-first while still rendering correctly on mobile.

### 4.5 CSV Is a Governed Interface

Imports and exports have versioned schemas, validation reports, row limits, formula-injection protection, checksums, creator/reviewer records where required, and private download authorization. CSV is not an ad hoc browser download or unchecked upload.

## 5. Users, Roles, and Capability Model

Existing authenticated Mwell Intra roles remain the source of identity. Warehouse authorization is expressed as capabilities rather than route-name checks.

| Role lens | Primary work | Key capabilities |
| --- | --- | --- |
| Warehouse Operator | Receive, put away, transfer, pick, pack, issue, return, count | Scan and execute assigned floor tasks; create draft discrepancies; cannot approve own material exception |
| Warehouse Supervisor | Direct operations and resolve exceptions | Assign waves/tasks, approve operational exceptions, release holds when qualified, confirm material adjustments below Finance threshold |
| Inventory Controller | Maintain stock integrity | Count, reconcile, investigate variances, manage operation routes, monitor aging and traceability |
| Procurement User | Supply and PO handoff | View approved demand, create or import PO handoffs, maintain suppliers, respond to replenishment recommendations |
| Finance Reviewer | Cost and reconciliation oversight | Review valuation, landed cost, write-offs, material exceptions above PHP 10,000, and finance reconciliation reports |
| Business Unit Requester | Request and track stock | View authorized availability, submit reservations/orders, follow delivery and return status |
| Marketing/Event Coordinator | Plan campaign inventory | Create events, request kits/items, review issued/returned quantities, import campaign outcomes |
| Auditor/Leadership Viewer | Read-only assurance and analysis | View authorized reports, audit history, KPI definitions, SLA trends, and export evidence |
| Warehouse Administrator | Configure the module | Maintain products, locations, bins, policies, operation types, import templates, customers/channels, and role assignments |

Rules:

- Capabilities are evaluated server-side against authenticated identity and active role assignments.
- Row access is further restricted by organization, site, business unit, and record ownership where applicable.
- Creator and approver must be different people for material exceptions and governed exports that require review.
- A user may hold multiple roles, but separation-of-duties checks still apply to the individual actor.
- Route visibility improves usability but is never treated as authorization.

## 6. Architecture

### 6.1 Existing Boundaries Retained

- `apps/shell` owns authentication, session lifecycle, cross-module navigation, server routes, health checks, and production environment validation.
- `modules/warehouse` owns Warehouse routes, UI workflows, domain models, task orchestration, and repository interfaces.
- `packages/data-kit` owns authenticated repository construction and must fail closed when production Supabase dependencies are unavailable.
- Supabase Auth establishes identity; Postgres, RPCs, RLS, and private Storage enforce data and file access.
- Existing Procurement records remain the source of approved procurement-origin PO state. Warehouse references them through a controlled handoff instead of creating a competing approval workflow.

### 6.2 New Bounded Warehouse Domains

| Domain | Responsibility | Depends on |
| --- | --- | --- |
| Operations | Operation types, routes, floor tasks, scan events, pick waves, packing, chain of custody | Inventory, orders, quality |
| Quality | Inspection, disposition, quarantine/hold, damage, vendor return, recall scope | Inventory, suppliers, evidence |
| Orders | Manual/CSV demand, customer/channel context, reservation, fulfillment, delivery, cancellation, return linkage | Inventory, operations, approvals |
| Kits | Kit definitions, effective dates, component requirements, assembly/disassembly, availability | Product master, inventory, costing |
| Approvals | Configurable risk rules, requests, steps, decisions, escalation, evidence | Identity, policy, activity log |
| Costing | Cost layers, weighted average, specific cost, landed cost allocation, event/promo cost | Inventory ledger, suppliers, Finance |
| Planning | Reorder policy, lead time, projected stockout, event replenishment, ABC/velocity | Inventory history, events, POs |
| Data Governance | Versioned imports, governed exports, BI views, KPI dictionary, ERD, retention | All Warehouse domains |
| Exceptions | Common operational inbox, ownership, SLA, resolution, waiver | All Warehouse domains |

Each domain exposes typed commands and read models. Page components do not assemble stock mutations directly, and repository implementations do not contain presentation logic.

### 6.3 Transaction Pattern

Every consequential command follows this server transaction pattern:

1. Resolve authenticated user and active capabilities.
2. Validate idempotency key and reject conflicting replays.
3. Lock the business record, affected inventory balances, and serialized units in a deterministic order.
4. Validate current state, ownership, quantities, serial/lot identity, approval requirements, and live-connection requirement.
5. Write the business state transition.
6. Write authoritative stock and cost ledger entries when inventory or value changes.
7. Append an immutable activity event with actor, timestamp, prior state, next state, reason, and evidence references.
8. Commit and return the canonical read model.

Failed commands return a stable error code, a safe user-facing explanation, and enough structured context for the UI to preserve work and offer a valid recovery action.

## 7. Core Data Design

Names below are conceptual. The implementation plan will align exact names with existing schemas and migrations.

### 7.1 Configuration and Master Data

- `warehouse.operation_types`: receipt, putaway, transfer, pick, pack, issue/delivery, return, vendor return, count, adjustment, assembly, and disassembly.
- `warehouse.operation_routes`: allowed source/destination location types, required steps, evidence rules, approval policy, and active dates.
- `warehouse.customers` and `warehouse.channels`: bounded fulfillment dimensions, not a CRM.
- `warehouse.kits` and `warehouse.kit_components`: versioned component definitions, quantities, substitutions policy, and effective dates.
- Product additions: tracking method, expiry tracking flag, shelf-life warning days, unit weight, costing method, ABC class override, and channel eligibility.
- Supplier additions: lead time, active state, approved categories, return instructions, and CSV/export identifiers.

### 7.2 Operational Records

- `warehouse.orders` and `warehouse.order_lines`: source, external reference, customer/channel/business unit/event, requested date, priority, status, cancellation reason, and import job.
- `warehouse.reservations`: order/event line, item/variant, lot/serial when assigned, quantity, expiry, state, and allocation policy result.
- `warehouse.waves`, `warehouse.tasks`, and `warehouse.task_scans`: assignment, sequence, status, expected and actual values, device/session, and offline sync identity.
- `warehouse.packages` and `warehouse.handoffs`: package contents, seal/reference, custodian transitions, recipient, timestamps, evidence, and exceptions.
- `warehouse.quality_inspections`: source transaction, inspection results, disposition, hold reason, evidence, and release authority.
- `warehouse.holds`: affected item/lot/serial/location quantity, reason, status, owner, release decision, and recall linkage.
- `warehouse.vendor_returns`: supplier, source receipt/return, items, quantities, reason, disposition, shipment/handoff, and completion state.
- `warehouse.recalls`: scope rule, affected stock, issued stock, contacts/status, recovery outcomes, and closure evidence.

### 7.3 Controls and Finance

- `warehouse.approval_policies`, `approval_requests`, and `approval_steps`: risk criteria, ordered approvers, threshold, creator, decisions, escalation, and evidence.
- `warehouse.cost_layers`: receipt/adjustment source, item/lot/serial, base unit cost, landed cost, remaining quantity, and currency basis.
- `warehouse.landed_costs` and `landed_cost_allocations`: charge type, supplier/reference, allocation basis, eligible receipts, approval, and applied value.
- `warehouse.reconciliation_runs` and lines: stock ledger, quantity balance, cost layer, valuation, discrepancy, owner, resolution, and sign-off.
- `warehouse.exceptions`: type, severity, source record, owner, due date, status, resolution, waiver, approval reference, and activity history.

### 7.4 Planning and Governance

- `warehouse.replenishment_policies` and `replenishment_recommendations`: min/max, reorder point, lead time, review period, forecast basis, event demand, recommendation, and disposition.
- `warehouse.item_classifications`: calculated ABC/velocity class, period, overrides, and effective date.
- `warehouse.import_jobs`, validation rows, and correction jobs: schema version, checksum, uploader, counts, errors, warnings, approval, and applied transaction.
- `warehouse.export_jobs`: dataset, filters, schema version, checksum, private object path, requester, reviewer, correction chain, expiry, and audit events.
- `warehouse.report_subscriptions`: saved report/view, cadence, recipients, next run, status, and generated private report job. Delivery is in-app; external email delivery is outside this scope.

## 8. End-to-End Workflows

### 8.1 Product, Location, Bin, and Opening Stock Setup

1. Administrator creates or imports products, variants, suppliers, sites, storage areas, locations, and bins using versioned templates.
2. Validation checks required fields, duplicate SKU/serial/bin codes, references, tracking method, quantities, costs, and formula injection.
3. The import preview separates errors, warnings, inserts, and updates. No partial apply is allowed for opening balances.
4. An authorized reviewer approves the opening-balance job.
5. The server writes products and locations, then posts opening stock through the stock ledger with cost layers and import lineage.
6. Operations and Finance reconcile imported quantities and values before sign-off.

Negative paths include duplicate serials, unknown locations, negative quantities, invalid costs, stale template versions, oversized files, mixed organizations, reviewer conflict, and interrupted apply.

### 8.2 Procurement-to-Receipt

1. A procurement-origin PO becomes visible only after reaching the configured approved state, or a warehouse-origin exception PO is explicitly identified.
2. Receiving selects the PO, destination route, and delivery reference.
3. Operator scans or selects each line, lot/serial, quantity, expiry when tracked, and evidence.
4. The server rejects duplicate serials, excess quantity without exception, invalid destination, closed PO, unapproved PO, and idempotency conflicts.
5. Accepted quantities enter receiving staging. Items requiring inspection enter hold and are excluded from available stock.
6. QC accepts, damages, holds, or marks items for vendor return.
7. Putaway tasks move accepted stock into a valid bin. The PO handoff and receipt update together.

### 8.3 QC, Hold, Damage, Vendor Return, and Recall

- QC disposition is explicit for received and returned stock: accepted, damaged, hold, vendor return, or unavailable.
- Held, damaged, recalled, and vendor-return stock is excluded from available-to-reserve calculations.
- Releasing a hold requires the capability and evidence defined by policy; the inspector cannot release a material hold they created when separation is required.
- Vendor return preserves supplier, receipt, item, lot/serial, quantity, custody, and completion evidence.
- Recall scope may target product, variant, lot, serial range, supplier, receipt, or date window. The workspace separates on-hand, held, allocated, issued, returned, and unrecovered stock.
- Expiry warnings appear in receiving, inventory, allocation, and planning views. They do not automatically block allocation or issue.

### 8.4 Internal Transfer and Putaway

1. User selects a valid operation route or scans a source task.
2. Source location, destination, item, quantity, and serial/lot are validated.
3. Controlled items may require source and destination scans plus custody confirmation.
4. Material route deviations create approval-backed exceptions.
5. The stock movement and task completion commit atomically.

Offline transfer capture is allowed only for assigned tasks with a recent server snapshot, a unique offline transaction ID, and no approval requirement. Sync conflicts never overwrite newer server state.

### 8.5 Customer/Channel Order to Delivery

1. A requester creates an order manually or uploads the versioned order CSV.
2. Validation resolves customer, channel, business unit, event, products, dates, and duplicate external references.
3. The system calculates available-to-reserve and creates full, partial, or exception-needed reservations.
4. Supervisors review shortage, priority, substitution, and over-allocation exceptions.
5. Approved demand enters one or more pick waves. Operators scan source bin and item/serial.
6. Packing validates picked contents, records package/custody information, and exposes discrepancies before issue.
7. Issue/shipment confirmation posts the movement, releases reservation, records purpose as promotional or sold, and creates a delivery/handoff record.
8. Recipient delivery confirmation closes custody. Failed delivery, cancellation, and return use explicit reversal/return routes rather than deleting history.

The workflow does not create invoices, collect payments, manage sales opportunities, or optimize delivery routes.

### 8.6 Event, Campaign, Kit, and Replenishment Flow

1. Event coordinator creates an event with dates, site, business unit/channel, expected audience, and requested items or kits.
2. Kit demand explodes into component requirements using the effective kit version without losing the kit-level reporting reference.
3. Existing reservations, on-hand stock, expiry warnings, open POs, lead times, and historical event consumption feed a replenishment recommendation.
4. Procurement accepts, edits with reason, defers, or rejects the recommendation and creates a CSV/manual PO handoff.
5. Warehouse fulfills the event through the order flow and scans issuance to event/recipient targets.
6. Returns are validated against issued items. Missing, mismatched, damaged, and excess returns create exceptions.
7. Event closeout reports requested, reserved, issued, returned, consumed, damaged, unrecovered, promotional/sold, and cost totals.
8. Campaign outcome CSV may be imported and joined to the event for comparison. No live marketing-system integration is added.

### 8.7 Cycle Count and Adjustment

1. Inventory Controller schedules count scope by site, bin, category, item, lot, or serialized unit.
2. Counters receive blind or expected counts according to policy and scan item/location/serial where possible.
3. The system flags duplicate scans, unexpected serials, missing serials, and quantity variance.
4. Recount and investigation occur before adjustment.
5. Material adjustments require Supervisor approval; value above PHP 10,000 also requires Finance approval.
6. Creator and approver cannot be the same individual.
7. Approval posts the adjustment ledger movement and cost correction atomically. Rejection returns the count for resolution without altering stock.

### 8.8 Returns

- Return intake validates the source issue/order/event, recipient, item, serial/lot, and expected quantity.
- Valid returned stock enters inspection, not immediately available inventory.
- Mismatched, duplicate, previously returned, or unknown serials are blocked and added to the exception inbox.
- Disposition routes stock to accepted putaway, hold, damaged/unavailable, vendor return, or authorized write-off.
- Cancellation and failed delivery use return/reversal records linked to the original movement.

### 8.9 Costing, Landed Cost, and Finance Reconciliation

- Serialized and lot-controlled stock uses specific cost layers tied to the received unit or lot.
- Bulk stock uses moving weighted average, recalculated only by server-side receipt and authorized cost events.
- Landed cost charges are allocated by quantity, value, or weight. The allocation basis, eligible receipts, rounding difference, and approval are retained.
- Event and promotional costing uses issued quantities and the applicable cost layer at movement time.
- Valuation reports reconcile quantity balances, movement ledger, cost layers, landed cost, and adjustments as of a selected timestamp.
- Finance differences become reconciliation items with owners and sign-off. Reports never silently force a balance.
- CSV exports provide accounting handoff; posting to a general ledger remains out of scope.

## 9. Information Architecture and Interaction Design

### 9.1 Desktop Navigation

Warehouse navigation is grouped by work rather than by database entity:

- **Operate:** Receive, Putaway, Transfer, Pick/Pack, Issue, Returns, Cycle Count
- **Plan:** Orders, Events, Allocations, Replenishment, Purchase Orders
- **Control:** QC/Holds, Approvals, Recalls, Adjustments, Audit
- **Analyze:** Inventory, Costing, Finance, Reports, Imports/Exports
- **Configure:** Products, Kits, Customers/Channels, Suppliers, Locations/Bins, Policies

Desktop views use dense but readable tables, saved filters, bulk selection, batch actions, contextual side sheets, and split views for reconciliation. Page sections remain unframed; cards are reserved for repeated records, modals, and bounded tools.

### 9.2 Mobile Navigation

Mobile uses a reachable bottom navigation:

- Home
- Scan
- Tasks
- Inventory
- More

The Scan action opens a contextual chooser for receive, putaway, transfer, pick, issue, return, count, and lookup based on the user's capabilities. Floor workflows use full-width step screens with a persistent but non-occluding primary action. Dense tables become summary lists with filter and detail sheets. No business-critical action lives only in top navigation.

### 9.3 Shared Interaction Rules

- Minimum interactive target is 44 by 44 CSS pixels.
- Sticky actions account for bottom navigation, device safe areas, and on-screen keyboard.
- Forms preserve valid input after server errors and focus the first invalid field.
- Every loading state identifies the object being loaded; every empty state offers the next valid action when one exists.
- Destructive actions require explicit scope and consequence. High-risk actions require a typed or selected reason and show the approval result.
- Long names, large quantities, localization-length labels, and dense records must wrap or truncate with accessible disclosure; they may not resize or shift controls.
- Keyboard navigation, visible focus, reduced motion, screen-reader labels, and status announcements are required.
- Charts are supporting analysis, not the only representation of a value. Every chart has readable labels, a data table or drill-down, meaningful empty states, and responsive dimensions.

## 10. Additional High-Value Features

These capabilities are included because they reduce operating risk or improve throughput using data already required by the roadmap:

1. **Inventory aging and dead-stock view:** age buckets by last movement and receipt, with value and suggested investigation.
2. **ABC and velocity classification:** scheduled classification with visible calculation period and authorized override.
3. **Recall workspace:** locate affected on-hand and issued stock, assign recovery tasks, and track closure evidence.
4. **Pick waves and workload board:** group demand by site/date/priority, assign operators, and expose blocked tasks.
5. **Chain-of-custody handoff:** capture package, custodian, recipient, timestamps, and evidence from pack to delivery.
6. **Saved views and in-app report subscriptions:** persist filters and generate private report jobs on schedule without external email integration.
7. **Exception inbox:** one prioritized queue for shortages, holds, mismatches, variances, stale approvals, import failures, and reconciliation differences.
8. **SLA and throughput metrics:** receiving-to-putaway, reservation-to-pick, pick-to-issue, return-to-disposition, approval age, and exception resolution time.

## 11. Error Handling, Offline Behavior, and Recovery

### 11.1 Stable Error Contract

Server commands return stable codes such as unauthorized, invalid-state, insufficient-stock, duplicate-reference, serial-conflict, approval-required, stale-version, validation-failed, offline-not-allowed, and service-unavailable. UI text explains the recovery action without exposing SQL, secrets, internal paths, or personal data.

### 11.2 Offline Allowlist

Offline capture is permitted only for assigned, low-risk floor tasks:

- scan lookup against a recent local snapshot;
- receiving line capture before final receipt submission;
- assigned putaway, pick, return, and count scans;
- evidence capture pending upload within configured limits.

These operations require a live connection:

- approvals and approval decisions;
- final stock/cost posting when server validation is required;
- landed cost and valuation changes;
- import apply;
- shipment/delivery confirmation;
- hold release, write-off, recall closure, and policy configuration.

The outbox shows pending, syncing, failed, conflicted, and completed states per transaction. Conflict resolution compares the captured base version to current server state; it never uses last-write-wins for stock or approval records.

### 11.3 Resumability

Draft orders, imports, counts, receipts, waves, and inspections retain server drafts. Users can safely resume after sign-out, refresh, route change, timeout, or device restart. A user never sees a success state before the server confirms the canonical transition.

## 12. Security and Data Governance

### 12.1 Database and RPC Controls

- New tables enable RLS before use and define explicit policies for authorized roles, organization/site scope, ownership, and read-only audiences.
- RPCs use a safe `search_path`, schema-qualified objects, least-privilege execution grants, authenticated actor derivation, capability checks, and deterministic row locking.
- Default and anonymous execution is revoked unless an endpoint is intentionally public.
- Quantity, state, price, cost, identity, approval, and ownership values are re-derived or validated server-side.
- Idempotency keys are scoped to actor and operation; conflicting payload reuse is rejected.
- High-risk commands are rate limited at the server boundary and log safe operational metadata.

### 12.2 Files and CSV

- Evidence, import source files, validation reports, and exports live in private Storage.
- Access uses short-lived signed URLs generated only after server authorization.
- Upload rules enforce MIME allowlists, extension consistency, size limits, row caps, schema version, malware/quarantine hook status, and checksum.
- CSV import rejects spreadsheet formulas in untrusted text cells or neutralizes them according to the field contract.
- Generated CSV exports escape formula-leading values and record schema version and checksum.
- Logs and telemetry exclude file contents, secrets, tokens, passwords, and unnecessary personal data.

### 12.3 Audit, Retention, and Legal Hold

- Activity history is append-only and records actor, capability, source record, prior/next state, reason, evidence references, request identity, and timestamp.
- Business records are corrected through linked reversals, amendments, or superseding versions rather than destructive edits.
- Existing retention classes apply to Warehouse records and files; legal hold prevents deletion and expiry.
- Audit viewers respect the same organization, site, and sensitivity boundaries as source records.

## 13. Reporting and Metric Definitions

The initial KPI dictionary must define formula, numerator, denominator, time basis, inclusion/exclusion, source fields, refresh behavior, owner, and known limitations for:

- on hand, held, committed, allocated, available, in transit, issued, consumed, and returned;
- inventory utilization and recovery efficiency;
- return, damage, discrepancy, and shrinkage rates;
- fast/slow moving, ABC class, inventory aging, and projected stockout;
- event consumption and promotional versus sold usage;
- supplier/PO by SKU, receipt variance, and supplier lead-time performance;
- receiving-to-putaway, reservation-to-pick, pick-to-issue, return-to-disposition, approval age, and exception-resolution SLA;
- stock valuation, landed cost, event cost, and reconciliation variance.

Raw BI views expose stable, documented columns for products, variants, locations, bins, suppliers, POs, receipts, movements, balances, serials/lots, reservations, orders, events, issues, returns, quality, costs, and audit lineage. Access remains authenticated and role-scoped. CSV is the supported external handoff.

## 14. Strict Verification and Release Gates

No section below is advisory. A failed required check blocks release unless an accountable business and engineering owner records a time-bounded waiver for a non-security P2 issue. P0 and P1 failures cannot be waived for launch.

### 14.1 Test Layers

1. **Domain tests:** reservation math, stock availability, operation routing, kit explosion, expiry warnings, costing, landed cost, replenishment, classifications, and KPI formulas.
2. **Repository and RPC contract tests:** state transitions, RLS allow/deny, idempotency, row locking, concurrent reservation/receipt/count scenarios, and authoritative read-back.
3. **Workflow E2E tests:** every role executes permitted happy paths, negative paths, recovery paths, empty/loading/error states, and forbidden actions.
4. **CSV tests:** valid, invalid, stale schema, duplicate, oversized, formula injection, mixed tenant, encoding, interrupted apply, correction, and export checksum fixtures.
5. **Visual and accessibility tests:** all routes and key states at every required viewport and theme.
6. **Performance and resilience tests:** bounded query shape, large realistic datasets, weak network, offline/online transition, repeated submissions, and recoverable server failure.
7. **Cutover tests:** product/location/opening balance import, quantity and valuation reconciliation, private file access, role denial, and rollback rehearsal.

### 14.2 Required Role and Workflow Coverage

Each applicable role must be tested independently. Tests may not grant a universal role merely to traverse the app. Coverage includes:

- product, variant, supplier, location, storage area, and bin creation/import;
- opening balances and reconciliation;
- approved and unapproved PO receipt, over-receipt, duplicate serial, partial receipt, QC, hold, putaway, damage, and vendor return;
- transfer and route deviation;
- manual and CSV order creation, full/partial/failed reservation, cancellation, wave, pick, pack, issue, failed delivery, confirmation, and return;
- event creation, kit demand, allocation, replenishment recommendation, issuance, return, closeout, and outcome import;
- normal and serialized cycle counts, recount, variance, rejection, supervisor approval, Finance co-approval, and ledger correction;
- landed cost application, weighted average, specific cost, valuation, and reconciliation exception;
- recall scope, recovery, unresolved issued stock, and closure denial;
- imports, governed exports, saved views, subscriptions, audit, and retention/legal-hold behavior;
- offline allowlisted capture, conflict, retry, sign-out, session expiry, refresh, duplicate submit, and service outage.

Every write-path E2E test must prove:

1. the intended user-visible state;
2. the canonical database row and state;
3. the corresponding stock and cost ledger effect where applicable;
4. the activity/audit event;
5. denial for an unauthorized role;
6. persistence after a fresh authenticated browser session.

### 14.3 Visual Frontend Matrix

Required viewports:

- Desktop: 1440x900 and 1280x800
- Tablet: 768x1024
- Mobile: 390x844, 360x800, and 320x568

Required visual states:

- every Warehouse role and reachable route;
- navigation expanded/collapsed, dialogs, sheets, drawers, menus, filters, bulk actions, and sticky actions;
- empty, loading, error, offline, conflict, success, partially completed, and realistically populated states;
- light and dark themes;
- long names, large quantities, many status badges, large tables, dense lists, and validation summaries;
- on-screen keyboard and device safe-area behavior for mobile form flows.

The visual suite performs screenshots, visual regression comparison, DOM geometry assertions, accessibility checks, and canvas pixel checks for charts/scanner surfaces. It fails on:

- horizontal page overflow at any required viewport;
- text or controls clipped, obscured, overlapped, or rendered outside their container;
- top navigation used as the only primary mobile navigation;
- sticky actions hidden by bottom navigation, safe area, keyboard, sheet, or another sticky element;
- touch targets below 44x44 CSS pixels for operational actions;
- unreadable contrast, missing focus indicator, inaccessible control name, broken tab order, or unannounced status change;
- nested scrolling that traps the user or separates a primary action from its form context;
- charts with clipped labels, overlapping marks, unexplained abbreviations, blank canvases, misleading scales, missing values, or awkward placement that breaks the reading order;
- layout shifts caused by loading, badges, long labels, dynamic totals, errors, or offline/conflict banners;
- a route, drawer, modal, or sheet with no reachable close/back/next action;
- empty/error states that produce a dead end where recovery is possible.

The full visual crawl runs three times from clean browser contexts. A pass requires deterministic geometry and screenshots across all three runs. The final run is manually reviewed by a human using contact sheets organized by role, route, viewport, state, and theme. Automated green status without human screenshot review is insufficient.

### 14.4 Performance Gates

- Operational list queries use explicit projections and bounded pagination; no unbounded movement, audit, scan, or evidence history is loaded into a page.
- Primary floor actions remain responsive on the agreed representative warehouse dataset and under simulated constrained mobile network conditions.
- Long lists use stable virtualized or paginated layouts without losing keyboard focus or selection.
- Duplicate submission, concurrent reservation, concurrent receipt, and concurrent count tests preserve ledger invariants.
- Production build, typecheck, lint, unit/component tests, migration checks, secret scan, and security policy verification pass from a clean checkout.

### 14.5 Severity Standard

- **P0:** data corruption/loss, cross-tenant or unauthorized access, incorrect stock/cost ledger, impossible core workflow, exposed secret/private file, or unrecoverable production failure. Release blocked.
- **P1:** broken role flow, incorrect approval, inaccessible core action, mobile/desktop overlap that prevents use, persistent dead end, major reconciliation error, or common-path crash. Release blocked.
- **P2:** material friction, inconsistent information, non-blocking accessibility issue, weak feedback, or report deficiency. Must be fixed or explicitly owned before general availability.
- **P3:** polish or low-frequency improvement with no material correctness, security, accessibility, or task-completion impact. May enter the post-launch backlog with owner and evidence.

## 15. Delivery Sequence

The roadmap is delivered in controlled releases on the same branch/program. Each release has its own implementation plan, migration set, test evidence, and review gate.

### Release W1: Inventory Control Foundation

- operation types and routing;
- QC, holds, damage, vendor returns, and expiry visibility;
- risk-based approvals and common exception inbox;
- receiving/issue/return/count scanning completion;
- product/location/bin/opening-balance imports;
- procurement PO approval handoff;
- committed/allocated/available reporting;
- KPI dictionary, ERD, and raw extraction views.

Exit requires the receiving-through-putaway and count-through-adjustment workflows to pass live database, security, desktop, tablet, and mobile gates.

### Release W2: Demand and Fulfillment

- customer/channel/business-unit master;
- manual and CSV orders;
- reservation governance and BU self-service request;
- pick waves, workload board, packing, issue/delivery, chain of custody;
- cancellation, failed delivery, and closed-loop returns;
- recall workspace.

Exit requires order-to-delivery and reverse-logistics reconciliation across requester, operator, supervisor, and auditor roles.

### Release W3: Kits and Costing

- kits/bundles and component reporting;
- specific and moving-weighted-average costing;
- landed cost allocation;
- event/promotional costing;
- finance-grade valuation and reconciliation;
- supplier/batch/volume cost analysis.

Exit requires Finance-approved formula fixtures, concurrent transaction tests, and valuation reconciliation to the stock ledger.

### Release W4: Planning and Analytics

- event-driven replenishment and projected stockout;
- inventory aging/dead stock;
- ABC/velocity classification;
- campaign outcome CSV comparison;
- SLA/throughput analytics;
- saved views and in-app report subscriptions;
- governed BI/export packages.

Exit requires metric-owner sign-off, historical-data sufficiency notes, and deterministic report validation.

### Release W5: Full Production Readiness

- complete three-pass visual matrix;
- full multi-role happy, negative, edge, offline, concurrency, and recovery E2E suite;
- production-volume performance verification;
- cutover rehearsal and reconciliation;
- role-based UAT, training, support, hypercare, rollback, and release evidence;
- final security review and zero open P0/P1 findings.

The later releases may be feature-flagged while implementation continues, but Warehouse may not be called complete until W5 passes.

## 16. Roadmap Traceability

| Backlog IDs | Design treatment |
| --- | --- |
| WH-001 to WH-005 | Existing item/variant/serial/lot/location foundation retained and hardened through governed master data, expiry/cost attributes, and route-aware locations |
| WH-006 to WH-009 | PO/opening receipt, evidence, QC/hold/disposition, putaway, and relocation completed in W1 |
| WH-010 to WH-014 | Allocation, conflict control, accountable issuance, return intake, and vendor return completed across W1/W2 |
| WH-015 to WH-016 | Quantity and serialized cycle count plus approval-backed reconciliation completed in W1 |
| WH-017 to WH-018 | Reorder policy retained; projected stockout completed in W4 |
| WH-019 to WH-024 | On-hand, committed/available, event movement, usage type, raw export, and formal metric dictionary completed in W1/W4 |
| WH-025 | Dashboard/report automation completed through governed views, saved reports, and in-app subscriptions in W4 |
| WH-026 to WH-029 | Scoped BU visibility/reservation, campaign request/event flow, and campaign outcome CSV comparison completed in W2/W4 |
| WH-030 to WH-033 | Velocity, supplier/PO reporting, landed cost, and supplier/batch/volume analysis completed in W3/W4 |
| WH-034 to WH-035 | Satisfied as governed CSV handoffs and manual/CSV order intake; live integrations remain explicitly excluded |
| WH-036 | Camera/barcode scanning completed for receive, issue, return, and count in W1 |
| WH-037 | Excluded by product decision: no RFID |
| WH-038 | Risk-based adjustment approval completed in W1 |
| WH-039 | Existing PWA hardened with offline allowlist, conflict handling, and strict mobile visual gates |
| WH-040 to WH-041 | Post-pilot backlog governance and signed RTM maintained as release artifacts |
| WH-042 to WH-045 | Operation routes, validated imports, committed report, and procurement PO approval handoff completed in W1 |
| WH-046 to WH-049 | Event replenishment, customer/channel dimension, order/delivery linkage, and kits completed in W2-W4 |
| WH-050 to WH-052 | Finance reconciliation, landed cost, and event/promotional costing completed in W3 |
| WH-053 to WH-054 | Issuance and return validation scans completed in W1 |
| WH-055 to WH-056 | Raw BI views, ERD, data dictionary, and KPI definitions completed in W1/W4 |
| WH-057 to WH-059 | UAT, training/manual, migration, hypercare, warranty, SLA, and defect ownership required for W5 exit |
| WH-060 | This design records the deliberate native, staged delivery and exclusion of commercial ERP integration |

## 17. Completion Criteria

Warehouse roadmap completion requires all of the following:

1. Every included WH backlog item is mapped to implemented code, migration or policy artifact, automated tests, UAT evidence, owner, and release status in the RTM.
2. WH-037 is the only omitted Warehouse Backlog+ feature; WH-034 and WH-035 are implemented as governed CSV/manual handoffs rather than live integrations.
3. All Warehouse roles can complete their permitted workflows and are denied forbidden actions by the server and database.
4. Every inventory and cost mutation reconciles to authoritative ledger entries and immutable activity evidence after a fresh session.
5. All required desktop, tablet, and mobile visual states pass three deterministic crawls and human screenshot review with no open P0/P1 defects.
6. The full security, accessibility, performance, concurrency, migration, offline, recovery, and cutover gates pass from a clean build against the designated test Supabase project.
7. Operations, Finance, Procurement, BI, Security, and Product owners sign the relevant UAT and metric/control sections.
8. Training, support, rollback, and hypercare owners are named before launch.

Until these criteria are met, the module may be described by its completed release stage, but not as fully production ready.
