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

## Fix Round 2 In Progress

- Added the vendor-only `/vendor/purchase-orders` acknowledgement surface and a server-scoped awarded-PO list RPC. Lifecycle and procurement-only monitoring refreshes are now independent.
- Overrode `release_payment` to leave even fully paid POs issued; an independent approved closure request remains required for the only governed terminal path. The issued-PO backfill now normalizes the state revision to the immutable sent-event revision.
- Added a Task-9-only Playwright configuration with dynamic controlled-auth port propagation, HTML/JUnit output, failure screenshots, traces, and a Node22 runner.

## Verification

- `& 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node.exe' 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node_modules\corepack\dist\pnpm.js' --filter @intra/procurement test`: passed, 178 tests.
- `& 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node.exe' 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node_modules\corepack\dist\pnpm.js' --filter @intra/procurement typecheck`: passed.
- `& 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node.exe' scripts/verify-mpic-procurement-policy-alignment.mjs`: passed.
- `& 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node_modules\corepack\dist\pnpm.js' exec node --test --test-name-pattern "Task 9 RPC" scripts/verify-mpic-procurement-policy-alignment.test.mjs`: passed the disposable public lifecycle/RLS matrix.
- `& 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node.exe' 'C:\Users\NormanArisDeocareza\.cache\node-runtimes\node-v22.17.0-win-x64\node_modules\corepack\dist\pnpm.js' --filter @intra/shell typecheck`: passed.
- `git diff --check`: passed.

## Limits And Blockers

- No Supabase migration, deployment, UAT, or production mutation was performed.
- The migration was not applied and no shared Supabase target was changed.
- Browser fixture source is present and typechecked, but the three current controlled runs start both dynamically ported web servers and then return no Playwright completion, report, JUnit file, trace, or screenshot to this shell. This is an external local-runner/process-handoff limitation; desktop/mobile evidence is not claimed.
