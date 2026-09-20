# User Training And Operations Manual

September 20 UAT update: the deployed experience improves open-work visibility, request search, Warehouse navigation, alerts, desktop order density and mobile actions without removing approval or stock-control steps. Completed learning can be collapsed; outstanding requirements still apply. For batch Quality inspection, select compatible records, inspect every item, review all serials and quantities, and attach your own photos. A rejected batch saves none of its results. If confirmation is lost, reopen the unconfirmed inspection and retry the same details instead of creating another attempt.

The event workflow adds individually assigned sellers after release setup. Each seller records their own acknowledged stock; corrections retain the original record through a reversal. Returned watches pass Quality inspection and use a Product-approved recovery recipe. These controls do not automatically retire products, extend event access or enable old events. Follow the detailed [September 20 release guide](releases/2026-09-20-EXPERIENCE-REMEDIATION-CANDIDATE.md) for deployed status and outstanding live checks. The synthetic seller account exists but is not a completed real-user pilot. SMTP is unchanged.

## Event Seller Practice

The September 20 synthetic seller's orientation and six practice decisions were completed through live UAT, with saved checkpoint and certificate readback and completion retained on reload. Repeat the drill with real participants using their own accounts; this automated evidence does not count as their acceptance. An event owner must separately assign the seller before operational testing.

## Warehouse Access Recovery Drill

With an authorized test account, open an unsaved warehouse form and switch browser tabs. A successful background access check should leave the form in place. Do not save during this navigation exercise.

Distinguish three states: **Checking warehouse access** pauses warehouse actions while verification runs; **Could not verify warehouse access** means verification failed; **No warehouse access** means a completed check did not grant access. For the retryable error, check the connection and choose **Retry access**. Retry checks permissions only: it does not save, approve or repeat a transaction. Contact the administrator if a completed check unexpectedly denies access. Do not assume unsaved fields survive a failed check, sign-out or reload.

Use controlled read-failure injection only in the automated UAT drill; do not ask testers to revoke roles or repeatedly submit stock commands. Confirm recovery on both desktop and mobile and inspect the recorded outcome before retrying any uncertain business action. Local test results and a prepared drill are not participant acceptance or live certification.

## September 13 Return And Quality Display Drill

Follow the training assigned to you in Onboarding. A new permission does not mean you have completed training for it. If the task's required training is missing or unclear, ask your administrator to check your published assignment rather than repeating unrelated practice. The September 14 training-version correction does not reset your progress or mark new exercises complete.

Verify page access and export authority separately in the drill. A warehouse dashboard viewer need not be an analytics or Finance viewer. Data & Reports and Inventory Reports keep their own page-access checks, while export preparation requires its separate effective permission. Do not ask a tester to obtain wider reporting access just to use their permitted dashboard export.

In the role drill, distinguish viewing information from carrying out a command. Export preparation and replenishment actions follow current command permissions. Operations recommends; Procurement decides and hands off. Also check that a permission change prevents a command from an already-open dialog.

For the replenishment drill, Operations opens an Inventory item, chooses **Recommend replenishment**, checks available inventory and minimum stock, and enters the quantity, rationale and planning assumption in days. The initial 14 days is not a supplier forecast. Saving a recommendation does not change stock or issue a PO. Procurement accepts the recommendation and hands it off to a linked draft request through its existing controls. Accepted or handed-off recommendations cannot be edited from Inventory. If a save is uncertain, reopen and verify the status before retrying. Cancel only closes the form.

**Replenishment completion drill:** With both Procurement management and request-creation permission, select **Complete Procurement request** after acceptance. Keep the accepted item, quantity and reason unchanged. Choose the classification and enter the estimate, department, cost center, funding and applicable solicitation details; attach specification and budget evidence. Select **Create draft & complete handoff**, verify the linked draft, then demonstrate **Confirm procurement route** separately. Stop before submission or approval unless that later stage is explicitly part of the exercise. If the initial check fails, use **Back to recommendation** when offered. If saving stops, reopen Warehouse replenishment planning and check the saved linkage; uploaded evidence may be retained for reconciliation. Do not recreate an older malformed linked draft. Record desktop and mobile results separately; an automated rehearsal does not count as a real participant's acceptance.

**Check your assigned role before the drill:** Operations alone raises demand and customer return cases, recommends replenishment, and prepares governed exports. Receiving, inspection, picking, packing and stock movement need the separate warehouse execution role. An Operations Associate may hold both roles; the job title by itself is not the permission. Business Unit users request stock and acknowledge eligible handovers, but do not reserve or allocate it. Pricing users review rather than change prices. Finance reviews warehouse exports; Procurement Officer/Admin handle replenishment decisions and governed PO cancellation. Required training, evidence and independent approvals still apply.

In the receiving drill, use different receiver and inspector accounts. The accepted procurement receipt inspection releases the provisional hold atomically; verify its result and eligible balance before putaway. Do not add a second approval. A later continuing-hold release needs a permitted reviewer other than the hold creator. Operations/Procurement-only participants coordinate rather than execute custody commands. Repeat with combined-role accounts to confirm that extra roles do not waive the existing actor checks. Return-source rules must be checked separately, not inferred from this receipt drill.

Include a long-form navigation check: move to the lower replacement-delivery fields, then back to the first field. The title, Close control and footer should stay in place while the body scrolls. Selecting new delivery details still requires the existing address fields before Save becomes available. Close the drill without saving unless a transaction exercise is intended.

Repeat that check with an app update notice pending. Warehouse install/update notices must stay behind the form, with no blocked fields or footer buttons. Finish or deliberately close the form before Reload, and never reload while a submission is pending. Dismissal of a notice must not submit or cancel a transaction.

Use a designated synthetic customer case. Open **Resolve return case** and explain the difference between customer-case progress and physical intake. A verified intake link is not Quality clearance. Check the linked return and the current inspection/hold records before making a permitted decision; do not create a duplicate intake when the summary cannot verify a link.

In **Quality Control**, select **Holds**, search for the test product, then clear the search. The count must follow that tab and filter, for example **1 of 3**. Repeat on **Completed**. Reading, filtering and closing without saving must leave case state and stock unchanged. Existing evidence, quarantine and independent-review requirements still apply.

This drill accompanies the display candidate. Local tests and simulated browser captures are not real-user acceptance or a replacement for the release's live verification record. Older dated results below remain tied to their stated builds.

## September 13 Warehouse Receipt Follow-up

**Release status:** The latest layout and KB update is live on UAT in build `63a52fc`. Six new post-deployment checks passed across Marketing, Operations and Admin at 1440px and 390px. Fresh desktop and mobile ecommerce journeys then completed all 32 recorded checkpoints without interruption. Both reached delivered/completed with private proof images and exactly one stock deduction. Live screenshots confirm that packing guidance is unobstructed and wrong-bin errors remain visible. Other warehouse branches and the real-user pilot remain open.

The requester evidence-upload correction is applied to UAT. For an issued department request, use **Acknowledge receipt**, enter the acceptance reference and attach the actual recipient evidence. This does not give the requester warehouse execution access. The person who released the stock still cannot confirm its receipt, and shipment orders still use delivery tracking.

The released layout keeps allocation, start-picking and packing confirmation on the order row, or below the filters when that order leaves the selected queue. Request review closes temporarily while receipt capture is open; Cancel returns to the request. Expand **Order reference** to read or copy the complete reference. In the pick form, expand **Quality checkpoint** for the condition reminder; required checks are unchanged. New validation errors scroll into view without clearing scanned values. A different operator must still release packed stock.

The automated department journey completed 30 live checks on the recorded pre-layout UAT build. Its three synthetic batches were separately cleaned and verified; this is not evidence of a complete warehouse pilot or every ecommerce/return branch. SMTP is outside this WMS signoff.

## September 12 Interface Training

**Vendor practice:** Use an accepted vendor account with completed assigned training, without adding an internal department role. Review an awarded PO, enter a reference, acknowledge the displayed revision, and refresh to check the saved result. Confirm that an empty reference, an unread document, or changed document cannot be acknowledged. Invitation-form completion is not application submission or Legal handoff; record those as separate training steps.

**Invitation delivery:** Show the difference between a saved accreditation case, pending email, failed email, and confirmed sending. For a sending-limit message, contact the administrator before retrying the existing invitation; do not create another case. Once delivery is resolved, test the current invitation link and vendor acceptance. A CI account's synthetic accepted-invitation prerequisite does not prove this journey.

**Multi-role and updated assignments:** Demonstrate an older completed assignment beside pending training, including two assignments of the same version. Start or Resume the pending item and verify the correct attempt opens. Retrying an assessment must keep that selected assignment. Older completion evidence remains unchanged.

**Training-version and receiving retest:** Use a newly assigned learner to check that practice ends after the assigned checkpoints, then reload to verify completion. Older two-checkpoint Operations Lead training must not show two additional unpublished steps. For short, excess, damaged and unidentified deliveries, enter the actual delivery date and check receipt history; the receipt still waits for independent review. Do not invent dates for older receipts or repeat receipt posting to repair their history.

On a narrow screen, mixed evidence attachments appear in two columns. Confirm the website address before opening an external link. Photo preview and Close/Escape behavior are unchanged.

**External evidence:** Demonstrate an uploaded photo and a saved website link. Photos use the preview; **External evidence** opens the original website in a new tab without downloading it during queue loading. An external link is not proof that a photo was uploaded or verified. Report an incorrect link with the receipt reference; do not repeat the stock transaction.

**Task queue recovery:** Demonstrate a failed Tasks read and **Retry task queue**. A background provider update must not replace an error with **No due tasks**. Task labels no longer download photo payloads; open the linked Quality source when evidence review is required.

**Inspection photos:** The complete Quality queue loads first. Completed-inspection photos load when visible; click the thumbnail to see the original evidence. Use **Retry photos** for a failed image read. Do not submit another inspection or upload a duplicate to get past a loading error. Queue retry and photo retry are separate, read-only recovery actions.

**Loading follow-up:** Quality Control fetches its complete queues after warehouse startup, avoiding a discarded early download. Existing inspection, hold, evidence and independent-review steps stay the same. A loading failure must show **Retry quality queue**, not an empty-work confirmation. Permission checks are faster but still use current roles and required training. **PERF-SEP12** records are clearly tagged UAT volume fixtures, not real orders to dispatch or a substitute for operational training scenarios.

**Authorization follow-up:** Demonstrate that return resolution requires current role authority and any required training, including repeat submissions on completed returns. A denied attempt is not a reason to recreate the case. Quarantine, evidence and delivery checks still apply. Requesters can see names on their own stock requests; reviewing names on other requests requires current issuing or request-approval authority. Check training and assignment before escalating a missing name.

The final visual pass also corrects outlined dialog-action text in dark mode, including View original order. Contrast is checked against the rendered button background; destinations and actions are unchanged.

For mobile Pick & Pack, demonstrate the Status selector and Search orders; do not ask learners to find the desktop counter strip. Security dependency updates leave these operating steps unchanged.

Rehearse the same business workflow with the updated workspace hierarchy: identify the page, its section heading, current status, responsible role and next action. The visual changes do not create new permissions or change approval order.

Desktop users can hide/show navigation from the header; the browser remembers the choice. The sidebar remains reachable while scrolling. My Work uses compact desktop rows and mobile stacked records. Open a supported order dialog and locate its grouped information, scrollable body, close control and separate footer. Copy a record reference and link, then return to its list and confirm context is retained. A copied link never bypasses recipient access checks.

Explain the limits: unsaved warnings cover browser exit/Cancel on procurement requests and failed local draft persistence on order intake, not every SPA navigation. Save before leaving other forms. Automated layout checks are not evidence that a tester has completed a business transaction.

## Marketing Request Receipt (Live UAT, September 11)

After Warehouse releases your items, open **Fulfillment > Department requests**. Find your issued request and select **Acknowledge receipt**, either on the request itself or inside **View request**. Check the linked order and recipient, enter the acceptance reference, attach recipient acceptance evidence, and select **Confirm receipt**. The request then shows **Receipt acknowledged** with the saved reference; the action is no longer offered. You do not need to switch to Orders and events.

Only acknowledge items actually received. Warehouse release and recipient acceptance remain separate steps. The releasing operator cannot acknowledge their own release, even if they also hold the Marketing role. Unreleased orders cannot be acknowledged; courier shipments use delivery proof instead. If the linked order is missing, refresh and ask the warehouse lead to check it. Closing the form without confirmation does not record receipt.

This entry point is live in UAT release `e411a7e`. Desktop and mobile checks opened the acknowledgment form and confirmed its required inputs; no receipt was submitted during the deployment smoke test.

## Order Context And Alerts (Live UAT, September 11)

These presentation changes are deployed to UAT in release `e411a7e`. The receiving, approval, pick/pack, return and release sequences remain unchanged.

- **Conflicts:** Select **View details** in the warehouse banner. Each saved change shows its action, reason, affected product and available warehouse, bin, quantity, serial or line references. Check the record history with the warehouse lead before retrying. **Discard queued copy** removes only the device copy; it does not reverse stock already saved on the server.
- **Return cases:** Check **Original order** in the case list and resolution form, alongside the case number, item, serial and reported issue. An unavailable reference is stated explicitly, not guessed. Confirm the destination as before; quarantine, independent decisions and Finance checks still apply.
- **Order details:** Internal department requests show the recorded request date, requester name when available, department, purpose, cost center and required date. Payment is not applicable to an internal request. Order lines show picked quantities and expandable serials; order instructions, recorded activity and handover references remain together. Customer shipments retain their delivery timeline and authorized commercial details. Missing saved information is not fabricated.
- **Notifications:** The main bell has All/Unread filters and Unread first/Newest first sorting. Its count covers only the latest 10 accessible notifications. Opening it does not mark anything read. Use **Mark read** explicitly. If confirmation fails, refresh to check before retrying. Warehouse **Module alerts** are separate current stock/reservation alerts, sorted by urgency, with links only where your role permits access; their count is not an unread count.

Desktop order counters occupy a single row. Detail panels use the available desktop width and stack on smaller screens. Changing filters or closing a detail panel does not save a transaction.

**Error-recovery practice, live UAT:** Read what happened, check whether the result is confirmed, then follow the named next step. If a PO receipt already awaits a decision, ask an independent Warehouse Supervisor to review the existing PO under Receive and inspect > Controlled receipt decisions. Do not receive the same units again. If a unit is waiting for inspection, ask an authorized person other than the receiver to inspect it under Quality Control > Pending. Other holds need the warehouse supervisor's review. A failed connection may hide a completed action: check history before submitting again. Report the record number, account, time and screenshot, never passwords or private links. The new wording was deployed September 11.

## September 9 Feedback: Receiving And Return Clarifications

These refinements are deployed to UAT in revision `044ee26` on September 10, with both required database updates. Live checks covered Operations Associate access, receiving validation and desktop/mobile receiving layout, returns guidance and the Pick & Pack queue. Full transaction retesting remains separate.

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

Receiving practice records its saved-draft checkpoint when the learner reaches receipt review after entering the delivery, traceability, destination, evidence and condition. Pausing is optional. The learner must still submit the simulated receipt and receive confirmed completion. If the result is uncertain, refresh onboarding status before retrying; never create a live receipt to complete the exercise. Emergency-access eligibility is only permission to request approval, not an active access grant.

After receiving practice confirms completion, select **Finish review** to return to the onboarding checklist. The completed coach no longer offers **Resume later**; its banner's Exit also returns to the checklist. Finish is unavailable while completion is saving or has failed. It ends practice without erasing learning evidence, replaying a receipt or granting access. Unfinished Pause/Exit and other guided practices keep their existing controls.

While the checklist opens, **Returning to your onboarding checklist** keeps the old receiving page inactive. Use **Return to onboarding** if navigation stalls; do not submit again. An empty certification list is not a reason to repeat completed learning: some requirements do not issue certificates. Use the required-step progress to identify what remains assigned.

For a blind-count drill, record observed quantities and serials without using expected balances. Before successful submission, no variance amount, balanced status, shortage count or variance-only filter should reveal the expected result. Required evidence and unexpected-serial checks still apply. An interrupted submission must keep the sheet blind; confirm the saved result before treating the count as complete. Normal-mode comparisons and approval requirements are unchanged.

The onboarding task chooser starts closed. Your progress and next required action come first; use the compact Start, Resume or Try again button beside its title. Expand Choose a task or Change task to browse and search the full eligible list using the page scroll. Shared tasks show an expandable Available to role count instead of a long audience paragraph. The return-to-work link remains available, but does not bypass prerequisites, permissions or certification requirements.

For sourcing, reopen the original request after creating its plan. Its saved evaluation evidence should remain readable without requiring variance-review authority. Only the authorized independent reviewer can approve a variance. An unavailable variance history is not proof of no decisions. Retry a failed sourcing read; do not create another request or approve outside the workflow.

Check that the sourcing deadline editor matches the saved summary in your device's local time. Reopening and saving an unchanged deadline must keep the original deadline. Stop and report a mismatch before issuing the package; do not compensate by manually shifting the time.

For the stage-guidance correction prepared after `05b2326`, reopen the same sourcing record and compare the advice with its saved status. A draft with zero invitations should explain plan preparation and accredited invitations before governed issue, never suggest closing a response window that has not opened. Issued, response-closed, evaluation and failed-bid states have their own guidance; awarded and cancelled states describe retained history. Loading or denied reads must not invent a next step. Verify the existing disabled controls and independent-review boundaries separately; the copy is not permission or completion evidence, and its live retest remains pending.

Check current version-2 assignment and certificate labels against the learner's actual Procurement Admin, Procurement Finance or Vendor Portal scope. Labels do not change progress, activate access or prove payment release; unknown curricula and versions remain unidentified. Vendor onboarding waits for the session to resolve before deciding whether the account belongs in that workspace. A loading capture is not evidence of completed onboarding.

For vendor documents, use an original JPEG, PNG, WebP or PDF of at most 10 MB. A failed upload leaves a visible message and retains the selected file. When the outcome is uncertain, check the case document list before retrying. Verify document registration, then application submission, then the separate Legal handoff; these are distinct steps.

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
