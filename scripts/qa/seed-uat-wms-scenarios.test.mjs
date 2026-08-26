import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  UAT_WMS_IDS,
  buildUatWmsScenarioFixtures,
} from "./uat-wms-scenario-fixtures.mjs";
import { validateUatWmsSeedInputs } from "./seed-uat-wms-scenarios.mjs";
import { renderUatWmsScenarioSql } from "./render-uat-wms-scenarios-sql.mjs";

const actors = {
  employee: "00000000-0000-4000-8000-000000000001",
  operationsAssociate: "00000000-0000-4000-8000-000000000002",
  operationsLead: "00000000-0000-4000-8000-000000000003",
  procurementLead: "00000000-0000-4000-8000-000000000004",
  finance: "00000000-0000-4000-8000-000000000005",
  marketing: "00000000-0000-4000-8000-000000000006",
  productOwner: "00000000-0000-4000-8000-000000000007",
};

function rowsFor(fixtures, schema, table) {
  return (
    fixtures.find(
      (fixture) => fixture.schema === schema && fixture.table === table,
    )?.rows ?? []
  );
}

test("builds the exact August 24 PO and putaway scenario", () => {
  const fixtures = buildUatWmsScenarioFixtures(actors);
  const pos = rowsFor(fixtures, "procurement", "purchase_orders");
  const requests = rowsFor(fixtures, "procurement", "requests");
  const bins = rowsFor(fixtures, "warehouse", "storage_areas");
  assert.deepEqual(
    pos.map((po) => po.po_number),
    ["0001", "0002", "0003"],
  );
  assert.equal(
    pos[0].lines.reduce((sum, line) => sum + line.quantity, 0),
    400,
  );
  assert.equal(pos[1].lines[0].quantity, 100);
  assert.equal(pos[2].lines[0].quantity, 100);
  assert.equal(requests.length, 3);
  assert.ok(requests.every((request) => request.category === "goods"));
  assert.deepEqual(
    pos.map((po) => po.request_id),
    requests.map((request) => request.id),
  );
  assert.deepEqual(
    new Set(bins.map((bin) => bin.code)),
    new Set([
      "A-01-01",
      "A-01-02",
      "A-01-03",
      "A-01-04",
      "F-01-02",
      "F-04-01",
      "Q-01-01",
    ]),
  );
});

test("covers every fulfillment stage and the August 24 channel scenarios", () => {
  const fixtures = buildUatWmsScenarioFixtures(actors);
  const orders = rowsFor(fixtures, "warehouse", "fulfillment_orders");
  assert.deepEqual(
    new Set(orders.map((order) => order.status)),
    new Set([
      "received",
      "allocated",
      "picking",
      "packing",
      "ready",
      "released",
      "completed",
      "cancelled",
    ]),
  );
  assert.ok(orders.some((order) => order.ecommerce_channel === "Eshop"));
  assert.ok(orders.some((order) => order.ecommerce_channel === "Shopify"));
  assert.ok(orders.some((order) => order.source === "third_party"));
  assert.ok(
    orders.some((order) => order.delivery_method === "internal_handover"),
  );
  assert.ok(
    orders.some((order) => order.shipment_status === "delivery_failed"),
  );
  assert.ok(
    orders.some((order) =>
      order.lines.some((orderLine) =>
        orderLine.bundleSetCodes?.includes("OTG-A-001"),
      ),
    ),
  );
});

test("includes open, decision, replacement, and closed return references", () => {
  const fixtures = buildUatWmsScenarioFixtures(actors);
  const returns = rowsFor(fixtures, "warehouse", "customer_return_cases");
  assert.deepEqual(
    new Set(returns.map((record) => record.status)),
    new Set(["submitted", "decision_required", "resolved", "closed"]),
  );
  assert.ok(
    returns.some(
      (record) =>
        record.resolution === "replacement" &&
        record.replacement_order_id === UAT_WMS_IDS.replacementOrder,
    ),
  );
  assert.ok(returns.some((record) => record.customer_closure_evidence_url));
});

test("attributes the Marketing Event A stock request to the Marketing actor", () => {
  const fixtures = buildUatWmsScenarioFixtures(actors);
  const requests = rowsFor(
    fixtures,
    "warehouse",
    "department_stock_requests",
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].requesting_department, "marketing");
  assert.equal(requests[0].requested_by, actors.marketing);
  assert.equal(requests[0].event_id, UAT_WMS_IDS.event);
});

test("refuses production and mismatched Supabase targets", () => {
  assert.throws(
    () =>
      validateUatWmsSeedInputs({
        url: "https://prodref.supabase.co",
        serviceKey: "secret",
        appEnv: "production",
        expectedProjectRef: "prodref",
        productionProjectRef: "prodref",
        mutationsApproved: true,
      }),
    /forbidden/i,
  );
  assert.throws(
    () =>
      validateUatWmsSeedInputs({
        url: "https://wrongref.supabase.co",
        serviceKey: "secret",
        appEnv: "uat",
        expectedProjectRef: "uatref",
        productionProjectRef: "prodref",
        mutationsApproved: true,
      }),
    /does not match/i,
  );
});

test("renders one transactional, conflict-safe SQL seed", () => {
  const sql = renderUatWmsScenarioSql();
  assert.match(sql, /^begin;/);
  assert.match(sql, /Required UAT actor profile is missing/);
  assert.match(sql, /insert into "procurement"\."purchase_orders"/);
  assert.match(sql, /insert into "warehouse"\."fulfillment_orders"/);
  assert.match(sql, /on conflict \("id"\) do nothing;/);
  assert.match(
    sql,
    /update procurement\.purchase_orders set request_id = 'UAT-AUG24-REQ-0001' where id = 'UAT-AUG24-PO-0001' and request_id is null;/,
  );
  assert.match(sql, /commit;/);
  assert.match(
    sql,
    /select id::text from core\.profiles where lower\(email\) = 'intra\.test\.operations\.associate@mwell\.com\.ph'/,
  );
  assert.match(
    sql,
    /update warehouse\.department_stock_requests set requested_by = \(select id from core\.profiles where lower\(email\) = 'intra\.test\.marketing\.events@mwell\.com\.ph'\) where id = 'a8245000-0000-4000-8000-000000000001';/,
  );
});

test("warehouse goods PO handoff uses an RLS-safe request predicate", () => {
  const migration = readFileSync(
    new URL(
      "../../supabase/migrations/20260824234441_repair_warehouse_goods_po_handoff_visibility.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    migration,
    /function private\.is_goods_procurement_request\(p_request_id text\)/,
  );
  assert.match(migration, /stable\s+security definer/);
  assert.match(
    migration,
    /core\.has_cap\('warehouse', 'receive_stock'\)[\s\S]*private\.is_goods_procurement_request\(request_id\)/,
  );
  assert.match(
    migration,
    /view warehouse\.procurement_po_handoff[\s\S]*private\.is_goods_procurement_request\(purchase_order\.request_id\)/,
  );
});
