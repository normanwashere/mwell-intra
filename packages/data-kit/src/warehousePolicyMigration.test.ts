import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Warehouse procurement-lineage migration", () => {
  it("disables raw Warehouse PO creation and converges read-only role grants", () => {
    const migrations = resolve(process.cwd(), "../../supabase/migrations");
    const policyMigration = readdirSync(migrations)
      .filter((file) => file.endsWith(".sql"))
      .map((file) => readFileSync(resolve(migrations, file), "utf8"))
      .find((sql) => sql.includes("Warehouse PO authoring is disabled"));

    expect(policyMigration).toContain(
      "raise exception 'Warehouse PO authoring is disabled; create an approved Procurement PO instead'",
    );
    expect(policyMigration).toContain("('warehouse', 'view_inventory')");
    expect(policyMigration).toMatch(
      /delete from core\.role_capabilities[\s\S]+role in \('finance', 'pricing'\)[\s\S]+cap in \('manage_inventory', 'cycle_count', 'transfer_stock'\)/,
    );
    expect(policyMigration).toContain(
      "and role = 'operations'\n  and cap in (",
    );
    expect(policyMigration).toContain("'receive_stock', 'cycle_count'");
  });
});
