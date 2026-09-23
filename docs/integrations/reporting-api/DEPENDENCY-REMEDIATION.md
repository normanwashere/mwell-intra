# Dependency Security Remediation

September 23, 2026. Worktree: `reporting-security-foundation`; branch:
`codex/reporting-security-foundation`; starting commit: `96f75f9`.

## Scope

This is the separately authorized dependency follow-up to
`FOUNDATION-PROGRESS.md`, not a reporting API release. Only the 15 workspace
manifests declaring Vitest, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, two
test-only compatibility corrections, and this note are changed by this pass.
Reporting implementation, migrations, the handoff builder, live settings,
credentials, and the original onboarding checkout are
outside this change. This dependency subtask performed no commit, push,
deployment or live operations and had no deployment authority.

## Advisory Verification and Versions

The following maintainer-published advisories were checked directly, alongside
the npm registry audit. Counts refer to advisory/package-version entries:
the baseline contains seven High and two Moderate entries, not nine distinct
vulnerabilities.

| Package | Maintainer advisory | Patched threshold relevant to this tree |
| --- | --- | --- |
| brace-expansion | [GHSA-3jxr-9vmj-r5cp](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-3jxr-9vmj-r5cp) | 1.1.16 / 5.0.7 |
| brace-expansion | [GHSA-mh99-v99m-4gvg](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-mh99-v99m-4gvg) | 1.1.17 / 5.0.8 |
| brace-expansion | [GHSA-rgw5-rvv9-x895](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-rgw5-rvv9-x895) | 1.1.18 / 5.0.9 |
| js-yaml | [GHSA-5p4m-2wfm-xmqj](https://github.com/nodeca/js-yaml/security/advisories/GHSA-5p4m-2wfm-xmqj) | 4.3.1 |
| js-yaml | [GHSA-2883-xcg3-v3hh](https://github.com/nodeca/js-yaml/security/advisories/GHSA-2883-xcg3-v3hh) | 4.3.2 |
| vitest and @vitest/mocker | [GHSA-82fw-gwwq-j7x9](https://github.com/vitest-dev/vitest/security/advisories/GHSA-82fw-gwwq-j7x9) | 4.1.11 |

- All 15 Vitest consumers now declare `^4.1.11` (at least 4.1.11, below 5.0.0).
  The lockfile resolves Vitest and all seven `@vitest/*` internals to 4.1.11.
  This was the latest stable 4.x returned by the registry during this pass;
  Vitest 5 and prereleases were deliberately not selected.
- Major-scoped overrides replace brace-expansion 1.1.15 with 1.1.18 and 5.0.7
  with 5.0.9. They preserve the existing majors and pin the minimum releases
  addressing all three reported denial-of-service advisories. Other major
  lines are not coerced into an incompatible API.
- The js-yaml 4.x override pins 4.3.2, addressing both reported parsing
  denial-of-service advisories without adopting js-yaml 5.
- The mocker advisory concerns redirect-mock file serving. A clean audit
  does not authorize exposing development servers or establish end-to-end
  application authorization.

## Compatibility Boundary

The [Vitest 4 migration guide](https://v4.vitest.dev/guide/migration) was
reviewed, especially constructor mocks, mock restoration, test discovery,
the module runner, and pool options. Existing test assertions, skips,
timeouts, and production scripts are not relaxed to accommodate the upgrade.

A parsed comparison against the starting lockfile confirms that Vitest is
the only changed direct dependency across all workspace importers. Other
lockfile changes are its required transitive dependency replacements/removals
and the targeted brace-expansion/js-yaml patches. In particular, Vite remains
7.3.6; Next remains 16.3.4; React/React DOM remain 19.2.7; Serwist remains
9.5.11. This subtask leaves the runtime engine declaration unchanged. Validation uses
native Node 24.19.0 and pnpm 10.23.0.

### Required Test-Only Corrections

The initial Vitest 4 workspace run reproduced two failures in
`modules/warehouse/src/components/WorkingConvenience.test.tsx`: the tests
rejecting another user's/filter's scroll checkpoint and cancelling delayed
restoration inherited earlier `scrollTo` calls. Warehouse setup installs
`window.scrollTo = vi.fn()`. As documented in the Vitest 4 migration guide,
`spyOn` now returns an existing mock directly, and `restoreAllMocks()` does
not clear that mock's history. This is a lifecycle change, not a timing issue.

A focused run with one worker reproduced 4 passing and 2 failing tests before
the correction. A `beforeEach` inside only the list-position group now calls
`vi.mocked(window.scrollTo).mockClear()` before each test. All six tests then
passed. No assertion, timeout, skip, application code or shared configuration
was changed. The same cross-user/filter denial and exact call-count assertions
remain active.

The initial full workspace typecheck also found one TS2769 error in
`modules/procurement/src/components/SourcingWorkspace.test.ts`. Its mount
helper accepted `ReturnType<typeof vi.fn>`, which now includes constructor
mocks and is not necessarily a callable RPC. The helper now derives its RPC
type from `ComponentProps<typeof SourcingWorkspace>['client']`. No `any`,
cast, suppression, changed assertion or production type was introduced.
Procurement typecheck passed after this correction, followed by the complete
procurement test suite and a fresh all-workspace typecheck.

## Verification

Commands run from the worktree root using the native Node/pnpm paths supplied
for this task. Registry access and native test workers required escalated
execution. No secret files were read. Logs are generated under the ignored
`outputs/` directory.

| Check | Result |
| --- | --- |
| Baseline `pnpm audit --json` | Exit 1: 7 High, 2 Moderate; all other severities zero; 915 dependencies; none muted. |
| `pnpm install --lockfile-only --ignore-scripts --no-frozen-lockfile` | Exit 0; reviewed the generated diff before installation. |
| `pnpm install --frozen-lockfile` | Exit 0 across 17 projects; 20 package entries added, 26 removed; resolution skipped. |
| `pnpm install --frozen-lockfile --offline` | Exit 0, already up to date. All 15 installed Vitest paths resolve inside this worktree at 4.1.11. |
| Final `pnpm audit --json` | Exit 0; 906 dependencies; zero Info/Low/Moderate/High/Critical; no advisories or muted entries. |
| Final `pnpm audit --prod --json` | Exit 0; 167 dependencies; zero Info/Low/Moderate/High/Critical; no advisories or muted entries. |
| Parsed lockfile comparison against `96f75f9` | Passed: only Vitest changes among direct importer entries; all Vitest internals are 4.1.11; all three targeted patches present. |
| Transitive-consumer smoke checks | Passed: minimatch 3.1.5 resolves brace-expansion 1.1.18; minimatch 10.2.5 resolves 5.0.9; both preserve extension/sequence expansion and positive/negative glob matching. js-yaml 4.3.2 passes configuration parsing, ordered-map parsing and duplicate-key rejection. |
| `pnpm -r --workspace-concurrency=1 --no-bail run lint` | Exit 0 for all 15 workspace scripts; 0 errors, 6 warnings in untouched legal/procurement files. |
| `pnpm --filter @intra/procurement run lint` after its test-only correction | Exit 0; the same 4 procurement warnings, no new warnings or errors. |
| Final `pnpm -r --workspace-concurrency=1 --no-bail run typecheck` | Exit 0 for all 15 workspace scripts; no errors. The earlier full run had 14 passes and the single TS2769 error described above. |
| Scoped `git diff --check` | Exit 0 for all owned tracked files. |

No additional installer was run after
the successful offline check and the build handoff to the coordinating
engineering agent.

### Test Results

The complete workspace test command was
`pnpm -r --workspace-concurrency=1 --no-bail run test --maxWorkers=2`.
The baseline used `--reporter=dot`; the upgraded run and final package reruns
used `--reporter=default`. No filters excluded existing test cases.

- Vitest 3 baseline: 4,277 passed, one unchanged opt-in browser test skipped;
  exit 1 because the concurrently added `reporting/dictionary.test.ts` could
  not yet resolve its implementation. All 14 non-shell workspace scripts
  passed. This was a suite-loading failure, not a failing existing assertion.
- Initial Vitest 4 full run: 4,314 passed, two failed, one skipped; 14 workspace
  scripts passed. The only failing script was warehouse, with the two
  scroll-mock history failures described above. Shell passed 995 tests,
  including all 39 now-complete dictionary tests from coordinated release work.
- Focused red/green command:
  `pnpm --filter @intra/warehouse exec vitest run src/components/WorkingConvenience.test.tsx --maxWorkers=1`.
  Before the correction: 4 passed, 2 failed, exit 1. After: all 6 passed, exit 0.
- Complete corrected warehouse rerun:
  `pnpm --filter @intra/warehouse run test --maxWorkers=2 --reporter=default`.
  Exit 0: 119 files, 1,224 passed, no failures or skips. No concurrent build.
- Complete procurement rerun after the type correction:
  `pnpm --filter @intra/procurement run test --maxWorkers=2 --reporter=default`.
  Exit 0: 54 files, 538 passed, no failures or skips.

Final verified aggregate: **4,316 passing tests across 411 passing files**, plus
one unchanged skipped test/file (`lib/knowledge/taskGuidance.browser.test.tsx`).
This combines the unchanged workspaces' full-run results with the two complete
corrected package reruns; it is not presented as a second single green recursive
test command. No unresolved test failure remains in this evidence set.

| Workspace | Passing files | Passing tests |
| --- | ---: | ---: |
| data-kit | 36 | 391 |
| rbac | 3 | 65 |
| ui | 8 | 61 |
| auth | 3 | 73 |
| core-data | 1 | 18 |
| events | 10 | 74 |
| finance | 14 | 95 |
| insights | 5 | 38 |
| learning | 28 | 370 |
| legal | 29 | 244 |
| product | 7 | 67 |
| work | 9 | 63 |
| procurement | 54 | 538 |
| warehouse | 119 | 1,224 |
| shell | 85 | 995 |

Local evidence is in `outputs/dependency-audit-before.json`,
`outputs/dependency-audit-after.json`, `outputs/dependency-audit-prod-after.json`,
`outputs/dependency-install.log`, `outputs/dependency-install-offline.log`,
`outputs/dependency-consumer-smoke.log`, `outputs/dependency-tests-before.log`,
`outputs/dependency-tests-after.log`, `outputs/dependency-migration-red.log`,
`outputs/dependency-migration-green.log`, `outputs/dependency-warehouse-final.log`,
`outputs/dependency-procurement-tests-final.log`, `outputs/dependency-lint.log`,
`outputs/dependency-procurement-lint-final.log`, `outputs/dependency-typecheck.log`,
`outputs/dependency-procurement-typecheck-final.log`, and
`outputs/dependency-typecheck-final.log`.

The coordinating engineering agent reported a successful local shell build
with Node 24 and existing UAT configuration: compilation, TypeScript, 21 static
pages and 223 service-worker entries. That build ran concurrently with part of the
initial Vitest 4 warehouse run; it was finished before the focused reproduction
and corrected full warehouse rerun. This dependency pass did not run a build,
read UAT secrets or modify its configuration.

## Files Changed by This Pass

- `apps/shell/package.json`
- `modules/events/package.json`, `modules/finance/package.json`, `modules/insights/package.json`
- `modules/learning/package.json`, `modules/legal/package.json`, `modules/procurement/package.json`
- `modules/product/package.json`, `modules/warehouse/package.json`, `modules/work/package.json`
- `packages/auth/package.json`, `packages/core-data/package.json`, `packages/data-kit/package.json`
- `packages/rbac/package.json`, `packages/ui/package.json`
- `pnpm-workspace.yaml`, `pnpm-lock.yaml`
- `modules/warehouse/src/components/WorkingConvenience.test.tsx`
- `modules/procurement/src/components/SourcingWorkspace.test.ts`
- `docs/integrations/reporting-api/DEPENDENCY-REMEDIATION.md`

Concurrent reporting, deployment configuration/CI, handoff builder and other
documentation changes belong to coordinated release work and are not
part of this dependency change.

## Remaining Boundaries

An npm audit is a dated check of known registry advisories, not a guarantee
against undisclosed vulnerabilities. The overrides require review when
upstream dependency majors change. Six unused-variable lint warnings remain
in untouched legal/procurement files. Existing test-environment Tailwind
warnings and installer deprecation notices remain; no warnings were suppressed.
Local tests do not replace deployment,
live database/RLS checks, production browser/PWA acceptance, or reporting
release approval. The overall GitHub/Vercel UAT release is authorized; this
dependency subtask had no deployment authority and performed no live operations.
