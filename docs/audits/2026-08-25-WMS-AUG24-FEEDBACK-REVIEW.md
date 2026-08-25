# WMS August 24 Feedback Review

Source reviewed: `wms comments (2).pdf`, pages 1-4. The August 20 material on pages 5-18 was also checked because it supplies context for the August 24 scenarios.

## Outcome

The live application already contains the controls requested by the feedback: governed PO receiving, location and serial scanning, vertical receipt detail, visible validation, ecommerce import/export and templates, controlled sales channels and payment methods, automated product selling prices, Maya-derived payment status, address suggestions, bundle set codes, packaging consumption, split backorders, internal request references, event gross-sales reconciliation, delivery tracking, internal acknowledgement, and return-to-replacement lineage.

The principal gap was UAT readiness. The database did not contain the exact suppliers, products, bins, POs, stock, orders, and return states described in the August 24 document. The guarded UAT fixture pack in `scripts/qa/uat-wms-scenario-fixtures.mjs` closes that gap without resetting progressed records.

The fixture transaction was applied to the live UAT Supabase project on August 25, 2026. An independent readback confirmed:

- PO 0001 with 400 units, PO 0002 with 100 units, and PO 0003 with 100 units, all in issued state.
- Seven active bins: A-01-01 through A-01-04, F-01-02, F-04-01, and Q-01-01.
- Nine scenario products and 140 serialized device units.
- Twelve fulfillment orders spanning received, allocated, picking, packing, ready, released, completed, and cancelled states.
- Ecommerce, third-party event, and department-request sources.
- Submitted, decision-required, resolved, and closed return cases with a verified replacement-order link.
- A pending Marketing stock request, a PHP 16,970 Event A reconciliation, and pending/held QC examples.

## Live Blocker Found And Fixed

Role-level verification initially showed that the Operations Associate could see Warehouse inventory and fulfillment orders but no receivable Procurement POs. The PO policy checked the linked request category through a request table whose own RLS correctly hid that row from Warehouse, so the nested proof always evaluated false.

Migration `20260825090000_repair_warehouse_goods_po_handoff_visibility.sql` adds a security-definer predicate that returns only whether a request is categorized as goods. The PO and line policies and the Warehouse handoff view now use that predicate without exposing Procurement request content.

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
| Required putaway locations        | Warehouse and active bins are scanned before putaway                                              | A-01-01 through A-01-04, F-01-02, F-04-01, and Q-01-01                                                                       |
| Eshop order and defective return  | Controlled intake, delivery, serial lookup, quarantine, decision, replacement demand, and closure | Received Eshop order, delivered source order, open return, decision-required return, resolved replacement, and closed refund |
| Shopify OTG bundle                | Bundle mode requires explicit set codes; components remain serial-specific                        | Shopify order with shared bundle set code `OTG-A-001`                                                                        |
| On-ground Event A sale            | Marketing owns the event; third-party location and gross sales feed reconciliation                | Event A location, order, and draft gross-sales reconciliation                                                                |
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
- Warehouse PO bridge, Purchase Orders page, and Receiving page tests: 36 passed.
- Live UAT role/RLS readback: passed for Operations Associate.
- Supabase security and performance advisors were rerun. No new warning was introduced by the handoff repair; existing informational RLS-without-policy and broader index/policy optimization notices remain backlog work.
