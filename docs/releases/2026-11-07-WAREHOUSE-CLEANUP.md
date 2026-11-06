# Warehouse cleanup and Associate Tasks

Scope: live UAT only. Masterlist stock, Procurement records, user accounts, approval decisions and audit history are retained. SMTP is unchanged.

## For Warehouse testers

- Associates can open Tasks and Exceptions without an unnecessary request for approval-only data. Approvers keep their existing access; no permissions were added.
- Confirmed old Warehouse samples are archived from active work, not erased from history. Completed or pending test counts are not silently approved, rejected or posted as stock adjustments.
- A wholly archived sample emailed PO leaves the active receiving list. Its existing authorized history link still shows the original order, lines and shipments. Empty drafts and mixed orders remain visible.
- Archived event custody is historical: original sales and totals stay visible, but its stock cannot be used for new outcomes or reversals. Normal active-event work is unchanged.
- Event Reserved totals use active allocations only. Historical issued and returned quantities still use the existing custody totals; settlement calculations are not rewritten.
- Power, Prodigy and Sport masterlist discrepancies still require Warehouse confirmation; cleanup does not guess missing serials or reconcile their counts.

## Verification

The Tasks/Exceptions access tests passed 49 cases. The released Tasks change passed live Inventory, Quality and Tasks checks for Operations Associate and Operations Lead at 1440px and 390px, 12 screens total. The emailed-PO safeguard passed 9 focused database tests. Event custody passed 13 focused database tests, and the Events suite passed 85 tests.

Before each archive commit, rehearse the exact manifest with rollback; pin the UAT project, source hashes and incoming dependencies; use the archive fence; compare protected base-table counts/digests; verify active absence and unchanged authorized history. The execution report records committed batches separately from rehearsals.

## Test data going forward

Existing Warehouse mutation runners remain paused unless their exact ownership and cleanup path is verified. Read-only screen checks do not create Warehouse transactions. Do not use masterlist stock for new synthetic tests.

The new PostgreSQL lifecycle adapter is a separate bounded one-serial proof, not blanket permission to resume legacy runners. The user has paused live mutation tests; its ledger migration and live fixture run remain unapplied/not run. Independent-session recovery checks, an approved connection and live readback must pass before live enablement. Never reset other testers' changes to make cleanup pass.

Execution evidence: `outputs/warehouse-sample-cleanup-20261107/` in the project workspace. The report distinguishes retained records, committed archives, unconfirmed ownership and automation limits.
