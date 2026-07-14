import { describe, expect, it } from "vitest";
import {
  MODULES,
  WAREHOUSE_DETAIL_ROUTES,
  WAREHOUSE_ROUTE_CONTRACTS,
  modulesForWarehouseAccess,
  modulesForRole,
  primaryModulesForWarehouseAccess,
  primaryModulesForRole,
} from "./modules";
import { ROLE_LIST } from "@/auth/roles";

describe("warehouse navigation metadata", () => {
  it("gives the Operator only the four routine floor flows plus Home", () => {
    expect(modulesForRole("operations").map((module) => module.label)).toEqual([
      "Home",
      "Receive and inspect",
      "Put away",
      "Pick or issue",
      "Returns and counts",
    ]);
  });

  it("maps the canonical Operator and Supervisor roles while preserving aliases", () => {
    expect(modulesForRole("warehouse_operator").map((module) => module.label)).toEqual(
      modulesForRole("operations").map((module) => module.label),
    );
    expect(modulesForRole("warehouse_supervisor").map((module) => module.id)).toEqual(
      modulesForRole("logistics_supervisor").map((module) => module.id),
    );
  });

  it("keeps advanced cross-functional tools out of the Operator workflow", () => {
    expect(modulesForRole("operations").map((module) => module.id)).not.toEqual(
      expect.arrayContaining([
        "procurement", "pricing", "data", "reports", "events", "suppliers",
        "imports", "operation-routes", "approvals", "quality",
      ]),
    );
  });

  it("intersects live Operator capabilities with the canonical four-flow projection", () => {
    const capabilities = new Set([
      "view_dashboard", "receive_stock", "view_pricing", "set_pricing",
      "manage_locations", "reserve_allocate", "manage_returns",
    ]);
    const visible = modulesForWarehouseAccess(
      "supabase", "warehouse_operator", (capability) => capabilities.has(capability),
    );
    expect(visible.map((module) => module.label)).toEqual([
      "Home", "Receive and inspect", "Put away", "Pick or issue", "Returns and counts",
    ]);
    expect(visible.map((module) => module.id)).not.toContain("pricing");
    expect(primaryModulesForWarehouseAccess(
      "supabase", "operations", (capability) => capabilities.has(capability),
    ).map((module) => module.label)).toEqual([
      "Home", "Receive and inspect", "Put away", "Pick or issue",
    ]);
  });

  it("assigns every route to exactly one desktop group", () => {
    expect(MODULES.every((module) => Boolean(module.group))).toBe(true);
    expect(new Set(MODULES.map((module) => module.id)).size).toBe(
      MODULES.length,
    );
  });

  it("builds router contracts from every navigation module plus detail alias", () => {
    expect(WAREHOUSE_ROUTE_CONTRACTS.map((entry) => entry.path)).toEqual([
      ...MODULES.map((module) => module.path),
      ...WAREHOUSE_DETAIL_ROUTES.map((entry) => entry.path),
    ]);
  });

  it("uses the exact logistics mobile primary order", () => {
    expect(
      primaryModulesForRole("logistics_supervisor").map(
        (module) => module.mobile,
      ),
    ).toEqual(["home", "scan", "tasks", "inventory"]);
  });

  it("gives every role a Home destination", () => {
    for (const role of ROLE_LIST) {
      expect(primaryModulesForRole(role.id)[0]?.mobile).toBe("home");
    }
  });

  it("shows scan and tasks only to roles with actionable capabilities", () => {
    expect(
      primaryModulesForRole("business_unit").map((module) => module.id),
    ).not.toContain("scan");
    expect(
      primaryModulesForRole("business_unit").map((module) => module.id),
    ).not.toContain("tasks");
    expect(
      primaryModulesForRole("logistics_supervisor").map((module) => module.id),
    ).toEqual(expect.arrayContaining(["scan", "tasks"]));
  });

  it("only includes modules authorized for the role", () => {
    const visible = new Set(
      modulesForRole("operations").map((module) => module.id),
    );
    for (const module of primaryModulesForRole("operations"))
      expect(visible.has(module.id)).toBe(true);
  });

  it("places quality control in the Control group for inspection roles", () => {
    const quality = modulesForRole("logistics_supervisor").find(
      (module) => module.id === "quality",
    );
    expect(quality).toMatchObject({
      path: "/quality",
      group: "control",
      icon: "shield",
    });
    expect(
      modulesForRole("finance").some((module) => module.id === "quality"),
    ).toBe(false);
  });

  it("exposes approvals and exceptions only to their authorized roles", () => {
    expect(
      modulesForRole("logistics_supervisor").find(
        (module) => module.id === "approvals",
      ),
    ).toMatchObject({ path: "/approvals", group: "control" });
    expect(
      modulesForRole("finance").find((module) => module.id === "approvals"),
    ).toBeDefined();
    expect(
      modulesForRole("operations").find((module) => module.id === "approvals"),
    ).toBeUndefined();
    expect(
      modulesForRole("logistics_supervisor").find((module) => module.id === "exceptions"),
    ).toMatchObject({ path: "/exceptions", group: "control" });
  });

  it("places imports, reports, and operation routes in their operating groups", () => {
    expect(
      modulesForRole("warehouse_admin").find(
        (module) => module.id === "imports",
      ),
    ).toMatchObject({ path: "/imports", group: "configure" });
    expect(
      modulesForRole("bi_analyst").find((module) => module.id === "reports"),
    ).toMatchObject({ path: "/reports", group: "analyze" });
    expect(
      modulesForRole("logistics_supervisor").find(
        (module) => module.id === "operation-routes",
      ),
    ).toMatchObject({ path: "/operation-routes", group: "configure" });
  });
});
