# Unified Finance Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Warehouse-hosted Finance destination with a first-class `/finance` workspace that combines implemented Warehouse and Procurement financial activity for users holding either or both scoped Finance roles.

**Architecture:** Add `@intra/finance` as a UI and read-model package mounted by the Next.js shell. Authorization remains capability-based across existing module scopes (`warehouse:view_finance` or `procurement:view_finance`); this release does not invent a new Finance RBAC scope. Live reads use `core.v_finance_activity` plus Procurement payment-readiness and PO records, while existing operational modules remain the owners of PO, receipt, acceptance, adjustment, and review commands.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase JS, existing `@intra/auth`, `@intra/rbac`, and `@intra/ui` packages, Vitest, Playwright.

## Global Constraints

- Finance is a first-class Intra area, not a Warehouse subpage.
- One account may hold Warehouse Finance, Procurement Finance, or both roles.
- Cross-module visibility must not grant operational receiving, PO authoring, cycle-count entry, or administrator authority.
- Live data must come from RLS-protected Supabase read models and tables; memory mode uses deterministic demonstration data.
- Existing `/warehouse/finance` deep links must migrate without leaving users at a dead end.
- Desktop and mobile layouts must remain legible at 1440, 768, 390, 360, and 320 pixel widths.

---

### Task 1: Finance Access Contract

**Files:**
- Modify: `apps/shell/lib/navigation.ts`
- Modify: `apps/shell/lib/navigation.test.ts`
- Modify: `apps/shell/components/CommandPalette.tsx`
- Modify: `apps/shell/components/AppShell.tsx`
- Modify: `apps/shell/app/page.tsx`

**Interfaces:**
- Produces: `canAccessFinance(userRoles): boolean`
- Produces: `FINANCE_NAV.href === '/finance'`

- [ ] Write navigation tests proving Warehouse Finance, Procurement Finance, and a dual-role user each receive exactly one Finance destination.
- [ ] Run `pnpm --filter @intra/shell test -- navigation.test.ts` and verify the new cases fail against the Warehouse-only gate.
- [ ] Add `canAccessFinance()` using the union of the two existing `view_finance` capabilities and update dashboard, shell, and command-palette composition to use it.
- [ ] Run the focused shell tests and verify all Finance access cases pass.

### Task 2: Finance Read Model Adapter

**Files:**
- Create: `modules/finance/package.json`
- Create: `modules/finance/tsconfig.json`
- Create: `modules/finance/eslint.config.mjs`
- Create: `modules/finance/vitest.config.ts`
- Create: `modules/finance/src/types.ts`
- Create: `modules/finance/src/seed.ts`
- Create: `modules/finance/src/data.ts`
- Create: `modules/finance/src/data.test.ts`
- Create: `modules/finance/src/index.ts`

**Interfaces:**
- Produces: `FinanceActivity`, `FinancePaymentItem`, `FinanceData`, `FinanceSummary`
- Produces: `summarizeFinanceData(data): FinanceSummary`
- Produces: `useFinanceData(): { data, loading, error, refresh }`

- [ ] Write pure tests for committed value, receipt value, return value, open review count, returned exceptions, and source/status filtering.
- [ ] Run `pnpm --filter @intra/finance test` and verify failure before implementation.
- [ ] Implement deterministic memory data and a live adapter that reads `core.v_finance_activity`, `procurement.purchase_orders`, and `procurement.payment_readiness_packs` through the authenticated client.
- [ ] Preserve partial success: a failed optional source returns a visible source warning instead of replacing valid rows with an empty dashboard.
- [ ] Run Finance tests and typecheck.

### Task 3: Responsive Finance Workspace

**Files:**
- Create: `modules/finance/src/FinanceApp.tsx`
- Create: `modules/finance/src/components/FinanceOverview.tsx`
- Create: `modules/finance/src/components/FinanceReviewQueue.tsx`
- Create: `modules/finance/src/components/FinanceActivityTable.tsx`
- Create: `modules/finance/src/FinanceApp.test.tsx`

**Interfaces:**
- Consumes: `useFinanceData()` and `canAccessFinance()`
- Produces: `<FinanceApp />`

- [ ] Write component tests for signed-out, unauthorized, Warehouse-only, Procurement-only, dual-role, loading, partial-error, empty, and populated states.
- [ ] Build a restrained operational workspace with one KPI row, a review queue, cross-module activity filters, and links to owning records.
- [ ] Ensure procurement-only Finance users can open Finance even without a Warehouse role.
- [ ] Keep decisions in the existing PO detail workflow; Finance rows link to `/procurement/purchase-orders/:id` and Warehouse rows link to their relevant operational area.
- [ ] Run Finance component tests, accessibility assertions, and typecheck.

### Task 4: Shell Route and Legacy Migration

**Files:**
- Create: `apps/shell/app/finance/page.tsx`
- Modify: `apps/shell/package.json`
- Modify: `modules/warehouse/src/app/App.tsx`
- Modify: `modules/warehouse/src/app/App.test.tsx`
- Modify: `apps/shell/tests/smoke/routes.spec.ts`
- Modify: `apps/shell/tests/e2e/all-user-types.spec.ts`

**Interfaces:**
- Produces: `/finance`
- Preserves: `/warehouse/finance` as a redirect to `/finance`

- [ ] Add route tests for direct navigation, shell navigation, command-palette navigation, and the legacy redirect.
- [ ] Mount `FinanceApp` at `/finance` and add the workspace dependency.
- [ ] Replace the Warehouse Finance route content with a deterministic redirect component.
- [ ] Update role fixtures so Warehouse, Procurement, and dual Finance personas cover the route.
- [ ] Run shell smoke and all-user-type tests.

### Task 5: Knowledge Base and User Guidance

**Files:**
- Modify: `apps/shell/lib/knowledge/features.ts`
- Modify: `apps/shell/lib/knowledge/roles.ts`
- Modify: `apps/shell/lib/knowledge/workflows.ts`
- Modify: `docs/manual/MWELL_INTRA_USER_MANUAL.md`

**Interfaces:**
- Produces: searchable Finance module, role, reconciliation, and payment-readiness guidance.

- [ ] Update role guidance to explain Warehouse Finance, Procurement Finance, dual assignment, and segregation of duties.
- [ ] Document Finance handoffs and decision points without claiming invoice payment or accounting-ledger functionality that is not implemented.
- [ ] Run the Knowledge Base verifier.

### Task 6: Release Verification

**Files:**
- Modify only if failures expose a Finance-specific defect.

- [ ] Run Finance and shell unit tests.
- [ ] Run monorepo typecheck, lint, and build.
- [ ] Start the local shell and verify Warehouse Finance, Procurement Finance, and dual-role personas.
- [ ] Inspect `/finance` at desktop and mobile widths for overflow, overlap, dead controls, illegible labels, and unreachable navigation.
- [ ] Capture desktop and mobile screenshots as implementation evidence.
- [ ] Verify `/warehouse/finance` resolves to `/finance`, role-denied access is explicit, and PO links preserve the owning workflow.

