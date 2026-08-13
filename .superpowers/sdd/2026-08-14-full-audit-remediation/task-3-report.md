# Task 3 report

## Completed

- Published generic guided-review completion for role practices without a domain simulation adapter; Warehouse retains its registered receiving simulation, while policy and assessment activities retain their governed adapters.
- Added demo-session persistence for learning snapshots and completed checkpoints, scoped to the signed-in demo profile and its role bundle.
- Kept role denial separate from certification locks through the existing `CertifiedAction` and `LockedCapabilityRecovery` branches; no authority is granted by completion storage.
- Aligned canonical demo persona bundles and titles, removed unrelated Platform Administrator and Warehouse Administrator event/insights authority, and derived an honest fallback department from assigned authority.
- Scoped My Work items by their declared capability and source-record validity before applying filters, sorting, and priority counts. The Finance item now links to the Finance source record rather than the absent Procurement PO.

## TDD evidence

- RED: `modules/work/src/data.test.ts` failed because `scopeWorkItems` did not exist.
- RED: added Learning generic-practice and persistence regressions, plus demo-role/department regression coverage.
- GREEN verification was attempted with focused Vitest and TypeScript commands. This workspace is running Node `20.18.1` while the repository requires Node `>=22`; Vitest frequently stopped at its startup banner in this environment. The focused Work suite initially ran and reported the intended RED failure. `git diff --check` passes.

## Scope

Only Learning, My Work, shell persona/demo presentation, the directly related Work page, and their focused tests were changed. No Knowledge Base content, migration, Warehouse implementation, or business module files were edited.
