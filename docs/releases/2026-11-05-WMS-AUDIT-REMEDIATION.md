# WMS audit remediation - November 5, 2026

## Release status

Fixes for all 19 findings in the November 5 WMS checklist audit are deployed to UAT as application commit `4dbde805faf71f700e729adc5ef986489b122699`. All seven database migrations are applied. The UAT alias and health endpoint confirm the expected commit and database project. This note is not department acceptance or go-live approval.

A subsequent shared-header-only correction prevents brand/Help overlap at 320 pixels. It preserves the existing actions and 44-pixel touch targets. The business-journey evidence below belongs to `4dbde80`; the cosmetic follow-up has separate build/deployment and live-smoke evidence in the remediation folder, rather than relabeling earlier transactions as a new run.

## What changed

- Counts retain the original submission after an interrupted response. Retry recovers that same submission, including after a reload; it does not create a second adjustment (F01).
- Counts record actual observations only. Blank is not counted; zero means physically checked and empty. Serial scanning follows the current draft and supports removing and rescanning an item (F06, F07).
- Receipt-lot counts and approval details retain each lot. Offsetting lot differences still require review, and gross exposure follows the existing Finance threshold (F02).
- Approval validates the original stock snapshot and exact serial identities. Changed stock requires a new count. Current training, effective group membership and independent reviewer rules remain mandatory (F03, F05).
- Active holds and reservations prevent adjustment posting. The control owner must resolve them through the existing process; counting never releases them automatically.
- Serial custody history records the actual unit changed. Earlier aggregate product movements are no longer presented as proof that every serial moved (F04).
- Uncertain moves recover the original result before validating a new draft. Stocked or otherwise active warehouses cannot be hidden by changing their type or deactivating them; harmless renaming remains available (F08, F09).
- Product details show current Quality hold context. Return decisions distinguish current Quality state, loading and unavailable information rather than treating missing information as clearance (F10, F18).
- Warehouse Reports stays in Warehouse for existing authorized readers. Insights and CSV export permissions remain separate. The additional quantity-summary correction accounts for fulfillment reservations, avoids double-counting a returned held serial, and distinguishes product-wide demand from known bin commitments (F12).
- Mobile allocation identities, exact alert/exception links, queue labels, visible selected-bin identities, accessible low-stock contrast, collapsible secondary guidance, import progress and failure-state colors were refined without changing the transaction sequence (F11, F13-F17, F19).
- At 320 pixels, the Warehouse header allows controls onto a second row instead of squeezing the brand into Help. Desktop and 390-pixel layouts retain a single row.

## Process boundaries

Both emailed-PO receiving and original Procurement-PO receiving remain supported. No Procurement approval steps, receiving ownership, Quality separation, fulfillment sequence or export entitlement is removed. Existing tester transactions and masterlist data are preserved. SMTP is unchanged.

Global product availability and unassigned commitments repeat on inventory-position rows and must be counted once per product. A location's availability is not confirmed when the demand source is unassigned. Putaway quantity is local free stock, not a promise that product-wide demand is fulfilled.

Catalog items without an authoritative stock-position result remain Unverified. A missing summary entry is not proof of zero stock or no demand. This release does not reconcile unresolved masterlist quantities or invent opening balances.

## Evidence at this checkpoint

- Warehouse suite: 1,503 tests in 134 files passed, zero failed or skipped. Subsequent quantity-summary edits require targeted revalidation; this is not a frozen final-build certification.
- Six focused SQL/routing scripts: 84 tests passed after migration filenames were reconciled with actual UAT history.
- Data-kit suite: 478 tests passed before the latest quantity-summary changes.
- Actual UAT role-context rollback probes passed for submission/replay, independent Lead approval/replay, net-zero lot correction, self-review denial, confirmed rejection, location protection, stale serial rejection and exact-unit write-off. Probe records were rolled back and their absence checked.
- Four independent UAT database-session checks passed: stock-row contention, event-style product-row contention, a committed new-stock arrival invalidating a snapshot, and receiving-draft/location-reclassification contention. Only isolated synthetic fixtures were used.
- Current Lead and inventory-only Employee readers received identical inventory-summary rows in one database snapshot, while the Employee could not read private active hold records.
- Independent summary review found and corrected Quality-only Tasks compatibility and product-local unknown-state handling. SQL summary tests passed 23/23; the retained independent suite passed 26/26 (overlapping, not additive).
- Desktop/mobile component and full-shell memory screenshots were reviewed separately from live evidence.
- Final targeted checks passed: 107 Warehouse, 76 data-kit and 95 shell tests, all three typechecks and scoped lint. These overlap earlier runs and must not be added as unique coverage.
- The final frozen production build and hosted Vercel build passed. Deployment `dpl_Huon1THTRXEKX71S1zwkD4Tm9ddC` is aliased to `https://mwell-intra-uat.vercel.app`.
- Live browser recovery: a count committed before its response was interrupted; reload and retry kept the same payload, count and request IDs. Only one count persisted. Independent Lead review showed the two exact lot corrections, gross quantity 2 and PHP20 exposure; approval conserved five units as lots 2+3.
- Live scanner fallback: removing and rescanning a serial worked; completing a balanced count cleared the scanner and allowed the next draft to scan it again. This was manual barcode entry, not physical scanner hardware.
- Live relocation recovery: after an interrupted committed move, reload, Resume draft and Move stock returned the same movement IDs. Source remained zero and destination retained the original two lots, with no duplicate movement.
- Live stocked-location reclassification was rejected by the server, leaving its type and active state unchanged. Warehouse Reports opened for the inventory-only Employee, showed the correct quantity, and retained the separate export restriction. Report layouts at 1440, 390 and 320 pixels had no page overflow; the scoped mobile accessibility scan found no violations.
- The original Procurement-PO receiving regression passed: partial 3, independent Lead discrepancy decision, independent Quality acceptance, final 4, closed 7/7 and seven units moved to the intended destination. The issued PO was synthetic setup, not evidence of a newly tested purchasing approval.
- The emailed-PO regression passed: saved arrival restored before independent Lead confirmation, bulk receipts 2+1 and two serials, four independent Quality outcomes, two exact bulk lots placed once, accepted serial put away, damaged serial blocked and retained on active hold. The separate Quality actor had existing supervisor authority; this is not least-privilege Quality-only certification.
- Live allocations, work queues, alert links, exact Quality/count sources and operation labels were inspected at 1440, 390 and 320 pixels. Hold context, return Quality status, import progress and selected-bin identities were checked without altering existing tester records.
- The additional shared-header regression passed 22 focused tests, typecheck and lint. Settled local real-component screenshots at 1440, 390, 320, 360 and 420 pixels showed no brand/Help overlap, no page overflow and retained 44-pixel controls. Local component evidence is separate from the post-deployment smoke.

## Still required before certification

The affected business-journey retests are complete on `4dbde80`. Full hosted cross-platform CI, physical scanner/camera acceptance and real department signatures are separate gates; these are not represented as passed by local tests or synthetic transactions. No GitHub Actions run existed for that commit when checked. SMTP remains excluded.

Isolated synthetic fixtures remain identified in their owned manifests. Cleanup was not executed; no broad reset was performed and no concurrent tester transaction was reverted. Damaged synthetic stock deliberately remains held as evidence of the control.

The original audit and remediation evidence are retained separately; failed baseline results are not overwritten. Local evidence folder: `outputs/wms-uat-remediation-20261105` in the parent workspace.
