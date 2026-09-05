# Outcome-First Standalone Handbook Certification

**Certification date:** August 25, 2026
**Release scope:** standalone Mwell Intra handbook
**Release status:** certified standalone artifact; no deployment or push authorized by this record

## Release identity

This release certifies the outcome-first, offline-capable handbook generated at `docs/manual/index.html`. It does not deploy application code, mutate UAT data, touch production, or change authenticated application behavior.

The certified source lineage begins with Task 7 evidence remediation at `27eb9b9` and includes the independently anchored CI-attestation hardening at `464f840`. The final Task 8 commit is created only after every gate in this record is rerun against the regenerated handbook.

## Certified architecture

- Four public modes: Home, Tasks, Roles, and System.
- Canonical five-field route state: mode, guide, heading, query, and scope.
- Exhaustive migration from all 372 maintained legacy tab, article, and heading routes in the current registry. The original August 24 certification covered 313; eighteen source-registry routes were added on August 28 and 37 article/heading routes across updated maintained sources on September 5, including all three candidate guides. Four September 6 headings bring the previous 368-route inventory to 372: technical PO receipt/closure presentation, training PO count/closure practice, operating PO count/closure guidance, and manual guided-practice feedback. Later routes require their own verification and do not inherit the historical browser certification. August captures are stale under the unchanged seven-day gate as of September 5; historical-fixture unit tests do not recertify images.
- Separate governed source registry and user-facing guide model.
- Typed, ranked search for tasks, steps, decisions, roles, troubleshooting, and System references.
- One self-contained HTML artifact with embedded styles, runtime, Mermaid diagrams, search data, and responsive screenshots.

## Acceptance coverage

- First-use Home and role entry.
- All 13 canonical task guides and their 52 operating stages.
- All 11 canonical role guides, including the Leadership / Insights read-only simulation at `/insights`.
- All 48 decisions, 96 branches, and 27 terminal outcomes.
- Governed source controls and every generated legacy deep link.
- Search ranking and no-result recovery, including the eight literal first-use prompts at desktop 1440 and mobile 320 with the correct first-ranked title, match explanation, canonical destination, reload restoration, and zero serious or critical Axe findings.
- Reload, per-guide position, Back, Forward, keyboard-only operation, and focus restoration.
- Print scopes for current guide, current mode, and complete handbook.
- Mermaid fit, zoom, overview, role-lane, and decision perspectives.
- Certified desktop/mobile screenshot viewer and focus return.
- Light and dark presentation.

## Evidence and commands

The final Task 8 gates completed with these exact results:

- Unit trio: 81 passed, 0 failed, 0 skipped.
- Documentation build: generated `docs/manual/index.html` from 29 maintained sources.
- Generated HTML check: current.
- Strict evidence coverage: 0 warnings and 0 errors.
- Strict evidence provenance: 0 warnings and 0 errors.
- CI attestation: `task-stage-ci-attestation.json` verified.
- Eight-project Playwright suite: 116 passed, 100 project-conditional skips, 0 failed in 19.6 minutes.
- Capture inventory: 24 current PNGs, covering light, dark, and print at all eight acceptance widths.
- Lint: 15 of 15 Turbo tasks succeeded; 0 errors and 3 unrelated existing warnings.
- Typecheck: 15 of 15 Turbo tasks succeeded.
- Release-documentation verification: passed with `no operational source changed`; generated HTML current.

The executed commands were:

```text
node --test scripts/docs/handbook-catalog.test.mjs scripts/docs/handbook-guides.test.mjs scripts/docs/build-app-documentation.test.mjs
pnpm docs:build
pnpm verify:app-documentation-html
node --input-type=module -e "import { validateHandbookEvidenceCoverage, validateHandbookEvidenceProvenance } from './scripts/docs/handbook-guides.mjs'; /* fail on any warning or error */"
node scripts/docs/verify-handbook-ci-attestation.mjs
$env:HANDBOOK_CAPTURE='1'; pnpm --filter @intra/shell exec playwright test --config playwright.handbook.config.ts
pnpm lint
pnpm typecheck
pnpm verify:release-documentation
```

Strict screenshot coverage is evaluated through `validateHandbookEvidenceCoverage()` and provenance through `validateHandbookEvidenceProvenance()`.

## Visual review

The capture bundle under `outputs/handbook-visual-review/` contains light, dark, and print evidence for 1440, 1280, 1024, 768, 430, 390, 360, and 320 CSS-pixel widths. All 24 captures were inspected for hierarchy, legibility, clipped text, accidental whitespace, overlap, diagram fit, focus, hotspots, stale screenshots, and dead ends.

The final review found no clipped headings, incoherent overlaps, page-level horizontal overflow, stale stage evidence, unexplained layout gaps, unreadable decision records, or blocked continuation controls. Responsive screenshots retain numbered interaction targets and descriptive captions. Compact light and dark layouts close the menu after theme selection and preserve the full reading width. Print removes interactive chrome while retaining the guide, diagram, text equivalent, stage evidence, decisions, and completion record.

## Accessibility and responsive result

The acceptance suite completed with zero serious or critical Axe violations and zero page-level overflow findings. All mobile toolbar controls met the 44 by 44 CSS-pixel minimum. Keyboard-only navigation, compact focus trapping, trigger-focus return, same-document routing, reload restoration, Back and Forward, screenshot viewer, three print scopes, and Mermaid fit/zoom passed. The generated workspace tables are keyboard-focusable when horizontal scrolling is required. Mermaid fit retains the complete flow and readable labels through 320 CSS pixels, with dark canvas, edge, surface, and label contrast assertions passing.

## Repository checks

There were no unrelated pre-existing failures. Lint reported these three unrelated existing warnings, all outside the Task 8 files:

- `modules/procurement/src/components/BestValueEvaluation.tsx:70`: `requestId` is defined but never used.
- `modules/procurement/src/components/ExceptionPack.tsx:6`: `method` is defined but never used.
- `modules/procurement/src/components/ExceptionPack.tsx:8`: `amount` is defined but never used.

The repository requests Node 22 or newer and pnpm 10. The local verification runtime was Node `v20.18.1` with pnpm `9.15.9`, so every pnpm command emitted the existing unsupported-engine warning. All required commands still exited successfully; certification does not waive the declared engine requirement.

## Residual limitations

- The handbook certifies current documented behavior and UAT evidence; it is not proof of a production deployment or production database activation.
- External vendor-email delivery remains governed by the separate canary and release process when that scope is requested.
- Local execution uses the installed Node and pnpm versions; engine-version warnings are recorded with the final results.

## Release decision

Approved as the certified outcome-first standalone handbook artifact for the current documented UAT behavior and evidence set. This decision does not deploy or push the repository, approve production data changes, or replace the separate application release and canary process.
