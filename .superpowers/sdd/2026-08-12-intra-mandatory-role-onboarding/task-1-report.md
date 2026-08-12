# Task 1 Report: Learning Domain Contracts and Catalog Validation

Status: DONE_WITH_CONCERNS

Commits:

- `71c1f78 feat(learning): define onboarding contracts and catalog`
- `be987d4 fix(learning): align curricula with role authority`
- `08c871d fix(rbac): preserve vendor onboarding evidence access`
- `7ab2aa5 fix(rbac): split vendor accreditation draft authority`

## Fix Round 4

Resolved re-review finding R1 through the live SQL authority path and the Legal
runtime without changing vendor row scope.

- Added the forward-only
  `20260812120000_vendor_accreditation_draft_rbac.sql` migration to register
  `core:manage_own_accreditation_draft` and grant it only to
  `core:vendor_portal`. The migration is additive and does not modify any
  historical seed or cutover migration.
- Guarded the exposed draft save and discard RPCs with
  `core.has_cap('core', 'manage_own_accreditation_draft')`. They continue to
  delegate to the existing private implementations that enforce
  `core.current_vendor_id()`, draft status, optimistic versioning, and all
  existing snapshot row predicates.
- Guarded the final vendor application transition separately with
  `core.has_cap('core', 'submit_accreditation')`. Draft authority cannot invoke
  the final transition, and the existing vendor-ID and draft-state checks remain
  in the private submission implementation.
- Kept `core:submit_documents` unchanged as the vendor onboarding evidence
  write. No internal role, cross-vendor role, or broader data scope received the
  new draft capability.
- Changed `LegalApp` authorization decisions from static `can(userRoles, ...)`
  calls to `useCan(...)`, which consumes the `core.my_capabilities()` projection
  in Supabase mode. The vendor case list remains available with read authority,
  while the application route requires the draft capability.
- Made the vendor draft repository fail closed before save/discard when the
  runtime capability is absent; the SQL RPC remains the authoritative boundary.

### Fix Round 4 RED/GREEN Evidence

**RED**

- `node --test scripts/verify-vendor-draft-rbac.test.mjs`: exit `1`; 3 expected
  failures for the absent forward migration, missing draft RPC capability guard,
  and missing final-submission capability guard.
- Focused Legal test run: the draft service assertion failed because an
  unauthorized save still reached the RPC. After isolating the pre-existing
  incomplete `@intra/ui` workspace link in the test, the UI assertion failed
  because a read-only vendor still rendered the application route.

**GREEN**

- `node --test scripts/verify-vendor-draft-rbac.test.mjs`: exit `0`; 3 tests
  passed for SQL registration/vendor-only grant, live capability projection,
  draft RPC enforcement, retained ownership scope, and separate final
  submission authority.
- Focused Legal UI/service run: exit `0`; 9 tests passed.
- Full Legal suite: exit `0`; 17 files and 135 tests passed.
- RBAC suite: exit `0`; 41 tests passed.
- Learning catalog suite: exit `0`; 11 tests passed.
- Legal, RBAC, and learning TypeScript project checks: exit `0`.
- Focused Legal lint and `git diff --check`: exit `0`.

### Fix Round 4 Files Changed

- `.superpowers/sdd/2026-08-12-intra-mandatory-role-onboarding/task-1-report.md`
- `modules/legal/src/LegalApp.accessDenied.test.ts`
- `modules/legal/src/LegalApp.tsx`
- `modules/legal/src/pages/VendorApplicationPage.tsx`
- `modules/legal/src/vendorApplicationDraft.test.ts`
- `modules/legal/src/vendorApplicationDraft.ts`
- `scripts/verify-vendor-draft-rbac.test.mjs`
- `supabase/migrations/20260812120000_vendor_accreditation_draft_rbac.sql`

### Fix Round 4 Self-Review Findings

- The SQL verifier scans the complete migration history and fails if the new
  capability is granted to any role other than `core:vendor_portal`.
- `core.my_capabilities()` remains the live projection source, joining active
  roles to `core.role_capabilities` for only `auth.uid()`.
- Draft save/discard and final submission remain distinct commands with distinct
  capabilities. Existing vendor-ID ownership, state, concurrency, and snapshot
  checks were not rewritten or relaxed.
- No later learning schema, internal role grant, historical migration, lockfile,
  or unrelated dirty file was changed.
- No live migration was applied and no database service credential was used, as
  required. Ignored local `node_modules` junctions were used only to restore the
  incomplete workspace link graph for full verification.

## Fix Round 3

Resolved re-review finding R1 by separating vendor-owned draft work from the
final accreditation submission transition.

- Added the vendor-only `core:manage_own_accreditation_draft` capability and
  granted it only to `core:vendor_portal`; no internal role or cross-vendor
  scope was added.
- Classified that capability as the authoritative `onboarding_write` access
  class. It therefore remains available to an authenticated invited vendor
  before live certification, alongside required `core:submit_documents`
  evidence upload.
- Kept `core:submit_accreditation` as a `mutation`; the existing vendor
  curriculum keeps its orientation and evidence/acknowledgment prerequisites
  before final submission can become live-certification eligible.
- Changed vendor case-detail and application route declarations to require the
  draft capability rather than final submission capability, so a vendor can
  open, create, and save only its own draft before completion. The existing
  vendor-scoped draft repository/RPCs remain unchanged for the later database
  task.
- Added shell capability guidance for the new draft authority and updated the
  Legal RBAC ownership comment to avoid stale capability documentation.

### Fix Round 3 RED/GREEN Evidence

**RED**

- `node modules/learning/node_modules/vitest/vitest.mjs run --root packages/rbac src/rbac.test.ts`: exit `1`; 2 expected assertion failures because `core:manage_own_accreditation_draft` had no authoritative classification or vendor role grant.
- `node modules/learning/node_modules/vitest/vitest.mjs run --root modules/learning --config vitest.config.ts src/catalog.test.ts`: exit `1`; expected assertion failure because the missing draft capability could not be classified as an onboarding write.
- `node modules/learning/node_modules/vitest/vitest.mjs run --root modules/legal src/routes.test.ts`: exit `1` before collection because the locally incomplete workspace link graph could not resolve `@intra/config`. After adding an ignored local junction to the existing package, the focused test executed normally; no source or lockfile was changed for the workaround.

**GREEN**

- `node modules/learning/node_modules/vitest/vitest.mjs run --root packages/rbac src/rbac.test.ts`: exit `0`; 41 tests passed.
- `node modules/learning/node_modules/vitest/vitest.mjs run --root modules/learning --config vitest.config.ts src/catalog.test.ts`: exit `0`; 11 tests passed.
- `node modules/learning/node_modules/vitest/vitest.mjs run --root modules/legal src/routes.test.ts`: exit `0`; 3 tests passed.
- `node modules/learning/node_modules/typescript/bin/tsc --noEmit --project packages/rbac/tsconfig.json`: exit `0`.
- `node modules/learning/node_modules/typescript/bin/tsc --noEmit --project modules/learning/tsconfig.json`: exit `0`.
- `node modules/learning/node_modules/typescript/bin/tsc --noEmit --target ES2022 --module ESNext --moduleResolution Bundler --skipLibCheck modules/legal/src/routes.ts apps/shell/lib/knowledge/capabilities.ts`: exit `0`.
- `node modules/learning/node_modules/eslint/bin/eslint.js packages/rbac/src/modules/core.ts packages/rbac/src/modules/legal.ts packages/rbac/src/registry.ts packages/rbac/src/rbac.test.ts modules/learning/src/catalog.test.ts`: exit `0`.
- `node modules/learning/node_modules/eslint/bin/eslint.js modules/legal/src/routes.ts modules/legal/src/routes.test.ts apps/shell/lib/knowledge/capabilities.ts`: exit `0`.

### Fix Round 3 Files Changed

- `apps/shell/lib/knowledge/capabilities.ts`
- `modules/learning/src/catalog.test.ts`
- `modules/legal/src/routes.ts`
- `modules/legal/src/routes.test.ts`
- `packages/rbac/src/modules/core.ts`
- `packages/rbac/src/modules/legal.ts`
- `packages/rbac/src/rbac.test.ts`
- `packages/rbac/src/registry.ts`

### Fix Round 3 Self-Review Findings

- The new capability is granted only to `core:vendor_portal`; it does not add
  an internal grant, a different vendor role, or a broader row scope.
- The catalog's exhaustive registry parity continues to cover the new
  capability, while its mutation-only curriculum rule correctly excludes the
  onboarding write.
- The route contracts no longer conflate opening or editing an application
  with final submission. Search confirmed `legal.create_accreditation_case` is
  used only by the internal invite flow; vendor drafts continue through the
  existing vendor-owned snapshot service.
- Full Legal and shell typechecks remain unavailable because the incomplete
  local workspace link graph cannot resolve unrelated package dependencies.
  The two changed non-React source files passed focused direct typechecking.
- `git diff --check` passed before staging. Pre-existing `apps/shell/next-env.d.ts`,
  screenshots, `.codex-tmp`, and `outputs` changes remain unstaged.

## Fix Round 2

Resolved re-review finding R1 without widening vendor RBAC.

- Added the authoritative `onboarding_write` access class for writes that are required to complete onboarding but must not require an active live capability certification.
- Classified only `core:submit_documents` as `onboarding_write`. The existing vendor role grant and RLS scope are unchanged; the classification does not add a role, capability, data scope, or final transition.
- Kept `core:submit_accreditation` as a certification-gated `mutation` and made its vendor role curriculum require the controlled `vendor.vendor_representative.evidence-and-acknowledgments.v1` requirement after orientation.
- Added `capabilityClassificationFor()` and `requiresLiveCertification()` to make gate behavior consume the same exhaustive RBAC classification source as learning.
- Preserved ungated internal read-only exploration and live-certification-gated normal internal mutations.

### Fix Round 2 RED/GREEN Evidence

**RED**

- `node modules/learning/node_modules/vitest/vitest.mjs run --root modules/learning --config vitest.config.ts src/catalog.test.ts`: exit `1`; 3 expected failures because `capabilityClassificationFor` and `requiresLiveCertification` did not exist, proving the authority contract could not distinguish evidence upload from final submission.

**GREEN**

- `node modules/learning/node_modules/vitest/vitest.mjs run --root modules/learning --config vitest.config.ts src/catalog.test.ts --reporter=verbose`: exit `0`; 11 tests passed, including incomplete vendor upload/final-submission, internal read-only, internal mutation, and exhaustive parity checks.
- `node modules/learning/node_modules/vitest/vitest.mjs run --root packages/rbac src/rbac.test.ts`: exit `0`; 41 tests passed.
- `node modules/learning/node_modules/typescript/bin/tsc --noEmit --project modules/learning/tsconfig.json`: exit `0`.
- `node modules/learning/node_modules/typescript/bin/tsc --noEmit --project packages/rbac/tsconfig.json`: exit `0`.
- `node modules/learning/node_modules/eslint/bin/eslint.js modules/learning packages/rbac/src/registry.ts packages/rbac/src/index.ts packages/rbac/src/rbac.test.ts`: exit `0`.
- `git diff --cached --check`: exit `0` before commit.

## Fix Round 1

Resolved reviewer findings I1-I4 and M1.

- I1: Role curricula are generated from authoritative `roleCapabilities`; every mutating role grant now has a requirement outcome on its concrete role curriculum. Persona mapping is used only to select the shared baseline orientation, never to infer capabilities.
- I2: Canonical persona baselines are orientation-only. Leadership's read-only baseline is complete without a simulation; the Insights Administrator role receives a separate capability practice and simulation for its actual mutation grant.
- I3: `RequirementProgressState` and `AssessmentResult.state` now use the approved requirement lifecycle: `not_started`, `in_progress`, `passed`, `failed_retryable`, `needs_support`, `expired`, and `waived`.
- I4: `@intra/rbac` now owns `CAPABILITY_CLASSIFICATIONS` and validates it against every declared RBAC capability exactly once. Learning derives `MUTATING_CAPABILITIES` from that source.
- M1: Catalog tests now enforce unique IDs, audience consistency, curriculum/requirement/prerequisite references, acyclic prerequisites, simulation integrity, authoritative RBAC outcomes, and mutation-classification parity.

### Fix Round RED/GREEN Evidence

**RED**

- `node modules/learning/node_modules/vitest/vitest.mjs run --root modules/learning --config vitest.config.ts src/catalog.test.ts`: exit `1`; expected failure `TypeError: ROLE_CURRICULA is not iterable` after adding the role-authority assertions and before implementing role curricula.

**GREEN**

- `node modules/learning/node_modules/vitest/vitest.mjs run --root modules/learning --config vitest.config.ts src/catalog.test.ts`: exit `0`; 8 tests passed.
- `node modules/learning/node_modules/vitest/vitest.mjs run --root packages/rbac src/rbac.test.ts`: exit `0`; 40 tests passed.
- `node modules/learning/node_modules/typescript/bin/tsc --noEmit --project modules/learning/tsconfig.json`: exit `0`.
- `node modules/learning/node_modules/typescript/bin/tsc --noEmit --project packages/rbac/tsconfig.json`: exit `0`.
- `node modules/learning/node_modules/eslint/bin/eslint.js modules/learning packages/rbac/src/registry.ts packages/rbac/src/index.ts`: exit `0`.
- `git diff --cached --check`: exit `0` before commit.

## Files Changed

- `modules/learning/package.json`
- `modules/learning/tsconfig.json`
- `modules/learning/vitest.config.ts`
- `modules/learning/vitest.setup.ts`
- `modules/learning/eslint.config.mjs`
- `modules/learning/src/types.ts`
- `modules/learning/src/personas.ts`
- `modules/learning/src/catalog.ts`
- `modules/learning/src/catalog.test.ts`
- `modules/learning/src/index.ts`
- `apps/shell/package.json`
- `apps/shell/lib/knowledge/operatingPersonas.ts`
- `package.json`
- `pnpm-lock.yaml`
- `packages/rbac/src/index.ts` (fix round 1)
- `packages/rbac/src/registry.ts` (fix round 1)
- `packages/rbac/src/rbac.test.ts` (fix round 2)

## Delivered

- Added `@intra/learning` with stable public learning, assessment, progress, certification, lock-recovery, snapshot, curriculum, requirement, and simulation contracts.
- Moved the eleven canonical operating persona records into the learning package and re-exported them from the shell knowledge module while retaining all shell guide and workflow definitions.
- Added a catalog with one audience-safe baseline curriculum per canonical persona, separate `internal.*` and `vendor.*` requirement identifiers, and mandatory coverage for every RBAC mutation capability.
- Preserved read-only exploration by excluding every current `view_*` capability and `insights:prepare_exports` from certification-gated mutation coverage.
- Added the requested root verification and live-onboarding script entries plus the shell workspace dependency.
- Kept the RBAC role and capability grant matrices unchanged. Fix round 1 adds only an authoritative capability access classification alongside the registry; learning does not grant roles or data scope.

## RED/GREEN Evidence

### RED

- `pnpm.cmd --filter @intra/learning test` before package creation: exit `0`, reporting `No projects matched the filters`. This pnpm 9 behavior did not match the brief's expected non-zero failure.
- A direct Vitest attempt before the package tooling existed failed with exit `1` because the test runner was not installed for the absent workspace. This confirmed the requested package/test surface was unavailable, but it could not execute the catalog assertions until the workspace existed.

### GREEN

- `node modules/learning/node_modules/vitest/vitest.mjs run --root modules/learning --config vitest.config.ts src/catalog.test.ts --reporter=verbose`: exit `0`; 2 tests passed.
- `node modules/learning/node_modules/typescript/bin/tsc --noEmit --project modules/learning/tsconfig.json`: exit `0`.
- `node modules/learning/node_modules/eslint/bin/eslint.js modules/learning`: exit `0`.
- `git diff --check`: exit `0` before commit.

## Commands and Outcomes

- `pnpm.cmd install --lockfile-only --offline --ignore-scripts`: exit `0`; registered the workspace. The pnpm 9 writer changed unrelated override/peer lock metadata, so that mechanical drift was reverted and the lockfile was retained with only the new learning importers.
- `pnpm.cmd install --offline --ignore-scripts --no-frozen-lockfile`: exit `1`; local link installation was blocked by an existing locked `@img/sharp-win32-x64/lib/libvips-42.dll`.
- `pnpm.cmd install --offline --ignore-scripts --frozen-lockfile`: exit `1`; the local pnpm 9 client cannot consume the repository's pnpm 10 lockfile override metadata.
- The GREEN commands above used temporary ignored junctions to the existing local package cache. Those links were not staged or committed.
- Existing shell guide compatibility test attempt: exit `1` before collection because the damaged workspace link graph cannot resolve unrelated `@intra/warehouse` from shell knowledge content. No assertion failed and no shell guide/task definition was changed.
- `git commit -m "feat(learning): define onboarding contracts and catalog"`: exit `0`; commit `71c1f78`.

## Self-Review Findings

- No RBAC role/capability grant matrix, RLS policy, React component, or operational repository was modified. Fix round 1 adds only the reviewed capability access classification beside the RBAC registry.
- The catalog completeness test exercises the real RBAC registry and fails if any derived mutating capability has no mandatory curriculum mapping.
- The audience test verifies all eleven canonical personas receive exactly one baseline curriculum and that vendor/internal requirement IDs never overlap.
- The lockfile diff was reviewed and limited to the shell dependency plus the `modules/learning` importer.
- The initial commit staged only the fourteen Task 1 files. Fix round 1 staged only its six learning/RBAC correction files. Pre-existing worktree changes were left untouched.

## Remaining Concerns

- The host is running Node `20.18.1` and pnpm `9.15.9`, while the repository requires Node `>=22` and pnpm `10.23.0`. This prevents the exact package-script verification path and frozen install from running normally.
- A pre-existing locked Sharp DLL prevented pnpm from rebuilding workspace links. The focused learning test, typecheck, and lint were nevertheless green through the cached toolchain.
- The newly registered root scripts target later-task artifacts that do not exist yet; they are intentionally not runnable until those tasks land.
