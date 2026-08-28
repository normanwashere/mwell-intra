import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260828015022_marketing_event_reservation_access.sql",
    import.meta.url,
  ),
  "utf8",
);
const db = new PGlite();
const snapshot = async () =>
  (
    await db.query(
      "select module, role, cap from core.role_capabilities order by module, role, cap",
    )
  ).rows;
let original;

before(async () => {
  await db.exec(`
    create schema core;
    create table core.roles (module text, role text, primary key(module, role));
    create table core.capabilities (module text, cap text, primary key(module, cap));
    create table core.role_capabilities (
      module text, role text, cap text, primary key(module, role, cap),
      foreign key(module, role) references core.roles,
      foreign key(module, cap) references core.capabilities
    );
    insert into core.roles values ('warehouse','marketing'), ('warehouse','warehouse_operator'), ('warehouse','warehouse_supervisor');
    insert into core.capabilities values
      ('warehouse','request_stock'), ('warehouse','view_dashboard'),
      ('warehouse','view_inventory'), ('warehouse','reserve_allocate'),
      ('warehouse','issue_items'), ('warehouse','approve_stock_adjustment');
    insert into core.role_capabilities values
      ('warehouse','marketing','request_stock'),
      ('warehouse','marketing','view_dashboard'),
      ('warehouse','marketing','view_inventory'),
      ('warehouse','warehouse_operator','issue_items'),
      ('warehouse','warehouse_supervisor','approve_stock_adjustment');
  `);
  original = await snapshot();
});
after(() => db.close());

test("adds only Marketing reserve_allocate, preserving all existing grants", async () => {
  await db.exec(migration);
  const rows = await snapshot();
  assert.equal(rows.length, original.length + 1);
  assert.deepEqual(
    rows.filter((row) => row.role !== "marketing"),
    original.filter((row) => row.role !== "marketing"),
  );
  assert.deepEqual(
    rows.filter((row) => row.role === "marketing").map((row) => row.cap),
    ["request_stock", "reserve_allocate", "view_dashboard", "view_inventory"],
  );
});

test("reapplying the source is idempotent and adds no issue or approval authority", async () => {
  await db.exec(migration);
  const before = await snapshot();
  await db.exec(migration);
  assert.deepEqual(await snapshot(), before);
  assert.equal(
    before.some(
      (row) =>
        row.role === "marketing" && /issue|approv|return|quality/.test(row.cap),
    ),
    false,
  );
});
