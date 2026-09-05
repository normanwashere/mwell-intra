import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('putaway projection uses current staging balances and retains invoker security', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema warehouse;
      create schema core;
      create function core.has_cap(text, text) returns boolean language sql stable as
        $$ select coalesce(current_setting('test.capability', true), '') = $2 $$;
      create table warehouse.locations(id text, type text);
      create table warehouse.products(id text, name text, serialized boolean);
      create table warehouse.inventory_units(id text, product_id text, location_id text, bin_id text, status text, serial_number text);
      create table warehouse.inventory_holds(product_id text, location_id text, bin_id text, status text, serial_number text, quantity integer);
      create table warehouse.quality_inspections(id text, disposition text, inspected_at timestamptz);
      create table warehouse.exceptions(id text, exception_type text, status text, owner_id uuid, due_at timestamptz, created_at timestamptz);
      create table warehouse.stock_levels(product_id text, location_id text, bin_id text, quantity integer);
      create table warehouse.allocations(product_id text, quantity integer, status text);
      insert into warehouse.locations values ('wh','warehouse'),('event','event_site'),('hidden','warehouse');
      insert into warehouse.products values ('bulk','Bulk',false),('serial','Device',true);
      insert into warehouse.stock_levels values ('bulk','wh',null,20),('bulk','event',null,50),('bulk','hidden',null,10);
      insert into warehouse.inventory_units values ('u1','serial','wh',null,'in_stock','SN1'),('u2','serial','wh',null,'pending_inspection','SN2');
      insert into warehouse.quality_inspections values ('old1','accepted',now()),('old2','accepted',now());
    `);
    const reporting = await readFile(new URL('../supabase/migrations/20260710170000_warehouse_w1_imports_po_and_reporting.sql', import.meta.url), 'utf8');
    await db.exec(reporting.slice(reporting.indexOf('create or replace view warehouse.inventory_position_v1'), reporting.indexOf('create or replace view warehouse.warehouse_tasks')));
    await db.exec(await readFile(new URL('../supabase/migrations/20260905043614_warehouse_putaway_tasks.sql', import.meta.url), 'utf8'));
    await db.exec(`
      grant usage on schema warehouse to authenticated;
      grant usage on schema core to authenticated;
      grant select on all tables in schema warehouse to authenticated;
      alter table warehouse.locations enable row level security;
      create policy visible_locations on warehouse.locations for select to authenticated using (id <> 'hidden');
      alter table warehouse.inventory_holds enable row level security;
      create policy visible_holds on warehouse.inventory_holds for select to authenticated using (
        core.has_cap('warehouse','inspect_quality') or core.has_cap('warehouse','view_exceptions') or core.has_cap('warehouse','view_finance')
      );
      set test.capability = 'inspect_quality';
      set role authenticated;
    `);
    const tasks = async () => (await db.query("select * from warehouse.warehouse_tasks where task_type='putaway' order by id")).rows;
    const initial = await tasks();
    assert.equal(initial.length, 2);
    const bulk = initial.find(row => row.source_id.startsWith('staging:'));
    assert.deepEqual(JSON.parse(bulk.source_id.slice(8)), ['bulk','wh']);
    await db.exec("reset role; insert into warehouse.inventory_holds values ('bulk','wh',null,'active',null,20),('serial','wh',null,'active','SN1',1); set role authenticated; set test.capability = 'transfer_stock'");
    assert.equal((await db.query('select * from warehouse.inventory_holds')).rows.length, 0, 'actual divergent RLS hides holds');
    assert.ok((await db.query("select available from warehouse.inventory_position_v1 where location_id='wh' and available>0")).rows.length > 0, 'invoker availability overstates stock without hold visibility');
    assert.deepEqual(await tasks(), [], 'putaway must fail closed when authoritative holds are invisible');
    for (const capability of ['inspect_quality', 'view_exceptions', 'view_finance']) {
      await db.query("select set_config('test.capability', $1, false)", [capability]);
      assert.deepEqual(await tasks(), [], `${capability} sees held stock but no actionable task`);
    }
    await db.exec("reset role; delete from warehouse.inventory_holds; set role authenticated; set test.capability='transfer_stock'");
    assert.deepEqual(await tasks(), [], 'lack of authoritative hold visibility remains fail-closed even for apparently empty holds');
    await db.exec("set test.capability='inspect_quality'");
    assert.equal((await tasks()).length, 2, 'authorized callers recover eligible work after hold release');
    await db.exec("reset role; update warehouse.stock_levels set quantity=5 where product_id='bulk' and location_id='wh'; set role authenticated");
    assert.equal((await tasks()).find(row => row.id===bulk.id).title, 'Put away Bulk / 5 units');
    await db.exec("reset role; insert into warehouse.inventory_holds values ('bulk','wh',null,'active',null,5); set role authenticated");
    assert.equal((await tasks()).some(row => row.id === bulk.id), false, 'held balance is not actionable');
    await db.exec("reset role; delete from warehouse.inventory_holds; update warehouse.stock_levels set quantity=0 where product_id='bulk' and location_id='wh'; update warehouse.inventory_units set bin_id='bin' where id='u1'; set role authenticated");
    assert.equal((await tasks()).length, 0);
    await db.exec("reset role; insert into warehouse.quality_inspections values ('pending','pending',now()); insert into warehouse.exceptions values ('ex','quality','in_progress',null,null,now()); set role authenticated");
    assert.deepEqual((await db.query("select task_type,status from warehouse.warehouse_tasks order by task_type")).rows,
      [{ task_type: 'exception', status: 'blocked' }, { task_type: 'quality', status: 'due' }]);
    const view = (await db.query("select reloptions from pg_class where oid='warehouse.warehouse_tasks'::regclass")).rows[0];
    assert.ok(view.reloptions.includes('security_invoker=true'));
  } finally { await db.close(); }
});
