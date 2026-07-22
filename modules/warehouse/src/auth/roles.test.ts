import { describe, it, expect } from "vitest";
import { ROLES, ROLE_LIST, can } from "./roles";
import { modulesForRole } from "@/app/modules";

describe("roles", () => {
  it("defines canonical bundles, legacy roles, and Warehouse Administrator", () => {
    expect(ROLE_LIST).toHaveLength(11);
    expect(ROLES.warehouse_operator).toBeDefined();
    expect(ROLES.warehouse_supervisor).toBeDefined();
  });

  it("grants every role the dashboard and read-only inventory view", () => {
    for (const role of ROLE_LIST) {
      expect(can(role.id, "view_dashboard")).toBe(true);
      expect(can(role.id, "view_inventory")).toBe(true);
    }
  });

  it("keeps physical inventory mutation with Warehouse custody roles", () => {
    expect(can("warehouse_operator", "manage_inventory")).toBe(true);
    expect(can("warehouse_supervisor", "manage_inventory")).toBe(true);
    expect(can("finance", "manage_inventory")).toBe(false);
    expect(can("pricing", "manage_inventory")).toBe(false);
  });

  it("keeps physical receiving with warehouse roles", () => {
    expect(can("logistics_supervisor", "receive_stock")).toBe(true);
    expect(can("warehouse_operator", "receive_stock")).toBe(true);
    expect(can("operations", "receive_stock")).toBe(false);
    expect(can("finance", "receive_stock")).toBe(false);
  });

  it("limits financial valuation to finance and pricing", () => {
    expect(can("finance", "view_finance")).toBe(true);
    expect(can("pricing", "view_finance")).toBe(true);
    expect(can("marketing", "view_finance")).toBe(false);
  });

  it("keeps allocation with warehouse custody roles", () => {
    expect(can("warehouse_operator", "reserve_allocate")).toBe(true);
    expect(can("operations", "reserve_allocate")).toBe(false);
    expect(can("marketing", "reserve_allocate")).toBe(false);
    expect(can("business_unit", "reserve_allocate")).toBe(false);
    expect(can("logistics_supervisor", "reserve_allocate")).toBe(true);
  });
});

describe("modulesForRole", () => {
  it("always includes dashboard and inventory", () => {
    const ids = modulesForRole("bi_analyst").map((m) => m.id);
    expect(ids).toContain("dashboard");
    expect(ids).toContain("inventory");
  });

  it("shows receiving + cycle counts + returns for logistics", () => {
    const ids = modulesForRole("logistics_supervisor").map((m) => m.id);
    expect(ids).toEqual(
      expect.arrayContaining(["receiving", "cycle-counts", "returns"]),
    );
  });

  it("hides receiving from operations", () => {
    const ids = modulesForRole("operations").map((m) => m.id);
    expect(ids).not.toContain("receiving");
    expect(ids).not.toContain("allocations");
    expect(ids).toContain("fulfillment");
  });

  it("shows procurement only to procurement role", () => {
    expect(modulesForRole("procurement").map((m) => m.id)).toContain(
      "procurement",
    );
    expect(modulesForRole("finance").map((m) => m.id)).not.toContain(
      "procurement",
    );
  });

  it("shows pricing only to the pricing role", () => {
    expect(modulesForRole("pricing").map((m) => m.id)).toContain("pricing");
    expect(modulesForRole("finance").map((m) => m.id)).not.toContain("pricing");
  });

  it("gives logistics an issue path via Allocations", () => {
    expect(modulesForRole("logistics_supervisor").map((m) => m.id)).toContain(
      "allocations",
    );
  });

  it("shows the data/reports module to the BI analyst", () => {
    expect(modulesForRole("bi_analyst").map((m) => m.id)).toContain("data");
  });

  it("every role definition is internally consistent", () => {
    for (const id of Object.keys(ROLES)) {
      expect(ROLES[id as keyof typeof ROLES].id).toBe(id);
    }
  });
});
