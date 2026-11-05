import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';

// Execute the production repository and mapper, including extensionless TS imports.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL) {
      const candidate = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(candidate)) return next(candidate.href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.ts')) return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText };
    return next(url, context);
  },
});
const { SupabaseRepository } = await import('../packages/data-kit/src/supabase/SupabaseRepository.ts');

const migrations = new URL('../supabase/migrations/', import.meta.url);
const sql = name => readFile(new URL(name, migrations), 'utf8');
const actor = '00000000-0000-0000-0000-000000000001';

test('serialized transfer enforces the actual SQL command boundary', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema warehouse; create schema private; create schema core; create schema auth;
      grant usage on schema warehouse to authenticated;
      create function auth.role() returns text language sql as $$ select 'authenticated'::text $$;
      create function auth.uid() returns uuid language sql as $$ select '${actor}'::uuid $$;
      create function core.has_cap(text,text) returns boolean language sql as $$ select current_setting('test.cap',true)='yes' $$;
      create function core.has_live_cap(text,text) returns boolean language sql as $$ select current_setting('test.live',true)='yes' $$;
      create function warehouse.authoritative_actor() returns text language sql as $$ select auth.uid()::text $$;
      create function warehouse.force_actor_on_object(jsonb,text) returns jsonb language sql as $$ select $1 || jsonb_build_object('actor',$2) $$;
      create function private.lock_warehouse_products(text[]) returns void language plpgsql as $$ begin perform pg_advisory_xact_lock(1); end $$;
      create table warehouse.products(id text primary key, serialized boolean);
      create table warehouse.locations(id text primary key,type text);
      create table warehouse.storage_areas(id text primary key,location_id text,active boolean);
      create table warehouse.stock_levels(id bigint generated always as identity,product_id text,location_id text,bin_id text,lot_id text,quantity integer check(quantity>=0));
      create unique index stock_uq on warehouse.stock_levels(product_id,location_id,bin_id,lot_id) nulls not distinct;
      create table warehouse.inventory_units(id text primary key,product_id text,location_id text,bin_id text,lot_id text,status text,serial_number text);
      create table warehouse.inventory_holds(product_id text,location_id text,bin_id text,lot_id text,serial_number text,status text,quantity integer);
      create table warehouse.movements(id text primary key,type text,product_id text,quantity integer,from_location_id text,to_location_id text,lot_id text,serial_number text,event_id text,reason text,reference text,evidence_urls jsonb,actor text,created_at timestamptz,from_bin_id text,to_bin_id text);
      create function warehouse.issue(jsonb) returns jsonb language sql as $$ select $1 $$;
      insert into warehouse.products values ('serial',true),('other-serial',true),('bulk',false);
      insert into warehouse.locations values ('wh','warehouse'),('other','warehouse');
      insert into warehouse.storage_areas values ('source','wh',true),('dest','other',true),('putaway','wh',true);
      create sequence private.write_attempts;
      create function private.count_write() returns trigger language plpgsql as $$ begin perform nextval('private.write_attempts'); return new; end $$;
      create trigger count_units before update on warehouse.inventory_units for each row execute function private.count_write();
      create trigger count_stock before insert or update on warehouse.stock_levels for each row execute function private.count_write();
      create trigger count_movements before insert on warehouse.movements for each row execute function private.count_write();
    `);
    await db.exec(await sql('20260810155237_block_transfer_of_held_inventory.sql'));
    const authority = await sql('20260813203240_task_1_database_authority_remediation.sql');
    const wrapper = authority.match(/create or replace function warehouse\.transfer\(payload jsonb\)[\s\S]*?\$\$;/i)?.[0];
    assert.ok(wrapper, 'load the actual live-capability wrapper');
    await db.exec(wrapper);
    await db.exec(await sql('20260905094000_offline_replay_identity.sql'));
    await db.exec(await sql('20261019180843_lot_aware_atomic_putaway.sql'));
    const wrappers = () => db.query("select oid::text,pg_get_functiondef(oid) body,proacl::text from pg_proc where oid in ('warehouse.transfer(jsonb)'::regprocedure,'warehouse.transfer_pre_offline_identity(jsonb)'::regprocedure,'private.warehouse_offline_action(text,jsonb)'::regprocedure,'private.warehouse_transfer(jsonb)'::regprocedure) order by oid");
    const wrappersBefore = (await wrappers()).rows;
    const fix = (await readdir(migrations)).find(name => name.endsWith('_serialized_transfer_quantity_identity.sql'));
    if (process.env.QA_TRANSFER_BASELINE !== '1') {
      assert.ok(fix, 'serialized transfer remediation migration exists');
      await db.exec(await sql(fix));
    }
    const reset = async () => {
      await db.exec(`
        truncate warehouse.inventory_units,warehouse.inventory_holds,warehouse.stock_levels,warehouse.movements,private.warehouse_offline_receipts;
        set test.cap='yes'; set test.live='yes';
        insert into warehouse.inventory_units values ('u1','serial','wh','source','lot-s','in_stock','SN1'),('u2','serial','wh','source','lot-s','in_stock','SN2'),('u3','other-serial','wh','source',null,'in_stock','SN3');
        insert into warehouse.stock_levels(product_id,location_id,bin_id,lot_id,quantity) values ('bulk','wh','source','lot-a',3),('bulk','wh','source','lot-b',2);
        alter sequence private.write_attempts restart with 1;
      `);
    };
    const input = () => ({
      idempotency_key: 'serialized-transfer-test-001',
      command_input: { productId: 'serial', quantity: 1, fromLocationId: 'wh', fromBinId: 'source', toLocationId: 'other', toBinId: 'dest', serialNumbers: ['SN1'] },
      unit_ids: ['u1'], from_location_id: 'wh', to_location_id: 'other', to_bin_id: 'dest', from_stock_delta: null, to_stock_delta: null,
      movement: { id: 'mv-test', type: 'transfer', product_id: 'serial', quantity: 1, from_location_id: 'wh', to_location_id: 'other', from_bin_id: 'source', to_bin_id: 'dest', actor: 'spoofed' },
    });
    const move = async payload => {
      await db.exec('set role authenticated');
      try { return (await db.query('select warehouse.transfer($1::jsonb) result', [JSON.stringify(payload)])).rows[0].result; }
      finally { await db.exec('reset role'); }
    };
    const repository = () => {
      const repo = new SupabaseRepository({});
      repo.getStockState = async () => ({products:[{id:'serial',serialized:true},{id:'bulk',serialized:false}],units:[{id:'u1',productId:'serial',serialNumber:'SN1',locationId:'wh',binId:'source',lotId:'lot-s',status:'in_stock'}],stockLevels:[{productId:'bulk',locationId:'wh',binId:'source',lotId:'lot-a',quantity:3}],allocations:[],holds:[],inventoryPositions:[]});
      repo.callRpc = async (name, payload) => { assert.equal(name,'transfer'); return move(payload); };
      return repo;
    };
    const state = async () => (await db.query(`select jsonb_build_object(
      'units',(select jsonb_agg(to_jsonb(u) order by id) from warehouse.inventory_units u),
      'stock',(select jsonb_agg(to_jsonb(s) order by id) from warehouse.stock_levels s),
      'holds',(select jsonb_agg(to_jsonb(h) order by product_id,serial_number) from warehouse.inventory_holds h),
      'movements',(select jsonb_agg(to_jsonb(m) order by id) from warehouse.movements m),
      'receipts',(select jsonb_agg(to_jsonb(r) order by intent_key) from private.warehouse_offline_receipts r)
    ) state`)).rows[0].state;
    const rejectUnchanged = async (payload, pattern = /Serialized transfer|Transfer movement/) => {
      const before = await state();
      await assert.rejects(move(payload), pattern);
      assert.deepEqual(await state(), before, 'no business or receipt residue');
      assert.equal((await db.query('select is_called from private.write_attempts')).rows[0].is_called, false, 'reject before any business write, not just rollback');
    };

    for (const quantity of [2, 0, -1, 0.5, 1.5, '1', null, undefined]) {
      await t.test(`reject movement quantity ${String(quantity)} before writes`, async () => {
        await reset(); const p = input(); p.movement.quantity = quantity;
        if (quantity === 2) p.command_input.quantity = 2;
        await rejectUnchanged(p);
      });
    }
    for (const [name, patch] of [
      ['extra units', p => { p.unit_ids.push('u2'); }],
      ['duplicate units', p => { p.unit_ids.push('u1'); p.movement.quantity = 2; }],
      ['missing unit', p => { p.unit_ids = ['missing']; }],
      ['no units', p => { p.unit_ids = []; }],
      ['omitted units', p => { delete p.unit_ids; }],
      ['mixed products', p => { p.unit_ids = ['u1','u3']; p.movement.quantity = 2; p.command_input.quantity = 2; p.command_input.serialNumbers = ['SN1','SN3']; }],
      ['wrong movement product', p => { p.movement.product_id = 'other-serial'; }],
      ['wrong movement type', p => { p.movement.type = 'issue'; }],
      ['wrong movement source', p => { p.movement.from_location_id = 'other'; }],
      ['wrong movement destination', p => { p.movement.to_location_id = 'wh'; }],
      ['wrong movement destination bin', p => { p.movement.to_bin_id = 'putaway'; }],
      ['conflicting source bin', p => { p.from_bin_id = 'different'; }],
      ['mixed bulk deltas', p => { p.from_stock_delta = {product_id:'bulk',location_id:'wh',bin_id:'source',lot_id:'lot-a',delta:-1}; p.to_stock_delta = {...p.from_stock_delta,location_id:'other',bin_id:'dest',delta:1}; }],
      ['wrong command quantity', p => { p.command_input.quantity = 2; }],
      ['fractional command quantity', p => { p.command_input.quantity = 1.5; }],
      ['wrong command product', p => { p.command_input.productId = 'other-serial'; }],
      ['wrong command source', p => { p.command_input.fromLocationId = 'other'; }],
      ['wrong command source bin', p => { p.command_input.fromBinId = 'different'; }],
      ['wrong command destination', p => { p.command_input.toLocationId = 'wh'; }],
      ['wrong command destination bin', p => { p.command_input.toBinId = 'putaway'; }],
      ['wrong command serial', p => { p.command_input.serialNumbers = ['SN2']; }],
      ['extra command serial', p => { p.command_input.serialNumbers = ['SN1','SN2']; }],
      ['duplicate command serial', p => { p.command_input.serialNumbers = ['SN1','SN1']; }],
      ['wrong relocation warehouse', p => { p.command_input.locationId = 'wh'; }],
      ['wrong movement lot', p => { p.movement.lot_id = 'other-lot'; }],
      ['wrong movement serial', p => { p.movement.serial_number = 'SN2'; }],
    ]) {
      await t.test(`reject ${name} before writes`, async () => {
        await reset(); const p = input(); patch(p); await rejectUnchanged(p, /Serialized transfer|Transfer movement|Some serialized units|No serialized inventory/);
      });
    }
    await t.test('valid exact units succeed once; retry retains authoritative actor and receipt', async () => {
      await reset(); const p = input(); const first = await move(p);
      assert.equal(first.quantity, 1); assert.equal(first.actor, actor);
      const after = await state(); assert.equal(after.units.find(u => u.id === 'u1').bin_id, 'dest');
      assert.deepEqual(await move(p), first); assert.deepEqual(await state(), after);
      await assert.rejects(move({...p,command_input:{...p.command_input,quantity:2}}), /different payload/);
      await db.exec("set test.live='no'"); await assert.rejects(move(p), /Not authorized/);
      assert.deepEqual(await state(), after);
    });
    await t.test('valid two-unit serial set is order independent', async () => {
      await reset(); const p = input(); p.unit_ids = ['u2','u1']; p.movement.quantity = 2; p.command_input.quantity = 2; p.command_input.serialNumbers = ['SN1','SN2'];
      assert.equal((await move(p)).quantity, 2);
    });
    await t.test('legacy without command input and optional serial list remains valid', async () => {
      await reset(); const p = input(); delete p.idempotency_key; delete p.command_input;
      assert.equal((await move(p)).quantity, 1);
      await reset(); const q = input(); delete q.command_input.serialNumbers;
      assert.equal((await move(q)).quantity, 1);
    });
    await t.test('actual repository serialized transfer payload succeeds and replays', async () => {
      await reset(); const repo=repository(); const command={productId:'serial',fromLocationId:'wh',fromBinId:'source',toLocationId:'other',toBinId:'dest',quantity:1,serialNumbers:['SN1'],actor:'spoofed',idempotencyKey:'repository-transfer-001'};
      const result=await repo.transfer(command); assert.equal(result[0].quantity,1); assert.equal(result[0].actor,actor);
      assert.deepEqual(await repo.transfer(command),result);
    });
    await t.test('actual repository serialized relocation payload succeeds and replays', async () => {
      await reset(); const repo=repository(); const command={productId:'serial',locationId:'wh',fromBinId:'source',toBinId:'putaway',quantity:1,serialNumbers:['SN1'],actor:'spoofed',idempotencyKey:'repository-relocate-001'};
      const result=await repo.relocate(command); assert.equal(result[0].quantity,1); assert.equal(result[0].toBinId,'putaway');
      assert.deepEqual(await repo.relocate(command),result);
    });
    await t.test('repository empty serial list retains legacy automatic exact-unit selection',async()=>{
      await reset(); const result=await repository().relocate({productId:'serial',locationId:'wh',fromBinId:'source',toBinId:'putaway',quantity:1,serialNumbers:[],actor:'test'});
      assert.equal(result[0].quantity,1);
    });
    for (const [name, patch] of [
      ['quantity mismatch',p=>{p.movement.quantity=1;}],
      ['wrong product',p=>{p.movement.product_id='other-serial';}],
      ['wrong source',p=>{p.movement.from_location_id='other';}],
      ['wrong destination',p=>{p.movement.to_location_id='wh';}],
      ['wrong source bin',p=>{p.movement.from_bin_id='putaway';}],
      ['wrong destination bin',p=>{p.movement.to_bin_id='source';}],
      ['wrong movement type',p=>{p.movement.type='issue';}],
      ['wrong lot',p=>{p.movement.lot_id='lot-b';}],
      ['fractional delta',p=>{p.from_stock_delta.delta=-1.5;}],
      ['zero delta',p=>{p.from_stock_delta.delta=0;}],
      ['positive source delta',p=>{p.from_stock_delta.delta=2;}],
      ['negative destination delta',p=>{p.to_stock_delta.delta=-2;}],
      ['different destination quantity',p=>{p.to_stock_delta.delta=1;}],
      ['missing deltas',p=>{delete p.from_stock_delta;delete p.to_stock_delta;}],
    ]) {
      await t.test(`bulk rejects ${name} before writes`,async()=>{
        await reset(); const p={from_stock_delta:{product_id:'bulk',location_id:'wh',bin_id:'source',lot_id:'lot-a',delta:-2},to_stock_delta:{product_id:'bulk',location_id:'other',bin_id:'dest',lot_id:'lot-a',delta:2},movement:{id:'bulk-mv',type:'transfer',product_id:'bulk',quantity:2,from_location_id:'wh',to_location_id:'other',from_bin_id:'source',to_bin_id:'dest',lot_id:'lot-a'}};
        patch(p); await rejectUnchanged(p,/Transfer|Serialized transfer/);
      });
    }
    await t.test('actual repository bulk transfer infers a single lot and accepts mapper nulls',async()=>{
      await reset(); await db.exec("delete from warehouse.stock_levels where lot_id='lot-b'");
      const result=await repository().transfer({productId:'bulk',fromLocationId:'wh',fromBinId:'source',toLocationId:'other',toBinId:'dest',quantity:2,actor:'test'});
      assert.equal(result[0].quantity,2);
    });
    await t.test('source, status and exact active hold checks are retained', async () => {
      for (const change of ["update warehouse.inventory_units set bin_id='other-bin' where id='u1'", "update warehouse.inventory_units set status='issued' where id='u1'", "insert into warehouse.inventory_holds values ('serial','wh','source','lot-s','SN1','active',1)"]) {
        await reset(); await db.exec(change); await db.exec('alter sequence private.write_attempts restart with 1');
        await rejectUnchanged(input(), /exact source|Held serialized/);
      }
    });
    await t.test('live and base capability failures cannot write', async () => {
      for (const cap of ['live','cap']) { await reset(); await db.exec(`set test.${cap}='no'`); await rejectUnchanged(input(), /Not authorized/); }
    });
    await t.test('bulk legacy lot transfer remains unchanged', async () => {
      await reset(); const p = {from_stock_delta:{product_id:'bulk',location_id:'wh',bin_id:'source',lot_id:'lot-a',delta:-2},to_stock_delta:{product_id:'bulk',location_id:'other',bin_id:'dest',lot_id:'lot-a',delta:2},movement:{id:'bulk-mv',type:'transfer',product_id:'bulk',quantity:2,from_location_id:'wh',to_location_id:'other',from_bin_id:'source',to_bin_id:'dest',lot_id:'lot-a'}};
      assert.equal((await move(p)).quantity,2);
      const after=await state(); assert.equal(after.stock.find(s=>s.location_id==='other').quantity,2); assert.equal(after.stock.find(s=>s.location_id==='wh'&&s.lot_id==='lot-a').quantity,1);
    });
    await t.test('bulk multi-lot relocation retains holds, atomicity and replay', async () => {
      await reset(); await db.exec("insert into warehouse.inventory_holds values ('bulk','wh','source','lot-a',null,'active',1)");
      const p={bulk_relocation:true,idempotency_key:'bulk-relocation-test-001',command_input:{productId:'bulk',locationId:'wh',fromBinId:'source',toBinId:'putaway',quantity:4}};
      const first=await move(p); assert.deepEqual(first.movements.map(m=>[m.lot_id,m.quantity]),[['lot-a',2],['lot-b',2]]);
      const after=await state(); assert.deepEqual(await move(p),first); assert.deepEqual(await state(),after);
      await assert.rejects(move({...p,idempotency_key:'bulk-relocation-test-002',command_input:{...p.command_input,quantity:1}}),/Only 0/);
      assert.deepEqual(await state(),after);
    });
    await t.test('late insert failure rolls back units and offline receipt', async () => {
      await reset(); const before=await state(); await db.exec("alter table warehouse.movements add constraint reject_test check(id<>'mv-test')");
      await assert.rejects(move(input()),/reject_test/); assert.deepEqual(await state(),before);
      await db.exec('alter table warehouse.movements drop constraint reject_test');
    });
    await t.test('private helper ACL and public wrapper definitions remain unchanged', async () => {
      assert.deepEqual((await wrappers()).rows,wrappersBefore,'wrapper OIDs, bodies and ACLs must be unchanged');
      for (const name of ['private.warehouse_transfer(jsonb)','private.warehouse_transfer_pre_lot_putaway(jsonb)']) {
        assert.deepEqual((await db.query("select has_function_privilege('authenticated',$1,'execute') auth,has_function_privilege('anon',$1,'execute') anon,prosecdef,proconfig from pg_proc where oid=$1::regprocedure",[name])).rows,[{auth:false,anon:false,prosecdef:true,proconfig:['search_path=""']}]);
      }
      const publicDefinition=(await db.query("select pg_get_functiondef('warehouse.transfer(jsonb)'::regprocedure) body")).rows[0].body;
      assert.match(publicDefinition,/warehouse_offline_action\('transfer'/);
    });
    if (process.env.QA_TRANSFER_BASELINE !== '1') await t.test('predecessor drift guard refuses to overwrite a different function body',async()=>{
      const definition=async()=>(await db.query("select pg_get_functiondef('private.warehouse_transfer_pre_lot_putaway(jsonb)'::regprocedure) body")).rows[0].body;
      const before=await definition();
      await assert.rejects(db.exec(await sql(fix)),/Transfer predecessor definition drifted/);
      await db.exec('rollback');
      assert.equal(await definition(),before);
    });
  } finally { await db.close(); }
});
