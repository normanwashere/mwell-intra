-- Exact reserved identities only. This does not enable the live adapter.
set local lock_timeout='3s';
set local statement_timeout='30s';

create table private.wms_fixture_identities (
  run_id text primary key references private.wms_fixture_runs(run_id),
  product_id text not null unique,
  unit_id text not null unique,
  serial_number text not null unique,
  check(product_id='qa-fixture-'||substr(run_id,13)||'-product'),
  check(unit_id='qa-fixture-'||substr(run_id,13)||'-unit'),
  check(serial_number='QA-'||upper(substr(run_id,13)))
);
alter table private.wms_fixture_identities owner to postgres;
alter table private.wms_fixture_identities enable row level security;
alter table private.wms_fixture_identities force row level security;
revoke all on private.wms_fixture_identities from public,anon,authenticated,service_role;
create trigger immutable_fixture_identity before update or delete or truncate on private.wms_fixture_identities
  for each statement execute function private.uat_warehouse_archive_immutable();

alter table private.wms_fixture_leases
  add column owner_pid integer,
  add column owner_backend_start timestamptz,
  add column seed_transaction bigint;

do $epoch_contract$
begin
  if (select pg_get_constraintdef(oid) from pg_constraint where conrelid='private.wms_fixture_owned_rows'::regclass
      and conname='wms_fixture_owned_rows_table_name_check') is distinct from
      'CHECK ((table_name = ANY (ARRAY[''warehouse.products''::text, ''warehouse.inventory_units''::text, ''private.warehouse_unit_history''::text])))' then
    raise exception 'Fixture ownership table contract changed';
  end if;
  alter table private.wms_fixture_owned_rows drop constraint wms_fixture_owned_rows_table_name_check;
  alter table private.wms_fixture_owned_rows add constraint wms_fixture_owned_rows_table_name_check
    check(table_name in ('warehouse.products','warehouse.inventory_units','private.warehouse_unit_history','private.warehouse_stock_epochs'));
end;
$epoch_contract$;

-- Scan exact scalar values (and JSON object keys), never substrings. Reserved
-- syntax is a denial boundary, not authority: only a registered backend may seed.
create function private.wms_fixture_tokens(image jsonb) returns text[]
language sql immutable set search_path='' as $$
  select coalesce(array_agg(distinct lower(regexp_replace(token,'^\s+|\s+$','','g'))),array[]::text[]) from (
    select value #>> '{}' as token from jsonb_path_query(image,'strict $.** ? (@.type() == "string")') item(value)
    union all
    select value #>> '{}' from jsonb_path_query(image,'strict $.** ? (@.type() == "object").keyvalue().key') item(value)
  ) scalar_values where lower(regexp_replace(token,'^\s+|\s+$','','g')) ~
    '^(qa-fixture-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-(product|unit)|qa-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$';
$$;

-- Include JSON-capable application tables, identity columns, and catalog FKs.
-- Infrastructure schemas and exact ownership/archive ledgers are not commands.
create function private.wms_fixture_guard_targets() returns table(relation regclass)
language sql stable security definer set search_path='' as $$
  select c.oid::regclass from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where c.relkind in ('r','p') and not c.relispartition
    and n.nspname not in ('pg_catalog','information_schema','auth','storage','realtime','extensions','supabase_migrations','supabase_functions','vault','graphql','graphql_public')
    and n.nspname not like 'pg_%'
    and not (n.nspname='core' and c.relname='activity_log')
    -- Reporting authority history is a separately owned immutable audit sink.
    and not (n.nspname='reporting_authority' and c.relname='admin_audit')
    -- pg_net transport queues must not receive application triggers; verify membership.
    and not (n.nspname='net' and c.relname in ('http_request_queue','_http_response')
      and exists(select 1 from pg_catalog.pg_depend d join pg_catalog.pg_extension e on e.oid=d.refobjid
        where d.classid='pg_catalog.pg_class'::regclass and d.objid=c.oid and d.objsubid=0
          and d.refclassid='pg_catalog.pg_extension'::regclass and d.refobjsubid=0
          and d.deptype='e' and e.extname='pg_net'))
    and not (n.nspname='private' and c.relname in ('wms_fixture_runs','wms_fixture_leases','wms_fixture_operations','wms_fixture_owned_rows','wms_fixture_identities','uat_warehouse_archive_batches','uat_warehouse_archive_members','uat_admin_reset_archives'))
    and (n.nspname in ('warehouse','product','procurement')
      or (n.nspname='private' and (c.relname like 'stock_conversion_%' or c.relname like 'external_po_%' or c.relname like 'event_custody_%' or c.relname in ('warehouse_unit_history','warehouse_stock_epochs')))
      or exists(select 1 from pg_catalog.pg_attribute a join pg_catalog.pg_type t on t.oid=a.atttypid
        where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
          and (t.typname in ('json','jsonb') or a.attname=any(array['product_id','productId','warehouse_product_id','warehouseProductId','source_product_id','sourceProductId','output_product_id','outputProductId','unit_id','unitId','inventory_unit_id','inventoryUnitId','serial_number','serialNumber','serial_numbers','serialNumbers','pickedSerialNumbers'])))
      or exists(select 1 from pg_catalog.pg_constraint fk where fk.conrelid=c.oid and fk.contype='f'
        and fk.confrelid in ('warehouse.products'::regclass,'warehouse.inventory_units'::regclass)))
  order by c.oid;
$$;

create function private.wms_fixture_guard_write() returns trigger
language plpgsql volatile security definer set search_path='' as $$
declare tokens text[]; identity private.wms_fixture_identities%rowtype; owned private.wms_fixture_leases%rowtype;
  image jsonb; actual jsonb; count_runs integer; allowed boolean:=false;
begin
  if tg_op='TRUNCATE' then
    if exists(select 1 from private.wms_fixture_identities) then
      raise exception 'An isolated fixture retains immutable source history; truncate is not allowed.';
    end if;
    return null;
  end if;
  image:=case when tg_op='INSERT' then to_jsonb(new)
    when tg_op='DELETE' then to_jsonb(old) else jsonb_build_array(to_jsonb(old),to_jsonb(new)) end;
  if tg_table_schema='private' and tg_table_name='warehouse_stock_epochs' then
    -- This source-owned column is JSON encoded in text, not an arbitrary text parser.
    image:=jsonb_build_array(image,case when tg_op<>'INSERT' then (to_jsonb(old)->>'scope_key')::jsonb end,
      case when tg_op<>'DELETE' then (to_jsonb(new)->>'scope_key')::jsonb end);
  end if;
  tokens:=private.wms_fixture_tokens(image);
  if cardinality(tokens)=0 then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  -- A stale RR snapshot must not miss a registration committed after it began.
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'An isolated fixture requires a fresh read-committed transaction.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('wms-fixture-registered-writers',0));
  select count(*) into count_runs from private.wms_fixture_identities i
    where i.product_id=any(tokens) or i.unit_id=any(tokens) or lower(i.serial_number)=any(tokens);
  if count_runs=1 then
    select * into identity from private.wms_fixture_identities i
      where i.product_id=any(tokens) or i.unit_id=any(tokens) or lower(i.serial_number)=any(tokens);
    if exists(select 1 from unnest(tokens) token where token<>all(array[identity.product_id,identity.unit_id,lower(identity.serial_number)])) then
      raise exception 'A command cannot combine isolated fixture identities.';
    end if;
    select * into owned from private.wms_fixture_leases where run_id=identity.run_id;
    if tg_op='INSERT' and owned.state='open' and owned.owner_pid=pg_backend_pid()
      and owned.owner_backend_start=(select backend_start from pg_catalog.pg_stat_activity where pid=pg_backend_pid())
      and owned.seed_transaction=txid_current()
      and not exists(select 1 from private.wms_fixture_operations where run_id=identity.run_id)
      and not exists(select 1 from private.uat_warehouse_archive_members where table_name='products' and row_id=identity.product_id) then
      image:=to_jsonb(new);
      if tg_table_schema='warehouse' and tg_table_name='products' then
        allowed:=image->>'id'=identity.product_id and image->>'sku'=identity.serial_number
          and image->>'name'='Owned UAT fixture - cleanup required' and image->>'category'='device'
          and image->'serialized'='true'::jsonb and image->>'item_class'='sellable_sku'
          and image->>'serialization_policy'='required' and image->>'uom'='piece'
          and (image->>'unit_cost')::numeric=0 and (image->>'reorder_point')::numeric=0
          and image->'attributes'=jsonb_build_object('synthetic',true,'wms_fixture_run_id',identity.run_id);
      elsif tg_table_schema='warehouse' and tg_table_name='inventory_units' then
        allowed:=image->>'id'=identity.unit_id and image->>'product_id'=identity.product_id
          and image->>'serial_number'=identity.serial_number and image->>'status'='in_stock'
          and image->>'assigned_to' is null and image->>'event_id' is null and image->>'lot_id' is null
          and exists(select 1 from private.wms_fixture_runs r where r.run_id=identity.run_id
            and r.bindings->>'binId'=image->>'bin_id' and r.bindings->>'locationId'=image->>'location_id');
      elsif tg_table_schema='private' and tg_table_name='warehouse_unit_history' and pg_trigger_depth()=2 then
        select to_jsonb(u) into actual from warehouse.inventory_units u where u.id=identity.unit_id;
        allowed:=image->>'unit_id'=identity.unit_id and image->>'product_id'=identity.product_id
          and image->>'serial_number'=identity.serial_number and image->>'operation'='registered'
          and image->'before_state'='null'::jsonb and image->'after_state'=actual
          and not exists(select 1 from private.warehouse_unit_history h where h.unit_id=identity.unit_id);
      elsif tg_table_schema='private' and tg_table_name='warehouse_stock_epochs' and pg_trigger_depth()=2 then
        allowed:=exists(select 1 from private.wms_fixture_runs r where r.run_id=identity.run_id
          and (image->>'scope_key')::jsonb=jsonb_build_array(identity.product_id,r.bindings->>'locationId',r.bindings->>'binId'))
          and not exists(select 1 from private.warehouse_stock_epochs e where e.scope_key=image->>'scope_key');
      end if;
    end if;
  end if;
  if allowed is not true then raise exception 'This is an isolated fixture. Other commands cannot use or change it.'; end if;
  return new;
end;
$$;

create function private.wms_fixture_assert_writer_coverage() returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if exists(select 1 from private.wms_fixture_guard_targets() t where not exists(
    select 1 from pg_catalog.pg_trigger g where g.tgrelid=t.relation and g.tgname='wms_fixture_registered_write_guard'
      and g.tgfoid='private.wms_fixture_guard_write()'::regprocedure and g.tgenabled='A' and g.tgtype=31
      and g.tgqual is null and not g.tgisinternal and g.tgnargs=0 and g.tgattr=''::int2vector))
    or exists(select 1 from unnest(array['warehouse.products'::regclass,'warehouse.inventory_units'::regclass,'private.warehouse_unit_history'::regclass,'private.warehouse_stock_epochs'::regclass]) t(relation)
      where not exists(select 1 from pg_catalog.pg_trigger g where g.tgrelid=t.relation and g.tgname='wms_fixture_registered_truncate_guard'
        and g.tgfoid='private.wms_fixture_guard_write()'::regprocedure and g.tgenabled='A' and g.tgtype=34
        and g.tgqual is null and not g.tgisinternal and g.tgnargs=0)) then
    raise exception 'Isolated fixture writer coverage changed; activation is blocked.';
  end if;
end;
$$;

do $install$
declare target regclass; signature text;
begin
  foreach signature in array array['private.wms_fixture_tokens(jsonb)','private.wms_fixture_guard_targets()','private.wms_fixture_guard_write()','private.wms_fixture_assert_writer_coverage()'] loop
    execute 'alter function '||signature||' owner to postgres';
    execute 'revoke all on function '||signature||' from public,anon,authenticated,service_role';
  end loop;
  for target in select relation from private.wms_fixture_guard_targets() loop
    execute format('create trigger wms_fixture_registered_write_guard before insert or update or delete on %s for each row execute function private.wms_fixture_guard_write()',target);
    execute format('alter table %s enable always trigger wms_fixture_registered_write_guard',target);
  end loop;
  foreach target in array array['warehouse.products'::regclass,'warehouse.inventory_units'::regclass,'private.warehouse_unit_history'::regclass,'private.warehouse_stock_epochs'::regclass] loop
    execute format('create trigger wms_fixture_registered_truncate_guard before truncate on %s for each statement execute function private.wms_fixture_guard_write()',target);
    execute format('alter table %s enable always trigger wms_fixture_registered_truncate_guard',target);
  end loop;
end;
$install$;
select private.wms_fixture_assert_writer_coverage();
