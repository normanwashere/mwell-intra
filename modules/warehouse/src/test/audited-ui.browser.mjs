import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const require = createRequire(path.join(root, "apps/shell/package.json"));
const { chromium, expect } = require("@playwright/test");
const { build } = require("esbuild");
const AxeBuilder = require("@axe-core/playwright").default;
const base = "http://localhost:3021";
const role = process.env.WAREHOUSE_BROWSER_ROLE ?? "warehouse_operator";
assert(["warehouse_operator", "warehouse_admin", "marketing"].includes(role));
const output = path.join(
  root,
  "modules/warehouse/output/playwright/sep11-audited-ui",
  role,
);
await mkdir(output, { recursive: true });

// Transpile test helpers only, not the running application or Next build directory.
const helpers = await build({
  stdin: {
    contents: `export {buildSeed} from './packages/data-kit/src/seed';
    export {installWarehouseSession} from './apps/shell/tests/helpers/warehouseFixtures';`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
});
const helperModule = { exports: {} };
new Function("exports", "module", "require", helpers.outputFiles[0].text)(
  helperModule.exports,
  helperModule,
  require,
);
const { buildSeed, installWarehouseSession } = helperModule.exports;
const data = buildSeed();
const now = "2026-09-11T00:00:00Z";
data.fulfillmentOrders = Array.from({ length: 12 }, (_, index) => ({
  id: `browser-order-${index}`,
  externalReference: `BROWSER-ORDER-${index}`,
  source: "ecommerce",
  ecommerceChannel: "Shopee",
  sourceLocationId: "loc-wh",
  status: "received",
  createdBy: "fixture",
  createdAt: now,
  updatedAt: now,
  deliveryMethod: "shipment",
  shipmentEvents: [],
  packaging: [],
  lines: Array.from({ length: 12 }, (_, line) => ({
    productId: data.products[line % data.products.length].id,
    quantity: 1,
    pickedQuantity: 0,
    pickedSerialNumbers: [],
  })),
}));

const browser = await chromium.launch();
const results = [];
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [320, 720],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await context.route("**/*", (route) => {
      const request = route.request();
      if (
        new URL(request.url()).origin !== base ||
        !["GET", "HEAD"].includes(request.method())
      )
        return route.abort();
      return route.continue();
    });
    await installWarehouseSession(page, role);
    await page.addInitScript((seed) => {
      const key = "mwell-intra-warehouse:data:v2";
      if (!localStorage.getItem(key))
        localStorage.setItem(key, JSON.stringify(seed));
    }, data);
    try {
      await page.goto(`${base}/warehouse/fulfillment?tab=orders`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByRole("heading", {
          name: role === "warehouse_operator" ? "Pick & Pack" : "Fulfillment",
          exact: true,
        }),
      ).toBeVisible({ timeout: 60000 });
      await expect(
        page.getByRole("list", { name: "Fulfillment demand" }),
      ).toBeVisible();
      const first = page.getByRole("listitem", {
        name: "Order BROWSER-ORDER-0",
        exact: true,
      });
      const bounds = await first.boundingBox();
      assert(
        bounds && bounds.y < height,
        `First order starts at ${bounds?.y}, viewport ${height}`,
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      );
      assert(overflow <= 2, `Document overflow: ${overflow}`);
      await page.screenshot({
        path: path.join(output, `${width}-queue.png`),
        animations: "disabled",
      });
      await page.getByText("Queue tools", { exact: true }).click();
      const tools = page.getByRole("button", { name: "Export current view" });
      await expect(tools).toBeVisible();
      const toolBounds = await tools.boundingBox();
      assert(
        toolBounds.x >= 0 && toolBounds.x + toolBounds.width <= width + 1,
        "Tools must fit viewport",
      );
      await page.getByText("Queue tools", { exact: true }).click();
      await page.getByLabel("Status", { exact: true }).selectOption("all");
      await expect(page.getByLabel("Status", { exact: true })).toHaveValue(
        "all",
      );
      await page
        .getByLabel("Search orders", { exact: true })
        .fill("BROWSER-ORDER-0");
      await expect(
        page.getByLabel("Search orders", { exact: true }),
      ).toHaveValue("BROWSER-ORDER-0");
      await expect(
        page.getByRole("button", { name: "View order details", exact: true }),
      ).toHaveCount(1);
      await page.getByLabel("Channel", { exact: true }).selectOption("Shopee");
      await expect(
        page.getByLabel("Search orders", { exact: true }),
      ).toHaveValue("BROWSER-ORDER-0");
      console.log("Filtered URL", page.url());
      const queueUrl = page.url();
      const trigger = page.getByRole("button", {
        name: "View order details",
        exact: true,
      });
      await trigger.click();
      const dialog = page.getByRole("dialog", {
        name: "Order details / BROWSER-ORDER-0",
        exact: true,
      });
      await expect(dialog).toBeVisible();
      assert.equal(
        new URL(page.url()).searchParams.get("order"),
        "browser-order-0",
      );
      await page.goBack();
      await expect(dialog).toBeHidden();
      assert.equal(page.url(), queueUrl);
      await page.goForward();
      await expect(dialog).toBeVisible();
      await page.reload();
      await expect(dialog).toBeVisible({ timeout: 60000 });
      const region = dialog.getByRole("region", {
        name: "Order details / BROWSER-ORDER-0 content",
        exact: true,
      });
      await dialog.getByRole("button", { name: "Close", exact: true }).focus();
      await page.keyboard.press("Tab");
      await expect(region).toBeFocused();
      await page.keyboard.press("PageDown");
      await expect
        .poll(() => region.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      await page.screenshot({
        path: path.join(output, `${width}-detail-keyboard.png`),
        animations: "disabled",
      });
      const axe = await new AxeBuilder({ page })
        .withRules(["scrollable-region-focusable"])
        .analyze();
      assert.deepEqual(axe.violations, []);
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(page.getByLabel("Status", { exact: true })).toHaveValue(
        "all",
      );
      await expect(
        page.getByLabel("Search orders", { exact: true }),
      ).toHaveValue("BROWSER-ORDER-0");
      await trigger.click();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await page.goto(`${base}/warehouse/exceptions`, {
        waitUntil: "domcontentloaded",
      });
      const main = page.getByRole("main", { name: "Warehouse workspace" });
      await expect(main).toBeVisible({ timeout: 60000 });
      assert.equal(await main.getAttribute("tabindex"), "0");
      await main.focus();
      await page.keyboard.press("PageDown");
      const exceptionsAxe = await new AxeBuilder({ page })
        .withRules(["scrollable-region-focusable"])
        .analyze();
      assert.deepEqual(exceptionsAxe.violations, []);
      assert.deepEqual(errors, []);
      results.push({
        width,
        height,
        firstOrderY: bounds.y,
        overflow,
        status: "passed",
        mode: "isolated memory fixtures, external requests blocked",
      });
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
  await writeFile(
    path.join(output, "results.json"),
    JSON.stringify(results, null, 2),
  );
}
console.log(JSON.stringify(results, null, 2));
