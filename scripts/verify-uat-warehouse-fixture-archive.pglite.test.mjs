import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261106145742_uat_warehouse_fixture_archive.sql', import.meta.url), 'utf8');
const tables = ['products','inventory_units','stock_levels','lots','allocations','fulfillment_orders',
  'fulfillment_reservations','department_stock_requests','customer_return_cases','receipts','returns',
  'cycle_counts','quality_inspections','inventory_holds','vendor_returns','stock_change_requests',
  'exceptions','kit_definitions','rekit_work_orders','storage_areas','events'];

async function fixture(run) {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema warehouse; create schema private;
      grant usage on schema warehouse,private to authenticated;
      create table warehouse.movements(id text primary key,product_id text,reference text);
      create table warehouse.products(id text primary key,attributes jsonb default '{}');
      create table warehouse.inventory_units(id text primary key,product_id text,serial_number text);
      create table warehouse.stock_levels(id text primary key,product_id text,quantity integer);
      create table warehouse.fulfillment_orders(id text primary key,lines jsonb,external_reference text);`);
    for (const table of tables.filter(t => !['products','inventory_units','stock_levels','fulfillment_orders'].includes(t))) {
      await db.exec(`create table warehouse.${table}(id text primary key,product_id text);`);
    }
    for (const table of [...tables,'movements']) {
      await db.exec(`alter table warehouse.${table} enable row level security;
        grant select on warehouse.${table} to authenticated;
        create policy fixture_reader on warehouse.${table} for select to authenticated using (id <> 'denied');`);
    }
    await db.exec(`insert into warehouse.products values ('sample','{"synthetic":true}'),('master-001','{"Master data":"approved"}'),('denied','{}');
      insert into warehouse.inventory_units values ('sample-unit','sample','SYN-1'),('uat-open-unit-001','master-001','REAL-1');
      insert into warehouse.stock_levels values ('sample-bulk','sample',9);
      insert into warehouse.fulfillment_orders(id,lines,external_reference) values ('sample-order','[{"productId":"sample"}]','SYN-ORDER-1');
      insert into warehouse.movements values ('old-history','sample','sample-order');`);
    await db.exec(migration);
    await run(db);
  } finally { await db.close(); }
}
async function archive(db, entries = [['products','sample'],['inventory_units','sample-unit'],['stock_levels','sample-bulk'],['fulfillment_orders','sample-order']], batch = 'uat-fixture-test-001') {
  const manifest = [];
  for (const [table,id] of entries) {
    const row = (await db.query(`select md5(to_jsonb(t)::text) hash from warehouse.${table} t where id=$1`, [id])).rows[0];
    manifest.push({table,row_id:id,row_md5:row.hash,provenance:'Disposable test fixture, explicitly owned by this run'});
  }
  return db.query('select private.archive_uat_warehouse_fixture($1,$2::jsonb)', [batch,JSON.stringify(manifest)]);
}

test('archive preserves original rows and history while active reads exclude exact members', () => fixture(async db => {
  const before = (await db.query('select to_jsonb(t) row from warehouse.inventory_units t order by id')).rows;
  await archive(db);
  assert.deepEqual((await db.query('select to_jsonb(t) row from warehouse.inventory_units t order by id')).rows,before);
  assert.equal((await db.query('select count(*)::int n from warehouse.movements')).rows[0].n,1);
  await db.exec('set role authenticated');
  assert.deepEqual((await db.query('select id from warehouse.active_products order by id')).rows,[{id:'master-001'}]);
  assert.deepEqual((await db.query('select id from warehouse.active_inventory_units')).rows,[{id:'uat-open-unit-001'}]);
  assert.equal((await db.query('select count(*)::int n from warehouse.active_stock_levels')).rows[0].n,0);
  // Existing history reads retain the original policy and labels.
  assert.equal((await db.query("select count(*)::int n from warehouse.products where id='sample'")).rows[0].n,1);
}));

test('archived self, changed identity and new references cannot mutate; real stock still can', () => fixture(async db => {
  await archive(db);
  for (const sql of ["update warehouse.products set id='renamed' where id='sample'",
    "delete from warehouse.inventory_units where id='sample-unit'",
    "insert into warehouse.inventory_units values ('new','sample','NEW')",
    "insert into warehouse.fulfillment_orders(id,lines) values ('new-order','[{\"productId\":\"sample\"}]')",
    "insert into warehouse.movements values ('new-move','sample','new-order')"]) {
    await assert.rejects(db.exec(sql), /archived UAT test record/i);
  }
  await db.exec("update warehouse.inventory_units set serial_number='REAL-2' where id='uat-open-unit-001'");
}));

test('master products and opening identities cannot be archived', () => fixture(async db => {
  await assert.rejects(archive(db,[['products','master-001']]), /masterlist/i);
  await assert.rejects(archive(db,[['inventory_units','uat-open-unit-001']]), /masterlist/i);
  assert.equal((await db.query('select count(*)::int n from private.uat_warehouse_archive_batches')).rows[0].n,0);
}));

test('clients cannot archive, mutate archive membership or relax the existing RLS', () => fixture(async db => {
  await archive(db);
  await db.exec('set role authenticated');
  await assert.rejects(db.exec("select private.archive_uat_warehouse_fixture('uat-fixture-bad','[]')"), /permission denied/i);
  await assert.rejects(db.exec('select * from private.uat_warehouse_archive_members'), /permission denied/i);
  assert.equal((await db.query("select count(*)::int n from warehouse.active_products where id='denied'")).rows[0].n,0);
}));

test('archive replay is idempotent and changed or unlisted rows fail closed', () => fixture(async db => {
  await archive(db);
  await archive(db);
  assert.equal((await db.query('select count(*)::int n from private.uat_warehouse_archive_batches')).rows[0].n,1);
  await assert.rejects(archive(db,[['products','sample']]), /manifest.*changed/i);
  await assert.rejects(db.query('select private.archive_uat_warehouse_fixture($1,$2::jsonb)', ['uat-fixture-unknown',JSON.stringify([{table:'profiles',row_id:'user',row_md5:'a'.repeat(32),provenance:'not allowed'}])]), /table.*not allowed/i);
  await assert.rejects(db.exec("update private.uat_warehouse_archive_members set row_md5=repeat('a',32)"), /immutable/i);
  await assert.rejects(db.exec('truncate private.uat_warehouse_archive_batches,private.uat_warehouse_archive_members'), /immutable/i);
}));

test('stale row hashes and duplicate identities cause no partial archive', () => fixture(async db => {
  const entry = {table:'products',row_id:'sample',row_md5:'a'.repeat(32),provenance:'known fixture'};
  await assert.rejects(db.query('select private.archive_uat_warehouse_fixture($1,$2::jsonb)', ['uat-fixture-stale',JSON.stringify([entry])]), /changed|hash/i);
  assert.equal((await db.query('select count(*)::int n from private.uat_warehouse_archive_members')).rows[0].n,0);
  await assert.rejects(archive(db,[['products','sample'],['products','sample']]), /duplicate archive identity/i);
}));

test('table-qualified identity does not freeze unrelated master rows with the same ID', () => fixture(async db => {
  await db.exec("insert into warehouse.inventory_units values ('sample-order','master-001','REAL-COLLISION')");
  await archive(db);
  await db.exec("update warehouse.inventory_units set serial_number='REAL-COLLISION-2' where id='sample-order'");
  assert.equal((await db.query("select serial_number from warehouse.inventory_units where id='sample-order'")).rows[0].serial_number,'REAL-COLLISION-2');
}));

test('movement references cannot reuse an archived order through ID or display reference', () => fixture(async db => {
  await archive(db);
  for(const reference of ['sample-order','SYN-ORDER-1']) {
    await assert.rejects(db.query('insert into warehouse.movements values ($1,$2,$3)',['new-movement','master-001',reference]), /archived UAT test record/i);
  }
}));

test('mixed master lines and unmarked roots are rejected, preserving the whole graph', () => fixture(async db => {
  await db.exec(`insert into warehouse.fulfillment_orders(id,lines) values ('mixed','[{"productId":"sample"},{"productId":"master-001"}]');
    insert into warehouse.products values ('unmarked','{}');`);
  await assert.rejects(archive(db,[['products','sample'],['fulfillment_orders','mixed']]),/Mixed or foreign/);
  await assert.rejects(archive(db,[['products','unmarked']]),/synthetic product ownership/);
  assert.equal((await db.query('select count(*)::int n from private.uat_warehouse_archive_members')).rows[0].n,0);
}));

test('actual exception source types retain typed Quality and stock-request references', () => fixture(async db => {
  for(const [type,target] of [['stock_change_request','stock_change_requests'],['quality_inspection','quality_inspections']]){
    assert.deepEqual((await db.query('select * from private.uat_warehouse_references($1::jsonb,$2)',[JSON.stringify({source_type:type,source_id:'linked'}),'exceptions'])).rows,[{target_table:target,target_id:'linked'}]);
  }
}));

test('stale snapshot write modes are rejected without preventing read-only snapshots', () => fixture(async db => {
  for(const isolation of ['repeatable read','serializable']){
    await db.exec(`begin isolation level ${isolation}`);
    try {
      await db.query('select * from warehouse.products');
      await assert.rejects(db.exec("update warehouse.products set attributes=attributes where id='sample'"),error=>error.code==='40001');
    } finally { await db.exec('rollback'); }
  }
}));
