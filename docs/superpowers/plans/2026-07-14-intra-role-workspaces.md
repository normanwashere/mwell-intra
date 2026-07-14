# Intra Role Workspaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class Events, My Work, and Insights workspaces that extract existing organization-wide responsibilities from Warehouse while preserving source-system commands and RLS.

**Architecture:** Add `events` and `insights` to canonical RBAC; keep My Work as a core aggregate workspace. Each workspace is a focused package mounted by the Next.js shell. Events owns intent and reads Warehouse fulfillment; My Work and Insights are read-only aggregators with source links. Compatibility redirects preserve existing Warehouse bookmarks.

**Tech Stack:** TypeScript, React 19, Next.js 16 App Router, Tailwind CSS, Supabase/Postgres RLS, Vitest, Playwright.

## Global Constraints

- Warehouse remains a component of Intra and owns physical stock commands.
- Source modules retain approve, reject, resolve, issue, receive, return, and export commands.
- Cross-module views use `security_invoker = true` and preserve source RLS.
- Current implemented functions ship first; speculative HR, IT, Facilities, CRM, and advanced analytics stay out of scope.
- Every route must support 1440, 1280, 768, 390, 360, and 320 pixel viewports without overflow or overlap.
- Every interactive target is at least 44 by 44 pixels on mobile.
- Existing `/warehouse/events`, `/warehouse/data`, and `/warehouse/reports` bookmarks receive HTTP 308 redirects.
- The unrelated untracked `output/` directory must remain untouched.

---

### Task 1: Canonical RBAC contracts

**Files:**
- Create: `packages/rbac/src/modules/events.ts`
- Create: `packages/rbac/src/modules/insights.ts`
- Modify: `packages/rbac/src/contracts.ts`
- Modify: `packages/rbac/src/registry.ts`
- Modify: `packages/rbac/src/index.ts`
- Test: `packages/rbac/src/rbac.test.ts`

**Interfaces:**
- Produces: `EventsRole`, `EventsCapability`, `eventsModule`, `InsightsRole`, `InsightsCapability`, `insightsModule`.
- Produces module keys `events` and `insights` in `Module`, `CapabilityFor`, `RoleFor`, and `UserRoles`.

- [ ] **Step 1: Add failing registry tests**

```ts
expect(listModuleRoles('events').sort()).toEqual(
  ['admin', 'coordinator', 'requester', 'viewer'].sort(),
);
expect(listModuleRoles('insights').sort()).toEqual(
  ['admin', 'analyst', 'executive', 'manager'].sort(),
);
expect(can({ events: ['coordinator'] }, 'events', 'manage_events')).toBe(true);
expect(can({ insights: ['executive'] }, 'insights', 'view_executive')).toBe(true);
```

- [ ] **Step 2: Verify tests fail on unknown module keys**

Run: `pnpm --filter @intra/rbac test`

Expected: TypeScript/Vitest fails because `events` and `insights` are not registered.

- [ ] **Step 3: Implement module definitions**

```ts
export type EventsCapability =
  | 'view_events'
  | 'create_event'
  | 'manage_events'
  | 'request_fulfillment'
  | 'close_event'
  | 'admin';

export type EventsRole = 'requester' | 'coordinator' | 'viewer' | 'admin';

export type InsightsCapability =
  | 'view_warehouse'
  | 'view_procurement'
  | 'view_legal'
  | 'view_finance'
  | 'view_executive'
  | 'prepare_exports'
  | 'admin';

export type InsightsRole = 'analyst' | 'manager' | 'executive' | 'admin';
```

Define least-privilege role matrices matching the design: requester creates owned events; coordinator manages lifecycle and fulfillment requests; viewer is read-only; admin is the Events superset. Insights analyst receives source detail and exports, manager receives scoped summaries, executive receives executive summaries only, and admin receives the Insights superset.

- [ ] **Step 4: Run RBAC tests and typecheck**

Run: `pnpm --filter @intra/rbac test && pnpm --filter @intra/rbac typecheck`

Expected: all tests pass with no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add packages/rbac/src
git commit -m "feat: register events and insights roles"
```

---

### Task 2: Events package and existing-function adapter

**Files:**
- Create: `modules/events/package.json`
- Create: `modules/events/tsconfig.json`
- Create: `modules/events/eslint.config.mjs`
- Create: `modules/events/vitest.config.ts`
- Create: `modules/events/src/index.ts`
- Create: `modules/events/src/types.ts`
- Create: `modules/events/src/access.ts`
- Create: `modules/events/src/data.ts`
- Create: `modules/events/src/seed.ts`
- Create: `modules/events/src/EventsApp.tsx`
- Create: `modules/events/src/components/EventPortfolio.tsx`
- Create: `modules/events/src/components/EventWorkspace.tsx`
- Test: `modules/events/src/access.test.ts`
- Test: `modules/events/src/data.test.ts`
- Test: `modules/events/src/EventsApp.test.tsx`

**Interfaces:**
- Consumes: `events` RBAC contracts from Task 1 and authenticated Supabase client from `@intra/auth`.
- Produces: `EventsApp`, `EventRecord`, `EventFulfillmentSummary`, `loadLiveEventsData`.

- [ ] **Step 1: Add failing access and lifecycle tests**

```ts
expect(canAccessEvents({ events: ['requester'] })).toBe(true);
expect(canManageEvents({ events: ['viewer'] })).toBe(false);
expect(eventCompletionBlockers(eventWithOpenReturns)).toContain('open returns');
expect(eventCompletionBlockers(reconciledEvent)).toEqual([]);
```

- [ ] **Step 2: Verify Events tests fail**

Run: `pnpm --filter @intra/events test`

Expected: fails because the package and functions do not exist.

- [ ] **Step 3: Implement explicit event types**

```ts
export type EventStatus =
  | 'draft'
  | 'confirmed'
  | 'in_fulfillment'
  | 'active'
  | 'reconciling'
  | 'closed'
  | 'cancelled';

export interface EventRecord {
  id: string;
  name: string;
  startAt: string;
  endAt: string;
  locationName: string;
  status: EventStatus;
  ownerId?: string;
  requestedItems: number;
}

export interface EventFulfillmentSummary {
  reserved: number;
  issued: number;
  returned: number;
  consumed: number;
  unresolved: number;
}
```

- [ ] **Step 4: Implement memory and live adapters**

Memory data mirrors the existing seeded Warehouse events and allocations without creating a second stock ledger. Live mode reads `warehouse.events`, `warehouse.allocations`, `warehouse.returns`, and event-linked `warehouse.movements`. Event creation calls the existing governed event repository/RPC contract; fulfillment controls are links to `/warehouse/allocations?event=<id>` and `/warehouse/returns?event=<id>`.

`loadLiveEventsData(client)` returns valid partial data plus named warnings when a source fails. It never inserts or updates Warehouse stock tables.

- [ ] **Step 5: Implement portfolio and event workspace**

The portfolio provides status and date filters, event creation for authorized roles, stable KPI filters, and explicit empty/error states. Event detail shows lifecycle, requested items, fulfillment totals, unresolved outcomes, and Warehouse source links. Disable Close while `eventCompletionBlockers` is non-empty and display each blocker.

- [ ] **Step 6: Test requester, coordinator, viewer, partial source, and closure blockers**

Run: `pnpm --filter @intra/events test && pnpm --filter @intra/events typecheck && pnpm --filter @intra/events lint`

Expected: all Events tests and static checks pass.

- [ ] **Step 7: Commit**

```bash
git add modules/events
git commit -m "feat: add events workspace"
```

---

### Task 3: My Work aggregation package

**Files:**
- Create: `modules/work/package.json`
- Create: `modules/work/tsconfig.json`
- Create: `modules/work/eslint.config.mjs`
- Create: `modules/work/vitest.config.ts`
- Create: `modules/work/src/index.ts`
- Create: `modules/work/src/types.ts`
- Create: `modules/work/src/data.ts`
- Create: `modules/work/src/seed.ts`
- Create: `modules/work/src/WorkApp.tsx`
- Create: `modules/work/src/components/WorkQueue.tsx`
- Test: `modules/work/src/data.test.ts`
- Test: `modules/work/src/WorkApp.test.tsx`

**Interfaces:**
- Consumes: authenticated profile, scoped roles, and `core.v_my_work`.
- Produces: `WorkApp`, `WorkItem`, `deriveWorkPriority`, `loadLiveWorkItems`.

- [ ] **Step 1: Add failing normalization and priority tests**

```ts
expect(deriveWorkPriority({ severity: 'critical', dueAt: null })).toBe('urgent');
expect(deriveWorkPriority({ severity: null, dueAt: tomorrow })).toBe('high');
expect(normalizeWorkItem(row).sourceRoute).toBe('/procurement/approvals');
expect(filterWorkItems(items, 'warehouse').every((item) => item.sourceModule === 'warehouse')).toBe(true);
```

- [ ] **Step 2: Verify Work tests fail**

Run: `pnpm --filter @intra/work test`

Expected: fails because the package and functions do not exist.

- [ ] **Step 3: Implement normalized work types**

```ts
export type WorkSource = 'procurement' | 'legal' | 'warehouse' | 'finance' | 'admin';
export type WorkPriority = 'urgent' | 'high' | 'normal' | 'informational';

export interface WorkItem {
  id: string;
  sourceModule: WorkSource;
  workType: string;
  sourceId: string;
  title: string;
  status: string;
  priority: WorkPriority;
  dueAt?: string;
  createdAt: string;
  sourceRoute: string;
}
```

- [ ] **Step 4: Implement memory and Supabase adapters**

Memory mode includes representative Procurement approval, Legal review, Warehouse task/exception, Finance payment-readiness, and administration remediation rows. Live mode selects from `core.v_my_work`, orders urgent/overdue then due date, and returns named partial/error state without any mutation API.

- [ ] **Step 5: Implement the unified queue**

Provide Assigned, Available, Blocked, Due soon, and Completed views; source filters; priority/status badges; due-date legibility; exact source links; loading, empty, offline, and access-denied states. No row contains an approve/reject/resolve control.

- [ ] **Step 6: Verify Work behavior**

Run: `pnpm --filter @intra/work test && pnpm --filter @intra/work typecheck && pnpm --filter @intra/work lint`

Expected: all Work tests and static checks pass.

- [ ] **Step 7: Commit**

```bash
git add modules/work
git commit -m "feat: add unified my work queue"
```

---

### Task 4: Data & Insights package

**Files:**
- Create: `modules/insights/package.json`
- Create: `modules/insights/tsconfig.json`
- Create: `modules/insights/eslint.config.mjs`
- Create: `modules/insights/vitest.config.ts`
- Create: `modules/insights/src/index.ts`
- Create: `modules/insights/src/types.ts`
- Create: `modules/insights/src/access.ts`
- Create: `modules/insights/src/data.ts`
- Create: `modules/insights/src/seed.ts`
- Create: `modules/insights/src/InsightsApp.tsx`
- Create: `modules/insights/src/components/MetricGrid.tsx`
- Create: `modules/insights/src/components/SourceHealth.tsx`
- Test: `modules/insights/src/access.test.ts`
- Test: `modules/insights/src/data.test.ts`
- Test: `modules/insights/src/InsightsApp.test.tsx`

**Interfaces:**
- Consumes: `insights` RBAC and existing governed module read models.
- Produces: `InsightsApp`, `InsightMetric`, `InsightSource`, `loadLiveInsightsData`.

- [ ] **Step 1: Add failing scope and partial-source tests**

```ts
expect(visibleInsightSources({ insights: ['analyst'] })).toContain('warehouse');
expect(visibleInsightSources({ insights: ['executive'] })).toEqual(['executive']);
expect(scopeInsightsData(allData, ['warehouse']).sources).toHaveLength(1);
expect(summarizeSourceHealth(partialData)).toEqual({ available: 3, unavailable: 1 });
```

- [ ] **Step 2: Verify Insights tests fail**

Run: `pnpm --filter @intra/insights test`

Expected: fails because the package and functions do not exist.

- [ ] **Step 3: Implement metric contracts**

```ts
export type InsightSource = 'executive' | 'warehouse' | 'procurement' | 'legal' | 'finance';

export interface InsightMetric {
  id: string;
  source: InsightSource;
  label: string;
  value: number;
  unit: 'count' | 'currency' | 'percent' | 'days';
  definition: string;
  freshnessAt: string;
  drilldownRoute: string;
}
```

- [ ] **Step 4: Implement source adapters**

Warehouse uses `warehouse.inventory_position_v1`, `warehouse.bi_movements_v1`, `warehouse.bi_quality_v1`, and `warehouse.bi_cycle_counts_v1`. Finance uses `core.v_finance_activity` and payment readiness. Procurement and Legal use committed tables/views already readable by the caller. Each source query is conditional on the assigned Insights capability and independently reports failure.

- [ ] **Step 5: Implement overview and source views**

Every KPI displays definition, source, freshness, scope, and drill-down. Source health names unavailable modules. The UI retains valid sources during partial failure and exposes existing governed export routes rather than generating client-side unrestricted exports.

- [ ] **Step 6: Verify Insights behavior**

Run: `pnpm --filter @intra/insights test && pnpm --filter @intra/insights typecheck && pnpm --filter @intra/insights lint`

Expected: all Insights tests and static checks pass.

- [ ] **Step 7: Commit**

```bash
git add modules/insights
git commit -m "feat: add data and insights workspace"
```

---

### Task 5: Live Supabase read models and role catalogue

**Files:**
- Create: `supabase/migrations/20260714160000_intra_role_workspaces.sql`
- Test: `supabase/tests/rls_role_workspaces.sql`
- Modify: `scripts/verify-policy-alignment-schema.mjs`
- Modify: `scripts/qa/live-e2e-contract.test.mjs`

**Interfaces:**
- Consumes: Events and Insights role/capability names from Task 1.
- Produces: synchronized role catalogue and `core.v_my_work`.

- [ ] **Step 1: Add failing schema-contract assertions**

Assert that all Events and Insights roles/capabilities exist, that `core.v_my_work` is a security-invoker view, and that anon/public lack access.

- [ ] **Step 2: Verify contract fails before migration**

Run: `pnpm verify:policy-alignment-schema`

Expected: fails because the role catalogue and view are absent.

- [ ] **Step 3: Add idempotent catalogue synchronization**

Insert/update Events and Insights capability and role rows using the repository's existing catalogue schema. Map role capabilities exactly to Task 1. Do not delete legacy Warehouse roles in this migration; migration aliases remain until live profiles are reassigned.

- [ ] **Step 4: Add `core.v_my_work`**

Create a `security_invoker = true` union over committed Procurement approval steps, Legal case work, Warehouse tasks/exceptions/stock changes, Finance payment readiness, and remediation queue records. Each branch uses source RLS and module-specific capability checks. Grant select only to authenticated and service role.

- [ ] **Step 5: Add RLS-negative coverage**

Verify anonymous denial, unrelated-role exclusion, single-scope source isolation, multi-role union visibility, vendor exclusion from internal work, and no insert/update/delete grants on the view.

- [ ] **Step 6: Run migration/static verification**

Run: `pnpm verify:policy-alignment-schema && pnpm test:intra-live-contract`

Expected: both commands pass without requiring destructive live changes.

- [ ] **Step 7: Commit**

```bash
git add supabase scripts
git commit -m "feat: add role workspace read models"
```

---

### Task 6: Shell routes, navigation, profiles, and redirects

**Files:**
- Create: `apps/shell/app/events/[[...slug]]/page.tsx`
- Create: `apps/shell/app/work/page.tsx`
- Create: `apps/shell/app/insights/[[...slug]]/page.tsx`
- Modify: `apps/shell/package.json`
- Modify: `apps/shell/tailwind.config.ts`
- Modify: `apps/shell/lib/navigation.ts`
- Modify: `apps/shell/lib/navigation.test.ts`
- Modify: `apps/shell/lib/routes.ts`
- Modify: `apps/shell/lib/demoProfiles.ts`
- Modify: `apps/shell/components/AppShell.tsx`
- Modify: `apps/shell/components/CommandPalette.tsx`
- Modify: `apps/shell/proxy.ts`
- Modify: `modules/warehouse/src/app/modules.ts`
- Modify: `modules/warehouse/src/app/App.tsx`
- Test: `apps/shell/tests/smoke/routes.spec.ts`

**Interfaces:**
- Consumes: `EventsApp`, `WorkApp`, `InsightsApp` and new RBAC keys.
- Produces canonical shell destinations `/events`, `/work`, and `/insights`.

- [ ] **Step 1: Add failing navigation and redirect tests**

Test one canonical destination per authorized user, exact dashboard module counts, My Work visibility for actionable employees, no Events/Insights access for unrelated roles, and 308 redirects preserving event IDs and safe query parameters.

- [ ] **Step 2: Verify shell tests fail**

Run: `pnpm --filter @intra/shell test`

Expected: new route/navigation assertions fail.

- [ ] **Step 3: Mount package routes and dependencies**

Add workspace dependencies and Tailwind scan paths. Route catch-all segments into Events and Insights package routers; mount Work at `/work`.

- [ ] **Step 4: Update canonical navigation composition**

Use one `dashboardAreas` result for dashboard cards, counts, sidebar, mobile navigation, and command palette. Order Home, My Work, Events, Warehouse, Procurement, Finance, Legal, Insights, then privileged destinations. Promote My Work on mobile when available.

- [ ] **Step 5: Migrate demo profiles**

Map Marketing to `events:coordinator`, Business Unit to `events:requester`, and BI Analyst to `insights:analyst`. Preserve required Warehouse roles only for physical fulfillment personas.

- [ ] **Step 6: Remove moved Warehouse routes and add redirects**

Remove internal Warehouse event/data/report navigation and route contracts. Add HTTP 308 redirects:

```ts
/warehouse/events -> /events
/warehouse/events/:id -> /events/:id
/warehouse/data -> /insights/warehouse
/warehouse/reports -> /insights/warehouse
```

- [ ] **Step 7: Run shell tests and build**

Run: `pnpm --filter @intra/shell test && pnpm --filter @intra/shell build`

Expected: shell unit tests pass and all three routes appear in the Next.js route manifest.

- [ ] **Step 8: Commit**

```bash
git add apps/shell modules/warehouse pnpm-lock.yaml
git commit -m "feat: integrate intra role workspaces"
```

---

### Task 7: Knowledge Base coverage and evidence contracts

**Files:**
- Modify: `apps/shell/lib/knowledge/types.ts`
- Modify: `apps/shell/lib/knowledge/content.ts`
- Modify: `apps/shell/lib/knowledge/features.ts`
- Modify: `apps/shell/lib/knowledge/featureDetails.ts`
- Modify: `apps/shell/lib/knowledge/roles.ts`
- Modify: `apps/shell/lib/knowledge/capabilities.ts`
- Modify: `apps/shell/lib/knowledge/contextIndex.ts`
- Modify: `apps/shell/lib/knowledge/evidenceContract.ts`
- Test: `apps/shell/lib/knowledge/coverage.test.ts`
- Test: `apps/shell/lib/knowledge/content.test.ts`
- Test: `apps/shell/lib/knowledge/context.test.ts`

**Interfaces:**
- Consumes: canonical routes and role/capability contracts from Tasks 1 and 6.
- Produces searchable articles and contextual help for every new live route.

- [ ] **Step 1: Add failing route and role coverage assertions**

Require complete documentation for Events requester/coordinator/viewer/admin, Insights roles, My Work access, each canonical route, source handoff, control, field, status, exception, and compatibility redirect.

- [ ] **Step 2: Verify Knowledge Base tests fail**

Run: `pnpm --filter @intra/shell test -- lib/knowledge`

Expected: coverage fails for undocumented modules and routes.

- [ ] **Step 3: Add plain-language feature and workflow content**

Document Events lifecycle and Warehouse handoff, My Work source ownership, Insights source/freshness/scope, single- and multi-role behavior, all decision branches, negative states, and completion evidence.

- [ ] **Step 4: Add contextual indexes and evidence requirements**

Map `/events`, `/events/:id`, `/work`, `/insights`, and each source Insights route. Evidence entries must name the exact interaction and cannot reuse semantically different screenshots.

- [ ] **Step 5: Run Knowledge Base verification**

Run: `pnpm --filter @intra/shell test && pnpm verify:knowledge-base && pnpm verify:knowledge-evidence-catalog`

Expected: all content, coverage, semantic, and evidence contract checks pass.

- [ ] **Step 6: Commit**

```bash
git add apps/shell/lib/knowledge scripts/qa
git commit -m "docs: cover role workspaces in knowledge base"
```

---

### Task 8: Strict E2E, visual, accessibility, and production verification

**Files:**
- Create: `apps/shell/tests/e2e/events-workspace.spec.ts`
- Create: `apps/shell/tests/e2e/my-work.spec.ts`
- Create: `apps/shell/tests/e2e/insights-workspace.spec.ts`
- Modify: `apps/shell/tests/e2e/all-user-types.spec.ts`
- Modify: `scripts/qa/full-intra-live-e2e.mjs`

**Interfaces:**
- Consumes all implemented routes and live contracts.
- Produces launch-readiness evidence and regression coverage.

- [ ] **Step 1: Add role-scope workflow tests**

Cover Event requester/coordinator/viewer, Warehouse fulfillment handoff, single- and multi-scope Insights, and My Work source navigation. Include unauthorized and source-failure cases.

- [ ] **Step 2: Add full event lifecycle tests**

Create event, request stock, reserve/issue in Warehouse, record return and loss/damage paths, reconcile, and close. Verify insufficient stock, partial fulfillment, cancellation with reservation, overdue return, duplicate submission, and blocked closure.

- [ ] **Step 3: Add strict layout and accessibility assertions**

At 1440, 1280, 768, 390, 360, and 320 verify no document overflow, clipped controls, fixed-control overlap, dead ends, or targets below 44 pixels. Run Axe WCAG A/AA checks and keyboard navigation on primary routes.

- [ ] **Step 4: Run memory-mode verification**

Run:

```bash
pnpm -r test
pnpm -r typecheck
pnpm -r lint
pnpm --filter @intra/shell build
pnpm --filter @intra/shell exec playwright test \
  tests/e2e/events-workspace.spec.ts \
  tests/e2e/my-work.spec.ts \
  tests/e2e/insights-workspace.spec.ts \
  tests/e2e/all-user-types.spec.ts
```

Expected: zero failures across all packages and six browser projects.

- [ ] **Step 5: Run live certification when vaulted credentials are available**

Run: `pnpm test:intra-live`

Expected: governed read/write/read-back and cleanup pass for all source workflows; RLS-negative identities see no unauthorized rows.

- [ ] **Step 6: Commit verification coverage**

```bash
git add apps/shell/tests scripts/qa
git commit -m "test: certify intra role workspaces"
```

---

### Task 9: Final integration review

**Files:**
- Review all files changed by Tasks 1-8.

**Interfaces:**
- Produces a release-ready branch with no duplicate routes or broadened access.

- [ ] **Step 1: Search for stale ownership and route references**

Run:

```bash
rg -n "/warehouse/(events|data|reports)|warehouse: \['(marketing|business_unit|bi_analyst)'" \
  apps modules packages scripts supabase
```

Expected: only migration aliases, compatibility redirects, and explicit historical tests remain.

- [ ] **Step 2: Review security boundaries**

Confirm no direct stock mutation exists outside Warehouse, no decision command exists in My Work, no client export bypass exists in Insights, and all aggregate views are security-invoker with authenticated-only grants.

- [ ] **Step 3: Run final clean verification**

Run: `git diff --check && pnpm -r test && pnpm -r typecheck && pnpm -r lint && pnpm --filter @intra/shell build`

Expected: all commands exit zero.

- [ ] **Step 4: Commit any integration corrections**

```bash
git add -u
git commit -m "fix: complete role workspace integration"
```
