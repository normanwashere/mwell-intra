-- Mwell Intra — warehouse Step-2 deltas (ADR-002 #1/#2 schema changes)
--
-- The two ADDITIVE schema changes ADR-002 requires so warehouse master data and
-- purchase orders integrate with the shared `core` schema (spec §7, §11 ADR-002,
-- roadmap Step 2c). The third ADR-002 delta (evidence -> core.documents, #1) is
-- behavioural and lives inside the receipt/return RPCs in
-- 20260706092400_warehouse_rpcs.sql.
--
--   a) suppliers.core_vendor_id  — PROJECTION link to the shared vendor master
--      core.vendors(id). Spec §3/§4.3: "shared entity = lives in core; modules
--      reference core IDs and keep a thin projection table for module-local
--      fields." warehouse.suppliers is exactly that projection (id/name/lead
--      time are warehouse-local), and core_vendor_id points at the canonical
--      vendor record whose accreditation Legal owns.
--
--      No-FK philosophy note (docs/LLD.md §4.2): the warehouse base tables avoid
--      FKs. This column is the sanctioned exception — a NULLABLE, cross-schema FK
--      to core master data (on delete set null) is acceptable here because the
--      target is an authoritative, slow-changing core table, the link is a
--      reference not a copy, and null means "not yet linked to a core vendor"
--      (every existing supplier row stays valid). Guard-added so re-runs are safe.
--
--   b) purchase_orders.origin  — 'warehouse' | 'procurement' (ADR-002 #2). Both
--      origins feed the same receive_against_po() path; warehouse-origin POs are
--      the internal reorder/replenishment path (LLD §5.1) and are all this module
--      authors today. Procurement-origin POs arrive in Step 3. Defaults to
--      'warehouse'; the create_purchase_order() RPC stamps it server-side.
--      Consistent with the no-check-constraint design, the allowed-value set is
--      enforced in the RPC (server-authoritative) rather than a CHECK constraint.
--
-- Re-runnable: add column if not exists + guarded add-constraint.

-- ===========================================================================
-- a) warehouse.suppliers.core_vendor_id -> core.vendors(id)  (projection link)
-- ===========================================================================
alter table warehouse.suppliers
  add column if not exists core_vendor_id uuid;

create index if not exists suppliers_core_vendor_idx
  on warehouse.suppliers (core_vendor_id);

-- Null out any dangling links before adding the FK (defensive; normally none).
update warehouse.suppliers s set core_vendor_id = null
 where core_vendor_id is not null
   and not exists (select 1 from core.vendors v where v.id = s.core_vendor_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'suppliers_core_vendor_fk') then
    alter table warehouse.suppliers
      add constraint suppliers_core_vendor_fk foreign key (core_vendor_id)
      references core.vendors(id) on delete set null;
  end if;
end $$;

-- ===========================================================================
-- b) warehouse.purchase_orders.origin  ('warehouse' | 'procurement')
-- ===========================================================================
alter table warehouse.purchase_orders
  add column if not exists origin text not null default 'warehouse';

-- Backfill any pre-existing rows (all warehouse-authored to date) explicitly.
update warehouse.purchase_orders set origin = 'warehouse' where origin is null;

create index if not exists purchase_orders_origin_idx
  on warehouse.purchase_orders (origin);

notify pgrst, 'reload schema';
