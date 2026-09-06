# Task-First UAT Promotion

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

## Remaining Acceptance

Governed vendor publication, deployment identity, fresh-user journeys, exact-step
screenshots, and human pilot results must each have their own evidence. The prior
`7083373` route baseline is not evidence for the new candidate. No transaction
completion or human approval is inferred from route-rendering results.
