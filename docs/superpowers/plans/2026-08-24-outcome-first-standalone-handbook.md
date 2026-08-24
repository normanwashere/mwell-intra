# Outcome-First Standalone Handbook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task by task.

**Goal:** Turn the standalone Mwell Intra handbook into a task-first, role-aware, searchable, responsive guide while preserving its governed sources, offline HTML delivery, Mermaid diagrams, embedded screenshots, legacy deep links, and print controls.

**Architecture:** Keep `handbook-catalog.mjs` as the exact source registry and add a separate guide presentation model in `handbook-guides.mjs`. The generator resolves source documents into canonical Home, Tasks, Roles, and System guides, builds a typed search index, and emits one self-contained HTML file. The runtime owns canonical route/state migration, ranked search, focus, drawers, print scope, and per-guide restoration without reloading.

**Tech Stack:** Node.js ESM, `node:test`, Marked, Mermaid, vanilla JavaScript, CSS, Playwright, Axe.

**Spec:** `docs/superpowers/specs/2026-08-24-outcome-first-standalone-handbook-design.md`

## Global Constraints

- Keep `docs/manual/index.html` as one offline-capable generated file with no network dependency.
- Do not weaken policy, role, security, source provenance, or release evidence content.
- Do not expose file paths, hashes, commit metadata, or release controls before operational guidance.
- Preserve and translate legacy `#tab=...&article=...&heading=...` links.
- Treat every maintained source as exact: missing, duplicate, stale, or unclassified sources fail the build.
- Use the current 11-persona taxonomy exactly.
- Pair each procedural screenshot with the step it supports; a trailing screenshot gallery is not accepted as the primary instruction.
- Maintain keyboard, touch, print, light/dark, 320-1440px, and reduced-motion support.
- Use test-first red/green/refactor work and commit each task independently.

## Task 1: Make The Source Registry Fail Closed

**Files:**
- Modify: `scripts/docs/handbook-catalog.mjs`
- Modify: `scripts/docs/handbook-catalog.test.mjs`
- Modify: `scripts/docs/build-app-documentation.test.mjs`

**Step 1: Write failing catalog tests**

Replace the seven-tab public-navigation assertion with source-registry assertions. Add tests proving that every `documentationSources()` entry is explicitly classified, catalog entries missing from disk fail, unknown sources fail instead of falling back to Release, and source IDs are unique. Add explicit coverage for the two August 23 release notes and remove the stale August 22 catalog-only source.

**Step 2: Run the focused tests and confirm red**

Run: `node --test scripts/docs/handbook-catalog.test.mjs scripts/docs/build-app-documentation.test.mjs`

Expected: failures for unclassified release notes, the stale catalog record, fallback behavior, and the outdated `Knowledge Base` negative assertion.

**Step 3: Implement exact source classification**

Classify `docs/releases/2026-08-23-CANONICAL-DEPARTMENT-AUTHORITY.md` and `docs/releases/2026-08-23-UAT-TRANSACTION-CERTIFICATION-REMEDIATION.md`; remove the missing `docs/releases/2026-08-22-MPIC-PROCUREMENT-POLICY-ALIGNMENT.md` record; replace fallback metadata with an actionable error returned by `resolveHandbookCatalog` and thrown by the generator.

**Step 4: Update stale wording assertion**

Change the handbook-title assertion so it permits the current product terminology while continuing to reject links or prose that depend on the live in-app knowledge base.

**Step 5: Verify and commit**

Run: `node --test scripts/docs/handbook-catalog.test.mjs scripts/docs/build-app-documentation.test.mjs`

Expected: all focused tests pass.

Commit: `git commit -m "docs: fail closed on handbook source drift"`

## Task 2: Add The Canonical Guide Model

**Files:**
- Create: `scripts/docs/handbook-guides.mjs`
- Create: `scripts/docs/handbook-guides.test.mjs`

**Step 1: Write failing model-contract tests**

Test four ordered modes (`home`, `tasks`, `roles`, `system`), 13 canonical task IDs, 11 exact role IDs/titles, unique guide IDs, valid related-guide references, valid source files and source headings, valid screenshot paths, task fields, role authority fields, and complete source-to-guide traceability.

**Step 2: Run and confirm red**

Run: `node --test scripts/docs/handbook-guides.test.mjs`

Expected: module-not-found failure.

**Step 3: Implement immutable guide metadata**

Export `HANDBOOK_MODES`, `HANDBOOK_GUIDES`, `LEGACY_ROUTES`, and `validateHandbookGuides`. Define the 13 task guides from the approved spec, the 11 role guides from the current persona taxonomy, and System guides for architecture, infrastructure, security/governance, release/QA, imports, and source references. Store presentation labels, outcomes, roles, prerequisites, source sections, decision labels, related guides, and screenshot references separately from source metadata.

**Step 4: Implement deterministic validation**

Validation must report duplicate IDs, missing references, missing source files/headings/assets, incomplete task or role contracts, orphan maintained sources, and invalid legacy targets. It must not silently infer a release category.

**Step 5: Verify and commit**

Run: `node --test scripts/docs/handbook-guides.test.mjs scripts/docs/handbook-catalog.test.mjs`

Expected: all tests pass.

Commit: `git commit -m "docs: add canonical handbook guide model"`

## Task 3: Generate Outcome-First Guides

**Files:**
- Modify: `scripts/docs/build-app-documentation.mjs`
- Modify: `scripts/docs/build-app-documentation.test.mjs`
- Modify: `docs/manual/index.html`

**Step 1: Write failing generator tests**

Assert that the output exposes Home, Tasks, Roles, and System navigation; starts with the question “What do you need to do?”; renders frequent task links above source metadata; emits task sections in the required order; emits role modules, permitted/prohibited actions, handoffs, simulation, recovery, and completion; collapses Policy basis and Document controls; preserves all source content in traceable source-reference sections; and embeds typed search and legacy-route data.

**Step 2: Run and confirm red**

Run: `node --test scripts/docs/build-app-documentation.test.mjs`

Expected: assertions fail against the current seven-tab document renderer.

**Step 3: Refactor the generator into phases**

Add exported pure helpers `loadDocumentationSources`, `resolveHandbookModel`, `composeHandbookGuides`, `buildGuideSearchIndex`, and `renderHandbookShell`. Reuse existing Markdown, Mermaid, CSV, image embedding, heading IDs, and source checksum code. Render source references only inside guide support sections and the System source library.

**Step 4: Render canonical pages**

Home renders frequent tasks, role entry, System entry, and recent guides. Task pages render Outcome, Flow, Who is involved, Before you start, numbered procedures, decisions/exceptions, completion, related guides, Policy basis, and Document controls. Role pages render purpose, modules, authority, prohibited actions, handoffs, guided simulation, negative/recovery cases, and completion evidence.

**Step 5: Verify generation and commit**

Run: `node --test scripts/docs/build-app-documentation.test.mjs scripts/docs/handbook-guides.test.mjs scripts/docs/handbook-catalog.test.mjs`

Run: `pnpm docs:build`

Run: `pnpm verify:app-documentation-html`

Expected: all tests pass and the generated HTML is current.

Commit: `git commit -m "docs: generate outcome-first handbook guides"`

## Task 4: Replace Tab-Centric Runtime State

**Files:**
- Modify: `scripts/docs/handbook-runtime.js`
- Modify: `scripts/docs/build-app-documentation.test.mjs`
- Modify: `apps/shell/tests/e2e/standalone-handbook.spec.ts`

**Step 1: Write failing runtime tests**

Test canonical `#mode=tasks&guide=receive-inspect-putaway&heading=...` parsing/emission, legacy tab/article translation, URL-over-storage precedence, v2-to-v3 state migration, per-guide scroll restoration, back/forward, destination focus, guide-specific disclosure state, and invalid-route recovery.

**Step 2: Run and confirm red**

Run: `node --test scripts/docs/build-app-documentation.test.mjs`

Expected: canonical route and v3 state assertions fail.

**Step 3: Implement canonical navigation and state**

Use one route shape `{modeId, guideId, headingId, query, scope}`. Emit only canonical hashes. Parse old routes through `LEGACY_ROUTES`. Save `mwell-intra-handbook:v3` state per guide, migrate v2 once, and never let stored state override an explicit URL. Preserve scroll/focus on same-guide navigation and restore the exact guide/heading after reload.

**Step 4: Implement accessible navigation behavior**

Move focus to the selected guide heading, return focus when a drawer closes, trap drawer focus, support Escape, and update active navigation without document reload. Invalid links open Home with a visible recovery message and search action.

**Step 5: Verify and commit**

Run: `node --test scripts/docs/build-app-documentation.test.mjs`

Run: `pnpm --filter @intra/shell exec playwright test --config playwright.handbook.config.ts --grep "navigates|keyboard|overflow"`

Expected: unit and focused browser tests pass.

Commit: `git commit -m "docs: add canonical handbook navigation state"`

## Task 5: Make Search Operational And Explainable

**Files:**
- Modify: `scripts/docs/build-app-documentation.mjs`
- Modify: `scripts/docs/handbook-runtime.js`
- Modify: `scripts/docs/build-app-documentation.test.mjs`
- Modify: `apps/shell/tests/e2e/standalone-handbook.spec.ts`

**Step 1: Write failing search tests**

Cover “three-way match”, “approve request”, “report damaged item”, “reset password”, “cycle count”, and “DOA”. Assert typed results (`Task`, `Step`, `Decision`, `Role`, `Troubleshooting`, `System`), deduplication, actionable top-three ranking, operational results ahead of release evidence, highlighted reason/excerpt, and helpful zero-result recovery.

**Step 2: Run and confirm red**

Run: `node --test scripts/docs/build-app-documentation.test.mjs`

Run: `pnpm --filter @intra/shell exec playwright test --config playwright.handbook.config.ts --grep "search"`

Expected: current source-heading index returns zero, noisy, or incorrectly ranked results.

**Step 3: Build typed guide search records**

Index guide title/outcome, numbered steps, decisions, role permissions, recovery text, troubleshooting, and System references. Normalize aliases such as DOA/delegation of authority, receiving/receipt, damaged/quarantine, password/access. Use deterministic weights: exact task and step matches, then decision/role/troubleshooting, then System/release evidence.

**Step 4: Add no-result recovery**

Show spelling-neutral suggestions, frequent tasks, role-guides entry, and a System-reference link without trapping the user in an empty drawer.

**Step 5: Verify and commit**

Run: `node --test scripts/docs/build-app-documentation.test.mjs`

Run: `pnpm --filter @intra/shell exec playwright test --config playwright.handbook.config.ts --grep "search"`

Expected: every representative query resolves and ranking assertions pass at all configured projects.

Commit: `git commit -m "docs: add task-aware handbook search"`

## Task 6: Implement The Responsive Reading Experience

**Files:**
- Modify: `scripts/docs/handbook-styles.css`
- Modify: `scripts/docs/build-app-documentation.mjs`
- Modify: `apps/shell/tests/e2e/standalone-handbook.spec.ts`

**Step 1: Write failing layout and interaction tests**

Assert at most three stable desktop regions, no seven-tab horizontal strip, compact mobile header/menu, no metadata before primary guidance, mobile persistent chrome at or below 180px at 320x720, 44px touch targets with spacing, no horizontal overflow, readable diagrams/tables, and an accessible screenshot viewer.

**Step 2: Run and confirm red**

Run: `pnpm --filter @intra/shell exec playwright test --config playwright.handbook.config.ts --grep "mobile|desktop|overflow|touch"`

Expected: current shell violates navigation, chrome-height, and hierarchy assertions.

**Step 3: Build the desktop shell**

Use a restrained sticky header, one primary guide rail, and a centered reading canvas. Put On this page, theme, print, and source controls in compact controls or drawers. Use full-width content bands and tightly scoped cards only for repeated task/role choices.

**Step 4: Build the mobile shell**

Use a compact brand/search/menu header, one-column task/role navigation, safe-area-aware controls, and a full-height drawer. Remove persistent horizontal modes and source metadata. Keep the current step and next action within reach without covering content.

**Step 5: Improve diagrams and screenshots**

Keep Mermaid diagrams first in workflow guides. Add fit/zoom and decision-view controls. Place each actual screenshot next to its numbered step with a short caption and an accessible full-screen viewer; do not rely on the trailing gallery.

**Step 6: Verify and commit**

Run: `pnpm docs:build`

Run: `HANDBOOK_CAPTURE=1 pnpm --filter @intra/shell exec playwright test --config playwright.handbook.config.ts`

Expected: all eight viewport projects pass and current light/dark/print evidence is captured.

Commit: `git commit -m "docs: redesign handbook for responsive task guidance"`

## Task 7: Complete Task, Role, And Evidence Coverage

**Files:**
- Modify: `scripts/docs/handbook-guides.mjs`
- Modify: `scripts/docs/handbook-guides.test.mjs`
- Modify: `docs/manual/MWELL_INTRA_USER_MANUAL.md`
- Modify: `docs/PROCESS_REFERENCE_LIBRARY.md`
- Modify: `docs/TRAINING_AND_HANDOVER_CONTENT.md`
- Add or update: `docs/manual/assets/knowledge-base/*.png`

**Step 1: Write failing coverage tests**

Require every implemented workflow to have one canonical task guide, every current persona to have one role guide, every guide to identify its module, every decision branch to identify the decision owner and recovery path, and every procedural screenshot to map to a concrete step and current app route.

**Step 2: Run and confirm red**

Run: `node --test scripts/docs/handbook-guides.test.mjs scripts/docs/build-app-documentation.test.mjs`

Expected: incomplete screenshot and guide-section mappings fail.

**Step 3: Remove presentation-level duplication**

Keep policy and technical records as authoritative sources. Replace duplicated long-form operational prose with canonical guide compositions and source-section references. Reconcile role naming to the 11-persona taxonomy across the manual, process library, and training content without changing actual authority.

**Step 4: Capture and annotate current application evidence**

Use current UAT screens for the implemented steps only. Capture both desktop and mobile where the interaction differs. Crop to the relevant control while retaining enough page context, add a visible numbered hotspot/callout, remove sensitive data, and update captions with route, role, and expected result.

**Step 5: Verify and commit**

Run: `node --test scripts/docs/handbook-guides.test.mjs scripts/docs/build-app-documentation.test.mjs`

Run: `pnpm docs:build`

Expected: complete task/role/source/screenshot coverage with no orphan or duplicate guide.

Commit: `git commit -m "docs: complete handbook task and role coverage"`

## Task 8: Full Handbook Certification And Release Evidence

**Files:**
- Modify: `apps/shell/tests/e2e/standalone-handbook.spec.ts`
- Modify: `apps/shell/playwright.handbook.config.ts` only if project metadata changes are required
- Modify: `docs/releases/2026-08-24-OUTCOME-FIRST-HANDBOOK.md`
- Modify: `docs/TECHNICAL_AND_FUNCTIONAL_SPECIFICATION.md`
- Modify: `docs/TRAINING_AND_HANDOVER_CONTENT.md`
- Modify: `docs/manual/index.html`

**Step 1: Add end-to-end acceptance journeys**

Cover first-use Home, task discovery, role discovery, every task guide, every role guide, decision branches, source controls, legacy deep links, search, no-result recovery, reload restoration, back/forward, keyboard-only use, print guide/mode/all, Mermaid interactions, screenshot viewer, and light/dark presentation.

**Step 2: Run complete focused verification**

Run: `node --test scripts/docs/handbook-catalog.test.mjs scripts/docs/handbook-guides.test.mjs scripts/docs/build-app-documentation.test.mjs`

Run: `pnpm docs:build`

Run: `pnpm verify:app-documentation-html`

Run: `HANDBOOK_CAPTURE=1 pnpm --filter @intra/shell exec playwright test --config playwright.handbook.config.ts`

Expected: all unit and eight-project browser suites pass with zero serious/critical Axe violations, zero overflow, and current screenshots.

**Step 3: Perform strict visual review**

Inspect desktop 1440/1280/1024, tablet 768, and mobile 430/390/360/320 captures for hierarchy, legibility, clipped text, accidental whitespace, control overlap, unusable diagrams, weak focus, awkward hotspots, stale screenshots, and visual dead ends. Fix and rerun until clean.

**Step 4: Run repository-level documentation checks**

Run: `pnpm lint`

Run: `pnpm typecheck`

Run: `pnpm verify:release-documentation`

Expected: all checks pass; any unrelated pre-existing failure is recorded precisely without weakening the handbook checks.

**Step 5: Update release and handover documentation**

Record the four-mode architecture, route migration, source/guide split, search behavior, responsive acceptance, accessibility status, screenshot evidence paths, and exact commands/results. Regenerate `docs/manual/index.html` after the last source edit.

**Step 6: Final commit**

Commit: `git commit -m "docs: certify outcome-first standalone handbook"`
