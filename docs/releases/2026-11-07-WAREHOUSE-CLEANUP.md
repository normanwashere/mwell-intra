# Warehouse cleanup and Associate Tasks

Scope: live UAT only. Masterlist stock, Procurement records, user accounts, approval decisions and audit history are retained. SMTP is unchanged.

## For Warehouse testers

- Associates can open Tasks and Exceptions without an unnecessary request for approval-only data. Approvers keep their existing access; no permissions were added.
- Confirmed old Warehouse samples are archived from active work, not erased from history. Completed or pending test counts are not silently approved, rejected or posted as stock adjustments.
- A wholly archived sample emailed PO leaves the active receiving list. Its existing authorized history link still shows the original order, lines and shipments. Empty drafts and mixed orders remain visible.
- Archived event custody is historical: original sales and totals stay visible, but its stock cannot be used for new outcomes or reversals. Normal active-event work is unchanged.
- Event Reserved totals use active allocations only. Historical issued and returned quantities still use the existing custody totals; settlement calculations are not rewritten.
- Archived conversion history keeps its serials, approvals and evidence. It is labelled as test history and offers no new approval, completion or cancellation action. Saved submissions retain their original retry identity.
- Receiving checks archived receipt and mapped-product references, including unresolved receiving records. Serial-duplicate checks still use the original history; archival does not make old serials reusable.
- A specifically retired emailed-PO test journey cannot accept another shipment. The original PO, its lines, shipment evidence and authorized history remain unchanged. This does not retire the master products used by that test.
- Availability excludes exact archived stock, units, reservations and holds. The Warehouse receiving queue excludes a Procurement PO only when it has lines and every line is mapped to an archived product. Empty, unmapped and mixed orders stay available; Procurement's original history is unchanged.
- Power, Prodigy and Sport masterlist discrepancies still require Warehouse confirmation; cleanup does not guess missing serials or reconcile their counts.

## Verification

The Tasks/Exceptions access tests passed 49 cases. The released Tasks change passed live Inventory, Quality and Tasks checks for Operations Associate and Operations Lead at 1440px and 390px, 12 screens total. The emailed-PO safeguard passed 9 focused database tests. Event custody passed 13 focused database tests, and the Events suite passed 85 tests.

The receiving and conversion boundary suites passed 76 focused database tests. Independent review also checked the original adjacent receiving/archive suites. Seventeen focused component tests cover archived history, unchanged active controls and saved-command recovery; three module typechecks and scoped lint passed. Four local desktop/mobile component screenshots were inspected. Those local fixtures are not live transaction certification.

The two boundary migrations were applied as `20261106190736` and `20261106190738`. All 14 expected function definitions/authority settings and ten trigger definitions matched installed readback. The 118 protected source-table snapshots matched before and after. No live business-command probes or new stock fixtures were run for this check.

Availability and PO-queue tests passed seven database cases and 79 repository cases. The read migration was applied as `20261106191404`; installed function/view fingerprints, owner and grants matched the reviewed candidate. Protected snapshots remained unchanged across all three migrations. Raw movement history and its ledger exports are retained; they are not active stock balances.

Before each archive commit, rehearse the exact manifest with rollback; pin the UAT project, source hashes and incoming dependencies; use the archive fence; compare protected base-table counts/digests; verify active absence and unchanged authorized history. The execution report records committed batches separately from rehearsals.

## Test data going forward

Existing Warehouse mutation runners remain paused unless their exact ownership and cleanup path is verified. Read-only screen checks do not create Warehouse transactions. Do not use masterlist stock for new synthetic tests.

The new PostgreSQL lifecycle adapter is a separate bounded one-serial proof, not blanket permission to resume legacy runners. The user has paused live mutation tests; its ledger migration and live fixture run remain unapplied/not run. Independent-session recovery checks, an approved connection and live readback must pass before live enablement. Never reset other testers' changes to make cleanup pass.

The disabled candidate passed 38 focused tests and 11 local native PostgreSQL checks, including two actual worker-process deaths and repeated recovery. Independent review reran eight boundary regressions. Both live entrypoints stop before database connection or journal access; there is no environment switch to bypass the pause. Logical non-FK writer coordination and full migration-chain replay remain required before a later live enablement review.

Execution evidence: `outputs/warehouse-sample-cleanup-20261107/` in the project workspace. The report distinguishes retained records, committed archives, unconfirmed ownership and automation limits.
