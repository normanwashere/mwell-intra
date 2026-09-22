import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { rawReadFixture, setRoles, READER, OTHER } from './warehouse-raw-read-policy.fixture.mjs';

const migration = await readFile(new URL('../supabase/migrations/20260920084037_enforce_event_ledger_effective_finance_read.sql', import.meta.url), 'utf8');
const original = await readFile(new URL('../supabase/migrations/20260920025525_gated_event_seller_custody.sql', import.meta.url), 'utf8');
const verifier = await readFile(new URL('../supabase/migrations/20260816210000_add_service_role_launch_verifier.sql', import.meta.url), 'utf8');
const oldCheck = "core.has_cap('events','approve_settlement')";
const newCheck = "core.has_live_cap('events','approve_settlement')";
const definition = name => original.match(new RegExp(`create (?:or replace )?function ${name.replaceAll('.', '\\.')}\\([\\s\\S]*?\\$\\$;`))[0];
const ledger = async (db, event = 'own') => (await db.query('select warehouse.event_custody_ledger($1::jsonb) result', [{ event_id: event }])).rows[0].result;

async function fixture({ apply = true, timeZone = 'UTC' } = {}) {
  const db = await rawReadFixture();
  await db.query("select set_config('TimeZone',$1,false)", [timeZone]);
  await db.exec(`alter table core.profiles add full_name text default 'Fixture',add email text;
    update core.profiles set email=case when id='${READER}' then 'reader@example.test' else 'other@example.test' end;
    alter table warehouse.events add name text default 'Event',add status text default 'active',add owner_email text default 'reader@example.test',
      add start_date date default (statement_timestamp() at time zone 'Asia/Manila')::date,
      add end_date date default (statement_timestamp() at time zone 'Asia/Manila')::date;
    create table private.event_sellers(event_id text,user_id uuid,revoked_at timestamptz,valid_from timestamptz,valid_until timestamptz);
    insert into private.event_sellers values('own','${READER}',null,now()-interval '1 day',now()+interval '1 day');
    create table private.event_custody_sources(event_id text,allocation_id text,product_id text);
    insert into private.event_custody_sources values('own','allocation-1','product-1');
    create table private.event_custody_entries(id uuid primary key,event_id text,seller_id uuid,kind text,quantity int,amount numeric,reverses_id uuid,created_at timestamptz default now());
    insert into private.event_custody_entries values('${READER}','own','${READER}','sale',1,10,null,now()),('${OTHER}','own','${OTHER}','sale',1,20,null,now());
    create table private.event_custody_sessions(event_id text,enabled boolean);
    insert into private.event_custody_sessions values('own',true);
    create function private.event_allocation_remaining(text) returns jsonb language sql stable as $$select jsonb_build_object('allocation_id',$1)$$;
    create function warehouse.event_custody_readiness(jsonb) returns jsonb language sql stable as $$select '{"ready":true}'::jsonb$$;
    create table learning.mutation_capability_rules(module text,capability text);
    insert into learning.mutation_capability_rules values('events','approve_settlement');
    insert into learning.test_certification_required values('events','approve_settlement');
    create or replace function learning.has_active_certification(uuid,text,text) returns boolean language sql as $$select coalesce(current_setting('test.certified',true),'false')='true'$$;`);
  for (const name of ['private.is_event_seller', 'private.is_event_custody_owner', 'warehouse.event_custody_ledger']) await db.exec(definition(name));
  await db.exec(`revoke all on function warehouse.event_custody_ledger(jsonb) from public,anon;
    grant execute on function warehouse.event_custody_ledger(jsonb) to authenticated,service_role;`);
  await db.exec(verifier);
  if (apply) await db.exec(migration);
  return db;
}

test('installed predecessor reproduces uncertified Finance cross-seller ledger disclosure and verifier failure', async t => {
  const db = await fixture({ apply: false }); t.after(() => db.close());
  await setRoles(db, [['events', 'finance_reviewer']]);
  assert.equal((await db.query("select core.has_cap('events','approve_settlement') raw,core.has_live_cap('events','approve_settlement') live")).rows[0].raw, true);
  assert.equal((await db.query("select core.has_live_cap('events','approve_settlement') live")).rows[0].live, false);
  assert.equal((await ledger(db)).entries.length, 2);
  await db.exec('reset role');
  const result = (await db.query('select core.verify_security_database_launch_blockers() result')).rows[0].result;
  assert.ok(result.examples.includes('warehouse.event_custody_ledger(payload jsonb)'));
});

test('Finance raw grant without current certification cannot read event ledger', async t => {
  const db = await fixture(); t.after(() => db.close());
  await setRoles(db, [['events', 'finance_reviewer']]);
  await assert.rejects(ledger(db), /Not authorized: event custody read/);
});

test('effective Finance retains full ledger but expiry, revocation and missing identity deny', async t => {
  const db = await fixture(); t.after(() => db.close());
  await db.exec("select set_config('test.certified','true',false)");
  await setRoles(db, [['events', 'finance_reviewer']]);
  const result = await ledger(db);
  assert.equal(result.entries.length, 2); assert.equal(result.totals.gross_sales_amount, 30);
  assert.equal(result.may_configure, false); assert.deepEqual(result.sellers, []);
  await db.exec("select set_config('test.certified','false',false)");
  await assert.rejects(ledger(db), /Not authorized/);
  await db.exec("reset role;select set_config('test.certified','true',false);update core.user_roles set expires_at=now()-interval '1 second';set role authenticated");
  await assert.rejects(ledger(db), /Not authorized/);
  await setRoles(db, []); await assert.rejects(ledger(db), /Not authorized/);
  await setRoles(db, [['events', 'finance_reviewer']]);
  await db.exec("select set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(ledger(db), /Not authorized/);
});

test('named seller keeps own entries only; unassigned and other-event sellers deny', async t => {
  const db = await fixture(); t.after(() => db.close());
  await setRoles(db, [['events', 'seller']]);
  const result = await ledger(db);
  assert.deepEqual(result.entries.map(e => e.seller_id), [READER]);
  assert.equal(result.totals.gross_sales_amount, 10); assert.equal(result.may_configure, false);
  await assert.rejects(ledger(db, 'foreign'), /Not authorized/);
  await db.exec('reset role;delete from private.event_sellers;set role authenticated');
  await assert.rejects(ledger(db), /Not authorized/);
});

for (const timeZone of ['UTC', 'Pacific/Honolulu', 'Pacific/Kiritimati']) {
  test(`seller fixture stays on the Manila event date with database timezone ${timeZone}`, async t => {
    const db = await fixture({ timeZone }); t.after(() => db.close());
    await setRoles(db, [['events', 'seller']]);
    assert.deepEqual((await ledger(db)).entries.map(entry => entry.seller_id), [READER]);
    await assert.rejects(ledger(db, 'foreign'), /Not authorized: event custody read/);
    await db.exec('reset role');
    const dates = (await db.query(`select
      start_date::text as start_date, end_date::text as end_date,
      (statement_timestamp() at time zone 'Asia/Manila')::date::text as event_date
      from warehouse.events where id='own'`)).rows[0];
    assert.equal(dates.start_date, dates.event_date, 'fixture start must use the event business timezone');
    assert.equal(dates.end_date, dates.event_date, 'fixture end must use the event business timezone');
  });
}

test('seller event access includes Manila opening midnight and excludes closing midnight', async t => {
  const db = await fixture(); t.after(() => db.close());
  // Only the clock is substituted in the isolated database; the actual
  // seller predicate, role checks and half-open date boundaries stay intact.
  await db.exec(`create function private.fixture_statement_timestamp() returns timestamptz language sql stable as $$
      select current_setting('test.event_clock')::timestamptz $$;
    update warehouse.events set start_date='2026-09-20',end_date='2026-09-20';
    update private.event_sellers set valid_from='2026-09-19T00:00:00Z',valid_until='2026-09-22T00:00:00Z';`);
  await db.exec(definition('private.is_event_seller')
    .replace('create function', 'create or replace function')
    .replaceAll('statement_timestamp()', 'private.fixture_statement_timestamp()'));
  await setRoles(db, [['events', 'seller']]);
  for (const [instant, allowed] of [
    ['2026-09-19T15:59:59.999Z', false],
    ['2026-09-19T16:00:00Z', true],
    ['2026-09-20T15:59:59.999Z', true],
    ['2026-09-20T16:00:00Z', false],
    ['2026-09-20T17:10:55Z', false],
  ]) {
    await db.query("select set_config('test.event_clock',$1,false)", [instant]);
    if (allowed) assert.deepEqual((await ledger(db)).entries.map(entry => entry.seller_id), [READER], instant);
    else await assert.rejects(ledger(db), /Not authorized: event custody read/, instant);
  }
});

for (const [state, change] of [
  ['revoked assignment', 'update private.event_sellers set revoked_at=now()'],
  ['expired assignment', "update private.event_sellers set valid_until=now()-interval '1 second'"],
  ['future assignment', "update private.event_sellers set valid_from=now()+interval '1 hour'"],
  ['inactive profile', "update core.profiles set status='inactive'"],
  ['expired role', "update core.user_roles set expires_at=now()-interval '1 second'"],
]) {
  test(`seller with ${state} still cannot read event custody`, async t => {
    const db = await fixture(); t.after(() => db.close());
    await setRoles(db, [['events', 'seller']]);
    assert.deepEqual((await ledger(db)).entries.map(entry => entry.seller_id), [READER]);
    await db.exec(`reset role;${change};set role authenticated`);
    await assert.rejects(ledger(db), /Not authorized: event custody read/);
  });
}

test('event owner branch remains effective-capability gated', async t => {
  const db = await fixture(); t.after(() => db.close());
  await setRoles(db, [['events', 'coordinator']]);
  assert.equal((await ledger(db)).may_configure, true);
  await db.exec("reset role;insert into learning.test_certification_required values('events','manage_events');set role authenticated");
  await assert.rejects(ledger(db), /Not authorized/);
});

test('only the actual ledger authority call changes; verifier and ACL contracts remain intact', async t => {
  const db = await fixture({ apply: false }); t.after(() => db.close());
  const before = (await db.query("select pg_get_functiondef('warehouse.event_custody_ledger(jsonb)'::regprocedure) definition,proacl::text acl,proconfig from pg_proc where oid='warehouse.event_custody_ledger(jsonb)'::regprocedure")).rows[0];
  const verifierBefore = (await db.query("select pg_get_functiondef('core.verify_security_database_launch_blockers()'::regprocedure) definition")).rows[0].definition;
  await db.exec(migration);
  const after = (await db.query("select pg_get_functiondef('warehouse.event_custody_ledger(jsonb)'::regprocedure) definition,proacl::text acl,proconfig from pg_proc where oid='warehouse.event_custody_ledger(jsonb)'::regprocedure")).rows[0];
  assert.equal(after.definition, before.definition.replace(oldCheck, newCheck));
  assert.equal(after.acl, before.acl); assert.deepEqual(after.proconfig, before.proconfig);
  assert.equal((await db.query("select pg_get_functiondef('core.verify_security_database_launch_blockers()'::regprocedure) definition")).rows[0].definition, verifierBefore);
  assert.equal((await db.query('select core.verify_security_database_launch_blockers() result')).rows[0].result.raw_boundaries, 0);
  await db.exec("create function warehouse.other_unsafe_fixture() returns boolean language sql security definer as $$select core.has_cap('events','approve_settlement')$$;grant execute on function warehouse.other_unsafe_fixture() to authenticated");
  assert.equal((await db.query('select core.verify_security_database_launch_blockers() result')).rows[0].result.raw_boundaries, 1);
});
