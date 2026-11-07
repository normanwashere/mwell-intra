import assert from 'node:assert/strict';
import {createHash,randomUUID,randomInt} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {validateCanonicalManifest} from './prepare-learning-postgres.mjs';

const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
const sqlName=/^\d{14}_[a-z0-9_]+\.sql$/;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonicalHash=bytes=>hash(bytes.toString().replace(/\r\n?/g,'\n'));
const baselineDir='scripts/qa/fixtures/canonical-uat-baseline';
const manifestFile='scripts/qa/canonical-replay-manifest.json';
const excludedServices='gotrue,realtime,storage-api,imgproxy,kong,mailpit,postgrest,postgres-meta,studio,edge-runtime,logflare,vector,supavisor';

function owned(root,relative){
  const target=path.resolve(root,relative),rel=path.relative(root,target);
  assert(rel&&!rel.startsWith('..')&&!path.isAbsolute(rel),'Input outside repository');
  let part=root;
  for(const segment of rel.split(path.sep)){part=path.join(part,segment);assert(!lstatSync(part).isSymbolicLink(),'Symlink input rejected');}
  return target;
}
function bytes(root,relative){const target=owned(root,relative);assert(lstatSync(target).isFile(),'Expected regular input file');return readFileSync(target);}

export function inspectReplay(root=defaultRoot,{requiredFiles=[]}={}){
  root=realpathSync(root);
  const raw=bytes(root,manifestFile),manifest=validateCanonicalManifest(raw),files=[];
  const latest=manifest.sources.at(-1).file.slice(0,14);
  const baselineNames=readdirSync(owned(root,baselineDir)).filter(n=>n.endsWith('.sql')).sort();
  assert.deepEqual(baselineNames,manifest.baseline.map(f=>f.file),'Missing or unclassified canonical baseline');
  for(const [index,f] of manifest.baseline.entries()){
    const relative=baselineDir+'/'+f.file,b=bytes(root,relative);
    assert.equal(canonicalHash(b),f.sha256,'Known baseline checksum drift: '+f.file);
    files.push({kind:'baseline',classification:'canonical-baseline',file:f.file,relative,output:String(index+1).padStart(14,'0')+'_'+f.file.slice(15),sha256:hash(b),normalizedSha256:canonicalHash(b),canonicalSha256:f.sha256,bytes:b.length,recordedVersion:f.recordedVersion});
  }
  const names=readdirSync(owned(root,'supabase/migrations')).filter(n=>n.endsWith('.sql')).sort();
  assert(names.every(n=>sqlName.test(n)),'Invalid SQL filename');
  assert.equal(new Set(names.map(n=>n.slice(0,14))).size,names.length,'Duplicate migration version');
  for(const f of manifest.sources)assert(names.includes(f.file),'Missing known migration: '+f.file);
  for(const name of names){
    const relative='supabase/migrations/'+name,b=bytes(root,relative),known=manifest.sources.find(f=>f.file===name);
    if(known)assert.equal(canonicalHash(b),known.sha256,'Known migration checksum drift: '+name);
    else assert(name.slice(0,14)>latest,'Unknown backdated migration needs canonical classification: '+name);
    const output=known?.action==='preserve-history'?null:name;
    if(known)assert(['preserve-history','execute-forward'].includes(known.action),'Unknown canonical action');
    files.push({kind:'source',classification:known?(output?'canonical-forward':'canonical-preserved-history'):'candidate-forward',file:name,relative,output,sha256:hash(b),normalizedSha256:canonicalHash(b),canonicalSha256:known?.sha256??null,bytes:b.length,...(!output?{reason:known.reason}:{}),provenance:known?'Reviewed hash-bound canonical contract':'Current repository source, not claimed applied to UAT; execute unchanged after reviewed forward boundary'});
  }
  for(const name of requiredFiles){assert(sqlName.test(name),'Invalid required migration');assert(files.some(f=>f.file===name&&f.output),'Required migration missing: '+name);}
  const outputs=files.filter(f=>f.output).map(f=>f.output);
  assert.deepEqual(outputs,[...outputs].sort(),'Output ordering changed');
  assert.equal(new Set(outputs).size,outputs.length,'Output collision');
  const config=bytes(root,'supabase/config.toml').toString();
  assert(/^project_id = "mwell-intra-learning-ci"\r?$/m.test(config)&&!(/env\(|project_ref|password/i.test(config)),'Only committed credential-free config supported');
  const schemaAssertionsSha256=canonicalHash(readFileSync(new URL('./wms-fixture-migration-replay.assert.sql',import.meta.url)));
  const inventory={schemaVersion:1,scope:manifest.scope,canonicalManifestSha256:canonicalHash(raw),schemaAssertionsSha256,configSha256:hash(config),baselineCount:manifest.baseline.length,preservedCount:files.filter(f=>!f.output).length,forwardCount:files.filter(f=>f.kind==='source'&&f.output).length,requiredFiles:[...requiredFiles].sort(),files};
  const reviewed={...inventory,configSha256:canonicalHash(config),files:files.map(({sha256:_raw,bytes:_length,...f})=>f)};
  return {...inventory,digest:hash(JSON.stringify(reviewed)),rawDigest:hash(JSON.stringify(inventory))};
}

export function prepareReplay({root=defaultRoot,parent,workspace,expectedDigest,requiredFiles=[]}){
  const resolvedParent=realpathSync(parent);workspace=path.resolve(workspace);
  assert(path.dirname(workspace)===resolvedParent&&workspace!==path.resolve(root),'Workspace must be a new direct child of dedicated output parent');
  assert(!existsSync(workspace),'Workspace already exists');
  const inventory=inspectReplay(root,{requiredFiles});
  assert.equal(inventory.digest,expectedDigest,'Candidate inventory digest changed or not reviewed');
  const captured=inventory.files.filter(f=>f.output).map(f=>{const b=bytes(root,f.relative);assert.equal(hash(b),f.sha256,'Input changed during preparation');return {file:f.output,bytes:b};});
  const project='wms-replay-'+randomUUID().replaceAll('-','');
  const port=randomInt(20000,50000),shadowPort=port+1;
  const config=bytes(root,'supabase/config.toml').toString().replace('"mwell-intra-learning-ci"','"'+project+'"').replace(/^port = 54322\r?$/m,'port = '+port).replace(/^shadow_port = 54320\r?$/m,'shadow_port = '+shadowPort);
  mkdirSync(path.join(workspace,'supabase/migrations'),{recursive:true});
  mkdirSync(path.join(workspace,'home'));
  writeFileSync(path.join(workspace,'supabase/config.toml'),config);
  for(const f of captured)writeFileSync(path.join(workspace,'supabase/migrations',f.file),f.bytes);
  const schemaAssertions=readFileSync(new URL('./wms-fixture-migration-replay.assert.sql',import.meta.url));
  writeFileSync(path.join(workspace,'schema-assertions.sql'),schemaAssertions);
  const head=spawnSync('git',['rev-parse','HEAD'],{cwd:root,windowsHide:true,encoding:'utf8'}).stdout?.trim();
  const result={root:realpathSync(root),workspace,project,port,shadowPort,inventory,configSha256:hash(config),schemaAssertionsSha256:hash(schemaAssertions),candidateCommit:/^[a-f0-9]{40}$/.test(head??'')?head:null};
  writeFileSync(path.join(workspace,'replay-inventory.json'),JSON.stringify(result,null,2)+'\n');
  return result;
}

export function safeEnvironment(home,source=process.env){
  const env={};for(const k of ['PATH','Path','SYSTEMROOT','SystemRoot','WINDIR','COMSPEC','PATHEXT','TEMP','TMP'])if(source[k])env[k]=source[k];
  return {...env,HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:home,CI:'true',NO_COLOR:'1'};
}
export function redact(text){return String(text).replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[local database URL redacted]').replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[JWT redacted]').replace(/^.*(?:password|secret|publishable.?key|service.?role.?key|anon.?key|api.?key).*$/gim,'[credential line redacted]');}

export function summarizeReplayFailure(output,knownFiles=[]){
  const text=String(output),known=new Set(knownFiles.filter(file=>sqlName.test(file)));
  const knownPermissionObjects=new Set(['net','http_request_queue','_http_response','net.http_request_queue','net._http_response',
    'reporting_authority','admin_audit','reporting_authority.admin_audit','private','warehouse','procurement','core','public']);
  const permission=[...text.matchAll(/^ERROR:\s+(permission denied for|must be owner of)\s+(schema|table|function)\s+"?([a-z_][a-z0-9_.]*)"?(?=\s|$)/gm)]
    .filter(match=>knownPermissionObjects.has(match[3])).map(match=>({kind:match[2],object:match[3],reason:match[1]==='permission denied for'?'denied':'ownership-required'})).at(-1);
  const sqlstates=[...new Set([...text.matchAll(/\bSQLSTATE\s+([0-9A-Z]{5})\b/g)].map(match=>match[1]))].slice(-4);
  const migrations=[...text.matchAll(/Applying migration (\d{14}_[a-z0-9_]+\.sql)\b/g)].map(match=>match[1]).filter(file=>known.has(file));
  const category=sqlstates.length?'database-error'
    :/docker daemon|cannot connect to docker/i.test(text)?'docker-unavailable'
      :/pull access denied|failed to pull|manifest unknown|toomanyrequests/i.test(text)?'image-pull-error'
        :/connection refused|ECONNREFUSED|ENOTFOUND|certificate verify failed/i.test(text)?'connection-error'
          :'unclassified-startup-error';
  return {category,sqlstates,lastMigration:migrations.at(-1)??null,...(permission?{permission}: {})};
}

export function checkMigrationList(text,expected){
  // The second column is the selected database, even when an older CLI labels it Remote.
  const rows=String(text).split(/\r?\n/).map(s=>s.trim().replace(/^\u2502/,'').split(/[|\u2502]/).map(c=>c.trim()))
    .filter(c=>/^\d+$/.test(c[0])||/^\d+$/.test(c[1]??''));
  for(const column of [0,1])assert.deepEqual(rows.map(c=>c[column]),expected,'Applied migration versions missing, reordered or unexpected');
}
function assertFrozen(prepared){
  assert.equal(inspectReplay(prepared.root,{requiredFiles:prepared.inventory.requiredFiles}).rawDigest,prepared.inventory.rawDigest,'Repository inventory changed during replay');
  assert.equal(hash(readFileSync(path.join(prepared.workspace,'supabase/config.toml'))),prepared.configSha256,'Owned local config changed');
  assert.equal(hash(readFileSync(path.join(prepared.workspace,'schema-assertions.sql'))),prepared.schemaAssertionsSha256,'Post-schema assertions changed');
  assert(!existsSync(path.join(prepared.workspace,'supabase/.temp/project-ref')),'Linked project forbidden');
  const actual=readdirSync(path.join(prepared.workspace,'supabase/migrations')).sort();
  assert.deepEqual(actual,prepared.inventory.files.filter(f=>f.output).map(f=>f.output),'Prepared migration set changed');
  for(const f of prepared.inventory.files.filter(f=>f.output))assert.equal(hash(bytes(prepared.workspace,'supabase/migrations/'+f.output)),f.sha256,'Prepared SQL changed: '+f.output);
}

export async function runSupabaseReplay(prepared,{execute}={}){
  assertFrozen(prepared);
  const injected=Boolean(execute);
  const nativeFailures=new WeakMap();
  const cli=path.join(prepared.root,'node_modules/supabase/dist/supabase.js');
  const result={scope:prepared.inventory.scope,inventoryDigest:prepared.inventory.digest,rawInventoryDigest:prepared.inventory.rawDigest,candidateCommit:prepared.candidateCommit,evidenceKind:injected?'test-double':'supabase-cli-native',status:'FAILED',closed:false,steps:[],fullNativeChainPassed:false};
  const persist=()=>writeFileSync(path.join(prepared.workspace,'replay-result.json'),JSON.stringify(result,null,2)+'\n');
  execute??=(async args=>{
    const timeout=['start','reset'].includes(args[0])||args[1]==='reset'?10*60*1000:2*60*1000;
    const r=spawnSync(process.execPath,[cli,...args],{cwd:prepared.workspace,env:safeEnvironment(path.join(prepared.workspace,'home')),windowsHide:true,encoding:'utf8',timeout,maxBuffer:16*1024*1024});
    const output=redact((r.stdout??'')+'\n'+(r.stderr??''));
    writeFileSync(path.join(prepared.workspace,`step-${result.steps.length}-${args[0]}.log`),output);
    if(r.status!==0){
      const error=Error(`Local CLI ${args[0]} failed (exit ${r.status}, ${r.error?.code??'see owned step log'})`);
      nativeFailures.set(error,summarizeReplayFailure((r.stdout??'')+'\n'+(r.stderr??''),prepared.inventory.files.filter(file=>file.output).map(file=>file.output)));
      throw error;
    }
    return output;
  });
  const command=async args=>{const start=Date.now();try{const value=await execute([...args,'--workdir',prepared.workspace]);result.steps.push({command:args,status:'PASS',durationMs:Date.now()-start});persist();return value;}catch(e){result.steps.push({command:args,status:'FAILED',durationMs:Date.now()-start,error:redact(e.message),...(nativeFailures.has(e)?{diagnostic:nativeFailures.get(e)}:{})});persist();throw e;}};
  try{
    await command(['start','--exclude',excludedServices]);
    assertFrozen(prepared);
    await command(['db','reset','--local','--no-seed']);
    const listing=await command(['migration','list','--local']);
    checkMigrationList(listing,prepared.inventory.files.filter(f=>f.output).map(f=>f.output.slice(0,14)));
    const schema=await command(['db','query','--local','--file',path.join(prepared.workspace,'schema-assertions.sql')]);
    assert(schema.includes('wms_fixture_replay_schema_ok'),'Post-schema success marker absent');result.schemaAssertionsPassed=true;
    assertFrozen(prepared);result.fullNativeChainPassed=!injected;result.status=injected?'TEST_DRIVER_PASS':'PASS';
  }catch(e){result.error=redact(e.message);}
  finally{try{await command(['stop','--no-backup']);result.closed=true;}catch(e){result.status='FAILED';result.cleanupError=redact(e.message);}persist();}
  return result;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const [command,...args]=process.argv.slice(2);
  try{
    assert(['inspect','prepare','run'].includes(command),'Use inspect, prepare or run');
    assert(args.length%2===0,'Expected explicit option/value pairs');const options={};
    for(let i=0;i<args.length;i+=2){assert(['--parent','--digest','--fence-migration'].includes(args[i])&&!Object.hasOwn(options,args[i]),'Unknown/duplicate option');options[args[i]]=args[i+1];}
    const requiredFiles=['20261106173133_wms_fixture_postgres_lifecycle.sql',...(options['--fence-migration']?[options['--fence-migration']]:[])];
    const inventory=inspectReplay(defaultRoot,{requiredFiles});
    if(command==='inspect')console.log(JSON.stringify(inventory,null,2));
    else{
      assert(options['--parent']&&options['--digest'],'--parent and reviewed --digest required');
      if(command==='run')assert(options['--fence-migration'],'Final fence migration must be explicit before full replay');
      const prepared=prepareReplay({parent:options['--parent'],workspace:path.join(options['--parent'],'wms-replay-'+randomUUID()),expectedDigest:options['--digest'],requiredFiles});
      const result=command==='run'?await runSupabaseReplay(prepared):{status:'PREPARED_NOT_EXECUTED'};
      console.log(JSON.stringify({workspace:prepared.workspace,digest:inventory.digest,...result}));if(result.status==='FAILED')process.exitCode=1;
    }
  }catch(e){console.error(redact(e.message));process.exitCode=1;}
}
