# User Training And Operations Manual

**Reviewed:** August 21, 2026

**Current UAT reference:** `f88c9916c253546ae6960bd19ffd608b99fdd791`

## Training Format

Use a role-specific test account and realistic test data. Each learner completes one happy path, one correction path, one unauthorized action check, and a recovery from refresh/offline interruption. Trainers record attendance, role, environment, scenario IDs, result, and follow-up owner.

## Common Controls

- Verify the environment and signed-in identity before changing data.
- Use notifications for work assigned to the role; do not share accounts.
- A success message is not final evidence: reopen the record and confirm its status/history.
- Upload only approved business documents. Never place credentials, health data, or unrelated personal data in free-text fields.
- Report blank pages with time, route, role, and displayed reference. Do not send passwords or full document contents.

## Role Modules

| Audience                 | Must demonstrate                                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vendors                  | Invitation/password setup, case scope, document quality, replacement/versioning, instrument signature, submission and correction                               |
| Legal                    | Invite delivery state, checklist review, rejection note, approval signature, expiry/renewal, summary export and evidence handling                              |
| Requesters               | Request classification, line totals, justification, attachments, draft/save/submit, returned-request correction                                                |
| Procurement              | Approval ladder, sourcing/award evidence, PO creation, exception handling and segregation of duties                                                            |
| Warehouse receiving      | PO/DR references, location/bin selection, barcode/manual entry, serialized versus bulk receipt, inspection evidence and duplicate prevention                   |
| Operations/marketing     | Ecommerce import, bundle set IDs, rack/bin scan, serialized pick and pack, event creation, reservation, issue, return, cancellation and available-stock checks |
| Customer Service/returns | Camera or manual serial lookup, original-release confirmation, unmatched-serial quarantine, replacement/refund handoff and closure evidence                    |
| Finance/BI/pricing       | Reconciliation, count variance, governed export evidence, review/correction, valuation and pricing controls                                                    |
| Administrators           | Least-privilege role assignment, deprovisioning, test-account handling, audit review and escalation                                                            |

## Warehouse W1 Role Drills

- Logistics Supervisor: receive against an approved PO, inspect/hold/release, scan exact-unit putaway, create a bin, transfer stock, resolve an exception and approve another operator's variance.
- Operations and Marketing: create an event, reserve stock, scan the exact serialized issue, reject a wrong-product serial, record the issued-unit return and route it to inspection.
- Finance: run quantity and serialized presence counts, identify missing/unexpected units, approve or reject a stock change created by another user, and reconcile the resulting movement.
- BI Analyst: filter reports and export governed inventory position without seeing mutation controls.
- Business Unit: reserve valid stock and recognize over-allocation and access-denied states.
- Procurement and Pricing: review reorder/PO/supplier or landed-cost/pricing views without warehouse-floor mutation access.
- Warehouse Administrator: execute the complete route checklist while demonstrating that broad Core Platform Admin access alone does not grant Warehouse access.

## Ecommerce Fulfillment Drill

1. Import a valid order with the current CSV template and reject an invalid channel, payment value, or malformed line.
2. Confirm Product-assigned selling price is visible and cannot be edited by Warehouse.
3. Compare two standalone units with a two-set bundle; verify only the bundle creates per-set identifiers.
4. Scan the required rack or bin, then scan every serialized unit. Reject the wrong location, duplicate serial, wrong product, and already-released unit.
5. Record packaging supplies, waybill, courier, dispatch details, generated handover reference, and uploaded proof.
6. Reopen the order and verify status, picked serials, commercial fields, and audit history from Supabase-backed state.
7. Export the current view and reconcile order, customer, address, payment, product, dispatch, handover, and audit columns.

## Returns Drill

1. Scan a released serial with the camera and verify Intra selects its original order and release.
2. Enter the same serial manually and confirm duplicate processing is prevented.
3. Scan an unknown serial and confirm the app keeps it unmatched and requires controlled investigation.
4. Record inspection, quarantine, replacement or refund handoff, supplier action, Finance evidence, and customer closure as applicable.

For scan work, teach camera denial recovery, manual entry, duplicate-read feedback, source location/bin confirmation, serial lifecycle messages and cancellation. A green toast is not proof; reopen or refresh and verify the unit, bin, event and movement history.

## Support Routing

| Problem                                    | First response                                                       | Escalation                        |
| ------------------------------------------ | -------------------------------------------------------------------- | --------------------------------- |
| Cannot sign in                             | Confirm email, environment and password-reset delivery               | Identity/platform owner           |
| Access denied                              | Confirm assigned module role; do not add broad roles as a workaround | Module owner/admin                |
| Save failed or stale status                | Preserve record ID, refresh once, check activity history             | Engineering/on-call               |
| Suspected duplicate or incorrect inventory | Stop downstream issue/transfer and quarantine affected record IDs    | Warehouse supervisor and Finance  |
| Wrong approval path                        | Stop processing; do not bypass with admin                            | Procurement owner and Engineering |
| Possible data exposure                     | Stop, preserve evidence, notify Security/Privacy immediately         | Incident commander                |

## Daily Operations

- Review failed invitations, pending approvals, stale vendor cases, low stock, unresolved count variances, unmatched return serials, failed imports, and failed exports.
- Verify `/api/health` reports Supabase reachable, assets reachable, live auth configured, invite delivery configured, and service worker configured.
- Reconcile high-risk mutations against activity history and resolve conflicts before end of shift.
- At shift change, reconcile receiving staging, quality holds, unassigned-bin stock, open count approvals, P1 exceptions, failed imports and queued/offline commands. Do not hand over an unexplained balance variance.
