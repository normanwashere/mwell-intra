import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Warehouse Procurement handoff presentation migration", () => {
  it("retains invoker security, authoritative values, grants, and schema refresh", () => {
    const sql = readFileSync(
      resolve(
        process.cwd(),
        "../../supabase/migrations/20260722200000_warehouse_procurement_handoff_presentation.sql",
      ),
      "utf8",
    );

    expect(sql).toContain("with (security_invoker = true)");
    expect(sql).toContain("po.total");
    expect(sql).toContain("'unitPrice', line.unit_price");
    expect(sql).toContain("po.created_at");
    expect(sql).toContain(
      "grant select on warehouse.procurement_po_handoff to authenticated, service_role",
    );
    expect(sql).toContain("pg_notify('pgrst', 'reload schema')");
  });
});
