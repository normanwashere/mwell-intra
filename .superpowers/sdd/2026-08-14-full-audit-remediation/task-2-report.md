# Task 2: Warehouse custody and floor workflow

## Status

Implemented in `modules/warehouse` and `packages/data-kit`, preserving the pre-existing uncommitted Warehouse work in this fork.

## Delivered

- Direct receiving now requires an evidenced `non_po` or `overage` exception, creates a receipt record in `pending` quality state, and keeps received stock unavailable until inspection acceptance.
- PO receipts use the same receipt and quality-custody path, retain their procurement PO reference, and reject overages until they are recorded as an evidenced exception.
- Receiving actions are certification-gated in both direct receiving and PO receiving surfaces.
- Return intake is quarantine-first: operators choose physical custody but cannot choose a final disposition; returned stock is unavailable pending Quality action.
- Quality tasks are generated for pending receipts and returns, with actionable source links.
- Warehouse operators can reach Scan, Tasks, Inventory, Allocations, Cycle Counts, Quality Control, and Exceptions from navigation.

## TDD evidence

RED was captured before the data-kit implementation with:

```text
pnpm.cmd --filter @intra/data-kit test -- --reporter=verbose -t "rejects a direct receipt|creates a pending inspection receipt"
```

It failed because direct receiving resolved without an exception and PO receipts immediately increased availability.

GREEN verification completed:

```text
packages/data-kit: tsc --noEmit -p tsconfig.json
packages/data-kit: vitest inMemoryRepository.test.ts -t "rejects a direct receipt|creates a pending inspection receipt"
modules/warehouse: tsc --noEmit -p tsconfig.json
modules/warehouse: vitest ReceivingPage.test.tsx
modules/warehouse: vitest ReturnsPage.test.tsx
modules/warehouse: vitest TasksPage.test.tsx
modules/warehouse: vitest modules.test.ts
modules/warehouse: vitest AppShell.test.tsx
```

Focused results included 2 data-kit contract tests, all 15 Receiving page tests, 6 Returns page tests, 2 Tasks page tests, 18 navigation metadata tests, and 14 AppShell navigation tests passing.

## Changed paths

- `packages/data-kit/src/domain/{types,stock}.ts`
- `packages/data-kit/src/{repository,inMemoryRepository,inMemoryRepository.test}.ts`
- `packages/data-kit/src/supabase/{SupabaseRepository,mappers}.ts`
- `modules/warehouse/src/app/modules.{ts,test.ts}`
- `modules/warehouse/src/components/AppShell.test.tsx`
- `modules/warehouse/src/pages/{ProductDetailPage,PurchaseOrdersPage,ReceivingPage,ReceivingPage.test,ReturnsPage,ReturnsPage.test,TasksPage,TasksPage.test}.tsx`
- Existing in-scope Warehouse changes, including fulfillment, inventory, camera evidence, dashboard, and package configuration, are preserved in the commit as requested.

## Concerns

- The broader historical `inMemoryRepository.test.ts` run still has 28 failures because older fixtures expect direct receipts to become available immediately and returns to be operator-disposed. The focused new-policy tests pass; those legacy cases should be migrated in a follow-up rather than weakening custody controls.
- Live Supabase activation depends on the already-planned schema/RPC support for `pending_inspection`, `receipt_exception`, and unavailable stock. Migrations were explicitly out of scope for this task, so no migration was edited or applied.
- No Playwright spec was added because the existing end-to-end suite is in `apps/shell`, which was explicitly outside the permitted edit scope. The Warehouse unit workflow coverage above verifies the desktop component behavior; mobile end-to-end coverage remains for the integration task.
