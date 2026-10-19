import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { before, after, beforeEach, afterEach } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { functionDefinition } from './quality-inspection-verifier-fixture.mjs';

const migrationName = '20261019153041_external_po_procurement_duplicate_guard.sql';
const sql = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const receiver = '11111111-1111-4111-8111-111111111111';
const lead = '22222222-2222-4222-8222-222222222222';
const outsider = '33333333-3333-4333-8333-333333333333';
const orderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const lineId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const shipmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
let db;
let sequence = 0;
let migration;
let historical;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema core; create schema private; create schema warehouse; create schema storage; create schema procurement;
    grant usage on schema warehouse,private,procurement to authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email','test@example.invalid') $$;
    create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
    create function core.has_live_cap(text,text) returns boolean language sql stable as $$ select auth.uid() in ('${receiver}','${lead}') $$;
    create function core.has_cap(text,text) returns boolean language sql stable as $$ select core.has_live_cap($1,$2) $$;
    create table core.profiles(id uuid primary key,status text,kind text);
    create table core.roles(module text,role text,is_active boolean);
    create table core.user_roles(user_id uuid,module text,role text,effective_at timestamptz,expires_at timestamptz);
    create table core.activity_log(id bigserial,module text,entity_type text,entity_id text,action text,actor uuid,detail jsonb);
    create table warehouse.products(id text primary key,sku text,serialized boolean,unit_cost numeric default 0,uom text default 'piece',expiry_tracked boolean default false);
    create table warehouse.locations(id text primary key,type text,active boolean);
    create table warehouse.storage_areas(id text primary key,location_id text,active boolean);
    create table warehouse.suppliers(id text primary key,name text,lead_time_days integer default 0);
    create table warehouse.receipts(id text primary key,supplier_id text,location_id text,lines jsonb,evidence_urls jsonb,actor text,created_at timestamptz default now(),quality_status text,actual_delivery_date date,delivery_reference text,received_by uuid,procurement_po_id text,operation_route_id uuid);
    create table warehouse.lots(id text primary key,product_id text,lot_code text,supplier_id text,unit_cost numeric,received_at timestamptz,expiry_date date);
    create table warehouse.inventory_units(id text primary key,product_id text,serial_number text unique,lot_id text,location_id text,bin_id text,status text);
    create table warehouse.stock_levels(product_id text,location_id text,bin_id text,lot_id text,quantity integer,unique nulls not distinct(product_id,location_id,bin_id,lot_id));
    create table warehouse.movements(id text primary key,type text,product_id text,quantity integer,to_location_id text,to_bin_id text,lot_id text,reference text,evidence_urls jsonb,actor text,created_at timestamptz default now());
    create table warehouse.quality_inspections(id uuid primary key default gen_random_uuid(),source_type text,source_id text,product_id text,lot_id text,serial_number text,location_id text,bin_id text,quantity integer,disposition text,reason text,evidence_urls jsonb,inspected_by uuid,inspected_by_email text,inspected_at timestamptz default now(),procurement_po_line_id text);
    create table warehouse.inventory_holds(id uuid primary key default gen_random_uuid(),inspection_id uuid,product_id text,location_id text,bin_id text,lot_id text,serial_number text,quantity integer,status text default 'active',reason text,evidence_urls jsonb,created_by uuid,created_at timestamptz default now(),released_by uuid,released_at timestamptz,release_reason text,release_evidence_urls jsonb);
    create table warehouse.exceptions(id uuid primary key default gen_random_uuid(),exception_type text,severity text,source_type text,source_id text,status text,resolution text,evidence_urls jsonb,created_by uuid);
    create table warehouse.command_log(id uuid primary key default gen_random_uuid(),actor_id uuid,command_name text,idempotency_key text,payload_hash text,response jsonb,completed_at timestamptz,unique(actor_id,command_name,idempotency_key));
    create function private.warehouse_payload_hash(p jsonb) returns text language sql immutable as $$ select encode(sha256(convert_to(p::text,'UTF8')),'hex') $$;
    create function warehouse.authoritative_actor() returns text language sql as $$ select auth.uid()::text $$;
    create function private.warehouse_inspect_quality_v3(p jsonb) returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function private.inspect_return_intake(p jsonb) returns jsonb language sql as $$ select '{}'::jsonb $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text,owner uuid);
    alter table storage.objects enable row level security;
    create table procurement.purchase_orders(id text primary key,po_number text unique,status text,core_vendor_id uuid default '${lead}',vendor_name text default 'Other supplier identity',updated_at timestamptz default now());
    alter table procurement.purchase_orders enable row level security;
    grant select on procurement.purchase_orders to authenticated;
    create table procurement.purchase_order_lines(id text primary key,purchase_order_id text,description text default 'Bulk goods',quantity integer default 10,received_quantity integer default 0,receiving_status text default 'open',warehouse_product_id text default 'bag');
    create table warehouse.procurement_receipt_exception_lines(decision_id uuid,po_line_id text,active boolean);
    create table warehouse.procurement_receipt_exception_decisions(id uuid,purchase_order_id text);
    create table warehouse.procurement_receipt_serial_claims(serial_number text,status text);
    create function private.assert_goods_procurement_po(text) returns void language plpgsql as $$ begin end $$;
    create table warehouse.operation_types(id uuid primary key default gen_random_uuid(),code text,active boolean);
    create table warehouse.operation_routes(id uuid primary key default gen_random_uuid(),operation_type_id uuid,active boolean,source_location_types text[],destination_location_types text[],requires_evidence boolean,created_at timestamptz default now());
    insert into warehouse.operation_types(code,active) values('receipt',true);
    insert into warehouse.operation_routes(operation_type_id,active,source_location_types,destination_location_types,requires_evidence) select id,true,array['vendor'],array['warehouse'],true from warehouse.operation_types;
    insert into core.profiles values('${receiver}','active','employee'),('${lead}','active','employee'),('${outsider}','active','employee');
    insert into core.roles values('warehouse','warehouse_supervisor',true);
    insert into core.user_roles values('${lead}','warehouse','warehouse_supervisor',now()-interval '1 day',null);
    insert into warehouse.locations values('wh','warehouse',true);
    insert into warehouse.storage_areas values('stage','wh',true);
    insert into warehouse.suppliers(id,name) values('supplier','External supplier');
    insert into warehouse.products(id,sku,serialized) values('bag','BAG',false);
    insert into storage.objects(bucket_id,name,owner_id) values('warehouse-po-evidence','${receiver}/po.pdf','${receiver}'),('evidence','external/shipment.png','${receiver}');
  `);
  const commands = await sql('20260710160000_warehouse_w1_quality_and_approval_rpcs.sql');
  await db.exec(functionDefinition(commands, 'private.begin_idempotent_command'));
  await db.exec(functionDefinition(commands, 'private.finish_idempotent_command'));
  await db.exec(functionDefinition(await sql('20260714175318_single_po_receipt_authority.sql'), 'private.lock_warehouse_products'));
  await db.exec(functionDefinition(await sql('20260826015244_governed_po_receipt_breakdown.sql'), 'private.warehouse_receive_procurement_po_breakdown'));
  await db.exec(await sql('20261019142956_warehouse_external_po_receiving.sql'));
  await db.exec('begin'); await actor(receiver); await ready(); await command(post);
  const beforeMigration = await counts();
  const functionBodies = await db.query("select oid::regprocedure::text signature,prosrc from pg_proc where pronamespace in ('private'::regnamespace,'warehouse'::regnamespace) order by signature");
  await db.exec('commit');
  migration = await sql(migrationName);
  await db.exec(migration);
  historical = { before:beforeMigration,after:await counts(),claims:(await db.query('select * from private.po_receiving_source_claims')).rows };
  for (const row of functionBodies.rows) {
    assert.equal((await db.query('select prosrc from pg_proc where oid=$1::regprocedure',[row.signature])).rows[0].prosrc,row.prosrc,`${row.signature} must remain unchanged`);
  }
  await db.exec(`truncate private.external_po_orders,private.external_po_lines,private.external_po_shipments,
    warehouse.receipts,warehouse.lots,warehouse.inventory_units,warehouse.stock_levels,warehouse.movements,
    warehouse.quality_inspections,warehouse.inventory_holds,warehouse.command_log,core.activity_log cascade;
    delete from private.po_receiving_source_claims;`);
});
after(async () => { await db?.close(); });
beforeEach(async () => { await db.exec('begin'); await actor(receiver); });
afterEach(async () => { await db.exec('rollback'); });
const actor = id => db.query("select set_config('test.actor',$1,true)",[id]);
const command = async (p,key=`duplicate-test-${++sequence}`) => (await db.query('select warehouse.external_po_command($1::jsonb) result',[JSON.stringify({...p,idempotency_key:key})])).rows[0].result;
const order = (extra={}) => ({action:'save_order',order_id:orderId,version:0,po_number:'PO-101',supplier_id:'supplier',location_id:'wh',email_sender:'buyer@example.invalid',email_date:'2026-10-18',evidence_urls:[`warehouse-po-evidence/${receiver}/po.pdf`],lines:[{id:lineId,product_id:'bag',quantity:10,uom:'piece'}],...extra});
const shipment = (extra={}) => ({action:'save_shipment',order_id:orderId,shipment_id:shipmentId,version:0,delivery_reference:'DR-101',actual_delivery_date:'2026-10-18',bin_id:'stage',evidence_urls:['external/shipment.png'],lines:[{po_line_id:lineId,quantity:4,serial_numbers:[]}],...extra});
const post = {action:'post_shipment',order_id:orderId,shipment_id:shipmentId,version:1};
async function confirm() { await actor(lead); await command({action:'confirm_order',order_id:orderId,version:1,review_note:'Checked PO document'}); await actor(receiver); }
async function ready() { await command(order()); await confirm(); await command(shipment()); }
async function procurement(number='PO-101',status='issued',id='proc-1') {
  await db.query('insert into procurement.purchase_orders(id,po_number,status) values($1,$2,$3)',[id,number,status]);
  await db.query('insert into procurement.purchase_order_lines(id,purchase_order_id) values($1,$2)',[`${id}-line`,id]);
}
const receiveProcurement = async (id='proc-1',key=`proc-receive-${++sequence}`) => (await db.query('select private.warehouse_receive_procurement_po_breakdown($1::jsonb) result',[JSON.stringify({
  po_id:id,idempotency_key:key,location_id:'wh',bin_id:'stage',evidence_urls:['shipment.png'],
  lines:[{line_id:`${id}-line`,product_id:'bag',expected_quantity:10,outcomes:{clean:{quantity:10}}}],
})])).rows[0].result;
async function rejects(fn, pattern) {
  await db.exec('savepoint rejected_action');
  try { await assert.rejects(fn,pattern); } finally { await db.exec('rollback to savepoint rejected_action; release savepoint rejected_action'); }
}
async function counts() {
  return (await db.query(`select (select count(*)::int from warehouse.receipts) receipts,
    (select coalesce(sum(quantity),0)::int from warehouse.stock_levels) stock,
    (select count(*)::int from warehouse.movements) movements,
    (select count(*)::int from warehouse.inventory_holds) holds,
    (select count(*)::int from warehouse.quality_inspections) inspections,
    (select count(*)::int from warehouse.command_log) commands,
    (select coalesce(sum(received_quantity),0)::int from procurement.purchase_order_lines) procurement_received,
    (select coalesce(sum(received_quantity),0)::int from private.external_po_lines) external_received`)).rows[0];
}

for (const number of ['PO-101','po-101','  Po-101  ']) {
  test(`external registration rejects the canonical Procurement number ${JSON.stringify(number)}`,async()=>{
    await procurement(number,'closed');
    await db.exec('set local role authenticated');
    assert.equal((await db.query('select * from procurement.purchase_orders')).rows.length,0);
    await rejects(()=>command(order()),/already exists in Procurement/);
    await db.exec('reset role');
    assert.equal((await db.query('select * from private.external_po_orders')).rows.length,0);
    assert.deepEqual(await counts(),{receipts:0,stock:0,movements:0,holds:0,inspections:0,commands:0,procurement_received:0,external_received:0});
  });
}
test('fresh posting rejects a Procurement PO created after external confirmation',async()=>{
  await ready(); await procurement();
  const before = await counts();
  await rejects(()=>command(post),/already exists in Procurement/);
  assert.deepEqual(await counts(),before);
});
test('reverse order blocks actual Procurement bulk receipt but not Procurement creation',async()=>{
  await ready(); await command(post); await procurement();
  const before = await counts();
  await rejects(()=>receiveProcurement(),/received through External PO.*reconcile/i);
  assert.deepEqual(await counts(),before);
  assert.equal((await db.query('select status from procurement.purchase_orders')).rows[0].status,'issued');
});

test('migration seeds existing posted external sources without rewriting any custody or function body',()=>{
  assert.deepEqual(historical.after,historical.before);
  assert.deepEqual(historical.claims,[{normalized_po_number:'po-101',source:'external'}]);
  assert.doesNotMatch(migration,/create\s+or\s+replace\s+function|alter\s+function\s+(?:warehouse\.|private\.external_po_command)/i);
  assert.ok(migration.lastIndexOf('insert into private.po_receiving_source_claims')>migration.indexOf('create trigger warehouse_po_receipt_source_guard'));
});

test('existing posted external linkage also blocks Procurement receipt independently of the source claim',async()=>{
  await ready(); await command(post); await procurement();
  await db.exec('delete from private.po_receiving_source_claims');
  const before=await counts();
  await rejects(()=>receiveProcurement(),/received through External PO.*reconcile/i);
  assert.deepEqual(await counts(),before);
});

for (const status of ['draft','pending_approval','approved','issued','cancelled']) {
  test(`canonical matches are blocked even when the Procurement PO is ${status}`,async()=>{
    await procurement('PO-101',status);
    await rejects(()=>command(order()),/already exists in Procurement/);
  });
}

test('a blank-number external draft is allowed, but matching edits and later confirmation are blocked',async()=>{
  await command(order({po_number:null})); await procurement();
  await rejects(()=>command(order({version:1})),/already exists in Procurement/);
  assert.equal((await db.query('select po_number from private.external_po_orders')).rows[0].po_number,null);
  await db.query("update procurement.purchase_orders set po_number='OTHER-PO'");
  await command(order({version:1}));
  await db.query("update procurement.purchase_orders set po_number='PO-101'");
  await actor(lead);
  await rejects(()=>command({action:'confirm_order',order_id:orderId,version:2,review_note:'Checked'}),/already exists in Procurement/);
  assert.equal((await db.query('select status from private.external_po_orders')).rows[0].status,'draft');
  await command({action:'return_order',order_id:orderId,version:2,review_note:'Use existing Procurement PO'});
  assert.equal((await db.query('select status from private.external_po_orders')).rows[0].status,'returned');
});

test('valid emailed external PO supports same-source partial deliveries and leaves Procurement empty',async()=>{
  await ready(); await command(post);
  const second='cccccccc-cccc-4ccc-8ccc-cccccccccccd';
  await command(shipment({shipment_id:second,delivery_reference:'DR-102'}));
  await command({...post,shipment_id:second});
  assert.equal((await counts()).stock,8);
  assert.equal((await counts()).external_received,8);
  assert.equal((await db.query('select * from procurement.purchase_orders')).rows.length,0);
  assert.deepEqual((await db.query('select * from private.po_receiving_source_claims')).rows,[{normalized_po_number:'po-101',source:'external'}]);
});

test('actual Procurement bulk receipt and committed replay remain valid with only an external draft',async()=>{
  await command(order()); await procurement();
  const result=await receiveProcurement('proc-1','proc-replay-123');
  assert.deepEqual(await receiveProcurement('proc-1','proc-replay-123'),result);
  assert.equal((await counts()).stock,10);
  assert.equal((await counts()).procurement_received,10);
  assert.equal((await counts()).external_received,0);
  assert.equal((await db.query('select status from procurement.purchase_orders')).rows[0].status,'closed');
  assert.deepEqual((await db.query('select * from private.po_receiving_source_claims')).rows,[{normalized_po_number:'po-101',source:'procurement'}]);
});

test('normal same-source Procurement receipts and unrelated non-PO receipts are not rejected',async()=>{
  await procurement('OTHER-101'); await receiveProcurement();
  await db.exec("insert into warehouse.receipts(id,procurement_po_id) values('proc-next','proc-1'); insert into warehouse.receipts(id) values('direct-receipt'),('external-not-a-shipment')");
  assert.equal((await counts()).receipts,4);
  assert.deepEqual((await db.query('select * from private.po_receiving_source_claims')).rows,[{normalized_po_number:'other-101',source:'procurement'}]);
});

test('authorized external replay survives a later canonical match while fresh posts and revoked actors fail',async()=>{
  await ready(); const result=await command(post,'external-replay-123'); await procurement();
  const before=await counts();
  assert.deepEqual(await command(post,'external-replay-123'),result);
  assert.deepEqual(await counts(),before);
  await actor(outsider);
  await rejects(()=>command(post,'external-replay-123'),/Not authorized/);
  await actor(receiver);
  const second='cccccccc-cccc-4ccc-8ccc-cccccccccccd';
  await command(shipment({shipment_id:second,delivery_reference:'DR-102'}));
  const saved=await counts();
  await rejects(()=>command({...post,shipment_id:second}),/already exists in Procurement/);
  assert.deepEqual(await counts(),saved);
});

test('receipt guard catches a canonical PO introduced after command validation in the same transaction',async()=>{
  await ready();
  await db.exec(`create function private.test_late_procurement() returns trigger language plpgsql as $$ begin
    insert into procurement.purchase_orders(id,po_number,status) values('late',' po-101 ','issued'); return new;
  end $$; create trigger aaa_test_late_procurement before insert on warehouse.receipts for each row execute function private.test_late_procurement()`);
  const before=await counts();
  await rejects(()=>command(post),/already exists in Procurement/);
  assert.deepEqual(await counts(),before);
  assert.equal((await db.query('select * from procurement.purchase_orders')).rows.length,0);
});

test('a late inventory failure rolls the source claim back and the exact failed command can retry',async()=>{
  await ready();
  await db.exec(`create function private.test_late_failure() returns trigger language plpgsql as $$ begin raise exception 'Injected stock failure'; end $$;
    create trigger test_late_failure before insert on warehouse.stock_levels for each row execute function private.test_late_failure()`);
  const before=await counts();
  await rejects(()=>command(post,'rollback-retry-123'),/Injected stock failure/);
  assert.deepEqual(await counts(),before);
  assert.equal((await db.query('select * from private.po_receiving_source_claims')).rows.length,0);
  await db.exec('drop trigger test_late_failure on warehouse.stock_levels');
  await command(post,'rollback-retry-123');
  assert.equal((await counts()).stock,4);
});

test('opposite-source unique claim cannot be replaced even if the canonical PO is later renamed',async()=>{
  await command(order()); await procurement(); await receiveProcurement();
  await db.exec("update procurement.purchase_orders set po_number='RENAMED-101'");
  await confirm(); await command(shipment());
  const before=await counts();
  await rejects(()=>command(post),/already been received through Procurement/);
  assert.deepEqual(await counts(),before);
  assert.deepEqual((await db.query('select * from private.po_receiving_source_claims')).rows,[{normalized_po_number:'po-101',source:'procurement'}]);
});

test('both receipt paths use the same transaction lock and immutable source ownership',async()=>{
  await ready(); await command(post);
  assert.equal((await db.query("select private.lock_po_receiving_number(' Po-101 ') normalized")).rows[0].normalized,'po-101');
  assert.ok((await db.query("select count(*)::int count from pg_locks where locktype='advisory' and granted")).rows[0].count>0);
  const body=(await db.query("select prosrc from pg_proc where oid='private.guard_po_receipt_source()'::regprocedure")).rows[0].prosrc;
  assert.match(body,/private\.lock_po_receiving_number\(po_number\)/);
  assert.match(body,/on conflict\(normalized_po_number\) do update set source=excluded.source\s+where claim.source=excluded.source/);
  assert.match(body,/if not found then/);
  // PGlite is single-session. The unique write, not a stale SELECT, arbitrates
  // a competing receipt; native overlapping-session coverage remains separate.
});

test('new objects are private, fail closed, and install only the two intended triggers',async()=>{
  for (const role of ['anon','authenticated','service_role']) {
    for (const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) {
      assert.equal((await db.query("select has_table_privilege($1,'private.po_receiving_source_claims',$2) allowed",[role,privilege])).rows[0].allowed,false);
    }
    for (const fn of ['private.lock_po_receiving_number(text)','private.guard_external_po_procurement_number()','private.guard_po_receipt_source()']) {
      assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,fn])).rows[0].allowed,false);
    }
  }
  const functions=(await db.query("select prosecdef,provolatile,proconfig,pg_get_userbyid(proowner) owner from pg_proc where oid in ('private.lock_po_receiving_number(text)'::regprocedure,'private.guard_external_po_procurement_number()'::regprocedure,'private.guard_po_receipt_source()'::regprocedure)")).rows;
  assert.equal(functions.length,3);
  for (const fn of functions) assert.deepEqual(fn,{prosecdef:true,provolatile:'v',proconfig:['search_path=""'],owner:'postgres'});
  assert.deepEqual((await db.query("select tgname,tgtype,tgenabled from pg_trigger where tgname in ('external_po_procurement_number_guard','warehouse_po_receipt_source_guard') order by tgname")).rows,[
    {tgname:'external_po_procurement_number_guard',tgtype:23,tgenabled:'O'},
    {tgname:'warehouse_po_receipt_source_guard',tgtype:7,tgenabled:'O'},
  ]);
  assert.deepEqual((await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='private.po_receiving_source_claims'::regclass")).rows[0],{relrowsecurity:true,relforcerowsecurity:true});
  assert.doesNotMatch(migration,/on procurement\.purchase_orders\s+for each|update procurement\.|delete from procurement\./i);
});
