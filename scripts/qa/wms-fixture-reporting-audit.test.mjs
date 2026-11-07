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
