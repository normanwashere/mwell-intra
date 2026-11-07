# WMS Fixture Safety CI

Status: the isolated publication inventory is pinned to `ce4137aeec25061b1282c0ae60ea90c388ad31257cc200f6ec5107054ef83429`. Full replay and post-schema assertions remain mandatory. This inventory preserves the published cleanup branch's history and excludes unrelated working-checkout migrations. No hosted CI or live trial clearance is claimed by this source document.

## Scope

`WMS Fixture Safety (disposable only)` is separate from UAT live certification. It runs on pull requests, manual dispatch without inputs, and pushes to `main`, `codex/reporting-security-foundation`, and the isolated publication branch `codex/warehouse-cleanup-20261107`.

The job has read-only repository permission, no deployment environment, no secrets or variable-based connection targets, and no persistent checkout credential. It does not invoke the legacy live workflow, provisioning, onboarding, Auth APIs, email delivery, or a live business runner. Existing live mutation pauses remain in place.

The only database target in the fixture stage is its freshly started PostgreSQL 17 service on loopback. Three NOLOGIN role names and dummy identity/history rows are local fixture prerequisites, not UAT accounts or training changes. The native helper creates and drops a fresh randomly named database; it never resets an existing one. No UAT, master stock, Procurement, user or audit record is accessed. SMTP remains untouched.

## Required Checks

1. Exact checkout provenance and locked dependency installation.
2. Serial workflow-boundary, legacy-pause, lifecycle, adapter, registered-writer guard, CLI and replay-tool contract suites. Missing tests, failed assertions and installation failures fail the job; no conditional skip or `continue-on-error` is permitted.
3. Native recovery on the disposable service: separate writer/readback sessions, protected data, concurrency, lost response, worker death before/after commit and repeated recovery without seed replay. Missing PostgreSQL, wrong major version/cluster, failed cleanup or residual fixture databases fail the job.
4. Full canonical migration replay plus every candidate forward migration and post-schema assertions. The literal reviewed inventory digest includes the candidate SQL and post-schema assertions, is portable across LF/CRLF, and is checked before preparation. Runtime raw hashes preserve exact copied-byte proof. Required ledger and registered-writer fence filenames cannot be omitted. Actual Supabase CLI start, local reset without seed, exact applied migration listing, read-only schema assertions and owned cleanup must succeed. A test-double result, bare PostgreSQL diagnostic or fixture DDL cannot substitute for native replay.

The final digest must describe the reviewed **isolated publication tree**, not unreviewed additions in the dirty worker checkout. Never compute a fresh digest inside CI and silently accept it as the expected value. Any missing, extra or changed migration is a failure requiring review and a new pin.

The native fixture's synthetic health commit is deliberately all `a` characters; it is not a deployed SHA. `source.json` and `native-results.json.sourceCommit` record the actual checked-out candidate separately. Never relabel that fixture result as a live health or business-journey result.

## Evidence Handling

The evidence audit runs even after a failed test. It publishes only explicitly allowed files, bound to the checked-out SHA, under `test-results/wms-fixture-safety/publish`. It rejects symlinks, unknown files, oversized files, connection URLs, token/key patterns and credential fields. Checkout metadata, home/config directories, environment files, database dumps and credentials are never uploaded.

Safe partial journals are retained byte-for-byte for failure investigation, not repaired or claimed complete. On a successful native step, result prerequisites and journal integrity must validate before publication. Missing required success evidence fails the audit. A successful artifact upload never changes a failed test into a pass. Artifacts include an index of file hashes and step outcomes; retention is seven days, and names include SHA, run and attempt.

The native helper closes its sessions and drops its owned database. An always-run replay cleanup validates an exact workspace receipt, candidate SHA, generated project and configuration hash before stopping that one local project with the pinned CLI and isolated home. A final always-run step stops the owned fixture service. No `--all`, linked target or inherited project token is used. Hosted runner disposal is not evidence of business cleanup. If a proof or cleanup step fails, inspect the retained evidence; do not retry a live command or clear the pause.

The job budget is 80 minutes: 65 for install/contracts/native/replay, 10 for replay cleanup/evidence audit/upload/service stop, and five reserved for checkout/setup/provenance. A structural test sums every bounded step and rejects a job budget smaller than that sum plus the setup reserve. This reserves execution time under those budgets; it does not guarantee cleanup after runner loss, forced cancellation, or setup exceeding its reserve. Cleanup outcomes must still be recorded and checked.

Replay publication is restricted to `replay-result.json`, `replay-inventory.json` and the owned-cleanup summary. Raw CLI step logs, SQL, workspace/home and clusters are not published. The artifact gate requires same-candidate native evidence, actual schema-assertion success and successful final cleanup before accepting a replay success.

## Local Review

Run with the repository's Node 22 and installed locked dependencies:

```sh
node --test --test-concurrency=1 scripts/qa/wms-fixture-safety.test.mjs scripts/qa/wms-live-fixture-guard.test.mjs scripts/qa/wms-fixture-lifecycle.test.mjs scripts/qa/wms-fixture-postgres-adapter.test.mjs scripts/qa/wms-fixture-postgres-adapter.cli.test.mjs scripts/qa/wms-fixture-postgres-adapter.guard.test.mjs scripts/qa/wms-fixture-migration-replay.test.mjs scripts/qa/wms-fixture-migration-replay.native.test.mjs
```

These tests are offline. Structural checks are not proof that GitHub parsed/executed a workflow, that Docker is available, or that the complete migration chain applied. Record those results separately for the published candidate.

## Trial Boundary

A green safety workflow does not enable a UAT runner. The isolated trial remains a separately reviewed, manually operated action after all required same-candidate evidence is accepted. No workflow input, environment flag, URL or secret can authorize that trial. Preserve master stock, Procurement, users, original records and evidence history. Do not enable the old certification workflow or remove legacy mutation pauses as a shortcut.

The shared checkout contains unrelated work. Publish only reviewed file hunks and dependencies to the isolated branch, not the whole checkout. This task owns only the new workflow, its dedicated tests and these instructions; it does not own adapter, package, migration or legacy-workflow changes.
