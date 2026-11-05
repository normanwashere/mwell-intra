import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Executes the real migration functions; authentication stubs are not live RBAC certification.
const db = new PGlite();
const migration = (name) => readFileSync(resolve('supabase/migrations', name), 'utf8');
function definition(file, name) {
  const sql = migration(file);
  const start = sql.indexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf('$$;', sql.indexOf('as $$', start)) + 3);
}
const counter = '00000000-0000-4000-8000-000000000001';
const reviewer = '00000000-0000-4000-8000-000000000002';
const financeReviewer = '00000000-0000-4000-8000-000000000003';
let sequence = 0;
const q = (sql, args) => db.query(sql, args);
const actor = (id) => q("select set_config('probe.actor', $1, false)", [id]);
async function reset() {
  await db.exec(`truncate warehouse.command_log, warehouse.cycle_counts, warehouse.stock_change_requests,
    warehouse.exceptions, warehouse.inventory_units, warehouse.stock_levels, warehouse.movements,
    core.approvals, core.activity_log, private.warehouse_count_snapshots, private.warehouse_stock_epochs;
    delete from warehouse.locations; insert into warehouse.locations values('warehouse-a','warehouse',true);
    update warehouse.products set unit_cost=10;
    update core.roles set is_active=true;
    update core.approval_groups set is_active=true,capability=case group_code
      when 'logistics_supervisor' then 'approve_stock_adjustment' else 'approve_stock_adjustment_finance' end;
    truncate core.user_roles;
    insert into core.user_roles(user_id,module,role) values
      ('${counter}','warehouse','warehouse_counter'),
      ('${reviewer}','warehouse','warehouse_supervisor'),
      ('${financeReviewer}','warehouse','warehouse_finance');`);
  await actor(counter);
  await q("select set_config('probe.live', 'true', false)");
}
async function count(productId, counted, extra = {}, stable) {
  const payload = stable ?? { idempotency_key: `synthetic-count-${++sequence}`,
    cycle_count: { id: `count-${sequence}`, location_id: 'warehouse-a', bin_id: 'bin-a', category: 'merchandise',
      lines: [{ productId, counted, ...extra }] }, reason: 'Physical count', evidence_urls: ['synthetic/count.jpg'] };
  const result = await q('select warehouse.create_and_submit_cycle_count($1::jsonb) as result', [JSON.stringify(payload)]);
  return { ...result.rows[0].result, payload };
}
async function decide(id, decision = 'approved', key = `synthetic-decision-${++sequence}`, decider = reviewer) {
  await actor(decider);
  return q('select warehouse.decide_stock_change($1::jsonb) as result', [JSON.stringify({
    idempotency_key: key, request_id: id, decision, note: 'Independent review',
  })]);
}
async function decisionState(id) {
  return (await q(`select jsonb_build_object(
    'request',(select to_jsonb(r) from warehouse.stock_change_requests r where id=$1::uuid),
    'steps',(select jsonb_agg(to_jsonb(a) order by step) from core.approvals a where entity_id=$1::text),
    'counts',(select jsonb_agg(to_jsonb(c) order by id) from warehouse.cycle_counts c),
    'stock',(select sum(quantity) from warehouse.stock_levels),
    'movements',(select count(*) from warehouse.movements),
    'commands',(select count(*) from warehouse.command_log),
    'activity',(select count(*) from core.activity_log),
    'epochs',(select count(*) from private.warehouse_stock_epochs)
  ) as state`, [id])).rows[0].state;
}
before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema core; create schema private; create schema warehouse; create schema learning;
    create function auth.uid() returns uuid language sql as $$ select current_setting('probe.actor')::uuid $$;
    create function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function auth.role() returns text language sql as $$ select 'authenticated'::text $$;
    create function learning.is_certification_required(text,text) returns boolean language sql as $$ select true $$;
    create function learning.has_active_certification(uuid,text,text) returns boolean language sql as $$ select coalesce(current_setting('probe.live',true),'true')::boolean $$;
    create function learning.has_active_emergency_exception(uuid,text,text) returns boolean language sql as $$ select false $$;
    create function warehouse.authoritative_actor() returns text language sql as $$ select auth.uid()::text $$;
    create function private.warehouse_payload_hash(jsonb) returns text language sql as $$ select md5($1::text) $$;
    create function private.lock_warehouse_products(text[]) returns void language plpgsql as $$ begin return; end $$;
    create table warehouse.command_log(id uuid primary key default gen_random_uuid(),actor_id uuid,
      command_name text,idempotency_key text,payload_hash text,response jsonb,completed_at timestamptz,
      unique(actor_id,command_name,idempotency_key));
    create table warehouse.products(id text primary key,serialized boolean,unit_cost numeric);
    create table warehouse.locations(id text primary key,type text,active boolean default true);
    create table warehouse.fulfillment_orders(id text,source text,third_party_location_id text,status text);
    create table warehouse.cycle_counts(id text primary key,location_id text,bin_id text,category text,lines jsonb,
      status text,requested_by uuid,actor text,created_at timestamptz,submitted_at timestamptz);
    create table warehouse.stock_levels(product_id text,location_id text,bin_id text,lot_id text,quantity integer);
    create table warehouse.inventory_units(id text primary key,product_id text,location_id text,bin_id text,
      serial_number text,status text,assigned_to text,event_id text);
    create table warehouse.stock_change_requests(id uuid primary key default gen_random_uuid(),source_type text,
      source_id text,product_id text,location_id text,bin_id text,quantity_delta integer,unit_cost numeric,
      financial_impact numeric generated always as(abs(quantity_delta)*unit_cost) stored,reason text,
      evidence_urls jsonb,requested_by uuid,status text default 'pending_supervisor',requested_at timestamptz default now(),decided_at timestamptz);
    create table warehouse.exceptions(id uuid primary key default gen_random_uuid(),exception_type text,severity text,
      source_type text,source_id text,status text,due_at timestamptz,created_by uuid,resolution text,owner_id uuid,updated_at timestamptz);
    create table warehouse.movements(id text,type text,product_id text,quantity integer,to_location_id text,to_bin_id text,
      lot_id text,serial_number text,reason text,reference text,evidence_urls jsonb,actor text,created_at timestamptz);
    create table core.approvals(id uuid primary key default gen_random_uuid(),entity_type text,entity_id text,step integer,
      approver_role text,sla_due_at timestamptz,decision text default 'pending',decided_by uuid,decided_at timestamptz,note text);
    create table core.approval_groups(entity_type text,group_code text,is_active boolean,request_status text,capability text,module text,member_roles text[]);
    create table core.user_roles(user_id uuid,module text,role text,effective_at timestamptz not null default now(),expires_at timestamptz,
      check(expires_at is null or expires_at>effective_at));
    create table core.roles(module text,role text,is_active boolean);
    create table core.role_capabilities(module text,role text,cap text);
    create table core.profiles(id uuid primary key,status text);
    create table core.activity_log(module text,entity_type text,entity_id text,action text,actor uuid,detail jsonb);
    insert into warehouse.products values('bulk',false,10),('serial',true,10);
    insert into core.approval_groups values
      ('warehouse_stock_change','logistics_supervisor',true,'pending_supervisor','approve_stock_adjustment','warehouse',array['warehouse_supervisor']),
      ('warehouse_stock_change','finance',true,'pending_finance','approve_stock_adjustment_finance','warehouse',array['warehouse_finance']);
    insert into core.roles values('warehouse','warehouse_counter',true),('warehouse','warehouse_supervisor',true),
      ('warehouse','warehouse_finance',true),('warehouse','approval_delegate',true);
    insert into core.role_capabilities values('warehouse','warehouse_counter','cycle_count'),
      ('warehouse','warehouse_supervisor','approve_stock_adjustment'),
      ('warehouse','warehouse_finance','approve_stock_adjustment_finance'),
      ('warehouse','approval_delegate','approve_stock_adjustment'),
      ('warehouse','approval_delegate','approve_stock_adjustment_finance');
    insert into core.profiles values('${counter}','active'),('${reviewer}','active'),('${financeReviewer}','active');
  `);
  await db.exec(definition('20260816090000_security_database_launch_blocker_convergence.sql', 'core.has_cap'));
  await db.exec(definition('20260812200000_learning_authority.sql', 'core.has_live_cap'));
  const first = '20260710160000_warehouse_w1_quality_and_approval_rpcs.sql';
  for (const name of ['private.begin_idempotent_command','private.finish_idempotent_command','private.warehouse_submit_cycle_count']) await db.exec(definition(first, name));
  await db.exec(definition('20260815163010_require_attributable_cycle_count_actor.sql', 'warehouse.create_and_submit_cycle_count'));
  await db.exec(definition('20260714175318_single_po_receipt_authority.sql', 'private.warehouse_decide_stock_change'));
  await db.exec(migration('20260718199000_align_stock_approval_entity_identity.sql'));
  await db.exec(definition('20260718198000_converge_stock_change_governance.sql', 'warehouse.decide_stock_change'));
  await db.exec(migration('20261105071150_warehouse_count_integrity.sql'));
  await db.exec(migration('20261105071229_warehouse_count_rejection_receipt.sql'));
});
after(async () => db.close());

test('single receipt lot is deducted in place with a lot-specific movement', async () => {
  await reset();
  await db.exec("insert into warehouse.stock_levels values('bulk','warehouse-a','bin-a','lot-a',3)");
  const c = await count('bulk',2);
  await decide(c.requests[0].id);
  assert.deepEqual((await q('select lot_id,quantity from warehouse.stock_levels')).rows,[{lot_id:'lot-a',quantity:2}]);
  assert.deepEqual((await q('select lot_id,quantity from warehouse.movements')).rows,[{lot_id:'lot-a',quantity:-1}]);
});
test('multiple lots require explicit counts and preserve all other lot balances', async () => {
  await reset();
  await db.exec("insert into warehouse.stock_levels values('bulk','warehouse-a','bin-a','lot-a',2),('bulk','warehouse-a','bin-a','lot-b',1)");
  await assert.rejects(count('bulk',2), /Count each receipt lot/);
  const c = await count('bulk',2,{lotCounts:[{lotId:'lot-a',counted:1},{lotId:'lot-b',counted:1}]});
  await decide(c.requests[0].id);
  assert.deepEqual((await q('select lot_id,quantity from warehouse.stock_levels order by lot_id')).rows,[{lot_id:'lot-a',quantity:1},{lot_id:'lot-b',quantity:1}]);
});
test('malformed, duplicate, omitted and unknown lot counts cannot change stock', async () => {
  await reset();
  await db.exec("insert into warehouse.stock_levels values('bulk','warehouse-a','bin-a','lot-a',2),('bulk','warehouse-a','bin-a',null,1)");
  for (const lotCounts of [null,[],[{lotId:'lot-a',counted:2}], [{lotId:'lot-a',counted:1},{lotId:'lot-a',counted:1}], [{lotId:'unknown',counted:1},{lotId:null,counted:1}], [{lotId:'lot-a',counted:1.5},{lotId:null,counted:0.5}]]) {
    await assert.rejects(count('bulk',2,{lotCounts}));
  }
  assert.equal((await q('select count(*)::int n from warehouse.stock_change_requests')).rows[0].n,0);
});
test('retrying the same command creates one count and one request', async () => {
  await reset(); await db.exec("insert into warehouse.stock_levels values('bulk','warehouse-a','bin-a',null,3)");
  const first = await count('bulk',2);
  const second = await count('bulk',2,{},first.payload);
  assert.equal(first.requests[0].id,second.requests[0].id);
  assert.equal((await q('select count(*)::int n from warehouse.cycle_counts')).rows[0].n,1);
});
test('a second count against the same old balance cannot apply the shortage twice', async () => {
  await reset(); await db.exec("insert into warehouse.stock_levels values('bulk','warehouse-a','bin-a',null,3)");
  const first = await count('bulk',2); const second = await count('bulk',2);
  await decide(first.requests[0].id);
  await assert.rejects(decide(second.requests[0].id), /Stock changed after this count/);
  assert.equal((await q('select quantity from warehouse.stock_levels')).rows[0].quantity,2);
});
test('a departed serial and replacement arrival require a recount; neither is written off', async () => {
  await reset();
  await db.exec("insert into warehouse.inventory_units values('a','serial','warehouse-a','bin-a','SER-A','in_stock',null,null),('b','serial','warehouse-a','bin-a','SER-B','in_stock',null,null)");
  const c = await count('serial',1,{serialNumbers:['SER-B']});
  await db.exec("update warehouse.inventory_units set bin_id='bin-b' where id='a'; insert into warehouse.inventory_units values('c','serial','warehouse-a','bin-a','SER-C','in_stock',null,null)");
  await assert.rejects(decide(c.requests[0].id), /Stock changed after this count/);
  assert.equal((await q("select count(*)::int n from warehouse.inventory_units where status='lost'")).rows[0].n,0);
});
test('even stock moved away and back invalidates the old count', async () => {
  await reset(); await db.exec("insert into warehouse.stock_levels values('bulk','warehouse-a','bin-a',null,3)");
  const c = await count('bulk',2);
  await db.exec('update warehouse.stock_levels set quantity=2; update warehouse.stock_levels set quantity=3');
  await assert.rejects(decide(c.requests[0].id), /Stock changed after this count/);
});
test('serial write-off records the exact missing unit, not aggregate product history', async () => {
  await reset(); await db.exec("insert into warehouse.inventory_units values('a','serial','warehouse-a','bin-a','SER-A','in_stock',null,null),('b','serial','warehouse-a','bin-a','SER-B','in_stock',null,null)");
  const c = await count('serial',1,{serialNumbers:['SER-B']});
  await decide(c.requests[0].id);
  assert.deepEqual((await q('select serial_number,quantity from warehouse.movements')).rows,[{serial_number:'SER-A',quantity:-1}]);
});
test('raw capability cannot substitute for current training authority', async () => {
  await reset(); await db.exec("insert into warehouse.stock_levels values('bulk','warehouse-a','bin-a',null,3)");
  const c = await count('bulk',2); await q("select set_config('probe.live','false',false)");
  await assert.rejects(decide(c.requests[0].id), /Not authorized/);
  assert.equal((await q('select quantity from warehouse.stock_levels')).rows[0].quantity,3);
});

for (const tier of ['supervisor','finance']) {
  for (const window of ['future','expired']) {
    for (const decision of ['approved','rejected']) {
      test(`${tier} ${decision} rejects ${window} group membership despite another current capable role`, async () => {
        await reset();
        if (tier==='finance') await db.exec("update warehouse.products set unit_cost=10001 where id='bulk'");
        await db.exec("insert into warehouse.stock_levels values('bulk','warehouse-a','bin-a',null,3)");
        const c = await count('bulk',2);
        if (tier==='finance') await decide(c.requests[0].id);
        const decider = tier==='finance' ? financeReviewer : reviewer;
        const role = tier==='finance' ? 'warehouse_finance' : 'warehouse_supervisor';
        const capability = tier==='finance' ? 'approve_stock_adjustment_finance' : 'approve_stock_adjustment';
        await q(`update core.user_roles set
          effective_at=statement_timestamp()+$3::interval,
          expires_at=statement_timestamp()+$4::interval where user_id=$1::uuid and role=$2`,
        [decider,role,window==='future' ? '1 day' : '-2 days',window==='future' ? '2 days' : '-1 day']);
        await q("insert into core.user_roles(user_id,module,role) values($1::uuid,'warehouse','approval_delegate')", [decider]);
        await actor(decider);
        assert.equal((await q("select core.has_live_cap('warehouse',$1) as capable", [capability])).rows[0].capable,true);
        const before = await decisionState(c.requests[0].id);
        await assert.rejects(decide(c.requests[0].id,decision,undefined,decider), /not a member of the configured approval group/);
        assert.deepEqual(await decisionState(c.requests[0].id),before);
      });
    }
  }
}

test('current configured membership with a finite expiry still permits a decision', async () => {
  await reset(); await db.exec("insert into warehouse.stock_levels values('bulk','warehouse-a','bin-a',null,3)");
  const c = await count('bulk',2);
  await q("update core.user_roles set effective_at=statement_timestamp()-interval '1 day',expires_at=statement_timestamp()+interval '1 day' where user_id=$1::uuid", [reviewer]);
  await decide(c.requests[0].id);
  assert.equal((await q('select quantity from warehouse.stock_levels')).rows[0].quantity,2);
});

for (const boundary of ['effective','expiry']) test(`group membership ${boundary} boundary uses the decision statement time`, async () => {
  await reset(); await db.exec("insert into warehouse.stock_levels values('bulk','warehouse-a','bin-a',null,3)");
  const c = await count('bulk',2);
  await q("insert into core.user_roles(user_id,module,role) values($1::uuid,'warehouse','approval_delegate')", [reviewer]);
  await actor(reviewer);
  await q("select set_config('probe.decision', $1, false)", [JSON.stringify({
    idempotency_key:`synthetic-boundary-decision-${++sequence}`,request_id:c.requests[0].id,decision:'approved',note:'Independent review',
  })]);
  const before = await decisionState(c.requests[0].id);
  const sql = `do $$ begin
    update core.user_roles set effective_at=statement_timestamp()${boundary==='expiry' ? "-interval '1 day'" : ''},
      expires_at=statement_timestamp()${boundary==='effective' ? "+interval '1 day'" : ''}
      where user_id=auth.uid() and role='warehouse_supervisor';
    perform warehouse.decide_stock_change(current_setting('probe.decision')::jsonb);
  end $$;`;
  if (boundary==='expiry') {
    await assert.rejects(db.exec(sql), /not a member of the configured approval group/);
    assert.deepEqual(await decisionState(c.requests[0].id),before);
  } else {
    await db.exec(sql);
    assert.equal((await q('select quantity from warehouse.stock_levels')).rows[0].quantity,2);
  }
});

test('migration refuses missing or duplicate membership anchors', async () => {
  const sql = migration('20261105071150_warehouse_count_integrity.sql');
  const start = sql.indexOf("  v_sql:=replace(pg_get_functiondef('private.warehouse_decide_stock_change(jsonb)'::regprocedure)");
  const end = sql.indexOf('\nend $$;',start);
  assert.ok(start>=0 && end>start);
  const patch = 'do $$ declare v_sql text; v_old text; v_new text; v_start integer; v_end integer; begin\n'+sql.slice(start,end)+'\nend $$;';
  const original = definition('20260714175318_single_po_receipt_authority.sql','private.warehouse_decide_stock_change');
  const anchor = '       and membership.role=any(v_group.member_roles)\n       and catalogue_role.is_active';
  const normalized = original.replace(/\r/g,'');
  assert.ok(normalized.includes(anchor));
  for (const replacement of [anchor.replace('membership.role=any','membership.role = any'),`${anchor}\n${anchor}`]) {
    await db.exec('begin');
    try {
      await db.exec(normalized.replace(anchor,replacement));
      await assert.rejects(db.exec(patch), /Stock approval membership anchor changed/);
    } finally {
      await db.exec('rollback');
    }
  }
});

test('requesters and the first reviewer cannot bypass actor separation with current memberships', async () => {
  await reset(); await db.exec("update warehouse.products set unit_cost=10001 where id='bulk'; insert into warehouse.stock_levels values('bulk','warehouse-a','bin-a',null,3)");
  const c = await count('bulk',2);
  await q("insert into core.user_roles(user_id,module,role) values($1::uuid,'warehouse','warehouse_supervisor'),($2::uuid,'warehouse','warehouse_finance')", [counter,reviewer]);
  const initial = await decisionState(c.requests[0].id);
  await assert.rejects(decide(c.requests[0].id,'approved',undefined,counter), /requester cannot approve their own/);
  assert.deepEqual(await decisionState(c.requests[0].id),initial);
  await decide(c.requests[0].id);
  const finance = await decisionState(c.requests[0].id);
  assert.equal(finance.request.status,'pending_finance');
  assert.equal(finance.stock,3);
  await assert.rejects(decide(c.requests[0].id), /Finance must be a distinct actor/);
  assert.deepEqual(await decisionState(c.requests[0].id),finance);
  await decide(c.requests[0].id,'approved',undefined,financeReviewer);
  assert.equal((await q('select quantity from warehouse.stock_levels')).rows[0].quantity,2);
});

test('current group membership does not bypass the configured tier capability or inactive role', async () => {
  await reset(); await db.exec("insert into warehouse.stock_levels values('bulk','warehouse-a','bin-a',null,3)");
  const c = await count('bulk',2);
  await q("insert into core.user_roles(user_id,module,role) values($1::uuid,'warehouse','approval_delegate')", [reviewer]);
  const before = await decisionState(c.requests[0].id);
  await db.exec("update core.roles set is_active=false where role='warehouse_supervisor'");
  await assert.rejects(decide(c.requests[0].id), /not a member of the configured approval group/);
  assert.deepEqual(await decisionState(c.requests[0].id),before);
  await db.exec("update core.roles set is_active=true; update core.approval_groups set capability='approve_stock_adjustment_finance' where group_code='logistics_supervisor'");
  await assert.rejects(decide(c.requests[0].id), /Approval tier and trusted capability are inconsistent/);
  assert.deepEqual(await decisionState(c.requests[0].id),before);
});

test('callers cannot supply an approval tier and inactive groups cannot decide', async () => {
  await reset(); await db.exec("insert into warehouse.stock_levels values('bulk','warehouse-a','bin-a',null,3)");
  const c = await count('bulk',2);
  await actor(reviewer);
  const before = await decisionState(c.requests[0].id);
  for (const field of ['approval_tier','approvalTier']) {
    await assert.rejects(q('select warehouse.decide_stock_change($1::jsonb)',[JSON.stringify({
      idempotency_key:`synthetic-tier-decision-${++sequence}`,request_id:c.requests[0].id,decision:'approved',note:'Independent review',[field]:'finance',
    })]), /approval tier is derived from the governed approval step/);
    assert.deepEqual(await decisionState(c.requests[0].id),before);
  }
  await db.exec("update core.approval_groups set is_active=false where group_code='logistics_supervisor'");
  await assert.rejects(decide(c.requests[0].id), /Approval state and active governed group are inconsistent/);
  assert.deepEqual(await decisionState(c.requests[0].id),before);
});
test('legacy counts without a trustworthy snapshot can be rejected but not posted', async () => {
  await reset(); await db.exec("insert into warehouse.stock_levels values('bulk','warehouse-a','bin-a',null,3)");
  const c = await count('bulk',2); await db.exec('delete from private.warehouse_count_snapshots');
  await assert.rejects(decide(c.requests[0].id), /new count/);
  await decide(c.requests[0].id,'rejected');
});
test('stocked locations cannot be hidden by reclassification or deactivation; renaming is unaffected', async () => {
  await reset(); await db.exec("insert into warehouse.stock_levels values('bulk','warehouse-a','bin-a',null,3)");
  await assert.rejects(db.exec("update warehouse.locations set type='vendor'"), /still holds stock/);
  await assert.rejects(db.exec('update warehouse.locations set active=false'), /still holds stock/);
  await db.exec('update warehouse.stock_levels set quantity=0');
  await db.exec("update warehouse.locations set type='vendor'");
});

test('only a fully rolled-back new count returns a definitive rejection code', async () => {
  await reset();
  await assert.rejects(count('unknown',2),error => error.code==='PWC01' && /Unknown product/.test(error.message));
  assert.equal((await q('select count(*)::int n from warehouse.cycle_counts')).rows[0].n,0);
  assert.equal((await q('select count(*)::int n from warehouse.command_log')).rows[0].n,0);
  await db.exec("insert into warehouse.stock_levels values('bulk','warehouse-a','bin-a',null,3)");
  const saved=await count('bulk',2);
  const changed=structuredClone(saved.payload); changed.cycle_count.lines[0].counted=1;
  await assert.rejects(count('bulk',1,{},changed),error => error.code!=='PWC01' && /different payload/i.test(error.message));
  const replay=await count('bulk',2,{},saved.payload);
  assert.equal(replay.requests[0].id,saved.requests[0].id);
});
