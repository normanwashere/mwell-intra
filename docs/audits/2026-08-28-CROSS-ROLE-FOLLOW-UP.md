# August 27 Fixes: Cross-Role Assurance Review

Reviewed: 28 August 2026. Scope: mWell Intra UAT, not production.

## Remediation Tracking

The findings below are the historical review baseline. Corrective implementation and verification are recorded separately in [Cross-Role Recovery and Evidence Remediation](../releases/2026-08-28-CROSS-ROLE-RECOVERY.md). Defect probes are being replaced by normal regression tests asserting safe behavior. Do not use the original passing diagnostic count as release acceptance, or assume local verification means a deployed all-role pass.

## Decision

**Not everything is addressed. Do not treat the August 27 response as full operational sign-off.** The main receiving, allocation, return and backorder paths improved, and their targeted evidence remains valid. Equivalent entry points and interrupted interactions still contain defects.

The underlying direction is mostly sound: enforce stock invariants on the server, keep returns quarantined until Quality disposition, persist private receiving progress, and provide direct evidence upload. The implementation is not yet consistently applied across the app. Another redesign of every page is unnecessary; shared business-action components and a consistent transaction recovery contract are the priority.

## Evidence and Limits

- Reviewed the August 27 feedback on pages 1-5 of `wms comments (4).pdf`, the remediation report, application source, and affected tests.
- Source baseline is `ef22d20`, the application commit identified by the previous UAT deployment verification. Current HEAD `df7298f` adds documentation and test changes, not newer application behavior in the areas reviewed.
- Five isolated diagnostic cases reproduced current behavior in four test files. These intentionally assert defects: **a passing diagnostic means the defect reproduced, not that the app passed acceptance.**
- Diagnostic components use the actual application components with an in-memory repository or a deferred mock of the Storage boundary. No live stock, attachments, accounts, or tester records were changed.
- Opened UAT in the browser, but the session was signed out. No fresh authenticated, all-role live run was performed in this review.
- The earlier 12 live browser cases cover Operations Associate, Operations Lead, and Marketing & Events Lead on desktop/mobile. Operational server probes were separate, rolled-back transactions. That is not complete all-role or all-entry-point certification.
- Physical scanners, four simultaneous operators, courier execution, and real-world printing remain outside the verified scope.

## P1-01: Duplicate Event Reservations and Unequal Entry Points

**Affected:** Roles with event reservation authority, including the applicable Operations and Marketing assignments; desktop and mobile share the same handler.

**Source:** `modules/warehouse/src/pages/EventDetailPage.tsx:118`, `:361`; `packages/data-kit/src/supabase/SupabaseRepository.ts:893`.

**Reproduction:** Open an event, choose **Reserve for this event**, select a product, delay the repository response, then double-click Reserve. The rendered component calls `reserve` twice. This dialog also has only one product and no **Add product**, unlike the newly updated Allocations entry point.

**Impact:** One intended action can create two reservation attempts with separate generated allocation IDs. Available-stock checks can reject a second attempt when insufficient stock remains, but do not establish that both calls represent one user intent. This can reserve too much stock when stock is sufficient. The multi-product requirement is not met consistently.

**Recommendation:** Reuse one reservation component, accepting a preselected/locked event. Apply an immediate single-flight guard and a durable command identity. Prefer one transactional multi-line reservation command with aggregate stock validation and a replayable result.

**Acceptance:** Both routes offer the same product-line/purpose controls. Double-click, Enter plus click, slow response, and replay yield one business result. Concurrent stock changes return a clear conflict without silently leaving an unwanted partial reservation.

**Evidence:** `modules/warehouse/audit/aug28-event-parity.probe.tsx`, two reproduced cases. No live duplicate was intentionally created.

## P1-02: Late Evidence Can Cross Inspection Records

**Affected:** Quality inspectors, Operations Lead, and any other assignment authorized to inspect stock.

**Source:** `modules/warehouse/src/components/quality/InspectionSheet.tsx:46`, `:123`; `modules/warehouse/src/pages/QualityPage.tsx:272`; `modules/warehouse/src/components/camera/EvidenceCapture.tsx:84`.

**Reproduction:** Open inspection A and start an upload. Close A, open inspection B, and let A's upload finish. The actual upload component's late callback updates the still-mounted inspection parent. B's required-evidence gate becomes enabled and B's submit payload contains A's evidence path.

**Impact:** An inspection can be submitted with evidence from a different record. This is an evidence-integrity problem, not just a cosmetic thumbnail issue. The diagnostic does not assert that a live invalid inspection was committed.

**Recommendation:** Scope attachment state and asynchronous callbacks to a stable record/session identity. Ignore or cancel results after target changes or close. Reset by semantic target identity, not arbitrary object re-creation. Expose pending/error state to the parent; required evidence must be complete and belong to the current action before submission.

**Acceptance:** Delayed A uploads cannot alter B, including close/reopen, switching serials, navigation, and fresh target objects for the same record. Required evidence cannot be satisfied by another inspection's pending upload.

**Evidence:** `modules/warehouse/audit/aug28-quality-evidence.probe.tsx`; actual InspectionSheet and EvidenceCapture, with only the upload boundary deferred.

## P1-03: Removing Evidence During Upload Does Not Stay Removed

**Affected:** Shared warehouse evidence capture: receiving, allocation issue/return, returns, Quality, cycle counts, hold release, and fulfillment evidence. Exposure follows each action's capability grants, not just one role name.

**Source:** `modules/warehouse/src/components/camera/EvidenceCapture.tsx:53`, `:96`, `:102`.

**Reproduction:** Upload photo A; start a delayed upload B; remove A; complete B. The component reconstructs the list from its old snapshot and reports `[A, B]`, undoing the removal.

**Impact:** Removed or incorrect evidence can reappear and be included in a later submit. Parents also do not receive a shared upload-pending signal, making submit readiness inconsistent.

**Recommendation:** Make evidence state controlled and reconcile completed uploads with the latest list/session. Provide explicit pending, error, remove, retry, and cancellation behavior. Retain private Storage paths and authorized resolution; do not solve the usability issue with public buckets.

**Acceptance:** Removed files remain removed after pending uploads settle; failure/partial upload does not silently drop successful attachments; submitting while required evidence is pending is prevented; stale callbacks cannot cross records.

**Evidence:** `modules/warehouse/audit/aug28-evidence-race.probe.tsx`.

## P1-04: An Edited Return Can Get Stuck After an Unknown Commit

**Affected:** Operations users performing multi-product returns receiving.

**Source:** `modules/warehouse/src/pages/ReturnsPage.tsx:54`, `:93`, `:149`.

**Reproduction:** Commit a return but simulate loss of its response. The UI re-enables the form. Increase the quantity and submit again: the same idempotency key is reused with a different payload and the repository correctly rejects it. The diagnostic confirms one return exists, not duplicate stock.

**Impact:** The database remains protected, but the operator cannot tell whether to retry, correct, or start another intake. There is no explicit committed-result recovery action for this state. Unchanged-payload retry tests did not cover this edit-after-uncertain-result sequence.

**Recommendation:** Distinguish confirmed rejection, confirmed success, and unknown outcome. Retain the immutable submitted payload and command identity while status is unknown; reconcile the original result before allowing semantic edits or a new transaction. Do not simply regenerate a key after a timeout.

**Acceptance:** Test lost response after commit, failure before commit, reload while outcome is unknown, changed quantity/serial/evidence, and replay. Each resolves to exactly one understandable result with a link to the saved return, or a safely editable draft after confirmed rejection.

**Evidence:** `modules/warehouse/audit/aug28-return-recovery.probe.tsx`.

## P2-01: Scanner Requirements Are Not Applied Everywhere

**Affected:** Operations issue/custody and re-kitting workflows.

**Source:** `modules/warehouse/src/pages/EventDetailPage.tsx:163`, `:183`; `modules/warehouse/src/pages/FulfillmentPage.tsx:3940`, `:3950`.

The event-detail issue flow preselects serials from stock and presents checkboxes, while the Allocations issue path offers scanning. Re-kitting output/component serial controls remain manual text entry. These are source-confirmed differences, not fresh physical-scanner tests.

**Recommendation:** Reuse a scan-backed identity control for serialized work, with product/location/bin/serial validation and a deliberately authorized manual override. Do not count an automatically selected serial as physical scan verification. A keyboard scanner being able to type into a field is not equivalent to a guided scan flow.

**Acceptance:** Inventory identity requirements are equal across entry points; wrong product/bin, duplicate serial, unreadable barcode, permission-denied camera, and keyboard scanner input have clear recovery.

## P2-02: Evidence-URL Friction Remains Across Departments

**Affected paths, source-confirmed:**

| Department / work | Existing control | Source |
| --- | --- | --- |
| Finance close | Evidence URL text input | `modules/finance/src/components/FinanceClosePanel.tsx:533` |
| Marketing / event reconciliation | Evidence URL text input | `modules/events/src/EventsApp.tsx:849` |
| Procurement PO amendment | Evidence URL text input | `modules/procurement/src/pages/PurchaseOrdersPage.tsx:471` |
| Legal vendor lifecycle | Evidence URL text input | `modules/legal/src/components/VendorLifecyclePanel.tsx:689` |
| Operations excess-custody decision | Evidence URL text input | `modules/warehouse/src/components/ExcessCustodyDecisionPanel.tsx:125` |
| Operations inventory integrity | Evidence URL text input | `modules/warehouse/src/components/InventoryIntegrityPanel.tsx:321` |

These actions still expect the operator to obtain a document link elsewhere. Some workflows support other registered evidence fields, but the listed link-entry controls do not provide direct upload at that point.

**Recommendation:** A shared authorized attachment/document-picker service supporting appropriate images and documents, plus an optional secure-link input. Include upload state, readable validation, preview, provenance and record ownership. Reuse existing successful document-upload patterns where possible.

**Acceptance:** A user can complete each applicable action using a local document without separately hosting it. Invalid or unauthorized paths, expired preview links, upload failures, and missing required evidence produce actionable feedback.

## P2-03: Training Locks Look Like Incorrect Role Assignments

**Affected:** First-time or newly assigned Warehouse users, including Marketing reservation access and multi-role accounts.

**Source:** `modules/warehouse/src/app/App.tsx:125`, `:167`.

The denial copy says a tool is not part of the role even when the actual reason can be an incomplete training requirement. The previous live Marketing assessment sequence exercised this pre-certification state. This review did not rerun that live account.

**Recommendation:** Separate missing assignment, assigned-but-training-locked, stale session/access refresh, and forbidden record scope. Provide the exact course or assessment action for a training lock. Keep authority enforcement on the server.

**Acceptance:** Each role/combined-role account sees the actual blocking reason and a valid next step; completing training unlocks only the intended capability without granting issue or approval authority.

## P2-04: Long-Form Progress Protection Is Uneven

**Affected:** Returns receiving, warehouse order intake, and Finance close drafting. Receiving snapshots and procurement request drafts already provide stronger patterns.

**Source:** `modules/warehouse/src/pages/ReturnsPage.tsx:55`; `modules/warehouse/src/components/fulfillment/OrderIntakeSheet.tsx`; `modules/finance/src/components/FinanceClosePanel.tsx`.

These forms keep meaningful unfinished inputs in component state, without equivalent durable draft recovery. A full reload/remount can discard work. This is source inspection, not a new browser-loss reproduction. Closing every dialog does not necessarily unmount its parent, so this is not a claim that every close always loses data.

**Recommendation:** Apply per-user/per-record drafts to long workflows, with resume/discard, revision conflict handling, and unsaved-work protection. Store only appropriate fields; do not autosave secrets or treat a draft as authorization, committed stock, or an exclusive assignment.

**Acceptance:** Reload, tab return, sign-out/sign-in, concurrent draft revision, and stale reference data recover predictably without cross-user leakage or automatic transaction submission.

## P2-05: Request Review Still Exposes Technical Metadata

**Affected:** Request approvers and Operations reviewers, especially on mobile.

**Source:** `modules/warehouse/src/pages/FulfillmentPage.tsx` request-review dialog; existing `desktop-request-review.png` and `mobile-request-review.png` in the August 27 evidence folder.

The dialog shows UUID-style user identifiers and raw timestamps. A long purpose can become the dialog title and push the requested items down. This was already acknowledged in the original report's follow-up section; it remains open.

**Recommendation:** Short consistent title, purpose in the body, requested items prominent, permitted display names and local dates, with raw audit identifiers in expandable details. Check both desktop dialog density and narrow-screen action reachability.

## August 27 Requirement Reconciliation

| Feedback | Current disposition | Remaining qualification |
| --- | --- | --- |
| Scanner where serials are entered | Partially addressed | Receiving improved; event-detail issue and re-kitting remain inconsistent. |
| Four staff receive separate PO products | Software path verified in isolated transactions | Four real simultaneous operators and hardware still need rehearsal; drafts are not line ownership locks. |
| Save incomplete receiving scans | Implemented and targeted live save/reload verified | Similar recovery is not universal in other long forms. |
| Where to get delivery evidence URL | Direct upload added to receiving | Shared evidence races remain; other departments still have link-only controls. |
| Multiple event products / selling and giveaways | Implemented from Allocations | Event-detail entry point remains single-product; reservation batch is not atomic. |
| Marketing can reserve | Earned-access live checks passed | Training-lock wording is misleading before completion. |
| Allocation return rejects Restock | Quarantine-only intake corrected | General return unknown-outcome recovery remains incomplete. |
| Multiple products in a return | Implemented; atomic backend path probed | Edited retry after lost response requires recovery work. |
| Fulfillment tab counts and View request | Targeted desktop/mobile checks passed | Request metadata/long-title ergonomics remain open. |
| Zero fulfill-now line for partial backorder | Implemented and replay probed | Entirely zero retained orders remain intentionally invalid. |

## Was the Approach the Best?

**Keep:** Server-side stock validation and replay protection; quarantine before Quality release; independent inspection authority; per-operator receiving snapshots; aggregate demand checks; private evidence storage; preserving seeded tester data.

**Strengthen:** One reusable implementation for each business action, shared by all routes and applicable roles. Avoid maintaining different reserve/issue/evidence forms for the same transaction. Promote the main reservation flow's explicit uncertain-result handling into a reusable transaction result contract.

**Replace the interim compromise:** Multi-product reservations currently save acknowledged individual lines. The UI acknowledges partial/uncertain completion instead of inviting a blind retry, which is safer, but an atomic server batch is the better long-term match for one event reservation intent. If partial fulfillment is a business requirement, make it an explicit operator decision with visible line outcomes, not an incidental network failure result.

**Do not add excessive abstraction:** Start with reservation, evidence, and command outcome recovery. Reuse successful procurement draft and vendor document patterns rather than rebuilding the whole application shell.

## Remediation and Retest Sequence

1. Fix record-scoped evidence and upload reconciliation; convert both evidence diagnostics into normal regression tests asserting that stale/removed evidence is rejected.
2. Unify reservation entry points and prevent duplicate intents; add an atomic batch contract with concurrency and replay tests, or explicitly document an approved partial-allocation contract.
3. Implement unknown-outcome return recovery, including immutable pending payload and committed-result lookup/replay. Test edited retries and reload recovery.
4. Apply scanner, document attachment, training-lock explanation, and long-form draft patterns to the listed equivalent workflows. Improve the request-review metadata and multi-line review layout.
5. Run authenticated UAT acceptance by role capability, entry point, device, and interruption state. Check persisted result, next-role visibility, rejection paths, and cleanup of only the run's own records.
6. Update the standalone manual and response evidence after the fixes are actually verified. Do not replace outstanding warnings with unsupported completion claims.

## Required Coverage Before Sign-Off

- Reservation: Marketing and authorized Operations; Allocations and Event detail; combined role accounts; pending double-click, insufficient stock, concurrent allocation, partial/failed response and replay.
- Evidence: receiving, Quality, issue/return, fulfillment/delivery, counts, hold release; remove during upload, switch record, close/reopen, failure, and required-evidence submission while pending.
- Returns: customer/vendor/event, serialized/nonserialized multi-product intake, invalid source/bin, lost response after commit, edit-after-failure, replay, Quality handoff and final availability.
- Other departments: Finance close, Procurement amendment, event reconciliation, Legal lifecycle and Operations integrity/custody evidence controls; authorized and forbidden actions.
- Onboarding/access: newly assigned, certified, training-locked, revoked, and combined-role users. A union of navigation visibility must not bypass independent approval or training requirements.
- Desktop and mobile: focus order, keyboard activation, touch double-tap, pending/disabled states, reachable footer actions, long text, errors near fields, and no unexpected record/state reset.
- Every remaining persona, including requester, administrator, vendor, product and leadership/read-only, needs its own applicable-path smoke and negative checks before an all-role claim. No fresh live pass for those personas is asserted here.

## Diagnostic Reproduction

```powershell
pnpm --filter @intra/warehouse exec vitest run --config vitest.review.config.ts --reporter=verbose
```

Result on 28 August: four files, five diagnostic cases reproduced. Files are under `modules/warehouse/audit/` and excluded from the normal `*.test.*` regression suite. Once corrected, invert the relevant assertions and move them into normal regression coverage. These probes are not release-gating success tests in their current form.

No application fix, database migration, live data cleanup, or deployment was performed during this review.
