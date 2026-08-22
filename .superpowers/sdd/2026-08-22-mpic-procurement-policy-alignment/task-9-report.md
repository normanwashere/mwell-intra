# Task 9: PO Pack, Acknowledgment, Monitoring, and Quality Handoffs

## Delivered

- Added route-aware PO package readiness with legacy-compatible return behavior, including requisition, solicitation, response, commercial tabulation, technical evaluation, award recommendation, accreditation, approval-ladder, and protection gates.
- Added a responsive PO commitment panel for package evidence, the 48-hour acknowledgment threshold, delivery notice, weekly open-PO monitoring actions, quality recovery/payment-hold state, and governed closure availability.
- Added additive PO lifecycle state/event records and public RPC contracts for `acknowledge_purchase_order`, `record_vendor_delivery_notice`, `purchase_order_lifecycle`, `review_open_purchase_orders`, `request_purchase_order_closure`, and `approve_purchase_order_closure`.
- Lifecycle transitions lock the PO/state, require an expected revision, allow only identical event retries, record immutable actor/evidence events, revoke private helper execution, and deny client acceptance/quality/closure assertions. Quality recovery and closure are recomputed from Warehouse receipt state.
- Extended the PGlite parse fixture for the existing text-keyed PO and receipt-projection boundary, preserving migration ordering compatibility.

## Fix Round 1 Delivered

- Issue transition and issued-PO backfill now derive `sent_at`, immutable sent events, and the 48-hour acknowledgement deadline from authoritative `purchase_orders.issued_at`. Monitoring distinguishes 47-hour escalation preparation from 48-hour overdue acknowledgement.
- Direct closure is retired and revoked. Procurement creates a revision-bound closure request; a distinct final approver must clear exact receipt, acceptance, quality/RMA/credit/payment-hold, and unpaid Finance gates before the private governed terminal transition records closure.
- Exact lifecycle and closure retries are idempotent; changed evidence/reasons at the same revision are rejected. Private helpers and direct lifecycle writes remain unavailable to application roles.
- PO detail now reads the governed lifecycle and monitoring projections, uses the server revision for live commands, gives the awarded vendor the acknowledgement control only, and gives Procurement the delivery/closure-request controls.
- The commitment panel renders the server-derived requirement matrix with status, route/exception basis, source, owner, and recovery action.
- Added a disposable public Task 9 PGlite matrix plus desktop/mobile controlled-RPC fixture and lifecycle browser spec.

## Fix Round 2 Delivered

- Added the vendor-only `/vendor/purchase-orders` acknowledgement surface and a server-scoped awarded-PO list RPC. Lifecycle and procurement-only monitoring refreshes are now independent.
- Overrode `release_payment` to leave even fully paid POs issued; an independent approved closure request remains required for the only governed terminal path. The issued-PO backfill now normalizes the state revision to the immutable sent-event revision.
- Added an explicitly vendor-scoped `/vendor/purchase-orders` acknowledgement surface, backed only by the awarded-vendor PO list, lifecycle projection, and acknowledgement RPC. Procurement retains delivery, monitoring, and closure controls.
- Separated lifecycle and monitoring refreshes so a monitoring authorization denial cannot erase an allowed vendor lifecycle projection.
- Replaced the role-matrix privilege inspection with disposable `SET ROLE` sessions. It executes every Task 9 public RPC as anon, unrelated authenticated, awarded vendor, Procurement author, dashboard reader, Finance, independent closure approver, and service role; it also exercises direct table/event/request writes and private helpers.
- The matrix proves exact acknowledgement/request/terminal replay, changed-reference/reason rejection, 47/48-hour monitoring, vendor binding, direct-close/payment-close denial, and receipt/acceptance/quarantine/RMA/credit/payment-hold/unpaid-Finance closure blockers.
- Added a Task-9-only Playwright configuration with dynamically allocated app/auth ports, runtime CSP propagation, deterministic inspectable HTML/JUnit artifacts under `apps/shell/artifacts`, failure screenshots/traces, and a Node 22 runner that streams child output and returns the Playwright exit code.
- Captured passing desktop and mobile vendor-acknowledgement and Procurement delivery/quality-recovery screenshots in `docs/qa/evidence/`.

## Fix Round 3 Delivered

- The non-live payment fallback now records a fully released payment pack without changing an issued PO to `closed`. The PO remains on the modeled governed closure path, which requires the server-side revision-bound request, independent approver, immutable terminal event, and replay checks. A focused `applyLocalPaymentRelease` regression test covers the full-payment case.
- The Task 9 browser runner canonicalizes child `PATH` by prepending `dirname(process.execPath)` while preserving the inherited value. It fails immediately unless its direct runtime is Node 22; the controlled Next build and server also fail when `MWELL_CONTROLLED_RPC_TEST=1` under any non-Node-22 runtime.
- Reviewed the reviewer-regenerated `docs/qa/evidence/task-9-quality-recovery-mobile-390.png`. It is current passing controlled-RPC evidence for the mobile Procurement quality-recovery/payment-hold handoff and is retained with this change.

## Migration Status Ruling

Remote shared-target migration status is deliberately deferred to Task 12. This workspace is intentionally unlinked, and Task 9 forbids applying the migration; no remote migration status is asserted here. The migration remains unapplied in this local worktree and no shared target was changed. Before Task 12 proceeds, it must obtain a read-only linked migration-status artifact for the intended target and stop the UAT path if this migration is unexpectedly applied or the chain has drifted.

## Verification

- `& 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node.exe' 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node_modules\corepack\dist\pnpm.js' --filter @intra/procurement test`: passed, 26 files / 179 tests.
- `& 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node.exe' 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node_modules\corepack\dist\pnpm.js' --filter @intra/procurement typecheck`: passed.
- `& 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node.exe' 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node_modules\corepack\dist\pnpm.js' --filter @intra/shell typecheck`: passed.
- `& 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node.exe' scripts/verify-mpic-procurement-policy-alignment.mjs`: passed (`MPIC procurement policy alignment migration contract verified.`).
- `& 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node.exe' 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node_modules\corepack\dist\pnpm.js' exec node --test scripts/verify-mpic-procurement-policy-alignment.test.mjs`: passed, 19 tests. Focused reruns also passed `disposable public Task 9 RPC and RLS matrix` and `Task 9 public contracts under disposable database roles`.
- `& 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node.exe' scripts/run-task-9-browser.mjs` from `apps/shell`: passed desktop and mobile. The latest run allocated app `62031` and auth `62030`; both web servers were pinned to the same Node 22 runtime. `apps/shell/artifacts/task-9-junit.xml` records 2 tests, 0 failures. HTML is at `apps/shell/artifacts/task-9-html/index.html`.
- `git diff --check`: passed.

### Fix Round 3 Verification

- `& 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node.exe' 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node_modules\corepack\dist\pnpm.js' --filter @intra/procurement test -- localStore.test.ts`: passed, 26 files / 179 tests, including the full-payment local-closure regression.
- `& 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node.exe' scripts/run-task-9-browser.mjs` from `apps/shell`: passed. The runner logged `node=v22.17.0` and allocated app `57027`, auth `57026`; the controlled Next build/start assertion ran under the same Node 22 path. JUnit records 2 tests, 0 failures; no Node20 runtime warning was emitted. HTML/JUnit remain at `apps/shell/artifacts/task-9-html/index.html` and `apps/shell/artifacts/task-9-junit.xml`.
- `$env:PATH = 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64;' + $env:PATH; & 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node.exe' 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node_modules\corepack\dist\pnpm.js' exec node --test scripts/verify-mpic-procurement-policy-alignment.test.mjs`: passed, 19 tests. The explicit child `PATH` guard ensures Corepack's `node` executable resolves to Node 22 rather than the system installation.
- `& 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node.exe' 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node_modules\corepack\dist\pnpm.js' --filter @intra/procurement typecheck` and `--filter @intra/shell typecheck`: passed.
- `& 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node.exe' scripts/verify-mpic-procurement-policy-alignment.mjs`: passed (`MPIC procurement policy alignment migration contract verified.`).

## Limits And Blockers

- No Supabase migration, deployment, UAT, or production mutation was performed.
- No local persistent or shared Supabase target was changed. Remote status was intentionally not queried from this unlinked workspace; the Task 12 read-only linked-status stop gate is recorded above.
- Playwright HTML/JUnit files are deterministic, inspectable run artifacts rather than committed source. The passing screenshots and this report are committed evidence.
