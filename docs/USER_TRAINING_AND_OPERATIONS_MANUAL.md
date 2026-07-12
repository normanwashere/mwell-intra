# User Training And Operations Manual

## Training Format

Use a role-specific test account and realistic test data. Each learner completes one happy path, one correction path, one unauthorized action check, and a recovery from refresh/offline interruption. Trainers record attendance, role, environment, scenario IDs, result, and follow-up owner.

## Common Controls

- Verify the environment and signed-in identity before changing data.
- Use notifications for work assigned to the role; do not share accounts.
- A success message is not final evidence: reopen the record and confirm its status/history.
- Upload only approved business documents. Never place credentials, health data, or unrelated personal data in free-text fields.
- Report blank pages with time, route, role, and displayed reference. Do not send passwords or full document contents.

## Role Modules

| Audience | Must demonstrate |
| --- | --- |
| Vendors | Invitation/password setup, case scope, document quality, replacement/versioning, instrument signature, submission and correction |
| Legal | Invite delivery state, checklist review, rejection note, approval signature, expiry/renewal, summary export and evidence handling |
| Requesters | Request classification, line totals, justification, attachments, draft/save/submit, returned-request correction |
| Procurement | Approval ladder, sourcing/award evidence, PO creation, exception handling and segregation of duties |
| Warehouse receiving | Location/bin selection, barcode/manual entry, serialized versus bulk receipt, PO receipt and duplicate prevention |
| Operations/marketing | Event creation, reservation, issue, return, cancellation and available-stock checks |
| Finance/BI/pricing | Reconciliation, count variance, governed export evidence, review/correction, valuation and pricing controls |
| Administrators | Least-privilege role assignment, deprovisioning, test-account handling, audit review and escalation |

## Warehouse W1 Role Drills

- Logistics Supervisor: receive against an approved PO, inspect/hold/release, scan exact-unit putaway, create a bin, transfer stock, resolve an exception and approve another operator's variance.
- Operations and Marketing: create an event, reserve stock, scan the exact serialized issue, reject a wrong-product serial, record the issued-unit return and route it to inspection.
- Finance: run quantity and serialized presence counts, identify missing/unexpected units, approve or reject a stock change created by another user, and reconcile the resulting movement.
- BI Analyst: filter reports and export governed inventory position without seeing mutation controls.
- Business Unit: reserve valid stock and recognize over-allocation and access-denied states.
- Procurement and Pricing: review reorder/PO/supplier or landed-cost/pricing views without warehouse-floor mutation access.
- Warehouse Administrator: execute the complete route checklist while demonstrating that broad Core Platform Admin access alone does not grant Warehouse access.

For scan work, teach camera denial recovery, manual entry, duplicate-read feedback, source location/bin confirmation, serial lifecycle messages and cancellation. A green toast is not proof; reopen or refresh and verify the unit, bin, event and movement history.

## Support Routing

| Problem | First response | Escalation |
| --- | --- | --- |
| Cannot sign in | Confirm email, environment and password-reset delivery | Identity/platform owner |
| Access denied | Confirm assigned module role; do not add broad roles as a workaround | Module owner/admin |
| Save failed or stale status | Preserve record ID, refresh once, check activity history | Engineering/on-call |
| Suspected duplicate or incorrect inventory | Stop downstream issue/transfer and quarantine affected record IDs | Warehouse supervisor and Finance |
| Wrong approval path | Stop processing; do not bypass with admin | Procurement owner and Engineering |
| Possible data exposure | Stop, preserve evidence, notify Security/Privacy immediately | Incident commander |

## Daily Operations

- Review failed invitations, pending approvals, stale vendor cases, low stock, unresolved count variances, and failed exports.
- Verify `/api/health` reports Supabase reachable, assets reachable, live auth configured, invite delivery configured, and service worker configured.
- Reconcile high-risk mutations against activity history and resolve conflicts before end of shift.
- At shift change, reconcile receiving staging, quality holds, unassigned-bin stock, open count approvals, P1 exceptions, failed imports and queued/offline commands. Do not hand over an unexplained balance variance.
