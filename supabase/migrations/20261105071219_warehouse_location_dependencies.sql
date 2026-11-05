-- A rename is harmless. Changing a location's role must not strand stock or work.
create or replace function private.warehouse_guard_stocked_location()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.type is not distinct from old.type and not(old.active and not new.active) then return new; end if;
  if exists(select 1 from warehouse.stock_levels where location_id=old.id and quantity>0)
    or exists(select 1 from warehouse.inventory_units where location_id=old.id and status not in ('issued','vendor_return','lost')) then
    raise exception 'This location still holds stock. Move or reconcile that stock before changing its type or making it inactive. You can still rename it.';
  end if;
  if exists(select 1 from warehouse.storage_areas where location_id=old.id and active) then
    raise exception 'This warehouse has active storage areas. Close or move their work, then deactivate the empty areas before changing the warehouse. You can still rename it.';
  end if;
  if exists(select 1 from warehouse.inventory_holds where location_id=old.id and status='active')
    or exists(select 1 from warehouse.fulfillment_reservations where location_id=old.id and status='active')
    or exists(select 1 from warehouse.receiving_drafts where body->>'locationId'=old.id)
    or exists(select 1 from warehouse.cycle_counts where location_id=old.id and status in ('draft','submitted','pending_approval'))
    or exists(select 1 from warehouse.stock_change_requests where location_id=old.id and status in ('pending_supervisor','pending_finance'))
    or exists(select 1 from warehouse.quality_inspections where location_id=old.id and disposition='pending')
    or exists(select 1 from warehouse.receipts where location_id=old.id and quality_status in ('pending','partial','hold'))
    or exists(select 1 from warehouse.procurement_receipt_excess_custody c join warehouse.receipts r on r.id=c.receipt_id
      where r.location_id=old.id and c.status in ('pending','held'))
    or exists(select 1 from private.external_po_orders o where o.location_id=old.id and (
      o.status in ('draft','returned')
      or exists(select 1 from private.external_po_lines l where l.order_id=o.id and l.received_quantity<l.quantity)
      or exists(select 1 from private.external_po_shipments s where s.order_id=o.id and s.status='draft')))
    or exists(select 1 from warehouse.fulfillment_orders where third_party_location_id=old.id and status not in ('completed','cancelled')) then
    raise exception 'This location still has receiving, Quality, counting or fulfillment work. Complete or move that work before changing its type or making it inactive. You can still rename it.';
  end if;
  return new;
end $$;

-- SHARE conflicts with location reclassification, but not another receipt. The
-- location guard never locks stock/work rows, avoiding a reverse lock order.
create function private.warehouse_lock_work_location()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_new jsonb:=to_jsonb(new); v_old jsonb; v_id text; v_type text; v_active boolean; v_warehouse boolean:=false;
begin
  if tg_op='UPDATE' then v_old:=to_jsonb(old); end if;
  v_id:=v_new->>'location_id';
  case tg_table_name
    when 'stock_levels' then
      if (v_new->>'quantity')::integer<=0 then return new; end if;
      if tg_op='UPDATE' and v_old->>'location_id'=v_id and (v_new->>'quantity')::integer<=(v_old->>'quantity')::integer then return new; end if;
    when 'inventory_units' then
      if v_new->>'status' in ('issued','vendor_return','lost') then return new; end if;
      if tg_op='UPDATE' and v_old->>'location_id'=v_id and v_old->>'status' not in ('issued','vendor_return','lost') then return new; end if;
    when 'storage_areas' then
      if not (v_new->>'active')::boolean then return new; end if;
      v_warehouse:=true;
    when 'inventory_holds' then
      if v_new->>'status'<>'active' then return new; end if;
    when 'fulfillment_reservations' then
      if v_new->>'status'<>'active' then return new; end if;
    when 'receiving_drafts' then
      v_id:=v_new->'body'->>'locationId'; v_warehouse:=true;
    when 'external_po_orders' then v_warehouse:=true;
    when 'external_po_shipments' then
      if v_new->>'status'<>'draft' then return new; end if;
      select location_id into v_id from private.external_po_orders where id=(v_new->>'order_id')::uuid;
      v_warehouse:=true;
    when 'receipts' then
      if tg_op='UPDATE' and v_old->>'location_id'=v_id then return new; end if;
      v_warehouse:=true;
    when 'quality_inspections' then
      if v_new->>'disposition'<>'pending' then return new; end if;
    when 'cycle_counts' then
      if v_new->>'status' not in ('draft','submitted','pending_approval') then return new; end if;
    when 'stock_change_requests' then
      if v_new->>'status' not in ('pending_supervisor','pending_finance') then return new; end if;
    when 'fulfillment_orders' then
      if v_new->>'status' in ('completed','cancelled') then return new; end if;
      v_id:=v_new->>'third_party_location_id';
    else raise exception 'Unsupported location dependency';
  end case;
  if nullif(v_id,'') is null then return new; end if;
  select type,active into v_type,v_active from warehouse.locations where id=v_id for share;
  if not found or not v_active or (v_warehouse and v_type<>'warehouse') then
    raise exception 'This location is no longer available for this work. Refresh and choose an active location. Nothing was saved.';
  end if;
  return new;
end $$;
do $$
declare v_table text;
begin
  foreach v_table in array array['warehouse.stock_levels','warehouse.inventory_units','warehouse.storage_areas',
    'warehouse.inventory_holds','warehouse.fulfillment_reservations','warehouse.receiving_drafts','warehouse.receipts',
    'warehouse.cycle_counts','warehouse.stock_change_requests','warehouse.quality_inspections','warehouse.fulfillment_orders',
    'private.external_po_orders','private.external_po_shipments'] loop
    execute format('create trigger warehouse_work_location_guard before insert or update on %s for each row execute function private.warehouse_lock_work_location()',v_table::regclass);
  end loop;
end $$;
revoke all on function private.warehouse_lock_work_location(),private.warehouse_guard_stocked_location() from public,anon,authenticated;
select pg_notify('pgrst','reload schema');
