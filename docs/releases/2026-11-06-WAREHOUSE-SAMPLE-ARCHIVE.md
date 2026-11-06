# Warehouse Sample Cleanup

## Scope

This maintenance release separates confirmed Warehouse samples from active work
without deleting their original records. Procurement records, user accounts,
masterlist stock and audit history remain intact. SMTP is unchanged.

The first reviewed batch contains 97 records belonging to 13 explicitly synthetic
product groups. It excludes 11 locations and 19 bins. Mixed master/sample counts,
ambiguous sample ownership and other linked groups remain outside this batch.
This document describes the release contract, not evidence that the batch was
committed or that every historical sample was removed.

## How It Works

- An immutable, administrator-only registry records exact table/record identities,
  original row hashes, source evidence and the archive batch.
- Active Warehouse lists, stock summaries, task queues and My Work exclude those
  identities. Normal history/detail and Procurement reads retain original records.
- Archived rows cannot be changed or reused by new Warehouse writes, including
  old browser commands. Existing workflow permissions remain in force.
- Archive operations and normal Warehouse writes share a transaction lock.
  Warehouse writes require READ COMMITTED isolation. Read-only snapshots remain
  supported; callers using other write isolation levels must retry in a new
  READ COMMITTED transaction.
- No fake cancellation, Quality release, count approval or stock disposal is
  recorded merely to clean up a test fixture.

## Masterlist Protection

The approved opening load contains 5,402 serialized units and the current catalog
contains 191 masterlist products. The three workbook quantity/serial discrepancies
remain marked for warehouse confirmation; this archive does not reconcile them.
The separately approved restoration of two test-issued watches is retained.

## Future Tests

The covered mutating Warehouse runners are paused before their first write. There
is no environment flag to bypass the pause. Read-only and disposable local tests
remain available. Old scripts, manual SQL and copied checkouts are not protected
by this entrypoint guard and must not create new UAT samples.

The tested fixture-lifecycle framework requires an exact run manifest, exclusive
synthetic stock, durable mutation receipts, writer draining, cleanup in `finally`,
crash recovery and independent residue verification. It does not yet have a live
database adapter. Do not resume a runner or claim automatic cleanup until its
actual adapter and full closure are reviewed and verified.

## Release Gate

Before archive commit: verify the exact UAT project and build; rehearse the exact
manifest with rollback; verify native concurrent writes; compare protected source
row hashes; deploy and check all affected active readers. Commit only the reviewed
manifest, then independently verify active exclusion and retained source history.

Any failed ownership, row-hash, dependency or preservation check must abort the
whole batch. Never broaden the batch, delete linked history or rerun an older
destructive cleanup script to make a check pass.

Execution evidence is kept under the project output folder
`outputs/warehouse-sample-cleanup-20261106/`. The execution report, not this source
contract, records final deployed commit, completed batches and remaining limits.
