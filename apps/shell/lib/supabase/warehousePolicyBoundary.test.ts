import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260713191000_warehouse_policy_core_capabilities.sql",
  ),
  "utf8",
);
const storageMigration = readFileSync(
  resolve(
    process.cwd(),
    "../../supabase/migrations/20260713192000_storage_evidence_core_capabilities.sql",
  ),
  "utf8",
);

describe("warehouse RLS capability boundary", () => {
  it("removes legacy warehouse capability checks from every replaced policy", () => {
    expect(migration).not.toContain("warehouse.has_cap(");
    expect(storageMigration).not.toContain("warehouse.has_cap(");
    expect(migration.match(/core\.has_cap\('warehouse',/g)).toHaveLength(21);
    expect(storageMigration.match(/core\.has_cap\('warehouse',/g)).toHaveLength(
      5,
    );
  });

  it.each(["evidence_auth_read", "evidence_auth_write"])(
    "recreates storage policy %s against the core catalogue",
    (policy) => {
      expect(storageMigration).toContain(`create policy ${policy}`);
    },
  );

  it.each([
    "locations_insert",
    "locations_update",
    "locations_delete",
    "products_insert",
    "products_update",
    "products_delete",
    "suppliers_write_insert",
    "suppliers_write_update",
    "suppliers_write_delete",
    "read_lots",
    "read_purchase_orders",
    "read_suppliers",
  ])("recreates %s against the core catalogue", (policy) => {
    expect(migration).toContain(`create policy ${policy}`);
  });
});
