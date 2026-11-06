import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createRepository } from "../createRepository";
import { buildSeed } from "../seed";
import { productToRow } from "./mappers";
import { activeReadRelation } from "./activeReadRelation";

type RequestRecord = { table: string; method: string; url: URL; headers: Headers; body: unknown };

function harness(respond: (request: RequestRecord) => Response = () => Response.json([])) {
  const requests: RequestRecord[] = [];
  const client = createClient("https://archive.invalid", "test-anon-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const request = {
        table: url.pathname.split("/").at(-1)!, method: init?.method ?? "GET", url,
        headers: new Headers(init?.headers), body: init?.body ? JSON.parse(String(init.body)) : null,
      };
      requests.push(request);
      return respond(request);
    } },
  });
  return { repo: createRepository({ supabaseClient: client }).repo, requests };
}

describe("archive-aware warehouse REST reads", () => {
  it("uses the Warehouse-only active procurement handoff without changing its projection or limit", async () => {
    const { repo, requests } = harness();
    await repo.getReceivableProcurementPOs();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.table).toBe("active_procurement_po_handoff");
    expect(requests[0]!.method).toBe("GET");
    expect(requests[0]!.url.searchParams.get("limit")).toBe("500");
    expect(requests[0]!.url.searchParams.get("select")).toContain("lines");
  });

  it("does not substitute the raw PO queue when the active handoff is unavailable", async () => {
    const { repo, requests } = harness(({ table }) => table === "active_procurement_po_handoff"
      ? Response.json({ message: "active handoff unavailable" }, { status: 403 }) : Response.json([]));
    await expect(repo.getReceivableProcurementPOs()).rejects.toThrow("active handoff unavailable");
    expect(requests.map(r => r.table)).toEqual(["active_procurement_po_handoff"]);
  });

  it("maps exactly the supported archive tables without inferring other view names", () => {
    const tables = [
      "products", "inventory_units", "stock_levels", "lots", "allocations", "fulfillment_orders",
      "fulfillment_reservations", "department_stock_requests", "customer_return_cases", "receipts",
      "returns", "cycle_counts", "quality_inspections", "inventory_holds", "vendor_returns",
      "stock_change_requests", "exceptions", "kit_definitions", "rekit_work_orders", "storage_areas", "events", "movements",
    ];
    for (const table of tables) expect(activeReadRelation(table)).toBe(`active_${table}`);
    for (const table of [
      "locations", "suppliers", "purchase_orders", "profiles", "department_request_options",
      "operation_types", "operation_routes", "quality_inspection_queue", "warehouse_tasks",
      "inventory_position_v1", "procurement_po_handoff", "active_products", "Products", "unknown_table",
    ]) expect(activeReadRelation(table)).toBe(table);
  });

  it("uses active views only for archive-scoped aggregate lists", async () => {
    const { repo, requests } = harness();
    await repo.getData();
    await repo.getProfiles();
    expect(requests.map(({ table }) => table).sort()).toEqual([
      "active_products", "locations", "active_storage_areas", "suppliers", "active_lots",
      "active_inventory_units", "active_stock_levels", "active_movements", "active_allocations",
      "active_events", "active_returns", "active_cycle_counts", "active_receipts", "purchase_orders",
      "operation_types", "operation_routes", "active_fulfillment_orders", "active_fulfillment_reservations",
      "active_department_stock_requests", "department_request_options", "active_customer_return_cases",
      "active_kit_definitions", "active_rekit_work_orders", "profiles",
    ].sort());
    for (const request of requests) {
      expect(request.method).toBe("GET");
      expect(request.headers.get("accept-profile")).toBe("warehouse");
      expect(request.url.searchParams.get("select")).not.toBe("*");
    }
  });

  it.each([
    ["listQualityInspections", "active_quality_inspections", "inspected_at", "disposition", "accepted"],
    ["listHolds", "active_inventory_holds", "created_at", "status", "active"],
    ["listVendorReturns", "active_vendor_returns", "created_at", "status", "ready"],
    ["listExceptions", "active_exceptions", "created_at", "status", "open"],
  ] as const)("%s preserves filters and cursors on the active view", async (method, table, timestamp, statusColumn, status) => {
    const date = "2026-11-06T00:00:00.000Z";
    const { repo, requests } = harness(() => Response.json([
      { id: "row-2", [timestamp]: date }, { id: "row-1", [timestamp]: date },
    ]));
    const result = await repo[method]({ limit: 1, status, cursor: encodeURIComponent(JSON.stringify([date, "row-3"])) });
    expect(result.rows).toHaveLength(1);
    expect(JSON.parse(decodeURIComponent(result.nextCursor!))).toEqual([date, "row-2"]);
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.table).toBe(table);
    expect(request.url.searchParams.get(statusColumn)).toBe(`eq.${status}`);
    expect(request.url.searchParams.get("or")).toBe(`(${timestamp}.lt.${date},and(${timestamp}.eq.${date},id.lt.row-3))`);
    expect(request.url.searchParams.get("order")).toBe(`${timestamp}.desc,id.desc`);
    expect(request.url.searchParams.get("limit")).toBe("2");
    expect(request.url.searchParams.get("select")).not.toBe("*");
  });

  it("retains database-filtered queue names and the stock-change RPC contract", async () => {
    const { repo, requests } = harness(({ table }) => Response.json(table === "list_stock_change_requests" ? { rows: [] } : []));
    await repo.listQualityInspectionSummaries({});
    await repo.listWarehouseTasks({});
    await repo.listInventoryPositions({});
    await repo.listStockChangeRequests({ limit: 12, status: "pending", search: "fixture" });
    expect(requests.map(({ table }) => table)).toEqual([
      "quality_inspection_queue", "warehouse_tasks", "inventory_position_v1", "list_stock_change_requests",
    ]);
    expect(requests[3]).toMatchObject({ method: "POST", body: { payload: { limit: 12, status: "pending", search: "fixture" } } });
  });

  it.each([403, 404])("does not fall back to archived base rows when an active view returns %i", async (status) => {
    const { repo, requests } = harness(({ table }) => table.startsWith("active_")
      ? Response.json({ message: "active view unavailable" }, { status }) : Response.json([]));
    await expect(repo.getStockState()).rejects.toThrow("active view unavailable");
    await expect(repo.listHolds({})).rejects.toThrow("inventory_holds: active view unavailable");
    expect(requests.map(({ table }) => table).sort()).toEqual([
      "active_inventory_holds", "active_inventory_units", "active_products", "active_stock_levels",
    ]);
  });

  it("keeps direct count, inspection evidence, and receipt replay reads on raw tables", async () => {
    const key = "archive-replay-test";
    const lines = [{ productId: "archived-product", quantity: 1 }];
    const { repo, requests } = harness(({ table }) => {
      if (table === "cycle_counts") return Response.json({ id: "old-count", lines: [] });
      if (table === "quality_inspections") return Response.json({ evidence_urls: ["evidence/old.jpg"] });
      if (table === "receipts") return Response.json([{ id: `rcpt-${key}`, location_id: "loc-wh", lines, evidence_urls: [] }]);
      throw new Error(`Unexpected request: ${table}`);
    });
    expect((await repo.getCycleCount("old-count"))?.id).toBe("old-count");
    expect(await repo.getQualityInspectionEvidence("old-inspection")).toEqual(["evidence/old.jpg"]);
    expect((await repo.receiveStock({
      idempotencyKey: key, locationId: "loc-wh", lines, actor: "test",
      receiptException: { type: "non_po", reason: "Existing receipt replay", evidenceUrls: ["evidence/approval.pdf"] },
    })).id).toBe(`rcpt-${key}`);
    expect(requests.map(({ table, method, url }) => [table, method, url.searchParams.get("id")])).toEqual([
      ["cycle_counts", "GET", "eq.old-count"], ["quality_inspections", "GET", "eq.old-inspection"],
      ["receipts", "GET", `eq.rcpt-${key}`],
    ]);
  });

  it("updates a product on the base table after reading the active catalog", async () => {
    const product = buildSeed().products[0]!;
    const { repo, requests } = harness(({ table, method, url, body }) => {
      if (method === "PATCH") return Response.json(body);
      return Response.json(table === "active_products" && !url.searchParams.has("id") ? [productToRow(product)] : []);
    });
    expect((await repo.updateProduct({ productId: product.id, patch: { name: "Renamed product" }, actor: "test" })).name).toBe("Renamed product");
    expect(requests.map(({ table, method }) => [table, method])).toEqual([
      ["active_products", "GET"], ["active_products", "GET"], ["products", "PATCH"],
    ]);
    expect(requests[2]!.url.searchParams.get("id")).toBe(`eq.${product.id}`);
    expect(requests[2]!.headers.get("content-profile")).toBe("warehouse");
  });

  it("retains raw-stock deletion guards even when active stock is empty", async () => {
    const { repo, requests } = harness(({ table }) => Response.json(table === "stock_levels" ? [{ quantity: 1 }] : []));
    await expect(repo.deleteLocation({ locationId: "loc-wh" })).rejects.toThrow("still holds stock");
    expect(requests.map(({ table, method }) => [table, method])).toEqual([
      ["stock_levels", "GET"], ["inventory_units", "GET"],
    ]);
  });

  it("inserts products into the base table, never the active view", async () => {
    const { repo, requests } = harness();
    const product = await repo.createProduct({ ...buildSeed().products[0]!, sku: "NEW-SKU", actor: "test" });
    expect(product.sku).toBe("NEW-SKU");
    expect(requests.map(({ table, method }) => [table, method])).toEqual([
      ["active_products", "GET"], ["products", "POST"],
    ]);
    expect(requests[1]!.body).toMatchObject({ id: product.id, sku: "NEW-SKU" });
    expect(requests[1]!.headers.get("content-profile")).toBe("warehouse");
  });

  it("keeps deletion on the base table after raw-stock guards succeed", async () => {
    const { repo, requests } = harness();
    await repo.deleteLocation({ locationId: "empty-location" });
    expect(requests.map(({ table, method }) => [table, method])).toEqual([
      ["stock_levels", "GET"], ["inventory_units", "GET"], ["locations", "DELETE"],
    ]);
    expect(requests[2]!.url.searchParams.get("id")).toBe("eq.empty-location");
    expect(requests[2]!.headers.get("content-profile")).toBe("warehouse");
  });
});
