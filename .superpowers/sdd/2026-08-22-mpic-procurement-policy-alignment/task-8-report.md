# Task 8: Parameterized Exception Eligibility

## Delivered

- Replaced the evidence-only request-detail card with an authoritative `procurement.exception_workspace` read model. It returns the bound policy profile and limits, server blockers, recovery guidance, decision history, and only the actions that the authenticated actor may take.
- Added an operable request-detail workspace for live Supabase: Procurement submits evidence; an independent Procurement reviewer records its decision; Finance records petty-cash eligibility; and a distinct active DOA actor makes the final decision. Every command refreshes the workspace and reports recoverable errors.
- Bound exception packs to the request route version, effective policy profile, request fingerprint, evidence fingerprint, immutable snapshot, and monotonically increasing revision. Route/profile/request changes supersede a stale pack; decision commands require an expected revision and only an identical retry is idempotent.
- Enforced submitter, Procurement reviewer, Finance reviewer, and DOA segregation in the public RPC. Requester compliance JSON remains evidence only and cannot assert a review or approval.
- Reworked repeat-order eligibility so the server resolves and locks the prior request, awarded sourcing event, approved recommendation, and PO. It derives vendor, price, terms, commercial considerations, scope, and age, rejecting forged, stale, noncompetitive, cross-linked, or changed records.
- Added timestamp parsing and a 30-day retrospective-PO window for emergencies. An approved-exception route now references a real immutable approved pack through a foreign key.
- Preserved forced RLS, private-helper revocations, authenticated-only public commands, and the unapplied migration state.

## Verification

- Node 22.23.1 / pnpm 10.23.0: Procurement Vitest suite passed, 176 tests, including the new request-detail and workspace contracts; `pnpm --filter @intra/procurement typecheck` passed.
- PGlite public-RPC matrix passed through the strict Task 8 lifecycle scenarios: sole source, petty cash, emergency, approved exception, repeat order, actor collisions, forged links, temporal evidence, idempotent replay, stale scope, route confirmation, award, and PO guards.
- `node scripts/verify-mpic-procurement-policy-alignment.mjs`: passed.
- `node scripts/verify-effective-procurement-contract.mjs` and `pnpm verify:procurement-contract`: passed.

## Limits

- No live Supabase migration, deploy, or production/UAT data change was performed. Task 12 remains the mandatory live Supabase/Auth/RLS certification gate. Controlled browser coverage must be rerun against the updated RPC fixture as part of that certification.

## Fix Round 2

### Binding and lifecycle correction

- Route confirmation now locks the approved exception pack submitted for the pending route version and atomically rebinds it to the created `route_decision_id`, confirmed request version, and current request fingerprint. That approved pack remains valid for the resulting direct PO path.
- The same server binding helper still supersedes the pack after a meaningful change: route/profile change, amount/scope/vendor drift, evidence change, missing or changed source, or an invalid route-decision binding. The UI exposes `Replace stale exception evidence` whenever the authoritative workspace allows resubmission.
- Repeat-order evidence now accepts only an `issued` or `closed` source PO. Draft, pending approval, approved-but-unissued, and cancelled source POs are rejected by the public RPC matrix.

### Extended public-RPC matrix

- Node 22.14.0 / pnpm 10.23.0: `node --test --test-name-pattern="exception lifecycle matrix" scripts/verify-mpic-procurement-policy-alignment.test.mjs` passed.
- The matrix completes submit, independent approvals, route confirmation, and direct PO issuance for sole-source, petty-cash, emergency, approved-exception, and repeat-order modes. These are noncompetitive exception paths, so a direct PO is the applicable terminal procurement action rather than a sourcing award.
- It includes non-final repeat-source rejection, post-confirm scope invalidation, effective-profile change recovery, a new compliant pack under the new profile, and a successful reconfirmation/PO issue. Existing matrix coverage retains actor collisions, forged links, replay, stale data, and gate checks.

### Controlled rendered-browser evidence

- Node 22.14.0 / pnpm 10.23.0: `pnpm --filter @intra/shell exec playwright test tests/e2e/task-8-exception-workspace.spec.ts --config=playwright.controlled-rpc.config.ts` passed at 1440 x 900 and 390 x 844.
- The rendered request-detail workspace covers submitter error/retry, separate Procurement, Finance, and DOA decisions, a deliberate refresh failure and recovery, decision history, and stale-profile resubmission guidance. The test permits exactly the two intentional HTTP 400 console messages and rejects every other console error.
- Screenshots and the execution manifest are tracked in `docs/qa/task-8-exception-workspace-browser.md` and `docs/qa/evidence/`.

### Fix-round-2 verification boundary

- Migration remains unapplied. No live Supabase, UAT, production, or deployment mutation was performed.
