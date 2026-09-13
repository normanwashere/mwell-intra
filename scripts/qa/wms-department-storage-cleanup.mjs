import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { lstat, mkdir, open, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateDepartmentCleanup } from './wms-department-cleanup.mjs';

// Exact four objects reviewed in the second/postfix local evidence reports.
// Inventory is a refusal boundary, never an authorization to delete discoveries.
const REVIEWED = {
  '6b7e1a7c-8dee-4d43-a7ec-d3f7abaaeaa3': [
    ['48c8f4b9-7d3b-4e93-8fff-49faf832d10f','89561515-0b63-4cc9-901e-a282fa640db9','c39a8004-1165-45c1-874b-3f27e5c3ad08'],
    ['9ae80161-8a4c-4c38-aa94-4f597275c571','1dd8d9d6-9484-4340-9da9-79470735ce92','ac555553-e327-45c5-aecb-dafdc200ce6e'],
  ],
  '449835d7-8d30-4418-a171-4394382be2c6': [
    ['250cf255-f4db-4afd-b1c5-296dbf78be94','abc8f786-5974-4620-9e59-c95f93194d9f','88ea6f4b-37d3-4ca5-b949-f1ec36cd718b'],
    ['d99517fa-6436-40b0-aa95-65067927f6cf','922e36ce-b955-4caa-9c21-06add1338a7b','24f5941d-d4ba-4961-9234-a3b9a6d8f945'],
  ],
};
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => JSON.stringify(value, function(key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(k => [k,item[k]])) : item;
});
const proofHash = value => hash(canonical(value));

function scope(manifest, env, apply) {
  generateDepartmentCleanup(manifest); // Syntax/scope only, NOT live ownership proof.
  assert.equal(apply,true,'Explicit --apply is required');
  assert.equal(env.APP_ENV,'uat');
  assert.equal(env.SUPABASE_PROJECT_REF,manifest.project);
  assert.equal(new URL(env.NEXT_PUBLIC_SUPABASE_URL).href,`https://${manifest.project}.supabase.co/`);
  assert.notEqual(env.PRODUCTION_SUPABASE_PROJECT_REF,manifest.project);
  const m=structuredClone(manifest);
  m.cases.sort((a,b)=>a.viewport.localeCompare(b.viewport));
  assert(Object.hasOwn(REVIEWED,m.runId),'Unreviewed run; only the exact four approved photos are in scope');
  const expected=REVIEWED[m.runId].map(([requestId,orderId,file],i)=>{
    assert.equal(m.cases[i].requestId,requestId,'Reviewed request identity mismatch');
    assert.equal(m.cases[i].orderId,orderId,'Reviewed order identity mismatch');
    return `acknowledgment-${orderId}/0/${file}.png`;
  });
  return {m,expected};
}

async function freshLineage(client,m,expected) {
  const proof=[];
  const one=async (table,id)=>{
    const r=await client.schema('warehouse').from(table).select('*',{count:'exact'}).eq('id',id).limit(2);
    assert(!r.error,r.error?.message);
    assert(Array.isArray(r.data) && r.count===1 && r.data.length===1,`Incomplete live ${table} ownership proof`);
    assert.equal(r.data[0].id,id);
    return r.data[0];
  };
  for (const [i,c] of m.cases.entries()) {
    const product=await one('products',c.productId);
    assert.equal(product.sku,c.sku,'Product SKU mismatch');
    assert.equal(product.attributes?.signoffRun,m.runId,'Full-UUID product ownership mismatch');
    assert.equal(product.attributes?.synthetic,true,'Product is not synthetic');
    const request=await one('department_stock_requests',c.requestId);
    const order=await one('fulfillment_orders',c.orderId);
    for (const r of [request,order]) {
      assert(Array.isArray(r.lines) && r.lines.length===1,'Unexpected lineage lines');
      assert.equal(r.lines[0].productId,c.productId,'Line product mismatch');
      assert.equal(r.lines[0].quantity,c.requestedQuantity,'Line quantity mismatch');
      assert.equal(r.event_id,null,'Event lineage is outside scope');
    }
    assert.equal(request.purpose,`Synthetic WMS signoff ${m.runId}`,'Request purpose mismatch');
    assert.equal(request.fulfillment_order_id,c.orderId,'Request/order lineage mismatch');
    assert.equal(order.external_reference,`REQ-${c.requestId}`,'Order/request lineage mismatch');
    assert.equal(order.source,'department_request');
    assert.deepEqual(order.packaging,[]);
    assert.equal(order.parent_order_id,null);
    assert.equal(order.third_party_location_id,null);
    assert(order.source_location_id===null || order.source_location_id===c.locationId,'Order location mismatch');
    assert(order.source_bin_id===null || order.source_bin_id===c.binId,'Order bin mismatch');
    assert.equal(order.status,'completed','Only the reviewed completed acknowledgments may be cleaned');
    assert.equal(order.delivery_method,'internal_handover');
    assert(UUID.test(request.requested_by) && UUID.test(order.released_by),'Missing actor lineage');
    assert.equal(order.acknowledged_by,request.requested_by);
    assert.notEqual(order.released_by,order.acknowledged_by);
    assert.equal(order.acknowledgement_reference,`SYNTHETIC-${m.runId}`);
    assert.equal(order.acknowledgement_evidence_url,expected[i],'Exact acknowledgment path mismatch');
    proof.push({product,request,order});
  }
  return proof;
}

async function inventory(bucket,m) {
  const found=[];
  let visited=0;
  const walk=async (prefix,depth=0)=>{
    assert(depth<=3 && ++visited<=30,'Unexpected inventory depth/volume');
    const r=await bucket.list(prefix,{limit:100,sortBy:{column:'name',order:'asc'}});
    assert(!r.error,r.error?.message);
    assert(Array.isArray(r.data) && r.data.length<100,'Partial inventory; manual review required');
    const seen=new Set();
    for (const entry of r.data) {
      assert(entry && /^[A-Za-z0-9._-]+$/.test(entry.name) && !['.','..'].includes(entry.name),'Unsafe inventory entry');
      assert(!seen.has(entry.name),'Duplicate inventory entry'); seen.add(entry.name);
      const name=`${prefix}/${entry.name}`;
      if (entry.id===null) await walk(name,depth+1);
      else {
        assert(UUID.test(entry.id),'Missing object identity');
        assert(Number.isFinite(Date.parse(entry.created_at)) && Number.isFinite(Date.parse(entry.updated_at)),'Missing object version');
        assert(Number.isSafeInteger(entry.metadata?.size) && entry.metadata.size>0 && entry.metadata.size<=8388608,'Invalid object size');
        assert.equal(entry.metadata.mimetype,'image/png');
        found.push({path:name,id:entry.id,created_at:entry.created_at,updated_at:entry.updated_at,metadata:entry.metadata});
      }
    }
  };
  for (const c of m.cases) for (const prefix of [`acknowledgment-${c.orderId}`,`fulfillment/${c.orderId}`,`delivery-${c.orderId}`]) await walk(prefix);
  assert.equal(new Set(found.map(x=>x.path)).size,found.length);
  return found.sort((a,b)=>a.path.localeCompare(b.path));
}

async function regularFile(file) {
  const stat=await lstat(file);
  assert(stat.isFile() && !stat.isSymbolicLink(),'Unsafe local receipt/archive file');
  return readFile(file);
}
async function jsonIfExists(file) {
  try { return JSON.parse(await regularFile(file)); }
  catch(error) { if(error.code==='ENOENT') return null; throw error; }
}
async function atomicJson(file,value) {
  const temp=`${file}.${randomUUID()}.tmp`;
  const handle=await open(temp,'wx');
  try { await handle.writeFile(JSON.stringify(value,null,2)); await handle.sync(); }
  finally { await handle.close(); }
  await rename(temp,file);
}
async function verifyArchive(root,record) {
  assert(/^[a-f0-9]{64}$/.test(record.sha256),'Invalid archive hash');
  assert.equal(record.archive,`archived-evidence/${record.sha256}.png`,'Unsafe archive path');
  assert.equal(await realpath(path.join(root,'archived-evidence')),path.join(root,'archived-evidence'),'Archive directory redirected');
  const bytes=await regularFile(path.join(root,record.archive));
  assert.equal(hash(bytes),record.sha256,'Archive hash mismatch');
  assert.equal(bytes.length,record.size,'Archive size mismatch');
}
async function downloadBytes(bucket,item) {
  const response=await bucket.download(item.path);
  assert(!response.error,response.error?.message);
  assert(response.data && typeof response.data.arrayBuffer==='function','Missing download bytes');
  const bytes=Buffer.from(await response.data.arrayBuffer());
  assert.equal(bytes.length,item.metadata.size,'Downloaded size changed');
  assert.equal(bytes.subarray(0,8).toString('hex'),'89504e470d0a1a0a','Not PNG evidence');
  return bytes;
}

export async function cleanupDepartmentStorage({root,manifest,client,env=process.env,apply=false,resume=false}) {
  const {m,expected}=scope(manifest,env,apply);
  root=await realpath(root);
  const receiptFile=path.join(root,'storage-cleanup-results.json');
  const verificationFile=path.join(root,'storage-verification.json');
  const lockFile=path.join(root,'storage-cleanup.lock');
  // Concurrent executors cannot share progress. A crash leaves a lock for manual review.
  const lock=await open(lockFile,'wx');
  let receipt;
  let writable=false;
  try {
    receipt=await jsonIfExists(receiptFile);
    const verification=await jsonIfExists(verificationFile);
    if(receipt) {
      assert(resume,'Existing receipt requires explicit --resume');
      assert.equal(receipt.version,2,'Legacy/unproven receipt cannot resume');
      assert.equal(receipt.runId,m.runId,'Receipt run mismatch');
      assert.equal(receipt.project,m.project);
      assert.equal(receipt.manifestSha256,proofHash(m),'Receipt manifest mismatch');
      assert.equal(receipt.verifiedBy,'automated-storage-audit');
      assert.equal(receipt.evidenceRef,'storage-cleanup-results.json');
      assert(Number.isFinite(Date.parse(receipt.verifiedAt)),'Missing receipt verification time');
      assert(/^[a-f0-9]{64}$/.test(receipt.lineageSha256),'Missing receipt lineage proof');
      assert.deepEqual(receipt.expectedPaths,expected,'Receipt exact scope mismatch');
      assert(Array.isArray(receipt.initialInventory) && Array.isArray(receipt.objects) && Array.isArray(receipt.failures),'Incomplete receipt');
      assert.deepEqual(receipt.initialInventory.map(x=>x.path).sort(),[...expected].sort(),'Receipt inventory incomplete');
      assert.equal(new Set(receipt.initialInventory.map(x=>x.id)).size,expected.length,'Duplicate receipt object identity');
      for(const item of receipt.initialInventory) {
        assert(UUID.test(item.id),'Missing receipt object identity');
        assert(Number.isFinite(Date.parse(item.created_at)) && Number.isFinite(Date.parse(item.updated_at)),'Missing receipt object version');
        assert(Number.isSafeInteger(item.metadata?.size) && item.metadata.size>0 && item.metadata.size<=8388608,'Invalid receipt object size');
        assert.equal(item.metadata.mimetype,'image/png');
      }
      assert.equal(new Set(receipt.objects.map(x=>x.path)).size,receipt.objects.length);
      for(const record of receipt.objects) {
        assert(expected.includes(record.path) && record.bucket==='evidence','Receipt object outside exact scope');
        assert(['archived','delete-requested','deleted-and-verified'].includes(record.status),'Unknown receipt progress');
        assert.equal(record.size,receipt.initialInventory.find(x=>x.path===record.path).metadata.size,'Receipt/archive size mismatch');
        await verifyArchive(root,record);
      }
      if(receipt.inventoryComplete) assert(receipt.objects.length===expected.length
        && receipt.objects.every(x=>x.status==='deleted-and-verified'),'Unproven complete receipt');
      if(verification) assert.deepEqual(verification,receipt,'Conflicting verification receipt');
    } else {
      assert(!resume,'No receipt to resume');
      assert(!verification,'Unproven preexisting verification receipt');
    }
    // Validate every case against fresh DB rows before ANY Storage calls.
    const lineage=await freshLineage(client,m,expected);
    const lineageSha256=proofHash(lineage);
    if(receipt) assert.equal(receipt.lineageSha256,lineageSha256,'Live lineage changed since receipt');
    const bucket=client.storage.from('evidence');
    const initial=await inventory(bucket,m);
    const checkInventory=current=>{
      assert(current.every(x=>expected.includes(x.path)),'Unexpected object: exact scope exceeded');
      for(const name of expected) {
        const live=current.find(x=>x.path===name);
        const record=receipt?.objects.find(x=>x.path===name);
        if(!live) assert(record && ['delete-requested','deleted-and-verified'].includes(record.status),'Partial inventory: missing unattempted object');
        else {
          assert(record?.status!=='deleted-and-verified','Deleted object recreated; review required');
          if(receipt) assert.deepEqual(live,receipt.initialInventory.find(x=>x.path===name),'Object version changed');
        }
      }
    };
    checkInventory(initial);
    if(!receipt) {
      receipt={version:2,runId:m.runId,project:m.project,manifestSha256:proofHash(m),lineageSha256,
        expectedPaths:expected,initialInventory:initial,inventoryComplete:false,verifiedBy:'automated-storage-audit',
        evidenceRef:'storage-cleanup-results.json',verifiedAt:new Date().toISOString(),objects:[],failures:[]};
      await writeFile(receiptFile,JSON.stringify(receipt,null,2),{flag:'wx'});
    }
    writable=true;
    const persist=()=>atomicJson(receiptFile,receipt);
    await mkdir(path.join(root,'archived-evidence'),{recursive:true});
    assert.equal(await realpath(path.join(root,'archived-evidence')),path.join(root,'archived-evidence'),'Archive directory redirected');
    // Two phases: ALL downloads + disk hash verification before the first remove.
    for(const item of initial) {
      const bytes=await downloadBytes(bucket,item);
      const sha256=hash(bytes);
      let record=receipt.objects.find(x=>x.path===item.path);
      if(record) assert.equal(sha256,record.sha256,'Resumed object bytes changed');
      else {
        const archive=`archived-evidence/${sha256}.png`;
        const file=path.join(root,archive);
        try {
          const handle=await open(file,'wx');
          try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
        } catch(error) { if(error.code!=='EEXIST') throw error; }
        record={bucket:'evidence',path:item.path,sha256,size:bytes.length,archive,status:'archived'};
        await verifyArchive(root,record);
        receipt.objects.push(record);
        await persist();
      }
    }
    assert.equal(receipt.objects.length,expected.length,'Archive inventory incomplete');
    const recheck=async()=>{
      assert.equal(proofHash(await freshLineage(client,m,expected)),lineageSha256,'Fresh lineage changed');
      const current=await inventory(bucket,m);
      checkInventory(current);
      for(const record of receipt.objects) await verifyArchive(root,record);
      // Also detect replacement bytes when Storage version metadata is unchanged.
      for(const item of current) assert.equal(hash(await downloadBytes(bucket,item)),
        receipt.objects.find(x=>x.path===item.path).sha256,'Live object hash changed');
      return current;
    };
    await recheck();
    for(const record of receipt.objects) {
      const current=await recheck();
      if(current.some(x=>x.path===record.path)) {
        record.status='delete-requested';
        await persist(); // Durable intent allows recovery from an uncertain API response.
        const removed=await bucket.remove([record.path]);
        assert(!removed.error,removed.error?.message);
        assert(Array.isArray(removed.data) && removed.data.length===1 && removed.data[0].name===record.path,'Unproven deletion response');
        const after=await inventory(bucket,m);
        checkInventory(after);
        assert(!after.some(x=>x.path===record.path),'Storage object remained after deletion');
      }
      record.status='deleted-and-verified';
      await persist();
    }
    assert.equal((await recheck()).length,0,'Storage residue remains');
    receipt.inventoryComplete=true;
    if(!verification) receipt.verifiedAt=new Date().toISOString();
    await persist();
    if(!verification) await writeFile(verificationFile,JSON.stringify(receipt,null,2),{flag:'wx'});
    return receipt;
  } catch(error) {
    if(writable) {
      receipt.inventoryComplete=false;
      receipt.failures.push(error.message);
      await atomicJson(receiptFile,receipt);
    }
    throw error;
  } finally { await lock.close(); await unlink(lockFile); }
}

// Imports are offline. Only an explicit CLI invocation constructs a privileged client.
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [folder,...flags]=process.argv.slice(2);
    assert(folder && flags.includes('--apply') && flags.every(x=>['--apply','--resume'].includes(x)),
      'Usage: node scripts/qa/wms-department-storage-cleanup.mjs RUN_FOLDER --apply [--resume]');
    const root=path.resolve(folder);
    const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
    scope(manifest,process.env,true);
    assert(process.env.SUPABASE_SECRET_KEY,'Privileged Storage credential required');
    const require=createRequire(new URL('../../apps/shell/package.json',import.meta.url));
    const {createClient}=require('@supabase/supabase-js');
    const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SECRET_KEY,{
      auth:{persistSession:false,autoRefreshToken:false},
      global:{fetch:(url,init)=>fetch(url,{...init,signal:AbortSignal.any([AbortSignal.timeout(20000),init?.signal].filter(Boolean))})},
    });
    const receipt=await cleanupDepartmentStorage({root,manifest,client,apply:true,resume:flags.includes('--resume')});
    console.log(JSON.stringify({runId:receipt.runId,objects:receipt.objects.length,complete:receipt.inventoryComplete}));
  } catch(error) { console.error(error.message); process.exitCode=1; }
}
