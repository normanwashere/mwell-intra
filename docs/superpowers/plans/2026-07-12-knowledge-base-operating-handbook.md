# Knowledge Base Operating Handbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a comprehensive, role-aware, flow-first operating handbook that documents every live Mwell Intra role, route, feature, decision, exception, administrator control, and handoff with validated screenshot evidence.

**Architecture:** Extend the existing structured Knowledge Base registry with explicit availability, authority, feature, decision, and governance contracts. Derive search and front-end views from that registry, validate it against RBAC and a maintained live-route manifest, and present workflows through synchronized Flow, Steps, Roles, and Exceptions views with guided mobile branching.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, `@intra/rbac`, Vitest, Playwright, axe-core.

## Global Constraints

- Current roles and features use `live` or `limited`; roadmap items use `coming_soon` and cannot satisfy live coverage.
- Every live route and RBAC role must map to detailed guidance.
- Every decision branch must reach completion, revision, rejection, cancellation, or escalation.
- Every executable step requires real application evidence with validated hotspots.
- Preserve history and reading position without full-page session restoration.
- Minimum interactive target is 44px.
- Verify 1440x900, 1280x800, 768x1024, 390x844, 360x800, and 320x720.
- Do not add a CMS, user comments, AI-authored answers, public export, or technical-support runbook.

---

## File Structure

- `apps/shell/lib/knowledge/types.ts`: canonical handbook contracts.
- `apps/shell/lib/knowledge/roles.ts`: current and coming-soon role profiles.
- `apps/shell/lib/knowledge/features.ts`: live feature/page/control reference entries.
- `apps/shell/lib/knowledge/coverage.ts`: route, RBAC, feature, and evidence coverage report.
- `apps/shell/lib/knowledge/workflows.ts`: principal flows and decision branches.
- `apps/shell/lib/knowledge/content.ts`: assembled articles and registry indexes.
- `apps/shell/lib/knowledge/search.ts`: typed, availability-aware search ranking.
- `apps/shell/lib/knowledge/validate.ts`: structural and governance validation.
- `apps/shell/components/knowledge/KnowledgeBase.tsx`: handbook shell and landing experience.
- `apps/shell/components/knowledge/KnowledgeRoleGuide.tsx`: authority profile presentation.
- `apps/shell/components/knowledge/FeatureGuide.tsx`: control and behavior reference.
- `apps/shell/components/knowledge/KnowledgeFlow.tsx`: synchronized article views.
- `apps/shell/components/knowledge/GuidedDecisionPath.tsx`: mobile branch navigation.
- `apps/shell/public/knowledge/screenshots/`: reviewed application evidence.
- `apps/shell/tests/e2e/knowledge-handbook.spec.ts`: functional responsive matrix.
- `apps/shell/tests/e2e/knowledge-handbook-visual.spec.ts`: strict visual/accessibility audit.

---

### Task 1: Expand The Handbook Content Contracts

**Files:**
- Modify: `apps/shell/lib/knowledge/types.ts`
- Modify: `apps/shell/lib/knowledge/validate.test.ts`
- Modify: `apps/shell/lib/knowledge/validate.ts`

**Interfaces:**
- Produces: `KnowledgeAvailability`, `KnowledgeAuthority`, `KnowledgeFeature`, `KnowledgeDecision`, expanded `KnowledgeRole`, `KnowledgeStep`, and `KnowledgeEvidence`.

- [ ] **Step 1: Write failing contract-validation tests**

Add fixtures that assert a live role without capabilities, a decision without an authority owner, a live executable step without evidence, and a coming-soon item used for live coverage all produce errors.

```ts
expect(validateKnowledgeContent(invalid)).toEqual(expect.arrayContaining([
  "role procurement_requester has no capability profile",
  "flow p2p:threshold-decision has no authority",
  "flow p2p:create-request requires screenshot evidence",
]));
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `pnpm --filter @intra/shell test -- lib/knowledge/validate.test.ts`

Expected: FAIL because the expanded fields and checks do not exist.

- [ ] **Step 3: Add explicit contracts**

Implement the following stable shape:

```ts
export type KnowledgeAvailability = "live" | "limited" | "coming_soon";
export type KnowledgeOutcome = "complete" | "revision" | "rejected" | "cancelled" | "escalated";

export interface KnowledgeAuthority {
  capabilities: string[];
  accessibleRoutes: string[];
  canDo: string[];
  cannotDo: string[];
  decisions: string[];
  upstreamRoleIds: string[];
  downstreamRoleIds: string[];
  escalation: string;
}

export interface KnowledgeRole {
  id: string;
  rbacModule?: "core" | "warehouse" | "procurement" | "legal";
  rbacRole?: string;
  label: string;
  module: KnowledgeModule;
  availability: KnowledgeAvailability;
  purpose: string;
  authority: KnowledgeAuthority;
}

export interface KnowledgeFeature {
  id: string;
  title: string;
  module: KnowledgeModule;
  availability: KnowledgeAvailability;
  routes: string[];
  roleIds: string[];
  capabilityIds: string[];
  purpose: string;
  controls: Array<{ name: string; behavior: string; validation: string; result: string }>;
  reads: string[];
  writes: string[];
  statuses: string[];
  exceptions: string[];
  owner: string;
  reviewedAt: string;
}
```

Add `authorityRoleId`, `policyBasis`, and `terminalOutcome` to flow nodes; add `evidenceId`, `prerequisites`, `databaseEffect`, `handoff`, and `prohibitedActions` to steps.

- [ ] **Step 4: Implement validation and rerun tests**

Validate dates, availability, role references, RBAC coordinates, decision authority, terminal outcome, evidence requirements, routes, controls, and prohibited-action copy.

Expected: focused tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/shell/lib/knowledge/types.ts apps/shell/lib/knowledge/validate.ts apps/shell/lib/knowledge/validate.test.ts
git commit -m "feat: define complete handbook content contracts"
```

### Task 2: Build The Complete Role And Authority Registry

**Files:**
- Modify: `apps/shell/lib/knowledge/roles.ts`
- Create: `apps/shell/lib/knowledge/roles.test.ts`
- Read: `packages/rbac/src/modules/core.ts`
- Read: `packages/rbac/src/modules/warehouse.ts`
- Read: `packages/rbac/src/modules/procurement.ts`
- Read: `packages/rbac/src/modules/legal.ts`

**Interfaces:**
- Consumes: expanded `KnowledgeRole`.
- Produces: `KNOWLEDGE_ROLES`, `LIVE_KNOWLEDGE_ROLES`, `COMING_SOON_ROLES`, `knowledgeRoleForRbac(module, role)`.

- [ ] **Step 1: Write RBAC parity tests**

For every `listModuleRoles(module)` entry, require one live handbook profile with matching capabilities from `roleCapabilities(module, role)`.

```ts
for (const module of MODULE_LIST) {
  for (const role of listModuleRoles(module)) {
    const guide = knowledgeRoleForRbac(module, role);
    expect(guide?.availability).toBe("live");
    expect(new Set(guide?.authority.capabilities)).toEqual(new Set(roleCapabilities(module, role)));
  }
}
```

- [ ] **Step 2: Run and confirm the parity test fails**

Run: `pnpm --filter @intra/shell test -- lib/knowledge/roles.test.ts`

Expected: FAIL because profiles contain only labels and purpose.

- [ ] **Step 3: Populate every current role profile**

Document exact routes, capabilities, common tasks, decisions, prohibited actions, upstream/downstream handoffs, escalation, and segregation-of-duties restrictions for core, warehouse, procurement, legal, and vendor roles.

- [ ] **Step 4: Add roadmap roles**

Add distinct `coming_soon` profiles for planned roles such as Strategic Sourcing Lead, Vendor Relationship Manager, Inventory Planner, Internal Auditor, Department Budget Owner, and Security Reviewer. Do not assign live RBAC coordinates or live routes.

- [ ] **Step 5: Run role and validation tests**

Expected: RBAC parity and all content validation PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/shell/lib/knowledge/roles.ts apps/shell/lib/knowledge/roles.test.ts
git commit -m "feat: document all current and planned Intra roles"
```

### Task 3: Create The Live Feature And Route Coverage Registry

**Files:**
- Create: `apps/shell/lib/knowledge/features.ts`
- Create: `apps/shell/lib/knowledge/coverage.ts`
- Create: `apps/shell/lib/knowledge/coverage.test.ts`
- Modify: `apps/shell/lib/knowledge/content.ts`
- Read: `apps/shell/lib/navigation.ts`
- Read: `modules/warehouse/src/app/modules.ts`
- Read: `modules/procurement/src/ProcurementApp.tsx`
- Read: `modules/legal/src/LegalApp.tsx`

**Interfaces:**
- Produces: `KNOWLEDGE_FEATURES`, `LIVE_ROUTE_MANIFEST`, `buildKnowledgeCoverage(content)` returning `{ errors: string[]; warnings: string[]; routeCoverage: Map<string,string[]> }`.

- [ ] **Step 1: Write failing coverage tests**

Assert that an undocumented route, capability, administrator surface, or feature without controls fails live coverage, while coming-soon entries remain warnings.

- [ ] **Step 2: Implement the route manifest and report**

Create a maintained manifest containing every shell, procurement, legal, vendor, warehouse, finance, and admin destination. Normalize optional trailing slashes and parameterized detail paths.

- [ ] **Step 3: Populate feature entries**

Create detailed entries for every live page. Each entry must explain purpose, roles, capabilities, controls, fields, validation, statuses, reads, writes, notifications, exceptions, and completion evidence in plain language.

- [ ] **Step 4: Assemble features into `KNOWLEDGE_CONTENT`**

Add `features` to `KnowledgeContent`, derive feature articles from the registry, and eliminate duplicated feature authority copy from ad hoc article definitions.

- [ ] **Step 5: Run coverage tests and the complete shell unit suite**

Run: `pnpm --filter @intra/shell test`

Expected: no live route or current capability gaps.

- [ ] **Step 6: Commit**

```bash
git add apps/shell/lib/knowledge/features.ts apps/shell/lib/knowledge/coverage.ts apps/shell/lib/knowledge/coverage.test.ts apps/shell/lib/knowledge/content.ts apps/shell/lib/knowledge/types.ts
git commit -m "feat: add handbook feature and coverage registry"
```

### Task 4: Complete Principal Workflows And Decision Trees

**Files:**
- Modify: `apps/shell/lib/knowledge/workflows.ts`
- Modify: `apps/shell/lib/knowledge/graph.test.ts`
- Modify: `apps/shell/lib/knowledge/validate.test.ts`

**Interfaces:**
- Produces complete flows for access, purchase-to-pay, vendor accreditation, receiving-to-putaway, quality disposition, event fulfillment, returns/reconciliation, cycle count/adjustment, and administration.

- [ ] **Step 1: Add failing graph tests for every required process**

For each principal flow, assert decision nodes exist, every decision has two or more labelled outcomes where applicable, every terminal declares `terminalOutcome`, and every node reaches a terminal.

- [ ] **Step 2: Run graph tests and confirm failures**

- [ ] **Step 3: Expand procurement and vendor decisions**

Represent threshold, risk, competition, insufficient bids, exception approval, budget, DOA, accreditation, NDA/instrument, evidence completeness, remediation, conditional approval, rejection, renewal, and suspension paths.

- [ ] **Step 4: Expand warehouse and administration decisions**

Represent PO eligibility, traceability, inspection disposition, hold/release/return, bin readiness, variance, adjustment approval, event reconciliation, return condition, user access, department, DOA, and route configuration paths.

- [ ] **Step 5: Run graph and validation tests**

Expected: every branch is reachable and terminates in a declared outcome.

- [ ] **Step 6: Commit**

```bash
git add apps/shell/lib/knowledge/workflows.ts apps/shell/lib/knowledge/graph.test.ts apps/shell/lib/knowledge/validate.test.ts
git commit -m "feat: complete handbook decision trees"
```

### Task 5: Redesign The Handbook Landing And Search Experience

**Files:**
- Modify: `apps/shell/components/knowledge/KnowledgeBase.tsx`
- Create: `apps/shell/components/knowledge/HandbookLanding.tsx`
- Modify: `apps/shell/lib/knowledge/search.ts`
- Modify: `apps/shell/lib/knowledge/content.test.ts`

**Interfaces:**
- Produces three entry modes: task, role, feature; typed search results with availability and role context.

- [ ] **Step 1: Write failing search tests**

Test searches for a task, role, page, control, status, problem, policy term, and alias. Assert live results rank above coming-soon results unless the query explicitly requests roadmap content.

- [ ] **Step 2: Implement normalized weighted indexing**

Index titles, summaries, keywords, role actions, feature controls, statuses, exceptions, glossary aliases, and workflow decisions. Return content type, availability, module, and role context.

- [ ] **Step 3: Build the flow-first landing page**

Render the principal Intra flow map first, then one global search, entry-mode tabs, role-aware recommended work, recently reviewed content, and clear live/limited/coming-soon badges. Keep sections unframed; use cards only for repeated results.

- [ ] **Step 4: Preserve history and scroll state**

Retain the existing `pushState` behavior and per-URL scroll restoration. Ensure mode, query, filters, article, flow, step, and view are represented in the URL.

- [ ] **Step 5: Run content, search, and typecheck**

Run: `pnpm --filter @intra/shell test -- lib/knowledge && pnpm --filter @intra/shell typecheck`

- [ ] **Step 6: Commit**

```bash
git add apps/shell/components/knowledge/KnowledgeBase.tsx apps/shell/components/knowledge/HandbookLanding.tsx apps/shell/lib/knowledge/search.ts apps/shell/lib/knowledge/content.test.ts
git commit -m "feat: create task-first handbook landing experience"
```

### Task 6: Build Complete Role And Feature Guides

**Files:**
- Create: `apps/shell/components/knowledge/KnowledgeRoleGuide.tsx`
- Create: `apps/shell/components/knowledge/FeatureGuide.tsx`
- Modify: `apps/shell/components/knowledge/KnowledgeArticle.tsx`
- Modify: `apps/shell/components/knowledge/KnowledgeBase.tsx`

**Interfaces:**
- Consumes: `KnowledgeRole`, `KnowledgeFeature`.
- Produces dedicated role authority and feature reference views.

- [ ] **Step 1: Add component tests for live and coming-soon roles**

Assert exact permissions, pages, can/cannot actions, authority, handoffs, daily tasks, escalation, availability, and related content render with semantic headings and lists.

- [ ] **Step 2: Implement `KnowledgeRoleGuide`**

Use a concise authority summary, accessible-page list, capability matrix, “Can do / Cannot do” comparison, responsibility timeline, handoff map, common tasks, exceptions, and escalation. Mark roadmap profiles prominently and disable live-action links.

- [ ] **Step 3: Implement `FeatureGuide`**

Present purpose, audience, entry route, controls, field validation, reads/writes, statuses, notifications, errors, completion evidence, policy basis, and related workflows.

- [ ] **Step 4: Connect guides to search and related-content navigation**

- [ ] **Step 5: Run unit, accessibility, and type checks**

- [ ] **Step 6: Commit**

```bash
git add apps/shell/components/knowledge/KnowledgeRoleGuide.tsx apps/shell/components/knowledge/FeatureGuide.tsx apps/shell/components/knowledge/KnowledgeArticle.tsx apps/shell/components/knowledge/KnowledgeBase.tsx
git commit -m "feat: add complete role and feature handbook guides"
```

### Task 7: Add Synchronized Workflow Views And Guided Mobile Branching

**Files:**
- Modify: `apps/shell/components/knowledge/KnowledgeFlow.tsx`
- Modify: `apps/shell/components/knowledge/WorkflowCanvas.tsx`
- Modify: `apps/shell/components/knowledge/WorkflowNavigator.tsx`
- Modify: `apps/shell/components/knowledge/StepWorkspace.tsx`
- Create: `apps/shell/components/knowledge/GuidedDecisionPath.tsx`
- Modify: `apps/shell/lib/knowledge/graph.ts`
- Modify: `apps/shell/lib/knowledge/graph.test.ts`

**Interfaces:**
- Produces URL-addressable `flow`, `steps`, `roles`, and `exceptions` views plus branch history.

- [ ] **Step 1: Write failing tests for branch selection and backtracking**

Assert selecting a decision edge advances to the correct node, merge points remain reachable, backtracking restores the previous branch, and terminal outcomes display completion evidence.

- [ ] **Step 2: Add graph helpers**

Implement `traceBranch(flow, choices)`, `branchOptions(flow, nodeId)`, `roleNodes(flow, roleId)`, and `exceptionNodes(flow)` with deterministic return types.

- [ ] **Step 3: Build four synchronized article views**

Use an accessible tab list for Flow, Step-by-step, Roles involved, and Exceptions. Selecting content in any view updates the same selected node and URL state.

- [ ] **Step 4: Implement guided mobile decisions**

Below 640px, replace the wide canvas with `GuidedDecisionPath`: current-node card, branch buttons, breadcrumb, backtrack, responsible role, evidence, and terminal outcome. Keep the full canvas available from tablet upward.

- [ ] **Step 5: Verify keyboard order, focus movement, and reduced motion**

- [ ] **Step 6: Commit**

```bash
git add apps/shell/components/knowledge/KnowledgeFlow.tsx apps/shell/components/knowledge/WorkflowCanvas.tsx apps/shell/components/knowledge/WorkflowNavigator.tsx apps/shell/components/knowledge/StepWorkspace.tsx apps/shell/components/knowledge/GuidedDecisionPath.tsx apps/shell/lib/knowledge/graph.ts apps/shell/lib/knowledge/graph.test.ts
git commit -m "feat: add interactive handbook workflow views"
```

### Task 8: Capture And Validate Application Evidence

**Files:**
- Modify: `apps/shell/lib/knowledge/evidence.ts`
- Modify: `apps/shell/lib/knowledge/validate.ts`
- Modify: `apps/shell/lib/knowledge/validate.test.ts`
- Create/Update: `apps/shell/public/knowledge/screenshots/*.png`
- Create: `apps/shell/tests/e2e/capture-knowledge-evidence.spec.ts`

**Interfaces:**
- Produces a reviewed desktop/mobile screenshot pair and hotspots for every executable principal-flow step.

- [ ] **Step 1: Add failing evidence completeness tests**

Assert live executable nodes have evidence, files exist, desktop and mobile dimensions are valid, hotspot coordinates remain inside `[0,1]`, role and route match the step, and `capturedAt`, `reviewedAt`, and commit provenance exist.

- [ ] **Step 2: Build deterministic capture scenarios**

Use memory-mode personas and seeded data to navigate each documented state. Disable animations, mask sensitive values, and capture 1440x900 and 390x844 images.

- [ ] **Step 3: Capture and review screenshots**

Inspect every image for correct route, state, role, clipping, personal data, and intended control visibility. Define precise hotspot coordinates and captions.

- [ ] **Step 4: Run evidence validation**

Run: `pnpm --filter @intra/shell test -- lib/knowledge/validate.test.ts`

Expected: no missing or invalid live evidence.

- [ ] **Step 5: Commit**

```bash
git add apps/shell/lib/knowledge/evidence.ts apps/shell/lib/knowledge/validate.ts apps/shell/lib/knowledge/validate.test.ts apps/shell/public/knowledge/screenshots apps/shell/tests/e2e/capture-knowledge-evidence.spec.ts
git commit -m "docs: add validated handbook application evidence"
```

### Task 9: Add Administrator, Governance, Troubleshooting, And Roadmap Content

**Files:**
- Create: `apps/shell/lib/knowledge/admin.ts`
- Create: `apps/shell/lib/knowledge/governance.ts`
- Create: `apps/shell/lib/knowledge/troubleshooting.ts`
- Modify: `apps/shell/lib/knowledge/content.ts`
- Modify: `apps/shell/lib/knowledge/content.test.ts`

**Interfaces:**
- Produces structured admin guides, policy/control guides, problem-based recovery entries, and roadmap entries.

- [ ] **Step 1: Write coverage tests for administrator surfaces and common failures**

Require guidance for users/roles, departments, DOA, procurement thresholds, legal checklist, warehouse/location/bin setup, receiving routes, evidence, audit review, sign-in failure, access denial, missing data, failed upload, offline write, rejected request, quality hold, variance, and stale session.

- [ ] **Step 2: Populate administrator guidance**

Explain prerequisites, authority, configuration fields, validation, affected users, audit effect, rollback/recovery, and required review.

- [ ] **Step 3: Populate governance and troubleshooting guidance**

Tie operational controls to approved procurement/vendor/legal sources. Organize troubleshooting by observed symptom with safe recovery, data impact, escalation owner, and prohibited workarounds.

- [ ] **Step 4: Add roadmap, release-note, and glossary coverage**

Clearly separate live, limited, and coming-soon behavior and link changed workflows to affected roles.

- [ ] **Step 5: Run content and coverage tests**

- [ ] **Step 6: Commit**

```bash
git add apps/shell/lib/knowledge/admin.ts apps/shell/lib/knowledge/governance.ts apps/shell/lib/knowledge/troubleshooting.ts apps/shell/lib/knowledge/content.ts apps/shell/lib/knowledge/content.test.ts
git commit -m "docs: complete handbook operations and governance content"
```

### Task 10: Run The Strict Responsive Production-Readiness Gate

**Files:**
- Create: `apps/shell/tests/e2e/knowledge-handbook.spec.ts`
- Create: `apps/shell/tests/e2e/knowledge-handbook-visual.spec.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes the complete handbook.
- Produces a blocking functional, accessibility, visual, and content-coverage gate.

- [ ] **Step 1: Write functional E2E scenarios**

Cover task/role/feature search, all current role profiles, coming-soon treatment, principal workflows, every decision outcome, backtracking, synchronized views, screenshot hotspots, deep links, history, refresh, scroll restoration, no-result recovery, and access-aware content.

- [ ] **Step 2: Write strict visual and accessibility checks**

At all six configured viewports, assert no document overflow, clipped text, intercepted controls, overlapping navigation, undersized targets, missing landmarks, axe violations, blank screenshots, or off-image hotspots.

- [ ] **Step 3: Run the complete local verification set**

```bash
pnpm --filter @intra/shell lint
pnpm --filter @intra/shell typecheck
pnpm --filter @intra/shell test
pnpm --filter @intra/shell build
pnpm --filter @intra/shell exec playwright test tests/e2e/knowledge-handbook.spec.ts tests/e2e/knowledge-handbook-visual.spec.ts
```

Expected: all commands PASS.

- [ ] **Step 4: Add the content coverage command to CI**

Run the validator before build and keep the full responsive specs in the sharded E2E job. Upload failed screenshots and traces only.

- [ ] **Step 5: Review generated screenshots manually**

Inspect representative landing, role, feature, flow, decision, exception, administrator, no-result, and coming-soon states on desktop and mobile.

- [ ] **Step 6: Commit**

```bash
git add apps/shell/tests/e2e/knowledge-handbook.spec.ts apps/shell/tests/e2e/knowledge-handbook-visual.spec.ts .github/workflows/ci.yml
git commit -m "test: gate handbook completeness and responsive quality"
```

### Task 11: Final Coverage Review And Release Preparation

**Files:**
- Modify: `docs/superpowers/specs/2026-07-12-knowledge-base-operating-handbook-design.md` only if implementation decisions require clarification.
- Create: `docs/knowledge-base-coverage-report.md`

**Interfaces:**
- Produces a human-readable release report with route, role, feature, flow, evidence, and viewport coverage.

- [ ] **Step 1: Generate the final coverage report**

List current roles, planned roles, live routes, features, workflow decisions, terminal outcomes, screenshot pairs, content owners, last-reviewed dates, and test viewports. Report zero unexplained live gaps.

- [ ] **Step 2: Run credential and sensitive-data scans**

Scan source, generated static output, screenshot metadata, and image OCR results for passwords, tokens, email addresses not designated as demo data, and customer/vendor records.

- [ ] **Step 3: Run the full repository CI command set**

Run the same commands as GitHub CI and require a clean worktree afterward.

- [ ] **Step 4: Commit the release report**

```bash
git add docs/knowledge-base-coverage-report.md
git commit -m "docs: record handbook release coverage"
```
