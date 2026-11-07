import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,cpSync,mkdirSync,readFileSync,writeFileSync,rmSync,readdirSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inspectReplay,prepareReplay,runSupabaseReplay,safeEnvironment,checkMigrationList,checkSchemaResults,ownedContainerName,checkOwnedContainer,summarizeReplayFailure} from './wms-fixture-migration-replay.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const ledger='20261106173133_wms_fixture_postgres_lifecycle.sql';

test('failure diagnostics expose only known migration names, error codes and fixed categories',()=>{
  const log=`Applying migration ${ledger}...\nERROR: relation "private.example" does not exist (SQLSTATE 42P01)\nDETAIL: password=never-publish postgres://user:password@private.invalid/database\nSELECT 'private customer row';`;
  assert.deepEqual(summarizeReplayFailure(log,[ledger]),{category:'database-error',sqlstates:['42P01'],lastMigration:ledger});
  assert.deepEqual(summarizeReplayFailure('Applying migration 20990101000000_untrusted.sql...\nconnection refused\nsecret=never-publish',[ledger]),{category:'connection-error',sqlstates:[],lastMigration:null});
  assert.deepEqual(summarizeReplayFailure('Docker daemon is not running'),{category:'docker-unavailable',sqlstates:[],lastMigration:null});
  assert.deepEqual(summarizeReplayFailure('pull access denied for a private image'),{category:'image-pull-error',sqlstates:[],lastMigration:null});
  assert.deepEqual(summarizeReplayFailure('unrecognized failure with private values'),{category:'unclassified-startup-error',sqlstates:[],lastMigration:null});
  assert.deepEqual(summarizeReplayFailure('ERROR: permission denied for schema net (SQLSTATE 42501)\nDETAIL: password=never-publish'),{
    category:'database-error',sqlstates:['42501'],lastMigration:null,permission:{kind:'schema',object:'net',reason:'denied'}});
  assert.deepEqual(summarizeReplayFailure('ERROR: must be owner of table _http_response (SQLSTATE 42501)'),{
    category:'database-error',sqlstates:['42501'],lastMigration:null,permission:{kind:'table',object:'_http_response',reason:'ownership-required'}});
  assert.deepEqual(summarizeReplayFailure('\u001b[31mERROR: permission denied for table other_catalog_table (SQLSTATE 42501)\u001b[0m'),{
    category:'database-error',sqlstates:['42501'],lastMigration:null,permission:{kind:'table',object:'other_catalog_table',reason:'denied'}});
  for(const object of ["'Private customer value'",'net_secret','net;password=secret','postgres://private.invalid/database'])assert.deepEqual(
    summarizeReplayFailure(`ERROR: permission denied for schema ${object} (SQLSTATE 42501)`),{
      category:'database-error',sqlstates:['42501'],lastMigration:null});
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
  for(const body of ['2c507914f36344858b484521263e4885','24a00a761d0f152eeaf0be64ef709f7a','3c138d2eb9df1a00bbb06e9555395e9a','e8b746792b07622e501f6b05610fb7ae'])assert(sql.includes(body),body);
  assert.match(sql,/provolatile::text=expected.volatility/);
  assert.match(sql,/md5\(replace\(prosrc,chr\(13\),''\)\)=expected.body_md5/);
  assert.match(sql,/cardinality.*function_acl/);
  assert.match(sql,/begin read only/);
  assert.doesNotMatch(sql,/^\s*(insert into|update\s+\w+|delete from|truncate table|create table)\b/im);
});
const migrationOutput=versions=>JSON.stringify({migrations:versions.map(version=>({local:version,remote:version,time:'fixture'})),message:'Migrations listed'});
const schemaOutput=()=>['BEGIN','SET','DO','SELECT','ROLLBACK'].map(command=>({command,rows:command==='SELECT'?[{result:'wms_fixture_replay_schema_ok'}]:[]}));

test('owned database identity follows the CLI 40-character project rule and requires exact workspace, labels and port',()=>{
  const prepared={project:'wms-replay-'+'a'.repeat(32),workspace:'/owned/workspace',port:23456};
  const metadata={name:'/supabase_db_wms-replay-'+'a'.repeat(29),running:true,project:'wms-replay-'+'a'.repeat(29),workdir:prepared.workspace,ports:{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'23456'}]}};
  assert.equal(ownedContainerName(prepared),metadata.name.slice(1));
  checkOwnedContainer(JSON.stringify(metadata),prepared);
  checkOwnedContainer(JSON.stringify({...metadata,ports:{'5432/tcp':[{HostIp:'0.0.0.0',HostPort:'23456'},{HostIp:'::',HostPort:'23456'}]}}),prepared);
  for(const [key,value] of [['name',metadata.name+'aaa'],['project',prepared.project],['running',false],['workdir','/foreign'],['workdir',null],['ports',{}],['ports',{'5432/tcp':[]}],['ports',{'5432/tcp':[{HostIp:'127.0.0.1',HostPort:'5432'}]}],['ports',{'5432/tcp':[{HostIp:'192.0.2.1',HostPort:'23456'}]}]]){
    assert.throws(()=>checkOwnedContainer(JSON.stringify({...metadata,[key]:value}),prepared));
  }
  for(const HostIp of ['::','::1'])assert.throws(()=>checkOwnedContainer(JSON.stringify({...metadata,ports:{'5432/tcp':[{HostIp,HostPort:'23456'}]}}),prepared),/Owned IPv4 database port differs/);
  for(const project of ['foreign','../foreign','wms-replay-'+'x'.repeat(32)])assert.throws(()=>ownedContainerName({...prepared,project}));
  for(const port of [0,5432,50000,'23456'])assert.throws(()=>ownedContainerName({...prepared,port}));
});

test('migration JSON requires both ordered version columns without dropping blanks, extras or duplicate rows',()=>{
  const expected=['00000000000001','20261106173133'];
  checkMigrationList(migrationOutput(expected),expected);
  for(const mutate of [rows=>rows.pop(),rows=>rows.reverse(),rows=>rows.push(rows[0]),rows=>{rows[0].local='';},rows=>{rows[1].remote='';},rows=>{rows[0].remote='20990101000000';}]){
    const payload=JSON.parse(migrationOutput(expected));mutate(payload.migrations);
    assert.throws(()=>checkMigrationList(JSON.stringify(payload),expected),/Applied migration versions/);
  }
  for(const payload of [{},{data:JSON.parse(migrationOutput(expected))},{migrations:null},{migrations:[null]},{migrations:[{local:1,remote:1}]}])assert.throws(()=>checkMigrationList(JSON.stringify(payload),expected));
  for(const text of [' Local | Remote | Time','Connecting...\n'+migrationOutput(expected),migrationOutput(expected)+'\nwarning',''])assert.throws(()=>checkMigrationList(text,expected));
});

test('schema proof requires the exact completed read-only batch and result, not a substring marker',()=>{
  checkSchemaResults(schemaOutput());
  for(const mutate of [rows=>rows.pop(),rows=>rows.reverse(),rows=>rows.push(rows[0]),rows=>{rows[3].rows=[];},rows=>{rows[3].rows.push(rows[3].rows[0]);},rows=>{rows[3].rows[0].extra='unexpected';},rows=>{rows[3].rows[0].result+=' not actually passed';},rows=>{rows[4].rows=[{result:'unexpected'}];}]){
    const results=schemaOutput();mutate(results);assert.throws(()=>checkSchemaResults(results));
  }
  assert.throws(()=>checkSchemaResults('wms_fixture_replay_schema_ok'));
});
test('runtime errors stop replay; owned cleanup always runs; failed cleanup never reports pass',async()=>{
  for(const fail of ['start','reset','listing','schema','schema-result','cleanup',null]){const s=sandbox();try{const calls=[],i=inspectReplay(root);const prepared=prepareReplay({root,parent:s.home,workspace:path.join(s.home,'database'),expectedDigest:i.digest});
    const result=await runSupabaseReplay(prepared,{execute:async args=>{calls.push(args);if((fail==='start'&&args[0]==='start')||(fail==='reset'&&args[1]==='reset')||(fail==='schema'&&args[0]==='schema-assertions')||(fail==='cleanup'&&args[0]==='stop'))throw Error('native failure');return args[0]==='migration'?(fail==='listing'?'{}':migrationOutput(i.files.filter(f=>f.output).map(f=>f.output.slice(0,14)))):args[0]==='schema-assertions'?(fail==='schema-result'?schemaOutput().slice(0,-1):schemaOutput()):'ok';}});
    assert.equal(result.status,fail?'FAILED':'TEST_DRIVER_PASS');assert.equal(result.fullNativeChainPassed,false);assert(calls.some(a=>a[0]==='stop'));assert.equal(result.closed,fail!=='cleanup');
    assert(calls.every(a=>a.includes(prepared.workspace)));assert(!calls.flat().includes('--linked'));
    if(fail==='start')assert(!calls.some(a=>a[1]==='reset'));
    if(fail==='listing')assert(!calls.some(a=>a[0]==='schema-assertions'));
    const listing=calls.find(a=>a[0]==='migration');if(listing)assert.deepEqual(listing.slice(0,5),['migration','list','--local','--output-format','json']);
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
