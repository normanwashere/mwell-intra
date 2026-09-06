# Task-First Live Release Gates

Date: 2026-09-06

## Release Decision

**Undeployed candidate: BLOCKED pending authority guards and reviewed vendor publication.**

The parent reports live UAT health at commit `7083373`, targeting project
`kkoitlvydytdhlpxhuah`. The dirty task-first candidate is not deployed. The parent
is conducting a read-only all-role desktop/mobile live baseline and reports the
admin login passing. Those results describe the deployed baseline, not candidate
certification or fresh-user completion. This review did not independently repeat
the browser baseline or health check.

This review used read-only UAT SQL. No migration, publication, account reset,
business mutation, or deployment was performed. Optional experience telemetry is
excluded from this release gate and must remain disabled; its migration must not
be swept into a bulk migration application.

## Verified Authority State

The UAT migration ledger has no version `20260906043800`. Neither installed RPC
contains the candidate's authorization exception marker. Both exact source
anchors below match the installed `pg_get_functiondef` output.

Candidate: `supabase/migrations/20260906043800_gate_legacy_po_cancel_and_vendor_acknowledgement.sql`.

### Warehouse Cancellation

RPC: `warehouse.cancel_purchase_order(jsonb)`

Exact matched anchor (including two leading spaces):

```sql
  if not core.has_cap('warehouse','view_procurement') then
```

Verified installed properties:

- Owner: `postgres`.
- ACL: `{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}`.
- `prosecdef`: `true` (SECURITY DEFINER).
- `proconfig` entry: `search_path=warehouse, public`.
- Candidate marker `certified Procurement PO cancellation`: absent.

The candidate adds a non-null authenticated identity and both existing live
capabilities `procurement.cancel_purchase_order` and `procurement.author_po`.
Cancellation has no standalone learning pathway; `author_po` supplies the
existing certification gate. The original `warehouse.view_procurement` check
and business body remain in place. This does not introduce new role grants or
claim new department scoping for the legacy RPC.

### Vendor Acknowledgement

RPC: `procurement.acknowledge_purchase_order(jsonb)`

Exact matched anchor (including two leading spaces):

```sql
  if auth.uid() is null or nullif(payload->>'expected_revision','') is null then
```

Verified installed properties:

- Owner: `postgres`.
- ACL: `{postgres=X/postgres,authenticated=X/postgres}`.
- `prosecdef`: `true` (SECURITY DEFINER).
- `proconfig` entry: `search_path=""`.
- Candidate marker `certified Vendor acknowledgement`: absent.

The candidate adds a non-null authenticated identity and existing live capability
`core.submit_accreditation`, using its existing vendor certification pathway.
Original vendor/profile/invitation, PO ownership, document hash, and revision
checks must remain intact. Learning review is not a legal declaration or PO
acknowledgement.

The migration preserves function definitions outside its anchored guard insertion
and introduces no grants. Its anchors fail closed on unexpected source drift;
reapplication recognizes the inserted guard. Prior local actual-SQL regression
coverage checks denial/valid certification, original business checks, unchanged
ACL/owner/security properties, and idempotent reapplication. Tests were not rerun
during this read-only release review.

## Verified Vendor Publication State

The read-only query of `learning.requirements` joined to
`learning.requirement_versions` returned exactly these vendor requirements:

| Requirement key | Kind | Requirement status | Version/status | Simulation ID |
| --- | --- | --- | --- | --- |
| `vendor.role.core.vendor_portal.capability-practice.v1` | scenario | active | 1 / published | `vendor-accreditation-submission-v1` |
| `vendor.vendor_representative.orientation.v1` | orientation | active | 1 / published | `vendor.vendor_representative.orientation.v1` |

`vendor.vendor_representative.evidence-and-acknowledgments.v1` is absent, including
as a draft. The candidate catalog in `modules/learning/src/catalog.ts` expects
that requirement with simulation `vendor-evidence-review-v1`. Consequently this
is not a metadata-only patch to an existing published requirement.

Publication requires human governance review of the requirement and its
curriculum linkage, mandatory status, prerequisites, audience, version, and
learning content. Preserve the `attestation` kind and separation from actual
legal declarations, submissions, approvals, and acknowledgements. Use the
governed draft/review/publication lifecycle; do not edit immutable published
content, fabricate approval evidence, or reset shared certifications. No
publication migration or human approval is represented as completed here.

The local `scripts/verify-vendor-evidence-publication.test.mjs` exercises the
actual publication guard against published metadata/kind changes and direct
published insertion. It does not substitute for human review or prove a complete
live curriculum publication.

## Required Promotion Sequence

1. Freeze the reviewed candidate SHA and rerun the relevant local regressions:
   `node --test scripts/verify-learning-authority-lifecycle.test.mjs` and
   `node --test scripts/verify-vendor-evidence-publication.test.mjs scripts/verify-shared-role-orientations.test.mjs scripts/verify-launch-authority-learning.test.mjs`.
2. Obtain approval for the targeted authority migration, apply only that approved
   migration to UAT, and verify installed guards and unchanged ACLs, owner, and
   security properties. Do not bulk-apply pending migrations.
3. Obtain and execute governed human-reviewed vendor requirement and curriculum
   publication. Verify the exact published identity and simulation linkage.
4. Promote the exact reviewed app SHA and verify health identifies that SHA and
   UAT project `kkoitlvydytdhlpxhuah` before candidate certification.
5. Complete screenshot certification for every audited allowed and denied route
   across desktop and mobile. Surface capture failures. Existing baseline
   screenshots cannot certify an undeployed candidate.
6. Separately authorize isolated fresh-user completion and a real-user pilot.
   Record actual completion evidence and outcomes without resetting shared users
   or equating existing/shared completion credit with a fresh attempt.

Navigation continues to use effective capabilities: removing a broad onboarding
shell gate does not grant access to every role-assigned page. In particular,
`manage_rbac` must not be inferred from raw role capabilities for exploration.
These targeted RPC guards are prerequisites, not a whole-system security
certification. No optional telemetry enablement is required for these steps.
