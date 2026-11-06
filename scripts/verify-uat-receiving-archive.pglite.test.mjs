import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/uat-receiving-archive-baseline.json', import.meta.url)));
const readMigration = name => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8');
const patch = readMigration('20261106190738_uat_receiving_archive_boundaries');
const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(900);
const signatures = [
  'private.external_po_workspace(jsonb)', 'private.external_po_command(jsonb)',
  'private.external_po_all_lines_archived(uuid)', 'private.guard_uat_archived_external_po_write()',
  'private.warehouse_receipt_exception_work_items_v3(jsonb)', 'warehouse.procurement_receipt_excess_work_items(jsonb)',
  'private.warehouse_receive_procurement_po_breakdown(jsonb)', 'private.archive_uat_warehouse_fixture(text,jsonb)',
  'private.uat_warehouse_references(jsonb,text)', 'private.guard_uat_archived_warehouse_write()',
];
async function isolated(run) {
  await db.exec('begin');
  try { await run(); } finally { await db.exec('rollback'); }
}
async function denied(sql, pattern = /archived UAT/i) {
  await db.exec('savepoint denied');
  try { await assert.rejects(db.exec(sql), pattern); }
  finally { await db.exec('rollback to savepoint denied'); }
}
async function archive(table, rowId) {
  await db.query(`insert into private.uat_warehouse_archive_members(table_name,row_id,batch_id,row_md5,provenance)
    values($1,$2,'uat-receiving-test-001',repeat('a',32),'Disposable exact test identity')`, [table, rowId]);
}
async function workspace(payload = {}) {
  return (await db.query('select private.external_po_workspace($1::jsonb) value', [payload])).rows[0].value;
}
async function snapshot() {
  const result = {};
  for (const t of fixture.tables) {
    result[`${t.schema}.${t.table}`] = (await db.query(`select to_jsonb(t) value from ${t.schema}.${t.table} t order by to_jsonb(t)::text`)).rows;
  }
  return result;
}
async function metadata() {
  return (await db.query(`select oid::regprocedure::text signature,to_jsonb(p)-'prosrc' metadata,p.prosrc
    from pg_proc p where oid=any($1::regprocedure[]) order by oid::regprocedure::text`, [signatures])).rows;
}
function shipmentPayload(orderId = id(1), shipmentId = id(22)) {
  return { action: 'save_shipment', order_id: orderId, shipment_id: shipmentId, version: 1,
    idempotency_key: `shipment-${shipmentId}`, bin_id: 'bin', actual_delivery_date: '2026-01-01',
    delivery_reference: `delivery-${shipmentId}`, evidence_urls: ['evidence/test-only.png'],
    lines: [{ po_line_id: orderId === id(1) ? id(11) : id(12), quantity: 2, serial_numbers: [] }] };
}
function receiptPayload() {
  return { po_id: 'po', idempotency_key: 'unidentified-receipt', location_id: 'wh', bin_id: 'bin',
    actual_delivery_date: '2026-01-01', evidence_urls: ['evidence/test-only.png'], exception_reason: 'Synthetic test',
    lines: [{ line_id: 'po-line', product_id: 'sample', expected_quantity: 1, outcomes: {
      clean: { quantity: 0 }, damaged: { quantity: 0 }, short: { quantity: 0 }, excess: { quantity: 0 },
      unidentified: { quantity: 1, observed_description: 'Synthetic item', serial_numbers: [] },
    } }] };
}

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema warehouse; create schema private; create schema procurement; create schema core; create schema auth;
    select set_config('test.allowed','yes',false);
    grant usage on schema warehouse,private,core,auth to authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$select '${actor}'::uuid$$;
    create function auth.role() returns text language sql stable as $$select 'authenticated'::text$$;
    create function core.has_cap(text,text) returns boolean language sql stable as $$select coalesce(current_setting('test.allowed',true),'yes')='yes'$$;
    create function core.has_live_cap(text,text) returns boolean language sql stable as $$select core.has_cap($1,$2)$$;
    create function private.external_po_can_read() returns boolean language sql stable as $$select core.has_cap('warehouse','view_inventory')$$;
    create function private.external_po_can_confirm() returns boolean language sql stable as $$select false$$;
    create function private.external_po_check_evidence(jsonb,text,jsonb default '[]') returns void language plpgsql as $$begin end$$;
    create function private.assert_goods_procurement_po(text) returns void language plpgsql as $$begin end$$;
    create function private.receipt_actual_delivery_date(jsonb) returns date language sql as $$select ($1->>'actual_delivery_date')::date$$;
    create table core.activity_log(module text,entity_type text,entity_id text,action text,actor uuid,detail jsonb);`);
  // Real column types/primary keys; bounded defaults and authority adapters are fixture-only.
  for (const t of fixture.tables) {
    const columns = t.columns.map(c => {
      let d = c.type === 'jsonb' ? ` default '${c.name === 'attributes' ? '{}' : '[]'}'::jsonb`
        : c.type === 'timestamp with time zone' ? ' default now()'
        : c.type === 'boolean' ? ` default ${c.name === 'active' ? 'true' : 'false'}`
        : c.type === 'integer' ? ` default ${c.name === 'version' ? 1 : 0}` : '';
      if (c.name === 'id') d = c.type === 'uuid' ? ' default gen_random_uuid()' : c.type === 'text' ? ' default gen_random_uuid()::text' : d;
      return `"${c.name}" ${c.type}${d}`;
    });
    if (t.primary_key.length) columns.push(`primary key(${t.primary_key.map(c => `"${c}"`).join(',')})`);
    await db.exec(`create table ${t.schema}.${t.table}(${columns.join(',')});`);
  }
  await db.exec(`create function private.begin_idempotent_command(text,text,jsonb) returns jsonb language plpgsql as $$
    declare command warehouse.command_log; begin
      select * into command from warehouse.command_log where actor_id=auth.uid() and command_name=$1 and idempotency_key=$2;
      if found then
        if command.payload_hash<>md5($3::text) then raise exception 'Idempotency payload changed'; end if;
        return jsonb_build_object('replayed',true,'response',command.response,'command_id',command.id);
      end if;
      insert into warehouse.command_log(actor_id,command_name,idempotency_key,payload_hash) values(auth.uid(),$1,$2,md5($3::text)) returning * into command;
      return jsonb_build_object('replayed',false,'command_id',command.id);
    end$$;
    create function private.finish_idempotent_command(uuid,jsonb) returns jsonb language plpgsql as $$begin
      update warehouse.command_log set response=$2 where id=$1; return $2; end$$;
    insert into warehouse.products(id,name,attributes,serialized,uom) values('sample','Sample','{"synthetic":true}',false,'each'),('master-real','Master','{"Master data":"approved"}',false,'each');
    insert into warehouse.locations(id,type,active) values('wh','warehouse',true);
    insert into warehouse.storage_areas(id,location_id,active) values('bin','wh',true);
    insert into warehouse.operation_types(id,code,active) values('${id(800)}','receipt',true);
    insert into warehouse.operation_routes(id,operation_type_id,active,source_location_types,destination_location_types,requires_evidence)
      values('${id(801)}','${id(800)}',true,array['vendor'],array['warehouse'],true);
    insert into procurement.purchase_orders(id,status,core_vendor_id,vendor_name,po_number) values('po','issued','${id(700)}','Test supplier','TEST-PO');
    insert into procurement.purchase_order_lines(id,purchase_order_id,description,quantity,received_quantity,receiving_status,warehouse_product_id)
      values('po-line','po','Test item',1,0,'open','sample');
    insert into warehouse.receipts(id,location_id,lines) values('retired-receipt','wh','[]'),('active-receipt','wh','[]');
    insert into warehouse.procurement_receipt_exception_decisions(id,receipt_id,purchase_order_id,status,requested_disposition,requested_by,facts)
      values('${id(101)}','retired-receipt','po','pending','unidentified','${actor}','[]'),('${id(102)}','active-receipt','po','pending','excess','${actor}','[]');
    insert into warehouse.procurement_receipt_exception_lines(decision_id,po_line_id,active) values('${id(101)}','po-line',false);
    insert into warehouse.procurement_receipt_serial_claims(id,receipt_id,decision_id,po_line_id,product_id,outcome,serial_number,status)
      values('${id(201)}','retired-receipt','${id(101)}','po-line','master-real','clean','KEEP-SERIAL','posted');
    insert into warehouse.unidentified_receipt_custody(decision_id,receipt_id,po_line_id,quantity)
      values('${id(101)}','retired-receipt','po-line',1);
    insert into warehouse.procurement_receipt_excess_custody(id,decision_id,receipt_id,po_line_id,product_id,status)
      values('${id(301)}','${id(101)}','retired-receipt','po-line','master-real','held'),('${id(302)}','${id(102)}','active-receipt','po-line','master-real','held');
    insert into warehouse.receiving_drafts(actor_id,po_id,body,version)
      values('${actor}','po','{"version":1,"lines":[{"productId":"sample"},{"productId":"master-real"}]}',7);
    insert into private.external_po_orders(id,status,location_id,created_by,version) values('${id(1)}','confirmed','wh','${actor}',1),('${id(2)}','confirmed','wh','${actor}',1);
    insert into private.external_po_lines(id,order_id,product_id,quantity,received_quantity,uom)
      values('${id(11)}','${id(1)}','master-real',4,2,'each'),('${id(12)}','${id(2)}','master-real',8,0,'each');
    insert into private.external_po_shipments(id,order_id,lines,status,receipt_id,created_by,version)
      values('${id(21)}','${id(1)}','[]','posted','retired-receipt','${actor}',1),('${id(22)}','${id(1)}','[{"po_line_id":"${id(11)}","quantity":3}]','draft',null,'${actor}',1);
  `);
  for (const f of fixture.functions) await db.exec(f.definition);
  await db.exec(`revoke all on function private.external_po_workspace(jsonb),private.external_po_command(jsonb) from public,anon,service_role;
    grant execute on function private.external_po_workspace(jsonb),private.external_po_command(jsonb) to authenticated;`);
  await db.exec(readMigration('20261106145742_uat_warehouse_fixture_archive'));
  await db.exec(readMigration('20261106174518_uat_archive_external_po_visibility'));
  await db.exec(`insert into private.uat_warehouse_archive_batches(batch_id,manifest) values('uat-receiving-test-001','[{"fixture":"Disposable parent-guard tests"}]');`);
});
after(async () => db.close());

test('baseline: actual command can create unidentified receipt for an archived mapped product', () => isolated(async () => {
  await archive('products', 'sample');
  const result = (await db.query('select private.warehouse_receive_procurement_po_breakdown($1) value', [receiptPayload()])).rows[0].value;
  assert.equal(result.receipt.lines[0].mappedProductId, 'sample');
}));
test('fresh unidentified mapped receipt is denied atomically through actual command', () => isolated(async () => {
  await db.exec(patch); await archive('products', 'sample'); const before = await snapshot();
  await db.exec('savepoint rpc');
  await assert.rejects(db.query('select private.warehouse_receive_procurement_po_breakdown($1) value', [receiptPayload()]), /archived UAT/i);
  await db.exec('rollback to savepoint rpc'); assert.deepEqual(await snapshot(), before);
}));
test('all support writers reject old/new archived parents without registering terminal rows', () => isolated(async () => {
  await db.exec(patch); await archive('receipts', 'retired-receipt');
  for (const sql of [
    `update warehouse.procurement_receipt_exception_decisions set receipt_id='active-receipt' where id='${id(101)}'`,
    `update warehouse.procurement_receipt_exception_lines set decision_id='${id(102)}' where decision_id='${id(101)}'`,
    `update warehouse.procurement_receipt_serial_claims set receipt_id='active-receipt',decision_id=null where id='${id(201)}'`,
    `update warehouse.unidentified_receipt_custody set receipt_id='active-receipt',decision_id='${id(102)}' where decision_id='${id(101)}'`,
    `delete from warehouse.procurement_receipt_excess_custody where id='${id(301)}'`,
    `insert into warehouse.procurement_receipt_exception_lines(decision_id,po_line_id) values('${id(101)}','another-line')`,
    `update warehouse.procurement_receipt_exception_decisions set receipt_id='retired-receipt' where id='${id(102)}'`,
  ]) await denied(sql);
  await db.exec(`update warehouse.procurement_receipt_exception_decisions set request_reason='Retained active work' where id='${id(102)}'`);
  assert.equal((await db.query("select count(*)::int n from private.uat_warehouse_archive_members where table_name like 'procurement_receipt%' or table_name='unidentified_receipt_custody'")).rows[0].n, 0);
}));
test('mapped and identified aliases are checked without treating evidence text as identity', () => isolated(async () => {
  await db.exec(patch); await archive('products', 'sample');
  for (const key of ['mappedProductId','mapped_product_id','identifiedProductId','identified_product_id']) {
    await denied(`insert into warehouse.receipts(id,lines) values('alias-${key}','[{"${key}":"sample"}]')`);
  }
  await denied(`update warehouse.unidentified_receipt_custody set identified_product_id='sample' where decision_id='${id(101)}'`);
  await db.exec(`insert into warehouse.receipts(id,lines,evidence_urls) values('clean','[{"productId":"master-real"}]','["sample"]')`);
}));
test('active work-item readers filter parent archive but authorized raw history is unchanged', () => isolated(async () => {
  const before = await snapshot(); await db.exec(patch); await archive('receipts', 'retired-receipt');
  assert.deepEqual((await db.query("select decision_id from private.warehouse_receipt_exception_work_items_v3('{}')")).rows, [{decision_id:id(102)}]);
  assert.deepEqual((await db.query("select custody_id from warehouse.procurement_receipt_excess_work_items('{}')")).rows, [{custody_id:id(302)}]);
  assert.deepEqual(await snapshot(), before);
  await db.exec("set local test.allowed='no'");
  await denied("select * from private.warehouse_receipt_exception_work_items_v3('{}')", /Not authorized/);
  await denied("select * from warehouse.procurement_receipt_excess_work_items('{}')", /Not authorized/);
}));
test('mapped product in a retained decision filters both readers and protects its child writers', () => isolated(async () => {
  await db.exec(`update warehouse.procurement_receipt_exception_decisions set facts='[{"mappedProductId":"sample"}]' where id='${id(101)}'`);
  const before=await snapshot(); await db.exec(patch); await archive('products','sample');
  assert.deepEqual((await db.query("select decision_id from private.warehouse_receipt_exception_work_items_v3('{}')")).rows,[{decision_id:id(102)}]);
  assert.deepEqual((await db.query("select custody_id from warehouse.procurement_receipt_excess_work_items('{}')")).rows,[{custody_id:id(302)}]);
  await denied(`insert into warehouse.procurement_receipt_exception_lines(decision_id,po_line_id) values('${id(101)}','new-line')`);
  assert.deepEqual(await snapshot(),before);
}));
test('actual receipt command still rejects raw archived-unit and retained-claim serial duplicates', () => isolated(async () => {
  await db.exec(`update warehouse.products set serialized=true where id='sample';
    insert into warehouse.inventory_units(id,product_id,serial_number,status) values('archived-unit','sample','KEEP-UNIT','in_stock');`);
  await db.exec(patch); await archive('inventory_units','archived-unit'); await archive('receipts','retired-receipt');
  for(const [serial,pattern] of [['KEEP-UNIT',/serial number that already exists/],['KEEP-SERIAL',/already claimed/]]){
    const payload=receiptPayload();payload.lines[0].outcomes.unidentified.serial_numbers=[serial];
    await db.exec('savepoint duplicate');
    await assert.rejects(db.query('select private.warehouse_receive_procurement_po_breakdown($1)',[payload]),pattern);
    await db.exec('rollback to savepoint duplicate');
  }
}));
test('existing mixed saved progress stays unchanged; new archived inputs reject and normal clearing remains possible', () => isolated(async () => {
  const before = (await db.query('select to_jsonb(t) value from warehouse.receiving_drafts t')).rows;
  await db.exec(patch); await archive('products', 'sample');
  assert.deepEqual((await db.query('select to_jsonb(t) value from warehouse.receiving_drafts t')).rows, before);
  await denied(`update warehouse.receiving_drafts set body='{"version":1,"lines":[{"productId":"sample"}]}'`);
  await db.exec('update warehouse.receiving_drafts set body=null,version=version+1');
}));
test('exact retired master PO leaves queue but direct history and other master PO remain', () => isolated(async () => {
  const history = await workspace({order_id:id(1)}); const before = await snapshot();
  await db.exec(patch); await archive('external_po_orders', id(1));
  assert.deepEqual((await workspace()).orders.map(o=>o.id), [id(2)]);
  assert.deepEqual(await workspace({order_id:id(1)}), history); assert.deepEqual(await snapshot(), before);
}));
test('retired order blocks its actual draft command and new shipment identities, preserving active commands and cached replay', () => isolated(async () => {
  await db.exec(patch);
  const payload=shipmentPayload(id(2),id(23)); payload.version=0;
  const response=(await db.query('select private.external_po_command($1) value',[payload])).rows[0].value;
  await archive('external_po_orders',id(2));
  assert.deepEqual((await db.query('select private.external_po_command($1) value',[payload])).rows[0].value,response);
  await archive('external_po_orders',id(1));
  for(const p of [shipmentPayload(), {...shipmentPayload(id(1),id(24)),version:0}]){
    await db.exec('savepoint command');
    await assert.rejects(db.query('select private.external_po_command($1)',[p]),/archived UAT/i);
    await db.exec('rollback to savepoint command');
  }
}));
test('shipment receipt OLD and NEW are protected independently of product or parent retirement', () => isolated(async () => {
  await db.exec(patch); await archive('receipts','retired-receipt');
  await denied(`update private.external_po_shipments set receipt_id='active-receipt',order_id='${id(2)}' where id='${id(21)}'`);
  await denied(`update private.external_po_shipments set receipt_id='retired-receipt' where id='${id(22)}'`);
}));
test('migration preserves source rows, metadata and generic private-table rejection', () => isolated(async () => {
  const source=await snapshot(), prior=await metadata(); await db.exec(patch); const current=await metadata();
  assert.deepEqual(await snapshot(),source);
  assert.deepEqual(current.map(({prosrc,...row})=>row),prior.map(({prosrc,...row})=>row));
  for(const f of prior.filter(f=>!['private.external_po_all_lines_archived(uuid)','private.guard_uat_archived_external_po_write()','private.warehouse_receipt_exception_work_items_v3(jsonb)','warehouse.procurement_receipt_excess_work_items(jsonb)'].includes(f.signature))){
    assert.equal(current.find(row=>row.signature===f.signature).prosrc,f.prosrc);
  }
  await denied("select private.archive_uat_warehouse_fixture('uat-private-bad','[{\"table\":\"external_po_orders\",\"row_id\":\"x\",\"row_md5\":\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"provenance\":\"Not a supported table\"}]')",/table is not allowed/);
}));
test('support writers reject stale snapshots; clients cannot call new private helpers', async () => {
  for(const level of ['repeatable read','serializable']){
    await db.exec(`begin isolation level ${level}`);
    try { await db.exec(patch); await denied(`update warehouse.procurement_receipt_exception_decisions set request_reason='edit' where id='${id(102)}'`, error=>error.code==='40001'); }
    finally { await db.exec('rollback'); }
  }
  await isolated(async()=>{
    await db.exec(patch);
    for(const role of ['anon','authenticated','service_role']){
      assert.equal((await db.query("select has_function_privilege($1,'private.uat_receiving_image_archived(jsonb)','execute') allowed",[role])).rows[0].allowed,false);
    }
    await db.exec('set local role authenticated');
    await denied("select private.uat_receiving_image_archived('{}')",/permission denied/);
    await denied("delete from private.uat_warehouse_archive_members",/permission denied/);
  });
});
test('installed predecessor body drift fails closed', () => isolated(async () => {
  const original=fixture.functions.find(f=>f.proname==='warehouse_receipt_exception_work_items_v3').definition;
  await db.exec(original.replace('Controlled receipt decisions','Changed receipt decisions').replace('controlled receipt decisions','changed receipt decisions'));
  await assert.rejects(db.exec(patch),/predecessor drift/i);
}));
