import { describe, expect, it } from "vitest";
import type { UserRoles } from "@intra/rbac";
import {
  authorizedPostLoginPath,
  canAccessFinance,
  dashboardAreas,
  mobileCenterAction,
} from "./navigation";

describe("authorized post-login destinations", () => {
  it("keeps authorized module and shared destinations", () => {
    const roles: Partial<UserRoles> = {
      core: ["staff"],
      events: ["requester"],
      insights: ["analyst"],
      warehouse: ["finance"],
    };
    expect(authorizedPostLoginPath("/events", roles, "employee")).toBe(
      "/events",
    );
    expect(
      authorizedPostLoginPath("/insights/warehouse", roles, "employee"),
    ).toBe("/insights/warehouse");
    expect(authorizedPostLoginPath("/finance", roles, "employee")).toBe(
      "/finance",
    );
    expect(authorizedPostLoginPath("/work", roles, "employee")).toBe("/work");
  });

  it("fails closed instead of opening an unauthorized or unknown destination", () => {
    const roles: Partial<UserRoles> = {
      core: ["staff"],
      warehouse: ["logistics_supervisor"],
    };
    expect(authorizedPostLoginPath("/events", roles, "employee")).toBe("/");
    expect(authorizedPostLoginPath("/admin/users", roles, "employee")).toBe(
      "/",
    );
    expect(
      authorizedPostLoginPath("/not-a-real-route", roles, "employee"),
    ).toBe("/");
  });

  it("keeps employee and vendor shared areas separated", () => {
    expect(
      authorizedPostLoginPath("/vendor", { core: ["vendor"] }, "vendor"),
    ).toBe("/vendor");
    expect(
      authorizedPostLoginPath("/work", { core: ["vendor"] }, "vendor"),
    ).toBe("/");
    expect(
      authorizedPostLoginPath("/vendor", { core: ["staff"] }, "employee"),
    ).toBe("/");
  });
});

describe("dashboard areas", () => {
  it("shows every Warehouse Administrator area counted by the dashboard", () => {
    expect(
      dashboardAreas(
        {
          core: ["staff"],
          warehouse: ["warehouse_admin"],
          events: ["admin"],
          insights: ["admin"],
        },
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
      dashboardAreas({ core: ["platform_admin", "staff"] }, "employee").map(
        (area) => area.label,
      ),
    ).toEqual([
      "My Work",
      "Administration",
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
    const finance = dashboardAreas(roles, "employee").filter(
      (area) => area.label === "Finance",
    );
    expect(finance).toHaveLength(1);
    expect(finance[0]?.href).toBe("/finance");
    expect(canAccessFinance(roles)).toBe(true);
  });

  it("does not grant Finance through unrelated roles", () => {
    const roles = {
      core: ["staff"],
      warehouse: ["operations"],
      procurement: ["requester"],
    };
    expect(canAccessFinance(roles)).toBe(false);
    expect(
      dashboardAreas(roles, "employee").some(
        (area) => area.label === "Finance",
      ),
    ).toBe(false);
  });
});

describe("mobile contextual actions", () => {
  it("does not show Legal or Procurement write actions without permission", () => {
    expect(mobileCenterAction("/legal", {})).toBeNull();
    expect(mobileCenterAction("/procurement", {})).toBeNull();
  });

  it("shows actions only for a role with the required capability", () => {
    expect(mobileCenterAction("/legal", { legal: ["admin"] })?.label).toBe(
      "Invite vendor",
    );
    expect(
      mobileCenterAction("/procurement", { procurement: ["requester"] })?.label,
    ).toBe("New request");
    expect(
      mobileCenterAction("/events", { events: ["requester"] })?.label,
    ).toBe("New event");
  });
});
