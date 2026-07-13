import { describe, expect, it } from "vitest";
import { SHELL_PAGE_ROUTE_CONTRACTS } from "./routes";

describe("shell governance routes", () => {
  it("publishes a governed administration landing route", () => {
    expect(
      SHELL_PAGE_ROUTE_CONTRACTS.find((item) => item.route === "/admin"),
    ).toMatchObject({
      module: "admin",
      capabilityIds: ["manage_rbac"],
      administratorRoleIds: ["platform_admin"],
    });
  });
});
