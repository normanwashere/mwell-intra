import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync('supabase/migrations/20260905175131_uat_request_cleanup_retained_history.sql', 'utf8');
const retention = readFileSync('supabase/migrations/20260905090000_procurement_remediation.sql', 'utf8');
const marker = 'QA-20260905-00003C1F-desktop-1440';
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private; create schema procurement;
    grant usage on schema private, procurement to service_role;
    create function auth.role() returns text language sql as $$ select nullif(current_setting('test.role', true), '') $$;
    create table procurement.requests(id text primary key, title text, revision integer not null default 0);
    create table procurement.approval_steps(id text primary key, request_id text references procurement.requests on delete cascade);
    create table procurement.purchase_orders(id text primary key, request_id text references procurement.requests);
    create table procurement.request_revisions(request_id text references procurement.requests);
    insert into procurement.requests values('${marker}-request','Audit',3),('seed','Tester seed',2);
    insert into procurement.approval_steps values('audit-step','${marker}-request'),('seed-step','seed');`);
  const start = retention.indexOf('create table procurement.approval_step_audit');
  const end = retention.indexOf('-- Same retained IDs', start);
  await db.exec(retention.slice(start, end));
  await db.exec(migration);
  return db;
}
async function cleanup(db, value = marker) {
  return (await db.query('select procurement.cleanup_certification_requests($1) as result', [value])).rows[0].result;
}
test('parent-first cleanup reproduces CI failure; scoped child-first cleanup preserves seed and is repeatable', async () => {
  const db = await fixture();
  try {
    await assert.rejects(db.query('delete from procurement.requests where id=$1', [`${marker}-request`]), /request_revision/);
    await db.exec("set test.role='service_role'; set role service_role;");
    assert.deepEqual(await cleanup(db), { marker, removed: 1, remaining: 0 });
    assert.equal((await cleanup(db)).removed, 0);
    await db.exec('reset role');
    assert.deepEqual((await db.query('select id, revision from procurement.requests')).rows, [{ id: 'seed', revision: 2 }]);
    assert.equal((await db.query('select id from procurement.approval_step_audit')).rows[0].id, 'seed-step');
  } finally { await db.close(); }
});
test('rejects null roles, untrusted roles, invalid markers and linked orders without partial deletion', async () => {
  const db = await fixture();
  try {
    await assert.rejects(cleanup(db), /Service role required/);
    await db.exec("set test.role='authenticated'");
    await assert.rejects(cleanup(db), /Service role required/);
    await db.exec("set test.role='service_role'");
    for (const value of [null, '', 'QA-%', marker + '-extra']) await assert.rejects(cleanup(db, value), /Invalid certification marker/);
    await db.exec(`insert into procurement.purchase_orders values('order','${marker}-request')`);
    await assert.rejects(cleanup(db), /Linked purchase orders remain/);
    assert.equal((await db.query('select count(*)::int as n from procurement.approval_steps')).rows[0].n, 2);
    await db.exec('set role authenticated');
    await assert.rejects(cleanup(db), /permission denied/);
  } finally { await db.close(); }
});
