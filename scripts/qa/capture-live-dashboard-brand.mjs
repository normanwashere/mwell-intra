import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const require = createRequire(path.resolve("apps/shell/package.json"));
const { chromium } = require("@playwright/test");

const baseUrl = process.env.AUDIT_BASE_URL?.replace(/\/$/, "");
const password = process.env.AUDIT_PASSWORD;

if (!baseUrl || !/^https:\/\//.test(baseUrl)) {
  throw new Error("AUDIT_BASE_URL must be the HTTPS production URL.");
}
if (!password) {
  throw new Error("AUDIT_PASSWORD is required and must not be committed.");
}

const viewports = [
  ["desktop-1440", 1440, 900],
  ["desktop-1280", 1280, 800],
  ["tablet-768", 768, 1024],
  ["mobile-390", 390, 844],
  ["mobile-360", 360, 800],
  ["mobile-320", 320, 720],
];
const outputDirectory = path.resolve(
  "test-results",
  "live-dashboard-brand",
);
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = [];

try {
  for (const [name, width, height] of viewports) {
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: width < 768,
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        consoleErrors.push(`${message.type()}: ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email").fill("intra.test.wh.warehouse.admin@mwell.com.ph");
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /^Sign in$/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 30_000,
    });
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Your areas" }).waitFor({
      state: "visible",
      timeout: 30_000,
    });

    const audit = await page.evaluate(() => {
      const areaCards = Array.from(
        document.querySelectorAll("#workspace-area-cards > a"),
      );
      const logo = document.querySelector('img[src*="mwell-wordmark"]');
      const headerActions = document.querySelector(
        '[data-shell-header-actions="true"]',
      );
      const logoBox = logo?.getBoundingClientRect();
      const actionBox = headerActions?.getBoundingClientRect();
      const clippedMobileLabels = Array.from(
        document.querySelectorAll(
          'nav[aria-label="Primary mobile"] a > span:last-child',
        ),
      )
        .filter((label) => label.scrollWidth > label.clientWidth + 1)
        .map((label) => label.textContent?.trim());
      const logoOverlapsActions = Boolean(
        logoBox &&
          actionBox &&
          logoBox.right > actionBox.left &&
          logoBox.left < actionBox.right &&
          logoBox.bottom > actionBox.top &&
          logoBox.top < actionBox.bottom,
      );

      return {
        areaCount: areaCards.length,
        areaLabels: areaCards.map((card) =>
          card.textContent?.replace(/\s+/g, " ").trim(),
        ),
        horizontalOverflow:
          document.documentElement.scrollWidth > window.innerWidth + 1,
        logoLoaded:
          logo instanceof HTMLImageElement &&
          logo.complete &&
          logo.naturalWidth > 0,
        logoOverlapsActions,
        clippedMobileLabels,
      };
    });

    const screenshot = path.join(outputDirectory, `${name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    const ok =
      audit.areaCount === 3 &&
      audit.logoLoaded &&
      !audit.horizontalOverflow &&
      !audit.logoOverlapsActions &&
      audit.clippedMobileLabels.length === 0 &&
      consoleErrors.length === 0;

    results.push({ name, width, height, ok, ...audit, consoleErrors, screenshot });
    console.log(
      JSON.stringify({
        viewport: name,
        ok,
        areaCount: audit.areaCount,
        logoLoaded: audit.logoLoaded,
        overflow: audit.horizontalOverflow,
        overlap: audit.logoOverlapsActions,
        clippedLabels: audit.clippedMobileLabels,
        consoleErrors: consoleErrors.length,
      }),
    );
    await context.close();
  }
} finally {
  await browser.close();
}

const resultPath = path.join(outputDirectory, "results.json");
await writeFile(resultPath, `${JSON.stringify(results, null, 2)}\n`);
if (results.some((result) => !result.ok)) process.exitCode = 1;
