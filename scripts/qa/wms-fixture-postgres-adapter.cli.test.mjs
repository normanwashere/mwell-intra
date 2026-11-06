import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRunnerInput, runFixtureCommand } from './wms-fixture-postgres-adapter.cli.mjs';
import { validateNativeAdminInput } from './wms-fixture-postgres-adapter.native.mjs';
import { connectPostgresFixtureAdapter } from './wms-fixture-postgres-adapter.mjs';

const config={databaseUrl:'postgresql://postgres:never-log@db.kkoitlvydytdhlpxhuah.supabase.co/postgres',sourceCommit:'a'.repeat(40),runId:'wms-fixture-11111111-1111-4111-8111-111111111111',manifestPath:'owned-run.jsonl',locationId:'wh',binId:'bin'};
test('runner accepts only the fixed command and exact stdin contract',()=>{
  assert.deepEqual(parseRunnerInput('run',JSON.stringify(config)),config);
  for(const changed of [{...config,sql:'delete from warehouse.products'},{...config,localDisposable:true},{...config,sourceCommit:'main'},{...config,binId:''}])assert.throws(()=>parseRunnerInput('run',JSON.stringify(changed)));
  assert.throws(()=>parseRunnerInput('seed',JSON.stringify(config)));
  assert.throws(()=>parseRunnerInput('run',JSON.stringify({...config,databaseUrl:'postgres://postgres@localhost/postgres'})));
});
test('live run and recovery remain paused before credentials, connection or journal access',async()=>{
  let calls=0;const connector=async()=>{calls++;throw Error('must not connect');};
  for(const command of ['run','recover'])await assert.rejects(runFixtureCommand(command,config,{connector}),e=>e.code==='WMS_LIVE_FIXTURES_PAUSED');
  assert.equal(calls,0);
  await assert.rejects(connectPostgresFixtureAdapter({databaseUrl:config.databaseUrl,bindings:{locationId:'wh',binId:'bin'}}),e=>e.code==='WMS_LIVE_FIXTURES_PAUSED');
});
test('prepare is offline and never echoes connection input',async()=>{
  const prepared=await runFixtureCommand('prepare',{sourceCommit:config.sourceCommit,runId:config.runId},{connector:async()=>{throw Error('must not connect');}});
  assert.equal(prepared.plan.runId,config.runId);
  assert.ok(!JSON.stringify(prepared).includes('never-log'));
  assert.throws(()=>parseRunnerInput('prepare',JSON.stringify(config)));
});
test('native proof refuses any remote or preexisting fixture database target',()=>{
  validateNativeAdminInput({databaseUrl:'postgres://postgres@127.0.0.1:54322/postgres',outputDir:'owned-output'});
  for(const databaseUrl of [config.databaseUrl,'postgres://postgres@localhost/existing','postgres://postgres@localhost/postgres?options=-csearch_path=public','postgres://other@localhost/postgres'])assert.throws(()=>validateNativeAdminInput({databaseUrl,outputDir:'owned-output'}));
});
