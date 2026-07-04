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
| 21 | `20260706130000_cross_module_wiring.sql` | **Step 3d cross-module contracts:** accreditation-gated PO award (trigger + `procurement.approve_purchase_order` RPC) and procurement→warehouse receiving handoff (`procurement.receipts` + `warehouse.receive_against_procurement_po` RPC) |
| 22 | `20260706140000_scheduled_jobs.sql` | **Phase 4 delivery** (spec §8): enables `pg_cron`; installs `core.job_flip_accreditation_status()` (flips `approved` vendors to `renewal_due` <30d / `expired` past-due and inserts `core.notifications` for vendor-tier users + `manage_accreditation` holders) and `core.job_flag_overdue_approvals()` (fanouts `approval_overdue` notifications to every user holding the pending step's `approver_role`); schedules `nightly-accreditation` @ `0 2 * * *` and `nightly-overdue-approvals` @ `15 2 * * *` (idempotent `unschedule`-then-`schedule`). Notification writes are de-duplicated against unread rows so re-runs never pile up. |

## Migration order — Step 4 hardening

| # | File | Purpose |
|---|------|---------|
| 22 | `20260706170000_warehouse_rls_tighten.sql` | Scope the general warehouse read-model (`locations, products, events, storage_areas, inventory_units, stock_levels, movements, receipts, returns, allocations, cycle_counts`) from `using(true)` to `core.has_cap('warehouse','view_dashboard') OR core.has_module_role('warehouse')`. Adds helper `core.has_module_role(module)`. Suppliers/purchase_orders/lots remain on their existing capability-scoped reads; write policies and RPC-only lockdown are untouched. |

### Step 4 notes

- **Read-scope rationale.** The base warehouse RLS opened the general read-model
  to any authenticated caller because Step 2 shipped as a single-module suite.
  Once procurement + legal ship (Step 3), the same Supabase project hosts
  procurement/legal-only staff and the external `legal:vendor` tier — none of
  whom should read warehouse inventory by default. Every warehouse role grants
  `view_dashboard`, so gating on that cap admits every warehouse user and locks
  everyone else out; the `has_module_role` fallback keeps the door open if a
  future role provisioning drops the dashboard cap.
- **What is NOT changed.** `suppliers`, `purchase_orders`, and `lots` were
  already capability-scoped by 20260706092200_warehouse_rls.sql (procurement /
  finance / pricing / receive_stock) — those policies stay as-is. The v4+v6
  write lockdown (`revoke insert/update/delete on stock/audit/PO/lots from
  authenticated`) is likewise unchanged; direct writes still route through the
  SECURITY DEFINER RPCs in 20260706092400_warehouse_rpcs.sql.

### Step 3 notes

- **RBAC reconciliation:** procurement roles are now `requester`, `procurement_officer`, `approver`, `finance`, `admin` (9 caps). Legal roles are `legal_reviewer`, `compliance`, `admin`, `vendor` (9 caps). Core external tier remains `core:vendor_portal` / `submit_documents` for shared document RPCs; legal vendor tier uses `legal:vendor` / `upload_document` for module-scoped RLS.
- **Procurement PO handoff:** procurement-origin POs use the same `origin='procurement'` contract as warehouse ADR-002 #2; the Step 3d handoff RPC wires warehouse receiving to procurement fulfillment.
- **Legal accreditation:** case status mirrors `core.vendors.accreditation_status`; `approve_accreditation_case` updates the vendor master on approval, which in turn unblocks procurement PO award via the accreditation-gate trigger.

### Phase 4 scheduled jobs (migration #22)

- **`nightly-accreditation` @ `0 2 * * *`** → `core.job_flip_accreditation_status()`.
  Emits `accreditation_expired` and `accreditation_renewal_due` notifications.
  Recipients per flipped vendor: users linked via `core.profiles.vendor_id` +
  every user holding the `manage_accreditation` cap. De-duped against unread
  rows of the same `(user_id, kind, entity_id)`.
- **`nightly-overdue-approvals` @ `15 2 * * *`** → `core.job_flag_overdue_approvals()`.
  Emits `approval_overdue` notifications for every `core.user_roles` row whose
  `role` matches the pending step's `approver_role`. Same unread-dedupe rule.
- Both are `SECURITY DEFINER` (pg_cron has no `auth.uid()`); `service_role`
  may invoke them directly for a catch-up run. `authenticated`/`anon` cannot.
- `pg_cron.job.jobname` is unique per database; the migration unschedules the
  job by name before re-scheduling, so it is safe to re-apply.

### Step 3d cross-module contracts

- **Accreditation gates award.** A `before insert or update` trigger on
  `procurement.purchase_orders` fires `procurement.assert_vendor_accredited()`
  whenever `status` transitions **into** `approved`/`issued`. The public
  `procurement.approve_purchase_order(payload)` RPC gate-checks `approve_award`
  first, asserts accreditation, then flips the status and logs to
  `core.activity_log`. Trigger is the backstop: even a service_role update to
  `status='approved'` will fail without an accredited vendor.
- **Procurement PO → warehouse receiving.** New `procurement.receipts` links a
  warehouse-side receipt id to a procurement PO/line. The new
  `warehouse.receive_against_procurement_po(payload)` RPC (gated on warehouse
  `receive_stock`) refuses to receive against a PO that isn't
  `approved`/`issued`, records the line receipt, and — when the summed received
  quantities cover the PO's line totals — advances the PO to `closed`
  (else `issued`). Warehouse-origin POs continue to use `receive_against_po()`
  unchanged.

## RLS + write-lockdown negative tests

Live in `supabase/tests/`. They exercise the *security posture* end-to-end
against a real Postgres instance: each assertion attempts a write / read the
spec forbids and fails the script if the DB allows it.

### Layout

| Path | What it proves |
|------|----------------|
| `supabase/tests/rls_negative.sql` | 4 negative assertions: (1) `authenticated` cannot INSERT into `core.vendors` directly, (2) `authenticated` cannot UPDATE `core.role_capabilities`, (3) a vendor-kind session cannot SELECT another vendor's `core.documents`, (4) `authenticated` cannot INSERT into `warehouse.inventory_units` / `warehouse.movements`. |

The script wraps everything in a single `BEGIN … ROLLBACK`, so it never
mutates the DB — test fixtures (a couple of `auth.users`, `core.profiles`,
`core.vendors`, `core.documents` rows) are discarded on exit.

### How to run

Bring up a local Supabase stack (this applies every migration under
`supabase/migrations/` including the RBAC seed and the RLS lockdown):

```bash
supabase start   # or `supabase db reset` to reapply migrations from scratch
```

Then run the negative-test script against the local Postgres. The port and
default password come from `supabase start`'s output; the values below are
the standard local defaults.

```bash
psql "postgres://postgres:postgres@127.0.0.1:54322/postgres" \
     -v ON_ERROR_STOP=1 -f supabase/tests/rls_negative.sql
```

`ON_ERROR_STOP=1` makes `psql` exit non-zero on the first `raise exception`,
so the script is CI-friendly. On success you'll see one `PASS[…]` NOTICE per
assertion followed by:

```
NOTICE:  ===============================================================
NOTICE:    RLS negative test suite: ALL ASSERTIONS PASSED (4/4).
NOTICE:  ===============================================================
```

Any `FAIL[…]` line means the DB granted a write/read the spec forbids —
treat it as a **security regression** and fix the failing migration before
merging (do not weaken the assertion).

### Assertion reference (what each test proves)

1. **`authenticated` cannot INSERT into `core.vendors`.** All vendor writes go
   through `core.upsert_vendor()` (SECURITY DEFINER, capability-gated on
   `manage_vendors`). Direct table `INSERT/UPDATE/DELETE` was revoked from
   `authenticated` in `20260706090700_core_rls_policies.sql`.
2. **`authenticated` cannot UPDATE `core.role_capabilities`.** The RBAC
   catalogue is fully locked down: RLS on, no policies, no API-role grants
   (see `20260706090100_core_rbac.sql`). Only the SECURITY DEFINER helpers
   `core.has_cap()` / `core.has_any_cap()` may read it.
3. **Cross-vendor document reads are blocked.** The vendor-tier RLS branch on
   `core.documents` is scoped to `entity_type = 'vendor' AND entity_id =
   core.current_vendor_id()`. A vendor A session cannot see any document
   filed under vendor B.
4. **Direct writes to `warehouse.inventory_units` and `warehouse.movements`
   are refused.** The v4 + v6 hardening in
   `20260706092200_warehouse_rls.sql` revokes `INSERT/UPDATE/DELETE` from
   `authenticated` on every stock/audit/PO/lots table; all mutations flow
   through the definer RPCs in `20260706092400_warehouse_rpcs.sql`.
