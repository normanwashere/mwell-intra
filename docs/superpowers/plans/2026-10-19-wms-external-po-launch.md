# WMS Categorization and External PO Launch Implementation Plan

**Goal:** Launch transitional coexistence of external emailed-PO receiving and the existing in-app Procurement flow, retain physical custody controls, and replace legacy UAT sample stock with the latest verified masterlist subset. Procurement is not removed or replaced. Existing in-app Procurement and its issued-PO receiving remain available.

**Approved design:** The user approved the October 19 proposal in this chat. Warehouse registers the PO and documents emailed by Procurement. Operations Lead confirms the emailed PO evidence, not purchase approval. Warehouse records deliveries; an independent Quality actor inspects before putaway and availability. Existing Procurement receiving, fulfillment, returns and approvals must remain intact.

**Architecture:** Separate external PO orders, lines and shipment drafts from Procurement records. Server-authorized, idempotent commands produce ordinary Warehouse receipts, inventory, inspections and holds. Existing Quality and putaway interfaces continue to operate on those receipts. Catalogue display taxonomy is independent of serialization and operational item class.

**Coexistence and reconciliation:** Retain the external source email sender/date, PO number, delivery reference, receipt reference and evidence. Future reconciliation with Procurement must not double-receive stock already posted through either flow and is not retroactive purchase approval. Compare existing receipts, quantities and serial/lot identities with Procurement before any later receiving action; stop and escalate an uncertain match. No automatic linking or reconciliation is implemented. Do not create a second receipt to backfill the other flow; any future linking needs a separately reviewed design that preserves original provenance and approval history.

**Tech stack:** React, TypeScript, existing Warehouse UI, Supabase/PostgreSQL, Vitest, PGlite and browser checks.

## Global Constraints
- SMTP is excluded. No fake Procurement approvals or generated serial numbers.
- No direct client writes to external PO records; private implementation functions and guarded public RPCs.
- Operations Lead authority is a current, active Warehouse Supervisor / Logistics Supervisor assignment, with existing live operational authorization. An order creator cannot confirm their own document.
- Saving an arrival before confirmation does not post available inventory. Excess or unidentified quantities remain unposted until resolved; confirmed order lines are immutable.
- A PO number already in Intra Procurement rejects external registration, confirmation and new posting; use the existing eligible receiving flow or ask Operations Lead to review it. A Procurement PO added after external receipt must be reconciled with that receipt, not received again. Do not change the PO number or supplier to bypass the guard. This is source exclusion, not automatic linking or retroactive approval.
- Changes to user accounts, training, unrelated modules and audit history are outside a Warehouse-only reset.
- Masterlist stock discrepancies are not silently corrected or imported as available stock.

## Review Focus
- Multi-role users cannot self-confirm or inspect their own receipt.
- Retry, concurrent receipts and duplicate delivery references cannot add stock twice.
- A stored evidence path is not authorization to attach or read somebody else's private upload.
- Shared bin codes must resolve inside the selected warehouse, never switch warehouse silently.
- Reset/load must have a restorable snapshot and explicit scope, and must not break Procurement-linked historical custody.

## Tasks
- [x] Categorization: source-first categories, conservative variants, meaningful item labels, single-column inventory, search and incremental loading have focused regression coverage and rendered inspection.
- [x] External PO database: private tables and guarded commands applied to UAT; role, quantity, evidence, idempotency and Quality-chain checks pass. Five local migration versions, including the maintenance archive and duplicate guard, match UAT.
- [x] Receiving UI: registration, independent confirmation, pre-confirmation arrival, partial balance, posting and excess-delivery blocking verified with ordinary UAT accounts through the local candidate frontend.
- [x] Existing custody integration: external receipts use exact-identity Quality handling; the original path for other receipts is preserved. Ordinary UAT accounts completed independent inspection and normal putaway; damaged stock remained held.
- [x] UAT data: private before-image archive, exact 550-fixture reset and 5,402-unit opening import applied. Independent readback matched the serial/product/bin plan, 404 bins, preserved Procurement and original audit history. Linked legacy records remain visible at the user's direction.
- [x] Scoped verification: Warehouse -> Operations Lead -> Warehouse -> Quality -> putaway browser journey against the real UAT backend through the candidate frontend; canonical UAT readback and desktop/mobile checks after deployment. Automated tests cover duplicate/retry, overage, unauthorized actor, self-review and cross-warehouse negatives. Native overlapping-session concurrency and the all-app live certificate remain outside this evidence.
- [x] Documentation/release: KB, manuals, technical specifications, training and the shareable update reflect the verified flow and limits. Application `562fd0f73a7332e59e1b31df932b1dc93d43dd98` is deployed on canonical UAT; final health and focused browser checks passed. This is targeted release verification, not full-system certification.

## Current Verification Checkpoint
- Initial transaction verification used the local candidate at port 3026 with the real UAT backend. Canonical UAT now serves `562fd0f73a7332e59e1b31df932b1dc93d43dd98`; health verified the exact commit, UAT environment, expected backend and static assets at 2026-10-19 16:17:15 UTC (October 20, 00:17 SGT). The local development server is stopped.
- Operations Associate created `OCT19-EXT-JOURNEY-001`. Saving its arrival before confirmation created zero units. A separate Operations Lead opened the PO image and confirmed the document.
- Posting created two serialized test units and two quantity-tracked pens, all initially held. Independent inspection accepted one watch and the pens; their normal putaway commands succeeded. The damaged watch retained its active hold and the server rejected putaway.
- A mobile excess-delivery draft correctly disabled posting and left the remaining balance unchanged. The 390px receiving dialog had no horizontal overflow.
- The draft shipment evidence defect was fixed and retested: Operations Lead opened the uploaded 900 x 620 synthetic image through the normal signed-image UI.
- Putaway now blocks the held serial before submission and offers an availability refresh. The 390px browser retest showed zero eligible units, persistent Quality guidance, and a disabled confirmation action. Existing server controls remained effective.
- User approved Warehouse-only reset and importing 5,402 reconciled serials. Both applied successfully; Prodigy and Sport remain excluded from this import. The catalogue retains 191 masterlist IDs plus 78 protected or unverified legacy products, not a destructive masterlist-only purge.
- The private maintenance archive is migration `20261019151646`; exact reset and seed receipts and independent preservation readback are retained in workspace `outputs/wms-launch-20261019/` without publishing private row images.
- A separate, audited metadata correction replaced the stale pending-import note on only the nine imported products. A rollback rehearsal and committed readback verified nine changed notes, unchanged other product fields and 5,402 unchanged opening units. The earlier preservation fingerprints are evidence from before this intentional correction, not a claim that the notes still match their pre-import values.
- Cross-source duplicate protection is migration `20261019153041`. It preserves Procurement creation and original receipt workflows while preventing the same PO being received through both sources. Ordinary Warehouse UI registration of existing PO `0001` was rejected; readback showed zero duplicate external records and no stock change. An error-focus regression now brings the explanation into view after a long-form submission.
- Final local test/typecheck/lint passed 45/45 tasks after the availability-display and error-focus refinements. The replenishment test now waits for verified availability before clicking; a delayed-read regression confirms the dialog remains open. Native overlapping-session concurrency remains untested; isolated PostgreSQL and source-level concurrency checks are supporting evidence, not that certification.
- The final Quality follow-up passed 42 focused tests and the repeated full gate passed 45/45 tasks, including 1,361 Warehouse tests. Canonical UAT opens the exact receipt's active hold, shows three completed inspections, and removes the erroneous unavailable-source warning. Desktop and mobile overflow checks passed; the final Quality console had zero errors and warnings.
- Canonical UAT still shows nine receivable Procurement POs, including PO 0001 at 390/400, alongside the external receipt and partial balance. Lead evidence access works. Inventory and detail agree on 3,319 available versus 3,320 physical Power units, excluding the damaged unit. The loaded-stock note is correct.
- Documentation freshness and the actual operational-change release gate passed. The handbook contains 48 sources and 511 legacy routes. The shareable update is `outputs/wms-launch-20261019/WAREHOUSE-TRANSITION-UPDATE.html`; its screenshots are canonical UAT evidence. Full live CI was deliberately not rerun because its provisioning would repopulate the reset fixtures.

## File Ownership
- Inventory: `modules/warehouse/src/domain/inventory.ts`, `pages/InventoryPage.tsx`, corresponding tests.
- External UI: `modules/warehouse/src/pages/ExternalReceivingPage.tsx`, `data/externalReceiving.ts`, `components/ExternalPOEvidence.tsx`, route registration and receiving entry links.
- Database: `supabase/migrations/20261019142956_warehouse_external_po_receiving.sql`, `supabase/migrations/20261019143020_external_po_quality_verifier_chain.sql`, `scripts/verify-external-po-receiving.pglite.test.mjs`.
- Data review/evidence: workspace `outputs/wms-launch-20261019/`; immutable prior masterlist extracts remain unchanged.

## Applied Migration Versions
- UAT application via MCP was reported successful with observed versions `20261019142956` (external receiving) and `20261019143020` (Quality verifier chain). Local filenames match these versions without SQL changes.
- The parent reported the cross-source duplicate guard applied as version `20261019153041`. Deployment and verification status remain tracked in the release record; the database installation alone does not certify the frontend or full journey. Local filename/history alignment remains with the migration owner.
- Reported UAT checks: `quality_chain=true`, `anoncommand=false`, `directread=false`. Browser workflow verification remains separate.
- Mandatory UAT SQL checks include the external receiving, shipment evidence, legacy evidence-access, launch-verifier PGlite, launch-contract and verifier-response suites. The launch contract requires the three observed migration filenames, with no duplicate versions of any migration.

## Draft Shipment Evidence Follow-Up
- UAT application was reported successful with observed version `20261019145212` for `external_po_shipment_evidence_access`. Local migration `supabase/migrations/20261019145212_external_po_shipment_evidence_access.sql` matches that version without SQL changes; it adds only a private read helper and an authenticated SELECT policy for exact `evidence` objects attached to external PO shipments. The parent applied the migration; the reviewing agent performed no live database writes.
- Existing Storage reads recognize receipt, inspection, hold and movement links, not private shipment drafts. Posting establishes those receipt links; it is not a substitute for allowing the Lead to view saved draft evidence before posting.
- The new path requires an active employee and the existing live external-PO workspace authority. Unlinked uploads, other buckets, unrelated users and Storage mutations stay outside this grant. Existing Storage policies and Quality verifier functions are unchanged.
- The regression suite covers actual Storage RLS as authenticated actors, both draft and posted attachments, both path representations, revoked authority and negative access cases. It does not exercise the live signing HTTP endpoint.
- After application, reload or reopen the Lead's order to request fresh signed URLs: an already-mounted gallery does not retry an unchanged failed evidence list automatically. Parent browser verification passed with an ordinary Operations Lead opening the saved draft's synthetic image from real UAT Storage through the local candidate.
