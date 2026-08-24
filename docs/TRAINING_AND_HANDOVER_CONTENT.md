# Mwell Intra Training and Handover Content

**Reviewed:** August 25, 2026
**Procurement application behavior baseline:** `32170e425e125c63597ea8e05c6287a7cd256f5b`
**Evidence status:** deployed UAT behavior; standalone handbook Task 8 certification is recorded in `docs/releases/2026-08-24-OUTCOME-FIRST-HANDBOOK.md`

This is the maintained source for trainer, developer, and infrastructure handover materials. Presentation exports must use this content and the screenshots from the matching certification artifact.

## Training outcomes

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

Training sign-off uses the Task 8 certified baseline: 13 task guides, 52 stage screenshots, 11 role simulations, 48 decisions, 96 branches, 27 terminal outcomes, and 309 migrated legacy links. The source-model unit trio passed 81 of 81 tests, strict evidence coverage and provenance produced zero warnings and zero errors, and CI attestation verified. Browser acceptance passed 116 tests with 100 project-conditional skips and zero failures across all eight responsive projects in 19.6 minutes. The 24 visual-review captures cover light, dark, and print at every certified width.

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
