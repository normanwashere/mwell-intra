create or replace function warehouse.create_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_po warehouse.purchase_orders;
begin
  if not warehouse.has_cap('view_procurement') then raise exception 'Not authorized: view_procurement'; end if;
  insert into warehouse.purchase_orders
    select * from jsonb_populate_record(null::warehouse.purchase_orders, payload->'purchase_order')
    returning * into v_po;
  update warehouse.purchase_orders set status = 'ordered' where id = v_po.id returning * into v_po;
  return to_jsonb(v_po);
end; $$;

create or replace function warehouse.cancel_purchase_order(payload jsonb)
returns jsonb language plpgsql security definer set search_path = warehouse, public as $$
declare v_po warehouse.purchase_orders;
begin
  if not warehouse.has_cap('view_procurement') then raise exception 'Not authorized: view_procurement'; end if;
  update warehouse.purchase_orders set status = 'cancelled'
  where id = payload->>'po_id' and status not in ('received','cancelled')
  returning * into v_po;
  if v_po.id is null then raise exception 'Purchase order not found, already cancelled, or fully received.'; end if;
  return to_jsonb(v_po);
end; $$;

do $$ declare fn text;
begin
  foreach fn in array array['create_purchase_order','cancel_purchase_order']
  loop
    execute format('revoke all on function warehouse.%I(jsonb) from public, anon;', fn);
    execute format('grant execute on function warehouse.%I(jsonb) to authenticated, service_role;', fn);
  end loop;
end $$;

revoke insert, update, delete on warehouse.purchase_orders from authenticated;
revoke insert, update, delete on warehouse.lots from authenticated;

drop policy if exists purchase_orders_write on warehouse.purchase_orders;
drop policy if exists lots_insert on warehouse.lots;
drop policy if exists lots_update on warehouse.lots;
drop policy if exists lots_delete on warehouse.lots;

notify pgrst, 'reload schema';
