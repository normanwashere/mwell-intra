# Warehouse W1 Inventory Control Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first independently releasable Warehouse increment: controlled operation routes, QC/holds/vendor returns, risk-based stock-change approvals, scan completion, governed cutover imports, procurement PO receiving handoff, committed-versus-available reporting, and strict desktop/mobile release evidence.

**Architecture:** Extend the existing `@intra/data-kit` repository port and authenticated Warehouse module. Domain rules remain pure TypeScript; Supabase SECURITY DEFINER RPCs own authorization, row locking, idempotency, business state, stock movement, and audit writes. Existing memory adapters retain deterministic demo/test parity, while live cross-module and import workflows fail closed without Supabase.

**Tech Stack:** Next.js 16, React 19 shell, React Router 6 Warehouse module, TypeScript 5.6, Vitest, Playwright, Supabase Auth/Postgres/Storage, SQL migrations, pnpm/Turborepo.

## Global Constraints

- Work only in `codex/production-readiness-remediation`; do not modify the separate `mwell-intra-warehouse` working tree.
- Follow red-green-refactor for every behavior change and commit after each task.
- The existing stock movement ledger remains authoritative; workflow tables may not maintain an independent on-hand total.
- All live stock, quality, approval, import, and PO transitions must derive the actor from `auth.uid()` and enforce capabilities in Postgres.
- Material stock changes require a Warehouse Supervisor decision; changes with absolute financial impact above PHP 10,000 require a later Finance decision.
- The creator may not approve their own stock-change request at any approval tier.
- Held, damaged, recalled, vendor-return, and unavailable stock is excluded from available stock.
- Expiry is visible and warned on; W1 does not enforce FEFO or block issue based only on expiry.
- External handoffs remain CSV/manual. Do not add ERP, ecommerce, courier, payment, CRM, invoice, email-report, RFID, or BI-tool integration.
- Approvals, hold release, imports, final count posting, and procurement PO receipt require a live connection.
- Required viewports are 1440x900, 1280x800, 768x1024, 390x844, 360x800, and 320x568 in light and dark themes.
- Any P0/P1 security, correctness, accessibility, overlap, clipping, dead-end, or responsive failure blocks W1 release.
- New SQL functions set `search_path = ''`, schema-qualify all objects, revoke execution from `public` and `anon`, and grant only to `authenticated` and `service_role` as specified.
- New tables enable and force RLS before grants; private files use short-lived signed access.
- Do not apply migrations to live Supabase or deploy Vercel as part of implementation. Deployment is a separate approved release action.

## File Structure

### Domain and data boundary

- `packages/data-kit/src/domain/warehouseControls.ts`: operation, quality, hold, exception, approval, scan-task, and inventory-position types plus pure validation.
- `packages/data-kit/src/domain/warehouseControls.test.ts`: decision, availability, risk-tier, and state-machine tests.
- `packages/data-kit/src/domain/imports.ts`: versioned CSV contracts and pure row validation.
- `packages/data-kit/src/domain/imports.test.ts`: fixture-based validation tests.
- `packages/data-kit/src/domain/metrics.ts`: Warehouse KPI and field dictionary definitions.
- `packages/data-kit/src/repository.ts`: W1 repository commands and read-model additions.
- `packages/data-kit/src/inMemoryRepository.ts`: deterministic memory parity.
- `packages/data-kit/src/supabase/SupabaseRepository.ts`: explicit projections and RPC adapters.
- `packages/data-kit/src/supabase/mappers.ts`: snake-case/domain mappings.

### Database and server boundary

- `supabase/migrations/20260710150000_warehouse_w1_control_schema.sql`: W1 tables, indexes, RLS, capability catalogue, and seed operation routes.
- `supabase/migrations/20260710160000_warehouse_w1_quality_and_approval_rpcs.sql`: quality, hold, count, approval, exception, and idempotent movement commands.
- `supabase/migrations/20260710170000_warehouse_w1_imports_po_and_reporting.sql`: private imports, procurement PO receiving handoff, inventory-position/BI views, and governed export additions.
- `apps/shell/app/api/warehouse/imports/route.ts`: authenticated CSV parse/validate/stage/apply endpoint.
- `apps/shell/lib/warehouse/importAuthorization.ts`: server-side import actor and capability checks.
- `scripts/verify-warehouse-w1-contract.mjs`: static/effective migration checks plus optional live read/write/denial verification.

### Warehouse UI

- `modules/warehouse/src/pages/OperationRoutesPage.tsx`: route configuration and read-only operation map.
- `modules/warehouse/src/pages/QualityPage.tsx`: inspection, hold, vendor return, and release workspace.
- `modules/warehouse/src/pages/ApprovalsPage.tsx`: pending and decided stock-change approvals.
- `modules/warehouse/src/pages/ExceptionsPage.tsx`: prioritized exception inbox and resolution.
- `modules/warehouse/src/pages/ImportsPage.tsx`: import upload, preview, validation, approval, and reconciliation.
- `modules/warehouse/src/pages/ReportsPage.tsx`: committed/on-hand/held/available report and governed exports.
- `modules/warehouse/src/pages/ScanPage.tsx`: capability-aware receive/issue/return/count scanner entry.
- `modules/warehouse/src/pages/TasksPage.tsx`: actionable quality, putaway, count, and exception list.
- `modules/warehouse/src/pages/ReceivingPage.tsx`, `ReturnsPage.tsx`, and `CycleCountsPage.tsx`: W1 workflow integration.
- `modules/warehouse/src/app/modules.ts`, `App.tsx`, and `components/AppShell.tsx`: grouped navigation and mobile Home/Scan/Tasks/Inventory/More shell.

### Verification and documentation

- `apps/shell/tests/e2e/warehouse-w1-workflows.spec.ts`: memory-mode role/workflow coverage.
- `apps/shell/tests/e2e/warehouse-w1-visual.spec.ts`: six-viewport, two-theme visual/geometry/accessibility matrix.
- `apps/shell/tests/e2e/warehouse-w1-live.spec.ts`: opt-in live persistence and denial suite.
- `scripts/qa/build-warehouse-contact-sheet.mjs`: human-review HTML contact sheet.
- `docs/WAREHOUSE_ERD_AND_DATA_DICTIONARY.md`: W1 ERD, fields, ownership, and retention.
- `docs/REQUIREMENTS_TRACEABILITY_MATRIX.md`: WH/F roadmap evidence mapping.

---

### Task 1: W1 Domain Contracts and Capability Matrix

**Files:**

- Create: `packages/data-kit/src/domain/warehouseControls.ts`
- Create: `packages/data-kit/src/domain/warehouseControls.test.ts`
- Modify: `packages/data-kit/src/domain/types.ts`
- Modify: `packages/data-kit/src/repository.ts`
- Modify: `packages/data-kit/src/index.ts`
- Modify: `packages/rbac/src/modules/warehouse.ts`
- Modify: `packages/rbac/src/modules/warehouse.test.ts`
- Modify: `modules/warehouse/src/auth/roles.ts`
- Modify: `apps/shell/lib/demoProfiles.ts`
- Modify: `apps/shell/tests/e2e/all-user-types.spec.ts`

**Interfaces:**

- Produces: `OperationTypeCode`, `OperationType`, `OperationRoute`, `QualityDisposition`, `QualityInspection`, `InventoryHold`, `WarehouseException`, `StockChangeRequest`, `WarehouseTask`, `InventoryPosition`, expiry-risk helpers, and W1 repository input types.
- Produces capabilities: `manage_operation_routes`, `inspect_quality`, `release_quality_hold`, `approve_stock_adjustment`, `view_exceptions`, `resolve_exceptions`, and `import_warehouse_data`.
- Produces role: `warehouse_admin`, with all Warehouse configuration/control capabilities and no implicit access derived from the Core `platform_admin` role.

- [ ] **Step 1: Write failing domain and RBAC tests**

```ts
import { describe, expect, it } from "vitest";
import {
  availableAfterControls,
  approvalTiersForStockChange,
  canTransitionInspection,
} from "./warehouseControls";

describe("warehouse W1 controls", () => {
  it("removes commitments and unavailable dispositions from available stock", () => {
    expect(
      availableAfterControls({
        onHand: 40,
        committed: 9,
        held: 3,
        unavailable: 2,
      }),
    ).toBe(26);
  });

  it("requires supervisor then finance when impact exceeds PHP 10,000", () => {
    expect(
      approvalTiersForStockChange({ quantityDelta: -2, unitCost: 6000 }),
    ).toEqual(["logistics_supervisor", "finance"]);
  });

  it("does not add finance at exactly PHP 10,000", () => {
    expect(
      approvalTiersForStockChange({ quantityDelta: -2, unitCost: 5000 }),
    ).toEqual(["logistics_supervisor"]);
  });

  it("permits only explicit inspection transitions", () => {
    expect(canTransitionInspection("pending", "accepted")).toBe(true);
    expect(canTransitionInspection("vendor_return", "accepted")).toBe(false);
  });
});
```

Add RBAC assertions proving Logistics can inspect/release/resolve, Finance can approve stock adjustments but cannot release quality holds, BI can view exceptions but cannot resolve them, and Business Unit cannot import data.

Add domain assertions for expired/warning/ok dates and add a `warehouse_admin` memory persona whose role matrix matches the canonical module. Prove Core Platform Admin without `warehouse_admin` receives no Warehouse route access.

- [ ] **Step 2: Run focused tests and verify the new contracts fail to compile**

Run: `pnpm --filter @intra/data-kit test -- warehouseControls.test.ts && pnpm --filter @intra/rbac test -- warehouse.test.ts`

Expected: FAIL because W1 contracts and capabilities do not exist.

- [ ] **Step 3: Add the exact W1 domain surface**

```ts
export type OperationTypeCode =
  | "receipt"
  | "putaway"
  | "transfer"
  | "issue"
  | "return"
  | "vendor_return"
  | "cycle_count"
  | "adjustment";

export interface OperationType {
  id: string;
  code: OperationTypeCode;
  label: string;
  active: boolean;
}

export interface OperationRoute {
  id: string;
  operationTypeId: string;
  sourceLocationTypes: Array<"warehouse" | "event_site" | "vendor">;
  destinationLocationTypes: Array<"warehouse" | "event_site" | "vendor">;
  requiresEvidence: boolean;
  requiresApproval: boolean;
  requiresOnline: boolean;
  active: boolean;
}

export type QualityDisposition =
  "pending" | "accepted" | "damaged" | "hold" | "vendor_return" | "unavailable";

export interface QualityInspection {
  id: string;
  sourceType: "receipt" | "return";
  sourceId: string;
  productId: string;
  lotId?: string;
  serialNumber?: string;
  quantity: number;
  disposition: QualityDisposition;
  reason?: string;
  evidenceUrls: string[];
  inspectedBy: string;
  inspectedAt: string;
}

export interface InventoryHold {
  id: string;
  inspectionId: string;
  productId: string;
  locationId: string;
  lotId?: string;
  serialNumber?: string;
  quantity: number;
  status: "active" | "released" | "vendor_return" | "written_off";
  reason: string;
  releasedBy?: string;
  releasedAt?: string;
}

export interface WarehouseException {
  id: string;
  type:
    "quality" | "count_variance" | "po_receipt" | "scan_mismatch" | "import";
  severity: "P1" | "P2" | "P3";
  sourceType: string;
  sourceId: string;
  status: "open" | "in_progress" | "resolved" | "waived" | "cancelled";
  ownerId?: string;
  dueAt?: string;
  resolution?: string;
  createdAt: string;
}

export interface WarehouseTask {
  id: string;
  type: "quality" | "putaway" | "cycle_count" | "exception";
  sourceId: string;
  title: string;
  status: "due" | "blocked" | "completed";
  assigneeId?: string;
  dueAt?: string;
  completedAt?: string;
}

export interface StockChangeRequest {
  id: string;
  sourceType: "cycle_count" | "adjustment" | "write_off";
  sourceId: string;
  productId: string;
  locationId: string;
  binId?: string;
  quantityDelta: number;
  unitCost: number;
  financialImpact: number;
  reason: string;
  evidenceUrls: string[];
  status: "pending_supervisor" | "pending_finance" | "approved" | "rejected";
  requestedBy: string;
  requestedAt: string;
}

export interface InventoryPosition {
  productId: string;
  locationId: string;
  binId?: string;
  onHand: number;
  committed: number;
  held: number;
  unavailable: number;
  available: number;
}

export function availableAfterControls(
  v: Omit<InventoryPosition, "productId" | "locationId" | "available">,
): number {
  return Math.max(0, v.onHand - v.committed - v.held - v.unavailable);
}

export function approvalTiersForStockChange(input: {
  quantityDelta: number;
  unitCost: number;
}) {
  return Math.abs(input.quantityDelta * input.unitCost) > 10_000
    ? (["logistics_supervisor", "finance"] as const)
    : (["logistics_supervisor"] as const);
}

export function canTransitionInspection(
  from: QualityDisposition,
  to: QualityDisposition,
): boolean {
  const allowed: Record<QualityDisposition, readonly QualityDisposition[]> = {
    pending: ["accepted", "damaged", "hold", "vendor_return", "unavailable"],
    hold: ["accepted", "damaged", "vendor_return", "unavailable"],
    accepted: [],
    damaged: [],
    vendor_return: [],
    unavailable: [],
  };
  return allowed[from].includes(to);
}

export function canActorApproveStockChange(
  requestedBy: string,
  actor: string,
): boolean {
  return requestedBy !== actor;
}

export type ExpiryRisk = "not_tracked" | "expired" | "warning" | "ok";

export function expiryRisk(
  expiryDate: string | undefined,
  warningDays: number,
  today: string,
): ExpiryRisk {
  if (!expiryDate) return "not_tracked";
  const days = Math.floor(
    (Date.parse(expiryDate) - Date.parse(today)) / 86_400_000,
  );
  if (days < 0) return "expired";
  return days <= warningDays ? "warning" : "ok";
}
```

Add `expiryTracked` and `shelfLifeWarningDays` to `Product`, and `expiryDate` to `Lot`. Extend `WarehouseData` only with the small configuration sets `operationTypes` and `operationRoutes`; do not add unbounded operational queues to the full snapshot. Define `PageQuery` (`cursor?: string`, `limit: number`, `status?: string`, `search?: string`) and `PageResult<T>` (`rows: T[]`, `nextCursor?: string`, `total?: number`) with `limit` constrained to 1-100. Add bounded methods `listQualityInspections`, `listHolds`, `listExceptions`, `listStockChangeRequests`, `listWarehouseTasks`, and `listInventoryPositions`. Define `InspectQualityInput`, `ReleaseHoldInput`, `UpdateOperationRouteInput`, `SubmitCycleCountInput`, `DecideStockChangeInput`, and `ResolveExceptionInput`; each includes `idempotencyKey`, business fields, and no trusted actor/role. Add command methods `inspectQuality`, `releaseHold`, `updateOperationRoute`, `submitCycleCount`, `decideStockChange`, `resolveException`, and `getReceivableProcurementPOs` with exact canonical result types.

- [ ] **Step 4: Extend the canonical Warehouse capability matrix**

Add the seven W1 capabilities and `warehouse_admin` to the canonical Warehouse module. Assign route-management/import to Logistics and Warehouse Admin; inspection/release/resolve to Logistics and Warehouse Admin; inspection and exception view to Operations; approval to Logistics, Finance, and Warehouse Admin; read-only exception visibility to Finance and BI. Update the thin Warehouse adapter, domain `Role` union, memory profiles, and route-test personas to expose the ninth role. Core Platform Admin receives Warehouse access only when explicitly assigned `warehouse_admin`.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @intra/data-kit test -- warehouseControls.test.ts && pnpm --filter @intra/rbac test && pnpm --filter @intra/data-kit typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/data-kit/src packages/rbac/src modules/warehouse/src/auth/roles.ts apps/shell/lib/demoProfiles.ts apps/shell/tests/e2e/all-user-types.spec.ts
git commit -m "feat: define warehouse control contracts"
```

---

### Task 2: W1 Control Schema, RLS, and Seed Routes

**Files:**

- Create: `supabase/migrations/20260710150000_warehouse_w1_control_schema.sql`
- Create: `scripts/verify-warehouse-w1-schema.mjs`
- Modify: `package.json`

**Interfaces:**

- Consumes: Task 1 capability names and domain state values.
- Produces: operation types/routes, inspections, holds, exceptions, stock-change requests, command log, import jobs/errors, and expiry-aware lot columns.

- [ ] **Step 1: Write a failing static schema verifier**

The verifier must read the effective migration set and fail unless every W1 table enables and forces RLS, every state has a CHECK constraint, `warehouse.command_log` has a unique `(actor_id, command_name, idempotency_key)` key, new functions use `search_path = ''`, and anonymous grants are revoked.

```js
const requiredTables = [
  "operation_types",
  "operation_routes",
  "quality_inspections",
  "inventory_holds",
  "exceptions",
  "stock_change_requests",
  "command_log",
  "import_jobs",
  "import_errors",
];
for (const table of requiredTables) {
  assert.match(
    sql,
    new RegExp(
      `alter table warehouse\\.${table} enable row level security`,
      "i",
    ),
  );
  assert.match(
    sql,
    new RegExp(
      `alter table warehouse\\.${table} force row level security`,
      "i",
    ),
  );
}
assert.match(sql, /unique\s*\(actor_id,\s*command_name,\s*idempotency_key\)/i);
```

Add root script: `"verify:warehouse-w1-schema": "node scripts/verify-warehouse-w1-schema.mjs"`.

- [ ] **Step 2: Run the verifier and confirm failure**

Run: `pnpm verify:warehouse-w1-schema`

Expected: FAIL listing all missing W1 tables.

- [ ] **Step 3: Create the schema migration**

Create tables with UUID primary keys for new control records; use text foreign references for legacy Warehouse IDs. Add:

```sql
alter table warehouse.lots add column if not exists expiry_date date;
alter table warehouse.receipts add column if not exists operation_route_id uuid;
alter table warehouse.receipts add column if not exists procurement_po_id text;
alter table warehouse.receipts add column if not exists quality_status text not null default 'pending';
alter table warehouse.cycle_counts add column if not exists status text not null default 'draft';
alter table warehouse.cycle_counts add column if not exists requested_by uuid references core.profiles(id);
alter table warehouse.cycle_counts add column if not exists submitted_at timestamptz;

create table warehouse.operation_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  active boolean not null default true,
  check (code in ('receipt','putaway','transfer','issue','return','vendor_return','cycle_count','adjustment'))
);

create table warehouse.command_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references core.profiles(id),
  command_name text not null,
  idempotency_key text not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  response jsonb,
  created_at timestamptz not null default now(),
  unique (actor_id, command_name, idempotency_key)
);
```

Define `operation_routes` with `operation_type_id`, source/destination location-type arrays, `requires_evidence`, `requires_approval`, `requires_online`, and active/effective timestamps. Define inspections and holds using the Task 1 state unions, positive quantities, text references to receipt/return/product/lot/serial/location, UUID creator/releaser references, evidence arrays, and timestamps. Define exceptions with P1/P2/P3 severity, source reference, owner, due date, resolution/waiver evidence, and status. Define stock-change requests with quantity delta, unit cost, generated absolute financial impact, requested-by UUID, reason/evidence, and approval status. Define import jobs/errors with kind, schema version, source/checksum/storage path, uploader/reviewer, reconciliation counts, correction lineage, apply status, and row/field/code/message errors. Seed one active route for each operation code.

- [ ] **Step 4: Add capability catalogue and RLS policies**

Insert the seven capability names into `core.capabilities` and Task 1 assignments into `core.role_capabilities`. Policies allow capability-scoped reads; direct authenticated INSERT/UPDATE/DELETE is revoked for ledger/control tables. Import owners can read their jobs, while Logistics/Admin and Finance may read all jobs for review. No browser role may directly modify `command_log`.

- [ ] **Step 5: Verify schema and migration formatting**

Run: `pnpm verify:warehouse-w1-schema && pnpm exec supabase migration list`

Expected: verifier PASS; migration list contains `20260710150000`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260710150000_warehouse_w1_control_schema.sql scripts/verify-warehouse-w1-schema.mjs package.json
git commit -m "feat: add warehouse control schema"
```

---

### Task 3: Transactional Quality, Hold, and Vendor-Return Commands

**Files:**

- Create: `supabase/migrations/20260710160000_warehouse_w1_quality_and_approval_rpcs.sql`
- Create: `scripts/verify-warehouse-w1-contract.mjs`
- Modify: `package.json`

**Interfaces:**

- Produces RPCs: `warehouse.update_operation_route(jsonb)`, `warehouse.inspect_quality(jsonb)`, `warehouse.release_quality_hold(jsonb)`, and `warehouse.create_vendor_return(jsonb)`.
- Produces helper: `warehouse.begin_idempotent_command(text,text,text)` and `warehouse.finish_idempotent_command(uuid,jsonb)`.

- [ ] **Step 1: Add failing effective-function checks**

Assert each RPC is SECURITY DEFINER, uses an empty search path, calls `core.has_cap`, locks its source row with `FOR UPDATE`, records a command log result, writes `core.activity_log`, and revokes `public`/`anon` execution.

- [ ] **Step 2: Run the contract verifier and confirm failure**

Run: `pnpm verify:warehouse-w1-contract`

Expected: FAIL naming the four missing RPCs.

- [ ] **Step 3: Implement idempotent quality inspection**

`inspect_quality` must:

```sql
if not core.has_cap('warehouse', 'inspect_quality') then
  raise exception 'Not authorized: warehouse.inspect_quality';
end if;
if payload->>'disposition' not in ('accepted','damaged','hold','vendor_return','unavailable') then
  raise exception 'Invalid quality disposition';
end if;
```

Lock the source receipt/return, validate product/lot/serial and positive quantity, reject a quantity greater than the source quantity, create the inspection, and create an active hold for `hold`, `damaged`, `vendor_return`, or `unavailable`. Update receipt quality status only after all source lines have a terminal inspection. Create an exception for non-accepted disposition and append an activity event. The command returns the inspection, hold, and exception as one JSON object.

- [ ] **Step 4: Implement hold release and vendor return**

`release_quality_hold` requires `release_quality_hold`, locks the active hold, rejects self-release when `created_by = auth.uid()`, requires reason and evidence, and changes the associated unit/quantity to accepted availability only when the target disposition is `accepted`. `create_vendor_return` requires supplier/reference, records custody status, leaves stock unavailable, creates a `vendor_return` movement, and does not increase or decrease usable on-hand twice.

- [ ] **Step 5: Add live SQL assertions to the verifier**

When `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and role test credentials exist, prove: accepted stock becomes available; held stock does not; wrong role is denied; self-release is denied; retrying the same idempotency key returns the same inspection ID; changing the payload under the same key is rejected.

`update_operation_route` requires `manage_operation_routes`, locks the route, validates location-type arrays and online/evidence booleans, rejects disabling the last active route for an operation type, and records prior/next policy in the activity log.

- [ ] **Step 6: Run static verification**

Run: `pnpm verify:warehouse-w1-contract`

Expected: PASS in static mode and `LIVE SKIPPED` when live credentials are absent.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260710160000_warehouse_w1_quality_and_approval_rpcs.sql scripts/verify-warehouse-w1-contract.mjs package.json
git commit -m "feat: add transactional warehouse quality controls"
```

---

### Task 4: Risk-Based Cycle Count and Stock-Change Approval Commands

**Files:**

- Modify: `supabase/migrations/20260710160000_warehouse_w1_quality_and_approval_rpcs.sql`
- Modify: `scripts/verify-warehouse-w1-contract.mjs`
- Modify: `packages/data-kit/src/domain/warehouseControls.test.ts`

**Interfaces:**

- Produces RPCs: `warehouse.submit_cycle_count(jsonb)`, `warehouse.decide_stock_change(jsonb)`, and `warehouse.resolve_exception(jsonb)`.
- Uses `core.approvals` with entity type `warehouse_stock_change` and a UUID `stock_change_requests.id`.

- [ ] **Step 1: Add failing tests for approval state and separation of duties**

Add pure tests for zero-variance auto-completion, Supervisor-only impact at PHP 10,000, Supervisor-plus-Finance above PHP 10,000, rejection, and creator/approver conflict. Extend the SQL verifier to require row locks, ordered pending-step selection, and movement creation only after final approval.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @intra/data-kit test -- warehouseControls.test.ts && pnpm verify:warehouse-w1-contract`

Expected: FAIL for missing approval transition function and RPCs.

- [ ] **Step 3: Implement cycle-count submission**

The RPC validates `cycle_count`, locks affected `stock_levels` and serialized `inventory_units` in product/location/bin order, derives expected values on the server, rejects duplicate or unknown serial scans, and stores submitted lines. A zero-variance count becomes `approved` with no stock movement. Each variance creates one `stock_change_request`, one Logistics Supervisor approval step, a Finance step only when `abs(quantity_delta * unit_cost) > 10000`, and an open exception.

- [ ] **Step 4: Implement decisions and final posting**

`decide_stock_change` must select only the current pending step, require the matching Warehouse capability/role, reject `requested_by = auth.uid()`, require a note for rejection, and lock the stock-change plus balance. Supervisor approval advances to Finance where present. Final approval posts exactly one `adjustment` or `cycle_count` movement, updates stock/units, closes the exception, and records activity. Rejection changes no quantity and returns the count to `rejected`.

- [ ] **Step 5: Implement exception resolution**

Allow `resolve_exceptions` to assign, begin, resolve, waive, or cancel. Require resolution text for resolve and reason/evidence plus Supervisor capability for waive. P1 exceptions cannot be waived. Every transition writes activity history.

- [ ] **Step 6: Verify static and optional live behavior**

Run: `pnpm --filter @intra/data-kit test -- warehouseControls.test.ts && pnpm verify:warehouse-w1-contract`

Expected: PASS; live mode additionally proves wrong-tier denial, self-approval denial, no movement before final approval, one movement after final approval, and persistence after a new client session.

- [ ] **Step 7: Amend the Task 3 migration commit with the completed command set**

```bash
git add supabase/migrations/20260710160000_warehouse_w1_quality_and_approval_rpcs.sql scripts/verify-warehouse-w1-contract.mjs packages/data-kit/src/domain/warehouseControls.test.ts
git commit -m "feat: govern warehouse stock adjustments"
```

---

### Task 5: Repository and Store Parity

**Files:**

- Modify: `packages/data-kit/src/inMemoryRepository.ts`
- Modify: `packages/data-kit/src/inMemoryRepository.test.ts`
- Modify: `packages/data-kit/src/supabase/SupabaseRepository.ts`
- Modify: `packages/data-kit/src/supabase/SupabaseRepository.test.ts`
- Modify: `packages/data-kit/src/supabase/mappers.ts`
- Modify: `packages/data-kit/src/supabase/mappers.test.ts`
- Modify: `modules/warehouse/src/app/store.tsx`
- Modify: `modules/warehouse/src/app/App.test.tsx`

**Interfaces:**

- Consumes: Task 1 repository signatures and Tasks 2-4 tables/RPCs.
- Produces: W1 read-model hydration and boolean WarehouseProvider actions with no false success state.

- [ ] **Step 1: Write failing adapter tests**

Test explicit projections for every new table, snake-case mapping, memory quality/hold behavior, a pending count that does not mutate stock, final approval that mutates once, RPC payloads containing caller-generated idempotency keys but no trusted actor/role values, and every list method enforcing `limit <= 100` with a stable `(created_at,id)` cursor.

- [ ] **Step 2: Run adapter tests and confirm failure**

Run: `pnpm --filter @intra/data-kit test -- inMemoryRepository.test.ts SupabaseRepository.test.ts mappers.test.ts`

Expected: FAIL for missing W1 methods and projections.

- [ ] **Step 3: Implement mapper and Supabase adapter additions**

Add explicit projections for all W1 tables. Map numeric values with `Number`, null database values to `undefined`, and evidence arrays to `[]`. Small operation configuration may hydrate with `getData`; quality, hold, exception, approval, task, and inventory-position reads use explicit `.order('created_at').order('id').limit(limit + 1)` queries and return a cursor without `select('*')`. Each command calls only its W1 RPC and maps the canonical response; it must not pre-write stock or invent an actor.

- [ ] **Step 4: Implement deterministic memory parity**

Memory mode uses the same pure state rules and IDs supplied by the test clock/UUID helper. It may auto-create approval records for demo, but must not claim live persistence or permit offline approval/import. Preserve the existing outbox allowlist; do not add W1 approvals, hold release, or imports to `QueueableMethod`.

- [ ] **Step 5: Wire WarehouseProvider actions**

Expose bounded page loaders plus `inspectQuality`, `releaseHold`, `updateOperationRoute`, `submitCycleCount`, `decideStockChange`, and `resolveException` through the provider. Commands use `runAction('other', ...)`, invalidate only affected pages after canonical success, preserve drafts on failure, and return `false` on denial/network failure.

- [ ] **Step 6: Run package and module checks**

Run: `pnpm --filter @intra/data-kit test && pnpm --filter @intra/data-kit typecheck && pnpm --filter @intra/warehouse test -- App.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/data-kit/src modules/warehouse/src/app
git commit -m "feat: connect warehouse control data boundary"
```

---

### Task 6: Live Procurement PO Approval Handoff

**Files:**

- Create: `supabase/migrations/20260710170000_warehouse_w1_imports_po_and_reporting.sql`
- Modify: `packages/data-kit/src/domain/warehouseControls.ts`
- Modify: `packages/data-kit/src/repository.ts`
- Modify: `packages/data-kit/src/supabase/SupabaseRepository.ts`
- Modify: `packages/data-kit/src/supabase/SupabaseRepository.test.ts`
- Modify: `modules/warehouse/src/data/procurementBridge.ts`
- Modify: `modules/warehouse/src/data/procurementBridge.test.ts`
- Modify: `modules/warehouse/src/pages/PurchaseOrdersPage.tsx`
- Modify: `modules/warehouse/src/pages/PurchaseOrdersPage.test.tsx`
- Modify: `modules/warehouse/src/pages/ReceivingPage.tsx`

**Interfaces:**

- Produces: `ProcurementPOHandoff` read model and `warehouse.receive_procurement_po(jsonb)`.
- Memory mode retains the local bridge; Supabase mode reads only `procurement.purchase_orders`/`purchase_order_lines` under RLS.

- [ ] **Step 1: Write failing bridge and receipt tests**

Prove live mode never reads `localStorage`, only approved/issued POs are returned, pending/draft/cancelled/closed POs are hidden or denied, partial receipts update received quantity, over-receipt is rejected, and duplicate idempotency returns the original receipt.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `pnpm --filter @intra/data-kit test -- SupabaseRepository.test.ts && pnpm --filter @intra/warehouse test -- procurementBridge.test.ts PurchaseOrdersPage.test.tsx ReceivingPage.test.tsx`

Expected: FAIL because live procurement handoff is still browser-local.

- [ ] **Step 3: Implement the read model**

```ts
export interface ProcurementPOHandoff {
  id: string;
  poNumber: string;
  vendorName: string;
  status: "approved" | "issued";
  expectedDate?: string;
  lines: Array<{
    id: string;
    description: string;
    quantity: number;
    receivedQuantity: number;
    uom?: string;
  }>;
}
```

Supabase mode uses explicit projections and RLS. Memory mode alone calls `readProcurementPOs()` and labels its data Demo.

- [ ] **Step 4: Implement atomic receipt handoff**

The RPC locks the procurement PO and lines, requires `receive_stock`, permits only approved/issued state, validates each quantity against remaining quantity, executes the controlled receipt route, creates receipt/stock/lot/unit/movement/quality records, increments procurement received quantities, and closes the PO only when all lines are complete. It records one activity event containing both receipt and PO IDs.

- [ ] **Step 5: Replace UI ambiguity**

Purchase Orders and Receiving show `Approved`, `Issued`, `Partially received`, `Warehouse-origin exception`, or a blocked state. An unapproved PO has no Receive action. The page exposes a link to the Procurement PO but never treats local cached state as live approval evidence.

- [ ] **Step 6: Run checks**

Run: `pnpm --filter @intra/data-kit test && pnpm --filter @intra/warehouse test -- procurementBridge.test.ts PurchaseOrdersPage.test.tsx ReceivingPage.test.tsx && pnpm verify:warehouse-w1-contract`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260710170000_warehouse_w1_imports_po_and_reporting.sql packages/data-kit/src modules/warehouse/src/data modules/warehouse/src/pages/PurchaseOrdersPage.tsx modules/warehouse/src/pages/ReceivingPage.tsx modules/warehouse/src/pages/*PurchaseOrdersPage.test.tsx modules/warehouse/src/pages/*ReceivingPage.test.tsx
git commit -m "feat: connect approved procurement POs to receiving"
```

---

### Task 7: Governed Product, Location, Bin, and Opening-Balance Imports

**Files:**

- Create: `packages/data-kit/src/domain/imports.ts`
- Create: `packages/data-kit/src/domain/imports.test.ts`
- Create: `apps/shell/lib/warehouse/importAuthorization.ts`
- Create: `apps/shell/app/api/warehouse/imports/route.ts`
- Create: `apps/shell/tests/api/warehouse-imports.test.ts`
- Create: `apps/shell/vitest.config.ts`
- Modify: `apps/shell/package.json`
- Modify: `supabase/migrations/20260710170000_warehouse_w1_imports_po_and_reporting.sql`
- Modify: `docs/import-templates/README.md`
- Modify: `docs/import-templates/warehouse-locations-bins-v1.csv`
- Modify: `docs/import-templates/warehouse-products-opening-stock-v1.csv`

**Interfaces:**

- Produces: `validateImportRows(kind, rows)` and POST `/api/warehouse/imports` actions `validate` and `apply`.
- Uses `csv-parse/sync`; no hand-written comma splitting.

- [ ] **Step 1: Add the parser dependency and failing validation tests**

Run: `pnpm --filter @intra/shell add csv-parse && pnpm --filter @intra/shell add -D vitest`

Add `"test": "vitest run"` to `apps/shell/package.json` and a Node-environment `vitest.config.ts` whose include is `tests/api/**/*.test.ts`.

Test exact headers, UTF-8, duplicate SKU/bin/serial, unknown parent, invalid enum, negative quantity/cost, stale version, formula-leading cells, row cap 10,000, and source reconciliation `source = accepted + rejected + duplicate`.

- [ ] **Step 2: Run tests and confirm failure**

Run: `pnpm --filter @intra/data-kit test -- imports.test.ts && pnpm --filter @intra/shell test -- warehouse-imports.test.ts`

Expected: FAIL because the import validator and route do not exist.

- [ ] **Step 3: Implement exact import contracts**

```ts
export type WarehouseImportKind =
  "locations_bins_v1" | "products_opening_stock_v1";
export interface ImportIssue {
  row: number;
  field: string;
  code: string;
  message: string;
}
export interface ImportValidationResult {
  sourceRows: number;
  acceptedRows: number;
  rejectedRows: number;
  duplicateRows: number;
  issues: ImportIssue[];
  normalizedRows: Record<string, string | number | boolean | null>[];
}
```

Treat values beginning with `=`, `+`, `-`, or `@` as unsafe formula text unless the field is a validated signed numeric field. Reject a whole batch on header/version failure; preserve row-level errors for data failures.

- [ ] **Step 4: Implement private staging and atomic apply**

Create private `warehouse-imports` Storage bucket. The route verifies the authenticated Supabase user and `import_warehouse_data` capability, limits upload to 10 MB/10,000 rows, parses with `csv-parse`, computes SHA-256, uploads the source, writes `import_jobs`/errors, and returns preview counts. `apply` requires a different reviewer for opening stock, rechecks checksum/schema, and calls `warehouse.apply_import_job(jsonb)`. That RPC locks the job, rejects stale/already-applied jobs, applies all accepted rows in one transaction, posts opening stock movements/cost data, and records activity.

- [ ] **Step 5: Add route and database negative tests**

Prove anonymous, Business Unit, BI, and creator-as-reviewer requests are denied; unsafe CSV and oversized files are rejected; interrupted validation leaves no applied rows; replay returns the original job; correction creates a linked job rather than overwriting evidence.

- [ ] **Step 6: Run focused verification**

Run: `pnpm --filter @intra/data-kit test -- imports.test.ts && pnpm --filter @intra/shell test -- warehouse-imports.test.ts && pnpm verify:warehouse-w1-contract`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/shell packages/data-kit/src/domain/imports* supabase/migrations/20260710170000_warehouse_w1_imports_po_and_reporting.sql docs/import-templates pnpm-lock.yaml
git commit -m "feat: add governed warehouse cutover imports"
```

---

### Task 8: Inventory Position, BI Views, KPI Dictionary, and ERD

**Files:**

- Create: `packages/data-kit/src/domain/metrics.ts`
- Create: `packages/data-kit/src/domain/metrics.test.ts`
- Create: `docs/WAREHOUSE_ERD_AND_DATA_DICTIONARY.md`
- Modify: `supabase/migrations/20260710170000_warehouse_w1_imports_po_and_reporting.sql`
- Modify: `packages/data-kit/src/repository.ts`
- Modify: `packages/data-kit/src/supabase/SupabaseRepository.ts`
- Modify: `packages/data-kit/src/supabase/SupabaseRepository.test.ts`
- Modify: `modules/warehouse/src/pages/DataPage.tsx`
- Modify: `modules/warehouse/src/pages/DataPage.test.tsx`
- Modify: `modules/warehouse/src/app/governedExports.ts`

**Interfaces:**

- Produces views: `warehouse.inventory_position_v1`, `warehouse.bi_movements_v1`, `warehouse.bi_quality_v1`, and `warehouse.bi_cycle_counts_v1` with `security_invoker = true`.
- Produces metric records with `id`, `label`, `formula`, `numerator`, `denominator`, `timeBasis`, `inclusions`, `exclusions`, `owner`, and `sourceFields`.

- [ ] **Step 1: Add failing formula and query-shape tests**

Test on-hand 40, commitments 9, holds 3, unavailable 2 yields available 26; commitments count only reserved/allocated; inactive holds do not count; view projections contain no `select('*')`; metric IDs are unique and every metric includes owner and source fields.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @intra/data-kit test -- metrics.test.ts SupabaseRepository.test.ts && pnpm --filter @intra/warehouse test -- DataPage.test.tsx`

Expected: FAIL for missing views and formal metric fields.

- [ ] **Step 3: Implement security-invoker reporting views**

`inventory_position_v1` groups by product/location/bin and returns `on_hand`, `committed`, `held`, `unavailable`, and `greatest(on_hand - committed - held - unavailable, 0) AS available`. Add stable raw views with documented columns, no personal data not required by BI, and explicit authenticated SELECT grants compatible with source RLS.

- [ ] **Step 4: Extend governed export types**

In the new W1 migration, replace the export-type CHECK to allow `inventory_position`, `quality`, and `cycle_counts`; update filename validation and `register_export_job` allowlist. Do not change the historical migration. Add formula escaping for all exported text values.

- [ ] **Step 5: Make the KPI dictionary a single source**

Move DataPage definitions to `metrics.ts`, render definitions and limitations, and document entities/fields/relationships in `WAREHOUSE_ERD_AND_DATA_DICTIONARY.md` using a Mermaid ER diagram plus tables for owner, source, sensitivity, retention class, and calculation rules.

- [ ] **Step 6: Run tests and static SQL checks**

Run: `pnpm --filter @intra/data-kit test -- metrics.test.ts SupabaseRepository.test.ts && pnpm --filter @intra/warehouse test -- DataPage.test.tsx && pnpm verify:warehouse-w1-contract`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/data-kit/src modules/warehouse/src/pages/DataPage* modules/warehouse/src/app/governedExports.ts supabase/migrations/20260710170000_warehouse_w1_imports_po_and_reporting.sql docs/WAREHOUSE_ERD_AND_DATA_DICTIONARY.md
git commit -m "feat: add governed warehouse inventory reporting"
```

---

### Task 9: Grouped Navigation and Mobile Floor Shell

**Files:**

- Modify: `modules/warehouse/src/app/modules.ts`
- Modify: `modules/warehouse/src/app/modules.test.ts`
- Modify: `modules/warehouse/src/app/App.tsx`
- Modify: `modules/warehouse/src/app/App.test.tsx`
- Modify: `modules/warehouse/src/components/AppShell.tsx`
- Modify: `modules/warehouse/src/components/AppShell.test.tsx`
- Modify: `modules/warehouse/src/components/Icon.tsx`
- Modify: `modules/warehouse/src/index.css`
- Create: `modules/warehouse/src/pages/TasksPage.tsx`
- Create: `modules/warehouse/src/pages/TasksPage.test.tsx`
- Create: `modules/warehouse/src/pages/ScanPage.tsx`
- Create: `modules/warehouse/src/pages/ScanPage.test.tsx`

**Interfaces:**

- Produces desktop groups `Operate`, `Plan`, `Control`, `Analyze`, `Configure`.
- Produces mobile primary navigation `Home`, `Scan`, `Tasks`, `Inventory`, `More`.

- [ ] **Step 1: Write failing shell/navigation tests**

Assert every visible route belongs to exactly one desktop group; every role receives Home and More; Scan/Tasks appear only when the role has an actionable capability; mobile primary order is exact; More includes all remaining authorized routes; desktop group headings are keyboard navigable; bottom navigation and sticky actions reserve safe-area space.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @intra/warehouse test -- modules.test.ts AppShell.test.tsx App.test.tsx`

Expected: FAIL because navigation is currently a flat module list with role-specific four-item mobile preferences.

- [ ] **Step 3: Add grouped module metadata**

Extend `ModuleDef` with `group: 'operate' | 'plan' | 'control' | 'analyze' | 'configure'` and `mobile?: 'home' | 'scan' | 'tasks' | 'inventory'`. Add routes for operations, quality, approvals, exceptions, imports, reports, scan, and tasks with capability guards.

- [ ] **Step 4: Rebuild shell navigation**

Desktop renders group labels with compact lists, not cards. Mobile renders five equal stable tracks with icon+short label, 44 px minimum height, `env(safe-area-inset-bottom)`, visible active state, and a More sheet. Scan opens the dedicated route, not a top-header-only action. Header scan may remain as a secondary shortcut.

- [ ] **Step 5: Add task and scan landing states**

Tasks derives assigned/open quality, putaway, cycle count, and exception records from the read model and separates `Due`, `Blocked`, and `Completed`. Scan shows receive, issue, return, count, putaway, transfer, and lookup choices filtered by capability, with a safe manual-entry fallback.

- [ ] **Step 6: Run tests and typecheck**

Run: `pnpm --filter @intra/warehouse test -- modules.test.ts AppShell.test.tsx App.test.tsx TasksPage.test.tsx ScanPage.test.tsx && pnpm --filter @intra/warehouse typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add modules/warehouse/src/app modules/warehouse/src/components modules/warehouse/src/pages/TasksPage* modules/warehouse/src/pages/ScanPage* modules/warehouse/src/index.css
git commit -m "feat: organize warehouse floor navigation"
```

---

### Task 10: Receiving, QC, Hold, and Return Workspaces

**Files:**

- Create: `modules/warehouse/src/pages/QualityPage.tsx`
- Create: `modules/warehouse/src/pages/QualityPage.test.tsx`
- Create: `modules/warehouse/src/components/quality/InspectionSheet.tsx`
- Create: `modules/warehouse/src/components/quality/HoldReleaseSheet.tsx`
- Modify: `modules/warehouse/src/pages/ReceivingPage.tsx`
- Modify: `modules/warehouse/src/pages/ReceivingPage.test.tsx`
- Modify: `modules/warehouse/src/pages/ReturnsPage.tsx`
- Modify: `modules/warehouse/src/pages/ReturnsPage.test.tsx`
- Modify: `modules/warehouse/src/pages/PurchaseOrdersPage.tsx`
- Modify: `modules/warehouse/src/pages/InventoryPage.tsx`
- Modify: `modules/warehouse/src/pages/InventoryPage.test.tsx`
- Modify: `modules/warehouse/src/pages/ProductDetailPage.tsx`
- Modify: `modules/warehouse/src/pages/ProductDetailPage.test.tsx`
- Modify: `modules/warehouse/src/pages/AllocationsPage.tsx`
- Modify: `modules/warehouse/src/pages/AllocationsPage.test.tsx`

**Interfaces:**

- Consumes: `inspectQuality`, `releaseHold`, and procurement receipt actions.
- Produces accessible operation states `Receiving staging`, `Inspection required`, `On hold`, `Accepted for putaway`, `Vendor return`, and `Unavailable`.

- [ ] **Step 1: Write failing workflow component tests**

Cover accepted receipt, partial receipt, duplicate serial, over-receipt, hold creation, damaged stock, vendor return, self-release denial, evidence requirement, return mismatch, unknown serial, server failure preserving entered lines, and offline final-submit disabled with a useful message.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @intra/warehouse test -- ReceivingPage.test.tsx ReturnsPage.test.tsx QualityPage.test.tsx`

Expected: FAIL because quality state is not yet part of receiving/returns.

- [ ] **Step 3: Integrate receiving with inspection staging**

Receiving selects an operation route and approved PO context, captures lot/serial/expiry/evidence, and clearly states whether inspection is required. Success navigates or links to the created inspection; it does not claim stock is available while held. Validation summary focuses the first invalid control.

- [ ] **Step 4: Build the Quality workspace**

Use unframed status tabs and a dense desktop table that becomes mobile summary rows. InspectionSheet requires disposition, reason for non-accepted outcomes, evidence when policy requires it, and a review summary. HoldReleaseSheet displays creator, scope, reason, age, evidence, release target, and self-release denial.

- [ ] **Step 5: Integrate return validation**

Returns require source issue/event where known, validate serial/quantity, and always route accepted physical returns through inspection. Mismatch and duplicate return errors link to the exception record; vendor return retains supplier/reference and custody state.

Inventory lists, product detail, receiving lines, and allocation selection display expired/warning/ok shelf-life state using the shared helper. Expiry warnings do not disable reservation or issue in W1; tests must prove the warning is visible and the action remains available.

- [ ] **Step 6: Run tests and accessibility checks**

Run: `pnpm --filter @intra/warehouse test -- ReceivingPage.test.tsx ReturnsPage.test.tsx QualityPage.test.tsx && pnpm --filter @intra/warehouse lint`

Expected: PASS with no jest-axe violations in page tests.

- [ ] **Step 7: Commit**

```bash
git add modules/warehouse/src/pages/ReceivingPage* modules/warehouse/src/pages/ReturnsPage* modules/warehouse/src/pages/QualityPage* modules/warehouse/src/pages/PurchaseOrdersPage.tsx modules/warehouse/src/components/quality
git commit -m "feat: add warehouse quality control workspace"
```

---

### Task 11: Cycle Count, Approval, and Exception Workspaces

**Files:**

- Create: `modules/warehouse/src/pages/ApprovalsPage.tsx`
- Create: `modules/warehouse/src/pages/ApprovalsPage.test.tsx`
- Create: `modules/warehouse/src/pages/ExceptionsPage.tsx`
- Create: `modules/warehouse/src/pages/ExceptionsPage.test.tsx`
- Create: `modules/warehouse/src/components/approvals/StockChangeDecisionSheet.tsx`
- Modify: `modules/warehouse/src/pages/CycleCountsPage.tsx`
- Modify: `modules/warehouse/src/pages/CycleCountsPage.test.tsx`
- Modify: `modules/warehouse/src/pages/FinancePage.tsx`
- Modify: `modules/warehouse/src/pages/FinancePage.test.tsx`

**Interfaces:**

- Consumes: `submitCycleCount`, `decideStockChange`, and `resolveException`.
- Produces role-specific queues with explicit pending Supervisor, pending Finance, approved, rejected, and unresolved states.

- [ ] **Step 1: Write failing page tests**

Cover blind quantity count, serialized presence/missing/unexpected scans, recount, zero variance, Supervisor approval, Finance co-approval over threshold, exact PHP 10,000 boundary, self-approval, rejection note, server failure, stale record conflict, P1 waiver denial, and offline decision denial.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @intra/warehouse test -- CycleCountsPage.test.tsx ApprovalsPage.test.tsx ExceptionsPage.test.tsx FinancePage.test.tsx`

Expected: FAIL for missing governed approval workflow.

- [ ] **Step 3: Convert counts to submit/review/post**

The count page keeps draft scan data until server submission, shows expected values only after the configured blind-count step, and displays variance/value impact. A submitted variance says `Awaiting Warehouse Supervisor` or `Awaiting Finance`; no stock success message appears before final approval.

- [ ] **Step 4: Build the approval inbox**

Partition `Waiting on you`, `In review`, and `Recently decided`. StockChangeDecisionSheet shows source count, affected stock, quantity/value impact, evidence, creator, prior decisions, and separation-of-duties warning. Approve/reject buttons remain reachable above mobile bottom navigation and keyboard.

- [ ] **Step 5: Build the exception inbox**

Provide severity, type, age, owner, source, and next action filters with saved query-string state. Resolve requires resolution; waive requires Supervisor and evidence; P1 has no waive action. Every resolved row links back to source and audit evidence.

- [ ] **Step 6: Add Finance visibility**

Finance shows pending high-value stock changes and completed valuation-impact records without exposing hold-release actions. Reconciliation labels distinguish pending approval from posted adjustment.

- [ ] **Step 7: Run tests and lint**

Run: `pnpm --filter @intra/warehouse test -- CycleCountsPage.test.tsx ApprovalsPage.test.tsx ExceptionsPage.test.tsx FinancePage.test.tsx && pnpm --filter @intra/warehouse lint`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add modules/warehouse/src/pages/CycleCountsPage* modules/warehouse/src/pages/ApprovalsPage* modules/warehouse/src/pages/ExceptionsPage* modules/warehouse/src/pages/FinancePage* modules/warehouse/src/components/approvals
git commit -m "feat: add warehouse approval and exception queues"
```

---

### Task 12: Import, Report, and Operation-Route Pages

**Files:**

- Create: `modules/warehouse/src/pages/ImportsPage.tsx`
- Create: `modules/warehouse/src/pages/ImportsPage.test.tsx`
- Create: `modules/warehouse/src/pages/ReportsPage.tsx`
- Create: `modules/warehouse/src/pages/ReportsPage.test.tsx`
- Create: `modules/warehouse/src/pages/OperationRoutesPage.tsx`
- Create: `modules/warehouse/src/pages/OperationRoutesPage.test.tsx`
- Modify: `modules/warehouse/src/pages/DataPage.tsx`

**Interfaces:**

- Consumes: Task 7 import API, Task 8 inventory positions/KPI definitions, and Task 2 operation routes.
- Produces complete UI for WH-041 to WH-044, WH-055, and WH-056 W1 evidence.

- [ ] **Step 1: Write failing UI tests**

Test import drag/drop and file input, exact preview counts, downloadable error CSV, review separation, retry/correction lineage, offline block, committed report filters/totals/export, route read/edit permission, inactive route warning, long labels, empty/error/loading states, and keyboard-only completion.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @intra/warehouse test -- ImportsPage.test.tsx ReportsPage.test.tsx OperationRoutesPage.test.tsx`

Expected: FAIL because pages do not exist.

- [ ] **Step 3: Build ImportsPage**

Use a four-step full-width flow: Select template, Validate, Review, Apply/Reconcile. Show accepted/rejected/duplicate equations, errors grouped by field and row, checksum, source file, uploader, reviewer, and immutable correction lineage. Never place Apply beside unresolved errors.

- [ ] **Step 4: Build ReportsPage**

Render product/location/bin rows with stable numeric columns for on hand, committed, held, unavailable, and available. Desktop uses a paginated table; mobile uses summary rows with a filter sheet and no horizontal page scroll. Governed exports show preparing/ready/review/correction states and private download expiry.

- [ ] **Step 5: Build OperationRoutesPage**

Show operation route, source/destination types, evidence requirement, approval requirement, online requirement, and active state. Logistics/Admin may edit policy fields; other authorized users see read-only routing. Prevent disabling the last active route for an operation type.

- [ ] **Step 6: Run tests, typecheck, and lint**

Run: `pnpm --filter @intra/warehouse test -- ImportsPage.test.tsx ReportsPage.test.tsx OperationRoutesPage.test.tsx && pnpm --filter @intra/warehouse typecheck && pnpm --filter @intra/warehouse lint`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add modules/warehouse/src/pages/ImportsPage* modules/warehouse/src/pages/ReportsPage* modules/warehouse/src/pages/OperationRoutesPage* modules/warehouse/src/pages/DataPage.tsx
git commit -m "feat: add warehouse control and reporting pages"
```

---

### Task 13: Issue, Return, and Count Scan Completion

**Files:**

- Create: `modules/warehouse/src/components/camera/WarehouseScanFlow.tsx`
- Create: `modules/warehouse/src/components/camera/WarehouseScanFlow.test.tsx`
- Modify: `modules/warehouse/src/components/camera/BarcodeScanner.tsx`
- Modify: `modules/warehouse/src/components/camera/BarcodeScanner.test.tsx`
- Modify: `modules/warehouse/src/pages/ScanPage.tsx`
- Modify: `modules/warehouse/src/pages/AllocationsPage.tsx`
- Modify: `modules/warehouse/src/pages/AllocationsPage.test.tsx`
- Modify: `modules/warehouse/src/pages/ReturnsPage.tsx`
- Modify: `modules/warehouse/src/pages/CycleCountsPage.tsx`
- Modify: `modules/warehouse/src/pages/StorageAreasPage.tsx`
- Modify: `modules/warehouse/src/pages/StorageAreasPage.test.tsx`
- Modify: `modules/warehouse/src/pages/ProductDetailPage.tsx`
- Modify: `modules/warehouse/src/pages/ProductDetailPage.test.tsx`

**Interfaces:**

- Produces scan contexts `receive`, `issue`, `return`, `count`, `putaway`, `transfer`, and `lookup`.
- A scan resolves to one product/serial/lot plus context-specific validation; manual entry uses the same validator.

- [ ] **Step 1: Write failing scan tests**

Cover camera permission denial, ZXing fallback, duplicate callback suppression, unknown code, wrong product, wrong event/allocation serial, already-returned serial, missing count serial, manual input, scan cancellation, rapid double scan, offline task capture, and accessible status announcement.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @intra/warehouse test -- BarcodeScanner.test.tsx WarehouseScanFlow.test.tsx AllocationsPage.test.tsx ReturnsPage.test.tsx CycleCountsPage.test.tsx`

Expected: FAIL for missing context validation.

- [ ] **Step 3: Implement the shared scan state machine**

```ts
export type WarehouseScanContext =
  "receive" | "issue" | "return" | "count" | "putaway" | "transfer" | "lookup";
export type ScanResolution =
  | {
      ok: true;
      code: string;
      productId: string;
      serialNumber?: string;
      lotId?: string;
    }
  | {
      ok: false;
      code: string;
      errorCode: "unknown" | "duplicate" | "mismatch" | "invalid_state";
      message: string;
    };
```

The state machine deduplicates within the current task, announces success/error through `role=status`/`role=alert`, retains valid prior scans after one failure, and never posts a mutation by itself.

- [ ] **Step 4: Integrate issue, return, count, putaway, and transfer**

Issue validates allocation/event/product and serial availability before enabling confirmation. Return validates against issued records and prevents duplicate returns. Count records present/missing/unexpected serialized units and requires explicit review before submission. Putaway requires receiving-staging source plus destination-bin scan; transfer requires source location/bin plus destination and stock identity. Both reuse the existing `relocate`/`transfer` commands and produce no menu choice unless the complete contextual flow is reachable.

- [ ] **Step 5: Run scan tests and mobile component accessibility**

Run: `pnpm --filter @intra/warehouse test -- BarcodeScanner.test.tsx WarehouseScanFlow.test.tsx AllocationsPage.test.tsx ReturnsPage.test.tsx CycleCountsPage.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add modules/warehouse/src/components/camera modules/warehouse/src/pages/ScanPage.tsx modules/warehouse/src/pages/AllocationsPage* modules/warehouse/src/pages/ReturnsPage.tsx modules/warehouse/src/pages/CycleCountsPage.tsx
git commit -m "feat: complete warehouse scan workflows"
```

---

### Task 14: Strict Visual, Accessibility, Live E2E, and Release Evidence

**Files:**

- Modify: `apps/shell/playwright.config.ts`
- Create: `apps/shell/tests/e2e/warehouse-w1-workflows.spec.ts`
- Create: `apps/shell/tests/e2e/warehouse-w1-visual.spec.ts`
- Create: `apps/shell/tests/e2e/warehouse-w1-live.spec.ts`
- Create: `apps/shell/tests/e2e/warehouse-w1-performance.spec.ts`
- Create: `apps/shell/tests/helpers/warehouseLayoutAudit.ts`
- Create: `scripts/qa/build-warehouse-contact-sheet.mjs`
- Create: `scripts/qa/provision-warehouse-w1-test-users.mjs`
- Modify: `scripts/qa/full-intra-live-e2e.mjs`
- Modify: `scripts/verify-supabase-cutover.mjs`
- Modify: `package.json`
- Modify: `docs/REQUIREMENTS_TRACEABILITY_MATRIX.md`
- Modify: `docs/UAT_AND_ISSUE_MANAGEMENT.md`
- Modify: `docs/USER_TRAINING_AND_OPERATIONS_MANUAL.md`
- Modify: `docs/MIGRATION_CUTOVER_HYPERCARE_RUNBOOK.md`

**Interfaces:**

- Produces commands `test:warehouse-w1`, `test:warehouse-w1:visual`, `test:warehouse-w1:live`, and `report:warehouse-w1:visual`.
- Produces screenshot evidence under `apps/shell/test-results/warehouse-w1/<run>/<role>/<theme>/<viewport>/` and an HTML contact sheet.

- [ ] **Step 1: Add accessibility dependency and six Playwright projects**

Run: `pnpm --filter @intra/shell add -D @axe-core/playwright`

Configure projects named `desktop-1440`, `desktop-1280`, `tablet-768`, `mobile-390`, `mobile-360`, and `mobile-320` with exact required viewports. Preserve Chromium device behavior for mobile and set deterministic locale/timezone/animation reduction.

Add root scripts:

```json
{
  "test:warehouse-w1": "pnpm --filter @intra/shell exec playwright test tests/e2e/warehouse-w1-workflows.spec.ts",
  "test:warehouse-w1:visual": "pnpm --filter @intra/shell exec playwright test tests/e2e/warehouse-w1-visual.spec.ts",
  "test:warehouse-w1:live": "pnpm --filter @intra/shell exec playwright test tests/e2e/warehouse-w1-live.spec.ts",
  "test:warehouse-w1:performance": "pnpm --filter @intra/shell exec playwright test tests/e2e/warehouse-w1-performance.spec.ts",
  "report:warehouse-w1:visual": "node scripts/qa/build-warehouse-contact-sheet.mjs",
  "provision:test:warehouse-w1": "node scripts/qa/provision-warehouse-w1-test-users.mjs"
}
```

The provisioning script requires `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `MWELL_W1_TEST_PASSWORD`; it creates or updates nine `intra.test.wh.*@mwell.com.ph` users, upserts `core.profiles`, and assigns exactly one of `logistics_supervisor`, `operations`, `finance`, `bi_analyst`, `business_unit`, `marketing`, `procurement`, `pricing`, or `warehouse_admin`. It never prints passwords, tokens, or service keys.

- [ ] **Step 2: Write the failing visual audit helper**

For every role, route, theme, and required state, assert:

```ts
const audit = await auditWarehouseLayout(page, { minimumTarget: 44 });
expect(audit.scrollWidth).toBeLessThanOrEqual(audit.viewportWidth + 2);
expect(audit.overlaps).toEqual([]);
expect(audit.clippedControls).toEqual([]);
expect(audit.deadEnds).toEqual([]);
expect(audit.undersizedTargets).toEqual([]);
expect(await new AxeBuilder({ page }).analyze()).toMatchObject({
  violations: [],
});
await expect(page).toHaveScreenshot(`${role}-${route}-${theme}-${state}.png`, {
  animations: "disabled",
  caret: "hide",
  maxDiffPixelRatio: 0.002,
});
```

`auditWarehouseLayout(page, { minimumTarget })` returns `{ scrollWidth, viewportWidth, overlaps, clippedControls, deadEnds, undersizedTargets }`. Extract the existing visibility, clipping, `elementFromPoint`, overflow, dead-link, and accessible-name logic from `all-user-types.spec.ts` into this typed helper, then add sticky-versus-bottom-nav/safe-area intersection checks and keyboard-reachable close/back/next checks.

Canvas/scanner/chart states must include a pixel-variance assertion proving the surface is nonblank and a DOM-accessible data alternative.

- [ ] **Step 3: Add role and state workflow fixtures**

Cover all nine Warehouse roles, including `warehouse_admin`; test Core Platform Admin denial unless that Warehouse role is explicitly assigned. Build deterministic fixtures for empty, loading, error, offline, conflict, dense, long-label, large-quantity, modal, sheet, drawer, filter, success, and partial states. Do not grant a universal role for traversal.

- [ ] **Step 4: Add complete memory-mode W1 workflows**

Exercise setup/import preview, approved/unapproved PO receive, QC/hold/release/vendor return, transfer route deviation, quantity and serialized counts, Supervisor/Finance approval, rejection, issue scan, return mismatch, exception resolution, reports, exports, refresh persistence, duplicate submit, offline allowlist, and forbidden actions. Assert visible result and repository state.

- [ ] **Step 5: Add opt-in live database workflows**

Require `PLAYWRIGHT_BASE_URL`, Warehouse role credentials, and `AUDIT_MUTATIONS=true`. For every write, record created ID, query canonical database state through the user's authorized client or a verifier boundary, assert ledger/activity evidence, assert wrong-role denial, create a fresh browser context, and prove persistence. Run simultaneous same-stock receipts, counts, hold releases, and duplicate idempotency submissions; assert one canonical result, no negative balance, no duplicate movement, and a deterministic stale/conflict response. Prefix generated records with `W1-E2E-<run-id>`; reverse or cancel test transactions through normal audited business commands and retain immutable ledger/activity evidence.

- [ ] **Step 6: Add production-volume performance gates**

Seed a deterministic test dataset of 5,000 products, 20,000 serials/lots, 100,000 movements, 10,000 holds/exceptions, and 5,000 pending/completed control records. Assert every new list request returns at most 100 rows, no route transfers more than 2 MB before images/evidence, meaningful route content appears within 3 seconds at p95 over five runs on the local production build, and non-upload floor-command confirmation appears within 2 seconds at p95 under Playwright Fast 3G emulation. Record timings and query counts as JSON; any threshold breach exits nonzero.

- [ ] **Step 7: Run the complete visual crawl three times**

Run:

```bash
pnpm test:warehouse-w1:visual -- --repeat-each=3
pnpm report:warehouse-w1:visual
```

Expected: all three runs PASS with deterministic geometry; contact sheet contains every role/route/theme/viewport/state and no missing-image entries.

- [ ] **Step 8: Perform human screenshot review**

Open the generated contact sheet and record reviewer, date, pass/fail, and defect link for each matrix row. Explicitly inspect reading order, sticky/bottom-nav clearance, on-screen keyboard, charts, sheets, long labels, dense records, dark mode, 320 px layout, and action reachability. Automated pass alone is not sufficient.

- [ ] **Step 9: Run complete local verification**

Run:

```bash
pnpm --filter @intra/data-kit test
pnpm --filter @intra/warehouse test
pnpm --filter @intra/warehouse lint
pnpm --filter @intra/warehouse typecheck
pnpm --filter @intra/shell lint
pnpm --filter @intra/shell typecheck
pnpm --filter @intra/shell exec playwright test tests/e2e/warehouse-w1-workflows.spec.ts
pnpm test:warehouse-w1:performance
pnpm verify:warehouse-w1-schema
pnpm verify:warehouse-w1-contract
pnpm verify:launch-artifacts
pnpm build
```

Expected: every command exits 0 from a clean checkout under Node 22 or newer.

- [ ] **Step 10: Run live verification only against the designated test project**

Run: `AUDIT_MUTATIONS=true pnpm test:warehouse-w1:live`

Expected: all authorized writes, canonical read-backs, ledger/audit assertions, new-session persistence, idempotency, concurrency, and unauthorized denials PASS. If credentials or migrations are absent, the command must fail closed rather than report a pass.

- [ ] **Step 11: Update traceability and launch documents**

Map WH-006 to WH-016, WH-020, WH-036, WH-038, WH-041 to WH-045, WH-053 to WH-059 and corresponding F-items to route/RPC/test/evidence/owner/status. Add W1 role training, migration reconciliation, rollback triggers, hypercare metrics, and zero-open-P0/P1 sign-off fields.

- [ ] **Step 12: Review final diff and commit**

```bash
git diff --check
git status --short
git add apps/shell scripts package.json pnpm-lock.yaml docs
git commit -m "test: enforce warehouse W1 release gates"
```

Expected: clean worktree after commit; no screenshots, credentials, `.env` files, or test-generated business data committed.

## W1 Exit Checklist

- [ ] All fourteen task commits are present and independently reviewable.
- [ ] New migrations pass static verification and local reset where Supabase CLI is available.
- [ ] No W1 RPC trusts browser actor, role, quantity, cost, approval, or state without server validation.
- [ ] Receiving, QC, hold, release, vendor return, count, approval, import, PO handoff, and reports persist and reconcile in the designated test Supabase project.
- [ ] Wrong-role and self-approval denials are proven at the database boundary.
- [ ] Concurrent receipt/count/hold/idempotency tests preserve stock and movement invariants.
- [ ] Bounded-query and production-volume performance thresholds pass.
- [ ] Six viewports, two themes, all roles/routes/states pass three visual runs and human contact-sheet review.
- [ ] No open P0/P1 defect remains.
- [ ] RTM, UAT, training, rollback, migration, and hypercare evidence is complete for W1.
- [ ] Live deployment remains unperformed until separately approved.
