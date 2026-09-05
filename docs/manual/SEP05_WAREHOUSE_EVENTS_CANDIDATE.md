# Warehouse and Events Candidate

Status: **Pending deployment. Not production acceptance.** Reviewed locally on 2026-09-05.

## Scope

Candidate remediation covers WE01, WE02, WE05, WE10, WE13, WE14, LV06 and LV07. No deployment, live database changes, commits, or authorization bypasses were performed. Warehouse shared store and the parent-owned governed receipt editor were not changed by this work.

## Candidate Behavior

- Linked allocation returns retain their allocation identity and enforce cumulative outstanding quantity. Partial returns may complete an allocation across calls; excess returns fail atomically and exact idempotent retries do not write again.
- New reservations require a planned or active event. Previously committed reservation retries retain their original result after event closure.
- Live Events and Warehouse event detail use the common lifetime custody projection. Returned allocations remain part of lifetime issued totals. Outstanding custody is not automatically treated as sold or consumed.
- Reconciliation separates sold, giveaway, returned, lost, damaged and re-kitted quantities. Drafts may be incomplete; submission and approval require valid whole quantities accounting for all issued units.
- Valuation uses captured issue costs. Missing historical snapshots and ambiguous mixed costs remain unavailable rather than being reconstructed from today's catalogue price.
- Floor work includes received, allocated, picking, packing and ready demand. The shared navigation contract is `/fulfillment?filter=floor_work`; released follow-up is separate. Inbound counters use issued purchase orders with outstanding quantities and retain unavailable prices as unknown.
- Certification, RLS, Finance separation of duties, evidence requirements and idempotency remain in force. Orientation grants module entry, not completion of action-specific training.

## Local Browser Verification

Used an independent Codex In-app Browser session at `http://localhost:3017`, with the local server explicitly configured for memory data. Signed in as the demo Kai Mendoza profile and completed the actual Role orientation review using Continue and Finish review. The screen then showed 1 of 4 requirements complete and allowed entry to Events; remaining action certification stayed required. No event, reconciliation or inventory transaction was saved.

| Surface | Observed result |
| --- | --- |
| Events list | 3 events, 1 planned, 1 active, 460 units issued |
| Quezon City Community Activation | Reserved 300, issued 280, returned 18 |
| Reconciliation editor | Issued 280, accounted 0, remaining 280; incomplete draft balance; all six outcome labels readable |
| Warehouse Marketing dashboard | 6 events, 116 units issued KPI, 145 units in the 10-day comparison; allocation navigation badge 5 |
| Warehouse fulfillment navigation | Opens `/warehouse/fulfillment?filter=floor_work`; Marketing defaults to Department requests, with all request counters 0 |
| Responsive inspection | Actual screenshots inspected at 1440 x 900 and 390 x 844; editor labels fit, balance wraps, no page-width overflow in inspected mobile surfaces |

The memory Events and Warehouse modules display different seeded event populations. These observations verify rendering, not shared live-data agreement. Operator pick/pack and inbound purchase-order count agreement still require a role-specific journey; Marketing's zero request list does not prove those paths.

## Captured Evidence

![Events reconciliation at 1440](../../outputs/sep05-remediation/warehouse-events-visual/events-reconciliation-1440.png)

![Events reconciliation at 390](../../outputs/sep05-remediation/warehouse-events-visual/events-reconciliation-390.png)

![Warehouse dashboard at 1440](../../outputs/sep05-remediation/warehouse-events-visual/warehouse-dashboard-1440.png)

![Warehouse dashboard at 390](../../outputs/sep05-remediation/warehouse-events-visual/warehouse-dashboard-390.png)

## Automated Verification

Bundled Node 24 was placed first in PATH. Latest AppShell and Dashboard focused run passed **32 tests across 2 files**. The all-roles overview passed in 3.43 seconds (also passed in isolated runs); its timeout was not increased. Two Operator assertions were changed to re-query current DOM inside `waitFor` after detached-element failures during initialization. AppShell now expects the intentional floor-work query string.

Latest return-intake PGlite run: **36 tests passed**, including actual legacy wrapper retirement, no-write rejection, post-migration v2 authentication/capability/certification checks on replay, quarantine and idempotency, and historical empty return lines. The unapplied candidate backfill preserves `[]` instead of attempting to write NULL to a NOT NULL column.

Earlier scoped evidence: Events 35 tests; data-kit return safety and memory repository 114 tests; warehouse six-file focused run 47 tests. Events, warehouse and data-kit typechecks passed at that checkpoint. These are scoped results, not a claim that the current full workspace suite passes.

WE10 canonical single-cost mixed-purpose acceptance was rerun successfully (domain suite 5/5): one SKU issued 10 at captured cost 100; catalogue later 999; approved sold 4, giveaways 3, physical returns 2, lost 1. Valuation is respectively 400, 300, 200 and 100. This helper regression and the separate SQL cost-snapshot regression must not be described as one end-to-end live journey. Mixed purposes at one historical cost are supported; differing historical issue costs without outcome-to-lot attribution remain uncertain.

## Migration Compatibility and Release Gates

Candidate migration: `supabase/migrations/20260905092000_warehouse_integrity.sql`. It has not been applied to a live database.

- Repository DDL confirms text event/allocation identities, JSONB return lines and integer movement quantities. The new numeric valuation column is additive; JSONB composite-record inserts adapt to the table row type. Existing secure-evidence checks are not replaced.
- The candidate preserves the `record_return_v2(jsonb)` authorization/idempotency implementation, changes normalized line identity, and moves allocation completion into cumulative accounting. Its guarded source replacements must match the installed function body.
- Reconciliation source chain includes `save_event_reconciliation_uncertified_impl(jsonb)` and `save_event_reconciliation_pre_action_evidence(jsonb)`, reached through certification, handoff and action-evidence wrappers. The candidate changes only their lifetime-issued query. A full installed wrapper-chain replay remains a release gate; the existing selected-migration fixture is not that replay.
- `reserve_batch(jsonb)` resolves replay before its event check; the candidate adds the event row lock and terminal-state restriction. `manage_event` already locks that event row. Real multi-session PostgreSQL races remain untested.
- **Legacy API blocker resolved in the candidate:** `record_return(jsonb)` retains its signature and existing authenticated execute permission solely to return SQLSTATE `0A000`: "Legacy return intake is retired. Reload or upgrade the app and retry using record_return_v2." It unconditionally raises before any delegation or raw caller-authored stock write. Anonymous/public execution and authenticated access to the hidden legacy implementation are revoked. Stale clients must upgrade; the current app uses v2. The regression installs the actual historical implementation and certification wrapper before applying the candidate, checks unchanged state for raw-write/empty/null payloads, then verifies the v2 safety chain. The allocation trigger still requires issued status; no permissive compatibility bypass was added.
- Review `warehouse.return_lineage_audit` before operational rollout. Ambiguous or excessive historical returns are not silently repaired. Historical cost gaps remain intentionally unavailable.
- A full disposable-database migration replay, authenticated live-mode UI read checks, and concurrency tests are required before production acceptance. No live write was used for this review.

Detailed remediation status: `outputs/sep05-remediation/warehouse-integrity.md`.
