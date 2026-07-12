# Mwell Intra Production Readiness Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the audit's production trust blockers, close the highest-risk roadmap gaps, and leave repeatable release evidence for every Mwell Intra role and module.

**Architecture:** The authenticated shell remains the owner of identity and Supabase client construction. Department modules receive authenticated dependencies explicitly, database state transitions remain capability-gated RPCs, private files live in Supabase Storage, and local/demo adapters are opt-in only. Verification is split into deterministic unit/contract tests, migration checks, rendered responsive checks, and live read/write gates.

**Tech Stack:** Next.js, React, TypeScript, Vitest, Playwright, Supabase Auth/Postgres/Storage, SQL migrations, pnpm/Turborepo.

## Global Constraints

- Production authorization must derive from server-validated Supabase identity and database role assignments.
- Production Warehouse must fail closed when its authenticated Supabase dependency is unavailable.
- MVP integrations remain CSV handoff; no ERP, courier, payment, OCR, RFID, or scanner integration is introduced.
- Private documents and generated exports require server-side authorization, private Storage, and audit evidence.
- New database functions must set a safe `search_path`, revoke default execution, and grant only the intended role.
- All behavior changes follow red-green-refactor and receive a targeted verification step.
- Live Supabase migration application and Vercel deployment require a separate release action after local verification.

---

### Task 1: Warehouse Live Data Boundary

**Files:**
- Modify: `modules/warehouse/src/WarehouseApp.tsx`
- Modify: `modules/warehouse/src/app/store.tsx`
- Modify: `packages/data-kit/src/createRepository.ts`
- Test: `modules/warehouse/src/WarehouseApp.test.tsx`
- Test: `packages/data-kit/src/createRepository.test.ts`

**Interfaces:**
- Consumes: `useSession().supabaseClient` and `useSession().mode`.
- Produces: `WarehouseProvider` props `supabaseClient?: SupabaseClient` and `source?: DataSource`; `createRepository` throws when `dataSource: 'supabase'` lacks a usable adapter.

- [ ] Add a failing factory test proving explicit Supabase mode cannot fall back to memory.
- [ ] Add a failing module test proving a live shell session supplies the authenticated client and renders a live source.
- [ ] Pass the session client/source into `WarehouseProvider` and construct the repository explicitly.
- [ ] Keep memory mode available only when the shell itself is in memory mode or a test injects a repository.
- [ ] Run `pnpm --filter @intra/data-kit test` and `pnpm --filter @intra/warehouse test`.

### Task 2: Procurement Submission And Approval Contract

**Files:**
- Create: `supabase/migrations/<cli-timestamp>_repair_procurement_submission_contract.sql`
- Create: `scripts/verify-effective-procurement-contract.mjs`
- Modify: `scripts/verify-supabase-cutover.mjs`
- Modify: `package.json`
- Test: `modules/procurement/src/tiers.test.ts`

**Interfaces:**
- Produces: `procurement.derive_approval_tiers(estimated_amount, category, sourcing_method)` and a final `procurement.submit_request(payload jsonb)` that uses `array_append`, locks the draft, creates the ordered ladder, and always includes the final approver tier.

- [ ] Add a failing static contract verifier that resolves the last effective function definition and rejects scalar array concatenation.
- [ ] Add boundary tests for finance/legal/final approver tier derivation.
- [ ] Generate the migration with `supabase migration new repair_procurement_submission_contract`.
- [ ] Implement the corrected functions with explicit schema references, safe search path, grants, and activity logging.
- [ ] Extend the Supabase verifier to exercise tier derivation and verify approval-step reachability.
- [ ] Run the static verifier, Procurement tests, migration-list check, and a database dry run when a local Supabase instance is available.

### Task 3: Private Procurement Attachments And Vendor Invitations

**Files:**
- Modify: `modules/procurement/src/pages/CreateRequestPage.tsx`
- Modify: `modules/procurement/src/localStore.ts`
- Create: `modules/procurement/src/attachments.ts`
- Create: `apps/shell/app/api/legal/vendor-invites/route.ts`
- Modify: `modules/legal/src/localStore.ts`
- Modify: `modules/legal/src/pages/InviteVendorPage.tsx`
- Create: `supabase/functions/vendor-invite/index.ts` only if the existing Next server boundary cannot preserve user authorization.
- Create: `supabase/migrations/<cli-timestamp>_govern_procurement_attachments_and_vendor_invites.sql`
- Test: `modules/procurement/src/attachments.test.ts`
- Test: `modules/legal/src/localStore.test.ts`

**Interfaces:**
- Produces: attachment metadata with `storagePath`, checksum, MIME type, and size; no base64 payload in `procurement.requests`.
- Produces: authenticated vendor invitation endpoint that calls the capability-gated Legal RPC and `auth.admin.inviteUserByEmail` only from a server runtime.

- [ ] Add failing tests that reject base64 persistence and unsafe attachment types/sizes.
- [ ] Upload files to the private `procurement-requests` bucket using request-scoped paths and persist only metadata.
- [ ] Add owner/capability Storage policies for insert/select/delete cleanup and a controlled signed-access RPC.
- [ ] Add an authenticated server invitation boundary; never expose the service role key to the browser.
- [ ] Replace demo invite copy with delivery state, resend/error handling, and an explicit unavailable state when server secrets are absent.
- [ ] Verify negative RLS cases, a successful signed URL, invitation authorization, and error recovery.

### Task 4: Responsive Operational UI And PWA

**Files:**
- Modify: shared hero implementation under `packages/ui/src/**`
- Modify: shell navigation/layout under `apps/shell/**`
- Modify: `modules/warehouse/src/components/AppShell.tsx`
- Modify: affected Legal, Procurement, Vendor, Admin pages identified by rendered audit evidence.
- Modify: service-worker registration/config under `apps/shell/**`
- Test: shared component tests and Playwright responsive checks under `.qa/**`

**Interfaces:**
- Produces: readable module heroes at 320-1440 px, 44 px minimum interactive targets, bottom-nav clearance with safe-area padding, and production PWA registration enabled by default with an explicit opt-out.

- [ ] Add failing DOM/layout assertions for hero text clearance, sticky-action/bottom-nav clearance, touch targets, and horizontal overflow.
- [ ] Move decorative icon art behind content, reduce its mobile footprint/opacity, and keep operational actions in the first viewport.
- [ ] Add shell-level mobile bottom padding and correct Legal checklist sticky offsets.
- [ ] Replace technical RPC names and production demo controls with user-facing operational language.
- [ ] Enable the service worker in production by default and verify manifest, offline fallback, update, and install behavior.
- [ ] Capture desktop and mobile screenshots for all role/module combinations and run the overlap crawler three times.

### Task 5: Governed Exports, Monitoring, And Release Gates

**Files:**
- Create: database migration for export jobs/checksum/review/audit lifecycle.
- Create: authenticated export request/download/review server routes.
- Modify: Warehouse/Finance export surfaces to use governed jobs instead of client-only Blob generation.
- Modify: `scripts/verify-supabase-cutover.mjs`
- Modify: `.qa/final-intra-workflow-audit.mjs`
- Create: `.qa/verify-production-contracts.mjs`
- Modify: monitoring/error-boundary/health code under `apps/shell/**`

**Interfaces:**
- Produces: private CSV object, SHA-256 checksum, creator/reviewer/timestamps, correction chain, short-lived download, and activity-log entries.
- Produces: verifier output that distinguishes memory reload from live database persistence and fails when live proof is required.

- [ ] Add failing tests for export authorization, checksum stability, correction lineage, and audit entries.
- [ ] Implement governed export RPC/server flow and replace client-only download actions.
- [ ] Add structured error reporting hooks, health checks, and environment validation without logging secrets or document payloads.
- [ ] Make release scripts fail closed for Warehouse database read-back, Procurement progression, private file access, and role denial.
- [ ] Verify anonymous/wrong-role denial and creator/reviewer separation.

### Task 6: Security, Performance, And Code Quality

**Files:**
- Modify: Warehouse Supabase repository query projections/pagination.
- Create: final migration consolidating exposed function grants, finance view availability, indexes, and safe search paths.
- Modify: large client stores only where extraction is required for tested boundaries.
- Modify: CI/runtime configuration to enforce Node >=22 and uncached release verification.

**Interfaces:**
- Produces: bounded Warehouse reads, security-invoker finance views, minimal exposed RPC surface, and deterministic Node/runtime checks.

- [ ] Add query-shape tests and replace `select('*')` with explicit projections plus bounded operational history.
- [ ] Inventory the final effective function/grant surface and revoke unintended `public`/`anon` execution.
- [ ] Restore the missing Finance live view with `security_invoker = true` and explicit grants/RLS-compatible source access.
- [ ] Add runtime and migration-order checks that fail on stale function redefinitions.
- [ ] Run lint, typecheck, unit tests, SQL static checks, and Supabase advisors where available.

### Task 7: Roadmap Traceability And Launch Governance

**Files:**
- Create: `docs/REQUIREMENTS_TRACEABILITY_MATRIX.md`
- Create: `docs/UAT_AND_ISSUE_MANAGEMENT.md`
- Create: `docs/USER_TRAINING_AND_OPERATIONS_MANUAL.md`
- Create: `docs/MIGRATION_CUTOVER_HYPERCARE_RUNBOOK.md`
- Create: `docs/import-templates/*.csv`
- Modify: roadmap comparison documentation and release checklist.

**Interfaces:**
- Produces: owner/status/evidence mapping for F-013, F-029, F-086, F-087, F-100, and F-101; validated import templates; role-based UAT scenarios; rollback and hypercare ownership.

- [ ] Build the RTM from roadmap IDs to routes, RPCs, tests, evidence, owners, and launch status.
- [ ] Add a defect/UAT workflow with severity, SLA, retest, waiver, and approval fields.
- [ ] Add versioned CSV templates and a validation/readme contract.
- [ ] Add role-based training, support, rollback, cutover, data reconciliation, and hypercare checklists.
- [ ] Add Legal accreditation summary export coverage for F-029.
- [ ] Verify every roadmap launch item has either working evidence or an explicit external owner/blocker.

### Task 8: Final Verification And Release Evidence

**Files:**
- Modify: release evidence/checklist files only when verification produces new evidence.

**Interfaces:**
- Produces: a clean branch and a precise list of code-complete, environment-dependent, and business-signoff-dependent items.

- [ ] Run fresh, uncached unit/component/domain tests.
- [ ] Run lint, typecheck, and production build under Node >=22.
- [ ] Run static migration/security/secret scans.
- [ ] Start the local production-equivalent app and run desktop/mobile role crawls three times.
- [ ] Run live Supabase read/write/negative-access verification only against the explicitly configured test project.
- [ ] Review the diff, document residual external dependencies, and prepare the branch for review without deploying it.
