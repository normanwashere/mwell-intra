# Intra UAT Foundation and Receipt Authority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isolate UAT, make departments and role bundles extensible, and establish Warehouse as the only authority for physical PO receipt.

**Architecture:** The new Supabase project is rebuilt from migrations and sanitized fixtures, with an environment guard preventing production mutation. Organization structure is stored as hierarchical data; roles remain reusable bundles of existing module capabilities. Procurement owns PO issuance and reads Warehouse receipt status, while Warehouse alone posts receipt, QC, custody, and inventory movements.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase Postgres/Auth/Storage/Edge Functions, Vitest, Node test runner, Playwright, pnpm/Turborepo.

## Global Constraints

- Do not copy production Auth users, operational rows, storage objects, SMTP credentials, or service secrets into UAT.
- Browser code receives only the UAT publishable key; secret/service-role keys remain server-side and vaulted.
- Departments and parent-child relationships are data, not TypeScript unions.
- A new role may bundle existing capabilities without application code changes; a new capability still requires a reviewed workflow change.
- Product owns client/product go-live approval. Client & Product Implementation coordinates delivery under Operations.
- Procurement is an independent enterprise department.
- Warehouse is the only authority for physical PO receipt.
- The supplied Procurement Policy, LGL004 Vendor Accreditation Form v2025, and Technology Service Provider MNDA are executable acceptance sources.
- Routine Warehouse operations must be executable by one Operator plus one Supervisor without permitting self-approval.
- Production remains unchanged throughout this plan.

---

### Task 1: Fail-Closed Environment and Mutation Guard

**Files:**
- Create: `scripts/lib/target-environment.mjs`
- Create: `scripts/lib/target-environment.test.mjs`
- Modify: `scripts/qa/policy-aligned-live-e2e.mjs`
- Modify: `scripts/qa/full-intra-live-e2e.mjs`
- Modify: `.env.example`
- Modify: `package.json`

**Interfaces:**
- Produces: `projectRefFromSupabaseUrl(url: string): string | null`
- Produces: `assertApprovedMutationTarget(input: MutationTargetInput): void`
- Consumes: `APP_ENV`, `SUPABASE_PROJECT_REF`, `PRODUCTION_SUPABASE_PROJECT_REF`, `NEXT_PUBLIC_SUPABASE_URL`, `AUDIT_MUTATIONS`, and `POLICY_ALLOW_TEST_MUTATIONS`.

- [ ] **Step 1: Write failing guard tests**

Cover malformed URLs, project-ref mismatch, missing production ref, production-target mutation, read-only production smoke, UAT mutation without explicit approval, and approved UAT mutation.

```js
assert.throws(() => assertApprovedMutationTarget({
  appEnv: 'uat',
  supabaseUrl: 'https://production-ref.supabase.co',
  expectedProjectRef: 'production-ref',
  productionProjectRef: 'production-ref',
  mutationsRequested: true,
  mutationsApproved: true,
}), /production Supabase project/i);

assert.doesNotThrow(() => assertApprovedMutationTarget({
  appEnv: 'uat',
  supabaseUrl: 'https://uat-ref.supabase.co',
  expectedProjectRef: 'uat-ref',
  productionProjectRef: 'production-ref',
  mutationsRequested: true,
  mutationsApproved: true,
}));
```

- [ ] **Step 2: Run the tests and confirm failure**

Run: `node --test scripts/lib/target-environment.test.mjs`  
Expected: FAIL because `target-environment.mjs` does not exist.

- [ ] **Step 3: Implement the shared guard**

The implementation must parse the hostname exactly, reject non-Supabase hosts, compare exact project references, and refuse mutations when the production reference is missing.

```js
export function projectRefFromSupabaseUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    const match = /^([a-z0-9]+)\.supabase\.co$/.exec(host);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Route every live runner through the guard**

Replace the current substring project check in `policy-aligned-live-e2e.mjs`. Add the same preflight to `full-intra-live-e2e.mjs` before browser launch. Log only environment name and project ref, never keys or passwords.

- [ ] **Step 5: Document exact environment variables and add a test script**

Add `test:environment-guard` to `package.json`. Update `.env.example` with empty values and comments distinguishing production, UAT, and local targets.

- [ ] **Step 6: Verify and commit**

Run:

```powershell
node --test scripts/lib/target-environment.test.mjs
pnpm test:intra-live-contract
pnpm lint
```

Expected: all pass.  
Commit: `feat: guard UAT mutations from production`

---

### Task 2: Configurable Organization and Role Bundles

**Files:**
- Create with `supabase migration new core_organization_extensibility`: `supabase/migrations/*_core_organization_extensibility.sql`
- Create: `scripts/verify-organization-contract.mjs`
- Create: `scripts/verify-organization-contract.test.mjs`
- Modify: `packages/auth/src/claims.ts`
- Modify: `packages/auth/src/claims.test.ts`
- Modify: `packages/auth/src/contracts.ts`
- Modify: `packages/auth/src/SessionProvider.tsx`
- Modify: `packages/auth/src/Guard.tsx`
- Modify: `apps/shell/app/admin/users/page.tsx`
- Create: `apps/shell/app/admin/departments/page.tsx`
- Modify: `apps/shell/app/admin/page.tsx`
- Modify: `apps/shell/lib/routes.ts`
- Modify: `apps/shell/lib/navigation.ts`
- Modify: `apps/shell/lib/navigation.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces tables: `core.departments`, `core.profile_department_scopes`.
- Produces RPCs: `core.list_departments()`, `core.upsert_department(jsonb)`, `core.assign_profile_department(jsonb)`, `core.list_rbac_catalog()`, `core.upsert_role_bundle(jsonb)`, `core.my_capabilities()`.
- Produces client type: `UserCapabilities = Partial<Record<Module, string[]>>`.
- Preserves authoritative checks through `core.has_cap(module, cap)`.

- [ ] **Step 1: Write migration contract tests first**

The verifier must require hierarchical departments, cycle prevention, soft deactivation, historical-reference preservation, scoped assignments, admin-only writes, role-bundle validation against existing capabilities, audit logging, and self capability projection.

```js
assert.match(sql, /create table if not exists core\.departments/i);
assert.match(sql, /parent_id uuid references core\.departments/i);
assert.match(sql, /create or replace function core\.upsert_role_bundle/i);
assert.match(sql, /create or replace function core\.my_capabilities/i);
assert.match(sql, /core\.has_cap\('core',\s*'manage_rbac'\)/i);
```

- [ ] **Step 2: Run the verifier and confirm failure**

Run: `node --test scripts/verify-organization-contract.test.mjs`  
Expected: FAIL because the migration and verifier are absent.

- [ ] **Step 3: Create the migration with Supabase CLI and implement the schema**

Run `supabase migration new core_organization_extensibility` and edit the generated file. Use stable text codes, UUID primary keys, an optional self-referencing parent, active status, ordering, effective scope dates, and `on delete restrict` for historical integrity.

Seed these records idempotently:

```text
marketing
sales
product
technology
pmo
operations
operations.warehouse_logistics
operations.customer_service
operations.client_product_implementation
finance
procurement
legal_compliance
people_culture
administration
```

Product is the recorded go-live authority. Operations is the parent of Warehouse & Logistics, Customer Service, and Client & Product Implementation. Procurement has no parent.

- [ ] **Step 4: Make roles runtime bundles of existing capabilities**

`upsert_role_bundle` may create or rename a role and replace its grants only with rows already present in `core.capabilities`. It cannot create capabilities, alter protected bootstrap roles, grant itself `core:manage_rbac`, or modify the caller's own assignment. Record before/after values in `core.activity_log`.

Seed `warehouse_operator` and `warehouse_supervisor` as the canonical two-person operating bundles. Keep existing Operations and Logistics Supervisor assignments as migration aliases until active users are remapped. Finance, Procurement, BI/Insights, Marketing/Events, and Pricing responsibilities must not be bundled into either Warehouse operating role.

- [ ] **Step 5: Project effective capabilities to the authenticated client**

Add `parseUserCapabilitiesFromClaims` and a verified `my_capabilities()` refresh after `auth.getUser()`. `useCan` should prefer the live capability snapshot and use static role matrices only in memory mode. Database RPC/RLS remains authoritative.

```ts
export type UserCapabilities = Partial<Record<Module, readonly string[]>>;

export function useCan<M extends Module>(module: M, cap: CapabilityFor<M>) {
  const { mode, userRoles, userCapabilities } = useSession();
  return mode === 'supabase'
    ? userCapabilities[module]?.includes(cap) === true
    : can(userRoles, module, cap);
}
```

- [ ] **Step 6: Read the live role catalogue in User Administration**

Replace `buildRoleColumns()` as the live source with `list_rbac_catalog()`. Keep the static registry only for memory/demo mode. Unknown or inactive role bundles must display safely and remain revocable.

- [ ] **Step 7: Add Department Administration**

Create a compact tree/list page with add, rename, re-parent, reorder, and deactivate commands. Use a modal/sheet for editing, prevent selecting the department itself or its descendants as parent, and explain blocked deactivation when unresolved work exists.

- [ ] **Step 8: Verify and commit**

Run:

```powershell
node --test scripts/verify-organization-contract.test.mjs
pnpm --filter @intra/auth test
pnpm --filter @intra/shell test
pnpm typecheck
pnpm lint
```

Expected: all pass.  
Commit: `feat: add configurable departments and role bundles`

---

### Task 3: Enforce Policy Eligibility and Make Warehouse the Sole Receipt Authority

**Files:**
- Create with `supabase migration new single_po_receipt_authority`: `supabase/migrations/*_single_po_receipt_authority.sql`
- Create: `scripts/verify-po-receipt-authority.mjs`
- Create: `scripts/verify-po-receipt-authority.test.mjs`
- Modify: `modules/procurement/src/pages/PODetailPage.tsx`
- Create: `modules/procurement/src/pages/PODetailPage.test.tsx`
- Modify: `modules/procurement/src/localStore.ts`
- Modify: `modules/procurement/src/types.ts`
- Modify: `modules/procurement/src/policy.ts`
- Modify: `modules/procurement/src/policy.test.ts`
- Modify: `modules/legal/src/requirements/vendorAccreditationV2025.ts`
- Modify: `modules/legal/src/requirements/vendorAccreditationV2025.test.ts`
- Modify: `modules/legal/src/requirements/catalog.ts`
- Modify: `modules/legal/src/requirements/catalog.test.ts`
- Modify: `modules/legal/src/requirements/mndaTechnologyV2026.test.ts`
- Modify: `modules/warehouse/src/app/modules.ts`
- Modify: `modules/warehouse/src/app/modules.test.ts`
- Modify: `modules/warehouse/src/components/AppShell.tsx`
- Modify: `modules/warehouse/src/components/AppShell.test.tsx`
- Modify: `modules/warehouse/src/pages/DashboardPage.tsx`
- Modify: `modules/warehouse/src/pages/DashboardPage.test.tsx`
- Modify: `modules/warehouse/src/pages/ReceivingPage.tsx`
- Modify: `modules/warehouse/src/pages/ReceivingPage.test.tsx`
- Modify: `modules/warehouse/src/pages/CycleCountsPage.tsx`
- Modify: `modules/warehouse/src/pages/CycleCountsPage.test.tsx`
- Modify: `modules/warehouse/src/pages/QualityPage.tsx`
- Modify: `modules/warehouse/src/pages/QualityPage.test.tsx`
- Modify: `modules/warehouse/src/pages/ApprovalsPage.tsx`
- Modify: `modules/warehouse/src/pages/ApprovalsPage.test.tsx`
- Modify: `modules/warehouse/src/data/procurementBridge.ts`
- Modify: `modules/warehouse/src/data/procurementBridge.test.ts`
- Modify: `modules/warehouse/src/pages/PurchaseOrdersPage.tsx`
- Modify: `modules/warehouse/src/pages/PurchaseOrdersPage.test.tsx`
- Modify: `scripts/qa/full-intra-live-e2e.mjs`

**Interfaces:**
- Removes command: `procurement.receive_purchase_order`.
- Keeps command: `warehouse.receive_procurement_po(payload jsonb)`.
- Produces read model: `procurement.v_purchase_order_receipt_status` with accepted, rejected/quarantined, outstanding, receipt reference, QC status, and last receipt time.
- Procurement reads receipt state but never writes it.
- Preserves RFQ below PHP 1,000,000 and RFP at/above PHP 1,000,000 or for complex/high-risk/data-sensitive work.
- Blocks award/issue without full accreditation or a current scoped temporary clearance.

- [ ] **Step 1: Write contract and UI tests first**

Require that the migration revokes/drops the Procurement receipt command, Warehouse receipt remains capability-gated and idempotent, Procurement detail has no `Receive items` button, and the page shows a Warehouse status/link for issued POs.

```tsx
expect(screen.queryByRole('button', { name: /receive items/i })).not.toBeInTheDocument();
expect(screen.getByText(/warehouse receiving/i)).toBeInTheDocument();
expect(screen.getByRole('link', { name: /open warehouse handoff/i })).toHaveAttribute(
  'href',
  expect.stringContaining('/warehouse/purchase-orders'),
);
```

- [ ] **Step 2: Run focused tests and confirm failure**

Run:

```powershell
node --test scripts/verify-po-receipt-authority.test.mjs
pnpm --filter @intra/procurement test -- PODetailPage
```

Expected: FAIL because Procurement still exposes receipt.

- [ ] **Step 3: Implement the database authority migration**

Run `supabase migration new single_po_receipt_authority`. Revoke all execution from `procurement.receive_purchase_order`, remove it after confirming no governed caller remains, and create a security-invoker receipt-status view sourced from Warehouse receipt/QC records and Procurement ordered quantities. Do not expose private evidence paths.

- [ ] **Step 4: Lock policy and accreditation requirements to the supplied sources**

Add fixtures for RFQ, RFP threshold, complex/high-risk RFP, Direct Award, repeat order, emergency, petty cash, importation, foreign vendor, down payment, manpower, construction, equipment installation, and payment readiness. Confirm entity-type document branching, foreign equivalents, privacy/cybersecurity conditional evidence, manpower/technology qualifications, declarations, authorized signatory, and current NDA.

Technology-provider NDA tests must cover need-to-know handling, Data Privacy Act obligations, the two-year or definitive-agreement expiry rule, and the five-business-day return/destruction obligation. Do not invent a signature authority or legal conclusion not present in the approved source.

Audit the blocking catalogue as well as the form-specific helper. A requirement may block accreditation only when it cites the supplied LGL004 form, the supplied MNDA, another approved policy, applicable law, an approved risk classification, or an engagement-specific Legal decision. The supplied LGL004 form does not make ISO 27001 universally mandatory for every technology vendor; optional recommendations must remain guidance rather than false blockers.

- [ ] **Step 5: Remove the Procurement receipt mutation**

Delete `ReceiveInput`, the `receive` API method, local memory receipt mutation, receive sheet state, and button. Keep receipts as a read-only mapped projection populated by Warehouse status in live mode.

- [ ] **Step 6: Replace the control with an explicit handoff panel**

For issued or partially received POs, show ordered, accepted, rejected/quarantined, and outstanding quantities plus latest QC state. Procurement roles see `Open Warehouse handoff`; users without Warehouse access see read-only status without a dead link.

- [ ] **Step 7: Simplify Warehouse for two-person operation**

Give the Operator four primary flows only: `Receive and inspect`, `Put away`, `Pick or issue`, and `Returns and counts`. A clean, expected receipt can move from scan to putaway without Supervisor approval. Require Supervisor action for excess/short/damaged/unidentified receipt, rejection/quarantine disposition, hold release, manual adjustment, material count variance, write-off, and override.

Apply this to the actual desktop/mobile navigation, dashboard actions, receiving, quality, approvals, and cycle-count surfaces. Legacy roles remain migration aliases, but advanced Finance, Procurement authoring, pricing, analytics, events, supplier, or platform-administration controls must not remain in the Operator's primary workflow.

No actor may both perform and approve a controlled transaction. Temporary delegation may substitute personnel but cannot collapse the two actors into one account.

- [ ] **Step 8: Harden Warehouse receiving**

Verify only `warehouse:receive_stock` can execute the RPC. Repeated idempotency keys return the original receipt. Excess quantities, cancelled POs, rejected lines, and concurrent final receipt attempts must fail without partial stock posting.

- [ ] **Step 9: Add cross-role and policy-negative E2E**

The Procurement officer test must prove no receipt control exists and direct RPC execution is denied. The Warehouse Operator test performs clean and partial receipts. The Supervisor resolves quarantine and a count variance. Tests must reject self-approval, expired accreditation, unapproved temporary clearance, unsupported Direct Award, split petty-cash use, missing importation controls, and payment readiness without accepted receipt or service evidence.

- [ ] **Step 10: Verify and commit**

Run:

```powershell
node --test scripts/verify-po-receipt-authority.test.mjs
pnpm --filter @intra/procurement test
pnpm --filter @intra/warehouse test
pnpm typecheck
pnpm lint
```

Expected: all pass.  
Commit: `fix: make warehouse authoritative for PO receipt`

---

### Task 4: Rebuild and Certify the Isolated UAT Project

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/seed.sql`
- Create: `scripts/qa/provision-intra-uat-users.mjs`
- Create: `scripts/qa/verify-intra-uat-bootstrap.mjs`
- Modify: `scripts/qa/full-intra-live-e2e.mjs`
- Modify: `scripts/qa/live-e2e-contract.test.mjs`
- Modify: `docs/UAT_AND_ISSUE_MANAGEMENT.md`
- Modify: `docs/audits/2026-07-14-UAT-INTRA-END-TO-END-AUDIT.md`

**Interfaces:**
- Consumes the new UAT project through vaulted environment variables.
- Produces deterministic synthetic role identities and fixtures.
- Produces a redacted bootstrap/certification report with migration checksum and cleanup result.

- [ ] **Step 1: Add failing bootstrap checks**

Require an empty-to-current migration replay, expected schemas/tables/functions, UAT environment marker, synthetic-only email policy, complete role matrix, and absence of production project references.

- [ ] **Step 2: Add reproducible Supabase configuration and sanitized seeds**

Configure Auth URLs for UAT, Storage limits/types, and local parity. Seed organization/reference data and deterministic QA records only. Do not seed passwords in SQL or tracked files.

- [ ] **Step 3: Apply migrations to the new UAT project**

Use the connected Supabase migration tool for DDL. Verify migration order after each failure rather than skipping files. Deploy `vendor-invite-delivery` with UAT-only secrets after schema success.

- [ ] **Step 4: Provision the role matrix**

Create isolated role users plus realistic multi-role users, including unified Finance. Store the shared audit password only in the CI/Vercel vault. Include expired, suspended, delegated, vendor, and no-access negative identities.

- [ ] **Step 5: Point only the UAT Vercel project to UAT Supabase**

Replace UAT environment variables, redeploy, and verify `/api/health` reports the expected environment/project without exposing keys. Production Vercel variables remain untouched.

- [ ] **Step 6: Run three certification passes**

Each pass covers desktop 1440/1280, tablet 768, mobile 390/360/320, all roles, access denial, vendor invite lifecycle, Procurement-to-Warehouse receipt handoff, cleanup, accessibility, console/network errors, and database readback.

The role matrix must include the two-person Warehouse pair and prove the complete clean path, every controlled Supervisor decision, and self-approval denial. The procurement matrix must include RFQ, RFP, Direct Award, petty cash, importation, temporary clearance, expired accreditation, technology-provider MNDA, partial/rejected Warehouse receipt, acceptance, and Finance payment readiness.

- [ ] **Step 7: Run Supabase advisors and verify cleanup**

Security advisor must have no errors. Performance findings are documented, not blindly removed. Query by run correlation ID and require zero residual QA transactions after cleanup.

- [ ] **Step 8: Update audit status and commit**

Record exact evidence, remaining blockers, and launch decision. Do not claim certification for any workflow not exercised.

Commit: `test: certify isolated Intra UAT foundation`

---

## Deferred Work

This plan deliberately does not build department-specific Marketing, Sales, Product, Technology, PMO, Customer Service, People, or Administration workflows. Those modules will be designed only when their actual states, decisions, evidence, privacy, and handoffs are known. They will plug into the organization, role, My Work, Knowledge, notification, and audit contracts created here.
