import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const sql = readFileSync(
  resolve(
    "supabase",
    "migrations",
    "20260721200000_cross_department_wms_persistence.sql",
  ),
  "utf8",
);

const commands = [
  "create_fulfillment_order",
  "advance_fulfillment_order",
  "create_department_stock_request",
  "decide_department_stock_request",
  "create_customer_return_case",
  "resolve_customer_return_case",
  "create_kit_definition",
  "create_rekit_work_order",
  "complete_rekit_work_order",
];

test("exposes only audited public WMS command wrappers to authenticated users", () => {
  for (const command of commands) {
    assert.match(
      sql,
      new RegExp(
        `function warehouse\\.${command}\\(payload jsonb\\)[\\s\\S]*?security definer[\\s\\S]*?set search_path = ''`,
        "i",
      ),
    );
    assert.match(
      sql,
      new RegExp(
        `revoke all on function private\\.warehouse_${command}\\(jsonb\\) from public, anon, authenticated`,
        "i",
      ),
    );
    assert.match(
      sql,
      new RegExp(
        `grant execute on function private\\.warehouse_${command}\\(jsonb\\) to service_role`,
        "i",
      ),
    );
    assert.match(
      sql,
      new RegExp(
        `grant execute on function warehouse\\.${command}\\(jsonb\\) to authenticated, service_role`,
        "i",
      ),
    );
  }

  assert.doesNotMatch(
    sql,
    /grant execute on function private\.warehouse_[^(]+\(jsonb\) to authenticated/i,
  );
});

test("enforces product class, event, external inventory, and sales-value gates", () => {
  assert.match(sql, /core\.has_cap\('warehouse', 'request_fulfillment'\)/i);
  assert.match(sql, /core\.has_cap\('warehouse', 'request_stock'\)/i);
  assert.match(sql, /core\.has_cap\('warehouse', 'submit_return_case'\)/i);
  assert.match(sql, /p\.item_class in \('sellable_sku', 're_kitted_item'\)/i);
  assert.match(sql, /p\.item_class in \('sellable_sku', 'merchandise'\)/i);
  assert.match(sql, /An event is required for third-party sales/i);
  assert.match(sql, /A third-party location is required/i);
  assert.match(sql, /Gross sales amount is required for third-party sales/i);
});

test("keeps receiving, return quarantine, packaging, and re-kit writes auditable", () => {
  assert.match(sql, /actual_delivery_date date/i);
  assert.match(sql, /packaging_consumption/i);
  assert.match(sql, /A quarantine bin is required before resolution/i);
  assert.match(sql, /re_kit/i);
  assert.match(sql, /insert into core\.activity_log/i);
});
