import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = new URL('../supabase/migrations/20261019142956_warehouse_external_po_receiving.sql', import.meta.url);
const warehouse = '11111111-1111-4111-8111-111111111111';
const lead = '22222222-2222-4222-8222-222222222222';
const quality = '33333333-3333-4333-8333-333333333333';
const outsider = '44444444-4444-4444-8444-444444444444';
const orderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const lineId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const shipmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
let sequence = 0;

async function database() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema core; create schema private; create schema warehouse; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('sub',auth.uid(),'email','test@example.invalid') $$;
    create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
    create table core.profiles(id uuid primary key,status text,kind text);
    create table core.roles(module text,role text,is_active boolean);
    create table core.user_roles(user_id uuid,module text,role text,effective_at timestamptz,expires_at timestamptz);
    create function core.has_live_cap(m text,c text) returns boolean language sql stable as $$
      select case when auth.uid()='${outsider}' then false
        when c='inspect_quality' then auth.uid() in ('${quality}','${lead}')
        when c='receive_stock' then auth.uid() in ('${warehouse}','${lead}')
        when c='view_inventory' then true else false end $$;
    create function core.has_cap(m text,c text) returns boolean language sql stable as $$ select true $$;
    create table core.activity_log(id bigserial,module text,entity_type text,entity_id text,action text,actor uuid,detail jsonb);
    create table warehouse.products(id text primary key,sku text,serialized boolean,unit_cost numeric default 0,uom text default 'piece',expiry_tracked boolean default false);
    alter table warehouse.products add column name text default 'Test product';
    create table warehouse.allocations(product_id text,quantity integer,status text);
    create table warehouse.locations(id text primary key,type text,active boolean);
    create table warehouse.storage_areas(id text primary key,location_id text,active boolean);
    create table warehouse.suppliers(id text primary key,name text);
    create table warehouse.receipts(id text primary key,supplier_id text,location_id text,lines jsonb,evidence_urls jsonb,actor text,created_at timestamptz default now(),quality_status text,actual_delivery_date date,delivery_reference text,received_by uuid,procurement_po_id text);
    create table warehouse.lots(id text primary key,product_id text,lot_code text,supplier_id text,unit_cost numeric,received_at timestamptz,expiry_date date);
    create table warehouse.inventory_units(id text primary key,product_id text,serial_number text unique,lot_id text,location_id text,bin_id text,status text);
    create table warehouse.stock_levels(product_id text,location_id text,bin_id text,lot_id text,quantity integer,unique(product_id,location_id,bin_id,lot_id));
    create table warehouse.movements(id text primary key,type text,product_id text,quantity integer,to_location_id text,to_bin_id text,lot_id text,reference text,evidence_urls jsonb,actor text,created_at timestamptz default now());
    create table warehouse.quality_inspections(id uuid primary key default gen_random_uuid(),source_type text,source_id text,product_id text,lot_id text,serial_number text,location_id text,bin_id text,quantity integer,disposition text,reason text,evidence_urls jsonb,inspected_by uuid,inspected_by_email text,inspected_at timestamptz default now(),procurement_po_line_id text);
    create table warehouse.inventory_holds(id uuid primary key default gen_random_uuid(),inspection_id uuid,product_id text,location_id text,bin_id text,lot_id text,serial_number text,quantity integer,status text default 'active',reason text,evidence_urls jsonb,created_by uuid,created_at timestamptz default now(),released_by uuid,released_at timestamptz,release_reason text,release_evidence_urls jsonb);
    create table warehouse.exceptions(id uuid primary key default gen_random_uuid(),exception_type text,severity text,source_type text,source_id text,status text,resolution text,evidence_urls jsonb,created_by uuid);
    alter table warehouse.exceptions add column owner_id uuid,add column due_at timestamptz,add column created_at timestamptz default now();
    create table warehouse.command_log(id uuid primary key default gen_random_uuid(),actor_id uuid,command_name text,idempotency_key text,payload jsonb,response jsonb,unique(actor_id,command_name,idempotency_key));
    create function private.begin_idempotent_command(n text,k text,p jsonb) returns jsonb language plpgsql as $$
    declare r warehouse.command_log; begin
      if auth.uid() is null or length(k)<12 then raise exception 'Authentication and idempotency key required';end if;
      select * into r from warehouse.command_log where actor_id=auth.uid() and command_name=n and idempotency_key=k;
      if found then if r.payload<>p then raise exception 'Idempotency key was reused with a different payload';end if;
        return jsonb_build_object('replayed',true,'response',r.response);end if;
      insert into warehouse.command_log(actor_id,command_name,idempotency_key,payload) values(auth.uid(),n,k,p) returning * into r;
      return jsonb_build_object('replayed',false,'command_id',r.id);end $$;
    create function private.finish_idempotent_command(i uuid,r jsonb) returns jsonb language plpgsql as $$ begin update warehouse.command_log set response=r where id=i;return r;end $$;
    create function warehouse.authoritative_actor() returns text language sql as $$ select auth.uid()::text $$;
    create function private.warehouse_inspect_quality_v3(p jsonb) returns jsonb language sql as $$ select '{"legacy":true}'::jsonb $$;
    create function private.inspect_return_intake(p jsonb) returns jsonb language sql as $$ select '{"return":true}'::jsonb $$;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text,owner uuid);
    alter table storage.objects enable row level security;
    insert into core.profiles values ('${warehouse}','active','employee'),('${lead}','active','employee'),('${quality}','active','employee'),('${outsider}','active','employee');
    insert into core.roles values ('warehouse','warehouse_supervisor',true);
    insert into core.user_roles values ('${lead}','warehouse','warehouse_supervisor',now()-interval '1 day',null);
    insert into warehouse.locations values ('wh','warehouse',true),('other','warehouse',true);
    insert into warehouse.storage_areas values ('stage','wh',true),('wrong','other',true);
    insert into warehouse.suppliers values ('supplier','Test supplier');
    insert into warehouse.products(id,sku,serialized,unit_cost,uom,expiry_tracked) values ('watch','WATCH',true,0,'piece',false),('bag','BAG',false,0,'piece',false);
    insert into storage.objects(bucket_id,name,owner_id,owner) values
      ('warehouse-po-evidence','${warehouse}/po.pdf','${warehouse}','${warehouse}'),
      ('evidence','external/shipment.png','${warehouse}','${warehouse}'),
      ('evidence','external/quality.png','${quality}','${quality}');
  `);
  const existing = async (name) => readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
  const lockSource = await existing('20260714175318_single_po_receipt_authority.sql');
  await db.exec(lockSource.match(/create or replace function private\.lock_warehouse_products[\s\S]*?\$\$;/i)[0]);
  const atpSource = await existing('20260718201000_refresh_atp_inside_product_lock.sql');
  await db.exec(atpSource.match(/create or replace function warehouse\.available_to_promise[\s\S]*?\$\$;/i)[0]);
  const positionSource = await existing('20260710170000_warehouse_w1_imports_po_and_reporting.sql');
  await db.exec(positionSource.match(/create or replace view warehouse\.inventory_position_v1[\s\S]*?;/i)[0]);
  await db.exec(await existing('20260905043614_warehouse_putaway_tasks.sql'));
  await db.exec(await readFile(migration,'utf8'));
  await actor(db,warehouse);
  return db;
}
async function actor(db,id) { await db.query("select set_config('test.actor',$1,false)",[id]); }
async function command(db,p,key=`external-test-${++sequence}`) {
  return (await db.query('select warehouse.external_po_command($1::jsonb) as result',[JSON.stringify({...p,idempotency_key:key})])).rows[0].result;
}
const order = (extra={}) => ({action:'save_order',order_id:orderId,version:0,po_number:'EMAIL-001',supplier_id:'supplier',location_id:'wh',email_sender:'buyer@example.invalid',email_date:'2026-10-18',notes:'Test only',evidence_urls:[`warehouse-po-evidence/${warehouse}/po.pdf`],lines:[{id:lineId,product_id:'watch',quantity:2,uom:'piece'}],...extra});
const shipment = (extra={}) => ({action:'save_shipment',order_id:orderId,shipment_id:shipmentId,version:0,delivery_reference:'DR-001',actual_delivery_date:'2026-10-18',bin_id:'stage',evidence_urls:['external/shipment.png'],notes:'',lines:[{po_line_id:lineId,quantity:1,serial_numbers:['MW-TEST-001']}],...extra});
async function confirm(db) { await actor(db,lead);await command(db,{action:'confirm_order',order_id:orderId,version:1,review_note:'Checked emailed PO'});await actor(db,warehouse); }
async function scalar(db,sql) { return (await db.query(sql)).rows[0].value; }

test('Warehouse saves arrival; Lead confirms; posting is once-only and held for independent Quality', async () => {
 const db=await database();try {
  await command(db,order());await command(db,shipment());
  assert.equal(await scalar(db,'select count(*)::int as value from warehouse.inventory_units'),0);
  await assert.rejects(command(db,{action:'post_shipment',order_id:orderId,shipment_id:shipmentId,version:1}),/confirm/i);
  await confirm(db);
  const payload={action:'post_shipment',order_id:orderId,shipment_id:shipmentId,version:1};
  const result=await command(db,payload,'repeat-same-command');
  assert.deepEqual(await command(db,payload,'repeat-same-command'),result);
  assert.equal(await scalar(db,'select count(*)::int as value from warehouse.inventory_units'),1);
  assert.equal(await scalar(db,"select count(*)::int as value from warehouse.inventory_holds where status='active'"),1);
  assert.equal(await scalar(db,"select status as value from warehouse.inventory_units"),'in_stock');
  assert.equal(await scalar(db,"select warehouse.available_to_promise('watch') as value"),0);
  assert.equal(await scalar(db,"select count(*)::int as value from warehouse.warehouse_tasks where task_type='putaway'"),0);
  const i=(await db.query('select * from warehouse.quality_inspections')).rows[0];
  const inspect={idempotency_key:'external-inspection-001',source_type:'receipt',source_id:result.receipt_id,product_id:'watch',lot_id:i.lot_id,serial_number:'MW-TEST-001',quantity:1,disposition:'accepted',evidence_urls:['external/quality.png']};
  await assert.rejects(db.query('select warehouse.inspect_quality($1::jsonb)',[JSON.stringify(inspect)]),/authorized|inspect.*own|receiver|receiv.*inspect/i);
  await actor(db,quality);
  await db.query('select warehouse.inspect_quality($1::jsonb)',[JSON.stringify(inspect)]);
  assert.equal(await scalar(db,"select status as value from warehouse.inventory_units"),'in_stock');
  assert.equal(await scalar(db,"select status as value from warehouse.inventory_holds"),'released');
  assert.equal(await scalar(db,"select quality_status as value from warehouse.receipts"),'accepted');
  assert.equal(await scalar(db,"select warehouse.available_to_promise('watch') as value"),1);
  assert.equal(await scalar(db,"select count(*)::int as value from warehouse.warehouse_tasks where task_type='putaway'"),1);
 } finally {await db.close();}
});
test('server denies unauthorized, self confirmation, stale edits, forged evidence and cross-warehouse bin',async()=>{
 const db=await database();try{
  await actor(db,outsider);await assert.rejects(command(db,order()),/authorized/i);
  await actor(db,warehouse);await assert.rejects(command(db,order({evidence_urls:[`warehouse-po-evidence/${lead}/secret.pdf`]})),/upload|evidence/i);
  await command(db,order());await assert.rejects(command(db,order()),/changed|version|reload/i);
  await assert.rejects(command(db,shipment({bin_id:'wrong'})),/bin|warehouse/i);
  await actor(db,lead);await command(db,order({order_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',po_number:'EMAIL-002',evidence_urls:[],lines:[{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc',product_id:'watch',quantity:1,uom:'piece'}]}));
  await assert.rejects(command(db,{action:'confirm_order',order_id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab',version:1,review_note:'Self'}),/another|own|creator/i);
 }finally{await db.close();}
});
test('partial delivery, excess and duplicate serial do not corrupt remaining balance',async()=>{
 const db=await database();try{
  await command(db,order());await confirm(db);await command(db,shipment());
  await command(db,{action:'post_shipment',order_id:orderId,shipment_id:shipmentId,version:1});
  const second='cccccccc-cccc-4ccc-8ccc-cccccccccccd';
  await command(db,shipment({shipment_id:second,delivery_reference:'DR-002',lines:[{po_line_id:lineId,quantity:2,serial_numbers:['MW-TEST-002','MW-TEST-003']}]}));
  await assert.rejects(command(db,{action:'post_shipment',order_id:orderId,shipment_id:second,version:1}),/remaining|excess|quantity/i);
  await command(db,shipment({shipment_id:second,version:1,delivery_reference:'DR-002'}));
  await assert.rejects(command(db,{action:'post_shipment',order_id:orderId,shipment_id:second,version:2}),/serial/i);
  assert.equal(await scalar(db,'select received_quantity as value from private.external_po_lines'),1);
 }finally{await db.close();}
});
test('ordinary Procurement and return inspection paths remain unchanged',async()=>{
 const db=await database();try{
  await actor(db,quality);
  const result=(await db.query("select warehouse.inspect_quality('{\"source_type\":\"receipt\",\"source_id\":\"legacy\"}') as value")).rows[0].value;
  assert.deepEqual(result,{legacy:true});
 }finally{await db.close();}
});

test('quantity-tracked receipt remains fully held; damage retains the hold and creates an exception',async()=>{
 const db=await database();try{
  await command(db,order({lines:[{id:lineId,product_id:'bag',quantity:10,uom:'piece'}]}));await confirm(db);
  await command(db,shipment({lines:[{po_line_id:lineId,quantity:4,serial_numbers:[]}]}));
  const r=await command(db,{action:'post_shipment',order_id:orderId,shipment_id:shipmentId,version:1});
  assert.equal(await scalar(db,'select quantity as value from warehouse.stock_levels'),4);
  assert.equal(await scalar(db,"select sum(quantity)::int as value from warehouse.inventory_holds where status='active'"),4);
  await assert.rejects(db.exec("update warehouse.inventory_holds set status='released'"),/Quality/);
  await assert.rejects(db.exec('delete from warehouse.inventory_holds'),/Quality/);
  const i=(await db.query('select * from warehouse.quality_inspections')).rows[0];
  await actor(db,quality);
  await db.query('select warehouse.inspect_quality($1::jsonb)',[JSON.stringify({idempotency_key:'external-bag-inspect',source_type:'receipt',source_id:r.receipt_id,product_id:'bag',lot_id:i.lot_id,quantity:4,disposition:'damaged',reason:'Wet packaging',evidence_urls:['external/quality.png']})]);
  assert.equal(await scalar(db,"select status as value from warehouse.inventory_holds"),'active');
  assert.equal(await scalar(db,"select quality_status as value from warehouse.receipts"),'hold');
  assert.equal(await scalar(db,'select count(*)::int as value from warehouse.exceptions'),1);
 }finally{await db.close();}
});
test('missing evidence, altered replay, future delivery and invalid quantities cannot post stock',async()=>{
 const db=await database();try{
  await assert.rejects(command(db,order({lines:[{id:lineId,product_id:'watch',quantity:1.5,uom:'piece'}]})),/whole-number/);
  await assert.rejects(command(db,order({lines:[{id:lineId,product_id:'watch',quantity:-1,uom:'piece'}]})),/whole-number/);
  await command(db,order(),'order-repeat-key');
  await assert.rejects(command(db,order({po_number:'CHANGED'}),'order-repeat-key'),/different payload/);
  await confirm(db);
  await assert.rejects(command(db,shipment({actual_delivery_date:'2099-01-01'})),/date/);
  await command(db,shipment({evidence_urls:[]}));
  await assert.rejects(command(db,{action:'post_shipment',order_id:orderId,shipment_id:shipmentId,version:1}),/evidence/);
  assert.equal(await scalar(db,'select count(*)::int as value from warehouse.receipts'),0);
 }finally{await db.close();}
});
test('current authority and private table grants do not widen operational access',async()=>{
 const db=await database();try{
  await command(db,order());await actor(db,lead);
  await db.exec("update core.user_roles set expires_at=now()-interval '1 second'");
  await assert.rejects(command(db,{action:'confirm_order',order_id:orderId,version:1,review_note:'Expired role'}),/Operations Lead/);
  const access=await db.query("select has_table_privilege('authenticated','private.external_po_orders','SELECT') as read,has_table_privilege('authenticated','private.external_po_orders','UPDATE') as write,has_function_privilege('anon','warehouse.external_po_command(jsonb)','EXECUTE') as anon");
  assert.deepEqual(access.rows[0],{read:false,write:false,anon:false});
  await actor(db,outsider);await assert.rejects(db.query("select warehouse.external_po_workspace('{}')"),/authorized/);
 }finally{await db.close();}
});

test('pending and damaged new units never reduce pre-existing availability; repeated supplier lots remain distinct',async()=>{
 const db=await database();try{
  await db.exec("insert into warehouse.inventory_units(id,product_id,serial_number,location_id,bin_id,status) select 'old-'||i,'watch','OLD-'||i,'wh','stage','in_stock' from generate_series(1,10) i");
  await command(db,order());await confirm(db);
  await command(db,shipment({lines:[{po_line_id:lineId,quantity:1,serial_numbers:['MW-TEST-001'],lot_code:'SUPPLIER-BATCH-1'}]}));
  const first=await command(db,{action:'post_shipment',order_id:orderId,shipment_id:shipmentId,version:1});
  assert.equal(await scalar(db,"select warehouse.available_to_promise('watch') as value"),10);
  const second='cccccccc-cccc-4ccc-8ccc-ccccccccccce';
  await command(db,shipment({shipment_id:second,delivery_reference:'DR-002',lines:[{po_line_id:lineId,quantity:1,serial_numbers:['MW-TEST-002'],lot_code:'SUPPLIER-BATCH-1'}]}));
  await command(db,{action:'post_shipment',order_id:orderId,shipment_id:second,version:1});
  assert.equal(await scalar(db,"select warehouse.available_to_promise('watch') as value"),10);
  assert.equal(await scalar(db,'select count(distinct lot_code)::int as value from warehouse.lots'),2);
  assert.equal(await scalar(db,"select count(*)::int as value from warehouse.receipts where lines->0->>'supplierLotCode'='SUPPLIER-BATCH-1'"),2);
  await actor(db,quality);
  for (const i of (await db.query('select * from warehouse.quality_inspections order by serial_number')).rows) {
    const accepted=i.source_id===first.receipt_id;
    await db.query('select warehouse.inspect_quality($1::jsonb)',[JSON.stringify({idempotency_key:`inspect-${i.id}`,source_type:'receipt',source_id:i.source_id,product_id:'watch',lot_id:i.lot_id,serial_number:i.serial_number,quantity:1,disposition:accepted?'accepted':'damaged',reason:'Packaging damaged',evidence_urls:['external/quality.png']})]);
    assert.equal(await scalar(db,"select warehouse.available_to_promise('watch') as value"),11);
  }
  assert.equal(await scalar(db,"select count(*)::int as value from warehouse.warehouse_tasks where task_type='putaway'"),1);
  assert.equal(await scalar(db,'select count(*)::int as value from warehouse.receipts where procurement_po_id is not null'),0);
 }finally{await db.close();}
});

test('missing or null shipment quantities and cross-order child identities are rejected',async()=>{
 const db=await database();try{
  await command(db,order());
  for(const productId of ['watch','bag']) {
    await command(db,order({version:productId==='watch'?1:2,lines:[{id:lineId,product_id:productId,quantity:2,uom:'piece'}]}));
    for(const quantity of [null,undefined]) await assert.rejects(command(db,shipment({lines:[{po_line_id:lineId,quantity,serial_numbers:[]}]})),/whole-number/);
  }
  await command(db,shipment({lines:[{po_line_id:lineId,quantity:1,serial_numbers:[]}]}));
  const secondOrder='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
  await assert.rejects(command(db,order({order_id:secondOrder,po_number:'EMAIL-002'})),/another record/);
  const secondLine='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc';
  await command(db,order({order_id:secondOrder,po_number:'EMAIL-002',lines:[{id:secondLine,product_id:'bag',quantity:2,uom:'piece'}]}));
  await assert.rejects(command(db,shipment({order_id:secondOrder,lines:[{po_line_id:secondLine,quantity:1,serial_numbers:[]}]})),/another PO/);
  assert.equal(await scalar(db,'select count(*)::int as value from private.external_po_shipments'),1);
 }finally{await db.close();}
});

test('multirole receivers cannot self-inspect and independent Leads can read both evidence representations',async()=>{
 const db=await database();try{
  await command(db,order({evidence_urls:[`${warehouse}/po.pdf`]}));
  await actor(db,lead);
  assert.equal(await scalar(db,`select private.external_po_evidence_readable('${warehouse}/po.pdf') as value`),true);
  await actor(db,outsider);
  assert.equal(await scalar(db,`select private.external_po_evidence_readable('${warehouse}/po.pdf') as value`),false);
  await confirm(db);await actor(db,lead);
  await db.exec(`insert into storage.objects(bucket_id,name,owner_id,owner) values ('evidence','lead/shipment.png','${lead}','${lead}')`);
  await command(db,shipment({evidence_urls:['lead/shipment.png']}));
  const result=await command(db,{action:'post_shipment',order_id:orderId,shipment_id:shipmentId,version:1});
  const i=(await db.query('select * from warehouse.quality_inspections')).rows[0];
  await assert.rejects(db.query('select warehouse.inspect_quality($1::jsonb)',[JSON.stringify({idempotency_key:'multirole-inspection',source_type:'receipt',source_id:result.receipt_id,product_id:'watch',lot_id:i.lot_id,serial_number:i.serial_number,quantity:1,disposition:'accepted',evidence_urls:['lead/shipment.png']})]),/another Quality inspector/);
 }finally{await db.close();}
});
