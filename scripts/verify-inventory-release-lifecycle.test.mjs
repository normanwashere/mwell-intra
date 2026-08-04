import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const sql = readFileSync(
  resolve(
    "supabase",
    "migrations",
    "20260804150000_inventory_release_lifecycle_remediation.sql",
  ),
  "utf8",
);
const hardeningSql = readFileSync(
  resolve(
    "supabase",
    "migrations",
    "20260804153000_inventory_release_lifecycle_index_hardening.sql",
  ),
  "utf8",
);
const rlsHardeningSql = readFileSync(
  resolve(
    "supabase",
    "migrations",
    "20260804154500_inventory_release_rls_performance.sql",
  ),
  "utf8",
);

test("persists accountable fulfillment handoffs and explicit reservations", () => {
  assert.match(sql, /delivery_method text/i);
  assert.match(sql, /handover_recipient_name text/i);
  assert.match(sql, /packed_by uuid/i);
  assert.match(sql, /acknowledged_by uuid/i);
  assert.match(sql, /create table warehouse\.fulfillment_reservations/i);
  assert.match(sql, /A second warehouse operator must release/i);
});

test("synchronizes request status with the linked fulfillment lifecycle", () => {
  assert.match(
    sql,
    /create or replace function warehouse\.sync_department_request_status/i,
  );
  assert.match(sql, /when 'allocated' then 'allocated'/i);
  assert.match(sql, /when 'released' then 'issued'/i);
  assert.match(sql, /when 'completed' then 'closed'/i);
});

test("governs internal demand, backorders, acknowledgments, and cancellations", () => {
  assert.match(sql, /core\.department_cost_centers/i);
  assert.match(sql, /event_material/i);
  assert.match(sql, /split_backorder/i);
  assert.match(sql, /acknowledge_receipt/i);
  assert.match(sql, /packaging_disposition/i);
  assert.match(sql, /Cancelled after packing/i);
});

test("covers new foreign-key access paths reported by the database advisor", () => {
  for (const indexName of [
    "department_cost_centers_created_by_idx",
    "department_cost_centers_updated_by_idx",
    "fulfillment_orders_picked_by_idx",
    "fulfillment_reservations_bin_idx",
    "fulfillment_reservations_created_by_idx",
    "fulfillment_reservations_location_idx",
  ]) {
    assert.match(hardeningSql, new RegExp(indexName, "i"));
  }
});

test("evaluates the reservation requester identity once per query", () => {
  assert.match(rlsHardeningSql, /select auth\.uid\(\)/i);
  assert.doesNotMatch(rlsHardeningSql, /= auth\.uid\(\)/i);
});
