# Task 3 Report: Live Feature And Route Coverage Registry

## Status

Complete. The handbook now has a maintained 48-route manifest, one detailed live feature entry and derived reference article per route, and blocking route/capability/admin/content coverage checks. Coming-soon entries produce warnings and cannot satisfy live coverage.

## Implementation Commit

- SHA: `a77c0d17daa2099a0b5180fd4f7f45469fadc883`
- Subject: `feat: add handbook feature and coverage registry`

## Delivered

- Added `KNOWLEDGE_FEATURES` with 48 page-specific entries covering shell, auth, admin, warehouse, finance, procurement, Legal, and Vendor Portal destinations.
- Documented purpose, roles, capability IDs, controls, fields and validation, statuses, reads, writes, notifications, exceptions, owner/review date, and completion evidence for every live page.
- Added `LIVE_ROUTE_MANIFEST` and `buildKnowledgeCoverage(content)` with route-pattern and optional-trailing-slash normalization.
- Added blocking errors for undocumented routes, current capabilities, administrator-role coverage, controls, fields, reads/writes, statuses, notifications, exceptions, and completion evidence.
- Added warning-only handling for coming-soon references while preserving the corresponding live route gap.
- Derived feature reference articles from the feature registry and assembled them into `KNOWLEDGE_CONTENT`; existing procedure articles remain workflow guidance rather than a second feature authority.
- Extended the feature contract additively. New detail arrays are optional at the shared type boundary to preserve prior Task 1 fixtures, while live coverage requires them for all current features.

## TDD Evidence

1. Added `coverage.test.ts` against the requested public API before registry implementation.
2. Confirmed RED under bundled Node: the initial run failed because `./coverage` did not exist.
3. Added an API-only scaffold and confirmed assertion-level RED: 7 failures for missing manifest, route, capability, admin, controls, coming-soon behavior, and normalization. The initially vacuous detail assertion was tightened to require the independently counted 48 routes.
4. Implemented the registry and validator. The first green attempt exposed a literal-versus-parameter route collision where `/procurement/requests/:id` incorrectly covered `/procurement/requests/new`.
5. Corrected matching so only manifest parameter segments are wildcards; focused coverage finished at 8/8.

## Commands And Results

All final commands ran with bundled Node `v24.14.0` (`>=22`) and `pnpm.cmd`.

- `pnpm --filter @intra/shell exec vitest run lib/knowledge/coverage.test.ts lib/knowledge/content.test.ts lib/knowledge/validate.test.ts`
  - PASS: 3 files, 24 tests.
- `pnpm --filter @intra/shell test`
  - PASS: 6 files, 37 tests.
- `pnpm --filter @intra/shell typecheck`
  - PASS: `tsc --noEmit` exited 0.
- `pnpm exec prettier --check apps/shell/lib/knowledge/features.ts apps/shell/lib/knowledge/coverage.ts apps/shell/lib/knowledge/coverage.test.ts apps/shell/lib/knowledge/content.ts apps/shell/lib/knowledge/types.ts`
  - PASS: all matched files use Prettier style.
- `git diff --check`
  - PASS: no whitespace errors. Git emitted only the repository's Windows line-ending conversion notices.
- Independent source audit over `modules/warehouse/src/app/App.tsx`, `modules/procurement/src/ProcurementApp.tsx`, and `modules/legal/src/LegalApp.tsx`
  - PASS: manifest count 48, unique count 48, router-source routes missing from manifest 0.

## Self-Review

- Confirmed the manifest is separate from feature content and that tests compare it with independent warehouse `MODULES` and shell navigation sources.
- Confirmed literal routes cannot be satisfied by broader parameterized feature routes.
- Confirmed all current role capabilities have live feature documentation and no coming-soon entry contributes live route or capability coverage.
- Confirmed all 48 live entries contain non-empty plain-language detail and have one generated `feature-*` article.
- Corrected grouped optional filters so they are not described as mandatory fields; credential, transaction, invitation, submission, and signature groups remain explicitly required.
- Reconciled administrator claims against the live page gate and preserved all earlier role/content files unchanged.
- Reviewed the staged scope: only the five Task 3 implementation files were included in the implementation commit.

## Concerns

- Pre-existing contract mismatch: `procurement_admin` is documented in `roles.ts` as able to access `/admin/doa`, but the live page gate admits only `core:manage_rbac` or `legal:manage_doa`. The new live manifest and feature entry follow the actual gate (`platform_admin`, `legal_admin`) and do not modify the prior role registry. A later role/RBAC reconciliation should either grant the intended capability or remove the stale route claim.
- `/vendor/invites/new` exists because the same Legal router is mounted under `/vendor`; the registry documents it as a protected vendor route and expects no invitation write. The current server-side invitation API remains the authoritative permission boundary.
