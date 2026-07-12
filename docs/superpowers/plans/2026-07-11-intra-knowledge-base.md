# Mwell Intra Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy an authenticated, universally visible, searchable, interactive Knowledge Base covering every current Intra user type, workflow, troubleshooting path, and future recommendation.

**Architecture:** Repository-backed typed content is validated independently of React, indexed by a small deterministic client-side search module, and rendered through focused Next.js Knowledge Base components. Flowcharts use semantic HTML with a desktop graph presentation and a mobile journey presentation; operational links remain protected by existing RBAC.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, `@intra/ui`, Vitest, Playwright, Markdown/HTML documentation.

## Global Constraints

- Route is `/knowledge` and requires the existing authenticated shell session.
- Every authenticated employee and vendor can browse all documentation.
- Documentation visibility never grants access to operational routes.
- Cover all 20 current production-test personas.
- Do not embed credentials, tokens, personal data, or confidential vendor documents.
- Use repository-backed typed content; no CMS or new database tables in this release.
- Search state must be URL-backed and bookmarkable.
- Mobile flowcharts must not require horizontal scrolling.
- Support 320, 360, 390, 768, 1280, and 1440 pixel widths.
- Proposed capabilities must be visibly separated from released features.

---

## File Structure

- `apps/shell/app/knowledge/page.tsx`: authenticated route entry.
- `apps/shell/app/knowledge/loading.tsx`: route skeleton.
- `apps/shell/components/knowledge/KnowledgeBase.tsx`: page state, query parameters, filters, and view selection.
- `apps/shell/components/knowledge/KnowledgeSearch.tsx`: accessible search input and result list.
- `apps/shell/components/knowledge/KnowledgeArticle.tsx`: procedure reader.
- `apps/shell/components/knowledge/KnowledgeFlow.tsx`: desktop graph and mobile journey.
- `apps/shell/components/knowledge/KnowledgeFilters.tsx`: role/module/type filters.
- `apps/shell/lib/knowledge/types.ts`: content contracts.
- `apps/shell/lib/knowledge/content.ts`: article, glossary, recommendation, and flow registry.
- `apps/shell/lib/knowledge/roles.ts`: all 20 role definitions and role-guide mappings.
- `apps/shell/lib/knowledge/workflows.ts`: end-to-end process graphs.
- `apps/shell/lib/knowledge/search.ts`: deterministic search index and ranking.
- `apps/shell/lib/knowledge/validate.ts`: content integrity checks.
- `apps/shell/lib/knowledge/*.test.ts`: validation and search tests.
- `apps/shell/tests/e2e/knowledge-base.spec.ts`: navigation, search, flow, accessibility, and responsive tests.
- `scripts/verify-knowledge-base.mjs`: release-gate content validation.
- `docs/manual/MWELL_INTRA_USER_MANUAL.md`: aligned offline manual.
- `docs/manual/index.html`: aligned standalone interactive manual.

---

### Task 1: Typed Content Contracts And Validation

**Files:**
- Create: `apps/shell/lib/knowledge/types.ts`
- Create: `apps/shell/lib/knowledge/validate.ts`
- Create: `apps/shell/lib/knowledge/validate.test.ts`
- Modify: `apps/shell/package.json`

**Interfaces:**
- Produces `KnowledgeArticle`, `KnowledgeFlow`, `KnowledgeFlowNode`, `KnowledgeRole`, `FutureFeature`, and `validateKnowledgeBase(content)`.
- Validation returns `string[]`; an empty array means valid.

- [ ] **Step 1: Write failing validation tests**

```ts
import { describe, expect, it } from 'vitest';
import { validateKnowledgeBase } from './validate';

describe('validateKnowledgeBase', () => {
  it('rejects duplicate slugs and missing flow terminals', () => {
    const errors = validateKnowledgeBase({
      roles: [{ id: 'staff', label: 'Staff', module: 'core' }],
      articles: [
        { id: 'a', slug: 'same', title: 'A', summary: 'A', module: 'core', roles: ['staff'], keywords: [], sections: [], relatedArticleIds: [], flowIds: [], liveRoutes: [], owner: 'Platform', reviewedAt: '2026-07-11' },
        { id: 'b', slug: 'same', title: 'B', summary: 'B', module: 'core', roles: ['staff'], keywords: [], sections: [], relatedArticleIds: [], flowIds: [], liveRoutes: [], owner: 'Platform', reviewedAt: '2026-07-11' },
      ],
      flows: [{ id: 'broken', title: 'Broken', summary: 'Broken', roles: ['staff'], startNodeId: 'start', nodes: [{ id: 'start', type: 'action', title: 'Start', ownerRoleIds: ['staff'], body: 'Start' }], edges: [] }],
      glossary: [],
      futureFeatures: [],
    });
    expect(errors).toContain('Duplicate article slug: same');
    expect(errors).toContain('Flow broken has no terminal node');
  });
});
```

- [ ] **Step 2: Run the test and confirm failure**

Run: `pnpm --filter @intra/shell test -- lib/knowledge/validate.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement the content types and validator**

```ts
export type KnowledgeModule = 'core' | 'warehouse' | 'procurement' | 'legal' | 'vendor' | 'admin';
export type FlowNodeType = 'start' | 'action' | 'decision' | 'handoff' | 'system' | 'terminal';

export interface KnowledgeRole { id: string; label: string; module: KnowledgeModule; }
export interface KnowledgeSection { id: string; title: string; body: string; steps?: KnowledgeStep[]; }
export interface KnowledgeStep { title: string; ownerRoleIds: string[]; instruction: string; expectedOutcome: string; exception?: string; }
export interface KnowledgeArticle {
  id: string; slug: string; title: string; summary: string; module: KnowledgeModule;
  roles: string[]; keywords: string[]; sections: KnowledgeSection[];
  relatedArticleIds: string[]; flowIds: string[]; liveRoutes: string[];
  owner: string; reviewedAt: string;
}
export interface KnowledgeFlowNode {
  id: string; type: FlowNodeType; title: string; ownerRoleIds: string[];
  body: string; prerequisite?: string; outcome?: string; exception?: string; articleId?: string;
}
export interface KnowledgeFlowEdge { from: string; to: string; label?: string; }
export interface KnowledgeFlow {
  id: string; title: string; summary: string; roles: string[]; startNodeId: string;
  nodes: KnowledgeFlowNode[]; edges: KnowledgeFlowEdge[];
}
export interface FutureFeature { id: string; title: string; status: 'proposed' | 'planned' | 'in_progress' | 'released'; value: string; }
export interface KnowledgeContent { roles: KnowledgeRole[]; articles: KnowledgeArticle[]; flows: KnowledgeFlow[]; glossary: Array<{ term: string; definition: string; aliases: string[] }>; futureFeatures: FutureFeature[]; }
```

Validator checks unique IDs/slugs, known role references, valid links, start/terminal reachability, `/`-prefixed routes, reviewed dates, and valid future statuses.

- [ ] **Step 4: Run validation tests**

Run: `pnpm --filter @intra/shell test -- lib/knowledge/validate.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/shell/lib/knowledge apps/shell/package.json
git commit -m "feat: add knowledge content contracts"
```

---

### Task 2: Complete Role, Article, And Workflow Registry

**Files:**
- Create: `apps/shell/lib/knowledge/roles.ts`
- Create: `apps/shell/lib/knowledge/content.ts`
- Create: `apps/shell/lib/knowledge/workflows.ts`
- Create: `apps/shell/lib/knowledge/content.test.ts`

**Interfaces:**
- Consumes Task 1 content types and validator.
- Produces `KNOWLEDGE_CONTENT`, `KNOWLEDGE_ROLES`, and `KNOWLEDGE_FLOWS`.

- [ ] **Step 1: Write the coverage test**

```ts
import { describe, expect, it } from 'vitest';
import { KNOWLEDGE_CONTENT } from './content';
import { validateKnowledgeBase } from './validate';

describe('knowledge content', () => {
  it('covers every production persona with an article and flow', () => {
    expect(KNOWLEDGE_CONTENT.roles).toHaveLength(20);
    for (const role of KNOWLEDGE_CONTENT.roles) {
      expect(KNOWLEDGE_CONTENT.articles.some((article) => article.roles.includes(role.id))).toBe(true);
      expect(KNOWLEDGE_CONTENT.flows.some((flow) => flow.roles.includes(role.id))).toBe(true);
    }
    expect(validateKnowledgeBase(KNOWLEDGE_CONTENT)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the coverage test and confirm failure**

Run: `pnpm --filter @intra/shell test -- lib/knowledge/content.test.ts`

Expected: FAIL because the registry is absent.

- [ ] **Step 3: Add all 20 role definitions**

Define IDs matching the audit personas: `core_staff_only`, `platform_admin`, `vendor_portal`, nine Warehouse roles, five Procurement roles, and three Legal roles.

- [ ] **Step 4: Add procedure articles**

Create focused articles for sign-in/recovery, user administration, DOA, procurement request/approval/PO/payment readiness, vendor invitation/application/review/instruments/decision/renewal, warehouse setup/receiving/inspection/putaway/holds/allocation/events/returns/cycle counts/pricing/import/export/exceptions/reporting, security, troubleshooting, and glossary entry points.

Every procedure step contains named owner roles, expected outcome, exception path, and live route where applicable.

- [ ] **Step 5: Add comprehensive workflow graphs**

At minimum define these graph IDs:

```ts
export const REQUIRED_FLOW_IDS = [
  'identity-and-access',
  'procure-to-pay',
  'vendor-accreditation',
  'warehouse-setup',
  'receive-to-putaway',
  'allocation-event-return',
  'cycle-count-adjustment',
  'pricing-and-costing',
  'doa-governance',
  'exception-and-recovery',
] as const;
```

Include decision branches for denied access, missing evidence, rejection, duplicate commands, stale state, insufficient bids, failed delivery, hold/vendor return, and escalation.

- [ ] **Step 6: Add future recommendations**

Include CMS publishing, review reminders, contextual help, search analytics, feedback, policy traceability, guided sandbox walkthroughs, multilingual content, offline precaching, onboarding curricula, and release-note generation. Set every initial item to `proposed`.

- [ ] **Step 7: Run content tests**

Run: `pnpm --filter @intra/shell test -- lib/knowledge/content.test.ts`

Expected: PASS with 20 roles and zero validation errors.

- [ ] **Step 8: Commit**

```bash
git add apps/shell/lib/knowledge
git commit -m "feat: author complete Intra knowledge registry"
```

---

### Task 3: Deterministic Search And URL Filters

**Files:**
- Create: `apps/shell/lib/knowledge/search.ts`
- Create: `apps/shell/lib/knowledge/search.test.ts`
- Create: `apps/shell/components/knowledge/KnowledgeFilters.tsx`
- Create: `apps/shell/components/knowledge/KnowledgeSearch.tsx`

**Interfaces:**
- Produces `searchKnowledge(content, query, filters): KnowledgeSearchResult[]`.
- `KnowledgeSearchResult` includes `id`, `type`, `title`, `summary`, `score`, `href`, `module`, and `roleIds`.

- [ ] **Step 1: Write ranking and alias tests**

```ts
it('ranks exact titles above keywords and resolves aliases', () => {
  const results = searchKnowledge(KNOWLEDGE_CONTENT, 'receive stock', {});
  expect(results[0].title).toMatch(/Receiving/i);
  expect(searchKnowledge(KNOWLEDGE_CONTENT, 'PR', {})[0].href).toContain('procurement');
});

it('filters by role and module without hiding universal search by default', () => {
  const results = searchKnowledge(KNOWLEDGE_CONTENT, '', { module: 'legal', roleId: 'legal_reviewer' });
  expect(results.length).toBeGreaterThan(0);
  expect(results.every((result) => result.module === 'legal' || result.roleIds.includes('legal_reviewer'))).toBe(true);
});
```

- [ ] **Step 2: Confirm tests fail**

Run: `pnpm --filter @intra/shell test -- lib/knowledge/search.test.ts`

Expected: FAIL because search is absent.

- [ ] **Step 3: Implement normalized weighted search**

Use lowercase Unicode normalization, token intersection, and deterministic weights: exact title 100, title token 40, alias 35, keyword 25, summary 15, section/step text 8. Sort by descending score then title.

- [ ] **Step 4: Build accessible search and filters**

Search uses a native search input, clear icon button, result count live region, arrow-key result navigation, and empty suggestions. Filters use module tabs on desktop and compact select/menu controls on mobile. Components receive query/filter values and callbacks; URL synchronization belongs to Task 5.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm --filter @intra/shell test -- lib/knowledge/search.test.ts && pnpm --filter @intra/shell typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/shell/lib/knowledge/search* apps/shell/components/knowledge
git commit -m "feat: add knowledge search and filters"
```

---

### Task 4: Accessible Article And Interactive Flow Rendering

**Files:**
- Create: `apps/shell/components/knowledge/KnowledgeArticle.tsx`
- Create: `apps/shell/components/knowledge/KnowledgeFlow.tsx`
- Create: `apps/shell/components/knowledge/KnowledgeFlow.test.tsx`

**Interfaces:**
- `KnowledgeArticle({ article, rolesById })` renders procedures and route links.
- `KnowledgeFlow({ flow, rolesById })` renders the graph/journey and selected node detail.

- [ ] **Step 1: Write flow interaction tests**

```tsx
render(<KnowledgeFlow flow={flowFixture} rolesById={rolesById} />);
expect(screen.getByRole('button', { name: /Requester submits request/i })).toBeVisible();
await user.click(screen.getByRole('button', { name: /Procurement confirms route/i }));
expect(screen.getByRole('dialog', { name: /Procurement confirms route/i })).toHaveTextContent('Expected outcome');
await user.keyboard('{Escape}');
expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
```

- [ ] **Step 2: Confirm the test fails**

Run: `pnpm --filter @intra/shell test -- components/knowledge/KnowledgeFlow.test.tsx`

Expected: FAIL because the renderer is absent.

- [ ] **Step 3: Implement article rendering**

Render a constrained reading column, semantic headings, prerequisites, ordered steps, owner labels, expected outcomes, exceptions, policy references, live-route links, and related content. Route links include visible “Role access required” copy without pre-authorizing them.

- [ ] **Step 4: Implement responsive flow rendering**

Desktop uses CSS grid columns derived from graph depth; edges are labeled connectors, not SVG-only meaning. Mobile renders nodes in reachable journey order with decision branches as labeled expandable groups. Node buttons open the shared adaptive dialog with details and related article links.

- [ ] **Step 5: Add keyboard and reduced-motion behavior**

Tab order follows graph order. Arrow keys move among sibling nodes. Focus returns to the triggering node after close. Motion classes are disabled through existing reduced-motion conventions.

- [ ] **Step 6: Run component tests and typecheck**

Run: `pnpm --filter @intra/shell test -- components/knowledge/KnowledgeFlow.test.tsx && pnpm --filter @intra/shell typecheck`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/shell/components/knowledge
git commit -m "feat: render knowledge articles and flows"
```

---

### Task 5: Knowledge Base Route And Navigation Integration

**Files:**
- Create: `apps/shell/app/knowledge/page.tsx`
- Create: `apps/shell/app/knowledge/loading.tsx`
- Create: `apps/shell/components/knowledge/KnowledgeBase.tsx`
- Modify: `apps/shell/lib/navigation.ts`
- Modify: `apps/shell/components/AppShell.tsx`
- Modify: `apps/shell/components/CommandPalette.tsx`
- Modify: `apps/shell/app/page.tsx`
- Test: `apps/shell/tests/smoke/routes.spec.ts`

**Interfaces:**
- Adds universal authenticated `KNOWLEDGE_NAV` with `/knowledge`, label `Knowledge Base`, icon `book` or the nearest available Lucide-backed icon.
- `KnowledgeBase` reads/writes `q`, `module`, `role`, `type`, `article`, and `flow` query parameters.

- [ ] **Step 1: Add failing smoke and navigation tests**

```ts
test('authenticated users can open the knowledge base', async ({ page }) => {
  await page.goto('/knowledge');
  await expect(page.getByRole('heading', { name: 'Knowledge Base' })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: /Search functions/i })).toBeVisible();
});
```

- [ ] **Step 2: Confirm route test fails**

Run: `pnpm --filter @intra/shell exec playwright test tests/smoke/routes.spec.ts --project=desktop-1280`

Expected: FAIL with a missing route/heading.

- [ ] **Step 3: Add route and loading state**

The server page mounts the existing authenticated shell and client `KnowledgeBase`. Loading state uses `ModuleLoadingSkeleton` and exposes `aria-busy="true"`.

- [ ] **Step 4: Implement URL-backed page state**

Use `useSearchParams`, `useRouter`, and `URLSearchParams`. Debounce only text query updates by 150ms; filter and article/flow selection update immediately. Back/forward navigation restores the same view.

- [ ] **Step 5: Integrate universal navigation**

Add `KNOWLEDGE_NAV` to every authenticated user’s desktop entries, mobile More menu, command palette, and home module list. Do not show it before authentication.

- [ ] **Step 6: Run smoke tests and typecheck**

Run: `pnpm --filter @intra/shell typecheck && pnpm --filter @intra/shell exec playwright test tests/smoke/routes.spec.ts --project=desktop-1280`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/shell/app/knowledge apps/shell/components/knowledge/KnowledgeBase.tsx apps/shell/lib/navigation.ts apps/shell/components/AppShell.tsx apps/shell/components/CommandPalette.tsx apps/shell/app/page.tsx apps/shell/tests/smoke/routes.spec.ts
git commit -m "feat: add authenticated knowledge base route"
```

---

### Task 6: Release-Gate Validation And Manual Synchronization

**Files:**
- Create: `scripts/verify-knowledge-base.mjs`
- Modify: `package.json`
- Modify: `docs/manual/MWELL_INTRA_USER_MANUAL.md`
- Modify: `docs/manual/index.html`
- Modify: `scripts/verify-launch-artifacts.mjs`

**Interfaces:**
- Adds root script `verify:knowledge-base`.
- Manual links to `https://mwell-intra.vercel.app/knowledge` and contains the same role/process/future-feature taxonomy.

- [ ] **Step 1: Add a failing release-gate check**

The script imports or parses a generated JSON-safe representation of `KNOWLEDGE_CONTENT`, runs validation, verifies all 20 role IDs, scans rendered content for credential patterns (`service_role`, JWT-like strings, `AUDIT_PASSWORD`, `VERCEL_OIDC_TOKEN`), and exits nonzero with exact content IDs.

- [ ] **Step 2: Run and confirm failure before wiring content**

Run: `pnpm verify:knowledge-base`

Expected: FAIL until the script can load and validate the registry.

- [ ] **Step 3: Complete the validator script and package command**

```json
"verify:knowledge-base": "node scripts/verify-knowledge-base.mjs"
```

- [ ] **Step 4: Rewrite the Markdown manual around the new taxonomy**

Include start guide, role matrix, all end-to-end flows in Mermaid, module procedures, troubleshooting, security, glossary, future recommendations, content owner, review date, and live Knowledge Base link. Remove obsolete Warehouse schema-error screenshots and claims.

- [ ] **Step 5: Update the standalone interactive manual**

Provide in-page search, section navigation, accessible expandable flow steps, role/module filters, and live links. Keep it dependency-free for offline opening.

- [ ] **Step 6: Extend launch artifact verification**

Require the Knowledge Base route files, content registry, flow coverage, manual headings, and live URL.

- [ ] **Step 7: Run release gates**

Run: `pnpm verify:knowledge-base && pnpm verify:launch-artifacts`

Expected: PASS with no secret-pattern matches.

- [ ] **Step 8: Commit**

```bash
git add scripts package.json docs/manual
git commit -m "docs: align interactive manual with knowledge base"
```

---

### Task 7: Responsive And Cross-Role Browser Verification

**Files:**
- Create: `apps/shell/tests/e2e/knowledge-base.spec.ts`
- Create: `docs/manual/assets/knowledge-base/knowledge-desktop.png`
- Create: `docs/manual/assets/knowledge-base/knowledge-mobile.png`

**Interfaces:**
- Browser test uses the existing six Playwright projects and existing authentication fixtures/patterns.

- [ ] **Step 1: Write end-to-end tests**

Cover authenticated access, unauthenticated redirect, universal visibility for employee/vendor roles, query search, alias search, filters, URL restoration, article navigation, desktop flow selection, mobile journey expansion, operational deep links, unknown IDs, keyboard focus, Escape close, and empty results.

- [ ] **Step 2: Run desktop and mobile tests**

Run:

```bash
pnpm --filter @intra/shell exec playwright test tests/e2e/knowledge-base.spec.ts --project=desktop-1440 --project=mobile-390 --project=mobile-320
```

Expected: PASS.

- [ ] **Step 3: Run strict layout checks at all six widths**

Reuse the existing layout-audit helpers to assert no horizontal overflow, text clipping, incoherent overlap, unlabeled controls, dead links, or control centers blocked by modal/navigation layers.

- [ ] **Step 4: Run representative checks for all 20 personas**

For each persona, sign in, open `/knowledge`, select its role filter, open its guide and one assigned flow, and verify the operational route link is present. Visibility is universal; role filter merely changes recommendations.

- [ ] **Step 5: Capture final documentation screenshots**

Capture one 1440px search/flow view and one 390px article/journey view after visual inspection. Verify no test credentials or personal data are visible.

- [ ] **Step 6: Run full build and tests**

Run:

```bash
pnpm --filter @intra/shell typecheck
pnpm --filter @intra/shell test
pnpm --filter @intra/shell build
pnpm verify:knowledge-base
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/shell/tests/e2e/knowledge-base.spec.ts docs/manual/assets/knowledge-base
git commit -m "test: verify knowledge base across roles and viewports"
```

---

### Task 8: Deploy And Verify Production

**Files:**
- Modify only if production verification exposes a defect.

**Interfaces:**
- Production URL: `https://mwell-intra.vercel.app/knowledge`.

- [ ] **Step 1: Confirm clean branch and push**

Run:

```bash
git status --short
git push origin codex/production-readiness-remediation
```

Expected: clean worktree and successful push.

- [ ] **Step 2: Deploy production**

Run: `vercel --prod --yes`

Expected: READY and alias `https://mwell-intra.vercel.app`.

- [ ] **Step 3: Verify production health and route**

Check `/api/health` returns `status=ok`; sign in with one employee and one vendor test persona; open `/knowledge`; search `receive stock`; open the receiving flow; verify article and flow links.

- [ ] **Step 4: Run production responsive checks**

Verify 1440, 1280, 768, 390, 360, and 320 widths against the live alias with service workers blocked for freshness. Confirm search, filters, flow detail, mobile journey, and navigation.

- [ ] **Step 5: Verify security and documentation integrity**

Search built static assets and rendered text for credential patterns. Confirm operational route links still enforce RBAC when opened by a user without that module.

- [ ] **Step 6: Record final outcome**

Update the audit/manual review date only if production checks pass. Report any residual limitations explicitly; do not classify future recommendations as released.
