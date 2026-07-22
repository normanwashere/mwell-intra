import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

describe("Product governance route", () => {
  it("hosts the Product workspace behind Product capabilities", () => {
    expect(
      SHELL_PAGE_ROUTE_CONTRACTS.find((item) => item.route === "/product"),
    ).toMatchObject({
      module: "product",
      capabilityIds: ["view_readiness"],
    });
    expect(
      readFileSync(
        resolve(process.cwd(), "app/product/[[...slug]]/page.tsx"),
        "utf8",
      ),
    ).toContain("<ProductApp");
  });
});
