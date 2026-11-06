-- Only wholly archived sample POs leave the queue; direct authorized history remains.
set local lock_timeout='3s';
set local statement_timeout='30s';

create function private.external_po_all_lines_archived(p_order uuid) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from private.external_po_lines l where l.order_id=p_order)
    and not exists(select 1 from private.external_po_lines l where l.order_id=p_order
      and not private.is_uat_warehouse_archived('products',l.product_id))
$$;
alter function private.external_po_all_lines_archived(uuid) owner to postgres;
revoke all on function private.external_po_all_lines_archived(uuid) from public,anon,authenticated,service_role;

create function private.guard_uat_archived_external_po_write() returns trigger
language plpgsql security definer set search_path='' as $$
declare image jsonb; blocked boolean; order_id uuid;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception using errcode='40001',message='Please retry this Warehouse change in a new session.';
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('uat-warehouse-fixture-archive',0));
  foreach image in array case when tg_op='INSERT' then array[to_jsonb(new)]
    when tg_op='DELETE' then array[to_jsonb(old)] else array[to_jsonb(old),to_jsonb(new)] end loop
    order_id:=case when tg_table_name='external_po_orders' then (image->>'id')::uuid else (image->>'order_id')::uuid end;
    blocked:=private.external_po_all_lines_archived(order_id);
    if tg_table_name='external_po_lines' then
      blocked:=blocked or private.is_uat_warehouse_archived('products',image->>'product_id');
    elsif tg_table_name='external_po_shipments' then
      blocked:=blocked or exists(select 1 from jsonb_array_elements(coalesce(image->'lines','[]'::jsonb)) line
        join private.external_po_lines l on l.id::text=line->>'po_line_id'
        where private.is_uat_warehouse_archived('products',l.product_id));
    end if;
    if blocked then raise exception 'This is an archived UAT test PO. Open an active PO to continue.'; end if;
  end loop;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
alter function private.guard_uat_archived_external_po_write() owner to postgres;
revoke all on function private.guard_uat_archived_external_po_write() from public,anon,authenticated,service_role;
create trigger uat_archived_external_po_guard before insert or update or delete on private.external_po_orders
  for each row execute function private.guard_uat_archived_external_po_write();
create trigger uat_archived_external_po_guard before insert or update or delete on private.external_po_lines
  for each row execute function private.guard_uat_archived_external_po_write();
create trigger uat_archived_external_po_guard before insert or update or delete on private.external_po_shipments
  for each row execute function private.guard_uat_archived_external_po_write();

do $patch$
declare definition text; metadata jsonb; after_metadata jsonb;
  queue_anchor constant text:='where nullif(payload->>''order_id'','''') is null or id=(payload->>''order_id'')::uuid';
  more_anchor constant text:='from private.external_po_orders offset offset_rows+100';
begin
  if not exists(select 1 from pg_proc p where p.oid='private.external_po_workspace(jsonb)'::regprocedure
    and md5(replace(p.prosrc,chr(13),''))='8a3e83bb9fa2e949189c46100eaa5ff0') then
    raise exception 'External PO archive reader predecessor drift';
  end if;
  select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into definition,metadata
    from pg_proc p where p.oid='private.external_po_workspace(jsonb)'::regprocedure;
  if (length(definition)-length(replace(definition,queue_anchor,'')))/length(queue_anchor)<>1
    or (length(definition)-length(replace(definition,more_anchor,'')))/length(more_anchor)<>1 then
    raise exception 'External PO archive reader anchor drift';
  end if;
  definition:=replace(definition,queue_anchor,
    'where (nullif(payload->>''order_id'','''') is null and not private.external_po_all_lines_archived(id)) or id=nullif(payload->>''order_id'','''')::uuid');
  definition:=replace(definition,more_anchor,
    'from private.external_po_orders where not private.external_po_all_lines_archived(id) offset offset_rows+100');
  execute definition;
  select to_jsonb(p)-'prosrc' into after_metadata from pg_proc p where p.oid='private.external_po_workspace(jsonb)'::regprocedure;
  if metadata is distinct from after_metadata then raise exception 'External PO reader metadata changed'; end if;
end $patch$;
