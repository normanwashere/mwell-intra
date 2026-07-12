import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { KNOWLEDGE_CONTENT } from "../../lib/knowledge/content";

const MEMORY_SESSION_KEY = "intra.memory-session.v1";
const EXPECTED_VIEWPORTS: Record<string, [number, number]> = {
  "desktop-1440": [1440, 900], "desktop-1280": [1280, 800], "tablet-768": [768, 1024],
  "mobile-390": [390, 844], "mobile-360": [360, 800], "mobile-320": [320, 720],
};
const PAGES = [
  ["landing", "/knowledge"], ["role", `/knowledge?article=role-${KNOWLEDGE_CONTENT.roles[0]!.id}`],
  ["feature", `/knowledge?article=feature-${KNOWLEDGE_CONTENT.features[0]!.id}`],
  ["flow", `/knowledge?flow=${KNOWLEDGE_CONTENT.flows[0]!.id}&view=flow`],
  ["decision", `/knowledge?flow=${KNOWLEDGE_CONTENT.flows[0]!.id}&view=steps&step=${KNOWLEDGE_CONTENT.flows[0]!.nodes.find((n) => n.type === "decision")!.id}`],
  ["exception", `/knowledge?flow=${KNOWLEDGE_CONTENT.flows[0]!.id}&view=exceptions`],
  ["admin", "/knowledge?article=admin-doa"], ["no-result", "/knowledge?q=no-such-operation-9274"],
  ["coming-soon", "/knowledge?type=future"],
] as const;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ key, session }) => sessionStorage.setItem(key, JSON.stringify(session)), {
    key: MEMORY_SESSION_KEY, session: { profileId: "demo-admin", roles: { core: ["admin"], warehouse: ["admin"], legal: ["legal_admin"] } },
  });
});

async function assertVisualIntegrity(page: Page) {
  const problems = await page.evaluate(() => {
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect(); const style = getComputedStyle(el);
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    };
    const label = (el: Element) => el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 80) || el.tagName;
    const controls = [...document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [role="tab"]')].filter(visible);
    const clipped = [...document.querySelectorAll<HTMLElement>("h1,h2,h3,p,label")].filter(visible).filter((el) => { const style = getComputedStyle(el); return el.scrollWidth > el.clientWidth + 2 && style.overflowX !== "auto" && style.overflow !== "hidden" && style.textOverflow !== "ellipsis"; }).map(label);
    const minimum = innerWidth < 640 ? 44 : 24;
    const undersized = controls.filter((el) => { const r = el.getBoundingClientRect(); return (r.width < minimum || r.height < minimum) && !el.closest("[data-compact-control]"); }).map(label);
    const mobileNav = document.querySelector<HTMLElement>('nav[aria-label="Primary mobile"]');
    const navRect = mobileNav && visible(mobileNav) ? mobileNav.getBoundingClientRect() : null;
    const intercepted = controls.filter((el) => { const r = el.getBoundingClientRect(); if (r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight) return false; const x = r.left + r.width / 2; const y = r.top + r.height / 2; if (navRect && y >= navRect.top) return false; const top = document.elementFromPoint(x, y); return top && top !== el && !el.contains(top); }).map(label);
    const main = document.querySelector("main");
    const navClearance = navRect && main ? Number.parseFloat(getComputedStyle(main).paddingBottom) - navRect.height : 0;
    return { overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, clipped, undersized, intercepted, navClearance, main: document.querySelectorAll("main").length, h1: document.querySelectorAll("main h1").length };
  });
  expect(problems.overflow, JSON.stringify(problems)).toBeLessThanOrEqual(1);
  expect(problems.clipped).toEqual([]); expect(problems.undersized).toEqual([]);
  expect(problems.intercepted).toEqual([]); expect(problems.navClearance).toBeGreaterThanOrEqual(0);
  expect(problems.main).toBe(1); expect(problems.h1).toBeGreaterThan(0);

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations).toEqual([]);
  for (const hotspot of await page.locator('figure button[aria-pressed]').all()) {
    const box = await hotspot.boundingBox(); const image = hotspot.locator("xpath=ancestor::*[.//img][1]//img"); const imageBox = await image.boundingBox();
    expect(box).not.toBeNull(); expect(imageBox).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(imageBox!.x - 1); expect(box!.y).toBeGreaterThanOrEqual(imageBox!.y - 1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(imageBox!.x + imageBox!.width + 1);
    expect(box!.y + box!.height).toBeLessThanOrEqual(imageBox!.y + imageBox!.height + 1);
  }
  const shot = await page.screenshot();
  expect(shot.byteLength).toBeGreaterThan(12_000);
  const colors = await page.evaluate(async (data) => { const image = new Image(); image.src = `data:image/png;base64,${data}`; await image.decode(); const canvas = document.createElement("canvas"); canvas.width = 64; canvas.height = 64; const ctx = canvas.getContext("2d")!; ctx.drawImage(image, 0, 0, 64, 64); const pixels = ctx.getImageData(0, 0, 64, 64).data; const set = new Set<string>(); for (let i = 0; i < pixels.length; i += 16) set.add(`${pixels[i] >> 4}-${pixels[i + 1] >> 4}-${pixels[i + 2] >> 4}`); return set.size; }, shot.toString("base64"));
  expect(colors).toBeGreaterThan(8);
}

for (const [name, route] of PAGES) {
  test(`${name} passes responsive, interaction, pixel, and accessibility gates`, async ({ page }, testInfo) => {
    const expected = EXPECTED_VIEWPORTS[testInfo.project.name]; expect(expected, `unapproved project ${testInfo.project.name}`).toBeTruthy();
    expect(page.viewportSize()).toEqual({ width: expected![0], height: expected![1] });
    await page.goto(route); await expect(page.getByRole("main")).toBeVisible(); await expect(page.locator("body")).not.toContainText("Restoring your session");
    await assertVisualIntegrity(page);
  });
}
