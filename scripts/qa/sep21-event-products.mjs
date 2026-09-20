import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertExecutionGate, validateManifest } from './sep20-event-live-manifest.mjs';

const RUN='13ec2166-93be-4902-b323-bacc857dad5d';
const SHA='9ec7311f9062c2c185682db21a5f9bddc7b72943';
const ACTOR='60bdca8a-14dd-4297-b9a8-be64e9e7a1cc';
export function assertProductSetup(m,env,today){
  assertExecutionGate(m,env);
  assert.equal(m.runId,RUN);assert.equal(m.date,'2026-09-21');assert.equal(today,m.date);
  assert.equal(m.commit,SHA);assert.equal(m.origin,'https://mwell-intra-uat.vercel.app');
}
export function productsFor(m){
  validateManifest(m);
  return m.lines.map((line,index)=>({id:line.productId,
    sku:`UAT-SEP21-${m.runId.slice(0,8).toUpperCase()}-${index===0?'WATCH':'MATERIAL'}`,
    name:`UAT Sep21 ${m.runId.slice(0,8)} ${index===0?'Test Watch':'Event Material'}`,
    category:index===0?'device':'merchandise',device_type:index===0?'watch':null,
    item_class:index===0?'sellable_sku':'event_material',serialization_policy:index===0?'required':'none',serialized:index===0,
    uom:'piece',unit_cost:0,reorder_point:0,attributes:{sep20_event_run:m.runId,synthetic:true,event_date:m.date,
      purpose:'Isolated September 21 event handoff test',cost_basis:'Zero placeholder; no receipt or stock seeded'}}));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  assert.equal(process.argv.length,3,'Supply only the prepared output directory');
  const output=await realpath(process.argv[2]);
  assert.equal(output.toLowerCase().replaceAll('\\','/'),'c:/users/normanarisdeocareza/projects/mwell-intra-warehouse/outputs/sep21-event-run');
  const bytes=await readFile(path.join(output,'manifest.json'));
  const m=JSON.parse(bytes);const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  assertProductSetup(m,process.env,today);
  const response=await fetch(`${m.origin}/api/health`,{cache:'no-store',signal:AbortSignal.timeout(20000)});assert(response.ok);
  const health=await response.json();assert.equal(health.commit,m.commit);assert.equal(health.status,'ok');
  assert.equal(health.deployment.appEnv,'uat');assert.equal(health.deployment.supabaseProjectRef,m.project);
  const require=createRequire(new URL('../../apps/shell/package.json',import.meta.url));
  const {createClient}=require('@supabase/supabase-js');
  const client=createClient(`https://${m.project}.supabase.co`,'sb_publishable_7YRN3Sg0Cm8QRoDt6IszlA_yAuRD5u9',{
    auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.timeout(20000)})}});
  const checked=result=>{assert(!result.error,`Request denied (${result.error?.code??'transport'})`);return result.data;};
  const login=await client.auth.signInWithPassword({email:m.actors.reviewer,password:process.env.AUDIT_PASSWORD});
  assert(!login.error,'Operations Lead login failed');assert.equal(login.data.user.id,ACTOR);assert.equal(login.data.user.email,m.actors.reviewer);
  assert.equal(checked(await client.schema('core').rpc('has_live_cap',{p_module:'warehouse',p_cap:'manage_products'})),true);
  const ids=m.lines.map(l=>l.productId);
  const rows=(table,column)=>client.schema('warehouse').from(table).select('*').in(column,ids).then(checked);
  assert.deepEqual(await rows('products','id'),[],'New IDs already exist; do not replay product setup');
  const stock=async()=>{const result={};for(const table of ['stock_levels','inventory_units','allocations'])result[table]=await rows(table,'product_id');return result;};
  const before=await stock();for(const values of Object.values(before))assert.deepEqual(values,[]);
  const report={runId:m.runId,commit:m.commit,manifestSha256:createHash('sha256').update(bytes).digest('hex'),actor:m.actors.reviewer,actorId:ACTOR,
    method:'Authenticated product INSERT under existing RLS',products:productsFor(m),startedAt:new Date().toISOString(),confirmed:false,stockCreated:null,before};
  const file=path.join(output,'product-fixture-receipt.json');await writeFile(file,JSON.stringify(report,null,2),{flag:'wx'});
  try{
    // One atomic metadata insert. No opening stock, receipt, serial, approval or role writes.
    checked(await client.schema('warehouse').from('products').insert(report.products));
    report.readback=await rows('products','id');assert.equal(report.readback.length,2);
    for(const product of report.products){const actual=report.readback.find(row=>row.id===product.id);assert(actual);for(const key of Object.keys(product))assert.deepEqual(actual[key],product[key]);}
    report.after=await stock();assert.deepEqual(report.after,before);report.stockCreated=false;report.confirmed=true;
  }catch(error){report.failure=error.message;process.exitCode=1;}
  finally{report.finishedAt=new Date().toISOString();await writeFile(file,JSON.stringify(report,null,2));client.auth.stopAutoRefresh();}
  console.log(JSON.stringify({confirmed:report.confirmed,stockCreated:report.stockCreated,file}));
}
