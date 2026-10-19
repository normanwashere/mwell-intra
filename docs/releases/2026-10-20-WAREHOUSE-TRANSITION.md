# Warehouse Transition Release Record

Scope: October 19-20, 2026, UAT only. Procurement remains available. SMTP is unchanged.

## Receiving Emailed POs

Procurement can continue sending approved purchase documents by email. Warehouse registers their PO number, supplier, warehouse, email context, evidence and ordered lines under **Receive and inspect > Emailed POs and saved arrival drafts**. Operations Lead confirms the supporting document; this is not purchase approval. A creator cannot confirm their own document.

Warehouse records each arrival and its delivery reference. Saving an arrival creates no available stock. Posting requires a confirmed record and quantities within the remaining balance, and sends the receipt to independent Quality inspection. Accepted goods continue through normal putaway. Damaged or held goods stay unavailable.

Use the existing Procurement receiving record when the PO is already in Intra. Cross-source guards prevent duplicate receiving. Do not rename a PO or change its supplier to bypass that check. A Procurement PO created after an external receipt needs reconciliation, not another receipt for the same goods. Automatic email ingestion and automatic historical receipt linking are not implemented.

## Catalogue And Opening Stock

- Categories distinguish Watches, Rings, Accessories, Merchandise, OTG, Packaging and HealthPass, with a review category for unmatched records. Product names and SKUs remain visible; unrelated products are not presented as sizes of one generic Merchandise item.
- The single-column inventory list loads incrementally. Availability comes from the governed stock positions and excludes holds; unavailable or incomplete reads do not silently display trusted totals.
- Imported 5,402 reconciled serialized opening units from `mWell_WMS_Product_SKU_Master_1018 (1).xlsx`, dated October 18, into the separate UAT masterlist warehouse.
- Prodigy and Sport are excluded from this opening import pending serial/quantity confirmation. Missing costs and reorder values were not invented.
- Privately archived and removed exactly 550 disposable fixtures: 300 untouched performance products, 200 untouched orders and 50 draft department requests.
- Preserved accounts, roles, training, 16 Procurement POs, linked custody records and audit history. The catalogue retains 191 masterlist products plus 78 protected or unverified legacy products; this was not a masterlist-only purge.
- A separate audited metadata correction replaced the pending-import note on only the nine imported products. All other product fields and opening-unit counts were unchanged.

## Verification

The initial rollout, application `ac8c3289cc460ffd5008fa261b1b4db97a1edb90`, reached canonical UAT on October 19 at 15:55 UTC. Health confirmed the UAT environment, expected Supabase project and reachable static assets. GitHub branch: `codex/reporting-security-foundation`.

- Full local tests, typecheck and lint: 45/45 tasks; Warehouse: 1,354/1,354 tests.
- Targeted SQL/security regression suites: 112/112 checks; independent duplicate-source review: 22/22.
- Ordinary Warehouse and separate Operations Lead accounts completed registration, document confirmation, partial receiving, independent Quality and putaway against the real UAT backend through the candidate frontend. The Lead exercised its existing Quality authority; this was two accounts, not three separate human participants.
- Pre-confirmation arrival created no stock, damaged stock remained held, excess delivery remained draft, and an existing Procurement PO could not be registered again externally.
- After deployment, canonical UAT showed the preserved nine-item Procurement receiving queue, saved external receipt and remaining balance, authorized evidence access, responsive desktop/mobile layouts, and matching inventory/detail availability.
- Independent database readback matched all 5,402 serial/product/bin assignments and preserved records. Before-images are retained privately, not published in this document.

The live review identified a completed-receipt Quality deep-link issue: the receipt's three recorded inspections were visible under Completed, while the initial Pending view incorrectly reported the source unavailable. The follow-up resolves exact receipt/inspection/hold identities, opens the appropriate tab, exposes matching-state shortcuts, and clears unsubmitted selections on source navigation. It preserves in-flight guards and does not change any inspection, hold, approval or stock decision. Its focused 42-test Quality regression, typecheck and scoped lint passed; post-deployment verification is tracked separately in the release evidence.

## Limits And Follow-Up

This is targeted Warehouse transition evidence, not a new all-app CI certificate. Native concurrent PostgreSQL-session testing, maximum-capacity testing, physical scanner/camera validation and a real-user pilot are not claimed. Synthetic images are test evidence, not supplier or physical-delivery proof. The all-app live certification pipeline was not rerun because its fixture provisioning would repopulate the reset UAT data.

The team still needs to confirm unresolved Prodigy serial identities, the Sport quantity, and missing business fields before expanding the opening-stock import or treating it as financially valued. Original Procurement controls remain in force.
