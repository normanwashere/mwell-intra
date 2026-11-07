import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { installAdapterFixture } from './wms-fixture-postgres-adapter.fixture.mjs';
import { createPostgresFixtureSessions, createRepresentativeFixturePlan } from './wms-fixture-postgres-adapter.mjs';

const sourceCommit='a'.repeat(40);

async function netCatalogFixture(db,{members=true}={}){
  // Catalog predicate fixture only: this does not install or execute pg_net.
  await db.exec(`create role qa_net_owner nologin nosuperuser;
    create role qa_net_migrator nosuperuser inherit in role postgres;
    create schema net authorization qa_net_owner;
    grant usage on schema net to postgres;
    create table net.http_request_queue(id text primary key,payload jsonb);
    create table net._http_response(id text primary key,payload jsonb);
    insert into net.http_request_queue values('retained-request','{"preserved":true}');
    insert into net._http_response values('retained-response','{"preserved":true}');
    alter table net.http_request_queue owner to qa_net_owner;
    alter table net._http_response owner to qa_net_owner;
    grant select,trigger on net.http_request_queue,net._http_response to postgres;
    insert into pg_catalog.pg_extension(oid,extname,extowner,extnamespace,extrelocatable,extversion)
      select (select max(oid)::bigint+1 from pg_catalog.pg_extension)::oid,'pg_net',
        (select oid from pg_catalog.pg_roles where rolname=current_user),'net'::regnamespace,false,'catalog-fixture-only';`);
  if(members)await db.exec(`alter extension pg_net add table net.http_request_queue;
    alter extension pg_net add table net._http_response;`);
}

async function netSnapshot(db){
  return (await db.query(`select c.relname,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,
    (select jsonb_agg(jsonb_build_object('name',g.tgname,'enabled',g.tgenabled,'definition',pg_get_triggerdef(g.oid)) order by g.tgname)
      from pg_trigger g where g.tgrelid=c.oid and not g.tgisinternal) as triggers,
    (select jsonb_agg(to_jsonb(d) order by d.refobjid,d.deptype) from pg_depend d
      where d.classid='pg_class'::regclass and d.objid=c.oid and d.refclassid='pg_extension'::regclass) as membership,
    case c.relname when 'http_request_queue' then (select jsonb_agg(to_jsonb(r) order by r.id) from net.http_request_queue r)
      else (select jsonb_agg(to_jsonb(r) order by r.id) from net._http_response r) end as rows
    from pg_class c where c.oid in ('net.http_request_queue'::regclass,'net._http_response'::regclass) order by c.relname`)).rows;
}

test('non-superuser migration preserves the exact pg_net catalog fixture, not arbitrary net business tables',async()=>{
  const db=new PGlite();
  let before;let verifiedRole=false;
  try{
    await installAdapterFixture(db,{beforeWriterGuards:async()=>{
      await netCatalogFixture(db);
      await db.exec(`create schema net_namesake;
        create table net_namesake.http_request_queue(id text primary key,payload jsonb);
        create table net_namesake._http_response(id text primary key,payload jsonb);`);
      before=await netSnapshot(db);
      await db.exec('set local role qa_net_migrator');
      assert.deepEqual((await db.query(`select rolsuper as superuser,
        pg_has_role(current_user,'postgres','USAGE') as member,
        has_table_privilege(current_user,'net.http_request_queue','TRIGGER') as can_trigger,
        pg_has_role(current_user,'qa_net_owner','USAGE') as owns_queue
        from pg_roles where rolname=current_user`)).rows[0],
      {superuser:false,member:true,can_trigger:true,owns_queue:false});
      verifiedRole=true;
    }});
    assert.deepEqual(await netSnapshot(db),before);
    assert.deepEqual((await db.query(`select relation::text from private.wms_fixture_guard_targets()
      where relation in ('net.http_request_queue'::regclass,'net._http_response'::regclass,
        'net_namesake.http_request_queue'::regclass,'net_namesake._http_response'::regclass) order by relation::text`)).rows,
    [{relation:'net_namesake._http_response'},{relation:'net_namesake.http_request_queue'}]);
    for(const relation of ['net.http_request_queue','net._http_response']){
      await db.exec(`begin;alter extension pg_net drop table ${relation}`);
      try{
        assert.equal((await db.query('select count(*)::int n from private.wms_fixture_guard_targets() where relation=$1::regclass',[relation])).rows[0].n,1);
        await db.exec(`alter extension plpgsql add table ${relation}`);
        assert.equal((await db.query('select count(*)::int n from private.wms_fixture_guard_targets() where relation=$1::regclass',[relation])).rows[0].n,1);
        await assert.rejects(db.query('select private.wms_fixture_assert_writer_coverage()'),/writer coverage changed/);
      }finally{await db.exec('rollback');}
    }
    await db.exec(`create table net.business_payload(id text primary key,payload jsonb);
      alter table net.business_payload owner to qa_net_owner;
      alter extension pg_net add table net.business_payload;`);
    assert.equal((await db.query("select count(*)::int n from private.wms_fixture_guard_targets() where relation='net.business_payload'::regclass")).rows[0].n,1);
    await assert.rejects(db.query('select private.wms_fixture_assert_writer_coverage()'),/writer coverage changed/);
    assert.deepEqual(await netSnapshot(db),before);
  }catch(error){
    if(error.code==='42501'){
      assert.equal(verifiedRole,true,'permission failure must occur in fence installation, not catalog setup');
      error.message=`Fence installation denied: ${error.message}`;
    }
    throw error;
  }finally{await db.exec('rollback;reset role');await db.close();}
});

test('exact net table names without pg_net membership still fail closed for a non-owner migrator',async()=>{
  const db=new PGlite();
  let verifiedRole=false;
  try{
    await assert.rejects(installAdapterFixture(db,{beforeWriterGuards:async()=>{
      await netCatalogFixture(db,{members:false});
      assert.equal((await db.query(`select count(*)::int n from pg_depend d join pg_extension e on e.oid=d.refobjid
        where d.classid='pg_class'::regclass and d.refclassid='pg_extension'::regclass and e.extname='pg_net'
          and d.objid in ('net.http_request_queue'::regclass,'net._http_response'::regclass)`)).rows[0].n,0);
      await db.exec('set local role qa_net_migrator');
      assert.equal((await db.query('select rolsuper from pg_roles where rolname=current_user')).rows[0].rolsuper,false);
      verifiedRole=true;
    }}),error=>verifiedRole&&error.code==='42501'&&/must be owner of table (http_request_queue|_http_response)/.test(error.message));
  }finally{await db.exec('rollback;reset role');await db.close();}
});

test('non-superuser migration preserves the actual reporting audit and never skips foreign business tables',async()=>{
  const db=new PGlite();
  const reporting=readFileSync(new URL('../../supabase/migrations/20260923025605_reporting_private_authority_foundation.sql',import.meta.url),'utf8');
  const auditSnapshot=async()=> (await db.query(`select
    (select jsonb_build_object('owner',relowner,'acl',relacl,'rls',relrowsecurity,'forced',relforcerowsecurity)
      from pg_class where oid='reporting_authority.admin_audit'::regclass) as metadata,
    (select jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'definition',pg_get_triggerdef(oid)) order by tgname)
      from pg_trigger where tgrelid='reporting_authority.admin_audit'::regclass and not tgisinternal) as triggers,
    (select jsonb_agg(to_jsonb(a) order by audit_id) from reporting_authority.admin_audit a) as rows`)).rows[0];
  let before; let verifiedRole=false;
  try{
    await installAdapterFixture(db,{beforeWriterGuards:async()=>{
      // The real foundation owns BEGIN/COMMIT; avoid nesting it inside the fixture.
      await db.exec('commit');
      await db.exec(reporting);
      await db.exec("select reporting_authority._audit('register_principal',null,'local-preserved-audit',null,null)");
      before=await auditSnapshot();
      const auditOid=(await db.query("select 'reporting_authority.admin_audit'::regclass::oid as oid")).rows[0].oid;
      await db.exec('create role qa_fixture_migrator nosuperuser inherit in role postgres');
      await db.exec('begin;set local role qa_fixture_migrator');
      assert.deepEqual((await db.query(`select current_user as role,rolsuper as superuser,
        pg_has_role(current_user,'postgres','USAGE') as member,
        has_table_privilege(current_user,$1::oid,'TRIGGER') as can_trigger
        from pg_roles where rolname=current_user`,[auditOid])).rows[0],
      {role:'qa_fixture_migrator',superuser:false,member:true,can_trigger:false});
      verifiedRole=true;
    }});
    assert.deepEqual(await auditSnapshot(),before);
    assert.equal((await db.query("select count(*)::int n from private.wms_fixture_guard_targets() where relation='reporting_authority.admin_audit'::regclass")).rows[0].n,0);
    for(const sql of ['update reporting_authority.admin_audit set change_ref=change_ref','delete from reporting_authority.admin_audit','truncate reporting_authority.admin_audit']){
      await assert.rejects(db.exec(sql),error=>error.code==='23000'&&/immutable/.test(error.message));
    }
    assert.deepEqual(await auditSnapshot(),before);
    await db.exec(`create table reporting_authority.foreign_business_probe(id text primary key,payload jsonb);
      alter table reporting_authority.foreign_business_probe owner to reporting_authority_owner`);
    assert.equal((await db.query("select count(*)::int n from private.wms_fixture_guard_targets() where relation='reporting_authority.foreign_business_probe'::regclass")).rows[0].n,1);
    await assert.rejects(db.query('select private.wms_fixture_assert_writer_coverage()'),/writer coverage changed/);
    await db.exec('begin;set local role qa_fixture_migrator');
    try{
      await assert.rejects(db.exec(`create trigger wms_fixture_registered_write_guard before insert or update or delete
        on reporting_authority.foreign_business_probe for each row execute function private.wms_fixture_guard_write()`),error=>error.code==='42501');
    }finally{await db.exec('rollback');}
  }catch(error){
    if(error.code==='42501'){
      assert.equal(verifiedRole,true,'permission failure must be in fence installation, not role setup');
      error.message=`Fence installation denied: ${error.message}`;
    }
    throw error;
  }finally{
    await db.exec('rollback;reset role');
    await db.close();
  }
});

async function fixture(fn,{seed=true}={}){
  const db=new PGlite();
  try{
    await installAdapterFixture(db);
    const writer={query:(sql,args)=>db.query(sql,args)};
    const reader={query:(sql,args)=>db.query(sql,args)};
    const plan=createRepresentativeFixturePlan({sourceCommit});
    const pair=createPostgresFixtureSessions({writer,reader,bindings:{locationId:'fixture-wh',binId:'fixture-bin'},readHealth:async()=>({status:'ok',commit:sourceCommit,deployment:{appEnv:'uat',supabaseProjectRef:plan.projectRef}})});
    const {fence}=await pair.adapter.acquire({plan,recovery:false});
    const command={plan,fence,operation:plan.operations[0],idempotencyKey:`${plan.runId}:mutation:seed-one-serial`};
    if(seed)await pair.adapter.execute(command);
    await fn({db,plan,pair,fence});
    await pair.adapter.release({plan,fence});
  }finally{await db.close();}
}

test('registered fixture denies a logical product reference before cleanup',()=>fixture(async({db,plan})=>{
  await assert.rejects(db.query("insert into warehouse.cycle_counts(id,lines,status) values('foreign',$1,'draft')",[JSON.stringify([{productId:plan.roots[0].id}])]),/isolated fixture/);
  assert.equal((await db.query("select count(*)::int n from warehouse.cycle_counts where id='foreign'")).rows[0].n,0);
}));

test('OLD identities cannot be removed or replaced and unrelated master writes remain normal',()=>fixture(async({db,plan})=>{
  for(const sql of ["update warehouse.inventory_units set product_id='master-preserved' where id=$1",'delete from warehouse.inventory_units where id=$1']){
    await assert.rejects(db.query(sql,[plan.roots[1].id]),/isolated fixture/);
  }
  await db.query("update warehouse.products set name='Master unchanged authority' where id='master-preserved'");
  assert.equal((await db.query("select name from warehouse.products where id='master-preserved'")).rows[0].name,'Master unchanged authority');
  await assert.rejects(db.exec('truncate private.warehouse_unit_history'),/isolated fixture/);
}));

test('exact tokens are guarded in JSON keys, scalar arrays and SQL serial fields',()=>fixture(async({db,plan})=>{
  const serial=`QA-${plan.runId.slice('wms-fixture-'.length).toUpperCase()}`;
  for(const value of [{[plan.roots[0].id]:true},[plan.roots[1].id],{nested:{serial_numbers:[' '+serial.toLowerCase()+' ']}},{serialNumber:'\t'+serial.toLowerCase()+'\r\n'}]){
    await assert.rejects(db.query("insert into warehouse.cycle_counts(id,lines,status) values('exact',$1,'draft')",[JSON.stringify(value)]),/isolated fixture/);
  }
  for(const value of [null,12,false,{},['OTHER-SERIAL'],{note:`Report about ${plan.roots[0].id}`}]){
    await db.query("insert into warehouse.cycle_counts(id,lines,status) values(gen_random_uuid()::text,$1,'draft')",[JSON.stringify(value)]);
  }
  await assert.rejects(db.query("insert into private.warehouse_unit_history(unit_id,product_id,serial_number,operation,after_state) values('foreign','master-preserved',$1,'registered','{}')",[serial]),/isolated fixture/);
}));

test('an unregistered reserved identity is denied before it can become a dependency',()=>fixture(async({db})=>{
  const future=createRepresentativeFixturePlan({sourceCommit});
  await assert.rejects(db.query("insert into warehouse.cycle_counts(id,lines,status) values('future',$1,'draft')",[JSON.stringify([{productId:future.roots[0].id}])]),/isolated fixture/);
}));

test('repeatable-read fixture writes fail closed rather than trust a stale registration snapshot',()=>fixture(async({db,plan})=>{
  await db.exec('begin isolation level repeatable read');
  try{await assert.rejects(db.query('insert into private.stock_conversion_batches(id,units) values(gen_random_uuid(),$1)',[JSON.stringify([{productId:plan.roots[0].id}])]),/fresh read-committed/);}
  finally{await db.exec('rollback');}
}));

test('open lease alone cannot seed and an altered backend binding cannot authorize dispatch',()=>fixture(async({db,plan,pair,fence})=>{
  const serial=`QA-${plan.runId.slice('wms-fixture-'.length).toUpperCase()}`;
  await assert.rejects(db.query("insert into warehouse.products(id,sku,name) values($1,$2,'Not an adapter transaction')",[plan.roots[0].id,serial]),/isolated fixture/);
  await db.query('update private.wms_fixture_leases set owner_pid=owner_pid+1 where run_id=$1',[plan.runId]);
  await assert.rejects(pair.adapter.execute({plan,fence,operation:plan.operations[0],idempotencyKey:`${plan.runId}:mutation:seed-one-serial`}),/stale or closed/);
},{seed:false}));

test('missing, disabled or replaced coverage prevents fixture activation',()=>fixture(async({db,plan,pair})=>{
  await db.exec('alter table warehouse.cycle_counts disable trigger wms_fixture_registered_write_guard');
  await assert.rejects(pair.adapter.inspect({plan}),/writer coverage changed/);
  await db.exec('alter table warehouse.cycle_counts enable always trigger wms_fixture_registered_write_guard');
  await db.exec('create schema integration_probe;create table integration_probe.new_json_writer(id text,payload jsonb)');
  await assert.rejects(pair.adapter.inspect({plan}),/writer coverage changed/);
}));

test('registry stays immutable and private while every public client lacks helper authority',()=>fixture(async({db})=>{
  for(const sql of ['update private.wms_fixture_identities set product_id=product_id','delete from private.wms_fixture_identities','truncate private.wms_fixture_identities'])await assert.rejects(db.exec(sql),/immutable/);
  for(const role of ['anon','authenticated','service_role']){
    for(const privilege of ['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'])assert.equal((await db.query("select has_table_privilege($1,'private.wms_fixture_identities',$2) allowed",[role,privilege])).rows[0].allowed,false);
    for(const signature of ['private.wms_fixture_guard_write()','private.wms_fixture_tokens(jsonb)','private.wms_fixture_guard_targets()','private.wms_fixture_assert_writer_coverage()'])assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature])).rows[0].allowed,false);
  }
}));

test('WHEN false cannot impersonate installed row coverage',()=>fixture(async({db})=>{
  await db.exec(`drop trigger wms_fixture_registered_write_guard on warehouse.cycle_counts;
    create trigger wms_fixture_registered_write_guard before insert or update or delete on warehouse.cycle_counts
      for each row when(false) execute function private.wms_fixture_guard_write();
    alter table warehouse.cycle_counts enable always trigger wms_fixture_registered_write_guard`);
  await assert.rejects(db.query('select private.wms_fixture_assert_writer_coverage()'),/writer coverage changed/);
}));

test('each of the four exact truncate guards is required for activation',()=>fixture(async({db})=>{
  for(const table of ['warehouse.products','warehouse.inventory_units','private.warehouse_unit_history','private.warehouse_stock_epochs']){
    await db.exec(`alter table ${table} disable trigger wms_fixture_registered_truncate_guard`);
    await assert.rejects(db.query('select private.wms_fixture_assert_writer_coverage()'),/writer coverage changed/);
    await db.exec(`alter table ${table} enable always trigger wms_fixture_registered_truncate_guard`);
  }
}));

test('canonical unit registration retains and accounts its actual stock epoch',()=>fixture(async({db,plan})=>{
  const epochs=(await db.query("select e.id::text id from private.warehouse_stock_epochs e where (scope_key::jsonb)->>0=$1",[plan.roots[0].id])).rows;
  assert.equal(epochs.length,1);
  const owned=(await db.query("select row_id from private.wms_fixture_owned_rows where run_id=$1 and table_name='private.warehouse_stock_epochs'",[plan.runId])).rows;
  assert.deepEqual(owned.map(r=>r.row_id),epochs.map(r=>r.id));
  assert.equal((await db.query('select count(*)::int n from core.activity_log')).rows[0].n,1);
  const scope=JSON.stringify([plan.roots[0].id,'fixture-wh','fixture-bin']);
  for(const [sql,args] of [
    ['insert into private.warehouse_stock_epochs(scope_key) values($1)',[scope]],
    ["update private.warehouse_stock_epochs set scope_key='[\"master-preserved\",\"fixture-wh\",\"fixture-bin\"]' where id=$1",[epochs[0].id]],
    ['delete from private.warehouse_stock_epochs where id=$1',[epochs[0].id]],
  ])await assert.rejects(db.query(sql,args),/isolated fixture/);
  await db.query('insert into private.warehouse_stock_epochs(scope_key) values($1)',[JSON.stringify(['master-preserved','fixture-wh','fixture-bin'])]);
  await db.query('insert into core.activity_log(id,detail) values(gen_random_uuid(),$1)',[JSON.stringify({productId:plan.roots[0].id,action:'observed-only'})]);
  assert.equal((await db.query('select count(*)::int n from core.activity_log')).rows[0].n,2);
}));

test('every new guard body is pinned rather than trusted by signature alone',()=>fixture(async({db,pair,plan})=>{
  for(const [signature,body] of [
    ['private.wms_fixture_tokens(jsonb)',"select array[]::text[]"],
    ['private.wms_fixture_guard_targets()',"select null::regclass where false"],
    ['private.wms_fixture_guard_write()','begin return new;end'],
    ['private.wms_fixture_assert_writer_coverage()','begin return;end'],
  ]){
    const definition=(await db.query('select pg_get_functiondef($1::regprocedure) value',[signature])).rows[0].value;
    await db.exec(definition.replace(/AS \$function\$[^]*?\$function\$/,`AS $function$${body}$function$`));
    await assert.rejects(pair.adapter.inspect({plan}),/source contract drift/);
    await db.exec(definition);
  }
}));

test('new helper ACL drift blocks dispatch without widening client permissions',()=>fixture(async({db,pair,plan})=>{
  await db.exec('grant execute on function private.wms_fixture_guard_write() to authenticated');
  await assert.rejects(pair.adapter.inspect({plan}),/source contract drift/);
}));

test('unknown INSERT side effects or missing canonical seed triggers block activation',()=>fixture(async({db,pair,plan})=>{
  await db.exec(`create function private.unreviewed_seed() returns trigger language plpgsql as $$begin return new;end$$;
    create trigger unreviewed_seed before insert on warehouse.inventory_units for each row execute function private.unreviewed_seed()`);
  await assert.rejects(pair.adapter.inspect({plan}),/source contract drift/);
  await db.exec('drop trigger unreviewed_seed on warehouse.inventory_units');
  for(const name of ['warehouse_count_epoch','warehouse_inventory_unit_serial_normalize','warehouse_work_location_guard','warehouse_unit_history']){
    await db.exec(`alter table warehouse.inventory_units disable trigger ${name}`);
    await assert.rejects(pair.adapter.inspect({plan}),/source contract drift/);
    await db.exec(`alter table warehouse.inventory_units enable trigger ${name}`);
  }
}));

test('registered fixture denies a logical reference after archive without deleting history',()=>fixture(async({db,plan})=>{
  const members=(await db.query("select jsonb_agg(jsonb_build_object('table',replace(table_name,'warehouse.',''),'row_id',row_id,'row_md5',row_md5,'provenance','Owned test fixture')) manifest from private.wms_fixture_owned_rows where run_id=$1 and table_name like 'warehouse.%'",[plan.runId])).rows[0].manifest;
  await db.query('select private.archive_uat_warehouse_fixture($1,$2)',[`uat-guard-${plan.runId.slice(12)}`,JSON.stringify(members)]);
  await assert.rejects(db.query('insert into private.stock_conversion_batches(id,units) values(gen_random_uuid(),$1)',[JSON.stringify([{productId:plan.roots[0].id}])]),/isolated fixture/);
  assert.equal((await db.query('select count(*)::int n from private.warehouse_unit_history where unit_id=$1',[plan.roots[1].id])).rows[0].n,1);
}));

test('registered fixture denies direct owned update despite an open lease and custom settings',()=>fixture(async({db,plan})=>{
  await db.query("select set_config('app.wms_fixture_run',$1,false)",[plan.runId]);
  await assert.rejects(db.query("update warehouse.products set name='Foreign command' where id=$1",[plan.roots[0].id]),/isolated fixture/);
}));

test('registered fixture denies a serial-only reference nested in JSON',()=>fixture(async({db,plan})=>{
  const serial=`QA-${plan.runId.slice('wms-fixture-'.length).toUpperCase()}`;
  await assert.rejects(db.query("insert into warehouse.cycle_counts(id,lines,status) values('serial-only',$1,'draft')",[JSON.stringify([{pickedSerialNumbers:[null,42,serial.toLowerCase()]}])]),/isolated fixture/);
}));
