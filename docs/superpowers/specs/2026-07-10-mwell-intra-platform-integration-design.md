# Mwell Intra Platform Integration Design

**Date:** 2026-07-10

**Status:** Approved for implementation planning

**Product boundary:** Mwell Intra is the product. Warehouse, Legal, Vendor, Procurement, Finance, and Admin are components of the same protected operating platform.

**Deployment target:** `https://mwell-intra.vercel.app/`

## 1. Objective

Complete Mwell Intra as a coherent internal operating platform instead of treating Warehouse as the application and the other areas as attachments.

The release must let authorized users progress work across department boundaries, understand ownership and status, and verify that every important action is persisted and auditable. The app must remain usable on desktop, tablet, and mobile without weakening server-side authorization.

## 2. Release Scope

### Included

- Authenticated Command Center.
- Legal vendor accreditation and document governance.
- External Vendor Portal.
- Procurement request, approval, award, and purchase-order workflow.
- Warehouse receiving, quality, storage, inventory, allocation, count, return, and reporting workflow.
- First-class Finance workspace for MVP handoff, reconciliation, valuation, review, and corrections.
- First-class Admin workspace for users, scoped roles, audit, environment health, and launch governance.
- Cross-module handoffs and visible activity evidence.
- Supabase Auth, Postgres, Storage, RLS, controlled RPCs, and authenticated server routes.
- PWA behavior and responsive UI from 320px through 1440px.
- Repeatable local and designated-test-project release gates.

### Excluded From This Release

- Full general ledger or accounts-payable implementation.
- BIR 2307 issuance.
- Live ERP, ecommerce, courier, payment, or BI integration.
- Odoo implementation, hosting, licenses, or migration.
- RFID.
- Production test mutations using real business records.

MVP integration remains governed CSV/file handoff. Later integrations must consume the same audited transaction boundaries rather than bypass them.

## 3. Information Architecture

The authenticated shell owns global identity, navigation, notifications, theme, command palette, route protection, error reporting, and service-worker lifecycle.

| Route | Product area | Primary responsibility |
| --- | --- | --- |
| `/` | Command Center | Assigned work, approvals, handoffs, exceptions, and module entry |
| `/legal` | Legal | Accreditation queue, case review, document gates, decisions, signing |
| `/vendor` | Vendor Portal | Vendor-owned application, documents, status, and corrections |
| `/procurement` | Procurement | Requests, sourcing basis, approval ladder, award, PO handoff |
| `/warehouse` | Warehouse | Receipt through inventory custody, issue, return, count, and reporting |
| `/finance` | Finance | Reconciliation, valuation, governed exports, review, and correction |
| `/admin` | Admin | Governance overview, users, roles, audit, health, and launch controls |

### Route Migration

- `/warehouse/finance` remains a temporary compatibility redirect to `/finance`.
- `/admin/users` remains a supported child route under the new `/admin` workspace.
- Existing Legal, Vendor, Procurement, and Warehouse deep links remain stable.
- Redirect parameters remain same-origin relative paths only.

## 4. Command Center

The Command Center is the first authenticated screen and must reflect the whole platform.

It shows:

- Modules available to the current user.
- Work assigned to the current user.
- Approvals waiting on the current user.
- Cross-module handoffs that are blocked or ready.
- High-severity exceptions and failed jobs.
- Recent activity relevant to the user's roles.
- Backend/environment state without exposing technical secrets.

Cards must open real protected routes. Counts must come from repositories or governed read models, not independent local demo stores in live mode.

Users with no module role receive a clear no-access state and an administrator contact path. A Core Platform Administrator does not automatically gain department access.

## 5. Department Workflows

### 5.1 Vendor And Legal

1. Legal invites a vendor through an authenticated server boundary.
2. The vendor account is linked to one vendor record.
3. The vendor completes accreditation fields and uploads private documents.
4. Legal reviews checklist requirements, requests corrections, and records decisions.
5. Signed instruments use short-lived governed access and access auditing.
6. Accreditation state and expiry become the authoritative procurement vendor gate.

Required negative paths include wrong-vendor access, unsafe upload, missing requirement, expired accreditation, unauthorized decision, duplicate submission, and signing-link expiry.

### 5.2 Procurement

1. A requester drafts a purchase request with line items and governed attachments.
2. Submission derives the approval ladder from policy and locks the submitted version.
3. Approvers act only on their assigned active step and cannot self-approve where separation is required.
4. Procurement records sourcing basis, vendor choice, award evidence, and PO details.
5. PO issuance requires an eligible vendor and one canonical PO handoff.
6. The issued PO becomes visible to Warehouse receiving without a duplicate local PO record.

Required negative paths include threshold boundaries, stale approval, skipped tier, self-approval, unaccredited vendor, duplicate PO, unauthorized attachment access, and rejected/resubmitted requests.

### 5.3 Warehouse

Warehouse retains the implemented W1 control model but participates in the Intra-wide handoff contract.

1. Warehouse receives an issued Procurement PO.
2. Receiving records exact quantities, lots, serials, evidence, and idempotency.
3. Quality inspection accepts, holds, rejects, releases, or creates a vendor return.
4. Accepted stock is put away into governed locations and bins.
5. Allocation, issue, return, transfer, and cycle count preserve exact-unit custody.
6. Variances and controlled adjustments use Supervisor/Finance approval where required.
7. Inventory position and movement evidence feed Finance and Command Center read models.

No Warehouse screen may own a parallel vendor, PO, Finance, or role source of truth in live mode.

### 5.4 Finance

Finance becomes a first-class Intra area while remaining deliberately narrower than an accounting system.

It provides:

- Inventory valuation and landed-cost visibility.
- Movement, receipt, hold, return, and adjustment reconciliation.
- Event and promotional inventory usage summaries.
- Governed export jobs with checksum, creator, reviewer, timestamps, correction lineage, and short-lived download.
- Review, correction, and sign-off states.
- Read-only visibility for BI where granted.

Finance data comes from security-invoker read models and controlled export functions. Direct client-only Blob exports are not launch evidence.

### 5.5 Admin

Admin becomes a workspace rather than a single role matrix.

It includes:

- `/admin`: governance overview and launch health.
- `/admin/users`: profiles, account status, scoped role assignment, and deprovisioning controls.
- `/admin/audit`: searchable actor, module, entity, action, timestamp, result, and correlation ID.
- `/admin/health`: environment checks, migration compatibility, storage availability, service worker state, and integration readiness.

Admin does not grant itself department authority. Role mutations use controlled RPCs, require explicit confirmation, and create immutable audit records.

## 6. Cross-Module State Model

The core launch flow is:

```text
Vendor invited
  -> application submitted
  -> Legal documents complete
  -> Legal accredited
  -> Procurement request submitted
  -> approval ladder completed
  -> purchase order issued
  -> Warehouse receipt staged
  -> quality accepted or exception routed
  -> stock put away
  -> Finance export/reconciliation reviewed
```

Every transition records:

- Transaction or command ID.
- Actor from the server-validated session.
- Previous and resulting state.
- Source and destination entity references.
- Timestamp and correlation/idempotency key.
- Visible activity/audit evidence.

Downstream modules read canonical upstream state. They do not infer authorization or readiness from copied labels, browser storage, or user-provided status fields.

## 7. Identity And Authorization

- Supabase Auth is the live identity provider.
- The browser verifies sessions with `auth.getUser()` before projecting a profile.
- Authorization claims use `app_metadata`, never user-editable metadata.
- Roles remain module-scoped: `core`, `legal`, `procurement`, and `warehouse`; Finance access is initially expressed through approved Finance/BI capabilities while the database contract is migrated deliberately.
- Client checks control presentation only. RLS and controlled RPC/server boundaries are authoritative.
- Core Platform Admin has governance capabilities but no implicit Legal, Procurement, Warehouse, or Finance authority.
- Vendor users are restricted to their linked vendor record and private document paths.

## 8. Supabase And Storage Boundaries

- Every Data API table has RLS enabled and forced where the current contract requires it.
- Anonymous table/function/storage access is revoked unless explicitly public and documented.
- Exposed RPC wrappers use invoker semantics and delegate to guarded private implementations where needed.
- Private `SECURITY DEFINER` functions remain outside exposed schemas, set a safe `search_path`, validate actor/capability/state, and revoke default execution.
- Views exposed to authenticated users use `security_invoker = true` or remain inaccessible.
- Procurement, Legal, Finance, and Warehouse evidence lives in private buckets.
- Signed URLs are short-lived, capability checked, and audited.
- The service-role key is server-only and never appears in public environment variables, browser bundles, logs, or committed examples.

New-project compatibility must account for Supabase Data API exposure no longer being automatic. Required schema/table/function grants are explicit in migrations.

## 9. Frontend And Responsive Standards

The shared shell and design system define the visual contract across modules.

- Desktop uses persistent global navigation and dense operational layouts.
- Mobile uses bottom navigation in the thumb zone, with overflow areas in a named sheet/menu.
- Department navigation remains secondary to global Intra navigation.
- All interactive targets are at least 44px.
- No page-level horizontal overflow is allowed from 320px through 1440px.
- Sticky actions, sheets, keyboards, and safe areas must not overlap bottom navigation.
- Tables become mobile cards or contained, named, keyboard-focusable scroll regions.
- Empty, loading, error, offline, conflict, denied, success, and partial states are visually distinct.
- Dark and light themes preserve WCAG A/AA contrast and status meaning.
- Decorative artwork never obstructs operational copy or actions.

## 10. Error, Offline, And Conflict Handling

- Authentication and protected-route failures fail closed.
- Server/API errors show a user-facing recovery action plus a correlation ID.
- Client errors are reported without credentials, document payloads, or sensitive form data.
- Offline writes are allowed only for the documented Warehouse floor allowlist.
- Legal decisions, Procurement submission/approval, role changes, governed exports, and other high-risk commands require connectivity.
- Retried commands use idempotency keys.
- Stale/concurrent updates return a deterministic conflict state and never silently overwrite canonical data.

## 11. Verification Strategy

### Deterministic Local Gates

- Unit/domain/repository tests for every state transition and policy boundary.
- API route tests for authentication, authorization, validation, and error handling.
- Static migration checks for RLS, grants, safe search paths, effective function definitions, and migration order.
- Repository-wide lint, typecheck, dependency audit, and Node 22+ production build.

### Intra-Wide Browser Gates

Test all canonical personas across:

- Desktop 1440x900 and 1280x800.
- Tablet 768x1024.
- Mobile 390x844, 360x800, and 320x720.
- Light and dark themes where applicable.

Required browser evidence includes:

- Login, logout, reset, safe redirect, and hard-reload session restoration.
- Command Center and every accessible/denied module route.
- Vendor application and Legal review/correction/decision.
- Procurement request, tier approvals, award, and PO handoff.
- Warehouse receipt, quality, putaway, issue, return, count, and exception.
- Finance export, download, review, and correction.
- Admin role assignment, audit search, and health states.
- Cross-module happy paths, negative paths, duplicate submits, refresh persistence, and dead-end detection.
- Geometry, target size, overlap, accessibility, console, and screenshot review.

The complete responsive visual crawl runs three times. Automated screenshots require named Product/UX review before launch.

### Live Test-Project Gates

Live tests run only against a designated Supabase test project with synthetic records prefixed by a run ID.

They prove:

- Authorized write and canonical read-back.
- Wrong-role, wrong-vendor, and anonymous denial.
- Fresh-browser-session persistence.
- Audit/ledger evidence.
- Idempotency and concurrency invariants.
- Controlled cleanup or business reversal without deleting immutable evidence.

Production data is never mutated for QA.

## 12. Deployment And Rollback

1. Complete local gates on the Intra integration branch.
2. Apply migrations to the designated test project and run advisors/security checks.
3. Run all live personas and cross-module workflows.
4. Complete Product, Warehouse, Legal, Procurement, Finance, Admin, Security, and UX sign-off.
5. Push the reviewed branch and deploy a Vercel preview.
6. Repeat smoke, auth, PWA, and critical workflow checks on the preview.
7. Promote to `mwell-intra.vercel.app` only with explicit go/no-go approval.
8. Monitor health, auth, client errors, failed jobs, approval age, handoff age, and inventory invariants during hypercare.

Rollback triggers include cross-user data exposure, unauthorized state changes, login outage, unrecoverable transaction errors, duplicate financial/inventory movements, negative stock, broken private-file access, or unexplained audit loss.

Rollback preserves logs and immutable evidence, freezes writes when necessary, restores the prior application deployment, and applies only tested database recovery procedures.

## 13. Implementation Order

1. Platform route and RBAC contracts for first-class Finance/Admin.
2. Command Center and shared shell/navigation alignment.
3. Finance workspace extraction and governed read/export flows.
4. Admin overview, audit, health, and safer role administration.
5. Legal/Vendor and Procurement live repository completion.
6. Canonical cross-module handoffs and activity read models.
7. Whole-app responsive/accessibility remediation.
8. Intra-wide local E2E, visual evidence, and performance/security gates.
9. Designated Supabase test-project verification.
10. Vercel preview, post-deploy audit, and controlled production promotion.

## 14. Acceptance Criteria

Mwell Intra is ready for production promotion only when:

- All seven product areas are reachable through the authenticated shell according to scoped roles.
- Finance and Admin are first-class routes and no longer presented as Warehouse appendages.
- The complete Vendor-to-Finance launch flow progresses through canonical persisted state.
- Every high-risk action is server authorized, auditable, and persistent across a fresh session.
- Private documents and exports have governed access and no public leakage.
- All local, live test-project, responsive, accessibility, security, and build gates pass.
- Three full visual crawls pass and receive named review.
- There are zero open P0/P1 defects and every P2 has an owner or approved waiver.
- Cutover, rollback, support, training, and hypercare owners have signed off.

Until those criteria are met, the release may be code-complete or test-ready but must not be described as production-ready.
