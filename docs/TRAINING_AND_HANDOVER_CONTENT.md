# Mwell Intra Training and Handover Content

**Reviewed:** August 23, 2026
**Procurement application behavior baseline:** `0bf88e362acec9ee8f5c59dbda865a8d4767e4a2`
**Evidence status:** local code and documentation baseline; live/UAT certification remains a separate gate

This is the maintained source for trainer, developer, and infrastructure handover materials. Presentation exports must use this content and the screenshots from the matching certification artifact.

## Training outcomes

Learners must be able to:

- Identify their role, module, authority, handoffs, and escalation path.
- Complete one role-specific happy path, correction path, denial check, and recovery path.
- Verify persisted state after a successful command.
- Avoid duplicate writes after refresh, timeout, or uncertain network state.
- Use the standalone handbook to find the current procedure, governing reference and application route.

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

1. As Requester, create a clear, comparable request below PHP 1,000,000 with specification or scope, budget, cost center, acceptance criteria, route facts and target date.
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
12. As vendor representative, acknowledge the exact PO version. As Warehouse/Operations or service owner, record receipt/QC/acceptance and demonstrate quarantine, rejection, replacement/warranty, RMA, and re-inspection recovery.
13. As Procurement, prepare the versioned payment pack. As Finance Controller, demonstrate missing-evidence, mismatch, tax/foreign-vendor, stale-acceptance, returned-correction, and successful readiness decisions.
14. Attempt file closure with an open delivery/quality issue, recover the issue, and close only when payment readiness, delivery closure, issue resolution, and retained evidence are complete.

### Role procedure checks

For Requester, Department Head, Procurement Lead, Legal/Compliance, technical reviewer, Warehouse/Operations, Finance Controller, vendor representative, and Platform Admin, the learner must state and demonstrate the role's start condition, permitted action, prohibited action, handoff, denial check, recovery, and completion evidence from the standalone manual.

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

## Handover evidence

The release bundle must contain:

- Commit-bound documentation manifest.
- Self-contained `MWELL_INTRA_COMPLETE_DOCUMENTATION.html`, generated from the maintained source set and safe to open offline.
- Current manuals, specification, training content, and release note.
- Desktop, tablet, and mobile screenshots from live route audits.
- Governed transaction and database-readback results.
- Cleanup evidence and declared residual blockers.

Screenshots must come from the same deployed commit. Trainers must not use historical screenshots that show retired controls, incorrect labels, or resolved errors.

The Task 11 handbook build and local tests are not a live/UAT certification artifact. The additive migration remains unapplied, and the controlled-fixture QC alias limitation remains parked for Task 12.
