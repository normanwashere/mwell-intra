import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fixtureFrom, installedFunctions, root, sourceHashes, startScratch } from './sep20-native-runtime.mjs';
import { functionDefinition } from '../quality-inspection-verifier-fixture.mjs';

const bindings = {};
for (const name of ['core','warehouse','events','product','procurement','legal','insights']) {
  const file = `packages/rbac/src/modules/${name}.ts`;
  sourceHashes.set(file,createHash('sha256').update(await readFile(path.join(root,file))).digest('hex'));
  bindings[`${name}Module`] = (await import(pathToFileURL(path.join(root, file))))[`${name}Module`];
}
const runtime = await startScratch();
const report = { version: runtime.version, scope: 'Native PostgreSQL RLS with actual candidate guards and current core capability resolvers; synthetic rows and certification responses, NOT UAT attestation.', cases: [], stopped: false };
const rpc = async (db,name,payload) => (await db.query(`select warehouse.${name}($1::jsonb) result`,[JSON.stringify(payload)])).rows[0].result;
async function check(name, task) { await task(); report.cases.push({name,status:'passed'}); console.log(`PASS ${name}`); }
try {
  const d = await runtime.database('raw_rls');
  const f = await fixtureFrom('scripts/warehouse-raw-read-policy.fixture.mjs',
    ['rawReadFixture','setRoles','readIds','RAW_TABLES','ROLE_MODULES','POLICY_MIGRATION','READER','readMigration'], d.client, bindings);
  const db = await f.rawReadFixture({apply:false});
  await check('permissive-baseline-reproduces-cross-event-leak',async()=>{
    await f.setRoles(db,[['core','staff'],['events','seller']]);
    assert.deepEqual(await f.readIds(db,'inventory_units'),['foreign','own']);
    await db.exec('reset role');
  });
  const policy = await f.readMigration(f.POLICY_MIGRATION); await db.exec(policy);
  await check('exact-36-restrictive-guards-installed',async()=>{
    const guards=(await d.client.query("select tablename from pg_policies where schemaname='warehouse' and permissive='RESTRICTIVE' and cmd='SELECT' order by tablename")).rows.map(r=>r.tablename);
    assert.deepEqual(guards,[...f.RAW_TABLES].sort());
    report.functions=await installedFunctions(d.client,['core.has_cap(text,text)','core.has_live_cap(text,text)','private.can_read_warehouse_table(text)']);
  });
  for (const [name,roles] of [['seller',[['events','seller']]],['seller-staff',[['events','seller'],['core','staff']]],['staff',[['core','staff']]],['vendor',[['core','vendor_portal']]],['no-role',[]]]) {
    await check(`all-raw-denied-${name}`,async()=>{
      await f.setRoles(db,roles);
      for(const table of [...f.RAW_TABLES,'inventory_read_projection'])assert.deepEqual(await f.readIds(db,table),[],table);
    });
  }
  for(const role of ['viewer','requester','coordinator','finance_reviewer','admin'])await check(`existing-events-${role}`,async()=>{
    await f.setRoles(db,[['events',role]]);
    for(const table of ['events','allocations','movements','products','event_lifecycle_events','event_reconciliations','department_stock_requests'])assert.deepEqual(await f.readIds(db,table),['foreign','own'],table);
    assert.deepEqual(await f.readIds(db,'inventory_units'),[]);
  });
  await check('narrower-row-policy-preserved',async()=>{
    await db.exec("reset role;drop policy read_authenticated on warehouse.customer_return_cases;create policy owner_read on warehouse.customer_return_cases for select to authenticated using(created_by=auth.uid())");
    await f.setRoles(db,[['warehouse','operations']]);assert.deepEqual(await f.readIds(db,'customer_return_cases'),['own']);
  });
  await check('revoked-role-ignores-stale-jwt',async()=>{
    await f.setRoles(db,[['warehouse','warehouse_operator']]);assert.equal((await f.readIds(db,'inventory_units')).length,2);
    await db.exec('reset role;delete from core.user_roles');
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:f.READER,app_metadata:{roles:{warehouse:['warehouse_operator']}}})]);
    await db.exec('set role authenticated');
    for(const table of f.RAW_TABLES)assert.deepEqual(await f.readIds(db,table),[],table);
  });
  await d.close();

  const e = await runtime.database('actual_events_rls');
  const ef = await fixtureFrom('modules/events/tests/custody.pglite.test.mjs',['fixture','setup','actor','sale','A','B','migration'],e.client);
  const edb = await ef.fixture(), allocation = await ef.setup(edb);
  // Replace synthetic capability lookup, preserving actual SQL bodies/parameter names.
  await edb.exec(`alter function core.has_cap(text,text) rename to fixture_has_cap;
    alter function core.has_live_cap(text,text) rename to fixture_has_live_cap;
    alter table core.user_roles add effective_at timestamptz default now()-interval '1 day',add expires_at timestamptz;
    create function learning.is_certification_required(text,text) returns boolean language sql as $$select $1='events' and $2='record_event_outcome'$$;
    create function learning.has_active_certification(uuid,text,text) returns boolean language sql as $$select current_setting('test.certified',true)='true'$$;
    create function learning.has_active_emergency_exception(uuid,text,text) returns boolean language sql as $$select false$$;`);
  for(const module of f.ROLE_MODULES)for(const [role,definition] of Object.entries(module.roles)){
    await e.client.query('insert into core.roles(module,role,is_active) values($1,$2,true) on conflict(module,role) do update set is_active=true',[module.module,role]);
    for(const cap of definition.capabilities)await e.client.query('insert into core.role_capabilities values($1,$2,$3) on conflict do nothing',[module.module,role,cap]);
  }
  for(const [migration,name] of [['20260816090000_security_database_launch_blocker_convergence','core.has_cap'],['20260812200000_learning_authority','core.has_live_cap']])await edb.exec(functionDefinition(await ef.migration(migration),name));
  for(const table of f.RAW_TABLES){
    await edb.exec(`create table if not exists warehouse.${table}(id text primary key);
      alter table warehouse.${table} enable row level security;grant select on warehouse.${table} to authenticated;
      create policy read_authenticated on warehouse.${table} for select to authenticated using(true);`);
  }
  await edb.exec("drop policy read_authenticated on warehouse.kit_definitions;create policy kit_definitions_read on warehouse.kit_definitions for select to authenticated using(core.has_cap('core','view_directory'))");
  await edb.exec(policy);
  await edb.exec("select set_config('test.certified','true',false)");
  await ef.actor(edb);
  await check('actual-seller-rpc-survives-raw-denial',async()=>{
    await edb.exec('set role authenticated');
    assert.equal((await rpc(edb,'my_event_custody_events',{})).length,1);
    assert.equal((await rpc(edb,'event_custody_ledger',{event_id:'e1'})).allocations.length,1);
    for(const table of f.RAW_TABLES)assert.equal((await edb.query(`select 1 from warehouse.${table}`)).rows.length,0,table);
    await assert.rejects(rpc(edb,'event_custody_ledger',{event_id:'e2'}),/Not authorized/);
    const input=ef.sale({allocation_id:allocation});const result=await rpc(edb,'record_event_outcome',input);
    assert.equal((await rpc(edb,'record_event_outcome',input)).id,result.id);
    assert.equal(result.seller_id,ef.A);
  });
  await check('actual-seller-staff-still-scoped',async()=>{
    await edb.exec('reset role');await edb.query("insert into core.user_roles(user_id,module,role) values($1,'core','staff')",[ef.A]);await edb.exec('set role authenticated');
    assert.equal((await rpc(edb,'event_custody_ledger',{event_id:'e1'})).totals.sold_units,1);
    for(const table of f.RAW_TABLES)assert.equal((await edb.query(`select 1 from warehouse.${table}`)).rows.length,0,table);
  });
  await check('actual-seller-learning-and-revocation-still-enforced',async()=>{
    const input=ef.sale({allocation_id:allocation,serial_numbers:['S2'],external_reference:'SALE-2',idempotency_key:'native-uncertified-sale'});
    await edb.exec("select set_config('test.certified','false',false)");
    await assert.rejects(rpc(edb,'record_event_outcome',input),/Not authorized/);
    await edb.exec("reset role;select set_config('test.certified','true',false)");
    await edb.query("delete from core.user_roles where user_id=$1 and module='events'",[ef.A]);await edb.exec('set role authenticated');
    await assert.rejects(rpc(edb,'event_custody_ledger',{event_id:'e1'}),/Not authorized/);
    await assert.rejects(rpc(edb,'record_event_outcome',input),/Not authorized/);
  });
  await e.close();
}catch(error){report.error=error.message;process.exitCode=1;console.error(error.message);}
finally{await runtime.close();report.stopped=true;report.source_sha256=Object.fromEntries(sourceHashes);await writeFile(path.join(runtime.output,'sep20-native-rls-report.json'),JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.cases.length,error:report.error,stopped:report.stopped}));
