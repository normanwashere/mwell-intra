# User Training And Operations Manual

## September 9 Feedback: Receiving And Return Clarifications

These instructions describe the controls reviewed on September 10. Related UI refinements are local candidates until verified on a matching UAT deployment.

1. **Exception, not exemption:** In governed PO receiving, record an Exception reason when quantities include damaged, short, excess or unidentified items. For example: "Expected 100 jackets; received 95 clean and 5 damaged. Delivery photos attached." A clean receipt does not need an exception reason. Do not enter a made-up reason simply to continue.
2. **Merchandise barcode:** Use the barcode mapped to the exact merchandise product and size, then enter quantity for non-serialized stock. A barcode on a different jacket variant is not interchangeable. If the label is rejected, give the Warehouse lead the PO, line, scanned value and label photo so the product mapping can be checked. Do not create replacement product records or invent serials.
3. **Received is not accepted:** General area is a location, not a quality decision. Open the receipt's inspection in Quality Control. The authorized Quality owner records evidence and disposition. Once the relevant hold is resolved through that flow, complete putaway or ordinary relocation. Never transfer held stock to bypass the quality control.
4. **Unknown movement outcome:** Keep the exact scanned units and check current movement history before retrying. A network failure is not proof that a move failed. Do not delete pending work merely to clear a conflict counter.
5. **Recipient acknowledgment:** Dispatch is the Warehouse handoff. Acknowledgment confirms acceptance by the receiving party. The releasing operator cannot acknowledge their own release. The authorized recipient/requester should open the linked request/order under their own account and record the reference and permitted acceptance evidence. If their action is unavailable, escalate the order ID and role to the lead; do not share accounts.
6. **Return source:** Use Allocation Return from the issued allocation for a linked event-stock return. Returns receiving records physical intake to inspection staging. Do not enter the same physical return twice. Customer replacement/refund decisions remain in the customer return case in Fulfillment.
7. **Return serial:** Scan the existing serial on the returned unit or find it in the original issued order/allocation history. Do not generate a new serial. "Already scanned" means that serial is already included in this draft; check the list rather than scanning it again.
8. **Replacement delivery:** Confirm the original order, customer and destination before preparing a replacement. Missing customer or address data must be corrected through the permitted order workflow, not guessed. A new destination requires an explicit recorded change; the original order history must remain intact.


**Task-first candidate (September 6; not yet a live acceptance claim):** Use the shared **What are you working on?** entry on Home, Knowledge Base and onboarding. **Prepare for task** selects task-specific learning; **View guide** opens instructions; **All task guides** keeps the full library available. Read **Needed for this task**, with **Other required learning** and **Optional guidance** separately available. These groups prioritize existing requirements without waiving mandatory policy, authority, evidence or certification checks. Unavailable readiness is not readiness.

The **New to Intra?** Knowledge Base strip is an optional introduction, not a four-step local completion process. Its navigation and reading preferences never issue learning credit. Use contextual task help without submitting the operational form; close it to return, or open the full guide. Read prerequisites, the actual decision/owner path, control steps and screenshots, then expected result, next owner and recovery. Missing evidence remains unverified. Required learning may open separately; return and refresh access before retrying the exact action. Candidate captures and pilot outcomes must be verified on the eventual release rather than inferred from this manual.

## Reading PO Counts and Closure

**Received** is the physical count from the matching normalized PO line. **Unknown** means that count could not be read; refresh or escalate without assuming zero, full receipt or a payment entitlement. **Not yet QC accepted (outstanding)** is separate: delivered stock can still await inspection. A known receipt with no Quality acceptance shows **Awaiting QC acceptance**.

PO **Closed** is not proof of acceptance, payment or governed file closure. **Package closed** requires confirmed governed closure; **PO closed; lifecycle review required** retains unresolved evidence and recovery requirements. Review current control gaps and the separate acceptance/Finance records. Never alter source quantities, add an outstanding line, reopen a PO or broaden permissions merely to remove a status warning. This clarity correction is a candidate until verified on its matching deployment.

## September 5 Candidate Training Delta

Use these scenarios with the matching UAT release only. September 5 changes through `7dd30cb` are deployed and targeted read-only checks have passed; full transaction certification remains pending. The subsequent enlarged-title and outcome-layout correction requires its own deployed check. Live navigation is not transaction certification.

1. Search a large Quality queue by serial or receipt, expand the matching group, and verify exactly one intended inspection opens from its task. Repeat with a completed and an unavailable source.
2. Open a governed PO receipt on desktop and mobile. Expand item lines, select a missing requirement in the footer, and verify focus reaches its field. Saving progress must not receive stock; confirmation remains blocked until the selected lines and evidence reconcile.
3. Review a stock adjustment against its product, warehouse/bin, expected/counted quantities, requester and evidence. A missing source count must block approval. The requester must not decide their own change.
4. Interrupt a supported queued stock action. Confirm that queued status is not success, the draft remains recoverable, and replay does not duplicate the movement. Escalate legacy queue records that lack a verifiable owner or intent key.
5. Simulate a queue loading error. The page must offer retry and must not say there is no work. Retest the same record after recovery.
6. As Operations Lead, open an authorized Procurement PO. Confirm acceptance information remains usable and restricted payment documents are not requested. As an authorized Procurement or Finance reader, inspect the same document area and verify valid evidence opens; a real server denial must remain visible. Never grant Finance access as a workaround for a page error.
7. In the putaway dialog, verify the selected product and serial against the physical item before scanning its destination. The redundant task description has been removed; the actual stock identity and quantity remain visible.
8. Retry a failed Finance source while another source is valid. Its figures, selected tab and filters must remain usable. Switching accounts or losing a capability must not retain the previous authorized view, even if an old request completes late.
9. Review a vendor case with three missing documents and one unsigned agreement. Both the list and sticky case summary must call the total four requirements, then one requirement when only the agreement remains. Recording a manual reminder does not send an email.
10. Expand a Quality receipt group before selecting Inspect. Verify repeated product lines and serialized identities against their source. Conflicting inspection records must show a retryable error and block decisions. A stalled control read must also stop loading and offer **Retry quality queue**; all required records must load before decisions resume. A late response from a failed or replaced attempt must not replace the current queue. Product **Link to this record** controls provide a record permalink, not an additional decision-history view.
11. Enlarge text to 200% on a narrow screen. Event custody and outcome labels may stack, and the shared header may wrap. Page titles must not collide with their icons. Branding, help, notifications and the account control must remain reachable without horizontal panning; do not shrink the text to hide a layout defect.
    Open the account menu with long role information. Scroll its contents to the lower actions without scrolling the page sideways; verify Escape and outside dismissal. Do not activate Sign out during a read-only evidence capture.
    Repeat the bounds check for notifications, including the empty explanation and a populated row with its action. An empty popup does not prove that populated notification actions work.
    Change the verified account or its notification access scope while Home remains open. The old list must disappear before the new account's list loads, including when the new load fails. Ordinary same-account refreshes must not be treated as account changes.
12. In local training, receive the same SKU on two different procurement lines in one bin. Inspect only line A, then reload the queue: A must stay completed and B must retain its own pending quantity. An unknown line or a quantity exceeding that line must be rejected.
13. From Blocked or Completed tasks, open a source and choose Back to tasks. The same status must remain selected, including after refreshing the queue URL. Source links in My Work must announce the task title, not just an indistinguishable Open source action.
14. Select a specific receipt requirement: a serial mismatch must focus its serial textarea, a quantity error the relevant quantity input, and an unmapped product the product selector. If nothing is selected on a partially received PO, the selection link must focus an outstanding line, not a completed disabled line.
15. In Pick & Pack, select **Floor work** and confirm the actionable floor queue appears. Open a pending department or event request with **View request**, review the actual lines in **Review request**, and approve as an authorized independent reviewer. Reopen the source to verify its status before handing it to Operations. Verify that the requester cannot approve their own demand.
16. Upload a real supporting file for excess custody and wait for attachment completion. Missing or failed uploads must not be treated as evidence. Receive a governed item with one operator, then accept its exact receipt line and identity with a separate authorized inspector. Verify pending custody stays unavailable before acceptance, and that direct provisional-hold release by the receiving operator is rejected.
17. Open DOA settings on desktop and mobile. Wait for the workspace to load and **Save draft** to enable before testing validation. Confirm policy inputs remain reachable after loading and department actions stack below their details on narrow screens. Do not treat an attempted click on a disabled loading control as a completed validation test.
18. Prepare payment with a real invoice number and registered supporting documents. With goods acceptance missing, confirm the acceptance-specific block; then complete acceptance through its authorized owner before retrying. A document-validation rejection alone does not prove that the goods-acceptance control works. These September 6 follow-up scenarios require live certification against the deployed commit; local passes are not a substitute.

**Reviewed:** August 23, 2026

**Current UAT behavior reference:** `32170e425e125c63597ea8e05c6287a7cd256f5b`

## Training Format

The action-scoped onboarding candidate uses one checklist model for employees, vendors, and multi-role users. Start with the authorized workspace, not a mandatory tour of every assigned module. Practice the relevant task and complete its required policy and competency evidence before performing a governed action. A new or unfinished role requirement does not redirect unrelated authorized work. Vendor scope remains separate from internal scope; access-sensitive pages can still require a capability that has not yet been certified.

When an action shows required learning, use **Resume onboarding** to open the assigned requirement in a separate tab. Leave the original form open, complete the learning, return, and select **Refresh access**. Recheck the current record before submitting. Training completion does not change the user's role, approval limit, evidence obligations, or segregation-of-duties rules.

Include an account with several scoped roles in onboarding rehearsal. Read each certification's module and role alongside its capability, status and validity. Similar names must remain separate when their authority differs. Historical curriculum context may be unavailable; escalate it rather than treating the label as an access change. A screenshot with all requirements already completed proves the completed view only, not a fresh orientation or assessment attempt.

For vendors, the candidate evidence-responsibility review is training only. It must never be presented as a signature, legal acknowledgment, document upload, application submission, or accreditation decision. The new local exercise requires a reviewed versioned curriculum publication before trainers can claim it is available in live UAT.

Rehearse full delivery with zero outstanding quantity, independent acceptance, real invoice/document registration, and Finance preparation on the resulting Closed PO. Do not add an artificial balance line to keep its status Issued. Reject draft/cancelled POs, wrong-owner evidence and missing acceptance. Separately receive a lowercase serial and independently inspect the same canonical identity. Verify completed raw QC leaves the exact unit `in_stock`, not stranded in `pending_inspection`, without a duplicate inspection. Active holds still enforce availability, including for non-accepted QC; governed hold release does not change the unit status. Do not allocate or pick held stock merely because it is `in_stock`. Repeat with a different serial and a case-only duplicate as rejection paths. On mobile, the procurement route explanation must provide a full-height touch target.

### August 27 WMS Practice

Train two operators using separate accounts on different items of one issued PO. Save an incomplete serial list, close and reopen the PO, and verify the draft resumes without changing inventory. Submit one selected line and verify pending inspection while the other line stays receivable. Test duplicate scans and an HTTP evidence link as rejection paths; use delivery-note upload for the successful path.

Marketing then reserves several event products with Selling and Giveaway purposes. Both reservation entry points use one atomic batch; a confirmed rejection saves no lines. The issuer remains separately authorized. If a response is uncertain, the form locks the submitted payload: use **Recover reservation** to retrieve the original result, including after reopening in the same browser. Do not create replacement reservations in another browser. In Returns receiving, add several items and confirm quarantine-first intake in one batch; an invalid line blocks the entire batch. Use **Recover original result** after an uncertain return response. Correct fields only after a confirmed rejection. Supervisors use View request to inspect actual demand and test a backorder with one fulfill-now line set to zero, without creating an empty overall split.

During rehearsal, start an evidence upload and switch records, remove an earlier attachment while another file uploads, and simulate a failed upload. No evidence should cross records or reappear after removal. Wait for pending uploads before committing. Test resume/discard of editable Returns and order-intake drafts, and verify that a pending transaction can be recovered but not edited into a different command. Browser-local drafts are operator-specific, not cross-device backups or shared work assignments.

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

For the Procurement drill, learners select anywhere on the named category tile through its full-surface radio control and separately choose **Goods / materials** or **Services**. Verify pointer, touch, and keyboard focus behavior. On **Codes & justification**, wait for the controlled Department list to finish loading, choose the named department, and then choose its Cost Center. Desktop and mobile must retain these as selects while loading; a directory failure displays a blocking recovery message and must never turn either controlled value into free text. Goods PO lines must carry unit prices so receipt and QC quantities produce a server-derived accepted value for Finance matching. A missing active department DOA, unknown or inactive department identity, unpriced PO line, or incomplete acceptance evidence must stop the handoff instead of being bypassed. Department labels may vary in presentation, but every saved request, matrix, and assignment resolves to the same stable directory code.

For the DOA administration drill, Platform Admin or Legal selects a department from the active directory, confirms its stable code, saves a new draft revision with named approvers, and hands activation to a different authorized checker. Submit the blank form on desktop and mobile and confirm Intra focuses and scrolls to the first invalid field with an inline correction; repeat for Department, Version, and missing named approvers. Attempt a free-text or inactive department and confirm it is rejected. Reopen the active matrix and verify that assignments carry the same department code as their parent matrix. A governed save failure is not complete work: retain the displayed reference, verify the matrix was not created, and escalate rather than retrying a different department. UAT temporary matrices deliberately expose all five supported tiers for end-to-end testing; record the approved production owners and amount/category bands through a governed revision before launch.

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
- Treat vendor email delivery as a controlled canary: routine regression verifies invitation persistence and lifecycle controls, while an explicit desktop canary verifies the external send. Do not repeatedly resend after a rate-limit response.
- At shift change, reconcile receiving staging, quality holds, unassigned-bin stock, open count approvals, P1 exceptions, failed imports and queued/offline commands. Do not hand over an unexplained balance variance.
