import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read=name=>readFileSync(new URL(`../supabase/migrations/${name}.sql`,import.meta.url),'utf8').replaceAll('\r','');
const candidate=read('20261106152118_insights_active_cycle_count_variances');
const baseline=JSON.parse(readFileSync(new URL('./fixtures/uat-archive-read-baseline.json',import.meta.url),'utf8'));
const signatures=['core.insights_snapshot_pre_task1()','core.insights_snapshot_pre_leadership_launch()','core.insights_snapshot()'];
// Independently read from UAT pg_proc on 2026-11-06. The fixture reconstructs
// these source bodies rather than accepting its own observed fingerprints.
const bodyHashes=['fa11cc6b30b98b799032c773cbe4c7eb','482536a5098a69a7b3dc68192f055c4e','f40d7ede7ef5f322aa0cbb30239065dc'];
const db=new PGlite();
let originalDefinitions;
async function isolated(fn) { await db.exec('begin');try {await fn();}finally{await db.exec('rollback');} }
async function metrics() { return (await db.query('select * from core.v_insights_snapshot order by id')).rows; }
async function snapshot() {
  return (await db.query(`select jsonb_agg(to_jsonb(c) order by id) rows from warehouse.cycle_counts c`)).rows[0].rows;
}
async function seed({live=true,archive=true}={}) {
  await db.exec(`insert into warehouse.products(id,sku,name,serialized,attributes) values('sample','SYN','Synthetic',false,'{"synthetic":true}');
    insert into warehouse.cycle_counts(id,status,created_at,submitted_at,lines) values('sample-count','rejected',now(),now(),'[{"productId":"sample"}]');
    insert into warehouse.allocations(id,quantity,status,created_at) values('allocation',2,'issued',now());
    insert into procurement.requests(id,status,created_at,updated_at,submitted_at) values('approved','approved',now()-interval '4 days',now(),now()-interval '3 days'),('waiting','submitted',now(),now(),now());
    insert into procurement.purchase_orders(id,request_id,issued_at,updated_at) values('po','approved',now()-interval '1 day',now());
    insert into procurement.payment_readiness_packs(status,prepared_at) values('ready_for_finance',now());
    insert into legal.accreditation_cases(id,submitted_at,decided_at) values('legal',now()-interval '1 day',now());
    insert into core.policy_remediation_queue(id,status,created_at) values('exception','open',now());`);
  if(live) await db.exec(`insert into warehouse.cycle_counts(id,status,created_at,submitted_at,lines) values
    ('real-count','pending_approval',now()-interval '2 hours',now()-interval '2 hours','[]'),
    ('decided-count','approved',now()-interval '3 hours',now()-interval '3 hours','[]'),
    ('old-count','submitted',now()-interval '100 days',now()-interval '100 days','[]');`);
  if(archive) {
    const rows=[];
    for(const [table,id] of [['products','sample'],['cycle_counts','sample-count']]) rows.push({table,row_id:id,
      row_md5:(await db.query(`select md5(to_jsonb(t)::text) h from warehouse.${table} t where id=$1`,[id])).rows[0].h,
      provenance:'Exact disposable synthetic fixture for Insights variance regression'});
    await db.query('select private.archive_uat_warehouse_fixture($1,$2::jsonb)',['uat-insights-variance-001',rows]);
  }
}

before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema core;create schema warehouse;create schema procurement;create schema legal;create schema private;
    create function core.has_cap(text,text) returns boolean language sql stable as $$
      select coalesce(current_setting('test.caps',true)='all' or $2=any(string_to_array(current_setting('test.caps',true),',')),false) $$;
    grant usage on schema core to anon,authenticated,service_role;
    select set_config('test.caps','all',false);`);
  for(const entry of baseline.ddl) await db.exec(entry.ddl);
  await db.exec(`create table procurement.purchase_orders(id text,request_id text,issued_at timestamptz,updated_at timestamptz);
    create table core.policy_remediation_queue(id text,status text,created_at timestamptz,resolved_at timestamptz);`);
  await db.exec(read('20260722124731_insights_correctness_and_provenance'));
  await db.exec(read('20260723010000_insights_projection_read_only'));
  await db.exec(read('20260723031500_insights_warehouse_source_route'));
  const task=read('20260813203240_task_1_database_authority_remediation');
  const end='grant select on core.v_insights_snapshot to authenticated,service_role;';
  await db.exec(task.slice(task.indexOf('drop view if exists core.v_insights_snapshot;'),task.indexOf(end)+end.length));
  const launch=read('20260815183000_leadership_insights_launch_blockers');
  await db.exec(launch.slice(0,launch.indexOf('-- Export creation is a certified command.')));
  await db.exec('begin');await db.exec(read('20261106145742_uat_warehouse_fixture_archive'));await db.exec('commit');
  originalDefinitions=[];
  for(let i=0;i<signatures.length;i++) {
    const row=(await db.query("select md5(replace(prosrc,chr(13),'')) hash,pg_get_functiondef(oid) definition from pg_proc where oid=$1::regprocedure",[signatures[i]])).rows[0];
    assert.equal(row.hash,bodyHashes[i],signatures[i]);originalDefinitions.push(row.definition);
  }
});
after(async()=>db.close());

test('actual predecessor chain exposes the archived variance while active view excludes it',()=>isolated(async()=>{
  await seed();
  const variance=(await metrics()).find(r=>r.id==='wh-variance');
  assert.equal(Number(variance.value),2);assert.equal(Number(variance.sample_count),3);
  assert.equal((await db.query("select count(*)::int n from warehouse.active_cycle_counts where id='sample-count'")).rows[0].n,0);
}));

test('forward patch excludes archived counts through actual public and retained wrappers',()=>isolated(async()=>{
  await seed();const rows=await snapshot();await db.exec(candidate);
  for(const signature of signatures) {
    const value=(await db.query(`select * from ${signature} where id='wh-variance'`)).rows[0];
    assert.equal(Number(value.value),1,signature);assert.equal(Number(value.sample_count),2,signature);
  }
  await db.exec('set local role authenticated');
  assert.equal(Number((await metrics()).find(r=>r.id==='wh-variance').value),1);
  await db.exec('reset role');assert.deepEqual(await snapshot(),rows);
}));

test('other metrics and provenance stay byte-equivalent within one transaction',()=>isolated(async()=>{
  await seed();const before=await metrics();await db.exec(candidate);const after=await metrics();
  assert.deepEqual(after.filter(r=>r.id!=='wh-variance'),before.filter(r=>r.id!=='wh-variance'));
  const a=before.find(r=>r.id==='wh-variance'),b=after.find(r=>r.id==='wh-variance');
  for(const field of ['label','unit','target_direction','target_min','target_max','detail','source_href','reporting_period_start','reporting_period_end']) assert.deepEqual(b[field],a[field]);
  assert.notEqual(String(b.source_updated_at),String(a.source_updated_at));
}));

test('archive-only dataset becomes no_data without deleting original count or changing outcome',()=>isolated(async()=>{
  await seed({live:false});await db.exec(candidate);
  const variance=(await metrics()).find(r=>r.id==='wh-variance');
  assert.equal(variance.value,null);assert.equal(Number(variance.sample_count),0);assert.equal(variance.data_status,'no_data');
  assert.equal((await snapshot())[0].status,'rejected');
}));

test('unarchived counts and all other metric results remain identical',()=>isolated(async()=>{
  await seed({archive:false});const before=await metrics();await db.exec(candidate);assert.deepEqual(await metrics(),before);
}));

test('function identity, ABI, owner, grants, search path, volatility and wrapper bodies stay unchanged',()=>isolated(async()=>{
  const catalog=async()=> (await db.query("select to_jsonb(p)-'prosrc' as metadata from pg_proc p where oid=any($1::regprocedure[]) order by oid",[signatures])).rows;
  const before=await catalog();await db.exec(candidate);assert.deepEqual(await catalog(),before);
  for(let i=0;i<signatures.length;i++) {
    const definition=(await db.query('select pg_get_functiondef($1::regprocedure) definition',[signatures[i]])).rows[0].definition;
    assert.equal(definition,i===0?originalDefinitions[i].replace('from warehouse.cycle_counts c','from warehouse.active_cycle_counts c'):originalDefinitions[i]);
  }
}));

for(const caps of ['', 'view_procurement', 'view_warehouse']) test(`existing capability filtering remains exact: ${caps||'none'}`,()=>isolated(async()=>{
  await seed();await db.exec(candidate);await db.query("select set_config('test.caps',$1,true)",[caps]);
  await db.exec('set local role authenticated');
  const rows=await metrics();
  assert.deepEqual(rows.map(r=>r.id),caps==='view_warehouse'?['wh-fill','wh-variance']:caps==='view_procurement'?['pr-approval','pr-cycle']:[]);
  await db.exec('reset role');
}));

test('anon execution and client retained-helper access remain denied',()=>isolated(async()=>{
  await db.exec(candidate);
  for(const [role,signature] of [['anon',signatures[2]],['authenticated',signatures[0]],['authenticated',signatures[1]]]) {
    assert.equal((await db.query("select has_function_privilege($1,$2,'execute') allowed",[role,signature])).rows[0].allowed,false);
    await db.exec(`savepoint deny;set local role ${role}`);
    try{await assert.rejects(db.query(`select * from ${signature}`),e=>e.code==='42501');}
    finally{await db.exec('rollback to savepoint deny');}
  }
}));

for(const signature of signatures) test(`unexpected actual-chain body drift aborts atomically: ${signature}`,()=>isolated(async()=>{
  const definition=originalDefinitions[signatures.indexOf(signature)];
  await db.exec(definition.replace('AS $function$','AS $function$\n-- independent drift\n'));
  const before=(await db.query('select oid,prosrc from pg_proc where oid=any($1::regprocedure[]) order by oid',[signatures])).rows;
  await db.exec('savepoint patch');
  try{await assert.rejects(db.exec(candidate),/Insights active variance predecessor drift/);}finally{await db.exec('rollback to savepoint patch');}
  assert.deepEqual((await db.query('select oid,prosrc from pg_proc where oid=any($1::regprocedure[]) order by oid',[signatures])).rows,before);
}));

test('missing active view and unexpected reapply fail closed',()=>isolated(async()=>{
  await db.exec('savepoint missing;drop view warehouse.active_cycle_counts');
  try{await assert.rejects(db.exec(candidate),/active cycle-count view/);}finally{await db.exec('rollback to savepoint missing');}
  await db.exec(candidate);await db.exec('savepoint repeated');
  try{await assert.rejects(db.exec(candidate),/predecessor drift/);}finally{await db.exec('rollback to savepoint repeated');}
}));
