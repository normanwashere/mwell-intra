import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const actor = "11111111-1111-4111-8111-111111111111";
const readMigration = (file) =>
  readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
const functionSql = (sql, name) => {
  const start = sql.indexOf(`create or replace function ${name}(`);
  assert.notEqual(start, -1, name);
  const body = sql.indexOf("as $$", start);
  return sql.slice(start, sql.indexOf("$$;", body + 5) + 3);
};
const payload = () => ({
  idempotency_key: "return-batch-test-0001",
  allocation_id: null,
  return: {
    source: "event",
    event_id: "event",
    evidence_urls: [],
    actor: "spoofed",
    lines: [
      {
        productId: "bulk",
        quantity: 3,
        reason: "unused",
        locationId: "wh",
        binId: "bin",
        disposition: "quarantine",
      },
      {
        productId: "device",
        quantity: 1,
        reason: "damaged",
        serialNumber: "SERIAL-1",
        locationId: "wh",
        binId: "bin",
        disposition: "quarantine",
      },
      {
        productId: "device",
        quantity: 1,
        reason: "damaged",
        serialNumber: "SERIAL-2",
        locationId: "wh",
        binId: "bin",
        disposition: "quarantine",
      },
    ],
  },
});
const rpc = async (value, name = "record_return_v2") =>
  (
    await db.query(`select warehouse.${name}($1::jsonb) result`, [
      JSON.stringify(value),
    ])
  ).rows[0].result;
const snapshot = async () =>
  (
    await db.query(`select jsonb_build_object(
  'returns', (select jsonb_agg(r order by id) from warehouse.returns r),
  'units', (select jsonb_agg(u order by id) from warehouse.inventory_units u),
  'stock', (select jsonb_agg(s order by product_id,location_id) from warehouse.stock_levels s),
  'holds', (select jsonb_agg(h order by id) from warehouse.inventory_holds h),
  'quality', (select jsonb_agg(q order by id) from warehouse.quality_inspections q),
  'movements', (select jsonb_agg(m order by id) from warehouse.movements m),
  'commands', (select jsonb_agg(c order by id) from warehouse.command_log c),
  'allocations', (select jsonb_agg(a order by id) from warehouse.allocations a)) result`)
  ).rows[0].result;

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema core; create schema private;
    create table core.profiles(id uuid primary key);
    insert into core.profiles values('${actor}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select 'authenticated'::text $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select '{"email":"receiver@test.invalid"}'::jsonb $$;
    create function core.has_cap(text,text) returns boolean language sql stable as $$ select coalesce(current_setting('test.cap',true),'on') <> 'off' $$;
    create function core.has_live_cap(text,text) returns boolean language sql stable as $$ select coalesce(current_setting('test.live',true),'on') <> 'off' $$;
    create function private.warehouse_payload_hash(jsonb) returns text language sql as $$ select encode(sha256(convert_to($1::text,'UTF8')),'hex') $$;
  `);
  const base = await readMigration("20260706092000_warehouse_schema.sql");
  await db.exec(base.replace('create extension if not exists "pgcrypto";', ""));
  const controls = await readMigration(
    "20260710150000_warehouse_w1_control_schema.sql",
  );
  await db.exec(
    controls.slice(
      controls.indexOf(
        "create table if not exists warehouse.quality_inspections",
      ),
      controls.indexOf(
        "create table if not exists warehouse.stock_change_requests",
      ),
    ),
  );
  await db.exec(
    controls.slice(
      controls.indexOf("create table if not exists warehouse.command_log"),
      controls.indexOf("create table if not exists warehouse.import_jobs"),
    ),
  );
  const helpers = await readMigration(
    "20260710160000_warehouse_w1_quality_and_approval_rpcs.sql",
  );
  await db.exec(functionSql(helpers, "private.begin_idempotent_command"));
  await db.exec(functionSql(helpers, "private.finish_idempotent_command"));
  await db.exec(`alter table warehouse.locations add column active boolean not null default true;
    alter table warehouse.quality_inspections add column bin_id text references warehouse.storage_areas(id);
    alter table warehouse.inventory_holds add column bin_id text references warehouse.storage_areas(id);
    create function private.lock_warehouse_products(text[]) returns void language plpgsql as $$ begin
      perform pg_advisory_xact_lock(hashtextextended('warehouse.product:' || p,0)) from unnest($1) p order by p;
    end $$;
    create function private.remove_provisional_quality_hold() returns trigger language plpgsql as $$ begin
      if old.disposition='pending' then delete from warehouse.inventory_holds where inspection_id=old.id and status='active' and reason='Awaiting independent quality inspection'; end if; return old; end $$;
    create trigger remove_provisional before delete on warehouse.quality_inspections for each row execute function private.remove_provisional_quality_hold();
    create function warehouse.record_return_uncertified_impl(jsonb) returns jsonb language sql as $$ select $1 $$;
    create function warehouse.record_return(jsonb) returns jsonb language sql as $$ select $1 $$;
    revoke all on function warehouse.record_return(jsonb) from public, anon;
    grant execute on function warehouse.record_return(jsonb) to authenticated, service_role;
    create function private.warehouse_inspect_quality_v3(jsonb) returns jsonb language sql as $$ select '{"legacy":true}'::jsonb $$;
    create function warehouse.inspect_quality(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$ begin
      if not core.has_live_cap('warehouse','inspect_quality') then raise exception 'Not authorized'; end if;
      return private.warehouse_inspect_quality_v3(payload); end $$;
  `);
  await db.exec(
    await readMigration("20260828033036_return_intake_atomic_quarantine.sql"),
  );
  await db.exec(
    functionSql(
      await readMigration("20260718201000_refresh_atp_inside_product_lock.sql"),
      "warehouse.available_to_promise",
    ),
  );
  await db.exec(
    await readMigration("20260828041500_return_intake_stock_state.sql"),
  );
});
beforeEach(async () => {
  await db.exec(`truncate warehouse.vendor_returns,warehouse.inventory_holds,warehouse.quality_inspections,warehouse.exceptions,warehouse.command_log,warehouse.returns,warehouse.movements,warehouse.allocations,warehouse.stock_levels,warehouse.inventory_units;
    select set_config('request.jwt.claim.sub','${actor}',false),set_config('test.cap','on',false),set_config('test.live','on',false);
    insert into warehouse.products(id,sku,name,category,serialized) values('bulk','B','Bulk','merchandise',false),('device','D','Device','device',true) on conflict do nothing;
    insert into warehouse.locations(id,name,type) values('wh','Warehouse','warehouse'),('other','Other','warehouse'),('vendor','Vendor','vendor') on conflict do nothing;
    update warehouse.locations set active=true;
    insert into warehouse.storage_areas(id,location_id,code) values('bin','wh','B1'),('other-bin','other','O1') on conflict do nothing;
    update warehouse.storage_areas set active=true;
    insert into warehouse.events(id,name,type,start_date) values('event','Event','wellness',current_date),('other-event','Other','wellness',current_date) on conflict do nothing;
    insert into warehouse.inventory_units(id,product_id,serial_number,location_id,status,event_id) values('u1','device','SERIAL-1','other','issued','event'),('u2','device','SERIAL-2','other','issued','event');
    insert into warehouse.stock_levels(product_id,location_id,bin_id,quantity) values('bulk','wh','bin',10);
  `);
});
after(() => db.close());

test('WE02 retires the actual legacy wrapper before raw writes while v2 retains its safety chain', async () => {
  await db.exec('begin');
  try {
    const legacy = functionSql(await readMigration('20260707110000_warehouse_actor_identity.sql'), 'warehouse.record_return');
    await db.exec(legacy.replace('function warehouse.record_return(', 'function warehouse.record_return_uncertified_impl('));
    await db.exec(functionSql(await readMigration('20260813203240_task_1_database_authority_remediation.sql'), 'warehouse.record_return'));
    await db.exec("alter table warehouse.events add column status text not null default 'planned'");
    await db.exec(await readMigration('20260828060000_atomic_event_reservations.sql'));
    await db.exec(await readMigration('20260905092000_warehouse_integrity.sql'));
    await db.exec("insert into warehouse.allocations(id,event_id,product_id,quantity,status) values('legacy-allocation','event','bulk',10,'issued')");
    const before = await snapshot();
    const raw = {
      allocation_id: 'legacy-allocation',
      unit_updates: [{ serial_number: 'SERIAL-1', status: 'available', location_id: 'wh', bin_id: 'bin' }],
      stock_deltas: [{ product_id: 'bulk', location_id: 'wh', bin_id: 'bin', delta: 99 }],
      movements: [{ id: 'legacy-movement', type: 'return', product_id: 'bulk', quantity: 99, event_id: 'event', actor: 'spoofed' }],
      return: { id: 'legacy-return', source: 'event', event_id: 'event', actor: 'spoofed', lines: [{ productId: 'bulk', quantity: 99 }] },
    };
    for (const input of [raw, {}, null]) {
      await db.exec('savepoint legacy_rejection');
      await assert.rejects(rpc(input, 'record_return'), error => {
        assert.equal(error.code, '0A000');
        assert.match(error.message, /Reload or upgrade the app.*record_return_v2/);
        return true;
      });
      await db.exec('rollback to legacy_rejection');
      assert.deepEqual(await snapshot(), before);
    }
    const grants = (await db.query(`select
      has_function_privilege('authenticated','warehouse.record_return(jsonb)','execute') legacy,
      has_function_privilege('anon','warehouse.record_return(jsonb)','execute') anon,
      has_function_privilege('authenticated','warehouse.record_return_uncertified_impl(jsonb)','execute') hidden`)).rows[0];
    assert.deepEqual(grants, { legacy: true, anon: false, hidden: false });
    const value = payload();
    value.allocation_id = 'legacy-allocation';
    value.return.lines = [value.return.lines[0]];
    const result = await rpc(value);
    assert.equal(result.lines[0].allocationId, 'legacy-allocation');
    const committed = await snapshot();
    assert.equal(committed.returns.length, 1);
    assert.equal(committed.movements.length, 1);
    assert.equal(committed.quality[0].disposition, 'pending');
    assert.equal(committed.holds[0].status, 'active');
    assert.deepEqual(await rpc(value), result);
    assert.deepEqual(await snapshot(), committed);
    for (const setting of ['test.cap', 'test.live', 'request.jwt.claim.sub']) {
      await db.query('select set_config($1,$2,true)', [setting, setting === 'request.jwt.claim.sub' ? '' : 'off']);
      await db.exec('savepoint v2_auth');
      await assert.rejects(rpc(value), /authorized|Authentication|authenticated/i);
      await db.exec('rollback to v2_auth');
      assert.deepEqual(await snapshot(), committed);
      await db.query('select set_config($1,$2,true)', [setting, setting === 'request.jwt.claim.sub' ? actor : 'on']);
    }
  } finally { await db.exec('rollback'); }
});

test('WE02 migration preserves empty historical return lines allowed by the deployed DDL', async () => {
  await db.exec('begin');
  try {
    await db.exec("insert into warehouse.returns(id,source,event_id,actor) values('empty-legacy','event','event','legacy')");
    await db.exec("alter table warehouse.events add column status text not null default 'planned'");
    await db.exec(await readMigration('20260828060000_atomic_event_reservations.sql'));
    await db.exec(await readMigration('20260905092000_warehouse_integrity.sql'));
    assert.deepEqual((await db.query("select lines from warehouse.returns where id='empty-legacy'")).rows[0].lines, []);
  } finally { await db.exec('rollback'); }
});

test('WE02 cumulative bulk returns preserve identity, reject excess atomically and replay after closure', async () => {
  await db.exec('begin');
  try {
    await db.exec("alter table warehouse.events add column status text not null default 'planned'");
    await db.exec(await readMigration('20260828060000_atomic_event_reservations.sql'));
    await db.exec(await readMigration('20260905092000_warehouse_integrity.sql'));
    await db.exec("insert into warehouse.allocations(id,event_id,product_id,quantity,status) values('bulk-allocation','event','bulk',10,'issued')");
    const value = payload();
    value.allocation_id = 'bulk-allocation';
    value.return.lines = [{ ...value.return.lines[0], quantity: 6 }];
    const first = await rpc(value);
    assert.equal(first.lines[0].allocationId, 'bulk-allocation');
    const unchanged = await snapshot();
    await db.exec('savepoint excessive');
    await assert.rejects(rpc({ ...value, idempotency_key: 'second-return-excess' }), /outstanding allocation custody/);
    await db.exec('rollback to excessive');
    assert.deepEqual(await snapshot(), unchanged);
    const final = { ...value, idempotency_key: 'final-return-balanced', return: { ...value.return, lines: [{ ...value.return.lines[0], quantity: 4 }] } };
    const last = await rpc(final);
    assert.equal((await snapshot()).allocations[0].status, 'returned');
    assert.deepEqual(await rpc(value), first);
    assert.deepEqual(await rpc(final), last);
    assert.equal((await snapshot()).movements.reduce((sum, row) => sum + row.quantity, 0), 10);
  } finally { await db.exec('rollback'); }
});

test('WE05 terminal event reservations reject fresh intents but committed replay survives close', async () => {
  await db.exec('begin');
  try {
    await db.exec("alter table warehouse.events add column status text not null default 'planned'");
    await db.exec(await readMigration('20260828060000_atomic_event_reservations.sql'));
    await db.exec(await readMigration('20260905092000_warehouse_integrity.sql'));
    const value = { event_id: 'event', idempotency_key: 'reserve-open-event', lines: [{ product_id: 'bulk', quantity: 2 }] };
    const first = await rpc(value, 'reserve_batch');
    assert.equal(first.status, 'committed');
    for (const status of ['closed', 'cancelled']) {
      await db.query('update warehouse.events set status=$1 where id=\'event\'', [status]);
      const rejected = await rpc({ ...value, idempotency_key: `reserve-${status}-event` }, 'reserve_batch');
      assert.equal(rejected.status, 'rejected');
      assert.equal((await snapshot()).allocations.length, 1);
      assert.deepEqual(await rpc(value, 'reserve_batch'), first);
    }
    await db.exec("update warehouse.allocations set status='returned'; insert into warehouse.movements(id,type,product_id,quantity,event_id,actor) values('returned-movement','return','bulk',2,'event','test')");
    const totals = (await db.query("select * from warehouse.event_custody_totals where event_id='event'")).rows[0];
    assert.equal(Number(totals.issued_units), 2);
    assert.equal(Number(totals.returned_units), 2);
    assert.equal(Number(totals.outstanding_units), 0);
  } finally { await db.exec('rollback'); }
});

test('WE10 issue valuation survives catalogue edits; ambiguous mixed-cost returns remain unknown', async () => {
  await db.exec('begin');
  try {
    await db.exec("alter table warehouse.events add column status text not null default 'planned'");
    await db.exec(await readMigration('20260828060000_atomic_event_reservations.sql'));
    await db.exec(await readMigration('20260905092000_warehouse_integrity.sql'));
    await db.exec("update warehouse.products set unit_cost=100 where id='bulk'; insert into warehouse.movements(id,type,product_id,quantity,event_id,actor) values('issue-history','issue','bulk',10,'event','test'); update warehouse.products set unit_cost=999 where id='bulk'; insert into warehouse.movements(id,type,product_id,quantity,event_id,actor) values('return-history','return','bulk',2,'event','test')");
    const first = (await db.query("select unit_cost_at_movement from warehouse.movements order by id")).rows;
    assert.deepEqual(first.map(row => Number(row.unit_cost_at_movement)), [100,100]);
    await db.exec("insert into warehouse.movements(id,type,product_id,quantity,event_id,actor) values('issue-mixed','issue','bulk',2,'event','test'),('return-mixed','return','bulk',1,'event','test')");
    assert.equal((await db.query("select unit_cost_at_movement from warehouse.movements where id='return-mixed'")).rows[0].unit_cost_at_movement, null);
  } finally { await db.exec('rollback'); }
});

test('WE02 ambiguous historical return identity is audited and blocks fresh intake without side effects', async () => {
  await db.exec('begin');
  try {
    await db.exec("insert into warehouse.allocations(id,event_id,product_id,quantity,status) values('a','event','bulk',10,'issued'),('b','event','bulk',10,'issued')");
    const historical = payload();
    historical.return.lines = [historical.return.lines[0]];
    await rpc(historical);
    await db.exec("alter table warehouse.events add column status text not null default 'planned'");
    await db.exec(await readMigration('20260828060000_atomic_event_reservations.sql'));
    await db.exec(await readMigration('20260905092000_warehouse_integrity.sql'));
    assert.equal((await db.query('select * from warehouse.return_lineage_audit')).rows.length, 1);
    const before = await snapshot();
    await db.exec('savepoint ambiguous');
    await assert.rejects(rpc({ ...historical, allocation_id: 'a', idempotency_key: 'ambiguous-fresh-return' }), /lineage needs reconciliation/);
    await db.exec('rollback to ambiguous');
    assert.deepEqual(await snapshot(), before);
  } finally { await db.exec('rollback'); }
});

test("one multi-product command quarantines every line and exact replay writes nothing", async () => {
  const first = await rpc(payload());
  assert.equal(first.actor, "receiver@test.invalid");
  const after = await snapshot();
  assert.equal(after.returns.length, 1);
  assert.equal(after.movements.length, 3);
  assert.equal(after.quality.length, 3);
  assert.equal(
    after.holds.reduce((sum, h) => sum + h.quantity, 0),
    5,
  );
  assert.equal(after.stock[0].quantity, 13);
  assert.equal(
    after.stock[0].quantity -
      after.holds
        .filter((h) => h.product_id === "bulk")
        .reduce((sum, h) => sum + h.quantity, 0),
    10,
  );
  assert.ok(
    after.units.every(
      (u) =>
        u.status === "in_stock" &&
        after.holds.some((h) => h.serial_number === u.serial_number),
    ),
  );
  assert.deepEqual(await rpc(payload()), first);
  assert.deepEqual(await snapshot(), after);
  const changed = payload();
  changed.return.lines[0].quantity = 4;
  await assert.rejects(rpc(changed), /different payload/);
  assert.deepEqual(await snapshot(), after);
});

for (const [label, mutate] of [
  ["empty batch", (p) => (p.return.lines = [])],
  ["missing key", (p) => delete p.idempotency_key],
  ["missing product", (p) => (p.return.lines[2].productId = "missing")],
  ["zero", (p) => (p.return.lines[2].quantity = 0)],
  ["negative", (p) => (p.return.lines[2].quantity = -1)],
  ["fraction", (p) => (p.return.lines[2].quantity = 1.5)],
  ["null quantity", (p) => (p.return.lines[2].quantity = null)],
  ["string quantity", (p) => (p.return.lines[2].quantity = "1")],
  ["malformed reason", (p) => (p.return.lines[2].reason = {})],
  ["missing serial", (p) => delete p.return.lines[2].serialNumber],
  [
    "wrong product serial",
    (p) => (p.return.lines[0].serialNumber = "SERIAL-1"),
  ],
  ["duplicate serial", (p) => (p.return.lines[2].serialNumber = "serial-1")],
  ["wrong event", (p) => (p.return.event_id = "other-event")],
  ["missing event", (p) => delete p.return.event_id],
  ["bad source", (p) => (p.return.source = "anything")],
  ["restock bypass", (p) => (p.return.lines[2].disposition = "restock")],
  ["wrong bin", (p) => (p.return.lines[2].binId = "other-bin")],
  ["vendor destination", (p) => (p.return.lines[2].locationId = "vendor")],
  ["missing location", (p) => delete p.return.lines[2].locationId],
  ["forged inventory writes", (p) => (p.stock_deltas = [{ delta: 999 }])],
  ["unknown allocation", (p) => (p.allocation_id = "missing")],
])
  test(`rejects ${label} with no partial writes or retained command claim`, async () => {
    const before = await snapshot();
    const invalid = payload();
    mutate(invalid);
    await assert.rejects(rpc(invalid));
    assert.deepEqual(await snapshot(), before);
    await rpc(payload());
  });

test("inactive locations and bins fail before any write", async () => {
  await db.exec("update warehouse.locations set active=false where id='wh'");
  await assert.rejects(rpc(payload()), /active/);
  await db.exec(
    "update warehouse.locations set active=true; update warehouse.storage_areas set active=false where id='bin'",
  );
  await assert.rejects(rpc(payload()), /active/);
  assert.equal((await snapshot()).returns, null);
});

test("a late database failure rolls back inventory, quality, movements and the command claim", async () => {
  await db.exec(`create function warehouse.fail_return_movement() returns trigger language plpgsql as $$ begin
    if new.product_id='device' then raise exception 'Injected movement failure'; end if; return new; end $$;
    create trigger fail_return_movement before insert on warehouse.movements for each row execute function warehouse.fail_return_movement();`);
  try {
    const before = await snapshot();
    await assert.rejects(rpc(payload()), /Injected movement failure/);
    assert.deepEqual(await snapshot(), before);
  } finally {
    await db.exec(
      "drop trigger fail_return_movement on warehouse.movements; drop function warehouse.fail_return_movement()",
    );
  }
  await rpc(payload());
});

test("current authentication and certification are required even for replay", async () => {
  await rpc(payload());
  const before = await snapshot();
  await db.exec("select set_config('test.live','off',false)");
  await assert.rejects(rpc(payload()), /Not authorized/);
  await db.exec(
    "select set_config('test.live','on',false),set_config('request.jwt.claim.sub','',false)",
  );
  await assert.rejects(rpc(payload()), /Authentication/);
  assert.deepEqual(await snapshot(), before);
});

test("a different command cannot return the same serial twice", async () => {
  await rpc(payload());
  const before = await snapshot();
  const again = payload();
  again.idempotency_key = "return-second-command";
  await assert.rejects(rpc(again), /issued serial/);
  assert.deepEqual(await snapshot(), before);
});

test("partial serialized allocation closes only after all issued serials return", async () => {
  await db.exec(
    "insert into warehouse.allocations(id,event_id,product_id,quantity,status) values('allocation','event','device',2,'issued')",
  );
  const one = payload();
  one.allocation_id = "allocation";
  one.return.lines = [one.return.lines[1]];
  await rpc(one);
  assert.equal((await snapshot()).allocations[0].status, "issued");
  const two = payload();
  two.idempotency_key = "return-allocation-second";
  two.allocation_id = "allocation";
  two.return.lines = [two.return.lines[2]];
  await rpc(two);
  assert.equal((await snapshot()).allocations[0].status, "returned");
  await rpc(one);
});

test("real ATP stays unchanged for pending serial returns and increases by one after exact QC acceptance", async () => {
  await db.exec(`insert into warehouse.inventory_units(id,product_id,serial_number,location_id,bin_id,status)
    select 'available-' || n, 'device', 'AVAILABLE-' || n, 'wh', 'bin', 'in_stock'
    from generate_series(1,15) n;
    insert into warehouse.allocations(id,event_id,product_id,quantity,status) values
      ('reserved-devices','event','device',2,'reserved'),
      ('allocated-device','event','device',1,'allocated');`);
  const availability = async () =>
    (
      await db.query(
        "select warehouse.available_to_promise('device') as device, warehouse.available_to_promise('bulk') as bulk",
      )
    ).rows[0];
  assert.deepEqual(await availability(), { device: 12, bulk: 10 });

  const returned = await rpc(payload());
  assert.deepEqual(await availability(), { device: 12, bulk: 10 });
  const pending = await snapshot();
  for (const serial of ["SERIAL-1", "SERIAL-2"]) {
    assert.equal(
      pending.units.find((unit) => unit.serial_number === serial).status,
      "in_stock",
    );
    assert.ok(
      pending.holds.some(
        (hold) =>
          hold.serial_number === serial &&
          hold.status === "active" &&
          hold.quantity === 1,
      ),
    );
  }
  assert.deepEqual(await rpc(payload()), returned);
  assert.deepEqual(await snapshot(), pending);
  assert.deepEqual(await availability(), { device: 12, bulk: 10 });

  const inspect = {
    idempotency_key: "quality-real-atp-serial-1",
    source_type: "return",
    source_id: returned.id,
    product_id: "device",
    serial_number: "SERIAL-1",
    bin_id: "bin",
    quantity: 1,
    disposition: "accepted",
  };
  const accepted = await rpc(inspect, "inspect_quality");
  assert.deepEqual(await availability(), { device: 13, bulk: 10 });
  const after = await snapshot();
  assert.ok(!after.holds.some((hold) => hold.serial_number === "SERIAL-1"));
  assert.ok(
    after.holds.some(
      (hold) =>
        hold.serial_number === "SERIAL-2" &&
        hold.status === "active" &&
        hold.quantity === 1,
    ),
  );
  assert.deepEqual(await rpc(inspect, "inspect_quality"), accepted);
  assert.deepEqual(await rpc(payload()), returned);
  assert.deepEqual(await snapshot(), after);
  assert.deepEqual(await availability(), { device: 13, bulk: 10 });
});

test("quality accepts one serial without releasing another and retains partial bulk custody", async () => {
  const returned = await rpc(payload());
  const inspect = {
    idempotency_key: "quality-return-serial-1",
    source_type: "return",
    source_id: returned.id,
    product_id: "device",
    serial_number: "SERIAL-1",
    bin_id: "bin",
    quantity: 1,
    disposition: "accepted",
  };
  const result = await rpc(inspect, "inspect_quality");
  const after = await snapshot();
  assert.ok(after.holds.some((h) => h.serial_number === "SERIAL-2"));
  assert.ok(!after.holds.some((h) => h.serial_number === "SERIAL-1"));
  assert.deepEqual(await rpc(inspect, "inspect_quality"), result);
  assert.deepEqual(await snapshot(), after);
  await rpc(
    {
      ...inspect,
      idempotency_key: "quality-return-bulk-1",
      product_id: "bulk",
      serial_number: null,
      quantity: 1,
    },
    "inspect_quality",
  );
  assert.equal(
    (await snapshot()).holds.find((h) => h.product_id === "bulk").quantity,
    2,
  );
  await rpc(
    {
      ...inspect,
      idempotency_key: "quality-return-bulk-2",
      product_id: "bulk",
      serial_number: null,
      quantity: 2,
      disposition: "hold",
      reason: "Needs review",
    },
    "inspect_quality",
  );
  const final = await snapshot();
  assert.equal(
    final.holds
      .filter((h) => h.product_id === "bulk")
      .reduce((sum, h) => sum + h.quantity, 0),
    2,
  );
  assert.equal(
    final.quality.filter(
      (q) => q.product_id === "bulk" && q.disposition === "pending",
    ).length,
    0,
  );
});

test("pre-integrity baseline v2 grants and receipt routing remain unchanged", async () => {
  const grants = (
    await db.query(`select has_function_privilege('anon','warehouse.record_return_v2(jsonb)','execute') anon,
    has_function_privilege('authenticated','warehouse.record_return_v2(jsonb)','execute') authenticated,
    has_function_privilege('authenticated','private.inspect_return_intake(jsonb)','execute') private,
    has_function_privilege('authenticated','warehouse.record_return(jsonb)','execute') legacy`)
  ).rows[0];
  assert.deepEqual(grants, {
    anon: false,
    authenticated: true,
    private: false,
    legacy: true,
  });
  const oldPayload = {
    unit_updates: [],
    stock_deltas: [],
    return: { id: "old-client" },
  };
  assert.deepEqual(await rpc(oldPayload, "record_return"), oldPayload);
  assert.deepEqual(await rpc({ source_type: "receipt" }, "inspect_quality"), {
    legacy: true,
  });
});
