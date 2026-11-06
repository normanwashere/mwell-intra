import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertFixtureDatabaseTarget, connectPostgresFixtureAdapter, createRepresentativeFixturePlan } from './wms-fixture-postgres-adapter.mjs';
import { readWmsFixtureManifest, recoverWmsFixtureLifecycle, runWmsFixtureLifecycle } from './wms-fixture-lifecycle.mjs';
import { assertWmsLiveFixtureCleanupReady } from './wms-live-fixture-guard.mjs';

function requireInput(ok){if(!ok)throw Error('Invalid fixed fixture runner input');}
export function parseRunnerInput(command,text){
  requireInput(['prepare','run','recover'].includes(command)&&Buffer.byteLength(text)<=16384);
  const input=JSON.parse(text);
  requireInput(input&&typeof input==='object'&&!Array.isArray(input));
  const fields=command==='prepare'?['sourceCommit','runId']:['databaseUrl','sourceCommit','runId','manifestPath','locationId','binId'];
  requireInput(Object.keys(input).every(k=>fields.includes(k)));
  for(const key of fields)requireInput(command==='prepare'&&key==='runId'&&input[key]===undefined||typeof input[key]==='string'&&input[key].length>0&&input[key].length<=4096);
  createRepresentativeFixturePlan(input);
  if(command!=='prepare')assertFixtureDatabaseTarget(input.databaseUrl);
  return input;
}

export async function runFixtureCommand(command,raw,{connector=connectPostgresFixtureAdapter,lifecycle=runWmsFixtureLifecycle,recovery=recoverWmsFixtureLifecycle,signal,onObservation}={}){
  const input=parseRunnerInput(command,JSON.stringify(raw));
  const plan=createRepresentativeFixturePlan(input);
  if(command==='prepare')return {plan,executed:false};
  assertWmsLiveFixtureCleanupReady();
  if(command==='recover'){
    const saved=readWmsFixtureManifest(input.manifestPath);
    requireInput(saved.plan.runId===input.runId&&saved.plan.sourceCommit===input.sourceCommit);
  }
  const sessions=await connector({databaseUrl:input.databaseUrl,bindings:{locationId:input.locationId,binId:input.binId},onObservation});
  try{
    const shared={manifestPath:input.manifestPath,adapter:sessions.adapter,verifier:sessions.verifier};
    const result=command==='recover'?await recovery({...shared,expectedRunId:input.runId})
      :await lifecycle({...shared,plan,signal},writer=>writer.mutate('seed-one-serial'));
    return {runId:plan.runId,sourceCommit:plan.sourceCommit,cleanupVerified:result.cleanupVerified,archiveIds:result.archiveIds};
  }finally{await sessions.close();}
}

async function readInput(){
  requireInput(!process.stdin.isTTY);let text='';
  for await(const chunk of process.stdin){text+=chunk;requireInput(Buffer.byteLength(text)<=16384);}
  return text;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const controller=new AbortController();
  const abort=()=>controller.abort(Error('Runner interrupted; drain and cleanup required'));
  process.on('SIGINT',abort);process.on('SIGTERM',abort);
  try{
    requireInput(process.argv.length===3);
    const command=process.argv[2];
    const result=await runFixtureCommand(command,parseRunnerInput(command,await readInput()),{signal:controller.signal,
      onObservation:observation=>process.stderr.write(`${JSON.stringify({observation})}\n`)});
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }catch{
    // Connection and server errors may contain credentials or business data.
    process.stderr.write('WMS fixture runner failed closed. Retain the manifest and use reviewed recovery; no success is claimed.\n');
    process.exitCode=1;
  }finally{process.off('SIGINT',abort);process.off('SIGTERM',abort);}
}
