# Current Function Launch Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining production-readiness gaps for currently implemented Mwell Intra functions, with verified database hardening, complete production evidence, role-based transactional E2E, QA cleanup, deployment, and merge to `main`.

**Architecture:** A migration and SQL verifier close actionable Supabase advisor findings without changing authorization semantics. A manifest-driven evidence pipeline maps every executable live Knowledge Base node to validated desktop/mobile production captures. The live E2E harness records run-scoped transactions, verifies each cross-role handoff in the UI and database, and deletes only its own QA data before the final release gate.

**Tech Stack:** Next.js 15, React 19, TypeScript, Vitest, Playwright, Node.js ESM, Supabase Postgres/Auth/RLS, pnpm/Turborepo, Vercel.

## Global Constraints

- Build only currently implemented functions; nine workflows marked `limited` remain future-state guidance.
- Never embed passwords, JWTs, service-role keys, or Vercel credentials in source, reports, screenshots, or command output.
- Preserve existing RLS decisions and controlled RPC boundaries.
- Production screenshots are mandatory only for executable user-action nodes in `live` workflows.
- Every live test record uses a unique `QA-YYYYMMDD-8HEX` run identifier and must be removed or explicitly governed after the run.
- Do not delete indexes solely because a low-traffic advisor snapshot reports zero scans.
- Do not merge or deploy a commit that has not passed the complete release gate.

---

### Task 1: Freeze The Live Baseline And Advisor Contract

**Files:**
- Create: `scripts/qa/snapshot-supabase-advisors.mjs`
- Create: `docs/audits/2026-07-13-SUPABASE-ADVISOR-BASELINE.md`
- Modify: `package.json`
- Test: `scripts/verify-launch-artifacts.mjs`

**Interfaces:**
- Consumes: `SUPABASE_PROJECT_ID` and the connected Supabase MCP/CLI environment.
- Produces: `output/supabase-advisors/latest.json` with `security`, `performance`, `generatedAt`, and grouped counts.

- [ ] **Step 1: Add a failing launch-artifact assertion**

Extend `scripts/verify-launch-artifacts.mjs` to require the advisor snapshot script and a `verify:supabase-advisors` package script.

```js
const advisorSnapshot = path.resolve("scripts/qa/snapshot-supabase-advisors.mjs");
if (!existsSync(advisorSnapshot)) {
  failures.push("Supabase advisor snapshot script is missing");
}
if (pkg.scripts?.["verify:supabase-advisors"] !== "node scripts/qa/snapshot-supabase-advisors.mjs") {
  failures.push("verify:supabase-advisors must run the governed snapshot script");
}
```

- [ ] **Step 2: Run the verifier and observe the expected failure**

Run: `pnpm verify:launch-artifacts`

Expected: nonzero exit with the missing advisor snapshot contract.

- [ ] **Step 3: Implement normalized advisor reporting**

Create a script that accepts advisor JSON through environment-provided files or a generated live export, rejects secrets, groups findings by `name` and `level`, and writes the normalized report atomically.

```js
const report = {
  generatedAt: new Date().toISOString(),
  projectId,
  security: normalize(security.lints),
  performance: normalize(performance.lints),
};
await writeFile(tempPath, JSON.stringify(report, null, 2));
await rename(tempPath, outputPath);
```

- [ ] **Step 4: Add the package script and baseline report**

Add:

```json
"verify:supabase-advisors": "node scripts/qa/snapshot-supabase-advisors.mjs"
```

The Markdown baseline records 0 critical security findings, the intentional service-only `warehouse.command_log` notice, 131 unindexed foreign keys, 5 auth init-plan warnings, 2 duplicate permissive-policy warnings, 1 no-primary-key notice, 34 unused-index observations, and 1 auth connection-allocation notice.

- [ ] **Step 5: Verify and commit**

Run:

```powershell
pnpm verify:launch-artifacts
node scripts/qa/snapshot-supabase-advisors.mjs
git add package.json scripts/qa/snapshot-supabase-advisors.mjs scripts/verify-launch-artifacts.mjs docs/audits/2026-07-13-SUPABASE-ADVISOR-BASELINE.md
git commit -m "test: codify live Supabase advisor baseline"
```

Expected: verifier passes and normalized report contains no credential-shaped values.

---

### Task 2: Apply Database Performance And Policy Hardening

**Files:**
- Create: `supabase/migrations/20260713170000_current_function_advisor_hardening.sql`
- Create: `supabase/tests/current_function_advisor_hardening.sql`
- Create: `scripts/verify-current-function-advisor-hardening.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: current live catalog, existing capability helpers, and the existing `stock_levels_uq` business-key index.
- Produces: surrogate `warehouse.stock_levels.id`, covering FK indexes, optimized equivalent RLS policies, and one select policy per procurement PO table.

- [ ] **Step 1: Write the failing static verifier**

Require the migration to contain:

```js
[
  /add column if not exists id uuid default gen_random_uuid\(\)/i,
  /add constraint stock_levels_pkey primary key \(id\)/i,
  /\(select auth\.uid\(\)\)/i,
  /create policy procurement_purchase_orders_read/i,
  /create policy procurement_purchase_order_lines_read/i,
].forEach((pattern) => assert.match(sql, pattern));
```

Also parse every current foreign key and assert the migration contains its declared covering index.

- [ ] **Step 2: Run the verifier and observe failure**

Run: `node scripts/verify-current-function-advisor-hardening.mjs`

Expected: nonzero exit because the migration does not exist.

- [ ] **Step 3: Add the surrogate stock-level identity**

```sql
alter table warehouse.stock_levels
  add column if not exists id uuid default gen_random_uuid();

update warehouse.stock_levels
set id = gen_random_uuid()
where id is null;

alter table warehouse.stock_levels
  alter column id set default gen_random_uuid(),
  alter column id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'warehouse.stock_levels'::regclass
      and contype = 'p'
  ) then
    alter table warehouse.stock_levels
      add constraint stock_levels_pkey primary key (id);
  end if;
end
$$;
```

Retain `stock_levels_uq (product_id, location_id, bin_id, lot_id) nulls not distinct` so existing `on conflict` behavior is unchanged.

- [ ] **Step 4: Add explicit covering indexes**

Generate explicit `create index if not exists schema_table_fk_idx on schema.table(foreign_key_columns);` statements for every advisor-reported foreign key. Each real statement uses its actual schema, table, constraint-derived index name, and columns. Composite constraints use the same ordered column list.

Do not create a duplicate when an existing index has the foreign-key columns as its leading columns.

- [ ] **Step 5: Optimize the five policies**

Recreate the policies with selected auth identity:

```sql
requested_by = (select auth.uid())
created_by = (select auth.uid())
j.created_by = (select auth.uid())
r.requester_id = (select auth.uid())
```

Keep every `core.has_cap(...)` predicate unchanged.

- [ ] **Step 6: Consolidate Procurement PO policies**

```sql
drop policy if exists procurement_pos_read on procurement.purchase_orders;
drop policy if exists warehouse_receivable_pos_read on procurement.purchase_orders;
create policy procurement_purchase_orders_read
on procurement.purchase_orders for select to authenticated
using (
  core.has_cap('procurement', 'author_po')
  or core.has_cap('procurement', 'approve_award')
  or core.has_cap('procurement', 'view_finance')
  or (
    core.has_cap('warehouse', 'receive_stock')
    and status in ('approved', 'issued')
  )
);
```

Create the equivalent single line-item policy, preserving the parent-PO and receivable-status predicates.

- [ ] **Step 7: Add SQL regression tests**

Test that:

- `stock_levels` has exactly one primary key and the existing business-key index remains unique.
- All existing rows have unique non-null `id` values.
- The five policies contain selected auth identity expressions.
- Each PO table has one authenticated SELECT policy.
- Procurement PO authors and warehouse receivers retain expected reads.
- A core-only staff identity cannot read protected PO data.

- [ ] **Step 8: Verify locally, apply to live Supabase, and rerun advisors**

Run:

```powershell
node scripts/verify-current-function-advisor-hardening.mjs
pnpm verify:warehouse-w1-schema
pnpm verify:policy-alignment-schema
```

Apply the migration using the connected Supabase migration tool. Then run the SQL regression file and both advisor types.

Expected: zero unindexed-FK, auth-init-plan, duplicate-permissive-policy, and no-primary-key findings. Security has no warning or error.

- [ ] **Step 9: Commit**

```powershell
git add package.json supabase/migrations/20260713170000_current_function_advisor_hardening.sql supabase/tests/current_function_advisor_hardening.sql scripts/verify-current-function-advisor-hardening.mjs
git commit -m "fix: harden current Supabase query paths"
```

---

### Task 3: Make Evidence Coverage Executable And Verifiable

**Files:**
- Create: `apps/shell/lib/knowledge/evidenceContract.ts`
- Create: `apps/shell/lib/knowledge/evidenceContract.test.ts`
- Create: `scripts/qa/knowledge-evidence-catalog.mjs`
- Modify: `scripts/qa/capture-knowledge-evidence.mjs`
- Modify: `apps/shell/lib/knowledge/evidence.ts`
- Modify: `apps/shell/lib/knowledge/content.test.ts`

**Interfaces:**
- Consumes: `KNOWLEDGE_CONTENT.workflows`, node semantics, evidence registry, and deployed commit metadata.
- Produces: `KnowledgeEvidenceRequirement[]` and `output/knowledge-evidence/manifest.json`.

- [ ] **Step 1: Write failing evidence-contract tests**

```ts
expect(executableLiveNodes.every((node) => node.evidenceId)).toBe(true);
expect(requirements.every((item) => item.desktop && item.mobile)).toBe(true);
expect(requirements.every((item) => item.environment === "production")).toBe(true);
expect(limitedNodes.some((node) => node.requiredCapture)).toBe(false);
```

Tests also reject duplicate evidence IDs, missing expected landmarks, empty hotspots, stale source commits, and capture dimensions other than 1440x900 or 390x844.

- [ ] **Step 2: Run focused tests and observe failure**

Run:

```powershell
pnpm --filter @intra/shell exec vitest run lib/knowledge/evidenceContract.test.ts
```

Expected: nonzero exit because the contract module is missing.

- [ ] **Step 3: Implement semantic evidence requirements**

```ts
export function evidenceRequirements(content: KnowledgeContent): KnowledgeEvidenceRequirement[] {
  return content.workflows.flatMap((flow) =>
    flow.availability !== "live"
      ? []
      : flow.nodes
          .filter((node) => node.kind === "action" && Boolean(node.guide))
          .map((node) => requirementFor(flow, node)),
  );
}
```

Decision, system, exception, and terminal nodes remain semantic panels unless they declare an actual executable guide.

- [ ] **Step 4: Replace hand-maintained capture calls with catalog iteration**

The catalog entry contains:

```js
{
  evidenceId,
  workflowId,
  nodeId,
  roleEmail,
  route,
  expectedText,
  targetSelector,
  hotspots,
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
}
```

The capture script must focus or open the exact interaction state, verify the target selector is visible and unique, capture the image, compute SHA-256, and write the temporary manifest. Promotion occurs only after every requirement passes.

- [ ] **Step 5: Add hotspot validation**

For each hotspot, obtain the target element bounding box and calculate normalized coordinates. Reject hotspots outside the image or more than 24 CSS pixels from the declared target center.

- [ ] **Step 6: Verify the contract**

Run:

```powershell
pnpm --filter @intra/shell exec vitest run lib/knowledge/evidenceContract.test.ts lib/knowledge/content.test.ts
pnpm verify:knowledge-base
```

Expected: all executable live nodes resolve to a production evidence requirement; limited flows resolve to none.

- [ ] **Step 7: Commit**

```powershell
git add apps/shell/lib/knowledge scripts/qa/capture-knowledge-evidence.mjs scripts/qa/knowledge-evidence-catalog.mjs
git commit -m "test: enforce production knowledge evidence"
```

---

### Task 4: Extend Live E2E With Persistence And Cleanup

**Files:**
- Create: `scripts/qa/live-e2e-scenarios.mjs`
- Create: `scripts/qa/live-e2e-cleanup.mjs`
- Create: `scripts/qa/live-e2e-db-verify.mjs`
- Create: `scripts/qa/live-e2e-contract.test.mjs`
- Modify: `scripts/qa/full-intra-live-e2e.mjs`
- Modify: `scripts/qa/policy-aligned-live-e2e.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `AUDIT_BASE_URL`, `AUDIT_PASSWORD`, server-side Supabase verification credentials, and the existing test-account matrix.
- Produces: run manifest, role/viewport route results, transaction checkpoints, database proofs, cleanup proofs, screenshots, and a nonzero exit on any failed gate.

- [ ] **Step 1: Write failing harness contract tests**

Assert the harness:

- Declares every current role exactly once.
- Runs desktop 1440 and mobile 390 transaction checks.
- Includes authorized, unauthorized, validation, duplicate, correction, refresh, and handoff scenarios.
- Requires a run ID for every mutation.
- Invokes cleanup in a `finally` block.
- Never embeds a password or service key.

- [ ] **Step 2: Run contract tests and observe failure**

Run: `node --test scripts/qa/live-e2e-contract.test.mjs`

Expected: nonzero exit because scenario and cleanup modules are missing.

- [ ] **Step 3: Extract scenario definitions**

```js
export const scenarios = [
  vendorAccreditationScenario,
  procurementRequestToPoScenario,
  warehouseReceiveToPutawayScenario,
  warehouseCycleCountScenario,
  warehouseAllocationAndEventScenario,
  warehouseReturnScenario,
  financeHandoffScenario,
  adminDoaScenario,
];
```

Each scenario declares actors, viewport coverage, prerequisites, UI actions, expected database checkpoints, next-role readback, negative cases, and cleanup entities.

- [ ] **Step 4: Add direct persistence verification**

The DB verifier receives only the run ID and expected checkpoint:

```js
await verifyCheckpoint({
  runId,
  entity: "procurement.requests",
  expected: { status: "submitted" },
});
```

Queries are server-side, parameterized, and scoped to the run ID. Returned reports contain IDs and statuses but no tokens or personal data.

- [ ] **Step 5: Add governed cleanup**

```js
try {
  await executeScenarios(run);
} finally {
  run.cleanup = await cleanupRun(run.id);
  await writeRunReport(run);
}
if (!run.cleanup.complete) process.exitCode = 1;
```

Delete children before parents, verify zero remaining run-tagged rows, and never delete seed IDs, shared configuration, auth users, or records without the exact run marker.

- [ ] **Step 6: Add visual and ergonomic assertions**

At desktop and mobile transaction checkpoints, assert:

- No document-level horizontal overflow.
- No intersection between fixed navigation and the primary CTA.
- No visible unlabeled controls.
- Modal or sheet controls fit the viewport and can be dismissed.
- Focus returns to the triggering control.
- Refresh restores the route or produces a clear recoverable state.

- [ ] **Step 7: Verify contract and dry-run mode**

Run:

```powershell
node --test scripts/qa/live-e2e-contract.test.mjs
$env:AUDIT_MUTATIONS='false'
pnpm test:intra-live
```

Expected: contract passes; dry run completes every role/route/view audit without writing.

- [ ] **Step 8: Commit**

```powershell
git add package.json scripts/qa/full-intra-live-e2e.mjs scripts/qa/policy-aligned-live-e2e.mjs scripts/qa/live-e2e-*.mjs
git commit -m "test: verify live cross-role transactions"
```

---

### Task 5: Capture Production Evidence And Run Transactional Audit

**Files:**
- Modify: `apps/shell/public/knowledge/screenshots/*.png`
- Modify: `apps/shell/lib/knowledge/evidence.ts`
- Create: `output/knowledge-evidence/manifest.json`
- Create: `output/intra-live-e2e/latest/report.json`
- Create: `docs/audits/2026-07-13-CURRENT-FUNCTION-LIVE-E2E.md`

**Interfaces:**
- Consumes: deployed preview URL for the exact branch commit and environment-only audit credentials.
- Produces: production evidence and a cleanup-complete live audit report.

- [ ] **Step 1: Deploy a preview for the exact commit**

Run:

```powershell
$previewUrl = (vercel.cmd deploy --yes | Select-Object -Last 1).Trim()
if (-not $previewUrl.StartsWith('https://')) { throw 'Preview deployment URL was not returned.' }
vercel.cmd inspect $previewUrl
```

Expected: preview is Ready and reports the expected source commit.

- [ ] **Step 2: Capture every required screenshot**

```powershell
$env:AUDIT_BASE_URL=$previewUrl
$env:EVIDENCE_AUTH_MODE='live'
node scripts/qa/capture-knowledge-evidence.mjs
```

Expected: every catalog entry passes landmark, hotspot, browser-error, unlabeled-control, and overflow checks; manifest promotion is atomic.

- [ ] **Step 3: Review image integrity**

Generate a contact sheet and inspect all desktop/mobile pairs for legibility, correct interaction state, absence of sensitive values, and hotspot accuracy. Reject any image that shows loading, stale session, blank content, or a control outside the viewport.

- [ ] **Step 4: Run read-only live E2E**

```powershell
$env:AUDIT_MUTATIONS='false'
pnpm test:intra-live
```

Expected: every current role passes both required viewports and unauthorized routes fail closed.

- [ ] **Step 5: Run mutating policy-aligned E2E**

```powershell
$env:AUDIT_MUTATIONS='true'
node scripts/qa/policy-aligned-live-e2e.mjs
```

Expected: every scenario records UI action, DB checkpoint, next-role readback, negative case, and cleanup completion.

- [ ] **Step 6: Verify zero QA residue**

Run the cleanup verifier against the run ID.

Expected: zero run-tagged rows remain outside explicitly documented immutable audit events.

- [ ] **Step 7: Write the audit report and commit evidence**

The report lists every role, scenario, viewport, checkpoint, failure/recovery path, screenshot, and cleanup result. It contains no credentials.

```powershell
git add apps/shell/public/knowledge/screenshots apps/shell/lib/knowledge/evidence.ts docs/audits/2026-07-13-CURRENT-FUNCTION-LIVE-E2E.md
git commit -m "docs: publish verified production workflow evidence"
```

---

### Task 6: Run The Complete Release Gate

**Files:**
- Modify: `docs/QA_RELEASE_CHECKLIST.md`
- Modify: `docs/USER_TRAINING_AND_OPERATIONS_MANUAL.md`
- Modify: `docs/SUPABASE_CUTOVER_RUNBOOK.md`

**Interfaces:**
- Consumes: final branch commit, live advisor report, evidence manifest, E2E report, and cleanup report.
- Produces: one release decision tied to a commit SHA.

- [ ] **Step 1: Update release documentation**

Record exact commands, required environment variables by name only, rollback procedure, evidence location, QA cleanup procedure, and accepted intentional advisor observations.

- [ ] **Step 2: Run local gates**

```powershell
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:launch-artifacts
pnpm verify:knowledge-base
pnpm verify:supabase-cutover
pnpm verify:warehouse-w1-schema
pnpm verify:warehouse-w1-contract
pnpm verify:policy-alignment-schema
node scripts/verify-current-function-advisor-hardening.mjs
node --test scripts/qa/live-e2e-contract.test.mjs
```

Expected: every command exits 0 with no skipped required live gate.

- [ ] **Step 3: Rerun live advisors and smoke tests**

Expected:

- Security: no warning or error.
- Performance: no unindexed FK, auth init-plan, duplicate permissive policy, or no-primary-key finding.
- Intentional service-only and telemetry-dependent informational findings are documented.

- [ ] **Step 4: Commit release documentation**

```powershell
git add docs/QA_RELEASE_CHECKLIST.md docs/USER_TRAINING_AND_OPERATIONS_MANUAL.md docs/SUPABASE_CUTOVER_RUNBOOK.md
git commit -m "docs: finalize current-function release controls"
```

---

### Task 7: Merge, Deploy, And Run The Production Canary

**Files:**
- No additional source files unless the canary exposes a regression.

**Interfaces:**
- Consumes: verified branch HEAD.
- Produces: `origin/main` and the Vercel production alias at the same verified commit.

- [ ] **Step 1: Fetch and integrate current `origin/main`**

```powershell
git fetch origin
git merge --no-edit origin/main
```

Resolve conflicts without discarding either current main changes or remediation behavior. Rerun the complete local gate after any conflict resolution.

- [ ] **Step 2: Push the verified branch**

```powershell
git push origin codex/knowledge-base-semantic-remediation
```

- [ ] **Step 3: Deploy the integrated commit to production**

```powershell
$headSha = (git rev-parse HEAD).Trim()
vercel.cmd deploy --prod --yes --build-env NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA=$headSha
vercel.cmd inspect https://mwell-intra.vercel.app
```

Expected: production deployment is Ready and source provenance equals HEAD.

- [ ] **Step 4: Run production canary**

Repeat sign-in, Knowledge Base deep link, guided Warehouse action and return, one Procurement read, one Legal read, one Admin DOA read, mobile overflow checks, and console/network error checks.

- [ ] **Step 5: Push the verified commit to `main`**

```powershell
git push origin HEAD:main
```

Expected: push is fast-forward or an explicitly reviewed merge; no force push.

- [ ] **Step 6: Confirm final provenance and clean state**

```powershell
git status --short --branch
git rev-parse HEAD
git ls-remote origin refs/heads/main
vercel.cmd inspect https://mwell-intra.vercel.app
```

Expected: worktree clean, local HEAD equals remote main, and production is Ready at the same source commit.
