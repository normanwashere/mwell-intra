import { expect, test, type Page } from "@playwright/test";

const SESSION_KEY = "intra.memory-session.v1";

async function installSession(
  page: Page,
  profileId: string,
  roles: Record<string, string[]>,
) {
  await page.addInitScript(
    ({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)),
    { key: SESSION_KEY, value: { profileId, roles } },
  );
}

test("department hierarchy horizontal region is keyboard reachable", async ({
  page,
}) => {
  await installSession(page, "demo-admin", {
    core: ["platform_admin", "staff"],
  });
  await page.goto("/admin/departments");

  const region = page.getByRole("region", {
    name: "Department hierarchy table",
  });
  await expect(region).toHaveAttribute("tabindex", "0");
  await region.focus();
  await expect(region).toBeFocused();
});

test("procurement approval record links meet the mobile touch target", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile target audit");
  await installSession(page, "demo-procurement", {
    core: ["staff"],
    procurement: ["procurement_officer", "admin"],
    warehouse: ["procurement"],
  });
  await page.goto("/procurement/approvals");

  const links = page.locator(
    'main a[href*="/procurement/requests/"], main a[href^="/requests/"]',
  );
  await expect(links.first()).toBeAttached();
  const heights = await links.evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((node) => Math.round(node.getBoundingClientRect().height)),
  );
  expect(heights.length).toBeGreaterThan(0);
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
});

test("finance activity links meet the mobile touch target", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile target audit");
  await installSession(page, "demo-finance", {
    core: ["staff"],
    warehouse: ["finance"],
    procurement: ["finance"],
    events: ["finance_reviewer"],
  });
  await page.goto("/finance");

  const links = page.locator('main a[href*="/procurement/purchase-orders/"]').filter({
    hasText: /^po_seed_/i,
  });
  await expect(links.first()).toBeAttached();
  const heights = await links.evaluateAll((nodes) =>
    nodes
      .map((node) => Math.round(node.getBoundingClientRect().height))
      .filter((height) => height > 0),
  );
  expect(heights.length).toBeGreaterThan(0);
  expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
});

test("vendor home logo meets the mobile touch target", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Mobile target audit");
  await installSession(page, "demo-vendor", { core: ["vendor_portal"] });
  await page.goto("/vendor/onboarding");

  const home = page.getByRole("link", { name: "Vendor portal home" });
  const box = await home.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});
