import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const prior = readFileSync(new URL('../../supabase/migrations/20260905175131_uat_request_cleanup_retained_history.sql', import.meta.url), 'utf8');
const forward = readFileSync(new URL('../../supabase/migrations/20260905181632_certification_payment_evidence_cleanup.sql', import.meta.url), 'utf8');
const retention = readFileSync(new URL('../../supabase/migrations/20260905090000_procurement_remediation.sql', import.meta.url), 'utf8');
const marker = 'QA-20260905-00003C1F-desktop-1440';
const requestId = `req_${marker}-receipt-request`;
async function fixture() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private; create schema procurement;
    grant usage on schema private, procurement to service_role, authenticated, anon;
    create function auth.role() returns text language sql as $$ select nullif(current_setting('test.role', true), '') $$;
    create table procurement.requests(id text primary key, title text, revision integer not null default 0);
    create table procurement.approval_steps(id text primary key, request_id text references procurement.requests on delete cascade);
    create table procurement.purchase_orders(id text primary key, request_id text references procurement.requests);
    create table procurement.request_revisions(request_id text references procurement.requests);
    create table procurement.request_attachments(id text primary key, request_id text references procurement.requests on delete cascade);
    insert into procurement.requests values('${requestId}','${marker} Receipt authority request',3),
      ('${requestId}-ordinary','Ordinary similar ID',3),
      ('req_${marker}-other-request','Ordinary other ID',3),
      ('req_QA-20260905-00003C1F-mobile-390-receipt-request','Other viewport',3),
      ('seed','Ordinary request',3);
    insert into procurement.approval_steps select id||'-step',id from procurement.requests;
    insert into procurement.request_revisions select id from procurement.requests;
    insert into procurement.request_attachments select id||'-doc',id from procurement.requests;`);
  const start = retention.indexOf('create table procurement.approval_step_audit');
  await db.exec(retention.slice(start, retention.indexOf('-- Same retained IDs', start)));
  await db.exec(prior);
  return db;
}
const cleanup = async (db, value = marker) => (await db.query('select procurement.cleanup_certification_requests($1) as result', [value])).rows[0].result;

test('forward extension removes exact req_ receipt ID with retention ordering, preserves lookalikes and repeats safely', async () => {
  const db = await fixture();
  try {
    await db.exec("set test.role='service_role'; set role service_role;");
    assert.equal((await cleanup(db)).removed, 0);
    await db.exec('reset role');
    await db.exec(forward);
    await db.exec('set role service_role');
    assert.deepEqual(await cleanup(db), { marker, removed: 1, remaining: 0 });
    assert.equal((await cleanup(db)).removed, 0);
    await db.exec('reset role');
    for (const table of ['requests', 'approval_steps', 'approval_step_audit', 'request_revisions', 'request_attachments']) {
      assert.equal((await db.query(`select count(*)::int n from procurement.${table}`)).rows[0].n, 4, table);
    }
    assert.equal((await db.query('select count(*)::int n from procurement.requests where id=$1', [requestId])).rows[0].n, 0);
    const { rows } = await db.query("select prosecdef, proconfig from pg_proc where oid='private.cleanup_certification_requests(text)'::regprocedure");
    assert.equal(rows[0].prosecdef, true);
    assert.ok(rows[0].proconfig.some(value => value.startsWith('search_path=')));
  } finally { await db.close(); }
});

test('forward cleanup rejects roles, invalid scope and linked POs atomically', async () => {
  const db = await fixture();
  try {
    await db.exec(forward);
    await assert.rejects(cleanup(db), /Service role required/);
    for (const role of ['authenticated', 'anon']) {
      await db.exec(`set test.role='${role}'`);
      await assert.rejects(cleanup(db), /Service role required/);
      await db.exec(`set role ${role}`);
      await assert.rejects(cleanup(db), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec("set test.role='service_role'");
    for (const invalid of [null, '', 'QA-%', marker + '-extra', `req_${marker}`, marker.toLowerCase()])
      await assert.rejects(cleanup(db, invalid), /Invalid certification marker/);
    await db.query('insert into procurement.purchase_orders values ($1,$2)', ['ordinary-order', requestId]);
    await assert.rejects(cleanup(db), /Linked purchase orders remain/);
    for (const table of ['requests', 'approval_steps', 'approval_step_audit', 'request_revisions', 'request_attachments'])
      assert.equal((await db.query(`select count(*)::int n from procurement.${table}`)).rows[0].n, 5);
  } finally { await db.close(); }
});
