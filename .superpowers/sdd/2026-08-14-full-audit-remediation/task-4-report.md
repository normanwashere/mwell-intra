# Task 4 Remediation Report

Date: 2026-08-14
Branch: `codex/task-4-procurement-finance-events-product-insights`

## Scope

Changed only `modules/procurement`, `modules/finance`, `modules/events`,
`modules/product`, `modules/insights`, their tests, and this required report.
No migrations or Shell, Warehouse, Legal, Learning, Work, or Knowledge files
were changed.

## Test-first Evidence

Added focused remediation specifications before implementation and observed the
expected initial failures for missing procurement submit/cancellation/rejection
validation, Finance close validation and seed lineage, Event memory settlement,
Product kit dependency, and Insights freshness/context behavior. Implemented the
smallest governed changes to make those tests pass.

## Delivered Controls

- Canonical Finance demo records now use `po_seed_004` / `PO-2026-0004` for the
  EventWorks event PO and expose the `evt-demo-lgu` settlement in the Finance
  close queue.
- Procurement blocks submission when evidence is incomplete, requires a
  meaningful rejection reason, and uses a reasoned confirmation sheet for PO
  cancellation. Failed live cancellation leaves the displayed PO unchanged and
  reports the failure.
- Memory-mode Procurement, Finance, Events, and Product workflows retain their
  locally recorded state and label cross-module handoffs as demo-only rather
  than claiming they were sent to a live downstream system.
- Finance close entries reject zero values, require meaningful exception notes,
  and enforce separate preparer/poster/reconciler actors in memory mode.
- Product readiness makes kit approval an explicit launch and Operations-handoff
  dependency; the memory contract preserves separate preparer and decision
  actors for readiness and pricing decisions.
- Insights classifies extractions older than 24 hours as stale, defines PR-to-PO
  cycle time as approved PR submission to first issued PO, and appends metric
  context to governed drill-down links. No nonfunctional Insights export action
  is rendered.

## Verification

- Focused module tests: 169 passed across Procurement (101), Finance (17),
  Events (19), Product (16), and Insights (16).
- TypeScript: `tsc --noEmit` passed in all five changed modules.
- ESLint: passed in all five changed modules.
- `git diff --check`: passed.
- Full repository suite: `pnpm test` passed, 15 of 15 Turbo tasks successful.

## SoD and Live Boundaries

Live actions continue through the existing RPC boundary. Memory actions are
explicitly demo-local, require their existing capabilities, and retain the
separation checks added for Finance posting/reconciliation and Product
preparation/decision flows. No backend schema or migration contract was changed.
