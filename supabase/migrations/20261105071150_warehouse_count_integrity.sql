-- A count is an observation of a particular stock state, not a reusable delta.
-- Private snapshots cannot be supplied or edited by the browser.
create table private.warehouse_stock_epochs (
  id bigint generated always as identity primary key,
  scope_key text not null
);
create index warehouse_stock_epochs_scope on private.warehouse_stock_epochs(scope_key);
create table private.warehouse_count_snapshots (
  count_id text not null,
  product_id text not null,
  scope_key text not null,
  revision bigint not null,
  facts jsonb not null,
  primary key(count_id,product_id)
);
alter table private.warehouse_stock_epochs enable row level security;
alter table private.warehouse_count_snapshots enable row level security;
revoke all on private.warehouse_stock_epochs,private.warehouse_count_snapshots from public,anon,authenticated;
revoke all on sequence private.warehouse_stock_epochs_id_seq from public,anon,authenticated;

create or replace function private.warehouse_stock_scope(p_product text,p_location text,p_bin text)
returns text language sql immutable set search_path='' as $$
  select jsonb_build_array(p_product,p_location,p_bin)::text
$$;

create or replace function private.warehouse_lock_count_scope(p_product text,p_location text,p_bin text)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_scope text := private.warehouse_stock_scope(p_product,p_location,p_bin); v_revision bigint;
begin
  -- Product-row authorities (including event outcomes) do not all use the
  -- advisory lock. Acquire the FK/valuation row before any inventory rows.
  perform 1 from warehouse.products where id=p_product for share nowait;
  -- Lock existing identities before observing their committed mutation events.
  -- NOWAIT avoids inversion with older authorities that lock units before bulk rows.
  perform 1 from warehouse.stock_levels
    where product_id=p_product and location_id=p_location and bin_id is not distinct from p_bin
    order by lot_id nulls first for update nowait;
  perform 1 from warehouse.inventory_units
    where product_id=p_product and location_id=p_location and bin_id is not distinct from p_bin
      and status in ('in_stock','returned')
    order by id for update nowait;
  select count(*) into v_revision from private.warehouse_stock_epochs where scope_key=v_scope;
  return v_revision;
exception when lock_not_available then
  raise exception 'Stock is being updated by another person. Wait a moment and retry the same count or decision. Nothing was adjusted.';
end $$;

create or replace function private.warehouse_advance_stock_epoch()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_old text; v_new text; v_scope text;
begin
  if tg_op<>'INSERT' then v_old:=private.warehouse_stock_scope(old.product_id,old.location_id,old.bin_id); end if;
  if tg_op<>'DELETE' then v_new:=private.warehouse_stock_scope(new.product_id,new.location_id,new.bin_id); end if;
  for v_scope in select distinct scope from unnest(array[v_old,v_new]) scope where scope is not null order by scope loop
    -- Append-only events do not introduce an epoch-row lock after a stock-row lock.
    -- COUNT (not MAX(sequence)) also observes late commits with earlier sequence IDs.
    insert into private.warehouse_stock_epochs(scope_key) values(v_scope);
  end loop;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
create trigger warehouse_count_epoch before insert or update or delete on warehouse.stock_levels
  for each row execute function private.warehouse_advance_stock_epoch();
create trigger warehouse_count_epoch before insert or update or delete on warehouse.inventory_units
  for each row execute function private.warehouse_advance_stock_epoch();

create or replace function private.warehouse_capture_count(p_count warehouse.cycle_counts,p_line jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_product text:=p_line->>'productId'; v_serialized boolean; v_revision bigint;
  v_lots jsonb; v_observed jsonb; v_units jsonb; v_lot jsonb; v_item jsonb;
  v_expected integer; v_counted integer; v_delta integer; v_gross integer:=0; v_total integer:=0;
begin
  v_revision:=private.warehouse_lock_count_scope(v_product,p_count.location_id,p_count.bin_id);
  select serialized into strict v_serialized from warehouse.products where id=v_product;
  if v_serialized then
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'serialNumber',serial_number) order by id),'[]'::jsonb)
      into v_units from warehouse.inventory_units
      where product_id=v_product and location_id=p_count.location_id and bin_id is not distinct from p_count.bin_id
        and status in ('in_stock','returned')
        and not(serial_number=any(array(select jsonb_array_elements_text(p_line->'serialNumbers'))));
    v_observed:=jsonb_build_object('serialized',true,'missingUnits',v_units);
  else
    if jsonb_typeof(p_line->'counted')<>'number' or coalesce(p_line->>'counted','') !~ '^[0-9]+$' then
      raise exception 'Enter a whole-number count for every item, including zero when none were found.';
    end if;
    v_counted:=(p_line->>'counted')::integer;
    select coalesce(jsonb_agg(jsonb_build_object('lotId',lot_id,'expected',quantity) order by lot_id nulls first),'[]'::jsonb)
      into v_lots from warehouse.stock_levels
      where product_id=v_product and location_id=p_count.location_id and bin_id is not distinct from p_count.bin_id and quantity>0;
    if jsonb_array_length(v_lots)=0 then v_lots:='[{"lotId":null,"expected":0}]'::jsonb; end if;
    if p_line ? 'lotCounts' then
      if jsonb_typeof(p_line->'lotCounts') is distinct from 'array'
        or jsonb_array_length(p_line->'lotCounts')<>jsonb_array_length(v_lots) then
        raise exception 'Count each receipt lot once, including zero when none were found.';
      end if;
      if exists(select 1 from jsonb_array_elements(p_line->'lotCounts') item
          group by item->>'lotId' having count(*)>1) then raise exception 'Each receipt lot must appear only once.'; end if;
    elsif jsonb_array_length(v_lots)>1 then
      raise exception 'Count each receipt lot before submitting this item. Stock will not be taken from an arbitrary receipt.';
    end if;
    v_observed:='[]'::jsonb;
    for v_lot in select value from jsonb_array_elements(v_lots) loop
      if p_line ? 'lotCounts' then
        select value into v_item from jsonb_array_elements(p_line->'lotCounts') where value->>'lotId' is not distinct from v_lot->>'lotId';
        if v_item is null or jsonb_typeof(v_item->'counted') is distinct from 'number'
          or coalesce(v_item->>'counted','') !~ '^[0-9]+$' then raise exception 'Enter a whole-number count for each listed receipt lot.'; end if;
      else v_item:=jsonb_build_object('counted',v_counted); end if;
      v_expected:=(v_lot->>'expected')::integer;
      v_delta:=(v_item->>'counted')::integer-v_expected;
      v_gross:=v_gross+abs(v_delta); v_total:=v_total+(v_item->>'counted')::integer;
      v_observed:=v_observed||jsonb_build_array(v_lot||jsonb_build_object('counted',(v_item->>'counted')::integer,'delta',v_delta));
    end loop;
    if v_total<>v_counted then raise exception 'Receipt-lot counts must add up to the item count.'; end if;
    select sum((value->>'expected')::integer)::integer into v_expected from jsonb_array_elements(v_lots);
    if v_gross<>abs(v_counted-v_expected) then
      raise exception 'Receipt lots have offsetting differences. Recheck the lot labels and counts; do not transfer quantities between receipt lots in a count.';
    end if;
    v_observed:=jsonb_build_object('serialized',false,'lots',v_observed);
  end if;
  insert into private.warehouse_count_snapshots(count_id,product_id,scope_key,revision,facts)
    values(p_count.id,v_product,private.warehouse_stock_scope(v_product,p_count.location_id,p_count.bin_id),v_revision,v_observed);
end $$;

create or replace function private.warehouse_apply_count(p_request warehouse.stock_change_requests)
returns text language plpgsql security definer set search_path='' as $$
declare v_snapshot private.warehouse_count_snapshots; v_revision bigint; v_item jsonb;
  v_movement text; v_first text; v_rows integer; v_delta integer;
begin
  perform private.lock_warehouse_products(array[p_request.product_id]);
  v_revision:=private.warehouse_lock_count_scope(p_request.product_id,p_request.location_id,p_request.bin_id);
  select * into v_snapshot from private.warehouse_count_snapshots
    where count_id=p_request.source_id and product_id=p_request.product_id for update;
  if not found then raise exception 'This older request has no verified stock snapshot. Reject it and submit a new count.'; end if;
  if v_snapshot.scope_key<>private.warehouse_stock_scope(p_request.product_id,p_request.location_id,p_request.bin_id)
    or v_snapshot.revision<>v_revision then
    raise exception 'Stock changed after this count. Nothing was adjusted. Reject this request and submit a new count.';
  end if;
  if (v_snapshot.facts->>'serialized')::boolean then
    if jsonb_array_length(v_snapshot.facts->'missingUnits')<>abs(p_request.quantity_delta) or p_request.quantity_delta>=0 then
      raise exception 'Missing serials no longer match this request. Submit a new count.';
    end if;
    for v_item in select value from jsonb_array_elements(v_snapshot.facts->'missingUnits') loop
      update warehouse.inventory_units set status='lost',assigned_to=null,event_id=null
        where id=v_item->>'id' and product_id=p_request.product_id and serial_number=v_item->>'serialNumber'
          and location_id=p_request.location_id and bin_id is not distinct from p_request.bin_id and status in ('in_stock','returned');
      get diagnostics v_rows=row_count;
      if v_rows<>1 then raise exception 'Stock changed after this count. Submit a new count.'; end if;
      v_movement:='mv-'||replace(gen_random_uuid()::text,'-',''); v_first:=coalesce(v_first,v_movement);
      insert into warehouse.movements(id,type,product_id,quantity,to_location_id,to_bin_id,serial_number,reason,reference,evidence_urls,actor,created_at)
        values(v_movement,'cycle_count',p_request.product_id,-1,p_request.location_id,p_request.bin_id,v_item->>'serialNumber',
          p_request.reason,p_request.id::text,p_request.evidence_urls,coalesce(auth.jwt()->>'email',auth.uid()::text),now());
    end loop;
  else
    if (select sum((value->>'delta')::integer) from jsonb_array_elements(v_snapshot.facts->'lots'))<>p_request.quantity_delta then
      raise exception 'Receipt-lot differences no longer match this request. Submit a new count.';
    end if;
    for v_item in select value from jsonb_array_elements(v_snapshot.facts->'lots') loop
      v_delta:=(v_item->>'delta')::integer;
      if v_delta=0 then continue; end if;
      update warehouse.stock_levels set quantity=quantity+v_delta
        where product_id=p_request.product_id and location_id=p_request.location_id
          and bin_id is not distinct from p_request.bin_id and lot_id is not distinct from v_item->>'lotId'
          and quantity=(v_item->>'expected')::integer and quantity+v_delta>=0;
      get diagnostics v_rows=row_count;
      if v_rows=0 and (v_item->>'expected')::integer=0 and v_delta>0 and v_item->>'lotId' is null then
        insert into warehouse.stock_levels(product_id,location_id,bin_id,lot_id,quantity)
          values(p_request.product_id,p_request.location_id,p_request.bin_id,null,v_delta);
      elsif v_rows<>1 then raise exception 'Stock changed after this count. Submit a new count.'; end if;
      v_movement:='mv-'||replace(gen_random_uuid()::text,'-',''); v_first:=coalesce(v_first,v_movement);
      insert into warehouse.movements(id,type,product_id,quantity,to_location_id,to_bin_id,lot_id,reason,reference,evidence_urls,actor,created_at)
        values(v_movement,'cycle_count',p_request.product_id,v_delta,p_request.location_id,p_request.bin_id,v_item->>'lotId',
          p_request.reason,p_request.id::text,p_request.evidence_urls,coalesce(auth.jwt()->>'email',auth.uid()::text),now());
    end loop;
  end if;
  return v_first;
end $$;

-- Extend the deployed functions without replacing the approval ladder, ledger or receipt authority.
-- Exact anchors fail migration on drift instead of silently weakening the active contract.
do $$
declare v_sql text; v_old text; v_new text; v_start integer; v_end integer;
begin
  v_sql:=replace(pg_get_functiondef('private.warehouse_submit_cycle_count(jsonb)'::regprocedure),E'\r','');
  v_start:=position(E'  perform 1\n    from warehouse.stock_levels' in v_sql);
  v_end:=position('  for v_line in select value from jsonb_array_elements(v_count.lines)' in v_sql);
  if v_start=0 or v_end<=v_start then raise exception 'Count submission lock anchor changed'; end if;
  v_new:=$patch$  perform private.lock_warehouse_products(array(select value->>'productId' from jsonb_array_elements(v_count.lines)));
  for v_product_id in select value->>'productId' from jsonb_array_elements(v_count.lines) order by value->>'productId' loop
    perform private.warehouse_lock_count_scope(v_product_id,v_count.location_id,v_count.bin_id);
  end loop;
$patch$;
  v_sql:=overlay(v_sql placing v_new from v_start for v_end-v_start);
  v_old:='    v_variance := v_counted - v_expected;';
  if position(v_old in v_sql)=0 then raise exception 'Count snapshot anchor changed'; end if;
  v_sql:=replace(v_sql,v_old,E'    perform private.warehouse_capture_count(v_count,jsonb_set(v_line,''{_serverExpected}'',to_jsonb(v_expected)));\n'||v_old);
  v_old:=E'      ''serialNumbers'', v_serials\n    ));';
  if position(v_old in v_sql)=0 then raise exception 'Count lot review anchor changed'; end if;
  v_sql:=replace(v_sql,v_old,$patch$      'serialNumbers', v_serials,
      'lotCounts', coalesce((select facts->'lots' from private.warehouse_count_snapshots
        where count_id=v_count.id and product_id=v_product_id),'[]'::jsonb)
    ));$patch$);
  v_sql:=replace(v_sql,'core.has_cap(''warehouse'', ''cycle_count'')','core.has_live_cap(''warehouse'', ''cycle_count'')');
  execute v_sql;

  v_sql:=replace(pg_get_functiondef('private.warehouse_decide_stock_change(jsonb)'::regprocedure),E'\r','');
  v_old:='core.has_cap(v_group.module,v_group.capability)';
  if position(v_old in v_sql)=0 then raise exception 'Approval authority anchor changed'; end if;
  v_sql:=replace(v_sql,v_old,'core.has_live_cap(v_group.module,v_group.capability)');
  v_old:=$patch$       and membership.role=any(v_group.member_roles)
       and catalogue_role.is_active$patch$;
  if length(v_sql)-length(replace(v_sql,v_old,''))<>length(v_old) then
    raise exception 'Stock approval membership anchor changed';
  end if;
  v_new:=$patch$       and membership.role=any(v_group.member_roles)
       and membership.effective_at<=pg_catalog.statement_timestamp()
       and (membership.expires_at is null or membership.expires_at>pg_catalog.statement_timestamp())
       and catalogue_role.is_active$patch$;
  v_sql:=replace(v_sql,v_old,v_new);
  v_start:=position('    if v_product.serialized then' in v_sql);
  v_end:=position('    update warehouse.stock_change_requests set status=''approved''' in v_sql);
  if v_start=0 or v_end<=v_start then raise exception 'Stock adjustment anchors changed'; end if;
  v_old:=substring(v_sql from v_start for v_end-v_start);
  v_new:=$patch$    if v_request.source_type='cycle_count' then
      v_movement_id:=private.warehouse_apply_count(v_request);
    else
$patch$||v_old||E'    end if;\n';
  v_sql:=overlay(v_sql placing v_new from v_start for v_end-v_start);
  execute v_sql;
end $$;

create or replace function private.warehouse_guard_stocked_location()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (new.type is distinct from old.type or (old.active and not new.active)) and (
    exists(select 1 from warehouse.stock_levels where location_id=old.id and quantity>0)
    or exists(select 1 from warehouse.inventory_units where location_id=old.id and status not in ('issued','vendor_return','lost'))
  ) then raise exception 'This location still holds stock. Move or reconcile that stock before changing its type or making it inactive. You can still rename it.'; end if;
  return new;
end $$;
create trigger warehouse_stocked_location_guard before update of type,active on warehouse.locations
  for each row execute function private.warehouse_guard_stocked_location();

revoke all on function private.warehouse_stock_scope(text,text,text),private.warehouse_lock_count_scope(text,text,text),
  private.warehouse_advance_stock_epoch(),private.warehouse_capture_count(warehouse.cycle_counts,jsonb),
  private.warehouse_apply_count(warehouse.stock_change_requests),private.warehouse_guard_stocked_location()
  from public,anon,authenticated;
select pg_notify('pgrst','reload schema');
