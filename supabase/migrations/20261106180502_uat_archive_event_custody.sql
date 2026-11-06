-- Archive eligibility is separate from immutable event history and settlement math.
set local lock_timeout='3s';
set local statement_timeout='30s';

create function private.event_custody_source_archived(p_allocation text) returns boolean
language sql stable set search_path='' as $$
  select private.is_uat_warehouse_archived('allocations',p_allocation)
    or exists(select 1 from private.event_custody_sources s where s.allocation_id=p_allocation
      and (private.is_uat_warehouse_archived('products',s.product_id)
        or private.is_uat_warehouse_archived('fulfillment_orders',s.order_id::text)))
$$;
alter function private.event_custody_source_archived(text) owner to postgres;
revoke all on function private.event_custody_source_archived(text) from public,anon,authenticated,service_role;

create function private.assert_uat_event_custody_active(p_event text,p_allocation text) returns void
language plpgsql set search_path='' as $$
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='40001',message='Please retry this Warehouse change in a new session.';
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('uat-warehouse-fixture-archive',0));
  if not exists(select 1 from private.event_custody_sources s where s.allocation_id=p_allocation and s.event_id=p_event) then
    raise exception 'Event custody lineage unresolved';
  end if;
  if private.event_custody_source_archived(p_allocation) then
    raise exception 'This is archived UAT event custody. Choose an active allocation to continue.';
  end if;
end $$;
alter function private.assert_uat_event_custody_active(text,text) owner to postgres;
revoke all on function private.assert_uat_event_custody_active(text,text) from public,anon,authenticated,service_role;

create function private.guard_uat_archived_event_entry() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_uat_event_custody_active(new.event_id,new.allocation_id);
  return new;
end $$;
alter function private.guard_uat_archived_event_entry() owner to postgres;
revoke all on function private.guard_uat_archived_event_entry() from public,anon,authenticated,service_role;
create trigger uat_archived_event_entry_guard before insert on private.event_custody_entries
  for each row execute function private.guard_uat_archived_event_entry();

do $patch$
declare target regprocedure; definition text; metadata jsonb; after_metadata jsonb; item record;
  replay_anchor constant text:='if (started->>''replayed'')::boolean then return started->''response'';end if;';
  source_anchor constant text:='from private.event_custody_sources s where s.event_id=payload->>''event_id'';';
  entries_anchor constant text:='jsonb_agg(to_jsonb(x))';
  result_anchor constant text:='''allocations'',result,''entries'',entries';
  anchor text;
begin
  for item in select * from (values
    ('warehouse.record_event_outcome(jsonb)','3262d80706321f82f9ec6b998ede5238'),
    ('warehouse.event_custody_ledger(jsonb)','28e22b231ae2950d56a2183c4625d98c')
  ) expected(signature,body_md5) loop
    target:=to_regprocedure(item.signature);
    if target is null or not exists(select 1 from pg_proc p where p.oid=target
      and md5(replace(p.prosrc,chr(13),''))=item.body_md5) then
      raise exception 'Event archive predecessor drift: %',item.signature;
    end if;
    select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into definition,metadata from pg_proc p where p.oid=target;
    foreach anchor in array case when item.signature='warehouse.record_event_outcome(jsonb)'
      then array[replay_anchor] else array[source_anchor,entries_anchor,result_anchor] end loop
      if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
        raise exception 'Event archive anchor drift: %',item.signature;
      end if;
    end loop;
    if item.signature='warehouse.record_event_outcome(jsonb)' then
      -- Keep existing authority and completed replay before the fresh-write fence.
      definition:=replace(definition,replay_anchor,replay_anchor||E'\n  perform private.assert_uat_event_custody_active(payload->>''event_id'',payload->>''allocation_id'');');
    else
      definition:=replace(definition,source_anchor,
        'from private.event_custody_sources s where s.event_id=payload->>''event_id'' and not private.event_custody_source_archived(s.allocation_id);');
      definition:=replace(definition,entries_anchor,
        'jsonb_agg(to_jsonb(x)||jsonb_build_object(''archived_source'',private.event_custody_source_archived(x.allocation_id)))');
      definition:=replace(definition,result_anchor,result_anchor||
        ',''archived_allocation_count'',(select count(*) from private.event_custody_sources s where s.event_id=payload->>''event_id'' and private.event_custody_source_archived(s.allocation_id))');
    end if;
    execute definition;
    select to_jsonb(p)-'prosrc' into after_metadata from pg_proc p where p.oid=target;
    if metadata is distinct from after_metadata then raise exception 'Event archive function metadata changed: %',item.signature; end if;
  end loop;
end $patch$;
