# Ecommerce Live Journey - September 13

Status: **Limited shipment journey completed; overall WMS signoff remains open.** SMTP excluded.

## Scope And Result

Live UAT build `75e733b1aefd16aab831ca3a04f4d7adab2a66c9`, database `kkoitlvydytdhlpxhuah`. Run `acd6711b-6480-4bf9-83f0-896c5174974f` uses two isolated nonserialized merchandise products, one per viewport, with 10 seeded opening units and a shipment quantity of two. Opening stock is not receiving or inspection evidence. No courier actually shipped these goods, and no customer payment or human acceptance is claimed.

The Operations Associate created, allocated, picked and packed. A different Operations Lead released and updated delivery. Procurement was denied warehouse execution. No grants, training completions or workflow rules were changed to make the run pass.

| Check | Observed result |
| --- | --- |
| Intake, allocation, directed pick and pack | Saved with the exact synthetic product, bin and quantity |
| Wrong scanned bin | Refused; persisted order and inventory unchanged |
| Packer attempts release | Refused; different operator required |
| Release | Exactly one issue of two units; stock 10 to 8 |
| Department-style acknowledgment on shipment | Refused; shipment tracking required |
| Delivery without evidence | Refused; unchanged persisted state |
| Failed delivery, then retry | Timeline retained both the failure and renewed transit |
| Delivery confirmation | Completed/delivered with reference, timestamp and private photo |
| Same-key replay and conflicting payload | Replay unchanged; conflicting payload refused |
| Duplicate delivery with new key | Refused; no second event, audit or stock deduction |
| Private photo persistence | Two authorized accounts downloaded identical SHA-256 bytes; public access refused |

Desktop order: `ab9c70a4-869b-48ab-990d-272c82d881bb`. Mobile order: `a903be33-47ee-413a-b4f7-b874ea1afc2a`.

## Evidence Boundaries

Base: `outputs/wms-signoff/sep13-ecommerce-governed-bootstrap`.

- Original attempt `attempt-2026-09-13T04-00-03-456Z-01e52401` retained eight desktop checkpoints. It stopped after release because the harness expected a UUID in the movement actor field, which intentionally stores the server-derived profile email. Order and core audit actor columns still store UUIDs.
- Continuation `attempt-2026-09-13T04-08-52-389Z-aca4e68c` passed 24 checks and completed at `2026-09-13T04:12:44.033Z`. It hashes the original report and release payload. Fresh reads verified the same build, identities, released/dispatched state, event history, exact stock and movement before any delivery action. It did not release the desktop order again. Mobile then ran from intake through delivery without interruption.
- This is a linked desktop journey and a continuous mobile journey, **not two uninterrupted fresh runs**. The prior failure is not relabeled as passing.
- `independent-completion-verified.json` separately confirms both completed orders, each with stock 8, one movement of 2, one delivery audit and one Storage object. The earlier `independent-completion-readback.json` retains a failed read-only query caused by a text/UUID comparison; it is not accepted evidence.
- Each final `*-private-storage.json` contains the actual upload, authorized download hashes and public-access denial. Synthetic fixtures are marked as test images, not signed delivery acceptance.
- Supplemental visual review is business-read-only. Its initial attempt blocked signed-download POST requests incorrectly; that test guard was corrected to allow only signing the two already verified POD paths. No object-write permission was added.

## Visual Findings

**P2 - Packing notice covers the next handover instruction. Fixed locally, not deployed.** On mobile, the long packing success toast covers the order card's guidance. Evidence: final attempt `mobile390-14-packed-independent-release-required.png`. The candidate uses persistent row/filter feedback while retaining errors and the independent-release instruction. Success is shown only after the command confirms; uncertain responses keep the original command for recovery.

**P2 - Long pick reference crowds the active form. Fixed locally, not deployed.** The three-line mobile heading and explanatory copy consume too much of the scan surface; the scrolled error begins beneath the sticky header. Evidence: final attempt `mobile390-12-wrong-bin-denied.png`. The candidate keeps the full accessible/copyable reference in an expandable disclosure, shortens the visible heading, makes the Quality reminder expandable and scrolls new errors into view without moving focus. Scan validation and stock commands are unchanged.

Candidate verification: 158/158 fulfillment tests passed in the parent rerun (`outputs/wms-signoff/sep13-pack-pick-layout/parent-fulfillment-tests.json`); 30 browser cases passed across six viewports in `all-views`. Parent visual review of 390px packing and wrong-bin captures confirms visible handover guidance and the complete error below the compact header. Independent source/recovery review found no blockers. These are local memory-mode results, not evidence that this new layout is live. Local KB guidance was aligned for the same future release.

Reviewed desktop wrong-bin and delivery-failure screens retain clear task/error sections and visible actions. Order details show completed status, order date, customer/destination and courier information. Supplemental run `evidence-review-2026-09-13T04-18-26-203Z` captured ten screenshots without page errors or business mutations. Visual inspection confirmed the full proof image opens without cropping at 1440px and 390px, closes back to order details, and the mobile final timeline shows failed delivery, renewed transit and delivered status with evidence. Earlier supplemental `evidence-review-2026-09-13T04-16-19-084Z` captures show readable proof references and activity dates. This is an assistant visual review of selected screens, not human pilot acceptance or certification of every captured control.

## Still Open

The earlier `55b66a58` ecommerce batch remains at Received; this new batch contains two completed orders and two private synthetic photos. Both batches need run-specific archive/API cleanup and independent database readback. Testers should leave WMS-ECOM fixtures untouched. Existing tester data is outside this scope.

Receiving/independent inspection/putaway, physical return disposition, customer return resolution and replacement delivery, other stock types, partial/cancel/hold cases, all isolated roles, concurrency, wider recovery, hardware and named-user pilot acceptance remain open. The historical inbound scripts and rollback return probes do not certify those requirements on this build.
