import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const read = async (id, cursor = null) => (await db.query('select warehouse.unit_custody_history($1,$2) result', [id,cursor])).rows[0].result;
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema private; create schema warehouse; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select '00000000-0000-4000-8000-000000000001'::uuid $$;
    create function private.can_read_warehouse_table(text) returns boolean language sql as $$ select coalesce(current_setting('probe.access',true),'true')::boolean $$;
    create table warehouse.inventory_units(id text primary key,product_id text,serial_number text,location_id text,bin_id text,status text,assigned_to text);
    insert into warehouse.inventory_units values('old','watch','OLD','wh','a','in_stock',null);
  `);
  await db.exec(readFileSync('supabase/migrations/20261105071201_warehouse_unit_custody_history.sql','utf8'));
});
after(async () => db.close());
test('older product totals are not invented as a serial history', async () => {
  assert.deepEqual(await read('old'),[]);
});
test('insert, move and loss record exact unit states without changing another serial', async () => {
  await db.exec(`insert into warehouse.inventory_units values('one','watch','SER1','wh','a','in_stock','private-customer');
    insert into warehouse.inventory_units values('two','watch','SER2','wh','a','in_stock',null);
    update warehouse.inventory_units set bin_id='b' where id='one';
    update warehouse.inventory_units set status='lost' where id='one';`);
  const history = await read('one');
  assert.equal(history.length,3);
  assert.ok(history.every(row=>row.unit_id==='one' && row.serial_number==='SER1'));
  assert.equal(history[0].before_state.status,'in_stock');
  assert.equal(history[0].after_state.status,'lost');
  assert.equal(history[1].before_state.bin_id,'a');
  assert.equal(history[1].after_state.bin_id,'b');
  assert.equal(history[2].operation,'registered');
  assert.ok(history.every(row=>!('assigned_to' in (row.after_state ?? {}))));
  assert.equal((await read('two')).length,1);
});
test('failed transactions leave no history and no-op updates add no event', async () => {
  const before = await read('two');
  await db.exec("begin; update warehouse.inventory_units set bin_id='c' where id='two'; rollback;");
  await db.exec("update warehouse.inventory_units set bin_id=bin_id where id='two'");
  assert.deepEqual(await read('two'),before);
});
test('history remains after unit removal, and current authority gates reads', async () => {
  await db.exec("delete from warehouse.inventory_units where id='two'");
  assert.equal((await read('two'))[0].operation,'removed');
  await db.exec("select set_config('probe.access','false',false)");
  await assert.rejects(read('one'),/do not have access/);
  await db.exec("select set_config('probe.access','true',false)");
});
test('pagination remains numerically ordered beyond single-digit identifiers', async () => {
  for (let i=0;i<56;i++) await db.query("update warehouse.inventory_units set bin_id=$1 where id='one'",[`page-${i}`]);
  const first = await read('one');
  assert.equal(first.length,51);
  assert.ok(first.every((row,index)=>index===0 || BigInt(first[index-1].id)>BigInt(row.id)));
  const next = await read('one',first[49].id);
  assert.equal(next.length,9);
  assert.equal(new Set([...first.slice(0,50),...next].map(row=>row.id)).size,59);
});
test('API roles cannot edit immutable history or call the trigger function', async () => {
  const result = await db.query(`select has_table_privilege('authenticated','private.warehouse_unit_history','INSERT') ins,
    has_table_privilege('authenticated','private.warehouse_unit_history','UPDATE') upd,
    has_table_privilege('authenticated','private.warehouse_unit_history','DELETE') del,
    has_function_privilege('anon','warehouse.unit_custody_history(text,bigint)','EXECUTE') anon,
    has_function_privilege('authenticated','private.warehouse_record_unit_history()','EXECUTE') trigger`);
  assert.deepEqual(result.rows[0],{ins:false,upd:false,del:false,anon:false,trigger:false});
});
