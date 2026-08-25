-- Let Warehouse prove that an issued PO is for goods without exposing the
-- underlying Procurement request. The predicate returns only a boolean and
-- avoids an RLS-within-RLS visibility failure.

create or replace function private.is_goods_procurement_request(p_request_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from procurement.requests request
    where request.id = p_request_id
      and request.category = 'goods'
  )
$$;

revoke all on function private.is_goods_procurement_request(text) from public;
grant execute on function private.is_goods_procurement_request(text) to authenticated, service_role;

drop policy if exists procurement_purchase_orders_read on procurement.purchase_orders;
create policy procurement_purchase_orders_read
  on procurement.purchase_orders for select to authenticated
  using (
    core.has_cap('procurement', 'author_po')
    or core.has_cap('procurement', 'approve_award')
    or core.has_cap('procurement', 'view_finance')
    or core.has_cap('procurement', 'admin')
    or (
      core.has_cap('warehouse', 'receive_stock')
      and status in ('approved', 'issued')
      and private.is_goods_procurement_request(request_id)
    )
    or private.can_read_procurement_request(request_id)
  );

drop policy if exists procurement_purchase_order_lines_read on procurement.purchase_order_lines;
create policy procurement_purchase_order_lines_read
  on procurement.purchase_order_lines for select to authenticated
  using (
    exists (
      select 1
      from procurement.purchase_orders purchase_order
      where purchase_order.id = purchase_order_lines.purchase_order_id
        and (
          core.has_cap('procurement', 'author_po')
          or core.has_cap('procurement', 'approve_award')
          or core.has_cap('procurement', 'view_finance')
          or core.has_cap('procurement', 'admin')
          or (
            core.has_cap('warehouse', 'receive_stock')
            and purchase_order.status in ('approved', 'issued')
            and private.is_goods_procurement_request(purchase_order.request_id)
          )
          or private.can_read_procurement_request(purchase_order.request_id)
        )
    )
  );

create or replace view warehouse.procurement_po_handoff
with (security_invoker = true)
as
select
  purchase_order.id,
  coalesce(purchase_order.po_number, purchase_order.id) as po_number,
  coalesce(purchase_order.vendor_name, 'Unknown vendor') as vendor_name,
  purchase_order.status,
  purchase_order.expected_date,
  coalesce(jsonb_agg(
    jsonb_build_object(
      'id', line.id,
      'productId', line.warehouse_product_id,
      'description', line.description,
      'quantity', line.quantity,
      'receivedQuantity', line.received_quantity,
      'uom', line.uom,
      'unitPrice', line.unit_price
    ) order by line.line_no, line.id
  ) filter (where line.id is not null), '[]'::jsonb) as lines,
  purchase_order.created_at,
  purchase_order.total
from procurement.purchase_orders purchase_order
left join procurement.purchase_order_lines line
  on line.purchase_order_id = purchase_order.id
where purchase_order.status in ('approved', 'issued')
  and private.is_goods_procurement_request(purchase_order.request_id)
group by
  purchase_order.id,
  purchase_order.po_number,
  purchase_order.vendor_name,
  purchase_order.status,
  purchase_order.expected_date,
  purchase_order.total,
  purchase_order.created_at;

revoke all on warehouse.procurement_po_handoff from public, anon;
grant select on warehouse.procurement_po_handoff to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
