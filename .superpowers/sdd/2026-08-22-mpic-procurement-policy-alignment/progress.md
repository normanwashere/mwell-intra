# SDD ledger — plan: docs/superpowers/plans/2026-08-22-mpic-procurement-policy-alignment.md

Spec: `docs/superpowers/specs/2026-08-22-standalone-handbook-tabbed-experience-design.md` reachable at preflight.
Branch/worktree: `codex/uat-launch-blockers` at `C:/Users/NormanArisDeocareza/Projects/mwell-intra-onboarding`.
Start commit: to be recorded when Procurement Task 1 begins after Handbook Task 7.

## Preflight

| Tasks | Shared file/interface | Producer/consumer relationship | Finding |
|---|---|---|---|
| Task 1 | self | profile tests precede types/profile implementation | clean |
| Task 2 | self | route tests precede derivation implementation | clean |
| Task 3 | self | SQL verifier precedes schema implementation | clean |
| Task 4 | self | mapping tests precede server/backfill changes | clean |
| Task 5 | self | route UI contract precedes UI replacement | clean |
| Task 6 | self | bid-readiness tests precede sourcing changes | clean |
| Task 7 | self | best-value tests precede evaluation changes | clean |
| Task 8 | self | exception matrix precedes eligibility implementation | clean |
| Task 9 | self | commitment tests precede PO monitoring changes | clean |
| Task 10 | self | vendor/payment tests precede lifecycle changes | clean |
| Task 11 | self | documentation assertions precede source updates | clean |
| Task 12 | self | live guard tests precede certification | clean |
| Tasks 1/2 | `index.ts` | Task 2 exports Task 1 profile interfaces | ordered; clean |
| Tasks 1/6 | `types.ts` | Task 6 consumes route/profile types | ordered; clean |
| Tasks 1/7 | `types.ts` | Task 7 consumes profile/evaluation types | ordered; clean |
| Tasks 1/10 | `types.ts` | Task 10 consumes profile/vendor types | ordered; clean |
| Tasks 2/8 | `policy.ts` | Task 8 extends route policy | ordered; clean |
| Tasks 2/9 | `policy.ts`, `policy.test.ts` | Task 9 extends route-aware readiness | ordered; clean |
| Tasks 3/4 | migration and verifier | Task 4 extends additive schema | ordered; clean |
| Tasks 3/6 | migration | Task 6 adds sourcing controls | ordered; clean |
| Tasks 3/7 | migration | Task 7 adds evaluation controls | ordered; clean |
| Tasks 3/8 | migration | Task 8 adds exception controls | ordered; clean |
| Tasks 3/9 | migration | Task 9 adds PO controls | ordered; clean |
| Tasks 3/10 | migration | Task 10 adds vendor/payment controls | ordered; clean |
| Tasks 4/6 | migration | sourcing uses backfilled route axes | ordered; clean |
| Tasks 4/7 | migration | evaluation uses governed routes | ordered; clean |
| Tasks 4/8 | migration | exceptions use governed routes | ordered; clean |
| Tasks 4/9 | migration | PO readiness uses governed routes | ordered; clean |
| Tasks 4/10 | migration | eligibility uses governed profile binding | ordered; clean |
| Tasks 5/7 | `RequestDetailPage.tsx` | evaluation composes with route UI | ordered; clean |
| Tasks 5/8 | request pages | exception UI composes with route UI | ordered; clean |
| Tasks 6/7 | sourcing workspace, migration, types | evaluation follows sourcing event state | ordered; clean |
| Tasks 6/8 | migration | exceptions consume sourcing state | ordered; clean |
| Tasks 6/9 | migration | PO readiness consumes sourcing completion | ordered; clean |
| Tasks 6/10 | migration, types | vendor eligibility gates invitations | ordered; clean |
| Tasks 7/8 | request detail, migration | variance and exceptions remain separate | ordered; clean |
| Tasks 7/9 | migration | PO readiness consumes award evidence | ordered; clean |
| Tasks 7/10 | types, migration | payment consumes evaluation evidence | ordered; clean |
| Tasks 8/9 | policy, migration | PO readiness consumes exception approval | ordered; clean |
| Tasks 8/10 | migration | vendor/payment gates consume exception modes | ordered; clean |
| Tasks 9/10 | PO detail, migration | payment consumes receipt/quality closure | ordered; clean |

Cross-plan order: begin after Handbook Task 7; complete Tasks 1–10, then Task 11, then Handbook Task 8, then Task 12.

Task 1: fix round 1/5 (2 important and 2 minor findings addressed; commits abc960e..7d1900c; source governance, numeric invariants, and selection boundaries strengthened)
Task 1: complete (commits 2781440..7d1900c; scoped re-review approved; 121 procurement tests and typecheck passed)
Task 1: release note: repeat verification with the repository-declared Node 22 and pnpm 10 toolchain.
Task 2: Ruling: migrating CreateRequestPage, RequestDetailPage, request drafts, and store write paths from deprecated category inference is explicitly planned for Task 5, while Task 2 requires compatibility wrappers to remain until callers migrate; Task 2 will harden the route engine and legacy reads without pulling forward the request UX migration — cost if wrong: new request writes continue using category inference through Tasks 3–4 and must be treated as transitional until Task 5 completes.
Task 2: fix round 1/5 (1 important and 1 minor implementation finding addressed; commits 28372d7..1fd3211; lossless legacy round trips and trigger-specific reasons)
Task 2: complete (commits 7d1900c..1fd3211; scoped re-review approved under recorded Task 5 caller-migration ruling; 147 procurement tests and typecheck passed)
Task 2: release note: repeat verification with the repository-declared Node 22 and pnpm 10 toolchain.
Task 3: Ruling: Supabase-compatible behavioral authorization execution is deferred to Task 12's UAT migration/certification gate because Task 3 is explicitly an unapplied migration plus static verifier and PGlite cannot model Supabase role/RLS semantics; Task 3 must still harden the SQL and verifier and label PGlite as parse smoke only — cost if wrong: a role-specific authorization defect could remain undiscovered until the UAT apply gate, where deployment must stop rather than proceed.
Task 3: carryover: the pre-existing effective procurement.submit_request delegation contract remains red and must be resolved in Task 4 or Task 5 before end-to-end route certification.
Task 3: fix round 1/5 (5 important security/schema findings addressed; commits 39ac2f8..aafacac; lineage, maker-checker, numeric invariants, least privilege, and verifier hardened)
Task 3: complete (commits 1fd3211..aafacac; scoped security re-review approved under Task 12 behavioral-auth ruling; migration remains unapplied)
Task 4: Ruling: RequestDetailPage's minimal expected_route_version/requested_mode payload migration remains in explicit Task 5 Step 5; Task 4 must add a server payload contract test and remain non-deployable/unapplied until Task 5 lands in the same release — cost if wrong: applying Task 4 alone would break live route confirmation, so Task 12 must verify both commits as one UAT release.
Task 4: fix round 1/5 (2 backfill implementation findings addressed; commits f424623..6845a83; risk preservation and unsupported-method remediation)
Task 4: fix round 2/5 (2 executable-coverage findings addressed; commits 6845a83..82eea40; persisted backfill and public confirmation RPC contracts)
Task 4: complete (commits aafacac..82eea40; second scoped re-review approved; 151 procurement tests, 6 migration contracts, schema and submit verifiers passed)
Task 4: release dependency: migration remains unapplied/non-deployable until Task 5 caller payload migration lands and Task 12 certifies the combined release.
Task 5: fix round 1/5 (4 important and 2 minor findings addressed; commits d162790..76969a4; route read model, solicitation briefs, policy hydration, and exception semantics)
Task 5: fix round 2/5 (4 remaining persistence/UI/browser findings addressed; commits 76969a4..70b62c6; governed create brief, confirmed profile summary, parent selector, locators)
Task 5: fix round 3/5 (4 evidence blockers addressed; commits 2f3cf49..ca9591e; public create/finalize contracts, policy lifecycle, non-default refresh, Node22 browser evidence)
Task 5: fix round 4/5 (2 final certification blockers addressed; commits ca9591e..90dde8b; draft rollback and controlled-RPC desktop/mobile lifecycle)
Task 5: complete (commits 82eea40..90dde8b; fourth scoped re-review approved; Node 22.17/pnpm 10.23: 156 procurement, 388 shell, 9 PGlite, controlled browser 2/2, regression browser 9+1 skip)
Task 5: release dependency closed for client payload; migration remains unapplied pending Task 12 live Supabase/RLS certification.
Task 6: Ruling: complete-chain local Supabase application/browser certification is deferred to Task 12 because this workstation has neither Docker Desktop nor Supabase CLI; Task 6 must still execute migration RPC contracts and client/governed-browser contracts, while Task 12 must stop deployment if real roles/RLS/grants differ — cost if wrong: a full-chain migration-order or Supabase-specific RLS defect may remain until the UAT apply gate.
Task 6: fix round 1/5 (4 important findings addressed; commits 83478c4..f9abb10; invitation evidence, requote, cumulative cap, governed DB harness)
Task 6: fix round 2/5 (3 code/security findings addressed; commits f9abb10..b5865e5; package-bound acknowledgements, legacy deadline backfill, service-role revocation)
Task 6: complete (commits 90dde8b..b5865e5; scoped re-review approved under Task 12 full-chain Supabase ruling; 158 procurement tests, 11 migration contracts, desktop/mobile governed-browser checks)
Task 7: fix round 1/5 (5 P1 and 2 P2 findings addressed; commits 3bfc4b7..974a8b8; closure, evidence freshness, segregation, complete evaluation, audit UI)
Task 7: fix round 2/5 (reviewer deep-link admission addressed; commits 974a8b8..da49bbd; request-scoped reviewer view)
Task 7: fix round 3/5 (fail-closed evidence authorization and production-equivalent Finance capability addressed; commits da49bbd..60ab469)
Task 7: fix round 4/5 (direct sourcing RPC reviewer leak addressed; commits 60ab469..2dae8d0)
Task 7: complete (commits b5865e5..2dae8d0; final scoped re-review approved; 164 procurement tests, 14 PGlite contracts, desktop/mobile controlled variance journey)
Task 8: complete (commits 2dae8d0..214155f; parameterized sole-source, repeat-order, emergency, petty-cash, and approved-exception eligibility; persisted independent Procurement/Finance/DOA controls; Node 22.23.1/pnpm 10.23.0: 174 procurement tests and typecheck, 14 PGlite migration contracts, schema/MPIC/effective-contract verifiers passed; migration remains unapplied and Task 12 owns live Supabase/Auth/RLS certification)
Task 8: verification follow-up (public exception RPC negative/positive contract added; self-review denial, independent Procurement review, active DOA completion, and governed confirmation covered; 15 PGlite contracts passed)
Task 8: strict review remediation complete in commit 2273b93 (authoritative request-detail workspace, immutable server bindings, independently separated Procurement/Finance/DOA stages, linked-repeat resolver, temporal/source evidence guards, and public PGlite lifecycle matrix added; migration remains unapplied and controlled-browser UAT certification remains pending)
Task 8: fix round 2/5 (route-confirmation self-invalidation, final repeat-order PO state, stale-profile recovery, all-mode post-confirm lifecycle coverage, and controlled desktop/mobile workspace evidence addressed in commit c9624fd)
Task 8: fix round 3/5 (private security-definer helper execute revocation and actionable desktop/mobile stale-pack replacement submission addressed in commit a9b8c1e)
Task 8: complete (commits 2dae8d0..a9b8c1e; third scoped re-review approved; Node 22/pnpm 10: 176 procurement tests, 17 PGlite contracts, workspace typecheck, static/effective-contract verifiers, and controlled desktop/mobile Playwright 2/2 passed; migration remains unapplied and Task 12 owns live Supabase/Auth/RLS certification)
Task 9: implemented pending scoped review (route-aware PO package readiness; additive PO lifecycle/event SQL with expected-revision/idempotent public commands; 48-hour acknowledgement, monitoring, quality/payment-hold, and closure projection; focused component/policy/detail tests, typecheck, static verifier, and PGlite parse smoke passed; migration remains unapplied. Controlled desktop/mobile PO browser evidence is blocked by the mandatory onboarding redirect and the local runtime resolved Node 20/pnpm 9 instead of the declared Node 22/pnpm 10.)
Task 9: fix round 3/5 (fully paid non-live release preserves `issued` pending the governed independent closure path; controlled browser child PATH is Node 22-first and runner/Next build/start fail closed off Node 22; current mobile quality-recovery evidence reviewed and retained). Ruling: remote shared-target migration status is deferred to Task 12 because this workspace is intentionally unlinked and Task 9 forbids applying the migration. Task 12 must obtain a read-only linked migration-status artifact for the intended target and stop if this migration is unexpectedly applied or migration history has drifted; the migration remains unapplied locally.
Task 9: complete (commits a9b8c1e..4ad1802; third scoped re-review approved under the recorded Task 12 migration-status ruling; Node 22/pnpm 10: 179 procurement tests, Procurement and Shell typechecks, 19 PGlite contracts with real role sessions, static verifier, and controlled desktop/mobile Playwright 2/2 passed; vendor acknowledgment is reachable in Vendor Portal and all PO closure paths require governed independent approval)
Task 10: fix rounds 1-5/5 addressed public payment authority, core expiry and temporary-clearance recovery, stale payment evidence, successful invitation/issue persistence, authenticated Legal/Procurement/Operations/Finance/approver browser handoffs, terminal closure refresh, terminal commitment wording, and accepted QC presentation (commits 4017f32..0bf88e3; Node 22/pnpm 10: 187 Procurement tests, Shell typecheck, Task 10 PGlite matrix, MPIC verifier, and controlled desktop/mobile Playwright 2/2 passed; migration remains unapplied).
Task 10: Ruling: after the five-round breaker, the remaining P2 is parked as a non-load-bearing controlled-evidence limitation because production already maps the authoritative `purchase_order_receipt_status.qc_status` field, while only the controlled fixture returns the compatibility alias `latest_qc_status`; Task 12 must prove the real linked UAT RPC returns `qc_status=accepted` and that the authenticated PO page renders `QC: accepted`, and UAT must stop if either contract differs — cost if wrong: the controlled evidence overstates production fidelity and a live QC projection defect will surface only at the Task 12 stop gate.
Task 10: complete under the recorded Task 12 QC-contract and migration-status rulings (commits 4ad1802..0bf88e3; no P0/P1 findings remain, terminal desktop/mobile UI is internally consistent, and the only parked P2 is fixture-contract fidelity rather than production behavior).
Task 6: complete (commit 83478c4; Node 22.17/pnpm 10.23: 158 procurement tests, 10 PGlite/static migration contracts, MPIC/schema/submission verifiers, and controlled-RPC desktop/mobile lifecycle passed; migration remains unapplied and Task 12 owns live Supabase/RLS certification).
Task 6: review fix wave complete (commit f9abb10; governed invitation/acknowledgement evidence, source-additional-and-requote, cumulative extension cap, and disposable PGlite desktop/mobile browser evidence added; migration remains unapplied and Task 12 remains the live Supabase/RLS gate).
Task 6: re-review fix wave 2 complete (commit b5865e5; immutable current communication/package acknowledgements, legacy original-deadline backfill/non-null enforcement, direct service-role sourcing/audit DML revocation, and role-capable PGlite denial coverage added; Node 22.17/pnpm 10.23 verification passed. Docker and Supabase CLI are unavailable locally, so complete full-chain local Supabase/Auth/RLS certification remains an explicit Task 12 blocker; no remote apply performed).
Task 2: complete (commit 28372d7; three-axis routing, deterministic legacy mapping, and compatibility projections verified by 133 procurement tests and typecheck)
Task 2: release note: repeat verification with the repository-declared Node 22 and pnpm 10 toolchain.
Task 2: fix round 1/5 (review findings addressed; commits 28372d7..1fd3211; all legacy methods round-trip and each high-risk trigger is retained as an explainable reason)
Task 2: complete (scoped review blockers fixed; 147 procurement tests and typecheck passed)
Task 3: complete (commit 39ac2f8; additive effective-dated policy schema, forced RLS, maker-checker RPCs, static verifier, and isolated PGlite migration load passed)
Task 3: release note: repeat verification with the repository-declared Node 22 and pnpm 10 toolchain; the unavailable local Supabase lint was covered by a no-live-PGlite schema load.
Task 3: external pre-existing failure: `pnpm verify:procurement-contract` remains red in `20260816223000_deduplicate_procurement_intake_collaborators.sql` because its effective `procurement.submit_request` does not delegate through the governed private implementation; Task 3 did not touch that function.
Task 3: security fix round 1/5 (review blockers addressed in focused migration/verifier/test changes; relationship-aware lineage, exact control mappings, latest-modifier maker-checker, sealed-bid ceiling, service-role revocation, and negative static contracts added; Supabase-compatible behavioral certification remains Task 12).
Task 4: complete (commit aafacac..f424623; server-authoritative three-axis route derivation, version-guarded confirmation, deterministic legacy mapping/remediation queue, compatibility mapper/seeds, and effective governed submission delegation verified by 151 procurement tests, typecheck, policy verifiers, PGlite parse smoke, and procurement contract verifier)
Task 4: release note: repeat verification with the repository-declared Node 22 and pnpm 10 toolchain; migration remains unapplied pending Task 12 UAT certification.
Task 4: fix round 1/5 (review blockers addressed; normalized persisted risk facts now drive both live and legacy high-risk routing, unsupported legacy methods are quarantined, and executable PGlite route/backfill/confirmation contracts cover risk variants, allowlisted methods, idempotence, version guards, ignored client authority, and exception evidence)
Task 4: release gate: non-deployable until Task 5 moves the RequestDetailPage confirmation payload to expected_route_version plus requested_mode; Task 12 must apply both as one UAT release.
Task 4: fix round 2/5 (re-review execution gaps addressed; isolated PGlite backfill runs against seeded persisted requests/decisions, and public confirm_route_decision RPC execution proves server authority, version guards, exception evidence, and amount limits)
Task 4: release gate reaffirmed: migration remains unapplied and non-deployable until Task 5 moves the RequestDetailPage confirmation caller to expected_route_version plus requested_mode in the same release; Task 12 applies/certifies that combined UAT release.
Task 5: complete (commit d162790; explicit requirement classification is required for all new request writes, client route axes are preview/draft data only, confirmation sends request_id plus expected_route_version/requested_mode and renders server recomputation, and policy profile administration is separated from DOA with maker-checker/conflict/history controls).
Task 5: closed Task 2 caller-migration ruling and Task 4 route-confirmation payload ruling. Migration remains unapplied; Task 12 must apply and certify Tasks 3-5 as one UAT release.
Task 5: verification passed: 154 Procurement tests, 388 Shell tests, Procurement and Shell typechecks, MPIC verifier, policy schema verifier, procurement contract verifier, seven PGlite/static migration contracts, and responsive desktop/mobile Playwright route coverage.
Task 5: release note: verification ran under local Node 20.18.1 and pnpm 9.15.9 while the repository requires Node 22 and pnpm 10; repeat the full suite using the declared toolchain before UAT certification.
Task 5: strict review fix wave complete (commit 76969a4; confirmed route projection is atomically readable after refresh, structured RFQ/RFP briefs and evidence gates added, policy profile view hydrates governed state, exception attestation is not Finance approval, and browser fixture aligns with canonical roles). Migration remains unapplied; Task 12 is still the live RLS/UAT gate.
Task 11A: Ruling: the user-supplied `mWell Procurement Policy and Procedures - Revised Modern Visual - Word Updated.docx` (SHA-256 `51F4E381CF7DEC6A1950867C4839750078DB08D603A5DE8AA54B63D12F6D1239`) is the canonical Mwell procurement requirements source; MPIC is demoted to an incorporated/reference source and may supply a control only when the canonical policy explicitly incorporates it and does not override it. The source document's own updated-visual-draft status must remain visible, so no policy-profile activation, approved-DOA claim, or live-governance claim is permitted until the accountable owners approve and activate the corresponding profile and DOA. Cost if wrong: the application could route requests, enforce thresholds, or train users from a superseded parent-policy interpretation, producing unauthorized procurement decisions and an invalid release certification.
Task 11A: canonical alignment implementation complete at local baseline (amount/risk RFQ-RFP derivation in TypeScript and SQL, importation exclusion, exact source identity, separate document/profile status, fail-closed activation, calendar-day extension contract, request-bound inherited-control provenance, draft-vs-approval submission readiness, canonical 13-step maintained guidance, in-app Knowledge wording, and regenerated 26-source standalone handbook). Verification: 192 Procurement tests, 69 Knowledge graph tests, Procurement/Shell typechecks, 21 handbook contracts, 21 disposable PostgreSQL contracts, static migration verifier, generated-handbook freshness, and `git diff --check` passed. Migration remains unapplied.
Task 11A: remaining production gates are explicit P1 work, not hidden completion claims: versioned canonical planning-SLA controls/start conditions; complete supply/delivery, development-warranty, third-party-liability, and contractor-equipment financial-protection applicability/evidence gates; Procurement approval of the draft source; authorized neutral variance-stage mapping; and Task 12 controlled Supabase/RLS/UAT certification.
