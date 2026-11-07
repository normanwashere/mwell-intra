// Diagnostic only: bare PostgreSQL is never reported as a completed Supabase replay.
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Client} from 'pg';
import {inspectReplay,safeEnvironment,redact} from './wms-fixture-migration-replay.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
export function classifyPlatform(row){
  const missing=[];
  for(const [key,label] of [['auth_users','auth.users'],['storage_objects','storage.objects'],['auth_uid','auth.uid()']])if(!row[key])missing.push(label);
  for(const role of ['anon','authenticated','service_role'])if(!row.api_roles.includes(role))missing.push(role);
  return {supabaseCompatible:missing.length===0,missing};
}
export function validateDiagnosticOptions(options){
  assert(Object.keys(options).every(k=>['parent','nativeBin'].includes(k)),'Unknown diagnostic option');
  assert(typeof options.parent==='string'&&path.isAbsolute(options.parent)&&typeof options.nativeBin==='string'&&path.isAbsolute(options.nativeBin),'Existing absolute local directories required');
  return {parent:realpathSync(options.parent),nativeBin:realpathSync(options.nativeBin)};
}
export async function runNativeDiagnostic(input){
  const {parent,nativeBin}=validateDiagnosticOptions(input),id=randomUUID();
  const output=path.join(parent,'migration-platform-'+id),cluster=path.join(output,'cluster');
  mkdirSync(output);mkdirSync(path.join(output,'home'));
  const env=safeEnvironment(path.join(output,'home'));
  const exe=name=>path.join(nativeBin,name+(process.platform==='win32'?'.exe':''));
  const result={status:'DIAGNOSTIC_ONLY',fullNativeChainPassed: false,startedAt:new Date().toISOString(),closed:false};
  let server,client,exitPromise;
  const command=(name,args)=>{
    const r=spawnSync(exe(name),args,{env,windowsHide:true,encoding:'utf8',timeout:30000});
    writeFileSync(path.join(output,name+'.log'),redact((r.stdout??'')+'\n'+(r.stderr??'')));
    assert.equal(r.status,0,`${name} failed: ${r.error?.code??'see owned log'}`);
  };
  try{
    const inventory=inspectReplay(root,{requiredFiles:['20261106173133_wms_fixture_postgres_lifecycle.sql']});
    writeFileSync(path.join(output,'inventory.json'),JSON.stringify(inventory,null,2)+'\n');
    result.inventoryDigest=inventory.digest;
    command('initdb',['-D',cluster,'-U','postgres','--auth=trust','--encoding=UTF8','--locale=C']);
    const listener=net.createServer();await new Promise((resolve,reject)=>{listener.once('error',reject);listener.listen(0,'127.0.0.1',resolve);});
    const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
    server=spawn(exe('postgres'),['-D',cluster,'-h','127.0.0.1','-p',String(port)],{env,windowsHide:true,stdio:['ignore','ignore','ignore']});
    let startError;server.once('error',e=>{startError=e;});
    exitPromise=new Promise(resolve=>{server.once('exit',resolve);server.once('error',resolve);});
    result.ownedPid=server.pid;
    for(let attempt=0;attempt<100;attempt++){
      if(startError)throw startError;
      client=new Client({host:'127.0.0.1',port,user:'postgres',database:'postgres',connectionTimeoutMillis:500,statement_timeout:30000,application_name:'wms-migration-platform-diagnostic'});
      try{await client.connect();break;}catch(e){await client.end();client=null;if(attempt===99)throw e;await new Promise(resolve=>setTimeout(resolve,100));}
    }
    const row=(await client.query(`select current_setting('server_version') server_version,to_regclass('auth.users')::text auth_users,to_regclass('storage.objects')::text storage_objects,
      (select p.oid::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='auth' and p.proname='uid' and p.pronargs=0) auth_uid,
      array(select rolname::text from pg_roles where rolname in ('anon','authenticated','service_role') order by rolname) api_roles`)).rows[0];
    result.platform={...row,...classifyPlatform(row)};
    const first=inventory.files.find(f=>f.output),sql=readFileSync(path.join(root,first.relative));
    assert.equal(createHash('sha256').update(sql).digest('hex'),first.sha256,'Source drift before diagnostic');
    result.attemptedSource={file:first.relative,sha256:first.sha256,bytes:sql.length};
    try{await client.query(sql.toString());result.firstSourceStatus='PASS_ONLY_FIRST_FILE';}
    catch(e){result.firstSourceStatus='FAILED';result.failure={code:e.code??null,message:redact(e.message),position:e.position??null};}
    result.notRun=inventory.files.filter(f=>f.output).slice(1).map(f=>f.relative);
    result.status=result.platform.supabaseCompatible?'DIAGNOSTIC_NOT_FULL_REPLAY':'BLOCKED_MISSING_SUPABASE_PLATFORM';
  }catch(e){result.status='DIAGNOSTIC_FAILED';result.error=redact(e.message);}
  finally{
    try{await client?.end();}catch(e){result.clientCloseError=redact(e.message);}
    if(server?.pid&&server.exitCode===null){
      try{command('pg_ctl',['-D',cluster,'-m','fast','-w','-t','15','stop']);await exitPromise;result.closed=true;}
      catch(e){result.status='DIAGNOSTIC_FAILED';result.cleanupError=redact(e.message);server.kill();await exitPromise;}
    }else result.closed=true;
    result.finishedAt=new Date().toISOString();writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2)+'\n');
  }
  return {output,...result};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{assert.equal(process.argv.length,4,'Use native.mjs ABSOLUTE_OUTPUT_PARENT ABSOLUTE_NATIVE_BIN');const result=await runNativeDiagnostic({parent:process.argv[2],nativeBin:process.argv[3]});console.log(JSON.stringify({output:result.output,status:result.status,closed:result.closed,platform:result.platform,failure:result.failure}));process.exitCode=1;}
  catch(e){console.error(redact(e.message));process.exitCode=1;}
}
