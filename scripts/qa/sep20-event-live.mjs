// PREPARE ONLY unless the release owner separately authorizes this exact run.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createManifest,validateManifest,assertExecutionGate,assertReleaseEvidence,smokeCommands,REQUIRED_MIGRATIONS } from './sep20-event-live-manifest.mjs';
import { assertSellerPreflight } from './sep20-event-live-preflight.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
const [command,output,commit,origin,date]=process.argv.slice(2);
assert(['prepare','run'].includes(command),'Use prepare or explicitly authorized run');
assert(output&&path.isAbsolute(output),'Absolute external output directory required');
assert(!path.resolve(output).toLowerCase().startsWith(path.resolve(root).toLowerCase()),'Keep evidence outside checkout');
const hash=value=>createHash('sha256').update(value).digest('hex');
const migrations={};
for(const name of REQUIRED_MIGRATIONS){const source=await readFile(path.join(root,'supabase/migrations',name),'utf8');assert(source.trim(),`Empty migration: ${name}`);migrations[name]=hash(source);}
if(command==='prepare'){
  const m=createManifest({commit,origin,date});validateManifest(m);
  await mkdir(output,{recursive:false});
  await writeFile(path.join(output,'manifest.json'),JSON.stringify(m,null,2),{flag:'wx'});
  await writeFile(path.join(output,'planned-commands.json'),JSON.stringify(smokeCommands(m),null,2),{flag:'wx'});
  await writeFile(path.join(output,'release-evidence.template.json'),JSON.stringify({runId:m.runId,project:m.project,commit:m.commit,
    verifiedBy:null,verifiedAt:null,evidenceReference:null,fixtureEvidenceReference:null,sellerUiEvidenceReference:null,
    migrations,installedDefinitionsVerified:false,rawRlsVerified:false,learningPublishedApproved:false,sellerLearningCompleted:false,
    sellerUiVerified:false,newSyntheticProductsOnly:false},null,2),{flag:'wx'});
  console.log(JSON.stringify({prepared:true,networkRequests:0,mutations:0,runId:m.runId,output,scope:m.scope}));
}else{
  const m=JSON.parse(await readFile(path.join(output,'manifest.json'),'utf8'));
  assertExecutionGate(m,process.env);
  const release=JSON.parse(await readFile(path.join(output,'release-evidence.json'),'utf8'));assertReleaseEvidence(m,release,migrations);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  assert.equal(m.date,today,'Strict Manila event date: do not silently extend the run');
  const report={runId:m.runId,scope:m.scope,startedAt:new Date().toISOString(),manifestSha256:hash(JSON.stringify(m)),
    releaseEvidenceSha256:hash(JSON.stringify(release)),complete:false,fullChainComplete:false,checks:[],commands:[]};
  const reportFile=path.join(output,'first-smoke-results.json');
  await writeFile(reportFile,JSON.stringify(report,null,2),{flag:'wx'});
  const persist=()=>writeFile(reportFile,JSON.stringify(report,null,2));
  const require=createRequire(new URL('../../apps/shell/package.json',import.meta.url));
  const {createClient}=require('@supabase/supabase-js');
  const clients={};
  const checked=result=>{assert(!result.error,`Request denied (${result.error?.code??'transport'}); inspect authorized server logs`);return result.data;};
  const call=async(actor,name,payload)=>checked(await clients[actor].schema('warehouse').rpc(name,{payload}));
  const rows=async(actor,table,column,value,select='*')=>checked(await clients[actor].schema('warehouse').from(table).select(select).eq(column,value));
  try{
    const healthResponse=await fetch(`${m.origin}/api/health`,{signal:AbortSignal.timeout(20000),cache:'no-store'});assert(healthResponse.ok);
    const health=await healthResponse.json();assert.equal(health.status,'ok');assert.equal(health.deployment.appEnv,'uat');assert.equal(health.deployment.supabaseProjectRef,m.project);assert.equal(health.commit,m.commit);
    report.checks.push({name:'pinned-UAT-health',passed:true,commit:health.commit});
    for(const actor of ['owner','seller']){
      const client=createClient(`https://${m.project}.supabase.co`,'sb_publishable_7YRN3Sg0Cm8QRoDt6IszlA_yAuRD5u9',{
        auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(20000)})}});
      const login=await client.auth.signInWithPassword({email:m.actors[actor],password:process.env.AUDIT_PASSWORD});assert(!login.error,`Login failed: ${actor}`);
      assert.equal(login.data.user.email,m.actors[actor]);clients[actor]=client;
      if(actor==='seller'){
        await assertSellerPreflight(client,m,login.data.user.id,today);
      }
    }
    for(const [actor,module,cap] of [['owner','events','create_event'],['owner','events','manage_events'],['owner','events','request_fulfillment'],['seller','events','view_event_custody'],['seller','events','record_event_outcome']]){
      assert.equal(checked(await clients[actor].schema('core').rpc('has_live_cap',{p_module:module,p_cap:cap})),true,`Missing live capability: ${actor}/${cap}`);
    }
    for(const table of ['events','allocations','inventory_units','returns','stock_levels','products']){
      const data=checked(await clients.seller.schema('warehouse').from(table).select('*').limit(1));assert.equal(data.length,0,`Raw seller exposure: ${table}`);
    }
    assert.equal((await rows('owner','events','id',m.eventId)).length,0,'New event ID already exists; do not rerun blindly');
    for(const line of m.lines){
      const products=await rows('owner','products','id',line.productId,'id,attributes,item_class');assert.equal(products.length,1,'Parent must create the exact NEW product');
      assert.equal(products[0].attributes?.sep20_event_run,m.runId);assert(['sellable_sku','merchandise','event_material'].includes(products[0].item_class));
      assert.equal((await rows('owner','allocations','product_id',line.productId)).length,0,'New product already allocated');
    }
    report.checks.push({name:'seller-authority-isolation-and-new-products',passed:true});await persist();
    for(const step of smokeCommands(m)){
      if(step.payload.action==='enable'){
        const readiness=await call('owner','event_custody_readiness',{event_id:m.eventId});
        assert.deepEqual(readiness,{schema:true,capabilities:true,learning:true,ready:true});report.checks.push({name:'live-custody-readiness',readiness});
      }
      const saved={actor:'owner',...step,status:'pending'};report.commands.push(saved);await persist();
      const response=await call('owner',step.name,step.payload);saved.status='confirmed';saved.response=response;await persist();
      if(step.name==='request_event_fulfillment'){
        assert.equal(response.event_id,m.eventId);assert.equal(response.status,'pending_approval');assert.deepEqual(response.lines,m.lines);
        const replay=await call('owner',step.name,step.payload);assert.equal(replay.id,response.id);
        const demands=await rows('owner','department_stock_requests','event_id',m.eventId);assert.equal(demands.length,1);assert.equal(demands[0].id,response.id);
        report.checks.push({name:'single-two-line-demand-and-same-key-retry',passed:true,requestId:response.id});
      }
    }
    const assigned=await call('seller','my_event_custody_events',{});assert(assigned.some(e=>e.id===m.eventId));
    const ledger=await call('seller','event_custody_ledger',{event_id:m.eventId});assert.equal(ledger.allocations.length,0);assert.equal(ledger.entries.length,0);
    report.checks.push({name:'seller-assigned-with-zero-issued-custody',passed:true});report.complete=true;
  }catch(error){report.failure=error.message;process.exitCode=1;}
  finally{report.finishedAt=new Date().toISOString();await persist();}
  console.log(JSON.stringify({complete:report.complete,fullChainComplete:false,report:reportFile}));
}
