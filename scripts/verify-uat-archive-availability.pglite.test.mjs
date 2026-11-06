import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const baseline=JSON.parse(readFileSync(new URL('./fixtures/uat-archive-availability-baseline.json',import.meta.url)));
const policies=JSON.parse(readFileSync(new URL('./fixtures/uat-archive-handoff-policies.json',import.meta.url)));
const patch=readFileSync(new URL('../supabase/migrations/20261106191404_uat_archive_availability_and_po_queue.sql',import.meta.url),'utf8');
const db=new PGlite();
async function isolated(fn){await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}}
async function atp(){return (await db.query("select warehouse.available_to_promise('master') value")).rows[0].value;}
async function rows(relation){return (await db.query(`select id,lines from warehouse.${relation} order by id`)).rows;}
async function source(){return (await db.query(`select jsonb_build_object('orders',(select jsonb_agg(to_jsonb(t) order by id) from procurement.purchase_orders t),
  'lines',(select jsonb_agg(to_jsonb(t) order by id) from procurement.purchase_order_lines t),
  'stock',(select jsonb_agg(to_jsonb(t) order by id) from warehouse.stock_levels t),
  'units',(select jsonb_agg(to_jsonb(t) order by id) from warehouse.inventory_units t),
  'holds',(select jsonb_agg(to_jsonb(t) order by id) from warehouse.inventory_holds t),
  'allocations',(select jsonb_agg(to_jsonb(t) order by id) from warehouse.allocations t)) value`)).rows[0].value;}
before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema warehouse;create schema private;create schema procurement;create schema core;
    grant usage on schema warehouse,private,procurement,core to authenticated,service_role;
    select set_config('test.reader','warehouse',false);
    create function core.has_cap(text,text) returns boolean language sql stable as $$select
      (current_setting('test.reader')='warehouse' and $1='warehouse' and $2='receive_stock')
      or (current_setting('test.reader')='procurement' and $1='procurement' and $2='author_po')$$;
    create function private.is_goods_procurement_request(text) returns boolean language sql stable as $$select $1<>'services'$$;
    create function private.can_read_procurement_request(text) returns boolean language sql stable as $$select current_setting('test.reader')='requester' and $1='owned-request'$$;
    create table private.uat_warehouse_archive_members(table_name text,row_id text,primary key(table_name,row_id));
    create function private.is_uat_warehouse_archived(text,text) returns boolean language sql stable security definer set search_path='' as
      $$select exists(select 1 from private.uat_warehouse_archive_members where table_name=$1 and row_id=$2)$$;
    revoke all on private.uat_warehouse_archive_members from public,anon,authenticated,service_role;
    create table warehouse.stock_levels(id text primary key,product_id text,quantity integer);
    create table warehouse.inventory_units(id text primary key,product_id text,status text);
    create table warehouse.allocations(id text primary key,product_id text,quantity integer,status text);
    create table warehouse.inventory_holds(id text primary key,product_id text,quantity integer,status text);
    insert into warehouse.stock_levels values('opening','master',100),('test-pens','master',2);
    insert into warehouse.inventory_units values('real','master','in_stock'),('test-watch','master','in_stock'),('issued','master','issued');
    insert into warehouse.allocations values('active-demand','master',3,'reserved'),('old-demand','master',4,'allocated'),('issued-demand','master',99,'issued');
    insert into warehouse.inventory_holds values('real-hold','master',2,'active'),('old-hold','master',1,'active'),('released','master',99,'released');
    insert into private.uat_warehouse_archive_members values('products','sample'),('stock_levels','test-pens'),('inventory_units','test-watch'),('allocations','old-demand'),('inventory_holds','old-hold');
    create table procurement.purchase_orders(id text primary key,po_number text,vendor_name text,status text,expected_date date,created_at timestamptz,total numeric,request_id text);
    create table procurement.purchase_order_lines(id text primary key,purchase_order_id text,warehouse_product_id text,description text,quantity integer,received_quantity integer,uom text,unit_price numeric,line_no integer);
    insert into procurement.purchase_orders(id,status,request_id) values('archived','issued','goods'),('mixed','issued','goods'),('unmapped','issued','goods'),('empty','issued','goods'),('active','approved','owned-request'),('not-goods','issued','services'),('draft','draft','goods');
    insert into procurement.purchase_order_lines(id,purchase_order_id,warehouse_product_id,line_no) values
      ('a','archived','sample',1),('b','mixed','sample',1),('c','mixed','master',2),('d','unmapped',null,1),('e','unmapped','sample',2),('f','active','master',1);
    alter table procurement.purchase_orders enable row level security;
    alter table procurement.purchase_order_lines enable row level security;
    grant select on procurement.purchase_orders,procurement.purchase_order_lines to authenticated,service_role;`);
  for(const p of policies) await db.exec(`create policy ${p.policyname} on ${p.schemaname}.${p.tablename} as permissive for select to authenticated using (${p.qual})`);
  for(const table of ['stock_levels','inventory_units','allocations','inventory_holds']){
    await db.exec(`create view warehouse.active_${table} with(security_invoker=true) as select * from warehouse.${table} t where not private.is_uat_warehouse_archived('${table}',t.id);`);
  }
  await db.exec(baseline.atp.definition);
  await db.exec(`revoke all on function warehouse.available_to_promise(text) from public,anon,authenticated,service_role;
    grant execute on function warehouse.available_to_promise(text) to authenticated,service_role;
    create view warehouse.procurement_po_handoff with(security_invoker=true) as ${baseline.handoff.definition}
    grant all on warehouse.procurement_po_handoff to authenticated,service_role;`);
});
after(async()=>db.close());

test('ATP excludes only exact retired rows and keeps original status arithmetic',()=>isolated(async()=>{
  assert.equal(await atp(),94);const before=await source();await db.exec(patch);
  assert.equal(await atp(),96);assert.deepEqual(await source(),before);
  await db.exec("update warehouse.allocations set quantity=10000 where id='active-demand'");assert.equal(await atp(),0);
}));
test('OCT19 two-pen exclusion preserves every original master stock row',()=>isolated(async()=>{
  await db.exec("delete from warehouse.inventory_units;delete from warehouse.allocations;delete from warehouse.inventory_holds");
  const before=await source();assert.equal(await atp(),102);await db.exec(patch);assert.equal(await atp(),100);assert.deepEqual(await source(),before);
}));
test('active PO queue excludes only nonempty fully mapped wholly retired headers',()=>isolated(async()=>{
  const raw=await rows('procurement_po_handoff'),before=await source();await db.exec(patch);
  const active=await rows('active_procurement_po_handoff');assert.deepEqual(active.map(r=>r.id),['active','empty','mixed','unmapped']);
  assert.deepEqual(active.find(r=>r.id==='mixed').lines,raw.find(r=>r.id==='mixed').lines);
  assert.deepEqual(await rows('procurement_po_handoff'),raw);assert.deepEqual(await source(),before);
}));
test('actual header/line policies retain role visibility; no raw fallback or permission widening',()=>isolated(async()=>{
  await db.exec(patch);
  for(const reader of ['warehouse','procurement','requester','none']){
    await db.query("select set_config('test.reader',$1,true)",[reader]);await db.exec('set local role authenticated');
    const raw=await rows('procurement_po_handoff');const active=await rows('active_procurement_po_handoff');
    assert.deepEqual(active,raw.filter(r=>r.id!=='archived'),reader);await db.exec('reset role');
  }
  await db.exec('set local role service_role');const raw=await rows('procurement_po_handoff');assert.deepEqual(await rows('active_procurement_po_handoff'),raw.filter(r=>r.id!=='archived'));await db.exec('reset role');
  for(const role of ['anon','authenticated','service_role']){
    const grants=(await db.query("select has_table_privilege($1,'warehouse.active_procurement_po_handoff','select') read,has_table_privilege($1,'warehouse.active_procurement_po_handoff','insert') write",[role])).rows[0];
    assert.deepEqual(grants,{read:role!=='anon',write:false});
  }
}));
test('existing ATP and base-view metadata, policy definitions, and raw history remain unchanged',()=>isolated(async()=>{
  const q="select to_jsonb(p)-'prosrc' value from pg_proc p where oid='warehouse.available_to_promise(text)'::regprocedure";
  const v="select to_jsonb(c) value,pg_get_viewdef(oid) definition from pg_class c where oid='warehouse.procurement_po_handoff'::regclass";
  const before=(await db.query(q)).rows,view=(await db.query(v)).rows,policy=(await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows;
  await db.exec(patch);assert.deepEqual((await db.query(q)).rows,before);assert.deepEqual((await db.query(v)).rows,view);
  assert.deepEqual((await db.query('select * from pg_policies order by schemaname,tablename,policyname')).rows,policy);
}));
test('predecessor ATP drift and base handoff drift fail closed',()=>isolated(async()=>{
  await db.exec(baseline.atp.definition.replace('greatest(0,','greatest(1,'));
  await assert.rejects(db.exec(patch),/predecessor drift/i);
}));
test('base handoff drift fails before altering ATP',()=>isolated(async()=>{
  await db.exec(`create or replace view warehouse.procurement_po_handoff with(security_invoker=true) as ${baseline.handoff.definition.replace("'Unknown vendor'","'Changed vendor'")}`);
  await assert.rejects(db.exec(patch),/predecessor drift/i);
}));
