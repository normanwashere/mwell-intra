import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migrationUrl = new URL(
  "../supabase/migrations/20260826170000_repair_uat_operations_evidence_links.sql",
  import.meta.url,
);

test("repairs unsafe UAT links and unreachable receiving evidence", async () => {
  const db = new PGlite();
  await db.exec(`
    create schema warehouse;
    create table warehouse.fulfillment_orders (
      id text primary key,
      delivery_link text,
      updated_at timestamptz not null default now(),
      constraint warehouse_fulfillment_delivery_link_check
        check (delivery_link is null or delivery_link ~* '^https?://')
    );
    create table warehouse.receipts (
      id text primary key,
      evidence_urls jsonb not null default '[]'::jsonb
    );
    create table warehouse.quality_inspections (
      id text primary key,
      source_id text not null,
      serial_number text not null,
      evidence_urls jsonb not null default '[]'::jsonb
    );
    insert into warehouse.fulfillment_orders(id, delivery_link) values
      ('unsafe', 'http://www.deliverylink.com/AAA-BBB'),
      ('safe', 'https://courier.example/WB-001');
    insert into warehouse.receipts(id, evidence_urls) values
      ('UAT-AUG24-RECEIPT-QC-PENDING', '["https://example.com/uat/receipts/UAT-AUG24-QC-PENDING"]');
    insert into warehouse.quality_inspections(id, source_id, serial_number, evidence_urls) values
      ('quality-1', 'UAT-AUG24-RECEIPT-QC-PENDING', 'UAT-A24-QC-POWER-0001', '["https://example.com/uat/quality/UAT-AUG24-QC-001"]'),
      ('quality-2', 'UAT-AUG24-RECEIPT-QC-PENDING', 'UAT-A24-QC-POWER-0002', '["https://example.com/uat/quality/UAT-AUG24-QC-002"]');
  `);

  const migration = (await readFile(migrationUrl, "utf8")).replace(
    /^lock table .*;$/gim,
    "",
  );
  await db.exec(migration);

  const orders = await db.query(
    "select id, delivery_link from warehouse.fulfillment_orders order by id",
  );
  assert.deepEqual(orders.rows, [
    { id: "safe", delivery_link: "https://courier.example/WB-001" },
    { id: "unsafe", delivery_link: null },
  ]);
  const receipt = await db.query(
    "select evidence_urls from warehouse.receipts where id='UAT-AUG24-RECEIPT-QC-PENDING'",
  );
  assert.deepEqual(receipt.rows[0].evidence_urls, [
    "/uat-evidence/aug24-qc-pending.svg",
  ]);
  const quality = await db.query(
    "select evidence_urls from warehouse.quality_inspections order by serial_number",
  );
  assert.deepEqual(quality.rows, [
    { evidence_urls: ["/uat-evidence/aug24-qc-functional-test.svg"] },
    { evidence_urls: ["/uat-evidence/aug24-qc-screen-defect.svg"] },
  ]);

  await assert.rejects(
    db.exec(
      "insert into warehouse.fulfillment_orders(id, delivery_link) values ('blocked', 'http://courier.example/WB-002')",
    ),
    /warehouse_fulfillment_delivery_link_check/i,
  );
  await db.close();
});
