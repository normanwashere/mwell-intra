# Standalone Handbook Tabbed Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the generated standalone Mwell Intra handbook as a self-contained, audience-aware, flow-first reference with seven tabs, scoped search, collapsible procedures, reliable deep links, state restoration, responsive diagrams, and accessible print modes.

**Architecture:** Keep Markdown, CSV, and local screenshots as canonical sources, but replace filename-driven navigation with a validated metadata catalog. The Node generator renders one offline HTML artifact containing its styles, runtime, source index, images, and Mermaid bundle; the browser runtime controls tabs, search, disclosures, diagram views, history, and local state without page reloads.

**Tech Stack:** Node.js 22, ESM, `marked`, `csv-parse`, Mermaid 11, native DOM APIs, Node test runner, Playwright 1.51, Axe Playwright, HTML/CSS.

**Spec:** `docs/superpowers/specs/2026-08-22-standalone-handbook-tabbed-experience-design.md`

## Global Constraints

- The output remains one self-contained file at `docs/manual/index.html` and works from `file://` without a server.
- The seven tab IDs are exactly `start`, `workflows`, `roles`, `architecture`, `infrastructure`, `security`, and `release`.
- No external JavaScript, stylesheet, font, image, or analytics request is allowed.
- Existing maintained documents stay canonical; the generator may reorganize presentation but must not duplicate their instructions.
- Unknown source documents fall back to Release & QA and emit a build warning.
- The handbook must not describe an application function as live unless the maintained source explicitly marks it live.
- Visual acceptance widths are 1440, 1280, 1024, 768, 430, 390, 360, and 320 CSS pixels.
- Accessibility target is WCAG 2.2 AA with no critical or serious automated violations.
- Generated output must be byte-stable across Windows and Linux.
- Every interaction must update in place; no tab, article, search, disclosure, diagram, or history action may reload the page.

## File Structure

- `scripts/docs/handbook-catalog.mjs`: typed-by-convention metadata registry, tab definitions, source classification, and validation.
- `scripts/docs/handbook-catalog.test.mjs`: catalog completeness, uniqueness, fallback, and related-source tests.
- `scripts/docs/handbook-styles.css`: offline-safe visual system, responsive layout, print modes, focus, and reduced-motion rules.
- `scripts/docs/handbook-runtime.js`: tab, article, search, disclosure, history, state, diagram, drawer, and print behavior.
- `scripts/docs/build-app-documentation.mjs`: source ingestion and deterministic HTML assembly only.
- `scripts/docs/build-app-documentation.test.mjs`: generated artifact and content-integrity contract.
- `apps/shell/tests/e2e/standalone-handbook.spec.ts`: static handbook functional, responsive, visual, keyboard, and Axe checks.
- `scripts/docs/serve-handbook.mjs`: loopback-only static server used by Playwright.
- `docs/manual/MWELL_INTRA_USER_MANUAL.md`: workflow-first overview and completion criteria.
- `docs/PROCESS_REFERENCE_LIBRARY.md`: maintained Mermaid overview, role, and exception flows.
- `docs/releases/2026-08-22-STANDALONE-HANDBOOK-RELEASE.md`: release identity, coverage, evidence, and limitations.
- `docs/manual/index.html`: generated, committed release artifact.

---

### Task 1: Validated Handbook Metadata Catalog

**Files:**
- Create: `scripts/docs/handbook-catalog.mjs`
- Create: `scripts/docs/handbook-catalog.test.mjs`
- Modify: `scripts/docs/build-app-documentation.mjs`

**Interfaces:**
- Produces: `HANDBOOK_TABS: readonly HandbookTab[]`
- Produces: `HANDBOOK_DOCUMENTS: readonly HandbookDocumentMeta[]`
- Produces: `resolveHandbookCatalog(sourceFiles: string[]): { documents: ResolvedHandbookDocument[]; warnings: string[] }`
- Consumes: normalized repo-relative source paths from `documentationSources()`.

- [ ] **Step 1: Write failing catalog tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  HANDBOOK_TABS,
  resolveHandbookCatalog,
} from "./handbook-catalog.mjs";

test("defines the seven audience-facing tabs in release order", () => {
  assert.deepEqual(HANDBOOK_TABS.map(({ id }) => id), [
    "start", "workflows", "roles", "architecture",
    "infrastructure", "security", "release",
  ]);
});

test("classifies every maintained source exactly once", () => {
  const sources = [
    "docs/manual/MWELL_INTRA_USER_MANUAL.md",
    "docs/PROCESS_REFERENCE_LIBRARY.md",
  ];
  const result = resolveHandbookCatalog(sources);
  assert.equal(result.documents.length, sources.length);
  assert.equal(new Set(result.documents.map(({ id }) => id)).size, sources.length);
  assert.equal(result.warnings.length, 0);
});

test("falls an unknown source back to release with an actionable warning", () => {
  const result = resolveHandbookCatalog(["docs/new-review.md"]);
  assert.equal(result.documents[0].primaryTab, "release");
  assert.match(result.warnings[0], /docs\/new-review\.md.*Release & QA/);
});
```

- [ ] **Step 2: Run the tests and verify the missing module failure**

Run: `node --test scripts/docs/handbook-catalog.test.mjs`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `handbook-catalog.mjs`.

- [ ] **Step 3: Add the catalog model and resolver**

```js
/** @typedef {'start'|'workflows'|'roles'|'architecture'|'infrastructure'|'security'|'release'} HandbookTabId */
/** @typedef {{id: HandbookTabId, label: string, summary: string, order: number}} HandbookTab */
/** @typedef {{source: string, id: string, title?: string, primaryTab: HandbookTabId, relatedTabs: HandbookTabId[], contentType: string, audience: string[], summary: string, keywords: string[], sortOrder: number, collapse: 'workflow'|'reference'|'none', relatedSources: string[]}} HandbookDocumentMeta */

export const HANDBOOK_TABS = Object.freeze([
  { id: "start", label: "Start Here", summary: "Orientation and product map", order: 1 },
  { id: "workflows", label: "Workflows", summary: "End-to-end operating flows", order: 2 },
  { id: "roles", label: "Roles & Training", summary: "Authority, onboarding, and simulations", order: 3 },
  { id: "architecture", label: "Architecture", summary: "Application and data design", order: 4 },
  { id: "infrastructure", label: "Infrastructure", summary: "Hosting, environments, and continuity", order: 5 },
  { id: "security", label: "Security & Governance", summary: "Access, policy, evidence, and retention", order: 6 },
  { id: "release", label: "Release & QA", summary: "Certification, evidence, and release history", order: 7 },
]);

const CATALOG = [
  {
    source: "docs/manual/MWELL_INTRA_USER_MANUAL.md",
    id: "user-manual",
    primaryTab: "start",
    relatedTabs: ["workflows", "roles"],
    contentType: "manual",
    audience: ["employee", "operator", "approver", "trainer"],
    summary: "How to use Mwell Intra and complete its implemented workflows.",
    keywords: ["orientation", "navigation", "modules", "help"],
    sortOrder: 10,
    collapse: "workflow",
    relatedSources: ["docs/PROCESS_REFERENCE_LIBRARY.md"],
  },
  {
    source: "docs/PROCESS_REFERENCE_LIBRARY.md",
    id: "process-reference-library",
    primaryTab: "workflows",
    relatedTabs: ["roles", "security"],
    contentType: "workflow",
    audience: ["operator", "approver", "trainer", "auditor"],
    summary: "Governed lifecycle, decision, exception, and handoff diagrams.",
    keywords: ["flow", "decision", "handoff", "exception"],
    sortOrder: 10,
    collapse: "workflow",
    relatedSources: ["docs/manual/MWELL_INTRA_USER_MANUAL.md"],
  },
];

export const HANDBOOK_DOCUMENTS = Object.freeze(CATALOG);

export function resolveHandbookCatalog(sourceFiles) {
  const bySource = new Map(CATALOG.map((entry) => [entry.source, entry]));
  const warnings = [];
  const documents = sourceFiles.map((source, index) => {
    const entry = bySource.get(source);
    if (entry) return { ...entry };
    warnings.push(`${source} is not classified; using Release & QA fallback.`);
    return {
      source,
      id: `release-${source.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
      primaryTab: "release",
      relatedTabs: [],
      contentType: "evidence",
      audience: ["release-reviewer"],
      summary: "Unclassified maintained source; classify this file in the handbook catalog.",
      keywords: ["release", "unclassified"],
      sortOrder: 9000 + index,
      collapse: "reference",
      relatedSources: [],
    };
  });
  const ids = documents.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) throw new Error("Handbook document IDs must be unique.");
  return { documents, warnings };
}
```

Add explicit entries for every path returned by `documentationSources()`. Use primary tabs and related tabs from the approved spec; do not rely on filename inference for a classified source.

Use this release classification map; each row becomes an explicit `CATALOG` entry with a stable ID derived from the stated purpose, not from its file position:

| Source | Primary tab | Related tabs | Content type |
|---|---|---|---|
| `docs/manual/MWELL_INTRA_USER_MANUAL.md` | Start Here | Workflows; Roles & Training | manual |
| `docs/PROCESS_REFERENCE_LIBRARY.md` | Workflows | Roles & Training; Security & Governance | workflow |
| `docs/MIGRATION_CUTOVER_HYPERCARE_RUNBOOK.md` | Infrastructure | Release & QA | runbook |
| `docs/REQUIREMENTS_TRACEABILITY_MATRIX.md` | Architecture | Release & QA; Security & Governance | traceability |
| `docs/RETENTION.md` | Security & Governance | Infrastructure | policy |
| `docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md` | Architecture | Infrastructure; Security & Governance | specification |
| `docs/TRAINING_AND_HANDOVER_CONTENT.md` | Roles & Training | Start Here; Workflows | training |
| `docs/UAT_AND_ISSUE_MANAGEMENT.md` | Release & QA | Roles & Training | procedure |
| `docs/USER_TRAINING_AND_OPERATIONS_MANUAL.md` | Roles & Training | Start Here; Workflows | manual |
| `docs/UX-REVIEW-FULL-APP.md` | Release & QA | Architecture | evidence |
| `docs/UX-REVIEW-VENDOR-LEGAL.md` | Release & QA | Security & Governance | evidence |
| `docs/WAREHOUSE_ERD_AND_DATA_DICTIONARY.md` | Architecture | Workflows | data-reference |
| `docs/WAREHOUSE_W1_RELEASE_EVIDENCE.md` | Release & QA | Workflows | evidence |
| `docs/import-templates/README.md` | Workflows | Start Here | template-guide |
| `docs/import-templates/users-v1.csv` | Infrastructure | Roles & Training | import-template |
| `docs/import-templates/vendors-v1.csv` | Workflows | Security & Governance | import-template |
| `docs/import-templates/warehouse-locations-bins-v1.csv` | Workflows | Architecture | import-template |
| `docs/import-templates/warehouse-products-opening-stock-v1.csv` | Workflows | Architecture | import-template |
| `docs/policy/VENDOR_TO_PAY_CONTROL_MATRIX.md` | Security & Governance | Workflows; Architecture | control-matrix |
| `docs/releases/2026-08-21-WMS-FEEDBACK-RELEASE.md` | Release & QA | Workflows | release-note |
| `docs/runbooks/POLICY-ALIGNMENT-CUTOVER.md` | Infrastructure | Security & Governance; Release & QA | runbook |
| `docs/runbooks/SUPABASE-SECURITY-CONTROLS.md` | Security & Governance | Infrastructure | runbook |
| `docs/runbooks/UAT-LIVE-CERTIFICATION.md` | Release & QA | Infrastructure; Security & Governance | runbook |

Task 11 of the procurement plan adds `docs/policy/MPIC_PROCUREMENT_POLICY_FEBRUARY_2025.md` as Security & Governance primary with Workflows and Architecture related visibility. Task 8 adds its release note under Release & QA.

- [ ] **Step 4: Make the generator consume the catalog and surface warnings**

Replace `categoryFor()` usage with `resolveHandbookCatalog(sources)` and attach `primaryTab`, `relatedTabs`, `audience`, `summary`, `keywords`, `sortOrder`, `collapse`, and `relatedSources` to each generated document. Emit each warning once with `console.warn`.

- [ ] **Step 5: Run focused tests**

Run: `node --test scripts/docs/handbook-catalog.test.mjs scripts/docs/build-app-documentation.test.mjs`

Expected: PASS; no warning for the current maintained source set.

- [ ] **Step 6: Commit**

```bash
git add scripts/docs/handbook-catalog.mjs scripts/docs/handbook-catalog.test.mjs scripts/docs/build-app-documentation.mjs
git commit -m "feat(docs): classify handbook content by audience"
```

---

### Task 2: Deterministic Offline Presentation Assets

**Files:**
- Create: `scripts/docs/handbook-styles.css`
- Create: `scripts/docs/handbook-runtime.js`
- Modify: `scripts/docs/build-app-documentation.mjs`
- Modify: `scripts/docs/build-app-documentation.test.mjs`

**Interfaces:**
- Produces: embedded `<style data-handbook-styles>` and `<script data-handbook-runtime>` blocks.
- Consumes: stable element IDs and `data-*` contracts emitted by the generator.

- [ ] **Step 1: Extend the generator contract test**

```js
test("embeds local presentation assets without external requests", () => {
  const html = buildDocumentationHtml();
  assert.match(html, /<style data-handbook-styles>/);
  assert.match(html, /<script data-handbook-runtime>/);
  assert.doesNotMatch(html, /<script\s+src=/i);
  assert.doesNotMatch(html, /<link\s+[^>]*rel=["']stylesheet/i);
});
```

- [ ] **Step 2: Verify the test fails before extraction**

Run: `node --test scripts/docs/build-app-documentation.test.mjs`

Expected: FAIL because the tagged asset blocks do not exist.

- [ ] **Step 3: Extract the current CSS and runtime without behavior changes**

Move the current inline CSS verbatim into `scripts/docs/handbook-styles.css` and the current interaction script into `scripts/docs/handbook-runtime.js`. Read both with `readFileSync`, normalize line endings, strip trailing whitespace, escape `</script` in the runtime, and embed them:

```js
const styles = normalizeText(readFileSync(path.join(root, "scripts/docs/handbook-styles.css"), "utf8"));
const runtime = normalizeText(readFileSync(path.join(root, "scripts/docs/handbook-runtime.js"), "utf8"))
  .replaceAll("</script", "<\\/script");
```

- [ ] **Step 4: Verify deterministic output**

Run: `node --test scripts/docs/build-app-documentation.test.mjs && pnpm docs:build && pnpm verify:app-documentation-html`

Expected: PASS and `docs/manual/index.html` is current.

- [ ] **Step 5: Commit**

```bash
git add scripts/docs/handbook-styles.css scripts/docs/handbook-runtime.js scripts/docs/build-app-documentation.mjs scripts/docs/build-app-documentation.test.mjs docs/manual/index.html
git commit -m "refactor(docs): isolate handbook presentation assets"
```

---

### Task 3: Accessible Seven-Tab Shell and Article Navigation

**Files:**
- Modify: `scripts/docs/build-app-documentation.mjs`
- Modify: `scripts/docs/handbook-styles.css`
- Modify: `scripts/docs/handbook-runtime.js`
- Modify: `scripts/docs/build-app-documentation.test.mjs`

**Interfaces:**
- URL state: `#tab=<tabId>&article=<documentId>&heading=<headingId>`.
- DOM: `[role=tablist]`, `[role=tab]`, `[role=tabpanel]`, `[data-article-link]`, `[data-document]`, `[data-page-toc]`.
- Runtime: `activateRoute({ tabId, articleId, headingId, historyMode, restoreScroll })`.

- [ ] **Step 1: Add shell and reachability assertions**

```js
test("renders seven accessible tabs and every source once", () => {
  const html = buildDocumentationHtml();
  assert.equal((html.match(/role="tab"/g) ?? []).length, 7);
  assert.equal((html.match(/role="tabpanel"/g) ?? []).length, 7);
  for (const id of ["start", "workflows", "roles", "architecture", "infrastructure", "security", "release"]) {
    assert.match(html, new RegExp(`id="tab-${id}"`));
    assert.match(html, new RegExp(`id="panel-${id}"`));
  }
  assert.equal((html.match(/<article[^>]+data-document/g) ?? []).length, documentationSources().length);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test scripts/docs/build-app-documentation.test.mjs`

Expected: FAIL because the current shell has no ARIA tab pattern.

- [ ] **Step 3: Render the four-region desktop shell**

Generate a global header, sticky primary tab rail, active-tab contents rail, reading canvas, and optional right-side table of contents. Render one article instance only; related tabs link to its primary location.

The active tab button must use:

```html
<button role="tab" id="tab-start" aria-controls="panel-start" aria-selected="true" tabindex="0">Start Here</button>
```

Inactive tabs use `aria-selected="false"` and `tabindex="-1"`. Each article link includes `data-tab`, `data-article`, title, summary, audience, and content type.

- [ ] **Step 4: Implement in-place routing and history**

```js
function parseRoute(hash = location.hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  return {
    tabId: params.get("tab") || "start",
    articleId: params.get("article"),
    headingId: params.get("heading"),
  };
}

function routeHash({ tabId, articleId, headingId }) {
  const params = new URLSearchParams({ tab: tabId });
  if (articleId) params.set("article", articleId);
  if (headingId) params.set("heading", headingId);
  return `#${params}`;
}
```

`activateRoute` validates IDs, updates tabs/panels/articles/TOC, updates `aria-current`, restores focus only for keyboard activation, and uses `history.pushState` or `history.replaceState`. Listen to `popstate` and `hashchange`; never assign `location.href` or call `location.reload()`.

- [ ] **Step 5: Add previous, next, related-source, and heading links**

Generate previous/next links in primary-tab sort order. Build right-side TOC entries from `h2` and `h3` headings. Related-source links use the related document's primary tab and ID.

- [ ] **Step 6: Verify generated behavior contract**

Run: `node --test scripts/docs/handbook-catalog.test.mjs scripts/docs/build-app-documentation.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/docs/build-app-documentation.mjs scripts/docs/build-app-documentation.test.mjs scripts/docs/handbook-styles.css scripts/docs/handbook-runtime.js
git commit -m "feat(docs): add accessible tabbed handbook navigation"
```

---

### Task 4: Scoped Search with Explainable Results

**Files:**
- Modify: `scripts/docs/build-app-documentation.mjs`
- Modify: `scripts/docs/handbook-runtime.js`
- Modify: `scripts/docs/handbook-styles.css`
- Modify: `scripts/docs/build-app-documentation.test.mjs`

**Interfaces:**
- Embedded index: `window.__HANDBOOK_INDEX__` entries with `tabId`, `articleId`, `headingId`, `title`, `heading`, `summary`, `audience`, `keywords`, `source`, and `text`.
- Search state: `{ query: string, scope: 'tab'|'all' }`.

- [ ] **Step 1: Add index assertions**

```js
test("embeds heading-level search records with match metadata", () => {
  const html = buildDocumentationHtml();
  assert.match(html, /window\.__HANDBOOK_INDEX__/);
  assert.match(html, /"scope":"all"/);
  assert.match(html, /aria-live="polite"/);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test scripts/docs/build-app-documentation.test.mjs`

Expected: FAIL because there is no heading-level embedded index.

- [ ] **Step 3: Build the deterministic search index**

Parse each rendered document into records at the article and heading level. Normalize with `toLocaleLowerCase('en-PH')`, collapse whitespace, retain at most 240 characters around a heading, and serialize with `JSON.stringify` after sorting by tab order, document sort order, and heading order.

- [ ] **Step 4: Implement current-tab and all-handbook search**

Search title, heading, summary, audience, keywords, source path, and body text. Rank exact title, title prefix, heading, keywords, summary, then body. Display tab, article, heading, excerpt, and a plain-language match reason. Selecting a result calls `activateRoute` and opens its containing disclosure.

- [ ] **Step 5: Preserve and clear search state correctly**

Store `query` and `scope`, write them to the hash as `q` and `scope`, announce result counts via `aria-live="polite"`, and restore pre-search disclosure state when clearing the query.

- [ ] **Step 6: Run focused tests**

Run: `node --test scripts/docs/build-app-documentation.test.mjs`

Expected: PASS and no unescaped `</script>` appears in embedded JSON.

- [ ] **Step 7: Commit**

```bash
git add scripts/docs/build-app-documentation.mjs scripts/docs/build-app-documentation.test.mjs scripts/docs/handbook-runtime.js scripts/docs/handbook-styles.css
git commit -m "feat(docs): add scoped explainable handbook search"
```

---

### Task 5: Progressive Disclosure and State Recovery

**Files:**
- Modify: `scripts/docs/build-app-documentation.mjs`
- Modify: `scripts/docs/handbook-runtime.js`
- Modify: `scripts/docs/handbook-styles.css`
- Modify: `scripts/docs/build-app-documentation.test.mjs`

**Interfaces:**
- Storage key: `mwell-intra-handbook:v2`.
- Persisted model: `{ activeTab, activeArticle, query, scope, expandedIds, diagramViews, diagramZoom, tabScroll, theme }`.

- [ ] **Step 1: Assert semantic disclosures and storage version**

```js
test("renders progressive disclosures with stable state keys", () => {
  const html = buildDocumentationHtml();
  assert.match(html, /<details[^>]+data-section-id=/);
  assert.match(html, /Expand all/);
  assert.match(html, /Collapse all/);
  assert.match(html, /mwell-intra-handbook:v2/);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test scripts/docs/build-app-documentation.test.mjs`

Expected: FAIL because article sections are not disclosures.

- [ ] **Step 3: Transform eligible `h2` sections into `<details>`**

For `collapse: 'workflow'`, leave overview diagram and completion criteria open and collapse procedures, exceptions, controls, and reference detail. For `collapse: 'reference'`, keep the first section open. Use a stable key `${document.id}:${headingId}` and native `<summary>` elements.

- [ ] **Step 4: Implement persistence and recovery**

Debounce writes by 100 ms. Restore tab and article before scroll; restore heading after Mermaid finishes. Store per-tab scroll only when the scroll source is the reading canvas. If the hash is invalid, route to Start Here and show a dismissible message containing a Search action.

- [ ] **Step 5: Implement expand-all and collapse-all**

Actions affect only the current article. Search temporarily opens matching sections but does not overwrite the user's saved disclosure set; clearing search restores it.

- [ ] **Step 6: Run focused tests**

Run: `node --test scripts/docs/build-app-documentation.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/docs/build-app-documentation.mjs scripts/docs/build-app-documentation.test.mjs scripts/docs/handbook-runtime.js scripts/docs/handbook-styles.css
git commit -m "feat(docs): preserve handbook reading state"
```

---

### Task 6: Flow-First Diagram Views and Process Ribbon

**Files:**
- Modify: `docs/PROCESS_REFERENCE_LIBRARY.md`
- Modify: `docs/manual/MWELL_INTRA_USER_MANUAL.md`
- Modify: `scripts/docs/build-app-documentation.mjs`
- Modify: `scripts/docs/handbook-runtime.js`
- Modify: `scripts/docs/handbook-styles.css`
- Modify: `scripts/docs/build-app-documentation.test.mjs`

**Interfaces:**
- Diagram markup: `[data-diagram-group]`, `[data-diagram-view='overview|role|decision']`, `[data-diagram-fit]`, `[data-diagram-zoom]`.
- Process ribbon: ordered lifecycle stages derived from a workflow's overview diagram metadata.

- [ ] **Step 1: Add flow-first artifact assertions**

```js
test("renders maintained flow views before workflow prose", () => {
  const html = buildDocumentationHtml();
  assert.ok((html.match(/class="mermaid"/g) ?? []).length >= 6);
  assert.match(html, /data-diagram-view="overview"/);
  assert.match(html, /data-diagram-view="role"/);
  assert.match(html, /data-diagram-view="decision"/);
  assert.match(html, /class="process-ribbon"/);
  assert.doesNotMatch(html, /```mermaid/);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test scripts/docs/build-app-documentation.test.mjs`

Expected: FAIL because diagram groups and the process ribbon are absent.

- [ ] **Step 3: Update maintained workflow sources**

For procurement-to-payment, vendor accreditation, receiving/putaway, ecommerce fulfillment, returns/replacements, inventory release, event custody, and inventory integrity, place the overview Mermaid flow first, followed by completion criteria. Add separate role/handoff and decision/exception Mermaid diagrams where the workflow branches. Use labeled decision edges and preserve source filenames and owners.

- [ ] **Step 4: Generate grouped diagram controls and process ribbons**

Render Overview, By role, and Decisions as a segmented control. The process ribbon lists the overview's major stages with the active stage synchronized to the selected view. Keep all diagram labels selectable.

- [ ] **Step 5: Add fit, 100%, zoom, pan, and state behavior**

Default to Fit. Clamp zoom to 60–180%, persist per diagram, allow independent overflow pan, and never resize the page layout. Respect reduced motion by removing zoom transitions.

- [ ] **Step 6: Validate Mermaid rendering and source order**

Run: `node --test scripts/docs/build-app-documentation.test.mjs && pnpm docs:build && pnpm verify:app-documentation-html`

Expected: PASS with at least six rendered Mermaid containers and no source fence visible.

- [ ] **Step 7: Commit**

```bash
git add docs/PROCESS_REFERENCE_LIBRARY.md docs/manual/MWELL_INTRA_USER_MANUAL.md scripts/docs/build-app-documentation.mjs scripts/docs/build-app-documentation.test.mjs scripts/docs/handbook-runtime.js scripts/docs/handbook-styles.css docs/manual/index.html
git commit -m "feat(docs): make handbook workflows flow first"
```

---

### Task 7: Responsive, Accessible, and Print Certification

**Files:**
- Create: `scripts/docs/serve-handbook.mjs`
- Create: `apps/shell/tests/e2e/standalone-handbook.spec.ts`
- Create: `apps/shell/playwright.handbook.config.ts`
- Modify: `scripts/docs/handbook-runtime.js`
- Modify: `scripts/docs/handbook-styles.css`
- Modify: `apps/shell/package.json`

**Interfaces:**
- Static server command: `node ../../scripts/docs/serve-handbook.mjs --port 3018` from `apps/shell`.
- Playwright base URL: `http://127.0.0.1:3018/`.

- [ ] **Step 1: Write the failing browser certification**

```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('navigates, searches, restores state, and has no serious accessibility findings', async ({ page }) => {
  await page.goto('http://127.0.0.1:3018/');
  await page.getByRole('tab', { name: 'Workflows' }).click();
  await page.getByRole('searchbox').fill('three-way match');
  await page.getByRole('link', { name: /three-way match/i }).first().click();
  const before = page.url();
  await page.reload();
  await expect(page).toHaveURL(before);
  await expect(page.getByRole('tab', { name: 'Workflows' })).toHaveAttribute('aria-selected', 'true');
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual([]);
});

test('never creates page-level horizontal overflow', async ({ page }) => {
  await page.goto('http://127.0.0.1:3018/#tab=workflows');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `pnpm --filter @intra/shell exec playwright test tests/e2e/standalone-handbook.spec.ts --config=playwright.handbook.config.ts --project=desktop-1440`

Expected: FAIL because the handbook static server and final controls are not wired.

- [ ] **Step 3: Add the loopback-only static server**

Serve only `docs/manual/index.html` at `/`, reject traversal with status 404, set `Content-Type: text/html; charset=utf-8`, and bind to `127.0.0.1`. Add `test:handbook` to `apps/shell/package.json` using the dedicated config below.

```ts
import { defineConfig, devices } from '@playwright/test';

const widths = [
  ['desktop-1440', 1440, 900], ['desktop-1280', 1280, 800],
  ['desktop-1024', 1024, 768], ['tablet-768', 768, 1024],
  ['mobile-430', 430, 932], ['mobile-390', 390, 844],
  ['mobile-360', 360, 800], ['mobile-320', 320, 720],
] as const;

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'standalone-handbook.spec.ts',
  use: { baseURL: 'http://127.0.0.1:3018', serviceWorkers: 'block', reducedMotion: 'reduce' },
  projects: widths.map(([name, width, height]) => ({
    name,
    use: { ...devices['Desktop Chrome'], viewport: { width, height } },
  })),
  webServer: {
    command: 'node ../../scripts/docs/serve-handbook.mjs --port 3018',
    url: 'http://127.0.0.1:3018/',
    reuseExistingServer: false,
  },
});
```

- [ ] **Step 4: Complete responsive and drawer behavior**

At 1024 and wider use contents/article/TOC columns. At 768–1023 hide the TOC behind an icon button. At 767 and narrower keep the tab rail horizontally scrollable, place Contents and On this page in focus-trapped drawers, keep sticky controls below the header, and prevent drawers from covering focused content. Tables and diagrams scroll inside their own containers.

- [ ] **Step 5: Complete keyboard and print behavior**

Implement Left/Right/Home/End tab movement, Escape drawer close with focus return, `/` search focus, visible `:focus-visible`, and no trap in diagram controls. Add Current article, Active tab, and Complete handbook print choices. Before print, mark scope on `<html>`; CSS hides controls and expands required disclosures without mutating `open` attributes.

- [ ] **Step 6: Run the full viewport matrix**

Run: `pnpm --filter @intra/shell exec playwright test tests/e2e/standalone-handbook.spec.ts --config=playwright.handbook.config.ts`

Expected: PASS across all eight specified viewport projects.

- [ ] **Step 7: Capture review screenshots**

Capture light, dark, and print previews at desktop 1440, tablet 768, mobile 430, and mobile 320 into `outputs/handbook-visual-review/`. Review for sticky collisions, clipped tabs, truncated controls, unreadable diagrams, orphan headings, and horizontal overflow. Keep `outputs/` untracked.

- [ ] **Step 8: Commit**

```bash
git add scripts/docs/serve-handbook.mjs apps/shell/tests/e2e/standalone-handbook.spec.ts apps/shell/playwright.handbook.config.ts apps/shell/package.json scripts/docs/handbook-runtime.js scripts/docs/handbook-styles.css
git commit -m "test(docs): certify handbook accessibility and responsiveness"
```

---

### Task 8: Release Content, Generated Artifact, and Launch Gates

**Files:**
- Create: `docs/releases/2026-08-22-STANDALONE-HANDBOOK-RELEASE.md`
- Modify: `docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md`
- Modify: `docs/TRAINING_AND_HANDOVER_CONTENT.md`
- Modify: `docs/manual/MWELL_INTRA_USER_MANUAL.md`
- Modify: `scripts/docs/handbook-catalog.mjs`
- Modify: `scripts/docs/build-app-documentation.test.mjs`
- Modify: `docs/manual/index.html`

**Interfaces:**
- Release source must state build command, source count, release commit, tested viewports, diagram count, accessibility result, and known limitations.
- Final artifact remains generated only through `pnpm docs:build`.

- [ ] **Step 1: Add final release assertions**

```js
test("publishes current release identity and governed source metadata", () => {
  const html = buildDocumentationHtml();
  assert.match(html, /Standalone Handbook Release/);
  assert.match(html, /Source checksum/);
  assert.match(html, /Reviewed|Effective|Historical evidence/);
  assert.doesNotMatch(html, /Knowledge Base/i);
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `node --test scripts/docs/build-app-documentation.test.mjs`

Expected: FAIL until the release source is added and classified.

- [ ] **Step 3: Update maintained documentation**

Document the seven-tab standalone experience, state model, offline boundary, search behavior, print scopes, metadata ownership, screenshot policy, diagram conventions, and the rule that release documentation changes with application behavior. Write the release note with evidence from Task 7 and classify it under Release & QA.

- [ ] **Step 4: Regenerate and run all documentation gates**

Run: `pnpm docs:build && node --test scripts/docs/handbook-catalog.test.mjs scripts/docs/build-app-documentation.test.mjs && pnpm verify:app-documentation-html && pnpm verify:release-documentation && pnpm verify:launch-artifacts`

Expected: every command passes; a second `pnpm docs:build` creates no diff.

- [ ] **Step 5: Run final browser certification**

Run: `pnpm --filter @intra/shell exec playwright test tests/e2e/standalone-handbook.spec.ts --config=playwright.handbook.config.ts`

Expected: PASS across the configured desktop, tablet, and mobile projects.

- [ ] **Step 6: Commit**

```bash
git add docs/releases/2026-08-22-STANDALONE-HANDBOOK-RELEASE.md docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md docs/TRAINING_AND_HANDOVER_CONTENT.md docs/manual/MWELL_INTRA_USER_MANUAL.md scripts/docs/handbook-catalog.mjs scripts/docs/build-app-documentation.test.mjs docs/manual/index.html
git commit -m "docs: release standalone tabbed handbook"
```

## Cross-Plan Release Order

1. Implement Tasks 1–7 in this plan without publishing the final release note.
2. Implement procurement-policy plan Tasks 1–10 so the application behavior is authoritative.
3. Implement procurement-policy documentation Task 11.
4. Complete Task 8 here, regenerate the single HTML artifact, and run both plans' certification suites.
5. Deploy UAT only after the generated handbook, application bundle, database migration, and release evidence identify the same commit.
