# Warehouse Pilot Run Sheet

**Status: prepared, not executed. No human acceptance has been recorded.**

Use this with the [WMS signoff plan](2026-09-13-WMS-SIGNOFF-PLAN.md). Automated test results are tracked separately in the [live readout](2026-09-13-WMS-LIVE-READOUT.md).

## Before The Session

1. The session lead records the exact UAT URL, application build and database migration version below. Do not use production orders or customer details.
2. Confirm each participant can sign in with their own authorized account. Do not share a packer's account with the releaser; changing the selected role does not make them a different person.
3. The test lead provides a fixture manifest listing the PO/request/order, product, quantity, serial/lot, location and bin for each scenario. Blank or missing fixtures mean **not ready**, not passed. Do not repurpose the retained September 13 automated signoff records.
4. Use clearly marked training stock and synthetic customer information. Agree the opening physical and system quantities before moving anything. Keep real outbound shipping and supplier/customer communications outside the session.
5. Confirm an authorized cleanup owner can reconcile the stock and archive/remove the run's synthetic records and private uploads. Until that access is available, do not start another upload-producing pilot batch.
6. Walk through the expected scenario only after the participant's first attempt. Record whether they finished independently, needed help, or could not finish. A coached success is useful feedback, but must not be recorded as an unassisted success.

| Session details | Complete before testing |
| --- | --- |
| Date and session lead | |
| UAT URL and database project | |
| Application build / deployment | |
| Database migration version | |
| Fixture manifest and opening-stock readback | |
| Cleanup owner and approved method | |
| Supported browsers, desktop and phone models | |
| Scanner models and scan mode | |
| Label printing used operationally? If no, why? | |
| Wi-Fi location and supervised interruption method | |

## People And Handoffs

One person may hold several assignments. Record every effective grant, but never count a role switch as an independent user. For pack/release separation, use different people and accounts. Finance/BI read-only checks can be scheduled separately from the floor session.

| WMS assignment to cover | Participant and account | Department / other roles | Device | Handoff partner |
| --- | --- | --- | --- | --- |
| warehouse_operator | | | | |
| warehouse_supervisor | | | | |
| logistics_supervisor | | | | |
| operations | | | | |
| finance | | | | |
| bi_analyst | | | | |
| business_unit | | | | |
| marketing | | | | |
| procurement | | | | |
| pricing | | | | |
| warehouse_admin | | | | |

## Floor Scenarios

Use separate fixture records for mutually exclusive outcomes. The test lead captures persisted readbacks; the participant should not need database tools. Keep records linked through each journey rather than replacing a difficult step with a different already-completed order.

| ID | Participant task | What must be observed |
| --- | --- | --- |
| P01 | Procurement identifies an issued PO line. Warehouse receives the designated quantity, with the actual test delivery date and receipt evidence. | Correct PO and product; pending inspection is not available to pick; receipt actor and quantities match the physical intake. |
| P02 | Repeat intake with the prepared short, excess and damaged cases. Retry the same saved submission under supervision. | The app explains each exception and who handles it. The repeat does not add stock again. Do not change a quantity just to bypass a warning. |
| P03 | Quality inspects the received stock. Accept one prepared case and quarantine/reject the others. Warehouse puts away only eligible accepted stock. | Exact quantities, serials/lots, source and destination bins match. Held stock stays unavailable. The next responsible person can find their work. |
| P04 | Create the supplied ecommerce order, allocate, scan the bin and products, and complete packing with the specified courier/waybill and evidence. | All order fields needed by the warehouse tracker are present. Wrong bin, unknown barcode and duplicate serial attempts give an understandable correction without losing valid capture. |
| P05 | The packer tries to release P04, then the designated different user releases it. Record delivery using the actual shipment update control and proof of delivery. | Packer release is blocked; authorized independent release deducts stock once. Delivery completes through shipment tracking, not department acknowledgment. A releaser who has tracking authority may record delivery. |
| P06 | Marketing or another authorized department requester submits the prepared stock request. Follow approval, allocation, picking, handover packing and independent release. The eligible requester acknowledges receipt with a photo. | Each user can locate the linked record. Release is not shown as recipient acceptance. The releaser cannot acknowledge their own release. Receipt confirmation closes the request without deducting stock again. |
| P07 | Record the prepared physical customer/event/vendor return into quarantine; Quality applies each supported test outcome on separate records. | Pending return stock is not available. Accepted QC and nonaccepted outcomes produce their expected hold/availability results. This physical intake is not the customer case decision. |
| P08 | Work through prepared customer return cases: replacement, refund, vendor return, re-kit and write-off, with the authorized people and required branch evidence. | Original order and destination are clear. Replacement creates linked demand; finance/RMA evidence is required where applicable. Case decisions do not silently restock goods. |
| P09 | Complete the linked replacement's pick, pack, independent release and shipment delivery; separately close the customer case with its required evidence. | Both replacement delivery and customer closure are evidenced. Do not invent a delivery-before-closure restriction if the application permits independent case closure. |
| P10 | Count the prepared bin, submit a discrepancy, and complete the authorized adjustment/transfer path with the appropriate independent approval. | Physical and recorded quantities agree after resolution; no silent override or unauthorized stock adjustment. |
| P11 | Two authorized users attempt the prepared last-stock allocation under supervision. Repeat the prepared release/receipt/return submission. | No oversell and no duplicate stock movement. The unsuccessful user gets a clear next step and can requery the current state. |
| P12 | Interrupt the test device's network during a designated capture, then reconnect. Reload and resume the same record. | Saved work remains available; uncertain submissions are checked before retry. No duplicate inventory effects. Do not deliberately interrupt another tester's device or session. |
| P13 | Test actual scanner and phone-camera input with valid, damaged, duplicate and unknown labels. If label printing is used, print and rescan the prepared labels. | Correct identity, legibility and usable controls on the real devices. A desktop-typed barcode is not hardware acceptance. |
| P14 | Each remaining role checks its permitted screens and denied actions. A combined-role user repeats separation and cross-department checks. | Record actual grants and observed allowed/denied behavior. Extra roles do not permit self-release or cross-record leakage. No unauthorized mutation or private evidence access. |
| P15 | The session lead compares physical custody, on-hand, reserved, held and available quantities with the movement ledger, reports and exports. Complete approved cleanup. | Every fixture is reconciled; unrelated tester data is unchanged. Retained evidence and any cleanup limits are explicitly listed. |

## Record Each Attempt

Copy this small block for each scenario/device/participant. Leave the result unfilled until the attempt happens; use **passed**, **failed**, **blocked** or **not run**. Never replace a failed attempt with a later successful one. Add a dated retest entry instead.

| Observation | Actual result |
| --- | --- |
| Scenario ID / attempt / date | |
| Participant and effective roles | |
| Device / browser / scanner / network | |
| Build / database version | |
| Exact linked business record IDs | |
| Expected result | |
| What actually happened | |
| Finished independently, with help, or not finished? | |
| Where did the user hesitate, go back, or miss the next action? | |
| Exact error wording and whether the user understood the recovery | |
| Screenshot / recording / private evidence reference | |
| Persisted quantities, statuses and actors verified by test lead | |
| Result / defect severity / owner / next action | |
| Retest reference, if any | |

## Stop And Escalate

Stop that scenario for an unexpected stock change, wrong-user access, duplicate release, lost evidence, or an action against unmarked data. Preserve the record ID and screenshot. Do not release a hold, broaden a role, edit the database or reuse a receipt merely to move the test along.

The session lead checks the persisted state before retrying an uncertain submission. Resume only with an agreed recovery action. SMTP/vendor email is excluded from this warehouse pilot; do not mark email delivery as passed or remove authorization controls to avoid it.

## Acceptance Record

| Required review | Named reviewer, date and evidence |
| --- | --- |
| All WMS role coverage and independent handovers | |
| Physical devices and scanners; printer applicability | |
| Physical stock / system ledger reconciliation | |
| Exception, concurrency and recovery outcomes | |
| User task clarity, training and support ownership | |
| Blocking defects closed with same-candidate retest evidence | |
| Cleanup verified, or remaining records explicitly listed | |
| Release owner's decision and any restrictions | |

**Current decision: pending.** This blank run sheet, an agent review, or an automated browser account is not a human signature or operational acceptance.
