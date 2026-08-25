import { expect, test } from "@playwright/test";

const WAREHOUSE_ADMIN_SESSION = {
  profileId: "demo-warehouse-admin",
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
    await expect(
      page.getByText("Welcome back, Alex", { exact: true }),
    ).toBeVisible();

    const hero = page
      .getByText("Areas available", { exact: true })
      .locator("xpath=ancestor::*[contains(@class, 'hero-surface')][1]");
    await expect(hero).toContainText(/4\s*areas/);
    await expect(hero.getByRole("link", { name: "My Work" })).toBeVisible();
    await expect(hero.getByRole("link", { name: "Warehouse" })).toBeVisible();
    await expect(hero.getByRole("link", { name: "Finance" })).toBeVisible();
    await expect(
      hero.getByRole("link", { name: "+1 more below" }),
    ).toBeVisible();

    const areaCards = page.locator("#workspace-area-cards");
    await expect(areaCards).toBeVisible();
    await expect(areaCards.getByRole("link")).toHaveCount(4);
    await expect(
      areaCards.getByRole("link", { name: /My Work/ }),
    ).toBeVisible();
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
    await expect(logo).toBeVisible();
    const logoBox = await logo.boundingBox();
    expect(logoBox?.width ?? 0).toBeGreaterThan(isTablet ? 35 : 55);
    expect(logoBox?.height ?? 0).toBeGreaterThan(isTablet ? 10 : 18);

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

      const clippedMobileLabels = await page
        .getByRole("navigation", { name: "Primary mobile" })
        .locator("a > span:last-child")
        .evaluateAll((labels) =>
          labels
            .filter((label) => label.scrollWidth > label.clientWidth + 1)
            .map((label) => label.textContent?.trim()),
        );
      expect(clippedMobileLabels).toEqual([]);
    }

    if (
      testInfo.project.name.startsWith("desktop") ||
      testInfo.project.name.startsWith("tablet")
    ) {
      const sidebar = page.getByRole("complementary", { name: "Primary" });
      const sidebarBox = await sidebar.boundingBox();
      expect(sidebarBox).not.toBeNull();
      expect(logoBox!.x).toBeGreaterThanOrEqual(sidebarBox!.x);
      expect(logoBox!.x + logoBox!.width).toBeLessThanOrEqual(
        sidebarBox!.x + sidebarBox!.width,
      );
      if (testInfo.project.name.startsWith("desktop")) {
        await expect(sidebar.getByText("Intra", { exact: true })).toBeVisible();
      }
    }

    await page.screenshot({
      path: testInfo.outputPath(`dashboard-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });

  test("the approved wordmark remains legible in dark mode", async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("intra-theme", "dark");
    });
    await page.goto("/");

    const logo = page.locator('img[src*="mwell-wordmark"]:visible').first();
    await expect(logo).toBeVisible();
    await expect(page.locator("html")).toHaveClass(/dark/);
    expect(
      await logo.evaluate((element) => getComputedStyle(element).filter),
    ).not.toBe("none");

    await page.screenshot({
      path: testInfo.outputPath(`dashboard-dark-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });
});
