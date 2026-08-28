# Response to August 27 Warehouse Feedback

Source: August 27 section, pages 1-5 of `wms comments (4).pdf`.

Target: **Mwell Intra UAT**, https://mwell-intra-uat.vercel.app. This report does not certify or change the production site.

## Receiving and Inspection

**Reported:** Serial entry needed a scanner; different staff could not finish individual PO products independently; incomplete scans could not be saved.

**Change:** Each product has its own receive checkbox. Select only the products assigned to your account, then reconcile each selected product's clean, damaged, unidentified, short and excess quantities. Open the scanner beside the correct product and physical condition. Camera scanning, a keyboard scanner and manual serial entry feed the same validation. Duplicate serials and scans beyond the entered quantity are rejected.

**Save progress** records an unfinished snapshot for the signed-in operator and PO. It does not receive stock, change quantities or reserve exclusive ownership of that PO line. Another operator has a separate snapshot. Reopening the PO restores saved work; changed PO quantities require review before submission. Concurrent final receipts are checked against locked server balances.

**Verified database behavior:** Four separate 100-unit SKU receipts were simulated through the live UAT RPC, alternating between Operations Associate and Operations Lead. Each receipt changed only its selected PO line, stored 100 unique serials, created a pending Quality inspection and active hold, and returned the same response on replay. All writes were rolled back. This was not a four-person simultaneous physical-scanner test.

## Delivery Evidence

**Reported:** The team did not know where to obtain a receipt URL; an HTTP link caused a database constraint message.

**Change:** Use **Upload or photograph delivery note** directly in receiving. You no longer need to create a separate document URL. The optional **Delivery evidence URL** accepts a secure HTTPS link. An HTTP address receives a plain-language validation message before submission; the secure-evidence database constraint remains in place.

## Event Reservations

**Reported:** One event needed several products, including both selling and giveaway stock. Marketing needed a reservation action.

**Change:** Use **Add product** in New reservation. Each product line has its own quantity and **Selling / Giveaway** purpose. Combined demand for repeated products is checked against available stock before any line is saved. Marketing receives reservation authority through its applicable training requirement, not issue or approval authority.

Reservations remain acknowledged per-line commands, not an atomic batch. If a response is uncertain, the form locks, identifies confirmed saves, and directs the user to review recorded allocations before reserving only quantities confirmed missing. This avoids presenting an uncertain submission as a safe automatic retry.

## Allocation Returns and Multi-Product Intake

**Reported:** The allocation return screen offered Restock, then rejected that action because the backend required quarantine. Returns receiving accepted only one product.

**Change:** Allocation returns now identify quarantine custody and no longer offer an immediate Restock disposition. Returns receiving supports several products, quantities and serialized identities in one intake. The selected source event and active destination/bin are validated. Invalid lines block the whole intake. Quality remains responsible for the final disposition; receipt of a return does not authorize resale or putaway.

Regression testing also checks lost responses, replay safety and the Quality queue after partially inspecting a multi-serial return.

**Live validation:** A return containing two serialized watches and three non-serialized bags was posted and read back inside a rolled-back UAT transaction. Replaying it created no additional movements. Pending returns did not change available-to-promise stock. An Operations Lead accepted one watch; availability increased by exactly one, while the other watch remained pending. This check caught and corrected a physical-stock/hold double deduction that isolated tests had missed.

## Fulfillment Queues and Request Review

**Reported:** Queue counts were missing and approvers could not inspect a department request before deciding.

**Change:** Orders and events and Department requests display counts. Status counters act as filters. **View request** opens the requested items, quantities, request context and permitted decisions in a bounded dialog. Approval remains subject to role and independent-authority checks.

## Partial Backorders

**Reported:** A product that could not be supplied needed a zero fulfill-now quantity.

**Change:** A line may have zero fulfill-now quantity; its full demand moves to the linked backorder. The retained order must still contain at least one positive quantity, and at least one quantity must be deferred. Negative, fractional, excessive, all-zero and all-fulfilled splits are rejected.

**Verified database behavior:** The live UAT split command retained a positive line, deferred a zero line completely, preserved linked demand and replayed without duplication. The probe transaction was rolled back.

## Validation Record

Pre-deployment verification: 200 Warehouse component/logic tests, 142 data-repository tests, 135 Learning tests, 58 RBAC tests, 47 database regression tests, six training-publisher tests and 49 documentation-model tests passed. All 15 package typecheck tasks and the optimized Next.js build passed. Counts are per distinct test set, not totals inflated by repeated runs.

- Automated component/logic checks cover each changed workflow and negative cases.
- Database checks cover draft ownership, direct-write denial, stale revisions, capability revocation, bounded JSON, backorder validation and replay.
- Live authenticated probes cover draft save/read/isolation, independent PO-line receipts and backorder persistence. Operational probe writes were rolled back.
- Release verification and desktop/mobile screenshot results are recorded below once completed. Passing unit tests alone is not live browser certification.

The before-release UAT browser run reproduced the absent Save progress control. Its screenshot is preserved as the comparison baseline:

![Before release: receiving had no Save progress control](../evidence/2026-08-28-aug27-remediation/before-desktop-receiving.png)

## Operational Acceptance

Before operational rollout, have the warehouse team rehearse four actual people scanning their assigned products, camera permission denial, poor connectivity, a paused receiving shift, and independent Quality handoff. Use distinct accounts. A draft is private progress, not a lock on a product.

Keep using the seeded UAT POs, stock, events, department requests and orders. Do not reset other testers' progressed records to reproduce a screenshot. Hardware camera optics, printing and real courier execution are outside this targeted software regression.
