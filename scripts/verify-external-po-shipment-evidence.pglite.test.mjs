import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, beforeEach, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { functionDefinition } from './quality-inspection-verifier-fixture.mjs';

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const owner = '11111111-1111-4111-8111-111111111111';
const lead = '22222222-2222-4222-8222-222222222222';
const vendor = '33333333-3333-4333-8333-333333333333';
const objectPath = 'external-po/shipment/0/photo.png';
const orderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let db;
let priorPolicies;
let priorFunctions;

const policies = async () => (await db.query(`select policyname,permissive,roles,cmd,qual,with_check
  from pg_policies where schemaname='storage' and tablename='objects'
    and policyname<>'external_po_shipment_evidence_read' order by policyname`)).rows;
const functions = async () => (await db.query(`select p.oid,pg_get_functiondef(p.oid) body,p.proacl::text acl
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('private','core') and p.proname<>'external_po_shipment_evidence_readable'
  order by p.oid`)).rows;

before(async () => {
  db = new PGlite();
  // Minimal record schemas; execute the actual registered-evidence policies and workspace guard.
  await db.exec(`
    create role authenticated; create role anon; create role service_role bypassrls;
    create schema auth; create schema core; create schema private; create schema warehouse; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create function core.has_cap(module text,cap text) returns boolean language sql stable as $$
      select module='warehouse' and cap=any(string_to_array(current_setting('test.caps',true),',')) $$;
    create function core.has_live_cap(module text,cap text) returns boolean language sql stable as $$
      select core.has_cap(module,cap) and current_setting('test.live',true)='true' $$;
    create table core.profiles(id uuid primary key,kind text,status text);
    alter table core.profiles enable row level security;
    create policy self_read on core.profiles for select to authenticated using(id=auth.uid());
    create table storage.buckets(id text primary key,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    insert into storage.buckets values('evidence',false,null,null),('warehouse-po-evidence',false,null,null),('other',false,null,null);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner uuid,owner_id text,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    create table warehouse.receipts(id text,evidence_urls jsonb);
    create table warehouse.returns(id text,evidence_urls jsonb);
    create table warehouse.movements(id text,evidence_urls jsonb);
    create table warehouse.quality_inspections(id text,evidence_urls jsonb);
    create table warehouse.inventory_holds(id text,evidence_urls jsonb,release_evidence_urls jsonb);
    create table warehouse.vendor_returns(id text,evidence_urls jsonb);
    create table warehouse.stock_change_requests(id text,evidence_urls jsonb);
    create table warehouse.fulfillment_orders(id text,lines jsonb,handover_evidence_url text,acknowledgement_evidence_url text,proof_of_delivery_evidence_url text);
    create table private.external_po_orders(id uuid primary key);
    create table private.external_po_shipments(id uuid primary key default gen_random_uuid(),order_id uuid references private.external_po_orders(id),status text,evidence_urls jsonb);
    alter table private.external_po_orders enable row level security;
    alter table private.external_po_orders force row level security;
    alter table private.external_po_shipments enable row level security;
    alter table private.external_po_shipments force row level security;
    revoke all on private.external_po_orders,private.external_po_shipments from public,anon,authenticated,service_role;
    grant usage on schema auth,core,private,warehouse,storage to authenticated,anon,service_role;
    grant select on all tables in schema core,warehouse to authenticated;
    grant select,insert,update,delete on storage.objects to authenticated,anon,service_role;
  `);
  for (const table of ['receipts','returns','movements','quality_inspections','inventory_holds','vendor_returns','stock_change_requests','fulfillment_orders']) {
    await db.exec(`alter table warehouse.${table} enable row level security;
      create policy fixture_read on warehouse.${table} for select to authenticated using(true)`);
  }
  await db.exec(await migration('20260908042408_warehouse_registered_evidence_access.sql'));
  const external = await migration('20261019142956_warehouse_external_po_receiving.sql');
  await db.exec(functionDefinition(external, 'private.external_po_can_read'));
  await db.exec('revoke all on function private.external_po_can_read() from public,anon,authenticated,service_role');
  priorPolicies = await policies();
  priorFunctions = await functions();
  await db.exec(await migration('20261019145212_external_po_shipment_evidence_access.sql'));
});
after(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec(`reset role;
    truncate storage.objects,core.profiles,warehouse.receipts,private.external_po_shipments,private.external_po_orders;
    insert into core.profiles values('${owner}','employee','active'),('${lead}','employee','active'),('${vendor}','vendor','active');
    insert into private.external_po_orders values('${orderId}');
    select set_config('test.live','true',false);`);
  await db.query("insert into storage.objects(bucket_id,name,owner_id) values('evidence',$1,$2)", [objectPath,owner]);
});
async function actor(id=lead,caps='receive_stock') {
  await db.exec('reset role');
  await db.query("select set_config('test.uid',$1,false),set_config('test.caps',$2,false)", [id,caps]);
  await db.exec('set role authenticated');
}
async function visible() {
  return (await db.query('select bucket_id,name from storage.objects order by bucket_id,name')).rows;
}
const expected = [{ bucket_id: 'evidence', name: objectPath }];
async function shipment(paths=[objectPath],status='draft') {
  await db.exec('reset role; truncate private.external_po_shipments');
  await db.query('insert into private.external_po_shipments(order_id,status,evidence_urls) values($1,$2,$3::jsonb)', [orderId,status,JSON.stringify(paths)]);
}

test('baseline policy denies cross-owner draft evidence but posting a receipt makes it readable', async () => {
  await shipment();
  await db.exec('begin; drop policy if exists external_po_shipment_evidence_read on storage.objects');
  try {
    await actor(owner); assert.deepEqual(await visible(), expected);
    await actor(); assert.deepEqual(await visible(), []);
    await db.exec('reset role');
    await db.query("insert into warehouse.receipts values('posted',$1::jsonb)", [JSON.stringify([objectPath])]);
    await actor(); assert.deepEqual(await visible(), expected);
  } finally { await db.exec('reset role; rollback'); }
});

for (const status of ['draft','posted']) {
  test(`authorized external PO participants read only exact ${status} shipment evidence in either path form`, async () => {
    await db.query("insert into storage.objects(bucket_id,name,owner_id) values('evidence','unrelated/photo.png',$1),('other',$2,$1),('warehouse-po-evidence',$2,$1)", [owner,objectPath]);
    for (const paths of [[objectPath],['evidence/'+objectPath]]) {
      await shipment(paths,status);
      for (const cap of ['receive_stock','inspect_quality','view_procurement']) {
        await actor(lead,cap); assert.deepEqual(await visible(), expected);
      }
    }
  });
}

test('raw capability without live authority, unrelated staff, vendors and inactive profiles cannot read shipment evidence', async () => {
  await shipment();
  for (const cap of ['', 'view_inventory', 'view_finance', 'issue_items']) {
    await actor(lead,cap); assert.deepEqual(await visible(), []);
  }
  await actor(vendor,'receive_stock,inspect_quality,view_procurement'); assert.deepEqual(await visible(), []);
  await actor();
  await db.query("select set_config('test.live','false',false)");
  assert.deepEqual(await visible(), []);
  await db.exec("reset role; select set_config('test.live','true',false)");
  await db.query("update core.profiles set status='inactive' where id=$1", [lead]);
  await actor(); assert.deepEqual(await visible(), []);
  await actor('', 'receive_stock'); assert.deepEqual(await visible(), []);
  await db.exec('reset role; set role anon'); assert.deepEqual(await visible(), []);
  await assert.rejects(db.query('select private.external_po_shipment_evidence_readable($1)', [objectPath]), /permission denied/);
});

test('unsaved, detached, malformed, partial and URL references do not authorize object reads', async () => {
  for (const paths of [[],null,{[objectPath]:true},objectPath,[objectPath+'.other'],['https://example.invalid/'+objectPath],['warehouse-po-evidence/'+objectPath]]) {
    await shipment(paths); await actor(); assert.deepEqual(await visible(), []);
  }
  await shipment(); await actor(); assert.deepEqual(await visible(), expected);
  await db.exec("reset role; update private.external_po_shipments set evidence_urls='[]'");
  await actor(); assert.deepEqual(await visible(), []);
});

test('shipment read policy does not grant private-table access, evidence mutation or forged uploads', async () => {
  await shipment(); await actor();
  assert.deepEqual(await visible(), expected);
  for (const table of ['external_po_orders','external_po_shipments']) {
    await assert.rejects(db.query(`select * from private.${table}`), /permission denied/);
    await assert.rejects(db.query(`delete from private.${table}`), /permission denied/);
  }
  assert.equal((await db.query("update storage.objects set name='changed' returning name")).rows.length, 0);
  assert.equal((await db.query('delete from storage.objects returning name')).rows.length, 0);
  await assert.rejects(db.query("insert into storage.objects(bucket_id,name,owner_id) values('evidence','forged/photo.png',$1)", [owner]), /row-level security/);
  await actor(lead,'view_procurement');
  await assert.rejects(db.query("insert into storage.objects(bucket_id,name,owner_id) values('evidence','read-only/photo.png',$1)", [lead]), /row-level security/);
});

test('existing policy and function definitions stay unchanged; new helper has a private hardened boundary', async () => {
  assert.deepEqual(await policies(), priorPolicies);
  assert.deepEqual(await functions(), priorFunctions);
  assert.equal((await db.query('select bool_or(public) public from storage.buckets')).rows[0].public, false);
  const result = (await db.query(`select p.prosecdef,pg_get_userbyid(p.proowner) owner,p.proconfig,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
    has_function_privilege('anon',p.oid,'EXECUTE') anon,
    has_function_privilege('service_role',p.oid,'EXECUTE') service_role
    from pg_proc p where p.oid='private.external_po_shipment_evidence_readable(text)'::regprocedure`)).rows[0];
  assert.deepEqual(result, {prosecdef:true,owner:'postgres',proconfig:['search_path=""'],authenticated:true,anon:false,service_role:false});
});
