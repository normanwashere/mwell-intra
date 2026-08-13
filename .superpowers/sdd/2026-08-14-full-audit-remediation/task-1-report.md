# Task 1: Database Authority and Security Boundary

## Status

Implemented in forward migration `20260813203240_task_1_database_authority_remediation.sql`.

## Changes

- Wrapped audited Warehouse, Procurement, Finance, Product, and Legal mutation RPCs with `core.has_live_cap` checks, preserving original implementations behind non-browser-executable names.
- Added dedicated mutation capabilities for replenishment, payment release/review, and export registration/review, with role wiring.
- Revoked `public`, `anon`, and `authenticated` execution from private Warehouse implementations; public wrappers retain controlled execution.
- Scoped Finance close reads to certified `warehouse:manage_finance_close` authority.
- Added `legal.document_access_audit`, a 300-second governed Legal document-access preparation command, and removed broad internal direct reads from the `documents` Storage policy.
- Added server-side vendor application completeness validation and a live-governed, version-preserving correction-request transition.

## TDD Evidence

- RED: `node --test scripts/verify-task1-database-authority-remediation.test.mjs` failed 7/7 because no Task 1 migration existed.
- GREEN: the same command passed 7/7 after implementation.
- `git diff --check` passed.

## Concerns

- `supabase migration list --local` could not connect because Docker/local Postgres is not running on `127.0.0.1:54322`; no migration was applied to a local or remote database.
- The governed Legal command returns the private storage path, 300-second access window, and immutable audit identifier. The browser/service signed-URL consumer is intentionally outside this database-only task scope.
