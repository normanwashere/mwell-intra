-- Active availability and Warehouse receiving only; raw Procurement/history stays intact.
set local lock_timeout='3s';
set local statement_timeout='30s';

do $patch$
declare definition text; changed text; metadata jsonb; after_metadata jsonb; relation_name text;
begin
  if not exists(select 1 from pg_proc p where p.oid='warehouse.available_to_promise(text)'::regprocedure
    and md5(replace(p.prosrc,chr(13),''))='dce5073ca82b12e60d00ef94917170fe'
    and pg_get_userbyid(p.proowner)='postgres' and p.prosecdef
    and p.proconfig=array['search_path=""']
    and p.proacl::text='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}') then
    raise exception 'Active availability predecessor drift';
  end if;
  if not exists(select 1 from pg_class c where c.oid='warehouse.procurement_po_handoff'::regclass
    and md5(pg_get_viewdef(c.oid))='92f218fa25f5eb3c7b32eefb5203fafe'
    and pg_get_userbyid(c.relowner)='postgres' and c.reloptions=array['security_invoker=true']
    and c.relacl::text='{postgres=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}') then
    raise exception 'Warehouse PO handoff predecessor drift';
  end if;
  select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into definition,metadata
    from pg_proc p where p.oid='warehouse.available_to_promise(text)'::regprocedure;
  changed:=definition;
  foreach relation_name in array array['stock_levels','inventory_units','allocations','inventory_holds'] loop
    if (length(changed)-length(replace(changed,'from warehouse.'||relation_name,'')))/length('from warehouse.'||relation_name)<>1 then
      raise exception 'Active availability replacement anchor drift: %',relation_name;
    end if;
    changed:=replace(changed,'from warehouse.'||relation_name,'from warehouse.active_'||relation_name);
  end loop;
  execute changed;
  select to_jsonb(p)-'prosrc' into after_metadata from pg_proc p where p.oid='warehouse.available_to_promise(text)'::regprocedure;
  if metadata is distinct from after_metadata then raise exception 'Active availability metadata changed'; end if;
end $patch$;

-- The original handoff aggregates every authorized line under matching header/line
-- RLS. Keep mixed, unmapped and empty orders; never remove individual historical lines.
create view warehouse.active_procurement_po_handoff with(security_invoker=true) as
select handoff.* from warehouse.procurement_po_handoff handoff
where jsonb_array_length(handoff.lines)=0 or exists(
  select 1 from jsonb_array_elements(handoff.lines) line
  where nullif(btrim(line->>'productId'),'') is null
    or not private.is_uat_warehouse_archived('products',line->>'productId')
);
alter view warehouse.active_procurement_po_handoff owner to postgres;
revoke all on warehouse.active_procurement_po_handoff from public,anon,authenticated,service_role;
grant select on warehouse.active_procurement_po_handoff to authenticated,service_role;
