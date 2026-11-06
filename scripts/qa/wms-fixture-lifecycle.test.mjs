import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import test from 'node:test';
import { runWmsFixtureLifecycle, recoverWmsFixtureLifecycle, readWmsFixtureManifest, WMS_FIXTURE_PROJECT_REF } from './wms-fixture-lifecycle.mjs';
import { assertWmsLiveFixtureCleanupReady } from './wms-live-fixture-guard.mjs';

const root = { table: 'warehouse.inventory_units', id: 'synthetic-unit-01' };
const key = r => `${r.table}:${r.id}`;
const plan = () => ({ version: 1, runId: 'wms-fixture-11111111-1111-4111-8111-111111111111',
  namespace: 'wms-fixture-11111111-1111-4111-8111-111111111111', projectRef: WMS_FIXTURE_PROJECT_REF,
  sourceCommit: 'a'.repeat(40), stockOrigin: 'synthetic', roots: [root],
  operations: [{ id: 'receive-one', action: 'receive', rootKeys: [key(root)] }] });

async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'wms-lifecycle-'));
  const manifestPath = join(dir, 'manifest.jsonl');
  const state = { calls: [], applied: false, archives: [], unknown: false };
  const envelope = p => ({ runId: p.runId, projectRef: p.projectRef, namespace: p.namespace, sourceCommit: p.sourceCommit });
  const records = p => state.applied ? [{ ...root, runId:p.runId, operationId:'receive-one', rowSha256:'b'.repeat(64) }] : [];
  const adapter = {
    id: 'offline-write-model',
    async inspect({ plan: p, records: rows=[] }) { state.calls.push('inspect'); return { ...envelope(p), appEnv: 'uat', complete: true,
      roots: p.roots.map(r => ({ ...r, ownerRunId: p.runId, classification: state.applied ? 'owned-synthetic' : 'reserved-synthetic', masterStock: false })),
      records: rows.map(r=>({...r,ownerRunId:p.runId,classification:'owned-synthetic',masterStock:false})) }; },
    async acquire({ plan: p }) { state.calls.push('acquire'); return { ...envelope(p), fence: 'exclusive-test-fence' }; },
    async execute({ plan: p, operation, idempotencyKey, fence }) {
      state.calls.push('execute');
      const durable = await readWmsFixtureManifest(manifestPath);
      assert(durable.events.some(e => e.type==='intent' && e.data.operationId===operation.id && e.data.idempotencyKey===idempotencyKey));
      state.applied = true;
      return { ...envelope(p), fence, operationId: operation.id, outcome: 'applied', receiptId: 'receipt-1', records:records(p) };
    },
    async drain({ plan: p, fence }) { state.calls.push('drain'); return { ...envelope(p), fence, writers: 0, fenced: true }; },
    async reconcile({ plan: p, intents, fence }) { state.calls.push('reconcile'); return { ...envelope(p), fence, complete: true,
      outcomes: intents.map(i => ({ operationId: i.operationId, outcome: state.unknown ? 'unknown' : state.applied ? 'applied' : 'not-applied', receiptId: state.applied ? 'receipt-1' : null })),records:records(p) }; },
    async archive({ plan: p, fence, idempotencyKey, records: rows, inventorySha256 }) {
      state.calls.push('archive');
      const durable = await readWmsFixtureManifest(manifestPath);
      assert(durable.events.some(e => e.type==='cleanup-intent' && e.data.idempotencyKey===idempotencyKey));
      assert.deepEqual(rows,records(p));
      if (state.applied && !state.archives.length) state.archives.push('archive-1');
      return { ...envelope(p), fence, idempotencyKey, inventorySha256, archiveIds: [...state.archives] };
    },
    async release() { state.calls.push('release'); },
  };
  const verifier = { id: 'offline-independent-read-model', async prove({ plan: p, fence, nonce }) {
    state.calls.push('prove'); return { ...envelope(p), fence, nonce, verifierId: this.id, complete: true,
      activeCount: 0, unknownCount: 0, foreignCount: 0, archiveIds: [...state.archives],
      retainedRecords: records(p),
      archivedRecords: records(p).map(r=>({...r,archiveId:state.archives[0]})) };
  } };
  const options = { manifestPath, plan: plan(), adapter, verifier };
  try { await fn({ options, state, adapter, verifier, manifestPath, envelope }); }
  finally { await rm(dir, { recursive: true, force: true, maxRetries: 8, retryDelay: 100 }); }
}

test('durable intent/response, finally cleanup, independent complete proof and unchanged pause', () => fixture(async ({ options, state, manifestPath }) => {
  const result = await runWmsFixtureLifecycle(options, async run => { await run.mutate('receive-one'); return 'journey-result'; });
  assert.equal(result.value, 'journey-result'); assert.equal(result.cleanupVerified, true);
  const manifest = await readWmsFixtureManifest(manifestPath);
  assert.deepEqual(manifest.events.map(e=>e.type), ['manifest','lease','intent','response','drained','reconciled','cleanup-intent','cleanup-response','proof','complete']);
  assert(state.calls.indexOf('drain') < state.calls.indexOf('archive'));
  assert(state.calls.indexOf('archive') < state.calls.indexOf('prove'));
  assert.equal(state.calls.at(-1), 'release');
  assert.throws(() => assertWmsLiveFixtureCleanupReady(), /PAUSED/);
}));

for (const [label, change] of [
  ['wrong project', p => { p.projectRef='another-project'; }],
  ['master stock', p => { p.stockOrigin='master'; }],
  ['foreign root', p => { p.operations[0].rootKeys=['warehouse.inventory_units:foreign']; }],
  ['foreign namespace', p => { p.namespace='other-run'; }],
  ['unstructured payload', p => { p.operations[0].payload={unit_id:'foreign'}; }],
]) test(`rejects ${label} before any adapter work`, () => fixture(async ({ options, state }) => {
  change(options.plan); await assert.rejects(runWmsFixtureLifecycle(options, async()=>{}));
  assert.deepEqual(state.calls, []);
}));

for (const field of ['projectRef','sourceCommit','appEnv','masterStock','ownerRunId','classification']) {
  test(`authoritative preflight rejects incorrect ${field} without writers/cleanup`, () => fixture(async ({ options, adapter, state }) => {
    const inspect=adapter.inspect;
    adapter.inspect=async c => { const r=await inspect(c); if (field==='masterStock') r.roots[0][field]=true;
      else if (['ownerRunId','classification'].includes(field)) r.roots[0][field]='foreign'; else r[field]='wrong'; return r; };
    await assert.rejects(runWmsFixtureLifecycle(options, async r=>r.mutate('receive-one')));
    assert(!state.calls.includes('execute')); assert(!state.calls.includes('archive'));
  }));
}

test('business failure remains a failure even after verified finally cleanup', () => fixture(async ({ options, state }) => {
  await assert.rejects(runWmsFixtureLifecycle(options, async r => { await r.mutate('receive-one'); throw Error('journey failed'); }), /journey failed/);
  assert(state.calls.includes('archive')); assert(state.calls.includes('prove'));
}));

test('unawaited admitted writer drains before cleanup; late writes are rejected', () => fixture(async ({ options, adapter, state }) => {
  const execute=adapter.execute; let finish, late;
  adapter.execute=async c => { await new Promise(resolve=>{finish=resolve;}); return execute(c); };
  const pending=runWmsFixtureLifecycle(options, async r => { late=r; void r.mutate('receive-one'); });
  while (!finish) await new Promise(resolve=>setImmediate(resolve));
  assert(!state.calls.includes('archive')); finish(); await pending;
  await assert.rejects(late.mutate('receive-one'), /closed/);
}));

test('aborted writer is reconciled and cleaned without passing aborted signal to cleanup', () => fixture(async ({ options, adapter, state }) => {
  const controller=new AbortController(); options.signal=controller.signal;
  const execute=adapter.execute; adapter.execute=async c=>{await execute(c); controller.abort(); throw Error('aborted after remote commit');};
  await assert.rejects(runWmsFixtureLifecycle(options, async r=>r.mutate('receive-one')));
  assert(state.calls.includes('drain')); assert(state.calls.includes('archive')); assert(state.calls.includes('prove'));
}));

test('unknown outcome cannot archive or certify; durable recovery never replays business commands', () => fixture(async ({ options, adapter, state, manifestPath }) => {
  const execute=adapter.execute; adapter.execute=async c=>{await execute(c); state.unknown=true; throw Error('connection lost');};
  await assert.rejects(runWmsFixtureLifecycle(options, async r=>r.mutate('receive-one')));
  assert(!state.calls.includes('archive'));
  const writes=state.calls.filter(c=>c==='execute').length; state.unknown=false;
  const recovery={manifestPath,expectedRunId:options.plan.runId,adapter,verifier:options.verifier};
  assert.equal((await recoverWmsFixtureLifecycle(recovery)).cleanupVerified,true);
  assert.equal((await recoverWmsFixtureLifecycle(recovery)).cleanupVerified,true);
  assert.equal(state.calls.filter(c=>c==='execute').length,writes);
  assert.deepEqual(state.archives,['archive-1']);
}));

for (const field of ['activeCount','unknownCount','foreignCount','archiveIds','archivedRecords','retainedRecords','nonce','verifierId','complete']) {
  test(`incomplete/foreign residual proof ${field} cannot certify cleanup`, () => fixture(async ({ options, verifier, manifestPath, state }) => {
    const prove=verifier.prove.bind(verifier); verifier.prove=async c=>{const p=await prove(c);
      if (field.endsWith('Count')) p[field]=1;
      else if (field==='archiveIds') p[field]=['foreign-archive'];
      else if (field==='archivedRecords') p[field]=[];
      else if (field==='retainedRecords') p[field]=[root,{...root,id:'unaccounted'}];
      else if (field==='complete') p[field]=false; else p[field]='wrong'; return p;};
    await assert.rejects(runWmsFixtureLifecycle(options, async r=>r.mutate('receive-one')));
    assert(state.calls.includes('prove'));
    assert(!(await readWmsFixtureManifest(manifestPath)).events.some(e=>e.type==='complete'));
  }));
}

test('same adapter/verifier identity cannot stand in for independent readback', () => fixture(async ({ options, state }) => {
  options.verifier.id=options.adapter.id; await assert.rejects(runWmsFixtureLifecycle(options, async()=>{})); assert.deepEqual(state.calls,[]);
}));

test('cleanup error retains durable intent and same idempotency key on recovery', () => fixture(async ({ options, adapter, manifestPath }) => {
  const archive=adapter.archive; let first=true;
  adapter.archive=async c=>{const result=await archive(c); if(first){first=false;throw Error('lost cleanup response');} return result;};
  await assert.rejects(runWmsFixtureLifecycle(options, async r=>r.mutate('receive-one')));
  await recoverWmsFixtureLifecycle({manifestPath,expectedRunId:options.plan.runId,adapter,verifier:options.verifier});
  const entries=(await readWmsFixtureManifest(manifestPath)).events.filter(e=>e.type==='cleanup-intent');
  assert.equal(entries.length,2); assert.equal(entries[0].data.idempotencyKey,entries[1].data.idempotencyKey);
}));

test('wrong recovery run, existing manifest, undeclared operation and duplicate mutation fail closed', () => fixture(async ({ options, manifestPath, state }) => {
  await runWmsFixtureLifecycle(options, async r=>{
    await assert.rejects(r.mutate('foreign-op')); await r.mutate('receive-one'); await assert.rejects(r.mutate('receive-one'));
  });
  const count=state.calls.length;
  await assert.rejects(runWmsFixtureLifecycle(options, async()=>{}));
  await assert.rejects(recoverWmsFixtureLifecycle({manifestPath,expectedRunId:'foreign',adapter:options.adapter,verifier:options.verifier}));
  assert.equal(state.calls.length,count);
}));

test('nonzero active writers forbid cleanup', () => fixture(async ({ options, adapter, state }) => {
  const drain=adapter.drain; adapter.drain=async c=>({...await drain(c),writers:1});
  await assert.rejects(runWmsFixtureLifecycle(options, async r=>r.mutate('receive-one')));
  assert(!state.calls.includes('archive'));
}));

test('response foreign run is not a valid checkpoint; reconcile still attempts exact owned cleanup', () => fixture(async ({ options, adapter, state, manifestPath }) => {
  const execute=adapter.execute; adapter.execute=async c=>({...await execute(c),runId:'foreign'});
  await assert.rejects(runWmsFixtureLifecycle(options, async r=>r.mutate('receive-one')));
  assert(state.calls.includes('reconcile')); assert(state.calls.includes('archive'));
  assert(!(await readWmsFixtureManifest(manifestPath)).events.some(e=>e.type==='response'));
}));

test('manifest records are hash chained, contain no raw response or credentials', () => fixture(async ({ options, manifestPath }) => {
  await runWmsFixtureLifecycle(options, async r=>r.mutate('receive-one'));
  const text=await readFile(manifestPath,'utf8'); const rows=text.trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].previousHash,null);
  assert(rows.slice(1).every((r,i)=>r.previousHash===rows[i].hash));
  assert(!text.includes('password')); assert(!text.includes('authorization'));
}));

for (const field of ['runId','operationId','rowSha256']) test(`foreign or changed retained ${field} blocks proof`, () => fixture(async ({options,verifier,state})=>{
  const prove=verifier.prove.bind(verifier);
  verifier.prove=async c=>{const p=await prove(c);p.retainedRecords[0][field]=field==='rowSha256'?'c'.repeat(64):'foreign';return p;};
  await assert.rejects(runWmsFixtureLifecycle(options, async r=>r.mutate('receive-one')),/retained provenance\/hash/);
  assert(state.calls.includes('prove'));
}));

test('master/foreign descendant from exact reconciliation blocks archival', () => fixture(async ({options,adapter,state})=>{
  const inspect=adapter.inspect; adapter.inspect=async c=>{const p=await inspect(c);if(c.records?.length)p.records[0].masterStock=true;return p;};
  await assert.rejects(runWmsFixtureLifecycle(options, async r=>r.mutate('receive-one')));
  assert(!state.calls.includes('archive'));
}));

test('caught mutation failure closes admission to later business writes', () => fixture(async ({options,adapter,state})=>{
  options.plan.operations.push({id:'later-step',action:'pick',rootKeys:[key(root)]});
  const execute=adapter.execute;adapter.execute=async c=>{await execute(c);if(c.operation.id==='receive-one')throw Error('lost response');return {...c,operationId:c.operation.id,outcome:'applied',receiptId:'receipt-2'};};
  await assert.rejects(runWmsFixtureLifecycle(options,async r=>{
    await assert.rejects(r.mutate('receive-one'));
    await assert.rejects(r.mutate('later-step'),/closed/);
  }));
  assert.equal(state.calls.filter(c=>c==='execute').length,1);
}));

for(const mode of ['partial','corrupt']) test(`${mode} durable manifest cannot start recovery or adapter calls`,()=>fixture(async ({options,manifestPath,state})=>{
  await runWmsFixtureLifecycle(options,async r=>r.mutate('receive-one'));
  const content=await readFile(manifestPath,'utf8');
  await writeFile(manifestPath,mode==='partial'?content.slice(0,-1):content.replace('receive-one','foreign-one'));
  const calls=state.calls.length;
  await assert.rejects(recoverWmsFixtureLifecycle({manifestPath,expectedRunId:options.plan.runId,adapter:options.adapter,verifier:options.verifier}));
  assert.equal(state.calls.length,calls);
}));

test('recovery rejects changed inventory under an existing archive idempotency key',()=>fixture(async ({options,adapter,manifestPath,state})=>{
  const archive=adapter.archive; adapter.archive=async c=>{await archive(c);throw Error('lost cleanup response');};
  await assert.rejects(runWmsFixtureLifecycle(options,async r=>r.mutate('receive-one')));
  const reconcile=adapter.reconcile;adapter.reconcile=async c=>{const r=await reconcile(c);r.records[0].rowSha256='d'.repeat(64);return r;};
  const calls=state.calls.filter(c=>c==='archive').length;
  await assert.rejects(recoverWmsFixtureLifecycle({manifestPath,expectedRunId:options.plan.runId,adapter,verifier:options.verifier}),/archive inventory changed/);
  assert.equal(state.calls.filter(c=>c==='archive').length,calls);
}));

test('no mutable records means known zero residue, without inventing an archive',()=>fixture(async({options,state})=>{
  const result=await runWmsFixtureLifecycle(options,async()=>undefined);
  assert.equal(result.cleanupVerified,true);assert.deepEqual(result.archiveIds,[]);assert(!state.calls.includes('execute'));
}));

test('pre-aborted run never dispatches business work',()=>fixture(async({options,state})=>{
  const controller=new AbortController();controller.abort();options.signal=controller.signal;
  await assert.rejects(runWmsFixtureLifecycle(options,async r=>r.mutate('receive-one')));
  assert(!state.calls.includes('execute'));assert(state.calls.includes('prove'));
}));

test('two owners cannot concurrently use the same durable manifest',()=>fixture(async({options,state,manifestPath})=>{
  let finish;
  const pending=runWmsFixtureLifecycle(options,async()=>new Promise(resolve=>{finish=resolve;}));
  while(!finish)await new Promise(resolve=>setImmediate(resolve));
  const calls=state.calls.length;
  await assert.rejects(recoverWmsFixtureLifecycle({manifestPath,expectedRunId:options.plan.runId,adapter:options.adapter,verifier:options.verifier}),/active writer/);
  assert.equal(state.calls.length,calls);finish();await pending;
}));

test('journal creation failure prevents adapter acquisition and mutation',()=>fixture(async({options,state,manifestPath})=>{
  options.manifestPath=join(manifestPath,'missing-parent','journal');
  await assert.rejects(runWmsFixtureLifecycle(options,async r=>r.mutate('receive-one')));
  assert.deepEqual(state.calls,[]);
}));

test('strict TypeScript consumer resolves lifecycle declarations and rejects incomplete adapters',()=>{
  const entry=fileURLToPath(new URL('./__wms_lifecycle_typecheck__.mts',import.meta.url));
  const source=`import {runWmsFixtureLifecycle,recoverWmsFixtureLifecycle, type FixtureRunOptions,type WmsFixtureAdapter} from './wms-fixture-lifecycle.mjs';
declare const options: FixtureRunOptions;
const result = await runWmsFixtureLifecycle(options, async writer => { await writer.mutate('receive-one'); return 1; });
const value:number=result.value;
// @ts-expect-error Exact operations are strings, not arbitrary mutation payloads.
runWmsFixtureLifecycle(options,writer=>writer.mutate({unit_id:'foreign'}));
// @ts-expect-error Recovery requires the exact run ID.
recoverWmsFixtureLifecycle({manifestPath:'journal',adapter:options.adapter,verifier:options.verifier});
// @ts-expect-error Archive cannot be silently omitted.
const incomplete:WmsFixtureAdapter={id:'partial'};
void value; void incomplete;`;
  const options={strict:true,noEmit:true,types:[],target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext};
  const host=ts.createCompilerHost(options),original=host.getSourceFile.bind(host);
  host.getSourceFile=(file,version,...args)=>resolve(file)===entry?ts.createSourceFile(file,source,version,true):original(file,version,...args);
  const program=ts.createProgram([entry],options,host);
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(d=>ts.flattenDiagnosticMessageText(d.messageText,'\n')),[]);
});
