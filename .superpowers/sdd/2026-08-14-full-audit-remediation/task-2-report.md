# Task 2: Warehouse custody and floor workflow

## Status

Stabilized in `modules/warehouse` and `packages/data-kit`, preserving unrelated uncommitted work in this fork.

## Delivered

- Direct receiving now requires an evidenced `non_po` or `overage` exception, creates a receipt record in `pending` quality state, and keeps received stock unavailable until inspection acceptance.
- PO receipts use the same receipt and quality-custody path, retain their procurement PO reference, and reject overages until they are recorded as an evidenced exception.
- Receiving actions are certification-gated in both direct receiving and PO receiving surfaces.
- Return intake is quarantine-first: operators choose physical custody but cannot choose a final disposition; returned stock is unavailable pending Quality action.
- Quality tasks are generated for pending receipts and returns, with actionable source links.
- Return Quality completion now resolves the quarantined line and stock state for accepted, held, vendor-return, and lost outcomes. Hold release and vendor handoff advance custody without leaving the original return inspection task open.
- Warehouse operators can reach Scan, Tasks, Inventory, Allocations, Cycle Counts, Quality Control, and Exceptions from navigation.

## TDD evidence

RED was captured before the data-kit implementation with:

```text
pnpm.cmd --filter @intra/data-kit test -- --reporter=verbose -t "rejects a direct receipt|creates a pending inspection receipt"
```

It failed because direct receiving resolved without an exception and PO receipts immediately increased availability.

GREEN verification completed on Node `v22.23.1`:

```text
packages/data-kit full suite: 15 files passed, 201 tests passed
packages/data-kit focused repository suites: 2 files passed, 116 tests passed
packages/data-kit typecheck: passed
modules/warehouse focused Quality/Returns/Tasks suites: 3 files passed, 16 tests passed
modules/warehouse focused Quality/Returns/Tasks/Fulfillment suites: 4 files passed, 29 tests passed
modules/warehouse typecheck: passed
```

The pre-fix full Warehouse run passed 360 of 366 tests; its six failures were all stale Quality fixtures. After migrating those fixtures, all six affected cases pass in the focused suite.

## Changed paths

- `packages/data-kit/src/domain/{types,stock}.ts`
- `packages/data-kit/src/{repository,inMemoryRepository,inMemoryRepository.test}.ts`
- `packages/data-kit/src/supabase/{SupabaseRepository,mappers}.ts`
- `modules/warehouse/src/app/modules.{ts,test.ts}`
- `modules/warehouse/src/components/AppShell.test.tsx`
- `modules/warehouse/src/pages/{ProductDetailPage,PurchaseOrdersPage,ReceivingPage,ReceivingPage.test,ReturnsPage,ReturnsPage.test,TasksPage,TasksPage.test}.tsx`
- Existing in-scope Warehouse changes, including fulfillment, inventory, camera evidence, dashboard, and package configuration, are preserved in the commit as requested.

## Concerns

- Live Supabase activation depends on the already-planned schema/RPC support for `pending_inspection`, `receipt_exception`, and unavailable stock. Migrations were explicitly out of scope for this task, so no migration was edited or applied.
- No Playwright spec was added because the existing end-to-end suite is in `apps/shell`, which was explicitly outside the permitted edit scope. The Warehouse unit workflow coverage above verifies the desktop component behavior; mobile end-to-end coverage remains for the integration task.
