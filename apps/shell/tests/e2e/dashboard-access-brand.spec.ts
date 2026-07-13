import { expect, test } from "@playwright/test";

const WAREHOUSE_ADMIN_SESSION = {
  profileId: "demo-warehouse-admin",
  roles: { core: ["staff"], warehouse: ["warehouse_admin"] },
};

test.describe("dashboard access and brand truthfulness", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((session) => {
      window.sessionStorage.setItem(
        "intra.memory-session.v1",
        JSON.stringify(session),
      );
    }, WAREHOUSE_ADMIN_SESSION);
  });

  test("Warehouse Administrator sees every counted area and an unclipped Intra lockup", async ({
    page,
  }, testInfo) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Alex" })).toBeVisible();

    const hero = page
      .getByText("Areas available", { exact: true })
      .locator("xpath=ancestor::div[contains(@class, 'hero-surface')]");
    await expect(hero).toContainText(/3\s*areas/);
    await expect(hero.getByRole("link", { name: "Warehouse" })).toBeVisible();
    await expect(hero.getByRole("link", { name: "Finance" })).toBeVisible();
    await expect(
      hero.getByRole("link", { name: "Knowledge Base" }),
    ).toBeVisible();

    const areaCards = page.locator("#workspace-area-cards");
    await expect(areaCards).toBeVisible();
    await expect(areaCards.getByRole("link")).toHaveCount(3);
    await expect(
      areaCards.getByRole("link", { name: /Warehouse/ }),
    ).toBeVisible();
    await expect(
      areaCards.getByRole("link", { name: /Finance/ }),
    ).toBeVisible();
    await expect(
      areaCards.getByRole("link", { name: /Knowledge Base/ }),
    ).toBeVisible();

    const isTablet = testInfo.project.name.startsWith("tablet");
    const logo = page.locator('img[src*="mwell-wordmark"]:visible').first();
    const logoBox = isTablet ? null : await logo.boundingBox();
    if (isTablet) {
      await expect(
        page
          .getByRole("complementary", { name: "Primary" })
          .getByText("M", { exact: true }),
      ).toBeVisible();
    } else {
      await expect(logo).toBeVisible();
      expect(logoBox?.width ?? 0).toBeGreaterThan(55);
      expect(logoBox?.height ?? 0).toBeGreaterThan(18);
    }

    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(viewport!.width + 1);

    if (testInfo.project.name.startsWith("mobile")) {
      const brandBox = await page
        .locator('header [aria-label="mWell Intra"]:visible')
        .boundingBox();
      const actionsBox = await page
        .locator('[data-shell-header-actions="true"]')
        .boundingBox();
      expect(brandBox).not.toBeNull();
      expect(actionsBox).not.toBeNull();
      expect(brandBox!.x + brandBox!.width).toBeLessThanOrEqual(actionsBox!.x);
    }

    if (testInfo.project.name.startsWith("desktop")) {
      const sidebar = page.getByRole("complementary", { name: "Primary" });
      const sidebarBox = await sidebar.boundingBox();
      expect(sidebarBox).not.toBeNull();
      expect(logoBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x);
      expect(logoBox!.x + logoBox!.width).toBeLessThanOrEqual(
        sidebarBox!.x + sidebarBox!.width,
      );
      await expect(sidebar.getByText("Intra", { exact: true })).toBeVisible();
    }

    await page.screenshot({
      path: testInfo.outputPath(`dashboard-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });
});
