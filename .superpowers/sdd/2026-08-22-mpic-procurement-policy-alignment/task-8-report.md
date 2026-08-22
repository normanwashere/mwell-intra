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
