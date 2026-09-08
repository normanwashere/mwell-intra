# September 7 Procurement Tester Feedback

Source: `wms comments (5).pdf`, page 1, dated September 7. Pages 2-31 are earlier feedback retained for regression review, not new September 7 findings.

## Answer to the barcode question

Yes, merchandise configured as non-serialized uses a product barcode plus quantity. All identical tumblers share the product barcode; a scan identifies the product, while the operator counts and records quantity. It is not necessary to invent a serial for every tumbler. Jacket S, M and L are separate variants and need separate product barcodes. Serialized products retain unique serial-per-unit controls.

The example of receiving 1,000 tumblers and releasing ten describes this quantity model. The requested sample PO explicitly asks for 300 tumblers; the fixture follows 300, not 1,000.

## Requested scenarios

| Tester reference | UAT reference | Supplier | Lines |
| --- | --- | --- | --- |
| PO0005 | UAT-SEP07-PO-0005 | Company D | Jacket S 100; M 100; L 100 |
| PO0006 | UAT-SEP07-PO-0006 | Company E | Tumbler 300 |

The UAT namespace distinguishes synthetic testing from genuine purchasing commitments. Costs and supplier details are placeholders, not quotations, accreditation evidence or real approval attestations. Receiving these fixtures should create actual UAT custody records through the normal UI; seeding does not pre-receive or pre-issue them.

## Confirmed source gaps

1. Receiving's product scan used quantity 1 instead of the selected bulk quantity.
2. Pick & Pack exposed item scanning only for serialized products.
3. Governed PO receiving needed a quantity-controlled product identification path alongside serial capture.
4. The first live visual review found the new scan notifications overlapping the mobile evidence link. The follow-up uses inline feedback beside the affected receipt line, scoped to that PO session and product; success replaces the error without covering the footer.

Keep source-bin checks, eligible-stock limits, Quality inspection, required learning and separate release authority. A product scan does not confirm receipt or release by itself.

## Suggested tester sequence

1. Operations opens the requested PO in Receive and inspect, checks each product variant and records the actual received quantity, delivery date and evidence.
2. Complete Quality inspection and Put away accepted merchandise. Confirm available stock; inspection and held stock are not ready to issue.
3. Marketing reserves a small quantity for an event through Allocations. Operations completes the authorized issue and records the recipient.
4. Test a separate quantity through Marketing's department request and Pick & Pack. A separate approver decides the request; Operations allocates, picks, packs and releases it under the existing role rules.
5. Check the same product's availability and movement history. Do not release the same physical units again through the second path.
6. Negative checks: wrong jacket size barcode, zero/fractional/excess quantity, wrong bin, insufficient accepted stock, and unauthorized approval/release must not create movements.

## Further input

No clarification is required to prepare this UAT scenario. Before using real purchasing data, confirm actual supplier names, supplier/product barcode standards, jacket color/size variants, unit costs and the intended destination event/department. The fixtures deliberately do not claim those business details are final.

For the historical September 4 receiving screenshot, the displayed counts are 92 clean + 6 damaged + 1 unidentified = 99 of 100. If the tester still reports that issue, ask whether the remaining unit was short or belongs to another physical condition; do not invent its disposition. Earlier automatic Maya-report reconciliation also needs a separate confirmed integration/data-source scope before it can be called complete. Neither question blocks the September 7 merchandise fixtures.

## Earlier dates

See [earlier feedback regression trace](2026-09-08-EARLIER-WMS-REGRESSION.md). September 4 carryovers include exact serialized bin-to-bin relocation, an automatically generated but editable order reference, and ordinary demand incorrectly forwarding an empty bundle-code array. They are tracked separately from September 7. A passing focused test is not a claim that every earlier live transaction or integration has been recertified.

## Verification status

The seed is applied to UAT `kkoitlvydytdhlpxhuah`. Before application, 11 local SQL tests and an actual-UAT rollback rehearsal passed, followed by a separate zero-row rollback check and independent seed review. Applied SQL SHA256: `5fd77e0264a5c377c42a1f90a12beab55a85e731f2c716357e282350b519b7da`.

After application, an existing Operations Associate SQL role-context check returned `receive_stock=true` and both issued PO handoffs with the exact four line quantities and zero received quantities. This establishes database visibility, not a browser transaction. Four products and two POs were added; no receipts, stock units, grants, signatures or approvals were submitted by this seed.

Existing-row fingerprints matched before and after application: products `6ae24b8ecf97619238c552356076b028`, POs `1a5444e42dd7004294325d818042e77e`, normalized PO lines `cb2031063c6e68a4a3093a8e68e46ef5`. The pre-existing tumbler product was not reused or reset.

Candidate verification: 104 focused merchandise tests passed; Warehouse and shell type checks passed; 81 KB content/provenance tests passed; four KB flow tests passed after correcting an existing test fixture's discriminated-union typing without weakening assertions. Consult the deployment receipt and live capture report for the deployed revision; seed availability alone does not prove new frontend controls are deployed.

Final UAT revision is `a377d6fff79f7a8eb8d85e079b01c14ec513d3ee`. All six final live role/device cases passed; four mobile barcode-result originals were independently reviewed and accepted. Sample POs were not received or consumed by these browser checks. The manual and KB guidance were updated with the merchandise/serial distinction. See [deployment and evidence receipt](2026-09-08-SEPT7-UAT-DEPLOYMENT.md) for test scope, screenshots and historical rejected captures. Earlier-date coverage is a regression trace, not blanket closure of unexecuted integrations or human acceptance.
