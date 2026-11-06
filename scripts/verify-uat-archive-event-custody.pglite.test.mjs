import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { rawReadFixture, setRoles, READER } from './warehouse-raw-read-policy.fixture.mjs';

const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const original = read('20260920025525_gated_event_seller_custody.sql');
const finance = read('20260920084037_enforce_event_ledger_effective_finance_read.sql');
const commands = read('20260710160000_warehouse_w1_quality_and_approval_rpcs.sql');
const foundation = read('20261106145742_uat_warehouse_fixture_archive.sql');
const migration = read('20261106180502_uat_archive_event_custody.sql');
const definition = (sql, name) => {
  const found = sql.match(new RegExp(`create (?:or replace )?function ${name.replaceAll('.', '\\.')}\\([\\s\\S]*?\\$\\$;`, 'i'));
  assert.ok(found, name); return found[0];
};
const order = '33333333-3333-4333-8333-333333333333';
let db;
const ledger = async () => (await db.query("select warehouse.event_custody_ledger('{\"event_id\":\"own\"}') data")).rows[0].data;
const payload = (extra = {}) => ({ event_id: 'own', allocation_id: 'sample-allocation', kind: 'sale', quantity: 1,
  amount: 10, serial_numbers: [], external_reference: 'NEW-SALE', idempotency_key: 'archive-event-sale-001', ...extra });
const outcome = async p => (await db.query('select warehouse.record_event_outcome($1::jsonb) data', [p])).rows[0].data;
async function isolated(fn, { isolation = 'read committed' } = {}) {
  await db.exec(`begin isolation level ${isolation}`);
  try { await fn(); } finally { await db.exec('rollback'); }
}
async function denied(fn, pattern) {
  await db.exec('savepoint expected_denial');
  try { await assert.rejects(fn(), pattern); } finally { await db.exec('rollback to savepoint expected_denial'); }
}
async function archive(table = 'allocations', id = 'sample-allocation') {
  await db.exec('reset role');
  await db.query('insert into private.uat_warehouse_archive_members values($1,$2)', [table, id]);
  await db.exec('set local role authenticated');
}
async function snapshot() {
  await db.exec('reset role');
  const data = (await db.query(`select jsonb_build_object(
    'entries',(select jsonb_agg(to_jsonb(t) order by id) from private.event_custody_entries t),
    'sources',(select jsonb_agg(to_jsonb(t) order by allocation_id) from private.event_custody_sources t),
    'commands',(select jsonb_agg(to_jsonb(t) order by id) from warehouse.command_log t),
    'events',(select jsonb_agg(to_jsonb(t) order by id) from warehouse.events t),
    'units',(select jsonb_agg(to_jsonb(t) order by id) from warehouse.inventory_units t)) data`)).rows[0].data;
  await db.exec('set local role authenticated'); return data;
}
before(async () => {
  db = await rawReadFixture();
  await db.exec(`alter table core.profiles add full_name text default 'Fixture',add email text;
    update core.profiles set email=id::text||'@example.test';
    alter table warehouse.events add name text default 'Event',add status text default 'active',add owner_email text,
      add start_date date default (statement_timestamp() at time zone 'Asia/Manila')::date,
      add end_date date default (statement_timestamp() at time zone 'Asia/Manila')::date;
    alter table warehouse.inventory_units add product_id text,add serial_number text,add status text;
    alter table warehouse.inventory_holds add serial_number text,add status text;
    alter table warehouse.returns add lines jsonb default '[]';
    alter table warehouse.event_reconciliations add status text;
    drop table warehouse.fulfillment_orders;
    create table warehouse.fulfillment_orders(id uuid primary key);
    insert into warehouse.fulfillment_orders values('${order}');
    insert into warehouse.products(id) values('sample-product'),('active-product');
    insert into warehouse.allocations(id,event_id) values('sample-allocation','own'),('active-allocation','own');
    ${original.slice(original.indexOf('create table private.event_custody_sessions'), original.indexOf('create function private.is_event_seller'))}
    insert into private.event_custody_sessions(event_id,enabled,configured_by) values('own',true,'${READER}');
    insert into private.event_sellers values('own','${READER}',now()-interval '1 day',now()+interval '1 day',null);
    insert into private.event_custody_sources(allocation_id,event_id,order_id,product_id,quantity,acknowledged_at)
      values('sample-allocation','own','${order}','sample-product',10,now()),('active-allocation','own','${order}','active-product',10,now());
    create table warehouse.command_log(id uuid primary key default gen_random_uuid(),actor_id uuid,command_name text,idempotency_key text,
      payload_hash text,response jsonb,created_at timestamptz default now(),completed_at timestamptz,unique(actor_id,command_name,idempotency_key));
    create function private.warehouse_payload_hash(jsonb) returns text language sql as $$select encode(sha256(convert_to($1::text,'UTF8')),'hex')$$;
    create function warehouse.event_custody_readiness(jsonb) returns jsonb language sql stable as $$select '{"ready":true}'::jsonb$$;
    create table private.uat_warehouse_archive_members(table_name text,row_id text,primary key(table_name,row_id));
    ${definition(foundation, 'private.is_uat_warehouse_archived')}
    ${definition(commands, 'private.begin_idempotent_command')}
    ${definition(commands, 'private.finish_idempotent_command')}
    ${['private.is_event_seller','private.is_event_custody_owner','private.event_allocation_remaining','warehouse.record_event_outcome','warehouse.event_custody_ledger'].map(name => definition(original, name)).join('\n')}
    revoke all on function warehouse.record_event_outcome(jsonb),warehouse.event_custody_ledger(jsonb) from public,anon,service_role;
    grant execute on function warehouse.record_event_outcome(jsonb),warehouse.event_custody_ledger(jsonb) to authenticated;
    revoke all on all tables in schema private from public,anon,authenticated,service_role;
    ${finance}`);
  await setRoles(db, [['events', 'seller']]);
  await outcome(payload({ external_reference: 'HISTORICAL-SALE', idempotency_key: 'archive-event-history-001' }));
  await db.exec('reset role');
});
after(async () => { await db?.close(); });

test('baseline reproduces a fresh private outcome for an archived allocation', () => isolated(async () => {
  await archive(); const result = await outcome(payload()); assert.equal(result.external_reference, 'NEW-SALE');
}));
test('fresh archived outcome is rejected with no command or history residue', () => isolated(async () => {
  await db.exec(migration); await archive(); const before = await snapshot();
  await denied(() => outcome(payload()), /archived UAT event custody/);
  assert.deepEqual(await snapshot(), before);
}));
test('active allocations hide archived sources while original history and totals remain', () => isolated(async () => {
  await setRoles(db, [['events', 'seller']]); const before = await ledger();
  await db.exec('reset role'); await db.exec(migration); await archive(); const after = await ledger();
  assert.deepEqual(after.allocations.map(a => a.allocation_id), ['active-allocation']);
  assert.deepEqual(after.entries.map(({ archived_source, ...e }) => e), before.entries);
  assert.equal(after.entries[0].archived_source, true); assert.deepEqual(after.totals, before.totals);
  assert.equal(after.archived_allocation_count, 1); assert.equal(after.enabled, before.enabled);
}));
for (const [table, id] of [['products','sample-product'], ['fulfillment_orders',order]]) {
  test(`archived ${table} also denies all new outcome kinds`, () => isolated(async () => {
    await db.exec(migration); await archive(table, id);
    for (const kind of ['sale', 'giveaway', 'reversal']) await denied(() => outcome(payload({ kind })), /archived UAT event custody/);
  }));
}
test('valid cached replay survives archival but altered payload and revoked authority still deny', () => isolated(async () => {
  const p = payload({ external_reference: 'HISTORICAL-SALE', idempotency_key: 'archive-event-history-001' });
  await setRoles(db, [['events','seller']]); const before = await outcome(p);
  await db.exec('reset role'); await db.exec(migration); await archive(); const state = await snapshot();
  assert.deepEqual(await outcome(p), before); assert.deepEqual(await snapshot(), state);
  await denied(() => outcome({ ...p, amount: 11 }), /different payload/);
  await db.exec('reset role; update private.event_sellers set revoked_at=now(); set local role authenticated');
  await denied(() => outcome(p), /Not authorized/);
}));
test('archived reversal cannot append, while active allocation sales and reversals still work', () => isolated(async () => {
  await db.exec(migration); await archive(); const history = (await ledger()).entries[0];
  await denied(() => outcome(payload({ kind: 'reversal', reverses_id: history.id, reason: 'Correction' })), /archived UAT event custody/);
  const sale = await outcome(payload({ allocation_id: 'active-allocation' }));
  const reversal = await outcome(payload({ allocation_id: 'active-allocation', kind: 'reversal', reverses_id: sale.id, reason: 'Correction',
    external_reference: 'ACTIVE-REVERSAL', idempotency_key: 'archive-event-reverse-001' }));
  assert.equal(reversal.reverses_id, sale.id); assert.equal((await ledger()).totals.sold_units, 1);
}));
test('direct private insert cannot bypass archive or mismatch its source event', () => isolated(async () => {
  await db.exec(migration); await archive(); await db.exec('reset role');
  const insert = (event, allocation) => db.query(`insert into private.event_custody_entries(event_id,allocation_id,seller_id,kind,quantity,amount,external_reference)
    values($1,$2,$3,'sale',1,10,'DIRECT')`, [event, allocation, READER]);
  await denied(() => insert('own', 'sample-allocation'), /archived UAT event custody/);
  await denied(() => insert('foreign', 'active-allocation'), /lineage unresolved/);
}));
for (const isolation of ['repeatable read', 'serializable']) {
  test(`${isolation} fresh private writes reject rather than use a stale archive snapshot`, () => isolated(async () => {
    await db.exec(migration); await setRoles(db, [['events','seller']]);
    await denied(() => outcome(payload({ allocation_id: 'active-allocation' })), e => e.code === '40001');
    await db.exec('reset role');
    await denied(() => db.exec(`insert into private.event_custody_entries(event_id,allocation_id,seller_id,kind,quantity,amount,external_reference)
      values('own','active-allocation','${READER}','sale',1,10,'DIRECT')`), e => e.code === '40001');
  }, { isolation }));
}
test('existing no-auth, wrong-event and live Finance boundaries remain enforced', () => isolated(async () => {
  await db.exec(migration); await setRoles(db, [['events','seller']]);
  await denied(() => outcome(payload({ event_id: 'foreign' })), /Not authorized/);
  await db.exec("select set_config('request.jwt.claim.sub','',true)");
  await denied(() => outcome(payload()), /Not authorized/);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [READER]);
  await setRoles(db, [['events','finance_reviewer']]);
  await db.exec("reset role; insert into learning.test_certification_required values('events','approve_settlement'); set local role authenticated");
  await denied(() => ledger(), /Not authorized/);
}));
test('private helper permissions, metadata and immutable history are preserved', () => isolated(async () => {
  const metadata = async () => (await db.query("select jsonb_agg(to_jsonb(p)-'prosrc' order by proname) data from pg_proc p where oid in ('warehouse.record_event_outcome(jsonb)'::regprocedure,'warehouse.event_custody_ledger(jsonb)'::regprocedure)")).rows[0].data;
  const before = await metadata(); await db.exec(migration); assert.deepEqual(await metadata(), before);
  await db.exec('set local role authenticated');
  await denied(() => db.exec("select private.event_custody_source_archived('sample-allocation')"), /permission denied/);
  await denied(() => db.exec("select private.assert_uat_event_custody_active('own','sample-allocation')"), /permission denied/);
  await denied(() => db.exec('delete from private.event_custody_entries'), /permission denied/);
  await db.exec('reset role');
  await denied(() => db.exec('delete from private.event_custody_entries'), /history is immutable/);
}));
test('predecessor drift fails closed', () => isolated(async () => {
  await db.exec(definition(original, 'warehouse.record_event_outcome').replace('create function','create or replace function').replace('Unknown event outcome','Changed predecessor'));
  await denied(() => db.exec(migration), /predecessor drift/);
}));
