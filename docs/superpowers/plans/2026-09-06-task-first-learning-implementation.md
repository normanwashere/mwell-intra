# Task-first Learning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make one task-first onboarding and Knowledge Base experience help every persona and multi-role user perform current Intra work safely, with less visible complexity and measurable usability.

**Architecture:** Retain the learning authority and shared UI engine. Add a task presentation layer in the shell that references existing knowledge content and capabilities, with a pure learning-priority projection in the learning module. Contextual help is a shared UI facility; transaction handlers, policy evidence, certification, and server authorization remain authoritative.

**Tech Stack:** Existing Next.js/React shell, internal UI library, embedded React Router modules, Supabase, Vitest, Playwright, existing workflow/evidence renderer, and standalone handbook generator.

**Spec:** [Task-first learning design](../specs/2026-09-06-task-first-learning-design.md).

## Global Constraints

- Reuse the app's design tokens, icons, and components. No new visual theme or card-heavy landing page.
- Use one shared experience for all eleven operating personas and multi-role users. One experience does not mean identical requirements or interchangeable permissions.
- Preserve mandatory flags, policy versions, passing scores, attempt limits, certification expiry, role scope, DOA, ownership, and server checks.
- No clipped text or horizontal page scrolling at 320, 360, 390, 768, 1280, and 1440 CSS pixels. Diagram pan is contained and has an accessible text equivalent.
- Mobile: single-column content, 44 by 44 CSS-pixel minimum action targets, thumb-reachable navigation, and forms unaffected by help overlays.
- Do not store raw search text, form values, serials, filenames, tokens, policy answers, or customer/vendor record payloads in experience telemetry.
- No generated pictures may be presented as actual app evidence; do not relax provenance or screenshot-age rules.
- UAT is the release/certification target first. No production deployment, password reset, broad seed deletion, or policy waiver is implied by this plan.
- Planning does not change the app. All implementation tasks below are pending.

## Baseline and working rules

Repository: `C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding`. The similarly named Warehouse directory is not the target.

The worktree already contains the uncommitted action-scoped candidate. Preserve it and inspect its diff before starting. Its recorded local checks are in `docs/audits/2026-09-06-ONBOARDING-EVOLUTION-VERIFICATION.md`; they do not establish live UAT status. Establish a reviewed commit/deployment baseline during Task 1 rather than assuming the branch name identifies the running app.

Use focused commits after each reviewed task, staging explicit owned files. Do not use `git add .`, reset unrelated work, commit secrets, or merge simultaneous edits to shared files without an integration review.

Each task follows a red/green test cycle: add the stated test, observe the intended assertion failure rather than a missing dependency/build error, implement the bounded change, run focused tests, review the diff, and commit only the task's files. Code blocks below define implementation contracts and test expectations, not permission to change server authority.

## Milestones and ownership

| Milestone | Tasks | Independently reviewable outcome | Owner |
| --- | --- | --- | --- |
| M0: Safe baseline | 1-2 | Verified rollout prerequisites and complete task/content inventory | Integration lead plus security/content reviewers |
| M1: Task-first entry | 3-5 | One noncompeting entry experience and action-relevant learning | Shared-learning and shell frontend owners |
| M2: Guidance at work | 6-8 | Contextual help, standardized guides, actual screenshots, useful search | Frontend, content/process, and evidence owners |
| M3: Measurement | 9 | Minimal telemetry and actionable aggregate feedback | Data/security owner |
| M4: UAT acceptance | 10-12 | Automated evidence, real-user pilot, corrected release, updated handbook | QA, business owners, release lead |

Dependency order: `1 -> 2 -> 3 -> 4 -> 5`; `2 -> 7 -> 8`; `3 + 5 + 7 -> 6`; `3 -> 9`; `5 + 6 + 7 + 8 + 9 -> 10 -> 11 -> 12`.

Content inventory and scenario authoring can proceed alongside frontend implementation after the contract is frozen. Do not capture final screenshots until the corresponding UI build is stable. Do not run production builds while a memory dev server uses the nested `.next/memory-simulations` output.

## File ownership map

| Boundary | Existing integration points | Proposed additions |
| --- | --- | --- |
| Task presentation metadata | `apps/shell/lib/knowledge/types.ts`, `taskGuidance.ts`, `features.ts`, `workflows.ts`, `audience.ts` | `taskCatalog.ts`, `taskRecommendations.ts`, corresponding tests |
| Learning projection | `modules/learning/src/types.ts`, `LearningProvider.tsx`, `OnboardingCenter.tsx`, `OnboardingStatusBand.tsx`, `requirementIdentity.ts` | `taskReadiness.ts`, `TaskLearningSummary.tsx`, tests |
| Entry screens | `apps/shell/app/page.tsx`, `app/onboarding/page.tsx`, `app/vendor/onboarding/page.tsx`, `components/knowledge/HandbookLanding.tsx` | `components/knowledge/TaskStart.tsx`, tests |
| KB secondary introduction | `components/knowledge/FirstTimeJourney.tsx`, `lib/knowledge/preferences.ts`, `preferences.test.ts` | No second completion store; retire or relabel introductory component |
| Contextual help | `packages/ui/src/ContextualHelpLink.tsx`, `index.ts`, `apps/shell/components/AppShell.tsx`, `app/providers.tsx`, `app/api/knowledge/context/route.ts` | UI help-context contract; shell `ContextualTaskHelp.tsx`; audience-safe guide response |
| Task guide rendering | `FeatureGuide.tsx`, `StepWorkspace.tsx`, `WorkflowCanvas.tsx`, `GuidedDecisionPath.tsx`, `EvidenceViewer.tsx`, `GuideOutline.tsx` | `TaskGuide.tsx` only if existing renderers cannot compose the shared structure cleanly |
| Coverage/evidence | `coverage.ts`, `evidenceContract.ts`, `validate.ts`, `productionEvidence.json`, `scripts/docs/handbook-stage-contracts.mjs` | Coverage inventory and capture/review manifest, not duplicated screenshots without provenance |
| Search | `search.ts`, `KnowledgeBase.tsx`, `HandbookLanding.tsx`, `search.test.ts` | Stable-task indexing and a 55-query benchmark fixture |
| Measurement | Existing authentication, server client, deployment/RLS conventions | `lib/knowledge/experienceEvents.ts`, `app/api/knowledge/experience/route.ts`, a CLI-created migration, tests |
| Verification/docs | Existing onboarding/KB Playwright specs, SQL tests, manuals, handbook build | Task-first acceptance spec, pilot protocol/results, release verification report |

Do not add shell or KB dependencies to the learning module. The shell supplies task metadata; the learning module accepts capability references and derives requirement readiness. A proposed path is a planned file, not an assertion that it exists today.

## Task 1: Freeze and verify the safety baseline

**Files:** inspect existing candidate files and `supabase/migrations/20260906043800_gate_legacy_po_cancel_and_vendor_acknowledgement.sql`; modify release/audit notes only until the candidate is reviewed.

**Consumes:** current worktree, live deployment identifiers, published learning metadata. **Produces:** a baseline manifest containing repo commit, app deployment, migration state, curriculum versions, and test/evidence paths.

- [ ] Record the current diff, lockfile, UAT project/database identity, and reviewed candidate commit without exposing credentials.
- [ ] Run the existing SQL authority and publication-guard tests before changing the experience.

```powershell
node --test scripts/verify-learning-authority-lifecycle.test.mjs scripts/verify-vendor-evidence-publication.test.mjs
pnpm --filter @intra/learning test
pnpm --filter @intra/shell typecheck
```

- [ ] Require tests that uncertified direct cancellation and vendor acknowledgement are denied; valid exact-role certification succeeds; ownership/hash/revision checks still reject invalid commands.
- [ ] Record that existing server title/simulation-based orientation sharing is not being redefined. Do not promise cross-version deduplication in server credit unless separately implemented and tested.
- [ ] Prepare vendor curriculum publication as a versioned, reviewed change only if it is included in the live release. Compare obligations before/after; retain existing history and current published versions. If excluded, keep the new exercise clearly non-live and out of live task recommendations.
- [ ] Apply reviewed security prerequisites to UAT through the existing governed deployment process before exposing the new navigation. Verify direct RPC behavior with designated UAT fixtures and preserve tester seed data.

**Exit:** migration/learning version matrix is explicit; no legacy UI navigation gate is being treated as transaction security. No public credential is created or pasted into documentation.

## Task 2: Inventory current tasks, content, and policy coverage

**Files:** `apps/shell/lib/knowledge/features.ts`, `featureDetails.ts`, `workflows.ts`, `roles.ts`, `taskGuidance.ts`, `coverage.ts`, `validate.ts`; create `docs/audits/task-first-coverage.md` and a machine-readable inventory beside the knowledge tests.

**Consumes:** implemented feature/control inventory, existing role and policy references. **Produces:** reviewed task IDs and coverage for every live function; explicit exclusions for limited/coming-soon behavior.

- [ ] Enumerate live features, routes, controls, relevant role scopes, mutations, decisions, and existing evidence IDs. Compare module route registries with KB content rather than assuming the KB is complete.
- [ ] For each control record: task ID, feature ID, owner, prerequisite record state, capability, expected persisted result, next owner, failure/recovery path, policy version, and screenshot target.
- [ ] Classify gaps as missing documentation, incorrect UI behavior, unavailable business function, or stale evidence. Missing business functionality is not fixed by inventing guide steps.
- [ ] Add an inventory test that fails for any live control without a reviewed task/reference mapping, unresolved task target, orphan decision edge, or executable coming-soon destination.
- [ ] Review the persona matrix in the design with department/process owners; resolve conflicting terms through display labels without changing permission IDs.
- [ ] Freeze the first three task priorities per persona and the full library inventory. Unknown/new roles receive an honest empty state and existing support route, not another persona's tasks.

**Exit:** every implemented control is accounted for and each missing item has a specific owner and disposition. Current procurement, DOA, vendor evidence/MNDA, and Warehouse rules are linked to their existing controlled references; no unverified thresholds are transcribed.

## Task 3: Add a stable task catalog and safe recommendations

**Files:** create `apps/shell/lib/knowledge/taskCatalog.ts`, `taskRecommendations.ts`, and tests; extend existing `taskGuidance.ts` mapping and content validation.

**Consumes:** Task 2 inventory, audience-filtered content, current role/record eligibility. **Produces:** presentation-only task definitions and deterministic recommendations.

```ts
export interface TaskDefinition {
  id: string;
  title: string;
  outcome: string;
  audience: "internal" | "vendor";
  roleIds: readonly string[];
  featureId: string;
  flowId?: string;
  actionCapabilities: readonly { module: string; capability: string }[];
  availability: "live" | "limited" | "coming_soon";
  priority: number;
}
export interface TaskRecommendationInput {
  tasks: readonly TaskDefinition[];
  eligibleTaskIds: ReadonlySet<string>;
  selectedTaskId?: string;
  resumableTaskId?: string;
  assignedTaskIds: readonly string[];
}
export function recommendTasks(input: TaskRecommendationInput): TaskDefinition[];
```

Implementation order: filter to eligible live tasks; selected first; resumable second; verified assigned work order third; curated priority then stable ID. Deduplicate IDs and take three. Eligibility comes from the existing audience/access projection, never the persona label. The function does not determine authority.

```ts
expect(recommendTasks({ tasks, eligibleTaskIds: new Set(["receive", "pick"]),
  selectedTaskId: "pay", assignedTaskIds: ["receive", "receive", "pick"] })
  .map(task => task.id)).toEqual(["receive", "pick"]);
```

- [ ] Test zero tasks, duplicate tasks, unavailable queue data, unknown task ID, coming-soon exclusion, and same-title/different-ID tasks.
- [ ] Test vendor/internal isolation before ranking; no forbidden task titles or counts leak into vendor payloads.
- [ ] Reuse existing feature/list destinations. Parameterized records require a verified source item; absent/deleted records return to the appropriate list/recovery.
- [ ] Export only shell-level presentation contracts. Do not write to the RBAC registry or learning catalog from recommendation code.

**Exit:** every recommendation has a deterministic, valid destination and cannot grant access.

## Task 4: Project task-specific learning without changing authority

**Files:** create `modules/learning/src/taskReadiness.ts` and tests; modify `OnboardingCenter.tsx`, `OnboardingStatusBand.tsx`, `index.ts`; add `TaskLearningSummary.tsx` only for reusable presentation.

**Consumes:** existing `LearningSnapshot`, `LearningCapability`, requirement definitions/progress and selected action capabilities. **Produces:** selected-task learning priorities, not new grants.

```ts
export interface TaskLearningProjection {
  status: "known" | "unavailable";
  neededNow: readonly RequirementDefinition[];
  otherRequired: readonly RequirementDefinition[];
  optional: readonly RequirementDefinition[];
}
export function projectTaskLearning(
  snapshot: LearningSnapshot | null,
  audience: "internal" | "vendor",
  capabilities: readonly LearningCapability[],
  stale: boolean,
): TaskLearningProjection;
```

- [ ] Write a failing test that selected receiving requirements include their complete prerequisite closure but do not include an unrelated Finance requirement.
- [ ] Test exact version matching, missing/cyclic prerequisites, revoked assignment, retry exhaustion, policy update, expired credit, multi-role duplicate definitions, wrong audience, and absent snapshot. Unknown graph/state returns unavailable; it never means ready.
- [ ] Build groups from current governed snapshot. Order prerequisites before dependents. Never mutate `mandatory`, progress, attempt count, or certification state.
- [ ] Preserve the existing separate-tab recovery and explicit access refresh. Pass a safe selected-task context from the shell as optional presentation props; old requirement/next deep links remain valid.
- [ ] Add "All assigned learning" without hiding mandatory obligations or changing deadlines. A dismissed recommendation does not dismiss a requirement.

```ts
expect(projectTaskLearning(null, "internal", [], false).status)
  .toBe("unavailable");
expect(inputSnapshot).toEqual(beforeProjection);
```

**Exit:** users see relevant learning first, and existing direct-RPC denial tests still pass unchanged.

## Task 5: Replace competing entry screens with one task start

**Files:** create shell `components/knowledge/TaskStart.tsx`; modify Home, onboarding wrappers, `HandbookLanding.tsx`, `KnowledgeBase.tsx`, `FirstTimeJourney.tsx`, `preferences.ts`, and tests.

**Consumes:** Task 3 recommendations and Task 4 learning projection. **Produces:** consistent task-first entry across Home/onboarding/KB.

- [ ] Add tests for all eleven personas and the defined multi-role combinations showing at most three relevant tasks, all authorized modules, and a full-library link.
- [ ] Replace the KB's separate "Orientation complete" signal. Existing local intro preferences may become a dismissed introduction or reading preference; they must never map to server learning progress.
- [ ] Migrate local preference reads compatibly: keep saved/recent articles; safely tolerate malformed/blocked storage; do not upload historical local data automatically; isolate account/audience changes.
- [ ] Preserve old KB query modes, article deep links, selected step, history, and reading position. Refresh/tab return must not remount the operational form or trigger unnecessary session restoration.
- [ ] Present unknown/error/loading/empty states independently. Do not fabricate an empty queue or reset a learner when a request fails.
- [ ] Add accessible first-screen states for desktop/mobile, long role names, 200% zoom, and keyboard navigation.

```ts
// A local introduction preference is not a learning credential.
expect(learningSnapshotAfterIntroDismissal).toEqual(learningSnapshotBefore);
await expect(page.locator('[data-task-id="unassigned-admin-task"]')).toHaveCount(0);
```

**Exit:** there is one governed onboarding completion concept, one task-start component, and no forced general tour.

## Task 6: Add contextual help without disturbing operational work

**Files:** `packages/ui/src/ContextualHelpLink.tsx`, `index.ts`, new UI help-context provider; shell `ContextualTaskHelp.tsx`, `providers.tsx`, `AppShell.tsx`, `app/api/knowledge/context/route.ts`, relevant tests.

**Consumes:** approved task/guide IDs and audience-filtered content. **Produces:** optional side-panel help with a normal full-guide fallback.

```ts
export interface TaskHelpRequest {
  articleId: string;
  taskId?: string;
  stepId?: string;
}
export interface TaskHelpController {
  open(request: TaskHelpRequest): void;
  close(): void;
}
```

- [ ] Keep `ContextualHelpLink` as a valid link when no provider is installed or when users open it in a new tab. The shared UI package must not import shell/Next internals.
- [ ] Intercept only an ordinary primary activation with an installed controller. Do not hijack modified clicks or browser link behavior.
- [ ] Use a wide-desktop nonmodal panel only when the form retains adequate width; otherwise use the existing accessible sheet/modal. Do not nest a modal coach inside another modal.
- [ ] Test unsaved receipt serials, PO reference, procurement request values, camera/scan input, dialog focus, escape, focus return, and interrupted help. Zero form submissions or mutations from opening help.
- [ ] Extend the server context endpoint only with audience-safe guide metadata. Derive actor identity server-side; never accept client role claims as authorization. Memory fallback remains explicit and separately tested.
- [ ] On unavailable/removed guidance, keep the form intact and offer the KB/recovery route. Long policy/assessment work uses the existing separate-tab path.

```ts
await page.getByLabel("Quantity").fill("3");
await page.getByRole("link", { name: "Help for Warehouse receiving" }).click();
await expect(page.getByRole("complementary", { name: "Task help" })).toBeVisible();
await page.getByRole("button", { name: "Close task help" }).click();
await expect(page.getByLabel("Quantity")).toHaveValue("3");
expect(businessRequests).toHaveLength(0);
```

**Exit:** guidance is available beside the work without blocking, submitting, losing, or falsely certifying it.

## Task 7: Standardize task guides and recapture evidence

**Files:** existing `FeatureGuide.tsx`, `StepWorkspace.tsx`, flow/evidence components, `types.ts`, `featureDetails.ts`, `workflows.ts`, `coverage.ts`, `evidenceContract.ts`, `productionEvidence.json`, handbook stage contracts and content sources.

**Consumes:** Task 2 coverage and Task 3 task IDs. **Produces:** one reusable guide structure and reviewed content for the current implemented inventory.

- [ ] Implement outcome/access, prerequisites, flow, annotated steps, result, next owner, recovery, and controlled reference sections using existing content fields first. Add references only where the current model lacks them; do not duplicate complete article text in a new catalog.
- [ ] For each decision, test its owner, branch labels, valid destination, rejection/correction path, and eventual terminal outcome or explicitly documented bounded retry/escalation. Detect orphan nodes and unbounded cycles.
- [ ] For each actionable step, validate the actual control name, input requirements, screenshot state/target, expected persisted result, and next owner. A page overview alone does not satisfy step evidence.
- [ ] Capture stable UAT screens using dedicated synthetic records and preserve the tester seed pool. Separate transactional audit records from documentation fixtures and record cleanup scope.
- [ ] Review every capture at native size and in the rendered guide. Capture desktops and mobile for app guides; keep standalone handbook layout desktop-oriented. Check zoom, pan, hotspot selection, full-screen close, and text alternatives.
- [ ] Reject stale/mismatched evidence rather than changing dates or removing verification rules. A missing screenshot yields an explicit unverified guide, not a finished empty image frame.

```ts
expect(validateTaskCoverage(content).unmappedLiveControls).toEqual([]);
expect(validateTaskCoverage(content).unresolvedTargets).toEqual([]);
expect(validateTaskCoverage(content).missingActionEvidence).toEqual([]);
```

The proposed `validateTaskCoverage` export belongs in existing `coverage.ts`; it returns these three string arrays plus `invalidDecisionBranches: string[]` for release gating.

**Exit:** 100% of the frozen current-function inventory has reviewed guidance or a clearly documented non-executable disposition; all release-labelled verified steps have accepted evidence.

## Task 8: Improve task search and recovery from no results

**Files:** `search.ts`, `search.test.ts`, `KnowledgeBase.tsx`, `HandbookLanding.tsx`; create `taskSearchBenchmark.test.ts` and fixture.

**Consumes:** task catalog and existing index. **Produces:** task-first discovery with stable legacy routes.

- [ ] Index stable task IDs, literal task names, approved synonyms, control labels, and recovery phrases. Reuse the current normalization/alias machinery rather than building an AI answer layer.
- [ ] Rank exact task/control matches before generic references; prefer live guidance. Apply audience filtering before search and suggestions, including counts. An explicit all-roles learning view does not enable execution.
- [ ] Build 55 reviewed queries: five per persona covering task name, colloquial phrase, error/recovery, handoff, and policy/reference. Include misspellings, zero results, ambiguous terms, and outdated route labels.
- [ ] Provide safe query suggestions, clear filter reset, and a feedback option. Never redirect an unmatched query to an unrelated task.
- [ ] Verify browser back/refresh and search-result links preserve context. Keep role/feature/reference entry points secondary but available.

```ts
expect(benchmark.topThreeHitRate).toBeGreaterThanOrEqual(0.9);
expect(benchmark.unauthorizedResults).toEqual([]);
expect(benchmark.brokenDestinations).toEqual([]);
```

**Exit:** the maintained benchmark meets the target and novice wording leads to usable task guidance.

## Task 9: Add minimal experience measurement and feedback

**Files:** new `experienceEvents.ts`/tests and authenticated API route; CLI-created additive migration for minimal events/feedback; existing governed Insights/Admin reporting surface only if authorized.

**Consumes:** stable task/article IDs and current authenticated actor. **Produces:** aggregate usability evidence, never certification or personnel scoring.

Proposed storage: `core.knowledge_experience_events`, with `event_id` UUID primary key, server-derived `actor_ref` pseudonym, `audience`, server `received_at`, event `name`, optional catalog-bound `task_id`/`article_id`/`step_id`, optional enumerated `result`, and `viewport`. No generic free-form JSON payload column. Use additive migration and explicit RLS/privileges; aggregate queries use the approved reporting authority, not browser-supplied actor IDs.

```ts
export type ExperienceEventName = "task_selected" | "guide_opened" |
  "step_viewed" | "recovery_opened" | "search_outcome" | "guide_feedback";
export interface ExperienceEventInput {
  eventId: string;
  name: ExperienceEventName;
  taskId?: string;
  articleId?: string;
  stepId?: string;
  result?: "found" | "empty" | "helpful" | "needs_improvement" | "outdated";
  viewport: "mobile" | "tablet" | "desktop";
}
export function validateExperienceEvent(input: unknown):
  { ok: true; value: ExperienceEventInput } | { ok: false; reason: string };
```

- [ ] Reject unknown fields, invalid IDs, oversize payloads, forged identity, and unauthenticated writes. Set actor pseudonym, audience, and receipt time on the server. Unique event ID prevents retries being double-counted; enforce rate limits.
- [ ] Test direct SQL/RLS denial of reading another actor's events and unauthorized aggregate access. Do not grant new reporting rights merely because someone is a manager.
- [ ] Do not store raw queries or record payloads. Telemetry submission is best effort, bounded, and separate from operational mutation success. Offline/retry errors never disable a workflow.
- [ ] Implement approved 90-day retention and small-cohort suppression, or leave collection disabled until the data owner approves the proposed policy. Deletion behavior is tested against telemetry fixtures only.
- [ ] Show aggregate search failures, recovery frequency, feedback category, and task-start trends. Only report successful business completion if a reviewed server event integration exists; otherwise label it unavailable.

```ts
expect(validateExperienceEvent({ ...validEvent, password: "not-allowed" }).ok).toBe(false);
// After the local fixture submits the same validated event twice:
const { rows } = await db.query<{ count: number }>(
  "select count(*)::int as count from core.knowledge_experience_events where event_id = $1",
  [validEvent.eventId],
);
expect(rows[0]?.count).toBe(1);
```

**Exit:** privacy/security tests pass and dashboards distinguish viewed/clicked/practiced from completed business work.

## Task 10: Run strict automated acceptance on UAT

**Files:** existing onboarding/KB Playwright tests; new `task-first-journeys.spec.ts`; SQL lifecycle tests; coverage/search benchmarks; `docs/audits/task-first-automated-results.md`.

**Consumes:** stable candidate deployment, approved curricula, synthetic fixture manifest. **Produces:** reproducible pass/fail evidence against the actual UAT build.

- [ ] Freeze application and database versions before the run. Verify deployment identity, auth mode, curriculum versions, and fixture availability. Warm local routes separately; never treat an environment/build failure as an application pass.
- [ ] Run all eleven persona task-entry/help/recovery journeys on desktop and mobile, then the specified multi-role combinations. Include a task completed by one actor and verified by its next owner.
- [ ] Test first visit, returning visit, refresh, tab switch, expired/revoked role, stale snapshot, interrupted assessment, failed/retried save, duplicate click, wrong record owner, deleted record, policy expiry, no tasks, and unavailable help/search.
- [ ] Inspect screenshots at 320/360/390/768/1280/1440; use representative dense screens in both themes, 200% zoom, keyboard-only and reduced-motion modes. Retain geometry/contrast checks and manually inspect captured output.
- [ ] Verify direct unauthorized RPCs remain denied; no fake completion, privilege grants, waived policy, or cross-audience leakage. Validate financial/stock effects and cleanup only within named fixtures.
- [ ] Report every case as passed, failed, blocked, or not run. Preserve failed traces; retest fixes and explicitly state whether the final full invocation was green or results were assembled across targeted retests.

**Exit:** zero open critical/high security or transaction defects; zero broken verified guide destinations; no undocumented dead ends in the scoped journeys; remaining lower-priority issues have named owners and release disposition.

## Task 11: Validate with new users, then correct and retest

**Files:** create `docs/training/task-first-pilot-protocol.md`, `task-first-pilot-results.md`, and an anonymized per-persona results sheet using existing spreadsheet tooling.

**Consumes:** passing UAT candidate and design success criteria. **Produces:** observed usability results, not inferred scores from test counts.

- [ ] Recruit the proposed two first-time participants per persona plus four mixed-role sessions. Record actual numbers, experience and device; keep identities out of shared evidence. Ask for consent before recording sessions.
- [ ] Give each participant a goal, not click-by-click instructions. Use routine, correction and handoff cases. Capture first meaningful action, task finding time, success, errors, support requests, and SEQ rating.
- [ ] Apply the design thresholds. Every compliance bypass or incorrect handoff is a blocking finding regardless of average scores. Report per-persona results to avoid hiding a weak role behind an aggregate.
- [ ] Fix navigation/content/control issues in their owning components. Repeat failed scenarios with fresh participants where possible; do not count memorized second attempts as first-time success.
- [ ] If sample size is insufficient, report provisional usability confidence and keep rollout limited; do not replace missing participants with agent simulations.

**Exit:** measured results satisfy the agreed thresholds or the release explicitly remains a pilot with documented restrictions.

## Task 12: Update handover materials and release safely

**Files:** `docs/manual/MWELL_INTRA_USER_MANUAL.md`, `docs/USER_TRAINING_AND_OPERATIONS_MANUAL.md`, `docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md`, `docs/TRAINING_AND_HANDOVER_CONTENT.md`, release/audit notes, handbook source registry and generated `docs/manual/index.html`.

**Consumes:** approved implementation, screenshots, test results, and real-user findings. **Produces:** versioned UAT release and complete standalone handover material.

- [ ] Update the task model, role/readiness distinction, help behavior, policy references, operational recovery, evidence provenance, analytics access/retention, and deployment/rollback procedures.
- [ ] Keep the standalone handbook self-contained. Reuse source facts and approved evidence; do not make its process instructions depend on visiting the app KB.
- [ ] Build and verify documentation with `pnpm docs:build`, `pnpm verify:app-documentation-html`, and release-documentation tests. Do not change historical capture dates or inherit prior certification claims.
- [ ] Deploy to UAT behind the existing release controls. Start with Operations Associate/Lead and one cross-department Finance/Procurement pair, then all personas including vendor after their publication prerequisites pass.
- [ ] Monitor error rates, task recovery, search failures and feedback during the pilot window. Roll back presentation changes if operational completion or accessibility regresses; preserve server security hardening and learning history.
- [ ] Publish a release manifest listing application commit, deployment URL, schema/curriculum versions, tested roles/devices, screenshots, remaining issues, and rollback target. Production promotion requires the UAT evidence and normal release approval.

**Exit:** the team can distinguish what is implemented, what is deployed, what was tested, and what remains deferred.

## Execution strategy

Use bounded parallel workers: one for learning/readiness, one for shell/help/search, one for content/policy mapping, and one for QA/evidence. Keep a single integration owner for shared types, providers, migrations, and release coordination. A security reviewer checks action boundaries independently. Workers do not share ownership of `OnboardingCenter.tsx`, `KnowledgeBase.tsx`, or the same migration.

Begin with Tasks 1-2. Freeze the task contracts before parallel implementation. Review each milestone against its acceptance criteria before moving on. Prefer this sequence over a single large redesign or simultaneous edits across every department.

## Plan self-review

- [x] All five recommended improvements have implementation tasks: task-first entry (3-5), relevant requirements (4), contextual help (6), standardized guides/evidence (7), and measurement/pilot (9-11).
- [x] All eleven personas, canonical mixed-role cases, read-only users, and vendor isolation are included.
- [x] Decision branches, actual screenshots, desktop/mobile constraints, policy references, and standalone handbook requirements are retained.
- [x] Live rollout prerequisites and the existing duplicate KB completion state are explicit.
- [x] Implementation contracts have named owners and do not introduce a second authorization system.
- [x] Automated evidence and human usability evidence remain separate; success targets are labelled proposed, not achieved.
