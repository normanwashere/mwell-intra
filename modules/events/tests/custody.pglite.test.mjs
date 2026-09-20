import assert from 'node:assert/strict';
import { URL } from 'node:url';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
const migration = async name => (await readFile(new URL(`../../../supabase/migrations/${name}.sql`,import.meta.url),'utf8')).replaceAll('\r\n','\n');
const sql = await migration('20260920025525_gated_event_seller_custody');
const historical = await migration('20260710160000_warehouse_w1_quality_and_approval_rpcs');
const returnIntake = await migration('20260828033036_return_intake_atomic_quarantine');
const fulfillment = await migration('20260828011200_fulfillment_zero_line_backorder');
const integrity = await migration('20260905092000_warehouse_integrity');
const extractFunction = (source,name) => source.match(new RegExp(`create or replace function ${name.replaceAll('.', '\\.')}\\([\\s\\S]*?\\$\\$;`))[0];
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',O='33333333-3333-4333-8333-333333333333';
const seller=['events.view_event_custody','events.record_event_outcome'];
async function actor(db,id=A,caps=seller){await db.query("select set_config('app.actor',$1,false),set_config('app.caps',$2,false)",[id,caps.join(',')]);}
async function rpc(db,name,payload){return (await db.query(`select warehouse.${name}($1::jsonb) result`,[payload])).rows[0].result;}
const sale=extra=>({event_id:'e1',allocation_id:'a1',kind:'sale',quantity:1,serial_numbers:['S1'],amount:125,external_reference:'SALE-1',idempotency_key:'outcome-command-1',...extra});
async function fixture(){
  const db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth;create schema core;create schema private;create schema warehouse;create schema learning;
    create table learning.mutation_capability_rules(module text,capability text,primary key(module,capability));
    -- Catalog-publication proof belongs to Learning; this fixture controls its read-only result.
    create function private.event_seller_learning_ready() returns boolean language sql as $$select true$$;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('app.actor',true),'')::uuid$$;
    create function core.has_live_cap(m text,c text) returns boolean language sql stable as $$select (m||'.'||c)=any(string_to_array(current_setting('app.caps',true),','))$$;
    create function core.has_cap(m text,c text) returns boolean language sql stable as $$select core.has_live_cap(m,c)$$;
    create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;
    create function auth.jwt() returns jsonb language sql stable as $$select '{}'::jsonb$$;
    create table core.profiles(id uuid primary key,status text,full_name text,email text);
    insert into core.profiles values ('${A}','active','Seller One','one@example.test'),('${B}','active','Owner','owner@example.test');
    create table core.capabilities(module text,cap text,primary key(module,cap));
    create table core.roles(module text,role text,label text,description text,is_active boolean,primary key(module,role));
    create table core.role_capabilities(module text,role text,cap text,primary key(module,role,cap));
    create table core.user_roles(user_id uuid,module text,role text);
    insert into core.user_roles values ('${A}','events','seller');
    create table warehouse.events(id text primary key,name text,status text,start_date date,end_date date,owner_email text);
    insert into warehouse.events values ('e1','Event One','active',current_date,current_date+1,'owner@example.test'),('e2','Other','active',current_date,current_date+1,'other@example.test');
    create table warehouse.products(id text primary key,name text,serialized boolean,item_class text);
    insert into warehouse.products values ('watch','Watch',true,'sellable_sku'),('bag','Bag',false,'merchandise');
    create table warehouse.allocations(id text primary key,event_id text,product_id text,quantity integer,status text,promotional boolean default false,created_at timestamptz default now());
    create table warehouse.inventory_units(id text primary key,product_id text,serial_number text,status text,event_id text,assigned_to text);
    insert into warehouse.inventory_units values ('u1','watch','S1','issued',null,'ORDER-1'),('u2','watch','S2','issued',null,'ORDER-1');
    create table warehouse.inventory_holds(id uuid,status text,serial_number text);
    create table warehouse.fulfillment_orders(id uuid primary key,event_id text,status text,external_reference text,lines jsonb,created_at timestamptz,acknowledged_at timestamptz,acknowledged_by uuid);
    create table warehouse.movements(id text,type text,product_id text,quantity integer,serial_number text,event_id text,reference text);
    create table warehouse.returns(id text primary key,source text,event_id text,lines jsonb);
    create table warehouse.event_reconciliations(event_id text,status text,sold_units integer,giveaway_units integer,gross_sales_amount numeric);
    alter table warehouse.event_reconciliations add returned_units integer default 0,add lost_units integer default 0,add damaged_units integer default 0,add rekit_units integer default 0;
    create table warehouse.stock_levels(product_id text,location_id text,bin_id text,lot_id text,quantity integer,unique nulls not distinct(product_id,location_id,bin_id,lot_id));
    create table warehouse.locations(id text,active boolean,type text);
    insert into warehouse.locations values ('quarantine',true,'warehouse');
    create table warehouse.storage_areas(id text,active boolean,location_id text);
    create table warehouse.department_stock_requests(fulfillment_order_id uuid,requested_by uuid);
    alter table warehouse.department_stock_requests add id uuid primary key default gen_random_uuid(),add event_id text,add requesting_department text,add purpose text,add cost_center text,add required_date date,add expense_treatment text,add status text,add lines jsonb;
    create table core.departments(id uuid primary key,code text,is_active boolean);
    create table core.department_cost_centers(department_id uuid,code text,is_active boolean);
    insert into core.departments values ('${O}','marketing',true);
    insert into core.department_cost_centers values ('${O}','MKT',true);
    create function warehouse.available_to_promise(p_product text) returns integer language sql stable as $$select case when p_product='watch' then 2 else 5 end$$;
    create table warehouse.customer_return_cases(id uuid primary key,source_order_id uuid,created_by uuid,product_id text,serial_number text);
    create table core.activity_log(module text,entity_type text,entity_id text,action text,actor uuid,detail jsonb);
    create table warehouse.quality_inspections(id uuid default gen_random_uuid(),source_type text,source_id text,product_id text,location_id text,bin_id text,lot_id text,serial_number text,quantity integer,disposition text,reason text,evidence_urls jsonb,inspected_by uuid,inspected_by_email text);
    alter table warehouse.inventory_units add location_id text,add bin_id text,add lot_id text;
    alter table warehouse.inventory_holds add inspection_id uuid,add product_id text,add location_id text,add bin_id text,add lot_id text,add quantity integer,add reason text,add evidence_urls jsonb,add created_by uuid;
    alter table warehouse.fulfillment_orders add delivery_method text default 'event_handover',add released_by uuid,add created_by uuid,add acknowledgement_reference text,add acknowledgement_evidence_url text,add updated_at timestamptz;
    alter table warehouse.returns add evidence_urls jsonb,add actor text,add created_at timestamptz;
    alter table warehouse.movements add to_location_id text,add to_bin_id text,add lot_id text,add reason text,add evidence_urls jsonb,add actor text,add created_at timestamptz;
    create function private.lock_warehouse_products(p_products text[]) returns void language plpgsql as $$begin perform 1 from warehouse.products where id=any(p_products) order by id for update;end$$;
    create table warehouse.command_log(id uuid primary key default gen_random_uuid(),actor_id uuid,command_name text,idempotency_key text,payload_hash text,response jsonb,completed_at timestamptz,unique(actor_id,command_name,idempotency_key));
    create function private.warehouse_payload_hash(payload jsonb) returns text language sql as $$select md5(payload::text)$$;
    grant usage on schema warehouse,private,core,auth to authenticated,anon;`);
  for(const name of ['begin_idempotent_command','finish_idempotent_command']) await db.exec(historical.match(new RegExp(`create or replace function private.${name}\\([\\s\\S]*?\\$\\$;`))[0]);
  await db.exec(extractFunction(returnIntake,'warehouse.record_return_v2'));
  await db.exec(await migration('20260828041500_return_intake_stock_state'));
  await db.exec(extractFunction(integrity,'private.enforce_allocation_return_balance'));
  await db.exec(integrity.slice(integrity.indexOf("do $$\ndeclare definition text := pg_get_functiondef('warehouse.record_return_v2"),integrity.indexOf("notify pgrst, 'reload schema';")));
  await db.exec('create trigger enforce_allocation_return_balance before insert on warehouse.returns for each row execute function private.enforce_allocation_return_balance()');
  await db.exec(await migration('20260905095000_return_intake_certified_boundary'));
  await db.exec(await migration('20260913071110_customer_return_intake_lineage'));
  await db.exec(extractFunction(fulfillment,'private.warehouse_advance_fulfillment_order_v2'));
  await db.exec(await migration('20260910140118_fulfillment_handover_acknowledgment_guard'));
  await db.exec(extractFunction(await migration('20260804150000_inventory_release_lifecycle_remediation'),'warehouse.request_event_fulfillment'));
  await db.exec('alter function warehouse.request_event_fulfillment(jsonb) rename to request_event_fulfillment_uncertified_impl');
  await db.exec(extractFunction(await migration('20260813203240_task_1_database_authority_remediation'),'warehouse.request_event_fulfillment'));
  await db.exec(extractFunction(await migration('20260714175318_single_po_receipt_authority'),'warehouse.reserve'));
  await db.exec('alter function warehouse.reserve(jsonb) rename to reserve_uncertified_impl');
  await db.exec(extractFunction(await migration('20260718202000_block_issue_from_held_stock_identity'),'warehouse.issue'));
  await db.exec('alter function warehouse.issue(jsonb) rename to issue_uncertified_impl');
  await db.exec(extractFunction(await migration('20260706092400_warehouse_rpcs'),'warehouse.cancel_allocation'));
  await db.exec(sql);await actor(db);return db;
}
async function setup(db,acknowledge=true){
  await actor(db,B,['events.manage_events']);
  await rpc(db,'configure_event_custody',{event_id:'e1',action:'enable',idempotency_key:'setup-event-command'});
  await rpc(db,'configure_event_custody',{event_id:'e1',action:'assign',user_id:A,idempotency_key:'assign-event-command'});
  await db.exec(`insert into warehouse.fulfillment_orders(id,event_id,status,external_reference,lines,created_at,created_by) values ('${O}','e1','released','ORDER-1','[{"productId":"watch","quantity":2,"pickedSerialNumbers":["S1","S2"]}]',clock_timestamp(),'${B}');
    insert into warehouse.movements(id,type,product_id,quantity,serial_number,event_id,reference) values ('m1','fulfillment_release','watch',1,'S1','e1','${O}'),('m2','fulfillment_release','watch',1,'S2','e1','${O}');`);
  const acknowledgment={order_id:O,action:'acknowledge_receipt',acknowledgement_reference:'ACK-1',acknowledgement_evidence_url:'https://example.test/ack',idempotency_key:'acknowledge-command-1'};
  if(acknowledge){
    await db.query('select private.warehouse_advance_fulfillment_order_v2($1::jsonb)',[acknowledgment]);
    await db.query('select private.warehouse_advance_fulfillment_order_v2($1::jsonb)',[acknowledgment]);
  }
  await actor(db);return (await db.query('select allocation_id from private.event_custody_sources')).rows[0]?.allocation_id;
}
test('gated migration provides executable server custody functions',()=>assert.match(sql,/function warehouse\.record_event_outcome/));
test('server event custody controls',async t=>{
  const db=await fixture();t.after(()=>db.close());
  await t.test('only owner can explicitly enable and assign named sellers',async()=>{
    await assert.rejects(rpc(db,'configure_event_custody',{event_id:'e1',action:'enable',idempotency_key:'bad-setup-command'}),/Not authorized/);
    await actor(db,B,['events.manage_events']);
    await assert.rejects(rpc(db,'configure_event_custody',{event_id:'e2',action:'enable',idempotency_key:'other-setup-command'}),/Not authorized/);
  });
  const allocation_id=await setup(db),input=sale({allocation_id});let recorded;
  await t.test('acknowledgment retry creates no extra allocation or movement',async()=>{
    await db.exec(`update warehouse.fulfillment_orders set acknowledged_at=acknowledged_at where id='${O}'`);
    assert.equal((await db.query('select count(*)::int n from warehouse.allocations')).rows[0].n,1);
    assert.equal((await db.query('select count(*)::int n from warehouse.movements')).rows[0].n,2);
  });
  await t.test('role, other event, expired/revoked assignment, unnamed account and disabled gate fail closed',async()=>{
    await actor(db,A,['events.manage_events']);await assert.rejects(rpc(db,'record_event_outcome',input),/Not authorized/);
    await actor(db,B);await assert.rejects(rpc(db,'record_event_outcome',input),/Not authorized/);
    await actor(db);await assert.rejects(rpc(db,'record_event_outcome',{...input,event_id:'e2'}),/Not authorized/);
    await db.exec("update private.event_sellers set revoked_at=now()");await assert.rejects(rpc(db,'record_event_outcome',input),/Not authorized/);
    await db.exec("update private.event_sellers set revoked_at=null,valid_from=now()-interval '2 days',valid_until=now()-interval '1 day'");await assert.rejects(rpc(db,'record_event_outcome',input),/Not authorized/);
    await db.exec("update private.event_sellers set valid_until=now()+interval '1 day';update private.event_custody_sessions set enabled=false");await assert.rejects(rpc(db,'record_event_outcome',input),/disabled/);
    await db.exec(`update private.event_custody_sessions set enabled=true;update core.profiles set full_name='' where id='${A}'`);await assert.rejects(rpc(db,'record_event_outcome',input),/Not authorized/);
    await db.exec(`update core.profiles set full_name='Seller One' where id='${A}'`);
  });
  await t.test('immutable attributable posting, idempotency, unique reference and sold serial exclusion',async()=>{
    recorded=await rpc(db,'record_event_outcome',input);assert.equal((await rpc(db,'record_event_outcome',input)).id,recorded.id);
    await assert.rejects(rpc(db,'record_event_outcome',{...input,amount:126}),/different payload/);
    await assert.rejects(rpc(db,'record_event_outcome',{...input,serial_numbers:['S2'],idempotency_key:'duplicate-ref-command'}),/external reference/i);
    await assert.rejects(rpc(db,'record_event_outcome',{...input,external_reference:'SALE-2',idempotency_key:'duplicate-serial-command'}),/custody/);
    for(const query of ['update private.event_custody_entries set amount=0','delete from private.event_custody_entries','truncate private.event_custody_entries'])await assert.rejects(db.exec(query),/immutable/);
  });
  await t.test('scoped reads and Finance-only totals without seller authority',async()=>{
    await actor(db,B);await assert.rejects(rpc(db,'event_custody_ledger',{event_id:'e1'}),/Not authorized/);
    await actor(db,B,['events.approve_settlement']);const ledger=await rpc(db,'event_custody_ledger',{event_id:'e1'});
    assert.equal(ledger.totals.sold_units,1);assert.equal(ledger.totals.gross_sales_amount,125);
    await assert.rejects(rpc(db,'record_event_outcome',input),/Not authorized/);
    await db.exec('set role authenticated');await assert.rejects(db.exec('select * from private.event_custody_entries'),/permission denied/);await db.exec('reset role');await actor(db);
  });
  await t.test('return excludes sold stock; attributable reversal allows exact physical return',async()=>{
    const payload={idempotency_key:'return-command-1',return:{source:'event',event_id:'e1',lines:[{allocationId:allocation_id,productId:'watch',quantity:1,serialNumber:'S1',locationId:'quarantine',reason:'Unsold'}]}};
    await assert.rejects(rpc(db,'record_return_v2',payload),/Not authorized/);
    await actor(db,A,['warehouse.manage_returns']);await assert.rejects(rpc(db,'record_return_v2',payload),/custody/);
    await actor(db);const reversal={...input,kind:'reversal',reverses_id:recorded.id,reason:'Receipt cancelled',external_reference:'REV-1',idempotency_key:'reverse-command-1'};
    await rpc(db,'record_event_outcome',reversal);
    await assert.rejects(rpc(db,'record_event_outcome',{...reversal,external_reference:'REV-2',idempotency_key:'reverse-command-2'}),/already reversed/);
    await actor(db,A,['warehouse.manage_returns']);const returned=await rpc(db,'record_return_v2',payload);await rpc(db,'record_return_v2',payload);
    await db.query('select private.assert_event_conversion_return($1,$2,$3,$4,$5)',[returned.id,allocation_id,'e1','watch','S1']);
    await assert.rejects(db.query('select private.assert_event_conversion_return($1,$2,$3,$4,$5)',[returned.id,allocation_id,'e1','watch','S2']),/lineage/);
    await actor(db);await assert.rejects(rpc(db,'record_event_outcome',{...input,external_reference:'RETURNED',idempotency_key:'returned-command-1'}),/custody/);
  });
  await t.test('oversell and simultaneous queued submissions cannot consume same remaining serial',async()=>{
    await assert.rejects(rpc(db,'record_event_outcome',sale({allocation_id,quantity:3,serial_numbers:['S2','S3','S4'],external_reference:'OVER',idempotency_key:'oversell-command-1'})),/custody/);
    const results=await Promise.allSettled([1,2].map(i=>rpc(db,'record_event_outcome',sale({allocation_id,serial_numbers:['S2'],external_reference:`CONCURRENT-${i}`,idempotency_key:`concurrent-command-${i}`}))));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    // PGlite serializes calls; independent-connection PostgreSQL contention is separate proof.
    await db.exec("update warehouse.events set status='closed' where id='e1'");
    await assert.rejects(rpc(db,'record_event_outcome',sale({allocation_id,external_reference:'CLOSED',idempotency_key:'closed-command-1'})),/closed/);
  });
});

test('giveaway, direct return writes, settlement mismatch, closed balance and historical enable are guarded',async t=>{
  const db=await fixture();t.after(()=>db.close());const allocation_id=await setup(db);
  const input=sale({allocation_id,kind:'giveaway',amount:0});await rpc(db,'record_event_outcome',input);
  await assert.rejects(db.exec(`insert into warehouse.returns(id,source,event_id,lines) values ('bypass','event','e1','[{"allocationId":"${allocation_id}","productId":"watch","quantity":1,"serialNumber":"S1"}]')`),/custody/);
  await assert.rejects(db.exec("insert into warehouse.event_reconciliations(event_id,status,sold_units,giveaway_units,gross_sales_amount) values ('e1','submitted',2,0,250)"),/ledger/);
  await assert.rejects(db.exec("update warehouse.events set status='closed' where id='e1'"),/custody/);
  await actor(db,B,['events.manage_events']);
  await db.exec("update warehouse.events set owner_email='owner@example.test' where id='e2';insert into warehouse.allocations values ('historical','e2','bag',1,'issued',false,now())");
  await assert.rejects(rpc(db,'configure_event_custody',{event_id:'e2',action:'enable',idempotency_key:'historical-command'}),/Historical/);
  assert.equal((await db.query("select count(*)::int n from learning.mutation_capability_rules where module='events' and capability='record_event_outcome'")).rows[0].n,1);
});

test('seller assignment allows only optional staff baseline and uses Manila midnight independent of session timezone',async t=>{
  const db=await fixture();t.after(()=>db.close());
  await db.exec(`insert into core.user_roles values ('${A}','core','staff');set timezone='UTC'`);
  await actor(db,B,['events.manage_events']);
  await rpc(db,'configure_event_custody',{event_id:'e1',action:'enable',idempotency_key:'baseline-enable-key'});
  await rpc(db,'configure_event_custody',{event_id:'e1',action:'assign',seller_email:'ONE@example.test',idempotency_key:'baseline-assign-key'});
  assert.equal((await db.query("select extract(hour from valid_until)::int as expiry_hour from private.event_sellers")).rows[0].expiry_hour,16);
  assert.equal((await rpc(db,'event_custody_ledger',{event_id:'e1'})).may_configure,true);
  await db.exec(`insert into core.user_roles values ('${A}','warehouse','warehouse_operator')`);
  await assert.rejects(rpc(db,'configure_event_custody',{event_id:'e1',action:'assign',user_id:A,idempotency_key:'broad-seller-denied'}),/event-limited/);
  await actor(db);await assert.rejects(rpc(db,'event_custody_ledger',{event_id:'e1'}),/Not authorized/);
});

test('retained fulfillment command locks event before its order lock',async t=>{
  const db=await fixture();t.after(()=>db.close());
  const definition=(await db.query("select pg_get_functiondef('private.warehouse_advance_fulfillment_order_v2(jsonb)'::regprocedure) as body")).rows[0].body;
  const guard=definition.indexOf('private.lock_event_fulfillment_custody');
  assert.ok(guard>definition.indexOf("if (v_started->>'replayed')::boolean"));
  assert.ok(guard<definition.indexOf('select * into v_order from warehouse.fulfillment_orders'));
});

test('rescheduling never silently extends or prematurely opens a seller assignment',async t=>{
  const db=await fixture();t.after(()=>db.close());const allocation_id=await setup(db);
  assert.equal((await rpc(db,'event_custody_ledger',{event_id:'e1'})).allocations[0].serialized,true);
  await assert.rejects(db.exec("insert into warehouse.allocations values ('legacy','e1','watch',1,'reserved',false,now())"),/acknowledged demand/);
  await db.exec("update warehouse.events set start_date=current_date+30,end_date=current_date+31,status='planned' where id='e1'");
  await assert.rejects(rpc(db,'record_event_outcome',sale({allocation_id})),/Not authorized/);
  await assert.rejects(rpc(db,'event_custody_ledger',{event_id:'e1'}),/Not authorized/);
  await db.exec("update warehouse.events set start_date=current_date-1,end_date=current_date+31 where id='e1';update private.event_sellers set valid_until=now()-interval '1 second',valid_from=now()-interval '1 day'");
  await assert.rejects(rpc(db,'event_custody_ledger',{event_id:'e1'}),/Not authorized/);
});

test('direct event returns cannot use duplicate serials or negative quantities to increase custody',async t=>{
  const db=await fixture();t.after(()=>db.close());const allocation_id=await setup(db);
  for(const lines of [
    [{allocationId:allocation_id,productId:'watch',quantity:-1,serialNumber:'S1'}],
    [{allocationId:allocation_id,productId:'watch',quantity:1,serialNumber:'S1'},{allocationId:allocation_id,productId:'watch',quantity:1,serialNumber:'S1'}]
  ])await assert.rejects(db.query("insert into warehouse.returns(id,source,event_id,lines) values('invalid','event','e1',$1)",[lines]),/quantity|serial/i);
});

test('multi-product event demand persists once with scoped eligibility and unchanged approval authority',async t=>{
  const db=await fixture();t.after(()=>db.close());await actor(db,B,['events.request_fulfillment']);
  const input={event_id:'e1',requesting_department:'marketing',purpose:'Event stock',cost_center:'MKT',required_date:'2026-10-01',expense_treatment:'expense',
    lines:[{productId:'watch',quantity:50},{productId:'bag',quantity:50}],idempotency_key:'multi-demand-command'};
  const requested=await rpc(db,'request_event_fulfillment',input);
  assert.equal((await rpc(db,'request_event_fulfillment',input)).id,requested.id);
  assert.deepEqual(requested.lines,input.lines);
  assert.equal((await db.query('select count(*)::int n from warehouse.department_stock_requests')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from warehouse.movements')).rows[0].n,0);
  assert.deepEqual(await rpc(db,'event_demand_availability',{event_id:'e1',product_ids:['watch','bag']}),[
    {product_id:'bag',eligible_quantity:5},{product_id:'watch',eligible_quantity:2}]);
  await assert.rejects(rpc(db,'request_event_fulfillment',{...input,idempotency_key:'duplicate-demand',lines:[{productId:'watch',quantity:1},{productId:'watch',quantity:1}]}),/Duplicate/);
  await assert.rejects(rpc(db,'request_event_fulfillment',{...input,idempotency_key:'fraction-demand',lines:[{productId:'watch',quantity:1.5}]}),/whole|integer/);
  await actor(db);await assert.rejects(rpc(db,'event_demand_availability',{event_id:'e1',product_ids:['watch']}),/Not authorized/);
  await assert.rejects(rpc(db,'request_event_fulfillment',{...input,idempotency_key:'seller-request-denied'}),/Not authorized/);
});

test('cancellation cannot strand a released handover before independent acknowledgment',async t=>{
  const db=await fixture();t.after(()=>db.close());await setup(db,false);
  await assert.rejects(db.exec("update warehouse.events set status='cancelled' where id='e1'"),/handover/);
});

test('settlement cannot replace outstanding physical custody with invented returns or exception counters',async t=>{
  const db=await fixture();t.after(()=>db.close());await setup(db);
  await assert.rejects(db.exec("insert into warehouse.event_reconciliations(event_id,status,sold_units,giveaway_units,gross_sales_amount,returned_units) values ('e1','approved',0,0,0,2)"),/physical|custody/);
  await assert.rejects(db.exec("insert into warehouse.event_reconciliations(event_id,status,sold_units,giveaway_units,gross_sales_amount,lost_units) values ('e1','submitted',0,0,0,2)"),/physical|custody/);
});

test('legacy reserve and issue take event lock before allocation/product locks, including pre-gate events',async t=>{
  const db=await fixture();t.after(()=>db.close());
  for(const [name,anchor] of [['reserve','private.lock_warehouse_products'],['issue','select * into v_alloc']]){
    const body=(await db.query(`select pg_get_functiondef('warehouse.${name}_uncertified_impl(jsonb)'::regprocedure) body`)).rows[0].body;
    const at=body.indexOf('private.lock_legacy_event_custody');assert.ok(at>=0 && at<body.indexOf(anchor));
  }
  await setup(db);await actor(db,B,['warehouse.reserve_allocate']);
  await assert.rejects(rpc(db,'reserve_uncertified_impl',{product_id:'bag',quantity:1,allocation:{id:'legacy-1',event_id:'e1',product_id:'bag',quantity:1,status:'reserved'}}),/acknowledged demand/);
});

test('owner activation fails closed until schema capability and approved learning prerequisites are ready',async t=>{
  const db=await fixture();t.after(()=>db.close());await actor(db,B,['events.manage_events']);
  assert.deepEqual(await rpc(db,'event_custody_readiness',{event_id:'e1'}),{schema:true,capabilities:true,learning:true,ready:true});
  await db.exec('create or replace function private.event_seller_learning_ready() returns boolean language sql as $$select false$$');
  assert.equal((await rpc(db,'event_custody_readiness',{event_id:'e1'})).learning,false);
  await assert.rejects(rpc(db,'configure_event_custody',{event_id:'e1',action:'enable',idempotency_key:'not-ready-enable'}),/rollout/);
  await db.exec('drop function private.event_seller_learning_ready()');
  assert.equal((await rpc(db,'event_custody_readiness',{event_id:'e1'})).ready,false);
});

test('fully returned acknowledged allocation cannot be removed from lifetime issued custody by retained unreserve RPC',async t=>{
  const db=await fixture();t.after(()=>db.close());const allocation_id=await setup(db);await actor(db,B,['warehouse.manage_returns','warehouse.reserve_allocate']);
  await rpc(db,'record_return_v2',{idempotency_key:'return-both-command',return:{source:'event',event_id:'e1',lines:['S1','S2'].map(serialNumber=>({allocationId:allocation_id,productId:'watch',quantity:1,serialNumber,locationId:'quarantine',reason:'Unsold'}))}});
  assert.equal((await db.query('select status from warehouse.allocations where id=$1',[allocation_id])).rows[0].status,'returned');
  await assert.rejects(rpc(db,'cancel_allocation',{allocation_id}),/custody status/);
  assert.equal((await db.query("select sum(quantity)::int n from warehouse.allocations where event_id='e1' and status in ('issued','returned')")).rows[0].n,2);
  await db.exec("insert into warehouse.event_reconciliations(event_id,status,sold_units,giveaway_units,gross_sales_amount,returned_units) values ('e1','approved',0,0,0,2)");
});

test('settlement cannot precede handover and settled events cannot grow another source or demand',async t=>{
  const db=await fixture();t.after(()=>db.close());await setup(db,false);
  await assert.rejects(db.exec("insert into warehouse.event_reconciliations(event_id,status,sold_units,giveaway_units,gross_sales_amount) values ('e1','approved',0,0,0)"),/handover/);
  await db.exec("insert into warehouse.event_reconciliations(event_id,status) values ('e1','draft')");
  await db.exec('alter table warehouse.event_reconciliations disable trigger event_custody_settlement');
  await db.exec("update warehouse.event_reconciliations set status='approved'");
  await db.exec('alter table warehouse.event_reconciliations enable trigger event_custody_settlement');
  await assert.rejects(db.exec(`update warehouse.fulfillment_orders set status='completed',acknowledged_at=now(),acknowledged_by='${B}' where id='${O}'`),/settlement/);
  await actor(db,B,['events.request_fulfillment']);
  await assert.rejects(rpc(db,'request_event_fulfillment',{event_id:'e1',requesting_department:'marketing',purpose:'Late growth',cost_center:'MKT',required_date:'2026-10-01',expense_treatment:'expense',lines:[{productId:'watch',quantity:1}],idempotency_key:'post-settlement-demand'}),/settlement/);
});
