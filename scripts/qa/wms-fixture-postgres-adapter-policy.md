# Bounded PostgreSQL Fixture Adapter

Status: local candidate, not a live cleanup certification. Both the new live runner/connector and existing legacy entrypoints are unconditionally paused through the existing guard. There is no URL, environment variable or caller option that opens the live runner. Offline preparation and disposable native proof remain available. No applied archive migration or existing lifecycle contract is changed.

## Exact Write Set

The sole supported command is `seed-one-serial`: one new synthetic serialized product, one in-stock unit at an explicitly selected existing active warehouse bin, and the real registration-history trigger's one immutable row. IDs/SKU/serial are derived from one UUIDv4 run ID; manifests cannot supply SQL, existing products, master stock or additional operations. This proves fixture visibility and retirement, not a receiving, QC, conversion or fulfillment journey. It fabricates no receipt, QC, count, order, actor or return evidence.

The new `20261106173133_wms_fixture_postgres_lifecycle.sql` adds only four private admin ledgers. All use forced RLS and revoke all client/service-role access. Plan, operation receipts and exact row provenance are immutable; only the lease fence/state is mutable. Existing source stock and public APIs are unchanged.

Cleanup calls the existing `private.archive_uat_warehouse_fixture` with exactly the owned product and unit IDs/current row hashes. It inserts archive registry records only. The original unit history is retained byte-for-byte and accounted through its parent unit's verified archive membership, not falsely registered as an archive-member table. Catalog incoming foreign keys to the product/unit are checked across all schemas, including composite keys with unrelated column names. Structured logical product/unit/serial references are checked in Warehouse, Product, Procurement, private conversion/custody/external-PO/history tables and other tables with identity columns. Row-filtered scans fail closed. Only the exact ledger-owned unit and history row/hash are exempt; other histories are not. Dependencies are checked before and after archival and by the independent verifier. A new dependency or changed owned row blocks cleanup, never expands ownership. This does not authorize concurrent foreign commands to acquire these synthetic roots or certify arbitrary future schemas/JSON conventions.

## Runtime And Recovery

- The live connector accepts only the approved UAT direct host or project-qualified **session** pooler on port 5432, database `postgres`, with verified TLS. Transaction-pooler port 6543 is refused. Two distinct PostgreSQL backends and `session_user=postgres` are required.
- Health must report `ok`, exact source SHA, `uat`, and project `kkoitlvydytdhlpxhuah`. Archive/dependency/history function bodies are pinned to reviewed source fingerprints. Unknown source/runtime drift fails closed, including during recovery.
- A session advisory lock owns one run. A durable fence must be open before writes; drain irrevocably closes it. Recovery obtains a new drained fence only after the prior session lock is gone. No automatic backend termination is used.
- Before dependency inspection, archive takes the existing exclusive archive advisory fence and locks the exact product then unit `FOR UPDATE`, matching the archive authority's lock order. This blocks an incoming FK insertion in the check/archive window. Not all logical non-FK writers yet participate in that shared fence, so live transport remains disabled pending a separately reviewed DB writer-fencing contract; local proof does not waive it.
- The existing lifecycle writes/fsyncs intent before dispatch and response checkpoints afterwards. SQL inserts the fixture, real history and exact ownership/operation receipt in one transaction. A missing response is reconciled from that receipt, never by repeating the business command.
- Cleanup follows settled writers and drain, including ordinary errors/abort. Process death leaves the durable journal and database receipts for `recover`; recovery never seeds again. Same archive batch/inventory is idempotent. An unresolved outcome, unavailable journal, foreign dependency or proof mismatch is failure, not successful cleanup.
- Protected server-side count/digests cover warehouse and Procurement base tables, core profiles/roles/assignments/activity, auth users/audit and original unit history, excluding only exact owned rows. Every mutating transaction takes fresh start/end snapshots; drift rolls that transaction back. Only this known rollback is retried, at most three attempts with fresh snapshots. Business dispatch checks cancellation on every attempt. Unknown COMMIT outcomes are never automatically retried.
- The initial immutable snapshot is an observation, not an hours-old cleanup gate. Unrelated writes between phases or before recovery are retained; table names and digest changes are separately reported through the runner's sanitized observation output. No foreign data is restored or overwritten. Persistent within-transaction contention can still fail safely and require later recovery.
- A separate connection performs repeatable-read **READ ONLY** proof of exact archive membership, zero owned IDs in `active_products`/`active_inventory_units`, and unchanged owned source/history hashes. It reports unrelated changes separately. This is not authenticated ATP/UI coverage; no actor is manufactured to bypass summary-read authorization.

## Invocation

Prerequisites: reviewed ledger migration installed by main, matching source deployment, existing active bin, explicit approval for this isolated fixture, and a separately approved admin PostgreSQL connection. Management API/MCP access alone does **not** provide the two-session connection required here. No credential discovery, `.env` loading, role changes, SMTP, global cleanup or migration apply is performed by these commands.

Pass one JSON object through stdin from an approved in-memory credential source. Never put the connection URL/password in arguments, a report, a persisted config or shell history. Commands below deliberately omit any credential-producing pipeline.

```text
node scripts/qa/wms-fixture-postgres-adapter.cli.mjs prepare
node scripts/qa/wms-fixture-postgres-adapter.cli.mjs run
node scripts/qa/wms-fixture-postgres-adapter.cli.mjs recover
```

`prepare` stdin has `sourceCommit` and optional `runId`; output is an offline plan. The frozen contract for `run`/`recover` has exactly `databaseUrl`, `sourceCommit`, `runId`, `manifestPath`, `locationId`, `binId`, but both commands currently fail with `WMS_LIVE_FIXTURES_PAUSED` before connecting or accessing a journal. Do not supply credentials while paused. Future reopening requires reviewed source changes and logical-writer fencing, not a flag. The local lifecycle proof retains its journal/finally/connection-closure behavior and recovery never replays seed.

## Local Evidence

```text
node --test --test-concurrency=1 scripts/qa/wms-fixture-postgres-adapter.test.mjs scripts/qa/wms-fixture-postgres-adapter.cli.test.mjs
node --test --test-concurrency=1 scripts/qa/wms-fixture-lifecycle.test.mjs scripts/qa/wms-live-fixture-guard.test.mjs
node scripts/qa/wms-fixture-postgres-adapter.native.mjs
```

Native stdin requires exactly `databaseUrl` (loopback PostgreSQL admin `/postgres`, existing standard Supabase roles) and `outputDir`. The script creates its own random `qa_wms_fixture_<uuid>` database using template0, installs only the disposable fixture, uses distinct clients, checks lease contention, native read-only denial, closed fences, rollback, separate-session interleaving and concurrent-drift retry. Its owned child workers are killed before COMMIT and after COMMIT but before the durable response; each is recovered twice without replaying seed, including unrelated writes before recovery. It closes only its clients and drops only that newly created database, without FORCE. Journals stay in the requested output directory. It does not reset any existing DB, create cluster roles, or contact UAT. Missing PostgreSQL is a failure/NOT RUN, never a skipped pass.

PGlite tests execute actual archive/history/ledger SQL with a captured table-shape fixture, not the full migration chain or native concurrent sessions. The final disabled candidate passed 38 focused tests and all eleven PostgreSQL 17.6 native checks on 2026-11-07, including the check/archive incoming-FK contention test and strict mixed-JSON serial handling. Latest native evidence is under parent `outputs/warehouse-sample-cleanup-20261107/adapter-native-proof-679af30a-5e84-4de4-bc8f-75b957920b56/`; final test TAP is `adapter-final-tests.tap` in the same parent output root. The negative dependency case intentionally retains its active fixture until the disposable database is dropped. This is not full Supabase migration replay. Future live reopening requires a reviewed logical-writer fencing contract, full candidate migration replay, explicit authorization and approved UAT transport/run/readback. Live mutation tests are paused at the user's request. Legacy harnesses remain paused until separately wired and proven.
