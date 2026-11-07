import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {after,before,test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';
import {installAdapterFixture} from './wms-fixture-postgres-adapter.fixture.mjs';

const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
const sql=read('./wms-fixture-migration-replay.assert.sql');
const start=sql.indexOf('  -- This independently owned append-only sink');
const end=sql.indexOf("  foreach relation in array array['warehouse.products'",start);
assert(start>=0&&end>start,'Actual Reporting audit assertion block is required');
const assertion=`do $test$ declare audit_relation oid; expected record; begin ${sql.slice(start,end)} end $test$;`;
const platformStart=sql.indexOf('  -- pg_net owns these HTTP transport tables');
assert(platformStart>=0&&platformStart<start,'Actual pg_net assertion block is required');
const platformAssertion=`do $test$ declare name text; platform_relation regclass; begin ${sql.slice(platformStart,start)} end $test$;`;
const db=new PGlite();
before(async()=>{
  await installAdapterFixture(db);
  await db.exec(read('../../supabase/migrations/20260923025605_reporting_private_authority_foundation.sql'));
});
after(async()=>db.close());

test('post-schema proof accepts the actual separately owned Reporting audit without changing it',async()=>{
  const before=(await db.query("select to_jsonb(c) state from pg_class c where oid='reporting_authority.admin_audit'::regclass")).rows;
  await db.exec(assertion);
  assert.deepEqual((await db.query("select to_jsonb(c) state from pg_class c where oid='reporting_authority.admin_audit'::regclass")).rows,before);
  assert.equal((await db.query('select count(*)::int n from reporting_authority.admin_audit')).rows[0].n,0);
});

for(const [name,mutation,message] of [
  ['ownership change','alter table reporting_authority.admin_audit owner to postgres','ownership/RLS'],
  ['RLS removal','alter table reporting_authority.admin_audit disable row level security','ownership/RLS'],
  ['new table grant','grant select on reporting_authority.admin_audit to authenticated','table grants'],
  ['missing immutable hook','drop trigger audit_immutable on reporting_authority.admin_audit','immutability'],
  ['disabled truncate hook','alter table reporting_authority.admin_audit disable trigger audit_no_truncate','immutability'],
  ['non-rejecting audit function','create or replace function reporting_authority._reject_mutation() returns trigger language plpgsql as $$begin return old;end$$','immutability'],
  ['fixture hook installation','create trigger wms_fixture_unexpected before update on reporting_authority.admin_audit for each row execute function reporting_authority._reject_mutation()','must not alter'],
  ['audit selected as a command target',"create or replace function private.wms_fixture_guard_targets() returns table(relation regclass) language sql stable security definer set search_path='' as $$select 'reporting_authority.admin_audit'::regclass$$",'must not alter'],
])test(`post-schema proof rejects ${name}`,async()=>{
  await db.exec('begin');
  try{
    await db.exec(mutation);
    await assert.rejects(db.exec(assertion),error=>error.code==='P0001'&&error.message.includes(message));
  }finally{await db.exec('rollback');}
});

test('pg_net assertion permits an installation without that extension',async()=>{
  assert.equal((await db.query("select count(*)::int n from pg_extension where extname='pg_net'")).rows[0].n,0);
  await db.exec(platformAssertion);
});

// PGlite has no pg_net worker. These rolled-back catalog fixtures exercise the
// assertion; only the hosted Supabase replay proves the real extension boundary.
async function withPlatformCatalog(run){
  await db.exec('begin');
  try{
    await db.exec(`
      create schema net;
      create unlogged table net.http_request_queue(id bigint,headers jsonb);
      create unlogged table net._http_response(id bigint,headers jsonb);
      insert into pg_catalog.pg_extension(oid,extname,extowner,extnamespace,extrelocatable,extversion)
        select 900001,'pg_net',oid,'net'::regnamespace,false,'catalog-fixture-only' from pg_roles where rolname=current_user;
      insert into pg_catalog.pg_depend(classid,objid,objsubid,refclassid,refobjid,refobjsubid,deptype)
        select 'pg_class'::regclass,relation,0,'pg_extension'::regclass,900001,0,'e'
        from unnest(array['net.http_request_queue'::regclass,'net._http_response'::regclass]) relation;
    `);
    await run();
  }finally{await db.exec('rollback');}
}

test('pg_net assertion accepts exact extension membership without changing its catalogs',async()=>withPlatformCatalog(async()=>{
  const before=(await db.query("select to_jsonb(c) state from pg_class c where relnamespace='net'::regnamespace order by oid")).rows;
  await db.exec(platformAssertion);
  assert.deepEqual((await db.query("select to_jsonb(c) state from pg_class c where relnamespace='net'::regnamespace order by oid")).rows,before);
}));

for(const [name,mutation,message] of [
  ['missing table','alter table net.http_request_queue rename to unexpected_queue','infrastructure identity'],
  ['missing extension membership',"delete from pg_depend where classid='pg_class'::regclass and objid='net.http_request_queue'::regclass and deptype='e'",'infrastructure identity'],
  ['extension dependency without membership',"update pg_depend set deptype='x' where classid='pg_class'::regclass and objid='net.http_request_queue'::regclass and deptype='e'",'infrastructure identity'],
  ['fixture trigger','create trigger wms_fixture_unexpected before update on net.http_request_queue for each row execute function reporting_authority._reject_mutation()','must not alter'],
  ['renamed fixture trigger','create trigger unrelated_name before update on net.http_request_queue for each row execute function private.wms_fixture_guard_write()','must not alter'],
  ['transport selected as command',"create or replace function private.wms_fixture_guard_targets() returns table(relation regclass) language sql stable security definer set search_path='' as $$select 'net.http_request_queue'::regclass$$",'must not alter'],
])test(`pg_net assertion rejects ${name}`,async()=>withPlatformCatalog(async()=>{
  await db.exec(mutation);
  await assert.rejects(db.exec(platformAssertion),error=>error.code==='P0001'&&error.message.includes(message));
}));
