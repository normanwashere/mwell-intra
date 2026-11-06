-- Additive UAT archive. Original business rows, status, quantities and history stay intact.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

create table private.uat_warehouse_archive_batches (
  batch_id text primary key check (batch_id ~ '^uat-[a-z0-9][a-z0-9-]{4,119}$'),
  manifest jsonb not null check (jsonb_typeof(manifest)='array' and jsonb_array_length(manifest)>0),
  archived_at timestamptz not null default now(),
  database_actor text not null default session_user
);
create table private.uat_warehouse_archive_members (
  table_name text not null,
  row_id text not null,
  batch_id text not null references private.uat_warehouse_archive_batches(batch_id),
  row_md5 text not null check (row_md5 ~ '^[0-9a-f]{32}$'),
  provenance text not null check (length(btrim(provenance))>=10),
  primary key(table_name,row_id)
);
create index uat_warehouse_archive_member_identity on private.uat_warehouse_archive_members(row_id);
create index uat_warehouse_archive_member_batch on private.uat_warehouse_archive_members(batch_id);
alter table private.uat_warehouse_archive_batches owner to postgres;
alter table private.uat_warehouse_archive_members owner to postgres;
alter table private.uat_warehouse_archive_batches enable row level security;
alter table private.uat_warehouse_archive_batches force row level security;
alter table private.uat_warehouse_archive_members enable row level security;
alter table private.uat_warehouse_archive_members force row level security;
revoke all on private.uat_warehouse_archive_batches,private.uat_warehouse_archive_members from public,anon,authenticated,service_role;

create function private.uat_warehouse_archive_immutable() returns trigger
language plpgsql set search_path='' as $$
begin raise exception 'Warehouse test archives are immutable'; end $$;
revoke all on function private.uat_warehouse_archive_immutable() from public,anon,authenticated,service_role;
create trigger archive_batches_immutable before update or delete or truncate on private.uat_warehouse_archive_batches
for each statement execute function private.uat_warehouse_archive_immutable();
create trigger archive_members_immutable before update or delete or truncate on private.uat_warehouse_archive_members
for each statement execute function private.uat_warehouse_archive_immutable();

create function private.is_uat_warehouse_archived(p_table text,p_id text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.uat_warehouse_archive_members where table_name=p_table and row_id=p_id)
$$;
alter function private.is_uat_warehouse_archived(text,text) owner to postgres;
revoke all on function private.is_uat_warehouse_archived(text,text) from public,anon,authenticated,service_role;
grant execute on function private.is_uat_warehouse_archived(text,text) to authenticated,service_role;

-- Inspect only identity-bearing fields, never evidence URLs, free text, prices or actor IDs.
create function private.uat_warehouse_references(p_row jsonb,p_table text default null) returns table(target_table text,target_id text)
language plpgsql immutable set search_path='' as $$
declare pair record; child jsonb; target text;
begin
  if jsonb_typeof(p_row)='array' then
    for child in select value from jsonb_array_elements(p_row) loop
      return query select * from private.uat_warehouse_references(child);
    end loop;
  elsif jsonb_typeof(p_row)='object' then
    for pair in select * from jsonb_each(p_row) loop
      target:=case
        when pair.key in ('product_id','productId','warehouse_product_id','warehouseProductId') then 'products'
        when pair.key in ('unit_id','unitId') then 'inventory_units'
        when pair.key in ('lot_id','lotId') then 'lots'
        when pair.key in ('order_id','orderId','source_order_id','sourceOrderId','replacement_order_id','parent_order_id','fulfillment_order_id') then 'fulfillment_orders'
        when pair.key in ('source_return_case_id','return_case_id','returnCaseId') then 'customer_return_cases'
        when pair.key in ('event_id','eventId') then 'events'
        when pair.key='inspection_id' then 'quality_inspections'
        when pair.key='hold_id' then 'inventory_holds'
        when pair.key='source_receipt_id' then 'receipts'
        when pair.key='source_return_id' then 'returns'
        when pair.key='kit_definition_id' then 'kit_definitions'
        when pair.key='allocationId' then 'allocations'
        when pair.key in ('bin_id','binId','source_bin_id','quarantine_bin_id','from_bin_id','to_bin_id') then 'storage_areas'
        when pair.key in ('source_id','sourceId') then case p_row->>'source_type'
          when 'receipt' then 'receipts' when 'return' then 'returns' when 'cycle_count' then 'cycle_counts'
          when 'stock_change' then 'stock_change_requests' when 'stock_change_request' then 'stock_change_requests'
          when 'quality_inspection' then 'quality_inspections' when 'fulfillment_order' then 'fulfillment_orders' end
        when pair.key='reference' and p_table='movements' then 'fulfillment_orders'
      end;
      if target is not null and jsonb_typeof(pair.value)='string' then
        target_table:=target; target_id:=pair.value #>> '{}'; return next;
      elsif pair.key=any(array['lines','components','packaging','changes']) then
        return query select * from private.uat_warehouse_references(pair.value);
      end if;
    end loop;
  end if;
end $$;
alter function private.uat_warehouse_references(jsonb,text) owner to postgres;
revoke all on function private.uat_warehouse_references(jsonb,text) from public,anon,authenticated,service_role;

create function private.guard_uat_archived_warehouse_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare image jsonb;
begin
  -- A repeatable snapshot could predate a completed archive after waiting for its fence.
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='40001',message='Please retry this Warehouse change in a new session.';
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('uat-warehouse-fixture-archive',0));
  if not exists(select 1 from private.uat_warehouse_archive_members) then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  foreach image in array case when tg_op='INSERT' then array[to_jsonb(new)]
    when tg_op='DELETE' then array[to_jsonb(old)] else array[to_jsonb(old),to_jsonb(new)] end loop
    if private.is_uat_warehouse_archived(tg_table_name,image->>'id') or
      exists(select 1 from private.uat_warehouse_references(image,tg_table_name) ref
        join private.uat_warehouse_archive_members a on a.table_name=ref.target_table and a.row_id=ref.target_id) or
      (tg_table_name='movements' and exists(select 1 from warehouse.fulfillment_orders o
        join private.uat_warehouse_archive_members a on a.table_name='fulfillment_orders' and a.row_id=o.id::text
        where o.external_reference=image->>'reference')) then
      raise exception using errcode='P0001',message='This is an archived UAT test record. Choose an active record to continue.';
    end if;
  end loop;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
alter function private.guard_uat_archived_warehouse_write() owner to postgres;
revoke all on function private.guard_uat_archived_warehouse_write() from public,anon,authenticated,service_role;

do $$ declare t text; begin
  foreach t in array array['products','inventory_units','stock_levels','lots','allocations','fulfillment_orders',
    'fulfillment_reservations','department_stock_requests','customer_return_cases','receipts','returns',
    'cycle_counts','quality_inspections','inventory_holds','vendor_returns','stock_change_requests',
    'exceptions','kit_definitions','rekit_work_orders','storage_areas','events'] loop
    execute format('create view warehouse.%I with (security_invoker=true) as select * from warehouse.%I t where not private.is_uat_warehouse_archived(%L,t.id::text)', 'active_'||t,t,t);
    execute format('revoke all on warehouse.%I from public,anon,authenticated,service_role','active_'||t);
    execute format('grant select on warehouse.%I to authenticated,service_role','active_'||t);
    execute format('create trigger uat_archived_record_write_guard before insert or update or delete on warehouse.%I for each row execute function private.guard_uat_archived_warehouse_write()',t);
  end loop;
  create trigger uat_archived_record_write_guard before insert or update or delete on warehouse.movements
    for each row execute function private.guard_uat_archived_warehouse_write();
end $$;

create view warehouse.active_movements with (security_invoker=true) as
select * from warehouse.movements m where not private.is_uat_warehouse_archived('products',m.product_id);
revoke all on warehouse.active_movements from public,anon,authenticated,service_role;
grant select on warehouse.active_movements to authenticated,service_role;

create function private.archive_uat_warehouse_fixture(p_batch text,p_manifest jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare entry jsonb; existing jsonb; image jsonb; t text; rid text; seen text[]:='{}'; n integer:=0; protected boolean;
begin
  if session_user<>'postgres' then raise exception 'Database maintenance session required'; end if;
  if current_setting('transaction_isolation')<>'read committed' then raise exception 'Archive requires READ COMMITTED isolation'; end if;
  if p_batch is null or p_batch !~ '^uat-[a-z0-9][a-z0-9-]{4,119}$' or jsonb_typeof(p_manifest) is distinct from 'array'
    or jsonb_array_length(p_manifest) not between 1 and 20000 then raise exception 'Invalid archive manifest'; end if;
  perform pg_advisory_xact_lock(hashtextextended('uat-warehouse-fixture-archive',0));
  select manifest into existing from private.uat_warehouse_archive_batches where batch_id=p_batch;
  if found then
    if existing is distinct from p_manifest then raise exception 'Archive manifest changed'; end if;
  end if;
  for entry in select value from jsonb_array_elements(p_manifest) order by value->>'table',value->>'row_id' loop
    t:=entry->>'table'; rid:=entry->>'row_id';
    if t is null or t<>all(array['products','inventory_units','stock_levels','lots','allocations','fulfillment_orders',
      'fulfillment_reservations','department_stock_requests','customer_return_cases','receipts','returns',
      'cycle_counts','quality_inspections','inventory_holds','vendor_returns','stock_change_requests',
      'exceptions','kit_definitions','rekit_work_orders']) then raise exception 'Archive table is not allowed'; end if;
    if rid is null or rid='' or t||':'||rid=any(seen) then raise exception 'Invalid or duplicate archive identity'; end if;
    seen:=array_append(seen,t||':'||rid);
    execute format('select to_jsonb(t) from warehouse.%I t where id::text=$1 for update',t) into image using rid;
    if image is null or md5(image::text) is distinct from entry->>'row_md5' then raise exception 'Archive row changed or hash mismatched: %.%',t,rid; end if;
    if rid like 'master-%' or rid like 'uat-open-unit-%' or
      (t='products' and image->'attributes' ? 'Master data') or
      (t in ('inventory_units','stock_levels','lots') and exists(select 1 from warehouse.products p
        where p.id=image->>'product_id' and (p.id like 'master-%' or p.attributes ? 'Master data'))) then
      raise exception 'Masterlist data cannot be archived: %.%',t,rid;
    end if;
    if t='inventory_units' and to_regclass('private.uat_admin_reset_archives') is not null then
      execute 'select exists(select 1 from private.uat_admin_reset_archives a
        cross join lateral jsonb_array_elements(a.planned_inserts->''units'') u
        where a.batch_id=''uat-masterlist-opening-1018-20261019-v1'' and u->>''id''=$1)' into protected using rid;
      if protected then raise exception 'Masterlist opening identity cannot be archived'; end if;
    end if;
    if t='products' then
      if image->'attributes'->'synthetic' is distinct from 'true'::jsonb then raise exception 'Explicit synthetic product ownership required'; end if;
    else
      if exists(select 1 from private.uat_warehouse_references(image,t) ref
        where ref.target_table='products' and not exists(select 1 from warehouse.products p
          where p.id=ref.target_id and p.attributes->'synthetic'='true'::jsonb and not p.attributes ? 'Master data'
          and exists(select 1 from jsonb_array_elements(p_manifest) e where e->>'table'='products' and e->>'row_id'=p.id))) then
        raise exception 'Mixed or foreign product data cannot be archived: %.%',t,rid;
      end if;
      if not exists(select 1 from private.uat_warehouse_references(image,t) ref
        join jsonb_array_elements(p_manifest) e on e->>'table'=ref.target_table and e->>'row_id'=ref.target_id) then
        raise exception 'Row is outside the declared synthetic graph: %.%',t,rid;
      end if;
    end if;
  end loop;
  if existing is not null then
    if (select count(*) from private.uat_warehouse_archive_members where batch_id=p_batch)<>jsonb_array_length(existing) then
      raise exception 'Archive membership is incomplete'; end if;
    return jsonb_build_object('batch_id',p_batch,'archived',jsonb_array_length(existing),'replayed',true);
  end if;
  insert into private.uat_warehouse_archive_batches(batch_id,manifest) values(p_batch,p_manifest);
  for entry in select value from jsonb_array_elements(p_manifest) loop
    insert into private.uat_warehouse_archive_members(table_name,row_id,batch_id,row_md5,provenance)
      values(entry->>'table',entry->>'row_id',p_batch,entry->>'row_md5',entry->>'provenance');
    n:=n+1;
  end loop;
  return jsonb_build_object('batch_id',p_batch,'archived',n,'replayed',false);
end $$;
alter function private.archive_uat_warehouse_fixture(text,jsonb) owner to postgres;
revoke all on function private.archive_uat_warehouse_fixture(text,jsonb) from public,anon,authenticated,service_role;
