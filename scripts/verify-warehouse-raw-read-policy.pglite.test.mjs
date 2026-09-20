import assert from 'node:assert/strict';
import test from 'node:test';
import { RAW_TABLES, ROLE_MODULES, READER, rawReadFixture, setRoles, readIds } from './warehouse-raw-read-policy.fixture.mjs';

test('actual UAT-style permissive baseline reproduces seller cross-event exposure', async t => {
  const db=await rawReadFixture({apply:false});t.after(()=>db.close());
  await setRoles(db,[['core','staff'],['events','seller']]);
  assert.deepEqual(await readIds(db,'inventory_units'),['foreign','own']);
});

test('seller, staff, vendor and no-role identities cannot read raw Warehouse tables or invoker projections', async t => {
  const db=await rawReadFixture();t.after(()=>db.close());
  for(const roles of [[['events','seller']],[['events','seller'],['core','staff']],[['core','staff']],[['core','vendor_portal']],[]]){
    await setRoles(db,roles);
    for(const table of [...RAW_TABLES,'inventory_read_projection']) assert.deepEqual(await readIds(db,table),[],`${JSON.stringify(roles)} ${table}`);
  }
  await setRoles(db,[['events','seller'],['core','staff']]);
  assert.deepEqual((await db.query('select id from warehouse.test_scoped_seller_read()')).rows,[{id:'own'}]);
});

test('every existing Warehouse persona retains its primitive read model', async t => {
  const db=await rawReadFixture();t.after(()=>db.close());
  const primitives=['products','locations','storage_areas','inventory_units','stock_levels','movements','allocations','events','returns','cycle_counts','receipts'];
  for(const role of Object.keys(ROLE_MODULES.find(m=>m.module==='warehouse').roles)){
    await setRoles(db,[['warehouse',role]]);
    for(const table of primitives) assert.deepEqual(await readIds(db,table),['foreign','own'],`${role} ${table}`);
  }
});

test('Events readers retain event totals inputs but scoped sellers do not inherit view_events', async t => {
  const db=await rawReadFixture();t.after(()=>db.close());
  for(const role of ['viewer','requester','coordinator','finance_reviewer','admin']){
    await setRoles(db,[['events',role]]);
    for(const table of ['events','allocations','movements','products','event_reconciliations']) assert.deepEqual(await readIds(db,table),['foreign','own'],`${role} ${table}`);
    assert.deepEqual(await readIds(db,'inventory_units'),[]);
  }
});

test('Product kit metadata remains available without a Warehouse or staff role; Legal and Procurement gain no custody', async t => {
  const db=await rawReadFixture();t.after(()=>db.close());
  for(const role of ['contributor','operations_partner','product_owner']){
    await setRoles(db,[['product',role]]);
    assert.deepEqual(await readIds(db,'kit_definitions'),['foreign','own']);
    assert.deepEqual(await readIds(db,'inventory_units'),[]);
  }
  for(const module of ['legal','procurement']) for(const role of Object.keys(ROLE_MODULES.find(m=>m.module===module).roles)){
    await setRoles(db,[[module,role],['core','staff']]);
    assert.deepEqual(await readIds(db,'inventory_units'),[],`${module}/${role}`);
    assert.deepEqual(await readIds(db,'returns'),[],`${module}/${role}`);
  }
});

test('restrictive guards preserve narrower existing owner policy rather than granting all rows', async t => {
  const db=await rawReadFixture();t.after(()=>db.close());
  await db.exec(`drop policy read_authenticated on warehouse.customer_return_cases;
    create policy customer_return_cases_read on warehouse.customer_return_cases for select to authenticated using(created_by=auth.uid());`);
  await setRoles(db,[['warehouse','operations']]);
  assert.deepEqual(await readIds(db,'customer_return_cases'),['own']);
  await setRoles(db,[['core','staff'],['events','seller']]);
  assert.deepEqual(await readIds(db,'customer_return_cases'),[]);
});

test('current database authority defeats stale JWTs, revoked roles, expiry, future grants and inactive profiles', async t => {
  const db=await rawReadFixture();t.after(()=>db.close());
  for(const mutation of [
    'delete from core.user_roles',
    "update core.user_roles set expires_at=now()-interval '1 second'",
    "update core.user_roles set effective_at=now()+interval '1 day'",
    "update core.roles set is_active=false where module='warehouse' and role='warehouse_operator'",
    "update core.profiles set status='inactive'",
    "delete from core.role_capabilities where module='warehouse' and role='warehouse_operator'",
  ]){
    await db.exec("reset role;update core.roles set is_active=true;update core.profiles set status='active'");
    await setRoles(db,[['warehouse','warehouse_operator']]);
    assert.deepEqual(await readIds(db,'inventory_units'),['foreign','own']);
    await db.exec('reset role');await db.exec(mutation);
    await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:READER,role:'authenticated',user_metadata:{roles:{warehouse:['warehouse_admin']}},app_metadata:{roles:{warehouse:['warehouse_operator']}}})]);
    await db.exec('set role authenticated');
    for(const table of RAW_TABLES) assert.deepEqual(await readIds(db,table),[],`${mutation} ${table}`);
  }
});

test('action-only custom readers require current effective capability, while ordinary read grants remain usable', async t => {
  const db=await rawReadFixture();t.after(()=>db.close());
  await db.exec("insert into core.roles(module,role) values('warehouse','inspection_only');insert into core.role_capabilities values('warehouse','inspection_only','inspect_quality')");
  await setRoles(db,[['warehouse','inspection_only']]);
  for(const table of ['products','inventory_units','receipts','returns','quality_inspections']) assert.deepEqual(await readIds(db,table),['foreign','own']);
  await db.exec("reset role;insert into learning.test_certification_required values('warehouse','inspect_quality');set role authenticated");
  assert.deepEqual(await readIds(db,'inventory_units'),[]);
  await setRoles(db,[['warehouse','warehouse_operator']]);
  assert.deepEqual(await readIds(db,'inventory_units'),['foreign','own']);
});

test('Insights warehouse/finance source readers retain raw export dependencies without universal staff reads', async t => {
  const db=await rawReadFixture();t.after(()=>db.close());
  for(const role of ['analyst','manager','admin']){
    await setRoles(db,[['insights',role]]);
    for(const table of ['products','inventory_units','stock_levels','movements','cycle_counts']) assert.deepEqual(await readIds(db,table),['foreign','own']);
  }
});

test('all raw read guards are restrictive SELECT-only, helper ACL is narrow and unknown targets fail closed', async t => {
  const db=await rawReadFixture();t.after(()=>db.close());
  const policies=(await db.query(`select tablename,permissive,cmd,roles from pg_policies
    where schemaname='warehouse' and policyname='current_capability_read_guard' order by tablename`)).rows;
  assert.deepEqual(policies.map(row=>row.tablename),[...RAW_TABLES].sort());
  for(const policy of policies){
    assert.equal(policy.permissive,'RESTRICTIVE');
    assert.equal(policy.cmd,'SELECT');
    assert.deepEqual(policy.roles,['authenticated']);
  }
  const acl=(await db.query(`select
    has_function_privilege('anon','private.can_read_warehouse_table(text)','EXECUTE') as anon,
    has_function_privilege('authenticated','private.can_read_warehouse_table(text)','EXECUTE') as authenticated,
    has_function_privilege('service_role','private.can_read_warehouse_table(text)','EXECUTE') as service,
    (select prosecdef from pg_proc where oid='private.can_read_warehouse_table(text)'::regprocedure) as definer`)).rows[0];
  assert.deepEqual(acl,{anon:false,authenticated:true,service:true,definer:false});
  await setRoles(db,[['warehouse','warehouse_admin']]);
  assert.deepEqual((await db.query("select private.can_read_warehouse_table('unknown') as unknown,private.can_read_warehouse_table(null) as absent")).rows,[{unknown:false,absent:false}]);
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  for(const table of RAW_TABLES) assert.deepEqual(await readIds(db,table),[],table);
});

test('mixed-role sellers retain only independently granted reads and lose them immediately on revocation', async t => {
  const db=await rawReadFixture();t.after(()=>db.close());
  await setRoles(db,[['core','staff'],['events','seller'],['warehouse','warehouse_operator']]);
  assert.deepEqual(await readIds(db,'inventory_units'),['foreign','own']);
  await db.exec("reset role;delete from core.user_roles where module='warehouse';set role authenticated");
  for(const table of RAW_TABLES) assert.deepEqual(await readIds(db,table),[],table);
  assert.deepEqual((await db.query('select id from warehouse.test_scoped_seller_read()')).rows,[{id:'own'}]);
  await db.exec('reset role;set role service_role');
  assert.deepEqual(await readIds(db,'inventory_units'),['foreign','own']);
});

test('an active Marketing member scope alone does not grant seller raw Warehouse reads', async t => {
  const db=await rawReadFixture();t.after(()=>db.close());
  await db.exec(`create table core.departments(id uuid primary key,code text,is_active boolean);
    create table core.profile_department_scopes(profile_id uuid,department_id uuid,scope_type text,effective_from date,effective_to date);
    insert into core.departments values('7e55e54e-86cd-4157-9fdb-7616be83e340','marketing',true);
    insert into core.profile_department_scopes values('${READER}','7e55e54e-86cd-4157-9fdb-7616be83e340','member',current_date,null);`);
  await setRoles(db,[['events','seller']]);
  assert.equal((await db.query("select core.has_live_cap('events','view_event_custody') as allowed")).rows[0].allowed,true);
  for(const table of RAW_TABLES) assert.deepEqual(await readIds(db,table),[],table);
  for(const [module,cap] of [['warehouse','view_inventory'],['events','view_events'],['procurement','view_dashboard'],['core','view_directory']]){
    assert.equal((await db.query('select core.has_live_cap($1,$2) as allowed',[module,cap])).rows[0].allowed,false,`${module}.${cap}`);
  }
});
