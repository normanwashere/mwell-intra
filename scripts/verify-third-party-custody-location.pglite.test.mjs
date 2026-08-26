import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationsUrl = new URL("../supabase/migrations/", import.meta.url);
const fulfillmentMigrationUrl = new URL(
  "../supabase/migrations/20260817121220_ecommerce_fulfillment_intake_and_directed_pick.sql",
  import.meta.url,
);

async function custodyMigrationUrl() {
  const names = await readdir(migrationsUrl);
  const name = names.find((candidate) =>
    candidate.endsWith("_third_party_custody_location_validation.sql"),
  );
  assert.ok(name, "third-party custody validation migration is required");
  return new URL(name, migrationsUrl);
}

async function custodyLifecycleMigrationUrl() {
  const names = await readdir(migrationsUrl);
  const name = names.find((candidate) =>
    candidate.endsWith("_third_party_custody_lifecycle_guard.sql"),
  );
  assert.ok(name, "third-party custody lifecycle guard migration is required");
  return new URL(name, migrationsUrl);
}

async function custodyConvergenceMigrationUrl() {
  const names = await readdir(migrationsUrl);
  const name = names.find((candidate) =>
    candidate.endsWith("_converge_third_party_custody_locking.sql"),
  );
  assert.ok(name, "third-party custody locking convergence migration is required");
  return new URL(name, migrationsUrl);
}

async function createDatabase({ existingInvalid } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema core;
    create schema private;
    create schema warehouse;

    create function auth.uid() returns uuid language sql stable as $$
      select '11111111-1111-4111-8111-111111111111'::uuid
    $$;
    create function core.has_cap(module_name text, capability_name text)
    returns boolean language sql stable as $$ select true $$;

    create table warehouse.locations (
      id text primary key,
      name text not null,
      type text not null
    );
    create table warehouse.fulfillment_orders (
      id uuid primary key,
      source text not null,
      third_party_location_id text,
      status text not null default 'received'
    );

    create function private.warehouse_create_fulfillment_order(payload jsonb)
    returns jsonb language plpgsql security definer set search_path = '' as $$
    declare v_order warehouse.fulfillment_orders;
    begin
      if not (
        core.has_cap('warehouse', 'request_fulfillment')
        or core.has_cap('events', 'request_fulfillment')
      ) then raise exception 'Not authorized: create fulfillment order'; end if;
      insert into warehouse.fulfillment_orders(id, source, third_party_location_id)
      values (
        (payload->>'order_id')::uuid,
        payload->>'source',
        nullif(payload->>'third_party_location_id', '')
      ) returning * into v_order;
      return to_jsonb(v_order);
    end $$;
    revoke all on function private.warehouse_create_fulfillment_order(jsonb)
      from public, anon, authenticated;
    grant execute on function private.warehouse_create_fulfillment_order(jsonb)
      to service_role;

    create function warehouse.create_fulfillment_order(payload jsonb)
    returns jsonb language sql security definer set search_path = '' as $$
      select private.warehouse_create_fulfillment_order(payload)
    $$;
    revoke all on function warehouse.create_fulfillment_order(jsonb)
      from public, anon;
    grant execute on function warehouse.create_fulfillment_order(jsonb)
      to authenticated, service_role;

    insert into warehouse.locations(id, name, type) values
      ('loc-event', 'Active event site', 'event_site'),
      ('loc-vendor', 'Active vendor custody', 'vendor'),
      ('loc-warehouse', 'Internal warehouse', 'warehouse'),
      ('loc-inactive', 'Inactive event site', 'event_site');
  `);

  if (existingInvalid) {
    await db.query(
      `insert into warehouse.fulfillment_orders(id, source, third_party_location_id)
       values ($1, 'third_party', $2)`,
      [existingInvalid.orderId, existingInvalid.locationId],
    );
  }

  await db.exec(await readFile(await custodyMigrationUrl(), "utf8"));
  if (existingInvalid?.locationId === "loc-inactive") {
    await db.query(
      "update warehouse.locations set active = false where id = 'loc-inactive'",
    );
  }
  await db.exec(await readFile(await custodyLifecycleMigrationUrl(), "utf8"));
  if (!existingInvalid) {
    await db.query(
      "update warehouse.locations set active = false where id = 'loc-inactive'",
    );
  }
  await db.exec(await readFile(await custodyConvergenceMigrationUrl(), "utf8"));
  return db;
}

function payload(sequence, source, thirdPartyLocationId) {
  return {
    order_id: `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
    source,
    ...(thirdPartyLocationId === undefined
      ? {}
      : { third_party_location_id: thirdPartyLocationId }),
  };
}

async function createOrder(db, orderPayload) {
  return db.query(
    "select warehouse.create_fulfillment_order($1::jsonb) as result",
    [JSON.stringify(orderPayload)],
  );
}

test("migration source keeps the existing fulfillment RPC protections intact", async () => {
  const [migration, fulfillmentMigration] = await Promise.all([
    readFile(await custodyMigrationUrl(), "utf8"),
    readFile(fulfillmentMigrationUrl, "utf8"),
  ]);

  assert.match(
    migration,
    /add column if not exists active boolean not null default true/i,
  );
  assert.match(migration, /new\.source = 'third_party'/i);
  assert.match(migration, /location\.type in \('event_site', 'vendor'\)/i);
  assert.match(migration, /location\.active/i);
  assert.match(
    migration,
    /function private\.warehouse_enforce_third_party_custody_location\(\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i,
  );
  assert.match(
    migration,
    /revoke all on function private\.warehouse_enforce_third_party_custody_location\(\)[\s\S]*?from public, anon, authenticated/i,
  );
  assert.doesNotMatch(
    migration,
    /create or replace function warehouse\.create_fulfillment_order/i,
  );
  assert.match(
    fulfillmentMigration,
    /create or replace function warehouse\.create_fulfillment_order\(payload jsonb\)[\s\S]*?security definer[\s\S]*?set search_path = ''/i,
  );
  assert.match(
    fulfillmentMigration,
    /revoke all on function warehouse\.create_fulfillment_order\(jsonb\)[\s\S]*?from public, anon/i,
  );
  assert.match(
    fulfillmentMigration,
    /grant execute on function warehouse\.create_fulfillment_order\(jsonb\)[\s\S]*?to authenticated, service_role/i,
  );
});

test("RPC rejects missing, warehouse, inactive, and unknown third-party custody", async () => {
  const db = await createDatabase();
  const invalidLocations = [
    [undefined, /third-party location is required/i],
    ["loc-warehouse", /active event site or vendor custody location/i],
    ["loc-inactive", /active event site or vendor custody location/i],
    ["loc-unknown", /active event site or vendor custody location/i],
  ];

  for (const [index, [locationId, expected]] of invalidLocations.entries()) {
    await assert.rejects(
      createOrder(db, payload(index + 1, "third_party", locationId)),
      expected,
    );
  }

  const count = await db.query(
    "select count(*)::integer as count from warehouse.fulfillment_orders",
  );
  assert.equal(count.rows[0].count, 0);
  await db.close();
});

test("RPC accepts active event-site and vendor custody and leaves other sources compatible", async () => {
  const db = await createDatabase();

  await createOrder(db, payload(10, "third_party", "loc-event"));
  await createOrder(db, payload(11, "third_party", "loc-vendor"));
  await createOrder(db, payload(12, "ecommerce", "loc-unknown"));

  const created = await db.query(
    `select source, third_party_location_id
       from warehouse.fulfillment_orders
      order by id`,
  );
  assert.deepEqual(created.rows, [
    { source: "third_party", third_party_location_id: "loc-event" },
    { source: "third_party", third_party_location_id: "loc-vendor" },
    { source: "ecommerce", third_party_location_id: "loc-unknown" },
  ]);
  await db.close();
});

test("active third-party custody blocks location deactivation and reclassification", async () => {
  const db = await createDatabase();
  await createOrder(db, payload(20, "third_party", "loc-event"));

  await assert.rejects(
    db.query("update warehouse.locations set active = false where id = 'loc-event'"),
    /cannot deactivate or reclassify.*nonterminal third-party fulfillment custody/i,
  );
  await assert.rejects(
    db.query("update warehouse.locations set type = 'warehouse' where id = 'loc-event'"),
    /cannot deactivate or reclassify.*nonterminal third-party fulfillment custody/i,
  );

  const location = await db.query(
    "select type, active from warehouse.locations where id = 'loc-event'",
  );
  assert.deepEqual(location.rows, [{ type: "event_site", active: true }]);
  await db.close();
});

test("released third-party custody remains protected until completion", async () => {
  const db = await createDatabase();
  const order = payload(21, "third_party", "loc-vendor");
  await createOrder(db, order);
  await db.query(
    "update warehouse.fulfillment_orders set status = 'released' where id = $1",
    [order.order_id],
  );

  await assert.rejects(
    db.query("update warehouse.locations set active = false where id = 'loc-vendor'"),
    /nonterminal third-party fulfillment custody/i,
  );
  await db.close();
});

test("rename and terminal custody changes remain available to administrators", async () => {
  const db = await createDatabase();
  const completed = payload(22, "third_party", "loc-event");
  const cancelled = payload(23, "third_party", "loc-vendor");
  await createOrder(db, completed);
  await createOrder(db, cancelled);

  await db.query(
    "update warehouse.locations set name = 'Renamed event site' where id = 'loc-event'",
  );
  await db.query(
    "update warehouse.fulfillment_orders set status = 'completed' where id = $1",
    [completed.order_id],
  );
  await db.query(
    "update warehouse.fulfillment_orders set status = 'cancelled' where id = $1",
    [cancelled.order_id],
  );
  await db.query("update warehouse.locations set active = false where id = 'loc-event'");
  await db.query("update warehouse.locations set type = 'warehouse' where id = 'loc-vendor'");

  const locations = await db.query(
    "select id, name, type, active from warehouse.locations where id in ('loc-event', 'loc-vendor') order by id",
  );
  assert.deepEqual(locations.rows, [
    { id: "loc-event", name: "Renamed event site", type: "event_site", active: false },
    { id: "loc-vendor", name: "Active vendor custody", type: "warehouse", active: true },
  ]);
  await db.close();
});

test("convergence migration uses a row lock that conflicts with active/type updates", async () => {
  const migration = await readFile(await custodyConvergenceMigrationUrl(), "utf8");

  assert.match(
    migration,
    /function private\.warehouse_enforce_third_party_custody_location\(\)[\s\S]*?for share/i,
  );
  assert.doesNotMatch(migration, /for key share/i);
  assert.match(
    migration,
    /lock table warehouse\.fulfillment_orders in share row exclusive mode[\s\S]*?lock table warehouse\.locations in share row exclusive mode/i,
  );
});

for (const invalid of [
  {
    label: "missing",
    orderId: "00000000-0000-4000-8000-000000000031",
    locationId: "loc-unknown",
  },
  {
    label: "inactive",
    orderId: "00000000-0000-4000-8000-000000000032",
    locationId: "loc-inactive",
  },
  {
    label: "non-event/vendor",
    orderId: "00000000-0000-4000-8000-000000000033",
    locationId: "loc-warehouse",
  },
]) {
  test(`convergence fails closed for an existing ${invalid.label} custody location`, async () => {
    await assert.rejects(
      createDatabase({ existingInvalid: invalid }),
      new RegExp(
        `third-party custody convergence blocked: 1 nonterminal order.*${invalid.orderId}.*${invalid.locationId}`,
        "i",
      ),
    );
  });
}

test("convergence source includes an actionable bounded preflight", async () => {
  const migration = await readFile(await custodyConvergenceMigrationUrl(), "utf8");

  assert.match(migration, /status not in \('completed', 'cancelled'\)/i);
  assert.match(migration, /location\.id is null/i);
  assert.match(migration, /not location\.active/i);
  assert.match(migration, /location\.type not in \('event_site', 'vendor'\)/i);
  assert.match(migration, /sample_rank <= 10/i);
  assert.match(migration, /reassign or close these orders, then rerun the migration/i);
});
