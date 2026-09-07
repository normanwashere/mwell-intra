import { test, expect } from "@playwright/test";

for (const theme of ["light", "dark"] as const) {
test(`local ${theme} feature guide exposes early entry and usable overview/policy disclosures`, async ({ page }, info) => {
  await page.addInitScript(value => localStorage.setItem("intra-theme", value), theme);
  await page.addInitScript(() => sessionStorage.setItem("intra.memory-session.v1", JSON.stringify({
    profileId: "demo-procurement", roles: { core: ["staff"], procurement: ["procurement_officer"] },
  })));
  await page.goto("/knowledge?article=feature-procurement-request-detail");
  await expect(page.getByRole("heading", { level: 1, name: "Purchase request detail" })).toBeVisible();
  const entry = page.locator('article > header a[href="#feature-entry"]');
  await expect(entry).toBeVisible();
  const bounds = await entry.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  const overview = page.locator("article > header > details");
  await expect(overview).toHaveJSProperty("open", false);
  await page.screenshot({ path: info.outputPath("guide-early-entry.png") });
  await overview.locator(":scope > summary").click();
  await expect(overview).toHaveJSProperty("open", true);
  await expect(overview.getByText("Audience", { exact: true })).toBeVisible();
  await overview.locator(":scope > summary").click();
  await page.getByRole("tab", { name: "Control reference", exact: true }).click();
  const policy = page.locator("#feature-policy details");
  await expect(policy).toHaveJSProperty("open", false);
  await policy.locator("summary").click();
  await expect(policy.locator("li").first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("guide-policy-disclosure.png") });
  await entry.click();
  await expect(page.getByRole("tab", { name: "Task guide", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#feature-entry")).toBeFocused();
  await page.screenshot({ path: info.outputPath("guide-entry-focused.png") });
  for (const name of ["Task guide", "Control reference"]) {
    const selected = page.getByRole("tab", { name, exact: true });
    await selected.click();
    const ratio = await selected.evaluate(element => {
      const style = getComputedStyle(element);
      const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const luminance = (values: number[]) => values.map(value => value / 255)
        .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
      const foreground = luminance(rgb(style.color));
      const background = luminance(rgb(style.backgroundColor));
      return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    });
    expect(ratio, `${theme} ${name} selected-tab text contrast`).toBeGreaterThanOrEqual(4.5);
  }
});
}
