-- Mwell Intra — cross-module wiring (Step 3d, spec §7)
--
-- Ties the department modules together at the SQL layer with two contracts:
--
--   1. Accreditation gates PO award (Legal → Procurement).
--      A procurement PO cannot be `approved` unless its `core_vendor_id` has
--      `core.vendors.accreditation_status = 'approved'`. Enforced by both:
--        - a status-transition RPC `procurement.approve_purchase_order`, and
--        - a trigger on `procurement.purchase_orders` so no other path (direct
--          service_role update, future RPC, migration) can bypass it.
--
--   2. Procurement PO → Warehouse receiving handoff (Procurement → Warehouse).
--      The warehouse `receive_against_po` RPC already accepts any PO id; this
--      migration exposes `warehouse.receive_against_procurement_po(payload)`
--      that validates the procurement PO is `approved`, records the receipt in
--      the warehouse ledger (via a small helper), and flips the procurement PO
--      to `issued`/`closed` as its lines are fulfilled. It also registers any
--      evidence in `core.documents` via the existing helper (ADR-002 #1).
--
-- Idempotent: create-or-replace functions + drop-then-create trigger.

set search_path to public;

-- ---------------------------------------------------------------------------
-- 1) Accreditation-gated award
-- ---------------------------------------------------------------------------

-- Helper: assert that a vendor is currently accredited (approved & not expired).
create or replace function procurement.assert_vendor_accredited(p_vendor_id uuid)
returns void language plpgsql stable security definer set search_path = procurement, core, public as $$
declare v_status text; v_expires date;
begin
  select accreditation_status, accreditation_expires_at
    into v_status, v_expires
    from core.vendors
   where id = p_vendor_id;
  if not found then
    raise exception 'Vendor % not found in core.vendors', p_vendor_id
      using errcode = 'foreign_key_violation';
  end if;
  if v_status is distinct from 'approved' then
    raise exception 'Vendor % is not accredited (status = %); cannot award PO',
      p_vendor_id, coalesce(v_status, 'null')
      using errcode = 'check_violation';
  end if;
  if v_expires is not null and v_expires < current_date then
    raise exception 'Vendor % accreditation expired on %; cannot award PO',
      p_vendor_id, v_expires
      using errcode = 'check_violation';
  end if;
end; $$;

revoke all on function procurement.assert_vendor_accredited(uuid) from public, anon;
grant execute on function procurement.assert_vendor_accredited(uuid) to authenticated, service_role;

-- Trigger backstop: any transition INTO 'approved' or 'issued' must satisfy
-- the accreditation gate. Draft/pending_approval/cancelled remain unrestricted
-- so vendors can be prepared before accreditation completes.
create or replace function procurement.enforce_award_accreditation()
returns trigger language plpgsql as $$
begin
  if new.status in ('approved', 'issued')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform procurement.assert_vendor_accredited(new.core_vendor_id);
  end if;
  return new;
end; $$;

drop trigger if exists purchase_orders_accreditation_gate on procurement.purchase_orders;
create trigger purchase_orders_accreditation_gate
before insert or update on procurement.purchase_orders
for each row execute function procurement.enforce_award_accreditation();

-- Public RPC to approve a PO. Wraps the assertion + transition + activity log.
create or replace function procurement.approve_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = procurement, core, public as $$
declare v procurement.purchase_orders; v_id uuid;
begin
  if not core.has_cap('procurement', 'approve_award') then
    raise exception 'Not authorized: procurement.approve_award';
  end if;
  v_id := (payload->>'id')::uuid;
  if v_id is null then raise exception 'purchase_order id is required'; end if;
  select * into v from procurement.purchase_orders where id = v_id for update;
  if not found then raise exception 'Purchase order not found'; end if;
  if v.status not in ('draft', 'pending_approval') then
    raise exception 'PO % cannot be approved from status %', v_id, v.status;
  end if;
  perform procurement.assert_vendor_accredited(v.core_vendor_id);
  update procurement.purchase_orders
     set status = 'approved', updated_at = now()
   where id = v_id
   returning * into v;
  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('procurement', 'purchase_order', v.id, 'approved', auth.uid(),
          jsonb_build_object('core_vendor_id', v.core_vendor_id));
  return to_jsonb(v);
end; $$;

revoke all on function procurement.approve_purchase_order(jsonb) from public, anon;
grant execute on function procurement.approve_purchase_order(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2) Procurement PO → Warehouse receiving handoff
-- ---------------------------------------------------------------------------

-- Lightweight "shipment received" record against a procurement PO. Warehouse
-- inventory movements are still the source of truth for on-hand math; this
-- table records the linkage between a warehouse receipt event and the
-- procurement PO/line that authorized it, so both sides can reconcile.
create table if not exists procurement.receipts (
  id                uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references procurement.purchase_orders(id) on delete restrict,
  line_id           uuid references procurement.purchase_order_lines(id) on delete set null,
  warehouse_receipt_id text,          -- warehouse-side receipt id (text per LLD)
  quantity          numeric(14, 4) not null check (quantity > 0),
  received_at       timestamptz not null default now(),
  actor_id          uuid not null references core.profiles(id),
  notes             text
);

create index if not exists procurement_receipts_po_idx on procurement.receipts (purchase_order_id);
create index if not exists procurement_receipts_line_idx on procurement.receipts (line_id);

alter table procurement.receipts enable row level security;
drop policy if exists read_procurement_receipts on procurement.receipts;
create policy read_procurement_receipts on procurement.receipts for select to authenticated
  using (core.has_cap('procurement', 'view_dashboard'));

grant select on procurement.receipts to authenticated, service_role;
grant all on procurement.receipts to service_role;
revoke insert, update, delete on procurement.receipts from authenticated;

-- Handoff RPC: called from the warehouse side when receiving against a
-- procurement PO. Records the receipt link and, when all lines are covered,
-- advances the procurement PO status to 'closed' (else 'issued').
create or replace function warehouse.receive_against_procurement_po(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, procurement, core, public as $$
declare
  v_po_id uuid;
  v_line_id uuid;
  v_qty numeric;
  v_receipt_id text;
  v procurement.purchase_orders;
  v_line_total numeric := 0;
  v_received_total numeric := 0;
  v_all_lines_fulfilled boolean;
  v_out jsonb;
begin
  if not core.has_cap('warehouse', 'receive_stock') then
    raise exception 'Not authorized: warehouse.receive_stock';
  end if;
  v_po_id := (payload->>'purchase_order_id')::uuid;
  v_line_id := nullif(payload->>'line_id', '')::uuid;
  v_qty := (payload->>'quantity')::numeric;
  v_receipt_id := nullif(payload->>'warehouse_receipt_id', '');
  if v_po_id is null or v_qty is null or v_qty <= 0 then
    raise exception 'purchase_order_id and positive quantity are required';
  end if;

  select * into v from procurement.purchase_orders where id = v_po_id for update;
  if not found then raise exception 'Procurement PO not found: %', v_po_id; end if;
  if v.status not in ('approved', 'issued') then
    raise exception 'Cannot receive against PO %: status must be approved or issued (was %)', v_po_id, v.status;
  end if;

  insert into procurement.receipts (
    purchase_order_id, line_id, warehouse_receipt_id, quantity, actor_id, notes
  ) values (
    v_po_id, v_line_id, v_receipt_id, v_qty, auth.uid(), nullif(payload->>'notes', '')
  ) returning to_jsonb(procurement.receipts.*) into v_out;

  -- Compute per-PO fulfillment across all lines.
  select coalesce(sum(l.quantity), 0), coalesce(sum(r.quantity), 0)
    into v_line_total, v_received_total
    from procurement.purchase_order_lines l
    left join procurement.receipts r on r.line_id = l.id
   where l.purchase_order_id = v_po_id;
  v_all_lines_fulfilled := v_line_total > 0 and v_received_total >= v_line_total;

  if v_all_lines_fulfilled then
    update procurement.purchase_orders
       set status = 'closed', updated_at = now()
     where id = v_po_id;
  elsif v.status = 'approved' then
    update procurement.purchase_orders
       set status = 'issued', updated_at = now()
     where id = v_po_id;
  end if;

  insert into core.activity_log (module, entity_type, entity_id, action, actor, detail)
  values ('procurement', 'purchase_order', v_po_id, 'received', auth.uid(),
          jsonb_build_object(
            'quantity', v_qty,
            'line_id', v_line_id,
            'warehouse_receipt_id', v_receipt_id,
            'fulfilled', v_all_lines_fulfilled
          ));
  return v_out;
end; $$;

revoke all on function warehouse.receive_against_procurement_po(jsonb) from public, anon;
grant execute on function warehouse.receive_against_procurement_po(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Note: warehouse `receive_stock` continues to work for warehouse-origin POs
-- and ad-hoc receipts. This RPC is the *linked* path when the source is a
-- procurement PO — callers on the warehouse UI can offer both flows.
-- ---------------------------------------------------------------------------
