import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanupDepartmentStorage } from './wms-department-storage-cleanup.mjs';
import { generateDepartmentCleanup } from './wms-department-cleanup.mjs';

// LOCAL MOCKS ONLY: no credentials, SDK client, network or live deletion.
// Fixtures retain reviewed synthetic identities and only the proof-check fields.
const manifests = await Promise.all(['second','postfix'].map(async name => JSON.parse(await readFile(
  new URL(`./fixtures/wms-department/${name}-manifest.json`, import.meta.url), 'utf8'))));
const files = [
  ['c39a8004-1165-45c1-874b-3f27e5c3ad08','ac555553-e327-45c5-aecb-dafdc200ce6e'],
  ['88ea6f4b-37d3-4ca5-b949-f1ec36cd718b','24f5941d-d4ba-4961-9234-a3b9a6d8f945'],
];
const requester = 'be0e8dcd-aba1-4a59-a1d8-b9d9c5fee47e';
const operator = '93a08670-c110-4244-97ec-477afcec759c';
const env = { APP_ENV:'uat', SUPABASE_PROJECT_REF:manifests[0].project,
  NEXT_PUBLIC_SUPABASE_URL:`https://${manifests[0].project}.supabase.co` };
const png = Buffer.from('89504e470d0a1a0a000000004c4f43414c204d4f434b', 'hex');

async function fixture(index = 0) {
  const manifest = structuredClone(manifests[index]);
  const root = await mkdtemp(path.join(tmpdir(), 'wms-storage-local-'));
  const calls = [];
  const tables = { products:[], department_stock_requests:[], fulfillment_orders:[] };
  const objects = new Map();
  manifest.cases.forEach((c,i) => {
    const objectPath = `acknowledgment-${c.orderId}/0/${files[index][i]}.png`;
    const lines = [{productId:c.productId,quantity:c.requestedQuantity}];
    tables.products.push({id:c.productId,sku:c.sku,attributes:{signoffRun:manifest.runId,synthetic:true}});
    tables.department_stock_requests.push({id:c.requestId,purpose:`Synthetic WMS signoff ${manifest.runId}`,
      lines,event_id:null,fulfillment_order_id:c.orderId,requested_by:requester});
    tables.fulfillment_orders.push({id:c.orderId,source:'department_request',external_reference:`REQ-${c.requestId}`,
      lines,packaging:[],parent_order_id:null,event_id:null,third_party_location_id:null,
      source_location_id:c.locationId,source_bin_id:c.binId,status:'completed',delivery_method:'internal_handover',
      acknowledged_by:requester,released_by:operator,acknowledgement_reference:`SYNTHETIC-${manifest.runId}`,
      acknowledgement_evidence_url:objectPath});
    objects.set(objectPath,{id:files[index][i],created_at:'2026-09-13T03:00:00Z',updated_at:'2026-09-13T03:00:00Z',
      metadata:{size:png.length,mimetype:'image/png'},bytes:Buffer.from(png)});
  });
  const f = {root,manifest,tables,objects,calls, beforeQuery:null, beforeList:null, beforeDownload:null, beforeRemove:null};
  const bucket = {
    async list(prefix, options) {
      calls.push(['list',prefix]);
      const override = await f.beforeList?.(prefix,options);
      if (override) return override;
      const entries = new Map();
      for (const [name,object] of objects) {
        if (!name.startsWith(prefix+'/')) continue;
        const relative = name.slice(prefix.length+1);
        const first = relative.split('/')[0];
        entries.set(first,relative.includes('/') ? {name:first,id:null} : {name:first,...object,bytes:undefined});
      }
      return {data:[...entries.values()],error:null};
    },
    async download(name) {
      calls.push(['download',name]);
      const override = await f.beforeDownload?.(name);
      if (override) return override;
      const object = objects.get(name);
      return object ? {data:new Blob([object.bytes]),error:null} : {data:null,error:{message:'not found'}};
    },
    async remove(names) {
      calls.push(['remove',...names]);
      const override = await f.beforeRemove?.(names);
      if (override) return override;
      const data = names.map(name => ({name,id:objects.get(name)?.id}));
      for (const name of names) objects.delete(name);
      return {data,error:null};
    },
  };
  f.client = {
    schema(schema) {
      assert.equal(schema,'warehouse');
      return {from(table) { return {select(columns,options) {
        assert.equal(options.count,'exact');
        return {eq(column,id) { return {async limit(limit) {
          calls.push(['select',table,id]);
          const override = await f.beforeQuery?.(table,id);
          if (override) return override;
          const data = tables[table].filter(r => r[column]===id);
          return {data:structuredClone(data.slice(0,limit)),count:data.length,error:null};
        }}; }};
      }}; }};
    },
    storage:{from(name) { assert.equal(name,'evidence'); return bucket; }},
  };
  f.run = (extra={}) => cleanupDepartmentStorage({root,manifest,client:f.client,env,apply:true,...extra});
  f.receipt = async () => JSON.parse(await readFile(path.join(root,'storage-cleanup-results.json'),'utf8'));
  return f;
}
const removed = f => f.calls.filter(c => c[0]==='remove');

for (const [index,run] of ['second','postfix'].entries()) test(`saved ${run} readback columns pass proof checks with mock Storage only`,async () => {
  const f=await fixture(index);
  const report=JSON.parse(await readFile(new URL(
    `./fixtures/wms-department/${run}-readback.json`,import.meta.url),'utf8'));
  assert.equal(report.runId,f.manifest.runId);
  assert.equal(report.project,f.manifest.project);
  for(const table of Object.keys(f.tables)) f.tables[table]=structuredClone(report.rows[`warehouse.${table}`]);
  for(const order of f.tables.fulfillment_orders) {
    assert.equal(order.source_location_id,null);
    assert.equal(order.source_bin_id,null);
    // The cleanup readback deliberately separates evidence values from row JSON.
    const paths=report.evidence.filter(x=>x.kind==='storage' && x.entity===`order:${order.id}`);
    assert.equal(paths.length,1);
    order.acknowledgement_evidence_url=paths[0].value;
  }
  for(const object of report.storageObjects) {
    assert.equal(object.bucket,'evidence');
    assert(f.objects.has(object.path));
    f.objects.get(object.path).id=object.id;
  }
  assert.equal((await f.run()).inventoryComplete,true);
  assert.equal(removed(f).length,2);
});

for (const index of [0,1]) test(`local mock: reviewed ${index ? 'postfix' : 'second'} deletes only two exact objects after all archives`,async () => {
  const f = await fixture(index);
  f.beforeRemove = async () => {
    const receipt = await f.receipt();
    assert.equal(receipt.objects.length,2);
    for (const item of receipt.objects) assert.deepEqual(await readFile(path.join(f.root,item.archive)),png);
    assert.equal(f.calls.filter(c=>c[0]==='download').length>=2,true);
  };
  const receipt = await f.run();
  assert.equal(receipt.inventoryComplete,true);
  assert.equal(removed(f).length,2);
  assert.equal(f.objects.size,0);
  assert.doesNotThrow(()=>generateDepartmentCleanup(f.manifest,{storageVerification:receipt}));
  assert.deepEqual(JSON.parse(await readFile(path.join(f.root,'storage-verification.json'),'utf8')),receipt);
});

for (const [label, mutate] of [
  ['full UUID collision',f=>{f.tables.products[1].attributes.signoffRun=f.manifest.runId.slice(0,8)+'-wrong';}],
  ['nonsynthetic product',f=>{f.tables.products[0].attributes.synthetic=false;}],
  ['wrong SKU',f=>{f.tables.products[0].sku='REAL';}],
  ['missing product',f=>{f.tables.products.pop();}],
  ['missing request',f=>{f.tables.department_stock_requests.pop();}],
  ['missing order',f=>{f.tables.fulfillment_orders.pop();}],
  ['request purpose',f=>{f.tables.department_stock_requests[0].purpose='Real request';}],
  ['request order link',f=>{f.tables.department_stock_requests[0].fulfillment_order_id=f.manifest.cases[1].orderId;}],
  ['request product',f=>{f.tables.department_stock_requests[0].lines=[{productId:'other',quantity:2}];}],
  ['order request link',f=>{f.tables.fulfillment_orders[0].external_reference='REQ-other';}],
  ['order source',f=>{f.tables.fulfillment_orders[0].source='ecommerce';}],
  ['order quantity',f=>{f.tables.fulfillment_orders[0].lines=[{productId:f.manifest.cases[0].productId,quantity:3}];}],
  ['order packaging',f=>{f.tables.fulfillment_orders[0].packaging=[{productId:'other',quantity:1}];}],
  ['cross-run location',f=>{f.tables.fulfillment_orders[0].source_location_id='other';}],
  ['wrong receipt actor',f=>{f.tables.fulfillment_orders[0].acknowledged_by=operator;}],
  ['wrong receipt reference',f=>{f.tables.fulfillment_orders[0].acknowledgement_reference='REAL';}],
  ['changed exact path',f=>{f.tables.fulfillment_orders[0].acknowledgement_evidence_url+= '.other';}],
]) test(`no Storage calls when fresh lineage fails: ${label}`,async () => {
  const f = await fixture(); mutate(f);
  await assert.rejects(f.run());
  assert.equal(f.calls.some(c=>c[0]!=='select'),false);
});

for (const response of [{data:[],count:0,error:null},{data:[],count:null,error:null},
  {data:[],count:1,error:{message:'denied'}},{data:[],count:2,error:null}]) {
  test(`partial/error DB response aborts before Storage (${JSON.stringify(response)})`,async () => {
    const f = await fixture(); f.beforeQuery=()=>response;
    await assert.rejects(f.run()); assert.equal(f.calls.some(c=>c[0]!=='select'),false);
  });
}

for (const mode of ['missing','extra','full-page','error','malformed','traversal']) test(`no deletion on partial or unexpected inventory: ${mode}`,async () => {
  const f = await fixture();
  if (mode==='missing') f.objects.delete([...f.objects.keys()][1]);
  if (mode==='extra') f.objects.set(`fulfillment/${f.manifest.cases[0].orderId}/extra.png`,{...f.objects.values().next().value});
  if (mode==='full-page') f.beforeList=()=>({data:Array.from({length:100},(_,i)=>({name:String(i),id:null})),error:null});
  if (mode==='error') f.beforeList=()=>({data:null,error:{message:'timeout'}});
  if (mode==='malformed') f.beforeList=()=>({data:null,error:null});
  if (mode==='traversal') f.beforeList=()=>({data:[{name:'..',id:null}],error:null});
  await assert.rejects(f.run()); assert.equal(removed(f).length,0);
});

test('last download failure archives nothing destructively; no first-object deletion',async () => {
  const f = await fixture(); const last=[...f.objects.keys()][1];
  f.beforeDownload=name=>name===last ? {data:null,error:{message:'download failed'}} : null;
  await assert.rejects(f.run(),/download failed/); assert.equal(removed(f).length,0);
});

test('archive corruption after write is detected before deletion',async () => {
  const f = await fixture(); let downloads=0;
  f.beforeDownload=async()=>{
    if (++downloads===2) {
      const receipt=await f.receipt();
      await writeFile(path.join(f.root,receipt.objects[0].archive),'corrupt');
    }
  };
  await assert.rejects(f.run(),/archive|hash/i); assert.equal(removed(f).length,0);
});

for (const change of ['lineage','inventory','version','bytes']) test(`rechecks ${change} after archiving before deletion`,async () => {
  const f=await fixture(); let downloads=0;
  f.beforeDownload=()=>{
    if (++downloads===2) {
      if(change==='lineage') f.tables.products[0].attributes.signoffRun='other';
      if(change==='inventory') f.objects.set(`delivery-${f.manifest.cases[0].orderId}/other.png`,{...f.objects.values().next().value});
      if(change==='version') f.objects.values().next().value.updated_at='2026-09-13T04:00:00Z';
      if(change==='bytes') f.objects.values().next().value.bytes=Buffer.from('changed');
    }
  };
  await assert.rejects(f.run()); assert.equal(removed(f).length,0);
});

test('uncertain successful deletion resumes same-run receipt without deleting an absent object again',async () => {
  const f=await fixture(); let deletes=0;
  f.beforeRemove=names=>{
    if(++deletes===1) {f.objects.delete(names[0]); return {data:null,error:{message:'response lost'}};}
  };
  await assert.rejects(f.run(),/response lost/);
  await assert.rejects(f.run(),/resume/i);
  f.beforeRemove=null;
  const result=await f.run({resume:true});
  assert.equal(result.inventoryComplete,true); assert.equal(removed(f).length,2);
  const calls=f.calls.length;
  assert.equal((await f.run({resume:true})).inventoryComplete,true);
  assert.equal(f.calls.slice(calls).some(c=>c[0]==='remove'),false);
});

for (const mode of ['foreign-run','manifest','path','archive','legacy','missing-unattempted','recreated']) test(`resume fails closed: ${mode}`,async () => {
  const f=await fixture();
  f.beforeRemove=()=>({data:null,error:{message:'stop'}});
  await assert.rejects(f.run());
  const receipt=await f.receipt();
  if(mode==='foreign-run') receipt.runId=manifests[1].runId;
  if(mode==='manifest') receipt.manifestSha256='0'.repeat(64);
  if(mode==='path') receipt.objects[0].path='shared/other.png';
  if(mode==='archive') await writeFile(path.join(f.root,receipt.objects[0].archive),'broken');
  if(mode==='legacy') delete receipt.version;
  if(mode==='missing-unattempted') f.objects.delete(receipt.objects[1].path);
  if(mode==='recreated') {receipt.objects[0].status='deleted-and-verified';}
  await writeFile(path.join(f.root,'storage-cleanup-results.json'),JSON.stringify(receipt));
  f.beforeRemove=null; const count=removed(f).length;
  await assert.rejects(f.run({resume:true})); assert.equal(removed(f).length,count);
});

test('wrong environment, no apply, unreviewed run and swapped valid UUIDs are rejected without queries',async () => {
  const f=await fixture();
  for(const extra of [{apply:false},{env:{...env,APP_ENV:'production'}},{env:{...env,NEXT_PUBLIC_SUPABASE_URL:'http://'+f.manifest.project+'.supabase.co'}},
    {env:{...env,PRODUCTION_SUPABASE_PROJECT_REF:f.manifest.project}}]) await assert.rejects(f.run(extra));
  [f.manifest.cases[0].orderId,f.manifest.cases[1].orderId]=[f.manifest.cases[1].orderId,f.manifest.cases[0].orderId];
  await assert.rejects(f.run()); assert.equal(f.calls.length,0);
});

test('resume requires complete original object metadata even for an uncertain absent object',async () => {
  const f=await fixture();
  f.beforeRemove=names=>{f.objects.delete(names[0]);return {data:null,error:{message:'lost response'}};};
  await assert.rejects(f.run());
  const receipt=await f.receipt();
  const absent=receipt.initialInventory.find(x=>!f.objects.has(x.path));
  delete absent.id;
  await writeFile(path.join(f.root,'storage-cleanup-results.json'),JSON.stringify(receipt));
  f.beforeRemove=null;
  const count=removed(f).length;
  await assert.rejects(f.run({resume:true}),/receipt.*identity/i);
  assert.equal(removed(f).length,count);
});

for(const mode of ['unproven-response','still-present','late-lineage-change']) test(`stops after first removal attempt: ${mode}`,async () => {
  const f=await fixture();
  f.beforeRemove=names=>{
    if(mode==='unproven-response') return {data:[],error:null};
    if(mode==='still-present') return {data:[{name:names[0]}],error:null};
    f.tables.products[1].attributes.synthetic=false;
  };
  await assert.rejects(f.run());
  assert.equal(removed(f).length,1);
  assert.equal((await f.receipt()).inventoryComplete,false);
  await assert.rejects(readFile(path.join(f.root,'storage-verification.json')),/ENOENT/);
});
