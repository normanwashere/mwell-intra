import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { UserRoles } from "@intra/rbac";
import { SHELL_PAGE_ROUTE_CONTRACTS } from "./routes";
import {
  authorizedPostLoginPath,
  canAccessFinance,
  dashboardAreas,
  memoryAccess,
  mobileCenterAction,
} from "./navigation";

describe("authorized post-login destinations", () => {
  it("uses only live capabilities in Supabase mode", () => {
    const staleRoleSnapshot = {
      mode: "supabase" as const,
      userRoles: { core: ["platform_admin"] } satisfies Partial<UserRoles>,
      userCapabilities: {},
    };
    expect(
      authorizedPostLoginPath(
        "/admin/departments",
        staleRoleSnapshot,
        "employee",
      ),
    ).toBe("/");

    const liveAuthority = {
      mode: "supabase" as const,
      userRoles: {} satisfies Partial<UserRoles>,
      userCapabilities: {
        core: ["manage_rbac"],
        warehouse: ["view_finance"],
      },
    };
    expect(
      authorizedPostLoginPath("/admin/departments", liveAuthority, "employee"),
    ).toBe("/admin/departments");
    expect(canAccessFinance(liveAuthority)).toBe(true);
  });

  it("keeps authorized module and shared destinations", () => {
    const roles: Partial<UserRoles> = {
      core: ["staff"],
      events: ["requester"],
      insights: ["analyst"],
      warehouse: ["finance"],
    };
    const access = memoryAccess(roles);
    expect(authorizedPostLoginPath("/events", access, "employee")).toBe(
      "/events",
    );
    expect(
      authorizedPostLoginPath("/insights/warehouse", access, "employee"),
    ).toBe("/insights/warehouse");
    expect(authorizedPostLoginPath("/finance", access, "employee")).toBe(
      "/finance",
    );
    expect(authorizedPostLoginPath("/work", access, "employee")).toBe("/work");
  });

  it("allows only RBAC administrators into Department Administration", () => {
    expect(
      authorizedPostLoginPath(
        "/admin/departments",
        memoryAccess({ core: ["platform_admin"] }),
        "employee",
      ),
    ).toBe("/admin/departments");
    expect(
      authorizedPostLoginPath(
        "/admin/departments",
        memoryAccess({ core: ["staff"] }),
        "employee",
      ),
    ).toBe("/");
  });

  it("fails closed instead of opening an unauthorized or unknown destination", () => {
    const roles: Partial<UserRoles> = {
      core: ["staff"],
      warehouse: ["logistics_supervisor"],
    };
    const access = memoryAccess(roles);
    expect(authorizedPostLoginPath("/events", access, "employee")).toBe("/");
    expect(authorizedPostLoginPath("/admin/users", access, "employee")).toBe(
      "/",
    );
    expect(
      authorizedPostLoginPath("/not-a-real-route", access, "employee"),
    ).toBe("/");
  });

  it("keeps employee and vendor shared areas separated", () => {
    expect(
      authorizedPostLoginPath(
        "/vendor",
        memoryAccess({ core: ["vendor"] }),
        "vendor",
      ),
    ).toBe("/vendor");
    expect(
      authorizedPostLoginPath(
        "/work",
        memoryAccess({ core: ["vendor"] }),
        "vendor",
      ),
    ).toBe("/");
    expect(
      authorizedPostLoginPath(
        "/vendor",
        memoryAccess({ core: ["staff"] }),
        "employee",
      ),
    ).toBe("/");
  });
});

describe("dashboard areas", () => {
  it("shows every Warehouse Administrator area counted by the dashboard", () => {
    expect(
      dashboardAreas(
        memoryAccess({
          core: ["staff"],
          warehouse: ["warehouse_admin"],
          events: ["admin"],
          insights: ["admin"],
        }),
        "employee",
      ).map((area) => area.label),
    ).toEqual([
      "My Work",
      "Events",
      "Warehouse",
      "Insights",
      "Finance",
      "Knowledge Base",
    ]);
  });

  it("includes the editable DOA area for authorized administrators", () => {
    expect(
      dashboardAreas(
        memoryAccess({ core: ["platform_admin", "staff"] }),
        "employee",
      ).map((area) => area.label),
    ).toEqual([
      "My Work",
      "Administration",
      "Departments",
      "Delegation of Authority",
      "Knowledge Base",
    ]);
  });

  it.each<[Partial<UserRoles>, string]>([
    [{ core: ["staff"], warehouse: ["finance"] }, "Warehouse Finance"],
    [{ core: ["staff"], procurement: ["finance"] }, "Procurement Finance"],
    [
      {
        core: ["staff"],
        warehouse: ["finance"],
        procurement: ["finance"],
      },
      "dual Finance",
    ],
  ])("gives %s one first-class Finance area", (roles) => {
    const access = memoryAccess(roles);
    const finance = dashboardAreas(access, "employee").filter(
      (area) => area.label === "Finance",
    );
    expect(finance).toHaveLength(1);
    expect(finance[0]?.href).toBe("/finance");
    expect(canAccessFinance(access)).toBe(true);
  });

  it("does not grant Finance through unrelated roles", () => {
    const roles = {
      core: ["staff"],
      warehouse: ["operations"],
      procurement: ["requester"],
    };
    const access = memoryAccess(roles);
    expect(canAccessFinance(access)).toBe(false);
    expect(
      dashboardAreas(access, "employee").some(
        (area) => area.label === "Finance",
      ),
    ).toBe(false);
  });
});

describe("configurable organization administration", () => {
  const source = (path: string) =>
    readFileSync(resolve(process.cwd(), path), "utf8");

  it("registers the governed Department Administration route", () => {
    expect(
      SHELL_PAGE_ROUTE_CONTRACTS.find(
        (item) => item.route === "/admin/departments",
      ),
    ).toMatchObject({
      module: "admin",
      capabilityIds: ["manage_rbac"],
      administratorRoleIds: ["platform_admin"],
    });
  });

  it("uses the live RBAC catalogue for live user administration", () => {
    const users = source("app/admin/users/page.tsx");
    expect(users).toContain("rpc('list_rbac_catalog')");
    expect(users).toContain("is_active");
    expect(users).toContain("Inactive");
  });

  it("provides a sheet-based department tree editor with safe parent choices", () => {
    const departments = source("app/admin/departments/page.tsx");
    expect(departments).toContain('rpc("list_departments")');
    expect(departments).toContain('rpc("upsert_department"');
    expect(departments).toContain("descendantIds");
    expect(departments).toContain("deactivation_blocked_reason");
    expect(departments).toContain("<Sheet");
    expect(departments).toContain("Sort order");
    expect(departments).toContain('role="tree"');
    expect(departments).toContain('role="treeitem"');
    expect(departments).toContain("aria-level={depth + 1}");
    expect(departments).toContain("Reports to");
    expect(departments).toContain("Confirm deactivation");
    expect(departments).toContain("Historical assignments remain available");
    expect(departments).toContain("expected_updated_at");
  });
});

describe("mobile contextual actions", () => {
  it("does not show Legal or Procurement write actions without permission", () => {
    expect(mobileCenterAction("/legal", memoryAccess({}))).toBeNull();
    expect(mobileCenterAction("/procurement", memoryAccess({}))).toBeNull();
  });

  it("shows actions only for a role with the required capability", () => {
    expect(
      mobileCenterAction("/legal", memoryAccess({ legal: ["admin"] }))?.label,
    ).toBe("Invite vendor");
    expect(
      mobileCenterAction(
        "/procurement",
        memoryAccess({ procurement: ["requester"] }),
      )?.label,
    ).toBe("New request");
    expect(
      mobileCenterAction("/events", memoryAccess({ events: ["requester"] }))
        ?.label,
    ).toBe("New event");
  });
});
