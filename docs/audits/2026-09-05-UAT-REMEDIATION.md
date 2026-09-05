# September 5 UAT Audit Remediation

Status: application/security and documentation patches through d0c98a890b89d2e4c2becef290458a4d9635837f deployed to UAT; a further acceptance-driven correction is being verified. Target is mwell-intra-uat.vercel.app and Supabase kkoitlvydytdhlpxhuah only. Main production is untouched. This is not a completed live-transaction certificate.

## Scope

The 53 canonical audit findings are assigned across Procurement/Legal, Platform/Finance, Warehouse/Event integrity, capture/offline workflows, and shared UI/control queues. Duplicate observations retain their canonical mapping. Existing tester seed data is not disposable audit data.

## Completed Local Checks

- Latest full workspace run passes all 45 test/lint/typecheck tasks, including 666 Warehouse tests. Earlier navigation-contract, dashboard timing, grouped Quality list, and obsolete KB retry assertions were corrected and retested. The separate handbook checks pass 83/83; audit/browser contracts pass 114 with one explicit skip. Counts from overlapping runs must not be added as unique cases.
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

The combined selected SQL suite passed 54 tests. A production application build passed. The CI-only vaulted service-key security check subsequently passed in guarded UAT run 33947512758; the credential was not exported locally.

Public UAT health verified the exact deployed commit, APP_ENV=uat, Supabase kkoitlvydytdhlpxhuah reachable, real Supabase client authentication, accessible static assets, and configured notification, vendor-invite, legal-document and service-worker features. Live vendor workspace and case detail were visually reviewed without modifying its seeded case.

The first CI certification run 33945783269 correctly stopped at two high-severity Browserslist advisories (GHSA-c83g-rgw3-j3cx and GHSA-73wf-gq98-2v4g), before persona or transaction changes. The follow-up pins the transitive dependency to patched 4.28.7; the updated production dependency audit reports zero advisories at every severity. Its build and UAT deployment passed; renewed certification is pending. No security gate was disabled.

Direct installed-metadata review additionally found redundant raw-capability checks in two receiving-draft helpers and the return-v2 entry point, plus an outdated quality-inspection delegate assertion. The existing runtime already had live-certification checks. Separate forward migrations make the exposed authority boundaries explicit while retaining ownership, versioning, quarantine and replay controls. The combined receiving/return regression passes 51 tests. Quality verification now recognizes the reviewed guarded v3 chain rather than restoring the obsolete direct-v2 dispatch; 24 verifier tests pass, including malformed-response rejection and detection of removed guards. Post-apply read-only database verification returned raw_boundaries=0, examples=[], missing_objects=[], missing_grants=[], qualityChain=true. This was direct database metadata/RPC verification under a transaction-local verifier role claim, not the still-pending CI HTTP service-key check.

## Live Desktop Route Audit

All 11 UAT test roles signed in successfully at 1440 pixels. Ten roles completed without detected route-expectation failures, overflow, overlaps, console errors or network errors. Operations Lead originally encountered HTTP 400 from procurement.payment_evidence_options. The deployed caller now checks the same employee/effective-capability boundary as the server, cancels stale results, and retains authorized reviewer errors. All 210 Procurement tests pass, including nine admission regressions. The d0c98a8 Operations Lead retest at 1440 and 390 pixels recorded zero network or console errors, resolving that failure. It separately retained a closed-disclosure audit-targeting failure on desktop and two undersized Product links on mobile. Neither was silently excluded from the report.

The follow-up corrects disclosure visibility/readiness in the audit, preserves its genuine obstruction checks, and supplies six real-browser harness tests. Product links now truthfully identify record permalinks and have a 44px minimum height. Their deployed geometry still requires a fresh screenshot check. Read-only route coverage does not certify transaction handoffs or physical-device ergonomics.

Further acceptance tests reproduced and corrected Finance retries hiding successful sources, exact Quality inspections losing priority to legacy records, and a vendor count incorrectly describing agreement requirements as uploads. Finance actor/capability changes discard stale results and late callbacks; Quality conflicting identifiers block actions with an explicit retry instead of crashing or showing a false empty queue. Focused acceptance covers seven Finance recovery/identity cases, 32 Quality cases including 101 repository-created holds, 33 PO receiving cases including a 400-unit serial draft, and seven new Legal component cases within its 174-test suite. These are local acceptance checks, not substitutes for the pending live write/read/handoff run.

CI run 33947512758 passed dependency, deployed schema/runtime authority, lint, typecheck, unit/contract tests and build. It was deliberately cancelled during CodeQL before persona reconciliation or transactions while these additional defects were corrected. No transaction cleanup was required by that cancelled run. A new commit-bound certification must finish before declaring complete acceptance.

Actual live Operations Associate mobile putaway and desktop procurement-receiving screenshots were captured and visually reviewed. The dialogs retain visible identity, validation and action controls. Other captured screens require their own recorded review; screenshot existence alone is not acceptance.

Additional reviewed live evidence verifies the exact request popover at 390/1440 (8px viewport inset, wrapped content, Escape, outside dismissal and focus return); all three August request details at 320/360/390/1440 without document horizontal overflow; Admin's longest displayed role chip at 320/390 and all 11 Manage actions at 44px height; the three desktop User type options and keyboard selection; and an Employee task's exact event handoff at 320/390/1440. The Operations Associate's existing 400-serial receiving draft retains persistent correction links while scrolling, and a stale putaway ID opens no unrelated dialog. These read-only checks preserved tester data.

Legal's first case remained below the initial mobile viewport despite the earlier lifecycle separation. A compact heading and count-filter layout now corrects that residual in the candidate, with all 175 Legal tests passing. New live first-case and action bounds are still required. The approved August request fixtures also display missing-document checklist items; they are synthetic existing data, not proof of a current-policy approval bypass or a verified grandfathering exemption. Do not use their approved state to certify today's policy transitions.

## Documentation Verification

The standalone handbook includes 35 maintained sources, with Procurement/Legal, Platform/Finance, Warehouse/Events guides and the certification follow-up release note. The source registry includes all 366 current article/heading routes. Updated procedures distinguish UAT deployment from pending end-to-end acceptance and are not represented as live transaction evidence. August screenshots retain their real dates and are stale under the unchanged seven-day evidence gate; historical-fixture unit tests do not renew their certification.

## Remaining Release Gates

1. Resolve every newly reproduced blocker and run the combined module, SQL, permission and recovery regressions again.
2. Finish desktop/mobile visual review of changed screens, including negative and missing-source states.
3. Regenerate the standalone handbook and verify the release documentation against the final candidate.
4. Review and apply migrations in order only to UAT, then deploy the matching application code.
5. Confirm the exact deployed commit and UAT database, then execute role-based live read/write/handoff/replay checks using isolated records. Do not treat local test totals as live certification.

Per-domain working evidence and screenshots are in outputs/sep05-remediation. The original audit remains in outputs/sep05-audit.
