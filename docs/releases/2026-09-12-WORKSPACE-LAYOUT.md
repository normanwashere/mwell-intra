# September 12 Workspace Layout Release

**Transaction test input correction:** The live receipt harness now supplies the required actual delivery date for clean, exception and collision scenarios, checks the stored date, and verifies that a missing date leaves received quantity unchanged. The app requirement is not relaxed. The old run's receipt failure caused dependent Quality/Finance scenarios to fail; those require a fresh successful run. Vendor email delivery also reported a provider rate limit and remains a separate unverified external dependency.

**Focused deployed checks:** On `42c76c1`, Operations Associate and Operations Lead receiving screens passed external-link checks at 1440px, 390px and 320px: the original link remains available, no deliverylink.com image request fires, and the link control does not overflow. This is not full-page or full-role screenshot certification; the narrow header and long receipt metadata still need broader visual review.

**Quality live follow-up:** All six focused checks passed on the same build: complete metadata without Pending photo downloads, Completed-only evidence reads, persisted-photo decoding, recovery after an injected read failure, mobile record links, and loading offscreen photos on scroll. These checks do not establish maximum capacity or a real-user pilot.

**Evidence layout follow-up:** Mixed photo/link attachments get wider mobile columns and wrapping addresses. An isolated browser fixture using the real gallery and shared CSS verifies 1440px, 390px and 320px, zero external requests at load, and photo preview dismissal. Full live certification remains a separate pending gate.

**Certification follow-up:** CI now runs an early critical route gate and isolates each viewport's automation accounts so up to three route/visual jobs can run together. All six viewports and eleven roles remain covered; actual onboarding, authorization checks, screenshots and console errors remain strict. Transactions and cleanup stay sequential. Initial account setup takes extra time; full runtime improvement must be measured on the new run, not assumed.

**External evidence fix:** Older HTTPS delivery references appear as **External evidence** links rather than broken automatic photo requests. Uploaded photos still preview normally. No receipt, inspection result, evidence value or stock transaction is changed. An external URL does not imply that its contents have been verified.

## What Changed

**Task queue and CI follow-up:** Tasks now use inspection metadata without photos and keep failed reads visible for explicit retry, avoiding provider callback refresh loops. Task source links and business steps remain unchanged. CI bounds nested test concurrency without increasing deadlines or skipping assertions; the Events and Finance tests that timed out on the runner pass in isolated verification. Final CI status is recorded separately from live performance evidence.

**Performance follow-up:** Training eligibility queries now reuse PostgreSQL plans without caching permission results or changing authority predicates. Quality Control avoids starting an evidence-heavy download before warehouse startup replaces its data. All 22 Quality regression tests passed, and the isolated SQL test preserves results across 18 authority variants. On UAT, all 11 capability-output fingerprints match and 66 requester-name/return boundary probes still pass. The live database launch/read gates remain clear. Compare the seeded before/after browser and API runs separately; SQL timing alone does not certify screen performance or completed transactions.

**Authorization follow-up:** The UAT requester-name lookup and return-resolution entry point now use current role/training eligibility. The migration changes only five permission predicates in the deployed functions. Own-request names, requested-ID limits, private profile access, quarantine, delivery confirmation, Finance evidence and duplicate-submission handling remain intact. Cross-request name review requires current issuing or approval eligibility.

The final visual pass also corrects outlined dialog-action text in dark mode, including View original order. Contrast is checked against the rendered button background; destinations and actions are unchanged.

The approved layout now applies through the shared internal and vendor workspace containers, not just the three pilot screens. Page headers, section bands and dialog surfaces have clearer contrast in both themes. Status colors keep their existing meanings.

Desktop navigation can be hidden/restored and remains reachable while scrolling. My Work rows are more compact. Order details and intake have wider, grouped desktop layouts and mobile stacking; dialog action footers remain separate. PO amendment inputs align without changing their validation. Supported record copying and list-return convenience are included.

## Workflow Boundaries

The visual layout itself has no database, role, authorization, approval, inventory or payment command changes. The separately tested authorization follow-up above changes current eligibility checks, not business steps or role assignments. Existing seeded tester records remain intact. Unsaved warnings are limited to procurement browser exit/Cancel and order-intake failed local draft persistence; they do not cover every in-app navigation.

## Verification And Deployment

Authorization follow-up evidence: the new assertions first reproduced six missing-certification failures in the previous functions. After remediation, 24 isolated SQL tests passed, including authenticated execution, all five return outcomes, denial before writes, completed-case replay, atomic rollback and name privacy. On UAT, 66 read-only boundary probes passed across the 11 canonical test personas. These check permission outcomes and nonexistent-record rejection, not 66 completed transactions. The unchanged live launch verifier reports zero raw boundaries, missing objects and missing grants. Full CI certification remains a separate result; do not infer it from these focused checks.

The first CI attempt stopped at the production dependency audit. The follow-up raises Next.js to at least 16.3.3, sharp to at least 0.35.4 and csv-parse to at least 7.0.2, retaining the existing security gate. The mobile smoke assertion now checks the approved Status selector and order search, rather than desktop-only counters. No transaction assertion was relaxed. Validate the final dependency-patched build independently from earlier layout captures.

Deploy to the existing mwell-intra-uat project using its configured production-target environment. Verify the deployed commit, appEnv uat and Supabase reference kkoitlvydytdhlpxhuah. Capture the final live receipt and role-screen results as release evidence. This release note describes scope; it does not itself certify that deployment or every transaction passed.

Updated references: standalone operating handbook, training/operations manual, technical/functional specification, training handover and in-app navigation guidance. Historical screenshots retain their historical labels; fresh release screenshots belong in the live validation gallery.
**Quality Evidence and KB Performance Follow-up**

- Quality now reads complete inspection metadata without eagerly downloading all photos. Completed photos load on visibility and retain exact-record preview and retry. Preview buttons wait until their image URL is ready before accepting clicks. The full inspection API remains available to other consumers.
- The additive, SELECT-only summary view uses caller RLS. The original 493 inspection records and 6,385,637 bytes of evidence were unchanged by the migration, verified by an identical content hash.
- The KB server route is configured for Tokyo (`hnd1`), near UAT Supabase (`ap-northeast-1`), instead of Virginia. Server authentication and vendor/employee content boundaries are unchanged.
- Removed in-app article dependencies from the standalone operating handbook. The strict launch-artifact gate now passes locally; it has not been relaxed.
- Local focused checks: 46 Quality component/page/queue tests, 47 repository tests, 81 knowledge-content tests and the new database RLS/evidence test pass. All-workspace typecheck passes. Live before/after measurements and full CI remain separate release checks; this is not a maximum-capacity certification.
