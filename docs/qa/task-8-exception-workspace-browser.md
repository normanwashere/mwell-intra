# Task 8 Exception Workspace: Controlled Browser Evidence

## Scope and command

This controlled rendered-browser test exercises the request-detail governed-exception workspace without a live Supabase connection or a database migration.

```powershell
npx --yes --package=node@22.14.0 --package=pnpm@10.23.0 --call "pnpm --filter @intra/shell exec playwright test tests/e2e/task-8-exception-workspace.spec.ts --config=playwright.controlled-rpc.config.ts"
```

Result: passed on 2026-08-23.

Route: `/procurement/requests/controlled-request-0001`

## Rendered lifecycle

| Stage | Actor | Expected outcome |
| --- | --- | --- |
| Submit | Procurement submitter | A deliberate server-side validation failure is visible and recoverable; corrected petty-cash evidence enters `under review`. |
| Review | Independent Procurement reviewer | Procurement may record only the Procurement decision. |
| Review | Independent Finance reviewer | Finance may record only petty-cash eligibility. |
| Approval and refresh | Independent DOA actor | DOA records the final decision; a deliberate workspace refresh failure is visible and a subsequent refresh restores decision history. |
| Recovery | Procurement submitter | A policy-profile change produces the server blocker and exposes the actionable `Replace stale exception evidence` form. |

The fixture asserts that exactly the intentional submit and refresh 400 responses appear in the browser console. No other console errors are accepted. It also asserts the three review RPC calls come from distinct role actors in the required order.

## Viewports and screenshots

| Viewport | Submitter state | Approval/history state | Stale recovery state |
| --- | --- | --- | --- |
| Desktop, 1440 x 900 | `evidence/task-8-exception-submitter-desktop-1440.png` | `evidence/task-8-exception-history-desktop-1440.png` | `evidence/task-8-exception-recovery-desktop-1440.png` |
| Mobile, 390 x 844 | `evidence/task-8-exception-submitter-mobile-390.png` | `evidence/task-8-exception-history-mobile-390.png` | `evidence/task-8-exception-recovery-mobile-390.png` |

The captured renders were manually inspected. Desktop retains clear stage cards and history; mobile remains one-column with visible blockers and no observed clipped actions or horizontal overflow.

## Controlled-test boundary

The test uses `ControlledProcurementRpcFixture` and the local controlled Playwright configuration. It is evidence for rendered client behavior and RPC-contract handling, not a live Supabase/Auth/RLS certification. The migration remains unapplied.
