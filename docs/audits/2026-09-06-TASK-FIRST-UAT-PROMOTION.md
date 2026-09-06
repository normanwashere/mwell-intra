# Task-First UAT Promotion

## Current Decision

**HOLD public promotion and full certification.** Protected application candidate
`0363ae2` is built and healthy. Public UAT remains `7083373`; production is untouched.

| Item | Evidence and remaining work |
| --- | --- |
| Authority migration | Applied and verified in UAT, including unauthenticated denial checks |
| Protected candidate | 22/22 navigation checks; reconnect preservation and one blocked-SW check passed |
| Task readiness | Four selected-screen warnings: Operations Associate and Finance, desktop/mobile; governed mappings unresolved |
| Vendor publication | Exact review packet and rollback-only rehearsal prepared; human owner/reviewer not designated; not published |
| Screenshot certification | 1/271 independently reviewed for instruction-only use; 270 still need capture/review |
| Real-user pilot | Not run; participants, owner, schedule and consent remain pending |

Navigation success is not complete learning, business-transaction, or launch certification.

## Scope

User authorized proceeding with UAT release prerequisites, candidate promotion,
exact-step screenshot certification, and pilot preparation on September 6, 2026.
Production is outside this release. Human participation is not simulated.

## Authority Migration

- Target: `kkoitlvydytdhlpxhuah` (UAT).
- Source: `supabase/migrations/20260906043800_gate_legacy_po_cancel_and_vendor_acknowledgement.sql`.
- Applied through Supabase migration API under generated ledger version
  `20260906143709`, name `gate_legacy_po_cancel_and_vendor_acknowledgement`.
- The source migration is idempotent; the remote generated version differs from
  its local source filename. Do not infer absence from the local timestamp alone.
- Verified installed cancellation and vendor acknowledgement guard markers.
- Verified unchanged owner `postgres`, original ACLs, SECURITY DEFINER settings,
  and original search paths for both functions.
- No unrelated migration or optional telemetry migration applied.
- Targeted actual-SQL and publication regression: 15 passed, zero failures.
- Knowledge components, catalog and API regression: 374 passed, one existing skip.
- Learning regression: 245 passed. Production build and TypeScript passed locally
  and in Vercel.
- Live negative verification: unauthenticated cancellation and acknowledgement
  both rejected by the new guard before business mutation.

## Protected Candidate

- Application commit: `39a509cab9a769c1b1c611fa9decd55d0b02c454`.
- Vercel deployment: `dpl_D8AUE4FWHKbLywJYieMxjTkgv38d`.
- Protected URL: `https://mwell-intra-6ena7ruqm-normans-projects-d718ecb1.vercel.app`.
- Built in the `mwell-intra-uat` project with domain promotion skipped.
- Authenticated deployment health at `2026-09-06T14:42:42.356Z` confirmed the
  exact application commit, UAT project, reachable Supabase and static assets,
  configured real authentication, and configured delivery/service-worker features.
- Public UAT still reports `708337392364b7ab2b243e3237bf0604e1cc9db4`.
- Vercel CLI generated an automation protection token for protected validation;
  no token is included in these artifacts. Deployment protection stays enabled.

## Vendor Publication Gate

The installed lifecycle requires a content owner and distinct reviewer. The
[review packet](2026-09-06-VENDOR-PUBLICATION-DRAFT.md) is prepared locally; no
independent human approval, live draft insertion, or publication is claimed.
The user has been asked to designate these people. Public promotion is held.

## Candidate Validation Corrections

The first protected candidate was not accepted. The blocked-service-worker run
preserved 22 failed cases. A normal-service-worker diagnostic preserved seven
failed cases before stopping at a case boundary with browser contexts closed.
Task selection/change stalled even with a 30-second assertion budget. An
uncaught registration failure was separately observed when service workers were
blocked. These results are not hidden by the earlier passing route baseline.

Commit `2496eb9297cd9180dd6b2e8147b4de85d807ce5b`:

- Registers the service worker with handled rejection so browser policy cannot
  create an unhandled registration promise while online work remains available.
- Uses native history for local task selection instead of a server navigation.
  This preserves task/return-path query state using Next's supported history
  integration with `useSearchParams`.
- Two registration unit tests passed; local and Vercel production builds and
  TypeScript passed.
- New protected deployment: `dpl_Gcp2WkK7stsBy17kpCtMoC65MUC8` at
  `https://mwell-intra-k8udn3aka-normans-projects-d718ecb1.vercel.app`.
- Exact SHA and UAT health verified at `2026-09-06T14:57:26.687Z`.
- Fresh role/viewport acceptance results are recorded separately, not inferred
  from this successful build. Public promotion remains held for vendor governance.

Sources for the implementation mechanisms:
[Next native history](https://nextjs.org/docs/app/getting-started/linking-and-navigating)
and [Vercel protected-browser automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation).

## Reconnect-Safe Candidate

Independent source review identified Serwist's inherited `reloadOnOnline=true`
default. Commit `0363ae28843d474bcb0efd4802bb91f15c9b135b` disables that forced
reload while retaining service-worker registration and handling registration
failure. The regression test asserts both provider options.

- Protected deployment: `dpl_9bwgiwE7sECoDLg2qCdHrQ9Dsa6Y`.
- URL: `https://mwell-intra-534eobi9l-normans-projects-d718ecb1.vercel.app`.
- Exact SHA, UAT project, real auth, assets and backend health verified at
  `2026-09-06T15:01:36.155Z`; Vercel build and TypeScript passed.
- The intermediate `2496eb9` run completed 22/22 task journeys with 154 captures.
  It is retained, not substituted for the final candidate's own evidence.
- Final-candidate evidence directory:
  `outputs/task-first-candidate/smoke-allow-2026-09-06T15-04-39-633Z`.
- Initial final-candidate reconnect test passed: same document, input identity,
  input value and URL after offline-to-online transition. This is one synthetic
  read-only UI test, not a general offline transaction certification.

## Final Navigation Versus Readiness

- Final candidate: 22/22 navigation checks passed, with 154 screenshots. Browser
  contexts closed. These assertions originally checked task-panel presence, not
  whether its readiness projection was available.
- Independent/manual selected-screen review found unavailable readiness in four
  captures: Operations Associate and Finance Controller, each desktop/mobile.
  The other 18 selected captures did not show that warning. Do not report a
  complete onboarding or learning-readiness pass.
- Read-only UAT SQL found no `procurement.review_payment_readiness` curriculum
  capability outcome. `warehouse.inspect_quality` outcomes exist for supervisor,
  logistics supervisor and warehouse admin, but not the operator curriculum.
  The local operator role includes that capability. These publication/mapping
  gaps require governed resolution, not extra role grants or hidden alerts.
- The smoke runner now explicitly rejects an unavailable task-readiness alert
  and can collect sanitized requirement/outcome diagnostics. This stronger check
  does not retroactively change the preserved original navigation results.
- Two bounded desktop diagnostics then failed that stronger readiness gate as
  expected. Actual `resolve_assignments` responses confirmed no inspection
  outcome in the Operations Associate snapshot and no payment-readiness outcome
  in the Finance snapshot, despite passed progress and zero listed locks.
  Sanitized evidence is retained in
  `outputs/task-first-candidate/smoke-allow-2026-09-06T15-15-57-524Z` and
  `outputs/task-first-candidate/smoke-allow-2026-09-06T15-16-15-733Z`.
  All diagnostic contexts and required sessions are closed. No role, curriculum,
  certification or business records were changed to make these checks pass.
- A limited final blocked-service-worker Administrator desktop check passed 1/1
  with seven captures and no actionable error. Evidence:
  `outputs/task-first-candidate/smoke-block-2026-09-06T15-12-23-505Z`.

## Screenshot Review Scope

The separate 271-control review inventory records one independently reviewed
instruction-only control: the empty, visible Knowledge Base search field on
desktop and mobile. The other 270 controls remain blocked/unreviewed. This is
not search-behavior, transaction, full-page, new-user or human-pilot certification.
See `outputs/task-first-candidate/control-review-0363ae2.md` and its JSON record.
The mobile placeholder example is truncated; the acceptance is limited to locating
the field, not reading the complete example text.

## Remaining Acceptance

Governed vendor publication, deployment identity, fresh-user journeys, exact-step
screenshots, and human pilot results must each have their own evidence. The prior
`7083373` route baseline is not evidence for the new candidate. No transaction
completion or human approval is inferred from route-rendering results.
