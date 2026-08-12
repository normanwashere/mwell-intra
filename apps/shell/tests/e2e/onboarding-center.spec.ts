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
    await expect(page.getByRole("region", { name: "Role readiness" })).toBeVisible();
    await expect(page.getByText("Role orientation", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue onboarding" })).toBeVisible();

    await page.getByRole("link", { name: "Continue onboarding" }).click();
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole("heading", { level: 1, name: "Role onboarding" })).toBeVisible();
    await expect(page.getByText("General Employee", { exact: true })).toBeVisible();
    await expect(page.getByText(/required steps complete/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Start Role orientation" })).toBeVisible();
    await expect(page.getByText("No onboarding assigned yet")).toHaveCount(0);

    await expectStableLayout(page);
    await page.screenshot({
      path: testInfo.outputPath(`onboarding-employee-${testInfo.project.name}.png`),
      fullPage: true,
    });
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
    await page.getByRole("link", { name: "Continue to vendor onboarding" }).click();

    await expect(page).toHaveURL(/\/vendor\/onboarding$/);
    await expect(page.getByRole("heading", { level: 1, name: "Vendor onboarding" })).toBeVisible();
    await expect(page.getByText("Vendor Representative", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Vendor portal", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary mobile" })).toHaveCount(0);

    await expectStableLayout(page);
    await page.screenshot({
      path: testInfo.outputPath(`onboarding-vendor-${testInfo.project.name}.png`),
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
    await expect(page.getByRole("link", { name: "Return home" })).toHaveAttribute(
      "href",
      "/",
    );
    await expect(page.getByText("Vendor Representative", { exact: true })).toHaveCount(0);
    await expectStableLayout(page);
  });
});
