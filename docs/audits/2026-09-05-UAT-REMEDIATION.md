# September 5 UAT Audit Remediation

Status: application/security patch commit 2b61b45945ae402afcfa46d40ea884d1a76842fd deployed to UAT; live journey acceptance in progress. Target is mwell-intra-uat.vercel.app and Supabase kkoitlvydytdhlpxhuah only. Main production is untouched.

## Scope

The 53 canonical audit findings are assigned across Procurement/Legal, Platform/Finance, Warehouse/Event integrity, capture/offline workflows, and shared UI/control queues. Duplicate observations retain their canonical mapping. Existing tester seed data is not disposable audit data.

## Completed Local Checks

- Final full workspace run passed all 15 package test suites, including 643 warehouse tests. All 15 package typechecks passed. Earlier navigation-contract, dashboard timing, and grouped Quality list regressions were corrected and retested.
- Quality list semantics were restored; the serial return handoff regression then passed. The expectation now counts actionable inspections rather than counting both receipt groups and child list items.
- Follow-up parent suite passed 31 tests covering Quality, tasks, approvals, and exceptions, including retry after failed reads and blocking approvals when source-count context is missing.
- Governed PO receiving's existing 30 tests passed; a new sticky-requirement focus test passed separately.
- Updated knowledge content, graph and validation tests: 231 passed across 17 files, including the revised Procurement, Legal, Finance, Product and Insights procedures.
- Actual local browser screenshots reviewed for Quality search and inspection at desktop 1440 and mobile 390. Mobile search was widened after visual review; filtered counts explicitly show the subset versus the whole queue. These are demo-mode UI evidence, not live transaction certification.

## Integration Findings Caught During Remediation

- Finance paging must reject a NULL limit rather than allowing an unbounded query: fixed with a negative SQL test.
- Finance evidence joins must support the actual TEXT document ID and UUID action-evidence ID: fixed and tested against those actual types.
- Current-tier procurement authority must reject expired/future/inactive assignments even when another role supplies a generic capability: revised and tested against prior authorization functions.
- Procurement request revision retains approval IDs and signed history while constructing a fresh approval ladder. The actual foreign-key regression and prior submission implementation pass the focused SQL checks.
- Authenticated database roles retained TRUNCATE grants on custody tables. The narrowly scoped forward migration was applied and passes six grant regressions; no destructive live probe was performed.
- Exact count source retrieval now uses an authorized ID lookup beyond the bounded history snapshot. Both approval and count-detail pages distinguish loading, missing, and failed reads and support retry. The combined approval/count/return suite passes 48 tests.
- Accepted stock now generates putaway tasks from remaining, unheld staging stock. Task completion follows actual stock movement rather than a separate manual completion flag. Live projection readback and actual-view RLS tests passed; governed transaction certification remains pending.
- The obsolete return RPC accepted caller-authored writes and had incompatible allocation completion ordering. It is now retired with an explicit recovery error before any write; the current application uses the governed v2 path. The actual legacy wrapper plus v2 permission/quarantine/replay regression passes.

## Applied UAT Migrations

The Supabase migration tool assigned the following installed versions. Repository filenames retain their authored versions; do not blindly replay the entire historical pending list or these already-applied candidates. Match installed names and definitions before any subsequent migration sync.

| Installed version | Migration name |
| --- | --- |
| 20260905044838 | warehouse_custody_truncate_least_privilege |
| 20260905044850 | warehouse_putaway_tasks |
| 20260905044857 | procurement_remediation |
| 20260905044907 | platform_finance |
| 20260905044920 | platform_work_union |
| 20260905044928 | warehouse_integrity |
| 20260905044939 | offline_replay_identity |
| 20260905051207 | receiving_draft_explicit_live_authority |
| 20260905051228 | return_intake_certified_boundary |
| 20260905051937 | quality_inspection_verifier_chain |

Readback confirmed authenticated TRUNCATE=false and service-role TRUNCATE=true for all four targeted custody tables; the legacy return entry point contains the retirement guard. Security-invoker task and event-custody views remain enabled. Read-only projections returned 102 tasks, 3 event-custody rows, and 0 lineage-audit issues at verification time. These counts are not transaction certification.

The latest combined selected SQL suite passed 54 tests. A production application build passed. The service-key security check was not run locally because the CI-only vaulted credential is absent; it must run through the guarded UAT certification workflow.

Public UAT health verified the exact deployed commit, APP_ENV=uat, Supabase kkoitlvydytdhlpxhuah reachable, real Supabase client authentication, accessible static assets, and configured notification, vendor-invite, legal-document and service-worker features. Live vendor workspace and case detail were visually reviewed without modifying its seeded case.

The first CI certification run 33945783269 correctly stopped at two high-severity Browserslist advisories (GHSA-c83g-rgw3-j3cx and GHSA-73wf-gq98-2v4g), before persona or transaction changes. The follow-up pins the transitive dependency to patched 4.28.7; the updated production dependency audit reports zero advisories at every severity. Its build and UAT deployment passed; renewed certification is pending. No security gate was disabled.

Direct installed-metadata review additionally found redundant raw-capability checks in two receiving-draft helpers and the return-v2 entry point, plus an outdated quality-inspection delegate assertion. The existing runtime already had live-certification checks. Separate forward migrations make the exposed authority boundaries explicit while retaining ownership, versioning, quarantine and replay controls. The combined receiving/return regression passes 51 tests. Quality verification now recognizes the reviewed guarded v3 chain rather than restoring the obsolete direct-v2 dispatch; 24 verifier tests pass, including malformed-response rejection and detection of removed guards. Post-apply read-only database verification returned raw_boundaries=0, examples=[], missing_objects=[], missing_grants=[], qualityChain=true. This was direct database metadata/RPC verification under a transaction-local verifier role claim, not the still-pending CI HTTP service-key check.

## Live Desktop Route Audit

All 11 UAT test roles signed in successfully at 1440 pixels. Ten roles completed without detected route-expectation failures, overflow, overlaps, console errors or network errors. Operations Lead completed the expected navigation checks but encountered HTTP 400 from procurement.payment_evidence_options. The caller now checks the same employee/effective-capability boundary as the server, cancels stale results, and retains authorized reviewer errors. All 210 Procurement tests pass, including nine admission regressions. The original live run remains failed until the frontend fix is deployed and retested. Read-only route coverage does not certify transaction handoffs or physical-device ergonomics.

Actual live Operations Associate mobile putaway and desktop procurement-receiving screenshots were captured and visually reviewed. The dialogs retain visible identity, validation and action controls. Other captured screens require their own recorded review; screenshot existence alone is not acceptance.

## Documentation Verification

The standalone handbook includes 34 maintained sources, with Procurement/Legal, Platform/Finance, and Warehouse/Events guides. All 40 documentation generator tests pass. Updated procedures distinguish UAT deployment from pending end-to-end acceptance and are not represented as live transaction evidence.

## Remaining Release Gates

1. Resolve every newly reproduced blocker and run the combined module, SQL, permission and recovery regressions again.
2. Finish desktop/mobile visual review of changed screens, including negative and missing-source states.
3. Regenerate the standalone handbook and verify the release documentation against the final candidate.
4. Review and apply migrations in order only to UAT, then deploy the matching application code.
5. Confirm the exact deployed commit and UAT database, then execute role-based live read/write/handoff/replay checks using isolated records. Do not treat local test totals as live certification.

Per-domain working evidence and screenshots are in outputs/sep05-remediation. The original audit remains in outputs/sep05-audit.
