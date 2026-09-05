import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { File } from 'node:buffer';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = name => readFileSync(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
function fn(sql, name) {
  const start = sql.lastIndexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0, name);
  const body = sql.indexOf('$$', start);
  return sql.slice(start, sql.indexOf('$$;', body + 2) + 3);
}
const authority = read('20260714175318_single_po_receipt_authority');
const convergence = read('20260717143000_task3_receipt_authority_forward_convergence');
const breakdown = read('20260826015244_governed_po_receipt_breakdown');
const commands = read('20260710160000_warehouse_w1_quality_and_approval_rpcs');
const independence = read('20260815154910_operations_launch_blocker_slice');
const require = createRequire(new URL('../../apps/shell/package.json', import.meta.url));
const ts = require('typescript');
const documentSource = readFileSync(new URL('../../packages/data-kit/src/supabase/documentEvidence.ts', import.meta.url), 'utf8');
const documentExports = {};
new Function('exports', ts.transpileModule(documentSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(documentExports);
const receiver = '11111111-1111-4111-8111-111111111111';
const supervisor = '22222222-2222-4222-8222-222222222222';
const custody = '33333333-3333-4333-8333-333333333333';
const decision = '44444444-4444-4444-8444-444444444444';
const amendment = '55555555-5555-4555-8555-555555555555';
const payload = {
  idempotency_key: '66666666-6666-4666-8666-666666666666', custody_id: custody,
  outcome: 'accepted_amendment', approved_amendment_id: amendment,
  reason: 'QA-20260905-00003DAF-desktop-1440 Supervisor excess custody final disposition',
  evidence_urls: [`excess-custody/${custody}/77777777-7777-4777-8777-777777777777.png`],
};
const rpc = (db, input = payload) => db.query('select warehouse.resolve_procurement_receipt_excess($1::jsonb) result', [JSON.stringify(input)]);

async function fixture() {
  const db = new PGlite();
  try {
    // Authentication and capability membership are local test inputs. Resolver,
    // command replay, product locking and claim-release bodies are production SQL.
    await db.exec(`
      create schema auth; create schema core; create schema warehouse; create schema procurement; create schema private;
      create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql as $$ select jsonb_build_object('email','supervisor@test') $$;
      create function core.has_cap(text,text) returns boolean language sql as $$ select auth.uid()='${supervisor}'::uuid $$;
      create table core.profiles(id uuid primary key,email text);
      insert into core.profiles values('${receiver}','receiver@test'),('${supervisor}','supervisor@test');
      create table core.activity_log(module text,entity_type text,entity_id text,action text,actor uuid references core.profiles,detail jsonb);
      create table warehouse.command_log(id uuid primary key default gen_random_uuid(),actor_id uuid,command_name text,idempotency_key text,payload_hash text,response jsonb,completed_at timestamptz,unique(actor_id,command_name,idempotency_key));
      create function private.warehouse_payload_hash(jsonb) returns text language sql as $$ select encode(sha256(convert_to($1::text,'UTF8')),'hex') $$;
      create table procurement.purchase_orders(id text primary key,status text,updated_at timestamptz);
      create table procurement.purchase_order_lines(id text primary key,purchase_order_id text,quantity numeric,received_quantity numeric,receiving_status text);
      create table procurement.purchase_order_amendments(id uuid primary key,purchase_order_id text,po_line_id text,status text,previous_quantity numeric,amended_quantity numeric);
      create table warehouse.products(id text primary key,serialized boolean);
      create table warehouse.receipts(id text primary key,location_id text,received_by uuid,actor text,lines jsonb);
      create table warehouse.procurement_receipt_exception_decisions(id uuid primary key,requested_by uuid,receipt_id text,purchase_order_id text,status text,decision text,exception_id uuid);
      create table warehouse.procurement_receipt_exception_lines(decision_id uuid,po_line_id text,active boolean,outcome text,released_at timestamptz);
      create table warehouse.procurement_receipt_excess_custody(id uuid primary key,decision_id uuid,receipt_id text,po_line_id text,product_id text,status text,ordered_quantity numeric,excess_quantity numeric,resolution_reason text,resolution_evidence_urls jsonb,approved_amendment_id uuid,resolved_by uuid,resolved_at timestamptz);
      create table warehouse.stock_levels(id uuid default gen_random_uuid(),product_id text,location_id text,bin_id text,lot_id text,quantity integer,unique nulls not distinct(product_id,location_id,bin_id,lot_id));
      create table warehouse.quality_inspections(id uuid default gen_random_uuid(),source_type text,source_id text,product_id text,location_id text,quantity integer,disposition text,reason text,evidence_urls jsonb,inspected_by uuid,inspected_by_email text,procurement_po_line_id text);
      create table warehouse.movements(id text,type text,product_id text,quantity integer,to_location_id text,reason text,reference text,evidence_urls jsonb,actor text,created_at timestamptz);
      create table warehouse.inventory_holds(inspection_id uuid,status text);
      create table warehouse.procurement_receipt_serial_claims(decision_id uuid,status text,transitioned_by uuid,transitioned_at timestamptz);
      create table warehouse.exceptions(id uuid,status text,resolution text,evidence_urls jsonb,owner_id uuid references core.profiles,updated_at timestamptz,created_by uuid references core.profiles);
      insert into procurement.purchase_orders values('po-excess','issued',now());
      insert into procurement.purchase_order_lines values('line-excess','po-excess',2,1,'open');
      insert into procurement.purchase_order_amendments values('${amendment}','po-excess','line-excess','approved',1,2);
      insert into warehouse.products values('product',false);
      insert into warehouse.receipts values('receipt','location','${receiver}','receiver@test','[{"productId":"product","procurementLineId":"line-excess","quantity":1}]');
      insert into warehouse.procurement_receipt_exception_decisions values('${decision}','${receiver}','receipt','po-excess','decided','quarantine','88888888-8888-4888-8888-888888888888');
      insert into warehouse.procurement_receipt_exception_lines values('${decision}','line-excess',true,'excess',null);
      insert into warehouse.procurement_receipt_excess_custody(id,decision_id,receipt_id,po_line_id,product_id,status,ordered_quantity,excess_quantity) values('${custody}','${decision}','receipt','line-excess','product','held',1,1);
      insert into warehouse.stock_levels(product_id,location_id,quantity) values('product','location',1);
      insert into warehouse.quality_inspections(source_type,source_id,product_id,location_id,quantity,disposition,inspected_by,procurement_po_line_id) values('receipt','receipt','product','location',1,'accepted','${supervisor}','line-excess');
      insert into warehouse.exceptions(id,status,created_by) values('88888888-8888-4888-8888-888888888888','in_progress','${receiver}');
      set test.actor='${supervisor}';
    `);
    for (const name of ['private.begin_idempotent_command','private.finish_idempotent_command']) await db.exec(fn(commands,name));
    for (const name of ['private.lock_warehouse_products','private.guard_active_procurement_receipt_decision']) await db.exec(fn(authority,name));
    await db.exec(fn(breakdown,'private.release_procurement_receipt_line_claim'));
    await db.exec(fn(convergence,'private.warehouse_resolve_procurement_receipt_excess'));
    await db.exec(fn(convergence,'warehouse.resolve_procurement_receipt_excess'));
    await db.exec(fn(authority,'private.bind_quality_procurement_line'));
    for (const name of ['private.enforce_independent_receipt_inspection','private.enforce_independent_exception_resolution']) await db.exec(fn(independence,name));
    await db.exec(`create trigger guard_active_procurement_receipt_decision before insert or update of disposition on warehouse.quality_inspections for each row execute function private.guard_active_procurement_receipt_decision()`);
    await db.exec(`
      create trigger warehouse_independent_receipt_inspection before insert on warehouse.quality_inspections for each row execute function private.enforce_independent_receipt_inspection();
      create trigger warehouse_quality_procurement_line before insert on warehouse.quality_inspections for each row execute function private.bind_quality_procurement_line();
      create trigger warehouse_independent_exception_resolution before update on warehouse.exceptions for each row execute function private.enforce_independent_exception_resolution();
      alter table warehouse.quality_inspections add constraint warehouse_quality_secure_evidence_urls_check check (not jsonb_path_exists(evidence_urls, '$[*]?(@ like_regex "^http://" flag "i")'));
      alter table warehouse.movements add constraint warehouse_movements_secure_evidence_urls_check check (not jsonb_path_exists(evidence_urls, '$[*]?(@ like_regex "^http://" flag "i")'));
    `);
    return db;
  } catch (error) { await db.close(); throw error; }
}

test('CI157 approved 1-to-2 amendment resolves held excess with uploaded storage evidence', async () => {
  const db = await fixture();
  try {
    const uploaded = [];
    const file = new File([new Uint8Array([137,80,78,71,13,10,26,10])], 'QA-excess-custody.png', { type:'image/png' });
    const reference = await documentExports.uploadEvidenceDocument({ storage: { from(bucket) {
      assert.equal(bucket,'evidence');
      return { async upload(path, actualFile, options) {
        assert.equal(actualFile,file);
        assert.deepEqual(options,{ contentType:'image/png',upsert:false });
        uploaded.push(path);
        return { error:null };
      } };
    } } },file,`excess-custody/${custody}`);
    assert.match(reference,new RegExp(`^excess-custody/${custody}/[0-9a-f-]{36}\\.png$`));
    assert.equal(reference,uploaded[0]);
    const { rows } = await rpc(db,{ ...payload,evidence_urls:[reference] });
    assert.equal(rows[0].result.custody.status,'accepted_amendment');
    assert.deepEqual(rows[0].result.custody.resolution_evidence_urls,[reference]);
    assert.deepEqual((await db.query('select evidence_urls from warehouse.movements')).rows[0].evidence_urls,[reference]);
    assert.equal(rows[0].result.purchase_order.status,'closed');
    assert.equal((await db.query('select quantity from warehouse.stock_levels')).rows[0].quantity,2);
    assert.equal((await db.query('select active from warehouse.procurement_receipt_exception_lines')).rows[0].active,false);
  } finally { await db.close(); }
});

test('legacy receipt exception claim follows the installed fallback release chain', async () => {
  const db = await fixture();
  try {
    await db.exec('update warehouse.procurement_receipt_exception_lines set outcome=null');
    const { rows } = await rpc(db);
    assert.equal(rows[0].result.purchase_order.status,'closed');
    assert.equal((await db.query('select active from warehouse.procurement_receipt_exception_lines')).rows[0].active,false);
  } finally { await db.close(); }
});

test('replay cannot double-post stock, receipt quantity, inspections or movements', async () => {
  const db = await fixture();
  try {
    const first = await rpc(db);
    assert.deepEqual(await rpc(db),first);
    assert.equal((await db.query('select quantity from warehouse.stock_levels')).rows[0].quantity,2);
    assert.equal((await db.query('select received_quantity from procurement.purchase_order_lines')).rows[0].received_quantity,'2');
    assert.equal((await db.query('select count(*)::int count from warehouse.quality_inspections')).rows[0].count,2);
    assert.equal((await db.query('select count(*)::int count from warehouse.movements')).rows[0].count,1);
    await assert.rejects(rpc(db,{ ...payload,reason:'changed' }),/reused with a different payload/);
  } finally { await db.close(); }
});

test('invalid amendment, evidence, identity and claim states roll back the entire resolution', async () => {
  const db = await fixture();
  try {
    const cases = [
      ['', { approved_amendment_id:null }, /approved PO amendment/],
      ['', { evidence_urls:[] }, /reason and evidence/],
      ['', { evidence_urls:['http://insecure.test/evidence.png'] }, /secure_evidence_urls_check/],
      [`set test.actor='${receiver}'`, {}, /Not authorized/],
      [`update warehouse.procurement_receipt_exception_decisions set requested_by='${supervisor}'`, {}, /own excess custody/],
      ["update procurement.purchase_order_amendments set status='pending'", {}, /approved PO amendment/],
      ["update procurement.purchase_order_amendments set po_line_id='other-line'", {}, /approved PO amendment/],
      ['update procurement.purchase_order_lines set received_quantity=2', {}, /approved PO amendment/],
      ["update procurement.purchase_order_lines set receiving_status='cancelled'", {}, /no longer open/],
      ['update warehouse.procurement_receipt_exception_lines set active=false', {}, /locked active PO-line claim/],
      [`update warehouse.receipts set received_by='${supervisor}'`, {}, /receipt actor cannot inspect/],
      [`update warehouse.exceptions set created_by='${supervisor}'`, {}, /exception creator cannot resolve/],
    ];
    for (const [setup, overrides, error] of cases) {
      await db.exec('begin');
      try {
        if (setup) await db.exec(setup);
        await db.exec('savepoint before_resolve');
        await assert.rejects(rpc(db,{ ...payload,...overrides }),error);
        await db.exec('rollback to before_resolve');
        assert.equal((await db.query('select quantity from warehouse.stock_levels')).rows[0].quantity,1);
        assert.equal((await db.query('select status from warehouse.procurement_receipt_excess_custody')).rows[0].status,'held');
        assert.equal((await db.query('select count(*)::int count from warehouse.command_log')).rows[0].count,0);
      } finally { await db.exec('rollback'); }
    }
  } finally { await db.close(); }
});
