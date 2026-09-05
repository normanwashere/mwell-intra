import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const prior = readFileSync(new URL('../../supabase/migrations/20260905175131_uat_request_cleanup_retained_history.sql', import.meta.url), 'utf8');
const forward = readFileSync(new URL('../../supabase/migrations/20260905181632_certification_payment_evidence_cleanup.sql', import.meta.url), 'utf8');
const retention = readFileSync(new URL('../../supabase/migrations/20260905090000_procurement_remediation.sql', import.meta.url), 'utf8');
const invoiceAcl = readFileSync(new URL('../../supabase/migrations/20260905225538_authorize_service_invoice_identity_cleanup.sql', import.meta.url), 'utf8');
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

test('actual invoice identity ACL reproduces cleanup failure then permits only service scoped read/delete', async () => {
  const db = await fixture();
  const desktop = 'QA-20260905-00003DAF-desktop-1440';
  const mobile = 'QA-20260905-00003DB0-mobile-390';
  try {
    await db.exec(forward);
    await db.exec(`alter role service_role bypassrls;
      create table procurement.payment_readiness_packs(id uuid primary key, purchase_order_id text references procurement.purchase_orders);
      grant select,delete on procurement.payment_readiness_packs,procurement.purchase_orders to service_role;`);
    const start = retention.indexOf('create table procurement.vendor_invoice_identities (');
    const end = retention.indexOf('insert into procurement.vendor_invoice_identities', start);
    assert.ok(start >= 0 && end > start);
    await db.exec(retention.slice(start, end));
    const scopes = [desktop, mobile, desktop + '-lookalike', 'ordinary'];
    const packs = [];
    for (const scope of scopes) {
      const id = (await db.query('select gen_random_uuid() id')).rows[0].id;
      packs.push(id);
      await db.query('insert into procurement.requests(id,title) values($1,$2)', [`req_${scope}-receipt-request`, 'Retained']);
      await db.query('insert into procurement.purchase_orders values($1,$2)', [`${scope}-po`, `req_${scope}-receipt-request`]);
      await db.query('insert into procurement.payment_readiness_packs values($1,$2)', [id, `${scope}-po`]);
      await db.query(`insert into procurement.vendor_invoice_identities values(gen_random_uuid(),$1,$2)`, [scope, id]);
    }
    const removeIdentity = id => db.query('delete from procurement.vendor_invoice_identities where current_pack_id=$1', [id]);
    await db.exec("set test.role='service_role'; set role service_role");
    await assert.rejects(db.query('select current_pack_id from procurement.vendor_invoice_identities'), /permission denied/);
    await assert.rejects(removeIdentity(packs[0]), /permission denied/);
    await assert.rejects(db.query('delete from procurement.payment_readiness_packs where id=$1', [packs[0]]), /vendor_invoice_identities_current_pack_id_fkey/);
    await db.exec('reset role');
    await db.exec(invoiceAcl);
    await db.exec(invoiceAcl);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select current_pack_id from procurement.vendor_invoice_identities'), /permission denied/);
      await assert.rejects(removeIdentity(packs[0]), /permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    await assert.rejects(db.query('select invoice_identity from procurement.vendor_invoice_identities'), /permission denied/);
    await assert.rejects(db.query('update procurement.vendor_invoice_identities set current_pack_id=$1', [packs[0]]), /permission denied/);
    await assert.rejects(db.query(`insert into procurement.vendor_invoice_identities values(gen_random_uuid(),'new',$1)`, [packs[0]]), /permission denied/);
    for (const [index, scope] of [desktop, mobile].entries()) {
      // Same exact-pack filter and identity -> pack -> PO -> retained-request ordering as cleanup.
      assert.equal((await db.query('select current_pack_id from procurement.vendor_invoice_identities where current_pack_id=$1', [packs[index]])).rows.length, 1);
      await removeIdentity(packs[index]);
      await removeIdentity(packs[index]);
      assert.equal((await db.query('select current_pack_id from procurement.vendor_invoice_identities where current_pack_id=$1', [packs[index]])).rows.length, 0);
      await db.query('delete from procurement.payment_readiness_packs where id=$1', [packs[index]]);
      await db.query('delete from procurement.purchase_orders where id=$1', [`${scope}-po`]);
      assert.equal((await cleanup(db, scope)).removed, 1);
    }
    await db.exec('reset role');
    assert.deepEqual((await db.query('select invoice_identity from procurement.vendor_invoice_identities order by invoice_identity')).rows.map(row => row.invoice_identity), [desktop + '-lookalike', 'ordinary']);
    assert.equal((await db.query('select count(*)::int n from procurement.payment_readiness_packs')).rows[0].n, 2);
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='procurement.vendor_invoice_identities'::regclass")).rows[0].relrowsecurity, true);
  } finally { await db.close(); }
});
