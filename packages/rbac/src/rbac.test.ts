import { describe, expect, it } from "vitest";
import {
  MODULES,
  MODULE_LIST,
  can,
  emptyUserRoles,
  hasCapInModule,
  listModuleRoles,
  roleCapabilities,
  toRoleCapabilityRows,
  productModule,
  warehouseModule,
  type UserRoles,
} from "./index";

describe("warehouse parity vs source roles.ts", () => {
  it("has the legacy roles plus canonical Operator and Supervisor bundles", () => {
    expect(Object.keys(warehouseModule.roles).sort()).toEqual(
      [
        "bi_analyst",
        "business_unit",
        "finance",
        "logistics_supervisor",
        "marketing",
        "operations",
        "pricing",
        "procurement",
        "warehouse_admin",
        "warehouse_operator",
        "warehouse_supervisor",
      ].sort(),
    );
  });

  it("has the source capabilities, W1 controls, and request-only handoffs", () => {
    expect(warehouseModule.capabilities).toHaveLength(27);
    expect([...warehouseModule.capabilities].sort()).toEqual(
      [
        "view_dashboard",
        "view_inventory",
        "receive_stock",
        "manage_inventory",
        "manage_products",
        "manage_locations",
        "cycle_count",
        "manage_returns",
        "request_fulfillment",
        "request_stock",
        "submit_return_case",
        "reserve_allocate",
        "issue_items",
        "transfer_stock",
        "view_finance",
        "view_analytics",
        "view_procurement",
        "view_pricing",
        "set_pricing",
        "manage_operation_routes",
        "inspect_quality",
        "release_quality_hold",
        "approve_stock_adjustment",
        "approve_stock_adjustment_finance",
        "view_exceptions",
        "resolve_exceptions",
        "import_warehouse_data",
      ].sort(),
    );
  });

  // Exact capability sets copied from mwell-intra-warehouse src/auth/roles.ts.
  const EXPECTED: Record<string, string[]> = {
    warehouse_operator: [
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
    ],
    warehouse_supervisor: [
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
    ],
    logistics_supervisor: [
      "view_dashboard",
      "view_inventory",
      "manage_inventory",
      "receive_stock",
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
    ],
    operations: [
      "view_dashboard",
      "view_inventory",
      "request_fulfillment",
      "request_stock",
      "submit_return_case",
    ],
    finance: [
      "view_dashboard",
      "view_inventory",
      "view_finance",
      "approve_stock_adjustment_finance",
      "view_exceptions",
    ],
    bi_analyst: [
      "view_dashboard",
      "view_inventory",
      "view_analytics",
      "view_exceptions",
    ],
    business_unit: ["view_dashboard", "view_inventory", "request_stock"],
    marketing: ["view_dashboard", "view_inventory", "request_stock"],
    procurement: [
      "view_dashboard",
      "view_inventory",
      "view_procurement",
      "manage_products",
    ],
    pricing: [
      "view_dashboard",
      "view_inventory",
      "view_pricing",
      "view_finance",
    ],
    warehouse_admin: warehouseModule.capabilities.filter(
      (capability) => capability !== "set_pricing",
    ),
  };

  it.each(Object.entries(EXPECTED))(
    "role %s grants exactly the source capabilities",
    (role, caps) => {
      const roleDef = Object.entries(warehouseModule.roles).find(
        ([name]) => name === role,
      )?.[1];
      expect(roleDef).toBeDefined();
      expect([...(roleDef?.capabilities ?? [])].sort()).toEqual(
        [...caps].sort(),
      );
    },
  );
});

describe("can() — capability checks", () => {
  const roles: UserRoles = {
    ...emptyUserRoles(),
    warehouse: ["logistics_supervisor"],
  };

  it("grants a capability the role has", () => {
    expect(can(roles, "warehouse", "receive_stock")).toBe(true);
    expect(can(roles, "warehouse", "view_dashboard")).toBe(true);
  });

  it("denies a capability the role lacks", () => {
    expect(can(roles, "warehouse", "set_pricing")).toBe(false);
    expect(can(roles, "warehouse", "view_analytics")).toBe(false);
  });

  it("unions capabilities across multiple roles in the same module", () => {
    const multi: UserRoles = {
      ...emptyUserRoles(),
      warehouse: ["bi_analyst", "pricing"],
    };
    expect(can(multi, "warehouse", "view_analytics")).toBe(true); // from bi_analyst
    expect(can(multi, "warehouse", "set_pricing")).toBe(false);
    expect(can(multi, "warehouse", "receive_stock")).toBe(false); // neither
  });
});

describe("can() — per-module scoping (spec §4.2)", () => {
  // A user with different roles per module.
  const roles: UserRoles = {
    core: ["staff"],
    warehouse: ["logistics_supervisor"],
    procurement: ["approver"],
    legal: [],
    events: [],
    insights: [],
    product: [],
  };

  it("applies warehouse roles only in the warehouse module", () => {
    expect(can(roles, "warehouse", "receive_stock")).toBe(true);
    // receive_stock is a warehouse capability; procurement scope must not grant it.
    expect(can(roles, "procurement", "approve_award")).toBe(true);
    expect(can(roles, "procurement", "author_po")).toBe(false); // approver can't author
  });

  it("does not leak capabilities across modules", () => {
    // The user is an approver in procurement but holds no legal role.
    expect(can(roles, "legal", "approve_accreditation")).toBe(false);
    expect(can(roles, "legal", "review_accreditation")).toBe(false);
  });

  it("returns false for a module the user has no roles in", () => {
    const partial: Partial<UserRoles> = { warehouse: ["finance"] };
    expect(can(partial, "procurement", "view_dashboard")).toBe(false);
    expect(can(partial, "legal", "view_dashboard")).toBe(false);
  });

  it("handles empty/partial UserRoles safely", () => {
    expect(can({}, "warehouse", "view_dashboard")).toBe(false);
    expect(can(emptyUserRoles(), "warehouse", "view_dashboard")).toBe(false);
  });
});

describe("hasCapInModule()", () => {
  it("checks a concrete role directly", () => {
    expect(hasCapInModule("warehouse", "pricing", "set_pricing")).toBe(false);
    expect(hasCapInModule("warehouse", "pricing", "receive_stock")).toBe(false);
  });

  it("returns false for an unknown role", () => {
    expect(hasCapInModule("warehouse", "ghost_role", "view_dashboard")).toBe(
      false,
    );
  });

  it("external vendor tier lives in core:vendor_portal (reconciled 2026-07-05)", () => {
    expect(hasCapInModule("core", "vendor_portal", "submit_documents")).toBe(
      true,
    );
    expect(
      hasCapInModule("core", "vendor_portal", "submit_accreditation"),
    ).toBe(true);
    expect(
      hasCapInModule("core", "vendor_portal", "view_own_accreditation"),
    ).toBe(true);
    // Retired: legal:vendor no longer exists.
    expect(hasCapInModule("legal", "vendor", "approve_accreditation")).toBe(
      false,
    );
  });
});

describe("provisional procurement/legal/core matrices", () => {
  it("exposes the chosen procurement roles", () => {
    expect(listModuleRoles("procurement").sort()).toEqual(
      [
        "admin",
        "approver",
        "finance",
        "procurement_officer",
        "requester",
      ].sort(),
    );
    expect(MODULES.procurement.provisional).toBe(true);
  });

  it("exposes the internal legal roles (external tier moved to core:vendor_portal)", () => {
    expect(listModuleRoles("legal").sort()).toEqual(
      ["admin", "compliance", "legal_reviewer"].sort(),
    );
  });

  it("exposes the core foundation roles", () => {
    expect(listModuleRoles("core").sort()).toEqual(
      ["platform_admin", "staff", "vendor_portal"].sort(),
    );
  });
});

describe("toRoleCapabilityRows() — DB seed shape", () => {
  const rows = toRoleCapabilityRows();

  it("matches the pre-computed roleCapabilities export", () => {
    expect(rows).toEqual(roleCapabilities);
  });

  it("emits { module, role, cap } rows for every module", () => {
    for (const row of rows) {
      expect(row).toEqual({
        module: expect.any(String),
        role: expect.any(String),
        cap: expect.any(String),
      });
      expect(MODULE_LIST).toContain(row.module);
    }
  });

  it("orders core first (matches migration order)", () => {
    expect(rows[0]?.module).toBe("core");
  });

  it("contains no duplicate (module, role, cap) grants", () => {
    const keys = rows.map((r) => `${r.module}/${r.role}/${r.cap}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("accounts for every declared grant across all modules", () => {
    const declared = MODULE_LIST.reduce((sum, module) => {
      const definition = MODULES[module];
      return (
        sum +
        Object.values(definition.roles).reduce(
          (n, role) => n + role.capabilities.length,
          0,
        )
      );
    }, 0);
    expect(rows).toHaveLength(declared);
  });

  it("includes the canonical warehouse grants (e.g. logistics_supervisor/receive_stock)", () => {
    expect(rows).toContainEqual({
      module: "warehouse",
      role: "logistics_supervisor",
      cap: "receive_stock",
    });
  });
});

describe("events and insights workspace matrices", () => {
  it("exposes the event lifecycle roles", () => {
    expect(listModuleRoles("events").sort()).toEqual(
      ["admin", "coordinator", "requester", "viewer"].sort(),
    );
    expect(hasCapInModule("events", "requester", "create_event")).toBe(true);
    expect(hasCapInModule("events", "requester", "close_event")).toBe(false);
    expect(hasCapInModule("events", "coordinator", "close_event")).toBe(true);
  });

  it("keeps insight audiences least-privileged", () => {
    expect(listModuleRoles("insights").sort()).toEqual(
      ["admin", "analyst", "executive", "manager"].sort(),
    );
    expect(hasCapInModule("insights", "analyst", "prepare_exports")).toBe(true);
    expect(hasCapInModule("insights", "executive", "view_executive")).toBe(
      true,
    );
    expect(hasCapInModule("insights", "executive", "view_warehouse")).toBe(
      false,
    );
  });

  it("returns fully keyed empty roles for every workspace", () => {
    expect(emptyUserRoles()).toEqual({
      core: [],
      warehouse: [],
      procurement: [],
      legal: [],
      events: [],
      insights: [],
      product: [],
    });
  });
});

describe("product governance matrix", () => {
  it("separates contribution, final decision, and operations handoff duties", () => {
    expect(listModuleRoles("product").sort()).toEqual(
      ["contributor", "operations_partner", "product_owner"].sort(),
    );
    expect(productModule.capabilities).toEqual([
      "view_readiness",
      "prepare_readiness",
      "decide_go_live",
      "acknowledge_operations_handoff",
      "view_pricing",
      "propose_pricing",
      "approve_pricing",
    ]);
    expect(
      hasCapInModule("product", "contributor", "prepare_readiness"),
    ).toBe(true);
    expect(
      hasCapInModule("product", "contributor", "decide_go_live"),
    ).toBe(false);
    expect(
      hasCapInModule("product", "product_owner", "decide_go_live"),
    ).toBe(true);
    expect(
      hasCapInModule(
        "product",
        "operations_partner",
        "acknowledge_operations_handoff",
      ),
    ).toBe(true);
    expect(
      hasCapInModule("product", "operations_partner", "approve_pricing"),
    ).toBe(false);
  });

  it("does not grant Product roles Warehouse custody mutations", () => {
    const roles = {
      ...emptyUserRoles(),
      product: ["product_owner"],
    };
    expect(can(roles, "product", "decide_go_live")).toBe(true);
    expect(can(roles, "product", "approve_pricing")).toBe(true);
    expect(can(roles, "warehouse", "manage_inventory")).toBe(false);
    expect(can(roles, "warehouse", "cycle_count")).toBe(false);
  });

  it("retires direct Warehouse price mutation for every role", () => {
    for (const role of listModuleRoles("warehouse")) {
      expect(hasCapInModule("warehouse", role, "set_pricing")).toBe(false);
    }
  });
});

describe("department DOA administration", () => {
  it("grants DOA configuration only to Legal Admin", () => {
    expect(can({ legal: ["admin"] }, "legal", "manage_doa")).toBe(true);
    expect(can({ legal: ["legal_reviewer"] }, "legal", "manage_doa")).toBe(
      false,
    );
    expect(can({ legal: ["compliance"] }, "legal", "manage_doa")).toBe(false);
  });

  it("does not turn DOA configuration into procurement approval authority", () => {
    expect(can({ legal: ["admin"] }, "procurement", "approve_request")).toBe(
      false,
    );
    expect(
      can({ core: ["platform_admin"] }, "procurement", "approve_request"),
    ).toBe(false);
  });
});
