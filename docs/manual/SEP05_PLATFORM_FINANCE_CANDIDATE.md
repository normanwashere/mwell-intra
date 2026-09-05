# September 5 Platform and Finance Candidate

**UAT release candidate: deployed September 5; end-to-end acceptance pending.** These procedures describe the current UAT implementation at https://mwell-intra-uat.vercel.app. The matching migrations are installed. Main production has not been promoted, and deployment alone does not certify every transaction, role, or evidence-delivery path.

## Finance Review

### Certification 153 Follow-up

Certification 153 remains failed. Run-scoped request cleanup has a service-role-only UAT function that removes approval children before parent requests, preserving ordinary retention permissions. It rejects malformed markers and linked purchase orders. The 12 requests left by run 153 were removed; the other four requests retained their ID/revision fingerprint. This is not a full cross-entity residue certificate.

Department actions are being rearranged below their details on narrow mobile screens. The DOA audit must wait for workspace loading to finish and Save draft to become enabled before tapping. These app and audit follow-ups remain pending deployment and full live rerun.

Release maintenance also pins Browserslist to patched 4.28.7 following the September 5 CI dependency scan. The production dependency audit is clean after that change. This does not change user permissions or business procedures, and does not replace live journey acceptance.

Payment cards show invoice identity, due date or an explicit unavailable label, and waiting age. The hero and queue use the same ordering: ready packs and accepted packs with an unpaid balance first, then due date, oldest preparation, and stable identity. Accepted is not the same as released. Ordering still requires business-owner confirmation.

Activity totals are calculated on the server for the displayed month-to-date period. Detail records are retrieved in stable server pages. Unauthorized sources say **Not in your scope**; failed sources say **Unavailable** and offer retry instead of claiming zero or an empty operational queue.

Source-specific retry is implemented locally and requires a new app deployment and UAT acceptance. It reloads only the failed source and its dependencies (payment packs plus orders; inventory plus products; activity plus period totals). Successful metrics, activity filters, and selection remain visible within the same authorized scope. Only the retried source's warnings are replaced. An actor or capability change hides previous-scope data immediately; late responses cannot restore it. The deployed version must not be assumed to have this behavior until redeployed and verified.

## Close Preparation and Correction

Live preparation uses a permission-scoped business-reference picker and locks the canonical type, ID, module, and reference. Purchase orders, warehouse receipts, and posted payment releases can be selected by business reference without copying UUIDs. Release lookup requires both certified Finance-close preparation and Procurement finance-read capability; it does not grant direct table access. Other manual source kinds are explicitly blocked with a supported alternative or governed upstream route. No new source types are introduced.

Select eligible source-bound registered evidence or upload a governed file. The source is reauthorized when the form is submitted, including when a source-close link prepopulates the form. Inaccessible or changed source identity blocks preparation. Signed download URLs are never saved in browser drafts.

Use **Flag** to enter a fresh required reviewer reason for a draft or ready entry. The saved reason includes reviewer attribution. Eligible non-Event draft, ready, and exception entries expose **Edit and resubmit** under the same entry ID and expected version. A rejected or stale save retains entered values. Posted and reconciled entries remain immutable.

Posting requires an independent Finance actor. Reconciliation excludes the preparer and poster; Event close actions also exclude the settlement approver. Disabled reasons identify the needed independent actor. Event settlement corrections remain upstream governed work, not manual Finance rewriting. Counts and returns are not new canonical close-source types in this candidate.

Read-only Finance users can request authorized evidence inspection without gaining preparation or posting rights. The server resolves the entry's registered evidence and checks its source. Supported private files are delivered with five-minute signed URLs; missing, expired, mismatched, or restricted evidence fails closed. Receipt/payment-release inspection can open its governed business record rather than invent a document file.

Payment-read visibility follow-up, pending the next frontend deployment: on the owning Procurement PO, payment-document lookup requires an employee with effective Procurement `author_po`, `admin`, or `view_finance`. A restricted Operations PO/acceptance viewer keeps the existing acceptance workflow but sees **Payment evidence is not in your scope** without fetching private payment documents. Read-only Finance retains authorized previews without gaining mutation rights. Genuine authorized lookup failures remain visible; an access change discards pending old responses. This caller correction changes no SQL authority and requires no new migration. Parent will verify OpsLead at both viewports after deployment; no new screenshot capture is claimed here.

## Product and My Work

Product readiness and pricing cards show the recorded decision reason, actor, and time. Approved readiness distinguishes pending Operations handoff from completed acknowledgement, with actor/time attribution. The follow-up **Link to this record** control anchors to the individual card and has a thumb-sized target. It replaces the misleading history label; this is current-version readback, not a complete multi-event history viewer. Confirm the follow-up deployment before using its new label in training.

My Work adds Product decisions, Operations handoffs, independent Finance posting/reconciliation, and owned Leadership follow-ups while preserving the previous domain projections. Future deadlines use **Due in**, today's deadlines use **Due today**, and past deadlines use **Overdue by**, with exact Philippine-calendar dates.

Leadership follow-ups are visible to the requester and authorized owner. Finance ownership uses its real underlying Warehouse/Procurement capabilities. Owners acknowledge then resolve with a controlled resolution-record reference. Actor/time and resolution survive reload. Unrelated employees cannot read or transition these records. Uncertain request retries retain a stable command key.

## Access and Administration

Live Finance, Product, and Insights admission follows effective capabilities; static role mappings remain for memory mode only. Assigned but uncertified actions display an onboarding route instead of inviting a predictably rejected write. Database certification and separation-of-duties enforcement remain authoritative.

Admin directory search, status, user type, page counts, and complete role arrays are supplied by the server. Failed/incomplete authority reads prevent role editing. Filters stay available during loading and no-results states. Matching-user totals are distinguished from current-page grant/vendor counts. Mobile role labels wrap; the user-type default is **All user types**.

## Deployment and Verification Boundary

- UAT already has the Finance migration followed by the separate My Work union migration. For a new environment, apply `20260905091000_platform_finance.sql` before `20260905091001_platform_work_union.sql`. Reconcile the installed names and definitions before replaying migrations. The union preserves the installed prior My Work function and rebinds its view.
- Maxwell review corrections reject NULL/out-of-range page sizes and compare TEXT document IDs with UUID action-evidence IDs through explicit text casts.
- Current evidence: isolated actual-migration PGlite regression passes, including posted payment-release reference search with direct table SELECT revoked; Finance 59 tests, Product 18, Work 9, Insights 24, shell navigation 26 and protected evidence API 3 tests passed. The shell typecheck passes after correcting Warehouse ownership to resolve_exceptions. See the remediation manifest for subsequent updates.
- Latest Finance suite passes 60/60, including payment-release business-reference selection and submission-time reauthorization failure. Actual migration PGlite rerun passes.
- Full prerequisite-schema migration replay, complete storage/certification/SoD chain, and authenticated desktop/mobile acceptance remain release gates. Local port 3017 demo UI was inspected at 1440x900 and 390x844 after normal profile sign-in and actual orientation completion, without auth injection or live transaction writes. Payment identity/aging and close drawer fit without page-level horizontal overflow; evidence images are in `outputs/sep05-remediation/platform-finance-*.png`. Demo manual fields do not verify the live canonical picker.
- UAT deployment does not mean every audit acceptance criterion is closed or untested source kinds are supported. Main production is not promoted.

Canonical findings and current residuals: `outputs/sep05-remediation/platform-finance.md` (PF-01 through PF-12; PV-01, PV-02, PV-05; PV-03/PV-04 confirm PF-08/PF-11).
