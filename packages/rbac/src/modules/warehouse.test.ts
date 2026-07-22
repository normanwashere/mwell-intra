import { describe, expect, it } from "vitest";
import { can, warehouseModule, type UserRoles } from "../index";

const roles = (warehouse: string[]): UserRoles => ({
  core: [],
  warehouse,
  procurement: [],
  legal: [],
  events: [],
  insights: [],
  product: [],
});

describe("warehouse W1 capabilities", () => {
  it("defines the canonical two-person Warehouse operating roles", () => {
    expect(warehouseModule.roles.warehouse_operator.capabilities).toEqual([
      "view_dashboard",
      "view_inventory",
      "receive_stock",
      "manage_inventory",
      "cycle_count",
      "manage_returns",
      "reserve_allocate",
      "issue_items",
      "transfer_stock",
      "inspect_quality",
      "view_exceptions",
    ]);
    expect(warehouseModule.roles.warehouse_supervisor.capabilities).toEqual([
      "view_dashboard",
      "view_inventory",
      "receive_stock",
      "manage_inventory",
      "manage_products",
      "manage_locations",
      "cycle_count",
      "manage_returns",
      "reserve_allocate",
      "issue_items",
      "transfer_stock",
      "manage_operation_routes",
      "inspect_quality",
      "release_quality_hold",
      "approve_stock_adjustment",
      "view_exceptions",
      "resolve_exceptions",
      "import_warehouse_data",
    ]);
  });

  it("keeps controlled exception and configuration capabilities with the Supervisor", () => {
    const operator = roles(["warehouse_operator"]);
    const supervisor = roles(["warehouse_supervisor"]);

    expect(can(operator, "warehouse", "receive_stock")).toBe(true);
    expect(can(operator, "warehouse", "inspect_quality")).toBe(true);
    expect(can(operator, "warehouse", "release_quality_hold")).toBe(false);
    expect(can(operator, "warehouse", "approve_stock_adjustment")).toBe(false);
    expect(can(operator, "warehouse", "resolve_exceptions")).toBe(false);
    expect(can(operator, "warehouse", "manage_operation_routes")).toBe(false);

    expect(can(supervisor, "warehouse", "release_quality_hold")).toBe(true);
    expect(can(supervisor, "warehouse", "approve_stock_adjustment")).toBe(true);
    expect(can(supervisor, "warehouse", "resolve_exceptions")).toBe(true);
    expect(can(supervisor, "warehouse", "manage_operation_routes")).toBe(true);
  });

  it("keeps Operations and department requesters outside physical custody actions", () => {
    const operations = roles(["operations"]);
    const marketing = roles(["marketing"]);

    expect(can(operations, "warehouse", "request_fulfillment")).toBe(true);
    expect(can(operations, "warehouse", "submit_return_case")).toBe(true);
    expect(can(operations, "warehouse", "reserve_allocate")).toBe(false);
    expect(can(operations, "warehouse", "issue_items")).toBe(false);
    expect(can(operations, "warehouse", "receive_stock")).toBe(false);
    expect(can(marketing, "warehouse", "request_stock")).toBe(true);
    expect(can(marketing, "warehouse", "reserve_allocate")).toBe(false);
    expect(can(marketing, "warehouse", "manage_returns")).toBe(false);
  });

  it.each(["warehouse_operator", "warehouse_supervisor"])(
    "keeps %s outside Finance, Procurement, Insights, Marketing/Pricing, Legal, and RBAC administration",
    (role) => {
      const user = roles([role]);
      for (const capability of [
        "view_finance",
        "view_analytics",
        "view_procurement",
        "view_pricing",
        "set_pricing",
      ] as const) {
        expect(can(user, "warehouse", capability)).toBe(false);
      }
      expect(can(user, "warehouse", "approve_stock_adjustment_finance")).toBe(
        false,
      );
      expect(can(user, "core", "manage_rbac")).toBe(false);
      expect(can(user, "procurement", "view_dashboard")).toBe(false);
      expect(can(user, "legal", "view_dashboard")).toBe(false);
      expect(can(user, "insights", "view_warehouse")).toBe(false);
      expect(can(user, "events", "create_event")).toBe(false);
    },
  );

  it("preserves legacy Warehouse role aliases", () => {
    expect(Object.keys(warehouseModule.roles)).toEqual(
      expect.arrayContaining(["operations", "logistics_supervisor"]),
    );
  });

  it("keeps the logistics alias equivalent to the canonical Supervisor bundle", () => {
    expect(warehouseModule.roles.logistics_supervisor.capabilities).toEqual(
      warehouseModule.roles.warehouse_supervisor.capabilities,
    );
  });

  it("adds the Warehouse Administrator role", () => {
    expect(Object.keys(warehouseModule.roles)).toContain("warehouse_admin");
    expect(warehouseModule.roles.warehouse_admin.capabilities).toEqual(
      warehouseModule.capabilities.filter(
        (capability) => capability !== "set_pricing",
      ),
    );
    expect(warehouseModule.roles.warehouse_admin.capabilities).not.toContain(
      "set_pricing",
    );
  });

  it("allows logistics to inspect, release, resolve, import, and route", () => {
    const user = roles(["logistics_supervisor"]);
    expect(can(user, "warehouse", "inspect_quality")).toBe(true);
    expect(can(user, "warehouse", "release_quality_hold")).toBe(true);
    expect(can(user, "warehouse", "approve_stock_adjustment")).toBe(true);
    expect(can(user, "warehouse", "view_exceptions")).toBe(true);
    expect(can(user, "warehouse", "resolve_exceptions")).toBe(true);
    expect(can(user, "warehouse", "import_warehouse_data")).toBe(true);
    expect(can(user, "warehouse", "manage_operation_routes")).toBe(true);
  });

  it("keeps Operations outside quality-control and exception decisions", () => {
    const user = roles(["operations"]);
    expect(can(user, "warehouse", "inspect_quality")).toBe(false);
    expect(can(user, "warehouse", "view_exceptions")).toBe(false);
    expect(can(user, "warehouse", "release_quality_hold")).toBe(false);
    expect(can(user, "warehouse", "resolve_exceptions")).toBe(false);
  });

  it("allows Finance to approve and BI to view without control access", () => {
    const finance = roles(["finance"]);
    const bi = roles(["bi_analyst"]);
    expect(can(finance, "warehouse", "approve_stock_adjustment")).toBe(false);
    expect(can(finance, "warehouse", "approve_stock_adjustment_finance")).toBe(
      true,
    );
    expect(can(finance, "warehouse", "release_quality_hold")).toBe(false);
    expect(can(bi, "warehouse", "view_exceptions")).toBe(true);
    expect(can(bi, "warehouse", "resolve_exceptions")).toBe(false);
  });

  it.each(["finance", "pricing"] as const)(
    "keeps %s inventory access read-only",
    (role) => {
      const capabilities = warehouseModule.roles[role].capabilities;
      expect(capabilities).toContain("view_inventory");
      expect(capabilities).not.toContain("manage_inventory");
      expect(capabilities).not.toContain("cycle_count");
      expect(capabilities).not.toContain("transfer_stock");
    },
  );

  it("does not grant import access to a Business Unit user", () => {
    expect(
      can(roles(["business_unit"]), "warehouse", "import_warehouse_data"),
    ).toBe(false);
  });

  it("does not infer Warehouse access from Core Platform Admin", () => {
    expect(
      can(
        {
          core: ["platform_admin"],
          warehouse: [],
          procurement: [],
          legal: [],
        },
        "warehouse",
        "manage_operation_routes",
      ),
    ).toBe(false);
  });
});
