import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const tables = {
  'warehouse.stock_levels': 'location_id text, quantity integer',
  'warehouse.inventory_units': 'location_id text, status text',
  'warehouse.storage_areas': 'location_id text, active boolean',
  'warehouse.inventory_holds': 'location_id text, status text',
  'warehouse.fulfillment_reservations': 'location_id text, status text',
  'warehouse.receiving_drafts': 'body jsonb',
  'warehouse.cycle_counts': 'location_id text, status text',
  'warehouse.stock_change_requests': 'location_id text, status text',
  'warehouse.quality_inspections': 'location_id text, disposition text',
  'warehouse.receipts': 'id text, location_id text, quality_status text',
  'warehouse.procurement_receipt_excess_custody': 'receipt_id text, status text',
  'warehouse.fulfillment_orders': 'third_party_location_id text, status text',
  'private.external_po_orders': 'id uuid, location_id text, status text',
  'private.external_po_lines': 'order_id uuid, quantity integer, received_quantity integer',
  'private.external_po_shipments': 'order_id uuid, status text',
};
before(async () => {
  await db.exec(`create schema private; create schema warehouse; create role anon; create role authenticated;
    create table warehouse.locations(id text primary key,name text,type text,active boolean);
    ${Object.entries(tables).map(([name,columns]) => `create table ${name}(${columns});`).join('\n')}
    create function private.warehouse_guard_stocked_location() returns trigger language plpgsql as $$ begin return new; end $$;
    create trigger warehouse_stocked_location_guard before update of type,active on warehouse.locations
      for each row execute function private.warehouse_guard_stocked_location();`);
  await db.exec(readFileSync('supabase/migrations/20261105071219_warehouse_location_dependencies.sql','utf8'));
});
after(() => db.close());
async function reset() {
  await db.exec(`truncate ${Object.keys(tables).join(',')},warehouse.locations;
    insert into warehouse.locations values('wh','Warehouse','warehouse',true),('off','Old','warehouse',false);`);
}

const dependencies = [
  ['stock','warehouse.stock_levels',"'wh',1"],
  ['units','warehouse.inventory_units',"'wh','in_stock'"],
  ['active bins','warehouse.storage_areas',"'wh',true"],
  ['hold','warehouse.inventory_holds',"'wh','active'"],
  ['reservation','warehouse.fulfillment_reservations',"'wh','active'"],
  ['receiving draft','warehouse.receiving_drafts',"'{\"locationId\":\"wh\"}'"],
  ['pending count','warehouse.cycle_counts',"'wh','pending_approval'"],
  ['finance decision','warehouse.stock_change_requests',"'wh','pending_finance'"],
  ['inspection','warehouse.quality_inspections',"'wh','pending'"],
  ['receipt','warehouse.receipts',"'rc','wh','pending'"],
  ['external PO draft','private.external_po_orders',"'00000000-0000-0000-0000-000000000001','wh','draft'"],
  ['third party delivery','warehouse.fulfillment_orders',"'wh','released'"],
];
for (const [name,table,values] of dependencies) test(`${name} prevents hiding its location; rename remains available`,async () => {
  await reset(); await db.exec(`insert into ${table} values(${values})`);
  await assert.rejects(db.exec("update warehouse.locations set type='vendor' where id='wh'"),/still|active storage areas/);
  await assert.rejects(db.exec("update warehouse.locations set active=false where id='wh'"),/still|active storage areas/);
  await db.exec("update warehouse.locations set name='New name' where id='wh'");
  assert.equal((await db.query("select name from warehouse.locations where id='wh'")).rows[0].name,'New name');
});
test('unreceived emailed PO lines and draft shipments remain dependencies',async () => {
  await reset();
  await db.exec("insert into private.external_po_orders values('00000000-0000-0000-0000-000000000001','wh','confirmed'); insert into private.external_po_lines values('00000000-0000-0000-0000-000000000001',3,2)");
  await assert.rejects(db.exec("update warehouse.locations set active=false where id='wh'"),/still has/);
  await db.exec('update private.external_po_lines set received_quantity=3');
  await db.exec("insert into private.external_po_shipments values('00000000-0000-0000-0000-000000000001','draft')");
  await assert.rejects(db.exec("update warehouse.locations set active=false where id='wh'"),/still has/);
  await db.exec("update private.external_po_shipments set status='posted'; update warehouse.locations set active=false where id='wh'");
});
test('excess receipt custody remains a dependency even after the receipt is accepted',async () => {
  await reset(); await db.exec("insert into warehouse.receipts values('rc','wh','accepted'); insert into warehouse.procurement_receipt_excess_custody values('rc','held')");
  await assert.rejects(db.exec("update warehouse.locations set active=false where id='wh'"),/still has/);
  await db.exec("update warehouse.procurement_receipt_excess_custody set status='vendor_return'; update warehouse.locations set active=false where id='wh'");
});
test('new stock and receiving work cannot arrive at an inactive or reclassified warehouse',async () => {
  await reset();
  for (const sql of ["insert into warehouse.stock_levels values('off',1)","insert into warehouse.inventory_units values('off','in_stock')", "insert into warehouse.receiving_drafts values('{\"locationId\":\"off\"}')", "insert into warehouse.receipts values('rc','off','pending')"])
    await assert.rejects(db.exec(sql),/no longer available/);
  await db.exec("update warehouse.locations set type='vendor' where id='wh'");
  await assert.rejects(db.exec("insert into warehouse.receipts values('rc','wh','pending')"),/no longer available/);
});
test('closed history is retained without permanently preventing an empty location change',async () => {
  await reset(); await db.exec("insert into warehouse.storage_areas values('wh',false); insert into warehouse.stock_levels values('wh',0); insert into warehouse.receipts values('rc','wh','accepted'); insert into warehouse.fulfillment_reservations values('wh','released'); insert into warehouse.inventory_units values('wh','issued'); insert into warehouse.receiving_drafts values(null)");
  await db.exec("update warehouse.locations set active=false where id='wh'");
  assert.equal((await db.query('select count(*)::int n from warehouse.receipts')).rows[0].n,1);
});
