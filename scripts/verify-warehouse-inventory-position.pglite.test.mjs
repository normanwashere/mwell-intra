import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const actor = '00000000-0000-4000-8000-000000000001';
const migration = '20261105074245_warehouse_inventory_position_summary.sql';
const sql = name => readFileSync(`supabase/migrations/${name}`,'utf8');
const q = (text,args) => db.query(text,args);
let seq = 0;
function table(file,name) {
  const source = sql(file);
  const match = source.match(new RegExp(`create table (?:if not exists )?${name.replaceAll('.', '\\.')} \\(`));
  assert.ok(match,name);
  return source.slice(match.index,source.indexOf('\n);',match.index)+4);
}
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema core; create schema auth; create schema private; create schema warehouse;
    create table core.profiles(id uuid primary key);
    insert into core.profiles values('${actor}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('probe.actor',true),'')::uuid $$;
    create function core.has_cap(text,text) returns boolean language sql stable as $$
      select ($1||'.'||$2)=any(string_to_array(current_setting('probe.caps',true),',')) $$;
    create function core.has_live_cap(text,text) returns boolean language sql stable as $$
      select core.has_cap($1,$2) and coalesce(current_setting('probe.current',true),'true')='true' $$;
    grant usage on schema warehouse,core,auth,private to authenticated,anon,service_role;`);
  for (const name of ['locations','products','storage_areas','events','lots','stock_levels','inventory_units','allocations']) {
    await db.exec(table('20260706092000_warehouse_schema.sql',`warehouse.${name}`));
  }
  await db.exec(`create unique index stock_levels_uq on warehouse.stock_levels(product_id,location_id,bin_id,lot_id) nulls not distinct;
    insert into warehouse.locations values('A','Warehouse A','warehouse'),('B','Warehouse B','warehouse');
    insert into warehouse.storage_areas(id,location_id,code) values('a-bin','A','A1'),('b-bin','B','B1');
    insert into warehouse.products(id,sku,name,category,serialized) values
      ('bulk','BULK','Bulk','merchandise',false),('serial','SERIAL','Device','device',true),('other','OTHER','Other','merchandise',false);
    insert into warehouse.lots(id,product_id) values('lot-a','bulk'),('lot-b','bulk');
    insert into warehouse.events(id,name,type,start_date) values('event-a','Event A','roadshow',current_date);`);
  for (const name of ['quality_inspections','inventory_holds','exceptions']) {
    await db.exec(table('20260710150000_warehouse_w1_control_schema.sql',`warehouse.${name}`));
  }
  await db.exec(`alter table warehouse.quality_inspections add column bin_id text references warehouse.storage_areas(id);
    alter table warehouse.inventory_holds add column bin_id text references warehouse.storage_areas(id);`);
  await db.exec(table('20260721200000_cross_department_wms_persistence.sql','warehouse.fulfillment_orders'));
  await db.exec(table('20260804150000_inventory_release_lifecycle_remediation.sql','warehouse.fulfillment_reservations'));
  const reporting = sql('20260710170000_warehouse_w1_imports_po_and_reporting.sql');
  await db.exec(reporting.slice(reporting.indexOf('create or replace view warehouse.inventory_position_v1'),
    reporting.indexOf('create or replace view warehouse.warehouse_tasks')));
  await db.exec(sql('20260905043614_warehouse_putaway_tasks.sql'));
  const guard = sql('20260920080131_gate_warehouse_raw_reads_by_current_capability.sql');
  await db.exec(guard.slice(guard.indexOf('create or replace function private.can_read_warehouse_table'),guard.indexOf('$$;')+3));
  for (const name of ['products','locations','storage_areas','stock_levels','inventory_units','allocations','inventory_holds',
    'quality_inspections','fulfillment_orders','fulfillment_reservations','exceptions']) {
    await db.exec(`alter table warehouse.${name} enable row level security;
      create policy current_capability_read_guard on warehouse.${name} as restrictive for select to authenticated
        using ((select private.can_read_warehouse_table('${name}')));`);
    if (!['inventory_holds','quality_inspections'].includes(name)) {
      await db.exec(`create policy read_authenticated on warehouse.${name} for select to authenticated using (true)`);
    }
  }
  const control = sql('20260710150000_warehouse_w1_control_schema.sql');
  const start = control.indexOf('create policy warehouse_holds_read');
  await db.exec(control.slice(start,control.indexOf(';',start)+1));
  await db.exec(`create policy quality_read on warehouse.quality_inspections for select to authenticated
    using(core.has_cap('warehouse','inspect_quality'));
    grant select on all tables in schema warehouse to authenticated,service_role;
    revoke select on warehouse.lots from authenticated;
    revoke all on warehouse.inventory_position_v1 from anon,public;`);
  if (process.env.WMS_POSITION_BASELINE !== '1') await db.exec(sql(migration));
});
after(async () => db.close());
async function caps(values = ['warehouse.view_inventory'], who = actor) {
  await q("select set_config('probe.actor',$1,false),set_config('probe.caps',$2,false),set_config('probe.current','true',false)",[who,values.join(',')]);
}
async function reset() {
  await db.exec(`reset role; truncate warehouse.fulfillment_reservations,warehouse.fulfillment_orders,warehouse.inventory_holds,
    warehouse.quality_inspections,warehouse.exceptions,warehouse.stock_levels,warehouse.inventory_units,warehouse.allocations;`);
  await caps();
}
async function stock(quantity, location = 'A', bin = 'a-bin', product = 'bulk', lot = null) {
  await q('insert into warehouse.stock_levels(product_id,location_id,bin_id,lot_id,quantity) values($1,$2,$3,$4,$5)',[product,location,bin,lot,quantity]);
}
async function unit(serial,status = 'in_stock',location = 'A',bin = 'a-bin',event = null) {
  await q('insert into warehouse.inventory_units(id,product_id,serial_number,location_id,bin_id,status,event_id) values($1,\'serial\',$1,$2,$3,$4,$5)',[serial,location,bin,status,event]);
}
async function hold(quantity, product = 'bulk', serial = null, location = 'A', bin = 'a-bin', lot = null) {
  const inspection = (await q(`insert into warehouse.quality_inspections
    (source_type,source_id,product_id,location_id,bin_id,lot_id,serial_number,quantity,disposition,inspected_by,inspected_by_email)
    values('return','synthetic-position',$1,$2,$3,$4,$5,$6,'hold',$7,'synthetic@example.invalid') returning id`,
  [product,location,bin,lot,serial,quantity,actor])).rows[0].id;
  return (await q(`insert into warehouse.inventory_holds
    (inspection_id,product_id,location_id,bin_id,lot_id,serial_number,quantity,reason,created_by)
    values($1,$2,$3,$4,$5,$6,$7,'PRIVATE QUALITY REASON',$8) returning id`,
  [inspection,product,location,bin,lot,serial,quantity,actor])).rows[0].id;
}
async function order(quantity,location = 'A',bin = 'a-bin',product = 'bulk',project = true,picked = []) {
  const id = (await q(`insert into warehouse.fulfillment_orders
    (source,external_reference,status,source_location_id,source_bin_id,lines,created_by)
    values('ecommerce',$1,'allocated',$2,$3,$4,$5) returning id`,
  [`position-order-${++seq}`,location,bin,JSON.stringify([{productId:product,quantity,pickedSerialNumbers:picked}]),actor])).rows[0].id;
  if (project) await q(`insert into warehouse.fulfillment_reservations(order_id,product_id,location_id,bin_id,quantity,created_by)
    values($1,$2,$3,$4,$5,$6)`,[id,product,location,bin,quantity,actor]);
  return id;
}
async function event(quantity, product = 'bulk',status = 'reserved') {
  await q(`insert into warehouse.allocations(id,event_id,product_id,quantity,status) values($1,'event-a',$2,$3,$4)`,[`event-${++seq}`,product,quantity,status]);
}
async function asRole(role,fn) {
  await db.exec(`set role ${role}`);
  try { return await fn(); } finally { await db.exec('reset role'); }
}
const numeric = ['on_hand','committed','held','unavailable','available','unscoped_committed','product_available','putaway_available'];
async function rows() {
  return asRole('authenticated',async () => (await q('select * from warehouse.inventory_position_v1 order by product_id,location_id,bin_id nulls first')).rows
    .map(row => Object.fromEntries(Object.entries(row).map(([key,value]) => [key,numeric.includes(key) && value!==null ? Number(value) : value]))));
}

test('scoped fulfillment reservations reduce the actual position once, with order projection deduplication', async () => {
  await reset(); await stock(10); await order(4);
  const [r] = await rows();
  assert.equal(r.committed,4); assert.equal(r.available,6); assert.equal(r.product_available,6);
  assert.equal(r.unscoped_committed,0); assert.equal(r.availability_verified,true);
});
test('real reservation uniqueness prevents duplicate same-order product deductions', async () => {
  await reset(); await stock(10); const id = await order(4);
  await assert.rejects(q(`insert into warehouse.fulfillment_reservations(order_id,product_id,location_id,bin_id,quantity,created_by)
    values($1,'bulk','B','b-bin',4,$2)`,[id,actor]),e => e.code==='23505');
  const [r] = await rows(); assert.equal(r.committed,4); assert.equal(r.product_available,6);
});
test('global event demand is not assigned to the first position and product availability clamps once', async () => {
  await reset(); await stock(2); await stock(10,'B','b-bin'); await event(8);
  const result = await rows();
  assert.deepEqual(result.map(r => [r.committed,r.available,r.unscoped_committed,r.product_available,r.availability_verified,r.putaway_available]),
    [[0,0,8,4,false,2],[0,0,8,4,false,10]]);
});
test('null source location or bin is unscoped, never invented as staging attribution', async () => {
  for (const [location,bin] of [['A',null],[null,null],[null,'a-bin']]) {
    await reset(); await stock(10); await order(4,location,bin);
    const [r] = await rows();
    assert.equal(r.committed,0); assert.equal(r.unscoped_committed,4); assert.equal(r.product_available,6);
    assert.equal(r.available,0); assert.equal(r.availability_verified,false); assert.equal(r.putaway_available,10);
  }
});
test('returned serial and matching duplicate holds are one held unit, not two unavailable units', async () => {
  await reset();
  for (let i=0;i<9;i++) await unit(`GOOD-${i}`);
  await unit('RETURNED','returned'); await hold(1,'serial','RETURNED'); await hold(1,'serial','RETURNED');
  const [r] = await rows();
  assert.deepEqual([r.on_hand,r.held,r.unavailable,r.available,r.product_available],[10,1,0,9,9]);
});
test('unrelated held serial and returned serial remain separate deductions', async () => {
  await reset(); await unit('HELD'); await unit('RETURNED','returned'); await unit('FREE');
  await hold(1,'serial','HELD');
  const [r] = await rows();
  assert.deepEqual([r.on_hand,r.held,r.unavailable,r.available],[3,1,1,1]);
});
test('hold on a pending-inspection unit does not subtract another on-hand unit', async () => {
  await reset(); await unit('PENDING','pending_inspection'); await unit('FREE'); await hold(1,'serial','PENDING');
  const [r] = await rows();
  assert.deepEqual([r.on_hand,r.held,r.unavailable,r.available],[1,0,0,1]);
});
test('active bulk holds retain exact lot scope instead of consuming another receipt lot', async () => {
  await reset(); await stock(2,'A','a-bin','bulk','lot-a'); await stock(8,'A','a-bin','bulk','lot-b');
  await hold(4,'bulk',null,'A','a-bin','lot-a');
  const [r] = await rows();
  assert.deepEqual([r.on_hand,r.held,r.available],[10,2,8]);
});
test('inventory-only, Quality, analytics, Finance and Insights see identical quantities without raw-hold disclosure', async () => {
  await reset(); await stock(10); await hold(4);
  const result = [];
  for (const permissions of [['warehouse.view_inventory'],['warehouse.view_inventory','warehouse.inspect_quality'],
    ['warehouse.view_analytics'],['warehouse.view_finance'],['insights.view_warehouse']]) {
    await caps(permissions);
    const [r] = await rows(); result.push([r.held,r.available]);
    assert.equal(JSON.stringify(r).includes('PRIVATE QUALITY REASON'),false);
    const raw = await asRole('authenticated',async () => (await q('select count(*)::int n from warehouse.inventory_holds')).rows[0].n);
    assert.equal(raw,permissions.includes('warehouse.inspect_quality') || permissions.includes('warehouse.view_finance') ? 1 : 0);
  }
  assert.deepEqual(result,Array(5).fill([4,6]));
});
test('missing identity, stale capability and unrelated capability cannot use view or private aggregate', async () => {
  await reset(); await stock(10);
  for (const mode of ['anonymous','unrelated','revoked']) {
    await caps(mode==='unrelated' ? ['warehouse.inspect_quality'] : ['warehouse.view_inventory'],mode==='anonymous' ? '' : actor);
    if (mode==='revoked') await q("select set_config('probe.current','false',false)");
    await assert.rejects(rows(),e => e.code==='42501');
    await assert.rejects(asRole('authenticated',() => q('select * from private.warehouse_inventory_position_summary()')),e => e.code==='42501');
  }
  await caps(['warehouse.view_inventory'],'');
  await assert.rejects(asRole('service_role',() => q('select * from warehouse.inventory_position_v1')),e => e.code==='42501');
});
test('anonymous has no aggregate execution grant or position-view read grant', async () => {
  assert.equal((await q("select has_function_privilege('anon','private.warehouse_inventory_position_summary()','EXECUTE') allowed")).rows[0].allowed,false);
  await assert.rejects(asRole('anon',() => q('select * from warehouse.inventory_position_v1')),e => e.code==='42501');
});
test('a new row-scoped restriction fails closed instead of being bypassed by privileged summary', async () => {
  await reset(); await stock(10);
  await db.exec("create policy narrower_location_scope on warehouse.locations as restrictive for select to authenticated using (id<>'A')");
  try { await assert.rejects(rows(),/row scope changed/); }
  finally { await db.exec('drop policy narrower_location_scope on warehouse.locations'); }
});
test('legacy open orders without reservation rows are counted once and terminal controls are ignored', async () => {
  await reset(); await stock(10); const id = await order(3,'A','a-bin','bulk',false);
  assert.equal((await rows())[0].available,7);
  await q("update warehouse.fulfillment_orders set status='cancelled' where id=$1",[id]);
  const projected = await order(4);
  await q("update warehouse.fulfillment_reservations set status='released',closed_at=now() where order_id=$1",[projected]);
  await q("update warehouse.fulfillment_orders set status='cancelled' where id=$1",[projected]);
  await event(6,'bulk','issued');
  const held = await hold(2);
  await q("update warehouse.inventory_holds set status='released',released_by=$1,released_at=now() where id=$2",[actor,held]);
  assert.equal((await rows())[0].available,10);
});
test('allocated serials already outside on-hand are not subtracted again by matching event demand', async () => {
  await reset(); for (let i=0;i<10;i++) await unit(`FREE-${i}`);
  await unit('ALLOC-1','allocated','A','a-bin','event-a'); await unit('ALLOC-2','allocated','B','b-bin','event-a');
  await event(4,'serial','allocated');
  const [r] = await rows();
  assert.deepEqual([r.on_hand,r.unscoped_committed,r.product_available],[10,2,8]);
});
test('old allocated serials do not erase a new reserved claim for the same event', async () => {
  await reset(); for (let i=0;i<10;i++) await unit(`FREE-${i}`);
  await unit('OLD-ALLOC','allocated','A','a-bin','event-a');
  await event(4,'serial','reserved');
  const [r] = await rows();
  assert.deepEqual([r.on_hand,r.unscoped_committed,r.product_available],[10,4,6]);
});
test('a null capability result is denied rather than interpreted as permission', async () => {
  await reset(); await stock(10);
  await db.exec('begin');
  try {
    await db.exec('create or replace function core.has_live_cap(text,text) returns boolean language sql stable as $$ select null::boolean $$');
    await assert.rejects(q('select * from warehouse.inventory_position_v1'),e => e.code==='42501');
  } finally { await db.exec('rollback'); }
});
test('exact picked serials outside on-hand are not deducted twice by fulfillment reservation', async () => {
  await reset(); await unit('FREE-1'); await unit('FREE-2'); await unit('OUT','allocated');
  await order(2,'A','a-bin','serial',true,['OUT','FREE-1']);
  const [r] = await rows(); assert.deepEqual([r.on_hand,r.committed,r.available],[2,1,1]);
});
test('explicit zero is retained and product fields are repeated but not additive', async () => {
  await reset(); await stock(0); await stock(2,'B','b-bin'); await event(9);
  const result = await rows();
  assert.deepEqual(result.map(r => r.product_available),[0,0]);
  assert.deepEqual(result.map(r => r.unscoped_committed),[9,9]);
  for (const row of result) for (const key of numeric) assert.equal(Number.isFinite(row[key]),true,key);
});
test('exact reserved scope can appear with zero stock; unscoped-only demand invents no location', async () => {
  await reset(); await order(3);
  assert.deepEqual((await rows()).map(r => [r.location_id,r.bin_id,r.on_hand,r.committed,r.available]),[['A','a-bin',0,3,0]]);
  await reset(); await event(3);
  assert.deepEqual(await rows(),[]);
});
test('unresolved event demand does not hide staging putaway work and task RLS remains invoker', async () => {
  await reset(); await stock(10,'A',null); await hold(2,'bulk',null,'A',null); await event(7);
  await caps(['warehouse.view_inventory','warehouse.inspect_quality']);
  const [r] = await rows(); assert.equal(r.available,0); assert.equal(r.product_available,1); assert.equal(r.putaway_available,8);
  const tasks = await asRole('authenticated',async () => (await q("select * from warehouse.warehouse_tasks where task_type='putaway'")).rows);
  assert.equal(tasks.length,1); assert.equal(tasks[0].title,'Put away Bulk / 8 units');
  assert.deepEqual(JSON.parse(tasks[0].source_id.slice('staging:'.length)),['bulk','A']);
  await caps(['warehouse.view_inventory']);
  assert.equal((await asRole('authenticated',() => q("select * from warehouse.warehouse_tasks where task_type='putaway'"))).rows.length,0);
});
test('unattributable serialized holds invalidate only their product, not unrelated stock reads', async () => {
  await reset(); await unit('FREE'); await unit('RETURNED','returned'); await hold(1,'serial');
  await stock(10);
  const result = await rows();
  const unknown = result.find(r => r.product_id==='serial');
  const good = result.find(r => r.product_id==='bulk');
  assert.equal(unknown.product_available,null); assert.equal(unknown.availability_verified,false);
  assert.equal(unknown.available,0); assert.equal(unknown.putaway_available,0);
  assert.equal(good.product_available,10); assert.equal(good.availability_verified,true);
  assert.equal((await asRole('authenticated',() => q("select on_hand from warehouse.inventory_position_v1 where product_id='bulk'"))).rows[0].on_hand,10);
});
test('Quality-only readers retain their authorized pending inspection Tasks without summary authority', async () => {
  await reset(); await stock(10);
  await q(`insert into warehouse.quality_inspections(source_type,source_id,product_id,location_id,quantity,disposition,inspected_by,inspected_by_email)
    values('receipt','pending-quality','bulk','A',1,'pending',$1,'synthetic@example.invalid')`,[actor]);
  await caps(['warehouse.inspect_quality']);
  const tasks = await asRole('authenticated',() => q('select task_type from warehouse.warehouse_tasks'));
  assert.deepEqual(tasks.rows,[{task_type:'quality'}]);
  await assert.rejects(rows(),e => e.code==='42501');
});
test('view contract preserves old columns, pagination keys and invoker security, appending only quantity metadata', async () => {
  await reset(); await stock(10);
  const [r] = await rows();
  assert.equal(r.id,'bulk|A|a-bin'); assert.equal(new Date(r.created_at).getTime(),0);
  const columns = (await q("select column_name,data_type from information_schema.columns where table_schema='warehouse' and table_name='inventory_position_v1' order by ordinal_position")).rows;
  assert.deepEqual(columns.map(c => c.column_name),['id','product_id','location_id','bin_id','on_hand','committed','held','unavailable','available','created_at','unscoped_committed','product_available','availability_verified','putaway_available']);
  for (const c of columns.filter(c => numeric.includes(c.column_name))) assert.equal(c.data_type,'bigint');
  for (const relation of ['warehouse.inventory_position_v1','warehouse.warehouse_tasks']) {
    assert.ok((await q('select reloptions from pg_class where oid=$1::regclass',[relation])).rows[0].reloptions.includes('security_invoker=true'));
  }
  assert.equal((await q("select has_table_privilege('authenticated','warehouse.inventory_holds','INSERT') allowed")).rows[0].allowed,false);
});
