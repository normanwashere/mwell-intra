# Reviewed Task Training

Documentation delta dated 7 September 2026. This describes reviewed learning content, not a publication notice or a grant of operational access.

## When Assigned

When assigned to your account, complete the exact learning requirement shown for your task. The four internal scenarios below each contain three decision checkpoints, with feedback on incorrect choices. They are separate scenario identities; they do not replace the meaning of an earlier receiving or role-practice version.

Runtime support alone does not assign a requirement or establish live readiness. The authoritative assignment, requirement version, prerequisites, recorded progress and capability mapping determine whether learning is satisfied. Missing or unavailable readiness must not be treated as completion. Completing one scenario does not imply that every requirement for a task is satisfied.

## Quality Inspection

Scenario: `warehouse-quality-inspection-review-v1` (internal audience).

When assigned, this scenario covers learning for `warehouse.inspect_quality`:

- Match the exact pending receipt or return source and affected units; a similar SKU is not sufficient identification.
- Record a reason for a non-accepted disposition and finish required evidence uploads before submission.
- Read back the exact source after a failed or lost response before retrying or handing off. An uncertain response does not establish whether the decision was recorded.

Inspection does not authorize releasing held stock or dispatching a vendor return. Custody restrictions and the separately authorized disposition workflow remain in force.

## Payment Readiness Review

Scenario: `procurement-payment-readiness-review-v1` (internal audience).

When assigned, this scenario covers learning for `procurement.review_payment_readiness`:

- Keep Warehouse custody, requester acceptance, Procurement evidence and Finance review as separate attributable decisions.
- Return an incomplete, mismatched or stale current pack with a reason to its responsible owner for correction and resubmission. Earlier acceptance is not proof that changed evidence is ready.
- Verify the recorded review after an uncertain response and preserve independent review and the separate payment-release handoff.

An approved PO or receipt alone is not payment readiness. Completing this scenario neither accepts a real payment pack nor releases a payment.

## Stock Putaway

Scenario: `warehouse-putaway-review-v1` (internal audience).

When assigned, this scenario covers learning for `warehouse.transfer_stock` in the putaway workflow:

- Confirm the exact source and eligible unbinned stock in the selected warehouse. Putaway does not remove a quality hold.
- Use an active destination bin in that warehouse. Move a serialized unit as one; other quantities must be positive whole units within eligible availability.
- Preserve the capture and read back source, destination and remaining quantity after an uncertain response. Partial putaway can leave outstanding work.

This is putaway-specific coverage, not a claim that every stock-transfer variant has been taught or tested.

## Allocation, Pick And Pack

Scenario: `warehouse-pick-pack-review-v1` (internal audience).

When assigned, this scenario covers learning for `warehouse.reserve_allocate` and `warehouse.issue_items` within the order workflow:

- Confirm the selected order and its allocation state. Only accepted, put-away stock is pickable; route condition problems through the authorized quality workflow.
- Verify the source rack or bin and exact required serials. Duplicate or unrelated serials do not establish a valid pick.
- Record delivery-method details and packaging actually consumed, use HTTPS shipment tracking links, and wait for pending evidence uploads. Read back the exact order after an uncertain packing response before retrying.

Packing is not release. A different authorized warehouse operator must release the packed order. This scenario does not certify unrelated reservation or issue workflows merely because they share a capability name.

## Vendor Evidence And Acknowledgments

Learning review: `vendor-evidence-review-v1`, bound to `vendor.vendor_representative.evidence-and-acknowledgments.v1` (vendor audience).

When assigned, this two-checkpoint learning review follows vendor orientation. It asks the learner to review the current case document checklist, prepare accurate and current company evidence, and address missing or expired documents. It also explains that authorized representatives must complete declarations, acknowledgments and signatures in the actual application.

This is a learning attestation, not a scored internal decision scenario or a legal declaration. It has no capability outcomes. Completing it does not upload or approve evidence, sign documents, submit an application, grant accreditation, or expose internal training to a vendor.

## Authority And Review Boundary

Learning completion is not operational authorization. Existing role permissions, audience restrictions, source eligibility, certification requirements, independent approval and release controls continue to apply. The exercises do not perform the business actions they describe or waive other requirements.

The content received independent **automated review**, explicitly authorized for this work. This was not a human pilot, observed learner study, or proof of live end-to-end certification. Local tests verified the four scenarios' decision evaluation, including accepted choices, negative feedback and rejected forged inputs; those tests are not evidence of database publication or learner completion. The vendor review is a separate learning-attestation flow, not part of those scored-choice claims.

Review provenance is recorded in [the automated content review artifact](../audits/2026-09-07-AUTOMATED-CONTENT-REVIEW.json). Content approval, runtime registration, database binding review, publication and deployment are distinct release steps.

## Release Status Snapshot

As reported by the release coordinator on 7 September 2026, public UAT is on `06c9b80`, verified at 03:39:16 UTC. Three internal curriculum version-2 publications and five new requirements are published. At 03:44 UTC, the three internal role mappings for Ops operator, Procurement Finance and admin were activated. No learner completion was automatically granted and no learner progress was reset. This status records the coordinator's verification; this documentation change did not independently check deployment or database state.

Runtime registration did not itself change default assignments; role-mapping activation was a separate release action. At 03:56:33 UTC, the core vendor-portal version-2 mapping was activated, preserving version 1. Its three-member curriculum uses a distinct practice to resolve the conflict and maps the new evidence attestation and practice. All four curriculum version-2 mappings are now active: three internal and one vendor. There are seven new requirement roots in total: five internal and two vendor. No learner completion was automatically granted and no learner progress was reset. Each learner must still receive and complete the exact assigned requirements.

The release coordinator reports that the final unmocked sweep passed at 03:54:29 UTC: 108 task views and 22 role views. Hashes were verified for 216 captures; only three captures received manual visual review. Hash verification does not establish visual correctness of every capture. This sweep preceded vendor activation and was navigation/readiness evidence, not learner completion, a human learner pilot, or proof of business transactions.

Subsequent internal actual-learning tests passed all eight checks across the four new scenarios. On desktop, each scenario rejected a wrong choice without advancing, accepted the correct choices at its three checkpoints, completed and retained completion after reload. On mobile, the completed scenarios were reviewed; these were not four additional fresh completions. These results concern the tested accounts and scenarios, not completion by every assigned learner.

Vendor post-activation navigation/readiness checks passed for six task views across two viewports, with 12 screenshots reported. At that stage, the server already showed the new distinct practice as passed through retained shared completion, while the new evidence attestation was not started. This was not manual credit or a fresh practice completion performed by the test.

The subsequent vendor actual-learning run passed all four checks with eight screenshots and zero blocked checks. It completed the fresh evidence attestation's two checkpoints in one saved attempt and verified persistence on mobile. The practice was already passed and had zero attempts; its check was readback only, not a new completion. Evidence is recorded at `outputs/task-first-candidate/vendor-live-learning-2026-09-07T04-04-59-366Z/results.json`. All test browser contexts are reported closed.

These are automated checks against actual UAT, not a real human learner pilot. The passing scope is 108 task views and 22 role views, six targeted vendor task views, four desktop internal scenario completions plus four mobile completed reviews, and four vendor learning checks. These results do not complete the separate 271-control exact-step screenshot certification; hash verification and targeted captures are not full visual certification.

Known P2 limitation: distinct prior and current vendor practice roots show duplicate titles, both completed, in the expanded list. Their historical distinction is ambiguous in that presentation. Retained practice credit must not be confused with completion of the separate new evidence attestation; use the exact requirement identity and status when reviewing progress.

This final status delta is included in the standalone handbook regeneration. Source content, release-state reports, automated test results and remaining visual-certification limits remain distinct; none implies completion by untested learners.
