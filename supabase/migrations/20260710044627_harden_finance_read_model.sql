create or replace view core.v_finance_activity
with (security_invoker = true)
as
  select
    'warehouse_receipt'::text as source,
    r.id::text as ref_id,
    null::text as po_id,
    null::uuid as vendor_id,
    coalesce(amt.amount, 0)::numeric as amount,
    'received'::text as status,
    r.created_at as occurred_at
  from warehouse.receipts r
  left join lateral (
    select sum(
      coalesce((line.value->>'quantity')::numeric, 0)
      * coalesce((line.value->>'unitCost')::numeric, p.unit_cost, 0)
    ) as amount
    from jsonb_array_elements(r.lines) line(value)
    left join warehouse.products p on p.id = line.value->>'productId'
  ) amt on true
  where core.has_any_cap('view_finance')

  union all

  select
    'warehouse_return'::text as source,
    ret.id::text as ref_id,
    null::text as po_id,
    null::uuid as vendor_id,
    (-1) * coalesce(amt.amount, 0)::numeric as amount,
    'returned'::text as status,
    ret.created_at as occurred_at
  from warehouse.returns ret
  left join lateral (
    select sum(
      coalesce((line.value->>'quantity')::numeric, 0)
      * coalesce((line.value->>'unitCost')::numeric, p.unit_cost, 0)
    ) as amount
    from jsonb_array_elements(ret.lines) line(value)
    left join warehouse.products p on p.id = line.value->>'productId'
  ) amt on true
  where core.has_any_cap('view_finance')

  union all

  select
    'procurement_po'::text as source,
    po.id::text as ref_id,
    po.id::text as po_id,
    po.core_vendor_id as vendor_id,
    coalesce(lines.amount, 0)::numeric as amount,
    po.status as status,
    po.updated_at as occurred_at
  from procurement.purchase_orders po
  left join lateral (
    select sum(coalesce(line.quantity, 0) * coalesce(line.unit_price, 0)) as amount
    from procurement.purchase_order_lines line
    where line.purchase_order_id = po.id
  ) lines on true
  where po.status in ('approved', 'issued', 'closed')
    and core.has_any_cap('view_finance');

revoke all on core.v_finance_activity from public, anon;
grant select on core.v_finance_activity to authenticated, service_role;

comment on view core.v_finance_activity is
  'RLS-preserving cross-module finance activity feed. The caller must hold view_finance and must pass source-table RLS.';

select pg_notify('pgrst', 'reload schema');
