-- Warehouse history is a read projection, not a receiving handoff or a PO reopen.
create function private.warehouse_closed_procurement_po_history(payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  page_size integer := greatest(1, least(100, coalesce((payload->>'limit')::integer, 25)));
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '28000';
  end if;
  -- Match current Warehouse purchase_orders/receipts read authority, including learning gates.
  if not (coalesce(core.has_live_cap('warehouse', 'receive_stock'), false)
    or coalesce(core.has_live_cap('warehouse', 'view_procurement'), false)) then
    raise exception 'Not authorized to read closed Warehouse PO history' using errcode = '42501';
  end if;
  with candidates as materialized (
    select po.*
    from procurement.purchase_orders po
    join procurement.requests request on request.id = po.request_id and request.category = 'goods'
    where po.status = 'closed'
      and (nullif(payload->>'po_id', '') is null or po.id = payload->>'po_id')
      and (nullif(payload->>'cursor', '') is null or po.id < payload->>'cursor')
      and (nullif(btrim(payload->>'search'), '') is null
        or strpos(lower(coalesce(po.po_number, po.id) || ' ' || coalesce(po.vendor_name, '')), lower(btrim(payload->>'search'))) > 0)
    order by po.id desc limit page_size + 1
  ), page as (
    select * from candidates order by id desc limit page_size
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
      'id', po.id, 'poNumber', coalesce(po.po_number, po.id), 'vendorName', coalesce(po.vendor_name, 'Unknown vendor'),
      'status', po.status, 'expectedDate', po.expected_date, 'createdAt', po.created_at, 'total', po.total,
      'lines', coalesce((select jsonb_agg(jsonb_build_object(
        'id', line.id, 'productId', line.warehouse_product_id, 'description', line.description,
        'quantity', line.quantity, 'receivedQuantity', line.received_quantity, 'uom', line.uom, 'unitPrice', line.unit_price
      ) order by line.line_no, line.id) from procurement.purchase_order_lines line where line.purchase_order_id = po.id), '[]'::jsonb),
      'receipts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', receipt.id, 'createdAt', receipt.created_at, 'qualityStatus', receipt.quality_status
      ) order by receipt.created_at, receipt.id) from warehouse.receipts receipt where receipt.procurement_po_id = po.id), '[]'::jsonb)
    ) order by po.id desc) from page po), '[]'::jsonb),
    'nextCursor', case when (select count(*) from candidates) > page_size then (select min(id) from page) else null end
  ) into result;
  return result;
end;
$$;

alter function private.warehouse_closed_procurement_po_history(jsonb) owner to postgres;
revoke all on function private.warehouse_closed_procurement_po_history(jsonb) from public, anon;
grant execute on function private.warehouse_closed_procurement_po_history(jsonb) to authenticated, service_role;

create function warehouse.closed_procurement_po_history(payload jsonb default '{}'::jsonb)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select private.warehouse_closed_procurement_po_history(payload);
$$;
revoke all on function warehouse.closed_procurement_po_history(jsonb) from public, anon;
grant execute on function warehouse.closed_procurement_po_history(jsonb) to authenticated, service_role;

select pg_notify('pgrst', 'reload schema');
