-- Keep non-stock procurement out of Warehouse receiving. Services,
-- subscriptions, manpower, construction, and capex use requester acceptance.

create or replace view warehouse.procurement_po_handoff
with (security_invoker = true)
as
select
  po.id,
  coalesce(po.po_number, po.id) as po_number,
  coalesce(po.vendor_name, 'Unknown vendor') as vendor_name,
  po.status,
  po.expected_date,
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
  po.created_at,
  po.total
from procurement.purchase_orders po
join procurement.requests request on request.id = po.request_id
left join procurement.purchase_order_lines line on line.purchase_order_id = po.id
where po.status in ('approved', 'issued')
  and request.category = 'goods'
group by po.id, po.po_number, po.vendor_name, po.status, po.expected_date,
  po.total, po.created_at;

revoke all on warehouse.procurement_po_handoff from public, anon;
grant select on warehouse.procurement_po_handoff to authenticated, service_role;

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
      and exists (
        select 1 from procurement.requests request
        where request.id = purchase_orders.request_id
          and request.category = 'goods'
      )
    )
    or exists (
      select 1 from procurement.requests request
      where request.id = purchase_orders.request_id
        and request.requester_id = (select auth.uid())
    )
  );

drop policy if exists procurement_purchase_order_lines_read on procurement.purchase_order_lines;
create policy procurement_purchase_order_lines_read
  on procurement.purchase_order_lines for select to authenticated
  using (
    exists (
      select 1
      from procurement.purchase_orders po
      left join procurement.requests request on request.id = po.request_id
      where po.id = purchase_order_lines.purchase_order_id
        and (
          core.has_cap('procurement', 'author_po')
          or core.has_cap('procurement', 'approve_award')
          or core.has_cap('procurement', 'view_finance')
          or core.has_cap('procurement', 'admin')
          or (
            core.has_cap('warehouse', 'receive_stock')
            and po.status in ('approved', 'issued')
            and request.category = 'goods'
          )
          or request.requester_id = (select auth.uid())
        )
    )
  );

drop policy if exists procurement_acceptance_read on procurement.acceptance_packs;
create policy procurement_acceptance_read
  on procurement.acceptance_packs for select to authenticated
  using (
    core.has_cap('procurement', 'author_po')
    or core.has_cap('procurement', 'approve_award')
    or core.has_cap('procurement', 'view_finance')
    or core.has_cap('procurement', 'admin')
    or (
      core.has_cap('warehouse', 'receive_stock')
      and exists (
        select 1 from procurement.requests request
        where request.id = acceptance_packs.request_id
          and request.category = 'goods'
      )
    )
    or exists (
      select 1 from procurement.requests request
      where request.id = acceptance_packs.request_id
        and request.requester_id = (select auth.uid())
    )
  );

create or replace function private.assert_goods_procurement_po(purchase_order_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from procurement.purchase_orders po
    join procurement.requests request on request.id = po.request_id
    where po.id = purchase_order_id
      and po.status in ('approved', 'issued')
      and request.category = 'goods'
  ) then
    raise exception 'Only approved or issued goods purchase orders may enter Warehouse receiving';
  end if;
end;
$$;

revoke all on function private.assert_goods_procurement_po(text) from public;

create or replace function warehouse.receive_procurement_po(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_goods_procurement_po(payload ->> 'po_id');
  return private.warehouse_receive_procurement_po(payload);
end;
$$;

create or replace function warehouse.receive_procurement_po_exception(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_goods_procurement_po(payload ->> 'po_id');
  return private.warehouse_receive_procurement_po_exception(payload);
end;
$$;

select pg_notify('pgrst', 'reload schema');
