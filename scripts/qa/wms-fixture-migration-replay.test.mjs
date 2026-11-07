import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,cpSync,mkdirSync,readFileSync,writeFileSync,rmSync,readdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectReplay,prepareReplay,runSupabaseReplay,safeEnvironment,checkMigrationList,summarizeReplayFailure} from './wms-fixture-migration-replay.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const ledger='20261106173133_wms_fixture_postgres_lifecycle.sql';

test('failure diagnostics expose only known migration names, error codes and fixed categories',()=>{
  const log=`Applying migration ${ledger}...\nERROR: relation "private.example" does not exist (SQLSTATE 42P01)\nDETAIL: password=never-publish postgres://user:password@private.invalid/database\nSELECT 'private customer row';`;
  assert.deepEqual(summarizeReplayFailure(log,[ledger]),{category:'database-error',sqlstates:['42P01'],lastMigration:ledger});
  assert.deepEqual(summarizeReplayFailure('Applying migration 20990101000000_untrusted.sql...\nconnection refused\nsecret=never-publish',[ledger]),{category:'connection-error',sqlstates:[],lastMigration:null});
  assert.deepEqual(summarizeReplayFailure('Docker daemon is not running'),{category:'docker-unavailable',sqlstates:[],lastMigration:null});
  assert.deepEqual(summarizeReplayFailure('pull access denied for a private image'),{category:'image-pull-error',sqlstates:[],lastMigration:null});
  assert.deepEqual(summarizeReplayFailure('unrecognized failure with private values'),{category:'unclassified-startup-error',sqlstates:[],lastMigration:null});
});
function sandbox(){const home=mkdtempSync(path.join(tmpdir(),'wms-replay-test-'));return{home,close(){assert(path.basename(home).startsWith('wms-replay-test-'));rmSync(home,{recursive:true,force:true});}};}
function copySource(home){const copy=path.join(home,'source');mkdirSync(copy);for(const n of ['supabase/config.toml','supabase/migrations','scripts/qa/canonical-replay-manifest.json','scripts/qa/fixtures/canonical-uat-baseline'])cpSync(path.join(root,n),path.join(copy,n),{recursive:true});return copy;}

test('canonical contract keeps 22 real baselines and 35 hash-bound historical exclusions; all new SQL executes',()=>{
  const inventory=inspectReplay(root,{requiredFiles:[ledger]});
  assert.equal(inventory.baselineCount,22);assert.equal(inventory.preservedCount,35);
  const actual=readdirSync(path.join(root,'supabase/migrations')).filter(n=>n.endsWith('.sql')).sort();
  assert.deepEqual(inventory.files.filter(f=>f.kind==='source').map(f=>f.file),actual);
  assert(inventory.files.find(f=>f.file===ledger)?.output);
  const known=JSON.parse(readFileSync(path.join(root,'scripts/qa/canonical-replay-manifest.json'))).sources.map(f=>f.file);
  assert.deepEqual(inventory.files.filter(f=>f.classification==='candidate-forward').map(f=>f.file),actual.filter(n=>!known.includes(n)));
  assert.match(inventory.scope,/not exact applied-history/);
});
test('reviewed digest is LF-stable across checkout platforms while raw hashes retain exact execution bytes',()=>{
  const s=sandbox();try{const copy=copySource(s.home),before=inspectReplay(copy);
    for(const f of before.files)writeFileSync(path.join(copy,f.relative),readFileSync(path.join(copy,f.relative),'utf8').replace(/\r\n?/g,'\n').replace(/\n/g,'\r\n'));
    const config=path.join(copy,'supabase/config.toml');writeFileSync(config,readFileSync(config,'utf8').replace(/\r\n?/g,'\n').replace(/\n/g,'\r\n'));
    const crlf=inspectReplay(copy);
    for(const f of before.files)writeFileSync(path.join(copy,f.relative),readFileSync(path.join(copy,f.relative),'utf8').replace(/\r\n?/g,'\n'));
    writeFileSync(config,readFileSync(config,'utf8').replace(/\r\n?/g,'\n'));
    const lf=inspectReplay(copy);
    assert.equal(lf.digest,crlf.digest);assert.notEqual(lf.rawDigest,crlf.rawDigest);
  }finally{s.close();}
});
test('changed known baseline/forward/excluded SQL, missing file and backdated unknown are rejected',()=>{
  const s=sandbox();try{const copy=copySource(s.home),inventory=inspectReplay(copy);
    for(const f of [inventory.files.find(x=>x.kind==='baseline'),inventory.files.find(x=>x.classification==='canonical-forward'),inventory.files.find(x=>!x.output)]){
      const p=path.join(copy,f.relative),bytes=readFileSync(p);writeFileSync(p,Buffer.concat([bytes,Buffer.from('\n-- drift')]));assert.throws(()=>inspectReplay(copy),/checksum drift/);writeFileSync(p,bytes);
    }
    writeFileSync(path.join(copy,'supabase/migrations/20200101000000_unknown.sql'),'select 1;');assert.throws(()=>inspectReplay(copy),/backdated/);
  }finally{s.close();}
});
test('required fence, duplicate version, symlink input and source drift after inspection fail closed',()=>{
  const s=sandbox();try{const copy=copySource(s.home);
    assert.throws(()=>inspectReplay(copy,{requiredFiles:['20990101000000_missing_fence.sql']}),/Required migration missing/);
    const p=path.join(copy,'supabase/migrations/20261106173133_duplicate.sql');writeFileSync(p,'select 1;');assert.throws(()=>inspectReplay(copy),/Duplicate migration version/);rmSync(p);
    const outside=path.join(s.home,'external');mkdirSync(outside);const original=path.join(copy,'scripts/qa/fixtures/canonical-uat-baseline');cpSync(original,outside,{recursive:true});rmSync(original,{recursive:true});symlinkSync(outside,original,'junction');assert.throws(()=>inspectReplay(copy),/Symlink/);
  }finally{s.close();}
});
test('prepare binds reviewed candidate digest, writes exact bytes, isolates config and refuses overwrite',()=>{
  const s=sandbox();try{const i=inspectReplay(root),workspace=path.join(s.home,'database');
    assert.throws(()=>prepareReplay({root,parent:s.home,workspace,expectedDigest:'0'.repeat(64)}),/inventory digest/);
    const result=prepareReplay({root,parent:s.home,workspace,expectedDigest:i.digest});
    for(const f of i.files.filter(f=>f.output))assert.deepEqual(readFileSync(path.join(workspace,'supabase/migrations',f.output)),readFileSync(path.join(root,f.relative)));
    assert.match(readFileSync(path.join(workspace,'supabase/config.toml'),'utf8'),/project_id = "wms-replay-[a-f0-9]+"/);
    assert(!readdirSync(workspace).includes('.env'));assert.equal(result.inventory.digest,i.digest);
    assert.throws(()=>prepareReplay({root,parent:s.home,workspace,expectedDigest:i.digest}),/already exists/);
    assert.throws(()=>prepareReplay({root,parent:s.home,workspace:root,expectedDigest:i.digest}),/direct child/);
  }finally{s.close();}
});
test('runtime environment has no inherited tokens, database targets or real home',()=>{
  const env=safeEnvironment('/owned/home',{PATH:'/bin',SYSTEMROOT:'C:/Windows',SUPABASE_ACCESS_TOKEN:'secret',DATABASE_URL:'remote',PGHOST:'remote',HOME:'/real',USERPROFILE:'/real'});
  assert.equal(env.HOME,'/owned/home');assert.equal(env.USERPROFILE,'/owned/home');assert.equal(env.PATH,'/bin');
  for(const k of ['SUPABASE_ACCESS_TOKEN','DATABASE_URL','PGHOST'])assert(!Object.hasOwn(env,k));
});
test('post-schema proof requires the real count-epoch trigger and exact fourth ownership source',()=>{
  const sql=readFileSync(new URL('./wms-fixture-migration-replay.assert.sql',import.meta.url),'utf8');
  assert.match(sql,/tgname='warehouse_count_epoch'/);
  assert.match(sql,/tgfoid='private\.warehouse_advance_stock_epoch\(\)'::regprocedure/);
  assert.match(sql,/private\.warehouse_stock_epochs/);
  assert.match(sql,/wms_fixture_owned_rows_table_name_check/);
  for(const name of ['warehouse_inventory_unit_serial_normalize','warehouse_work_location_guard','warehouse_unit_history','uat_archived_record_write_guard','stock_conversion_history_watch','stock_conversion_claim_guard'])assert(sql.includes(name),name);
  assert.match(sql,/40344bb25cc74e0f4b99cb201c4cfbf0/);
  assert.match(sql,/6e153048df3b2950cf06169bc86fa64c/);
  for(const body of ['2c507914f36344858b484521263e4885','899848f0aacd8334d5e4547e53d0eb94','3c138d2eb9df1a00bbb06e9555395e9a','e8b746792b07622e501f6b05610fb7ae'])assert(sql.includes(body),body);
  assert.match(sql,/provolatile::text=expected.volatility/);
  assert.match(sql,/md5\(replace\(prosrc,chr\(13\),''\)\)=expected.body_md5/);
  assert.match(sql,/cardinality.*function_acl/);
  assert.match(sql,/begin read only/);
  assert.doesNotMatch(sql,/^\s*(insert into|update\s+\w+|delete from|truncate table|create table)\b/im);
});
test('migration list requires both file and selected local database versions, including database-only rows',()=>{
  checkMigrationList(' Local | Remote | Time\n 00000000000001 | 00000000000001 | x\n 20261106173133 | 20261106173133 | x',['00000000000001','20261106173133']);
  checkMigrationList(' Local | Local DB | Time\n 00000000000001 \u2502 00000000000001 \u2502 x',['00000000000001']);
  for(const listing of ['00000000000001 | | x',' | 00000000000001 | x','00000000000001 | 00000000000002 | x','00000000000001 | 00000000000001 | x\n | 20990101000000 | x'])assert.throws(()=>checkMigrationList(listing,['00000000000001']),/Applied migration versions/);
});
test('runtime errors stop replay; owned cleanup always runs; failed cleanup never reports pass',async()=>{
  for(const fail of ['start','reset','cleanup',null]){const s=sandbox();try{const calls=[],i=inspectReplay(root);const prepared=prepareReplay({root,parent:s.home,workspace:path.join(s.home,'database'),expectedDigest:i.digest});
    const result=await runSupabaseReplay(prepared,{execute:async args=>{calls.push(args);if((fail==='start'&&args[0]==='start')||(fail==='reset'&&args[1]==='reset')||(fail==='cleanup'&&args[0]==='stop'))throw Error('native failure');return args[0]==='migration'?i.files.filter(f=>f.output).map(f=>f.output.slice(0,14)+' | '+f.output.slice(0,14)+' | time').join('\n'):args[1]==='query'?'wms_fixture_replay_schema_ok':'ok';}});
    assert.equal(result.status,fail?'FAILED':'TEST_DRIVER_PASS');assert.equal(result.fullNativeChainPassed,false);assert(calls.some(a=>a[0]==='stop'));assert.equal(result.closed,fail!=='cleanup');
    assert(calls.every(a=>a.includes(prepared.workspace)));assert(!calls.flat().includes('--linked'));
    if(fail==='start')assert(!calls.some(a=>a[1]==='reset'));
  }finally{s.close();}}
});
test('new candidate after inspection and prepared-byte tampering block execution, not just final reporting',async()=>{
  const s=sandbox();try{const copy=copySource(s.home),i=inspectReplay(copy);const later=path.join(copy,'supabase/migrations/20990101000000_new_fence.sql');
    writeFileSync(later,'select 1;');assert.throws(()=>prepareReplay({root:copy,parent:s.home,workspace:path.join(s.home,'bad'),expectedDigest:i.digest}),/inventory digest/);rmSync(later);
    const prepared=prepareReplay({root:copy,parent:s.home,workspace:path.join(s.home,'database'),expectedDigest:i.digest});
    const f=prepared.inventory.files.find(f=>f.output),target=path.join(prepared.workspace,'supabase/migrations',f.output);writeFileSync(target,'select 1;');
    let called=false;await assert.rejects(runSupabaseReplay(prepared,{execute:async()=>{called=true;}}),/Prepared SQL changed/);assert.equal(called,false);
  }finally{s.close();}
});
