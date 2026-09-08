# Earlier WMS Feedback Regression Trace - September 8, 2026

## Scope and Evidence Boundary

Source: `C:/Users/NormanArisDeocareza/Downloads/wms comments (5).pdf`, 31 pages. All extracted text read; September 4 screenshot pages 2-5 rendered and opened to inspect the actual errors. Earlier dates only: September 4 and August 27/25/24/20/17. September 7 merchandise fixtures and documentation belong to main; separate Warehouse functional work belongs to Einstein.

Baseline HEAD: `e1c9f135eef1952d920062e9dc918dadba6124b3`, with concurrent dirty candidate changes. These results describe this local working tree, not deployment or production certification. No live account, database mutation, fixture reset, migration, commit or deployment was performed.

Initial assignment was read-only regression tracing. The user subsequently authorized two September 4 carryover fixes: serialized bin relocation and an editable automatic order reference. These are not September 7 fixes. Other gaps below remain open or untested.

## Executed Results

- Initial package-manager invocation failed before tests: bundled pnpm attempted dependency reconciliation and aborted with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. No force-install or module purge was attempted. Log: `outputs/sep08-earlier-wms-regression/focused-tests.log`.
- Installed Vitest invoked directly with bundled Node 24 first in PATH: **22 Warehouse files, 291 tests passed**, 74.34 seconds. Log: `outputs/sep08-earlier-wms-regression/direct-focused-tests.log`. This run preceded the two authorized fixes and included concurrent ReceivingPage candidate changes; it is not a clean-HEAD result.
- Focused repository run: **2 files, 9 tests passed, 118 excluded by name filter**, 1.62 seconds. Log: `outputs/sep08-earlier-wms-regression/repository-focused-tests.log`. The excluded tests were not executed, not certified passes.
- TDD red run: the three new initial tests failed on the old behavior (empty reference, enabled relocation without serials, absent relocation scanner). Log: `outputs/sep08-earlier-wms-regression/tdd-red.log`.
- First post-fix owned suites: **2 files, 28 tests passed**, 24.48 seconds. Warehouse TypeScript check exited 0.
- Expanded owned run initially reported 29 pass / 1 fail: the new unavailable-unit test had mutated shared seed objects and contaminated the later inter-site transfer test. Fixed only the new test fixtures with `structuredClone(buildSeed())`; retained all assertions. Failed log preserved as `owned-tests-final.log`.
- Final isolated owned suites: **2 files, 30 tests passed**, 14.76 seconds, exit 0. Log: `outputs/sep08-earlier-wms-regression/owned-tests-isolated-final.log`. Scoped ESLint over all four owned files exited 0 (`owned-lint.log`). Final Warehouse TypeScript check exited 0 (`warehouse-typecheck-final.log`).

All tests above are local component/domain/in-memory or mocked Supabase adapter tests. No actual PostgreSQL RPC, RLS, concurrent live operator session, camera hardware, mobile browser geometry or live end-to-end workflow was exercised.

## Dated Coverage Matrix

Paths in this table are under `modules/warehouse/src` unless explicitly prefixed `packages/`. A passing related test is not full closure of the dated request.

| Date / PDF pages | Feedback | Executed behavioral evidence | Remaining boundary |
| --- | --- | --- | --- |
| Sep 4 / 2 | Unidentified serials counted for receipt | `pages/PurchaseOrdersPage.test.tsx`: captures unidentified custody without forced product mapping; mixed PO-0001 command contains clean/damaged/unidentified/short; rejects non-reconciling quantities and duplicate identities. | Screenshot actually shows 92 clean + 6 damaged + 1 unidentified = 99 of 100 expected. Its rejection does not establish that unidentified was omitted. Exact 92/6/1/1 correction and real RPC not replayed. |
| Sep 4 / 2-3 | Automatic but editable unique order reference | New `components/fulfillment/OrderIntakeSheet.test.tsx` tests generated UUID reference, editability and source-switch stability; existing owner/resume and failed-submission tests retained. | Implemented locally after initial trace. Not deployed. External user-edited references still rely on existing repository validation; no claim of centralized sequence allocation. |
| Sep 4 / 3-4 | Non-bundle demand must not require set codes | Follow-up confirmed the adapter forwarded an empty array, while SQL validates bundle count when the key exists. The adapter now omits empty optional bundle metadata; three wire-payload tests plus existing adapter/retry tests passed, 40 total. Nonempty bundle metadata still reaches server validation. | This establishes the corrected adapter payload and source-matched cause, not a new live event transaction. |
| Sep 4 / 5 | General-area to F-01-02 relocation, exact serial identity | New `pages/ProductDetailPage.test.tsx`: exact scanned serial and source-bin payload, wrong-bin/duplicate negatives, reset on source-bin change. Existing repository tests relocate serialized/bulk stock and reject excess source quantity. | Original screenshot error is `Held serialized inventory cannot be transferred: MW-OTG-L-0044`; hold authority must remain enforced. Separate inter-site Transfer test was not sufficient for this bin-to-bin UI. New fix is local; no exact live OTG replay. |
| Aug 27 / 5-6 | Scanner wherever serials required; partial multi-person receiving | `pages/PurchaseOrdersPage.test.tsx`: outcome scanner, duplicate/insecure evidence rejection, saves incomplete serial progress, restores 100 serials, submits selected SKU while another operator's SKU waits. `data/receivingDrafts.test.ts`: expected revision and no actor claims, conflicts/network failure. | Simulated selected-line cooperation, not four simultaneous authenticated operators editing the same PO or cross-device camera scans. |
| Aug 27 / 6 | Where to find receipt URL | Receiving and PO tests reject insecure evidence and cover procurement handoff. | No executed test proves discoverability of the exact receipt/document URL the user asks for. Help/documentation walkthrough still needed. |
| Aug 27 / 6-7 | Reserve multiple event items, including selling | `pages/AllocationsPage.test.tsx`: multi-product per-line purpose; combined selling/giveaway stock validation; partial removals; uncertain-response immutable recovery. | Memory/component behavior, not live atomic RPC or event settlement. |
| Aug 27 / 8 | Allocation return error and multiple returned products | `components/AllocationReturnSheet.test.tsx`: remaining bulk quantity, exact event/product serials, quarantine bin/evidence, in-flight and uncertain-result states. `pages/ReturnsPage.test.tsx`: multi-product intake, duplicate-count negatives, lost-response recovery. | Allocation-specific sheet remains tied to its selected allocation. Passing general multi-product intake does not prove a single multi-allocation return dialog or reproduce the screenshot error. |
| Aug 27 / 9 | Counters in Orders/events and Department requests; view requested items | `pages/FulfillmentPage.test.tsx`: actionable counts, conflicting-filter clearing, post-decision counters, all request items and quantities shown before approval. | jsdom assertions, not mobile occlusion or independent live role scope validation. |
| Aug 27 / 9 | Backorder zero behavior | `pages/FulfillmentPage.test.tsx`: entire line can be deferred with zero fulfill-now; invalid split quantities rejected. | Zero fulfill-now is distinct from a zero-size backorder; no validation was weakened. Live split/order linkage not tested. |
| Aug 27 / 10 | Marketing reservations | `pages/AllocationsPage.test.tsx`: reservation-only Marketing can reserve but cannot issue/return or navigate to approvals; absent capability hides controls. | Does not change role assignments or prove current live grants. |
| Aug 25 / 11 | Marketing New request and only own requests | `pages/FulfillmentPage.test.tsx`: Marketing request creation; requester sees items without approval controls. `pages/FulfillmentPage.metadata.test.tsx`: authenticated requester name and collapsed raw audit IDs. | No two-requester isolation/RLS test executed. Do not infer owner-only data filtering from action hiding. |
| Aug 25 / 12-13 | Four-SKU receiving with 50 clean/20 damaged/20 short/10 unidentified; per-SKU bins and paperbags | `pages/PurchaseOrdersPage.test.tsx`: 400 units / four 100-serial lines, mixed serialized receipt command and balance rejection. `pages/ReceivingPage.test.tsx`: non-serialized chosen quantity/edit. `pages/StorageAreasPage.test.tsx`: exact unit/destination scan and partial bulk putaway. | Not the complete four actual products with all requested bins in one live transaction. PO-0003 screenshot error not independently reproduced. |
| Aug 24 / 14 | PO0001/0002/0003 fixtures and destinations | Same large PO, mixed receipt, serialized and bulk putaway tests. | No fixtures created or live PO/bin quantities certified. Named locations and exact paperbag quantities remain scenario-data checks. |
| Aug 24 / 14-15 | Ecommerce/event order intake, picking, packaging, release, delivery | `pages/FulfillmentPage.test.tsx`: complete multi-line ecommerce order, grouped import, directed bin scan, all packaging materials, independent second-operator release, delivery image requirement. | No end-to-end run of all named orders, variants, payment methods and independent actors. |
| Aug 24 / 15 | Defective return and linked replacement | `pages/ReturnsPage.test.tsx`: quarantine intake, quality handoff; `pages/FulfillmentPage.test.tsx`: customer-service return and Finance refund-only action. `packages/data-kit/src/inMemoryRepository.test.ts`: creates replacement order and requires supplier RMA evidence. | No live replacement, supplier handoff or closed-ticket timeline certification. |
| Aug 24 / 16 | Closed tickets remain viewable | Related return creation/timeline tests run. | No direct closed-ticket reopen/read-only reference regression identified in selected tests. Untested. |
| Aug 24 / 16 | Third-party event location and gross sales | `components/fulfillment/OrderIntakeSheet.test.tsx`: authority-appropriate setup handoff, reachable location management for administrator, gross sales required; `pages/FulfillmentPage.test.tsx`: third-party sales demand. | Gross-sales settlement/accounting and Marketing-owned live location setup not executed. |
| Aug 24 / 16-17 | Split backorder and acknowledge receipt | Zero-fulfill split and accountable handover/second-person release tests pass. | Does not establish the full receipt-acknowledgment workflow named in the PDF. Exact task/help walkthrough remains untested. |
| Aug 20 / 19 | Selling price vs cost; bundle interpretation | `domain/pricing.test.ts`: separates landed-cost calculations; full ecommerce intake records commercial values. Explicit bundle ID generation test passes. | Landed-cost unit tests do not prove live Finance selling-price display; no real pricing publication or server optional-bundle replay. |
| Aug 20 / 20 | Scan source location before picking | `pages/FulfillmentPage.test.tsx`: requires bin scan and records directed pick location. `components/camera/WarehouseScanFlow.test.tsx` and `BarcodeScanner.test.tsx` run. | Scanner mocks/manual input, not real camera/device/printed code fidelity. |
| Aug 20 / 21 | Export log | `domain/orderIntakeOptions.test.ts`: tracker replacement export; `domain/export.test.ts`: export helper tests. | Actual downloaded browser file and spreadsheet interoperability not checked. |
| Aug 20 / 21 | Return serial photo scan and release provenance | `pages/ReturnsPage.test.tsx`: issued serial matches selected product/event; wrong/already-returned serial negatives; evidence upload and stale context safeguards. | No camera-photo decoding or automatic original shipment/release discovery walkthrough executed. |
| Aug 20 / 22 | Allocation/pick-pack notification badges | `app/notifications.test.ts`: stock/reservation notifications and capability-correct targets; Fulfillment actionable counters. | Exact sidebar badge geometry and live count freshness not tested. |
| Aug 17 / 23-25 | PO-first receiving, readable serials, mobile receive errors | PO-first and direct-receive exception tests, long 400-unit receipt, footer missing-field focus, transient save retry and opening-refresh failure tests. | jsdom does not establish responsive layout or mobile button visibility. No current screenshot comparison against the PDF. |
| Aug 17 / 26 | Import template and channel dropdown | `domain/orderIntakeOptions.test.ts`: governed import template; `domain/ecommerceOrderImport.test.ts`: tracker mapping, unpaid/duplicate/inconsistent rows and insecure links rejected; full import UI test. | Download interaction and every external channel data format not certified. |
| Aug 17 / 27 | City-derived location details and automatic product price | `domain/orderIntakeOptions.test.ts`: editable supported-city suggestions; ecommerce intake tests and source product-price default. | Not nationwide address resolution or all product/channel price-authority cases. |
| Aug 17 / 28 | Payment dropdown/reference and Maya report automation | `domain/orderIntakeOptions.test.ts`: payment-derived allocation state; import rejects unpaid/inconsistent rows. | Does not prove automatic Maya ingestion/reconciliation or removal of every old payment field. No external payment integration exercised. |
| Aug 17 / 29 | Internal request reference, requester/department/date | Marketing stock request and metadata tests cover governed request creation and authenticated name/date display. | Distinct workflow from order intake. No assertion of all requested automatic-reference and dropdown details for internal requests. |
| Aug 17 / 30 | Picking photo scan; packing handover placeholder and optional URL | Directed bin scan, accountable handover and `pages/FulfillmentPage.evidence.test.tsx` upload blocking tests pass. | Placeholder generation, optional URL across all handover modes, real photo decode and printing waybill not directly certified. |
| Aug 17 / 31 | Delivery update error | `pages/FulfillmentPage.test.tsx`: requires/persists delivery image; related evidence failure guards. | Original error not reproduced against the original order/live RPC. |

## Authorized Local Carryover Changes

Only these application/test files were edited by this task:

- `modules/warehouse/src/pages/ProductDetailPage.tsx`: relocation now uses the existing scanner with exact product, warehouse and source-bin constraints; serial-count-derived quantity; source changes clear scans; selected identities are sent to existing repository command. Pending submission freezes fields/dismissal; rejection retains scans and does not claim a confirmed move. Existing authorization, hold checks and RPC path remain unchanged.
- `modules/warehouse/src/pages/ProductDetailPage.test.tsx`: exact source-bin/serial payload and stored result; duplicate/wrong-bin rejection; source-reset behavior; pending/rejection and wrong-product/unavailable tests.
- `modules/warehouse/src/components/fulfillment/OrderIntakeSheet.tsx`: new drafts get `ORD-<UUID>`, editable by the user. Existing drafts and source switches retain their reference; success/discard generates a fresh default rather than reusing a completed order's reference.
- `modules/warehouse/src/components/fulfillment/OrderIntakeSheet.test.tsx`: generated/editable reference regression; preserved owner isolation, explicit resume, failure/retry and exact custom-reference assertions.

Main was notified that Einstein-owned FulfillmentPage tests must clear the newly prefilled field before typing an exact external reference. This task does not edit that file. Full workspace integration remains the parent's gate.

## Reproduction Commands

Prepend `C:/Users/NormanArisDeocareza/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin` to PATH. From `modules/warehouse`, invoke `node node_modules/vitest/vitest.mjs run` with these relative files and `--reporter=verbose`:

```text
src/pages/PurchaseOrdersPage.test.tsx
src/pages/ProductDetailPage.test.tsx
src/pages/StorageAreasPage.test.tsx
src/pages/ReceivingPage.test.tsx
src/pages/FulfillmentPage.test.tsx
src/components/fulfillment/OrderIntakeSheet.test.tsx
src/pages/AllocationsPage.test.tsx
src/components/AllocationReservationSheet.test.tsx
src/components/AllocationReturnSheet.test.tsx
src/pages/ReturnsPage.test.tsx
src/data/receivingDrafts.test.ts
src/domain/orderIntakeOptions.test.ts
src/domain/ecommerceOrderImport.test.ts
src/app/notifications.test.ts
src/pages/ScanPage.test.tsx
src/components/camera/WarehouseScanFlow.test.tsx
src/components/camera/BarcodeScanner.test.tsx
src/components/ReceiptExceptionDecisionPanel.test.tsx
src/pages/FulfillmentPage.evidence.test.tsx
src/pages/FulfillmentPage.metadata.test.tsx
src/domain/pricing.test.ts
src/domain/export.test.ts
```

From `packages/data-kit`: `node node_modules/vitest/vitest.mjs run src/inMemoryRepository.test.ts src/supabase/SupabaseRepository.test.ts --testNamePattern='relocat|replacement order|bundle|held|requester.*(own|scope)|receipt.*(outcome|unidentified)' --reporter=verbose`.

Owned rerun: the ProductDetailPage and OrderIntakeSheet test paths above. Typecheck: `node node_modules/typescript/bin/tsc --noEmit`. Scoped lint: `node node_modules/eslint/bin/eslint.js` with the four owned source/test paths.

Earlier feedback is **not all closed**. Passing component tests do not replace the explicitly untested scenarios, PostgreSQL authority checks, camera/device checks or live multi-role acceptance.
