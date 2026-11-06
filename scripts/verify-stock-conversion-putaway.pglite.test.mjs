import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import { scanSql } from './verify-learning-schema.mjs';
import { connectNativePutawayFixture, createNativePutawayFixture, putawayTimeoutProbeSql, verifyPutawayMigrationTimeouts } from './verify-stock-conversion-putaway.postgres.mjs';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return next(candidate.href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.ts')) return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText};
    return next(url, context);
  },
});
const { SupabaseRepository } = await import('../packages/data-kit/src/supabase/SupabaseRepository.ts');

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const fixName = '20261105233321_stock_conversion_qc_putaway_bridge.sql';
const actorFixName = '20261106012547_stock_conversion_putaway_authoritative_actor.sql';

test('native putaway timeout probe is source-bound and refuses external or override connections', async t => {
  const source = await migration(fixName);
  const schema = `qa_g02_timeout_${'a'.repeat(32)}`;
  const probe = putawayTimeoutProbeSql(source,schema);
  assert.equal(scanSql(probe.prefix).length,3);
  assert.equal(probe.trigger.replace(` on ${schema}.quality_inspections `,' on warehouse.quality_inspections '), scanSql(source).find(sql => sql.startsWith('create trigger stock_conversion_00_qc_watch ')));
  for (const entry of [
    ['external database','postgresql://postgres:unused@example.invalid:54322/postgres'],
    ['different local database','postgresql://postgres:unused@127.0.0.1:54322/existing'],
    ['different local port','postgresql://postgres:unused@127.0.0.1:5432/postgres'],
    ['connection override','postgresql://postgres:unused@127.0.0.1:54322/postgres?host=example.invalid'],
  ]) await t.test(entry[0], async () => {
    await assert.rejects(verifyPutawayMigrationTimeouts(entry[1]));
    await assert.rejects(createNativePutawayFixture(entry[1]));
    await assert.rejects(connectNativePutawayFixture(entry[1]));
  });
  for (const [name, mutate] of [
    ['missing local limits',sql => sql.replace(/select pg_catalog\.set_config\('lock_timeout'[\s\S]*?name='lock_timeout';/,'')],
    ['session-setting leak',sql => sql.replace("'ms',true)","'ms',false)")],
    ['changed trigger target',sql => sql.replace('on warehouse.quality_inspections for each row','on warehouse.receipts for each row')],
  ]) await t.test(name, () => assert.throws(() => putawayTimeoutProbeSql(mutate(source),schema)));
  await t.test('scratch name is closed', () => assert.throws(() => putawayTimeoutProbeSql(source,'warehouse')));
  const nativeGate = await readFile(new URL('./verify-learning-concurrency.mjs',import.meta.url),'utf8');
  assert.match(nativeGate,/await verifyPutawayMigrationTimeouts\(connectionString\);/);
});

for (const migrationName of [fixName,actorFixName]) test(`${migrationName}: timeout caps precede DDL and preserve stricter session limits`, async t => {
  const statements = scanSql(await migration(migrationName));
  assert.equal(statements[0].toLowerCase(), 'begin');
  for (const [index, setting] of ['lock_timeout', 'statement_timeout'].entries()) {
    assert.match(statements[index + 1], new RegExp(`^select pg_catalog\\.set_config\\(\\s*'${setting}'`, 'i'));
    assert.match(statements[index + 1], /true\s*\)\s*from pg_catalog\.pg_settings/i);
  }
  assert.match(statements[3], /^do\b/i);
  const db = new PGlite();
  const settings = async () => (await db.query("select name,setting::int value from pg_settings where name in ('lock_timeout','statement_timeout') order by name")).rows.map(row => row.value);
  try {
    for (const entry of [
      { name:'zero is unbounded', session:['0','0'], expected:[5000,60000] },
      { name:'stricter limits retained', session:['120ms','250ms'], expected:[120,250] },
      { name:'larger limits capped', session:['2min','3min'], expected:[5000,60000] },
      { name:'independent lock limit', session:['90ms','0'], expected:[90,60000] },
      { name:'independent statement limit', session:['0','400ms'], expected:[5000,400] },
      { name:'equal limits retained', session:['5s','60s'], expected:[5000,60000] },
    ]) {
      await t.test(entry.name, async () => {
        for (const [index, name] of ['lock_timeout','statement_timeout'].entries()) {
          await db.query('select set_config($1,$2,false)', [name,entry.session[index]]);
        }
        const before = await settings();
        for (const end of ['rollback','commit']) {
          await db.exec(`${statements.slice(0,3).join(';')};`);
          assert.deepEqual(await settings(), entry.expected);
          await db.exec(end);
          assert.deepEqual(await settings(), before, `${end} restores caller settings`);
        }
      });
    }
  } finally { await db.close(); }
});
const operator = '11111111-1111-4111-8111-111111111111';
const operatorEmail = 'putaway-operator@example.invalid';
const quality = '22222222-2222-4222-8222-222222222222';
const owner = '33333333-3333-4333-8333-333333333333';
const orderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const lineId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const shipmentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const kit = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const extract = (sql, name) => {
  const start = sql.search(new RegExp(`create (?:or replace )?function ${name.replaceAll('.', '\\.')}\\(`, 'i'));
  assert.notEqual(start, -1, `Actual function ${name} exists`);
  const delimiter = sql.slice(start).match(/\bas (\$[\w]*\$)/i);
  assert.ok(delimiter);
  const body = start + delimiter.index + delimiter[0].length;
  return sql.slice(start, sql.indexOf(`${delimiter[1]};`, body) + delimiter[1].length + 1);
};

async function database() {
  const nativeUrl = process.env.QA_QC_NATIVE_DATABASE_URL;
  const db = nativeUrl ? await connectNativePutawayFixture(nativeUrl) : new PGlite();
  try {
  if (!nativeUrl) await db.exec('create role anon; create role authenticated; create role service_role');
  await db.exec(`
    create schema auth; create schema core; create schema private; create schema warehouse; create schema storage; create schema product;
    grant usage on schema warehouse,private,core,auth to authenticated;
    grant usage on schema warehouse,private to anon,service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('sub',auth.uid(),'email','fixture@example.invalid') $$;
    create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
    create function core.has_live_cap(text,text) returns boolean language sql stable as $$ select auth.uid() is not null and current_setting('test.live',true)='yes' $$;
    create function core.has_cap(text,text) returns boolean language sql stable as $$ select auth.uid() is not null and current_setting('test.cap',true)='yes' $$;
    create function product.can_launch(text) returns boolean language sql stable as $$ select current_setting('test.launch',true)='yes' $$;
    create function private.can_read_warehouse_table(text) returns boolean language sql stable as $$ select true $$;
    create table core.profiles(id uuid primary key,status text,kind text,email text);
    create table core.roles(module text,role text,is_active boolean);
    create table core.user_roles(user_id uuid,module text,role text,effective_at timestamptz,expires_at timestamptz);
    create table core.activity_log(id bigserial,module text,entity_type text,entity_id text,action text,actor uuid,detail jsonb);
    create table warehouse.products(id text primary key,sku text,name text,category text,serialized boolean,serialization_policy text,unit_cost numeric default 0,uom text default 'piece',expiry_tracked boolean default false);
    create table warehouse.locations(id text primary key,type text,active boolean);
    create table warehouse.storage_areas(id text primary key,location_id text,active boolean);
    create table warehouse.suppliers(id text primary key,name text);
    create table warehouse.receipts(id text primary key,supplier_id text,location_id text,lines jsonb,evidence_urls jsonb,actor text,created_at timestamptz default now(),quality_status text,actual_delivery_date date,delivery_reference text,received_by uuid,procurement_po_id text);
    create table warehouse.lots(id text primary key,product_id text,lot_code text,supplier_id text,unit_cost numeric,received_at timestamptz,expiry_date date);
    create table warehouse.inventory_units(id text primary key,product_id text,serial_number text unique,lot_id text,location_id text,bin_id text,status text,event_id text,assigned_to text);
    create table warehouse.stock_levels(product_id text,location_id text,bin_id text,lot_id text,quantity integer,unique nulls not distinct(product_id,location_id,bin_id,lot_id));
    create table warehouse.movements(id text primary key,type text,product_id text,quantity integer,from_location_id text,from_bin_id text,to_location_id text,to_bin_id text,lot_id text,serial_number text,event_id text,reference text,reason text,evidence_urls jsonb,actor text,created_at timestamptz default now());
    create table warehouse.quality_inspections(id uuid primary key default gen_random_uuid(),source_type text check(source_type in ('receipt','return')),source_id text,product_id text,lot_id text,serial_number text,location_id text,bin_id text,quantity integer,disposition text,reason text,evidence_urls jsonb,inspected_by uuid,inspected_by_email text,inspected_at timestamptz default now(),procurement_po_line_id text);
    create table warehouse.inventory_holds(id uuid primary key default gen_random_uuid(),inspection_id uuid,product_id text,location_id text,bin_id text,lot_id text,serial_number text,quantity integer,status text default 'active',reason text,evidence_urls jsonb,created_by uuid,created_at timestamptz default now(),released_by uuid,released_at timestamptz,release_reason text,release_evidence_urls jsonb);
    create table warehouse.exceptions(id uuid primary key default gen_random_uuid(),exception_type text,severity text,source_type text,source_id text,status text,resolution text,evidence_urls jsonb,created_by uuid,owner_id uuid,due_at timestamptz,created_at timestamptz default now());
    create table warehouse.command_log(id uuid primary key default gen_random_uuid(),actor_id uuid,command_name text,idempotency_key text,payload_hash text,response jsonb,created_at timestamptz default now(),completed_at timestamptz,unique(actor_id,command_name,idempotency_key));
    create function private.warehouse_payload_hash(jsonb) returns text language sql as $$ select encode(sha256(convert_to($1::text,'UTF8')),'hex') $$;
    create table warehouse.events(id text primary key,name text,status text,start_date date);
    create table warehouse.allocations(id text primary key,event_id text,product_id text,quantity integer,status text);
    create table warehouse.returns(id text primary key,source text,event_id text,lines jsonb,created_at timestamptz default now());
    create table warehouse.kit_definitions(id uuid primary key,product_id text,version integer,name text,components jsonb,status text,owner_department text,product_approval_reference text);
    create table warehouse.fulfillment_reservations(id uuid primary key,product_id text,location_id text,bin_id text,quantity integer,status text);
    create table warehouse.procurement_receipt_serial_claims(serial_number text,product_id text,status text,outcome text);
    create table private.event_custody_sources(allocation_id text primary key,event_id text,order_id uuid,product_id text,quantity integer,serial_numbers text[],acknowledged_at timestamptz,created_at timestamptz default now());
    create table private.event_custody_entries(id uuid primary key default gen_random_uuid(),event_id text,allocation_id text,seller_id uuid,kind text,quantity integer,serial_numbers text[],amount numeric,external_reference text,reverses_id uuid,created_at timestamptz default now());
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,owner_id text,owner uuid);
    alter table storage.objects enable row level security;
    create function private.warehouse_inspect_quality_v3(jsonb) returns jsonb language plpgsql as $$ begin raise exception 'Unreviewed legacy fixture path'; end $$;
    create function private.inspect_return_intake(jsonb) returns jsonb language plpgsql as $$ begin raise exception 'Unreviewed return fixture path'; end $$;
    create function warehouse.issue(jsonb) returns jsonb language sql as $$ select $1 $$;
    insert into core.profiles values('${operator}','active','employee','${operatorEmail}'),('${quality}','active','employee','putaway-quality@example.invalid'),('${owner}','active','employee','putaway-owner@example.invalid');
    insert into core.roles values('warehouse','warehouse_supervisor',true);
    insert into core.user_roles values('${owner}','warehouse','warehouse_supervisor',now()-interval '1 day',null);
    insert into warehouse.locations values('wh','warehouse',true),('other','warehouse',true);
    insert into warehouse.storage_areas values('arrival','wh',true),('source','wh',true),('output','wh',true),('other-bin','wh',true),('cross','other',true);
    insert into warehouse.products(id,sku,name,category,serialized,serialization_policy) values('base','BASE','Base','device',true,'required'),('variant','VARIANT','Variant','device',true,'required'),('bulk','BULK','Bulk','supply',false,'none');
    insert into warehouse.suppliers values('supplier','Synthetic supplier');
    insert into warehouse.events values('event','Synthetic event','planned',current_date);
    insert into warehouse.kit_definitions values('${kit}','variant',1,'Serial only','[{"productId":"base","quantity":1,"serializationPolicy":"required"}]','active','product','Synthetic approval');
    insert into storage.objects(bucket_id,name,owner_id,owner) values('warehouse-po-evidence','${operator}/po.pdf','${operator}','${operator}'),('evidence','external/shipment.png','${operator}','${operator}'),('evidence','external/quality.png','${quality}','${quality}');
    set test.live='yes'; set test.cap='yes'; set test.launch='yes';
  `);
  await db.exec(await migration('20260718191000_restore_warehouse_actor_helpers.sql'));
  const helpers = await migration('20260710160000_warehouse_w1_quality_and_approval_rpcs.sql');
  await db.exec(extract(helpers, 'private.begin_idempotent_command'));
  await db.exec(extract(helpers, 'private.finish_idempotent_command'));
  await db.exec(extract(await migration('20260714175318_single_po_receipt_authority.sql'), 'private.lock_warehouse_products'));
  await db.exec(extract(await migration('20260718201000_refresh_atp_inside_product_lock.sql'), 'warehouse.available_to_promise'));
  await db.exec(await migration('20260810155237_block_transfer_of_held_inventory.sql'));
  await db.exec(extract(await migration('20260813203240_task_1_database_authority_remediation.sql'), 'warehouse.transfer'));
  await db.exec(await migration('20260905094000_offline_replay_identity.sql'));
  await db.exec(await migration('20261019180843_lot_aware_atomic_putaway.sql'));
  await db.exec(await migration('20261105141930_serialized_transfer_quantity_identity.sql'));
  await db.exec(await migration('20261105071201_warehouse_unit_custody_history.sql'));
  await db.exec(extract(await migration('20260920025525_gated_event_seller_custody.sql'), 'private.assert_event_conversion_return'));
  // Conversion patches this exact serial-custody guard; it is not a stub.
  const serialGuard = await migration('20260826160000_harden_serial_custody_concurrency.sql');
  await db.exec(extract(serialGuard, 'private.lock_serial_custody_identity'));
  await db.exec(extract(serialGuard, 'private.normalize_inventory_unit_serial'));
  await db.exec('create trigger warehouse_inventory_unit_serial_normalize before insert or update of serial_number,product_id,status on warehouse.inventory_units for each row execute function private.normalize_inventory_unit_serial()');
  await db.exec(await migration('20260920025920_approved_stock_origin_conversion.sql'));
  await db.exec(await migration('20261019142956_warehouse_external_po_receiving.sql'));
  return db;
  } catch (error) { await db.close(); throw error; }
}

test('QC putaway provenance uses actual receipt, inspection, transfer and conversion SQL', async t => {
  const db = await database();
  let key = 0;
  const actor = id => db.query("select set_config('test.actor',$1,false)", [id]);
  const rpc = async (name, input) => {
    await db.exec('set role authenticated');
    try { return (await db.query(`select warehouse.${name}($1::jsonb) result`, [JSON.stringify(input)])).rows[0].result; }
    catch (error) { error.message = `${name}/${input.action ?? ''}: ${error.message} (${error.where ?? ''})`; throw error; }
    finally { await db.exec('reset role').catch(() => {}); }
  };
  const command = (name, input) => rpc(name, { ...input, idempotency_key: input.idempotency_key ?? `qc-putaway-fixture-${++key}` });
  try {
    await actor(operator);
    await command('external_po_command', { action:'save_order', order_id:orderId, version:0, po_number:'SYNTHETIC-QC', supplier_id:'supplier', location_id:'wh', email_sender:'synthetic@example.invalid', email_date:'2026-10-18', evidence_urls:[`warehouse-po-evidence/${operator}/po.pdf`], lines:[{id:lineId,product_id:'base',quantity:1,uom:'piece'}] });
    await actor(owner);
    await command('external_po_command', { action:'confirm_order',order_id:orderId,version:1,review_note:'Independent synthetic confirmation' });
    await actor(operator);
    await command('external_po_command', { action:'save_shipment',order_id:orderId,shipment_id:shipmentId,version:0,delivery_reference:'SYNTHETIC-DR',actual_delivery_date:'2026-10-18',bin_id:'arrival',evidence_urls:['external/shipment.png'],lines:[{po_line_id:lineId,quantity:1,serial_numbers:['QC-PUTAWAY-001']}] });
    const receipt = await command('external_po_command', { action:'post_shipment',order_id:orderId,shipment_id:shipmentId,version:1 });
    const q = (await db.query('select * from warehouse.quality_inspections')).rows[0];
    const unit = (await db.query('select * from warehouse.inventory_units')).rows[0];
    const wrapperState = () => db.query("select oid::text,pg_get_functiondef(oid) body,proacl::text,prosecdef,proconfig from pg_proc where oid in ('warehouse.transfer(jsonb)'::regprocedure,'warehouse.transfer_pre_offline_identity(jsonb)'::regprocedure,'private.warehouse_offline_action(text,jsonb)'::regprocedure,'private.warehouse_transfer(jsonb)'::regprocedure,'private.warehouse_transfer_pre_lot_putaway(jsonb)'::regprocedure,'warehouse.execute_stock_conversion(jsonb)'::regprocedure,'warehouse.inspect_quality(jsonb)'::regprocedure,'private.external_po_inspect(jsonb)'::regprocedure) order by oid");
    const originalWrappers = (await wrapperState()).rows;
    if (process.env.QA_QC_BRIDGE_BASELINE !== '1') {
      await db.exec(await migration(fixName));
    }
    await actor(quality);
    await command('inspect_quality', {source_type:'receipt',source_id:receipt.receipt_id,product_id:'base',lot_id:q.lot_id,serial_number:unit.serial_number,quantity:1,disposition:'accepted',evidence_urls:['external/quality.png']});
    const accepted = (await db.query('select * from warehouse.quality_inspections')).rows[0];
    assert.equal(accepted.bin_id, null);
    const transferPayload = () => ({command_input:{productId:'base',quantity:1,locationId:'wh',fromBinId:null,toBinId:'source',serialNumbers:[unit.serial_number]},unit_ids:[unit.id],from_location_id:'wh',from_bin_id:null,to_location_id:'wh',to_bin_id:'source',movement:{id:`move-${++key}`,type:'transfer',product_id:'base',quantity:1,from_location_id:'wh',from_bin_id:null,to_location_id:'wh',to_bin_id:'source',serial_number:unit.serial_number,lot_id:unit.lot_id}});
    const move = (extra={}) => command('transfer', {...transferPayload(),...extra});
    const repository = new SupabaseRepository({});
    repository.getStockState = async () => ({products:[{id:'base',serialized:true}],units:[{id:unit.id,productId:'base',serialNumber:unit.serial_number,locationId:'wh',lotId:unit.lot_id,status:'in_stock'}],stockLevels:[],allocations:[],holds:[],inventoryPositions:[]});
    repository.callRpc = (name,payload) => rpc(name,payload);
    const actualPutaway = () => repository.relocate({productId:'base',locationId:'wh',toBinId:'source',quantity:1,serialNumbers:[unit.serial_number],actor:'untrusted-display-actor',idempotencyKey:`actual-repository-putaway-${++key}`});
    const workspace = () => rpc('stock_conversion_workspace',{});
    const recipe = () => command('execute_stock_conversion', {action:'approve_recipe',kit_definition_id:kit,event_id:'event',direction:'conversion',source_product_id:'base',output_product_id:'variant',packaging:[],approval_reference:'Synthetic Product approval',evidence_urls:['https://evidence.test/recipe']});
    const create = r => command('execute_stock_conversion', {action:'create',recipe_id:r.id,event_id:'event',source_location_id:'wh',source_bin_id:'source',destination_location_id:'wh',destination_bin_id:'output',units:[{serial_number:unit.serial_number,inspection_id:q.id}],evidence_urls:['https://evidence.test/create']});
    const snapshot = async () => (await db.query(`select jsonb_build_object('units',(select jsonb_agg(u order by id) from warehouse.inventory_units u),'qc',(select jsonb_agg(q order by id) from warehouse.quality_inspections q),'movements',(select jsonb_agg(m order by id) from warehouse.movements m),'claims',(select jsonb_agg(c order by batch_id,unit_id) from private.stock_conversion_claims c),'batches',(select jsonb_agg(b order by id) from private.stock_conversion_batches b),'commands',(select jsonb_agg(c order by id) from warehouse.command_log c)) state`)).rows[0].state;
    const scenario = async (name, body) => t.test(name, async () => { await db.exec('begin'); try { await actor(operator); await body(); } finally { await db.exec('rollback'); } });
    const denied = async (body, pattern) => {
      const before = await snapshot();
      await db.exec('savepoint denied');
      try { await assert.rejects(body,pattern); }
      finally { await db.exec('rollback to savepoint denied; release savepoint denied'); }
      assert.deepEqual(await snapshot(),before,'denied command has no business writes');
    };
    const bridgeCount = async () => (await db.query('select count(*)::int n from private.stock_conversion_putaway_bridges')).rows[0].n;
    const cannotCreate = async () => {
      assert.equal((await workspace()).candidates.length,0);
      await actor(owner); const r=await recipe(); await actor(operator);
      await denied(() => create(r),/exact-source|held|allocations|custody|source bin|Active source and destination warehouse bins/);
    };

    if (process.env.QA_QC_BRIDGE_BASELINE !== '1') {
      await scenario('pre-fix email putaway remains unbridged and ineligible after correction without replay',async()=>{
        await actualPutaway();
        assert.equal((await db.query("select actor from warehouse.movements where type='transfer'")).rows[0].actor,operatorEmail);
        assert.equal(await bridgeCount(),0);
        assert.equal((await workspace()).candidates.length,0);
        const before=await snapshot();
        const lineage=async()=> (await db.query("select jsonb_build_object('history',(select jsonb_agg(h order by id) from private.warehouse_unit_history h),'receipts',(select jsonb_agg(r) from private.warehouse_offline_receipts r),'origins',(select jsonb_agg(o) from private.stock_conversion_qc_origins o)) data")).rows[0].data;
        const beforeLineage=await lineage();
        // Run the exact migration contents inside this scenario's rollback boundary.
        // Full-file commit/rollback and metadata preservation are tested separately.
        await db.exec(`${scanSql(await migration(actorFixName)).slice(1,-1).join(';\n')};`);
        assert.equal(await bridgeCount(),0);
        assert.equal((await workspace()).candidates.length,0);
        assert.deepEqual(await snapshot(),before);
        assert.deepEqual(await lineage(),beforeLineage);
      });
      await db.exec(await migration(actorFixName));
    }
    await scenario('eligible putaway exposes exact accepted QC without rewriting it', async () => {
      await actualPutaway();
      assert.equal((await db.query("select actor from warehouse.movements where type='transfer'")).rows[0].actor,operatorEmail);
      const txRows=(await db.query(`select m.xmin::text movement_xmin,u.xmin::text unit_xmin,h.xmin::text history_xmin,c.xmin::text receipt_xmin,c.actor_id receipt_actor,h.actor_id history_actor
        from private.warehouse_offline_receipts c join warehouse.movements m on m.id=c.result->>'id'
        cross join warehouse.inventory_units u join private.warehouse_unit_history h on h.unit_id=u.id and h.operation='changed'
        where c.method='transfer'`)).rows;
      assert.equal(txRows.length,1);
      const tx=txRows[0];
      assert.equal(tx.movement_xmin,tx.receipt_xmin);
      assert.equal(tx.unit_xmin,tx.receipt_xmin);
      assert.equal(tx.history_xmin,tx.receipt_xmin);
      assert.equal(tx.receipt_actor,operator);
      assert.equal(tx.history_actor,operator);
      assert.equal((await workspace()).candidates.length,1, 'fresh accepted external stock is selectable after putaway');
      assert.deepEqual((await db.query('select * from warehouse.quality_inspections')).rows[0],accepted);
      assert.equal((await db.query('select count(*)::int n from private.stock_conversion_putaway_bridges')).rows[0].n,1);
    });
    if (process.env.QA_QC_BRIDGE_BASELINE === '1') return;
    for (const email of [null,'']) await scenario(`canonical actor UUID fallback for ${email===null?'null':'empty'} profile email`,async()=>{
      await db.query('update core.profiles set email=$1 where id=$2',[email,operator]);
      await actualPutaway();
      assert.equal((await db.query("select actor from warehouse.movements where type='transfer'")).rows[0].actor,operator);
      assert.equal(await bridgeCount(),1);
      assert.equal((await workspace()).candidates.length,1);
    });
    await scenario('normal wrapper ignores another claimed actor and retains authenticated UUID lineage',async()=>{
      const input=transferPayload();
      input.movement.actor='putaway-owner@example.invalid';
      const result=await command('transfer',input);
      assert.equal(result.actor,operatorEmail);
      assert.notEqual(result.actor,input.movement.actor);
      assert.equal(await bridgeCount(),1);
      assert.equal((await db.query('select actor_id from private.stock_conversion_putaway_bridges')).rows[0].actor_id,operator);
      assert.equal((await db.query("select actor_id from private.warehouse_unit_history where operation='changed'")).rows[0].actor_id,operator);
    });
    await scenario('capture rejects a privileged injected mismatching stored movement actor',async()=>{
      // Only this isolated adversarial fixture changes stored output; RPC stamping remains real.
      await db.exec(`create function private.synthetic_forge_movement_actor() returns trigger language plpgsql as $$
        begin new.actor:='putaway-owner@example.invalid'; return new; end $$;
        create trigger synthetic_forge_movement_actor before insert on warehouse.movements
        for each row execute function private.synthetic_forge_movement_actor()`);
      const result=await move();
      assert.equal(result.actor,'putaway-owner@example.invalid');
      assert.equal(await bridgeCount(),0);
      assert.equal((await workspace()).candidates.length,0);
    });
    await scenario('unauthenticated transfer cannot create putaway provenance',async()=>{
      await actor('');
      await denied(()=>move(),/Not authorized|Authentication|authenticated|actor/i);
      assert.equal(await bridgeCount(),0);
    });
    await scenario('conversion preserves serial, releases claim and retains original QC', async () => {
      await actualPutaway(); await actor(owner); const r=await recipe(); await actor(operator); const batch=await create(r);
      await actor(quality); await command('execute_stock_conversion',{action:'approve',batch_id:batch.id,inspected_serial_numbers:[unit.serial_number],evidence_urls:['https://evidence.test/quality']});
      await actor(operator); const result=await command('execute_stock_conversion',{action:'complete',batch_id:batch.id,evidence_urls:['https://evidence.test/completion']});
      assert.equal(result.status,'completed');
      assert.deepEqual((await db.query('select id,serial_number,product_id,bin_id,status from warehouse.inventory_units')).rows[0],{id:unit.id,serial_number:unit.serial_number,product_id:'variant',bin_id:'output',status:'in_stock'});
      assert.deepEqual((await db.query('select * from warehouse.quality_inspections')).rows[0],accepted);
      assert.equal((await db.query("select count(*)::int n from warehouse.movements where type in ('stock_conversion_in','stock_conversion_out') and quantity=1")).rows[0].n,2);
      assert.equal((await db.query('select count(*)::int n from private.stock_conversion_claims where released_at is null')).rows[0].n,0);
    });
    await scenario('all existing transfer/Quality/execution wrappers retain exact OIDs bodies ACLs and settings',async()=>{
      assert.deepEqual((await wrapperState()).rows,originalWrappers);
    });
    await scenario('exact-key replay creates one movement/history/bridge only',async()=>{
      const input={...transferPayload(),idempotency_key:'qc-putaway-repeat-001'};
      const first=await rpc('transfer',input); const before=await snapshot();
      assert.deepEqual(await rpc('transfer',input),first); assert.deepEqual(await snapshot(),before);
      assert.equal(await bridgeCount(),1);
      assert.equal((await db.query('select count(*)::int n from private.warehouse_unit_history')).rows[0].n,2);
    });
    for (const [name,change] of [
      ['released hold',"insert into warehouse.inventory_holds(product_id,location_id,bin_id,lot_id,serial_number,quantity,status) select product_id,location_id,bin_id,lot_id,serial_number,1,'released' from warehouse.inventory_units"],
      ['scoped released hold',"insert into warehouse.inventory_holds(product_id,location_id,quantity,status) values('base','wh',1,'released')"],
      ['new rejected QC',"insert into warehouse.quality_inspections(source_type,source_id,product_id,location_id,bin_id,serial_number,quantity,disposition,evidence_urls) select 'receipt','new',product_id,location_id,bin_id,serial_number,1,'damaged','[]' from warehouse.inventory_units"],
      ['return',"insert into warehouse.returns(id,lines) values('new-return','[{\"serialNumber\":\"QC-PUTAWAY-001\"}]')"],
      ['active reservation',"insert into warehouse.fulfillment_reservations(id,product_id,location_id,bin_id,status,quantity) values(gen_random_uuid(),'base','wh','source','active',1)"],
      ['active allocation',"insert into warehouse.allocations(id,product_id,status,quantity) values('allocation','base','allocated',1)"],
      ['held procurement custody',"insert into warehouse.procurement_receipt_serial_claims values('QC-PUTAWAY-001','base','held',null)"],
      ['lot mutation',"update warehouse.lots set lot_code='changed'"],
      ['receipt mutation',"update warehouse.receipts set delivery_reference='changed'"],
      ['bin inactive',"update warehouse.storage_areas set active=false where id='source'"],
    ]) await scenario(`${name} invalidates selection and create`,async()=>{await move();await db.exec(change);await cannotCreate();});
    await scenario('released then deleted hold cannot resurrect bridge',async()=>{
      await move(); await db.exec("insert into warehouse.inventory_holds(product_id,location_id,quantity,status,reason) values('base','wh',1,'released','new'); delete from warehouse.inventory_holds where reason='new'");
      await cannotCreate();
    });
    await scenario('new QC then deletion cannot resurrect bridge',async()=>{
      await move();await db.exec("insert into warehouse.quality_inspections(source_type,source_id,serial_number,disposition) values('receipt','new','QC-PUTAWAY-001','damaged'); delete from warehouse.quality_inspections where source_id='new'");await cannotCreate();
    });
    await scenario('released hold before putaway prevents proof but not normal transfer',async()=>{
      await db.exec("insert into warehouse.inventory_holds(product_id,location_id,quantity,status) values('base','wh',1,'released')");
      await move();assert.equal(await bridgeCount(),0);await cannotCreate();
    });
    for (const [name,change] of [
      ['custody',"update warehouse.inventory_units set assigned_to='someone'; update warehouse.inventory_units set assigned_to=null"],
      ['bin away and back',"update warehouse.inventory_units set bin_id='other-bin'; update warehouse.inventory_units set bin_id='source'"],
      ['lot away and back',"update warehouse.inventory_units set lot_id=null; update warehouse.inventory_units set lot_id=(select id from warehouse.lots limit 1)"],
      ['product away and back',"update warehouse.inventory_units set product_id='variant'; update warehouse.inventory_units set product_id='base'"],
    ]) await scenario(`${name} is not erased by restoring current state`,async()=>{await move();await db.exec(change);await cannotCreate();});
    await scenario('normal transfer without an offline key does not mint proof',async()=>{
      await rpc('transfer',transferPayload());assert.equal(await bridgeCount(),0);await cannotCreate();
    });
    await scenario('missing explicit serial selection permits legacy transfer without proof',async()=>{
      const p=transferPayload();p.command_input.serialNumbers=[];await command('transfer',p);assert.equal(await bridgeCount(),0);await cannotCreate();
    });
    await scenario('cross-warehouse transfer succeeds but cannot bridge QC',async()=>{
      const p=transferPayload();delete p.command_input.locationId;Object.assign(p.command_input,{fromLocationId:'wh',toLocationId:'other',toBinId:'cross'});p.to_location_id='other';p.to_bin_id='cross';p.movement.to_location_id='other';p.movement.to_bin_id='cross';
      await command('transfer',p);assert.equal(await bridgeCount(),0);assert.equal((await workspace()).candidates.length,0);
    });
    await scenario('missing QC still permits ordinary first putaway without proof',async()=>{
      await db.query("insert into warehouse.inventory_units select (jsonb_populate_record(null::warehouse.inventory_units,$1::jsonb)).*",[JSON.stringify({...unit,id:'no-qc',serial_number:'NO-QC'})]);
      const p=transferPayload();p.unit_ids=['no-qc'];p.command_input.serialNumbers=['NO-QC'];p.movement.serial_number='NO-QC';
      await command('transfer',p);assert.equal(await bridgeCount(),0);
      assert.equal((await db.query("select bin_id from warehouse.inventory_units where id='no-qc'")).rows[0].bin_id,'source');
    });
    await scenario('historical accepted QC is not backfilled on later putaway',async()=>{
      await db.query("insert into warehouse.inventory_units select (jsonb_populate_record(null::warehouse.inventory_units,$1::jsonb)).*",[JSON.stringify({...unit,id:'historical',serial_number:'HISTORICAL'})]);
      await db.query("insert into warehouse.quality_inspections select (jsonb_populate_record(null::warehouse.quality_inspections,$1::jsonb)).*",[JSON.stringify({...accepted,id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',serial_number:'HISTORICAL'})]);
      const p=transferPayload();p.unit_ids=['historical'];p.command_input.serialNumbers=['HISTORICAL'];p.movement.serial_number='HISTORICAL';
      await command('transfer',p);assert.equal(await bridgeCount(),0);assert.equal((await workspace()).candidates.length,0);
    });
    await scenario('two-unit transfer preserves workflow but creates no single-unit proof',async()=>{
      await db.query("insert into warehouse.inventory_units select (jsonb_populate_record(null::warehouse.inventory_units,$1::jsonb)).*",[JSON.stringify({...unit,id:'second',serial_number:'SECOND'})]);
      const p=transferPayload();p.unit_ids.push('second');p.command_input.serialNumbers.push('SECOND');p.command_input.quantity=2;p.movement.quantity=2;p.movement.serial_number=null;
      await command('transfer',p);assert.equal(await bridgeCount(),0);
      assert.equal((await db.query("select count(*)::int n from warehouse.inventory_units where bin_id='source'")).rows[0].n,2);
    });
    await scenario('ordinary bulk transfer stays available without QC proof',async()=>{
      await db.exec("insert into warehouse.stock_levels values('bulk','wh',null,null,3)");
      const p={command_input:{productId:'bulk',quantity:1,fromLocationId:'wh',toLocationId:'wh',toBinId:'source'},from_stock_delta:{product_id:'bulk',location_id:'wh',delta:-1},to_stock_delta:{product_id:'bulk',location_id:'wh',bin_id:'source',delta:1},movement:{id:'bulk',type:'transfer',product_id:'bulk',quantity:1,from_location_id:'wh',to_location_id:'wh',to_bin_id:'source'}};
      await command('transfer',p);assert.equal(await bridgeCount(),0);
      assert.equal((await db.query("select sum(quantity)::int n from warehouse.stock_levels where product_id='bulk'")).rows[0].n,3);
    });
    await scenario('exact active hold retains existing transfer denial',async()=>{
      await db.query("insert into warehouse.inventory_holds(product_id,location_id,lot_id,serial_number,quantity,status) values('base','wh',$1,$2,1,'active')",[unit.lot_id,unit.serial_number]);
      await denied(()=>move(),/Held serialized inventory/);assert.equal(await bridgeCount(),0);
    });
    await scenario('proof movement tampering remains invalid even when restored',async()=>{
      await move();await db.exec("update warehouse.movements set reason='changed' where type='transfer'; update warehouse.movements set reason=null where type='transfer'");await cannotCreate();
    });
    await scenario('history deletion cannot make an away-and-back cycle appear clean',async()=>{
      await move();await db.exec("update warehouse.inventory_units set bin_id='other-bin'; update warehouse.inventory_units set bin_id='source'; delete from private.warehouse_unit_history where id>(select history_id from private.stock_conversion_putaway_bridges)");await cannotCreate();
    });
    await scenario('returned status then cancelled claim cannot reuse the original bridge',async()=>{
      await move();await actor(owner);const r=await recipe();await actor(operator);const b=await create(r);
      await command('execute_stock_conversion',{action:'cancel',batch_id:b.id,reason:'Synthetic cancellation',evidence_urls:['https://evidence.test/cancel']});
      await cannotCreate();
    });
    for (const field of ['live','cap']) await scenario(`transfer retains ${field} capability denial`,async()=>{
      await db.exec(`set test.${field}='no'`);await denied(()=>move(),/Not authorized/);assert.equal(await bridgeCount(),0);
    });
    for (const [name,patch,pattern] of [
      ['quantity',p=>{p.movement.quantity=2},/quantity/],
      ['wrong serial',p=>{p.command_input.serialNumbers=['OTHER']},/serialNumbers/],
      ['wrong lot',p=>{p.movement.lot_id='OTHER'},/identity/],
      ['wrong source bin',p=>{p.from_bin_id='other-bin';p.movement.from_bin_id='other-bin';p.command_input.fromBinId='other-bin'},/exact source/],
    ]) await scenario(`original transfer ${name} denial remains atomic`,async()=>{const p=transferPayload();patch(p);await denied(()=>command('transfer',p),pattern);assert.equal(await bridgeCount(),0);});
    await scenario('late bridge write failure rolls back transfer movement history and receipt',async()=>{
      await db.exec('alter table private.stock_conversion_putaway_bridges add constraint synthetic_failure check(false)');
      await denied(()=>move(),/synthetic_failure/);assert.equal(await bridgeCount(),0);
      assert.equal((await db.query('select count(*)::int n from private.warehouse_unit_history')).rows[0].n,1);
    });
    await scenario('claim transition alone is accepted but intervening hold denies independent approval',async()=>{
      await move();await actor(owner);const r=await recipe();await actor(operator);const b=await create(r);
      await db.exec("insert into warehouse.inventory_holds(product_id,location_id,quantity,status) values('base','wh',1,'released')");
      await actor(quality);await denied(()=>command('execute_stock_conversion',{action:'approve',batch_id:b.id,inspected_serial_numbers:[unit.serial_number],evidence_urls:['https://evidence.test/quality']}),/exact-source/);
    });
    await scenario('intervening return after approval denies completion',async()=>{
      await move();await actor(owner);const r=await recipe();await actor(operator);const b=await create(r);
      await actor(quality);await command('execute_stock_conversion',{action:'approve',batch_id:b.id,inspected_serial_numbers:[unit.serial_number],evidence_urls:['https://evidence.test/quality']});
      await db.exec("insert into warehouse.returns(id,lines) values('new-return','[{\"serialNumber\":\"QC-PUTAWAY-001\"}]')");
      await actor(operator);await denied(()=>command('execute_stock_conversion',{action:'complete',batch_id:b.id,evidence_urls:['https://evidence.test/completion']}),/exact-source/);
    });
    await scenario('recovery never accepts receipt-to-putaway proof',async()=>{
      await move();
      const result=await db.query('select private.stock_conversion_qc_matches(u,q,null,false) accepted from warehouse.inventory_units u cross join warehouse.quality_inspections q');
      assert.equal(result.rows[0].accepted,false);
      await actor(owner);const r=await recipe();await actor(operator);const b=await create(r);
      await denied(()=>db.query("select private.stock_conversion_validate_unit(b,jsonb_populate_record(r,to_jsonb(r)||'{\"direction\":\"recovery\"}'::jsonb),b.units->0,true) from private.stock_conversion_batches b join private.stock_conversion_recipes r on r.id=b.recipe_id"),/exact-source/);
    });
    await scenario('existing exact-bin accepted QC remains unchanged',async()=>{
      await move();await db.exec("update warehouse.quality_inspections set bin_id='source'");
      assert.equal((await workspace()).candidates.length,1);
      await actor(owner);const r=await recipe();await actor(operator);assert.equal((await create(r)).status,'inspection');
    });
    await scenario('exact-return recovery still completes using separately prepared event return evidence',async()=>{
      await move();await actor(owner);const r=await recipe();await actor(operator);const b=await create(r);
      await actor(quality);await command('execute_stock_conversion',{action:'approve',batch_id:b.id,inspected_serial_numbers:[unit.serial_number],evidence_urls:['https://evidence.test/quality']});
      await actor(operator);await command('execute_stock_conversion',{action:'complete',batch_id:b.id,evidence_urls:['https://evidence.test/completion']});
      // Synthetic exact return lineage, not a claim that the return-intake UI ran.
      await db.exec("insert into warehouse.allocations values('returned','event','variant',1,'returned'); insert into private.event_custody_sources(allocation_id,event_id,order_id,product_id,quantity,serial_numbers) values('returned','event',gen_random_uuid(),'variant',1,array['QC-PUTAWAY-001'])");
      await db.exec("insert into warehouse.returns(id,source,event_id,lines) values('return-exact','event','event','[{\"allocationId\":\"returned\",\"productId\":\"variant\",\"serialNumber\":\"QC-PUTAWAY-001\",\"quantity\":1}]')");
      const returnQc=(await db.query("insert into warehouse.quality_inspections(source_type,source_id,product_id,serial_number,location_id,bin_id,quantity,disposition,evidence_urls,inspected_by) values('return','return-exact','variant','QC-PUTAWAY-001','wh','output',1,'accepted','[\"https://evidence.test/return\"]',$1) returning id",[quality])).rows[0].id;
      await actor(owner);const recovery=await command('execute_stock_conversion',{action:'approve_recipe',kit_definition_id:kit,event_id:'event',direction:'recovery',source_product_id:'variant',output_product_id:'base',packaging:[],approval_reference:'Synthetic recovery approval',evidence_urls:['https://evidence.test/recipe']});
      await actor(operator);const recovered=await command('execute_stock_conversion',{action:'create',recipe_id:recovery.id,event_id:'event',source_location_id:'wh',source_bin_id:'output',destination_location_id:'wh',destination_bin_id:'source',units:[{serial_number:unit.serial_number,inspection_id:returnQc,return_id:'return-exact',allocation_id:'returned',original_conversion_id:b.id}],evidence_urls:['https://evidence.test/recovery']});
      await actor(quality);await command('execute_stock_conversion',{action:'approve',batch_id:recovered.id,inspected_serial_numbers:[unit.serial_number],evidence_urls:['https://evidence.test/quality']});
      await actor(operator);await command('execute_stock_conversion',{action:'complete',batch_id:recovered.id,evidence_urls:['https://evidence.test/completion']});
      assert.deepEqual((await db.query('select id,serial_number,product_id,bin_id,status from warehouse.inventory_units')).rows[0],{id:unit.id,serial_number:unit.serial_number,product_id:'base',bin_id:'source',status:'in_stock'});
      assert.equal((await db.query('select count(*)::int n from private.stock_conversion_lines')).rows[0].n,2);
    });
    await scenario('bridge and origin are immutable, private and not directly executable',async()=>{
      await move();
      for(const table of ['stock_conversion_qc_origins','stock_conversion_qc_breaks','stock_conversion_putaway_bridges']){
        for(const role of ['anon','authenticated','service_role']){
          const grants=(await db.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') allowed",[role,`private.${table}`])).rows[0];assert.equal(grants.allowed,false);
        }
        if(table!=='stock_conversion_qc_breaks')await denied(()=>db.exec(`delete from private.${table}`),/cannot be deleted/);
        await denied(()=>db.exec(`truncate private.${table} cascade`),/cannot be deleted/);
      }
      assert.equal((await db.query("select count(*)::int n from pg_proc where pronamespace='private'::regnamespace and proname in ('stock_conversion_record_qc_origin','stock_conversion_watch_qc_origin','stock_conversion_capture_putaway','stock_conversion_qc_matches','stock_conversion_qc_origin_clean','stock_conversion_hold_scope') and (has_function_privilege('authenticated',oid,'EXECUTE') or has_function_privilege('anon',oid,'EXECUTE') or has_function_privilege('service_role',oid,'EXECUTE'))")).rows[0].n,0);
      for(const role of ['anon','authenticated','service_role']){
        await denied(async()=>{await db.exec(`set role ${role}`);await db.exec('delete from private.stock_conversion_putaway_bridges');},{code:'42501'});
        await denied(async()=>{await db.exec(`set role ${role}`);await db.exec('select private.stock_conversion_capture_putaway()');},{code:'42501'});
      }
    });
  } finally { await db.close(); }
});

test('actor correction is prospective, body-only, pinned and preserves OID ACL and every other guard',async t=>{
  const db=await database();
  const sql=await migration(actorFixName);
  const signature='private.stock_conversion_capture_putaway()';
  const state=async()=> (await db.query("select prosrc body,to_jsonb(p)-'prosrc' metadata from pg_proc p where oid=$1::regprocedure",[signature])).rows[0];
  try{
    await db.exec(await migration(fixName));
    const before=await state();
    const statements=scanSql(sql);
    assert.deepEqual(statements.map(statement=>statement.match(/^\w+/)[0].toLowerCase()),['begin','select','select','do','commit']);
    assert.match(sql,/6b06c2077da5a460353f45e686d96377/);
    await t.test('exact predecessor only, with atomic rejection',async()=>{
      const definition=(await db.query('select pg_get_functiondef($1::regprocedure) body',[signature])).rows[0].body;
      await db.exec(definition.replace(/AS (\$\w*\$)/,'$&\n-- synthetic actor predecessor drift'));
      const drifted=await state();
      await assert.rejects(db.exec(sql),/actor predecessor drift/);
      await db.exec('rollback');
      assert.deepEqual(await state(),drifted);
      await db.exec(definition);
    });
    await t.test('one comparison changes, metadata and historical rows do not',async()=>{
      const rows=async()=> (await db.query("select jsonb_build_object('origins',(select jsonb_agg(o) from private.stock_conversion_qc_origins o),'bridges',(select jsonb_agg(b) from private.stock_conversion_putaway_bridges b),'breaks',(select jsonb_agg(b) from private.stock_conversion_qc_breaks b)) data")).rows[0].data;
      // Isolated pre-existing provenance models the blocked old putaway; no migration backfill is allowed.
      await db.exec("insert into private.stock_conversion_qc_origins(inspection_id,unit_id,registration_id,unit_state,inspection_state,receipt_state,lot_state,hold_state) values(gen_random_uuid(),'historical-unbridged',1,'{}','{}','{}','{}','{}')");
      const oldRows=await rows();
      await db.exec(sql);
      const after=await state();
      assert.deepEqual(after.metadata,before.metadata);
      assert.equal(after.body,before.body.replace('m.actor is distinct from new.actor_id','m.actor is distinct from warehouse.authoritative_actor()'));
      assert.deepEqual(await rows(),oldRows);
      assert.equal((await db.query("select count(*)::int n from pg_proc where oid=$1::regprocedure and (has_function_privilege('anon',oid,'execute') or has_function_privilege('authenticated',oid,'execute') or has_function_privilege('service_role',oid,'execute'))",[signature])).rows[0].n,0);
      await assert.rejects(db.exec(sql),/actor predecessor drift/);
      await db.exec('rollback');
      assert.deepEqual(await state(),after,'already corrected body is not silently reprocessed');
    });
  }finally{await db.close();}
});

test('QC bridge migration fails closed on each authority/coordinate predecessor drift',async t=>{
  if(process.env.QA_QC_BRIDGE_BASELINE==='1')return;
  const db=await database();
  try{
    for(const signature of ['private.warehouse_transfer_pre_lot_putaway(jsonb)','private.external_po_inspect(jsonb)','private.warehouse_record_unit_history()','private.stock_conversion_validate_unit(private.stock_conversion_batches,private.stock_conversion_recipes,jsonb,boolean)','warehouse.stock_conversion_workspace(jsonb)']){
      await t.test(signature,async()=>{
        const definition=(await db.query('select pg_get_functiondef($1::regprocedure) body',[signature])).rows[0].body;
        const changed=definition.replace(/AS (\$\w*\$)/,'$&\n-- synthetic predecessor drift');assert.notEqual(changed,definition);
        await db.exec(changed);
        await assert.rejects(db.exec(await migration(fixName)),/predecessor drift/);
        await db.exec('rollback');
        assert.equal((await db.query("select to_regclass('private.stock_conversion_qc_origins') relation")).rows[0].relation,null,'failed migration leaves no bridge tables');
        await db.exec(definition);
      });
    }
  }finally{await db.close();}
});

test('watcher dispatch retains all original match sets and uses private lookup indexes',async t=>{
  if(process.env.QA_QC_BRIDGE_BASELINE==='1')return;
  const db=new PGlite();
  const source=await migration(fixName);
  try{
    await db.exec("create schema private;create schema warehouse;create schema auth;create role anon;create role authenticated;create role service_role;create function auth.uid() returns uuid language sql as $$select null::uuid$$");
    await db.exec(extract(await migration('20260920025920_approved_stock_origin_conversion.sql'),'private.stock_conversion_preserve_history'));
    await db.exec(source.slice(source.indexOf('create table private.stock_conversion_qc_origins'),source.indexOf('create function private.stock_conversion_hold_scope')));
    await db.exec(extract(source,'private.stock_conversion_hold_scope'));
    await db.exec(extract(source,'private.stock_conversion_watch_qc_origin'));
    const tables=['inventory_holds','quality_inspections','returns','receipts','lots','movements','warehouse_unit_history','warehouse_offline_receipts'];
    for(const table of tables){
      const schema=table.startsWith('warehouse_')?'private':'warehouse';
      await db.exec(`create table ${schema}.${table}(id text,unit_id text,product_id text,location_id text,bin_id text,lot_id text,serial_number text,lines jsonb,actor_id text,method text,intent_key text,quality_status text,reason text);
        create trigger watcher after insert or update or delete on ${schema}.${table} for each row execute function private.stock_conversion_watch_qc_origin();
        create trigger watcher_truncate before truncate on ${schema}.${table} for each statement execute function private.stock_conversion_watch_qc_origin()`);
    }
    await db.exec(`insert into private.stock_conversion_qc_origins(inspection_id,unit_id,registration_id,unit_state,inspection_state,receipt_state,lot_state,hold_state)
      select md5('qc'||g)::uuid,'U'||g,g,jsonb_build_object('id','U'||g,'serial_number','S'||g,'product_id',case when g<=6 then 'P' else 'OTHER' end,'location_id','WH','bin_id',null,'lot_id','L'||g),'{}',jsonb_build_object('id','R'||g),'{}','{}' from generate_series(1,12) g;
      insert into private.stock_conversion_putaway_bridges(unit_id,inspection_id,history_id,movement_id,unit_state,movement_state,actor_id,intent_key,command_input)
      select 'U'||g,md5('qc'||g)::uuid,g,'M'||g,jsonb_build_object('id','U'||g,'serial_number','S'||g,'product_id',case when g<=6 then 'P' else 'OTHER' end,'location_id','WH','bin_id',case when g%2=0 then 'EVEN' else 'ODD' end,'lot_id','L'||g),'{}','A','K'||g,'{}' from generate_series(1,10) g`);
    // Frozen pre-performance SQL is the semantic oracle, not the new dispatch.
    const expected=`select origin.inspection_id from private.stock_conversion_qc_origins origin left join private.stock_conversion_putaway_bridges bridge on bridge.inspection_id=origin.inspection_id where case $1::text
      when 'inventory_holds' then private.stock_conversion_hold_scope($2::jsonb,origin.unit_state) or private.stock_conversion_hold_scope($2::jsonb,bridge.unit_state)
      when 'quality_inspections' then $2::jsonb->>'serial_number'=origin.unit_state->>'serial_number' or $2::jsonb->>'id'=origin.inspection_id::text
      when 'returns' then exists(select 1 from jsonb_array_elements($2::jsonb->'lines') line where line->>'serialNumber'=origin.unit_state->>'serial_number' or line->'serialNumbers' ? (origin.unit_state->>'serial_number'))
      when 'receipts' then $2::jsonb->>'id'=origin.receipt_state->>'id'
      when 'lots' then $2::jsonb->>'id'=origin.unit_state->>'lot_id'
      when 'movements' then $2::jsonb->>'id'=bridge.movement_id or (bridge.unit_id is not null and $2::jsonb->>'serial_number'=origin.unit_state->>'serial_number')
      when 'warehouse_unit_history' then $2::jsonb->>'unit_id'=origin.unit_id
      when 'warehouse_offline_receipts' then $2::jsonb->>'actor_id'=bridge.actor_id and $2::jsonb->>'method'='transfer' and $2::jsonb->>'intent_key'=bridge.intent_key else false end`;
    const qcId=(await db.query("select md5('qc1')::uuid id")).rows[0].id;
    const cases=[
      ['inventory_holds','exact',{id:'h',product_id:'P',serial_number:'S1'}],
      ['inventory_holds','wrong product',{id:'h',product_id:'OTHER',serial_number:'S1'}],
      ['inventory_holds','scoped all bins',{id:'h',product_id:'P',location_id:'WH'}],
      ['inventory_holds','scoped exact destination',{id:'h',product_id:'P',location_id:'WH',bin_id:'EVEN'}],
      ['inventory_holds','scoped exact lot',{id:'h',product_id:'P',location_id:'WH',lot_id:'L3'}],
      ['inventory_holds','wrong location',{id:'h',product_id:'P',location_id:'ELSEWHERE'}],
      ['inventory_holds','missing serial',{id:'h',product_id:'P',serial_number:'MISSING'}],
      ['quality_inspections','id',{id:qcId}],
      ['quality_inspections','serial',{id:null,serial_number:'S2'}],
      ['quality_inspections','id plus serial union',{id:qcId,serial_number:'S2'}],
      ['quality_inspections','no match',{id:null,serial_number:'MISSING'}],
      ['returns','scalar serial',{id:'ret',lines:[{serialNumber:'S1'}]}],
      ['returns','array serials',{id:'ret',lines:[{serialNumbers:['S1','S2','S2',12,null]}]}],
      ['returns','object keys',{id:'ret',lines:[{serialNumbers:{S3:false,S4:1}}]}],
      ['returns','string value',{id:'ret',lines:[{serialNumbers:'S5'}]}],
      ['returns','primitive non-strings',{id:'ret',lines:[{serialNumbers:12},{serialNumbers:false},{serialNumbers:null}]}],
      ['returns','mixed and duplicates',{id:'ret',lines:[{serialNumber:'S1',serialNumbers:['S1','S2']},{serialNumber:'S3'}]}],
      ['returns','empty',{id:'ret',lines:[]}],
      ['receipts','id',{id:'R2'}],
      ['lots','id',{id:'L2'}],
      ['movements','id with null serial',{id:'M1'}],
      ['movements','serial',{id:'NEW',serial_number:'S2'}],
      ['movements','id plus serial union',{id:'M1',serial_number:'S2'}],
      ['movements','serial without bridge',{id:'NEW',serial_number:'S12'}],
      ['warehouse_unit_history','unit',{id:'hist',unit_id:'U3'}],
      ['warehouse_unit_history','no match',{id:'hist',unit_id:'MISSING'}],
      ['warehouse_offline_receipts','exact',{id:'offline',actor_id:'A',method:'transfer',intent_key:'K3'}],
      ['warehouse_offline_receipts','wrong method',{id:'offline',actor_id:'A',method:'issue',intent_key:'K3'}],
      ['warehouse_offline_receipts','wrong actor',{id:'offline',actor_id:'OTHER',method:'transfer',intent_key:'K3'}],
    ];
    for(const [table,label,row] of cases)await t.test(`${table}: ${label}`,async()=>{
      const schema=table.startsWith('warehouse_')?'private':'warehouse';
      const expectedIds=(await db.query(expected,[table,JSON.stringify(row)])).rows.map(r=>r.inspection_id).sort();
      await db.exec('begin');
      try{
        await db.query(`insert into ${schema}.${table} select (jsonb_populate_record(null::${schema}.${table},$1::jsonb)).*`,[JSON.stringify(row)]);
        assert.deepEqual((await db.query('select inspection_id from private.stock_conversion_qc_breaks order by inspection_id')).rows.map(r=>r.inspection_id),expectedIds);
      }finally{await db.exec('rollback');}
    });
    for(const table of tables)await t.test(`${table}: old/new update, delete and truncate preserve invalidation`,async()=>{
      const schema=table.startsWith('warehouse_')?'private':'warehouse';
      const before=cases.find(c=>c[0]===table)[2];
      const after={...before,id:table==='quality_inspections'?null:'changed',reason:'changed',serial_number:'S6',unit_id:'U6',intent_key:'K6',lines:[{serialNumber:'S6'}]};
      const oldIds=(await db.query(expected,[table,JSON.stringify(before)])).rows.map(r=>r.inspection_id);
      const newIds=(await db.query(expected,[table,JSON.stringify(after)])).rows.map(r=>r.inspection_id);
      await db.exec('begin');
      try{
        // Fixture insertion only; the operation being asserted always has triggers enabled.
        await db.exec(`alter table ${schema}.${table} disable trigger watcher`);
        await db.query(`insert into ${schema}.${table} select (jsonb_populate_record(null::${schema}.${table},$1::jsonb)).*`,[JSON.stringify(before)]);
        await db.exec(`alter table ${schema}.${table} enable trigger watcher`);
        await db.query(`update ${schema}.${table} set (id,reason,serial_number,unit_id,intent_key,lines)=(select id,reason,serial_number,unit_id,intent_key,lines from jsonb_populate_record(null::${schema}.${table},$1::jsonb))`,[JSON.stringify(after)]);
        assert.deepEqual((await db.query('select inspection_id from private.stock_conversion_qc_breaks order by inspection_id')).rows.map(r=>r.inspection_id),[...new Set([...oldIds,...newIds])].sort());
        await db.exec(`delete from ${schema}.${table}`);
        assert.deepEqual((await db.query('select inspection_id from private.stock_conversion_qc_breaks order by inspection_id')).rows.map(r=>r.inspection_id),[...new Set([...oldIds,...newIds])].sort());
        await db.exec(`truncate ${schema}.${table}`);
        assert.equal((await db.query('select count(*)::int n from private.stock_conversion_qc_breaks')).rows[0].n,12);
      }finally{await db.exec('rollback');}
    });
    await t.test('lookup indexes cover every non-primary-key observer identity',async()=>{
      const names=(await db.query("select indexname from pg_indexes where schemaname='private'")).rows.map(r=>r.indexname);
      for(const name of ['stock_conversion_origin_serial_lookup','stock_conversion_origin_scope_lookup','stock_conversion_origin_receipt_lookup','stock_conversion_origin_lot_lookup','stock_conversion_bridge_serial_lookup','stock_conversion_bridge_scope_lookup','stock_conversion_bridge_intent_lookup'])assert.ok(names.includes(name),name);
    });
  }finally{await db.close();}
});
