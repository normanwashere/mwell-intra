# Mwell Intra Live UAT Full Launch-Readiness Audit

Date: 2026-08-13
Target: https://mwell-intra-uat.vercel.app
Deployed commit: `37b688b418b9000f3d5e5280dd987d67c6d1b011`
Supabase project: `kkoitlvydytdhlpxhuah`
Decision: **NO-GO**

## Scope and evidence

- Live authentication and exact role-to-route authorization crawl for all 11 UAT personas.
- Desktop 1440x900 and mobile 390x844 rendered checks, including route readiness, overflow, overlap, dead links, accessible names, keyboard reachability, target sizes, console errors, and network errors.
- Governed transaction probes for least privilege, Procurement receipt authority, Warehouse operations, Admin identity, session restoration, Warehouse setup, and cleanup safety.
- Supabase schema/data checks, security and performance advisors, health endpoint, manifest, service worker, source contracts, typecheck, lint, and unit tests.
- Route evidence: `test-results/audit-2026-08-13/routes-desktop-1440.json` and `routes-mobile-390.json`.
- Transaction evidence: `test-results/audit-2026-08-13/transactions-mobile-390.json` and `transactions-desktop-1440.json`.

## Findings

### P0 - Core assigned personas are denied required work

The live role crawl found 14 unique role-route failures on desktop and the same 14 on mobile. Six of 11 personas are affected:

- Platform Administrator: `/admin/users` and transaction route `/admin/doa` render access denied.
- General Employee: `/procurement/requests/new` renders access denied.
- Operations Associate: `/warehouse/storage`, `/warehouse/allocations`, `/warehouse/returns`, and `/warehouse/quality` cannot be used. Quality has no route-owned H1 and never reaches ready state.
- Operations Lead: `/warehouse/receiving`, `/warehouse/quality`, `/warehouse/approvals`, `/warehouse/cycle-counts`, `/warehouse/locations`, and `/warehouse/storage` render access denied.
- Finance Controller: `/warehouse/approvals` renders access denied.
- Legal & Compliance Lead: `/legal/invites/new` renders access denied.

The failure is not a responsive-layout artifact: the exact same authorization result appears at 1440x900 and 390x844 with no console or network errors. Screenshots show explicit access-denied panels. This blocks Admin configuration, request creation, vendor invitation, receiving, quality, putaway, cycle counts, approvals, allocations, and returns.

**Required correction:** reconcile `core.user_roles`, capability projection, learning requirements, and route guards against the intended persona matrix. The navigation must expose only reachable controls. A training lock must render a specific locked-capability recovery state, not generic role denial.

**Acceptance:** all 11 personas pass the exact authorization matrix at all six certified viewports; every expected route has one visible route-owned H1 and reaches ready state after refresh.

### P0 - The deployed commit has no complete governed live certification

GitHub has no workflow run associated with the deployed commit. Local replication shows why:

- `pnpm typecheck` fails in `modules/product/src/ProductApp.test.tsx`: its `SessionValue` fixture omits required `refreshCapabilities`.
- The mobile transaction probe passes Procurement denial, General Employee session/least privilege, and Vendor session/least privilege, but fails Operations Associate, Operations Lead, Platform Administrator, Warehouse location creation, and Warehouse bin creation.
- Deeper write/readback/handoff certification cannot be accepted without the UAT vaulted service credential. The non-UAT key available locally is correctly rejected as `Invalid API key`.

**Required correction:** fix typecheck, provision the UAT environment secrets in GitHub Actions, run `uat-live-certification.yml` for the exact deployed SHA on Node 24, and require all prepare, six route, two transaction, cleanup, and bundle jobs to pass before promotion.

**Acceptance:** a single successful workflow run for the deployed SHA publishes complete route, transaction, cleanup, and bundle artifacts; cleanup reports zero residue.

### P1 - Learning records contain historical duplication

`intra.test.operations.associate@mwell.com.ph` has 136 completed learning assignments grouped into four duplicated logical assignment sets, with 132 excess rows. The user has one active `receive_stock` certification. Other test personas have expected assignment counts but remain in `assigned` status.

**Required correction:** perform an evidence-preserving reconciliation migration that retains the canonical assignment and certification lineage, supersedes or archives duplicate records, and enforces a uniqueness constraint matching the resolver's logical identity. Do not hard-delete audit evidence.

**Acceptance:** no duplicate logical assignment groups; the Operations Associate retains one valid certification and all prerequisite evidence; repeated resolver calls create zero new rows.

### P1 - Knowledge screenshot release evidence is stale and its catalog command is broken

Knowledge content validation passes 79 tests and 132 screenshot files exist, but release evidence points to commit `1b307738...` captured on 2026-08-04 rather than live commit `37b688b...`. `pnpm verify:knowledge-evidence-catalog` fails because esbuild cannot bundle `modules/learning/src/training.css` imported through `OnboardingTrainingSession.tsx` without a CSS output path.

This means the repository cannot prove that hotspot coordinates and screenshots still match the current live controls. It is particularly material because several current role routes now render access denied.

**Required correction:** make the catalog build CSS-aware or externalize style imports, recapture every governed screenshot from the exact release SHA after role access is corrected, inspect each hotspot visually, and set the deployed-commit verification flag in CI.

**Acceptance:** the catalog command passes; every evidence item references the deployed SHA; no screenshot depicts an access-denied or stale control unless that is the documented state.

### P1 - Release observability cannot be audited from the connected Vercel scope

The health endpoint is green and reports the correct UAT project and commit, but Vercel deployment and runtime-log queries return 403 because the connector is authenticated to a different scope. A green health check cannot substitute for runtime error and latency review.

**Required correction:** re-authenticate the Vercel connector/CI token to `team_xHVECeOWiH6TGFfPGLc4Ej2J`, then make runtime error clusters, 4xx/5xx counts, and slow-route checks part of promotion evidence.

**Acceptance:** reviewers can retrieve deployment metadata and 24-hour runtime errors for the exact UAT deployment; alert ownership and thresholds are documented.

### P2 - Database performance debt is growing

Supabase reports 212 performance notices: two unindexed foreign keys on `private.learning_assessment_answer_keys`, 27 multiple-permissive-policy warnings in Learning, and 183 unused-index notices.

**Required correction:** add covering indexes for `created_by` and `updated_by`; consolidate semantically overlapping Learning policies after query-plan verification; collect representative telemetry before considering any unused-index removal.

**Acceptance:** no unindexed foreign keys; policy consolidation preserves least privilege; index decisions use production-like telemetry and rollback plans.

### P2 - Release environment contracts are incomplete

- `APP_URL` is used by deployment configuration but is absent from `turbo.json` pass-through variables.
- Local default Node is 20 while the repository requires Node 22 or later; the live harness failed cleanup initialization under Node 20 because native WebSocket support was unavailable. The bundled Node 24 runtime works and matches CI.
- Lint passes with one unused `OPERATING_PERSONAS` import warning in `apps/shell/lib/knowledge/operatingPersonas.ts`.

**Required correction:** pass through `APP_URL`, fail fast on unsupported Node before audit startup, standardize local/CI Node 24, and remove or use the dead import.

## What passed

- Health endpoint: correct UAT environment, Supabase reachable, client auth configured, static assets reachable, notifications/vendor delivery/service worker configured, exact commit reported.
- Manifest and `/serwist/sw.js` return 200 with appropriate security headers and service-worker scope.
- No horizontal overflow, detected overlap, serious accessibility violations, dead links, unlabeled controls, console errors, or network errors on routes that reached a rendered state in the two live viewport shards.
- Procurement Lead, Marketing & Events Lead, Product Owner, Leadership / Insights, and Vendor Representative passed the route authorization crawl on both tested viewports.
- Unit suite passed 1,436 tests across 15 packages. The live-audit contract passed 75 tests with one intentional skip. Launch-artifact verification passed.
- Supabase security advisors report only two informational fail-closed RLS-without-policy notices for internal Learning tables; these should be documented as intentional.
- Both failed transaction attempts were checked by a database-wide marker scan and left zero run-scoped residue.

## Repair order

1. Correct capability/onboarding resolution for the six affected personas and align navigation with reachable routes.
2. Fix Product typecheck and knowledge evidence-catalog build.
3. Reconcile duplicated Learning records with retained evidence and add idempotency enforcement.
4. Restore GitHub UAT secrets and Vercel observability scope.
5. Rerun the complete Node 24 UAT certification for the exact SHA, including vendor email delivery and cleanup.
6. Recapture and visually inspect all Knowledge Base screenshots from that SHA.
7. Address the two FK indexes and profile Learning RLS performance before scale testing.

The app should not be promoted to production until P0 and P1 acceptance criteria are met and the exact release SHA has a successful governed certification bundle.
