import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before,after,test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const baseline=JSON.parse(readFileSync(new URL('./fixtures/uat-archive-external-po-baseline.json',import.meta.url)))[0];
const migration=readFileSync(new URL('../supabase/migrations/20261106174518_uat_archive_external_po_visibility.sql',import.meta.url),'utf8');
const db=new PGlite();
const order=id=>`00000000-0000-4000-8000-${String(id).padStart(12,'0')}`;
async function isolated(fn){await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}}
async function workspace(payload={}){return (await db.query('select private.external_po_workspace($1::jsonb) data',[payload])).rows[0].data;}
async function source(){return (await db.query("select jsonb_build_object('orders',(select jsonb_agg(to_jsonb(t) order by id) from private.external_po_orders t),'lines',(select jsonb_agg(to_jsonb(t) order by id) from private.external_po_lines t),'shipments',(select jsonb_agg(to_jsonb(t) order by id) from private.external_po_shipments t)) data")).rows[0].data;}
before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;
    grant usage on schema private to authenticated;
    create table private.uat_warehouse_archive_members(table_name text,row_id text);
    create function private.is_uat_warehouse_archived(text,text) returns boolean language sql stable as $$select exists(select 1 from private.uat_warehouse_archive_members where table_name=$1 and row_id=$2)$$;
    create function private.external_po_can_read() returns boolean language sql stable as $$select coalesce(current_setting('test.allow',true),'yes')='yes'$$;
    create function private.external_po_can_confirm() returns boolean language sql stable as $$select false$$;
    create table private.external_po_orders(id uuid primary key,status text,created_at timestamptz default now());
    create table private.external_po_lines(id uuid primary key,order_id uuid references private.external_po_orders,product_id text,quantity integer,received_quantity integer);
    create table private.external_po_shipments(id uuid primary key,order_id uuid references private.external_po_orders,lines jsonb,status text,created_at timestamptz default now());
    insert into private.external_po_orders(id,status) values('${order(1)}','confirmed'),('${order(2)}','confirmed'),('${order(3)}','draft'),('${order(4)}','confirmed');
    insert into private.external_po_lines values('${order(11)}','${order(1)}','sample',5,5),('${order(12)}','${order(2)}','master-real',8,0),('${order(13)}','${order(4)}','sample',1,1),('${order(14)}','${order(4)}','master-real',3,0);
    insert into private.external_po_shipments(id,order_id,lines,status) values('${order(21)}','${order(1)}','[{"po_line_id":"${order(11)}"}]','posted');
    insert into private.uat_warehouse_archive_members values('products','sample');
    ${baseline.definition};
    revoke all on function private.external_po_workspace(jsonb) from public,anon,service_role;
    grant execute on function private.external_po_workspace(jsonb) to authenticated;
    revoke all on all tables in schema private from public,anon,authenticated,service_role;
  `);
});
after(async()=>db.close());
test('baseline reproduces archived all-sample orders in active queue',()=>isolated(async()=>{
  assert.equal((await workspace()).orders.some(o=>o.id===order(1)),true);
}));
test('active queue hides only all-archived orders, retaining mixed orders and empty drafts',()=>isolated(async()=>{
  const before=await source();await db.exec(migration);
  assert.deepEqual((await workspace()).orders.map(o=>o.id).sort(),[order(2),order(3),order(4)]);
  assert.deepEqual(await source(),before);
}));
test('direct authorized history still contains the original archived order, lines and shipment',()=>isolated(async()=>{
  const before=await workspace({order_id:order(1)});await db.exec(migration);
  assert.deepEqual(await workspace({order_id:order(1)}),before);
}));
test('pagination counts only active orders before applying page boundaries',()=>isolated(async()=>{
  await db.exec(`insert into private.external_po_orders(id,status) select ('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'confirmed' from generate_series(1,101) i;
    insert into private.external_po_lines(id,order_id,product_id,quantity,received_quantity) select ('20000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,('10000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'sample',1,1 from generate_series(1,101) i;`);
  await db.exec(migration);const page=await workspace();assert.equal(page.orders.length,3);assert.equal(page.has_more,false);
  await db.exec(`insert into private.external_po_orders(id,status) select ('30000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'draft' from generate_series(1,100) i;`);
  assert.equal((await workspace()).has_more,true);assert.equal((await workspace({offset:100})).orders.length,3);
}));
test('archived PO edits, new lines and draft shipments are blocked; unrelated active work still saves',()=>isolated(async()=>{
  await db.exec(migration);
  for(const sql of [`update private.external_po_orders set status='draft' where id='${order(1)}'`,
    `update private.external_po_lines set product_id='master-real' where id='${order(11)}'`,
    `delete from private.external_po_lines where id='${order(11)}'`,
    `insert into private.external_po_lines values('${order(99)}','${order(2)}','sample',1,0)`,
    `insert into private.external_po_shipments(id,order_id,lines,status) values('${order(99)}','${order(1)}','[]','draft')`,
    `insert into private.external_po_shipments(id,order_id,lines,status) values('${order(99)}','${order(4)}','[{"po_line_id":"${order(13)}"}]','draft')`]) {
    await db.exec('savepoint denied');await assert.rejects(db.exec(sql),/archived UAT test/i);await db.exec('rollback to savepoint denied');
  }
  await db.exec(`update private.external_po_orders set status='confirmed' where id='${order(2)}';
    insert into private.external_po_shipments(id,order_id,lines,status) values('${order(98)}','${order(4)}','[{"po_line_id":"${order(14)}"}]','draft');`);
}));
test('direct-history permission and existing function metadata do not expand',()=>isolated(async()=>{
  const before=(await db.query("select to_jsonb(p)-'prosrc' data from pg_proc p where oid='private.external_po_workspace(jsonb)'::regprocedure")).rows[0].data;
  await db.exec(migration);
  const after=(await db.query("select to_jsonb(p)-'prosrc' data from pg_proc p where oid='private.external_po_workspace(jsonb)'::regprocedure")).rows[0].data;
  assert.deepEqual(after,before);
  await db.exec("set local test.allow='no'");
  await assert.rejects(workspace({order_id:order(1)}),/Not authorized/);
}));
test('clients cannot call helper or alter archives',()=>isolated(async()=>{
  await db.exec(migration);await db.exec('set local role authenticated');
  await db.exec('savepoint denial');await assert.rejects(db.query('select private.external_po_all_lines_archived($1)',[order(1)]),/permission denied/);await db.exec('rollback to savepoint denial');
  await db.exec('savepoint denial2');await assert.rejects(db.exec('delete from private.uat_warehouse_archive_members'),/permission denied/);await db.exec('rollback to savepoint denial2');
  await db.exec('reset role');
}));
test('stale transaction snapshots cannot write external PO records',async()=>{
  for(const isolation of ['repeatable read','serializable']){
    await db.exec(`begin isolation level ${isolation}`);
    try{await db.exec(migration);await assert.rejects(db.exec(`update private.external_po_orders set status=status where id='${order(2)}'`),error=>error.code==='40001');}
    finally{await db.exec('rollback');}
  }
});
test('predecessor drift fails closed without changing the reader',()=>isolated(async()=>{
  await db.exec("comment on function private.external_po_workspace(jsonb) is 'metadata only'");
  await db.exec(baseline.definition.replace('Invalid queue position.','Changed predecessor.'));
  await assert.rejects(db.exec(migration),/predecessor drift/);
}));
