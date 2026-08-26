# mWell Intra UAT: August 24–25 WMS Remediation Response

**Environment:** `https://mwell-intra-uat.vercel.app`

**Prepared:** August 26, 2026

**Source reviewed:** `wms comments (3).pdf`, with emphasis on feedback dated August 24 and August 25

**Scope:** Currently implemented mWell Intra warehouse, fulfillment, event, and cross-department handoff functions

## Executive result

The reported August 24–25 blockers are represented in the live UAT build and have been verified through role-authenticated browser journeys, targeted regression tests, visual inspection, and direct Supabase readback. The UAT database still contains reusable scenario data for Procurement, Operations, Marketing, Finance, and quality-control testing.

One fixture ownership mismatch was found during evidence capture: the Event A department request was originally attributed to the General Employee test actor. The application correctly hid that record from Marketing under least-privilege rules. The fixture and live record were repaired so the Marketing Events Lead now sees their own request, while other users’ requests remain private.

## What changed

### Marketing inventory requests

- Added a visible **New stock request** action for the Marketing role.
- Requests retain department, purpose, cost center, required date, expense treatment, event linkage, and line quantities.
- Marketing reads only requests created by its authorized actor/scope; the seeded Event A request is now correctly owned by the Marketing test actor.
- The same Event A context is available in the Events module for planning, custody, and reconciliation.

### Procurement PO receiving and quality

- Approved goods POs flow from Procurement into the Operations Associate receiving queue.
- Receiving supports clean, damaged, unidentified, short, and excess quantities per line.
- The governed receipt requires warehouse/staging location and delivery evidence before submission.
- Accepted stock proceeds to inspection and putaway; shortages, damage, unidentified stock, and excess create controlled exception work.
- PO 0001 and PO 0002 remain open for repeated UAT execution. PO 0003 is retained as a completed receiving/inspection reference.

### Fulfillment, returns, bundles, and events

- Pick & Pack exposes allocation, scan, packing, release, cancellation, courier/waybill, and handoff states.
- Seeded queues cover Ecommerce, Shopify, third-party event sales, delivery failure, completed delivery, and cancellation.
- OTG bundle definitions and bundle-set references are present for kit testing.
- Return scenarios cover submitted, decision-required, resolved/replacement, and closed/customer-evidence states.
- Event A carries its own demand, warehouse handoff, sales/giveaway outcome, and reconciliation trail.

### Responsive and usability fixes

- Operations’ task identifiers wrap at 320 px instead of forcing horizontal page overflow.
- Warehouse cards expose state-specific primary actions and retain contextual status labels.
- Desktop queue layouts preserve readable hierarchy, filters, and role-specific navigation.

## Live UAT seed readiness

Verified directly in the UAT Supabase project on August 26, 2026:

| Scenario data | Live count | Intended use |
|---|---:|---|
| Procurement requests | 3 | Request-to-PO traceability |
| Purchase orders | 3 | Two open receipt cases and one completed reference |
| Purchase-order lines | 6 | Four-line mixed device PO plus two supply POs |
| Active warehouse bins | 7 | Device, fulfillment-supply, and quarantine putaway |
| Scenario products | 10 | Watches, OTG supplies, paper bags, lanyard, and related stock |
| Serialized inventory units | 140 | Device serial lookup, allocation, pick, and returns |
| Fulfillment orders | 12 | Every active and terminal fulfillment stage |
| Customer return cases | 4 | Intake, decision, resolution, and closure |
| Event records | 1 | Event A custody and outcome testing |
| Event reconciliations | 1 | Event settlement and variance follow-up |
| Completed quality receipt | 1 | Completed PO reference |
| Quality inspections | 1 | Inspection evidence reference |
| Kit definitions | 1 | OTG bundle scanning and completeness |

## Feedback response matrix

| Reported item | Response implemented | Live evidence |
|---|---|---|
| Marketing cannot request stock | Added role-visible New stock request action and governed form | Screenshot 3 |
| Marketing should see only its own requests | Ownership/RLS retained; Event A seed repaired to Marketing actor | Screenshot 3 and live owner readback |
| PO 0001 must accept mixed outcomes | Per-line clean, damaged, unidentified, short, and excess quantities | Screenshot 2 |
| PO 0002 supply receiving | Open issued PO remains in Operations queue | Screenshot 1 |
| PO 0003 putaway/inspection feedback | Completed receipt and inspection reference retained | Supabase readback |
| Required rack/bin mapping | Seven active bins include A-01-01 through A-01-04, F-01-02, F-04-01, and Q-01-01 | Supabase readback |
| Ecommerce and Shopify order handling | Seeded orders cover channels, allocation, picking, packing, release, delivery, and cancellation | Screenshot 5 |
| Bundle set handling | OTG kit definition and bundle-set codes seeded | Supabase readback |
| Event A on-ground sale | Event record, third-party order, and reconciliation seeded | Screenshots 4 and 5 |
| Return/replacement flow | Four return lifecycle states with serial, replacement, and closure evidence | Supabase readback |
| Split backorder | Available as an explicit order action | Screenshot 5 |
| Mobile readability | 320 px viewport has no document-level horizontal overflow | Screenshot 6 |

## How the repaired flows work

### Department stock request

1. Marketing opens **Warehouse > Fulfillment > Department requests**.
2. **New stock request** captures purpose, cost center, required date, treatment, event, and item quantities.
3. The requesting user sees their own request and its approval status.
4. The department approver confirms business need and budget.
5. Warehouse allocates, picks, scans, and releases approved stock.
6. Event or department custody and Finance expense treatment remain attached to the same record.

### Procurement receiving

1. Procurement issues an approved goods PO.
2. Operations opens **Receive and inspect** and compares the PO with the physical delivery.
3. Each PO line is classified as clean, damaged, unidentified, short, or excess.
4. Evidence and staging location are recorded before the governed receipt can be confirmed.
5. Clean stock moves to inspection/putaway; exception quantities move to controlled queues and supervisor decisions.

### Pick, pack, and release

1. Demand enters from Ecommerce, Shopify, an event, a department request, or a controlled manual order.
2. Stock is allocated, including per-item bundle/serial requirements.
3. Operations confirms rack/bin and item scans.
4. Packaging supplies, courier, waybill, and recipient/handover details are recorded.
5. Release, failed delivery, proof of delivery, return, and Finance settlement remain traceable.

## Validation performed

- `7/7` deterministic scenario-seeder regression tests passed.
- `4/4` live role-authenticated Playwright evidence journeys passed against Vercel UAT.
- The three desktop evidence journeys were repeated after improving evidence framing; `3/3` passed.
- The 320 px My Work viewport was checked for document and body overflow; both remained within viewport width.
- Direct Supabase readback verified the scenario counts in this response.
- All six evidence screenshots were visually inspected before publication.

## Tester guidance

- Use PO **0001** for mixed device receiving: 50 clean, 20 damaged, 10 unidentified, and 20 short on Prodigy Watch; other device lines may be received clean.
- Use PO **0002** for fulfillment-supply receiving into bin F-01-02.
- Treat PO **0003** as the completed quality/putaway reference unless a reset is specifically required.
- Marketing should use the seeded Event A request to verify private request visibility, then create a new request to test submission and approval.
- Operations should test the `UAT-AUG24-PICKING` and `UAT-AUG24-PACKING` records without altering unrelated tester records.
- Transaction tests intentionally advance state. Rerun the guarded UAT seeder to restore missing deterministic rows; it does not overwrite unrelated user-created data.

## Evidence index

1. `01-live-purchase-order-receiving-queue.png` — Operations PO queue with PO 0001 and 0002.
2. `02-live-mixed-receipt-outcomes.png` — exact PO 0001 mixed quantity controls.
3. `03-live-marketing-stock-request.png` — Marketing’s own Event A request and New stock request action.
4. `04-live-event-a-custody-and-reconciliation.png` — Event A in the Events lifecycle view.
5. `05-live-pick-and-pack-scenario-queue.png` — event sale, picking, and packing state actions.
6. `06-live-mobile-my-work-no-overflow.png` — 320 px Operations task view.

## Release note

This response certifies the reported August 24–25 items and the supporting UAT fixtures. It is not a blanket production-readiness certification for every future or unimplemented module. Any additional stakeholder feedback should be attached to a dated scenario, expected role, exact record, and expected outcome so it can be reproduced and added to regression coverage.
