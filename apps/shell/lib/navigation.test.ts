import { describe, expect, it } from "vitest";
import { dashboardAreas, mobileCenterAction } from "./navigation";

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
