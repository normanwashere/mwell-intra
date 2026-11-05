import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

// Actual control DDL/constraints and allocation authorities. Identity/capability
// helpers and unrelated parent tables remain local stubs, not live RBAC proof.
const migration = '20261105071241_warehouse_count_encumbrance_guard.sql';
let h;
let seq = 0;
const ddl = (file, table) => {
  const source = readFileSync(`supabase/migrations/${file}`, 'utf8');
  const match = source.match(new RegExp(`create table (?:if not exists )?${table.replaceAll('.', '\\.')} \\(`));
  assert.ok(match, table);
  return source.slice(match.index, source.indexOf('\n);', match.index) + 4);
};
before(async () => {
  const setup = [];
  const source = readFileSync('scripts/verify-warehouse-lot-count-exposure.pglite.test.mjs', 'utf8')
    .replace(/^import .*;\r?\n/gm, '');
  h = new Function('assert', 'readFileSync', 'PGlite', 'before', 'after', 'test',
    `${source}\nreturn {db,q,reset,stock,count,decide,balances,definition,sql,counter,supervisor,finance,actor};`)(
    assert, readFileSync, PGlite, fn => setup.push(fn), () => {}, () => {});
  for (const fn of setup) await fn();
  for (const name of ['warehouse.quality_inspections', 'warehouse.inventory_holds']) {
    await h.db.exec(ddl('20260710150000_warehouse_w1_control_schema.sql', name));
  }
  await h.db.exec(`alter table warehouse.quality_inspections add column bin_id text references warehouse.storage_areas(id) on delete set null;
    alter table warehouse.inventory_holds add column bin_id text references warehouse.storage_areas(id) on delete set null;`);
  await h.db.exec(h.definition('20260714175318_single_po_receipt_authority.sql', 'private.lock_inventory_hold_product'));
  await h.db.exec(`create trigger lock_inventory_hold_product before insert or update of status on warehouse.inventory_holds
    for each row execute function private.lock_inventory_hold_product();`);
  await h.db.exec(ddl('20260706092000_warehouse_schema.sql', 'warehouse.events'));
  await h.db.exec(ddl('20260706092000_warehouse_schema.sql', 'warehouse.allocations'));
  await h.db.exec('drop table warehouse.fulfillment_orders');
  await h.db.exec(ddl('20260721200000_cross_department_wms_persistence.sql', 'warehouse.fulfillment_orders'));
  const lifecycle = h.sql('20260804150000_inventory_release_lifecycle_remediation.sql');
  await h.db.exec(lifecycle.slice(lifecycle.indexOf('alter table warehouse.fulfillment_orders'),
    lifecycle.indexOf('create table warehouse.fulfillment_reservations')));
  await h.db.exec(ddl('20260804150000_inventory_release_lifecycle_remediation.sql', 'warehouse.fulfillment_reservations'));
  await h.db.exec('alter table warehouse.products add column name text, add column item_class text');
  const fulfillment = readFileSync('scripts/fixtures/sep08-installed-fulfillment.sql','utf8');
  const start = fulfillment.indexOf('CREATE OR REPLACE FUNCTION private.warehouse_advance_fulfillment_order(');
  await h.db.exec(fulfillment.slice(start,fulfillment.indexOf('$function$;',start)+11));
  await h.db.exec(h.definition('20260804150000_inventory_release_lifecycle_remediation.sql','private.warehouse_advance_fulfillment_order_v2'));
  await h.db.exec(h.definition('20260718201000_refresh_atp_inside_product_lock.sql', 'warehouse.available_to_promise'));
  await h.db.exec(h.definition('20260828060000_atomic_event_reservations.sql', 'warehouse.reserve_batch'));
  await h.db.exec(`insert into warehouse.events(id,name,type,start_date) values('guard-event','Synthetic guard','roadshow',current_date);
    insert into warehouse.locations values('warehouse-b','warehouse',true);
    insert into warehouse.storage_areas values('bin-b','warehouse-b',true);
    insert into warehouse.products(id,serialized,unit_cost) values('other',false,10);`);
  if (process.env.WMS_COUNT_GUARD_BASELINE !== '1') await h.db.exec(h.sql(migration));
});
after(async () => h?.db.close());
async function reset(cost = 10) {
  await h.db.exec(`truncate warehouse.inventory_holds,warehouse.quality_inspections,
    warehouse.fulfillment_reservations,warehouse.fulfillment_orders,warehouse.allocations`);
  await h.reset(cost);
}
async function hold(product = 'bulk', lot = 'lot-a', serial = null, location = 'warehouse-a', bin = 'bin-a') {
  const inspection = (await h.q(`insert into warehouse.quality_inspections
    (source_type,source_id,product_id,lot_id,serial_number,location_id,bin_id,quantity,disposition,inspected_by,inspected_by_email)
    values('return','synthetic-guard',$1,$2,$3,$4,$5,1,'hold',$6,'synthetic@example.invalid') returning id`,
  [product,lot,serial,location,bin,h.counter])).rows[0].id;
  return (await h.q(`insert into warehouse.inventory_holds
    (inspection_id,product_id,location_id,bin_id,lot_id,serial_number,quantity,reason,created_by)
    values($1,$2,$3,$4,$5,$6,1,'Quality review pending',$7) returning id`,
  [inspection,product,location,bin,lot,serial,h.counter])).rows[0].id;
}
async function order(product = 'bulk', location = 'warehouse-a', bin = 'bin-a') {
  return (await h.q(`insert into warehouse.fulfillment_orders
    (source,external_reference,source_location_id,source_bin_id,status,lines,created_by)
    values('ecommerce',$1,$2,$3,'received',$4,$5) returning id`,
  [`synthetic-order-${++seq}`,location,bin,JSON.stringify([{productId:product,quantity:1}]),h.counter])).rows[0].id;
}
async function allocate(id) {
  return (await h.q('select private.warehouse_advance_fulfillment_order_v2($1::jsonb) result',[
    JSON.stringify({order_id:id,action:'allocate',idempotency_key:`guard-allocate-${++seq}`}),
  ])).rows[0].result;
}
async function reserve(product = 'bulk') {
  const r = (await h.q('select warehouse.reserve_batch($1::jsonb) result',[JSON.stringify({
    idempotency_key:`guard-event-${++seq}`,event_id:'guard-event',lines:[{product_id:product,quantity:1}],
  })])).rows[0].result;
  assert.equal(r.status,'committed');
  return r.allocations[0].id;
}
async function serialCount() {
  return h.count(0,0,{}, {
    idempotency_key:`guard-serial-command-${++seq}`,
    cycle_count:{id:`guard-serial-${seq}`,location_id:'warehouse-a',bin_id:'bin-a',category:'device',
      lines:[{productId:'serial',counted:0,serialNumbers:[]}]},
    reason:'Missing at count',evidence_urls:['synthetic/count.jpg'],
  });
}
async function state() {
  const tables = ['warehouse.stock_levels','warehouse.inventory_units','warehouse.movements',
    'warehouse.stock_change_requests','warehouse.cycle_counts','private.warehouse_count_snapshots',
    'private.warehouse_stock_epochs','core.approvals','warehouse.command_log','warehouse.inventory_holds',
    'warehouse.quality_inspections','warehouse.fulfillment_reservations','warehouse.fulfillment_orders',
    'warehouse.allocations','warehouse.exceptions','core.activity_log'];
  const result = {};
  for (const table of tables) result[table] = (await h.q(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) value from ${table} t`)).rows[0].value;
  return result;
}
async function blocked(id, who = h.supervisor, key = `guard-denied-${++seq}`) {
  const before = await state();
  await assert.rejects(h.decide(id,who,'approved',key), e => e.code === 'P0001' && /Count posting blocked/.test(e.message));
  assert.deepEqual(await state(),before,'posting denial must roll back every decision and leave all controls unchanged');
}

test('held serial observation is preserved, posting is denied, independent rejection remains available', async () => {
  await reset();
  await h.db.exec("insert into warehouse.inventory_units values('held-unit','serial','warehouse-a','bin-a','HELD-001','in_stock',null,null)");
  await hold('serial',null,'HELD-001');
  const c = await serialCount();
  assert.equal(c.requests.length,1);
  await blocked(c.requests[0].id);
  assert.equal((await h.decide(c.requests[0].id,h.supervisor,'rejected')).status,'rejected');
  assert.equal((await h.q('select status from warehouse.inventory_holds')).rows[0].status,'active');
  assert.equal((await h.q('select status from warehouse.inventory_units')).rows[0].status,'in_stock');
});

test('new held lot blocks net-zero posting without partially applying either lot', async () => {
  await reset(); await h.stock(3,2);
  const c = await h.count(1,4);
  await hold();
  assert.equal(c.requests[0].quantity_delta,0);
  await blocked(c.requests[0].id);
  assert.deepEqual(await h.balances(),[{lot_id:'lot-a',quantity:3},{lot_id:'lot-b',quantity:2}]);
});

test('a positive variance is guarded too; unchanged observations need no posting', async () => {
  await reset(); await h.stock(3,2); await hold();
  const unchanged = await h.count(3,2);
  assert.equal(unchanged.requests.length,0);
  const c = await h.count(4,2);
  await blocked(c.requests[0].id);
});

test('product-wide safety bound includes holds in another bin without blocking unrelated products', async () => {
  await reset(); await h.stock(3,2);
  await hold('bulk','lot-a',null,'warehouse-b','bin-b');
  const c = await h.count(2,2);
  await blocked(c.requests[0].id);
  await reset(); await h.stock(3,2);
  await hold('other',null,null,'warehouse-b','bin-b');
  const clear = await h.count(2,2);
  assert.equal((await h.decide(clear.requests[0].id)).status,'approved');
});

test('actual fulfillment allocation added after submission blocks final posting', async () => {
  await reset(); await h.stock(3,2);
  const c = await h.count(1,1);
  assert.equal((await allocate(await order())).status,'allocated');
  assert.equal((await h.q('select status from warehouse.fulfillment_reservations')).rows[0].status,'active');
  await blocked(c.requests[0].id);
});

test('active reservation rows independently guard null and other-location scopes', async () => {
  for (const [location,bin] of [[null,null],['warehouse-b','bin-b']]) {
    await reset(); await h.stock(3,2);
    const c = await h.count(2,2);
    const id = await order('bulk',location,bin);
    await h.q(`insert into warehouse.fulfillment_reservations(order_id,product_id,location_id,bin_id,quantity,created_by)
      values($1,'bulk',$2,$3,1,$4)`,[id,location,bin,h.counter]);
    await blocked(c.requests[0].id);
  }
});

test('legacy committed fulfillment lines block even without a reservation projection', async () => {
  for (const status of ['allocated','picking','packing','ready']) {
    await reset(); await h.stock(3,2);
    const c = await h.count(2,2);
    const id = await order();
    await h.q('update warehouse.fulfillment_orders set status=$1 where id=$2',[status,id]);
    await blocked(c.requests[0].id);
  }
});

test('event reservation added between supervisor and Finance prevents final posting', async () => {
  await reset(4000); await h.stock(3,2);
  const c = await h.count(1,1);
  assert.equal((await h.decide(c.requests[0].id)).status,'pending_finance');
  await reserve();
  await blocked(c.requests[0].id,h.finance);
  assert.equal((await h.decide(c.requests[0].id,h.finance,'rejected')).status,'rejected');
  assert.equal((await h.q('select status from warehouse.allocations')).rows[0].status,'reserved');
});

test('both reserved and allocated event demand block net-zero lot corrections', async () => {
  for (const status of ['reserved','allocated']) {
    await reset(); await h.stock(3,2);
    const id = await reserve();
    await h.q('update warehouse.allocations set status=$1 where id=$2',[status,id]);
    const c = await h.count(2,3);
    await blocked(c.requests[0].id);
  }
});

test('independent owner resolution then rejection and new count does not auto-release anything', async () => {
  await reset(); await h.stock(3,2);
  const id = await hold();
  const c = await h.count(2,2);
  await blocked(c.requests[0].id);
  await h.q(`update warehouse.inventory_holds set status='released',released_by=$1,released_at=now(),release_reason='Synthetic owner resolution' where id=$2`,[h.finance,id]);
  assert.equal((await h.decide(c.requests[0].id,h.supervisor,'rejected')).status,'rejected');
  await h.actor(h.counter);
  const fresh = await h.count(2,2);
  assert.equal((await h.decide(fresh.requests[0].id)).status,'approved');
  assert.equal((await h.q('select status from warehouse.inventory_holds')).rows[0].status,'released');
});

test('terminal controls and received or cancelled orders do not block new posting', async () => {
  await reset(); await h.stock(3,2);
  for (const status of ['released','vendor_return','written_off']) {
    const id = await hold();
    await h.q('update warehouse.inventory_holds set status=$1,released_by=$2,released_at=now() where id=$3',[status,h.finance,id]);
  }
  for (const status of ['released','cancelled']) {
    const id = await order();
    await h.q(`insert into warehouse.fulfillment_reservations(order_id,product_id,quantity,status,created_by,closed_at)
      values($1,'bulk',1,$2,$3,now())`,[id,status,h.counter]);
  }
  const id = await order();
  await h.q("update warehouse.fulfillment_orders set status='cancelled' where id=$1",[id]);
  await h.q("insert into warehouse.allocations(id,event_id,product_id,quantity,status) values('terminal-event','guard-event','bulk',1,'returned')");
  const c = await h.count(2,2);
  assert.equal((await h.decide(c.requests[0].id)).status,'approved');
});

test('unrelated product fulfillment and event demand cannot block this count', async () => {
  await reset(); await h.stock(3,2);
  await h.q("insert into warehouse.stock_levels values('other','warehouse-a','bin-a',null,5)");
  await allocate(await order('other'));
  await reserve('other');
  const c = await h.count(2,2);
  assert.equal((await h.decide(c.requests[0].id)).status,'approved');
});

test('rejected attempts have no ledger receipt; committed decision replay remains exactly once', async () => {
  await reset(); await h.stock(3,2);
  await hold();
  const c = await h.count(2,2);
  await blocked(c.requests[0].id,h.supervisor,'guard-same-failed-key');
  await blocked(c.requests[0].id,h.supervisor,'guard-same-failed-key');
  await reset(); await h.stock(3,2);
  const clear = await h.count(2,2);
  const result = await h.decide(clear.requests[0].id,h.supervisor,'approved','guard-success-key');
  await hold();
  assert.deepEqual(await h.decide(clear.requests[0].id,h.supervisor,'approved','guard-success-key'),result);
  await assert.rejects(h.decide(clear.requests[0].id,h.supervisor,'rejected','guard-success-key'),/different payload/);
  assert.equal((await h.q('select count(*)::int n from warehouse.movements')).rows[0].n,1);
});

test('private helper is not an API; effective apply orders existing locks before guard before writes', async () => {
  const fn = (await h.q("select pg_get_functiondef('private.warehouse_apply_count(warehouse.stock_change_requests)'::regprocedure) definition")).rows[0].definition;
  const guard = fn.indexOf('perform private.warehouse_assert_count_unencumbered(p_request.product_id)');
  assert.ok(guard>fn.indexOf('v_snapshot.revision<>v_revision'));
  assert.ok(guard<fn.indexOf('update warehouse.inventory_units'));
  assert.ok(fn.indexOf('private.lock_warehouse_products')<fn.indexOf('private.warehouse_lock_count_scope'));
  for (const role of ['anon','authenticated']) {
    assert.equal((await h.q("select has_function_privilege($1,'private.warehouse_assert_count_unencumbered(text)','EXECUTE') allowed",[role])).rows[0].allowed,false);
  }
});

test('migration fails closed if its apply anchor is duplicated or missing', async () => {
  for (const duplicated of [true,false]) {
    await h.db.exec('begin');
    try {
      const original = (await h.q("select pg_get_functiondef('private.warehouse_apply_count(warehouse.stock_change_requests)'::regprocedure) definition")).rows[0].definition;
      const anchor = "  if (v_snapshot.facts->>'serialized')::boolean then";
      await h.db.exec(original.replace(anchor,duplicated ? `${anchor}\n  null;\n  end if;\n${anchor}` : "  if coalesce((v_snapshot.facts->>'serialized')::boolean,false) then"));
      await assert.rejects(h.db.exec(h.sql(migration)),/Count encumbrance posting anchor changed/);
    } finally { await h.db.exec('rollback'); }
  }
});
