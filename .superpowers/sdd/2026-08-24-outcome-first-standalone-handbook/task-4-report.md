## Task 4 Report: Canonical Handbook Routing and State

### Status

DONE

### Implementation

- Replaced tab/article runtime authority with canonical route state `{modeId, guideId, headingId, query, scope}`.
- Emitted canonical `#mode=...&guide=...&heading=...` hashes for generated links, search results, page-outline links, related guides, recent guides, and governed source links while retaining compatibility `data-tab` and `data-article` hooks.
- Translated old `tab/article/heading` hashes only through exact entries in `window.__HANDBOOK_LEGACY_ROUTES__`, replaced translated hashes with canonical hashes, and displayed a non-blocking moved-link notice.
- Added visible invalid-route recovery to Home with a search action.
- Migrated `mwell-intra-handbook:v2` to `mwell-intra-handbook:v3` once, removed the v2 record after migration, and kept explicit URL state authoritative over storage.
- Persisted v3 active route, per-guide scroll, recent guides, guide-specific disclosures, diagram views/zoom/modes, theme, query, and scope.
- Restored per-guide reading depth across Back/Forward, refresh, and visibility changes without resetting to the top.
- Focused guide H1 headings and exact canonical heading destinations below sticky chrome; preserved same-document navigation and drawer focus return/trapping/Escape behavior.
- Preserved current-guide/current-mode/full-handbook print behavior.

### Red Evidence

Initial test-first run:

`node --test scripts/docs/build-app-documentation.test.mjs`

- 26 passed, 8 failed.
- Expected failures covered canonical activation, v3 normalization and migration, per-guide scroll, canonical parsing/emission, exact legacy translation, and canonical generated links.

Focused browser red evidence identified and drove these Task 4 corrections:

- Same-document hash navigation initially failed to focus a newly opened guide H1.
- Same-document legacy hashes translated runtime state but initially left the old hash visible.
- The keyboard journey at 1024px initially attempted to focus a guide link in the closed Contents drawer because the runtime drawer breakpoint is 1180px.

### Green Evidence

- `node --test scripts/docs/build-app-documentation.test.mjs`: 34 passed, 0 failed.
- `pnpm --filter @intra/shell exec playwright test --config playwright.handbook.config.ts --grep "navigates|keyboard|overflow"`: 24 passed, 0 failed across 1440, 1280, 1024, 768, 430, 390, 360, and 320 CSS pixels.
- `pnpm docs:build`: generated `docs/manual/index.html` from 28 source documents.
- `pnpm verify:app-documentation-html`: generated handbook is current.
- `git diff --check`: passed; only repository line-ending warnings were reported.

### Desktop 1024 Breakpoint Fix

At 1024px the runtime correctly treats Contents and On this page as drawers because the breakpoint is 1180px. The keyboard coverage now opens the Contents drawer before entering a guide and exercises focus trapping, Escape, and focus return through the full drawer range (`<= 1180px`). The affected 1024px case and the complete focused matrix pass.

### Concerns

- The repository requests Node `>=22`, while verification ran on Node `20.18.1`; pnpm emitted an engine warning, but all required commands passed.
- Task 6 still owns visual restyling. No Task 6 styling issue blocked or weakened the Task 4 behavioral assertions.
