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

## Migration order — `warehouse` schema (Step 2c)

Ports the live `mwell-intra-warehouse` schema (`docs/LLD.md` §11) into the
`warehouse` schema. **These apply after all `core` migrations** (they gate on the
`core` RBAC helpers and reference `core.vendors` / `core.documents`).

| # | File | Purpose |
|---|------|---------|
| 12 | `20260706092000_warehouse_schema.sql` | `warehouse` schema + all tables in final shape (reference data, inventory, bin-aware `stock_levels` + `stock_levels_uq` NULLS NOT DISTINCT on `(product,location,bin,lot)`, `storage_areas`, `purchase_orders`), bin→`storage_areas` FKs, location-delete orphan guard (v8), grants, RLS enabled |
| 13 | `20260706092100_warehouse_step2_deltas.sql` | **ADR-002 #1/#2 schema deltas** — `suppliers.core_vendor_id uuid` (nullable projection FK → `core.vendors`, on delete set null) + `purchase_orders.origin text not null default 'warehouse'` (`'warehouse'\|'procurement'`) |
| 14 | `20260706092200_warehouse_rls.sql` | Role-aware RLS rewired onto core RBAC: writes gate on `core.has_cap('warehouse',cap)`, capability-scoped reads (suppliers/purchase_orders/lots) on `core.has_any_cap(cap)`; v4+v6 write lockdown (stock/audit/PO/lots are RPC-only); anon locked out |
| 15 | `20260706092300_warehouse_evidence_storage.sql` | Private `evidence` Storage bucket + `storage.objects` policies (read=uploader/`view_finance`, write=capture-capable caps, delete=uploader) rewired to `core.has_any_cap` |
| 16 | `20260706092400_warehouse_rpcs.sql` | All `SECURITY DEFINER` transactional RPCs in final **v1→v8** shape, gates rewired to `core.has_cap('warehouse',…)`; `create_purchase_order` stamps `origin='warehouse'`; **evidence→`core.documents`** registration helper (ADR-002 #1) |
| 17 | `20260706092500_warehouse_demo_auth_users.sql` | **OPTIONAL / non-prod** demo role-tile accounts → `core.profiles` + `core.user_roles` (+ `core:staff`). Gated behind `mwell.seed_demo='on'`; no-op otherwise |

### Warehouse ADR-002 delta notes

- **#1 Evidence → `core.documents`.** Evidence FILES stay in the `evidence`
  bucket (no file migration). The `receive_stock`/`record_return` RPCs call the
  internal `warehouse.register_evidence_docs()` helper to register each object in
  `core.documents` (`entity_type='receipt'\|'return'`, `doc_type='evidence'`,
  `storage_path` → the object). Because `core.documents.entity_id` is `uuid` but
  warehouse ids are `text`, the entity id is a **stable synthetic uuid**
  (`md5('receipt:'||id)::uuid`), so the row is always joinable back. The helper
  runs as its definer-owner (writes `core.documents` without the warehouse caller
  needing core's `manage_documents`/`submit_documents`) and is never exposed to
  API roles.
- **#2 PO `origin`.** Every PO carries `origin` (default `'warehouse'`);
  `create_purchase_order()` stamps it server-side. Warehouse-origin is the
  internal reorder/replenishment path; `'procurement'`-origin POs arrive in
  Step 3 and feed the **same** `receive_against_po()` path.
- **`suppliers.core_vendor_id`.** A nullable, cross-schema FK to `core.vendors`
  — the sanctioned exception to the warehouse no-FK rule (§4.2), since the target
  is authoritative core master data and the link is a reference, not a copy.

### RBAC rewire (warehouse → core)

The source used a warehouse-local `warehouse.role_capabilities` + single-string
`warehouse.has_cap(cap)`. **That table/helper is NOT ported.** All gates now read
the authoritative scoped RBAC (`core.user_roles` + `core.role_capabilities` for
`auth.uid()`): write/RPC gates use `core.has_cap('warehouse',cap)`, and
capability-scoped reads use `core.has_any_cap(cap)`. Every warehouse cap gated by
these migrations is seeded in `core.role_capabilities` (module `warehouse`) by
`20260706091000_core_seed_rbac.sql` — no new caps required.

## RBAC sync contract

`core.role_capabilities` is a hand-mirror of the `@intra/rbac`
`toRoleCapabilityRows()` matrix (spec §6.6). **Change both together.** See the
header of `20260706091000_core_seed_rbac.sql` for the reconciliation checklist.

## Migration order — Step 3 (procurement + legal)

| # | File | Purpose |
|---|------|---------|
| 18 | `20260706100000_reconcile_provisional_rbac.sql` | Patch procurement/legal caps + roles to match `@intra/rbac` (idempotent for fresh installs that already got the updated seed) |
| 19 | `20260706110000_procurement_schema.sql` | `procurement` schema: `requests`, `purchase_orders` (`origin='procurement'`), `purchase_order_lines`, RLS + RPCs |
| 20 | `20260706120000_legal_schema.sql` | `legal` schema: `accreditation_cases`, `requirement_checklist_items`, vendor-scoped RLS + RPCs |

### Step 3 notes

- **RBAC reconciliation:** procurement roles are now `requester`, `procurement_officer`, `approver`, `finance`, `admin` (9 caps). Legal roles are `legal_reviewer`, `compliance`, `admin`, `vendor` (9 caps). Core external tier remains `core:vendor_portal` / `submit_documents` for shared document RPCs; legal vendor tier uses `legal:vendor` / `upload_document` for module-scoped RLS.
- **Procurement PO handoff:** procurement-origin POs use the same `origin='procurement'` contract as warehouse ADR-002 #2; warehouse receiving integration lands in Step 3d.
- **Legal accreditation:** case status mirrors `core.vendors.accreditation_status`; `approve_accreditation_case` updates the vendor master on approval.
