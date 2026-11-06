import { closeSync, fsyncSync, openSync, readFileSync, writeSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

export const WMS_FIXTURE_PROJECT_REF = 'kkoitlvydytdhlpxhuah';
const activePaths = new Set();
const eventTypes = new Set(['manifest','lease','intent','response','drained','reconciled','cleanup-intent','cleanup-response','proof','complete','failure']);
const rootKey = r => `${r.table}:${r.id}`;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 240;
function requireThat(condition, message) {
  if (!condition) { const error = new Error(`WMS fixture lifecycle: ${message}`); error.code='WMS_FIXTURE_LIFECYCLE_BLOCKED'; throw error; }
}
function exactKeys(value, keys) {
  requireThat(value && typeof value==='object' && !Array.isArray(value)
    && Object.keys(value).length===keys.length && keys.every(k=>Object.hasOwn(value,k)), 'unexpected contract fields');
}
function sameSet(actual, expected) {
  return Array.isArray(actual) && actual.length===expected.length && new Set(actual).size===actual.length
    && actual.every(item=>expected.includes(item));
}
function freeze(value) {
  if (value && typeof value==='object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function validatePlan(plan) {
  exactKeys(plan,['version','runId','namespace','projectRef','sourceCommit','stockOrigin','roots','operations']);
  requireThat(plan.version===1 && /^wms-fixture-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(plan.runId), 'exact UUID run ID required');
  requireThat(plan.namespace===plan.runId && plan.projectRef===WMS_FIXTURE_PROJECT_REF
    && /^[0-9a-f]{40}$/.test(plan.sourceCommit) && plan.stockOrigin==='synthetic', 'wrong project, namespace, commit or stock origin');
  requireThat(Array.isArray(plan.roots) && plan.roots.length>0 && plan.roots.length<=1000, 'bounded exact roots required');
  for (const root of plan.roots) {
    exactKeys(root,['table','id']);
    requireThat(/^(warehouse|procurement)\.[a-z_]+$/.test(root.table) && text(root.id), 'invalid fixture root');
  }
  const roots=plan.roots.map(rootKey);
  requireThat(new Set(roots).size===roots.length, 'duplicate fixture roots');
  requireThat(Array.isArray(plan.operations) && plan.operations.length>0 && plan.operations.length<=1000, 'bounded declared operations required');
  for (const op of plan.operations) {
    exactKeys(op,['id','action','rootKeys']);
    requireThat(/^[a-z][a-z0-9-]{0,79}$/.test(op.id) && /^[a-z][a-z0-9_-]{0,79}$/.test(op.action), 'invalid operation');
    requireThat(Array.isArray(op.rootKeys) && op.rootKeys.length>0 && new Set(op.rootKeys).size===op.rootKeys.length
      && op.rootKeys.every(id=>roots.includes(id)), 'foreign operation root');
  }
  requireThat(new Set(plan.operations.map(o=>o.id)).size===plan.operations.length, 'duplicate operation IDs');
  return freeze(structuredClone(plan));
}
function validateAdapters(adapter, verifier) {
  requireThat(text(adapter?.id) && text(verifier?.id) && adapter.id!==verifier.id && adapter!==verifier, 'separate read-only verifier required');
  for (const name of ['inspect','acquire','execute','drain','reconcile','archive','release']) requireThat(typeof adapter[name]==='function', `missing adapter ${name}`);
  requireThat(typeof verifier.prove==='function', 'missing independent proof');
}
function identity(result, plan, fence) {
  requireThat(result && ['runId','projectRef','namespace','sourceCommit'].every(k=>result[k]===plan[k]), 'foreign response identity');
  if (fence!==undefined) requireThat(result.fence===fence, 'foreign writer fence');
}
function inspectResult(result, plan, records) {
  identity(result,plan);
  requireThat(result.appEnv==='uat' && result.complete===true && Array.isArray(result.roots)
    && sameSet(result.roots.map(rootKey),plan.roots.map(rootKey)), 'incomplete UAT ownership preflight');
  requireThat(result.roots.every(r=>r.ownerRunId===plan.runId && r.masterStock===false
    && ['reserved-synthetic','owned-synthetic'].includes(r.classification)), 'master stock or foreign ownership');
  if(records) {
    requireThat(Array.isArray(result.records) && sameSet(result.records.map(rootKey),records.map(rootKey)), 'incomplete exact-row ownership');
    requireThat(result.records.every(r=>r.ownerRunId===plan.runId && r.masterStock===false && r.classification==='owned-synthetic'
      && records.some(expected=>rootKey(r)===rootKey(expected) && r.runId===expected.runId
        && r.operationId===expected.operationId && r.rowSha256===expected.rowSha256)), 'master stock, foreign provenance or changed row hash');
  }
}
const mutationKey = (plan,id) => `${plan.runId}:mutation:${id}`;
const cleanupKey = plan => `${plan.runId}:archive:v1`;
function outcome(result) {
  requireThat(result && ['applied','not-applied'].includes(result.outcome), 'unknown mutation outcome');
  requireThat(result.outcome==='applied' ? text(result.receiptId) : result.receiptId===null, 'missing outcome receipt');
  return { operationId: result.operationId, outcome: result.outcome, receiptId: result.receiptId };
}
function ownedRecords(records,plan,operationIds) {
  requireThat(Array.isArray(records) && new Set(records.map(rootKey)).size===records.length,'invalid retained row inventory');
  for(const row of records) {
    exactKeys(row,['table','id','runId','operationId','rowSha256']);
    requireThat(/^(warehouse|procurement|private|core)\.[a-z_]+$/.test(row.table) && text(row.id)
      && row.runId===plan.runId && operationIds.includes(row.operationId) && /^[0-9a-f]{64}$/.test(row.rowSha256),'invalid retained provenance/hash');
  }
  return records.map(r=>({table:r.table,id:r.id,runId:r.runId,operationId:r.operationId,rowSha256:r.rowSha256}));
}

// Append + fsync precedes every dispatch. A partial/corrupt journal is never
// repaired implicitly; an independently reviewed recovery must resolve it.
class Journal {
  constructor(path, plan, events, create) {
    this.plan=plan; this.events=events; this.broken=false;
    this.fd=openSync(path,create?'wx':'a',0o600);
    if (create) {
      try { this.append('manifest',plan); } catch (error) { closeSync(this.fd); throw error; }
    }
  }
  append(type,data) {
    requireThat(!this.broken,'journal is not durable; recovery required');
    const record={sequence:this.events.length,previousHash:this.events.at(-1)?.hash??null,type,data};
    const entry={...record,hash:digest(record)};
    const bytes=Buffer.from(`${JSON.stringify(entry)}\n`);
    try {
      let offset=0;
      while (offset<bytes.length) { const written=writeSync(this.fd,bytes,offset,bytes.length-offset); requireThat(written>0,'journal write failed'); offset+=written; }
      fsyncSync(this.fd); this.events.push(entry);
    } catch(error) { this.broken=true; throw error; }
  }
  close() { closeSync(this.fd); }
}

export function readWmsFixtureManifest(path) {
  const content=readFileSync(path,'utf8');
  requireThat(content.endsWith('\n'),'partial durable manifest');
  const events=content.slice(0,-1).split('\n').map(line=>JSON.parse(line));
  const intents=new Set(); const responses=new Set();
  let plan;
  for (let i=0;i<events.length;i++) {
    const e=events[i]; exactKeys(e,['sequence','previousHash','type','data','hash']);
    requireThat(e.sequence===i && e.previousHash===(events[i-1]?.hash??null) && eventTypes.has(e.type)
      && e.hash===digest({sequence:e.sequence,previousHash:e.previousHash,type:e.type,data:e.data}), 'manifest integrity failure');
    if(i===0) { requireThat(e.type==='manifest','missing durable manifest'); plan=validatePlan(e.data); }
    else requireThat(e.type!=='manifest','duplicate manifest');
    if(e.type==='intent') {
      requireThat(plan.operations.some(o=>o.id===e.data.operationId) && !intents.has(e.data.operationId)
        && e.data.idempotencyKey===mutationKey(plan,e.data.operationId),'invalid mutation intent');
      intents.add(e.data.operationId);
    }
    if(e.type==='response') {
      requireThat(intents.has(e.data.operationId) && !responses.has(e.data.operationId),'unbound mutation response');
      outcome(e.data); ownedRecords(e.data.records,plan,[...intents]); responses.add(e.data.operationId);
    }
  }
  return {plan,events};
}

function proofResult(proof, plan, fence, nonce, verifier, archiveIds, records) {
  identity(proof,plan,fence);
  requireThat(proof.nonce===nonce && proof.verifierId===verifier.id && proof.complete===true
    && proof.activeCount===0 && proof.unknownCount===0 && proof.foreignCount===0,'active, unknown, foreign or incomplete residual proof');
  requireThat(sameSet(proof.archiveIds,archiveIds) && Array.isArray(proof.retainedRecords) && Array.isArray(proof.archivedRecords), 'archive accounting incomplete');
  for (const r of proof.retainedRecords) exactKeys(r,['table','id','runId','operationId','rowSha256']);
  for (const r of proof.archivedRecords) exactKeys(r,['table','id','runId','operationId','rowSha256','archiveId']);
  requireThat(sameSet(proof.archivedRecords.map(rootKey),proof.retainedRecords.map(rootKey))
    && proof.archivedRecords.every(r=>archiveIds.includes(r.archiveId))
    && sameSet([...new Set(proof.archivedRecords.map(r=>r.archiveId))],archiveIds), 'unaccounted retained history or archive ID');
  const canonical=r=>({table:r.table,id:r.id,runId:r.runId,operationId:r.operationId,rowSha256:r.rowSha256});
  const expected=records.map(r=>digest(canonical(r)));
  requireThat(sameSet(proof.retainedRecords.map(r=>digest(canonical(r))),expected)
    && sameSet(proof.archivedRecords.map(r=>digest(canonical(r))),expected),'retained provenance/hash does not match exact reconciled rows');
}

async function cleanup(journal, adapter, verifier, fence, journeySucceeded) {
  const {plan}=journal; const context={plan,fence};
  inspectResult(await adapter.inspect(context),plan);
  const intents=journal.events.filter(e=>e.type==='intent').map(e=>e.data);
  const reconciled=await adapter.reconcile({...context,intents:structuredClone(intents)});
  identity(reconciled,plan,fence);
  requireThat(reconciled.complete===true && Array.isArray(reconciled.outcomes)
    && sameSet(reconciled.outcomes.map(o=>o.operationId),intents.map(i=>i.operationId)), 'incomplete intent reconciliation');
  const outcomes=reconciled.outcomes.map(outcome);
  const records=ownedRecords(reconciled.records,plan,outcomes.filter(o=>o.outcome==='applied').map(o=>o.operationId));
  requireThat(!outcomes.some(o=>o.outcome==='applied') || records.length>0,'applied mutations have no retained rows');
  for(const e of journal.events.filter(e=>e.type==='response')) {
    const actual=outcomes.find(o=>o.operationId===e.data.operationId);
    requireThat(actual.outcome===e.data.outcome && actual.receiptId===e.data.receiptId,'reconciliation contradicts durable response');
    requireThat(e.data.records.every(r=>records.some(current=>rootKey(current)===rootKey(r))),'reconciliation lost a durable retained row');
  }
  inspectResult(await adapter.inspect({...context,records:structuredClone(records)}),plan,records);
  journal.append('reconciled',{outcomes,records});
  const idempotencyKey=cleanupKey(plan);
  const inventorySha256=digest(records.toSorted((a,b)=>rootKey(a)<rootKey(b)?-1:rootKey(a)>rootKey(b)?1:0));
  requireThat(journal.events.filter(e=>e.type==='cleanup-intent').every(e=>e.data.inventorySha256===inventorySha256),'archive inventory changed; explicit review required');
  journal.append('cleanup-intent',{idempotencyKey,inventorySha256,records});
  const archived=await adapter.archive({...context,idempotencyKey,inventorySha256,outcomes:structuredClone(outcomes),records:structuredClone(records)});
  identity(archived,plan,fence);
  requireThat(archived.idempotencyKey===idempotencyKey && archived.inventorySha256===inventorySha256 && Array.isArray(archived.archiveIds)
    && archived.archiveIds.every(text) && new Set(archived.archiveIds).size===archived.archiveIds.length,'invalid archive receipt');
  journal.append('cleanup-response',{idempotencyKey,inventorySha256,archiveIds:archived.archiveIds});
  const nonce=randomUUID();
  const proof=await verifier.prove({...context,nonce,outcomes:structuredClone(outcomes)});
  proofResult(proof,plan,fence,nonce,verifier,archived.archiveIds,records);
  journal.append('proof',{verifierId:verifier.id,nonce,archiveIds:proof.archiveIds,
    retainedRecords:proof.retainedRecords,archivedRecords:proof.archivedRecords,activeCount:0,unknownCount:0,foreignCount:0});
  journal.append('complete',{cleanupVerified:true,journeySucceeded});
  return {cleanupVerified:true,archiveIds:[...archived.archiveIds]};
}

async function lifecycle(options, body, recovery) {
  const {adapter,verifier}=options; validateAdapters(adapter,verifier);
  const path=resolve(options.manifestPath);
  requireThat(!activePaths.has(path),'manifest already owned by an active writer');
  let original=recovery?readWmsFixtureManifest(path):null;
  const plan=validatePlan(recovery?original.plan:options.plan);
  if(recovery) requireThat(options.expectedRunId===plan.runId,'foreign recovery run ID');
  activePaths.add(path);
  let journal, fence, closing=false, value, cleaned;
  const errors=[]; const pending=[]; const dispatched=new Set();
  const fail=(error)=>{errors.push(error);};
  try {
    if(!recovery) journal=new Journal(path,plan,[],true);
    inspectResult(await adapter.inspect({plan}),plan);
    const lease=await adapter.acquire({plan,recovery});
    identity(lease,plan); requireThat(text(lease.fence),'exclusive writer fence required'); fence=lease.fence;
    if(recovery) {
      // The adapter fences other processes first; re-read after acquiring it.
      const latest=readWmsFixtureManifest(path);
      requireThat(digest(latest.plan)===digest(plan),'manifest changed while acquiring recovery fence');
      original=latest; journal=new Journal(path,plan,original.events,false);
    }
    journal.append('lease',{fence,recovery});
    if(!recovery) {
      const run=Object.freeze({mutate(operationId) {
        if(closing || errors.length) return Promise.reject(new Error('WMS fixture lifecycle: writer is closed'));
        const operation=plan.operations.find(o=>o.id===operationId);
        if(!operation || dispatched.has(operationId)) return Promise.reject(new Error('WMS fixture lifecycle: undeclared or duplicate operation'));
        if(options.signal?.aborted) return Promise.reject(options.signal.reason??new Error('Aborted'));
        dispatched.add(operationId);
        const task=(async()=>{
          inspectResult(await adapter.inspect({plan,fence,operation}),plan);
          requireThat(!errors.length,'writer is closed after an earlier failure');
          if(options.signal?.aborted) throw options.signal.reason??new Error('Aborted');
          const idempotencyKey=mutationKey(plan,operationId);
          journal.append('intent',{operationId,idempotencyKey});
          const receipt=await adapter.execute({plan,fence,operation,idempotencyKey,signal:options.signal});
          identity(receipt,plan,fence); requireThat(receipt.operationId===operationId,'foreign operation response');
          const records=ownedRecords(receipt.records,plan,[operationId]);
          requireThat(receipt.outcome==='applied' ? records.length>0 : records.length===0,'outcome and retained rows disagree');
          journal.append('response',{...outcome(receipt),records});
          return outcome(receipt);
        })();
        pending.push(task); task.catch(fail); return task;
      }});
      try { value=await body(run); } catch(error) { if(!errors.includes(error)) fail(error); }
    }
  } catch(error) { fail(error); }
  finally {
    closing=true;
    await Promise.allSettled(pending);
    if(options.signal?.aborted && !errors.includes(options.signal.reason)) fail(options.signal.reason??new Error('Aborted'));
    if(fence) {
      let drainedSafely=false;
      try {
        // Remote writers must be fenced/drained even if a local disk failure
        // prevents cleanup. Never archive merely because JS promises settled.
        const drained=await adapter.drain({plan,fence});
        identity(drained,plan,fence); requireThat(drained.writers===0 && drained.fenced===true,'writers are not drained and fenced');
        drainedSafely=true;
        requireThat(journal && !journal.broken,'journal unavailable; leave fenced run for recovery');
        journal.append('drained',{fence});
        cleaned=await cleanup(journal,adapter,verifier,fence,errors.length===0);
      } catch(error) { fail(error); }
      if(drainedSafely) {
        try { await adapter.release({plan,fence}); } catch(error) { fail(error); }
      }
    }
    if(errors.length && journal && !journal.broken) {
      try { journal.append('failure',{code:'WMS_FIXTURE_LIFECYCLE_FAILED',errorCount:errors.length}); } catch(error) { fail(error); }
    }
    try { journal?.close(); } catch(error) { fail(error); }
    activePaths.delete(path);
  }
  if(errors.length) throw new AggregateError(errors,`WMS fixture lifecycle failed: ${errors.map(e=>e?.message??String(e)).join('; ')}`);
  requireThat(cleaned?.cleanupVerified===true,'cleanup not verified');
  return {...cleaned,value};
}

export function runWmsFixtureLifecycle(options, body) {
  requireThat(typeof body==='function','journey callback required');
  return lifecycle(options,body,false);
}
export function recoverWmsFixtureLifecycle(options) { return lifecycle(options,null,true); }
