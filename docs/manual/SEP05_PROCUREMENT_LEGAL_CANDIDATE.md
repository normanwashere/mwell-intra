# Procurement And Legal - September 05 Candidate

**UAT RELEASE CANDIDATE - DEPLOYED SEPTEMBER 5; END-TO-END ACCEPTANCE PENDING.** These procedures describe the current UAT implementation at https://mwell-intra-uat.vercel.app. Main production has not been promoted. Deployment is not certification of every approval, vendor, payment, or evidence-delivery scenario.

This supplement describes proposed behavior in the September 05 remediation working tree. It does not amend the main manual, certify deployment, authorize a policy exception, or authorize live test transactions. Procurement/Legal owners must review it before publication. Existing approved policy, current certification, named assignments, separation of duties, and database authorization remain controlling.

## Release Status

The F03 retained-history foreign-key collision is fixed in the candidate and covered by disposable integration tests. Approval IDs and complete decision snapshots are retained in a protected audit ledger; exception references remain restrictive and retain their original IDs. This is not deployment or unqualified release sign-off. Do not delete history, unlink exceptions, widen privileges, or recreate invoices to bypass policy controls.

There is no completed all-repository migration bootstrap or deployed end-to-end certification. Local domain-chain tests reuse the existing Task 10 fixture and execute real prior payment, decision, lifecycle and attachment policies. Authentication/learning boundaries and portions of the supporting schema remain fixtures. Storage signed-URL delivery and mobile/keyboard acceptance still require separate checks.

## Requester Drafts And Corrections

Proposed controls on owner-held draft and rejected request details:

1. Open **Edit draft / add evidence**, or **Revise rejected request**.
2. Correct the title, business need, vendor, quantity or price. Select the evidence classification and upload the missing PDF or supported image.
3. Save the revision. The request identifier is retained. Previous request, approval, exception, route and sourcing snapshots are archived; exception references still identify the original retained approval decisions. Sourcing responses and their evidence are not deleted.
4. Procurement must confirm the route again before submission. Old exception packs are superseded, and failed sourcing attempts are closed as cancelled while their prior state remains archived. Earlier routing, exceptions and approval decisions must not be reused for materially changed facts. Required exceptions must be reviewed again and submission builds a fresh named approval ladder.

Only the requester with current creation authority may revise. A changed revision requires reload. Active sourcing or purchase orders block revision. Retained exception-approval history no longer blocks an otherwise eligible revision. The new editor requires the live service; preview mode does not claim to save a governed revision.

## Approval Queue And Authority

**Waiting on you** is proposed to use server eligibility, not a shared tier label alone. A decision requires the next pending named assignment, an active profile, a currently effective and unexpired role assignment, an active role definition, the required role capability, and current certification or the existing governed certification exception.

- Department Head: current Procurement approver role.
- Procurement Head: current Procurement officer or admin role.
- Finance tier: current Procurement finance role.
- Final Approver: current Procurement admin role.
- Legal tier: current Legal role carrying review-accreditation capability, with Legal live authority.

An active Finance role plus an expired admin grant does **not** confer final-approval authority. Future grants, inactive role definitions and inactive profiles do not qualify. Requesters cannot decide their own requests. Approvals still require the existing electronic signature contract. A denial is not permission to use another person's account or a broader role.

## Legal Case Review

Accreditation cases are the default workspace. The candidate uses a compact heading and count filters for **Waiting on vendor**, **Waiting on Legal**, **Ready for decision**, and **Renewals**, retaining the **Waiting on you** total. Select a count to filter the case list and clear the selected filter to return to all cases. **Vendor lifecycle** opens the separate lifecycle controls; selecting it does not grant additional authority. The compact layout addresses the observed mobile first-case visibility gap; final deployed bounds above the bottom navigation still require verification.

**Request correction** is proposed to remain available for an eligible submitted/under-review case even when all document requirements are present. Legal supplies a factual correction note. The correction remains bound to the submitted source version.

**Record manual reminder** records follow-up activity only. It does not send an email or establish delivery. Contact the vendor through the approved channel separately. Historic reminder labels are not evidence that an automatic message was delivered.

In this candidate, the case banner and sticky next action count **requirements**, including both missing uploads and agreements needing signatures. The vendor home preserves the document/agreement split: three missing documents plus one unsigned agreement correspond to **4 requirements remaining** in the case. Uploading documents or signing the agreement updates both views; one outstanding item reads **1 requirement remaining**. Local component/store tests verify these transitions, not live upload delivery, browser captures, or deployment of this label change.

## Vendor Correction Working Copy

After Legal requests a source-bound correction, the submitted source initializes an editable working copy. A new signature is required for submission; the original submitted snapshot is retained. Reloading an ordinary submitted application still leaves it read-only.

Discarding a draft does not erase its audit/version history. A new draft starts with the retained concurrency cursor. On a stale-version error, reload and review the current application before continuing; do not repeatedly submit stale content.

## Payment Evidence Preparation

Proposed preparation uses **uploaded document selections**, not arbitrary private-path text. Each document is bound to the purchase order, vendor, purpose and acceptance-evidence version. Invoice, acceptance and tax support are required; foreign-vendor controls follow accreditation jurisdiction, not whether the request imports goods.

Procurement and authorized Finance readers use protected **Open document** controls. Payment attachments must not become visible to ordinary request readers merely because they share the request's private storage bucket. Missing, stale, mismatched or unavailable evidence blocks preparation. A prepared pack is not a payment release. The review_payment_readiness capability exists in the registry/UAT roles; the current SQL review path checks view_finance, which is the authority used for this candidate's Finance evidence access.

Invoice identity is normalized per vendor across purchase orders. Case and whitespace variants cannot create another payable identity. Returned corrections must identify the latest invoice lineage. A paid invoice replacement requires Finance reconciliation; this candidate must not create a fresh payable balance from a stale paid invoice. Historical duplicates have not been reconciled by this work.

## Vendor Purchase Orders

The candidate queue exposes commercial line items, total, supplied terms, expected delivery and visible revision, with **Back to vendor portal** and **Sign out**. Unspecified terms are not invented.

Open the purchase order before acknowledgement. The command must include the current content hash and expected lifecycle revision. The hash is retained in the lifecycle event, and existing replay/order/vendor checks remain active. A changed or unavailable order requires refresh and review. Navigation alone must not acknowledge an order.

## Reading Incomplete Metadata

**Unknown** receipt quantity and **Size unavailable** are explicit missing-data states, not zero receipts, completed acceptance, or proof that a file is valid. Activity attribution should wrap on narrow screens without removing the actor identity.

## Publication Gate

Before merging this supplement into the main manual: test the full deployed schema and RLS/certification chain in an isolated environment, verify signed downloads as Procurement and Finance, complete supported mobile/keyboard journeys, and obtain release-owner acceptance. The local F03 regression executes the prior restrictive FK and submission-ladder implementation, but does not replace these release gates.
