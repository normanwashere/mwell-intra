-- Only audited administrative restorations gain a superseded-custody boundary.
-- Execute through the transaction-scoped migration runner. No business writes.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

do $predecessors$
declare expected record;
begin
  for expected in select * from (values
    ('warehouse.record_return_v2(jsonb)','f37beb288eff1b032b9b0c56b7f4639d'),
    ('warehouse.record_return_v2_certified_impl(jsonb)','43fbb6a6f224e7401ae20983b34534d3'),
    ('warehouse.resolve_customer_return_case(jsonb)','2c48a8aa08e32065a88f06e96a0562c1'),
    ('private.warehouse_create_customer_return_case(jsonb)','86eca4c774b5069bd7423a29f7f86713'),
    ('private.warehouse_resolve_customer_return_case(jsonb)','8184a151fc660a8abcf9bbd9171fc6f2')
  ) source(signature,body_md5) loop
    if not exists(select 1 from pg_catalog.pg_proc where oid=to_regprocedure(expected.signature)
      and md5(replace(prosrc,chr(13),''))=expected.body_md5) then
      raise exception 'Restored-unit return predecessor drift: %',expected.signature;
    end if;
  end loop;
end;
$predecessors$;

create function private.guard_restored_unit_return(payload jsonb, command_name text)
returns void language plpgsql security definer set search_path='' as $$
declare
  lines jsonb; line jsonb; case_row warehouse.customer_return_cases;
  source_order uuid; explicit_order uuid; order_row warehouse.fulfillment_orders;
  unit_row warehouse.inventory_units; archive_row private.uat_admin_reset_archives;
  membership jsonb; entry jsonb; before_unit jsonb; restored_history jsonb;
  cutoff bigint; issue_history private.warehouse_unit_history; issuance_history private.warehouse_unit_history;
  current_history private.warehouse_unit_history; affected boolean;
  v_event_id text; v_allocation_id text; event_return boolean; intake_proven boolean;
begin
  if command_name='intake' then
    if jsonb_typeof(payload#>'{return,lines}') is distinct from 'array' then return; end if;
    lines:=payload#>'{return,lines}';
    if jsonb_array_length(lines) not between 1 and 1000 then return; end if;
    explicit_order:=nullif(payload#>>'{return,source_order_id}','')::uuid;
    if nullif(payload#>>'{return,return_case_id}','') is not null then
      select * into case_row from warehouse.customer_return_cases
        where id=(payload#>>'{return,return_case_id}')::uuid for share;
    end if;
    source_order:=coalesce(explicit_order,case_row.source_order_id);
    v_event_id:=nullif(payload#>>'{return,event_id}','');
    event_return:=payload#>>'{return,source}'='event';
  elsif command_name='create_case' then
    source_order:=nullif(payload->>'source_order_id','')::uuid;
    select * into case_row from warehouse.customer_return_cases where id=(payload->>'return_case_id')::uuid for share;
    lines:=jsonb_build_array(jsonb_build_object('productId',payload->>'product_id','serialNumber',payload->>'serial_number'));
  elsif command_name='resolve_case' then
    select * into case_row from warehouse.customer_return_cases
      where id=(payload->>'return_case_id')::uuid for update;
    if not found then return; end if;
    source_order:=case_row.source_order_id;
    lines:=jsonb_build_array(jsonb_build_object('productId',case_row.product_id,'serialNumber',case_row.serial_number));
  else raise exception 'Unsupported restored-unit return command';
  end if;
  if source_order is not null then
    select * into order_row from warehouse.fulfillment_orders where id=source_order for share;
  end if;
  if coalesce(event_return,false) then
    perform 1 from warehouse.events where id=v_event_id for update;
    perform 1 from warehouse.allocations where event_id=v_event_id and id in (
      select coalesce(nullif(l->>'allocationId',''),nullif(payload->>'allocation_id',''))
      from jsonb_array_elements(lines) l) order by id for update;
  end if;
  -- The maintenance transaction takes these same product locks before units and
  -- inserts its archive before commit. Read the archive only after the unit lock.
  perform private.lock_warehouse_products(array(select distinct x->>'productId' from jsonb_array_elements(lines) x));
  for line in select value from jsonb_array_elements(lines) order by value->>'productId',value->>'serialNumber' loop
    if nullif(btrim(line->>'serialNumber'),'') is null then continue; end if;
    select * into unit_row from warehouse.inventory_units
      where product_id=line->>'productId' and upper(btrim(serial_number))=upper(btrim(line->>'serialNumber')) for update;
    if not found then continue; end if;
    cutoff:=0; affected:=false;
    for archive_row in select a.* from private.uat_admin_reset_archives a
      where a.operation='restore_test_issued_units' and (
        exists(select 1 from jsonb_array_elements(a.row_images) r
          where r->>'table'='warehouse.inventory_units' and r#>>'{row,id}'=unit_row.id)
        or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(a.planned_inserts->'restored_issuances')='array'
          then a.planned_inserts->'restored_issuances' else '[]'::jsonb end) r where r->>'unit_id'=unit_row.id))
    loop
      affected:=true; membership:=archive_row.planned_inserts->'restored_issuances';
      if jsonb_typeof(membership) is distinct from 'array'
        or (select count(*) from jsonb_array_elements(archive_row.row_images) r
          where r->>'kind'='restored_issuances' and r->'rows'=membership)<>1
        or (select count(*) from jsonb_array_elements(membership) r where r->>'unit_id'=unit_row.id)<>1 then
        raise exception 'Restored unit audit membership is incomplete';
      end if;
      select value into entry from jsonb_array_elements(membership) where value->>'unit_id'=unit_row.id;
      select r->'row' into before_unit from jsonb_array_elements(archive_row.row_images) r
        where r->>'table'='warehouse.inventory_units' and r#>>'{row,id}'=unit_row.id;
      if before_unit is null or entry->>'serial_number' is distinct from unit_row.serial_number
        or entry->>'product_id' is distinct from before_unit->>'product_id'
        or entry->>'serial_number' is distinct from before_unit->>'serial_number'
        or not exists(select 1 from warehouse.movements m join warehouse.fulfillment_orders o
          on o.id::text=entry->>'source_order_id'
          where m.id=entry->>'source_issue_movement_id' and m.reference=o.id::text
            and m.type='fulfillment_release' and m.quantity=1 and m.product_id=entry->>'product_id'
            and m.serial_number=entry->>'serial_number' and o.external_reference=before_unit->>'assigned_to')
        or not exists(select 1 from warehouse.movements m where m.id=entry->>'restoration_movement_id'
          and m.type='adjustment' and m.quantity=1 and m.reference=entry->>'source_issue_movement_id'
          and m.product_id=entry->>'product_id' and m.serial_number=entry->>'serial_number') then
        raise exception 'Restored unit audit issuance is incomplete';
      end if;
      select h into restored_history from jsonb_array_elements(archive_row.planned_inserts->'history') h
        where h->>'unit_id'=unit_row.id and h->'before_state'=before_unit
          and h->'after_state'=before_unit||jsonb_build_object('status','in_stock','assigned_to',null);
      if restored_history is null or not exists(select 1 from private.warehouse_unit_history h
        where h.id=(restored_history->>'id')::bigint and to_jsonb(h)=restored_history) then
        raise exception 'Restored unit audit history is incomplete';
      end if;
      cutoff:=greatest(cutoff,(restored_history->>'id')::bigint);
      if source_order::text=entry->>'source_order_id' then
        raise exception 'This watch was restored to stock during UAT cleanup. Use its current order for a return, not this old test order.';
      end if;
    end loop;
    if not affected then continue; end if;

    select * into issuance_history from private.warehouse_unit_history h
      where h.unit_id=unit_row.id and h.id>cutoff and h.after_state->>'status'='issued'
        and h.before_state->>'status' is distinct from 'issued' order by h.id desc limit 1;
    if not found then raise exception 'This watch has not been issued again since UAT cleanup. A return needs a current issue.'; end if;
    select * into issue_history from private.warehouse_unit_history h where h.unit_id=unit_row.id
      and h.id>=issuance_history.id and h.after_state->>'status'='issued' order by h.id desc limit 1;
    if issue_history.after_state->>'assigned_to' is distinct from issuance_history.after_state->>'assigned_to'
      or issue_history.after_state->>'product_id' is distinct from unit_row.product_id
      or issue_history.after_state->>'serial_number' is distinct from unit_row.serial_number then
      raise exception 'This watch has not been issued again since UAT cleanup. A return needs a current issue.';
    end if;
    if coalesce(event_return,false) then
      v_allocation_id:=coalesce(nullif(payload->>'allocation_id',''),nullif(line->>'allocationId',''));
      if source_order is not null or case_row.id is not null or v_event_id is null
        or unit_row.event_id is distinct from v_event_id then
        raise exception 'Choose the event that currently holds this watch.';
      end if;
      -- Existing intake/event authorities retain allocation, sale, giveaway,
      -- acknowledgement and exact serial eligibility checks below this boundary.
    else
      if exists(select 1 from private.event_custody_sources s
        where s.order_id=source_order and s.product_id=unit_row.product_id
          and unit_row.serial_number=any(s.serial_numbers)) then
        raise exception 'Choose the event that currently holds this watch.';
      end if;
      if (command_name='intake' and payload#>>'{return,source}' is distinct from 'customer')
        or order_row.id is null or order_row.status not in ('released','completed')
        or issue_history.after_state->>'assigned_to' is distinct from order_row.external_reference
        or (case_row.id is not null and source_order is distinct from case_row.source_order_id)
        or (case_row.id is not null and (case_row.product_id is distinct from unit_row.product_id
          or upper(btrim(case_row.serial_number)) is distinct from unit_row.serial_number))
        or not exists(select 1 from jsonb_array_elements(order_row.lines) l
          cross join lateral jsonb_array_elements_text(coalesce(l->'pickedSerialNumbers','[]'::jsonb)) s
          where l->>'productId'=unit_row.product_id and upper(btrim(s))=unit_row.serial_number)
        or not exists(select 1 from warehouse.movements m where m.reference=order_row.id::text
          and m.type='fulfillment_release' and m.product_id=unit_row.product_id and m.serial_number=unit_row.serial_number and m.quantity=1) then
        raise exception 'Use this watch''s current order and matching return case.';
      end if;
    end if;

    -- A legitimate intake may already have posted this later issuance to
    -- quarantine. Recognize its real history/return row, never invent evidence.
    select * into current_history from private.warehouse_unit_history where unit_id=unit_row.id order by id desc limit 1;
    if unit_row.status='issued' and to_jsonb(unit_row)=issue_history.after_state then continue; end if;
    if command_name in ('resolve_case','create_case') and case_row.status in ('resolved','closed') then continue; end if;
    select exists(select 1 from warehouse.returns r cross join lateral jsonb_array_elements(r.lines) l
      where l->>'productId'=unit_row.product_id and l->>'serialNumber'=unit_row.serial_number
        and (l->>'quantity')::integer=1 and (
          (coalesce(event_return,false) and r.source='event' and r.event_id=v_event_id
            and (v_allocation_id is null or l->>'allocationId'=v_allocation_id))
          or (not coalesce(event_return,false) and r.source='customer' and r.source_order_id=source_order))
        and current_history.id>issue_history.id and current_history.before_state=issue_history.after_state
        and current_history.after_state=to_jsonb(unit_row) and unit_row.status in ('in_stock','returned')
        and unit_row.assigned_to is null) into intake_proven;
    if not intake_proven then raise exception 'This watch''s custody has changed. Refresh and check its current order or return intake.'; end if;
  end loop;
end;
$$;
alter function private.guard_restored_unit_return(jsonb,text) owner to postgres;
revoke all on function private.guard_restored_unit_return(jsonb,text) from public,anon,authenticated,service_role;

do $anchors$
declare definition text; old_text text; new_text text; authority text;
begin
  -- Preserve the public live-authority wrapper and the existing cached reply.
  definition:=pg_get_functiondef('warehouse.record_return_v2_certified_impl(jsonb)'::regprocedure);
  old_text:='v_command_id := (v_started->>''command_id'')::uuid;';
  new_text:=old_text||E'\n  perform private.guard_restored_unit_return(payload,''intake'');';
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Restored-unit intake anchor drift'; end if;
  execute replace(definition,old_text,new_text);

  definition:=pg_get_functiondef('warehouse.resolve_customer_return_case(jsonb)'::regprocedure);
  old_text:='  if not found then raise exception ''Return case not found''; end if;';
  new_text:=old_text||E'\n  perform private.guard_restored_unit_return(payload,''resolve_case'');';
  if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>1 then raise exception 'Restored-unit resolution anchor drift'; end if;
  execute replace(definition,old_text,new_text);

  definition:=pg_get_functiondef('private.warehouse_create_customer_return_case(jsonb)'::regprocedure);
  authority:=E'  if not core.has_cap(''warehouse'', ''submit_return_case'') then\n    raise exception ''Not authorized: warehouse.submit_return_case'';\n  end if;\n';
  if strpos(definition,authority)=0 then raise exception 'Restored-unit create-case anchor drift'; end if;
  execute replace(definition,authority,authority||E'  perform private.guard_restored_unit_return(payload,''create_case'');\n');

  definition:=pg_get_functiondef('private.warehouse_resolve_customer_return_case(jsonb)'::regprocedure);
  authority:=substring(definition from strpos(definition,'  if v_resolution = ''refund'' then')
    for strpos(definition,'  if v_resolution not in')-strpos(definition,'  if v_resolution = ''refund'' then'));
  if length(authority)=0 then raise exception 'Restored-unit private-resolution anchor drift'; end if;
  execute replace(definition,authority,authority||E'  perform private.guard_restored_unit_return(payload,''resolve_case'');\n');
end;
$anchors$;
