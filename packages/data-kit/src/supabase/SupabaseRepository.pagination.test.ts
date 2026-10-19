import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createRepository } from "../createRepository";
import { availableForProduct } from "../domain/stock";
import { committedQuantity } from "../domain/allocations";
import { buildSeed } from "../seed";
import { productToRow, unitToRow } from "./mappers";

type Row = Record<string, unknown>;
const id = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const seed = buildSeed();
const product = seed.products.find((row) => row.serialized)!;
const unit = seed.units.find((row) => row.productId === product.id)!;
const units = (count: number) => Array.from({ length: count }, (_, index) => ({
  ...unitToRow(unit), id: id(index), serial_number: `IMPORT-${index}`, status: "in_stock",
}));

// Use the installed REST builder and the same factory/schema boundary as the shell.
// Only HTTP is replaced; it enforces the server cap independently of requested limits.
function harness(tables: Record<string, Row[]>, options: {
  cap?: number;
  pageResponse?: (table: string, cursor: string | null) => Response | undefined;
  beforePage?: (table: string, cursor: string | null) => void;
} = {}) {
  const requests: { table: string; url: URL; headers: Headers }[] = [];
  const client = createClient("https://pagination.invalid", "test-anon-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const table = url.pathname.split("/").at(-1)!;
      const cursor = url.searchParams.get("id")?.replace(/^gt\./, "") ?? null;
      requests.push({ table, url, headers: new Headers(init?.headers) });
      options.beforePage?.(table, cursor);
      const override = options.pageResponse?.(table, cursor);
      if (override) return override;
      let rows = [...(tables[table] ?? [])];
      if (url.searchParams.get("order") === "id.asc") {
        rows.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      }
      if (cursor !== null) rows = rows.filter((row) => String(row.id) > cursor);
      const limit = Math.min(options.cap ?? 1000, Number(url.searchParams.get("limit") ?? 1000));
      const projection = url.searchParams.get("select")!.split(",");
      return Response.json(rows.slice(0, limit).map((row) => Object.fromEntries(
        projection.filter((column) => column in row).map((column) => [column, row[column]]),
      )));
    } },
  });
  return { repo: createRepository({ supabaseClient: client }).repo, requests };
}

describe("complete operational REST reads", () => {
  it.each(["getStockState", "getData"] as const)("%s loads all 5,402 imported serials through the live factory", async (method) => {
    const { repo, requests } = harness({ products: [productToRow(product)], inventory_units: units(5402).reverse() });
    const data = await repo[method]();
    expect(data.units).toHaveLength(5402);
    expect(new Set(data.units.map((row) => row.id)).size).toBe(5402);
    expect(data.units.at(-1)?.serialNumber).toBe("IMPORT-5401");
    expect(availableForProduct(data, product.id)).toBe(5402);
    const pages = requests.filter((request) => request.table === "inventory_units");
    expect(pages.map(({ url }) => url.searchParams.get("id"))).toEqual([
      null, ...[999, 1999, 2999, 3999, 4999, 5401].map((index) => `gt.${id(index)}`),
    ]);
    for (const { url, headers } of pages) {
      expect(url.searchParams.get("order")).toBe("id.asc");
      expect(url.searchParams.get("limit")).toBe("1000");
      expect(url.searchParams.has("offset")).toBe(false);
      expect(headers.get("accept-profile")).toBe("warehouse");
    }
  });

  const operationalTables = [
    ["products", "products"], ["locations", "locations"], ["storage_areas", "storageAreas"],
    ["suppliers", "suppliers"], ["lots", "lots"], ["stock_levels", "stockLevels"],
    ["allocations", "allocations"], ["events", "events"],
    ["fulfillment_reservations", "fulfillmentReservations"],
  ] as const;
  it.each(operationalTables)("completes %s without depending on nullable business keys", async (table, key) => {
    const rows = Array.from({ length: 1001 }, (_, index) => ({
      id: id(index), product_id: product.id, location_id: unit.locationId,
      bin_id: null, lot_id: null, quantity: 1, status: "reserved",
    }));
    const { repo, requests } = harness({ [table]: rows.reverse() });
    const data = await repo.getData();
    expect(data[key]).toHaveLength(1001);
    const pages = requests.filter((request) => request.table === table);
    expect(pages).toHaveLength(3);
    expect(pages.every(({ url }) => url.searchParams.get("order") === "id.asc")).toBe(true);
    expect(pages[0]!.url.searchParams.get("select")!.split(",")).toContain("id");
    if (table === "stock_levels") {
      expect(data.stockLevels.reduce((sum, row) => sum + row.quantity, 0)).toBe(1001);
      expect(data.stockLevels[0]).not.toHaveProperty("id");
    }
    if (table === "allocations") expect(committedQuantity(data.allocations, product.id)).toBe(1001);
  });

  it.each([[0, 1000, 1], [2000, 1000, 3], [1001, 333, 5]])(
    "handles %i rows with a server cap of %i in %i requests", async (count, cap, expectedRequests) => {
      const { repo, requests } = harness({ inventory_units: units(count) }, { cap });
      expect((await repo.getStockState()).units).toHaveLength(count);
      expect(requests.filter((request) => request.table === "inventory_units")).toHaveLength(expectedRequests);
    },
  );

  it.each(["getStockState", "getData"] as const)("%s rejects a later-page error instead of returning partial stock", async (method) => {
    const { repo } = harness({ inventory_units: units(1001) }, {
      pageResponse: (table, cursor) => table === "inventory_units" && cursor !== null
        ? Response.json({ message: "read access revoked", code: "42501" }, { status: 403 }) : undefined,
    });
    await expect(repo[method]()).rejects.toThrow("inventory_units: read access revoked");
  });

  it("does not skip the next unit when an earlier-page row is deleted", async () => {
    const tables = { inventory_units: units(1001) };
    const { repo } = harness(tables, { beforePage: (table, cursor) => {
      if (table === "inventory_units" && cursor === id(999)) tables.inventory_units.shift();
    } });
    const data = await repo.getStockState();
    expect(data.units).toHaveLength(1001);
    expect(data.units.at(-1)?.id).toBe(id(1000));
  });

  it("fails closed on repeated pages rather than looping or double-counting", async () => {
    const repeated = units(1);
    const { repo, requests } = harness({ inventory_units: repeated }, {
      pageResponse: (table, cursor) => table === "inventory_units" && cursor !== null
        ? Response.json(repeated) : undefined,
    });
    await expect(repo.getStockState()).rejects.toThrow("inventory_units: invalid pagination identity");
    expect(requests.filter((request) => request.table === "inventory_units")).toHaveLength(2);
  });

  it.each([{ body: null }, { body: [{}] }, { body: [{ id: null }] }])("rejects malformed operational data: $body", async ({ body }) => {
    const { repo } = harness({}, { pageResponse: (table) => table === "inventory_units" ? Response.json(body) : undefined });
    await expect(repo.getStockState()).rejects.toThrow(/inventory_units: invalid pagination/);
  });

  it("leaves all bounded history reads and unrelated configuration reads single-page", async () => {
    const histories = ["movements", "returns", "cycle_counts", "receipts", "purchase_orders",
      "fulfillment_orders", "department_stock_requests", "customer_return_cases", "rekit_work_orders"];
    const { repo, requests } = harness({ movements: Array.from({ length: 1001 }, (_, index) => ({ id: id(index) })) });
    const data = await repo.getData();
    expect(data.movements).toHaveLength(1000);
    for (const table of histories) {
      const pages = requests.filter((request) => request.table === table);
      expect(pages).toHaveLength(1);
      expect(pages[0]!.url.searchParams.get("limit")).toBe("5000");
      expect(pages[0]!.url.searchParams.get("order")).toBe("created_at.desc");
      expect(pages[0]!.url.searchParams.has("id")).toBe(false);
    }
    for (const table of ["operation_types", "operation_routes", "department_request_options", "kit_definitions"]) {
      expect(requests.filter((request) => request.table === table)).toHaveLength(1);
    }
  });
});
