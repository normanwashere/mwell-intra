import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Real SQL/constraints with local identity/capability stubs, not live RBAC evidence.
const db = new PGlite();
const sql = name => readFileSync(`supabase/migrations/${name}`, 'utf8');
function definition(file, name) {
  const source = sql(file);
  const start = source.indexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('$$;', source.indexOf('as $$', start)) + 3);
}
const counter = '00000000-0000-4000-8000-000000000001';
const supervisor = '00000000-0000-4000-8000-000000000002';
const finance = '00000000-0000-4000-8000-000000000003';
const q = (text, args) => db.query(text, args);
let sequence = 0;
const actor = id => q("select set_config('probe.actor',$1,false)", [id]);
async function reset(cost = 10) {
  await db.exec(`truncate warehouse.command_log,warehouse.stock_change_requests,warehouse.cycle_counts,
    warehouse.exceptions,warehouse.stock_levels,warehouse.inventory_units,warehouse.movements,
    core.approvals,core.activity_log,private.warehouse_count_snapshots,private.warehouse_stock_epochs;
    delete from core.user_roles where user_id='${supervisor}' and role='finance';`);
  await q('update warehouse.products set unit_cost=$1', [cost]);
  await actor(counter);
  await q("select set_config('probe.denied_cap','',false)");
}
async function stock(a, b) {
  await q("insert into warehouse.stock_levels values('bulk','warehouse-a','bin-a','lot-a',$1),('bulk','warehouse-a','bin-a','lot-b',$2)", [a,b]);
}
async function count(a, b, extra = {}, payload) {
  const input = payload ?? {idempotency_key:`lot-count-command-${++sequence}`,
    cycle_count:{id:`lot-count-${sequence}`,location_id:'warehouse-a',bin_id:'bin-a',category:'merchandise',
      lines:[{productId:'bulk',counted:a+b,lotCounts:[{lotId:'lot-a',counted:a},{lotId:'lot-b',counted:b}],...extra}]},
    reason:'Physical count',evidence_urls:['synthetic/count.jpg']};
  const result = (await q('select warehouse.create_and_submit_cycle_count($1::jsonb) result',[JSON.stringify(input)])).rows[0].result;
  return {...result,payload:input};
}
async function decide(id, who = supervisor, decision = 'approved', key = `lot-decision-command-${++sequence}`) {
  await actor(who);
  return (await q('select warehouse.decide_stock_change($1::jsonb) result',[JSON.stringify({
    request_id:id,idempotency_key:key,decision,note:'Independent physical-count review',
  })])).rows[0].result;
}
const balances = async () => (await q('select lot_id,quantity from warehouse.stock_levels order by lot_id nulls last')).rows;
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema core; create schema auth; create schema private; create schema warehouse;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('probe.actor',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function core.has_cap(text,text) returns boolean language sql as $$ select true $$;
    create function core.has_live_cap(text,text) returns boolean language sql as $$ select $2 <> coalesce(current_setting('probe.denied_cap',true),'') $$;
    create function warehouse.authoritative_actor() returns text language sql as $$ select auth.uid()::text $$;
    create function private.warehouse_payload_hash(jsonb) returns text language sql as $$ select md5($1::text) $$;
    create table core.profiles(id uuid primary key);
    insert into core.profiles values('${counter}'),('${supervisor}'),('${finance}');
    create table warehouse.products(id text primary key,serialized boolean,unit_cost numeric(14,4));
    insert into warehouse.products values('bulk',false,10),('serial',true,10);
    create table warehouse.locations(id text primary key,type text,active boolean default true);
    insert into warehouse.locations values('warehouse-a','warehouse',true);
    create table warehouse.storage_areas(id text primary key,location_id text,active boolean default true);
    insert into warehouse.storage_areas values('bin-a','warehouse-a',true);
    create table warehouse.lots(id text primary key,product_id text,unit_cost numeric);
    insert into warehouse.lots values('lot-a','bulk',1),('lot-b','bulk',999999);
    create table warehouse.stock_levels(product_id text,location_id text,bin_id text,lot_id text,quantity integer not null);
    create unique index stock_levels_uq on warehouse.stock_levels(product_id,location_id,bin_id,lot_id) nulls not distinct;
    create table warehouse.inventory_units(id text primary key,product_id text,location_id text,bin_id text,
      serial_number text,status text,assigned_to text,event_id text);
    create table warehouse.cycle_counts(id text primary key,location_id text,bin_id text,category text,lines jsonb,
      status text,requested_by uuid,actor text,created_at timestamptz,submitted_at timestamptz);
    create table warehouse.command_log(id uuid primary key default gen_random_uuid(),actor_id uuid,command_name text,
      idempotency_key text,payload_hash text,response jsonb,completed_at timestamptz,unique(actor_id,command_name,idempotency_key));
    create table warehouse.exceptions(id uuid primary key default gen_random_uuid(),exception_type text,severity text,
      source_type text,source_id text,status text,due_at timestamptz,created_by uuid,resolution text,owner_id uuid,updated_at timestamptz);
    create table warehouse.movements(id text primary key,type text,product_id text,quantity integer,to_location_id text,to_bin_id text,
      lot_id text,serial_number text,reason text,reference text,evidence_urls jsonb,actor text,created_at timestamptz);
    create table warehouse.fulfillment_orders(id text,source text,third_party_location_id text,status text);
    create table core.approvals(id uuid primary key default gen_random_uuid(),entity_type text,entity_id text,step integer,
      approver_role text,sla_due_at timestamptz,decision text default 'pending',decided_by uuid,decided_at timestamptz,note text);
    create table core.approval_groups(entity_type text,group_code text,is_active boolean,request_status text,capability text,module text,member_roles text[]);
    insert into core.approval_groups values
      ('warehouse_stock_change','logistics_supervisor',true,'pending_supervisor','approve_stock_adjustment','warehouse',array['supervisor']),
      ('warehouse_stock_change','finance',true,'pending_finance','approve_stock_adjustment_finance','warehouse',array['finance']);
    create table core.user_roles(user_id uuid,module text,role text,effective_at timestamptz not null default now(),expires_at timestamptz,
      check(expires_at is null or expires_at>effective_at));
    insert into core.user_roles(user_id,module,role) values('${supervisor}','warehouse','supervisor'),('${finance}','warehouse','finance');
    create table core.roles(module text,role text,is_active boolean);
    insert into core.roles values('warehouse','supervisor',true),('warehouse','finance',true);
    create table core.activity_log(module text,entity_type text,entity_id text,action text,actor uuid,detail jsonb);
  `);
  const schema = sql('20260710150000_warehouse_w1_control_schema.sql');
  const start = schema.indexOf('create table if not exists warehouse.stock_change_requests (');
  await db.exec(schema.slice(start,schema.indexOf('\n);',start)+4));
  const w1 = '20260710160000_warehouse_w1_quality_and_approval_rpcs.sql';
  const receipt = '20260714175318_single_po_receipt_authority.sql';
  for (const name of ['private.begin_idempotent_command','private.finish_idempotent_command','private.warehouse_submit_cycle_count']) await db.exec(definition(w1,name));
  for (const name of ['private.lock_warehouse_products','private.warehouse_decide_stock_change','private.warehouse_request_stock_change','warehouse.request_stock_change']) await db.exec(definition(receipt,name));
  await db.exec(sql('20260718199000_align_stock_approval_entity_identity.sql'));
  await db.exec(definition('20260718198000_converge_stock_change_governance.sql','warehouse.decide_stock_change'));
  await db.exec(definition('20260815163010_require_attributable_cycle_count_actor.sql','warehouse.create_and_submit_cycle_count'));
  await db.exec(sql('20260718150000_fix_stock_approval_projection_uuid_join.sql'));
  await db.exec(sql('20261105071150_warehouse_count_integrity.sql'));
  if (process.env.WMS_LOT_BASELINE !== '1') await db.exec(sql('20261105071210_warehouse_lot_count_exposure.sql'));
  await db.exec(sql('20261105071229_warehouse_count_rejection_receipt.sql'));
});
after(async () => db.close());

test('zero-balance lot recovery changes that receipt lot, not unlotted stock', async () => {
  await reset(); await stock(0,3);
  const c = await count(1,3);
  assert.equal(c.requests.length,1);
  await decide(c.requests[0].id);
  assert.deepEqual(await balances(),[{lot_id:'lot-a',quantity:1},{lot_id:'lot-b',quantity:3}]);
  assert.deepEqual((await q('select lot_id,quantity from warehouse.movements')).rows,[{lot_id:'lot-a',quantity:1}]);
});

test('net-zero lot corrections get one atomic request and server-normalized gross exposure', async () => {
  await reset(); await stock(3,2);
  const c = await count(2,3,{_serverExpected:9000,unitCost:0,grossQuantity:0,approvalExposure:0,
    lotCounts:[{lotId:'lot-b',counted:3,expected:9000,delta:0},{lotId:'lot-a',counted:2,unitCost:0}]});
  assert.equal(c.requests.length,1);
  assert.equal(c.requests[0].quantity_delta,0);
  assert.equal(Number(c.requests[0].financial_impact),0);
  assert.equal(Number(c.requests[0].gross_quantity),2);
  assert.equal(Number(c.requests[0].approval_exposure),20);
  assert.deepEqual(c.cycle_count.lines[0].lotCounts,[
    {lotId:'lot-a',expected:3,counted:2,delta:-1},{lotId:'lot-b',expected:2,counted:3,delta:1},
  ]);
  await decide(c.requests[0].id);
  assert.deepEqual(await balances(),[{lot_id:'lot-a',quantity:2},{lot_id:'lot-b',quantity:3}]);
  assert.deepEqual((await q('select lot_id,quantity from warehouse.movements order by lot_id')).rows,[{lot_id:'lot-a',quantity:-1},{lot_id:'lot-b',quantity:1}]);
});

test('gross threshold retains product valuation and separate supervisor/finance review', async () => {
  await reset(4000); await stock(3,2);
  const c = await count(1,3);
  const request = c.requests[0];
  assert.equal(Number(request.financial_impact),4000);
  assert.equal(Number(request.gross_quantity),3);
  assert.equal(Number(request.approval_exposure),12000);
  assert.equal((await q('select count(*)::int n from core.approvals')).rows[0].n,2);
  assert.equal((await q('select severity from warehouse.exceptions')).rows[0].severity,'P1');
  await assert.rejects(decide(request.id,counter),/requester/);
  await assert.rejects(decide(request.id,finance),/configured approval group/);
  await q("select set_config('probe.denied_cap','approve_stock_adjustment',false)");
  await assert.rejects(decide(request.id),/Not authorized/);
  await q("select set_config('probe.denied_cap','',false)");
  assert.equal((await decide(request.id)).status,'pending_finance');
  assert.deepEqual(await balances(),[{lot_id:'lot-a',quantity:3},{lot_id:'lot-b',quantity:2}]);
  await db.exec(`insert into core.user_roles(user_id,module,role) values('${supervisor}','warehouse','finance')`);
  await assert.rejects(decide(request.id),/Finance must be a distinct actor/);
  await q("select set_config('probe.denied_cap','approve_stock_adjustment_finance',false)");
  await assert.rejects(decide(request.id,finance),/Not authorized/);
  await q("select set_config('probe.denied_cap','',false)");
  await db.exec('update warehouse.products set unit_cost=1');
  const approved = await decide(request.id,finance);
  assert.equal(approved.status,'approved');
  assert.equal(Number(approved.unit_cost),4000);
  assert.equal(Number(approved.approval_exposure),12000);
  assert.deepEqual(await balances(),[{lot_id:'lot-a',quantity:1},{lot_id:'lot-b',quantity:3}]);
});

test('exactly 10000 gross requires only supervisor; free net-zero stock still requires review', async () => {
  for (const cost of [5000,0]) {
    await reset(cost); await stock(3,2);
    const c = await count(2,3);
    assert.equal(Number(c.requests[0].approval_exposure),cost*2);
    assert.equal((await q('select count(*)::int n from core.approvals')).rows[0].n,1);
    assert.equal((await decide(c.requests[0].id)).status,'approved');
  }
});

test('unchanged lots create no request; omission, duplicate and unknown receipt identities fail', async () => {
  await reset(); await stock(0,3);
  assert.equal((await count(0,3)).requests.length,0);
  for (const lotCounts of [[],[{lotId:'lot-b',counted:3}], [{lotId:'lot-a',counted:0},{lotId:'lot-a',counted:3}],
    [{lotId:'not-in-scope',counted:0},{lotId:'lot-b',counted:3}], [{counted:0},{lotId:'lot-b',counted:3}],
    [{lotId:'lot-a',counted:-1},{lotId:'lot-b',counted:4}], [{lotId:'lot-a',counted:0.5},{lotId:'lot-b',counted:2.5}]]) {
    await assert.rejects(count(0,3,{lotCounts}));
  }
  assert.deepEqual(await balances(),[{lot_id:'lot-a',quantity:0},{lot_id:'lot-b',quantity:3}]);
});

test('same command and decision replay once; changed payload and stale sibling cannot post', async () => {
  await reset(); await stock(3,2);
  const c = await count(2,3);
  assert.equal((await count(2,3,{},c.payload)).requests[0].id,c.requests[0].id);
  const changed = structuredClone(c.payload); changed.cycle_count.lines[0].lotCounts[0].counted=1;
  await assert.rejects(count(1,3,{},changed),/different payload/);
  const sibling = await count(2,3);
  const result = await decide(c.requests[0].id,supervisor,'approved','stable-lot-review-command');
  assert.deepEqual(await decide(c.requests[0].id,supervisor,'approved','stable-lot-review-command'),result);
  await assert.rejects(decide(sibling.requests[0].id),/Stock changed/);
  assert.equal((await q('select count(*)::int n from warehouse.movements')).rows[0].n,2);
});

test('failed second lot movement rolls back both lot balances, decision and replay claim', async () => {
  await reset(); await stock(3,2);
  const c = await count(2,3);
  await db.exec(`create function private.probe_fail_lot_b() returns trigger language plpgsql as $$
    begin if new.lot_id='lot-b' then raise exception 'synthetic ledger failure'; end if; return new; end $$;
    create trigger probe_fail_lot_b before insert on warehouse.movements for each row execute function private.probe_fail_lot_b();`);
  try {
    await assert.rejects(decide(c.requests[0].id,supervisor,'approved','failed-lot-review-command'),/synthetic ledger failure/);
    assert.deepEqual(await balances(),[{lot_id:'lot-a',quantity:3},{lot_id:'lot-b',quantity:2}]);
    assert.equal((await q('select count(*)::int n from warehouse.movements')).rows[0].n,0);
    assert.equal((await q('select decision from core.approvals')).rows[0].decision,'pending');
  } finally { await db.exec('drop trigger probe_fail_lot_b on warehouse.movements; drop function private.probe_fail_lot_b()'); }
  assert.equal((await decide(c.requests[0].id,supervisor,'approved','failed-lot-review-command')).status,'approved');
});

test('manual zero changes remain forbidden and manual nonzero valuation remains unchanged', async () => {
  await reset();
  const base = {idempotency_key:'manual-lot-review-command',source_type:'adjustment',product_id:'bulk',location_id:'warehouse-a',bin_id:'bin-a',quantity_delta:0,reason:'Reconcile',evidence_urls:[]};
  await assert.rejects(q('select warehouse.request_stock_change($1::jsonb)',[JSON.stringify(base)]),/non-zero/);
  const request = (await q('select warehouse.request_stock_change($1::jsonb) result',[JSON.stringify({...base,quantity_delta:2})])).rows[0].result;
  assert.equal(Number(request.financial_impact),20);
  assert.equal(Number(request.approval_exposure),20);
  await assert.rejects(q('update warehouse.stock_change_requests set quantity_delta=0 where id=$1',[request.id]),/quantity_check/);
});

test('count exposure cannot be edited and API roles cannot call normalization helpers', async () => {
  await reset(); await stock(3,2);
  const c = await count(2,3);
  for (const set of ['gross_quantity=0','unit_cost=0','quantity_delta=1',"source_type='adjustment'"]) {
    await assert.rejects(q(`update warehouse.stock_change_requests set ${set} where id=$1`,[c.requests[0].id]),/immutable/);
  }
  assert.deepEqual((await q(`select
    has_function_privilege('authenticated','private.warehouse_normalize_count_exposure()','EXECUTE') helper,
    has_table_privilege('authenticated','warehouse.stock_change_requests','INSERT') ins,
    has_table_privilege('authenticated','warehouse.stock_change_requests','UPDATE') upd`)).rows[0],{helper:false,ins:false,upd:false});
});

test('serialized shortage still records exact identity with gross equal to net magnitude', async () => {
  await reset();
  await db.exec("insert into warehouse.inventory_units values('unit-a','serial','warehouse-a','bin-a','SER-A','in_stock',null,null)");
  const c = await count(0,0,{productId:'serial',serialNumbers:[],lotCounts:undefined});
  assert.equal(c.requests[0].quantity_delta,-1);
  assert.equal(Number(c.requests[0].gross_quantity),1);
  await decide(c.requests[0].id);
  assert.deepEqual((await q('select serial_number,quantity from warehouse.movements')).rows,[{serial_number:'SER-A',quantity:-1}]);
});

test('a sole depleted receipt is retained even when the caller supplies only the item total', async () => {
  await reset();
  await db.exec("insert into warehouse.stock_levels values('bulk','warehouse-a','bin-a','lot-a',0)");
  const c = await count(1,0,{lotCounts:undefined});
  await decide(c.requests[0].id);
  assert.deepEqual(await balances(),[{lot_id:'lot-a',quantity:1}]);
});

test('mixed unlotted and depleted receipt stock keeps each identity through correction', async () => {
  await reset();
  await db.exec("insert into warehouse.stock_levels values('bulk','warehouse-a','bin-a',null,2),('bulk','warehouse-a','bin-a','lot-a',0)");
  const c = await count(1,1,{lotCounts:[{lotId:null,counted:1},{lotId:'lot-a',counted:1}]});
  await decide(c.requests[0].id);
  assert.deepEqual(await balances(),[{lot_id:'lot-a',quantity:1},{lot_id:null,quantity:1}]);
});

test('zero-net finance request can be rejected without movements or partially applied lots', async () => {
  await reset(6000); await stock(3,2);
  const c = await count(2,3);
  assert.equal(c.requests[0].quantity_delta,0);
  assert.equal(Number(c.requests[0].approval_exposure),12000);
  assert.equal((await decide(c.requests[0].id)).status,'pending_finance');
  await assert.rejects(decide(c.requests[0].id,counter),/requester/);
  assert.equal((await decide(c.requests[0].id,finance,'rejected')).status,'rejected');
  assert.deepEqual(await balances(),[{lot_id:'lot-a',quantity:3},{lot_id:'lot-b',quantity:2}]);
  assert.equal((await q('select count(*)::int n from warehouse.movements')).rows[0].n,0);
});

test('stock changes between finance stages invalidate the whole lot correction', async () => {
  await reset(6000); await stock(3,2);
  const c = await count(2,3);
  await decide(c.requests[0].id);
  await db.exec("update warehouse.stock_levels set quantity=4 where lot_id='lot-a'");
  await assert.rejects(decide(c.requests[0].id,finance),/Stock changed/);
  assert.deepEqual(await balances(),[{lot_id:'lot-a',quantity:4},{lot_id:'lot-b',quantity:2}]);
  assert.equal((await q('select decision from core.approvals where step=2')).rows[0].decision,'pending');
  assert.equal((await q('select count(*)::int n from warehouse.movements')).rows[0].n,0);
});

test('capture refuses missing or inconsistent server expected totals for bulk and serials', async () => {
  await reset(); await stock(3,2);
  await db.exec("insert into warehouse.cycle_counts(id,location_id,bin_id) values('capture-guard','warehouse-a','bin-a'); insert into warehouse.inventory_units values('guard-a','serial','warehouse-a','bin-a','GUARD-A','in_stock',null,null)");
  for (const line of [
    {productId:'bulk',counted:5,lotCounts:[{lotId:'lot-a',counted:3},{lotId:'lot-b',counted:2}]},
    {productId:'bulk',counted:5,_serverExpected:4,lotCounts:[{lotId:'lot-a',counted:3},{lotId:'lot-b',counted:2}]},
    {productId:'serial',counted:0,serialNumbers:[],_serverExpected:2},
  ]) {
    await assert.rejects(q("select private.warehouse_capture_count(c,$1::jsonb) from warehouse.cycle_counts c where id='capture-guard'",[JSON.stringify(line)]),/Stock changed while/);
  }
  assert.equal((await q('select count(*)::int n from private.warehouse_count_snapshots')).rows[0].n,0);
});

test('gross quantities beyond int32 remain exact without inventing net stock', async () => {
  await reset(0); await stock(2000000000,0);
  const c = await count(0,2000000000);
  assert.equal(c.requests[0].quantity_delta,0);
  assert.equal(Number(c.requests[0].gross_quantity),4000000000);
  await decide(c.requests[0].id);
  assert.deepEqual(await balances(),[{lot_id:'lot-a',quantity:0},{lot_id:'lot-b',quantity:2000000000}]);
});

test('existing approval list RPC includes new exposure fields without expanding its data scope', async () => {
  await reset(); await stock(3,2);
  const c = await count(2,3);
  await actor(supervisor);
  const page = (await q("select private.warehouse_list_stock_change_requests('{}') result")).rows[0].result;
  assert.equal(page.rows.length,1);
  assert.equal(page.rows[0].id,c.requests[0].id);
  assert.equal(Number(page.rows[0].gross_quantity),2);
  assert.equal(Number(page.rows[0].approval_exposure),20);
});

test('rejection receipt tags only whitelisted fresh-command errors after all count writes roll back', async () => {
  await db.exec(`create function private.probe_count_finish_failure() returns trigger language plpgsql as $$
    begin
      if new.command_name='create_and_submit_cycle_count' and new.response is not null then
        raise exception using errcode=current_setting('probe.failure_code'),message='synthetic final count failure';
      end if;
      return new;
    end $$;
    create trigger probe_count_finish_failure before update on warehouse.command_log
      for each row execute function private.probe_count_finish_failure();`);
  try {
    for (const [code, expected] of [
      ['P0001','PWC01'],['23514','PWC01'],['23503','PWC01'],['22023','PWC01'],['22P02','PWC01'],['22003','PWC01'],
      ['23505','23505'],['40001','40001'],['40P01','40P01'],['57014','57014'],['42501','42501'],
    ]) {
      await reset(6000); await stock(3,2);
      await q("select set_config('probe.failure_code',$1,false)",[code]);
      await assert.rejects(count(2,3),error => {
        assert.equal(error.code,expected);
        if (expected==='PWC01') assert.match(error.detail,/fully rolled back/);
        return true;
      });
      for (const table of ['warehouse.cycle_counts','warehouse.stock_change_requests','core.approvals',
        'warehouse.exceptions','core.activity_log','private.warehouse_count_snapshots','warehouse.command_log']) {
        assert.equal((await q(`select count(*)::int n from ${table}`)).rows[0].n,0,`${code}: ${table}`);
      }
      assert.deepEqual(await balances(),[{lot_id:'lot-a',quantity:3},{lot_id:'lot-b',quantity:2}]);
    }
  } finally {
    await db.exec('drop trigger probe_count_finish_failure on warehouse.command_log; drop function private.probe_count_finish_failure()');
  }
});

test('an unresolved ledger claim is never relabeled rejected; completed gross counts still replay', async () => {
  await reset(); await stock(3,2);
  const payload = {idempotency_key:'unresolved-lot-count-command',cycle_count:{id:'unresolved-count',
    location_id:'warehouse-a',bin_id:'bin-a',lines:[{productId:'bulk',counted:5,
      lotCounts:[{lotId:'lot-a',counted:2},{lotId:'lot-b',counted:3}]}]},
    reason:'Physical count',evidence_urls:['synthetic/count.jpg']};
  await q("select private.begin_idempotent_command('create_and_submit_cycle_count',$1,$2::jsonb)",
    [payload.idempotency_key,JSON.stringify(payload)]);
  await assert.rejects(count(2,3,{},payload),error => error.code==='P0001' && /already in progress/.test(error.message));
  assert.deepEqual((await q('select response,completed_at from warehouse.command_log')).rows,[{response:null,completed_at:null}]);
  const c = await count(2,3);
  await q("select set_config('probe.denied_cap','cycle_count',false)");
  const replay = await count(2,3,{},c.payload);
  assert.deepEqual(replay.requests,c.requests);
  assert.equal(Number(replay.requests[0].approval_exposure),20);
  const changed = structuredClone(c.payload); changed.cycle_count.lines[0].counted=4;
  await assert.rejects(count(1,3,{},changed),error => error.code==='P0001' && /different payload/.test(error.message));
  assert.equal((await q('select count(*)::int n from warehouse.stock_change_requests')).rows[0].n,1);
});
