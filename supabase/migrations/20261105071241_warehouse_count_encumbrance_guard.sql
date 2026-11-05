-- Counts remain observations. Posting is conservatively denied product-wide
-- while Quality or fulfillment/event owners have active stock commitments.
create or replace function private.warehouse_assert_count_unencumbered(p_product text)
returns void language plpgsql security definer set search_path='' as $$
declare v_control text;
begin
  if exists(select 1 from warehouse.inventory_holds
    where product_id=p_product and status='active') then
    v_control:='active Quality holds';
  elsif exists(select 1 from warehouse.fulfillment_reservations
    where product_id=p_product and status='active') then
    v_control:='active fulfillment reservations';
  elsif exists(select 1 from warehouse.allocations
    where product_id=p_product and status in ('reserved','allocated')) then
    v_control:='active event allocations';
  elsif exists(select 1 from warehouse.fulfillment_orders o
    cross join lateral jsonb_array_elements(o.lines) line
    where o.status in ('allocated','picking','packing','ready')
      and line->>'productId'=p_product) then
    -- Legacy committed orders may predate the reservation projection.
    v_control:='committed fulfillment orders';
  end if;
  if v_control is not null then
    raise exception using errcode='P0001',
      message='Count posting blocked: this product has '||v_control||'. Resolve these with the owner before reviewing a new count. Reject this request if the physical count is no longer current.';
  end if;
end $$;

-- The existing apply helper already owns both product advisory and product-row
-- locks. Do not add control-row locks that invert the authorities' lock order.
do $$
declare v_sql text; v_anchor text; v_position integer;
begin
  v_sql:=replace(pg_get_functiondef('private.warehouse_apply_count(warehouse.stock_change_requests)'::regprocedure),E'\r','');
  v_anchor:=$patch$  if (v_snapshot.facts->>'serialized')::boolean then$patch$;
  v_position:=position(v_anchor in v_sql);
  if length(v_sql)-length(replace(v_sql,v_anchor,''))<>length(v_anchor)
    or position('perform private.lock_warehouse_products(array[p_request.product_id])' in v_sql)=0
    or position('v_revision:=private.warehouse_lock_count_scope(' in v_sql)=0
    or position('perform private.lock_warehouse_products(array[p_request.product_id])' in v_sql)
      >=position('v_revision:=private.warehouse_lock_count_scope(' in v_sql)
    or position('v_revision:=private.warehouse_lock_count_scope(' in v_sql)>=v_position
    or position('v_snapshot.revision<>v_revision' in v_sql)=0
    or position('v_snapshot.revision<>v_revision' in v_sql)>=v_position
    or position('warehouse_assert_count_unencumbered' in v_sql)>0 then
    raise exception 'Count encumbrance posting anchor changed';
  end if;
  v_sql:=replace(v_sql,v_anchor,
    E'  perform private.warehouse_assert_count_unencumbered(p_request.product_id);\n'||v_anchor);
  execute v_sql;
end $$;

revoke all on function private.warehouse_assert_count_unencumbered(text) from public,anon,authenticated;
select pg_notify('pgrst','reload schema');
