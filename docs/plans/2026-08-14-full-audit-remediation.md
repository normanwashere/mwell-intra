# Full audit remediation plan

Source audit: `docs/audits/2026-08-13-CURRENT-ROLE-BY-ROLE-FULL-AUDIT.md`

## Global constraints

- Preserve all pre-existing uncommitted work.
- Add a failing regression test before each behavior change and verify red/green.
- Keep role authority server-derived and certification-aware.
- Keep private database implementations inaccessible to browser roles.
- Do not weaken segregation of duties to make demo flows walkable.
- Demo/memory and Supabase modes must expose the same state model; demo records remain visibly non-production.
- Every cross-module handoff uses a canonical record identity and an explicit owner, state, blocker, and recovery route.
- Update Knowledge Base claims and tests with the implemented behavior.

## Task 1: Database authority and security boundary

- Add a forward migration that applies `core.has_live_cap` to every current mutation boundary.
- Introduce mutation-specific capabilities where read-class capabilities currently authorize writes.
- Revoke browser execution from private Warehouse implementations.
- Scope Finance close reads correctly.
- Add governed Legal document signed-access preparation and audit evidence.
- Harden vendor application submission validation and correction transitions.
- Add source/schema verification tests for every repaired boundary.

## Task 2: Warehouse custody and floor workflow

- Unify direct and PO receiving behind certification, receipt-line, pending-inspection, and unavailable-stock custody.
- Replace legacy return disposition with quarantine-first intake and independent Quality disposition.
- Make standard receiving PO-first; isolate non-PO/overage receipt as an evidenced exception.
- Complete operator navigation and actionable task/source links.
- Preserve two-person fulfillment, count, approval, and hold-release controls.
- Add focused unit and Playwright tests for desktop/mobile workflows.

## Task 3: Learning, roles, personas, and My Work

- Publish completable role-specific practices for all 11 personas.
- Persist memory completion and distinguish wrong role from missing/expired certification.
- Align demo profiles, persona labels, departments, route access, and Knowledge role contracts.
- Make responsibility selection durable or remove misleading presentation-only switching.
- Scope My Work records and counts from effective capabilities and valid source records.
- Add role matrix, onboarding, refresh, and negative-route tests.

## Task 4: Procurement, Finance, Events, Product, and Insights

- Join seeded and live records through canonical request/PO/receipt/payment/event identifiers.
- Implement governed PO cancellation, evidence-ready submission, sourcing exception review, and Warehouse assignment.
- Make Finance close/payment/settlement flows reachable, validated, auditable, and independently approved.
- Make Event fulfillment/reconciliation walkable in memory and governed in live mode.
- Enforce Product go-live/kit approval as a downstream gate.
- Correct Insights freshness, PR-to-PO definition, drill-down context, and export handling.
- Add happy, negative, stale, and handoff tests.

## Task 5: Legal and vendor experience

- Add governed private-document open/download in Legal and vendor case views.
- Make submitted applications read-only until Legal opens a versioned correction request.
- Complete correction, resubmission, suspension, renewal, offboarding, and reinstatement state presentation.
- Align Legal invitation, reviewer, compliance, and DOA authority with named roles.
- Add vendor server-validation, cross-vendor denial, expiry, and correction tests.

## Task 6: Shared UX, accessibility, and Knowledge Base

- Fix accessible-name collisions, clipped controls, mojibake, mobile wrapping, raw identifiers, and bounded loading states.
- Make blocked states explain exact owner and recovery action.
- Update Knowledge Base from actual effective capabilities and released behavior.
- Add accurate role, workflow, exception, and troubleshooting guidance.
- Refresh deterministic visual checks for 1440x900 and 390x844.

## Task 7: Integration and release verification

- Run unit, typecheck, lint, build, schema/source verifiers, and role Playwright suites on Node 22+.
- Run all 11 personas through onboarding, happy path, negative path, stale/replay, second-actor handoff, refresh/deep-link, read-back, and cleanup.
- Apply the forward migration to the intended UAT Supabase only after local/source verification.
- Rerun live UAT read/write certification and document any external-service limitations honestly.

## Completion status

Tasks 1-6 are implemented and locally verified. Task 7's source, PGlite, production-build,
desktop, and mobile gates passed on 2026-08-14. Applying the forward migration and running
governed live UAT write/read/cleanup certification remains intentionally separate because it
requires the CI-vaulted Supabase and QA credentials; the local run did not receive them.
