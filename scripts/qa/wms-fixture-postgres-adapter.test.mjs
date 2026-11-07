import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { createRepresentativeFixturePlan, createPostgresFixtureSessions, assertFixtureDatabaseTarget } from './wms-fixture-postgres-adapter.mjs';
import { runWmsFixtureLifecycle, recoverWmsFixtureLifecycle } from './wms-fixture-lifecycle.mjs';
import { installAdapterFixture } from './wms-fixture-postgres-adapter.fixture.mjs';
import { readFileSync } from 'node:fs';

const commit='a'.repeat(40);
const runId='wms-fixture-11111111-1111-4111-8111-111111111111';
const bindings={locationId:'fixture-wh',binId:'fixture-bin'};
const health=()=>({status:'ok',commit,deployment:{appEnv:'uat',supabaseProjectRef:'kkoitlvydytdhlpxhuah'}});
function sourceTable(file,name){
  const source=readFileSync(new URL(`../../supabase/migrations/${file}.sql`,import.meta.url),'utf8');
  const escaped=name.replaceAll('.','\\.');
  const ddl=source.match(new RegExp(`create table (?:if not exists )?${escaped} \\([\\s\\S]*?\\n\\);`,'i'))?.[0];
  assert.ok(ddl,`actual source table ${name}`);return ddl;
}

// Deliberate corrupt/pre-existing state in disposable PGlite only. Runtime
// source/trigger coverage is restored before the adapter can inspect anything.
async function withoutFixtureGuard(db,table,fn){
  assert.ok(db instanceof PGlite);
  assert.match(table,/^[a-z_]+\.[a-z_]+$/);
  await db.exec(`alter table ${table} disable trigger wms_fixture_registered_write_guard`);
  try{return await fn();}finally{await db.exec(`alter table ${table} enable always trigger wms_fixture_registered_write_guard`);}
}
async function guardAddedTestTables(db){
  assert.ok(db instanceof PGlite);
  for(const {relation} of (await db.query(`select relation::text from private.wms_fixture_guard_targets() t where not exists
    (select 1 from pg_trigger where tgrelid=t.relation and tgname='wms_fixture_registered_write_guard')`)).rows){
    assert.match(relation,/^[a-z_]+\.[a-z_]+$/);
    await db.exec(`create trigger wms_fixture_registered_write_guard before insert or update or delete on ${relation}
      for each row execute function private.wms_fixture_guard_write();alter table ${relation} enable always trigger wms_fixture_registered_write_guard`);
  }
}

async function fixture(fn) {
  const db=new PGlite();const dir=await mkdtemp(join(tmpdir(),'wms-pg-adapter-'));
  try {
    await installAdapterFixture(db);
    const writer={query:(sql,args)=>db.query(sql,args)};
    const reader={query:(sql,args)=>db.query(sql,args)};
    const observations=[];
    const pair=createPostgresFixtureSessions({writer,reader,readHealth:async()=>health(),bindings,onObservation:e=>observations.push(e)});
    const plan=createRepresentativeFixturePlan({runId,sourceCommit:commit});
    const options={manifestPath:join(dir,'run.jsonl'),plan,...pair};
    await fn({db,pair,options,plan,writer,reader,observations});
  }finally{await db.close();await rm(dir,{recursive:true,force:true,maxRetries:8,retryDelay:100});}
}

test('fixed two-row journey archives exact ownership, retains actual unit history and preserves shared data',()=>fixture(async({db,options,plan})=>{
  const originalHistory=(await db.query("select * from private.warehouse_unit_history where unit_id='uat-open-unit-preserved'")).rows;
  assert.equal(originalHistory.length,1);
  const result=await runWmsFixtureLifecycle(options,async run=>{
    await run.mutate('seed-one-serial');
    assert.equal((await db.query('select count(*)::int n from warehouse.active_inventory_units where id=$1',[plan.roots[1].id])).rows[0].n,1);
  });
  assert.equal(result.cleanupVerified,true);
  assert.equal((await db.query('select count(*)::int n from warehouse.active_inventory_units where id=$1',[plan.roots[1].id])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from warehouse.inventory_units where id=$1',[plan.roots[1].id])).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from private.warehouse_unit_history where unit_id=$1',[plan.roots[1].id])).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from private.uat_warehouse_archive_members')).rows[0].n,2);
  assert.equal((await db.query("select count(*)::int n from warehouse.active_inventory_units where id='uat-open-unit-preserved'")).rows[0].n,1);
  assert.deepEqual((await db.query("select * from private.warehouse_unit_history where unit_id='uat-open-unit-preserved'")).rows,originalHistory);
}));

test('lost mutation response reconciles actual operation receipt and cleanup remains idempotent',()=>fixture(async({db,options,pair})=>{
  const execute=pair.adapter.execute;pair.adapter.execute=async c=>{await execute(c);throw Error('lost response');};
  await assert.rejects(runWmsFixtureLifecycle(options,r=>r.mutate('seed-one-serial')),/lost response/);
  for(let i=0;i<2;i++)assert.equal((await recoverWmsFixtureLifecycle({manifestPath:options.manifestPath,expectedRunId:runId,...pair})).cleanupVerified,true);
  assert.equal((await db.query('select count(*)::int n from private.uat_warehouse_archive_batches')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from private.wms_fixture_operations')).rows[0].n,1);
}));

test('actual command transaction failure leaves no partial product/unit/receipt',()=>fixture(async({db,options})=>{
  await db.exec("alter table warehouse.inventory_units add constraint injected_fixture_failure check(id='uat-open-unit-preserved') not valid");
  await assert.rejects(runWmsFixtureLifecycle(options,r=>r.mutate('seed-one-serial')),/injected_fixture_failure/);
  assert.equal((await db.query('select count(*)::int n from private.wms_fixture_operations')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from private.uat_warehouse_archive_members')).rows[0].n,0);
}));

for(const kind of ['foreign-root','master-root','foreign-action'])test(`${kind} cannot dispatch arbitrary fixture SQL`,()=>fixture(async({db,options})=>{
  if(kind==='foreign-action')options.plan.operations[0].action='delete-everything';
  else options.plan.roots[0].id=kind==='master-root'?'master-preserved':'foreign-product';
  await assert.rejects(runWmsFixtureLifecycle(options,r=>r.mutate('seed-one-serial')));
  assert.equal((await db.query('select count(*)::int n from private.wms_fixture_runs')).rows[0].n,0);
}));

test('unrelated user write between seed and cleanup is preserved without blocking retirement',()=>fixture(async({db,options,observations})=>{
  assert.equal((await runWmsFixtureLifecycle(options,async r=>{
    await r.mutate('seed-one-serial');await db.exec("update procurement.requests set title='Concurrent change' where id='preserve-pr'");
  })).cleanupVerified,true);
  assert.equal((await db.query("select title from procurement.requests where id='preserve-pr'")).rows[0].title,'Concurrent change');
  assert.ok(observations.some(e=>e.kind==='unrelated-protected-change'&&e.phase==='readonly-proof'&&e.tables.includes('procurement.requests')));
  assert.ok(!JSON.stringify(observations).includes('Concurrent change'));
}));

test('A can retire after B seeded and retired with immutable B rows retained',()=>fixture(async({db,options,plan,writer,reader})=>{
  const b=createPostgresFixtureSessions({writer,reader,bindings,readHealth:async()=>health()});
  const bPlan=createRepresentativeFixturePlan({sourceCommit:commit});
  assert.equal((await runWmsFixtureLifecycle(options,async a=>{
    await a.mutate('seed-one-serial');
    assert.equal((await runWmsFixtureLifecycle({...options,...b,plan:bPlan,manifestPath:options.manifestPath+'.b'},r=>r.mutate('seed-one-serial'))).cleanupVerified,true);
  })).cleanupVerified,true);
  for(const p of [plan,bPlan]){
    assert.equal((await db.query('select count(*)::int n from warehouse.active_inventory_units where id=$1',[p.roots[1].id])).rows[0].n,0);
    assert.equal((await db.query('select count(*)::int n from warehouse.inventory_units where id=$1',[p.roots[1].id])).rows[0].n,1);
  }
}));

test('fresh recovery preserves unrelated changes made after a failed cleanup attempt',()=>fixture(async({db,options,pair})=>{
  const archive=pair.adapter.archive;pair.adapter.archive=async()=>{throw Error('temporary archive failure');};
  await assert.rejects(runWmsFixtureLifecycle(options,r=>r.mutate('seed-one-serial')),/temporary archive failure/);
  await db.exec("update procurement.requests set title='User work after interruption' where id='preserve-pr'");
  pair.adapter.archive=archive;
  assert.equal((await recoverWmsFixtureLifecycle({manifestPath:options.manifestPath,expectedRunId:runId,...pair})).cleanupVerified,true);
  assert.equal((await db.query("select title from procurement.requests where id='preserve-pr'")).rows[0].title,'User work after interruption');
}));

test('unreviewed trigger side effects are rejected before the seed transaction',()=>fixture(async({db,options})=>{
  await db.exec(`create function private.unexpected_fixture_side_effect() returns trigger language plpgsql as $$begin
    update procurement.requests set title='Unauthorized side effect' where id='preserve-pr';return new;end$$;
    create trigger unexpected_fixture_side_effect after insert on warehouse.inventory_units for each row execute function private.unexpected_fixture_side_effect()`);
  await assert.rejects(runWmsFixtureLifecycle(options,r=>r.mutate('seed-one-serial')),/source contract drift/);
  assert.equal((await db.query("select title from procurement.requests where id='preserve-pr'")).rows[0].title,'Existing audit');
  assert.equal((await db.query('select count(*)::int n from private.wms_fixture_operations')).rows[0].n,0);
}));

test('owned row drift still blocks cleanup despite fresh unrelated snapshots',()=>fixture(async({db,options,plan})=>{
  await assert.rejects(runWmsFixtureLifecycle(options,async r=>{
    await r.mutate('seed-one-serial');await withoutFixtureGuard(db,'warehouse.products',()=>db.query("update warehouse.products set name='Unexpected owned edit' where id=$1",[plan.roots[0].id]));
  }),/owned row changed/);
  assert.equal((await db.query('select count(*)::int n from private.uat_warehouse_archive_members')).rows[0].n,0);
}));

for(const abort of [false,true])test(`transaction drift retry ${abort?'honors a new abort before dispatch':'uses a fresh snapshot without duplicate stock'}`,()=>fixture(async({db,reader,options})=>{
  const controller=new AbortController();let insertAttempts=0;const observations=[];
  const writer={async query(sql,args){
    const result=await db.query(sql,args);
    if(sql.includes('insert into warehouse.inventory_units')&&++insertAttempts===1)await db.query("update procurement.requests set title='Injected protected side effect' where id='preserve-pr'");
    return result;
  }};
  const pair=createPostgresFixtureSessions({writer,reader,bindings,readHealth:async()=>health(),onObservation:event=>{
    observations.push(event);if(abort&&event.kind==='rolled-back-preservation-retry')controller.abort(Error('abort between attempts'));
  }});
  const result=runWmsFixtureLifecycle({...options,...pair,signal:controller.signal},r=>r.mutate('seed-one-serial'));
  if(abort)await assert.rejects(result,/abort/);else assert.equal((await result).cleanupVerified,true);
  assert.equal(insertAttempts,abort?1:2);
  assert.equal((await db.query('select count(*)::int n from private.wms_fixture_operations')).rows[0].n,abort?0:1);
  assert.equal((await db.query("select title from procurement.requests where id='preserve-pr'")).rows[0].title,'Existing audit');
  assert.equal(observations.filter(e=>e.kind==='rolled-back-preservation-retry').length,1);
}));

test('foreign dependency prevents widening cleanup beyond the exact run',()=>fixture(async({db,options,plan})=>{
  await assert.rejects(runWmsFixtureLifecycle(options,async r=>{
    await r.mutate('seed-one-serial');
    await withoutFixtureGuard(db,'warehouse.cycle_counts',()=>db.query("insert into warehouse.cycle_counts(id,lines,status) values('foreign-count',$1,'draft')",[JSON.stringify([{productId:plan.roots[0].id}])]));
  }),/dependency|preservation snapshot/);
  assert.equal((await db.query('select count(*)::int n from private.uat_warehouse_archive_members')).rows[0].n,0);
}));

for(const kind of ['private-po','product-readiness','conversion-fk','conversion-json','custody-serial','origin-state'])test(`foreign ${kind} blocks exact fixture retirement across schema boundaries`,()=>fixture(async({db,options,plan})=>{
  if(kind==='private-po'){
    await db.exec('alter table warehouse.suppliers add primary key(id);alter table warehouse.locations add primary key(id)');
    await db.exec(sourceTable('20261019142956_warehouse_external_po_receiving','private.external_po_orders'));
    await db.exec(sourceTable('20261019142956_warehouse_external_po_receiving','private.external_po_lines'));
    await db.exec("insert into warehouse.suppliers(id,name) values('foreign-supplier','Other user supplier');insert into private.external_po_orders(id,supplier_id,location_id,created_by) values('00000000-0000-4000-8000-000000000002','foreign-supplier','fixture-wh','00000000-0000-4000-8000-000000000001')");
  }else if(kind==='product-readiness'){
    await db.exec('create schema product');await db.exec(sourceTable('20260722121500_product_readiness_and_pricing_governance','product.readiness_packages'));
  }else if(kind==='conversion-fk')await db.exec('alter table private.stock_conversion_recipes add foreign key(source_product_id) references warehouse.products(id)');
  else if(kind==='custody-serial')await db.exec('create table private.event_custody_entries(id uuid primary key,serial_numbers text[] not null)');
  else if(kind==='origin-state')await db.exec(sourceTable('20261105233321_stock_conversion_qc_putaway_bridge','private.stock_conversion_qc_origins'));
  const serial='QA-11111111-1111-4111-8111-111111111111';
  await guardAddedTestTables(db);
  const target={'private-po':'private.external_po_lines','product-readiness':'product.readiness_packages','conversion-fk':'private.stock_conversion_recipes','conversion-json':'private.stock_conversion_batches','custody-serial':'private.event_custody_entries','origin-state':'private.stock_conversion_qc_origins'}[kind];
  await assert.rejects(runWmsFixtureLifecycle(options,async r=>{
    await r.mutate('seed-one-serial');
    await withoutFixtureGuard(db,target,async()=>{
    if(kind==='private-po')await db.query("insert into private.external_po_lines(id,order_id,product_id,quantity,uom) values('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002',$1,1,'piece')",[plan.roots[0].id]);
    else if(kind==='product-readiness')await db.query("insert into product.readiness_packages(product_id,title,version,status,evidence,prepared_by,submitted_by,submitted_at) values($1,'Foreign readiness',1,'submitted','[]','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001',now())",[plan.roots[0].id]);
    else if(kind==='conversion-fk')await db.query('insert into private.stock_conversion_recipes(id,source_product_id) values(gen_random_uuid(),$1)',[plan.roots[0].id]);
    else if(kind==='conversion-json')await db.query('insert into private.stock_conversion_batches(id,units) values(gen_random_uuid(),$1)',[JSON.stringify([{unitId:plan.roots[1].id}])]);
    else if(kind==='custody-serial')await db.query('insert into private.event_custody_entries values(gen_random_uuid(),$1::text[])',[[serial.toLowerCase()]]);
    else await db.query("insert into private.stock_conversion_qc_origins(inspection_id,unit_id,registration_id,unit_state,inspection_state,receipt_state,lot_state,hold_state) values(gen_random_uuid(),'foreign-unit',1,$1,'{}','{}','{}','{}')",[JSON.stringify({serial_number:serial})]);
    });
  }),/foreign dependency/);
  assert.equal((await db.query('select count(*)::int n from private.uat_warehouse_archive_members')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from warehouse.active_inventory_units where id=$1',[plan.roots[1].id])).rows[0].n,1);
}));

test('catalog closure includes a composite FK with unrelated column names in another schema',()=>fixture(async({db,options,plan})=>{
  await db.exec('create schema integration_probe;alter table warehouse.products add unique(id,sku);create table integration_probe.reference_rows(item text,code text,foreign key(item,code) references warehouse.products(id,sku))');
  await guardAddedTestTables(db);
  await assert.rejects(runWmsFixtureLifecycle(options,async r=>{
    await r.mutate('seed-one-serial');await withoutFixtureGuard(db,'integration_probe.reference_rows',()=>db.query('insert into integration_probe.reference_rows select id,sku from warehouse.products where id=$1',[plan.roots[0].id]));
  }),/foreign dependency in integration_probe.reference_rows/);
  assert.equal((await db.query('select count(*)::int n from private.uat_warehouse_archive_members')).rows[0].n,0);
}));

test('foreign history with matching serial is not exempted as owned history',()=>fixture(async({db,options,plan})=>{
  await assert.rejects(runWmsFixtureLifecycle(options,async r=>{
    await r.mutate('seed-one-serial');
    await withoutFixtureGuard(db,'private.warehouse_unit_history',()=>db.query("insert into private.warehouse_unit_history(unit_id,product_id,serial_number,operation,after_state) select 'other-unit','master-preserved',serial_number,'registered','{}' from warehouse.inventory_units where id=$1",[plan.roots[1].id]));
  }),/foreign dependency in private.warehouse_unit_history/);
  assert.equal((await db.query('select count(*)::int n from private.uat_warehouse_archive_members')).rows[0].n,0);
}));

test('unrelated cross-schema rows and text mentions do not become fixture ownership',()=>fixture(async({db,options,plan})=>{
  await db.exec('create schema integration_probe;create table integration_probe.reference_rows(item text references warehouse.products(id),note text)');
  await guardAddedTestTables(db);
  assert.equal((await runWmsFixtureLifecycle(options,async r=>{
    await r.mutate('seed-one-serial');await db.query("insert into integration_probe.reference_rows values('master-preserved',$1)",[`Report about ${plan.roots[0].id}`]);
  })).cleanupVerified,true);
  assert.equal((await db.query('select count(*)::int n from integration_probe.reference_rows')).rows[0].n,1);
}));

test('strict logical JSON shapes distinguish unrelated scalar/object/array values from an exact serial',()=>fixture(async({db,options,pair})=>{
  await db.exec('create table private.event_custody_entries(id text primary key,serial_numbers jsonb)');
  await guardAddedTestTables(db);
  for(const [index,value] of [null,42,false,'OTHER-SERIAL',{note:'OTHER-SERIAL'},['OTHER-SERIAL',null,12]].entries())await db.query('insert into private.event_custody_entries values($1,$2)',[String(index),JSON.stringify(value)]);
  const archive=pair.adapter.archive;
  pair.adapter.archive=async context=>{
    await withoutFixtureGuard(db,'private.event_custody_entries',()=>db.query("insert into private.event_custody_entries values('exact',$1)",[JSON.stringify([null,42,{note:'unrelated'},' qa-11111111-1111-4111-8111-111111111111 '])]));
    return archive(context);
  };
  await assert.rejects(runWmsFixtureLifecycle(options,r=>r.mutate('seed-one-serial')),/foreign dependency in private.event_custody_entries/);
  assert.equal((await db.query('select count(*)::int n from private.wms_fixture_operations')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from private.uat_warehouse_archive_members')).rows[0].n,0);
}));

test('fresh transaction preservation includes private external-PO reference surfaces',()=>fixture(async({db,options,reader})=>{
  await db.exec(`create table private.external_po_probe(id text primary key,amount int);
    insert into private.external_po_probe values('foreign',10)`);
  await guardAddedTestTables(db);
  const writer={async query(sql,args){
    const result=await db.query(sql,args);
    if(sql.includes('insert into warehouse.inventory_units'))await db.query("update private.external_po_probe set amount=999 where id='foreign'");
    return result;
  }};
  const pair=createPostgresFixtureSessions({writer,reader,readHealth:async()=>health(),bindings});
  await assert.rejects(runWmsFixtureLifecycle({...options,...pair},r=>r.mutate('seed-one-serial')),/preservation/);
  assert.equal((await db.query("select amount from private.external_po_probe where id='foreign'")).rows[0].amount,10);
  assert.equal((await db.query('select count(*)::int n from private.wms_fixture_operations')).rows[0].n,0);
}));

test('private run/receipt/ownership ledgers deny clients and remain immutable',()=>fixture(async({db,options})=>{
  await runWmsFixtureLifecycle(options,r=>r.mutate('seed-one-serial'));
  for(const table of ['wms_fixture_runs','wms_fixture_operations','wms_fixture_owned_rows']){
    await assert.rejects(db.exec(`update private.${table} set run_id=run_id`),/immutable/);
    await assert.rejects(db.exec(`delete from private.${table}`),/immutable/);
    await assert.rejects(db.exec(`truncate private.${table} cascade`),/immutable/);
    for(const role of ['anon','authenticated','service_role']){
      await db.exec(`begin;set local role ${role}`);
      try{await assert.rejects(db.exec(`select * from private.${table}`),/permission denied/);}finally{await db.exec('rollback');}
    }
  }
}));

test('lost archive response recovers the same exact batch without duplicate ownership',()=>fixture(async({db,options,pair})=>{
  const archive=pair.adapter.archive;
  pair.adapter.archive=async context=>{await archive(context);throw Error('archive response lost');};
  await assert.rejects(runWmsFixtureLifecycle(options,r=>r.mutate('seed-one-serial')),/archive response lost/);
  pair.adapter.archive=archive;
  assert.equal((await recoverWmsFixtureLifecycle({manifestPath:options.manifestPath,expectedRunId:runId,...pair})).cleanupVerified,true);
  assert.equal((await db.query('select count(*)::int n from private.uat_warehouse_archive_batches')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from private.uat_warehouse_archive_members')).rows[0].n,2);
}));

test('abort after a real committed write still drains and archives exact ownership',()=>fixture(async({db,options})=>{
  const controller=new AbortController();options.signal=controller.signal;
  await assert.rejects(runWmsFixtureLifecycle(options,async r=>{await r.mutate('seed-one-serial');controller.abort(Error('abort fixture'));}),/abort fixture/);
  assert.equal((await db.query('select count(*)::int n from private.uat_warehouse_archive_members')).rows[0].n,2);
  assert.equal((await db.query("select state from private.wms_fixture_leases")).rows[0].state,'drained');
}));

test('drained and stale fences cannot start another mutation',()=>fixture(async({db,pair,plan})=>{
  const {fence}=await pair.adapter.acquire({plan,recovery:false});
  const command={plan,fence,operation:plan.operations[0],idempotencyKey:`${runId}:mutation:seed-one-serial`};
  await assert.rejects(pair.adapter.execute({...command,fence:'foreign-fence'}),/does not own/);
  await pair.adapter.drain({plan,fence});
  await assert.rejects(pair.adapter.execute(command),/closed writer fence/);
  await pair.adapter.release({plan,fence});
  assert.equal((await db.query('select count(*)::int n from private.wms_fixture_operations')).rows[0].n,0);
}));

test('wrong runtime SHA, environment and project all stop before durable DB ownership',()=>fixture(async({db,writer,reader,plan,options})=>{
  for(const h of [{...health(),commit:'b'.repeat(40)},{...health(),deployment:{...health().deployment,appEnv:'production'}},{...health(),deployment:{...health().deployment,supabaseProjectRef:'foreign'}}]){
    const pair=createPostgresFixtureSessions({writer,reader,bindings,readHealth:async()=>h});
    await assert.rejects(pair.adapter.acquire({plan,recovery:false}),/runtime SHA/);
  }
  assert.equal((await db.query('select count(*)::int n from private.wms_fixture_runs')).rows[0].n,0);
}));

test('source-body drift stops before any fixture write',()=>fixture(async({db,options})=>{
  await db.exec("create or replace function private.warehouse_record_unit_history() returns trigger language plpgsql as $$begin return new;end$$");
  await assert.rejects(runWmsFixtureLifecycle(options,r=>r.mutate('seed-one-serial')),/source contract drift/);
  assert.equal((await db.query('select count(*)::int n from private.wms_fixture_runs')).rows[0].n,0);
}));

test('foreign SKU collision cannot be treated as synthetic owned stock',()=>fixture(async({db,options})=>{
  await withoutFixtureGuard(db,'warehouse.products',()=>db.exec("insert into warehouse.products(id,sku,name) values('foreign-product','QA-11111111-1111-4111-8111-111111111111','Foreign')"));
  await assert.rejects(runWmsFixtureLifecycle(options,r=>r.mutate('seed-one-serial')),/foreign SKU/);
  assert.equal((await db.query('select count(*)::int n from private.wms_fixture_runs')).rows[0].n,0);
}));

test('all private ledgers are forced-RLS and revoke every client mutation privilege',()=>fixture(async({db})=>{
  for(const table of ['wms_fixture_runs','wms_fixture_operations','wms_fixture_owned_rows','wms_fixture_leases']){
    const row=(await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid=to_regclass($1)",[`private.${table}`])).rows[0];
    assert.deepEqual(row,{relrowsecurity:true,relforcerowsecurity:true});
    for(const role of ['anon','authenticated','service_role'])for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']){
      assert.equal((await db.query('select has_table_privilege($1,$2,$3) allowed',[role,`private.${table}`,privilege])).rows[0].allowed,false);
    }
  }
}));

test('target validation has no production or pooler transaction-mode bypass',()=>{
  assertFixtureDatabaseTarget('postgresql://postgres:secret@db.kkoitlvydytdhlpxhuah.supabase.co:5432/postgres');
  for(const url of ['postgresql://postgres@db.other.supabase.co/postgres','postgresql://postgres.kkoitlvydytdhlpxhuah@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres','postgresql://postgres@localhost:5432/postgres'])assert.throws(()=>assertFixtureDatabaseTarget(url));
});
