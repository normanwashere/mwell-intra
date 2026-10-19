import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');

test('atomic lot-aware putaway retains hold authority and offline replay', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema warehouse; create schema private; create schema core; create schema auth;
      create function auth.role() returns text language sql as $$ select 'authenticated'::text $$;
      create function auth.uid() returns uuid language sql as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
      create function core.has_cap(text,text) returns boolean language sql as $$ select current_setting('test.allowed',true)='yes' $$;
      create function core.has_live_cap(text,text) returns boolean language sql as $$ select core.has_cap($1,$2) $$;
      create function warehouse.authoritative_actor() returns text language sql as $$ select auth.uid()::text $$;
      create function warehouse.force_actor_on_object(jsonb,text) returns jsonb language sql as $$ select $1 || jsonb_build_object('actor',$2) $$;
      create function private.lock_warehouse_products(text[]) returns void language plpgsql as $$ begin perform pg_advisory_xact_lock(1); end $$;
      create table warehouse.products(id text primary key, serialized boolean);
      create table warehouse.locations(id text primary key,type text);
      create table warehouse.storage_areas(id text primary key,location_id text,active boolean);
      create table warehouse.stock_levels(id bigint generated always as identity,product_id text,location_id text,bin_id text,lot_id text,quantity integer check(quantity>=0));
      create unique index stock_uq on warehouse.stock_levels(product_id,location_id,bin_id,lot_id) nulls not distinct;
      create table warehouse.inventory_units(id text,product_id text,location_id text,bin_id text,lot_id text,status text,serial_number text);
      create table warehouse.inventory_holds(product_id text,location_id text,bin_id text,lot_id text,serial_number text,status text,quantity integer);
      create table warehouse.movements(id text primary key,type text,product_id text,quantity integer,from_location_id text,to_location_id text,lot_id text,serial_number text,event_id text,reason text,reference text,evidence_urls jsonb,actor text,created_at timestamptz,from_bin_id text,to_bin_id text);
      create function warehouse.issue(jsonb) returns jsonb language sql as $$ select $1 $$;
      insert into warehouse.products values ('bulk',false),('serial',true);
      insert into warehouse.locations values ('wh','warehouse'),('other','warehouse');
      insert into warehouse.storage_areas values ('dest','wh',true),('source','wh',true),('wrong','other',true),('inactive','wh',false);
      set test.allowed='yes';
    `);
    await db.exec(await migration('20260810155237_block_transfer_of_held_inventory.sql'));
    await db.exec(await migration('20260905094000_offline_replay_identity.sql'));
    await db.exec(await migration('20261019180843_lot_aware_atomic_putaway.sql'));
    const reset = () => db.exec(`truncate warehouse.stock_levels,warehouse.inventory_holds,warehouse.movements,private.warehouse_offline_receipts; set test.allowed='yes'; insert into warehouse.stock_levels(product_id,location_id,bin_id,lot_id,quantity) values ('bulk','wh',null,'lot-a',2),('bulk','wh',null,'lot-b',1);`);
    const input = (quantity=3, extra={}) => ({ bulk_relocation:true,idempotency_key:'putaway-test-intent-001',command_input:{ productId:'bulk',locationId:'wh',toBinId:'dest',quantity,...extra } });
    const move = async payload => (await db.query('select warehouse.transfer($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;
    const balances = async () => (await db.query('select bin_id,lot_id,quantity from warehouse.stock_levels order by bin_id nulls first,lot_id')).rows;

    await t.test('moves 2+1 across lots and returns authoritative per-lot movements',async()=>{
      await reset();
      const result=await move(input());
      assert.deepEqual(result.movements.map(m=>[m.lot_id,m.quantity]),[['lot-a',2],['lot-b',1]]);
      assert.ok(result.movements.every(m=>m.actor==='00000000-0000-0000-0000-000000000001'));
      assert.deepEqual(await balances(),[{bin_id:null,lot_id:'lot-a',quantity:0},{bin_id:null,lot_id:'lot-b',quantity:0},{bin_id:'dest',lot_id:'lot-a',quantity:2},{bin_id:'dest',lot_id:'lot-b',quantity:1}]);
      assert.deepEqual(await move(input()),result,'retry returns same movement IDs');
      assert.equal((await db.query('select count(*)::int n from warehouse.movements')).rows[0].n,2);
      await assert.rejects(move(input(1)),/different payload/);
      await db.exec("set test.allowed='no'");
      await assert.rejects(move(input()),/Not authorized/);
    });
    await t.test('partial hold stays in its original lot; all-held stock cannot move',async()=>{
      await reset();
      await db.exec("insert into warehouse.inventory_holds values ('bulk','wh',null,'lot-a',null,'active',1)");
      const result=await move(input(2));
      assert.deepEqual(result.movements.map(m=>[m.lot_id,m.quantity]),[['lot-a',1],['lot-b',1]]);
      await assert.rejects(move({...input(1),idempotency_key:'putaway-test-intent-002'}),/Only 0.*Quality/i);
      assert.equal((await balances())[0].quantity,1);
    });
    await t.test('one unit succeeds with multiple source lots',async()=>{
      await reset();
      assert.equal((await move(input(1))).movements[0].quantity,1);
    });
    await t.test('insufficient or invalid input changes nothing',async()=>{
      await reset(); const before=await balances();
      await assert.rejects(move(input(4)),/Only 3/);
      for(const patch of [{quantity:0},{quantity:1.5},{toBinId:'wrong'},{toBinId:'inactive'},{toBinId:undefined},{productId:'serial'}]) await assert.rejects(move(input(3,patch)));
      assert.deepEqual(await balances(),before);
      assert.equal((await db.query('select count(*)::int n from warehouse.movements')).rows[0].n,0);
    });
    await t.test('a later movement failure rolls back earlier lots and retry receipt',async()=>{
      await reset(); const before=await balances();
      await db.exec("alter table warehouse.movements add constraint reject_second_lot check(lot_id is distinct from 'lot-b')");
      await assert.rejects(move(input()),/reject_second_lot/);
      assert.deepEqual(await balances(),before);
      assert.equal((await db.query('select count(*)::int n from private.warehouse_offline_receipts')).rows[0].n,0);
      await db.exec('alter table warehouse.movements drop constraint reject_second_lot');
    });
    await t.test('legacy null-lot Procurement stock retains null identity',async()=>{
      await reset(); await db.exec("delete from warehouse.stock_levels; insert into warehouse.stock_levels(product_id,location_id,bin_id,lot_id,quantity) values ('bulk','wh',null,null,7)");
      assert.equal((await move(input(7))).movements[0].lot_id,null);
      assert.equal((await balances()).find(r=>r.bin_id==='dest').quantity,7);
    });
    await t.test('serialized legacy route is preserved and held unit is rejected',async()=>{
      await reset(); await db.exec("insert into warehouse.inventory_units values ('unit','serial','wh',null,'serial-lot','in_stock','SN1')");
      const payload={unit_ids:['unit'],from_location_id:'wh',to_location_id:'wh',to_bin_id:'dest',movement:{id:'serial-mv',type:'transfer',product_id:'serial',quantity:1,from_location_id:'wh',to_location_id:'wh',from_bin_id:null,to_bin_id:'dest',actor:'spoof'}};
      await db.exec("insert into warehouse.inventory_holds values ('serial','wh',null,'serial-lot','SN1','active',1)");
      await assert.rejects(move(payload),/Held serialized/);
      await db.exec('delete from warehouse.inventory_holds');
      assert.equal((await move(payload)).id,'serial-mv');
      assert.equal((await db.query('select bin_id from warehouse.inventory_units')).rows[0].bin_id,'dest');
    });
    await t.test('new helper and legacy helper cannot be called directly by authenticated or anon',async()=>{
      for(const name of ['private.warehouse_transfer(jsonb)','private.warehouse_transfer_pre_lot_putaway(jsonb)']) {
        const rows=(await db.query("select has_function_privilege('authenticated',$1,'execute') auth,has_function_privilege('anon',$1,'execute') anon",[name])).rows;
        assert.deepEqual(rows,[{auth:false,anon:false}]);
      }
    });
  } finally { await db.close(); }
});
