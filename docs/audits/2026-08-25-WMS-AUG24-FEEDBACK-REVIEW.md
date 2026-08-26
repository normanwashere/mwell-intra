# WMS August 24-25 Feedback Review

Source reviewed: `wms comments (3).pdf`, pages 1-7. This review is intentionally limited to the August 25 and August 24 feedback; August 20 is excluded.

## Outcome

The August 25 review found two real receiving defects that the earlier component suite did not cover: the governed Procurement PO form did not capture serials, and one global disposition could not represent a mixed line. It also found discoverability and handoff gaps in Marketing requests, external event locations and Finance settlement.

The remediation adds a line-level atomic receipt breakdown, per-outcome serial capture and database validation; direct Marketing request navigation; an actionable external-location recovery state; and an evidence-backed Marketing-to-Finance settlement handoff. Existing ecommerce, bundle, packaging, backorder, acknowledgement, delivery and return controls remain in place.

The principal gap was UAT readiness. The database did not contain the exact suppliers, products, bins, POs, stock, orders, and return states described in the August 24 document. The guarded UAT fixture pack in `scripts/qa/uat-wms-scenario-fixtures.mjs` closes that gap without resetting progressed records.

The fixture transaction was applied to the live UAT Supabase project on August 25, 2026. An independent readback confirmed:

- PO 0001 with 400 units and PO 0002 with 100 units remain receivable; PO 0003 has been successfully received and closed at 100/100.
- Seven active bins: A-01-01 through A-01-04, F-01-02, F-04-01, and Q-01-01.
- Nine scenario products and 140 serialized device units.
- Twelve fulfillment orders spanning received, allocated, picking, packing, ready, released, completed, and cancelled states.
- Ecommerce, third-party event, and department-request sources.
- Submitted, decision-required, resolved, and closed return cases with a verified replacement-order link.
- A pending Marketing stock request, a PHP 16,970 Event A reconciliation, and pending/held QC examples.

## Blockers Found And Remediated

Role-level verification initially showed that the Operations Associate could see Warehouse inventory and fulfillment orders but no receivable Procurement POs. The PO policy checked the linked request category through a request table whose own RLS correctly hid that row from Warehouse, so the nested proof always evaluated false.

Migration `20260825090000_repair_warehouse_goods_po_handoff_visibility.sql` adds a security-definer predicate that returns only whether a request is categorized as goods. The PO and line policies and the Warehouse handoff view now use that predicate without exposing Procurement request content.

Migration `20260826015244_governed_po_receipt_breakdown.sql` adds one atomic, idempotent receipt command for clean, damaged, unidentified, short and excess outcomes. It validates remaining PO quantity, physical serial counts, serial uniqueness, evidence and exception reason before any stock or custody write.

Migration `20260826103000_event_reconciliation_finance_handoff.sql` requires Marketing/Event evidence at submission, lets Finance independently supply the Finance reference during approval, and binds the approved reconciliation to the Finance Close entry.

Post-migration verification under the live Operations Associate identity confirmed:

- `warehouse.receive_stock` capability: enabled.
- Receivable POs: 3.
- Receivable PO lines: 6.
- Warehouse handoff POs: 3, totaling 600 ordered units.
- Scenario fulfillment orders: 12.

## Feedback Mapping

| Feedback item                     | Current application behavior                                                                      | Seeded UAT evidence                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| PO 0001: 400 watches from Zhenzen | Issued Procurement PO lines map to Warehouse products and Receive and inspect                     | PO 0001 with 100 each Prodigy, Power, Prestige, and Sports Watch                                                             |
| PO 0002: 100 large OTG bags       | Same governed receiving path                                                                      | PO 0002 with 100 OTG Bag - Large                                                                                             |
| PO 0003: 100 white paperbags      | Non-serialized fulfillment supply with quantity tracking                                          | PO 0003 with 100 Generic Paperbag - White                                                                                    |
| Mixed serialized receipt          | Per-line clean, damaged, unidentified, short and excess outcomes with per-outcome serial capture   | Contract scenario validates 50 clean, 20 damaged, 10 unidentified and 20 short as one atomic command                        |
| Required putaway locations        | Warehouse and active bins are scanned before putaway                                              | A-01-01 through A-01-04, F-01-02, F-04-01, and Q-01-01                                                                       |
| Eshop order and defective return  | Controlled intake, delivery, serial lookup, quarantine, decision, replacement demand, and closure | Received Eshop order, delivered source order, open return, decision-required return, resolved replacement, and closed refund |
| Shopify OTG bundle                | Bundle mode requires explicit set codes; components remain serial-specific                        | Shopify order with shared bundle set code `OTG-A-001`                                                                        |
| On-ground Event A sale            | Marketing owns outcomes/evidence; Operations records sale; Finance adds reference and approves    | Event A location, order and PHP 16,970 reconciliation ready for the corrected role handoff                                  |
| Marketing stock request           | Dashboard opens Department requests directly; requester rows remain restricted by RLS              | Pending Marketing request and own-request visibility policy                                                                  |
| Split backorder                   | Open demand can be split while retaining parent lineage                                           | Demand for 25 Prodigy Watches against 20 seeded units                                                                        |
| Acknowledge receipt               | Internal handover requires a second named actor and acknowledgement evidence                      | Released internal order awaiting acknowledgement                                                                             |
| Pick location before item         | Pick action requires the source bin before product and serial confirmation                        | Picking order with active bin-scoped reservations                                                                            |
| Packaging supplies                | Packing records consumed paperbags, boxes, labels, pouches, and tape                              | Paperbag plus replenished shared UAT fulfillment supplies                                                                    |
| Failed delivery                   | Released shipments retain courier events and recovery state                                       | Delivery-failed order with reason and shipment event                                                                         |
| Closed tickets remain viewable    | Resolved and closed return cases are retained as reference records                                | Closed refund case with Finance and customer closure evidence                                                                |
| Quality and error recovery        | Receipt inspection supports pending, accepted, hold, damaged, and vendor-return states            | Pending and held Power Watch inspection examples                                                                             |

## Tester Starting Points

1. Operations Associate: open Warehouse > Receive and inspect and process PO 0001, 0002, or 0003.
2. Operations Associate: open Pick & Pack and use `UAT-AUG24-PICKING`, `UAT-AUG24-PACKING`, or `UAT-AUG24-SPLIT-BACKORDER`.
3. Operations Lead: release `UAT-AUG24-READY-FOR-RELEASE`, decide the held quality item, and inspect the delivery-failed queue.
4. General Employee: submit or review the Marketing stock request and close the internal acknowledgement handoff.
5. Marketing & Events Lead: review Event A demand and its PHP 16,970 gross-sales reconciliation.
6. Finance Controller: verify the event settlement input, selling-price totals, refund evidence, and return financial reference.
7. Product Owner: inspect the active OTG Set A definition and product selling prices.

## Safety

The REST seed command validates `APP_ENV=uat`, confirms the exact Supabase project reference, refuses the production project, and requires explicit test-mutation approval. The SQL renderer resolves actors by UAT email, guards against missing profiles, and wraps all inserts in one transaction. Both paths use deterministic identifiers with conflict-ignore behavior, so rerunning the command restores missing fixtures but does not overwrite a tester's progressed workflow.

## Verification

- Fixture, production-target guard, SQL-renderer, and migration contract tests: 6 passed.
- Warehouse package: 402 tests passed, including the long ecommerce scenario, exact serialized Quality custody, secure evidence resolution, and the August 24/25 receipt, request, custody, and role-routing regressions.
- Shell package: 391 tests passed, including the updated role guidance, Operations Associate task model, and narrow-screen navigation contract.
- Data-kit package: 228 tests passed across in-memory and Supabase repository behavior, including HTTPS and governed storage evidence handling.
- Procurement package: 193 tests passed; operational request visibility and direct-record recovery contracts passed 2/2.
- Events and Finance packages: 56 tests passed across settlement preparation, Finance approval, evidence access, and three-actor separation-of-duties controls.
- PGlite database contracts: 64 passed across governed PO receipt and Quality convergence, third-party custody locations and lifecycle, and event settlement. Coverage includes mixed outcomes, atomic rollback, normalized duplicate-serial rejection, shared serial locking, held-stock enforcement, live-certification enforcement, provisional-hold transition, conflicting location locks, legacy-data preflights, duplicate settlement prevention, invalid evidence, and audited evidence access.
- Live UAT schema preflight: zero exposed held serials, zero invalid nonterminal third-party custody records, and zero Event settlement actor-lineage violations.
- Live UAT evidence preflight: zero insecure tracking links and zero insecure Operations evidence values.
- Live UAT role/RLS readback: Procurement Lead and Finance Controller opened all four governed test requests; Operations Associate retained requester-scoped privacy.
- Live responsive crawl: 66 role/viewport combinations covered 1440px, 1280px, 768px, 390px, 360px, and 320px. The initial crawl found insecure Operations evidence, missing Procurement deep-link visibility, and a 320px bottom-navigation overflow; each was corrected and added to regression coverage.
- Supabase security and performance advisors were rerun. No new warning was introduced by the handoff repair; existing informational RLS-without-policy and broader index/policy optimization notices remain backlog work.
