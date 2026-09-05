import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const actor = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const migration = await readFile(new URL('../supabase/migrations/20260828010344_receiving_saved_progress.sql', import.meta.url), 'utf8');
const forwardMigration = await readFile(new URL('../supabase/migrations/20260905050820_receiving_draft_explicit_live_authority.sql', import.meta.url), 'utf8');
const authority = await readFile(new URL('../supabase/migrations/20260812200000_learning_authority.sql', import.meta.url), 'utf8');
const verifier = await readFile(new URL('./verify-security-database-launch-blockers.mjs', import.meta.url), 'utf8');
const rawBoundaryQuery = verifier.match(/const RAW_BOUNDARY_QUERY = `([\s\S]*?)`;/)[1];
const db = new PGlite();
const snapshot = { version: 1, lines: [{ lineId: 'line-1', serials: ['S-1', 'unfinished-'], quantity: 2, expectedQuantity: 5 }], location: 'receiving' };

before(async () => {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema core;
    create schema private;
    create schema procurement;
    create schema warehouse;
    create schema learning;
    create function auth.role() returns text language sql stable as $$
      select current_setting('request.jwt.claim.role', true)
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function core.has_cap(text, text) returns boolean language sql stable as $$
      select $1 = 'warehouse' and $2 = 'receive_stock'
        and coalesce(current_setting('test.has_cap', true), 'on') = 'on'
    $$;
    create table learning.mutation_capability_rules(module text, capability text);
    insert into learning.mutation_capability_rules values ('warehouse','receive_stock');
    create function learning.is_certification_required(text,text) returns boolean language sql as $$ select true $$;
    create function learning.has_active_certification(uuid,text,text) returns boolean language sql stable as $$
      select coalesce(current_setting('test.has_live_cap', true), 'on') = 'on'
    $$;
    create function learning.has_active_emergency_exception(uuid,text,text) returns boolean language sql stable as $$
      select coalesce(current_setting('test.emergency', true), 'off') = 'on'
    $$;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${actor}'), ('${other}');
    create table procurement.requests(id text primary key, category text not null);
    insert into procurement.requests values ('goods', 'goods'), ('service', 'services');
    create table procurement.purchase_orders(id text primary key, status text not null, request_id text not null);
    insert into procurement.purchase_orders values
      ('po-1', 'issued', 'goods'), ('po-2', 'issued', 'goods'),
      ('approved', 'approved', 'goods'), ('closed', 'closed', 'goods'),
      ('cancelled', 'cancelled', 'goods'), ('service', 'issued', 'service');
    create function private.is_goods_procurement_request(p_request_id text)
      returns boolean language sql stable security definer set search_path = '' as $$
      select exists(select 1 from procurement.requests where id = p_request_id and category = 'goods')
    $$;
    alter table procurement.purchase_orders enable row level security;
    create policy po_read on procurement.purchase_orders for select to authenticated using (
      core.has_cap('warehouse', 'receive_stock') and status in ('approved', 'issued')
      and private.is_goods_procurement_request(request_id)
      and coalesce(current_setting('test.read_scope', true), 'on') = 'on'
    );
    grant usage on schema warehouse, procurement, private, auth, core to authenticated, anon, service_role;
    grant select on procurement.purchase_orders to authenticated;
    -- Simulate Supabase legacy default grants, which the migration must revoke.
    alter default privileges in schema warehouse grant all on tables to authenticated, anon, service_role;
    alter default privileges in schema warehouse grant all on functions to authenticated, anon, service_role;
    alter default privileges in schema private grant all on functions to authenticated, anon, service_role;
    create table warehouse.stock_levels(id text primary key, quantity integer);
    create table warehouse.receipts(id text primary key);
    create table warehouse.inventory_units(id text primary key);
    create table warehouse.movements(id text primary key);
    insert into warehouse.stock_levels values ('stock-1', 10);
  `);
  // Load the real has_live_cap implementation, including its service shortcut.
  const start = authority.indexOf('create or replace function core.has_live_cap(');
  await db.exec(authority.slice(start, authority.indexOf('$$;', start) + 3));
  await db.exec(migration);
  const oldFlags = (await db.query(rawBoundaryQuery)).rows[0];
  assert.equal(oldFlags.raw_boundaries, 2);
  const contracts = async () => (await db.query(`select p.proname,p.proacl,p.proowner,p.proargtypes::text,p.prorettype,
    p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname in ('receiving_draft_command','can_discard_closed_receiving_draft') order by p.proname`)).rows;
  const beforeContracts = await contracts();
  await db.exec(forwardMigration);
  assert.deepEqual(await contracts(), beforeContracts);
  assert.equal((await db.query(rawBoundaryQuery)).rows[0].raw_boundaries, 0);
});

after(async () => db.close());

async function asActor(id = actor, { live = 'on', cap = 'on', scope = 'on', role = 'authenticated' } = {}) {
  await db.exec('reset role');
  await db.query(`select set_config('request.jwt.claim.sub', $1, false),
    set_config('test.has_live_cap', $2, false), set_config('test.has_cap', $3, false),
    set_config('test.read_scope', $4, false), set_config('request.jwt.claim.role', $5, false),
    set_config('test.emergency', 'off', false)`, [id, live, cap, scope, role]);
  await db.exec(`set role ${role}`);
}

async function command(operation, po = 'po-1', version = 0, body = snapshot) {
  const args = operation === 'load' ? [po] : operation === 'save' ? [po, JSON.stringify(body), version] : [po, version];
  const signature = operation === 'load' ? '$1' : operation === 'save' ? '$1, $2::jsonb, $3' : '$1, $2';
  const result = await db.query(`select warehouse.${operation}_receiving_draft(${signature}) as result`, args);
  return result.rows[0].result;
}

test('load/save/delete revisions preserve unfinished work and prevent stale/ABA writes', async () => {
  await asActor();
  assert.deepEqual(await command('load'), { status: 'ok', po_id: 'po-1', body: null, version: 0, updated_at: null });
  const saved = await command('save');
  assert.equal(saved.version, 1);
  assert.deepEqual(saved.body, snapshot);
  assert.ok(saved.updated_at);
  assert.deepEqual(await command('load'), saved);
  assert.deepEqual(await command('save', 'po-1', 0), { status: 'conflict', current_version: 1 });
  assert.deepEqual(await command('delete', 'po-1', 0), { status: 'conflict', current_version: 1 });
  const updated = await command('save', 'po-1', 1, { ...snapshot, reason: 'next scan' });
  assert.equal(updated.version, 2);
  const removed = await command('delete', 'po-1', 2);
  assert.equal(removed.version, 3);
  assert.equal(removed.body, null);
  assert.deepEqual(await command('load'), removed);
  assert.deepEqual(await command('save', 'po-1', 0), { status: 'conflict', current_version: 3 });
  assert.deepEqual(await command('save', 'po-1', 1), { status: 'conflict', current_version: 3 });
  assert.equal((await command('save', 'po-1', 3)).version, 4);
});

test('operators have independent drafts for the same PO and RLS hides other actors', async () => {
  await asActor(other);
  assert.equal((await command('load')).version, 0);
  assert.equal((await db.query('select * from warehouse.receiving_drafts')).rows.length, 0);
  assert.equal((await command('save', 'po-1', 0, { version: 1, scans: ['other'] })).version, 1);
  assert.deepEqual((await db.query('select actor_id from warehouse.receiving_drafts')).rows, [{ actor_id: other }]);
  await asActor();
  assert.equal((await command('load')).version, 4);
  assert.deepEqual((await command('load')).body, snapshot);
  assert.equal((await command('save', 'po-2')).version, 1);
  assert.equal((await db.query('select * from warehouse.receiving_drafts')).rows.length, 2);
});

test('direct inserts, updates, and deletes are denied even for the owner', async () => {
  await asActor();
  for (const sql of [
    `insert into warehouse.receiving_drafts(actor_id, po_id, body, version) values ('${other}', 'po-2', '{"version":1}', 1)`,
    `update warehouse.receiving_drafts set body = '{"version":1}', version = 100`,
    'delete from warehouse.receiving_drafts',
  ]) await assert.rejects(db.exec(sql), { code: '42501' });
  assert.equal((await command('load')).version, 4);
});

test('all RPCs reject unauthenticated actors and revoked capability or PO read access', async () => {
  for (const [id, options, code] of [
    ['', {}, '28000'], [actor, { live: 'off' }, '42501'],
    [actor, { cap: 'off' }, '42501'], [actor, { scope: 'off' }, '42501'],
  ]) {
    await asActor(id, options);
    for (const operation of ['load', 'save', 'delete']) {
      await assert.rejects(command(operation), { code });
    }
    assert.equal((await db.query('select * from warehouse.receiving_drafts')).rows.length, 0);
  }
});

test('anon and service-role sessions cannot execute draft RPCs or read raw drafts', async () => {
  for (const role of ['anon', 'service_role']) {
    await asActor('', { role });
    for (const operation of ['load', 'save', 'delete']) await assert.rejects(command(operation), { code: '42501' });
    await assert.rejects(db.exec('select * from warehouse.receiving_drafts'), { code: '42501' });
    await assert.rejects(db.exec("select private.receiving_draft_command('save', 'po-1', '{\"version\":1}', 0)"), { code: '42501' });
  }
});

test('only readable issued goods POs accept any draft operation', async () => {
  await asActor();
  for (const po of ['approved', 'closed', 'cancelled', 'service', 'missing']) {
    for (const operation of ['load', 'save', 'delete']) await assert.rejects(command(operation, po), { code: '42501' });
  }
  await db.exec('reset role');
  await db.exec("update procurement.purchase_orders set status = 'closed' where id = 'po-2'");
  await asActor();
  await assert.rejects(command('load', 'po-2'), { code: '42501' });
  assert.equal((await db.query("select * from warehouse.receiving_drafts where po_id = 'po-2'")).rows.length, 0);
});

test('post-receipt cleanup can clear only the own closed-PO draft, with optimistic revision', async () => {
  await asActor(other);
  await assert.rejects(command('delete', 'po-2', 1), { code: '42501' });
  await asActor(actor, { live: 'off' });
  await assert.rejects(command('delete', 'po-2', 1), { code: '42501' });
  await asActor();
  assert.deepEqual(await command('delete', 'po-2', 0), { status: 'conflict', current_version: 1 });
  const deleted = await command('delete', 'po-2', 1);
  assert.equal(deleted.body, null);
  assert.equal(deleted.version, 2);
  await assert.rejects(command('load', 'po-2'), { code: '42501' });
  await assert.rejects(command('save', 'po-2', 2), { code: '42501' });
});

test('JSON format, size, nesting, string and credential limits are enforced in SQL', async () => {
  await asActor();
  let deep = 0;
  for (let index = 0; index < 17; index++) deep = { nested: deep };
  for (const body of [
    null, [], {}, { version: 2 }, { version: '1' },
    { version: 1, lines: Array(1001).fill(0) }, { version: 1, text: 'x'.repeat(8193) },
    { version: 1, deep }, { version: 1, ['x'.repeat(129)]: 0 },
    { version: 1, text: Array(9).fill('x'.repeat(8192)) },
    { version: 1, many: Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`f${i}`, 0])) },
    { version: 1, many: Array.from({ length: 11 }, () => Array(1000).fill(0)) },
    ...['password', 'Pass_Word', 'accessToken', 'refresh_token', 'api-key', 'clientSecret', 'authorization']
      .map((key) => ({ version: 1, nested: [{ [key]: 'must-not-store' }] })),
  ]) await assert.rejects(command('save', 'po-1', 4, body), { code: '22023' });
  assert.equal((await command('load')).version, 4);
});

test('invalid expected versions and PO identifiers cannot change progress', async () => {
  await asActor();
  for (const version of [null, -1, 2147483647]) {
    for (const operation of ['save', 'delete']) await assert.rejects(command(operation, 'po-1', version), { code: '22023' });
  }
  for (const po of [null, '', ' ', 'x'.repeat(257)]) await assert.rejects(command('load', po), { code: '22023' });
  assert.equal((await command('load')).version, 4);
});

test('table constraints reject unsafe snapshots and actor/PO foreign keys cascade', async () => {
  await db.exec('reset role');
  await assert.rejects(db.exec(`insert into warehouse.receiving_drafts(actor_id,po_id,body,version)
    values ('${other}', 'po-2', '{"version":1,"password":"no"}', 1)`), { code: '23514' });
  await db.exec(`delete from auth.users where id = '${other}'`);
  assert.equal((await db.query('select * from warehouse.receiving_drafts where actor_id = $1', [other])).rows.length, 0);
  await db.exec("delete from procurement.purchase_orders where id = 'po-2'");
  assert.equal((await db.query("select * from warehouse.receiving_drafts where po_id = 'po-2'")).rows.length, 0);
});

test('draft commands never mutate inventory or receipt authority and expose no actor parameter', async () => {
  await db.exec('reset role');
  assert.deepEqual((await db.query('select * from warehouse.stock_levels')).rows, [{ id: 'stock-1', quantity: 10 }]);
  for (const table of ['receipts', 'inventory_units', 'movements']) {
    assert.equal((await db.query(`select * from warehouse.${table}`)).rows.length, 0);
  }
  const functions = (await db.query(`select p.proname, p.prosecdef, p.proargnames, p.proconfig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'warehouse' and p.proname like '%receiving_draft'`)).rows;
  assert.equal(functions.length, 3);
  for (const fn of functions) {
    assert.equal(fn.prosecdef, false);
    assert.ok(fn.proconfig.some((config) => config.startsWith('search_path=')));
    assert.ok(fn.proargnames.every((name) => !name.includes('actor')));
  }
  const table = (await db.query("select relrowsecurity from pg_class where oid = 'warehouse.receiving_drafts'::regclass")).rows[0];
  assert.equal(table.relrowsecurity, true);
});

test('direct private command requires authenticated current capability and certification', async () => {
  for (const options of [{ live: 'off' }, { cap: 'off' }]) {
    await asActor(actor, options);
    for (const operation of ['load', 'save', 'delete']) {
      await assert.rejects(db.query('select private.receiving_draft_command($1,$2,$3::jsonb,$4)',
        [operation, 'po-1', JSON.stringify(snapshot), 4]), { code: '42501' });
    }
  }
  await asActor();
  // Even if invoked through an authenticated SQL role, service JWT bypass is denied.
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)");
  assert.equal((await db.query("select core.has_live_cap('warehouse','receive_stock') allowed")).rows[0].allowed, true);
  await assert.rejects(db.exec("select private.receiving_draft_command('load','po-1',null,null)"), { code: '42501' });
  await asActor();
  assert.equal((await command('load')).version, 4);
});

test('approved emergency authority remains valid but cannot replace current RBAC', async () => {
  await asActor(actor, { live: 'off' });
  await db.exec("select set_config('test.emergency','on',false)");
  assert.equal((await command('load')).version, 4);
  await db.exec("select set_config('test.has_cap','off',false)");
  await assert.rejects(command('load'), { code: '42501' });
});

test('closed cleanup helper and direct delete preserve actor, live authority and version gates', async () => {
  await db.exec('reset role');
  await db.exec("insert into procurement.purchase_orders values ('closed-contract','issued','goods')");
  await asActor();
  await command('save', 'closed-contract');
  await db.exec('reset role');
  await db.exec("update procurement.purchase_orders set status='closed' where id='closed-contract'");
  for (const [id, options] of [[actor, { live: 'off' }], [actor, { cap: 'off' }], ['', {}]]) {
    await asActor(id, options);
    assert.equal((await db.query("select private.can_discard_closed_receiving_draft('closed-contract') allowed")).rows[0].allowed, false);
  }
  await asActor();
  await db.exec("select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false)");
  assert.equal((await db.query("select private.can_discard_closed_receiving_draft('closed-contract') allowed")).rows[0].allowed, false);
  await asActor();
  assert.equal((await db.query("select private.can_discard_closed_receiving_draft('closed-contract') allowed")).rows[0].allowed, true);
  for (const operation of ['load','save']) {
    await assert.rejects(db.query('select private.receiving_draft_command($1,$2,$3::jsonb,$4)',
      [operation,'closed-contract',JSON.stringify(snapshot),1]), { code: '42501' });
  }
  assert.deepEqual(await command('delete','closed-contract',0), { status:'conflict',current_version:1 });
  assert.equal((await command('delete','closed-contract',1)).body, null);
});
