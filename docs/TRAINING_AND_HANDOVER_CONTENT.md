# Mwell Intra Training and Handover Content

## September 5 Candidate Handover Gate

For multi-role users, explain certification module/role context alongside the capability name. Repeated names are not proof of duplicate authority. Test active and historical entries separately, preserving expiry and revocation status. Existing-completion screenshots are not evidence of fresh onboarding completion; retain that distinction in handover sign-off.

Require the fully received Closed PO to reach payment preparation without artificial outstanding lines, and a mixed-case serial receipt to reach independent inspection without duplicate custody. Preserve all negative authority and evidence tests. The live route gate's automated geometry/accessibility result is not a substitute for reviewing screenshots. Retain successful-route frames as well as failure evidence, including the bottom of modal content. A mobile invitation-form review must not claim email delivery certified by another viewport whose result is unknown.

For raw-receipt serialized QC, verify that the completed inspection leaves the exact unit `in_stock`, not stranded in `pending_inspection`. Demonstrate that active holds still exclude held stock from availability, including non-accepted QC outcomes. Governed release removes the hold's availability restriction without changing the unit status. Do not teach `in_stock` as permission to allocate or pick held stock; retain independent inspection and exact receipt/product/bin/serial checks.

The current remediation remains a UAT candidate until its release manifest and live checks are complete. Training material must not describe candidate screenshots as production evidence.

- Trainers: demonstrate exact task-to-record navigation, searchable grouped Quality work, actionable receipt validation, source-backed stock approval, and honest queued-versus-committed outcomes.
- Developers: preserve receipt line identity, complete cursor traversal, failure-state recovery, and immutable queued intent keys. Run the corresponding negative and retry regressions after changing these contracts.
- Infrastructure: apply reviewed forward migrations only to the UAT project, verify actual installed function signatures and grants, then deploy the matching app adapter. Preserve tester seed data and retain ambiguous legacy records for governed reconciliation.
- Acceptance owners: require desktop/mobile screenshots, cross-role readback, wrong-source/unauthorized rejection, and lost-response recovery evidence. Unit-test totals are not a substitute for deployed transaction certification.
- Role-access training: Operations PO visibility does not imply private payment-document visibility. Demonstrate the restricted-scope message and the authorized Procurement/Finance evidence path separately. Preserve independent approval responsibilities instead of broadening access to suppress errors.
- Recovery training: exercise failed Finance sources without losing valid neighboring information; repeat after a user/access change. For Quality, distinguish an actual empty queue from conflicting or incomplete records and demonstrate Retry before resuming decisions. Include a stalled read, its bounded recovery message, successful retry and a late response from the old attempt; incomplete or stale records must never enable inspection. Count vendor agreements alongside missing documents. Explain Product permalinks without promising a separate history screen.
- Audit maintenance: inspect visible controls only after loading settles; closed disclosure contents are not visible click targets. Keep tests that expand the real disclosure and exercise Inspect, plus negative overlay and persistent-loading fixtures. Do not weaken mobile target-size checks to accommodate undersized links.
- CI evidence discipline: a validation-only Quality/return check is not proof that a record was created. Attribute transaction milestones only to their actual RPC/UI write and readback, and run the maintained standalone SQL regressions explicitly. A green scenario registry is not automatically full acceptance of all 53 detailed audit findings.
- Simulation parity: retain the exact procurement line on local training inspections, including repeated SKUs in the same bin. Verify independent remaining quantities and rejection of an unrelated or over-consumed line. This does not certify live RLS or database concurrency.
- Accessible layout: include narrow-screen enlarged-text checks for the shared header as well as page content. Reflow controls, title icons, custody summaries and outcome totals without hiding branding, clipping labels or reducing the user's text size. Inspect the complete screen, not only the original defective component.
- Account-menu acceptance: exercise long role lists, narrow/enlarged text, internal scrolling to lower actions, and Escape/outside dismissal. A menu whose Sign out control remains below the visible boundary without scrolling is a failed check, even when the closed header fits.
- Notification acceptance: inspect both the empty explanation and populated rows above fixed navigation. Validate the action target and dismissal behavior; keep read-only evidence captures separate from tests that actually change read status.
- Notification privacy acceptance: keep Home mounted across an account/access change, delay or fail the new load, and resolve an old callback late. No previous-scope notification may appear. Normal sign-out/unmount alone is insufficient to certify the retained-shell boundary.
- Navigation and correction: train the non-Due task round-trip, task-specific screen-reader links, and receipt links that focus an actual invalid field rather than its line-selection checkbox. Test a PO whose first line is already complete; the remaining selection must target an outstanding line.
- September 5 verification handover: 24 security-verifier regressions and 51 receiving/return boundary regressions pass. Actual UAT metadata reports no remaining findings under those verifier rules. The Operations Lead payment-evidence failure has a passing deployed desktop/mobile retest. Through `7dd30cb`, targeted live checks also cover Quality source identity, Product targets, Employee task links and receiving correction focus. These are scoped checks, not complete cross-role transaction certification. Existing tester data is preserved.

**Reviewed:** August 25, 2026
**Procurement application behavior baseline:** `32170e425e125c63597ea8e05c6287a7cd256f5b`
**Evidence status:** deployed UAT behavior; standalone handbook Task 8 certification is recorded in `docs/releases/2026-08-24-OUTCOME-FIRST-HANDBOOK.md`

This is the maintained source for trainer, developer, and infrastructure handover materials. Presentation exports must use this content and the screenshots from the matching certification artifact.

## Training outcomes

### August 27 Feedback Handover

Demonstrate PO line selection, serial scanning, incomplete Save progress and resume, delivery-note upload, and the subsequent Quality handoff. Explain that different staff may receive different PO items, but a draft does not reserve ownership of a line and concurrent submissions are checked against current server quantities. Demonstrate multi-item event reservation with Selling/Giveaway purpose, multi-item quarantine-first returns, request detail review, actionable tab counts, and a zero-per-line backorder split. Use only UAT records for training and preserve other testers' in-progress transactions.

### August 28 Recovery Addendum

Use `docs/releases/2026-08-28-CROSS-ROLE-RECOVERY.md` to confirm deployment and verification status before demonstrating this release. Train both reservation entry points as one atomic action: a rejected batch saves nothing; an uncertain response uses **Recover reservation**, not a replacement transaction. For Returns, demonstrate an editable saved draft, a confirmed rejection, and **Recover original result** for a locked unknown outcome. Show that switching users cannot resume another user's draft through the app.

Teach evidence ownership explicitly: attach to the intended record, wait for uploads, remove incorrect attachments, retry only failed files, and verify the saved record. Closing an upload must never put its result on a different inspection. Document uploads remain private and require authorized preview. Request reviewers see items before purpose and open **Audit details** only when investigating identifiers or timestamps.

Scanner practice must include an incorrect bin, wrong product, duplicate serial, and denied camera permission. Manual fallback is explicit input, not proof that a physical scan occurred. Browser-local drafts are not cross-device backups or shared staff assignments. Live command authority and independent approvals remain required after training.

Learners must be able to:

- Identify their role, module, authority, handoffs, and escalation path.
- Complete one role-specific happy path, correction path, denial check, and recovery path.
- Verify persisted state after a successful command.
- Avoid duplicate writes after refresh, timeout, or uncertain network state.
- Use the standalone handbook to find the current procedure, governing reference and application route.

## Standalone handbook training path

The handbook is a standalone training and handover artifact. Teach its four modes as different learner intents:

1. Start on **Home** and choose a frequent outcome or select the learner's canonical role.
2. Use **Tasks** while performing work. Read Outcome and Flow first, then follow each numbered stage, expected result, read/write contract, evidence, and handoff.
3. Use **Roles** before a simulation to confirm workspace, authority, prohibited actions, handoffs, negative scenario, recovery, and completion evidence.
4. Use **System** for administration, architecture, infrastructure, security, release/QA, imports, or the governed source register.

Do not train learners to browse source filenames first. Policy basis, capability codes, checksums, and document controls are supporting evidence and remain collapsed until needed. Operational steps live in the canonical task guide; role and System guides link to those steps rather than replacing them.

### Guided discovery drill

Each learner must find a named task, role, and troubleshooting answer using Home or search in no more than three deliberate interactions. First-use certification uses these exact prompts without paraphrasing: `Receive and inspect a delivery.`, `Pick and pack an ecommerce order.`, `Submit a vendor accreditation application.`, `Create a purchase request.`, `Process an unknown returned serial.`, `Resolve an inventory variance.`, `Learn what an Operations Associate may do.`, and `Find the current infrastructure and recovery guidance.` Search practice also includes `receive stock`, `pick and pack`, `approve request`, `renew vendor`, `cycle count`, `report damaged item`, `reset password`, `three-way match`, and `DOA`. The learner must explain the first-ranked title, result type, applicable role/module, match reason, and exact destination before opening it.

### Role simulation drill

Use the role guide's **Guided simulation** as the source of the scenario, start route, success criteria, negative case, and recovery. The 11 canonical simulations are part of the handbook acceptance matrix. Leadership / Insights is explicitly read-only: the learner opens `/insights`, traces a source-linked indicator, verifies freshness, and confirms operational mutation controls are absent.

### Decision and recovery drill

For the learner's linked task, open Flow first and then Decisions and exceptions. The learner must identify the decision owner, both branches, the next stage or decision, the recovery action, and whether the outcome terminates the task. The certified task set contains 48 decisions, 96 branches, and 27 terminal outcomes; trainers must not teach a rejected, escalated, cancelled, or controlled-hold branch as if it automatically resumes.

### Responsive and accessibility drill

Run one simulation on desktop and one at a compact mobile width. Learners must use Menu and In this guide without losing position, open and close a certified screenshot with focus returning to its trigger, operate one flow by keyboard, zoom or fit one Mermaid diagram, use its text equivalent, refresh the selected step, and print the current guide. The acceptance viewports are 1440, 1280, 1024, 768, 430, 390, 360, and 320 CSS pixels.

### Trainer evidence

Use only screenshots from `docs/manual/assets/knowledge-base/` whose binding appears in `task-stage-evidence.json`. Task 8 visual review captures are under `outputs/handbook-visual-review/`. The CI response used to approve stage evidence is `task-stage-ci-attestation.json`; it is supporting UAT provenance and does not by itself prove a production deployment. Exact test commands and results are recorded in `docs/releases/2026-08-24-OUTCOME-FIRST-HANDBOOK.md`.

### Certified training baseline

Training uses 13 task guides, 52 stage screenshots, 11 role simulations, 48 decisions, 96 branches, 27 terminal outcomes, and 368 migrated legacy links. The current registry includes eighteen source links added on August 28 and 37 article/heading links across the September 5 updated maintained sources, including all three candidate guides. The original Task 8 certification covered 313 links: its source-model unit trio passed 81 of 81 tests, strict evidence coverage and provenance produced zero warnings and zero errors, and CI attestation verified. That original browser acceptance passed 116 tests with 100 project-conditional skips and zero failures across all eight responsive projects in 19.6 minutes. Its 24 visual-review captures cover light, dark, and print at every certified width; later changes require their own evidence. The August captures are stale under the unchanged seven-day gate as of September 5, and historical-fixture unit checks are not fresh capture certification.

Trainers and handover reviewers must use `docs/manual/index.html` generated from the same 29-source set and may inspect `outputs/handbook-visual-review/` for the responsive evidence. Lint, typecheck, generated-documentation, and release-documentation gates passed. The release record retains the three unrelated existing Procurement lint warnings and the local Node/pnpm engine warning; neither warning changes the learner procedure or grants production approval.

## Current Persona Training Register

Training and sign-off use exactly these 11 operating personas. Module role codes and older procedure labels are scoped capabilities or teaching aliases, not additional personas and not independent authority. Trainers link each learner to the canonical role guide and its canonical task simulations instead of restating the full operating procedure here.

<!-- canonical-personas:start -->
| Current persona | Required training emphasis |
| --- | --- |
| Platform Administrator | Minimum-role assignment, governed configuration, audit, and authorized DOA administration |
| General Employee | Own-request creation, correction, submission, and self-approval denial |
| Operations Associate | Floor receiving, scanning, putaway, fulfillment, returns, transfers, and counts |
| Operations Lead | Warehouse setup, controlled exceptions, releases, variances, and assigned approvals |
| Procurement Lead | Route confirmation, sourcing, vendor readiness, commitment, handoff, and closure |
| Finance Controller | Independent matching, valuation, settlement, and payment-readiness evidence |
| Legal & Compliance Lead | Vendor invitation, accreditation, legal evidence, compliance, and authorized DOA checks |
| Marketing & Events Lead | Event demand, custody, use/return evidence, reconciliation, and settlement submission |
| Product Owner | Readiness, pricing, go-live decisions, and Operations handoff |
| Leadership / Insights | Read-only metrics, source tracing, and data-quality escalation |
| Vendor Representative | Own-case application, evidence, correction, acknowledgement, and cross-vendor denial |
<!-- canonical-personas:end -->

## Updated Warehouse demonstration

1. Import or create an ecommerce order with customer, address, channel, payment, and product fields.
2. Explain why selling price is read-only and owned by Product.
3. Compare standalone quantity with an explicit bundle and inspect per-set IDs.
4. Scan the required rack/bin and every serialized unit.
5. Record packaging, waybill, courier, proof, dispatch, and handover reference.
6. Export the current view and reconcile it with the saved order.
7. Scan a returned serial and confirm its original release; quarantine an unmatched serial.
8. Demonstrate pending-work badges on desktop and mobile.

## Procurement-to-payment demonstration

Use `mWell Procurement Policy and Procedures - Revised Modern Visual - Word Updated.docx` as the canonical operating source. State that it identifies itself as an updated visual draft and therefore cannot back an active profile until Procurement records approval. Use the MPIC extract only for visibly inherited controls that the canonical source does not replace.

1. As Requester, choose the named category control, separately classify **Goods / materials** or **Services**, and create a clear, comparable request below PHP 1,000,000 with specification or scope, budget, controlled Department and Cost Center selects, priced lines, acceptance criteria, route facts and target date. Repeat on a narrow mobile viewport and confirm the two controlled fields remain selects while loading. Simulate a directory read failure and confirm the form blocks with recovery guidance instead of exposing free-text authority fields.
2. As Procurement Lead, show **Solicitation document: RFQ**, **Procurement mode: Competitive bidding**, and **Governance tier: Standard** as separate decisions.
3. Change the amount to PHP 1,000,000 and show that the route changes to RFP regardless of goods/service classification.
4. Return below PHP 1,000,000 and add complexity, technical, strategic, high-risk, data-sensitive or non-comparable facts; show RFP. Then use importation alone on a simple/comparable request and show that it remains RFQ while import controls are added.
5. Inspect the draft profile/source-status/DOA projection without calling it activated. Attempt activation while the source is draft and confirm fail-closed behavior. Explain that source approval, authorized variance-stage mapping and controlled UAT remain gates.
6. Issue one versioned package to three to four accredited vendors; demonstrate attributable acknowledgment, common clarification, equal deadline notice, and superseded-package denial. Also demonstrate fewer invitees: a current independently approved pre-issue invitation-target exception reaches the controlled package path, while denial remains blocked and returns to sourcing or closure.
7. Close with fewer than the profile-required usable responses and show the blocked failed-bid state. Recover once through equal-notice extension/requote within the inherited seven-calendar-day cap, and once through the independently approved insufficient-bids path.
8. Record commercial tabulation and an assigned technical evaluation. Show that lowest price does not create an automatic winner.
9. Record a best-value recommendation, then demonstrate a differing recommendation that remains blocked until written justification, a first independent variance decision, and a second independent variance decision are complete. Do not assign either neutral stage from an MPIC title or current code label; Mwell policy/DOA owners must authorize the stages first.
10. Demonstrate valid and invalid sole-source, repeat-order, emergency, and petty-cash modes. For petty cash, show Finance eligibility and rejected split/recurring use.
11. Approve the award through the current effective Mwell DOA and separation-of-duty checks, then create and issue the PO/agreement only after all commitment evidence passes.
12. As vendor representative, acknowledge the exact PO version. As Warehouse/Operations or service owner, record receipt/QC/acceptance and demonstrate quarantine, rejection, replacement/warranty, RMA, and re-inspection recovery. Confirm that accepted goods value is derived from accepted quantity and governed PO-line unit price.
13. As Procurement, prepare the versioned payment pack. As Finance Controller, demonstrate missing-evidence, mismatch, tax/foreign-vendor, stale-acceptance, returned-correction, and successful readiness decisions.
14. Attempt file closure with an open delivery/quality issue, recover the issue, and close only when payment readiness, delivery closure, issue resolution, and retained evidence are complete.
15. As Platform Admin or Legal, create a DOA revision by selecting an active controlled department. On desktop and mobile, submit missing Department, Version, and named-approver input and verify the editor focuses and scrolls to the inline correction. Confirm the draft is persisted and can be reopened before handoff, confirm the stable code shown on the matrix, reject an unknown/inactive department, and prove that a different authorized checker performs activation. During UAT, inspect all five temporary named tiers and explain that the broad `UAT-TEMP-*` ladder is replaceable certification data, not the approved production schedule. Engineering handover must also demonstrate that authenticated callers use the governed wrapper while the private save policy remains non-executable by ordinary users.

### Role procedure checks

For the 11 current personas in the training register, the learner must state and demonstrate the canonical role guide's start condition, permitted action, prohibited action, handoff, denial check, recovery, and completion evidence. Legacy labels such as Requester, Department Head, technical reviewer, and Warehouse/Operations are discussed only when explaining a scoped capability, a controlled assignment, or a source-policy term; they do not create another persona or grant authority.

## Negative scenarios

- Requirement kind incorrectly used to choose RFQ/RFP, or a PHP 1,000,000/risk boundary ignored.
- Importation alone incorrectly forces RFP, or required import controls are omitted.
- Requester attempt to confirm route, approve an exception, or self-approve.
- Missing active profile/DOA, MPIC named-role substitution, or overlapping authority.
- Attempt to activate a profile while the canonical source document status remains draft.
- Attempt to treat current `dept_head`/`finance` code stages as authorized variance approvers without Mwell policy/DOA approval.
- Fewer than three usable sealed-bid responses without failed-bid recovery approval.
- Unequal clarification/deadline notice, stale package acknowledgment, late response, or unaccredited vendor.
- Automatic lowest-price selection, incomplete technical evaluation, or unsupported recommendation variance.
- Ineligible sole source, changed/old/over-limit repeat order, unsupported emergency, or split/recurring petty cash.
- PO/agreement attempt with incomplete sourcing, eligibility, protection, or DOA evidence.
- Receipt/acceptance against the wrong commitment; unresolved QC, warranty, replacement, or RMA hold.
- Payment pack with missing invoice/commitment/acceptance/tax evidence, accepted-value excess, or stale versions.
- Invalid CSV headers or controlled values.
- Missing PO/DR reference or receiving evidence.
- Wrong rack/bin, duplicate serial, wrong product, or unavailable unit.
- Warehouse attempt to edit Product-owned price.
- Quantity incorrectly treated as a bundle.
- Return serial with no original release.
- Delivery update without permission.
- Vendor invitation delayed or rate-limited.
- External vendor email canary omitted, rate-limited, or missing persisted Auth identity, expiry, and generation evidence.
- Free-text, inactive, or unmapped DOA department; matrix/assignment department drift; or maker self-activation.

## Handover evidence

The release bundle must contain:

- Commit-bound documentation manifest.
- Self-contained `MWELL_INTRA_COMPLETE_DOCUMENTATION.html`, generated from the maintained source set and safe to open offline.
- Current manuals, specification, training content, and release note.
- Desktop, tablet, and mobile screenshots from live route audits.
- Governed transaction and database-readback results.
- Cleanup evidence and declared residual blockers.

Screenshots must come from the same deployed commit. Trainers must not use historical screenshots that show retired controls, incorrect labels, or resolved errors.

Local handbook and unit-test results are supporting evidence, not live certification. Release sign-off requires the exact deployed commit, UAT policy-baseline preflight, desktop/mobile route and transaction artifacts, successful cleanup, and a separately requested external vendor-email canary when delivery is in scope.
