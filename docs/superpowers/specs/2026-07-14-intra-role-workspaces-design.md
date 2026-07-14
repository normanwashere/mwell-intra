# mWell Intra Role Workspaces Design

**Date:** 2026-07-14  
**Status:** Proposed for implementation review  
**Scope:** Marketing & Events, My Work & Approvals, and Data & Insights

## Objective

Make organization-wide workflows first-class parts of mWell Intra without turning every job title into a module. The first release extracts currently implemented functionality from Warehouse, preserves the owning system for every command, and adds governed cross-module read models only where aggregation is required.

## Decision

Use domain modules with composable roles:

- **Marketing & Events** owns campaign and event intent, lifecycle, allocation requests, distribution context, and outcome reporting.
- **Warehouse** owns physical availability, reservation execution, issue, custody, return intake, inspection, and stock movements.
- **My Work & Approvals** aggregates assigned work and links to the source workflow. It never performs a source decision itself.
- **Data & Insights** presents authorized read-only metrics and governed exports. It never bypasses source RLS or creates operational records.

A person may hold roles in several modules. Business Unit, Requester, Department Head, Approver, and executive personas receive appropriate workspaces and capabilities; they do not become modules by themselves.

## Alternatives Considered

### Keep role pages under Warehouse

This is the smallest code change, but it keeps Marketing, BI, Pricing, Procurement, and Business Unit responsibilities falsely coupled to Warehouse access. It also produces misleading module counts and navigation.

### Create a module for every department or role

This matches the organization chart but duplicates approvals, dashboards, data access, and shell behavior. Users with several responsibilities would have fragmented queues and repeated navigation.

### Domain modules with cross-module workspaces

This is the selected approach. It follows durable workflow and data ownership while allowing roles to compose. It requires careful route migration and RLS-preserving aggregation, but it scales without multiplying applications.

## Release Boundaries

### Release 1: Existing-function extraction

- First-class `/events`, `/work`, and `/insights` shell routes.
- Reuse current event, allocation, return, task, approval, report, and KPI capabilities.
- Preserve source actions in Warehouse, Procurement, Legal, Finance, and Administration.
- Add compatibility redirects from moved Warehouse routes.
- Update role assignments, navigation, module counts, mobile navigation, command palette, and Knowledge Base.
- Use memory-mode adapters for complete local simulation and live Supabase read models for production.

### Later releases

- Campaign budgets, creative approval, lead capture, CRM integration, and marketing ROI attribution.
- Configurable enterprise SLA rules and delegation for My Work.
- Scheduled dashboards, warehouse-independent semantic models, and external BI tooling.
- People/HR, IT & Security, Facilities, and Commercial & Pricing modules.

Pricing, physical allocation execution, quality control, receiving, and return intake do not move in Release 1. They remain in Finance or Warehouse according to their current source ownership.

## Marketing & Events

### Roles

- `events:requester`: creates and updates owned draft events and requests stock.
- `events:coordinator`: manages event lifecycle, requirements, allocations, and reconciliation.
- `events:viewer`: views authorized event status and outcomes.
- `events:admin`: configures event categories and oversees all event records.

Existing Warehouse `marketing` assignments migrate to `events:coordinator`; `business_unit` assignments migrate to `events:requester`. Warehouse Operations and Logistics retain Warehouse roles for fulfillment.

### Routes

- `/events`: event portfolio, filters, status, fulfillment progress, and exceptions.
- `/events/new`: event creation using the current implemented event fields.
- `/events/:id`: lifecycle, requested items, fulfillment handoff, distribution, returns, and outcome summary.
- `/warehouse/events` and `/warehouse/events/:id`: permanent HTTP 308 compatibility redirects to the corresponding Events routes.

### Ownership and data flow

1. Events creates or updates event intent.
2. An allocation request references the event and required SKU quantities.
3. Warehouse validates availability and executes reservation or issue using existing governed commands.
4. Warehouse movements and returns update fulfillment state through an RLS-preserving event fulfillment view.
5. Events closes only when distributed stock has a final returned, consumed, lost, damaged, or retained outcome.

Release 1 may adapt the existing Warehouse event repository, but new Events UI code must not directly mutate Warehouse stock tables.

### States and exceptions

Supported lifecycle: `draft`, `confirmed`, `in_fulfillment`, `active`, `reconciling`, `closed`, `cancelled`.

The UI must handle insufficient stock, partial fulfillment, cancelled events with reserved stock, overdue returns, unresolved losses/damage, duplicate submissions, offline reads, and source-system failures without hiding valid partial data.

## My Work & Approvals

### Entry rule

Any authenticated employee with at least one actionable module role can open `/work`. The workspace displays only rows visible to that user's source-module policies.

### Routes

- `/work`: assigned, available-to-role, blocked, due soon, and completed work.
- `/work?source=procurement|legal|warehouse|finance|admin`: filtered queue.
- Source detail links open the owning module route.

### Aggregation contract

Create a security-invoker `core.v_my_work` read model with a normalized shape:

- `source_module`
- `work_type`
- `source_id`
- `title`
- `status`
- `priority`
- `assignee_id`
- `role_scope`
- `due_at`
- `created_at`
- `source_route`

The view unions existing Procurement approval steps, Legal accreditation work, Warehouse tasks/exceptions/stock approvals, Finance payment-readiness review, and administrative remediation records. Every branch must preserve source RLS and use the caller's scoped capability checks.

### Command boundary

My Work contains no approve, reject, resolve, release, or post command. Selecting a row opens the exact source record, where current validation, evidence, segregation-of-duties, idempotency, and audit controls remain authoritative.

### Priority and SLA

Release 1 derives priority from existing source severity and due dates:

- Critical source severity or overdue work: urgent.
- Due within two business days: high.
- Assigned work without immediate due risk: normal.
- Completed or superseded work: informational.

The workspace must not invent contractual SLA commitments where the source record has none.

## Data & Insights

### Roles

- `insights:analyst`: views authorized detail and prepares governed exports.
- `insights:manager`: views cross-team summaries within assigned scope.
- `insights:executive`: views high-level cross-module KPIs without operational edit access.
- `insights:admin`: manages metric definitions and approved export configuration, not source data.

Existing Warehouse `bi_analyst` migrates to `insights:analyst`. Other module roles may receive Insights roles independently.

### Routes

- `/insights`: cross-module overview and source health.
- `/insights/warehouse`: inventory, utilization, movements, quality, cycle counts, and event fulfillment.
- `/insights/procurement`: demand, cycle time, sourcing, PO, and payment-readiness summaries.
- `/insights/legal`: accreditation workload, evidence completeness, status, and lifecycle risk.
- `/insights/finance`: commitments, receipts, returns, readiness, and valuation summaries.
- `/warehouse/data` and `/warehouse/reports`: compatibility redirects to Warehouse Insights.

### Read model rules

- Reuse existing governed Warehouse BI views, inventory position, and Finance activity view.
- Add module summary views only when the metric can be defined from committed schema.
- All cross-module views use `security_invoker = true` and retain source RLS.
- A failed source produces a visible partial-data warning; valid sources remain available.
- Every KPI shows definition, source, freshness, scope, and drill-down route.
- Exports use existing governed export jobs and record requester, filters, row count, status, and expiry.

## RBAC and Identity

Add `events` and `insights` to the canonical RBAC module registry. My Work is a core workspace and does not introduce a separate source-role namespace.

Finance remains a first-class workspace backed by Warehouse Finance and Procurement Finance capabilities. Existing Warehouse role names remain temporarily valid for migration but no longer create navigation entries for moved domains.

Live changes require synchronized updates to:

- TypeScript RBAC contracts and tests.
- Supabase role and capability catalogue.
- JWT/custom-claim role parsing.
- Demo profiles and provisioning scripts.
- Knowledge Base capability and role descriptions.

No migration may broaden a source table's read policy merely to make an aggregate dashboard work.

## Shell and Navigation

Desktop module order: Home, My Work, Events, Warehouse, Procurement, Finance, Legal, Insights, Administration, Knowledge Base, filtered by access.

Mobile navigation prioritizes Home, My Work, and the current module. Overflow destinations remain in More. Contextual center actions are module-specific: New event in Events, New request in Procurement, and no synthetic action in My Work or Insights.

Dashboard access counts, quick links, sidebar entries, command palette, and mobile navigation must derive from one canonical destination function.

## Knowledge Base

Each new route requires:

- Plain-language purpose, reads, writes, statuses, exception behavior, and completion evidence.
- Exact role and capability mapping.
- A decision-aware workflow with source ownership and handoff points.
- Verified screenshots at the actual interaction step, with markers and captions.
- Contextual help mapping for route and query-state variants.
- Compatibility-route guidance that points to the new canonical article.

Knowledge Base validation must fail when a live route, role, capability, control, field, or evidence record is undocumented.

## Error Handling and Resilience

- Access denial identifies the missing scoped role and provides a safe return route.
- Loading, empty, partial, offline, unauthorized-source, and retry states are distinct.
- Aggregators tolerate one unavailable source and name the unavailable module.
- Source actions remain idempotent and auditable.
- Redirects preserve entity identifiers and safe query parameters.
- No workspace displays stale success after a source command fails.

## Testing and Acceptance

### Contract tests

- Canonical module and role registries match Supabase seed/migration definitions.
- Every moved route has one canonical destination and one compatibility redirect.
- Navigation, module count, command palette, and Knowledge Base share the same access result.
- Aggregation views preserve source RLS for single-role and multi-role users.

### Workflow tests

- Event creation through Warehouse fulfillment, issue, return, and reconciliation.
- Partial allocation, insufficient stock, cancellation, overdue return, and damaged/lost outcomes.
- My Work aggregation, source filtering, exact source navigation, completion disappearance, and unauthorized-row exclusion.
- Insights single-scope, multi-scope, partial-source, export, freshness, and drill-down behavior.

### Visual and accessibility tests

- Desktop widths 1440 and 1280; tablet 768; mobile widths 390, 360, and 320.
- No overflow, clipped text, overlapping fixed controls, dead ends, inaccessible focus, or undersized touch targets.
- Light and dark themes for primary routes.
- WCAG 2.2 AA automated checks plus keyboard and screen-reader landmark verification.

### Production certification

- Live Supabase read/write/read-back for source workflows using vaulted CI credentials.
- RLS-negative tests for unrelated, single-scope, vendor, and anonymous identities.
- Vercel route, redirect, caching, service-worker, and error-monitoring verification.
- Cleanup of certification records through governed test-data procedures.

## Implementation Sequence

1. Add shared route and RBAC contracts with migration-safe aliases.
2. Build Events module and Warehouse handoff adapters.
3. Build `core.v_my_work` and My Work UI.
4. Build Insights adapters and UI from existing governed views.
5. Update shell navigation, dashboard, mobile behavior, and compatibility redirects.
6. Update Knowledge Base content and evidence.
7. Run unit, contract, E2E, visual, accessibility, live Supabase, and Vercel certification.

The three module implementations may proceed in parallel after the shared contracts land. Shell, RBAC registry, Knowledge Base indexes, and migration files remain integration-owner files to avoid concurrent edits.

## Success Criteria

- Marketing, Business Unit, and BI users no longer require misleading Warehouse navigation for their primary work.
- Approvers see one queue while source modules retain all decisions and audit controls.
- Insights never grants broader access than the source modules.
- Multi-role users see one canonical destination per module with correct module counts.
- Existing bookmarks continue through tested redirects.
- Current implemented workflows remain functional on desktop and mobile in memory and live modes.
