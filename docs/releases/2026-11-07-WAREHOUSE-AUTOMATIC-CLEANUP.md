# Warehouse Automatic Test Cleanup

Status: safety changes under verification. The isolated UAT trial has not run.

## What Is Protected

- Imported masterlist stock, existing Procurement records, users, roles and training are not test fixtures.
- Original stock and audit records stay in place. Cleanup removes only the new run's registered samples from active Warehouse views through archival, not deletion.
- SMTP and email delivery are outside this change.
- The one-serial trial does not authorize the broader live certification workflow or other mutation suites.

## Safety Changes

- The legacy live workflow is blocked before it can provision users or complete training, including when manually dispatched. Its pause notice fails explicitly rather than appearing certified.
- The legacy deletion-based cleanup CLI is blocked before discovery or report creation. Its imported offline test helpers have not been re-certified for live use.
- A dedicated disposable-only CI workflow checks the fixture contract, native recovery and complete canonical migration replay without UAT credentials.
- The candidate database guard reserves exact synthetic product, unit and serial identities. An unrelated command must not acquire, modify or later reuse those identities.
- Actual unit registration also appends stock-count revision history. The candidate must account for this side effect and retain it; testing only the product and unit is insufficient.

## Verification So Far

- Legacy CI boundaries and related regressions: 86 passed, none skipped.
- Cleanup helper and mutation-pause regressions: 72 passed, none skipped. These overlap the preceding group and must not be added together as a unique-test count.
- Frozen adapter, lifecycle and writer-guard checks: 99 passed, none skipped. Native PostgreSQL 17.6 recovery checks: 12 passed, including 21 separate-session interference attempts and two process-death cases. Both interrupted runs recovered twice without re-seeding; no disposable test database remained.
- Those native results use an isolated fixture and an explicit test health response. They are not live UAT evidence or a complete migration replay.
- Read-only UAT observation: 191 active catalog products, 5,402 imported opening serials, and 2,274 archive memberships. No trial ledger was installed at this observation.
- A baseline of 118 protected tables and an inventory of the effective live stock triggers were captured read-only. They are observations, not permission to restore over subsequent legitimate user activity.

## Before The One-Serial Trial

1. Freeze and independently review the exact candidate, including normal-write behavior, logical references, stock-count history and concurrency protection.
2. Pass the native crash/recovery tests and full Supabase canonical replay on the same candidate. A captured table fixture, test double or bare PostgreSQL diagnostic is not a full replay pass.
3. Check the installed migration/function/trigger contract against that candidate. Never replay the entire historical migration list against UAT.
4. Establish the approved persistent UAT database connection without resetting passwords or changing account permissions. Management API query access is available, but does not by itself prove two persistent PostgreSQL sessions.
5. Activate only a reviewed, exact one-run entry point, then register one new synthetic product/serial in an explicitly selected active bin. No existing stock is borrowed.
6. Drain the writer, archive the exact owned inventory, and independently verify zero active residue and unchanged retained history. If the result is uncertain, reconcile durable receipts; do not replay seed or delete unrelated records.

Keep general live mutation tests paused until their own cleanup integration is proven. A successful one-serial cleanup trial would not certify receiving, Quality, conversion or fulfillment journeys.

## Hosted Checkpoint

GitHub run [42341929939](https://github.com/normanwashere/mwell-intra/actions/runs/42341929939), candidate `2b129e7dab13a87cb2278ba586d02b25715e641c`:

- Required contracts and native cleanup recovery passed.
- The complete clean-database replay failed at `20261106145744_uat_warehouse_archive_active_reads.sql` with SQLSTATE `P0001`. This is an open rebuild blocker, not a passed migration check.
- The owned disposable replay project was stopped successfully. No live migration, trial, stock change or SMTP change was made.
- Separately reran the captured archive-read regression: four passed. That fixture result does not override the failed full replay.

The rebuild failure was reproduced locally: My Work's recorded definition uses Windows line endings, while the identical Git source uses Unix line endings. The candidate now accepts only those two exact known definitions. Seven focused checks pass, including rejection of changed Procurement logic, unexpected body changes and unknown newline combinations. Permissions remain unchanged. The complete hosted replay must pass before this fix is considered verified end to end; no installed UAT migration is being reapplied.

The read-only Supabase connection was confirmed as the `postgres` database role on PostgreSQL 17.6. This confirms database access, not the persistent client connection needed for the isolated two-session trial.

## Supabase Access

The application already uses Supabase and management/query access is available. No second database is needed. This test additionally needs the PostgreSQL connection used by a backend client, so that its writer and independent verifier hold separate sessions while locks and interrupted commits are tested. The current local app configuration has API credentials, not that database connection. API keys must not be treated as PostgreSQL passwords. Do not reset the project's password, change role grants, or enable a new authentication method just to run the trial.
