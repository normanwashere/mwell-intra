# September 5 UAT Audit Remediation

Status: seven reviewed migrations applied to UAT; matching application deployment and live journey acceptance pending. Target is mwell-intra-uat.vercel.app and Supabase kkoitlvydytdhlpxhuah only. Main production is untouched.

## Scope

The 53 canonical audit findings are assigned across Procurement/Legal, Platform/Finance, Warehouse/Event integrity, capture/offline workflows, and shared UI/control queues. Duplicate observations retain their canonical mapping. Existing tester seed data is not disposable audit data.

## Completed Local Checks

- Final full workspace run passed all 15 package test suites, including 643 warehouse tests. All 15 package typechecks passed. Earlier navigation-contract, dashboard timing, and grouped Quality list regressions were corrected and retested.
- Quality list semantics were restored; the serial return handoff regression then passed. The expectation now counts actionable inspections rather than counting both receipt groups and child list items.
- Follow-up parent suite passed 31 tests covering Quality, tasks, approvals, and exceptions, including retry after failed reads and blocking approvals when source-count context is missing.
- Governed PO receiving's existing 30 tests passed; a new sticky-requirement focus test passed separately.
- Updated knowledge content, graph and validation tests: 149 passed.
- Actual local browser screenshots reviewed for Quality search and inspection at desktop 1440 and mobile 390. Mobile search was widened after visual review; filtered counts explicitly show the subset versus the whole queue. These are demo-mode UI evidence, not live transaction certification.

## Integration Findings Caught During Remediation

- Finance paging must reject a NULL limit rather than allowing an unbounded query: fixed with a negative SQL test.
- Finance evidence joins must support the actual TEXT document ID and UUID action-evidence ID: fixed and tested against those actual types.
- Current-tier procurement authority must reject expired/future/inactive assignments even when another role supplies a generic capability: revised and tested against prior authorization functions.
- Procurement request revision retains approval IDs and signed history while constructing a fresh approval ladder. The actual foreign-key regression and prior submission implementation pass the focused SQL checks.
- Authenticated database roles retain TRUNCATE grants on custody tables. A narrowly scoped forward migration is prepared and passes six grant regressions; no destructive live probe was performed.
- Exact count source retrieval now uses an authorized ID lookup beyond the bounded history snapshot. Both approval and count-detail pages distinguish loading, missing, and failed reads and support retry. The combined approval/count/return suite passes 48 tests.
- Accepted stock now generates putaway tasks from remaining, unheld staging stock. Task completion follows actual stock movement rather than a separate manual completion flag. Live database compatibility review remains a deployment gate.
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

Readback confirmed authenticated TRUNCATE=false and service-role TRUNCATE=true for all four targeted custody tables; the legacy return entry point contains the retirement guard. Security-invoker task and event-custody views remain enabled. Read-only projections returned 102 tasks, 3 event-custody rows, and 0 lineage-audit issues at verification time. These counts are not transaction certification.

The latest combined selected SQL suite passed 54 tests. A production application build passed. The service-key security check was not run locally because the CI-only vaulted credential is absent; it must run through the guarded UAT certification workflow.

## Documentation Verification

The standalone handbook includes 34 maintained sources, with Procurement/Legal, Platform/Finance, and Warehouse/Events candidate guides. All 40 documentation generator tests pass. Candidate procedures are clearly marked pending deployment and acceptance, not represented as live transaction evidence.

## Remaining Release Gates

1. Resolve every newly reproduced blocker and run the combined module, SQL, permission and recovery regressions again.
2. Finish desktop/mobile visual review of changed screens, including negative and missing-source states.
3. Regenerate the standalone handbook and verify the release documentation against the final candidate.
4. Review and apply migrations in order only to UAT, then deploy the matching application code.
5. Confirm the exact deployed commit and UAT database, then execute role-based live read/write/handoff/replay checks using isolated records. Do not treat local test totals as live certification.

Per-domain working evidence and screenshots are in outputs/sep05-remediation. The original audit remains in outputs/sep05-audit.
