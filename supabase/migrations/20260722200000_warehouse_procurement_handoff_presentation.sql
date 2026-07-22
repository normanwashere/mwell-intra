-- Preserve source dates and values in the Procurement -> Warehouse handoff.
-- The view remains actor-authorized through security_invoker and existing RLS.

create or replace view warehouse.procurement_po_handoff
with (security_invoker = true)
as
select
  po.id::text as id,
  coalesce(po.po_number, po.id::text) as po_number,
  coalesce(po.vendor_name, 'Unknown vendor') as vendor_name,
  po.status,
  po.expected_date,
  coalesce(jsonb_agg(
    jsonb_build_object(
      'id', line.id::text,
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
left join procurement.purchase_order_lines line on line.purchase_order_id = po.id
where po.status in ('approved', 'issued')
group by
  po.id,
  po.po_number,
  po.vendor_name,
  po.status,
  po.expected_date,
  po.total,
  po.created_at;

revoke all on warehouse.procurement_po_handoff from public, anon;
grant select on warehouse.procurement_po_handoff to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
