import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { buildSep07MerchFixtures, MERCH_PROJECT } from './uat-sep07-merch-fixtures.mjs';
import { renderSep07MerchSql } from './render-uat-sep07-merch-sql.mjs';

const source = name => readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8');
function table(sql, name) {
  const start = sql.indexOf(`create table if not exists ${name} (`);
  assert.ok(start >= 0, name);
  return sql.slice(start, sql.indexOf('\n);', start) + 3).replaceAll(' default gen_random_uuid()', '');
}
async function database() {
  const db = new PGlite();
  const core = source('20260706090200_core_vendors.sql');
  const wh = source('20260706092000_warehouse_schema.sql');
  const po = source('20260709152000_live_intra_cutover_contract.sql');
  await db.exec(`create schema core; create schema warehouse; create schema procurement;
    create table core.profiles (id uuid primary key);
    create table procurement.replenishment_recommendations (procurement_request_id text);
    ${table(core, 'core.vendors')}
    ${table(wh, 'warehouse.suppliers')}
    ${table(wh, 'warehouse.products')}
    alter table warehouse.products add serialization_policy text, add item_class text, add uom text, add expiry_tracked boolean, add shelf_life_warning_days integer;
    ${table(po, 'procurement.requests')}
    ${table(po, 'procurement.purchase_orders')}
    alter table procurement.purchase_orders add issued_at timestamptz;
    ${table(po, 'procurement.purchase_order_lines')}
    alter table procurement.purchase_order_lines add warehouse_product_id text references warehouse.products, add receiving_status text not null default 'open' check(receiving_status in ('open','rejected','cancelled'));
    alter table warehouse.products add check(serialization_policy in ('required','optional','none','asset_tag')), add check((serialization_policy in ('required','asset_tag') and serialized) or (serialization_policy='none' and not serialized) or serialization_policy='optional');`);
  return db;
}
const sql = mode => renderSep07MerchSql({ projectRef: MERCH_PROJECT, mode });
test('exact variant quantities, distinct product barcodes, synthetic costs and no fabricated approvals', () => {
  const f = buildSep07MerchFixtures();
  const p = f.find(x => x.table === 'products').rows;
  assert.equal(new Set(p.map(x => x.barcode)).size, 4);
  assert.ok(p.every(x => !x.serialized && x.serialization_policy === 'none'));
  const orders = f.find(x => x.table === 'purchase_orders').rows;
  assert.deepEqual(orders.map(x => x.lines.map(l => l.quantity)), [[100, 100, 100], [300]]);
  assert.deepEqual(orders.map(x => x.total), [150000, 45000]);
  assert.deepEqual(orders.map(x => x.vendor_name), ['Company D', 'Company E']);
  assert.ok(orders.every(x => x.expected_date === '2026-09-08' && /synthetic test date/.test(x.notes)));
  assert.ok(orders.every(x => x.status === 'issued' && /not actual human approval/.test(x.notes)));
  assert.doesNotMatch(JSON.stringify(f), /approved_by|decided_by|signature|serial_number|uat-prod-tumbler/);
  assert.doesNotMatch(sql('apply'), /\b(update|delete|grant|disable trigger)\b/i);
});
test('renderer rejects absent, production or arbitrary targets and unknown modes', () => {
  for (const projectRef of [undefined, 'production', 'otheruat']) assert.throws(() => renderSep07MerchSql({ projectRef }));
  assert.throws(() => renderSep07MerchSql({ projectRef: MERCH_PROJECT, mode: 'reset' }));
  assert.ok(renderSep07MerchSql({ projectRef: MERCH_PROJECT }).endsWith('rollback;'));
});
test('actual SQL default rollback leaves no fixtures', async () => {
  const db = await database();try {
    await db.exec(sql('rehearse'));
    assert.equal((await db.query('select count(*)::int n from core.vendors')).rows[0].n, 0);
  } finally { await db.close(); }
});
test('actual SQL inserts exact graph, repeat preserves progressed tester state and unrelated catalog', async () => {
  const db = await database();try {
    await db.exec(`insert into warehouse.products(id,sku,name,category,barcode) values('uat-prod-tumbler','UAT-MERCH-TUMBLER','Existing tumbler','merchandise','MWUAT-MERCH-TUMBLER');`);
    await db.exec(sql('apply'));
    await db.exec(`update procurement.purchase_orders set status='closed', total=123 where id='UAT-SEP07-PO-0005'; update procurement.purchase_order_lines set received_quantity=17, receiving_status='rejected' where id='UAT-SEP07-PO-0005-LINE-1';`);
    await db.exec(sql('apply'));
    assert.deepEqual((await db.query(`select status,total::int from procurement.purchase_orders where id='UAT-SEP07-PO-0005'`)).rows[0], {status:'closed',total:123});
    assert.equal((await db.query(`select received_quantity::int n from procurement.purchase_order_lines where id='UAT-SEP07-PO-0005-LINE-1'`)).rows[0].n,17);
    assert.equal((await db.query('select count(*)::int n from warehouse.products')).rows[0].n,5);
    assert.equal((await db.query('select count(*)::int n from procurement.purchase_order_lines')).rows[0].n,4);
  } finally { await db.close(); }
});
for (const [label, conflict] of [
  ['foreign PO reference', `insert into procurement.purchase_orders(id,po_number,vendor_name) values('foreign','UAT-SEP07-PO-0005','Other');`],
  ['foreign barcode', `insert into warehouse.products(id,sku,name,category,barcode) values('foreign','other','Other','merchandise','MWUAT-SEP07-JACKET-S');`],
  ['foreign SKU', `insert into warehouse.products(id,sku,name,category) values('foreign','UAT-SEP07-JACKET-M','Other','merchandise');`],
  ['owned ID with wrong ownership', `insert into warehouse.products(id,sku,name,category) values('uat-sep07-jacket-l','other','Other','merchandise');`],
  ['foreign Company D supplier', `insert into warehouse.suppliers(id,name) values('foreign','Company D');`],
  ['existing replenishment linkage', `insert into procurement.replenishment_recommendations values('UAT-SEP07-REQ-0005');`],
]) test(`actual SQL rejects ${label} and rolls back earlier inserts`, async () => {
  const db=await database();try {
    await db.exec(conflict);await assert.rejects(db.exec(sql('apply')),/collision|conflict|side effects/);await db.exec('rollback;');
    assert.equal((await db.query('select count(*)::int n from core.vendors')).rows[0].n,0);
  }finally{await db.close();}
});
test('actual SQL refuses existing normalized line drift without rewriting it', async () => {
  const db=await database();try {
    await db.exec(sql('apply'));
    await db.exec("update procurement.purchase_order_lines set quantity=99 where id='UAT-SEP07-PO-0005-LINE-1'");
    await assert.rejects(db.exec(sql('apply')), /coherence failed/);await db.exec('rollback;');
    assert.equal((await db.query("select quantity::int n from procurement.purchase_order_lines where id='UAT-SEP07-PO-0005-LINE-1'")).rows[0].n,99);
  }finally{await db.close();}
});
