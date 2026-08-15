import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const migrationDir = resolve("supabase", "migrations");

function launchBlockerMigration() {
  const matches = readdirSync(migrationDir).filter((name) =>
    name.endsWith("_operations_launch_blocker_slice.sql"),
  );
  assert.equal(
    matches.length,
    1,
    "expected one forward-only Operations migration",
  );
  return readFileSync(resolve(migrationDir, matches[0]), "utf8");
}

function attributableCycleCountMigration() {
  const matches = readdirSync(migrationDir).filter((name) =>
    name.endsWith("_require_attributable_cycle_count_actor.sql"),
  );
  assert.equal(
    matches.length,
    1,
    "expected one forward actor-attribution migration",
  );
  return readFileSync(resolve(migrationDir, matches[0]), "utf8");
}

test("separates receipt capture from inspection and exception creation from closure", () => {
  const sql = launchBlockerMigration();

  assert.match(sql, /add column if not exists received_by uuid/i);
  assert.match(sql, /before insert on warehouse\.receipts/i);
  assert.match(sql, /new\.received_by\s*:=\s*auth\.uid\(\)/i);
  assert.match(
    sql,
    /source_type\s*=\s*'receipt'[\s\S]*received_by[\s\S]*inspected_by[\s\S]*cannot inspect/i,
  );
  assert.match(sql, /before insert on warehouse\.quality_inspections/i);
  assert.match(
    sql,
    /before update of disposition on warehouse\.quality_inspections/i,
  );
  assert.match(
    sql,
    /function warehouse\.receive_procurement_po\(payload jsonb\)[\s\S]*set quality_status = 'pending'/i,
  );
  assert.match(
    sql,
    /defer_independent_receipt_inspection[\s\S]*'on'[\s\S]*warehouse_receive_procurement_po[\s\S]*'off'/i,
  );
  assert.match(sql, /Awaiting independent quality inspection/i);
  assert.match(
    sql,
    /old\.created_by\s*=\s*auth\.uid\(\)[\s\S]*resolved[\s\S]*waived[\s\S]*cancelled/i,
  );
  assert.match(sql, /before update on warehouse\.exceptions/i);
});

test("creates and submits an evidenced cycle count in one idempotent transaction", () => {
  const sql = launchBlockerMigration();
  const finalSql = attributableCycleCountMigration();

  assert.match(
    sql,
    /function warehouse\.create_and_submit_cycle_count\(payload jsonb\)/i,
  );
  assert.match(sql, /core\.has_live_cap\('warehouse',\s*'cycle_count'\)/i);
  assert.match(
    sql,
    /private\.begin_idempotent_command\([\s\S]*create_and_submit_cycle_count/i,
  );
  assert.match(sql, /jsonb_array_length\(v_evidence\)\s*=\s*0/i);
  assert.match(sql, /insert into warehouse\.cycle_counts/i);
  assert.match(sql, /private\.warehouse_submit_cycle_count\(/i);
  assert.match(sql, /private\.finish_idempotent_command\(/i);
  assert.match(
    sql,
    /grant execute on function warehouse\.create_and_submit_cycle_count\(jsonb\)/i,
  );
  assert.doesNotMatch(finalSql, /auth\.role\(\)/i);
  assert.match(
    finalSql,
    /auth\.uid\(\) is null[\s\S]*core\.has_live_cap\('warehouse',\s*'cycle_count'\)/i,
  );
});

test("leaves stock-change separation and Finance escalation implementations intact", () => {
  const sql = launchBlockerMigration();
  const allSql = readdirSync(migrationDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(resolve(migrationDir, name), "utf8"))
    .join("\n");

  assert.doesNotMatch(sql, /function private\.warehouse_decide_stock_change/i);
  assert.match(
    allSql,
    /private\.warehouse_decide_stock_change\(payload jsonb\)[\s\S]*requested_by\s*=\s*auth\.uid\(\)/i,
  );
  assert.match(
    allSql,
    /financial_impact\s*>\s*10000[\s\S]*approver_role[\s\S]*'finance'/i,
  );
});
