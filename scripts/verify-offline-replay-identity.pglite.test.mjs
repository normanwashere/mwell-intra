import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const migration = (name) => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const actor = '11111111-1111-4111-8111-111111111111';
const rpc = async (method, payload) => (await db.query(`select warehouse.${method}($1::jsonb) result`, [JSON.stringify(payload)])).rows[0].result;
const command = (key) => ({ idempotency_key: key, command_input: { productId: 'bulk', quantity: 2 }, movement: { id: 'first' } });

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema warehouse; create schema private; create schema auth; create schema core;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
    create function core.has_live_cap(text,text) returns boolean language sql stable as $$ select coalesce(current_setting('test.live',true),'on') <> 'off' $$;
    create table warehouse.effects(method text, actor uuid);
    create function warehouse.issue_uncertified_impl(payload jsonb) returns jsonb language plpgsql as $$ begin
      if payload->>'held' = 'true' then raise exception 'Held stock'; end if;
      insert into warehouse.effects values('issue',auth.uid()); return payload->'movement'; end; $$;
    create function private.warehouse_transfer(payload jsonb) returns jsonb language plpgsql as $$ begin
      if payload->>'held' = 'true' then raise exception 'Held stock'; end if;
      insert into warehouse.effects values('transfer',auth.uid()); return payload->'movement'; end; $$;
    select set_config('request.jwt.claim.sub','${actor}',false);
  `);
  // Use the actual latest certification wrappers, not an invented public chain.
  const authority = await migration('20260813203240_task_1_database_authority_remediation.sql');
  for (const name of ['issue', 'transfer']) {
    const start = authority.indexOf(`create or replace function warehouse.${name}(payload jsonb)`);
    assert.notEqual(start, -1);
    await db.exec(authority.slice(start, authority.indexOf('$$;', start) + 3));
  }
  await db.exec(await migration('20260905094000_offline_replay_identity.sql'));
});
after(() => db.close());

for (const method of ['issue', 'transfer']) {
  test(`${method}: lost response/replay returns original receipt with one effect`, async () => {
    const input = command(`replay-${method}-0001`);
    const first = await rpc(method, input);
    assert.deepEqual(await rpc(method, { ...input, movement: { id: 'new-generated-id' } }), first);
    assert.deepEqual(await rpc(method, { ...input, replay_only: true }), first);
    assert.equal((await db.query('select count(*)::int n from warehouse.effects where method=$1', [method])).rows[0].n, 1);
    await assert.rejects(rpc(method, { ...input, command_input: { quantity: 9 } }), /different payload/);
    await db.exec("select set_config('test.live','off',false)");
    await assert.rejects(rpc(method, { ...input, replay_only: true }), /Not authorized/);
    await db.exec("select set_config('test.live','on',false)");
  });
}

test('receipt belongs to authenticated actor, never payload actor', async () => {
  await db.exec("select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',false)");
  assert.equal(await rpc('issue', { ...command('replay-issue-0001'), actor, replay_only: true }), null);
  await db.exec(`select set_config('request.jwt.claim.sub','${actor}',false)`);
});

test('new intents still traverse existing hold checks, failure leaves no receipt', async () => {
  for (const method of ['issue', 'transfer']) {
    const input = { ...command(`held-${method}-0001`), held: true };
    await assert.rejects(rpc(method, input), /Held stock/);
    assert.equal(await rpc(method, { ...input, replay_only: true }), null);
  }
});

test('private receipt and renamed implementations cannot be called by authenticated', async () => {
  const result = await db.query(`select
    has_table_privilege('authenticated','private.warehouse_offline_receipts','select') table_access,
    has_function_privilege('authenticated','warehouse.issue_pre_offline_identity(jsonb)','execute') issue_access,
    has_function_privilege('authenticated','warehouse.transfer_pre_offline_identity(jsonb)','execute') transfer_access`);
  assert.deepEqual(result.rows[0], { table_access: false, issue_access: false, transfer_access: false });
});
