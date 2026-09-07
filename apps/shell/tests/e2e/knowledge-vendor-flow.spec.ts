import { test, expect } from "@playwright/test";
import { DEMO_PROFILES } from "../../lib/demoProfiles";

test("local vendor guide links to its limited self-service flow without internal business routes", async ({ page }, info) => {
  const profile = DEMO_PROFILES.find(item => item.id === "demo-vendor")!;
  await page.addInitScript(value => sessionStorage.setItem("intra.memory-session.v1", JSON.stringify(value)), { profileId: profile.id, roles: profile.roles });
  await page.goto("/knowledge?article=feature-vendor-application");
  await expect(page.locator("article h1")).toBeVisible();
  const hrefs = await page.locator("article a[href]").evaluateAll(nodes => nodes.map(node => node.getAttribute("href")!));
  // A parameterized application route is correctly shown as a record-list instruction, not a fake record link.
  await expect(page.locator("#feature-entry code")).toHaveText("/vendor/cases/:id/application");
  await expect(page.locator("#feature-entry")).toContainText("Open from a record list");
  expect(hrefs.some(href => href.includes(":id"))).toBe(false);
  for (const href of hrefs.filter(value => value.startsWith("/"))) {
    expect(/^\/(vendor(?:\/|$|\?)|knowledge(?:\?|$))/.test(href), href).toBe(true);
  }
  const flow = page.getByRole("button", { name: /Vendor application, evidence and corrections/ }).first();
  await expect(flow).toBeVisible();
  await flow.click();
  await expect(page).toHaveURL(/flow=vendor-application-submission/);
  await expect(page.getByRole("heading", { level: 1, name: "Vendor application, evidence and corrections" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("vendor-limited-flow.png"), fullPage: true });
  await page.screenshot({ path: info.outputPath("vendor-limited-flow-viewport.png") });
  const geometry = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    textOverflow: [...document.querySelectorAll("p")].filter(element => element.getClientRects().length > 0 && element.scrollWidth > element.clientWidth + 1)
      .map(element => ({ text: element.textContent, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth })),
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth);
  expect(geometry.textOverflow).toEqual([]);
  expect(await page.locator('a[href^="/legal"], a[href^="/procurement"], a[href^="/warehouse"], a[href^="/admin"]').count()).toBe(0);
});
