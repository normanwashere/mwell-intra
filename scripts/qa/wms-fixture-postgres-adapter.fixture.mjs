// Disposable databases only. This is not a live bootstrap or a schema-reset API.
import { readFileSync } from 'node:fs';
const source=n=>readFileSync(new URL(`../../supabase/migrations/${n}.sql`,import.meta.url),'utf8');
const baseline=JSON.parse(readFileSync(new URL('../fixtures/uat-archive-read-baseline.json',import.meta.url),'utf8'));
export async function installAdapterFixture(db,{roles=true}={}) {
  if(roles)await db.exec('create role anon;create role authenticated;create role service_role');
  await db.exec(`create schema warehouse;create schema private;create schema core;create schema auth;create schema procurement;create schema legal;
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create function private.can_read_warehouse_table(text) returns boolean language sql as $$select true$$;`);
  for(const t of baseline.ddl)await db.exec(t.ddl);
  await db.exec(`alter table warehouse.products add primary key(id);
    alter table warehouse.inventory_units add primary key(id);
    create unique index fixture_unique_serial on warehouse.inventory_units(serial_number);
    create table auth.users(id uuid primary key,email text);
    create table auth.audit_log_entries(id uuid primary key,payload jsonb);
    create table core.profiles(id uuid primary key,email text);
    create table core.activity_log(id uuid primary key,detail jsonb);
    insert into auth.users values('00000000-0000-4000-8000-000000000001','offline-only');
    insert into core.profiles values('00000000-0000-4000-8000-000000000001','offline-only');
    insert into core.activity_log values('00000000-0000-4000-8000-000000000001','{"existing":true}');
    insert into procurement.requests(id,title) values('preserve-pr','Existing audit');
    insert into warehouse.products(id,sku,name,category,serialized,attributes) values('master-preserved','MASTER','Master','device',true,'{"Master data":"approved"}');
    insert into warehouse.locations(id,name,type,active) values('fixture-wh','Fixture warehouse','warehouse',true);
    insert into warehouse.storage_areas(id,location_id,code,active) values('fixture-bin','fixture-wh','TEST',true);`);
  await db.exec(source('20261105071201_warehouse_unit_custody_history'));
  await db.exec("insert into warehouse.inventory_units(id,product_id,serial_number,location_id,bin_id,status) values('uat-open-unit-preserved','master-preserved','MASTER-SERIAL','fixture-wh','fixture-bin','in_stock')");
  await db.exec('begin');
  await db.exec(source('20261106145742_uat_warehouse_fixture_archive'));
  await db.exec(source('20261106173133_wms_fixture_postgres_lifecycle'));
  await db.exec('commit');
}
