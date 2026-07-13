# Supabase Advisor Baseline

**Project:** M-Intra (`abbfziukjalyqtcuskhi`)

**Captured:** 2026-07-13

**Purpose:** Pre-hardening baseline for currently implemented Mwell Intra functions.

## Security

- Critical: 0
- Warning: 0 after leaked-password protection was enabled and verified.
- Informational: 1

The informational notice is `rls_enabled_no_policy` on `warehouse.command_log`. This is intentional. The table is an internal idempotency and audit control, all access is revoked from `public`, `anon`, and `authenticated`, and only `service_role` has table privileges. Adding a client policy would weaken the current fail-closed boundary.

## Performance

The pre-hardening advisor returned 174 notices:

| Finding | Count | Disposition |
| --- | ---: | --- |
| Unindexed foreign keys | 131 | Add covering indexes where no leading-column index exists. |
| Auth RLS init-plan | 5 | Rewrite identity expressions as selected scalar subqueries. |
| No primary key | 1 | Add a surrogate UUID primary key to `warehouse.stock_levels` while preserving its business-key unique index. |
| Unused indexes | 34 | Retain pending sustained production telemetry and documented purpose review. |
| Multiple permissive policies | 2 | Consolidate each Procurement PO policy pair without changing the union of authorized readers. |
| Absolute Auth connection allocation | 1 | Move to percentage allocation in the Supabase dashboard before scaling the instance. |

## Acceptance Gate

The hardening pass must reduce unindexed foreign keys, auth init-plan warnings, duplicate permissive policies, and missing primary keys to zero. Newly created indexes may appear as unused until production queries exercise them; this is not grounds for immediate deletion. Security must continue to have no warning or critical finding.

## Verified Post-Hardening State

The live migration `current_function_advisor_hardening` was applied transactionally on 2026-07-13. Its catalog assertions completed without error.

| Finding | Before | After | Result |
| --- | ---: | ---: | --- |
| Unindexed foreign keys | 131 | 0 | Pass |
| Auth RLS init-plan | 5 | 0 | Pass |
| Tables without a primary key | 1 | 0 | Pass |
| Multiple permissive policies | 2 | 0 | Pass |
| Security warning or critical | 0 | 0 | Pass |

The post-change performance advisor contains only informational notices: 165 unused-index observations and one absolute Auth connection-allocation observation. The unused-index total includes the 131 newly created foreign-key indexes, which have no meaningful production telemetry yet. Retain them until a sustained workload review can distinguish unused indexes from low-frequency integrity and join paths. The Auth allocation remains an infrastructure scaling setting rather than an application-code defect.
