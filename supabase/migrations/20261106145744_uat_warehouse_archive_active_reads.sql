-- Only active Warehouse read relations change; base history and authorization stay intact.
set local lock_timeout = '3s';
set local statement_timeout = '30s';
set local timezone = 'UTC';
do $patch$
declare item record; oid_value oid; definition text; updated text; before_metadata jsonb; after_metadata jsonb;
begin
  for item in select * from (values
    ('warehouse.stock_conversion_workspace(jsonb)','949bb1f1e424077351421c2e57f502fc','function'),
    ('private.warehouse_inventory_position_summary()','ef9be17a0fede0292357115ab18706f6','function'),
    ('private.warehouse_list_stock_change_requests(jsonb)','ae152c1e368767fd39285985fb2e94ec','function'),
    ('core.platform_previous_my_work()','78e3465b9571031b0a51b62d645e4f09','function'),
    ('warehouse.quality_inspection_queue','d87bb4df7f648f930b0302a01dd92cdb','view'),
    ('warehouse.warehouse_tasks','7578c614039252d6572f64b89f3a2699','view')
  ) v(signature,expected_md5,kind) loop
    if item.kind='function' then
      oid_value:=to_regprocedure(item.signature);
      select pg_get_functiondef(p.oid),jsonb_build_object('owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'security_definer',p.prosecdef)
        into definition,before_metadata from pg_proc p where p.oid=oid_value;
    else
      oid_value:=to_regclass(item.signature);
      select pg_get_viewdef(c.oid),jsonb_build_object('owner',c.relowner,'acl',c.relacl,'options',c.reloptions)
        into definition,before_metadata from pg_class c where c.oid=oid_value;
    end if;
    -- The captured My Work body has 102 CRLFs; the identical source body has LF.
    -- Accept only those two exact definitions, without normalizing other drift.
    if definition is null or (md5(definition)<>item.expected_md5 and not (
      item.kind='function' and item.signature='core.platform_previous_my_work()'
      and md5(definition)='79364d79fa7c77ad5811c38f3d0bba6c'
    )) then
      raise exception 'Warehouse archive read definition drift: %',item.signature;
    end if;
    updated:=regexp_replace(definition,
      '\m(from|join)([[:space:]]+[(]*[[:space:]]*)warehouse\.(products|inventory_units|stock_levels|lots|allocations|fulfillment_orders|fulfillment_reservations|department_stock_requests|customer_return_cases|receipts|returns|cycle_counts|quality_inspections|inventory_holds|vendor_returns|stock_change_requests|exceptions|kit_definitions|rekit_work_orders|storage_areas|events)\M',
      '\1\2warehouse.active_\3','gi');
    if updated=definition then raise exception 'No active-read replacement: %',item.signature; end if;
    if updated ~* '\m(from|join)[[:space:]]+[(]*[[:space:]]*warehouse\.(products|inventory_units|stock_levels|lots|allocations|fulfillment_orders|fulfillment_reservations|department_stock_requests|customer_return_cases|receipts|returns|cycle_counts|quality_inspections|inventory_holds|vendor_returns|stock_change_requests|exceptions|kit_definitions|rekit_work_orders|storage_areas|events)\M' then
      raise exception 'Unfiltered Warehouse relation remains: %',item.signature;
    end if;
    if item.kind='function' then
      execute updated;
      select jsonb_build_object('owner',p.proowner,'acl',p.proacl,'config',p.proconfig,'security_definer',p.prosecdef)
        into after_metadata from pg_proc p where p.oid=oid_value;
    else
      execute 'create or replace view '||item.signature||' with (security_invoker=true) as '||updated;
      select jsonb_build_object('owner',c.relowner,'acl',c.relacl,'options',c.reloptions)
        into after_metadata from pg_class c where c.oid=oid_value;
    end if;
    if before_metadata is distinct from after_metadata then raise exception 'Archive read permissions drift: %',item.signature; end if;
  end loop;
end $patch$;

