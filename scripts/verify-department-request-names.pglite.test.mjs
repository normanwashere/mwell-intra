import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20260908042032_department_request_actor_names.sql', import.meta.url), 'utf8');
const requester = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const approver = '33333333-3333-4333-8333-333333333333';
const request = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const foreign = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
async function setup() {
  const db = new PGlite();
  await db.exec(`create role authenticated; create role anon; create schema auth; create schema core; create schema warehouse; create schema private;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.actor',true),'')::uuid$$;
    create function core.has_cap(text,text) returns boolean language sql stable as $$select coalesce(current_setting('test.cap',true),'') = $1 || '.' || $2$$;
    create table core.profiles(id uuid primary key, full_name text);
    create table warehouse.department_stock_requests(id uuid primary key, requested_by uuid, approved_by uuid);
    insert into core.profiles values('${requester}','Marketing Lead'),('${approver}','Approver'),('${other}','Other Person');
    insert into warehouse.department_stock_requests values('${request}','${requester}','${approver}'),('${foreign}','${other}',null);
    grant usage on schema warehouse,private to authenticated; grant usage on schema warehouse,private to anon;
    ${migration}
    set role authenticated; set test.actor='${requester}'; set test.cap='';`);
  return db;
}
const lookup = (db, ids) => db.query('select * from warehouse.department_request_actor_names($1::uuid[]) order by request_id', [ids]);

test('own request discloses only linked names; guessed unrelated request and actor IDs reveal nothing', async () => {
  const db = await setup(); try {
    assert.deepEqual((await lookup(db,[request,foreign,other])).rows,[{request_id:request,requested_by_name:'Marketing Lead',approved_by_name:'Approver'}]);
    assert.deepEqual((await lookup(db,[])).rows,[]);
    await assert.rejects(db.query('select * from core.profiles'),/permission denied/);
  } finally { await db.close(); }
});
for (const cap of ['warehouse.issue_items','procurement.approve_request']) test(`${cap} reads names for specifically requested rows`, async () => {
  const db = await setup(); try {
    await db.exec(`set test.actor='${approver}';set test.cap='${cap}'`);
    assert.equal((await lookup(db,[request])).rows[0].requested_by_name,'Marketing Lead');
    assert.equal((await lookup(db,[request])).rows.length,1);
  } finally { await db.close(); }
});
test('unrelated capability, no identity, oversized input and anonymous execution fail closed', async () => {
  const db = await setup(); try {
    await db.exec(`set test.actor='${approver}';set test.cap='warehouse.view_inventory'`);
    assert.deepEqual((await lookup(db,[request])).rows,[]);
    await assert.rejects(lookup(db,Array(201).fill(request)),/At most 200/);
    await db.exec("set test.actor=''");
    await assert.rejects(lookup(db,[request]),/Authentication required/);
    await db.exec('reset role; set role anon');
    await assert.rejects(lookup(db,[request]),/permission denied/);
  } finally { await db.close(); }
});
test('missing names remain null and migration grants no profile access', async () => {
  const db = await setup(); try {
    await db.exec(`reset role;update core.profiles set full_name='   ' where id='${requester}';delete from core.profiles where id='${approver}';set role authenticated;`);
    assert.deepEqual((await lookup(db,[request])).rows,[{request_id:request,requested_by_name:null,approved_by_name:null}]);
    await db.exec('reset role');
    const result = await db.query("select has_table_privilege('authenticated','core.profiles','SELECT') as profiles, has_function_privilege('anon','warehouse.department_request_actor_names(uuid[])','EXECUTE') as anonymous");
    assert.deepEqual(result.rows,[{profiles:false,anonymous:false}]);
  } finally { await db.close(); }
});
