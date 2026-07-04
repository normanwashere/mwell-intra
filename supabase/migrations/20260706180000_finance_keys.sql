-- Mwell Intra — finance activity read-model (spec §7 "model the keys now")
--
-- Ships the CROSS-MODULE keys the finance role will consume, one migration
-- ahead of the UI. Per spec §7: no client wiring is added yet — this is just a
-- single queryable view that unions every event finance cares about:
--
--   * warehouse.receipts       (inbound goods, best-effort amount from lines)
--   * warehouse.returns        (outbound returns, signed negative)
--   * procurement.purchase_orders that reached approved/issued/closed
--
-- Vendor identity is normalised to `core.vendors.id` on every row:
--   * warehouse arms use warehouse.suppliers.core_vendor_id (ADR-002 #1
--     projection FK, nullable — legacy suppliers may not be mapped yet)
--   * procurement arm uses procurement.purchase_orders.core_vendor_id (NOT NULL)
--
-- Amount computation is BEST-EFFORT because the warehouse ledger keeps
-- receipt/return lines as jsonb (LLD §11): sum of
-- (line.quantity * coalesce(line.unitCost, products.unit_cost, 0)) per row.
-- Returns are signed negative to make finance sums roll up correctly.
--
-- Access control: this view is `security_invoker = false` (owner-privileged;
-- the underlying warehouse read-model gate from 20260706170000 would otherwise
-- lock out cross-module finance callers who lack a warehouse role). Each union
-- arm therefore filters on `core.has_any_cap('view_finance')` so a caller
-- without the finance capability sees zero rows regardless of module.
-- `procurement:finance`, `warehouse:finance`, `warehouse:pricing`, and
-- `procurement:admin` all hold `view_finance` (see 20260706091000_core_seed_rbac.sql).
--
-- Re-runnable: `create or replace view` + idempotent grants.

-- ---------------------------------------------------------------------------
-- core.v_finance_activity — one row per finance-relevant event.
--
-- Columns:
--   source        text        'warehouse_receipt' | 'warehouse_return' | 'procurement_po'
--   ref_id        text        source-native id (warehouse ids are text; procurement uuids cast)
--   po_id         text        procurement PO id when the row is a procurement PO row;
--                             otherwise null (warehouse receipts don't record PO linkage
--                             on the receipt row itself — the join lives in
--                             procurement.receipts and can be layered on later)
--   vendor_id     uuid        core.vendors.id, or null when not yet mapped
--   amount        numeric     positive for inbound (receipts, PO totals),
--                             negative for warehouse returns
--   status        text        'received' | 'returned' | procurement PO status
--   occurred_at   timestamptz event time (receipts/returns.created_at, PO.updated_at)
-- ---------------------------------------------------------------------------
create or replace view core.v_finance_activity as
  -- Warehouse inbound receipts (ad-hoc + PO-backed alike).
  select
    'warehouse_receipt'::text                                as source,
    r.id::text                                               as ref_id,
    null::text                                               as po_id,
    s.core_vendor_id                                         as vendor_id,
    coalesce(amt.amount, 0)::numeric                         as amount,
    'received'::text                                         as status,
    r.created_at                                             as occurred_at
  from warehouse.receipts r
  left join warehouse.suppliers s on s.id = r.supplier_id
  left join lateral (
    select sum(
      coalesce((l->>'quantity')::numeric, 0)
      * coalesce((l->>'unitCost')::numeric, p.unit_cost, 0)
    ) as amount
    from jsonb_array_elements(r.lines) l
    left join warehouse.products p on p.id = (l->>'productId')
  ) amt on true
  where core.has_any_cap('view_finance')

  union all

  -- Warehouse outbound returns (signed negative so finance sums roll up).
  select
    'warehouse_return'::text                                 as source,
    ret.id::text                                             as ref_id,
    null::text                                               as po_id,
    null::uuid                                               as vendor_id,
    (-1) * coalesce(amt.amount, 0)::numeric                  as amount,
    'returned'::text                                         as status,
    ret.created_at                                           as occurred_at
  from warehouse.returns ret
  left join lateral (
    select sum(
      coalesce((l->>'quantity')::numeric, 0)
      * coalesce((l->>'unitCost')::numeric, p.unit_cost, 0)
    ) as amount
    from jsonb_array_elements(ret.lines) l
    left join warehouse.products p on p.id = (l->>'productId')
  ) amt on true
  where core.has_any_cap('view_finance')

  union all

  -- Procurement POs from the moment they clear approval.
  select
    'procurement_po'::text                                   as source,
    po.id::text                                              as ref_id,
    po.id::text                                              as po_id,
    po.core_vendor_id                                        as vendor_id,
    coalesce(lines.amount, 0)::numeric                       as amount,
    po.status                                                as status,
    po.updated_at                                            as occurred_at
  from procurement.purchase_orders po
  left join lateral (
    select sum(
      coalesce(l.quantity, 0) * coalesce(l.unit_price, 0)
    ) as amount
    from procurement.purchase_order_lines l
    where l.purchase_order_id = po.id
  ) lines on true
  where po.status in ('approved','issued','closed')
    and core.has_any_cap('view_finance');

-- ---------------------------------------------------------------------------
-- Grants — view is owner-privileged; caller-side gate is the `has_any_cap`
-- filter inlined above. anon never gets the view; authenticated may select.
-- ---------------------------------------------------------------------------
revoke all on core.v_finance_activity from public, anon;
grant select on core.v_finance_activity to authenticated, service_role;

comment on view core.v_finance_activity is
  'Cross-module finance activity feed (warehouse receipts/returns + approved procurement POs). '
  'Guarded by core.has_any_cap(''view_finance'') inline on each union arm. '
  'Spec §7 "model the keys now" — schema exists ahead of any UI wiring.';

notify pgrst, 'reload schema';
