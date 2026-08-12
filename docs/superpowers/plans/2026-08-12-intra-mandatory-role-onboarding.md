# Mwell Intra Mandatory Role Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build mandatory, role-driven onboarding that teaches users inside realistic module simulations and enables each live mutation capability only after server-verified competency.

**Architecture:** Add a focused `@intra/learning` workspace for curriculum, progress, simulation, and onboarding UI. A dedicated Supabase `learning` schema owns versioned content and evidence; `core.my_capabilities()` projects only currently usable live capabilities, while guarded mutation RPCs call `core.has_live_cap()` for authoritative enforcement. Domain modules expose narrow training adapters using deterministic in-memory scenario state and stable DOM anchors, never operational repositories.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.6, Tailwind CSS, Supabase/PostgreSQL with RLS and guarded RPCs, Vitest 3, Playwright, Node test runner, Turborepo, pnpm 10.

## Global Constraints

- Preserve read-only exploration, Knowledge Base access, profile/access review, and safe recovery before certification.
- A certification never grants a role or widens row scope; live authority requires both active role capability and active capability certification.
- Multi-role users unlock capability groups independently; shared commands require every declared prerequisite certification.
- Training adapters and simulation state must never import or call operational mutation repositories.
- Browser storage may cache a resume hint but is never completion, score, certification, exception, or policy authority.
- Vendor onboarding uses vendor-only curricula, routes, services, and RLS and must not expose internal identifiers or content.
- Only a Platform Administrator may issue a scoped, expiring emergency exception; a separate business approver is required and Legal acknowledgments are never waivable.
- Emergency exceptions default to 4 hours and may never exceed 24 hours.
- Assessments default to an 80 percent passing score and three attempts unless a published requirement defines stricter rules.
- Published content is immutable. Material changes create retraining assignments and relock only affected capabilities.
- Supported certification widths are exactly `1440`, `1280`, `768`, `390`, `360`, and `320` pixels.
- Critical interactions meet the existing 44 by 44 pixel target floor and remain usable at 200 percent zoom and with reduced motion.
- A P0/P1, unauthorized live mutation, simulation business write, vendor/internal leak, broken required anchor, incomplete cleanup, or missing control-owner sign-off blocks release.
- Do not enable the live capability gate until baseline curricula are published and two designated Platform Administrators are certified.
- Follow TDD for every task and commit only that task's files after its tests pass.
- Before every commit, inspect `git status --short` and stage only task-owned paths; preserve all pre-existing or unrelated worktree changes.

## File and Boundary Map

### New learning workspace

- `modules/learning/src/types.ts`: stable domain contracts for curricula, requirements, assignments, attempts, certifications, exceptions, and snapshots.
- `modules/learning/src/catalog.ts`: canonical internal and vendor curriculum descriptors generated from current personas and capabilities.
- `modules/learning/src/resolver.ts`: pure curriculum deduplication, prerequisite, and role-by-role unlock logic.
- `modules/learning/src/repository.ts`: Supabase and memory repositories behind one narrow interface.
- `modules/learning/src/LearningProvider.tsx`: authenticated learning state, refresh, resume, and command context.
- `modules/learning/src/OnboardingCenter.tsx`: assignment and certification workspace.
- `modules/learning/src/CoachOverlay.tsx`: accessible desktop/mobile coach placement and navigation.
- `modules/learning/src/TrainingModeProvider.tsx`: isolated scenario state and declared simulated-command dispatcher.
- `modules/learning/src/LockedCapabilityRecovery.tsx`: actionable denial for uncertified mutations.
- `modules/learning/src/AssessmentRunner.tsx`: server-scored checks and retry/support states.
- `modules/learning/src/PolicyAcknowledgment.tsx`: controlled policy/version acknowledgment.
- `modules/learning/src/admin/*`: curriculum publishing and team-completion administration.
- `modules/learning/src/index.ts`: public exports only.

### Shell integration

- `apps/shell/app/onboarding/page.tsx`: internal Onboarding Center route.
- `apps/shell/app/onboarding/manage/page.tsx`: department-, Legal-, and platform-scoped content, assignment, completion, and exception administration.
- `apps/shell/app/vendor/onboarding/page.tsx`: external onboarding route.
- `apps/shell/app/providers.tsx`: mounts `LearningProvider` inside `SessionProvider`.
- `apps/shell/app/page.tsx`: replaces static orientation prominence with current onboarding status.
- `apps/shell/lib/navigation.ts`: adds universal onboarding navigation and admin governance entry.
- `apps/shell/components/knowledge/FirstTimeJourney.tsx`: retires local completion authority and links to current server state.
- `apps/shell/lib/knowledge/preferences.ts`: removes onboarding authority while preserving saved/recent/feedback preferences.

### Domain training adapters

- `modules/warehouse/src/training/*`: receiving, quality, inventory movement, returns, counts, location/bin, event custody, and exception scenarios.
- `modules/procurement/src/training/*`: request, DOA, sourcing, award, PO, and handoff scenarios.
- `modules/legal/src/training/*`: invitation, accreditation, evidence, instrument, lifecycle, and DOA scenarios.
- `modules/finance/src/training/*`: budget, match, payment readiness, valuation, close, and reconciliation scenarios.
- `modules/events/src/training/*`: event demand, fulfillment handoff, outcomes, and reconciliation scenarios.
- `modules/product/src/training/*`: readiness, price, go-live, and handoff scenarios.
- `apps/shell/components/training/*`: core/admin, General Employee, My Work, Insights, and cross-module coached scenarios.

### Supabase and verification

- `supabase/migrations/20260812090000_learning_foundation.sql`: schema, content, assignment, evidence, certification, and exception tables with RLS.
- `supabase/migrations/20260812093000_learning_services.sql`: curriculum resolution, progress, assessment, acknowledgment, certification, and exception RPCs.
- `supabase/migrations/20260812100000_learning_authority.sql`: effective capability projection and `core.has_live_cap()`.
- `supabase/migrations/20260812103000_learning_seed_curricula.sql`: initial persona/capability curriculum mappings.
- `supabase/migrations/20260812110000_learning_mutation_enforcement.sql`: adds certified-capability checks to current mutation RPCs.
- `scripts/verify-learning-schema.mjs`: static schema and privilege contract.
- `scripts/verify-learning-authority.mjs`: proves every current mutation capability/RPC has a certification rule.
- `scripts/qa/onboarding-live-e2e.mjs`: guarded live UAT certification and cleanup.
- `scripts/qa/onboarding-scenarios.mjs`: catalog-driven persona, multi-role, journey, and branch definitions.
- `scripts/qa/onboarding-live-e2e-contract.test.mjs`: fail-closed harness contracts.

---

### Task 1: Establish Learning Domain Contracts and Catalog Validation

**Files:**
- Create: `modules/learning/package.json`
- Create: `modules/learning/tsconfig.json`
- Create: `modules/learning/vitest.config.ts`
- Create: `modules/learning/vitest.setup.ts`
- Create: `modules/learning/eslint.config.mjs`
- Create: `modules/learning/src/types.ts`
- Create: `modules/learning/src/personas.ts`
- Create: `modules/learning/src/catalog.ts`
- Create: `modules/learning/src/catalog.test.ts`
- Create: `modules/learning/src/index.ts`
- Modify: `apps/shell/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/shell/lib/knowledge/operatingPersonas.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `LearningCapability`, `CurriculumDefinition`, `RequirementDefinition`, `SimulationDefinition`, `EffectiveCurriculum`, `LearningSnapshot`, `RequirementProgress`, `SimulationCheckpointInput`, `AssessmentSubmission`, `AssessmentResult`, `Certification`, `LockedCapability`, and `LEARNING_CATALOG`.
- Consumes: `Module`, `CapabilityFor`, and the capability registry from `@intra/rbac`.

- [ ] **Step 1: Write failing catalog completeness tests**

```ts
it("maps every mutating capability to at least one required curriculum", () => {
  for (const capability of MUTATING_CAPABILITIES) {
    expect(requiredCurriculaFor(capability), capabilityKey(capability)).not.toHaveLength(0);
  }
});

it("defines one audience-safe baseline for every canonical persona", () => {
  expect(new Set(LEARNING_CATALOG.curricula.map((item) => item.personaId)))
    .toEqual(new Set(OPERATING_PERSONA_IDS));
  expect(internalRequirementIds().some((id) => vendorRequirementIds().includes(id))).toBe(false);
});
```

- [ ] **Step 2: Run the new tests and verify the package is absent**

Run: `pnpm --filter @intra/learning test`

Expected: FAIL because `@intra/learning` and its catalog do not exist.

- [ ] **Step 3: Add the package and exact public contracts**

```ts
export interface LearningCapability<M extends Module = Module> {
  module: M;
  capability: string;
}

export type RequirementKind =
  | "orientation" | "policy" | "tour" | "scenario" | "assessment" | "attestation";

export interface RequirementDefinition {
  id: string;
  version: number;
  audience: "internal" | "vendor";
  kind: RequirementKind;
  title: string;
  mandatory: boolean;
  prerequisiteIds: readonly string[];
  capabilityOutcomes: readonly LearningCapability[];
  simulationId?: string;
  passingScore?: number;
  maxAttempts?: number;
}

export interface CurriculumDefinition {
  id: string;
  version: number;
  personaId: string;
  audience: "internal" | "vendor";
  requirementIds: readonly string[];
}
```

Move the canonical `OperatingPersona` records into `modules/learning/src/personas.ts` and re-export them from `@intra/learning`. Update `apps/shell/lib/knowledge/operatingPersonas.ts` to import those records while retaining its task/guide definitions. Populate the catalog with all 11 persona IDs and every current mutating capability. Keep content descriptors in the learning package; do not import React components or operational repositories.

Define the progress, assessment, certification, lock-recovery, and snapshot contracts in `types.ts` at the same time. Keep database row shapes private to `repository.ts`; public contracts use stable domain names and ISO timestamp strings. Add workspace dependencies on `@intra/auth`, `@intra/rbac`, and `@intra/ui` to `modules/learning/package.json`.

- [ ] **Step 4: Add root commands and workspace dependency**

Add these scripts:

```json
{
  "verify:learning-schema": "node scripts/verify-learning-schema.mjs",
  "verify:learning-authority": "node scripts/verify-learning-authority.mjs",
  "test:onboarding-live": "node scripts/qa/onboarding-live-e2e.mjs"
}
```

Add `"@intra/learning": "workspace:*"` to `apps/shell/package.json`.

Run `pnpm install --lockfile-only` to register the new workspace and dependency without changing unrelated package versions.

- [ ] **Step 5: Run package and monorepo structural checks**

Run: `pnpm --filter @intra/learning lint && pnpm --filter @intra/learning typecheck && pnpm --filter @intra/learning test`

Expected: PASS with all personas, mutation capabilities, prerequisites, and audiences validated.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml apps/shell/package.json apps/shell/lib/knowledge/operatingPersonas.ts modules/learning
git commit -m "feat(learning): define onboarding contracts and catalog"
```

### Task 2: Create the Learning Schema, RLS, and Static Verifier

**Files:**
- Create: `supabase/migrations/20260812090000_learning_foundation.sql`
- Create: `scripts/verify-learning-schema.mjs`
- Create: `scripts/verify-learning-schema.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: versioned learning tables, enum/check constraints, RLS policies, append-only evidence controls, and `verifyLearningSchema(sql)`.
- Consumes: authenticated profile IDs and department assignments already owned by `core`.

- [ ] **Step 1: Write failing schema verifier tests**

Test that the migration declares all required tables, enables RLS on each, revokes direct writes to authoritative evidence, prevents a grantor from approving their own exception, and keeps vendor policies separate.

```js
assert.match(sql, /create schema if not exists learning/i);
for (const table of REQUIRED_TABLES) {
  assert.match(sql, new RegExp(`alter table learning\\.${table} enable row level security`, "i"));
}
assert.doesNotMatch(sql, /grant\s+(insert|update).*learning\.certifications.*authenticated/i);
```

- [ ] **Step 2: Verify the test fails before the migration exists**

Run: `node --test scripts/verify-learning-schema.test.mjs`

Expected: FAIL with missing migration/table declarations.

- [ ] **Step 3: Create exact schema objects**

Create these tables with UUID primary keys, `created_at timestamptz not null default now()`, explicit foreign keys, and check constraints:

```sql
learning.curricula
learning.curriculum_versions
learning.requirements
learning.requirement_versions
learning.curriculum_requirements
learning.role_curricula
learning.assignments
learning.assignment_requirements
learning.attempts
learning.attempt_events
learning.policy_acknowledgments
learning.certifications
learning.emergency_exceptions
```

Use status checks matching the approved state models. Add partial unique indexes for one active certification per `(user_id, department_id, module, capability, source_role_assignment_id)` and one open assignment per `(user_id, curriculum_version_id, source_type, source_id)`.

- [ ] **Step 4: Add RLS and append-only controls**

Policies must allow learners to select only their own evidence, department owners to select scoped team completion, Legal owners to select governed policy evidence, and Platform Administrators to manage technical configuration. No authenticated role receives direct insert/update/delete on scores, certifications, attempt events, or exception approval fields.

- [ ] **Step 5: Run verifier and migration lint**

Run: `node --test scripts/verify-learning-schema.test.mjs && pnpm verify:learning-schema`

Expected: PASS with no missing table, RLS, privilege, index, or audience boundary.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/verify-learning-schema* supabase/migrations/20260812090000_learning_foundation.sql
git commit -m "feat(learning): add governed onboarding schema"
```

### Task 3: Implement Curriculum Resolution, Progress, Assessment, and Certification RPCs

**Files:**
- Create: `supabase/migrations/20260812093000_learning_services.sql`
- Create: `modules/learning/src/resolver.ts`
- Create: `modules/learning/src/resolver.test.ts`
- Create: `modules/learning/src/repository.ts`
- Create: `modules/learning/src/repository.test.ts`
- Modify: `modules/learning/src/index.ts`

**Interfaces:**
- Produces database RPCs `learning.my_learning_snapshot`, `learning.resolve_assignments`, `learning.start_requirement`, `learning.record_simulation_checkpoint`, `learning.submit_assessment`, `learning.acknowledge_policy`, `learning.evaluate_certifications`, and `learning.request_support`.
- Produces client interface `LearningRepository` with matching camel-case methods.
- Consumes Task 1 catalog IDs and Task 2 tables.

- [ ] **Step 1: Write resolver tests for role, admin, department, deduplication, and retraining inputs**

```ts
const result = resolveEffectiveCurriculum({
  roleCurricula: [finance, operations],
  departmentAssignments: [sharedPolicy],
  userAssignments: [correctiveReceiving],
  activeCertifications: [financeCertification],
});
expect(result.requirements.filter((r) => r.id === sharedPolicy.id)).toHaveLength(1);
expect(result.capabilities.find(isFinance)!.state).toBe("certified");
expect(result.capabilities.find(isReceiving)!.state).toBe("locked");
```

- [ ] **Step 2: Run tests and confirm the resolver/RPC surface is missing**

Run: `pnpm --filter @intra/learning test -- resolver`

Expected: FAIL on missing resolver exports.

- [ ] **Step 3: Implement the pure resolver and repository contract**

```ts
export interface LearningRepository {
  snapshot(): Promise<LearningSnapshot>;
  startRequirement(requirementVersionId: string): Promise<RequirementProgress>;
  checkpoint(input: SimulationCheckpointInput): Promise<RequirementProgress>;
  submitAssessment(input: AssessmentSubmission): Promise<AssessmentResult>;
  acknowledgePolicy(requirementVersionId: string, evidenceHash: string): Promise<void>;
  requestSupport(assignmentRequirementId: string, reason: string): Promise<void>;
  refreshCertifications(): Promise<readonly Certification[]>;
}
```

Implement the memory repository with in-memory Maps for unit tests and local demos. It must use the same state transitions and cannot be selected in a production build.

- [ ] **Step 4: Implement guarded RPC transitions**

All state-changing functions are `security definer set search_path = ''`, validate `auth.uid()`, lock the affected assignment row, enforce prerequisites and retry limits, append an attributable event, and return the canonical post-write record. `submit_assessment` receives answers but resolves answer keys server-side. `evaluate_certifications` issues idempotently from passed mandatory requirements.

- [ ] **Step 5: Add SQL contract assertions to repository tests**

Mock Supabase calls and assert exact schema/RPC names and payload keys. Add static checks that no service accepts `score`, `passed`, `certification_status`, or `answer_key` from the learner payload.

- [ ] **Step 6: Run learning tests and schema verification**

Run: `pnpm --filter @intra/learning test && pnpm verify:learning-schema`

Expected: PASS for deduplication, role-by-role state, retraining, idempotency contracts, and guarded RPC payloads.

- [ ] **Step 7: Commit**

```bash
git add modules/learning/src supabase/migrations/20260812093000_learning_services.sql
git commit -m "feat(learning): resolve curricula and certify competency"
```

### Task 4: Add Effective Capability Projection and Emergency Exception Authority

**Files:**
- Create: `supabase/migrations/20260812100000_learning_authority.sql`
- Create: `scripts/verify-learning-authority.mjs`
- Create: `scripts/verify-learning-authority.test.mjs`
- Modify: `packages/auth/src/contracts.ts`
- Modify: `packages/auth/src/claims.ts`
- Modify: `packages/auth/src/claims.test.ts`
- Modify: `packages/auth/src/SessionProvider.tsx`
- Modify: `packages/auth/src/Guard.test.tsx`

**Interfaces:**
- Produces: `core.has_live_cap(p_module text, p_cap text) returns boolean` and a backward-compatible `core.my_capabilities()` effective projection.
- Produces: `SessionValue.roleCapabilities` for raw role-derived capabilities and retains `userCapabilities` as effective live capabilities.
- Consumes: active learning certifications, exceptions, and current role assignments.

- [ ] **Step 1: Write failing authority tests**

Cover read-only capabilities, uncertified mutation capabilities, certified capabilities, expired/revoked certifications, role removal, valid exception, expired exception, self-approved exception, and non-waivable policy requirements.

```ts
expect(effectiveCapability(roleCap, { certification: null })).toBe(false);
expect(effectiveCapability(roleCap, { certification: active })).toBe(true);
expect(effectiveCapability(noRoleCap, { certification: active })).toBe(false);
```

- [ ] **Step 2: Run Auth and verifier tests to prove the new projection is absent**

Run: `pnpm --filter @intra/auth test && node --test scripts/verify-learning-authority.test.mjs`

Expected: FAIL on missing raw/effective projections and SQL functions.

- [ ] **Step 3: Implement database authority**

`core.has_live_cap()` must return true only when:

```sql
core.has_cap(p_module, p_cap)
and (
  not learning.is_certification_required(p_module, p_cap)
  or learning.has_active_certification(auth.uid(), p_module, p_cap)
  or learning.has_active_emergency_exception(auth.uid(), p_module, p_cap)
)
```

Keep read-only capabilities outside `learning.mutation_capability_rules`, so navigation and exploration remain available. Return raw and effective capability projections in separate RPCs.

- [ ] **Step 4: Extend SessionProvider without creating a stale-authority window**

Load `core.my_role_capabilities()` and `core.my_capabilities()` in the same refresh generation. Clear both on focus/user change before refetch. Fail closed for effective capabilities while retaining verified identity and raw role context for onboarding explanations.

- [ ] **Step 5: Run Auth tests and authority verifier**

Run: `pnpm --filter @intra/auth test && pnpm verify:learning-authority`

Expected: PASS; effective mutation capabilities disappear until certified while read-only capabilities remain.

- [ ] **Step 6: Commit**

```bash
git add packages/auth scripts/verify-learning-authority* supabase/migrations/20260812100000_learning_authority.sql
git commit -m "feat(auth): enforce certified live capabilities"
```

### Task 5: Build LearningProvider and the Onboarding Center Route

**Files:**
- Create: `modules/learning/src/LearningProvider.tsx`
- Create: `modules/learning/src/LearningProvider.test.tsx`
- Create: `modules/learning/src/OnboardingCenter.tsx`
- Create: `modules/learning/src/OnboardingCenter.test.tsx`
- Create: `modules/learning/src/OnboardingProgress.tsx`
- Modify: `modules/learning/src/index.ts`
- Create: `apps/shell/app/onboarding/page.tsx`
- Modify: `apps/shell/app/providers.tsx`
- Modify: `apps/shell/app/page.tsx`
- Modify: `apps/shell/lib/navigation.ts`
- Modify: `apps/shell/lib/navigation.test.ts`
- Create: `apps/shell/tests/e2e/onboarding-center.spec.ts`

**Interfaces:**
- Produces: `LearningProvider`, `useLearning()`, `OnboardingCenter`, `/onboarding`, and `ONBOARDING_NAV`.
- Consumes: `LearningRepository`, authenticated profile, raw role capabilities, and effective capabilities.

- [ ] **Step 1: Write failing provider and center tests**

Test loading, load failure, empty assignment, required assignment, multi-role deduplication, active certificate, expired certificate, retraining, support state, emergency warning, and vendor redirect.

- [ ] **Step 2: Run focused tests and verify the route/provider are missing**

Run: `pnpm --filter @intra/learning test -- LearningProvider OnboardingCenter`

Expected: FAIL on missing components.

- [ ] **Step 3: Implement LearningProvider**

```ts
export interface LearningContextValue {
  snapshot: LearningSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh(): Promise<void>;
  resume(requirementId: string): void;
  isLiveCapability(module: Module, capability: string): boolean;
  lockedReason(module: Module, capability: string): LockedCapability | null;
}
```

Refresh after sign-in, focus, role/capability refresh, completion, certification, exception change, and explicit retry. Keep previous valid read-only snapshot visible with a stale warning when a refresh fails, but fail closed for mutation state.

- [ ] **Step 4: Implement the responsive Onboarding Center**

Use unframed page sections and individual assignment rows. Show persona/role context, required status, progress, duration, deadline, next action, certification outcomes, locked capabilities, policy state, and recovery. Mobile prioritizes Resume, status, and next requirement before detail.

- [ ] **Step 5: Integrate shell route and navigation**

Mount `LearningProvider` under `SessionProvider`. Add Onboarding for every authenticated profile; vendor profiles link to `/vendor/onboarding`. Add a compact dashboard status band rather than another module card.

- [ ] **Step 6: Run component, shell, and Playwright tests**

Run: `pnpm --filter @intra/learning test && pnpm --filter @intra/shell test && pnpm --filter @intra/shell exec playwright test tests/e2e/onboarding-center.spec.ts`

Expected: PASS on desktop/mobile status, navigation, error recovery, role labels, and no blank/loop state.

- [ ] **Step 7: Commit**

```bash
git add modules/learning apps/shell/app/onboarding apps/shell/app/providers.tsx apps/shell/app/page.tsx apps/shell/lib/navigation* apps/shell/tests/e2e/onboarding-center.spec.ts
git commit -m "feat(onboarding): add personalized learning center"
```

### Task 6: Build the Accessible Training Runtime and Anchor Contracts

**Files:**
- Create: `modules/learning/src/training/types.ts`
- Create: `modules/learning/src/training/registry.ts`
- Create: `modules/learning/src/training/registry.test.ts`
- Create: `modules/learning/src/TrainingModeProvider.tsx`
- Create: `modules/learning/src/TrainingModeProvider.test.tsx`
- Create: `modules/learning/src/CoachOverlay.tsx`
- Create: `modules/learning/src/CoachOverlay.test.tsx`
- Create: `modules/learning/src/TrainingBanner.tsx`
- Create: `modules/learning/src/training.css`
- Create: `apps/shell/tests/e2e/onboarding-coach-accessibility.spec.ts`
- Modify: `modules/learning/src/index.ts`

**Interfaces:**
- Produces: `TrainingAdapter<TState>`, `TrainingScenario`, `TrainingStep`, `TrainingCommand`, `registerTrainingAdapter()`, `TrainingModeProvider`, and `CoachOverlay`.
- Consumes: repository checkpoint service and stable `data-onboarding-anchor` attributes from later domain tasks.

- [ ] **Step 1: Write failing runtime tests**

Cover declared commands only, immutable initial state, deterministic reset, checkpoint idempotency, missing/ambiguous anchor stop, keyboard focus, Back, Exit, Resume Later, reduced motion, mobile sheet, and resize repositioning.

```ts
export interface TrainingAdapter<TState> {
  id: string;
  version: number;
  scenarioIds: readonly string[];
  initialState(scenarioId: string): TState;
  dispatch(state: TState, command: TrainingCommand): TrainingTransition<TState>;
}
```

- [ ] **Step 2: Run tests and verify runtime exports are absent**

Run: `pnpm --filter @intra/learning test -- training CoachOverlay`

Expected: FAIL.

- [ ] **Step 3: Implement the training dispatcher with a hard command boundary**

The provider receives an adapter directly and never a Supabase operational client. Reject unknown commands and commands invalid for the current step. Report only declared checkpoint IDs and outcome metadata.

- [ ] **Step 4: Implement accessible coach placement**

Desktop chooses right, left, bottom, then top based on collision-free space. Mobile uses a collapsible bottom sheet. On step change, focus the coach heading; on close, return focus to the launcher. Stop with `Training needs an update` when `document.querySelectorAll(anchor)` does not return exactly one visible target.

- [ ] **Step 5: Add runtime dependency guards**

In `registry.test.ts`, scan `modules/*/src/training` and fail if files import known operational repositories such as `localStore`, `data/supabase`, `createRepository`, or call `.rpc(` / `.from(`.

- [ ] **Step 6: Run component and Playwright accessibility tests**

Run: `pnpm --filter @intra/learning test && pnpm --filter @intra/shell exec playwright test tests/e2e/onboarding-coach-accessibility.spec.ts`

Expected: PASS at all six widths, keyboard-only, reduced motion, and 200 percent zoom.

- [ ] **Step 7: Commit**

```bash
git add modules/learning/src apps/shell/tests/e2e/onboarding-coach-accessibility.spec.ts
git commit -m "feat(onboarding): add isolated coached simulation runtime"
```

### Task 7: Deliver the Warehouse Receiving Pilot End to End

**Files:**
- Create: `modules/warehouse/src/training/receivingAdapter.ts`
- Create: `modules/warehouse/src/training/receivingAdapter.test.ts`
- Create: `modules/warehouse/src/training/index.ts`
- Modify: `modules/warehouse/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `modules/warehouse/src/pages/ReceivingPage.tsx`
- Modify: `modules/warehouse/src/pages/ReceivingPage.test.tsx`
- Create: `apps/shell/tests/e2e/onboarding-receiving-pilot.spec.ts`
- Modify: `modules/learning/src/catalog.ts`
- Modify: `modules/learning/src/catalog.test.ts`

**Interfaces:**
- Produces simulation `warehouse-receiving-v1` with clean, missing-batch, duplicate-serial, over-receipt, damaged-delivery, partial-receipt, interruption, and terminal-completion branches.
- Consumes: Task 6 training runtime and existing Receiving page visual controls.

- [ ] **Step 1: Write adapter tests for every receiving branch**

Assert delivery date/batch requirements, serialized SKU per-unit scans, merch/event-material barcode behavior, destination, evidence, quality handoff, duplicate/over-receipt denial, and terminal evidence.

- [ ] **Step 2: Run adapter tests and verify missing implementation**

Run: `pnpm --filter @intra/warehouse test -- receivingAdapter`

Expected: FAIL.

- [ ] **Step 3: Implement deterministic scenario state**

Use training-only IDs such as `TRAIN-PO-1042`, `TRAIN-BATCH-A`, and `TRAIN-SERIAL-0001`. Dispatch pure commands and return state plus checkpoint/outcome. Do not import the Warehouse store or Supabase client.

- [ ] **Step 4: Add stable anchors to actual receiving controls**

Add immutable anchors including:

```tsx
data-onboarding-anchor="receiving.purchase-order"
data-onboarding-anchor="receiving.delivery-date"
data-onboarding-anchor="receiving.batch-number"
data-onboarding-anchor="receiving.add-line"
data-onboarding-anchor="receiving.serial-input"
data-onboarding-anchor="receiving.submit"
```

Do not alter visible labels merely to satisfy tests.

- [ ] **Step 5: Wire training mode without touching live submission**

When `TrainingModeProvider` owns the receiving adapter, controls dispatch simulation commands. Otherwise preserve the existing live repository path. Add a runtime assertion that a training provider cannot receive the live submit callback.

Add `"@intra/learning": "workspace:*"` to `modules/warehouse/package.json` and run `pnpm install --lockfile-only`.

- [ ] **Step 6: Run unit and E2E pilot tests**

Run: `pnpm --filter @intra/warehouse test && pnpm --filter @intra/shell exec playwright test tests/e2e/onboarding-receiving-pilot.spec.ts`

Expected: PASS for all branches, refresh/resume, six widths, zero live requests, and certification checkpoint readback.

- [ ] **Step 7: Commit**

```bash
git add pnpm-lock.yaml modules/warehouse/package.json modules/warehouse/src/training modules/warehouse/src/pages/ReceivingPage* modules/learning/src/catalog* apps/shell/tests/e2e/onboarding-receiving-pilot.spec.ts
git commit -m "feat(warehouse): teach receiving through safe simulation"
```

### Task 8: Add Assessment, Policy, and Locked-Capability Recovery UI

**Files:**
- Create: `modules/learning/src/AssessmentRunner.tsx`
- Create: `modules/learning/src/AssessmentRunner.test.tsx`
- Create: `modules/learning/src/PolicyAcknowledgment.tsx`
- Create: `modules/learning/src/PolicyAcknowledgment.test.tsx`
- Create: `modules/learning/src/LockedCapabilityRecovery.tsx`
- Create: `modules/learning/src/LockedCapabilityRecovery.test.tsx`
- Create: `modules/learning/src/CertifiedAction.tsx`
- Create: `modules/learning/src/CertifiedAction.test.tsx`
- Create: `apps/shell/tests/e2e/onboarding-assessment-and-lock.spec.ts`
- Modify: `modules/learning/src/index.ts`

**Interfaces:**
- Produces: `AssessmentRunner`, `PolicyAcknowledgment`, `LockedCapabilityRecovery`, and `CertifiedAction`.
- Consumes: `LearningProvider`, server assessment/policy RPCs, raw role capability, and effective live capability.

- [ ] **Step 1: Write failing tests for pass/fail/support and actionable denials**

Test that answers are submitted once, answer keys are absent, explanations appear after scoring, exhausted retries show support, acknowledgment includes exact version, generic role denial stays distinct from training lock, and direct action replay is prevented.

- [ ] **Step 2: Run tests and verify components are missing**

Run: `pnpm --filter @intra/learning test -- Assessment Policy Locked CertifiedAction`

Expected: FAIL.

- [ ] **Step 3: Implement assessment and policy components**

Use semantic fieldsets, one question per mobile viewport, explicit save state, progress, and retry/support paths. Render controlled-document metadata and require explicit checkbox plus `Acknowledge policy`; never infer acceptance from scrolling.

- [ ] **Step 4: Implement capability-aware action wrapper**

```tsx
<CertifiedAction module="warehouse" capability="receive_stock">
  {({ execute }) => <button onClick={() => execute(receive)}>Receive</button>}
</CertifiedAction>
```

If the user lacks role authority, show normal access guidance. If the role grants the capability but training is incomplete, show the exact requirement and Resume action. The wrapper is UX only; the RPC remains authoritative.

- [ ] **Step 5: Run tests and E2E direct-recovery checks**

Run: `pnpm --filter @intra/learning test && pnpm --filter @intra/shell exec playwright test tests/e2e/onboarding-assessment-and-lock.spec.ts`

Expected: PASS for assessment branches, policy versioning, training-aware recovery, and no partial command.

- [ ] **Step 6: Commit**

```bash
git add modules/learning/src apps/shell/tests/e2e/onboarding-assessment-and-lock.spec.ts
git commit -m "feat(onboarding): assess competency and explain locked work"
```

### Task 9: Implement Internal Persona Curricula and Domain Simulations

**Files:**
- Create: `apps/shell/components/training/coreAdminAdapters.ts`
- Create: `apps/shell/components/training/generalEmployeeAdapters.ts`
- Create: `apps/shell/components/training/insightsAdapters.ts`
- Create: `apps/shell/components/training/shellAdapters.test.ts`
- Create: `modules/warehouse/src/training/inventoryAdapters.ts`
- Create: `modules/warehouse/src/training/inventoryAdapters.test.ts`
- Create: `modules/warehouse/src/training/custodyAdapters.ts`
- Create: `modules/warehouse/src/training/custodyAdapters.test.ts`
- Create: `modules/procurement/src/training/procurementAdapters.ts`
- Create: `modules/procurement/src/training/procurementAdapters.test.ts`
- Create: `modules/legal/src/training/legalAdapters.ts`
- Create: `modules/legal/src/training/legalAdapters.test.ts`
- Create: `modules/finance/src/training/financeAdapters.ts`
- Create: `modules/finance/src/training/financeAdapters.test.ts`
- Create: `modules/events/src/training/eventsAdapters.ts`
- Create: `modules/events/src/training/eventsAdapters.test.ts`
- Create: `modules/product/src/training/productAdapters.ts`
- Create: `modules/product/src/training/productAdapters.test.ts`
- Modify: `modules/procurement/package.json`
- Modify: `modules/legal/package.json`
- Modify: `modules/finance/package.json`
- Modify: `modules/events/package.json`
- Modify: `modules/product/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/shell/app/admin/users/page.tsx`
- Modify: `apps/shell/app/admin/departments/page.tsx`
- Modify: `apps/shell/app/admin/doa/page.tsx`
- Modify: `apps/shell/app/admin/audit/page.tsx`
- Modify: `modules/work/src/WorkApp.tsx`
- Modify: `modules/insights/src/InsightsApp.tsx`
- Modify: `modules/warehouse/src/pages/LocationsPage.tsx`
- Modify: `modules/warehouse/src/pages/StorageAreasPage.tsx`
- Modify: `modules/warehouse/src/pages/OperationRoutesPage.tsx`
- Modify: `modules/warehouse/src/pages/QualityPage.tsx`
- Modify: `modules/warehouse/src/pages/InventoryPage.tsx`
- Modify: `modules/warehouse/src/pages/AllocationsPage.tsx`
- Modify: `modules/warehouse/src/pages/EventDetailPage.tsx`
- Modify: `modules/warehouse/src/pages/ReturnsPage.tsx`
- Modify: `modules/warehouse/src/pages/CycleCountsPage.tsx`
- Modify: `modules/warehouse/src/pages/ExceptionsPage.tsx`
- Modify: `modules/warehouse/src/components/ReplenishmentControlPanel.tsx`
- Modify: `modules/procurement/src/pages/CreateRequestPage.tsx`
- Modify: `modules/procurement/src/pages/RequestDetailPage.tsx`
- Modify: `modules/procurement/src/pages/ApprovalInboxPage.tsx`
- Modify: `modules/procurement/src/pages/PurchaseOrdersPage.tsx`
- Modify: `modules/procurement/src/pages/PODetailPage.tsx`
- Modify: `modules/procurement/src/pages/AcceptanceWorkItemPage.tsx`
- Modify: `modules/legal/src/pages/InviteVendorPage.tsx`
- Modify: `modules/legal/src/pages/AccreditationCasesPage.tsx`
- Modify: `modules/legal/src/pages/CaseDetailPage.tsx`
- Modify: `modules/legal/src/pages/SignInstrumentPage.tsx`
- Modify: `modules/finance/src/FinanceApp.tsx`
- Modify: `modules/finance/src/components/FinanceReviewQueue.tsx`
- Modify: `modules/finance/src/components/FinanceClosePanel.tsx`
- Modify: `modules/events/src/EventsApp.tsx`
- Modify: `modules/product/src/ProductApp.tsx`
- Modify: `modules/learning/src/catalog.ts`
- Modify: `modules/learning/src/catalog.test.ts`
- Create: `apps/shell/tests/e2e/onboarding-all-personas.spec.ts`

**Interfaces:**
- Produces: all internal simulation IDs referenced by the Task 1 catalog and complete persona curricula for the first 10 internal personas.
- Consumes: Task 6 runtime, Task 7 pilot pattern, and current 25 workflow decision trees.

- [ ] **Step 1: Expand catalog tests to require every declared simulation and branch**

For each curriculum tour/scenario requirement, assert one registered adapter, matching version, nonempty scenario set, at least one happy terminal, every declared exception terminal, valid anchors, and capability outcomes.

- [ ] **Step 2: Run the catalog tests and capture the missing adapter list**

Run: `pnpm --filter @intra/learning test -- catalog registry`

Expected: FAIL listing every unimplemented internal simulation ID.

- [ ] **Step 3: Implement shell/admin/employee/insights adapters**

Cover user access, departments, DOA, audit, purchase/stock request, My Work handoff, event demand, read-only insights provenance, governed export, access denial, and recovery. Leadership simulations must remain read-only.

Add `"@intra/learning": "workspace:*"` to Procurement, Legal, Finance, Events, and Product package dependencies, then run `pnpm install --lockfile-only`.

- [ ] **Step 4: Implement remaining Warehouse and Events adapters**

Cover location/bin setup, operation routes, quality, putaway/movement, event allocation/issue/return/loss/re-kitting/reconciliation, returns/quarantine/replacement/refund handoff, cycle count/adjustment, inventory integrity, replenishment, and exceptions.

- [ ] **Step 5: Implement Procurement, Legal, Finance, and Product adapters**

Cover request/budget/DOA, sourcing, award, vendor eligibility, PO, receiving handoff, accreditation/instruments/lifecycle, three-way match/payment readiness, valuation/COGS/expense/write-off/event settlement/close, readiness/pricing/go-live, and negative/exception branches.

- [ ] **Step 6: Add anchors without changing visible workflow semantics**

Use feature-scoped names such as `procurement.request.business-need` and `legal.accreditation.request-correction`. Contract tests must fail on duplicates and absent anchors.

- [ ] **Step 7: Run domain suites and all-persona E2E**

Run: `pnpm test && pnpm --filter @intra/shell exec playwright test tests/e2e/onboarding-all-personas.spec.ts`

Expected: PASS for every internal persona, applicable curriculum, branch, handoff, denied boundary, and supported viewport.

- [ ] **Step 8: Commit**

```bash
git add pnpm-lock.yaml apps/shell/app/admin apps/shell/components/training apps/shell/tests/e2e/onboarding-all-personas.spec.ts modules/learning/src/catalog* modules/work/src/WorkApp.tsx modules/insights/src/InsightsApp.tsx modules/warehouse/src modules/procurement/package.json modules/procurement/src modules/legal/package.json modules/legal/src modules/finance/package.json modules/finance/src modules/events/package.json modules/events/src modules/product/package.json modules/product/src
git commit -m "feat(onboarding): cover every internal persona and workflow"
```

### Task 10: Build the Isolated Vendor Onboarding Journey

**Files:**
- Create: `modules/learning/src/vendor/vendorCatalog.ts`
- Create: `modules/learning/src/vendor/vendorCatalog.test.ts`
- Create: `modules/legal/src/training/vendorOnboardingAdapter.ts`
- Create: `modules/legal/src/training/vendorOnboardingAdapter.test.ts`
- Create: `apps/shell/app/vendor/onboarding/page.tsx`
- Modify: `modules/legal/src/LegalApp.tsx`
- Modify: `modules/legal/src/pages/VendorApplicationPage.tsx`
- Create: `apps/shell/tests/e2e/onboarding-vendor.spec.ts`
- Modify: `modules/learning/src/catalog.ts`

**Interfaces:**
- Produces: vendor-only curriculum, external Onboarding Center, invitation/account/evidence/declaration/signature/correction/submission/status journey.
- Consumes: vendor profile kind, Legal vendor application services, and training runtime.

- [ ] **Step 1: Write failing external-boundary tests**

Assert vendor curriculum contains no internal role/curriculum/anchor IDs, vendor APIs cannot enumerate internal records, expired/replayed invitations fail, final submission stays locked before acknowledgment, and evidence actions required to finish onboarding remain available.

- [ ] **Step 2: Run vendor tests and verify missing journey**

Run: `pnpm --filter @intra/learning test -- vendor && pnpm --filter @intra/legal test -- vendorOnboarding`

Expected: FAIL.

- [ ] **Step 3: Implement vendor catalog and simulation**

Use external copy and vendor-only screen anchors. Include missing document, wrong file, expired evidence, correction, declaration conflict, signature, session expiry, invite replay, and support branches.

- [ ] **Step 4: Integrate real application progression safely**

Do not require final accreditation before the vendor can complete the application. Gate only premature submission and controlled transitions. Preserve existing invite, account setup, draft, upload, and correction RPC authority.

- [ ] **Step 5: Run vendor E2E on desktop and mobile**

Run: `pnpm --filter @intra/shell exec playwright test tests/e2e/onboarding-vendor.spec.ts`

Expected: PASS for receipt/setup, expiry/replay, application, evidence, correction, submission, status, isolation, and recovery.

- [ ] **Step 6: Commit**

```bash
git add modules/learning/src/vendor modules/legal/src/training apps/shell/app/vendor/onboarding apps/shell/tests/e2e/onboarding-vendor.spec.ts
git commit -m "feat(vendor): add isolated accreditation onboarding"
```

### Task 11: Add Curriculum Governance, Team Monitoring, and Emergency Exceptions

**Files:**
- Create: `modules/learning/src/admin/CurriculumAdmin.tsx`
- Create: `modules/learning/src/admin/CurriculumAdmin.test.tsx`
- Create: `modules/learning/src/admin/TeamCompletion.tsx`
- Create: `modules/learning/src/admin/TeamCompletion.test.tsx`
- Create: `modules/learning/src/admin/EmergencyExceptionForm.tsx`
- Create: `modules/learning/src/admin/EmergencyExceptionForm.test.tsx`
- Create: `modules/learning/src/admin/PublicationReview.tsx`
- Create: `modules/learning/src/admin/LearningOperationsPanel.tsx`
- Create: `modules/learning/src/admin/LearningOperationsPanel.test.tsx`
- Create: `apps/shell/app/onboarding/manage/page.tsx`
- Modify: `apps/shell/app/admin/page.tsx`
- Modify: `apps/shell/lib/navigation.ts`
- Create: `apps/shell/tests/e2e/onboarding-governance.spec.ts`
- Create: `supabase/migrations/20260812102000_learning_governance_services.sql`

**Interfaces:**
- Produces draft/review/publish/schedule/supersede/retire UI, scoped assignment UI, team completion, materiality/retraining preview, and exception issue/revoke UI.
- Consumes Task 3 services and Task 4 authority.

- [ ] **Step 1: Write failing governance tests**

Cover owner/reviewer separation, effective date, change reason, materiality, source policy, missing anchor publication block, department scoping, user assignment, optional/mandatory choice, dry-run impact, exception self-approval denial, max duration, expiry, revocation, and Legal non-waiver.

- [ ] **Step 2: Run focused tests and verify admin surfaces are absent**

Run: `pnpm --filter @intra/learning test -- admin`

Expected: FAIL.

- [ ] **Step 3: Implement curriculum publication workflow**

Use a full-width workspace with tabs for Content, Requirements, Questions, Simulations, Review, and Impact. Do not create nested cards. Publication submits immutable version facts and blocks on missing review fields or anchor verification.

- [ ] **Step 4: Implement scoped team monitoring and assignment**

Department owners see only authorized users and curricula. Platform Administrators see platform status. Legal sees policy completion in scope. Provide filters, overdue/blocked states, CSV export, and direct support assignment without exposing assessment answers.

Add `LearningOperationsPanel` for curriculum-resolution latency/failures, requirement abandonment, anchor failures, scoring/support outcomes, certification lifecycle, locked attempts, exception use, resume conflicts, and vendor boundary denials. Read from aggregate learning/audit views; never render raw answers or business payloads.

- [ ] **Step 5: Implement emergency exception workflow**

Require exact capability, reason, reference, business approver, start, and expiry. Show a prominent non-certification warning. Require confirmation that no Legal acknowledgment is waived. Revoke through a separate confirmation dialog.

- [ ] **Step 6: Run governance E2E and authorization tests**

Run: `pnpm --filter @intra/learning test && pnpm --filter @intra/shell exec playwright test tests/e2e/onboarding-governance.spec.ts`

Expected: PASS for Platform Admin, department owner, Legal owner, learner denial, and cross-department denial.

- [ ] **Step 7: Commit**

```bash
git add modules/learning/src/admin apps/shell/app/onboarding/manage apps/shell/app/admin/page.tsx apps/shell/lib/navigation* apps/shell/tests/e2e/onboarding-governance.spec.ts supabase/migrations/20260812102000_learning_governance_services.sql
git commit -m "feat(onboarding): govern curricula and temporary exceptions"
```

### Task 12: Seed Effective Curricula and Enforce Every Current Mutation RPC

**Files:**
- Create: `supabase/migrations/20260812103000_learning_seed_curricula.sql`
- Create: `supabase/migrations/20260812110000_learning_mutation_enforcement.sql`
- Modify: `scripts/verify-learning-authority.mjs`
- Modify: `scripts/verify-learning-authority.test.mjs`
- Create: `scripts/verify-learning-catalog-parity.mjs`
- Create: `scripts/verify-learning-catalog-parity.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces all initial curriculum/requirement/role/capability rows and authoritative certification checks for every current mutation RPC.
- Consumes Tasks 1, 4, 7, 9, and 10 catalogs and Task 11 publication rules.

- [ ] **Step 1: Generate a failing parity report**

Compare TypeScript catalog IDs/versions/capabilities with SQL seed facts. Compare all registered mutating RPCs with `learning.mutation_capability_rules` and SQL definitions that call `core.has_live_cap()`.

Run: `node --test scripts/verify-learning-catalog-parity.test.mjs && pnpm verify:learning-authority`

Expected: FAIL listing unseeded curricula and unenforced mutation RPCs.

- [ ] **Step 2: Seed only approved published baseline versions**

Insert deterministic IDs, version `1`, audiences, requirements, prerequisite edges, role mappings, and mutation capability rules. Do not seed completion, certification, or exception records.

- [ ] **Step 3: Add `core.has_live_cap()` to each current mutation RPC**

For each business command, check the exact module/capability before any lock or write. Shared commands check all declared prerequisites. Preserve existing role, ownership, DOA, segregation, quantity, evidence, and state checks after certification; certification never replaces them.

```sql
if not core.has_live_cap('warehouse', 'receive_stock') then
  raise exception using errcode = '42501', message = 'ONBOARDING_REQUIRED:warehouse:receive_stock';
end if;
```

- [ ] **Step 4: Add a compatibility feature flag for controlled activation**

`learning.enforcement_enabled()` returns false until the UAT bootstrap activation RPC records two certified Platform Administrators and the approved activation event. The UAT/prod activation is an explicit operational step, not migration-time auto-enable.

- [ ] **Step 5: Run authority, catalog, operational-flow, and policy verification**

Run: `pnpm verify:learning-schema && pnpm verify:learning-authority && node --test scripts/verify-learning-catalog-parity.test.mjs && pnpm verify:operational-flows && pnpm verify:finance-event-authority`

Expected: PASS with zero current mutation gap and no weakened pre-existing control.

- [ ] **Step 6: Commit**

```bash
git add package.json scripts/verify-learning-* supabase/migrations/20260812103000_learning_seed_curricula.sql supabase/migrations/20260812110000_learning_mutation_enforcement.sql
git commit -m "feat(learning): enforce onboarding on governed mutations"
```

### Task 13: Replace Static Orientation Authority and Update the Knowledge Base

**Files:**
- Modify: `apps/shell/components/knowledge/FirstTimeJourney.tsx`
- Modify: `apps/shell/components/knowledge/HandbookLanding.tsx`
- Modify: `apps/shell/lib/knowledge/preferences.ts`
- Modify: `apps/shell/lib/knowledge/content.ts`
- Modify: `apps/shell/lib/knowledge/features.ts`
- Modify: `apps/shell/lib/knowledge/operatingPersonas.ts`
- Modify: `apps/shell/lib/knowledge/content.test.ts`
- Modify: `apps/shell/tests/e2e/knowledge-handbook.spec.ts`
- Modify: `apps/shell/tests/e2e/knowledge-handbook-visual.spec.ts`
- Modify: `scripts/verify-knowledge-base.mjs`

**Interfaces:**
- Produces Knowledge Base links to current assignments, simulations, certifications, locked-action recovery, retraining, governance, exceptions, and vendor onboarding.
- Consumes LearningProvider state and all published curriculum IDs.

- [ ] **Step 1: Update tests to reject browser-only onboarding authority**

Assert `KnowledgePreferences` no longer contains `onboardingComplete` or `onboardingStep`; `FirstTimeJourney` displays live status and opens `/onboarding`; every persona guide lists required curriculum and simulations; every onboarding article maps to a released route.

- [ ] **Step 2: Run Knowledge Base tests and verify old behavior fails**

Run: `pnpm --filter @intra/shell test -- knowledge && pnpm verify:knowledge-base`

Expected: FAIL while localStorage completion remains.

- [ ] **Step 3: Replace the static carousel with server-backed status**

Completed users see certifications and retraining status. Incomplete users see exact next requirement and Resume. The Knowledge Base remains searchable guidance, not the authority that unlocks work.

- [ ] **Step 4: Add detailed role and workflow onboarding guidance**

For every persona, explain required competencies, enabled capabilities, prerequisites, handoffs, exceptions, recovery, and retraining. Add dedicated governance and vendor articles. Link actual simulations and current screenshots where available.

- [ ] **Step 5: Run Knowledge Base unit, visual, and navigation tests**

Run: `pnpm --filter @intra/shell test && pnpm --filter @intra/shell exec playwright test tests/e2e/knowledge-handbook.spec.ts tests/e2e/knowledge-handbook-visual.spec.ts && pnpm verify:knowledge-base`

Expected: PASS with no refresh loop, dead link, shallow role guide, missing simulation, or stale authority copy.

- [ ] **Step 6: Commit**

```bash
git add apps/shell/components/knowledge apps/shell/lib/knowledge apps/shell/tests/e2e/knowledge-handbook* scripts/verify-knowledge-base.mjs
git commit -m "docs(knowledge): integrate mandatory role onboarding"
```

### Task 14: Build the Catalog-Driven UAT Certification Harness

**Files:**
- Create: `scripts/qa/onboarding-scenarios.mjs`
- Create: `scripts/qa/onboarding-live-e2e.mjs`
- Create: `scripts/qa/onboarding-live-e2e-contract.test.mjs`
- Create: `scripts/qa/onboarding-live-cleanup.mjs`
- Modify: `scripts/qa/full-intra-live-e2e.mjs`
- Modify: `scripts/verify-launch-artifacts.mjs`
- Modify: `scripts/verify-launch-artifacts.test.mjs`
- Modify: `.github/workflows/uat-live-certification.yml`
- Create: `apps/shell/tests/e2e/onboarding-responsive.spec.ts`
- Create: `apps/shell/tests/e2e/onboarding-security.spec.ts`

**Interfaces:**
- Produces three-cycle role/journey certification artifacts, exact-ID cleanup evidence, responsive screenshots, operational-row before/after checks, and fail-closed release bundle verification.
- Consumes all catalogs, UAT personas, Supabase vaulted credentials, and existing live harness conventions.

- [ ] **Step 1: Write harness contracts before the runner**

Assert coverage generation includes all personas, all required curricula, every registered scenario/branch, compatible multi-role fixtures, six widths, accessibility, direct API/RPC bypass, zero operational writes, role/retraining/exception cases, vendor isolation, and three cycles.

- [ ] **Step 2: Run contract tests and capture missing coverage**

Run: `node --test scripts/qa/onboarding-live-e2e-contract.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement deterministic scenario generation**

Use unique marker `QA-ONBOARD-<date>-<run>-<persona>-<viewport>`. Serialize mutating runs per identity. Use fresh browser contexts and do not run the same account concurrently. Record UI, DB, audit, certification, denial, and cleanup facts per case.

- [ ] **Step 4: Implement operational zero-write verification**

Snapshot exact row counts and IDs for protected operational tables before simulation; query again after completion and cleanup. Fail on any unexpected inventory ledger, receipt, request, PO, vendor decision, event, finance, access, or audit-business record.

- [ ] **Step 5: Extend CI and launch artifact verification**

Add shards for all six route/visual widths, controlled transaction/simulation certification, security bypass, and independent cleanup. Bundle verification fails if any catalog item is absent, a shard reports partial coverage, or cleanup has nonzero remaining rows.

- [ ] **Step 6: Run local harness contracts and Playwright suites**

Run: `node --test scripts/qa/onboarding-live-e2e-contract.test.mjs && pnpm --filter @intra/shell exec playwright test tests/e2e/onboarding-responsive.spec.ts tests/e2e/onboarding-security.spec.ts`

Expected: PASS with deterministic local fixtures and fail-closed negative fixtures. Runtime output is written under ignored `test-results/onboarding/`; do not add generated evidence to the code commit.

- [ ] **Step 7: Commit**

```bash
git add package.json scripts/qa scripts/verify-launch-artifacts* .github/workflows/uat-live-certification.yml apps/shell/tests/e2e/onboarding-*.spec.ts
git commit -m "test(onboarding): certify every role journey and authority boundary"
```

### Task 15: Bootstrap, Deploy to UAT, Activate, and Run Three Certification Cycles

**Files:**
- Create: `scripts/qa/bootstrap-uat-onboarding.mjs`
- Create: `scripts/qa/bootstrap-uat-onboarding.test.mjs`
- Create: `docs/runbooks/onboarding-activation.md`
- Modify: `apps/shell/app/api/health/route.ts`
- Modify: `apps/shell/tests/api/health.test.ts`
- Update generated UAT test workbook in `outputs/` using `@oai/artifact-tool`; do not store passwords

**Interfaces:**
- Produces a controlled UAT activation command, health evidence, certified bootstrap administrators, assignments for all UAT personas, three complete run artifacts, and an updated role-by-flow workbook.
- Consumes vaulted UAT Supabase service credentials and the deployed exact commit.

- [ ] **Step 1: Write bootstrap and health tests**

Test dry-run impact, exact environment/project guard, two distinct Platform Administrators, required curriculum publication, idempotent assignment generation, activation denial before prerequisites, and health fields `learningSchema`, `learningContent`, and `learningEnforcement`.

- [ ] **Step 2: Run bootstrap tests and verify the command is absent**

Run: `node --test scripts/qa/bootstrap-uat-onboarding.test.mjs && pnpm --filter @intra/shell test -- health`

Expected: FAIL.

- [ ] **Step 3: Implement guarded bootstrap**

Require `APP_ENV=uat`, expected Supabase project ref, explicit `POLICY_ALLOW_TEST_MUTATIONS=true`, and an `--activate` flag. Default is dry-run. Certify the two bootstrap administrators through the same server evidence path; do not insert certifications directly.

- [ ] **Step 4: Write the activation/rollback runbook**

Document prerequisite checks, dry-run report, content publication, bootstrap administrator evidence, assignment generation, activation, monitoring, emergency exception verification, rollback by disabling enforcement, and evidence retention.

- [ ] **Step 5: Run the complete local quality gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm verify:learning-schema && pnpm verify:learning-authority && pnpm verify:knowledge-base && node --test scripts/qa/onboarding-live-e2e-contract.test.mjs`

Expected: every command PASS.

- [ ] **Step 6: Push the implementation branch and wait for exact UAT deployment**

Verify `/api/health` reports `appEnv=uat`, the intended UAT Supabase project, exact Git SHA, reachable Supabase, published learning content, and enforcement disabled before activation.

- [ ] **Step 7: Dry-run, bootstrap, and activate UAT**

Run the dry-run first and review every locked UAT persona/capability. Then bootstrap two administrators, generate assignments, verify exception issuance/revocation, and activate enforcement.

- [ ] **Step 8: Execute three complete certification cycles**

Run baseline, clean replay, and recovery cycles for all 11 personas, multi-role fixtures, all registered journeys/branches, and six widths. Preserve screenshots and structured evidence. Verify independent cleanup after every cycle.

- [ ] **Step 9: Update the comprehensive test workbook**

Use `@oai/artifact-tool` to add onboarding cases and actual run evidence per role, journey, flow, viewport, database readback, audit, cleanup, and defect. Render and visually inspect key sheets; scan formulas for errors. Never embed passwords or service credentials.

- [ ] **Step 10: Obtain control-owner sign-off before production planning**

Require QA, Product, Security, Legal, and each affected department owner. Do not promote to production with an open P0/P1, missing vendor isolation evidence, incomplete operational zero-write proof, or incomplete cleanup.

- [ ] **Step 11: Commit runbook and non-secret certification references**

```bash
git add scripts/qa/bootstrap-uat-onboarding* docs/runbooks/onboarding-activation.md apps/shell/app/api/health/route.ts apps/shell/tests/api/health.test.ts
git commit -m "ops(onboarding): add controlled UAT activation and certification"
```

## Final Verification Checklist

- [ ] Every current mutation capability maps to a published curriculum and `core.has_live_cap()` enforcement.
- [ ] All 11 personas receive the intended audience-safe curriculum.
- [ ] Compatible multi-role fixtures prove deduplication and role-by-role unlock.
- [ ] Shared commands remain locked until every prerequisite certification is active.
- [ ] All simulation adapters are pure, registered, versioned, branch-complete, and operational-repository-free.
- [ ] Simulations produce zero operational business rows or ledger movements.
- [ ] Direct UI, URL, API/RPC, and database bypass attempts fail without partial writes.
- [ ] Assessment, policy, certification, retraining, and emergency-exception authority is server-side and attributable.
- [ ] Vendor onboarding cannot enumerate or render internal content, IDs, roles, or APIs.
- [ ] Knowledge Base content and screenshots match the deployed onboarding state.
- [ ] Automated and human visual checks pass at all six widths, 200 percent zoom, keyboard-only, screen reader, and reduced-motion modes.
- [ ] Three UAT cycles pass with exact commit/project evidence and independent zero-residue cleanup.
- [ ] QA, Product, Security, Legal, and affected department owners sign off.
