import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {before,after,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
const read = p => readFileSync(new URL(p,import.meta.url),'utf8');
const baseline=JSON.parse(read('./fixtures/uat-archive-read-baseline.json'));
const archive=read('../supabase/migrations/20261106145742_uat_warehouse_fixture_archive.sql');
const active=read('../supabase/migrations/20261106145744_uat_warehouse_archive_active_reads.sql');
const db=new PGlite();
before(async()=>{
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema warehouse; create schema private; create schema core; create schema auth; create schema procurement; create schema legal;
    create function auth.uid() returns uuid language sql as $$ select '00000000-0000-4000-8000-000000000001'::uuid $$;
    create function core.has_cap(text,text) returns boolean language sql as $$ select true $$;
    create function core.has_live_cap(text,text) returns boolean language sql as $$ select true $$;
    create function private.can_read_warehouse_table(text) returns boolean language sql as $$ select true $$;
    grant usage on schema warehouse,private,core,auth,procurement,legal to authenticated,service_role;`);
  for(const t of baseline.ddl) await db.exec(t.ddl);
  await db.exec(`create function private.stock_conversion_qc_matches(warehouse.inventory_units,warehouse.quality_inspections,text,boolean)
    returns boolean language sql as $$ select true $$;`);
  for(const f of baseline.functions) await db.exec(f.definition);
  for(const v of baseline.views.filter(v=>v.viewname==='inventory_position_v1')) await db.exec(`create view warehouse.${v.viewname} with(security_invoker=true) as ${v.definition}`);
  await db.exec(baseline.taskFunction);
  for(const v of baseline.views.filter(v=>v.viewname!=='inventory_position_v1')) await db.exec(`create view warehouse.${v.viewname} with(security_invoker=true) as ${v.definition}`);
  for(const t of baseline.ddl.filter(t=>t.schema_name==='warehouse')) await db.exec(`alter table warehouse.${t.table_name} enable row level security;
    create policy read_authenticated on warehouse.${t.table_name} for select to authenticated using(true);
    create policy current_capability_read_guard on warehouse.${t.table_name} as restrictive for select to authenticated
      using((select private.can_read_warehouse_table('${t.table_name}')));`);
  await db.exec(`grant select on all tables in schema warehouse to authenticated;
    insert into warehouse.products(id,sku,name,serialized,attributes) values('master-real','REAL','Master',false,'{"Master data":"approved"}'),('sample','SYN','Synthetic',false,'{"synthetic":true}');
    insert into warehouse.locations(id,name,type,active) values('main','Main','warehouse',true);
    insert into warehouse.stock_levels(id,product_id,location_id,quantity) values('00000000-0000-4000-8000-000000000003','master-real','main',100),('00000000-0000-4000-8000-000000000004','sample','main',9);
    insert into warehouse.inventory_holds(id,product_id,location_id,quantity,status) values('00000000-0000-4000-8000-000000000002','sample','main',2,'active');
    insert into warehouse.fulfillment_orders(id,lines,status,source_location_id) values('00000000-0000-4000-8000-000000000005','[{"productId":"sample","quantity":3}]','allocated','main');
    insert into warehouse.cycle_counts(id,status,created_at,lines) values('sample-count','pending_approval',now(),'[{"productId":"sample"}]');`);
  await db.exec(archive);
});
after(async()=>db.close());
test('exact installed read bodies patch without changing unrelated branches or metadata',async()=>{
  const old=(await db.query('select * from private.warehouse_inventory_position_summary() order by product_id')).rows;
  await db.exec(active);
  assert.deepEqual((await db.query('select * from private.warehouse_inventory_position_summary() order by product_id')).rows,old);
  const definition=(await db.query("select pg_get_functiondef('core.platform_previous_my_work()'::regprocedure) d")).rows[0].d;
  assert.match(definition,/from warehouse.active_cycle_counts/);
  assert.match(definition,/from procurement.requests request/);
  assert.match(definition,/from legal.accreditation_cases accreditation/);
});
test('archive removes synthetic positions/tasks but keeps master balances and original history',async()=>{
  const entries=[];
  for(const [table,id] of [['products','sample'],['stock_levels','00000000-0000-4000-8000-000000000004'],['inventory_holds','00000000-0000-4000-8000-000000000002'],['fulfillment_orders','00000000-0000-4000-8000-000000000005'],['cycle_counts','sample-count']]){
    entries.push({table,row_id:id,row_md5:(await db.query(`select md5(to_jsonb(t)::text) h from warehouse.${table} t where id::text=$1`,[id])).rows[0].h,provenance:'Disposable exact-owned synthetic fixture'});
  }
  const masterBefore=(await db.query("select * from warehouse.inventory_position_v1 where product_id='master-real'")).rows;
  await db.query('select private.archive_uat_warehouse_fixture($1,$2::jsonb)',['uat-read-test-001',JSON.stringify(entries)]);
  assert.deepEqual((await db.query("select * from warehouse.inventory_position_v1 where product_id='master-real'")).rows,masterBefore);
  assert.equal((await db.query("select count(*)::int n from warehouse.inventory_position_v1 where product_id='sample'")).rows[0].n,0);
  assert.equal((await db.query("select count(*)::int n from core.platform_previous_my_work() where id='count:sample-count'")).rows[0].n,0);
  assert.equal((await db.query("select count(*)::int n from warehouse.stock_levels where product_id='sample'")).rows[0].n,1);
});
test('preexisting restrictive scope fingerprint still rejects unexpected RLS changes',async()=>{
  await db.exec('begin');
  try {
    await db.exec('create policy unexpected_scope on warehouse.products as restrictive for select to authenticated using(false)');
    await assert.rejects(db.query('select * from warehouse.inventory_position_v1'),/row scope changed/);
  } finally { await db.exec('rollback'); }
});
test('putaway row numbering excludes archived serialized units before selecting siblings',async()=>{
  await db.exec('begin');
  try {
    await db.exec(`insert into warehouse.products(id,name,serialized,attributes) values('serial-sibling','Device',true,'{"synthetic":true}');
      insert into warehouse.inventory_units(id,product_id,serial_number,location_id,status) values
        ('sibling-a','serial-sibling','SIB-A','main','in_stock'),('sibling-b','serial-sibling','SIB-B','main','in_stock');
      insert into private.uat_warehouse_archive_batches(batch_id,manifest) values('uat-read-partial-probe','[{"test":"read projection only"}]');
      insert into private.uat_warehouse_archive_members(table_name,row_id,batch_id,row_md5,provenance)
        select 'inventory_units',id,'uat-read-partial-probe',md5(to_jsonb(u)::text),'Disposable projection regression only' from warehouse.inventory_units u where id='sibling-a';`);
    assert.deepEqual((await db.query("select source_id from warehouse.warehouse_tasks where source_id in ('sibling-a','sibling-b') order by source_id")).rows,[{source_id:'sibling-b'}]);
  } finally { await db.exec('rollback'); }
});
