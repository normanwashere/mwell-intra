# Mwell Intra UAT and Value-Stream Architecture Design

**Date:** 2026-07-14  
**Status:** Approved architecture; pending implementation-plan review  
**Scope:** environment isolation, shared workflow authority, cross-department modules, and launch certification

## Objective

Make Mwell Intra the primary system of engagement for all departments while preserving one authoritative owner for every business command. Warehouse, Procurement, Legal, Finance, Events, and future capabilities remain parts of one Intra application. Users hold composable roles across modules, while department, location, cost center, approval tier, and delegation determine data scope.

The first delivery also isolates UAT from production so destructive, negative, concurrency, expiry, and cleanup testing can be performed without touching operational data.

## Decisions

### One Intra application

Use one authenticated shell, one navigation and route registry, one role vocabulary, one My Work queue, and one Knowledge Base. Modules represent durable capabilities or value streams rather than copies of the organization chart.

Departments, sub-teams, reporting relationships, role assignments, and data scopes are configuration records rather than hard-coded application modules. Adding a department or role must not require a new deployment unless it also introduces a genuinely new workflow or capability.

### Dedicated UAT Supabase project

Use the newly provisioned, empty Supabase project as the long-lived UAT data plane. Reproduce it exclusively from version-controlled migrations, configuration, Edge Functions, and sanitized seed data. Do not restore or copy production data, production Auth users, storage objects, or secrets.

Production remains on its current Supabase project until every migration and workflow passes UAT certification. A future persistent Supabase branch may be introduced for short-lived pull-request previews after schema drift has been eliminated.

### One authority per command

- Procurement owns demand qualification, sourcing, award, and PO issuance.
- Legal owns vendor accreditation, legal evidence determination, contracts, and compliance disposition.
- Warehouse owns physical receipt, inspection, quarantine/rejection, custody, putaway, stock movement, issue, and return.
- Finance owns financial review, matching, release readiness, and payment-control disposition.
- Events owns event intent, approval context, demand, lifecycle, and reconciliation; it never writes stock directly.
- My Work aggregates assignments but performs no source decision.
- Insights reads governed projections and performs no operational command.

No module may expose a shortcut that creates a second version of another module's truth.

## Alternatives Considered

### Continue sharing production Supabase

This is the cheapest configuration but cannot safely certify destructive or adversarial workflows. Tenant labels and cleanup scripts do not protect Auth configuration, schema, storage, functions, or accidental untagged writes. Rejected.

### Persistent branch of production

This provides separate services and credentials with a migration-based, data-less environment. It is suitable for staging when migrations are authoritative. It is not selected for the first UAT rebuild because the audit found live schema drift that must be reconciled independently.

### Dedicated UAT project

This is selected. It provides an explicit security boundary, long-lived test identities, independent Auth/Storage/Function configuration, and a clean proof that the repository can recreate the platform. Its operational cost is additional environment management, which CI automation will minimize.

## Environment Topology

### Production

- Existing production Vercel site and Supabase project.
- Operational users and data only.
- No destructive E2E.
- Schema changes arrive only through reviewed migrations already certified in UAT.

### UAT

- UAT Vercel site and the new dedicated Supabase project.
- Sanitized deterministic fixtures and synthetic `intra.test.*` users.
- Separate publishable key, secret key, Auth configuration, Storage, SMTP/test mailbox, webhook secrets, and Edge Function secrets.
- Full mutation, expiry, replay, concurrency, handoff, and cleanup certification.
- Visible UAT environment label and correlation ID in exported evidence.

### Local and CI

- Local Supabase for developer migration/reset tests.
- CI uses short-lived or vaulted UAT secrets.
- Browser clients receive only the UAT publishable key.
- Service-role or secret keys never use a `NEXT_PUBLIC_` name and never enter screenshots, artifacts, browser bundles, or command output.

## Environment Guard

Add a shared environment manifest containing an immutable environment name and expected Supabase project reference. Server-side startup and mutation runners must fail closed when:

- `APP_ENV=uat` points to the production project reference.
- a destructive test targets an unapproved project reference.
- required server-only credentials are missing or appear in public environment variables.
- the database migration version differs from the application-required version.

Cleanup uses a run-scoped correlation ID and may delete only records created by the same UAT run. Production smoke tests remain read-only except for separately approved reversible canaries.

## Migration and Bootstrap Contract

1. Reconcile the current production schema against repository migrations without changing production behavior.
2. Generate explicit migrations for approved live-only functions, grants, policies, triggers, storage definitions, and extensions.
3. Add `supabase/config.toml` for reproducible Auth and service configuration where supported.
4. Reset a local database from zero and run all migrations.
5. Apply the same ordered migrations to the empty UAT project.
6. Deploy Edge Functions and configure server-only secrets.
7. Seed reference data, capabilities, temporary UAT DOA matrices, synthetic organizations/vendors/products, and deterministic test transactions.
8. Provision synthetic Auth identities and assign isolated and multi-role combinations.
9. Run security and performance advisors after DDL.
10. Generate TypeScript database types and fail CI when generated types drift.

Seed files must be idempotent and contain no production personal data. Synthetic emails must use controlled test mailboxes or non-deliverable reserved domains except where email-delivery certification intentionally uses a test inbox.

## Canonical Module Model

### Configurable organization model

The organization directory supports an arbitrary hierarchy through stable department records and optional parent departments. The initial UAT structure is:

- Marketing.
- Sales.
- Product.
- Technology.
- Project Management Office.
- Operations, with Warehouse & Logistics, Customer Service, and Client & Product Implementation as child teams.
- Finance.
- Procurement as an independent enterprise department.
- Legal & Compliance.
- People & Culture.
- Administration where required by the approved organization directory.

Client & Product Implementation coordinates new client/account and product implementation. Product owns the final go-live decision. Technology owns technical integration readiness, Operations owns operational readiness, Sales owns the commercial handoff, and Customer Service owns post-launch support.

This initial list is seed data, not a closed TypeScript union. Administrators can add, rename, deactivate, re-parent, and order departments without changing code. Deactivation preserves historical references. Reporting hierarchy does not grant capabilities by itself.

### Core workspaces

- Home: role-aware orientation and module access.
- My Work: authoritative assignments, exceptions, due work, and source links.
- Knowledge Base: searchable role, process, field, status, exception, and evidence guidance.
- Administration: identity, role assignment, department scope, DOA, policies, configuration, and audit.

### Operational modules

- Procurement: request-to-order.
- Legal: vendor accreditation, contracting, and compliance.
- Warehouse: physical custody and inventory.
- Finance: commitments, matching, approvals, valuation, and payment control.
- Events: intent-to-reconciliation.
- Insights: governed cross-domain measures and drill-downs.
- Vendor Portal: invitation, identity setup, accreditation evidence, status, and controlled communication.

### Future modules

Add modules only when they own a durable workflow and protected data boundary:

- People and HR.
- IT and Security Service Management.
- Facilities and Assets.
- Policy and Compliance, potentially Legal-owned.
- Projects and Portfolio.
- Communications and Directory.

A department does not receive a module merely because it exists on the organization chart.

## Composable Identity and Scope

The canonical authorization tuple is:

`user + module role + capability + department scope + location scope + amount/category authority + effective dates + delegation`

Finance becomes a first-class RBAC module with analyst, approver, controller, and administrator roles. A user may hold Warehouse Finance and Procurement Finance responsibilities through one Finance identity and unified workspace. Source visibility remains constrained by department, cost center, and explicit authority.

UAT must include:

- one isolated identity for every role;
- realistic multi-role identities, including unified Finance;
- users with multiple departments or locations;
- delegated, expired, suspended, and no-access identities;
- vendor identities separated from employee identities;
- negative identities that share a department but lack the required capability.

Authorization never relies on user-editable metadata. Sensitive commands re-evaluate current database authority instead of trusting stale client state.

## Shared Workflow Contract

Every cross-department process uses a normalized handoff envelope:

- process and entity identifiers;
- source module and authoritative owner;
- current state and version;
- requested command or next responsibility;
- assignee user/role and department scope;
- due date and escalation rule;
- evidence requirements and document references;
- correlation and idempotency keys;
- actor, timestamp, reason, and immutable audit event.

Commands use optimistic version checks and idempotency keys. Repeated submissions return the original result rather than duplicating records. Failed downstream work remains visibly pending or failed; it never displays a stale success.

## Vendor-to-Pay Authority

Canonical flow:

1. Requester creates demand.
2. DOA selects the current approval tier by department, amount, category, and effective date.
3. Procurement qualifies demand and conducts sourcing.
4. Legal confirms vendor accreditation and contract requirements.
5. Procurement issues the PO.
6. Warehouse records physical receipt, inspection, disposition, putaway, and inventory posting.
7. Procurement receives the Warehouse handoff status but cannot assert physical receipt.
8. Requester records service or business acceptance when applicable.
9. Finance performs the governed match and payment-control disposition.
10. Insights reads the committed audit trail.

The Procurement `Receive items` mutation is removed. Procurement PO detail displays the Warehouse receipt summary and links to the governed Warehouse route. Warehouse PO authoring is retired or made read-only for migrated legacy records.

Partial, excess, rejected, quarantined, damaged, missing-evidence, and duplicate-delivery outcomes produce explicit assigned exceptions. Finance cannot mark payment-ready beyond accepted quantity.

## Policy and Accreditation Control Baseline

The implementation treats these supplied documents as governing sources:

- `mWell Procurement Policy and Procedures - Revised Modern Visual Updated.docx`.
- `LGL004-Vendor Accreditation Form 2.0 (3).pdf`.
- `[MNDA]- Tech Service Provider.docx` for technology-service-provider confidentiality and privacy requirements.

The system must preserve the following procurement rules:

- RFQ/canvassing applies below PHP 1,000,000 when the requirement is simple and comparable.
- RFP/bidding applies at PHP 1,000,000 and above, or for complex, technical, strategic, high-risk, or data-sensitive work regardless of amount.
- Direct Award requires an allowed basis, requested supplier, business justification, price-reasonableness support, accreditation or approved clearance path, Procurement Head review, and final DOA approval.
- A non-accredited vendor requires written justification, approved temporary clearance, and accreditation follow-up. A one-time petty-cash exception additionally requires Finance eligibility, no splitting or recurrence, OR/SI or liquidation evidence, and Procurement visibility.
- PO, contract, or approved written agreement must exist before work starts except for a documented emergency path.
- Material scope, price, vendor, delivery, or term changes return to Procurement and the applicable DOA route.
- Imported or foreign-vendor transactions capture shipping terms, importer of record, permits, total landed cost, duties/taxes, insurance, currency/payment risk, and acceptance location.
- Payment readiness requires the approved PO/agreement, invoice or OR/SI, accepted Warehouse receipt or service acceptance, payment terms, and tax/withholding support before Finance release.

Vendor accreditation uses conditional requirements by entity type and risk. The baseline captures company identity and contacts, incorporation and tax details, business type, product/service category, manpower and expertise, certifications, completed projects, client references, bank proof, declarations, authorized signatory, and foreign-document equivalents. Required evidence includes the applicable DTI/SEC registration, BIR 2303, business permit, three-year audited financial statements, partnership/board/secretary authorization where applicable, GIS where applicable, company profile, client/transaction proof, privacy impact or compliance evidence when applicable, cybersecurity policies when applicable, official receipt evidence, bank proof, and NDA.

Technology-service-provider accreditation also records the applicable technology pool, delivery capabilities, named or evidenced UI/UX, project management, business analysis, QA, agile delivery, security standards, and technical team. The MNDA workflow captures authorized parties/signatories, purpose, execution/effective dates, two-year or definitive-agreement expiry rule, need-to-know handling, Data Privacy Act obligations, and the five-business-day return/destruction obligation after written request or termination.

Vendor Management Office owns accreditation when established. Until then, Legal coordinates accreditation and temporary clearance with Procurement, consistent with the supplied policy. Requesters provide facts but cannot approve risk, accreditation, Direct Award, or clearance.

## Two-Person Warehouse Operating Model

Routine Warehouse operation must be possible with two distinct personnel accounts:

- **Warehouse Operator:** receives against issued Procurement POs, scans products/serials/lots, records quantities, captures evidence, performs standard inspection, puts accepted stock away, picks/issues stock, receives returns, and performs assigned cycle counts.
- **Warehouse Supervisor:** owns the queue, confirms discrepancies, decides exception dispositions, releases holds when evidence permits, approves stock adjustments and count variances, manages bins/routes, and reviews operational closure.

The Operator completes a clean receipt from scan through putaway without unnecessary approval. The Supervisor is required for excess/short/damaged or unidentified receipt, rejection/quarantine disposition, hold release, manual stock adjustment, material cycle-count variance, write-off, and override. No user may execute and approve the same controlled transaction, including during temporary delegation.

The Warehouse UI prioritizes four daily flows: `Receive and inspect`, `Put away`, `Pick or issue`, and `Returns and counts`. Advanced configuration, analytics, Finance, Procurement authoring, and administration do not appear in the Operator's primary navigation. Existing Warehouse role names remain migration aliases while `warehouse_operator` and `warehouse_supervisor` become the canonical operating bundles.

## My Work Contract

My Work is generated from assignment-scoped, RLS-preserving projections. Each item contains the actual assignee or eligible role pool, department/location scope, approval tier, source state/version, due date, canonical route, and safe display fields.

My Work never approves, rejects, receives, releases, or closes a source record. Completion at the source removes or supersedes the work item transactionally. Unauthorized users cannot infer titles, counts, vendors, amounts, or evidence through aggregate rows.

The queue includes Procurement approvals, Legal cases, Warehouse QC/exceptions/stock approvals, Finance review, Events exceptions, and policy remediation.

## Events-to-Reconcile Contract

Events uses explicit states: `draft`, `pending_approval`, `confirmed`, `in_fulfillment`, `active`, `reconciling`, `closed`, and `cancelled`.

An Event records demand and dependencies. Warehouse owns reservation, issue, serialized custody, returns, and stock outcomes. Procurement and Legal are invoked when vendor, contract, or purchasing rules require them. Finance owns budget and reconciliation controls. Closure requires every issued unit or amount to have a terminal outcome and every material exception to be resolved or formally accepted.

## Insights Contract

Every metric defines:

- comparator: `at_least`, `at_most`, `range`, or `informational`;
- governed source projection;
- scope and policy;
- source-data watermark, not query time;
- target, owner, and definition;
- role-safe detail route;
- partial/stale/error state.

Metric status is calculated server-side and tested against known fixtures. A user who can view a metric but not its source receives a governed Insights detail view rather than an unauthorized deep link.

## Error and Exception Handling

- Distinguish validation, authorization, conflict, dependency, offline, timeout, and unexpected failures.
- Preserve entered form data after recoverable errors.
- Return stable error codes plus plain-language remediation.
- Restore focus after dialogs and announce asynchronous errors accessibly.
- Create assigned work for exceptions that require human resolution.
- Use retry only for idempotent commands.
- Log correlation ID, actor, entity version, source module, and outcome without logging secrets or protected document contents.

## Testing Strategy

### Migration and environment

- Clean local reset from zero.
- UAT migration replay and schema checksum.
- Environment mismatch and production-target mutation denial.
- Edge Function, Storage, Auth, and key separation verification.

### Authorization

- Isolated role, multi-role, department, location, DOA tier, delegation, expiry, suspension, anonymous, and vendor cases.
- Direct database/RPC attempts as well as UI routes.
- Cross-department title, count, amount, and evidence non-disclosure.

### Workflow

- Vendor invitation delivery, setup, expiry, replay, suspension, and reinvitation.
- PR through approval, sourcing, accreditation, PO, partial/rejected receipt, putaway, acceptance, match, and release.
- Event through approval, fulfillment, custody, returns, variance, and closure.
- Duplicate requests, optimistic conflicts, dependency outages, attachment controls, and governed cleanup.

### Frontend

- Desktop 1440 and 1280, tablet 768, and mobile 390, 360, and 320.
- Visual regression, DOM overlap/overflow, keyboard, screen-reader landmarks, focus, touch targets, browser chrome, safe areas, and software keyboard.
- Loading, empty, partial, stale, offline, denied, and error states.

The complete matrix runs three times without unexplained failure before release approval.

## Delivery Sequence

### Phase 1: Trust boundary and P0 process authority

1. Reconcile migrations and bootstrap isolated UAT.
2. Add environment and destructive-test guards.
3. Add the configurable department hierarchy and composable role-assignment contract, seeded with the currently known organization structure.
4. Establish canonical route, module, role, and workflow contracts.
5. Remove duplicate Procurement/Warehouse receipt authority.
6. Add first-class Finance RBAC and unified Finance UAT identity.
7. Replace My Work with assignment-scoped projections.
8. Correct Insights comparators and route-safe details.

Phase 1 does not build separate Marketing, Sales, Product, Technology, PMO, Customer Service, or People workflow modules. It creates the extension points those modules will reuse and fixes the currently implemented launch blockers first.

### Phase 2: Complete implemented value streams

1. Complete Events lifecycle and cross-module dependencies.
2. Complete vendor invitation and accreditation certification.
3. Add explicit exceptions, evidence, SLA, and escalation states.
4. Update Knowledge Base from the same route/role/process registry.
5. Add server-side projections, pagination, freshness, and observability.

### Phase 3: Expand Intra capabilities

Introduce People/HR, IT and Security, Facilities/Assets, and other modules in separate reviewed designs, reusing the shared identity, workflow, My Work, evidence, notification, Knowledge, and audit contracts.

## Rollback and Production Promotion

- UAT changes may be reset from migrations and sanitized seeds.
- Every production migration includes a reviewed forward correction or compatibility strategy; destructive rollback is not assumed.
- New command paths can be feature-flagged by environment and role during transition.
- Legacy receipt and route surfaces become read-only before removal.
- Production promotion requires migration checksum, advisor review, complete E2E evidence, business-owner sign-off, backup verification, and a tested incident/rollback runbook.

## Acceptance Criteria

- UAT uses no production Supabase service, key, Auth user, storage object, or operational record.
- A zero-state database can be rebuilt from the repository without manual schema edits.
- Every business command has exactly one authoritative owning module.
- Procurement cannot assert physical receipt; Warehouse receipt drives stock and Finance readiness.
- My Work matches actual assignee, DOA tier, scope, and source state.
- Unified Finance roles and workspace cover Procurement and Warehouse responsibilities without broadening source access.
- Events closes only after physical and financial reconciliation.
- Insights status, freshness, and drill-downs are accurate and role-safe.
- All supported role and multi-role workflows pass three desktop/mobile certification runs with governed cleanup.
- Production remains unchanged until the UAT release is explicitly promoted.
