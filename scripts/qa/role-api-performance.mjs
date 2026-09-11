import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { CURRENT_LIVE_ROLES } from './live-e2e-scenarios.mjs';
const require=createRequire(new URL('../../apps/shell/package.json',import.meta.url));
const {createClient}=require('@supabase/supabase-js');
const project='kkoitlvydytdhlpxhuah';
assert(process.env.AUDIT_PASSWORD && process.env.PERF_RUN && /^[a-z0-9-]+$/.test(process.env.PERF_RUN));
const health=await(await fetch('https://mwell-intra-uat.vercel.app/api/health')).json();
assert.equal(health.deployment?.supabaseProjectRef,project);
assert.equal(health.deployment?.appEnv,'uat');
const results=[], clients=[];
for(const persona of CURRENT_LIVE_ROLES){
  const client=createClient(`https://${project}.supabase.co`,'sb_publishable_7YRN3Sg0Cm8QRoDt6IszlA_yAuRD5u9',{auth:{persistSession:false,autoRefreshToken:false}});
  const login=await client.auth.signInWithPassword({email:persona.email,password:process.env.AUDIT_PASSWORD});
  assert(!login.error,`${persona.role} login failed: ${login.error?.message}`);
  clients.push({client,role:persona.role});
}
for(const concurrency of [1,3,5]){
  const jobs=clients.flatMap(item=>Array.from({length:3},(_,sample)=>({...item,sample})));
  let next=0;
  const start=performance.now();
  // A bounded worker pool: read-only snapshots, never business RPCs or stress to failure.
  await Promise.all(Array.from({length:concurrency},async()=>{
    while(next<jobs.length){
      const {client,role,sample}=jobs[next++];
      const t=performance.now();
      const {data,error}=await client.schema('core').rpc('my_capability_snapshot');
      results.push({role,concurrency,sample,ms:Math.round(performance.now()-t),error:error?.message??null,
        hash:data?createHash('sha256').update(JSON.stringify(data)).digest('hex'):null});
    }
  }));
  console.log(JSON.stringify({concurrency,requests:jobs.length,elapsedMs:Math.round(performance.now()-start)}));
}
const output=path.resolve('outputs/sep12-performance',process.env.PERF_RUN);
await mkdir(output,{recursive:true});
await writeFile(path.join(output,'api.json'),JSON.stringify({health,results,methodology:'99 real authenticated snapshot requests across 11 personas at bounded concurrency 1, 3 and 5. Credentials retained only in process memory. Not maximum-capacity or write-load certification.'},null,2));
assert.equal(results.filter(row=>row.error).length,0,'Some authenticated requests failed');
