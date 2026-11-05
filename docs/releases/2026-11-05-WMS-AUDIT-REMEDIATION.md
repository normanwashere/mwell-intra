# WMS audit remediation - November 5, 2026

## Release status

Candidate implementation for the 19 findings in the November 5 WMS checklist audit. All seven database migrations are applied to UAT. Frontend deployment and final live-browser certification are pending at this source checkpoint. This note is not department acceptance or go-live approval.

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

## Process boundaries

Both emailed-PO receiving and original Procurement-PO receiving remain supported. No Procurement approval steps, receiving ownership, Quality separation, fulfillment sequence or export entitlement is removed. Existing tester transactions and masterlist data are preserved. SMTP is unchanged.

Global product availability and unassigned commitments repeat on inventory-position rows and must be counted once per product. A location's availability is not confirmed when the demand source is unassigned. Putaway quantity is local free stock, not a promise that product-wide demand is fulfilled.

## Evidence at this checkpoint

- Warehouse suite: 1,503 tests in 134 files passed, zero failed or skipped. Subsequent quantity-summary edits require targeted revalidation; this is not a frozen final-build certification.
- Six focused SQL/routing scripts: 84 tests passed after migration filenames were reconciled with actual UAT history.
- Data-kit suite: 478 tests passed before the latest quantity-summary changes.
- Actual UAT role-context rollback probes passed for submission/replay, independent Lead approval/replay, net-zero lot correction, self-review denial, confirmed rejection, location protection, stale serial rejection and exact-unit write-off. Probe records were rolled back and their absence checked.
- Four independent UAT database-session checks passed: stock-row contention, event-style product-row contention, a committed new-stock arrival invalidating a snapshot, and receiving-draft/location-reclassification contention. Only isolated synthetic fixtures were used.
- Current Lead and inventory-only Employee readers received identical inventory-summary rows in one database snapshot, while the Employee could not read private active hold records.
- Independent summary review found and corrected Quality-only Tasks compatibility and product-local unknown-state handling. SQL summary tests passed 23/23; the retained independent suite passed 26/26 (overlapping, not additive).
- Desktop/mobile component and full-shell memory screenshots were reviewed separately from live evidence.

## Still required before certification

Complete the final inventory-summary review, integrated build, exact-candidate deployment, remaining concurrency probes and live Warehouse/Operations Lead/Quality browser journeys. Retest current-role access, saved-command recovery, report readback and the affected desktop/mobile screens. Keep automated evidence separate from physical scanner acceptance and department signatures.

The original audit and remediation evidence are retained separately; failed baseline results are not overwritten. Local evidence folder: `outputs/wms-uat-remediation-20261105` in the parent workspace.
