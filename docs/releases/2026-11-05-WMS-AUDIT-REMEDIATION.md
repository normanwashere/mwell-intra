# WMS audit remediation - November 5, 2026

**Current release authority:** See the [current manifest](../handoffs/current/release-status.json) and [November6 update](2026-11-06-RELEASE-READINESS.md) for UAT d45fd6f and applied actor repair032602. Dated findings/checkpoints below retain their original build and then-current/pending wording; no retroactive certification. September CI212 is historical.

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

**Four-QA follow-up: initial acceptance plan and pending application follow-up**

This addendum concerns `outputs/four-qa-review-20261105`, not the earlier 19-finding WMS checklist. The table preserves the initial acceptance plan; the checkpoint below distinguishes later scoped results from pending work. Main must supply the final candidate SHA, actual UAT deployment and same-commit retest evidence before the follow-up is described as deployed. Original review reports remain immutable.

| Finding | Candidate change / required acceptance |
| --- | --- |
| QA4-001 | Public-only response caching; private API/page/document data must not survive logout/access loss through worker caches. Purge legacy private responses without deleting queued commands. Worker-upgrade, account/access-change and offline-denial evidence pending. |
| QA1-WMS-001 | Valid alternate source bins for unconstrained picking, with explicit source-bin, warehouse, exact serial, hold/reservation and server validation preserved. Alternate-bin success and protected negative paths pending. |
| QA3-001 | My Work uses database cursor order rather than JavaScript lexical comparison; mixed-case pages, repeat-cursor denial, retry and account-scope tests pending. |
| QA2-F01 | CSV unknown quantity totals become blank numeric cells with appended `Ordered Units Availability` / `Received Units Availability` states; verified zero remains numeric. Governed download and UI parity pending. |
| QA2-F02 | Finance distinguishes period-based committed/received totals, current inventory value and all-time review/activity. Scope/read-failure desktop/mobile verification pending. |
| QA3-002 | Product workflow landmark names identify record/version/product. Desktop/mobile assistive-navigation and accessibility retest pending. |
| QA4-002 | Anonymous protected APIs return JSON 401 private/no-store instead of redirecting; signed-in 403 and page sign-in behavior retained. Deployed HTTP checks pending. |
| QA4-003 | Effective authority-wrapper/delegation tests replace obsolete inline-source expectations. These failures did not establish a live authorization bypass; actual results pending. |
| REL-01, REL-02, REL-03 | Same-SHA hosted certification, aligned actual coverage execution and promotion denial for failed/wrong-SHA checks require retained results. Build/deploy success alone is not closure. |
| REL-04 | One current manifest now links Data, Technical, Tester and handbook sources; historical snapshots stay unchanged. Generated-document checks are separate from the pending actual deployed handoff verification. |
| QA1-WMS-002 through QA1-WMS-005; QA2-G01 through QA2-G03 | Isolated live WMS variants, independent-review denials, transfer/event return, daily reconciliation/export, Legal-to-Finance, current Product handoff and seller-to-settlement evidence remain pending. |
| SCOPE-01 | Reporting API/connector remains undelivered and disabled. It is explicitly a separate implementation phase, not a falsely closed app fix. |

See the [candidate operator guidance](../manual/MWELL_INTRA_USER_MANUAL.md), [tester acceptance checklist](../handoffs/current/testers.md) and [separate API implementation phase](../integrations/reporting-api/SEPARATE-IMPLEMENTATION-PHASE.md). Existing workflows, tester data, policies, approvals, training and both receiving paths must be preserved. SMTP is excluded. No production, departmental or physical-device acceptance is granted by this addendum.

**Follow-up source checkpoint: not deployed**

The serving app remains `0b7964e5650e6908fdf861a081bc1fe27716c014`. Source `3d7fd83` is not deployed, and later repairs await a final candidate. Hosted run `42027790187` failed; local tests and successful UAT journeys are not a full CI pass. The current manifest records the application, applied database versions and prepared documentation separately.

- Export repair is applied as `20261105134446`, reviewed locally as `20261105132130` with unchanged SQL. Current export capabilities, registered-object protection and independent review remain mandatory. The actual Warehouse export matched 258 observed authorized positions and its registered checksum; authenticated Lead download/storage denials and preservation readback passed. Whole-day reconciliation remains separate.
- The P3 export explanation is prepared, **not deployed**: it distinguishes inventory/access loading, denied export permission and unsuccessful report loading. Viewing a report does not grant export authority; an authorized colleague prepares the file. The workflow and permissions are unchanged.
- QA2-F03 balance repair is applied as `20261105135318`, reviewed locally as `20261105133207` with unchanged SQL. The sale-aware allocation display is prepared, **not deployed**. Existing event custody calculations account for sales, giveaways and prior returns; ordinary allocations retain their prior quantity rules. An unavailable balance is unknown, not zero. Exact serials, holds, return validation, Quality and independent settlement authority are unchanged. Independent review passed 27 SQL and 33 UI checks; main verified the applied quantity-only RPC and security metadata. These are not an updated-client live retest.
- Main's full Warehouse follow-up suite passed **1,569/1,569, zero failed or skipped**, including the F03 and P3 tests, retained in `outputs/four-qa-remediation-20261105/warehouse-final-followup.json`. This is source verification, not deployment or hosted CI.
- QA1-WMS-007 transfer repair is applied as `20261105141930`, reviewed as `20261105140056`, unchanged source hash `8704110436a8bce29b577c067dd584c24e993d96b32508d3ff430977ab4224ef`. QA2 reported 75 focused passes; QA3 independently cleared 78 local checks. These overlapping runs are not additive. Main verified unchanged outer wrappers and original ACL/DEFINER/empty-search-path settings. Quantity must match distinct validated serials before writes, without changing bulk/lot behavior, current authority, hold checks or uncertain-command recovery. QA1's owned rollback and fresh UI acceptance remain in progress; no live pass is claimed here.
- On `0b7964e`, the fresh two-component customer-set journey passed nine scoped checks, including separate Lead release, full-set return and independent Quality acceptance. This is not recipe, kit assembly or stock conversion certification. Transfer quantity mismatch QA1-WMS-007, G01, recipe/conversion, remaining negative variants, human and physical-device gates stay open until their own evidence is recorded.

Retained current evidence is in the parent workspace's `outputs/four-qa-remediation-20261105`, including `docs/REMEDIATION-UPDATE.md`, the bundle report, export evidence and independent reviews. No original report is overwritten. Reporting API implementation remains separate and disabled. SMTP is unchanged.
