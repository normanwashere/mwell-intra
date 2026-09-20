// Run with Node 24. Inputs: SEP20_PG_BIN and SEP20_NATIVE_OUTPUT only (see runtime).
// This verifies native transaction contention, not full migration-chain/UAT/auth certification.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { contend, fixtureFrom, installedFunctions, root, sourceHashes, startScratch } from './sep20-native-runtime.mjs';
import { functionDefinition } from '../quality-inspection-verifier-fixture.mjs';

const runtime = await startScratch();
const report = { version: runtime.version, host: '127.0.0.1', port: runtime.port, scratch: runtime.scratch,
  scope: 'Independent native PostgreSQL sessions; actual candidate migrations/retained command bodies with synthetic surrounding schemas and auth/learning/readiness projections.',
  exclusions: ['Not UAT/production migration attestation', 'Not full Supabase RLS/auth/learning certification', 'Not the entire release-to-recovery pipeline'],
  cases: [], functions: {}, source_sha256: {}, stopped: false };
const readMigration = name => readFile(path.join(root, 'supabase/migrations', name), 'utf8');
const productsLock = functionDefinition(await readMigration('20260714175318_single_po_receipt_authority.sql'), 'private.lock_warehouse_products');
const rpc = async (client, name, payload) => (await client.query(`select warehouse.${name}($1::jsonb) result`, [JSON.stringify(payload)])).rows[0].result;
function rejected(result, pattern) { assert.equal(result.loser.ok, false, 'Second transaction must be rejected'); assert.match(result.loser.message, pattern); }
async function run(name, task) {
  const database = await runtime.database(name.replaceAll('-', '_'));
  try {
    const result = await task(database);
    report.cases.push({ name, ...result, status: 'passed' }); console.log(`PASS ${name}`);
  } catch (error) {
    report.cases.push({ name, status: 'failed', error: error.message }); console.error(`FAIL ${name}: ${error.message}`);
  } finally { await database.close(); }
}
async function events(database, acknowledge = true, seed = true) {
  const f = await fixtureFrom('modules/events/tests/custody.pglite.test.mjs', ['fixture','setup','actor','sale','A','B','O'], database.client);
  const db = await f.fixture();
  await database.client.query('drop function private.lock_warehouse_products(text[])');
  await database.client.query(productsLock);
  if (!report.functions.events) report.functions.events = await installedFunctions(database.client, [
    'warehouse.record_event_outcome(jsonb)', 'warehouse.record_return_v2_certified_impl(jsonb)',
    'private.warehouse_advance_fulfillment_order_v2(jsonb)', 'private.lock_legacy_event_custody(text)',
    'private.lock_warehouse_products(text[])', 'warehouse.configure_event_custody(jsonb)', 'private.begin_idempotent_command(text,text,jsonb)',
  ]);
  const allocation = seed ? await f.setup(db, acknowledge) : undefined;
  const a = await database.newClient(), b = await database.newClient();
  await f.actor(a); await f.actor(b);
  return { ...f, db, a, b, allocation };
}
const returnInput = allocation => ({ idempotency_key: 'native-return-command', return: { source: 'event', event_id: 'e1',
  lines: [{ allocationId: allocation, productId: 'watch', quantity: 1, serialNumber: 'S1', locationId: 'quarantine', reason: 'Unsold' }] } });

try {
  await run('event-competing-sellers', async d => {
    const f = await events(d), other = '44444444-4444-4444-8444-444444444444';
    await d.client.query("insert into core.profiles values($1,'active','Seller Two','two@example.test');", [other]);
    await d.client.query("insert into core.user_roles values($1,'events','seller')", [other]);
    await f.actor(d.client, f.B, ['events.manage_events']);
    await rpc(d.client, 'configure_event_custody', { event_id: 'e1', action: 'assign', user_id: other, idempotency_key: 'native-assign-second' });
    await f.actor(f.b, other);
    const input = f.sale({ allocation_id: f.allocation });
    const r = await contend(d.client, f.a, f.b, c => rpc(c,'record_event_outcome',input),
      c => rpc(c,'record_event_outcome',{ ...input, external_reference: 'OTHER-SELLER', idempotency_key: 'native-second-sale' }));
    rejected(r,/custody/);
    assert.equal((await d.client.query('select count(*)::int n from private.event_custody_entries')).rows[0].n,1);
    assert.equal((await d.client.query('select count(*)::int n from warehouse.movements')).rows[0].n,2);
    return { blocking:r.blocking, denial:r.loser.message, ledger_entries:1, unchanged_issue_movements:2 };
  });
  await run('event-idempotent-retry', async d => {
    const f=await events(d), input=f.sale({allocation_id:f.allocation});
    const r=await contend(d.client,f.a,f.b,c=>rpc(c,'record_event_outcome',input),c=>rpc(c,'record_event_outcome',input));
    assert.equal(r.loser.ok,true);assert.deepEqual(r.loser.value,r.winner);
    assert.equal((await d.client.query('select count(*)::int n from private.event_custody_entries')).rows[0].n,1);
    return {blocking:r.blocking,replayed_same_id:r.winner.id};
  });
  for(const first of ['sale','return'])await run(`event-${first}-wins-conflict`,async d=>{
    const f=await events(d),input=f.sale({allocation_id:f.allocation}),returned=returnInput(f.allocation);
    const sale=c=>rpc(c,'record_event_outcome',input), intake=c=>rpc(c,'record_return_v2',returned);
    await f.actor(first==='sale'?f.b:f.a,f.B,['warehouse.manage_returns']);
    const r=await contend(d.client,f.a,f.b,first==='sale'?sale:intake,first==='sale'?intake:sale);rejected(r,/custody/);
    const facts=(await d.client.query(`select (select count(*)::int from private.event_custody_entries) sales,
      (select count(*)::int from warehouse.returns) returns,(select status from warehouse.inventory_units where serial_number='S1') unit_status,
      (select count(*)::int from warehouse.inventory_holds where serial_number='S1' and status='active') quarantine_holds`)).rows[0];
    assert.equal(facts.sales,first==='sale'?1:0);assert.equal(facts.returns,first==='return'?1:0);
    assert.equal(facts.unit_status,first==='sale'?'issued':'in_stock');assert.equal(facts.quarantine_holds,first==='return'?1:0);
    return {blocking:r.blocking,denial:r.loser.message,...facts};
  });
  for(const sameKey of [true,false])await run(`event-acknowledgment-${sameKey?'replay':'distinct-retry'}`,async d=>{
    const f=await events(d,false);await f.actor(f.a,f.B,['events.manage_events']);await f.actor(f.b,f.B,['events.manage_events']);
    const input={order_id:f.O,action:'acknowledge_receipt',acknowledgement_reference:'ACK-NATIVE',acknowledgement_evidence_url:'https://example.test/ack',idempotency_key:'native-acknowledge-1'};
    const ack=(c,p)=>c.query('select private.warehouse_advance_fulfillment_order_v2($1::jsonb) result',[JSON.stringify(p)]).then(r=>r.rows[0].result);
    const r=await contend(d.client,f.a,f.b,c=>ack(c,input),c=>ack(c,sameKey?input:{...input,idempotency_key:'native-acknowledge-2'}));
    if(sameKey){assert.equal(r.loser.ok,true);assert.deepEqual(r.loser.value,r.winner);}else rejected(r,/Only released demand/);
    const facts=(await d.client.query('select (select count(*)::int from private.event_custody_sources) sources,(select count(*)::int from warehouse.allocations) allocations,(select count(*)::int from warehouse.movements) movements')).rows[0];
    assert.deepEqual(facts,{sources:1,allocations:1,movements:2});return {blocking:r.blocking,...facts};
  });
  for(const first of ['enable','reserve'])await run(`event-${first}-wins-opt-in`,async d=>{
    const f=await events(d,false,false);
    await f.actor(f.a,f.B,['events.manage_events','warehouse.reserve_allocate']);await f.actor(f.b,f.B,['events.manage_events','warehouse.reserve_allocate']);
    const enable=c=>rpc(c,'configure_event_custody',{event_id:'e1',action:'enable',idempotency_key:'native-enable-race'});
    const reserve=c=>rpc(c,'reserve_uncertified_impl',{product_id:'bag',quantity:1,allocation:{id:'legacy-native',event_id:'e1',product_id:'bag',quantity:1,status:'reserved'}});
    const r=await contend(d.client,f.a,f.b,first==='enable'?enable:reserve,first==='enable'?reserve:enable);
    rejected(r,first==='enable'?/acknowledged demand/:/Historical/);
    const facts=(await d.client.query('select (select count(*)::int from private.event_custody_sessions) gates,(select count(*)::int from warehouse.allocations) allocations')).rows[0];
    assert.deepEqual(facts,{gates:first==='enable'?1:0,allocations:first==='reserve'?1:0});return {blocking:r.blocking,denial:r.loser.message,...facts};
  });
  await run('event-revocation-wins-sale',async d=>{
    const f=await events(d);await f.actor(f.a,f.B,['events.manage_events']);
    const r=await contend(d.client,f.a,f.b,c=>rpc(c,'configure_event_custody',{event_id:'e1',action:'revoke',user_id:f.A,idempotency_key:'native-revoke-race'}),
      c=>rpc(c,'record_event_outcome',f.sale({allocation_id:f.allocation})));rejected(r,/Not authorized/);
    assert.equal((await d.client.query('select count(*)::int n from private.event_custody_entries')).rows[0].n,0);return {blocking:r.blocking,denial:r.loser.message};
  });
  await run('event-external-reference-conflict',async d=>{
    const f=await events(d),input=f.sale({allocation_id:f.allocation});
    const r=await contend(d.client,f.a,f.b,c=>rpc(c,'record_event_outcome',input),
      c=>rpc(c,'record_event_outcome',{...input,serial_numbers:['S2'],idempotency_key:'native-ref-conflict'}));
    rejected(r,/Duplicate external reference for event/);assert.equal(r.loser.code,'P0001');
    assert.equal((await d.client.query('select count(*)::int n from private.event_custody_entries')).rows[0].n,1);
    return {blocking:r.blocking,denial:r.loser.message};
  });
  await run('event-bulk-oversell',async d=>{
    const f=await events(d),order='55555555-5555-4555-8555-555555555555';
    await f.actor(d.client,f.B,['events.manage_events']);
    await d.client.query(`insert into warehouse.fulfillment_orders(id,event_id,status,external_reference,lines,created_at,created_by)
      values($1,'e1','released','ORDER-BULK','[{"productId":"bag","quantity":2}]',clock_timestamp(),$2)`,[order,f.B]);
    await d.client.query("insert into warehouse.movements(id,type,product_id,quantity,event_id,reference) values('bulk-release','fulfillment_release','bag',2,'e1',$1)",[order]);
    await d.client.query('select private.warehouse_advance_fulfillment_order_v2($1::jsonb)',[JSON.stringify({order_id:order,action:'acknowledge_receipt',acknowledgement_reference:'ACK-BULK',acknowledgement_evidence_url:'https://example.test/ack',idempotency_key:'native-ack-bulk-1'})]);
    const input=f.sale({allocation_id:`event-custody-${order}-bag`,quantity:2,serial_numbers:[],external_reference:'BULK-1'});
    const r=await contend(d.client,f.a,f.b,c=>rpc(c,'record_event_outcome',input),c=>rpc(c,'record_event_outcome',{...input,external_reference:'BULK-2',idempotency_key:'native-bulk-oversell'}));
    rejected(r,/custody/);
    assert.equal((await d.client.query('select sum(quantity)::int n from private.event_custody_entries')).rows[0].n,2);
    return {blocking:r.blocking,denial:r.loser.message};
  });

  async function conversion(d) {
    const f=await fixtureFrom('scripts/verify-stock-conversion.pglite.test.mjs',['recipeInput','createInput','act','rpc','operator','quality','evidence'],d.client);
    for(const hook of f.hooks.before)await hook();for(const hook of f.hooks.beforeEach)await hook();
    await d.client.query('drop function private.lock_warehouse_products(text[])');await d.client.query(productsLock);
    if(!report.functions.conversion)report.functions.conversion=await installedFunctions(d.client,[
      'warehouse.execute_stock_conversion(jsonb)','private.normalize_inventory_unit_serial()',
      'private.lock_serial_custody_identity(text)','private.assert_event_conversion_return(text,text,text,text,text)',
    ]);
    await f.act(f.operator,'decide_go_live');const recipe=await f.rpc(f.recipeInput());
    const a=await d.newClient(),b=await d.newClient();
    for(const c of [a,b])await c.query("select set_config('request.jwt.claim.sub',$1,false),set_config('test.capability','manage_returns',false),set_config('test.launch','on',false)",[f.operator]);
    return {...f,recipe,a,b};
  }
  for(const sameKey of [false,true])await run(`conversion-${sameKey?'replay':'cross-event-claim'}`,async d=>{
    const f=await conversion(d),input=f.createInput(f.recipe);let second=input;
    if(!sameKey){
      await d.client.query("insert into warehouse.events(id,name,type,start_date) values('event-two','Other','wellness',current_date)");
      const recipe=await f.rpc({...f.recipeInput(),event_id:'event-two',idempotency_key:'native-other-recipe'});
      second={...input,event_id:'event-two',recipe_id:recipe.id,idempotency_key:'native-second-conversion'};
    }
    const r=await contend(d.client,f.a,f.b,c=>rpc(c,'execute_stock_conversion',input),c=>rpc(c,'execute_stock_conversion',second));
    if(sameKey){assert.equal(r.loser.ok,true);assert.deepEqual(r.loser.value,r.winner);}else rejected(r,/available|claimed/);
    const facts=(await d.client.query(`select (select count(*)::int from private.stock_conversion_batches) batches,
      (select count(*)::int from private.stock_conversion_claims where released_at is null) active_claims,
      (select quantity from warehouse.stock_levels where product_id='bag') bags,
      (select status from warehouse.inventory_units where serial_number='WATCH-1') unit_status`)).rows[0];
    assert.deepEqual(facts,{batches:1,active_claims:1,bags:8,unit_status:'conversion_pending'});return {blocking:r.blocking,...facts};
  });
  for(const first of ['complete','cancel'])await run(`conversion-${first}-wins-terminal`,async d=>{
    const f=await conversion(d);await f.act(f.operator,'manage_returns');const batch=await f.rpc(f.createInput(f.recipe));
    await f.act(f.quality,'inspect_quality');await f.rpc({action:'approve',batch_id:batch.id,idempotency_key:'native-independent-qa',inspected_serial_numbers:['WATCH-1'],evidence_urls:f.evidence});
    const command=action=>({action,batch_id:batch.id,idempotency_key:`native-terminal-${action}`,reason:'Cancel unconsumed work',evidence_urls:f.evidence});
    const second=first==='complete'?'cancel':'complete';
    const r=await contend(d.client,f.a,f.b,c=>rpc(c,'execute_stock_conversion',command(first)),c=>rpc(c,'execute_stock_conversion',command(second)));
    rejected(r,/unconsumed|expected independent approval stage/);
    const facts=(await d.client.query(`select (select status from private.stock_conversion_batches) batch_status,
      (select product_id from warehouse.inventory_units where serial_number='WATCH-1') product,
      (select quantity from warehouse.stock_levels where product_id='bag') bags,
      (select count(*)::int from private.stock_conversion_lines) lineage,(select count(*)::int from warehouse.movements) movements`)).rows[0];
    assert.deepEqual(facts,{batch_status:first==='complete'?'completed':'cancelled',product:first==='complete'?'variant':'base',bags:first==='complete'?8:10,lineage:first==='complete'?1:0,movements:first==='complete'?3:0});
    const movements=(await d.client.query('select type,quantity from warehouse.movements order by type')).rows;
    assert.deepEqual(movements,first==='complete'?[
      {type:'stock_conversion_in',quantity:1},{type:'stock_conversion_out',quantity:1},
      {type:'stock_conversion_packaging_consumed',quantity:2},
    ]:[]);
    return {blocking:r.blocking,...facts};
  });

  async function quality(d) {
    const f=await fixtureFrom('scripts/verify-provisional-quality-hold-release.pglite.test.mjs',['database','seed','fix','migration','inspector','receiver','pending'],d.client);
    const db=await f.database();await db.exec(f.fix);
    await db.exec(`create schema storage;create table storage.objects(bucket_id text,name text,owner_id text,owner uuid);
      insert into storage.objects values('evidence','inspection/proof.png','${f.inspector}',null);
      create table warehouse.command_log(id uuid primary key default gen_random_uuid(),actor_id uuid,command_name text,idempotency_key text,payload_hash text,response jsonb,completed_at timestamptz,unique(actor_id,command_name,idempotency_key));
      create function private.warehouse_payload_hash(jsonb) returns text language sql as $$select md5($1::text)$$;`);
    const commands=f.migration('20260710160000_warehouse_w1_quality_and_approval_rpcs.sql');
    await db.exec(functionDefinition(commands,'private.begin_idempotent_command'));await db.exec(functionDefinition(commands,'private.finish_idempotent_command'));
    await db.exec(f.migration('20260920025455_atomic_quality_batch.sql'));await f.seed(db);
    await db.exec(`update warehouse.quality_inspections set quantity=1,serial_number='S1';
      insert into warehouse.quality_inspections(source_type,source_id,product_id,procurement_po_line_id,location_id,quantity,serial_number,disposition,reason,inspected_by,inspected_by_email)
      values('receipt','receipt','product','line','location',1,'S2','pending','${f.pending}','${f.receiver}','receiver@test');
      update warehouse.inventory_holds set quantity=1,serial_number='S1';
      insert into warehouse.inventory_holds(inspection_id,product_id,location_id,quantity,serial_number,status,reason,created_by)
      select id,product_id,location_id,1,'S2','active','${f.pending}','${f.receiver}' from warehouse.quality_inspections where serial_number='S2';`);
    if(!report.functions.quality)report.functions.quality=await installedFunctions(d.client,[
      'warehouse.inspect_quality_batch(jsonb)','private.warehouse_inspect_quality_batch(jsonb)',
      'warehouse.inspect_quality(jsonb)','private.warehouse_inspect_quality_v3(jsonb)','private.protect_provisional_quality_hold()',
    ]);
    const a=await d.newClient(),b=await d.newClient();
    for(const c of [a,b])await c.query("select set_config('request.jwt.claim.sub',$1,false)",[f.inspector]);
    const item={source_type:'receipt',source_id:'receipt',product_id:'product',procurement_po_line_id:'line',quantity:1,serial_number:'S1'};
    return {a,b,input:{idempotency_key:'native-quality-batch-1',disposition:'accepted',evidence_urls:['inspection/proof.png'],items:[item,{...item,serial_number:'S2'}]}};
  }
  for(const sameKey of [true,false])await run(`quality-batch-${sameKey?'replay':'overlap'}`,async d=>{
    const f=await quality(d),second=sameKey?f.input:{...f.input,idempotency_key:'native-quality-batch-2',items:[...f.input.items].reverse()};
    const r=await contend(d.client,f.a,f.b,c=>rpc(c,'inspect_quality_batch',f.input),c=>rpc(c,'inspect_quality_batch',second));
    if(sameKey){assert.equal(r.loser.ok,true);assert.deepEqual(r.loser.value,r.winner);}else rejected(r,/pending|inspection|provisional/i);
    const facts=(await d.client.query(`select (select count(*)::int from warehouse.quality_inspections where disposition='accepted') accepted,
      (select count(*)::int from warehouse.inventory_holds where status='released') released,
      (select count(*)::int from warehouse.command_log) commands,(select count(*)::int from core.activity_log) audit`)).rows[0];
    assert.deepEqual(facts,{accepted:2,released:2,commands:3,audit:2});return {blocking:r.blocking,...facts};
  });
} finally {
  await runtime.close();report.stopped=true;
  report.source_sha256=Object.fromEntries(sourceHashes);
  await writeFile(path.join(runtime.output,'sep20-native-concurrency-report.json'),JSON.stringify(report,null,2));
}
const failures=report.cases.filter(row=>row.status!=='passed');
console.log(JSON.stringify({passed:report.cases.length-failures.length,failed:failures.length,version:report.version,stopped:report.stopped,report:path.join(runtime.output,'sep20-native-concurrency-report.json')}));
if(failures.length)process.exitCode=1;
