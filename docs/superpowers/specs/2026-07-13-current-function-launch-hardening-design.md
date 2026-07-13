# Current Function Launch Hardening Design

## Objective

Close the remaining launch-readiness gaps for functionality that is already implemented in Mwell Intra. This pass covers live database performance and policy hygiene, production-grade Knowledge Base evidence, role-based transactional verification, QA cleanup, deployment, and source-control integration.

The nine Knowledge Base workflows marked `limited` remain governed future-state guidance. They do not receive simulated controls, fake screenshots, or an implied production capability.

## Scope

### Included

- Command Center and shared authenticated shell.
- Legal vendor accreditation and document workflows that currently have executable routes and database operations.
- Procurement request, approval, sourcing, purchase-order, and handoff functionality that currently exists.
- Warehouse setup, receiving, quality, putaway, inventory, cycle-count, allocation, event, return, approval, exception, pricing, import, and export functionality that currently exists.
- Finance handoff and review functionality that currently exists.
- Administration, users, roles, department DOA, and governance functionality that currently exists.
- Knowledge Base workflows whose availability is `live`.
- Live Supabase security and performance advisor findings that affect current tables, policies, and authentication configuration.

### Excluded

- Building the nine workflows currently marked `limited` into transactional modules.
- ERP, courier, payment, OCR, scanner, RFID, ecommerce, or vendor self-service integrations outside the existing release boundary.
- Removing indexes solely because the advisor labels them unused in a low-traffic environment.
- Inventing screenshots for routes or workflow states that do not exist.

## Architecture

The remediation is delivered as four independently reviewable changes on the existing `codex/knowledge-base-semantic-remediation` branch.

1. A database migration closes actionable advisor findings while preserving access-control boundaries.
2. The Knowledge Base evidence registry and capture verifier make production evidence mandatory for every executable step.
3. The live E2E harness records role handoffs, verifies persisted state through the next role, and removes tagged QA records.
4. Release automation runs local and live gates before the verified commit is merged into `main` and redeployed.

Each change is testable independently. Database migration changes must pass advisor checks and direct access tests. Evidence changes must pass coverage, image integrity, hotspot, and viewport checks. E2E changes must prove both UI behavior and backend persistence.

## Database Hardening

### Foreign-Key Indexes

Generate covering indexes for current foreign keys reported by the live Supabase advisor. Index definitions are derived from `pg_constraint`, `pg_attribute`, and `pg_index`, and committed as explicit `create index if not exists` statements. Composite foreign keys receive matching composite indexes in constraint-column order.

Index creation must not change table grants, RLS, function ownership, or business behavior. The migration is verified by rerunning the advisor and confirming that the unindexed-foreign-key count is zero for current schemas.

### RLS Init-Plan Optimization

Update the five reported policies so stable auth expressions are evaluated once per statement, using `(select auth.uid())` or the equivalent selected helper expression. The policy predicates and role access must remain behaviorally identical.

Positive and negative access tests must run before and after the migration for:

- `procurement.request_attachments`
- `warehouse.export_jobs`
- `warehouse.stock_change_requests`
- `warehouse.import_jobs`
- `warehouse.import_errors`

### Duplicate Permissive Policies

Consolidate the two reported pairs on `procurement.purchase_orders` and `procurement.purchase_order_lines` into one select policy per table. The combined predicate is the logical union of the existing Procurement and Warehouse receivable access rules. Tests must prove both intended audiences retain access and an unrelated authenticated role remains denied.

### `warehouse.stock_levels` Identity

Inspect existing unique constraints and live duplicate data before selecting a primary key. Reuse an existing non-null unique identifier when available. If the table is a projection or materialized read model where a primary key would misrepresent identity, document and suppress the informational advisor through an explicit architectural decision rather than adding an unsafe key.

### Unused Indexes

Do not remove indexes based on a fresh or low-traffic advisor snapshot. Produce a classified report containing index name, owning constraint or query purpose, size, scan count, and migration origin. Constraint-supporting and current-workflow indexes are retained. A later maintenance window may remove only indexes with sustained zero usage and no policy, ordering, lookup, or uniqueness purpose.

### Auth Configuration

Leaked-password protection must remain enabled and the security advisor must return no warning. The service-only `warehouse.command_log` remains intentionally inaccessible to `anon` and `authenticated`; its no-policy informational notice is accepted because table grants are revoked and only `service_role` is granted access.

## Knowledge Base Evidence

### Evidence Contract

Every node in a `live` workflow that represents an executable user action must have:

- A production desktop screenshot at 1440 by 900.
- A production mobile screenshot at 390 by 844, with an additional 320-pixel overflow audit for compact layouts.
- The exact route, role, workflow state, source commit, capture timestamp, environment, and expected landmark.
- One or more numbered hotspots pointing to the actual control or status the written step references.
- A successful sensitive-data review.

Decision, system, exception, and terminal nodes may use a semantic panel when no user interaction exists. They must not claim to be screenshots.

### Capture Method

Use the authenticated production capture harness with environment-only credentials. The harness navigates to each declared state, verifies the expected landmark, captures both viewports, computes image hashes, and writes a manifest atomically. A failed node prevents the entire evidence set from being promoted.

Existing screenshots may be reused only when their source build matches the deployed application and their landmark and hotspot checks still pass. Otherwise they are recaptured.

### Presentation

The flow chart remains first. Step-by-step guidance follows with the applicable screenshot, hotspot legend, responsible role, completion evidence, exception path, and guided application link. Refresh and deep links restore the selected workflow, tab, and step without returning to the page top.

## Transactional E2E Design

### Role Matrix

The live test covers every provisioned current role, including platform staff and administrator, vendor, Legal reviewer/compliance/admin, Procurement requester/officer/approver/finance/admin, and all Warehouse operational roles.

Each role receives:

- Authorized route and action checks.
- Unauthorized route and action checks.
- Desktop and mobile visual checks.
- Refresh and session-restoration checks.
- Empty, invalid, duplicate, stale-state, and server-error handling where the function supports those states.

### Cross-Role Transactions

Scenarios use a run identifier such as `QA-20260713-<random>` and verify state after every handoff.

- Vendor application: invitation, vendor submission, Legal review, correction or disposition, and vendor readback.
- Procurement: request creation, routing, approval or rejection, sourcing/PO handoff, and downstream visibility.
- Warehouse: setup lookup, receipt, quality disposition, hold or release, putaway, inventory readback, cycle count, allocation/event issue, return, approval, and exception handling.
- Finance: governed export or handoff creation, download/review state, correction path, and audit evidence.
- Administration: user/role visibility, department DOA read and edit authorization, and audit trail.

UI success is not sufficient. Each state transition must be confirmed through a server-controlled read or a direct service-side verification query, followed by a read through the next role's UI.

### Negative And Edge Cases

- Wrong-role access and direct URL entry.
- Invalid, missing, duplicate, and over-limit values.
- Duplicate submission and idempotency behavior.
- Stale record version or already-completed action.
- Missing required evidence.
- Rejection, correction, and resubmission.
- Refresh during an in-progress form.
- Mobile keyboard, fixed navigation, modal, and overflow behavior.
- Session expiry and safe redirect behavior.

### QA Cleanup

The harness records every created identifier in a run manifest. Cleanup uses a server-authorized function or service-side script that deletes only records carrying that run identifier and verifies the deletion. Seed records, real records, auth users, and shared configuration are excluded from cleanup.

If referential constraints prevent deletion, the cleanup archives or marks the QA record according to the existing audit model and reports it explicitly. Cleanup failure makes the live gate fail.

## Release Workflow

The release gate runs in this order:

1. Migration verification and Supabase advisors.
2. Targeted database policy and persistence tests.
3. Lint and typecheck.
4. Full unit and integration tests.
5. Production build.
6. Knowledge Base coverage and evidence verification.
7. Live role-based E2E on desktop and mobile.
8. QA cleanup verification.
9. Production deployment and route smoke test.
10. Post-deployment targeted transaction and visual canary.
11. Merge the verified commit into `main` and confirm the production alias resolves to that commit.

No release-ready claim is made when any gate is skipped, when cleanup fails, or when production source provenance differs from the verified commit.

## Acceptance Criteria

- All current executable Knowledge Base steps have fresh, validated production evidence for desktop and mobile.
- Limited workflows remain clearly labeled and contain no simulated production evidence.
- Every current role passes authorized and unauthorized route checks at both viewports.
- Cross-role scenarios prove database writes, downstream reads, rejection/correction paths, and audit evidence.
- QA records created by the run are deleted or governed according to the audit model, with zero untracked residue.
- Supabase security advisor has no warning or error.
- Supabase performance advisor has no unindexed-foreign-key, auth-init-plan, duplicate-permissive-policy, or unsafe-primary-key finding for current functionality.
- Unused indexes have a documented keep/remove decision backed by purpose and usage evidence.
- Lint, typecheck, full tests, build, Knowledge Base verification, and live E2E pass from the final commit.
- The final commit is pushed, merged into `main`, deployed to production, and verified at `https://mwell-intra.vercel.app/`.

## Failure Handling

Database changes are additive or policy-equivalent and are applied in a reversible migration sequence. A failed live test stops deployment. A failed post-deployment canary keeps the remediation branch unmerged and requires rollback to the previous verified Vercel deployment. Screenshot promotion is atomic, so partial or stale evidence cannot silently replace the published set.
