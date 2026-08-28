import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { after, before, beforeEach, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrations = new URL("../supabase/migrations/", import.meta.url);
const original = await readFile(
  new URL(
    "20260804150000_inventory_release_lifecycle_remediation.sql",
    migrations,
  ),
  "utf8",
);
const originalFunction = original.match(
  /create or replace function private\.warehouse_advance_fulfillment_order_v2\(payload jsonb\)[\s\S]*?\n\$\$;/,
)[0];
let db;
const orderId = "11111111-1111-4111-8111-111111111111";
const lines = [
  { productId: "a", quantity: 4, pickedQuantity: 0 },
  { productId: "b", quantity: 2, pickedQuantity: 0 },
];
const selections = (a, b) => [
  { productId: "a", quantity: a },
  { productId: "b", quantity: b },
];
const split = (fulfilledLines, key = "split-1") =>
  db.query(
    "select private.warehouse_advance_fulfillment_order_v2($1::jsonb) as result",
    [
      JSON.stringify({
        order_id: orderId,
        action: "split_backorder",
        idempotency_key: key,
        fulfilled_lines: fulfilledLines,
      }),
    ],
  );
const snapshot = async () =>
  (
    await db.query(
      "select to_jsonb(o) as value from warehouse.fulfillment_orders o order by external_reference",
    )
  ).rows;

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema private; create schema warehouse; create schema core; create schema auth;
    create function auth.uid() returns uuid language sql as $$ select '${orderId}'::uuid $$;
    create function core.has_cap(text, text) returns boolean language sql as $$ select coalesce(current_setting('test.allowed', true), 'true') <> 'false' $$;
    create table warehouse.stock_levels (product_id text, location_id text, bin_id text, lot_id text, quantity integer);
    create table warehouse.fulfillment_orders (
      id uuid primary key default gen_random_uuid(), source text, external_reference text,
      requesting_department text, source_location_id text, source_bin_id text, customer_reference text,
      event_id text, third_party_location_id text, gross_sales_amount numeric, status text,
      lines jsonb, packaging jsonb, created_by uuid, parent_order_id uuid,
      updated_at timestamptz default now()
    );
    create table core.activity_log (module text, entity_type text, entity_id uuid, action text, actor uuid, detail jsonb);
    create table private.test_commands (id uuid default gen_random_uuid(), key text primary key, payload jsonb, response jsonb);
    create function private.begin_idempotent_command(name text, key text, payload jsonb) returns jsonb language plpgsql as $$
    declare command private.test_commands;
    begin
      select * into command from private.test_commands c where c.key = begin_idempotent_command.key;
      if found then
        if command.payload <> payload then raise exception 'Idempotency payload changed'; end if;
        return jsonb_build_object('replayed', true, 'response', command.response);
      end if;
      insert into private.test_commands(key, payload) values (key, payload) returning * into command;
      return jsonb_build_object('replayed', false, 'command_id', command.id);
    end $$;
    create function private.finish_idempotent_command(command_id uuid, result jsonb) returns jsonb language plpgsql as $$
    begin
      update private.test_commands set response = result where id = command_id;
      return result;
    end $$;
  `);
  await db.exec(originalFunction);
  const name = (await readdir(migrations)).find((name) =>
    name.endsWith("_fulfillment_zero_line_backorder.sql"),
  );
  if (name && !process.env.FULFILLMENT_BACKORDER_BASELINE)
    await db.exec(await readFile(new URL(name, migrations), "utf8"));
});

beforeEach(async () => {
  await db.exec(
    "truncate warehouse.fulfillment_orders, private.test_commands, core.activity_log; set test.allowed = 'true';",
  );
  await db.query(
    "insert into warehouse.fulfillment_orders(id, source, external_reference, status, lines, packaging) values ($1, 'event', 'SPLIT', 'received', $2::jsonb, '[]')",
    [orderId, JSON.stringify(lines)],
  );
});
after(async () => {
  await db?.close();
});

test("zero fulfill-now lines move entirely to the linked backorder with replay safety", async () => {
  const first = await split(selections(3, 0));
  assert.deepEqual(first.rows[0].result.lines, [{ ...lines[0], quantity: 3 }]);
  const orders = (await snapshot()).map((row) => row.value);
  assert.equal(orders.length, 2);
  assert.equal(orders[1].parent_order_id, orderId);
  assert.deepEqual(orders[1].lines, [{ ...lines[0], quantity: 1 }, lines[1]]);
  assert.deepEqual(await split(selections(3, 0)), first);
  assert.equal((await snapshot()).length, 2);
  assert.equal(
    (await db.query("select count(*)::int as count from core.activity_log"))
      .rows[0].count,
    1,
  );
});

test("invalid splits leave orders and command records unchanged", async () => {
  const before = await snapshot();
  const invalid = [
    selections(0, 0),
    selections(4, 2),
    selections(3, -1),
    selections(3, 3),
    selections(3, 1.5),
    selections(3, null),
    selections(3, "1"),
    [{ productId: "a", quantity: 3 }],
    [...selections(3, 1), { productId: "b", quantity: 1 }],
    [...selections(3, 1), { productId: "unknown", quantity: 1 }],
  ];
  for (const [index, selection] of invalid.entries()) {
    await assert.rejects(
      split(selection, `invalid-${index}`),
      undefined,
      JSON.stringify(selection),
    );
    assert.deepEqual(await snapshot(), before);
  }
  assert.equal(
    (await db.query("select count(*)::int as count from private.test_commands"))
      .rows[0].count,
    0,
  );
});

test("retains existing positive partial split behavior", async () => {
  await split(selections(3, 1));
  const orders = (await snapshot()).map((row) => row.value);
  assert.deepEqual(orders[0].lines, [
    { ...lines[0], quantity: 3 },
    { ...lines[1], quantity: 1 },
  ]);
  assert.deepEqual(orders[1].lines, [
    { ...lines[0], quantity: 1 },
    { ...lines[1], quantity: 1 },
  ]);
});

test("retains capability and received-state checks", async () => {
  await db.exec("set test.allowed = 'false'");
  await assert.rejects(split(selections(3, 1)), /Not authorized/);
  await db.exec(
    "set test.allowed = 'true'; update warehouse.fulfillment_orders set status = 'allocated'",
  );
  await assert.rejects(split(selections(3, 1)), /Only received demand/);
  assert.equal((await snapshot()).length, 1);
});
