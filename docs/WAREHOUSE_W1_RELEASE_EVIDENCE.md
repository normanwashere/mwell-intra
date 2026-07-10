# Warehouse W1 Release Evidence

Date: 2026-07-10 (Asia/Manila)

Branch: `codex/production-readiness-remediation`

Evidence mode: local production build with memory authentication/data; live Supabase evidence pending

## Proven Locally

- Six viewport projects: 1440x900, 1280x800, 768x1024, 390x844, 360x800, and 320x720.
- Nine role dashboards in light and dark themes plus every Warehouse Administrator route.
- Three post-fix visual passes. The final two-pass command completed 384/384 cases and generated 768 top/bottom screenshots.
- Each visual case asserts the protected route and main heading, no setup/access-denied leak, WCAG A/AA with axe, no document or element overflow, no clipped controls, no dead links, no sticky/bottom-navigation collision, and 44px interactive targets.
- Role/workflow browser matrix completed 78/78 cases across all six viewports, including warehouse-role access, Core Platform Admin denial, serialized putaway with reload persistence, invalid/valid return scanning, and invalid/valid serialized count scanning.
- Data layer: 154/154 tests. Warehouse module: 252/252 tests. Shell Warehouse import API: 5/5 tests.
- Repository lint is warning-clean, repository typecheck passes, and the production build passes under Node 22.
- Static Warehouse schema verification passed for ten control tables, forced RLS, capabilities, and state constraints.
- Static Warehouse contract verification passed for nine invoker RPCs and guarded private implementations.
- Procurement contract and launch-artifact verifiers passed.
- Production dependency audit reported no known vulnerabilities.
- Current-seed production-build route performance passed over 20 samples per route: dashboard 399ms p95, inventory 299ms, receiving 259ms, reports 262ms; each route transferred about 2.58MB across all 20 runs.

## Defects Found And Fixed

- Tablet header overflow caused by the expanded account identity beside the desktop sidebar.
- Keyboard-inaccessible horizontal report scroller, reported by axe as a serious violation.
- Receiving context clipped at all three phone widths instead of wrapping the warehouse and bin.
- Sub-44px sidebar links, segmented controls, quantity controls, count toggles, low-stock filter, dashboard actions, and receiving context targets.
- 320px header crowding from the environment chip and an undersized receiving quantity column.
- Visual audit false positives for intentionally contained report scrolling and visually hidden file inputs; the helper now distinguishes contained scrolling while still rejecting page overflow.

## Assisted Visual Review

The generated contact sheet is `apps/shell/test-results/warehouse-w1/contact-sheet.html` and contains 768 screenshots. Codex-assisted inspection covered the desktop dark Warehouse Administrator dashboard, tablet dashboard/header and inventory report, 390px operation routes, and 320px receiving top/bottom, reports, dashboard bottom, long labels, dark mode, and bottom-navigation clearance. Selected repeat screenshots were byte-identical, confirming deterministic capture. No unresolved overlap, clipping, illegibility, hierarchy, or action-reachability defect was observed in the inspected samples.

A named business/UI reviewer must still disposition every contact-sheet row before launch. Automated and assisted review does not replace Product, Warehouse, Finance, Security, and Accessibility sign-off.

## Launch Blockers And Unproven Gates

- Live Supabase execution is blocked by missing designated test credentials and `AUDIT_MUTATIONS=true`. The live gate failed closed as designed.
- Authorized live writes, canonical database read-back, fresh-session persistence, immutable ledger evidence, wrong-role and self-approval denial, RLS enforcement, idempotency, concurrency, cleanup, and all nine live role journeys remain unproven.
- `verify:supabase-cutover` failed closed because `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are absent in this worktree.
- Production-volume behavior at 5,000 products, 20,000 serials/lots, 100,000 movements, and the planned control-record volumes remains unproven. The recorded performance numbers are current-seed smoke evidence only.
- The visual crawl covers seeded route top/bottom states. Formal evidence for every empty, loading, error, offline, conflict, dense, modal/sheet, on-screen-keyboard, and long-label state remains a UAT requirement where not already covered by component tests.
- The offline import tests pass but emit pre-existing React `act()` warnings; clean test output should be addressed before making warnings fatal in CI.

Do not mark Warehouse W1 production-ready until every blocker above has an evidence link and approval in `UAT_AND_ISSUE_MANAGEMENT.md`.
