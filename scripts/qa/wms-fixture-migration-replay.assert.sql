-- Read-only verification after actual canonical plus complete forward SQL replay.
begin read only;
set local statement_timeout='30s';
do $verify$
declare name text; relation regclass; fn regprocedure; api_role text; count_rows bigint; expected record; function_acl aclitem[];
begin
  if current_setting('server_version_num')::integer/10000<>17 then raise exception 'PostgreSQL17 required'; end if;
  if to_regclass('auth.users') is null or to_regclass('storage.objects') is null or to_regprocedure('auth.uid()') is null then
    raise exception 'Supabase platform baseline incomplete';
  end if;
  -- Main's read-only automatic-cleanup-live-trigger-inventory.json, cross-checked
  -- against the pinned count/history/location/serial/conversion/archive sources.
  for expected in select * from (values
    ('private','warehouse_unit_history','stock_conversion_history_watch','O',25,'private.stock_conversion_watch_qc_origin()','a67f2490c4de34690271e88dcd3a50a6'),
    ('private','warehouse_unit_history','stock_conversion_truncate_watch','O',34,'private.stock_conversion_watch_qc_origin()','a67f2490c4de34690271e88dcd3a50a6'),
    ('warehouse','inventory_units','stock_conversion_claim_guard','O',27,'private.stock_conversion_guard_claimed_unit()','982ce2ef4f71957d9586560d09548001'),
    ('warehouse','inventory_units','uat_archived_record_write_guard','O',31,'private.guard_uat_archived_warehouse_write()','1ccd0ed4bb034f13ba6734ecbd54932d'),
    ('warehouse','inventory_units','warehouse_count_epoch','O',31,'private.warehouse_advance_stock_epoch()','f46559a09d5636760f37c40d83d277f9'),
    ('warehouse','inventory_units','warehouse_inventory_unit_serial_normalize','O',23,'private.normalize_inventory_unit_serial()','40344bb25cc74e0f4b99cb201c4cfbf0'),
    ('warehouse','inventory_units','warehouse_unit_history','O',29,'private.warehouse_record_unit_history()','3c7dfcf8c4acc69faa8cd8b2cc1cd534'),
    ('warehouse','inventory_units','warehouse_work_location_guard','O',23,'private.warehouse_lock_work_location()','6e153048df3b2950cf06169bc86fa64c'),
    ('warehouse','products','uat_archived_record_write_guard','O',31,'private.guard_uat_archived_warehouse_write()','1ccd0ed4bb034f13ba6734ecbd54932d')
  ) t(schema_name,table_name,trigger_name,enabled,trigger_type,signature,body_md5) loop
    if not exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
      where t.tgrelid=to_regclass(format('%I.%I',expected.schema_name,expected.table_name))
      and t.tgname=expected.trigger_name and t.tgenabled::text=expected.enabled and t.tgtype=expected.trigger_type
      and t.tgfoid=to_regprocedure(expected.signature) and md5(replace(p.prosrc,chr(13),''))=expected.body_md5) then
      raise exception 'Actual source trigger/body drift: %.%/%',expected.schema_name,expected.table_name,expected.trigger_name;
    end if;
  end loop;
  foreach name in array array['wms_fixture_runs','wms_fixture_leases','wms_fixture_operations','wms_fixture_owned_rows','wms_fixture_identities'] loop
    relation:=to_regclass('private.'||name);
    if relation is null or not exists(select 1 from pg_class where oid=relation and relrowsecurity and relforcerowsecurity and pg_get_userbyid(relowner)='postgres') then
      raise exception 'Fixture ledger ownership/RLS missing: %',name;
    end if;
    if exists(select 1 from pg_policy where polrelid=relation) then raise exception 'Unexpected ledger policy: %',name; end if;
    foreach api_role in array array['anon','authenticated','service_role'] loop
      if not exists(select 1 from pg_roles where rolname=api_role) or has_table_privilege(api_role,relation,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then
        raise exception 'Fixture ledger API access changed: %.%',api_role,name;
      end if;
    end loop;
    execute format('select count(*) from %s',relation) into count_rows;
    if count_rows<>0 then raise exception 'Replay must not preseed fixture ledger: %',name; end if;
    if name<>'wms_fixture_leases' and not exists(select 1 from pg_trigger where tgrelid=relation and not tgisinternal and tgenabled='O' and tgtype=58
      and tgfoid='private.uat_warehouse_archive_immutable()'::regprocedure) then raise exception 'Immutable ledger hook missing: %',name; end if;
  end loop;
  for expected in select * from (values
    ('private.wms_fixture_tokens(jsonb)','2c507914f36344858b484521263e4885',false,'i'),
    ('private.wms_fixture_guard_targets()','899848f0aacd8334d5e4547e53d0eb94',true,'s'),
    ('private.wms_fixture_guard_write()','3c138d2eb9df1a00bbb06e9555395e9a',true,'v'),
    ('private.wms_fixture_assert_writer_coverage()','e8b746792b07622e501f6b05610fb7ae',true,'s')
  ) t(signature,body_md5,definer,volatility) loop
    name:=expected.signature; fn:=to_regprocedure(name);
    if fn is null or not exists(select 1 from pg_proc where oid=fn and pg_get_userbyid(proowner)='postgres' and proconfig=array['search_path=""']
      and prosecdef=expected.definer and provolatile::text=expected.volatility
      and md5(replace(prosrc,chr(13),''))=expected.body_md5) then raise exception 'Writer function authority/body mismatch: %',name; end if;
    select coalesce(proacl,acldefault('f',proowner)) into function_acl from pg_proc where oid=fn;
    if cardinality(function_acl)<>1 then raise exception 'Unexpected writer function ACL cardinality: %',name; end if;
    if exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=fn and a.grantee<>p.proowner) then
      raise exception 'Writer function exposed beyond owner: %',name;
    end if;
  end loop;
  foreach name in array array['owner_pid','owner_backend_start','seed_transaction'] loop
    if not exists(select 1 from pg_attribute where attrelid='private.wms_fixture_leases'::regclass and attname=name and attnum>0 and not attisdropped) then
      raise exception 'Writer backend/transaction binding missing: %',name;
    end if;
  end loop;
  if (select pg_get_constraintdef(oid) from pg_constraint where conrelid='private.wms_fixture_owned_rows'::regclass
    and conname='wms_fixture_owned_rows_table_name_check') is distinct from
    'CHECK ((table_name = ANY (ARRAY[''warehouse.products''::text, ''warehouse.inventory_units''::text, ''private.warehouse_unit_history''::text, ''private.warehouse_stock_epochs''::text])))' then
    raise exception 'Exact four-source ownership contract missing';
  end if;
  foreach relation in array array['warehouse.inventory_units'::regclass,'warehouse.stock_levels'::regclass] loop
    if not exists(select 1 from pg_trigger where tgrelid=relation and tgname='warehouse_count_epoch'
      and tgfoid='private.warehouse_advance_stock_epoch()'::regprocedure and tgenabled='O' and tgtype=31
      and tgqual is null and not tgisinternal and tgnargs=0 and tgattr=''::int2vector) then
      raise exception 'Real stock-count epoch trigger missing or narrowed: %',relation;
    end if;
  end loop;
  perform private.wms_fixture_assert_writer_coverage();
  if not exists(select 1 from private.wms_fixture_guard_targets()) then raise exception 'Writer coverage is empty'; end if;
  foreach relation in array array['warehouse.products'::regclass,'warehouse.inventory_units'::regclass,'private.warehouse_unit_history'::regclass,'private.warehouse_stock_epochs'::regclass] loop
    if not exists(select 1 from pg_trigger where tgrelid=relation and tgname='wms_fixture_registered_write_guard' and tgfoid='private.wms_fixture_guard_write()'::regprocedure and tgenabled='A' and tgtype=31 and tgqual is null and not tgisinternal and tgnargs=0 and tgattr=''::int2vector)
      or not exists(select 1 from pg_trigger where tgrelid=relation and tgname='wms_fixture_registered_truncate_guard' and tgfoid='private.wms_fixture_guard_write()'::regprocedure and tgenabled='A' and tgtype=34 and tgqual is null and not tgisinternal and tgnargs=0) then
      raise exception 'Required writer/truncate hook missing: %',relation;
    end if;
  end loop;
  foreach name in array array['active_products','active_inventory_units'] loop
    if not exists(select 1 from pg_class where oid=to_regclass('warehouse.'||name) and relkind='v' and reloptions @> array['security_invoker=true']) then
      raise exception 'Active security-invoker view missing: %',name;
    end if;
  end loop;
end $verify$;
select 'wms_fixture_replay_schema_ok' as result;
rollback;
