-- Net stock value remains backward compatible. Approval exposure includes both
-- sides of a lot correction at the existing product-cost valuation basis.
alter table warehouse.stock_change_requests
  add column gross_quantity bigint,
  add column approval_exposure numeric generated always as
    (coalesce(gross_quantity,abs(quantity_delta::bigint))*unit_cost) stored;

alter table warehouse.stock_change_requests
  drop constraint warehouse_stock_change_quantity_check,
  add constraint warehouse_stock_change_quantity_check check (
    quantity_delta<>0 or (source_type='cycle_count' and coalesce(gross_quantity,0)>0)
  ),
  add constraint warehouse_stock_change_gross_quantity_check check (
    gross_quantity is null or (source_type='cycle_count'
      and gross_quantity>0 and gross_quantity>=abs(quantity_delta::bigint))
  );

create or replace function private.warehouse_capture_count(p_count warehouse.cycle_counts,p_line jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_product text:=p_line->>'productId'; v_serialized boolean; v_unit_cost numeric;
  v_revision bigint; v_final_revision bigint; v_expected bigint:=0;
  v_lots jsonb; v_observed jsonb; v_units jsonb; v_lot jsonb; v_item jsonb;
  v_counted integer; v_delta integer; v_gross bigint:=0; v_total bigint:=0;
begin
  v_revision:=private.warehouse_lock_count_scope(v_product,p_count.location_id,p_count.bin_id);
  select serialized,unit_cost into strict v_serialized,v_unit_cost
    from warehouse.products where id=v_product for share;
  if v_serialized then
    v_counted:=jsonb_array_length(coalesce(p_line->'serialNumbers','[]'::jsonb));
    select coalesce(jsonb_agg(jsonb_build_object('id',id,'serialNumber',serial_number) order by id),'[]'::jsonb)
      into v_units from warehouse.inventory_units
      where product_id=v_product and location_id=p_count.location_id and bin_id is not distinct from p_count.bin_id
        and status in ('in_stock','returned')
        and not(serial_number=any(array(select jsonb_array_elements_text(p_line->'serialNumbers'))));
    v_gross:=jsonb_array_length(v_units);
    v_expected:=v_counted::bigint+v_gross;
    v_observed:=jsonb_build_object('serialized',true,'missingUnits',v_units);
  else
    if jsonb_typeof(p_line->'counted') is distinct from 'number'
      or coalesce(p_line->>'counted','') !~ '^[0-9]+$' then
      raise exception 'Enter a whole-number count for every item, including zero when none were found.';
    end if;
    v_counted:=(p_line->>'counted')::integer;
    -- A depleted receipt remains a known identity; never replace it with null.
    select coalesce(jsonb_agg(jsonb_build_object('lotId',lot_id,'expected',quantity) order by lot_id nulls first),'[]'::jsonb)
      into v_lots from warehouse.stock_levels
      where product_id=v_product and location_id=p_count.location_id and bin_id is not distinct from p_count.bin_id;
    if jsonb_array_length(v_lots)=0 then v_lots:='[{"lotId":null,"expected":0}]'::jsonb; end if;
    if p_line ? 'lotCounts' then
      if jsonb_typeof(p_line->'lotCounts') is distinct from 'array' then
        raise exception 'Count each receipt lot once, including zero when none were found.';
      end if;
      if jsonb_array_length(p_line->'lotCounts')<>jsonb_array_length(v_lots) then
        raise exception 'Count each receipt lot once, including zero when none were found.';
      end if;
      if exists(select 1 from jsonb_array_elements(p_line->'lotCounts') item
          where jsonb_typeof(item) is distinct from 'object' or not(item ? 'lotId')
            or jsonb_typeof(item->'lotId') not in ('string','null')
            or (jsonb_typeof(item->'lotId')='string' and btrim(item->>'lotId')='')) then
        raise exception 'Choose the receipt lot identity for every count.';
      end if;
      if exists(select 1 from jsonb_array_elements(p_line->'lotCounts') item
          group by item->>'lotId' having count(*)>1) then
        raise exception 'Each receipt lot must appear only once.';
      end if;
    elsif jsonb_array_length(v_lots)>1 then
      raise exception 'Count each receipt lot, including zero-balance lots, before submitting this item.';
    end if;
    v_observed:='[]'::jsonb;
    for v_lot in select value from jsonb_array_elements(v_lots) loop
      if (v_lot->>'expected')::integer<0 then
        raise exception 'Negative receipt-lot stock needs reconciliation before counting.';
      end if;
      if p_line ? 'lotCounts' then
        select value into v_item from jsonb_array_elements(p_line->'lotCounts')
          where value->>'lotId' is not distinct from v_lot->>'lotId';
        if v_item is null or jsonb_typeof(v_item->'counted') is distinct from 'number'
          or coalesce(v_item->>'counted','') !~ '^[0-9]+$' then
          raise exception 'Enter a whole-number count for each listed receipt lot.';
        end if;
      else v_item:=jsonb_build_object('counted',v_counted); end if;
      v_delta:=(v_item->>'counted')::integer-(v_lot->>'expected')::integer;
      v_gross:=v_gross+abs(v_delta::bigint);
      v_expected:=v_expected+(v_lot->>'expected')::integer;
      v_total:=v_total+(v_item->>'counted')::integer;
      v_observed:=v_observed||jsonb_build_array(v_lot||jsonb_build_object('counted',(v_item->>'counted')::integer,'delta',v_delta));
    end loop;
    if v_total<>v_counted then raise exception 'Receipt-lot counts must add up to the item count.'; end if;
    v_observed:=jsonb_build_object('serialized',false,'lots',v_observed);
  end if;
  -- The submitter overwrites this key with its server calculation. A committed
  -- phantom between its reads and capture must not produce mixed-state facts.
  select count(*) into v_final_revision from private.warehouse_stock_epochs
    where scope_key=private.warehouse_stock_scope(v_product,p_count.location_id,p_count.bin_id);
  if v_expected is distinct from (p_line->>'_serverExpected')::bigint or v_final_revision<>v_revision then
    raise exception 'Stock changed while this count was being submitted. Nothing was adjusted. Refresh and recount this item.';
  end if;
  v_observed:=v_observed||jsonb_build_object('grossQuantity',v_gross,
    'netQuantity',v_counted::bigint-v_expected,'unitCost',v_unit_cost);
  insert into private.warehouse_count_snapshots(count_id,product_id,scope_key,revision,facts)
    values(p_count.id,v_product,private.warehouse_stock_scope(v_product,p_count.location_id,p_count.bin_id),v_revision,v_observed);
end $$;

create or replace function private.warehouse_normalize_count_exposure()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_snapshot private.warehouse_count_snapshots;
begin
  if tg_op='UPDATE' then
    if (old.source_type='cycle_count' or new.source_type='cycle_count') and
      row(new.id,new.source_type,new.source_id,new.product_id,new.location_id,new.bin_id,
          new.quantity_delta,new.unit_cost,new.gross_quantity,new.requested_by)
      is distinct from
      row(old.id,old.source_type,old.source_id,old.product_id,old.location_id,old.bin_id,
          old.quantity_delta,old.unit_cost,old.gross_quantity,old.requested_by) then
      raise exception 'Submitted count identity, valuation and gross exposure are immutable.';
    end if;
    return new;
  end if;
  if new.source_type<>'cycle_count' then
    new.gross_quantity:=null;
    return new;
  end if;
  select * into v_snapshot from private.warehouse_count_snapshots
    where count_id=new.source_id and product_id=new.product_id;
  if not found or v_snapshot.scope_key<>private.warehouse_stock_scope(new.product_id,new.location_id,new.bin_id)
    or not(v_snapshot.facts ?& array['netQuantity','grossQuantity','unitCost']) then
    raise exception 'A stock change requires verified count exposure. Submit a new count.';
  end if;
  if new.quantity_delta is distinct from (v_snapshot.facts->>'netQuantity')::integer then
    raise exception 'Stock changed while this count was being submitted. Refresh and recount this item.';
  end if;
  new.gross_quantity:=(v_snapshot.facts->>'grossQuantity')::bigint;
  new.unit_cost:=(v_snapshot.facts->>'unitCost')::numeric;
  return new;
end $$;
create trigger warehouse_count_exposure before insert or update on warehouse.stock_change_requests
  for each row execute function private.warehouse_normalize_count_exposure();

-- Retain the current lock/auth/ledger implementation installed by the preceding
-- migration, changing only request creation and its existing approval threshold.
do $$
declare v_sql text; v_old text;
begin
  v_sql:=replace(pg_get_functiondef('private.warehouse_submit_cycle_count(jsonb)'::regprocedure),E'\r','');
  v_old:='    if v_variance <> 0 then';
  if position(v_old in v_sql)=0 or position('''{_serverExpected}''' in v_sql)=0 then
    raise exception 'Count exposure submission anchors changed';
  end if;
  v_sql:=replace(v_sql,v_old,$patch$    if (select (facts->>'grossQuantity')::bigint from private.warehouse_count_snapshots
      where count_id=v_count.id and product_id=v_product_id)>0 then$patch$);
  v_old:='v_request.financial_impact > 10000';
  if (length(v_sql)-length(replace(v_sql,v_old,'')))/length(v_old)<>2 then
    raise exception 'Count exposure approval threshold anchors changed';
  end if;
  v_sql:=replace(v_sql,v_old,'v_request.approval_exposure > 10000');
  execute v_sql;
end $$;

revoke all on function private.warehouse_capture_count(warehouse.cycle_counts,jsonb),
  private.warehouse_normalize_count_exposure() from public,anon,authenticated;
select pg_notify('pgrst','reload schema');
