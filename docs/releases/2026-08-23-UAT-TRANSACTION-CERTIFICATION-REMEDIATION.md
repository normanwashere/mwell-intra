# UAT Transaction Certification Remediation

**Released:** August 23, 2026

**Scope:** P0-P2 failures isolated by live desktop and mobile transaction artifacts

## Corrected controls

- Every active `UAT-TEMP-*` department matrix now has exactly one open named assignment for Department Head, Procurement Head, Legal, Finance, and Final Approver. Existing department final approvers were preserved.
- Procurement category and requirement-classification tiles now give the native radio control the entire tile hit surface and display keyboard focus, preventing child text from intercepting desktop or mobile selection.
- DOA certification selects a run-scoped active department from the controlled directory, verifies independent Admin-to-Legal activation, and removes every generated matrix, assignment, and activity record.
- Stale Finance evidence certification recognizes the current fail-closed correction message while continuing to require an HTTP failure response.
- The governed DOA save policy now uses PostgreSQL's executable `COALESCE` expression instead of the invalid `pg_catalog.coalesce` function reference introduced during department-code convergence. The private function remains inaccessible to normal users; authenticated callers continue through the capability-checked `procurement.save_doa_matrix` wrapper.
- Migration verification now rejects the broken expression, confirms the governed wrapper remains executable by authenticated users, and requests a PostgREST schema refresh.
- Live Procurement request entry now keeps Department and Cost Center as stable controlled selects while the directory loads on slower mobile sessions. The form fails closed with an actionable inline error instead of changing control type from a select to an unrestricted text field.

## Live evidence that triggered the change

Certification run 131 passed all route and visual shards at desktop, tablet, and mobile widths. Its governed transaction artifacts then exposed the incomplete temporary Operations ladder, intercepted category radio hit target, and stale DOA/payment test expectations. Certification run 132 again passed every route and visual shard, then isolated an invalid SQL expression in DOA draft creation on both desktop and mobile. Both runs' independent cleanup jobs completed with zero governed residue.

## Launch condition

The temporary UAT ladders exist only to exercise every derived approval route. Platform Admin and Legal must replace them with approved department owners, amount bands, category scope, effective dates, and source documents before production approval.
