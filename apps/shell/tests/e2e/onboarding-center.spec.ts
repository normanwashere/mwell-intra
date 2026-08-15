import { expect, test, type Page } from "@playwright/test";
import { auditWarehouseLayout } from "../helpers/warehouseLayoutAudit";

const SESSION_KEY = "intra.memory-session.v1";

async function installSession(
  page: Page,
  session: { profileId: string; roles: Record<string, readonly string[]> },
) {
  await page.addInitScript(
    ({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)),
    { key: SESSION_KEY, value: session },
  );
}

async function expectStableLayout(page: Page) {
  const audit = await auditWarehouseLayout(page);
  expect(audit.overflowElements).toEqual([]);
  expect(audit.clippedControls).toEqual([]);
  expect(audit.deadEnds).toEqual([]);
  expect(audit.overlaps).toEqual([]);
}

test.describe("personalized onboarding center", () => {
  test("employee can discover and open role-accurate onboarding without a blank or loop", async ({
    page,
  }, testInfo) => {
    await installSession(page, {
      profileId: "demo-operations",
      roles: { core: ["staff"], warehouse: ["operations"] },
    });

    await page.goto("/");
    await expect(
      page.getByRole("region", { name: "Role readiness" }),
    ).toBeVisible();
    await expect(
      page.getByText("Complete role orientation to enter your modules"),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Start onboarding" }),
    ).toBeVisible();
    await expect(page.getByText("Onboarding required").first()).toBeVisible();
    await expect(page.getByText("0 of 1 required step complete")).toBeVisible();
    await expect(
      page.locator("#workspace-area-cards").getByRole("link", {
        name: /Knowledge Base Search role guides/,
      }),
    ).toHaveAttribute("href", "/knowledge");
    const warehouseCard = page
      .locator("#workspace-area-cards")
      .getByRole("link", { name: "Warehouse, onboarding required" });
    await expect(warehouseCard).toBeVisible();
    await expectStableLayout(page);
    await page.screenshot({
      path: testInfo.outputPath(
        `onboarding-gate-home-${testInfo.project.name}.png`,
      ),
      fullPage: true,
    });

    await warehouseCard.click();
    await expect(page).toHaveURL(/\/onboarding\?next=%2Fwarehouse%2F$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Role onboarding" }),
    ).toBeVisible();
    await expect(
      page.getByRole("main").getByText("General Employee", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/required steps complete/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start Role orientation" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start Role orientation" }),
    ).toHaveCount(1);
    await expect(
      page
        .getByRole("region", { name: "Your required steps" })
        .getByText("Continue above", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("No onboarding assigned yet")).toHaveCount(0);
    await expectStableLayout(page);
    await page.screenshot({
      path: testInfo.outputPath(
        `onboarding-role-orientation-${testInfo.project.name}.png`,
      ),
      fullPage: true,
    });

    await page.getByRole("button", { name: "Start Role orientation" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("button", { name: "Finish review" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Continue to Warehouse" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Continue to Warehouse" }).click();
    await expect(page).toHaveURL(/\/warehouse\/?$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Warehouse dashboard" }),
    ).toBeVisible();

    await expectStableLayout(page);
    await page.screenshot({
      path: testInfo.outputPath(
        `onboarding-destination-${testInfo.project.name}.png`,
      ),
      fullPage: true,
    });
  });

  const employeeModuleCases = [
    {
      profileId: "demo-warehouse-operator",
      roles: { core: ["staff"], warehouse: ["warehouse_operator"] },
      module: "Warehouse",
    },
    {
      profileId: "demo-procurement",
      roles: {
        core: ["staff"],
        procurement: ["procurement_officer", "admin"],
        warehouse: ["procurement"],
      },
      module: "Procurement",
    },
    {
      profileId: "demo-legal",
      roles: {
        core: ["staff"],
        legal: ["legal_reviewer", "compliance", "admin"],
      },
      module: "Legal",
    },
    {
      profileId: "demo-finance",
      roles: {
        core: ["staff"],
        warehouse: ["finance"],
        procurement: ["finance"],
        events: ["finance_reviewer"],
      },
      module: "Finance",
    },
    {
      profileId: "demo-marketing",
      roles: {
        core: ["staff"],
        warehouse: ["marketing"],
        events: ["coordinator", "admin"],
      },
      module: "Events",
    },
    {
      profileId: "demo-bi",
      roles: {
        core: ["staff"],
        warehouse: ["bi_analyst"],
        insights: ["analyst", "manager", "executive"],
      },
      module: "Insights",
    },
    {
      profileId: "demo-product-owner",
      roles: {
        core: ["staff"],
        product: ["product_owner"],
        events: ["viewer"],
      },
      module: "Product",
    },
    {
      profileId: "demo-admin",
      roles: { core: ["platform_admin", "staff"] },
      module: "Administration",
    },
  ] as const;

  for (const roleCase of employeeModuleCases) {
    test(`${roleCase.module} assignment stays visible but requires first-time orientation`, async ({
      page,
    }) => {
      await installSession(page, roleCase);
      await page.goto("/");

      const moduleCard = page
        .locator("#workspace-area-cards")
        .getByRole("link", {
          name: `${roleCase.module}, onboarding required`,
        });
      await expect(moduleCard).toBeVisible();
      await expect(moduleCard).toHaveAttribute("href", /\/onboarding\?next=/);

      await moduleCard.click();
      await expect(
        page.getByRole("heading", { level: 1, name: "Role onboarding" }),
      ).toBeVisible();
    });
  }

  test("first-time employee cannot bypass orientation with a direct module URL", async ({
    page,
  }) => {
    await installSession(page, {
      profileId: "demo-operations",
      roles: { core: ["staff"], warehouse: ["operations"] },
    });

    await page.goto("/procurement/requests/new");
    await expect(page).toHaveURL(
      /\/onboarding\?next=%2Fprocurement%2Frequests%2Fnew$/,
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Role onboarding" }),
    ).toBeVisible();
    await expect(page.getByText("No onboarding assigned yet")).toHaveCount(0);
  });

  test("vendor is handed off to an isolated vendor curriculum and stable recovery chrome", async ({
    page,
  }, testInfo) => {
    await installSession(page, {
      profileId: "demo-vendor",
      roles: { core: ["vendor_portal"] },
    });

    await page.goto("/onboarding");
    await expect(
      page.getByRole("link", { name: "Continue to vendor onboarding" }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Continue to vendor onboarding" })
      .click();

    await expect(page).toHaveURL(/\/vendor\/onboarding$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Vendor onboarding" }),
    ).toBeVisible();
    await expect(
      page.getByText("Vendor Representative", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Vendor portal", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Primary mobile" }),
    ).toHaveCount(0);

    await expectStableLayout(page);
    await page.screenshot({
      path: testInfo.outputPath(
        `onboarding-vendor-${testInfo.project.name}.png`,
      ),
      fullPage: true,
    });
  });

  test("employee cannot open the isolated vendor curriculum directly", async ({
    page,
  }) => {
    await installSession(page, {
      profileId: "demo-operations",
      roles: { core: ["staff"], warehouse: ["operations"] },
    });

    await page.goto("/vendor/onboarding");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Vendor onboarding unavailable",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Return home" }),
    ).toHaveAttribute("href", "/");
    await expect(
      page.getByText("Vendor Representative", { exact: true }),
    ).toHaveCount(0);
    await expectStableLayout(page);
  });
});
