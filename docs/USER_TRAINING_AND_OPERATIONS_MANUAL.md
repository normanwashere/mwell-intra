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
