# Procurement / Legal / Finance UX Remediation

Workspace: C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding

## Implemented

- UX04: scoped, latest-request-wins reads; durable failure/retry instead of successful-empty states for audited Legal case/checklist/document/signature sources, Procurement requests/POs and vendor acknowledgements. Missing PO/case/instrument URLs remain available for diagnosis. Legal application and lifecycle reads and Finance source binding have persistent retry.
- UX08: Applications and Purchase orders are persistent vendor destinations; existing vendor-only PO access and return path remain.
- UX09: named policy controls, supported evidence formats, labeled business fields, field validation, and existing request-attachment selection. Import plan serializes the seven existing server fact keys. Submission/review RPC contracts are unchanged.
- UX10/16: Finance queue/next-pack links retain PO identity and target the payment section. Cold-load focus and scroll verified at desktop/mobile; Back to Finance is visible. PO, Legal case and Finance have section navigation; record/request headers are compact.
- UX14: Legal lifecycle is URL-backed with view=lifecycle, preserving filter query and browser history. Invalid bucket filters fall back to all. Unsaved form drafts are not put in URLs.
- UX19: removed the duplicate primary-style Cancel in request creation; footer sequence/validation retained.
- UX20 module coordination: tier-only approvals return to My Work; full Procurement retains Back to requests. Parent owns shell Legal reviewer admission and login query preservation.
- UX21: explicit recovery button awaits signOut before login navigation; safe current vendor path/query preserved. No arbitrary login query signs users out.
- UX25: authorized Finance receipt source view at /finance?receipt=ID, with return to the same prebound source draft. Registered evidence metadata uses existing authorized lookup; already-bound close evidence uses the existing protected opener. It is a source summary with explicit Warehouse ownership handoff, not a full receiving/QC viewer. No receive_stock grant or receiving mutation path. created_at-derived source timestamp is labeled Recorded on.
- UX26: Finance loader has status semantics and a meaningful loading announcement.

## Validation

- Final parent verification: parent reviewed the candidate migration and regression test, independently reran PGlite under Node 24 (9 passed, 0 failed), and reported all other module full suites passing under Node 24 (877 tests total). These are parent-reported independent results; the earlier local checks below remain recorded for traceability. Implementation is complete; the migration remains unapplied.
- Procurement full suite passed 229 tests before the final PO isolation follow-up. Post-follow-up focused checks passed: 9 PO/readiness tests, 2 policy form interaction tests, and 3 scoped read tests. The earlier 2 policy contract tests also passed.
- Legal full suite passed 180 tests. After application retry and scope follow-ups, 12 focused tests passed; final scoped-read recheck passed 3.
- Finance full suite passed 70 tests. Final FinanceApp/receipt scope recheck passed 13.
- Module tsc --noEmit passed for Legal, Procurement and Finance; Procurement was rerun after the readiness-isolation change. Parent owns final combined typecheck/build.
- git diff --check passed for these modules. The installed command runtime reports Node 20 / pnpm 9 against repository Node >=22 / pnpm 10 requirements; tests nevertheless passed. No dependencies were changed.
- Candidate browser: localhost:3022 with UAT accounts, authentication and read-only navigation only. No operational submissions, acknowledgements, signatures, upload, receiving, role changes or deploy.
- Legal desktop/mobile: correct My Work back link, no mobile overflow; lifecycle survives reload; explicit account switch reaches usable login preserving /vendor/. No page errors.
- Finance observed receipt UAT-AUG24-RECEIPT-QC-PENDING: authorized summary at 1440/390, Recorded on, exact return source, no receiving link or mutable inputs, no overflow/page errors. This source returned no registered evidence; UI reports that fact.
- Finance payment handoff: final fresh-mobile-login run focuses #payment at both widths; section top 289.796875px desktop, 112.015625px mobile, visible Back to Finance. No page errors. Earlier desktop run measured approximately 416px; the machine-readable final result records the final run only.
- Fresh Finance 390px cold login succeeded with auth token HTTP 200 and destination /. Parent's earlier repeated-login timeout was not reproduced; its cause is not proven.
- Parent role-smoke-retest/results.json confirms Procurement new-request and HANDBOOK-T7-R1-PO detail pass at both widths.

## Historical Readiness Finding

The prior blanket PO error came from Promise.all over readiness for every PO. Eight historical request IDs return HTTP 400, code P0001, message Procurement request not found. Parent read-only live SQL subsequently confirmed all eight rows EXIST with requester_id NULL. This is not a deleted-record diagnosis: the Aug22 wrapper regressed Aug16's FOUND-based existence test by treating a NULL owner as a missing row before checking live control access.

An independent read-only pg_get_functiondef check on UAT project kkoitlvydytdhlpxhuah verified the current live wrapper body matches the Aug22 migration after whitespace normalization. Owner is postgres; EXECUTE ACL is postgres, authenticated and service_role only. Live still includes the requirements projection and the nullable auth.uid() = requester_id acceptance expression.

Exact affected request IDs:

- `UAT-SEP07-REQ-0005`
- `UAT-SEP07-REQ-0006`
- `UAT-SEP08-TESTER1-REQ-0005`
- `UAT-SEP08-TESTER1-REQ-0006`
- `UAT-SEP08-TESTER2-REQ-0005`
- `UAT-SEP08-TESTER2-REQ-0006`
- `UAT-SEP08-VERIFY-REQ-0005`
- `UAT-SEP08-VERIFY-REQ-0006`

Readiness is now isolated per PO in the UI. A different record's failure cannot hide HANDBOOK-T7-R1-PO. A failed selected prerequisite is shown inline with Retry while its known PO/receipt/evidence details remain readable; approval/issue requiring that prerequisite stay disabled. No success/empty state is fabricated.

Candidate-only database fix: [20260911060022_restore_ownerless_commitment_readiness.sql](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/supabase/migrations/20260911060022_restore_ownerless_commitment_readiness.sql). It restores FOUND detection, permits ownerless reads only through the same three existing live control capabilities, explicitly denies NULL auth.uid(), and retains the unchanged call to private.procurement_commitment_readiness. The Aug22 requirements expression is unchanged. canRecordAcceptance is coalesced to false for NULL ownership unless an explicit active reviewer assignment exists. Existing owner/self acceptance behavior remains. Postgres ownership, SECURITY DEFINER, VOLATILE, empty search_path and authenticated/service_role grants are retained. No owner rows are assigned; no historical migration was edited.

Regression: [commitment-readiness-boundary.pglite.test.mjs](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/procurement/commitment-readiness-boundary.pglite.test.mjs). Command: node --test modules/procurement/commitment-readiness-boundary.pglite.test.mjs. Result: 9 passed, 0 failed. It discovers and executes the actual latest historical wrapper, reproduces the ownerless failure, applies only the candidate in isolated PGlite, and checks all three live capabilities, ordinary denial, live capability revocation, true not-found, anonymous/NULL-uid denial, private-helper denial propagation, explicit/superseded assignments, nullable acceptance false, requirements retention, unchanged owner rows and ACL/security metadata.

## Open Gaps

- The new ownerless-readiness migration is CANDIDATE ONLY and has not been applied to any live database or deployed. Parent has reviewed the candidate; any application still requires separate authorization. Historical request ownership is intentionally unchanged. The regression harness tests the actual wrapper with a controlled private-policy fixture; it does not reimplement or replace the production private authority.
- Receipt line/QC details beyond Finance's authorized summary still require a Warehouse-provided receipt pack. The observed receipt has no registered evidence; protected opening of populated evidence was covered in existing/unit tests, not exercised live.
- No live fault injection or transactional end-to-end submission was performed. New policy form behavior was exercised with isolated mocked submission.
- Section navigation/compactness is implemented on the audited module surfaces, not a replacement of every governance form/template. No new draft-in-URL state or global design-system changes.
- Some read failures deliberately hide failed-source rows rather than display stale records; they preserve the route/filter context and explicit retry, without carrying data across account/access changes.
- Parent's full build remains pending. Shared dev servers were not stopped or rebuilt.

## Browser Artifacts

- [Final Finance retest JSON, including the eight exact historical request IDs](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/outputs/sep11-ux-remediation/finance-final-retest.json)
- This JSON transcribes observed browser-worker stdout. Browser run timestamps were not emitted and remain null; only the evidence file creation time is recorded.

- [legal-approvals-1440.png](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/outputs/sep11-ux-remediation/legal-approvals-1440.png)
- [legal-approvals-390.png](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/outputs/sep11-ux-remediation/legal-approvals-390.png)
- [legal-lifecycle-390.png](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/outputs/sep11-ux-remediation/legal-lifecycle-390.png)
- [procurement-po-diagnostic.png](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/outputs/sep11-ux-remediation/procurement-po-diagnostic.png)
- [finance-receipt-1440.png](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/outputs/sep11-ux-remediation/finance-receipt-1440.png)
- [finance-receipt-390.png](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/outputs/sep11-ux-remediation/finance-receipt-390.png)
- [finance-payment-section-1440.png](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/outputs/sep11-ux-remediation/finance-payment-section-1440.png)
- [finance-payment-section-390.png](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/outputs/sep11-ux-remediation/finance-payment-section-390.png)

## Exact Changed Paths

- [modules/finance/src/FinanceApp.test.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/finance/src/FinanceApp.test.tsx)
- [modules/finance/src/FinanceApp.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/finance/src/FinanceApp.tsx)
- [modules/finance/src/components/FinanceActivityTable.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/finance/src/components/FinanceActivityTable.tsx)
- [modules/finance/src/components/FinanceClosePanel.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/finance/src/components/FinanceClosePanel.tsx)
- [modules/finance/src/components/FinanceReviewQueue.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/finance/src/components/FinanceReviewQueue.tsx)
- [modules/legal/src/LegalApp.accessDenied.test.ts](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/legal/src/LegalApp.accessDenied.test.ts)
- [modules/legal/src/LegalApp.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/legal/src/LegalApp.tsx)
- [modules/legal/src/components/VendorLifecyclePanel.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/legal/src/components/VendorLifecyclePanel.tsx)
- [modules/legal/src/localStore.ts](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/legal/src/localStore.ts)
- [modules/legal/src/pages/AccreditationCasesPage.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/legal/src/pages/AccreditationCasesPage.tsx)
- [modules/legal/src/pages/CaseDetailPage.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/legal/src/pages/CaseDetailPage.tsx)
- [modules/legal/src/pages/SignInstrumentPage.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/legal/src/pages/SignInstrumentPage.tsx)
- [modules/legal/src/pages/VendorApplicationPage.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/legal/src/pages/VendorApplicationPage.tsx)
- [modules/procurement/src/components/VendorPurchaseOrderAcknowledgements.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/procurement/src/components/VendorPurchaseOrderAcknowledgements.tsx)
- [modules/procurement/src/localStore.ts](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/procurement/src/localStore.ts)
- [modules/procurement/src/pages/ApprovalInboxPage.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/procurement/src/pages/ApprovalInboxPage.tsx)
- [modules/procurement/src/pages/CreateRequestPage.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/procurement/src/pages/CreateRequestPage.tsx)
- [modules/procurement/src/pages/PODetailPage.test.ts](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/procurement/src/pages/PODetailPage.test.ts)
- [modules/procurement/src/pages/PODetailPage.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/procurement/src/pages/PODetailPage.tsx)
- [modules/procurement/src/pages/PurchaseOrdersPage.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/procurement/src/pages/PurchaseOrdersPage.tsx)
- [modules/procurement/src/pages/RequestDetailPage.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/procurement/src/pages/RequestDetailPage.tsx)
- [modules/procurement/src/pages/RequestsPage.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/procurement/src/pages/RequestsPage.tsx)
- [modules/finance/src/components/ReceiptSourceView.test.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/finance/src/components/ReceiptSourceView.test.tsx)
- [modules/finance/src/components/ReceiptSourceView.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/finance/src/components/ReceiptSourceView.tsx)
- [modules/finance/tests/receiptReadOnly.browser.mjs](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/finance/tests/receiptReadOnly.browser.mjs)
- [modules/legal/src/accountRecovery.test.ts](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/legal/src/accountRecovery.test.ts)
- [modules/legal/src/accountRecovery.ts](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/legal/src/accountRecovery.ts)
- [modules/legal/src/useReadQuery.test.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/legal/src/useReadQuery.test.tsx)
- [modules/legal/src/useReadQuery.ts](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/legal/src/useReadQuery.ts)
- [modules/procurement/src/components/PolicyEvidenceForm.interaction.test.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/procurement/src/components/PolicyEvidenceForm.interaction.test.tsx)
- [modules/procurement/src/components/PolicyEvidenceForm.test.ts](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/procurement/src/components/PolicyEvidenceForm.test.ts)
- [modules/procurement/src/components/PolicyEvidenceForm.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/procurement/src/components/PolicyEvidenceForm.tsx)
- [modules/procurement/src/readinessReads.test.ts](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/procurement/src/readinessReads.test.ts)
- [modules/procurement/src/readinessReads.ts](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/procurement/src/readinessReads.ts)
- [modules/procurement/src/useReadQuery.test.tsx](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/procurement/src/useReadQuery.test.tsx)
- [modules/procurement/src/useReadQuery.ts](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/procurement/src/useReadQuery.ts)
- [modules/procurement/tests/poReadOnlyDiagnostic.browser.mjs](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/procurement/tests/poReadOnlyDiagnostic.browser.mjs)
- [modules/procurement/tests/readOnlyUx.browser.mjs](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/procurement/tests/readOnlyUx.browser.mjs)
- [This handoff](C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding/modules/procurement/UX_REMEDIATION_HANDOFF.md)
