import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { after as afterAll, before as beforeAll, it } from 'node:test';
import assert from 'node:assert/strict';

const db = new PGlite();
beforeAll(async () => {
  await db.exec(`
    create schema auth; create schema core; create schema private; create schema procurement; create schema warehouse;
    create role anon; create role authenticated; create role service_role;
    grant usage on schema warehouse, private to authenticated;
    grant usage on schema warehouse to anon;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create function core.has_cap(text,text) returns boolean language sql stable as $$ select coalesce(current_setting('test.cap',true),'') = $2 $$;
    create function core.has_live_cap(text,text) returns boolean language sql stable as $$ select core.has_cap($1,$2) and coalesce(current_setting('test.cert',true),'valid') <> 'expired' $$;
    create table procurement.requests(id text primary key, category text);
    create table procurement.purchase_orders(id text primary key, request_id text, po_number text, vendor_name text, status text, expected_date date, created_at timestamptz, total numeric);
    create table procurement.purchase_order_lines(id text, purchase_order_id text, warehouse_product_id text, description text, quantity numeric, received_quantity numeric, uom text, unit_price numeric, line_no int);
    create table warehouse.receipts(id text, procurement_po_id text, created_at timestamptz, quality_status text, evidence_urls jsonb);
    insert into procurement.requests values('goods','goods'),('services','services');
    insert into procurement.purchase_orders values
      ('z','goods','ORIGINAL-7','Vendor','closed',null,now(),70),
      ('y','goods','OTHER-8','Vendor','closed',null,now(),80),
      ('x','services','SERVICE','Vendor','closed',null,now(),90),
      ('w','goods','OPEN','Vendor','issued',null,now(),100);
    insert into procurement.purchase_order_lines values('l1','z','shirt-l','Shirts',7,7,'pc',10,1);
    insert into warehouse.receipts values('receipt-z','z',now(),'accepted','["evidence/receipt.jpg"]');
  `);
  await db.exec(readFileSync(new URL('../../../../supabase/migrations/20261019182006_warehouse_closed_po_history.sql', import.meta.url), 'utf8'));
});

it('exposes only the guarded read RPC to authenticated callers and denies anonymous execution', async () => {
  await db.exec("set test.uid='00000000-0000-4000-8000-000000000001'; set test.cap='receive_stock'; set role authenticated;");
  try { assert.equal((await history({ po_id: 'z' })).rows.length, 1); }
  finally { await db.exec('reset role'); }
  await db.exec('set role anon');
  try { await assert.rejects(history(), /permission denied/i); }
  finally { await db.exec('reset role'); }
});
afterAll(async () => { await db.close(); });

async function history(payload = {}) {
  const result = await db.query('select warehouse.closed_procurement_po_history($1::jsonb) as page', [JSON.stringify(payload)]);
  return result.rows[0].page;
}

it('denies anonymous and unrelated capabilities', async () => {
  await db.exec("set test.uid=''; set test.cap='receive_stock';");
  await assert.rejects(history(), /authentication/i);
  await db.exec("set test.uid='00000000-0000-4000-8000-000000000001'; set test.cap='view_dashboard';");
  await assert.rejects(history(), /not authorized/i);
});

it('reads only closed goods with stable bounded pagination, original PO numbers and receipt/Quality history', async () => {
  await db.exec("set test.uid='00000000-0000-4000-8000-000000000001'; set test.cap='receive_stock';");
  const first = await history({ limit: 1 });
  assert.equal(first.rows.length, 1);
  assert.equal(first.rows[0].poNumber, 'ORIGINAL-7');
  assert.equal(first.rows[0].status, 'closed');
  assert.equal(first.rows[0].lines[0].receivedQuantity, 7);
  assert.equal(first.rows[0].receipts[0].qualityStatus, 'accepted');
  assert.equal(first.nextCursor, 'z');
  const second = await history({ limit: 1, cursor: first.nextCursor });
  assert.deepEqual(second.rows.map(row => row.id), ['y']);
  assert.equal(second.nextCursor, null);
  assert.deepEqual((await history({ search: 'original' })).rows.map(row => row.id), ['z']);
  assert.deepEqual((await history({ po_id: 'x' })).rows, []);
  assert.deepEqual((await history({ po_id: 'w' })).rows, []);
  assert.equal((await history({ po_id: 'z' })).rows.length, 1);
  assert.deepEqual((await db.query('select status from procurement.purchase_orders where id=\'z\'')).rows, [{ status: 'closed' }]);
});

it('preserves current Warehouse Procurement read authority without exposing base tables', async () => {
  await db.exec("set test.cap='view_procurement';");
  assert.equal((await history()).rows.length, 2);
  const grants = await db.query("select has_table_privilege('authenticated','procurement.purchase_orders','SELECT') as allowed");
  assert.equal(grants.rows[0]?.allowed, false);
});

it('denies expired receiving certification even when the raw role capability remains granted', async () => {
  await db.exec("set test.cap='receive_stock'; set test.cert='expired';");
  assert.equal((await db.query("select core.has_cap('warehouse','receive_stock') as allowed")).rows[0].allowed, true);
  await assert.rejects(history(), /not authorized/i);
  await db.exec("set test.cert='valid';");
  assert.equal((await history()).rows.length, 2);
});
