import { describe, expect, it } from "vitest";
import type { UserRoles } from "@intra/rbac";
import {
  canAccessFinance,
  dashboardAreas,
  mobileCenterAction,
} from "./navigation";

describe("dashboard areas", () => {
  it("shows every Warehouse Administrator area counted by the dashboard", () => {
    expect(
      dashboardAreas(
        { core: ["staff"], warehouse: ["warehouse_admin"] },
        "employee",
      ).map((area) => area.label),
    ).toEqual(["Warehouse", "Finance", "Knowledge Base"]);
  });

  it("includes the editable DOA area for authorized administrators", () => {
    expect(
      dashboardAreas({ core: ["platform_admin", "staff"] }, "employee").map(
        (area) => area.label,
      ),
    ).toEqual(["Administration", "Delegation of Authority", "Knowledge Base"]);
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
  });
});
