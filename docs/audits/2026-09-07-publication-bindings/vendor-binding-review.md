# Vendor Binding Review

Independent AUTOMATED user-authorized review; candidate `06c9b80bc6c09c343800756ebcadc0efdb88619f`; exact authorized UAT project **`kkoitlvydytdhlpxhuah`**.

Main reports fresh vendor baseline `eb8668999e6f7826e1ec8ebc05ef6a7a` from the frozen `vendorBaselineQuery()`. This is main-reported read-only evidence, not a live query performed by this reviewer.

## Content and Provenance

Original vendor catalog author remains **unknown**. Curie `01a06fa0-d12a-73d0-a143-5e6c7f3a745e` is the adaptation/review preparer, not asserted to have authored the original catalog. Reviewer is `01a06fa2-a909-7bd0-84a1-90c820ec9c5f`. The current publisher author is reported as Schrodinger; no agent UUID has been supplied here and none is invented. These identities are not database principals; UAT account attribution is audit custody, not human review.

Approved vendor simulation content remains `508c2518986fa444810c659fd55b846d22f3873f72a4149b67762c8e6cef9391`. Independently hashed committed catalog bytes: `bce1c0278fdc7b4498ac42539497d004a4c980b1e56488f63c6fd4d01b9ea906`. Independently hashed JSON pass rules: `bcb08d0d5a727341ebb4ecf78e88dec547710407d901d5c92752b9bf3b1d9068`.

Both `review-evidence` and `complete` require outcome `reviewed`. This attestation is learning review only, not an upload, signature, legal acknowledgment, accreditation, or evidence acceptance. The proposal preserves orientation and practice, adds mandatory evidence review between them, retains the original edge and adds two ordered prerequisite edges. Only the existing practice grants `core.submit_accreditation`; the new evidence requirement grants no capability. Published v1 is fingerprinted before and after publication; no role maps or learner evidence are written. The draft-to-review-to-approved-to-published sequence and explicit postconditions are appropriate for inactive publication.

## R3: Binding Guard Correction Required

Update: R3 is resolved in publisher `9aa2bd65e64cef1c79ec943af864b5f3eb72277d019127d56cd01d5b227bec01`. The earlier snapshot finding below is retained as history. Current publisher also clones existing practice content/pass rules into distinct root `vendor.vendor_representative.evidence-backed-submission-practice.v1`, preserving the old root and its original prerequisites. V2 uses orientation, evidence, and this new practice, with three ordered edges; no role maps expire or get inserted. This resolves the reported shared-root prerequisite conflict without changing original content or certificates. Independently ran actual-lifecycle PGlite regression: 1/1 passed, exit 0. Current `vendor.review.json` and `vendor.input.json` bind exact candidate/baseline and authorize inactive publication rehearsal only; `vendor.rehearsal.sql` is generated and ends ROLLBACK. Apply and activation remain unapproved until separate evidence review.

Inspected publisher SHA-256 `59f0633f4126d8e182423c35a03016fb97e5b98a424456a5c350a2e8f9e5e222` validates the review artifact's candidate, catalog and pass-rule hashes, but does not compare `artifact.baselineFingerprint` with `input.baselineFingerprint` or require the artifact's inactive-publication policy for publication rehearsal. Thus a rehearsal input could substitute a baseline not approved in the artifact. Apply still separately binds an exact rehearsal SQL digest, so this finding is not a claim of an apply-authorization bypass.

Requested narrow correction: in non-draft mode require exact reviewed baseline equality and `publish_inactive_no_role_maps` policy, with negative regression tests. Main notified. Final machine binding and execution approval are **not issued** for this snapshot; content approval remains unchanged. No live writes performed.
