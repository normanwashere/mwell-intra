-- Quantities may include hidden controls; their identities/evidence remain private.
-- This summary supports the current global inventory read scope, not row-scoped
-- tenancy. Fail closed if that scope contract changes instead of bypassing it.
create or replace function private.warehouse_inventory_position_summary()
returns table (
  id text, product_id text, location_id text, bin_id text,
  on_hand bigint, committed bigint, held bigint, unavailable bigint,
  available bigint, created_at timestamptz,
  unscoped_committed bigint, product_available bigint,
  availability_verified boolean, putaway_available bigint
)
language plpgsql stable security definer set search_path='' as $$
declare v_table text; v_relation regclass; v_auth oid;
begin
  if auth.uid() is null or (
    core.has_live_cap('warehouse','view_inventory')
    or core.has_live_cap('warehouse','view_analytics')
    or core.has_live_cap('warehouse','view_finance')
    or core.has_live_cap('insights','view_warehouse')
  ) is not true then
    raise exception using errcode='42501',message='Current inventory summary read access is required';
  end if;
  select oid into strict v_auth from pg_catalog.pg_roles where rolname='authenticated';
  foreach v_table in array array['products','locations','storage_areas','stock_levels','inventory_units'] loop
    v_relation:=pg_catalog.to_regclass('warehouse.'||v_table);
    if not exists(select 1 from pg_catalog.pg_policy p
      where p.polrelid=v_relation and p.polcmd='r' and p.polpermissive
        and (v_auth=any(p.polroles) or 0=any(p.polroles))
        and pg_catalog.pg_get_expr(p.polqual,p.polrelid)='true')
      or not exists(select 1 from pg_catalog.pg_policy p
        where p.polrelid=v_relation and p.polcmd='r' and not p.polpermissive
          and v_auth=any(p.polroles) and p.polname='current_capability_read_guard')
      or exists(select 1 from pg_catalog.pg_policy p
        where p.polrelid=v_relation and p.polcmd in ('r','*') and not p.polpermissive
          and (v_auth=any(p.polroles) or 0=any(p.polroles))
          and (p.polname<>'current_capability_read_guard'
            or pg_catalog.regexp_replace(pg_catalog.pg_get_expr(p.polqual,p.polrelid),'\s+',' ','g')
              <>pg_catalog.format('( SELECT private.can_read_warehouse_table(%L::text) AS can_read_warehouse_table)',v_table))) then
      raise exception using errcode='42501',message='Inventory summary row scope changed; review the summary read policy';
    end if;
  end loop;
  return query
  with active_holds as materialized (
    select h.product_id,h.location_id,h.bin_id,h.lot_id,h.serial_number,h.quantity
    from warehouse.inventory_holds h where h.status='active'
  ), unverifiable_products as (
    -- Unknown serial overlap invalidates this product, not the whole read.
    select distinct h.product_id from active_holds h join warehouse.products p on p.id=h.product_id
    where p.serialized and (nullif(btrim(h.serial_number),'') is null or h.quantity<>1)
  ), held_serials as (
    select distinct h.product_id,upper(btrim(h.serial_number)) as serial_number
    from active_holds h where h.serial_number is not null
  ), bulk_holds as (
    select h.product_id,h.location_id,h.bin_id,h.lot_id,sum(h.quantity)::bigint as quantity
    from active_holds h join warehouse.products p on p.id=h.product_id and not p.serialized
    group by h.product_id,h.location_id,h.bin_id,h.lot_id
  ), bulk_levels as (
    select s.product_id,s.location_id,s.bin_id,s.lot_id,sum(s.quantity)::bigint as quantity
    from warehouse.stock_levels s group by s.product_id,s.location_id,s.bin_id,s.lot_id
  ), physical as (
    select s.product_id,s.location_id,s.bin_id,s.quantity as on_hand,
      least(greatest(s.quantity,0),coalesce(h.quantity,0))::bigint as held,0::bigint as unavailable
    from bulk_levels s left join bulk_holds h on h.product_id=s.product_id and h.location_id=s.location_id
      and h.bin_id is not distinct from s.bin_id and h.lot_id is not distinct from s.lot_id
    union all
    select u.product_id,u.location_id,u.bin_id,count(*)::bigint,
      count(*) filter(where h.serial_number is not null)::bigint,
      count(*) filter(where u.status='returned' and h.serial_number is null)::bigint
    from warehouse.inventory_units u left join held_serials h
      on h.product_id=u.product_id and h.serial_number=upper(btrim(u.serial_number))
    where u.status in ('in_stock','returned')
    group by u.product_id,u.location_id,u.bin_id
  ), physical_positions as (
    select p.product_id,p.location_id,p.bin_id,sum(p.on_hand)::bigint as on_hand,
      sum(p.held)::bigint as held,sum(p.unavailable)::bigint as unavailable
    from physical p group by p.product_id,p.location_id,p.bin_id
  ), fulfillment_demand as (
    select r.order_id,r.product_id,r.location_id,r.bin_id,r.quantity::bigint as quantity
    from warehouse.fulfillment_reservations r where r.status='active'
    union all
    select o.id,line->>'productId',o.source_location_id,o.source_bin_id,sum((line->>'quantity')::bigint)::bigint
    from warehouse.fulfillment_orders o cross join lateral jsonb_array_elements(o.lines) line
    where o.status in ('allocated','picking','packing','ready')
      and not exists(select 1 from warehouse.fulfillment_reservations r
        where r.order_id=o.id and r.product_id=line->>'productId' and r.status='active')
    group by o.id,line->>'productId',o.source_location_id,o.source_bin_id
  ), fulfillment_remaining as (
    select d.product_id,d.location_id,d.bin_id,
      greatest(d.quantity-(select count(distinct u.id)
        from warehouse.fulfillment_orders o cross join lateral jsonb_array_elements(o.lines) line
        cross join lateral jsonb_array_elements_text(coalesce(line->'pickedSerialNumbers','[]'::jsonb)) serial
        join warehouse.inventory_units u on u.product_id=d.product_id
          and upper(btrim(u.serial_number))=upper(btrim(serial.value)) and u.status in ('allocated','issued')
        where o.id=d.order_id and line->>'productId'=d.product_id),0)::bigint as quantity
    from fulfillment_demand d
  ), event_demand as (
    select a.product_id,a.event_id,
      coalesce(sum(a.quantity) filter(where a.status='reserved'),0)::bigint as reserved,
      coalesce(sum(a.quantity) filter(where a.status='allocated'),0)::bigint as allocated
    from warehouse.allocations a where a.status in ('reserved','allocated') group by a.product_id,a.event_id
  ), event_remaining as (
    select d.product_id,(d.reserved+greatest(d.allocated-(select count(*) from warehouse.inventory_units u
      where u.product_id=d.product_id and u.event_id=d.event_id and u.status='allocated'),0))::bigint as quantity
    from event_demand d
  ), scoped as (
    select d.product_id,d.location_id,d.bin_id,sum(d.quantity)::bigint as committed
    from fulfillment_remaining d where d.location_id is not null and d.bin_id is not null
    group by d.product_id,d.location_id,d.bin_id
  ), unscoped as (
    select d.product_id,sum(d.quantity)::bigint as committed from (
      select f.product_id,f.quantity from fulfillment_remaining f where f.location_id is null or f.bin_id is null
      union all select e.product_id,e.quantity from event_remaining e
    ) d group by d.product_id
  ), positions as (
    select coalesce(p.product_id,s.product_id) as product_id,coalesce(p.location_id,s.location_id) as location_id,
      coalesce(p.bin_id,s.bin_id) as bin_id,coalesce(p.on_hand,0)::bigint as on_hand,
      coalesce(p.held,0)::bigint as held,coalesce(p.unavailable,0)::bigint as unavailable,
      coalesce(s.committed,0)::bigint as committed
    from physical_positions p full join scoped s on s.product_id=p.product_id and s.location_id=p.location_id
      and s.bin_id is not distinct from p.bin_id
  ), valid_positions as (
    select p.* from positions p join warehouse.products product on product.id=p.product_id
      join warehouse.locations location on location.id=p.location_id
  ), totals as (
    select p.product_id,sum(p.on_hand-p.held-p.unavailable-p.committed)::bigint as free
    from valid_positions p group by p.product_id
  )
  select p.product_id||'|'||p.location_id||'|'||coalesce(p.bin_id,''),p.product_id,p.location_id,p.bin_id,
    p.on_hand,p.committed,p.held,p.unavailable,
    case when coalesce(u.committed,0)>0 or invalid.product_id is not null then 0::bigint
      else greatest(p.on_hand-p.held-p.unavailable-p.committed,0)::bigint end,
    timestamptz '1970-01-01 00:00:00+00',coalesce(u.committed,0)::bigint,
    case when invalid.product_id is not null then null::bigint else greatest(t.free-coalesce(u.committed,0),0)::bigint end,
    coalesce(u.committed,0)=0 and invalid.product_id is null,
    case when invalid.product_id is not null then 0::bigint else greatest(p.on_hand-p.held-p.unavailable-p.committed,0)::bigint end
  from valid_positions p join totals t on t.product_id=p.product_id
    left join unscoped u on u.product_id=p.product_id
    left join unverifiable_products invalid on invalid.product_id=p.product_id;
end $$;

revoke all on function private.warehouse_inventory_position_summary() from public,anon;
grant execute on function private.warehouse_inventory_position_summary() to authenticated,service_role;

create or replace view warehouse.inventory_position_v1 with (security_invoker=true) as
select * from private.warehouse_inventory_position_summary();

-- Action-only Quality/Exception readers retain their independent task branches.
-- This invoker bridge skips quantities they cannot read; it grants no new scope.
create or replace function private.warehouse_inventory_position_for_tasks()
returns setof warehouse.inventory_position_v1
language plpgsql stable security invoker set search_path='' as $$
begin
  if auth.uid() is not null and (
    core.has_live_cap('warehouse','view_inventory') or core.has_live_cap('warehouse','view_analytics')
    or core.has_live_cap('warehouse','view_finance') or core.has_live_cap('insights','view_warehouse')
  ) is true then
    return query select * from private.warehouse_inventory_position_summary();
  end if;
end $$;
revoke all on function private.warehouse_inventory_position_for_tasks() from public,anon;
grant execute on function private.warehouse_inventory_position_for_tasks() to authenticated,service_role;

-- Keep the task view's source RLS and raw-hold visibility guard. Only use the
-- local putaway quantity so product-wide commitments do not hide staging work.
do $$
declare v_sql text;
begin
  v_sql:=pg_get_viewdef('warehouse.warehouse_tasks'::regclass,true);
  if position('FROM warehouse.inventory_position_v1 "position"' in v_sql)=0
    or position('"position".available' in v_sql)=0 or position('staging.available' in v_sql)=0
    or position('unit.available' in v_sql)=0 then raise exception 'Warehouse putaway quantity anchors changed'; end if;
  v_sql:=replace(replace(replace(v_sql,'"position".available','"position".putaway_available'),
    'staging.available','staging.putaway_available'),'unit.available','unit.putaway_available');
  v_sql:=replace(v_sql,'FROM warehouse.inventory_position_v1 "position"',
    'FROM private.warehouse_inventory_position_for_tasks() "position"');
  execute 'create or replace view warehouse.warehouse_tasks with (security_invoker=true) as '||v_sql;
end $$;
select pg_notify('pgrst','reload schema');
