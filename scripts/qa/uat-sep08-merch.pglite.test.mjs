import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { buildSep07MerchFixtures, MERCH_PROJECT } from './uat-sep07-merch-fixtures.mjs';
import { renderSep07MerchSql } from './render-uat-sep07-merch-sql.mjs';
import { buildSep08MerchFixtures, SEP08_BINS, SEP08_LOCATION } from './uat-sep08-merch-fixtures.mjs';
import { renderSep08MerchSql } from './render-uat-sep08-merch-sql.mjs';

const source = n => readFileSync(new URL(`../../supabase/migrations/${n}`, import.meta.url), 'utf8');
function table(sql, name) {
  const i = sql.indexOf(`create table if not exists ${name} (`);assert.ok(i >= 0);
  return sql.slice(i, sql.indexOf('\n);', i) + 3).replaceAll(' default gen_random_uuid()', '');
}
async function database() {
  const db=new PGlite();
  const wh=source('20260706092000_warehouse_schema.sql'),po=source('20260709152000_live_intra_cutover_contract.sql');
  await db.exec(`create schema core;create schema warehouse;create schema procurement;
  create table core.profiles(id uuid primary key);
  create table procurement.replenishment_recommendations(procurement_request_id text);
  ${table(source('20260706090200_core_vendors.sql'),'core.vendors')}
  ${table(wh,'warehouse.suppliers')}
  ${table(wh,'warehouse.locations')}
  alter table warehouse.locations add active boolean default true;
  ${table(wh,'warehouse.storage_areas')}
  ${table(wh,'warehouse.products')}
  alter table warehouse.products add serialization_policy text, add item_class text, add uom text, add expiry_tracked boolean, add shelf_life_warning_days integer,
  add check((serialization_policy='none' and not serialized) or serialization_policy in ('required','asset_tag','optional'));
  ${table(po,'procurement.requests')}
  ${table(po,'procurement.purchase_orders')}
  alter table procurement.purchase_orders add issued_at timestamptz;
  ${table(po,'procurement.purchase_order_lines')}
  alter table procurement.purchase_order_lines add warehouse_product_id text references warehouse.products, add receiving_status text default 'open' check(receiving_status in ('open','rejected','cancelled'));
  insert into warehouse.locations(id,name,type) values('${SEP08_LOCATION}','UAT Pasig Main Warehouse','warehouse');`);
  await db.exec(renderSep07MerchSql({projectRef:MERCH_PROJECT,mode:'apply'}));
  return db;
}
const sql=mode=>renderSep08MerchSql({projectRef:MERCH_PROJECT,mode});
const count=async(db,table)=>Number((await db.query(`select count(*) n from ${table} where id like '%sep08%' or id like '%SEP08%'`)).rows[0].n);
async function original(db) {
  return (await db.query(`select jsonb_build_object(
  'products',(select jsonb_agg(to_jsonb(t) order by id) from warehouse.products t where id not like 'uat-sep08-%'),
  'pos',(select jsonb_agg(to_jsonb(t) order by id) from procurement.purchase_orders t where id not like 'UAT-SEP08-%'),
  'lines',(select jsonb_agg(to_jsonb(t) order by id) from procurement.purchase_order_lines t where id not like 'UAT-SEP08-%')) as result`)).rows[0].result;
}
test('three disjoint product/PO pairs, final quantities and general-area receipt context',()=>{
  const f=buildSep08MerchFixtures(),products=f.find(x=>x.table==='products').rows,orders=f.find(x=>x.table==='purchase_orders').rows;
  assert.equal(products.length,12);assert.equal(new Set(products.map(p=>p.barcode)).size,12);
  assert.ok(products.every(p=>!p.serialized&&p.serialization_policy==='none'));
  assert.deepEqual(orders.map(p=>p.lines.map(l=>l.quantity)),[[20,20,20],[1000],[100,100,100],[300],[100,100,100],[300]]);
  assert.equal(new Set(orders.flatMap(p=>p.lines.map(l=>l.productId))).size,12);
  assert.deepEqual(Object.keys(SEP08_BINS),['putaway']);
  const oldIds=new Set(buildSep07MerchFixtures().flatMap(t=>t.rows.map(r=>r.id)));
  assert.ok(f.every(t=>t.rows.every(r=>!oldIds.has(r.id))));
  assert.ok(orders.every(p=>p.status==='issued'&&p.expected_date==='2026-09-08'&&/not actual human approval/.test(p.notes)));
  assert.match(orders[1].notes,/intended receipt 1000 tumblers and release 10 tumblers/);
  assert.doesNotMatch(orders[1].notes,/partial receipt/);
  assert.doesNotMatch(JSON.stringify(f),/approved_by|signature|decided_by|serial_number/);
  assert.doesNotMatch(sql('apply'),/\b(update|delete|grant|disable trigger)\b/i);
});
test('review artifacts exactly match current final renderer',()=>{
  for(const mode of ['rehearse','apply'])assert.equal(readFileSync(new URL(`./uat-sep08-merch.${mode}.sql`,import.meta.url),'utf8'),sql(mode));
});
test('exact UAT target mandatory; rollback default; invalid mode rejected',()=>{
  for(const projectRef of [undefined,'production','other'])assert.throws(()=>renderSep08MerchSql({projectRef}));
  assert.ok(renderSep08MerchSql({projectRef:MERCH_PROJECT}).trimEnd().endsWith('rollback;'));
  assert.throws(()=>renderSep08MerchSql({projectRef:MERCH_PROJECT,mode:'reset'}));
});
test('actual SQL rollback preserves original graph and leaves zero new rows',async()=>{
  const db=await database();try{const before=await original(db);await db.exec(sql('rehearse'));assert.equal(await count(db,'warehouse.products'),0);assert.equal(await count(db,'warehouse.storage_areas'),0);assert.deepEqual(await original(db),before);}finally{await db.close();}
});
test('actual SQL apply and repeat preserve originals, processed verification and untouched tester capacity',async()=>{
  const db=await database();try{
    await db.exec("update procurement.purchase_order_lines set received_quantity=7 where id='UAT-SEP07-PO-0005-LINE-1'");
    const before=await original(db);await db.exec(sql('apply'));
    await db.exec("update procurement.purchase_orders set status='closed' where id='UAT-SEP08-VERIFY-PO-0005';update procurement.purchase_order_lines set received_quantity=10 where id='UAT-SEP08-VERIFY-PO-0006-LINE-1'");
    await db.exec(sql('apply'));
    assert.deepEqual(await original(db),before);assert.equal(await count(db,'warehouse.products'),12);assert.equal(await count(db,'procurement.purchase_orders'),6);assert.equal(await count(db,'procurement.purchase_order_lines'),12);
    assert.equal((await db.query("select received_quantity::int n from procurement.purchase_order_lines where id='UAT-SEP08-VERIFY-PO-0006-LINE-1'")).rows[0].n,10);
    assert.equal((await db.query("select sum(quantity)::int ordered,sum(received_quantity)::int received from procurement.purchase_order_lines where purchase_order_id like 'UAT-SEP08-TESTER%'")).rows[0].ordered,1200);
    assert.equal((await db.query("select sum(received_quantity)::int n from procurement.purchase_order_lines where purchase_order_id like 'UAT-SEP08-TESTER%'")).rows[0].n,0);
  }finally{await db.close();}
});
for(const [name,conflict,pattern] of [
  ['PO reference collision',"insert into procurement.purchase_orders(id,po_number,vendor_name) values('foreign','UAT-SEP08-VERIFY-PO-0006','Other')",/collision/],
  ['barcode collision',"insert into warehouse.products(id,sku,name,category,barcode) values('foreign','other','Other','merchandise','MWUAT-SEP08-VERIFY-TUMBLER')",/collision/],
  ['bin collision',`insert into warehouse.storage_areas(id,location_id,code,label) values('foreign','${SEP08_LOCATION}','S8V-STOCK','Other')`,/collision/],
  ['missing warehouse',`update warehouse.locations set active=false where id='${SEP08_LOCATION}'`,/warehouse missing/],
  ['vendor identity drift',"update core.vendors set trade_name='Different' where trade_name='Company D'",/identity missing/],
  ['replenishment trigger side effects',"insert into procurement.replenishment_recommendations values('UAT-SEP08-TESTER1-REQ-0005')",/side effects/],
])test(`actual SQL fails closed: ${name}`,async()=>{const db=await database();try{await db.exec(conflict);await assert.rejects(db.exec(sql('apply')),pattern);await db.exec('rollback');assert.equal(await count(db,'procurement.purchase_orders'),0);assert.equal(await count(db,'warehouse.products'),0);}finally{await db.close();}});
test('actual SQL detects unexpected trigger changes to existing rows and rolls back all seed rows',async()=>{
  const db=await database();try{
    const before=await original(db);
    await db.exec("create function warehouse.test_side_effect() returns trigger language plpgsql as $$begin update warehouse.products set price=999 where id='uat-sep07-tumbler'; return new;end$$;create trigger test_seed_side_effect after insert on warehouse.products for each row execute function warehouse.test_side_effect()");
    await assert.rejects(db.exec(sql('apply')),/Preexisting rows changed/);await db.exec('rollback');assert.deepEqual(await original(db),before);assert.equal(await count(db,'warehouse.products'),0);
  }finally{await db.close();}
});
