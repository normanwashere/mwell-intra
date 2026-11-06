// Only a newly created loopback database. Never resets an existing database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from 'pg';
import { fork } from 'node:child_process';
import { assertFixtureDatabaseTarget, createPostgresFixtureSessions, createRepresentativeFixturePlan } from './wms-fixture-postgres-adapter.mjs';
import { installAdapterFixture } from './wms-fixture-postgres-adapter.fixture.mjs';
import { readWmsFixtureManifest, recoverWmsFixtureLifecycle, runWmsFixtureLifecycle } from './wms-fixture-lifecycle.mjs';

async function killOwnedWorkerAtCommit(input){
  const child=fork(new URL('./wms-fixture-postgres-adapter.worker.mjs',import.meta.url),[],{stdio:['pipe','ignore','ignore','ipc'],windowsHide:true});
  const exited=new Promise((resolve,reject)=>{child.once('exit',(code,signal)=>resolve({code,signal}));child.once('error',reject);});
  try{
    const boundary=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Native worker did not reach commit boundary')),30000);
      child.on('message',message=>{
        clearTimeout(timer);
        if(message.kind==='kill-point'&&message.pid===child.pid)resolve(message);else reject(Error('Native worker failed'));
      });
      child.once('exit',()=>{clearTimeout(timer);reject(Error('Worker exited before kill point'));});
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.stdin.end(JSON.stringify(input));
    });
    assert.ok(child.kill('SIGKILL'));await exited;
    return boundary;
  }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}}
}

export function validateNativeAdminInput(input){
  assert.deepEqual(Object.keys(input).sort(),['databaseUrl','outputDir']);
  assert.equal(typeof input.outputDir,'string');assert.ok(input.outputDir.length>0);
  const url=new URL(input.databaseUrl);
  assert.ok(['postgres:','postgresql:'].includes(url.protocol));
  assert.ok(['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  assert.equal(url.pathname,'/postgres');assert.equal(url.search,'');assert.equal(url.hash,'');
  assert.equal(decodeURIComponent(url.username),'postgres');
  return url;
}

export async function runNativeFixtureProof(input){
  const adminUrl=validateNativeAdminInput(input);
  const database=`qa_wms_fixture_${randomUUID().replaceAll('-','')}`;
  const ownedUrl=new URL(adminUrl);ownedUrl.pathname=`/${database}`;
  assertFixtureDatabaseTarget(ownedUrl.href,{localDisposable:true});
  const clients=new Set();let created=false;let admin;
  const checks=[];const deaths=[];const observations=[];const sourceCommit='a'.repeat(40);
  const readHealth=async()=>({status:'ok',commit:sourceCommit,deployment:{appEnv:'uat',supabaseProjectRef:'kkoitlvydytdhlpxhuah'}});
  const connect=async url=>{const c=new Client({connectionString:url,connectionTimeoutMillis:8000,statement_timeout:30000,lock_timeout:3000});clients.add(c);await c.connect();return c;};
  const close=async c=>{if(clients.has(c)){await c.end();clients.delete(c);}};
  const makePair=async()=>{
    const writer=await connect(ownedUrl.href);const reader=await connect(ownedUrl.href);
    const a=(await writer.query('select pg_backend_pid() pid')).rows[0].pid;
    const b=(await reader.query('select pg_backend_pid() pid')).rows[0].pid;
    assert.notEqual(a,b);
    return {writer,reader,...createPostgresFixtureSessions({writer,reader,readHealth,onObservation:e=>observations.push(e),bindings:{locationId:'fixture-wh',binId:'fixture-bin'}})};
  };
  try{
    await mkdir(resolve(input.outputDir),{recursive:true});
    admin=await connect(adminUrl.href);
    assert.equal((await admin.query('select session_user')).rows[0].session_user,'postgres');
    assert.equal((await admin.query("select count(*)::int n from pg_roles where rolname in ('anon','authenticated','service_role')")).rows[0].n,3,'use a disposable local Supabase PostgreSQL cluster with its existing standard roles');
    await admin.query(`create database "${database}" template template0`);created=true;
    const setup=await connect(ownedUrl.href);
    await installAdapterFixture({exec:sql=>setup.query(sql)},{roles:false});
    await close(setup);
    const pair=await makePair();
    const options=label=>({plan:createRepresentativeFixturePlan({sourceCommit}),manifestPath:join(resolve(input.outputDir),`${database}-${label}.jsonl`),adapter:pair.adapter,verifier:pair.verifier});

    const normal=options('normal');
    await runWmsFixtureLifecycle(normal,async run=>{
      await run.mutate('seed-one-serial');
      assert.equal((await pair.reader.query('select count(*)::int n from warehouse.active_inventory_units where id=$1',[normal.plan.roots[1].id])).rows[0].n,1);
      const competitor=await makePair();
      try{await assert.rejects(competitor.adapter.acquire({plan:normal.plan,recovery:true}),/another process still owns/);}
      finally{await close(competitor.writer);await close(competitor.reader);}
    });
    assert.equal((await pair.reader.query('select count(*)::int n from warehouse.active_inventory_units where id=$1',[normal.plan.roots[1].id])).rows[0].n,0);
    checks.push('distinct connections, exclusive cross-process lease, active-zero exact archival');

    const interleaved=options('interleaved-a');const other=await makePair();
    const bPlan=createRepresentativeFixturePlan({sourceCommit});
    await runWmsFixtureLifecycle(interleaved,async run=>{
      await run.mutate('seed-one-serial');
      await runWmsFixtureLifecycle({plan:bPlan,manifestPath:join(resolve(input.outputDir),`${database}-interleaved-b.jsonl`),...other},r=>r.mutate('seed-one-serial'));
      await other.writer.query("update procurement.requests set title='Unrelated user work' where id='preserve-pr'");
    });
    for(const plan of [interleaved.plan,bPlan])assert.equal((await pair.reader.query('select count(*)::int n from warehouse.active_inventory_units where id=$1',[plan.roots[1].id])).rows[0].n,0);
    assert.equal((await pair.reader.query("select title from procurement.requests where id='preserve-pr'")).rows[0].title,'Unrelated user work');
    checks.push('separate-session A/B retirement and unrelated between-phase write preserve foreign rows');

    const query=pair.writer.query.bind(pair.writer);let inserts=0;
    pair.writer.query=async(sql,args)=>{
      const result=await query(sql,args);
      if(sql.includes('insert into warehouse.inventory_units')&&++inserts===1)await other.writer.query("update procurement.requests set title='Concurrent committed user change' where id='preserve-pr'");
      return result;
    };
    const retry=options('concurrent-drift');
    try{await runWmsFixtureLifecycle(retry,r=>r.mutate('seed-one-serial'));}finally{pair.writer.query=query;}
    assert.equal(inserts,2);assert.equal((await pair.reader.query('select count(*)::int n from private.wms_fixture_operations where run_id=$1',[retry.plan.runId])).rows[0].n,1);
    assert.equal((await pair.reader.query("select title from procurement.requests where id='preserve-pr'")).rows[0].title,'Concurrent committed user change');
    checks.push('concurrent committed drift rolls back only owned attempt and retries fresh snapshot');
    await close(other.writer);await close(other.reader);

    await pair.reader.query('begin read only');
    try{await assert.rejects(pair.reader.query("insert into warehouse.products(id) values('must-not-write')"),e=>e.code==='25006');}
    finally{await pair.reader.query('rollback');}
    checks.push('native read-only connection rejects writes');

    const closed=options('closed-fence');
    const lease=await pair.adapter.acquire({plan:closed.plan,recovery:false});
    await pair.adapter.drain({plan:closed.plan,fence:lease.fence});
    await assert.rejects(pair.adapter.execute({plan:closed.plan,fence:lease.fence,operation:closed.plan.operations[0],idempotencyKey:`${closed.plan.runId}:mutation:seed-one-serial`}),/closed writer fence/);
    await pair.adapter.release({plan:closed.plan,fence:lease.fence});
    checks.push('drained fence cannot dispatch a new write');

    await pair.writer.query(`create function private.fixture_failure() returns trigger language plpgsql as $$begin raise exception 'injected fixture rollback';end$$;
      create trigger fixture_failure before insert on warehouse.inventory_units for each row execute function private.fixture_failure()`);
    const failed=options('rollback');
    await assert.rejects(runWmsFixtureLifecycle(failed,r=>r.mutate('seed-one-serial')),/injected fixture rollback/);
    assert.equal((await pair.reader.query('select count(*)::int n from warehouse.products where id=$1',[failed.plan.roots[0].id])).rows[0].n,0);
    await pair.writer.query('drop trigger fixture_failure on warehouse.inventory_units;drop function private.fixture_failure()');
    checks.push('failed transaction leaves no partial fixture');

    await pair.writer.query('create schema integration_probe;create table integration_probe.references_to_products(item text references warehouse.products(id))');
    const locked=options('locked-reference-window');const incoming=await connect(ownedUrl.href);
    await incoming.query("set lock_timeout='250ms'");
    const beforeArchive=pair.writer.query.bind(pair.writer);let incomingBlocked=false;
    pair.writer.query=async(sql,args)=>{
      if(sql==='select private.archive_uat_warehouse_fixture($1,$2::jsonb)'){
        await assert.rejects(incoming.query('insert into integration_probe.references_to_products(item) values($1)',[locked.plan.roots[0].id]),error=>error.code==='55P03');
        incomingBlocked=true;
      }
      return beforeArchive(sql,args);
    };
    try{await runWmsFixtureLifecycle(locked,r=>r.mutate('seed-one-serial'));}
    finally{pair.writer.query=beforeArchive;await close(incoming);}
    assert.equal(incomingBlocked,true);
    assert.equal((await pair.reader.query('select count(*)::int n from integration_probe.references_to_products')).rows[0].n,0);
    checks.push('second-session incoming FK insert between closure check and archive is blocked by exact-root locks');

    const referenced=options('foreign-reference');
    await assert.rejects(runWmsFixtureLifecycle(referenced,async r=>{
      await r.mutate('seed-one-serial');
      await pair.reader.query('insert into integration_probe.references_to_products(item) values($1)',[referenced.plan.roots[0].id]);
    }),/foreign dependency in integration_probe.references_to_products/);
    assert.equal((await pair.reader.query('select count(*)::int n from warehouse.active_inventory_units where id=$1',[referenced.plan.roots[1].id])).rows[0].n,1);
    assert.equal((await pair.reader.query('select count(*)::int n from private.uat_warehouse_archive_members where row_id=$1',[referenced.plan.roots[0].id])).rows[0].n,0);
    checks.push('cross-schema foreign FK prevents archival; foreign row and active source retained');

    const crash=options('lost-connection');
    const execute=pair.adapter.execute;
    pair.adapter.execute=async context=>{await execute(context);await close(pair.writer);throw Error('simulated lost committed response and connection');};
    await assert.rejects(runWmsFixtureLifecycle(crash,r=>r.mutate('seed-one-serial')));
    assert.equal((await pair.reader.query('select count(*)::int n from warehouse.active_inventory_units where id=$1',[crash.plan.roots[1].id])).rows[0].n,1);
    const restarted=await makePair();
    for(let attempt=0;attempt<2;attempt++)assert.equal((await recoverWmsFixtureLifecycle({manifestPath:crash.manifestPath,expectedRunId:crash.plan.runId,...restarted})).cleanupVerified,true);
    assert.equal((await restarted.reader.query('select count(*)::int n from private.wms_fixture_operations where run_id=$1',[crash.plan.runId])).rows[0].n,1);
    assert.equal((await restarted.reader.query('select count(*)::int n from warehouse.active_inventory_units where id=$1',[crash.plan.roots[1].id])).rows[0].n,0);
    checks.push('committed lost connection recovered from durable intent once, repeated cleanup idempotent');

    for(const stopAt of ['before-commit','after-commit-before-response']){
      const plan=createRepresentativeFixturePlan({sourceCommit});
      const manifestPath=join(resolve(input.outputDir),`${database}-death-${stopAt}.jsonl`);
      const boundary=await killOwnedWorkerAtCommit({databaseUrl:ownedUrl.href,plan,manifestPath,stopAt});
      const deadline=Date.now()+5000;
      while((await restarted.reader.query('select count(*)::int n from pg_stat_activity where pid=any($1::int[])',[boundary.backendPids])).rows[0].n){
        assert.ok(Date.now()<deadline,'Owned worker sessions did not close');await new Promise(resolve=>setTimeout(resolve,25));
      }
      const journal=readWmsFixtureManifest(manifestPath);
      assert.equal(journal.events.filter(e=>e.type==='intent').length,1);assert.equal(journal.events.filter(e=>e.type==='response').length,0);
      const receipts=(await restarted.reader.query('select count(*)::int n from private.wms_fixture_operations where run_id=$1',[plan.runId])).rows[0].n;
      assert.equal(receipts,stopAt==='before-commit'?0:1);
      await restarted.writer.query('update procurement.requests set title=$1 where id=$2',[`User change after ${stopAt}`,'preserve-pr']);
      for(let attempt=0;attempt<2;attempt++)assert.equal((await recoverWmsFixtureLifecycle({manifestPath,expectedRunId:plan.runId,...restarted})).cleanupVerified,true);
      assert.equal((await restarted.reader.query('select count(*)::int n from warehouse.active_inventory_units where id=$1',[plan.roots[1].id])).rows[0].n,0);
      assert.equal((await restarted.reader.query('select count(*)::int n from private.wms_fixture_operations where run_id=$1',[plan.runId])).rows[0].n,receipts);
      assert.equal((await restarted.reader.query("select title from procurement.requests where id='preserve-pr'")).rows[0].title,`User change after ${stopAt}`);
      deaths.push({stopAt,killedPid:boundary.pid,backendPids:boundary.backendPids,receiptsBeforeRecovery:receipts,residue:0,recoveryAttempts:2});
      checks.push(`actual process SIGKILL ${stopAt}: no response, unrelated user change, fresh recovery without seed replay`);
    }
    return {kind:'native-disposable-postgresql',database,checks,deaths,observations,passed:checks.length,liveCalls:false,
      deliberateDependencyDenial:{runId:referenced.plan.runId,activeUnitsRetained:1,archivedRows:0,scope:'disposable database only, dropped at end'}};
  }finally{
    // Close only owned sessions before dropping only our freshly created DB.
    for(const c of [...clients])if(c!==admin)await close(c);
    try{
      if(created){assertFixtureDatabaseTarget(ownedUrl.href,{localDisposable:true});await admin.query(`drop database "${database}"`);}
    }finally{if(admin)await close(admin);}
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    assert.equal(process.argv.length,2);assert.ok(!process.stdin.isTTY);
    let text='';for await(const chunk of process.stdin){text+=chunk;assert.ok(Buffer.byteLength(text)<=16384);}
    process.stdout.write(`${JSON.stringify(await runNativeFixtureProof(JSON.parse(text)))}\n`);
  }catch{
    process.stderr.write('Disposable PostgreSQL fixture proof failed or unavailable; no native pass claimed.\n');process.exitCode=1;
  }
}
