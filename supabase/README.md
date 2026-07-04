# Supabase — Mwell Intra

Single M-Intra Supabase project hosting a shared `core` schema plus one
per-domain schema per module (`warehouse`, `procurement`, `legal`). See
`Documents/Mwell Intra/MWELL-INTRA-PLATFORM-SPEC.md` §3–§9 and
`mwell-intra-warehouse/docs/LLD.md` §11.

## Conventions

- **Idempotent, forward-only, timestamped** migrations (spec §6.8). Re-running a
  migration is safe: `create ... if not exists`, `create or replace function`,
  `drop policy if exists` before create, guarded `add constraint`.
- **`core` migrates first**, then domain schemas.
- Dedicated schemas (never `public`); **snake_case** columns.
- **RLS on every table.** Reads are capability-scoped; vendor-kind sessions are
  scoped to their own `vendor_id`.
- **No client-trusted writes.** Direct `INSERT/UPDATE/DELETE` is revoked from
  `authenticated`; all writes go through `SECURITY DEFINER` RPCs, each opening
  with a capability gate and appending a `core.activity_log` row where material.

## Migration order — `core` schema (Step 1e)

| # | File | Purpose |
|---|------|---------|
| 1 | `20260706090000_core_schema_identity.sql` | `core` schema + `core.profiles` (id = auth.users.id, kind, vendor_id, status) |
| 2 | `20260706090100_core_rbac.sql` | `capabilities`, `roles`, `role_capabilities`, `user_roles` (catalogue locked down) + helpers `jwt_role_claims()`, `jwt_kind()`, `has_cap(module,cap)`, `has_any_cap(cap)`, `current_vendor_id()`, `is_vendor()` |
| 3 | `20260706090200_core_vendors.sql` | `core.vendors` (accreditation lifecycle, `owner_module`) + `profiles.vendor_id` FK |
| 4 | `20260706090300_core_documents.sql` | `core.documents` (versioned/expiring; warehouse evidence registered here — ADR-002 #1) |
| 5 | `20260706090400_core_approvals.sql` | `core.approvals` (generic step/approver_role/decision/sla_due_at) |
| 6 | `20260706090500_core_activity_log.sql` | `core.activity_log` (cross-module audit + RA 10173 access log) |
| 7 | `20260706090600_core_notifications.sql` | `core.notifications` |
| 8 | `20260706090700_core_rls_policies.sql` | SELECT policies on every table + revoke direct writes |
| 9 | `20260706090800_core_rpcs.sql` | `SECURITY DEFINER` write RPCs (capability-gated) |
| 10 | `20260706090900_core_expose_postgrest.sql` | expose `core, warehouse, procurement, legal` to PostgREST |
| 11 | `20260706091000_core_seed_rbac.sql` | seed `capabilities`/`roles`/`role_capabilities` (mirror of `@intra/rbac`) |

Domain migrations (`warehouse_*`, `procurement_*`, `legal_*`) land after these in
their own steps and reference `core` IDs.

## RBAC sync contract

`core.role_capabilities` is a hand-mirror of the `@intra/rbac`
`toRoleCapabilityRows()` matrix (spec §6.6). **Change both together.** See the
header of `20260706091000_core_seed_rbac.sql` for the reconciliation checklist.
