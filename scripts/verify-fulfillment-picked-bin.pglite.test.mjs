import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const installed = await readFile(new URL('./fixtures/sep08-installed-fulfillment.sql', import.meta.url), 'utf8');
const migration = await readFile(new URL('../supabase/migrations/20260908033401_fulfillment_release_exact_picked_bin.sql', import.meta.url), 'utf8');
const baseline = process.env.FULFILLMENT_BIN_BASELINE === '1';
const orderId = '11111111-1111-4111-8111-111111111111';
const picker = '22222222-2222-4222-8222-222222222222';
const releaser = '33333333-3333-4333-8333-333333333333';

async function fixture({ applyMigration = !baseline } = {}) {
  const db = new PGlite();
  await db.exec(`
    create schema warehouse; create schema private; create schema core; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select current_setting('test.actor')::uuid $$;
    create function core.has_cap(text,text) returns boolean language sql as $$ select current_setting('test.allowed') = 'true' $$;
    create function warehouse.authoritative_actor() returns text language sql as $$ select auth.uid()::text $$;
    create table warehouse.products(id text primary key, name text, serialized boolean, item_class text);
    create table warehouse.storage_areas(id text primary key, location_id text, active boolean);
    create table warehouse.stock_levels(product_id text, location_id text, bin_id text, lot_id text, quantity integer);
    create table warehouse.inventory_units(id text, product_id text, serial_number text, status text, location_id text, bin_id text, assigned_to text);
    create table warehouse.inventory_holds(product_id text, location_id text, bin_id text, lot_id text, serial_number text, status text, quantity integer);
    create table warehouse.movements(id text, type text, product_id text, quantity integer, from_location_id text, from_bin_id text, serial_number text, lot_id text, event_id text, reference text, actor text, reason text);
    create table warehouse.fulfillment_orders(id uuid primary key, source text, external_reference text, source_location_id text, source_bin_id text, status text, lines jsonb, packaging jsonb, courier text, waybill_number text, event_id text, released_by uuid, released_at timestamptz, updated_at timestamptz, delivery_method text, delivery_link text, picked_by uuid, picked_at timestamptz, packed_by uuid, packed_at timestamptz, handover_recipient_name text, handover_recipient_department text, handover_reference text, handover_evidence_url text);
    create table warehouse.fulfillment_reservations(order_id uuid, product_id text, status text, closed_at timestamptz);
    create table core.activity_log(module text, entity_type text, entity_id uuid, action text, actor uuid, detail jsonb);
    create table private.test_commands(id uuid default gen_random_uuid(), key text primary key, payload jsonb, response jsonb);
    create function private.begin_idempotent_command(name text, key text, payload jsonb) returns jsonb language plpgsql as $$
    declare command private.test_commands;
    begin
      select * into command from private.test_commands c where c.key = begin_idempotent_command.key;
      if found then
        if command.payload <> payload then raise exception 'Idempotency payload changed'; end if;
        return jsonb_build_object('replayed',true,'response',command.response);
      end if;
      insert into private.test_commands(key,payload) values(key,payload) returning * into command;
      return jsonb_build_object('replayed',false,'command_id',command.id);
    end $$;
    create function private.finish_idempotent_command(command_id uuid,result jsonb) returns jsonb language plpgsql as $$
    begin update private.test_commands set response=result where id=command_id; return result; end $$;
    set test.actor = '${picker}'; set test.allowed = 'true';
    insert into warehouse.products values('merch','Merchandise',false,'merchandise');
    insert into warehouse.storage_areas values('A','WH',true),('B','WH',true);
    insert into warehouse.stock_levels values('merch','WH','A',null,10),('merch','WH','B',null,10);
    insert into warehouse.fulfillment_orders(id,source,external_reference,status,lines,packaging,delivery_method)
    values('${orderId}','department_request','REQ-TWO-BINS','picking','[{"productId":"merch","quantity":3}]','[]','internal_handover');
  `);
  await db.exec(installed);
  if (applyMigration) await db.exec(migration);
  return db;
}

async function advance(db, action, extra = {}) {
  return (await db.query('select warehouse.advance_fulfillment_order($1::jsonb) as result', [JSON.stringify({ order_id: orderId, action, idempotency_key: action, ...extra })])).rows[0].result;
}
async function prepare(db) {
  const picked = await advance(db, 'confirm_pick', { picked_lines: [{ productId: 'merch', quantity: 3, serialNumbers: [], binId: 'B' }] });
  assert.equal(picked.lines[0].pickBinId, 'B');
  await advance(db, 'confirm_pack', { packaging: [], handover_recipient_name: 'Requester', handover_recipient_department: 'Marketing', handover_reference: 'HO-TEST', handover_evidence_url: 'intra://handover/test' });
  await db.exec(`set test.actor = '${releaser}'`);
}

test('release debits the confirmed second bin, preserves the other bin, and replays without duplicate movements', async () => {
  const db = await fixture();
  try {
    await prepare(db);
    const result = await advance(db, 'release');
    assert.equal(result.status, 'released');
    assert.deepEqual(await advance(db, 'release'), result);
    assert.deepEqual((await db.query('select bin_id, quantity from warehouse.stock_levels order by bin_id')).rows, [{ bin_id: 'A', quantity: 10 }, { bin_id: 'B', quantity: 7 }]);
    assert.deepEqual((await db.query('select from_bin_id, quantity from warehouse.movements')).rows, [{ from_bin_id: 'B', quantity: 3 }]);
  } finally { await db.close(); }
});

test('held picked-bin stock must not silently fall back to the other stocked bin', async () => {
  const db = await fixture();
  try {
    await prepare(db);
    await db.exec("insert into warehouse.inventory_holds values('merch','WH','B',null,null,'active',10)");
    await assert.rejects(advance(db, 'release'), /no longer available/);
    assert.equal((await db.query('select count(*)::int as n from warehouse.movements')).rows[0].n, 0);
    assert.equal((await db.query('select status from warehouse.fulfillment_orders')).rows[0].status, 'ready');
  } finally { await db.close(); }
});

test('same packer and denied capability remain rejected', async () => {
  const db = await fixture();
  try {
    await prepare(db);
    await db.exec(`set test.actor = '${picker}'`);
    await assert.rejects(advance(db, 'release'), /second warehouse operator/);
    await db.exec(`set test.actor = '${releaser}'; set test.allowed = 'false'`);
    await assert.rejects(advance(db, 'release'), /Not authorized/);
    assert.equal((await db.query('select count(*)::int as n from warehouse.movements')).rows[0].n, 0);
  } finally { await db.close(); }
});

for (const [name, setup] of [
  ['insufficient picked-bin quantity', "update warehouse.stock_levels set quantity=2 where bin_id='B'"],
  ['missing picked-bin stock', "delete from warehouse.stock_levels where bin_id='B'"],
  ['missing picked-bin identity', "delete from warehouse.storage_areas where id='B'"],
  ['inactive picked bin', "update warehouse.storage_areas set active=false where id='B'"],
  ['picked bin at a different warehouse', "update warehouse.storage_areas set location_id='OTHER' where id='B'"],
  ['conflicting order source bin', "update warehouse.fulfillment_orders set source_bin_id='A'"],
]) {
  test(`${name} rejects atomically without falling back`, { skip: baseline }, async () => {
    const db = await fixture();
    try {
      await prepare(db);
      await db.exec(setup);
      const stock = (await db.query('select * from warehouse.stock_levels order by bin_id')).rows;
      await assert.rejects(advance(db, 'release'), /no longer available/);
      assert.deepEqual((await db.query('select * from warehouse.stock_levels order by bin_id')).rows, stock);
      assert.equal((await db.query('select count(*)::int as n from warehouse.movements')).rows[0].n, 0);
      assert.equal((await db.query('select status from warehouse.fulfillment_orders')).rows[0].status, 'ready');
      assert.equal((await db.query("select count(*)::int as n from private.test_commands where key='release'")).rows[0].n, 0);
    } finally { await db.close(); }
  });
}

for (const [name, expression] of [
  ['absent', "(lines->0) - 'pickBinId'"],
  ['empty', "(lines->0) || '{\"pickBinId\":\"\"}'::jsonb"],
]) {
  test(`legacy ${name} pick-bin metadata retains existing order-level selection`, { skip: baseline }, async () => {
    const db = await fixture();
    try {
      await prepare(db);
      await db.exec(`update warehouse.fulfillment_orders set lines=jsonb_build_array(${expression})`);
      await advance(db, 'release');
      assert.deepEqual((await db.query('select bin_id,quantity from warehouse.stock_levels order by bin_id')).rows, [{bin_id:'A',quantity:7},{bin_id:'B',quantity:10}]);
    } finally { await db.close(); }
  });
}

test('migration changes only the guarded selector and retains function security and wrapper definitions', { skip: baseline }, async () => {
  const db = await fixture({ applyMigration: false });
  try {
    const query = `select n.nspname, p.proname, p.prosecdef, p.proconfig, p.proacl,
      pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where p.proname like '%advance_fulfillment_order%' order by n.nspname,p.proname`;
    const before = (await db.query(query)).rows;
    await db.exec(migration);
    const after = (await db.query(query)).rows;
    const oldText = migration.match(/\$old\$([\s\S]*?)\$old\$/)[1];
    const newText = migration.match(/\$new\$([\s\S]*?)\$new\$/)[1];
    assert.deepEqual(after, before.map(row => row.nspname === 'private' && row.proname === 'warehouse_advance_fulfillment_order'
      ? { ...row, definition: row.definition.replace(oldText,newText) } : row));
    await assert.rejects(db.exec(migration), /already installed/);
    assert.deepEqual((await db.query(query)).rows, after);
  } finally { await db.close(); }
});

test('migration fails closed on an unexpected installed selector', { skip: baseline }, async () => {
  const db = await fixture({ applyMigration: false });
  try {
    const { rows: [row] } = await db.query("select pg_get_functiondef('private.warehouse_advance_fulfillment_order(jsonb)'::regprocedure) as definition");
    await db.exec(row.definition.replace('where level.product_id = v_product.id and level.quantity > 0', 'where level.product_id = v_product.id and level.quantity >= 1'));
    await assert.rejects(db.exec(migration), /Expected exactly one/);
  } finally { await db.close(); }
});
