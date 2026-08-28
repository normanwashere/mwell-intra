import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const actor = "11111111-1111-4111-8111-111111111111";
const otherActor = "22222222-2222-4222-8222-222222222222";
const migration = (name) =>
  readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const functionSql = (sql, name) => {
  const start = sql.indexOf(`create or replace function ${name}(`);
  assert.notEqual(start, -1, name);
  const body = sql.indexOf("as $$", start);
  return sql.slice(start, sql.indexOf("$$;", body + 5) + 3);
};
const payload = () => ({
  idempotency_key: "reservation-batch-0001",
  event_id: "event",
  lines: [
    { product_id: "bulk", quantity: 3, promotional: false },
    { product_id: "device", quantity: 1, promotional: true },
  ],
});
const rpc = async (input = payload()) =>
  (
    await db.query("select warehouse.reserve_batch($1::jsonb) result", [
      JSON.stringify(input),
    ])
  ).rows[0].result;
const allocations = async () =>
  (await db.query("select * from warehouse.allocations order by id")).rows;

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema core; create schema private;
    create table core.profiles(id uuid primary key);
    insert into core.profiles values('${actor}'),('${otherActor}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function core.has_live_cap(text,text) returns boolean language sql stable as $$
      select $1='warehouse' and $2='reserve_allocate' and current_setting('test.cap',true)='on' $$;
    create function private.warehouse_payload_hash(jsonb) returns text language sql as $$ select encode(sha256(convert_to($1::text,'UTF8')),'hex') $$;
  `);
  await db.exec(
    (await migration("20260706092000_warehouse_schema.sql")).replace(
      'create extension if not exists "pgcrypto";',
      "",
    ),
  );
  const controls = await migration(
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
  const commands = await migration(
    "20260710160000_warehouse_w1_quality_and_approval_rpcs.sql",
  );
  await db.exec(functionSql(commands, "private.begin_idempotent_command"));
  await db.exec(functionSql(commands, "private.finish_idempotent_command"));
  await db.exec(
    functionSql(
      await migration("20260714175318_single_po_receipt_authority.sql"),
      "private.lock_warehouse_products",
    ),
  );
  await db.exec(
    functionSql(
      await migration("20260718201000_refresh_atp_inside_product_lock.sql"),
      "warehouse.available_to_promise",
    ),
  );
  await db.exec(`
    alter table warehouse.command_log enable row level security;
    alter table warehouse.command_log force row level security;
    alter table warehouse.allocations enable row level security;
    grant usage on schema warehouse to authenticated, anon;
    grant select, insert on warehouse.allocations, warehouse.command_log to authenticated;
  `);
  await db.exec(
    await migration("20260714160000_command_log_explicit_client_deny.sql"),
  );
  await db.exec(
    await migration("20260828060000_atomic_event_reservations.sql"),
  );
});

beforeEach(async () => {
  await db.exec(`reset role;
    truncate warehouse.command_log,warehouse.allocations,warehouse.stock_levels,warehouse.inventory_units,warehouse.inventory_holds,warehouse.vendor_returns,warehouse.quality_inspections;
    select set_config('request.jwt.claim.sub','${actor}',false),set_config('test.cap','on',false);
    insert into warehouse.products(id,sku,name,category,serialized) values('bulk','B','Bulk','merchandise',false),('device','D','Device','device',true) on conflict do nothing;
    insert into warehouse.locations(id,name,type) values('wh','Warehouse','warehouse') on conflict do nothing;
    insert into warehouse.events(id,name,type,start_date) values('event','Event','wellness',current_date) on conflict do nothing;
    insert into warehouse.stock_levels(product_id,location_id,quantity) values('bulk','wh',10);
    insert into warehouse.inventory_units(id,product_id,serial_number,location_id,status) values('u1','device','S1','wh','in_stock');
  `);
});
after(() => db.close());

test("authenticated reservation commits every line and replays after ATP changes", async () => {
  await db.exec("set role authenticated");
  const first = await rpc();
  assert.equal(first.status, "committed");
  assert.equal(first.allocations.length, 2);
  assert.deepEqual(
    first.allocations.map((row) => row.promotional),
    [false, true],
  );
  assert.deepEqual(await rpc(), first);
  await assert.rejects(
    rpc({ ...payload(), lines: [payload().lines[0]] }),
    /different payload/,
  );
  await db.exec("reset role");
  assert.equal((await allocations()).length, 2);
  const log = (
    await db.query("select actor_id,response from warehouse.command_log")
  ).rows;
  assert.equal(log.length, 1);
  assert.equal(log[0].actor_id, actor);
  assert.deepEqual(log[0].response, first);
});

test("later failure and aggregate over-demand leave no partial reservation; rejection is replayable", async () => {
  const input = payload();
  input.lines[1].quantity = 2;
  const result = await rpc(input);
  assert.equal(result.status, "rejected");
  assert.equal((await allocations()).length, 0);
  await db.exec(
    "insert into warehouse.inventory_units(id,product_id,serial_number,location_id,status) values('u2','device','S2','wh','in_stock')",
  );
  assert.deepEqual(await rpc(input), result);
  const combined = {
    ...payload(),
    idempotency_key: "aggregate-demand-0001",
    lines: [
      { product_id: "bulk", quantity: 6, promotional: false },
      { product_id: "bulk", quantity: 5, promotional: true },
    ],
  };
  assert.equal((await rpc(combined)).status, "rejected");
  assert.equal((await allocations()).length, 0);
});

test("queued same-key requests replay and later competing intents respect ATP", async () => {
  // PGlite serializes one connection; this does not exercise cross-session lock contention.
  const results = await Promise.all([rpc(), rpc()]);
  assert.deepEqual(results[0], results[1]);
  const competing = await rpc({
    ...payload(),
    idempotency_key: "competing-intent-0001",
  });
  assert.equal(competing.status, "rejected");
  assert.equal((await allocations()).length, 2);
});

test("a failure during the second insert rolls back the first insert", async () => {
  await db.exec(`create function warehouse.reject_test_line() returns trigger language plpgsql as $$ begin
    if new.product_id='device' then raise exception 'Second line rejected'; end if; return new; end $$;
    create trigger reject_test_line before insert on warehouse.allocations for each row execute function warehouse.reject_test_line();`);
  try {
    assert.equal((await rpc()).status, "rejected");
    assert.equal((await allocations()).length, 0);
  } finally {
    await db.exec(
      "drop trigger reject_test_line on warehouse.allocations; drop function warehouse.reject_test_line()",
    );
  }
});

test("holds reduce availability", async () => {
  await db.exec(`with inspection as (
    insert into warehouse.quality_inspections(source_type,source_id,product_id,location_id,quantity,disposition,inspected_by,inspected_by_email)
    values('receipt','fixture','bulk','wh',9,'hold','${actor}','quality@test.invalid') returning id
  ) insert into warehouse.inventory_holds(inspection_id,product_id,location_id,quantity,status,reason,created_by)
    select id,'bulk','wh',9,'active','Quality','${actor}' from inspection`);
  assert.equal((await rpc()).status, "rejected");
  assert.equal((await allocations()).length, 0);
});

test("auth, live capability, RLS and grants cannot be bypassed with client actor fields", async () => {
  await db.exec("select set_config('request.jwt.claim.sub','',false)");
  await assert.rejects(rpc(), /Authentication required/);
  await db.exec(
    `select set_config('request.jwt.claim.sub','${actor}',false),set_config('test.cap','off',false)`,
  );
  await assert.rejects(rpc(), /Not authorized/);
  await db.exec("set role anon");
  await assert.rejects(rpc(), /permission denied/);
  await db.exec("reset role; set role authenticated");
  await assert.rejects(
    db.exec(
      "insert into warehouse.allocations(id,event_id,product_id,quantity,status) values('spoof','event','bulk',1,'reserved')",
    ),
    /row-level security/,
  );
  await assert.rejects(
    db.exec(
      `insert into warehouse.command_log(actor_id,command_name,idempotency_key,payload_hash) values('${actor}','reserve_batch','spoof-key-0001',repeat('a',64))`,
    ),
    /row-level security/,
  );
  await db.exec("reset role; select set_config('test.cap','on',false)");
  await rpc({ ...payload(), actor_id: otherActor });
  assert.equal(
    (await db.query("select actor_id from warehouse.command_log")).rows[0]
      .actor_id,
    actor,
  );
  await db.exec("select set_config('test.cap','off',false)");
  await assert.rejects(
    rpc({ ...payload(), actor_id: otherActor }),
    /Not authorized/,
  );
});

test("command keys are scoped to the authenticated actor", async () => {
  const input = { ...payload(), lines: [payload().lines[0]] };
  const first = await rpc(input);
  await db.exec(
    `select set_config('request.jwt.claim.sub','${otherActor}',false)`,
  );
  const second = await rpc(input);
  assert.notEqual(first.allocations[0].id, second.allocations[0].id);
  assert.equal((await allocations()).length, 2);
});

for (const patch of [
  { quantity: 0 },
  { quantity: 1.5 },
  { quantity: "1" },
  { product_id: "missing" },
  { promotional: "true" },
]) {
  test(`validates line fields: ${JSON.stringify(patch)}`, async () => {
    const input = payload();
    Object.assign(input.lines[1], patch);
    assert.equal((await rpc(input)).status, "rejected");
    assert.equal((await allocations()).length, 0);
  });
}

test("uses the shared ordered product lock and volatile ATP before inserts", async () => {
  const sql = await migration("20260828060000_atomic_event_reservations.sql");
  assert.ok(
    sql.indexOf("private.lock_warehouse_products") <
      sql.indexOf("warehouse.available_to_promise"),
  );
  assert.ok(
    sql.indexOf("warehouse.available_to_promise") <
      sql.indexOf("insert into warehouse.allocations"),
  );
  assert.equal(
    (
      await db.query(
        "select provolatile from pg_proc where oid='warehouse.available_to_promise(text)'::regprocedure",
      )
    ).rows[0].provolatile,
    "v",
  );
});
