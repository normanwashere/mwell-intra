import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = new URL('../supabase/migrations/20260908042408_warehouse_registered_evidence_access.sql', import.meta.url);
const owner = '11111111-1111-4111-8111-111111111111';
const reviewer = '22222222-2222-4222-8222-222222222222';
const vendor = '33333333-3333-4333-8333-333333333333';
const path = 'inspection/%7B%22productId%22%3A%22merch%22%7D/0/photo.png';
// Warehouse capability unions read from installed role_capabilities on 2026-09-08.
const liveOperationalCaps = {
  OA: 'cycle_count,inspect_quality,issue_items,manage_inventory,manage_returns,receive_stock,reserve_allocate,submit_return_case,transfer_stock,view_dashboard,view_exceptions,view_inventory,recommend_replenishment,register_exports,request_fulfillment,request_stock',
  OL: 'approve_stock_adjustment,cycle_count,import_warehouse_data,inspect_quality,issue_items,manage_inventory,manage_locations,manage_operation_routes,manage_products,manage_returns,receive_stock,release_quality_hold,reserve_allocate,resolve_exceptions,submit_return_case,transfer_stock,view_dashboard,view_exceptions,view_inventory',
};
let db;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth; create schema core; create schema private; create schema warehouse; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create function core.has_cap(module text, cap text) returns boolean language sql stable as $$
      select module='warehouse' and cap = any(string_to_array(current_setting('test.caps',true),',')) $$;
    create table core.profiles(id uuid primary key,kind text,status text);
    alter table core.profiles enable row level security;
    create policy self_read on core.profiles for select to authenticated using(id=auth.uid());
    create table storage.buckets(id text primary key,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    insert into storage.buckets values('evidence',false,null,null),('other',false,null,null);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    create table warehouse.receipts(id text,evidence_urls jsonb);
    create table warehouse.returns(id text,evidence_urls jsonb);
    create table warehouse.movements(id text,evidence_urls jsonb);
    create table warehouse.quality_inspections(id text,evidence_urls jsonb);
    create table warehouse.inventory_holds(id text,evidence_urls jsonb,release_evidence_urls jsonb);
    create table warehouse.vendor_returns(id text,evidence_urls jsonb);
    create table warehouse.stock_change_requests(id text,evidence_urls jsonb,requested_by uuid);
    create table warehouse.fulfillment_orders(id text,created_by uuid,lines jsonb,handover_evidence_url text,acknowledgement_evidence_url text,proof_of_delivery_evidence_url text);
    create table warehouse.department_stock_requests(fulfillment_order_id text,requested_by uuid);
    grant usage on schema auth,core,private,warehouse,storage to authenticated,anon,service_role;
    grant select on all tables in schema core,warehouse to authenticated;
    grant select,insert,delete,update on storage.objects to authenticated,anon,service_role;
  `);
  // Source SELECT policies mirror the installed UAT predicates, not a definer shortcut.
  for (const table of ['receipts','returns','movements']) {
    await db.exec(`alter table warehouse.${table} enable row level security;
      create policy read_authenticated on warehouse.${table} for select to authenticated using(true);`);
  }
  for (const table of ['quality_inspections','inventory_holds']) {
    await db.exec(`alter table warehouse.${table} enable row level security;
      create policy quality_read on warehouse.${table} for select to authenticated using(
        core.has_cap('warehouse','inspect_quality') or core.has_cap('warehouse','view_exceptions') or core.has_cap('warehouse','view_finance'));`);
  }
  await db.exec(`
    alter table warehouse.vendor_returns enable row level security;
    create policy vendor_return_read on warehouse.vendor_returns for select to authenticated using(core.has_cap('warehouse','inspect_quality') or core.has_cap('warehouse','view_procurement') or core.has_cap('warehouse','view_exceptions'));
    alter table warehouse.stock_change_requests enable row level security;
    create policy stock_change_read on warehouse.stock_change_requests for select to authenticated using(requested_by=auth.uid() or core.has_cap('warehouse','approve_stock_adjustment') or core.has_cap('warehouse','view_exceptions'));
    alter table warehouse.fulfillment_orders enable row level security;
    create policy fulfillment_read on warehouse.fulfillment_orders for select to authenticated using(
      created_by=auth.uid() or exists(select 1 from warehouse.department_stock_requests r where r.fulfillment_order_id=fulfillment_orders.id and r.requested_by=auth.uid())
      or core.has_cap('warehouse','view_dashboard') or core.has_cap('warehouse','request_fulfillment')
      or core.has_cap('warehouse','reserve_allocate') or core.has_cap('warehouse','issue_items'));
  `);
  await db.exec(await readFile(new URL('../supabase/migrations/20260713192000_storage_evidence_core_capabilities.sql', import.meta.url),'utf8'));
  await db.exec(`create policy evidence_auth_delete on storage.objects for delete to authenticated using(bucket_id='evidence' and owner=auth.uid());`);
  if (!process.env.WAREHOUSE_EVIDENCE_BASELINE) await db.exec(await readFile(migration,'utf8'));
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`reset role; truncate storage.objects,core.profiles,warehouse.receipts,warehouse.returns,warehouse.movements,warehouse.quality_inspections,warehouse.inventory_holds,warehouse.vendor_returns,warehouse.stock_change_requests,warehouse.fulfillment_orders,warehouse.department_stock_requests;
    insert into core.profiles values('${owner}','employee','active'),('${reviewer}','employee','active'),('${vendor}','vendor','active');`);
  await db.query('insert into storage.objects(bucket_id,name,owner) values ($1,$2,$3)', ['evidence',path,owner]);
});
async function asActor(id, caps='') {
  await db.exec('reset role');
  await db.query("select set_config('test.uid',$1,false),set_config('test.caps',$2,false)",[id,caps]);
  await db.exec('set role authenticated');
}
async function visible() { return (await db.query('select name from storage.objects order by name')).rows.map(r=>r.name); }
async function register(table, value=[path]) {
  await db.query(`insert into warehouse.${table}(id,evidence_urls) values ('linked',$1::jsonb)`,[JSON.stringify(value)]);
}

test('independent QC can read exact registered inspection raw paths and upload its own evidence',async()=>{
  await register('quality_inspections');
  await asActor(reviewer,'inspect_quality');
  assert.deepEqual(await visible(),[path]);
  await db.query('insert into storage.objects(bucket_id,name,owner) values ($1,$2,$3)',['evidence','inspection/new.png',reviewer]);
  assert.equal((await visible()).length,2);
});

for (const [table,cap] of [['receipts','receive_stock'],['returns','manage_returns'],['movements','issue_items'],['vendor_returns','inspect_quality'],['quality_inspections','view_exceptions']]) {
  test(`${cap} reads registered ${table}, including legacy evidence/ prefix`,async()=>{
    await register(table,['evidence/'+path]);
    await asActor(reviewer,cap);
    assert.deepEqual(await visible(),[path]);
  });
}

test('hold release evidence is independently visible to QC',async()=>{
  await db.query("insert into warehouse.inventory_holds values('hold','[]',$1::jsonb)",[JSON.stringify([path])]);
  await asActor(reviewer,'inspect_quality');
  assert.deepEqual(await visible(),[path]);
});

for (const [role,caps] of Object.entries(liveOperationalCaps)) {
  test(`installed ${role} warehouse capability union reads registered source rows through authenticated RLS`,async()=>{
    const cases = [['receipts','receipt'],['quality_inspections','quality'],['returns','return'],['movements','movement']];
    for (const [table,key] of cases) {
      const objectPath=`${key}/photo.png`;
      await db.query('insert into storage.objects(bucket_id,name,owner_id) values ($1,$2,$3)',['evidence',objectPath,owner]);
      await register(table,[objectPath]);
    }
    await db.query("insert into warehouse.fulfillment_orders(id,created_by,lines,handover_evidence_url) values('order',$1,'[]',$2)",[owner,path]);
    await asActor(reviewer,caps);
    assert.equal((await visible()).length,5);
    assert.equal((await db.query('delete from storage.objects returning name')).rows.length,0);
  });
}

test('a stricter source policy still hides linked evidence from an otherwise capable QC actor',async()=>{
  await register('quality_inspections');
  await db.exec("create policy evidence_fixture_deny on warehouse.quality_inspections as restrictive for select to authenticated using(false)");
  try {
    await asActor(reviewer,'inspect_quality'); assert.deepEqual(await visible(),[]);
  } finally { await db.exec('reset role; drop policy evidence_fixture_deny on warehouse.quality_inspections'); }
});

test('revoked source SELECT fails closed rather than using definer privileges',async()=>{
  await register('quality_inspections');
  await db.exec('revoke select on warehouse.quality_inspections from authenticated');
  try {
    await asActor(reviewer,'inspect_quality');
    await assert.rejects(visible(), /permission denied for table quality_inspections/);
  } finally { await db.exec('reset role; grant select on warehouse.quality_inspections to authenticated'); }
});

test('unregistered other-owner objects stay private even from Finance; employee owner preview survives',async()=>{
  for (const caps of ['','inspect_quality','receive_stock','view_finance']) {
    await asActor(reviewer,caps); assert.deepEqual(await visible(),[]);
  }
  await asActor(owner); assert.deepEqual(await visible(),[path]);
});

test('unrelated employees and vendor profiles cannot read registered evidence even with injected warehouse caps',async()=>{
  await register('receipts');
  await asActor(reviewer,'view_inventory'); assert.deepEqual(await visible(),[]);
  await asActor(vendor,'receive_stock,inspect_quality,view_finance'); assert.deepEqual(await visible(),[]);
  await assert.rejects(db.query('insert into storage.objects(bucket_id,name,owner) values ($1,$2,$3)',['evidence','vendor/new.png',vendor]),/row-level security/);
  await db.exec('reset role');
  await db.query('update storage.objects set owner=$1',[vendor]);
  await asActor(vendor,'inspect_quality'); assert.deepEqual(await visible(),[]);
});

test('wrong bucket, inactive profile and anonymous actors remain denied',async()=>{
  await register('receipts');
  await db.query("insert into storage.objects(bucket_id,name,owner) values('other','other/photo.png',$1)",[reviewer]);
  await asActor(reviewer,'receive_stock'); assert.deepEqual(await visible(),[path]);
  await db.exec('reset role'); await db.query("update core.profiles set status='inactive' where id=$1",[reviewer]);
  await asActor(reviewer,'receive_stock'); assert.deepEqual(await visible(),[]);
  await db.exec('reset role; set role anon'); assert.deepEqual(await visible(),[]);
});

test('JSON object keys, scalar strings and partial path matches are not registered array links',async()=>{
  for (const invalid of [{[path]:true},path,[path+'.other'],['https://example.test/'+path]]) {
    await db.exec('reset role; truncate warehouse.receipts'); await register('receipts',invalid);
    await asActor(reviewer,'receive_stock'); assert.deepEqual(await visible(),[]);
  }
});

test('source row RLS remains effective for stock changes and fulfillment',async()=>{
  await db.query("insert into warehouse.stock_change_requests values('count',$1::jsonb,$2)",[JSON.stringify([path]),owner]);
  await asActor(reviewer,'cycle_count'); assert.deepEqual(await visible(),[]);
  await asActor(reviewer,'approve_stock_adjustment'); assert.deepEqual(await visible(),[path]);
  await db.exec('reset role; truncate warehouse.stock_change_requests');
  await db.query("insert into warehouse.fulfillment_orders(id,created_by,lines) values('order',$1,$2::jsonb)",[owner,JSON.stringify([{fulfillmentEvidenceUrl:path}])]);
  await asActor(reviewer,'request_stock'); assert.deepEqual(await visible(),[]);
  await db.exec('reset role');
  await db.query("insert into warehouse.department_stock_requests values('order',$1)",[reviewer]);
  await asActor(reviewer,'request_stock'); assert.deepEqual(await visible(),[path]);
});

for (const field of ['handover_evidence_url','acknowledgement_evidence_url','proof_of_delivery_evidence_url']) {
  test(`release operator reads registered fulfillment ${field}`,async()=>{
    await db.query(`insert into warehouse.fulfillment_orders(id,created_by,lines,${field}) values('order',$1,'[]',$2)`,[owner,path]);
    await asActor(reviewer,'issue_items'); assert.deepEqual(await visible(),[path]);
  });
}

test('cross-owner delete, overwrite, and forged-owner upload remain denied',async()=>{
  await register('quality_inspections'); await asActor(reviewer,'inspect_quality');
  assert.equal((await db.query('delete from storage.objects returning name')).rows.length,0);
  assert.equal((await db.query("update storage.objects set name='changed' returning name")).rows.length,0);
  await assert.rejects(db.query('insert into storage.objects(bucket_id,name,owner) values ($1,$2,$3)',['evidence','forged/new.png',owner]),/row-level security/);
  await asActor(owner); assert.equal((await db.query('delete from storage.objects returning name')).rows.length,0);
});

test('current owner_id-only uploads and legacy owner-only previews work but browser cleanup is denied',async()=>{
  await asActor(reviewer,'inspect_quality');
  await db.query("insert into storage.objects(bucket_id,name,owner_id) values('evidence','new/photo.png',$1)",[reviewer]);
  assert.deepEqual(await visible(),['new/photo.png']);
  assert.equal((await db.query('delete from storage.objects returning name')).rows.length,0);
  await asActor(owner); assert.deepEqual(await visible(),[path]);
  assert.equal((await db.query('delete from storage.objects returning name')).rows.length,0);
});

test('registered owners cannot delete evidence even when the registration row is invisible',async()=>{
  await register('quality_inspections');
  await asActor(owner);
  assert.equal((await db.query('select * from warehouse.quality_inspections')).rows.length,0);
  assert.deepEqual(await visible(),[path]);
  assert.equal((await db.query('delete from storage.objects returning name')).rows.length,0);
});

test('restrictive evidence deletion boundary survives another permissive policy; service cleanup stays separate',async()=>{
  await db.exec('create policy fixture_broad_delete on storage.objects for delete to authenticated using(true)');
  try {
    await asActor(owner); assert.equal((await db.query('delete from storage.objects returning name')).rows.length,0);
    await db.exec('reset role; set role service_role');
    assert.equal((await db.query('delete from storage.objects returning name')).rows.length,1);
  } finally { await db.exec('reset role; drop policy fixture_broad_delete on storage.objects'); }
});

test('owner_id is authoritative over conflicting deprecated owner and neither can be forged at upload',async()=>{
  await db.query('update storage.objects set owner_id=$1',[reviewer]);
  await asActor(owner,'inspect_quality'); assert.deepEqual(await visible(),[]);
  assert.equal((await db.query('delete from storage.objects returning name')).rows.length,0);
  await assert.rejects(db.query("insert into storage.objects(bucket_id,name,owner,owner_id) values('evidence','conflict/new.png',$1,$2)",[reviewer,owner]),/row-level security/);
  await assert.rejects(db.query("insert into storage.objects(bucket_id,name,owner,owner_id) values('evidence','forged/new.png',$1,$2)",[owner,reviewer]),/row-level security/);
  await asActor(reviewer); assert.deepEqual(await visible(),[path]);
});

test('actual migration keeps bucket private with raster 8MiB limit and leaves other buckets untouched',async()=>{
  const rows=(await db.query('select * from storage.buckets order by id')).rows;
  assert.deepEqual(rows,[{id:'evidence',public:false,file_size_limit:8388608,allowed_mime_types:['image/jpeg','image/png','image/webp','image/gif']},{id:'other',public:false,file_size_limit:null,allowed_mime_types:null}]);
  const defs=(await db.query("select proname,prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private'")).rows;
  assert.ok(defs.length>=4); assert.ok(defs.every(r=>r.prosecdef===false));
});
