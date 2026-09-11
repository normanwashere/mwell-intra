# Loading and Database Performance - September 11

## Resolution

UAT database: `kkoitlvydytdhlpxhuah`. Migration `20260911035750_loading_query_performance` applied successfully. Main production was not changed. App-side changes were subsequently deployed to live UAT on September 11 in release `e411a7e`. Public health confirmed the release SHA, correct UAT database and reachable static assets. Six read-only desktop/mobile smoke checks passed for Marketing, Operations Associate and Administrator. See `docs/releases/2026-09-11-UAT-USABILITY-PERFORMANCE.md` for deployment evidence. The local tests and database measurements below retain their original scope.

| Area | Before | After |
| --- | --- | --- |
| Latest 250 audit entries | Scanned about 105,000 rows and sorted | Uses `activity_log_created_at_id_idx` |
| Audit SQL execution sample | 1159.045 ms; 3846 buffer hits | 0.352 ms; 61 buffer hits, 3 reads |
| Audit index | No matching recency index | Valid and ready, 3272 kB |
| Repeated auth-user policy checks | Three advisor warnings | Zero `auth_rls_initplan` warnings |
| Stock-state preflight | 23 datasets | 3 datasets |
| Reservation preflight | 23 datasets | 4 datasets |
| Issuance preflight | 23 datasets plus hold query | 4 datasets plus unchanged hold query |
| PO receiving preflight | 23 datasets | 2 datasets |
| Product/cancellation preflight | 23 datasets | 1 dataset |
| Hidden-tab notifications | Continued minute polling | Pauses until visible |
| Slow notification request | Next timer could overlap | Active read is not overlapped |

Query counts describe preflight reads, not total action traffic: replay lookups, transactional RPCs and post-save Warehouse refreshes still run. No stock or authority cache was added. Fresh reads, access rules and server-side rechecks remain in place. Complete initial Warehouse hydration still loads 23 datasets.

## Verification

- Data-kit: 342 tests passed, including five new query-shape tests that failed before the change.
- Warehouse: 836 tests passed across 97 files.
- Notifications: 10 tests passed, including hidden-tab, tab-return, slow-request and unmount cases; the two new polling tests failed before the change.
- Migration rehearsal: 64 combinations of identity, capability and row-specific ownership retained identical visibility. Anonymous/read-only grants stayed unchanged; reapplication and indexed query plan checked.
- Data-kit, Warehouse and Shell typechecks passed.
- Eight local Playwright journeys passed across desktop 1440/1280 and mobile 390/320, covering Marketing receipt acknowledgment and Warehouse conflict/order/return/notification context. Screenshots: `outputs/loading-performance-local/browser`.
- Four actual-notification-component browser fixtures passed filtering, explicit read action, focus restoration and viewport checks. Desktop/mobile screenshots inspected. Backend responses and receipt photos in local tests are synthetic.
- Live database: migration identity matches the source filename; valid/ready index confirmed; indexed EXPLAIN ANALYZE captured; all three altered policies inspected; performance/security advisors rerun.
- Live authenticated SQL reads using the existing Marketing and Administrator identities succeeded for all three policy tables. Those checks returned no visible rows; this does not certify every populated live role journey. The populated access matrix was a local database rehearsal.

## Evidence Limits and Scale Gates

SQL timing is one before/after sample, not a cold-cache comparison, endpoint p95, whole-page speedup or sustained-load result. Browser checks used the local app, not a newly deployed UAT application.

1. Measure authenticated p50/p95 latency, payload size and request counts for the 11 personas and multi-role combinations with representative volumes. Separate initial entry, tab return, search and post-save refresh.
2. Replace the broad snapshot with server-filtered, cursor-paged route data without excluding older pending orders, reservations, holds or handoffs. Do not calculate authoritative stock totals from a truncated page. Retain full-history navigation. Any future cache must be user/session/access-scoped and invalidated after mutations.
3. Review 82 unindexed foreign-key notices against actual joins, parent changes, RLS and query plans. Add justified indexes; use concurrent builds for large/busy tables and verify validity afterward.
4. Review 27 multiple-permissive-policy notices with semantic equivalence tests before consolidation. They are not permission failures. Thirteen security INFO notices concern RLS-enabled/no-policy tables; this migration added no access there.
5. Retain all 177 currently unused indexes until representative telemetry supports removal. Do not reset usage statistics or remove constraint/uniqueness protection.
6. Recheck Auth connection allocation and peak connections before raising concurrency. No compute size, billing, pool size or Auth allocation was changed.

## References and Rollback

- [Supabase query optimization](https://supabase.com/docs/guides/database/query-optimization): align indexes to observed queries, inspect EXPLAIN and avoid over-indexing.
- [RLS initialization-plan advisor](https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan): evaluate statement-invariant identity calls once.
- [Unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys): assess relationship-index coverage.

App changes can be reverted independently. Restore previous policy predicates only through a reviewed migration with the same visibility matrix. Dropping the new audit index is a performance rollback, not a data rollback; use a reviewed concurrent drop outside a transaction if needed on a busy database. Do not disable RLS or drop unrelated indexes.
