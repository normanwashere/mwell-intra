# Immersive Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Mwell Intra Knowledge Base around accessible governed decision trees and synchronized, hotspot-annotated screenshots of every launch-critical workflow step.

**Architecture:** Extend the static typed Knowledge Base schema into an explicit graph and evidence model, validate it at build time, and render it through focused workflow-library, graph, navigation, and evidence-viewer components. Documentation remains read-only and deep-links to role-protected operational routes; Playwright captures and validates screenshots against live Supabase without mutating Knowledge Base state.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5.6, Tailwind CSS 3, shared `@intra/ui`, Vitest 3, Playwright, Supabase, Vercel.

## Global Constraints

- Preserve all 20 current role guides, every current workflow, article, glossary entry, troubleshooting/control item, policy reference, and future recommendation.
- Show governed branches in the overview only when status, owner, evidence, segregation of duties, next action, or terminal outcome changes.
- Never use generated imagery as a substitute for an actual app screenshot.
- Never expose passwords, tokens, private keys, personal data, confidential documents, or uncontrolled production transactions in evidence.
- Documentation is read-only and never bypasses operational role authorization.
- Desktop acceptance viewports are 1440x900 and 1280x800; mobile acceptance viewports are 390x844 and 320x720.
- No new graph-layout dependency: the initial graph renderer uses deterministic CSS grid/lane layout and structured-list fallback.
- Node selection, hotspot selection, branch selection, zoom, and navigation must be keyboard accessible and reduced-motion compatible.

---

## File Map

- `apps/shell/lib/knowledge/types.ts`: graph, branch, screenshot evidence, and hotspot contracts.
- `apps/shell/lib/knowledge/workflows.ts`: explicit governed graph content.
- `apps/shell/lib/knowledge/evidence.ts`: evidence catalog, route provenance, and hotspot metadata.
- `apps/shell/lib/knowledge/validate.ts`: pure graph/content/evidence validation.
- `apps/shell/lib/knowledge/search.ts`: indexes nodes, branches, evidence instructions, and outcomes.
- `apps/shell/components/knowledge/WorkflowLibrary.tsx`: workflow-first home discovery.
- `apps/shell/components/knowledge/WorkflowCanvas.tsx`: accessible decision-tree rendering.
- `apps/shell/components/knowledge/WorkflowNavigator.tsx`: text fallback and branch-aware progression.
- `apps/shell/components/knowledge/StepWorkspace.tsx`: selected-step learning layout.
- `apps/shell/components/knowledge/EvidenceViewer.tsx`: screenshot zoom, pan, and hotspot synchronization.
- `apps/shell/components/knowledge/KnowledgeBase.tsx`: URL state and top-level composition only.
- `scripts/qa/capture-knowledge-evidence.mjs`: strict live evidence capture.
- `scripts/verify-knowledge-base.mjs`: release-gate invocation of schema/content validation.

---

### Task 1: Explicit Graph And Evidence Contracts

**Files:**
- Modify: `apps/shell/lib/knowledge/types.ts`
- Create: `apps/shell/lib/knowledge/validate.ts`
- Create: `apps/shell/lib/knowledge/validate.test.ts`

**Interfaces:**
- Produces: `FlowNodeType`, `KnowledgeFlowEdge.outcome`, `KnowledgeEvidence`, `KnowledgeHotspot`, `validateKnowledgeContent(content)`.
- Consumes: existing `KnowledgeContent`, `KnowledgeFlow`, and `KnowledgeArticle` structures.

- [ ] **Step 1: Write failing validation tests**

Create fixtures proving that validation rejects duplicate nodes, unlabeled decision edges, unreachable nodes, non-terminal dead ends, missing evidence references, and invalid hotspot coordinates; prove that a branched graph with normalized hotspot coordinates passes.

```ts
import { describe, expect, it } from "vitest";
import { validateKnowledgeContent } from "./validate";
import type { KnowledgeContent } from "./types";

const valid = (): KnowledgeContent => ({
  roles: [{ id: "owner", label: "Owner", module: "core", purpose: "Acts" }],
  articles: [],
  glossary: [],
  futureFeatures: [],
  evidence: [{
    id: "ev-start",
    nodeId: "start",
    desktopSrc: "/knowledge/screenshots/start.png",
    route: "/",
    roleId: "owner",
    capturedAt: "2026-07-11",
    reviewedAt: "2026-07-11",
    provenance: "production",
    alt: "Start screen",
    expectedLandmark: "Start",
    sensitiveDataReviewed: true,
    hotspots: [{ id: "open", number: 1, x: 0.5, y: 0.5, label: "Open", instruction: "Open the record." }],
  }],
  flows: [{
    id: "flow", title: "Flow", summary: "Summary", roles: ["owner"],
    startNodeId: "start",
    nodes: [
      { id: "start", type: "decision", title: "Valid?", ownerRoleIds: ["owner"], body: "Decide", evidenceId: "ev-start" },
      { id: "yes", type: "terminal", title: "Done", ownerRoleIds: ["owner"], body: "Complete" },
      { id: "no", type: "terminal", title: "Stopped", ownerRoleIds: ["owner"], body: "Stopped" },
    ],
    edges: [
      { from: "start", to: "yes", label: "Yes", outcome: "success" },
      { from: "start", to: "no", label: "No", outcome: "exception" },
    ],
  }],
});

it("accepts an explicit governed branch", () => {
  expect(validateKnowledgeContent(valid())).toEqual([]);
});

it("rejects unlabeled decision branches", () => {
  const content = valid();
  content.flows[0]!.edges[0]!.label = undefined;
  expect(validateKnowledgeContent(content)).toContain("flow:start decision edge to yes requires a label");
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `pnpm.cmd --filter @intra/shell test -- lib/knowledge/validate.test.ts`

Expected: FAIL because `validate.ts`, evidence types, and edge outcomes do not exist.

- [ ] **Step 3: Add the contracts and pure validator**

Add `exception` to `FlowNodeType`; add `evidenceId?: string` and `databaseEffect?: string` to nodes; add required `label` for decision edges through validation and `outcome?: "success" | "exception" | "neutral"`; add `evidence: KnowledgeEvidence[]` to `KnowledgeContent`.

Use these exact evidence contracts:

```ts
export interface KnowledgeHotspot {
  id: string;
  number: number;
  x: number;
  y: number;
  label: string;
  instruction: string;
}

export interface KnowledgeEvidence {
  id: string;
  nodeId: string;
  desktopSrc: string;
  mobileSrc?: string;
  route: string;
  roleId: string;
  capturedAt: string;
  reviewedAt: string;
  provenance: "production" | "documentation";
  alt: string;
  expectedLandmark: string;
  expectedDatabaseEffect?: string;
  sensitiveDataReviewed: boolean;
  hotspots: KnowledgeHotspot[];
}
```

Implement `validateKnowledgeContent` as a pure function returning exact error strings. It must validate role references, node/edge references, reachability from `startNodeId`, terminal reachability by reverse traversal, decision labels, evidence references, unique IDs, normalized hotspot coordinates in `[0,1]`, unique hotspot numbers per evidence item, safe local screenshot paths, and ISO date strings.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm.cmd --filter @intra/shell test -- lib/knowledge/validate.test.ts && pnpm.cmd --filter @intra/shell typecheck`

Expected: all validation tests PASS; typecheck reports migration errors in content until temporary `evidence: []` is added to `KNOWLEDGE_CONTENT`.

- [ ] **Step 5: Add the temporary catalog field and commit**

Add `evidence: []` to `apps/shell/lib/knowledge/content.ts`, rerun typecheck, then commit.

```powershell
git add apps/shell/lib/knowledge/types.ts apps/shell/lib/knowledge/validate.ts apps/shell/lib/knowledge/validate.test.ts apps/shell/lib/knowledge/content.ts
git commit -m "feat: define governed knowledge graph schema"
```

---

### Task 2: Migrate Linear Flows Into Governed Decision Graphs

**Files:**
- Modify: `apps/shell/lib/knowledge/workflows.ts`
- Modify: `apps/shell/lib/knowledge/content.test.ts`
- Test: `apps/shell/lib/knowledge/validate.test.ts`

**Interfaces:**
- Consumes: graph validation from Task 1.
- Produces: explicit edges for every workflow, stable node IDs, branch labels, exception nodes, and terminal outcomes.

- [ ] **Step 1: Add a failing catalog-wide graph test**

```ts
import { KNOWLEDGE_CONTENT } from "./content";
import { validateKnowledgeContent } from "./validate";

it("contains no invalid governed graph", () => {
  expect(validateKnowledgeContent(KNOWLEDGE_CONTENT)).toEqual([]);
});
```

- [ ] **Step 2: Run it and confirm current linear decisions fail**

Run: `pnpm.cmd --filter @intra/shell test -- lib/knowledge/content.test.ts`

Expected: FAIL for decision edges without labels and for missing terminal recovery paths.

- [ ] **Step 3: Replace inferred linear edges with explicit graph builders**

Remove `linear()`. Keep a small `flow()` builder that accepts explicit `nodes` and `edges` without deriving order. For each existing workflow, add governed branches only. At minimum:

- identity/access: correct access -> resume; incorrect -> admin correction -> resume;
- procure-to-pay: sourcing supported/clarification, approval/rejection, receipt match/exception, acceptance/payment readiness;
- vendor accreditation: evidence complete/correction, approved/conditional/rejected, renewal;
- receive-to-putaway: match/mismatch, accept/hold/damage/return, putaway/system availability;
- allocation/event/return: returned/consumed/lost/damaged and reconciliation;
- cycle count: within tolerance/escalation/approved adjustment;
- remaining existing flows: every decision receives named branches and terminal reachability.

Use explicit edge objects:

```ts
{ from: "receive-inspect", to: "receive-putaway", label: "Accept", outcome: "success" },
{ from: "receive-inspect", to: "receive-hold", label: "Hold", outcome: "exception" },
{ from: "receive-inspect", to: "receive-return", label: "Return to vendor", outcome: "exception" },
```

- [ ] **Step 4: Run content, validation, and search tests**

Run: `pnpm.cmd --filter @intra/shell test -- lib/knowledge/content.test.ts lib/knowledge/validate.test.ts lib/knowledge/search.test.ts`

Expected: PASS with every current flow and role retained.

- [ ] **Step 5: Commit the governed graph migration**

```powershell
git add apps/shell/lib/knowledge/workflows.ts apps/shell/lib/knowledge/content.test.ts
git commit -m "feat: model knowledge workflows as decision graphs"
```

---

### Task 3: Build The Workflow-First Library

**Files:**
- Create: `apps/shell/components/knowledge/WorkflowLibrary.tsx`
- Create: `apps/shell/components/knowledge/WorkflowLibrary.test.tsx`
- Modify: `apps/shell/components/knowledge/KnowledgeBase.tsx`

**Interfaces:**
- Consumes: `KnowledgeFlow[]`, role map, current profile kind and assigned roles, search results.
- Produces: `onOpenFlow(flowId)` and filter/search interactions through URL parameters.

- [ ] **Step 1: Write failing component tests**

Test that workflows render before reference results; role-relevant flows receive a "Recommended" label; search can still reach articles, glossary, and future features; opening a flow calls `onOpenFlow` with its stable ID.

```tsx
render(<WorkflowLibrary flows={flows} rolesById={roles} recommendedRoleIds={["warehouse_admin"]} onOpenFlow={open} />);
expect(screen.getByRole("heading", { name: /what do you need to complete/i })).toBeVisible();
expect(screen.getByRole("button", { name: /warehouse setup/i })).toHaveTextContent("Recommended");
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm.cmd --filter @intra/shell test -- components/knowledge/WorkflowLibrary.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the workflow library and simplify KnowledgeBase**

Build an unframed workflow band with compact repeated workflow items showing title, purpose, participating-role count, decision count, and recommended state. Keep search directly below this band and retain all existing filters/results. Move URL parsing/composition into `KnowledgeBase`; do not duplicate content search logic.

- [ ] **Step 4: Run component tests at desktop and narrow DOM widths**

Run: `pnpm.cmd --filter @intra/shell test -- components/knowledge/WorkflowLibrary.test.tsx && pnpm.cmd --filter @intra/shell typecheck`

Expected: PASS, with no inaccessible nested interactive controls.

- [ ] **Step 5: Commit the workflow-first home**

```powershell
git add apps/shell/components/knowledge/WorkflowLibrary.tsx apps/shell/components/knowledge/WorkflowLibrary.test.tsx apps/shell/components/knowledge/KnowledgeBase.tsx
git commit -m "feat: make workflows primary in knowledge base"
```

---

### Task 4: Accessible Decision-Tree Canvas And Navigator

**Files:**
- Create: `apps/shell/lib/knowledge/graph.ts`
- Create: `apps/shell/lib/knowledge/graph.test.ts`
- Create: `apps/shell/components/knowledge/WorkflowCanvas.tsx`
- Create: `apps/shell/components/knowledge/WorkflowNavigator.tsx`
- Replace: `apps/shell/components/knowledge/KnowledgeFlow.tsx`

**Interfaces:**
- Produces: `layoutFlow(flow): FlowLayout`, `pathForSelection(flow, choices)`, `WorkflowCanvas` props `{ flow, selectedNodeId, onSelectNode }`.
- Consumes: explicit graph from Task 2 and roles map.

- [ ] **Step 1: Test deterministic layout and branch progression**

```ts
const layout = layoutFlow(branchedFlow);
expect(layout.nodes.get("decision")).toMatchObject({ depth: 1 });
expect(layout.nodes.get("success")!.lane).not.toBe(layout.nodes.get("exception")!.lane);
expect(pathForSelection(branchedFlow, { decision: "No" })).toEqual(["start", "decision", "exception"]);
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm.cmd --filter @intra/shell test -- lib/knowledge/graph.test.ts`

Expected: FAIL because graph layout helpers do not exist.

- [ ] **Step 3: Implement deterministic graph helpers**

Use breadth-first depth assignment from `startNodeId`, stable edge-order lanes, cycle detection supplied by validation, and selected-branch path traversal. Return layout data only; do not include React or DOM concerns.

- [ ] **Step 4: Implement canvas and structured navigator**

Render semantic buttons for nodes with visible type labels, owners, and outcomes. Render labeled SVG/CSS connectors behind nodes, but provide an ordered/branched `WorkflowNavigator` list as the accessible and narrow-screen equivalent. On mobile, default to the compact path summary and allow "Show all branches" without page-level overflow.

`KnowledgeFlow` becomes a thin coordinator that reads `step` from props, renders the canvas first, and renders the selected node's compact summary below until Task 5 replaces it with the complete workspace.

- [ ] **Step 5: Add interaction tests**

Verify keyboard node selection, branch labels, list fallback, active-path semantics, terminal outcomes, and no `aria-label` omissions.

Run: `pnpm.cmd --filter @intra/shell test -- lib/knowledge/graph.test.ts components/knowledge/WorkflowCanvas.test.tsx && pnpm.cmd --filter @intra/shell typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the decision-tree renderer**

```powershell
git add apps/shell/lib/knowledge/graph.ts apps/shell/lib/knowledge/graph.test.ts apps/shell/components/knowledge/WorkflowCanvas.tsx apps/shell/components/knowledge/WorkflowNavigator.tsx apps/shell/components/knowledge/KnowledgeFlow.tsx apps/shell/components/knowledge/WorkflowCanvas.test.tsx
git commit -m "feat: render accessible knowledge decision trees"
```

---

### Task 5: Screenshot Evidence Viewer And Step Workspace

**Files:**
- Create: `apps/shell/components/knowledge/EvidenceViewer.tsx`
- Create: `apps/shell/components/knowledge/EvidenceViewer.test.tsx`
- Create: `apps/shell/components/knowledge/StepWorkspace.tsx`
- Create: `apps/shell/components/knowledge/StepWorkspace.test.tsx`
- Modify: `apps/shell/components/knowledge/KnowledgeFlow.tsx`

**Interfaces:**
- Consumes: `KnowledgeFlowNode`, `KnowledgeEvidence | undefined`, current branch choice.
- Produces: synchronized `selectedHotspotId`, branch selection, Previous/Next callbacks, and `Open live screen` link.

- [ ] **Step 1: Write evidence-viewer tests**

Test initial fit mode, zoom controls, hotspot/instruction synchronization, keyboard activation, mobile image source selection, unavailable evidence, alt text, normalized marker positioning, and reduced motion.

```tsx
render(<EvidenceViewer evidence={evidence} viewport="desktop" />);
await user.click(screen.getByRole("button", { name: "1. Select product" }));
expect(screen.getByText("Use the PO-backed product list.")).toHaveAttribute("data-active", "true");
expect(screen.getByRole("img", { name: evidence.alt })).toBeVisible();
```

- [ ] **Step 2: Run and verify failure**

Run: `pnpm.cmd --filter @intra/shell test -- components/knowledge/EvidenceViewer.test.tsx`

Expected: FAIL because viewer does not exist.

- [ ] **Step 3: Implement EvidenceViewer**

Use native `<img>` with explicit dimensions/aspect constraints. Implement fit and zoom with CSS transform on an inner image layer inside an overflow container; keep hotspot buttons positioned by percentage. Use icon buttons with tooltips for zoom in/out/reset. Render hotspot instructions outside the image on narrow screens.

- [ ] **Step 4: Implement StepWorkspace**

Render owner, prerequisites, exact action, evidence, expected status, database effect, success, and recovery in a quiet instruction column. At decision nodes, render a labeled branch selection control. Disable Next until a branch is selected and explain the disabled state. Preserve operational route authorization by using a normal route link only.

- [ ] **Step 5: Integrate URL-deep-linked selected step**

Update `KnowledgeBase.setParams` and `KnowledgeFlow` so `/knowledge?flow=receive-to-putaway&step=receive-inspect` selects the correct node. Browser Back restores the prior step. Invalid step IDs fall back to `startNodeId` and replace the URL.

- [ ] **Step 6: Run component and type tests**

Run: `pnpm.cmd --filter @intra/shell test -- components/knowledge/EvidenceViewer.test.tsx components/knowledge/StepWorkspace.test.tsx && pnpm.cmd --filter @intra/shell typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the guided workspace**

```powershell
git add apps/shell/components/knowledge/EvidenceViewer.tsx apps/shell/components/knowledge/EvidenceViewer.test.tsx apps/shell/components/knowledge/StepWorkspace.tsx apps/shell/components/knowledge/StepWorkspace.test.tsx apps/shell/components/knowledge/KnowledgeFlow.tsx apps/shell/components/knowledge/KnowledgeBase.tsx
git commit -m "feat: add screenshot-guided workflow workspace"
```

---

### Task 6: Complete Evidence Catalog And Search Migration

**Files:**
- Create: `apps/shell/lib/knowledge/evidence.ts`
- Modify: `apps/shell/lib/knowledge/content.ts`
- Modify: `apps/shell/lib/knowledge/search.ts`
- Modify: `apps/shell/lib/knowledge/search.test.ts`
- Modify: `scripts/verify-knowledge-base.mjs`
- Add images under: `apps/shell/public/knowledge/evidence/<flow-id>/`

**Interfaces:**
- Consumes: evidence schema and validator from Task 1.
- Produces: complete evidence catalog and search tokens for hotspots/branches/outcomes.

- [ ] **Step 1: Add failing coverage and search tests**

Assert every non-terminal launch-critical node has evidence, every evidence ID resolves, all existing content counts remain at or above the baseline, and searches such as "return to vendor", "select product", "DOA rejection", and "quality hold" return their workflow step.

- [ ] **Step 2: Run and verify failure**

Run: `pnpm.cmd verify:knowledge-base`

Expected: FAIL listing exact nodes without evidence and search terms without results.

- [ ] **Step 3: Build the evidence catalog**

Move existing procedure screenshots into node-scoped evidence records. Add route, role, dates, expected landmark, sensitive-data review, hotspot coordinates, and expected database effect. Keep article screenshots temporarily for backward compatibility, but derive new workflow rendering only from `evidenceId`.

- [ ] **Step 4: Expand search indexing**

Index node titles/bodies/database effects, edge labels, evidence hotspot labels/instructions, exceptions, and terminal outcomes. Result hrefs must deep-link to `flow` and `step`.

- [ ] **Step 5: Upgrade the release validator**

Make `scripts/verify-knowledge-base.mjs` load the same validation rules, enforce baseline counts, scan all text metadata for JWTs/service-role tokens/password labels, verify each public screenshot path exists, and print exact coverage totals.

- [ ] **Step 6: Run the complete content gate and commit**

Run: `pnpm.cmd verify:knowledge-base && pnpm.cmd --filter @intra/shell test -- lib/knowledge && pnpm.cmd --filter @intra/shell typecheck`

Expected: PASS with zero content loss and explicit evidence gaps only for nodes marked non-critical by a documented rule.

```powershell
git add apps/shell/lib/knowledge/evidence.ts apps/shell/lib/knowledge/content.ts apps/shell/lib/knowledge/search.ts apps/shell/lib/knowledge/search.test.ts scripts/verify-knowledge-base.mjs apps/shell/public/knowledge/evidence
git commit -m "feat: add complete knowledge evidence catalog"
```

---

### Task 7: Strict Desktop And Mobile Evidence Capture

**Files:**
- Modify: `scripts/qa/capture-knowledge-evidence.mjs`
- Create: `scripts/qa/knowledge-evidence-matrix.mjs`
- Modify: `apps/shell/tests/e2e/all-user-types.spec.ts`
- Add output: `docs/manual/assets/knowledge-base/immersive/`

**Interfaces:**
- Consumes: evidence catalog, audit identities from environment, live routes.
- Produces: current screenshots, JSON capture manifest, and hard-failing visual/evidence checks.

- [ ] **Step 1: Create the capture matrix**

Export records containing evidence ID, route, role email, desktop/mobile viewport, expected landmark, fixture state, and output path. Credentials remain environment-only.

- [ ] **Step 2: Extend the capture runner**

For each matrix entry: authenticate, navigate, wait for the expected landmark and absence of loading skeletons, verify no page/console errors, verify no horizontal overflow or unlabeled controls, capture only after animations settle, run a sensitive-text scan, and write capture metadata without credentials.

- [ ] **Step 3: Add Knowledge Base interaction coverage**

At 1440, 1280, 390, and 320 pixels, verify workflow-first ordering, node keyboard activation, explicit decision branches, step deep links, branch-aware Next, zoom/reset, hotspot synchronization, mobile bottom-navigation clearance, no overlaps, and structured fallback.

- [ ] **Step 4: Run three deterministic local passes**

Run three times:

```powershell
$env:AUDIT_BASE_URL='http://localhost:3016'
$env:EVIDENCE_AUTH_MODE='memory'
node scripts/qa/capture-knowledge-evidence.mjs
```

Expected: all three PASS and produce equivalent layout manifests; no black raster bands, loading placeholders, or developer indicators.

- [ ] **Step 5: Inspect every major screenshot visually**

Use `view_image` for the workflow home, a branched flow, a desktop step workspace, a 390px workspace, a 320px workspace, unavailable evidence, and a permission-denied live route. Reject clipping, illegible text, awkward empty space, hotspot drift, and navigation overlap.

- [ ] **Step 6: Commit verified evidence and tests**

```powershell
git add scripts/qa/capture-knowledge-evidence.mjs scripts/qa/knowledge-evidence-matrix.mjs apps/shell/tests/e2e/all-user-types.spec.ts docs/manual/assets/knowledge-base/immersive apps/shell/public/knowledge/evidence
git commit -m "test: verify immersive knowledge workflows"
```

---

### Task 8: Documentation, Production Build, Deployment, And Live Audit

**Files:**
- Modify: `docs/manual/MWELL_INTRA_USER_MANUAL.md`
- Modify: `docs/manual/index.html`
- Modify: `docs/audits/2026-07-11-VERCEL-PRODUCTION-E2E-AUDIT.md`
- Modify: `scripts/verify-launch-artifacts.mjs`

**Interfaces:**
- Consumes: completed Knowledge Base and evidence manifest.
- Produces: updated manual, launch gate, deployed production build, and final live report.

- [ ] **Step 1: Update the manual**

Document workflow-first navigation, decision branch semantics, screenshot hotspots, mobile zoom/pan, deep links, and evidence freshness. Include current desktop/mobile screenshots only.

- [ ] **Step 2: Run the complete local release gate**

```powershell
pnpm.cmd verify:knowledge-base
pnpm.cmd verify:launch
pnpm.cmd --filter @intra/ui typecheck
pnpm.cmd --filter @intra/shell test
pnpm.cmd --filter @intra/shell typecheck
pnpm.cmd --filter @intra/shell build
```

Expected: every command exits 0. Node 20 deprecation warnings are recorded; Vercel builds with the repository-declared Node/pnpm runtime.

- [ ] **Step 3: Push and deploy**

```powershell
git push origin codex/production-readiness-remediation
pnpm.cmd exec vercel --prod --yes
```

Expected: deployment reaches READY and aliases `https://mwell-intra.vercel.app`.

- [ ] **Step 4: Run the live Supabase evidence and workflow gate**

Load `.env.local` into the process without printing values, set `AUDIT_BASE_URL=https://mwell-intra.vercel.app`, set `EVIDENCE_AUTH_MODE=live`, and run the capture/e2e gate for all relevant roles. Confirm `/api/health` reports `status: ok`, `supabase: reachable`, static assets reachable, and service worker configured.

- [ ] **Step 5: Repeat the live visual audit three times**

Run desktop and mobile passes three times. Compare failures and screenshots; do not accept intermittent console errors, screenshot drift, stale service-worker content, or role-dependent dead ends.

- [ ] **Step 6: Record findings, commit final evidence, and push**

Update the production audit with exact pass/fail counts, unresolved risks, screenshot inventory, deployment ID, and health response. Remove regenerated screenshot noise before committing.

```powershell
git add docs/manual docs/audits/2026-07-11-VERCEL-PRODUCTION-E2E-AUDIT.md scripts/verify-launch-artifacts.mjs
git commit -m "docs: publish immersive knowledge manual"
git push origin codex/production-readiness-remediation
```

Expected: clean working tree and live alias serving the audited commit.

---

## Final Acceptance Checklist

- [ ] Workflow gallery appears before search/reference content.
- [ ] All current Knowledge Base content remains reachable.
- [ ] All governed decisions have explicit branches and terminal reachability.
- [ ] Every launch-critical node has current desktop evidence.
- [ ] Every materially different mobile state has current mobile evidence.
- [ ] Every hotspot is keyboard accessible and aligned at all four viewports.
- [ ] Screenshot evidence contains no secrets or uncontrolled sensitive data.
- [ ] Search indexes steps, branches, hotspots, exceptions, and outcomes.
- [ ] No visual overlap, clipping, page-level horizontal overflow, dead end, or unlabeled control.
- [ ] Live routes preserve role authorization and Knowledge Base interactions remain read-only.
- [ ] Three local and three production passes are clean.
- [ ] Supabase health, production build, service worker, and static assets are healthy.
