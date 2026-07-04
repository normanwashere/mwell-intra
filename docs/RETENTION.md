# Mwell Intra — Data Retention & Privacy Policy (RA 10173)

This document defines the retention periods, deletion/anonymisation procedures,
and Data Subject Access Request (DSAR) workflow for the Mwell Intra platform.
It aligns with **Republic Act No. 10173** (Data Privacy Act of 2012) and the
National Privacy Commission's implementing rules on data minimisation, storage
limitation, and data-subject rights.

The eventual enforcement mechanism is the scheduled job
`core.job_purge_expired` (stub — to be implemented in Phase 4, spec §8). Until
that job ships, the periods below are the **audit-time SLA** we hold
ourselves to; ad-hoc purge scripts run against Supabase with `service_role`.

Every access to personal / commercial data is recorded in `core.activity_log`
(migration `20260706090500_core_activity_log.sql`) — that table is the
RA 10173 access audit trail.

---

## 1. Retention periods by data class

Retention starts from the last modification of the record OR the end of the
active business relationship, whichever is later. "Anonymise" means the row
is preserved (referential integrity is retained) but PII columns are cleared.
"Delete" means the row is removed and cascades apply.

| # | Data class | Table(s) | Period | End-of-life action | Legal basis |
|---|---|---|---|---|---|
| 1 | Identity profiles (employees + vendor contacts) | `core.profiles` | **7 years** after account disabled | Anonymise (email, full_name, title → null; `status='disabled'`) | RA 10173 §11(e); Labor Code recordkeeping |
| 2 | Cross-module activity / access log | `core.activity_log` | **5 years** rolling | Delete (partition by month; drop oldest) | RA 10173 §16(f) reasonable proof; audit posture |
| 3 | Vendor / commercial documents | `core.documents` | **10 years** after `expires_at` (or upload if no expiry) | Delete row + `storage.objects` blob | BIR / SEC / SRA recordkeeping norms; contract disputes |
| 4 | User-facing notifications | `core.notifications` | **90 days** after `read_at`; unread rows kept until read or 1 year (whichever is first) | Delete | Transient operational data; minimisation |
| 5 | Vendor master (accreditation lifecycle) | `core.vendors` | **10 years** after last transaction or accreditation expiry | Anonymise contact fields; retain `id` + audit shell | Same as #3 (linked commercial history) |
| 6 | Approvals ledger | `core.approvals` | Follows the parent entity's retention (e.g. PO approvals live 10 yr with the PO) | Deleted with parent | Cascades; approvals are audit evidence |
| 7 | Warehouse inventory ledger (movements, receipts, returns, cycle counts, purchase orders, allocations) | `warehouse.*` | **10 years** from `created_at` | Delete | Tax / audit; RA 10173 does not require earlier purge |
| 8 | Procurement records (requests, purchase_orders, purchase_order_lines, receipts) | `procurement.*` | **10 years** from `updated_at` | Delete | Same as #7 |
| 9 | Legal accreditation cases + checklist items | `legal.*` | **10 years** after case closure | Delete | RA 9184 procurement policy compatibility |
| 10 | Supabase Auth users (`auth.users`) with no linked profile | `auth.users` | **30 days** after profile deletion | Delete (cascades from `core.profiles`) | Storage limitation |
| 11 | Storage objects — evidence (warehouse) | `storage.objects` (`evidence` bucket) | Follows parent receipt/return (#7) | Delete blob when doc row is purged | Storage limitation |
| 12 | Storage objects — documents (procurement/legal) | `storage.objects` (`documents` bucket) | Follows `core.documents` (#3) | Delete blob when doc row is purged | Storage limitation |

**"Warehouse profiles" note.** `warehouse.profiles` is a legacy demo-tier
projection (see `20260706092000_warehouse_schema.sql` header) — it holds NO
authoritative PII (identity lives in `core.profiles`). It follows the profile
retention in row #1.

---

## 2. Delete / anonymise procedures

### 2.1 Anonymisation (default for identity)

Preserve the row (foreign-key targets in `core.activity_log`, `core.documents`,
`warehouse.movements`, etc. depend on it) and clear PII columns:

```sql
-- Employee / vendor contact profile
update core.profiles
   set email     = 'anonymised+' || id || '@intra.mwell.local',
       full_name = null,
       title     = null,
       status    = 'disabled'
 where id = :subject_id;

-- Vendor master (retain id + accreditation shell)
update core.vendors
   set contact_email = null,
       contact_name  = null,
       -- retain trade_name for audit history; drop only direct-contact fields
       updated_at    = now()
 where id = :vendor_id;

insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
values ('core','profile', :subject_id, 'anonymised', auth.uid(),
        jsonb_build_object('reason', :reason));
```

### 2.2 Hard delete (default for operational logs and old commercial data)

Rely on FK cascades from `core.profiles` (auth → profile → module-linked rows)
where the retention window has elapsed. The purge job template:

```sql
-- Illustrative: purge activity_log older than 5 years (data class #2)
delete from core.activity_log
 where created_at < now() - interval '5 years';

-- Illustrative: purge notifications older than 90 days after being read
delete from core.notifications
 where read_at is not null
   and read_at < now() - interval '90 days';

-- Illustrative: purge unread notifications older than 1 year
delete from core.notifications
 where read_at is null
   and created_at < now() - interval '1 year';
```

Storage blobs deleted via the Supabase Storage API in the same transaction
window as the parent row (`core.documents.storage_path` → `evidence` /
`documents` bucket).

### 2.3 Enforcement — `core.job_purge_expired` (stub)

Phase 4 introduces a `pg_cron` job that wraps rows #2, #4, #7–#12 above:

```sql
-- STUB — to be implemented in Phase 4 (spec §8).
create or replace function core.job_purge_expired()
returns void language plpgsql security definer set search_path = core, public as $$
begin
  -- 1. Activity log (5y)
  -- 2. Notifications (90d read / 1y unread)
  -- 3. Warehouse ledger (10y)
  -- 4. Procurement records (10y)
  -- 5. Legal cases (10y after closure)
  -- 6. Documents past expires_at + 10y (also unlink storage blobs)
  raise notice 'job_purge_expired is a stub — no rows purged';
end; $$;
```

The job runs nightly under `service_role`, emits an
`entity_type='retention_job'` row to `core.activity_log` with row counts per
class, and alerts on any purge failure. Identity anonymisation (row #1, #5) is
NOT auto-purged — it is a human-reviewed workflow triggered by HR offboarding
or a DSAR (see §3).

---

## 3. DSAR — Data Subject Access Requests

Under RA 10173, a data subject may request (a) access to their personal
information, (b) correction of inaccurate personal information, (c) erasure
where a lawful ground exists, and (d) a portable export. Mwell Intra's DSAR
workflow:

### 3.1 Intake & identity verification

1. DSAR received via `privacy@mwell.com.ph` or through the Legal module's
   external portal (Phase 3, `legal:vendor` tier).
2. Legal / DPO verifies the requester's identity (government ID for
   employees; authorised-signatory letter for vendors).
3. Case is opened as a `legal.accreditation_cases` row of type `dsar` (Phase 3
   schema extension) linking to `core.profiles.id` or `core.vendors.id`.

### 3.2 Access & portability response (SLA: 15 working days)

Generate a per-subject export from every schema the subject appears in.
Reference queries:

```sql
-- Everything about a single subject
select * from core.profiles       where id = :subject_id;
select * from core.user_roles     where user_id = :subject_id;
select * from core.activity_log   where actor = :subject_id order by created_at;
select * from core.documents      where uploaded_by = :subject_id;
select * from core.notifications  where user_id = :subject_id;

-- Vendor-scoped commercial history (when subject is a vendor contact)
select * from core.vendors                where id = :vendor_id;
select * from procurement.requests        where core_vendor_id = :vendor_id;
select * from procurement.purchase_orders where core_vendor_id = :vendor_id;
select * from legal.accreditation_cases   where core_vendor_id = :vendor_id;
```

The export is packaged as JSON + linked storage objects, encrypted, and
delivered via secure link. Every export is logged
(`core.activity_log`, `action='dsar_export'`).

### 3.3 Correction

The DPO edits the record (or coordinates with the owning module lead) via
service-role SQL, then writes an `action='dsar_correction'` audit row with
before/after values in `detail`.

### 3.4 Erasure

Erasure is honoured **unless** overridden by a lawful retention obligation
(tax, contract, ongoing dispute, audit exposure — see §1). Where erasure is
possible, apply §2.1 (anonymisation) rather than hard delete so audit
integrity is preserved. Where full deletion is required and lawful, cascade
from `core.profiles` / `core.vendors` deletion and unlink storage blobs.

Write `action='dsar_erasure'` in `core.activity_log`. If erasure is refused,
document the refusal reason in the same row's `detail`.

### 3.5 Objection / withdrawal of consent

Recorded on the profile (future column `consent_withdrawn_at`) and honoured
prospectively by removing the subject from downstream processing (marketing
notifications first; operational processing where lawful basis is contract
or legitimate interest continues, per RA 10173 §12).

---

## 4. Access audit trail (`core.activity_log`)

The audit column contract per RA 10173:

- Every SECURITY DEFINER RPC that reads or writes personal / commercial data
  MUST insert into `core.activity_log` with
  `actor = auth.uid()` (forced server-side — never trust client claims),
  `entity_type` naming the target class, and `detail` carrying a minimal,
  non-redundant snapshot of the change (no bulk column dumps).
- The table is APPEND-ONLY at the RLS layer (no UPDATE/DELETE policies) so
  the trail can't be rewritten by application code.
- Purge of old activity_log rows (§1 row #2) is an explicit privileged
  operation attributed to `core.job_purge_expired` (§2.3).

Any exception (bulk exports, service_role scripts, migrations) MUST also
write to `core.activity_log` with `module='core'`, `entity_type='ops'`, and
the operator identity in `detail.operator`.

---

## 5. Change control

| Version | Date | Author | Change |
|---|---|---|---|
| 1.0 | 2026-07-05 | Platform Eng | Initial policy — periods, DSAR workflow, purge stub reference |

Amendments require Legal + DPO sign-off and a corresponding update to
`core.job_purge_expired` once implemented.
