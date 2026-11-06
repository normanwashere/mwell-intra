// Native proof child only. Parent supplies local disposable target via stdin.
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { assertFixtureDatabaseTarget, createPostgresFixtureSessions } from './wms-fixture-postgres-adapter.mjs';
import { runWmsFixtureLifecycle } from './wms-fixture-lifecycle.mjs';

let writer,reader;
try{
  assert.equal(typeof process.send,'function');
  let text='';for await(const chunk of process.stdin){text+=chunk;assert.ok(Buffer.byteLength(text)<=16384);}
  const {databaseUrl,plan,manifestPath,stopAt}=JSON.parse(text);
  assertFixtureDatabaseTarget(databaseUrl,{localDisposable:true});
  assert.ok(['before-commit','after-commit-before-response'].includes(stopAt));
  writer=new Client({connectionString:databaseUrl,statement_timeout:30000});
  reader=new Client({connectionString:databaseUrl,statement_timeout:30000});
  await writer.connect();await reader.connect();
  const backendPids=[(await writer.query('select pg_backend_pid() pid')).rows[0].pid,(await reader.query('select pg_backend_pid() pid')).rows[0].pid];
  const query=writer.query.bind(writer);let executing=false;
  writer.query=async(sql,args)=>{
    if(executing&&sql==='commit'){
      if(stopAt==='after-commit-before-response')await query(sql,args);
      process.send({kind:'kill-point',stopAt,pid:process.pid,backendPids});
      // Deliberately never return the COMMIT outcome to the lifecycle. Parent
      // kills this owned process; no graceful close/finally runs on that path.
      return new Promise(()=>{});
    }
    return query(sql,args);
  };
  const pair=createPostgresFixtureSessions({writer,reader,bindings:{locationId:'fixture-wh',binId:'fixture-bin'},
    readHealth:async()=>({status:'ok',commit:plan.sourceCommit,deployment:{appEnv:'uat',supabaseProjectRef:plan.projectRef}})});
  const execute=pair.adapter.execute;
  pair.adapter.execute=async context=>{executing=true;try{return await execute(context);}finally{executing=false;}};
  await runWmsFixtureLifecycle({manifestPath,plan,...pair},r=>r.mutate('seed-one-serial'));
  throw Error('Expected a process-death boundary');
}catch{
  process.send?.({kind:'worker-failure'});process.exitCode=1;
}finally{
  await Promise.allSettled([writer?.end(),reader?.end()]);process.disconnect?.();
}
