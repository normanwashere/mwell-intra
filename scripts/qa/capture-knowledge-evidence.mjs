import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const require = createRequire(path.resolve("apps/shell/package.json"));
const { chromium } = require("@playwright/test");

const baseUrl = process.env.AUDIT_BASE_URL?.replace(/\/$/, "");
const password = process.env.AUDIT_PASSWORD;
const authMode = process.env.EVIDENCE_AUTH_MODE ?? "live";
const evidenceOnly = process.env.EVIDENCE_ONLY;
if (!baseUrl || (authMode === "live" && !password)) {
  throw new Error(
    "AUDIT_BASE_URL and, for live mode, AUDIT_PASSWORD are required.",
  );
}

const publicOutput = path.resolve("apps/shell/public/knowledge/screenshots");
const manualOutput = path.resolve("docs/manual/assets/knowledge-base");
await Promise.all([
  mkdir(publicOutput, { recursive: true }),
  mkdir(manualOutput, { recursive: true }),
]);

const browser = await chromium.launch({ headless: true });

async function settle(page) {
  await page.waitForLoadState("domcontentloaded");
  await page
    .waitForFunction(
      () => !document.body.innerText.includes("Restoring your session"),
      null,
      {
        timeout: 15_000,
      },
    )
    .catch(() => {});
  await page.waitForTimeout(800);
}

async function login(page, email) {
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 20_000,
  });
  await settle(page);
}

const memoryRoles = {
  "intra.test.proc.requester@mwell.com.ph": {
    profileId: "demo-logistics",
    core: ["staff"],
    procurement: ["requester"],
  },
  "intra.test.wh.logistics@mwell.com.ph": {
    profileId: "demo-logistics",
    core: ["staff"],
    warehouse: ["logistics_supervisor"],
  },
  "intra.test.wh.warehouse.admin@mwell.com.ph": {
    profileId: "demo-warehouse-admin",
    core: ["staff"],
    warehouse: ["warehouse_admin"],
  },
  "intra.test.proc.officer@mwell.com.ph": {
    profileId: "demo-procurement",
    core: ["staff"],
    procurement: ["procurement_officer"],
  },
  "intra.test.admin@mwell.com.ph": {
    profileId: "demo-admin",
    core: ["admin"],
  },
};

async function establishSession(page, email) {
  if (authMode === "live") return login(page, email);
  const fixture = memoryRoles[email] ?? {
    profileId: "demo-operations",
    core: ["staff"],
  };
  const { profileId, ...roles } = fixture;
  await page.addInitScript(
    ({ identity, assignedRoles }) => {
      sessionStorage.setItem(
        "intra.memory-session.v1",
        JSON.stringify({ profileId: identity, roles: assignedRoles }),
      );
    },
    { identity: profileId, assignedRoles: roles },
  );
}

async function capture({
  name,
  route,
  viewport,
  email,
  expectedText,
  output = manualOutput,
  fullPage = true,
  verifyFlowInteraction = false,
  scrollToText,
}) {
  if (evidenceOnly && name !== evidenceOnly) return;
  const context = await browser.newContext({
    viewport,
    serviceWorkers: "allow",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") {
      const location = message.location().url;
      errors.push(`${message.text()}${location ? ` @ ${location}` : ""}`);
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      const headers = response.request().headers();
      errors.push(
        `${response.status()} ${response.url()} profile=${headers["accept-profile"] ?? "missing"}`,
      );
    }
  });

  if (email) await establishSession(page, email);
  await page.goto(`${baseUrl}${route}`);
  await settle(page);
  await page
    .getByText(expectedText, { exact: false })
    .first()
    .waitFor({ timeout: 20_000 });
  await page.waitForFunction(
    () =>
      !document.querySelector('main [aria-busy="true"], main .animate-pulse'),
    null,
    { timeout: 20_000 },
  );

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  if (dimensions.content > dimensions.viewport + 1) {
    throw new Error(
      `${name} overflows horizontally: ${dimensions.content}px > ${dimensions.viewport}px`,
    );
  }
  if (errors.length)
    throw new Error(`${name} emitted browser errors: ${errors.join(" | ")}`);

  const unlabeledControls = await page.evaluate(
    () =>
      [...document.querySelectorAll("button, a")].filter((element) => {
        if (!(element instanceof HTMLElement) || element.offsetParent === null)
          return false;
        return !(
          element.innerText.trim() ||
          element.getAttribute("aria-label") ||
          element.getAttribute("title")
        );
      }).length,
  );
  if (unlabeledControls) {
    throw new Error(
      `${name} contains ${unlabeledControls} unlabeled controls.`,
    );
  }

  if (verifyFlowInteraction) {
    const actionNode = page.locator('a[aria-label*=". action."]').first();
    await actionNode.click();
    await page
      .waitForFunction(
        () => new URL(window.location.href).searchParams.has("step"),
        null,
        { timeout: 5_000 },
      )
      .catch(() => {});
    const selectedStep = await page.evaluate(() =>
      new URL(window.location.href).searchParams.get("step"),
    );
    if (!selectedStep) {
      const state = await actionNode.getAttribute("aria-current");
      const href = await actionNode.getAttribute("href");
      throw new Error(
        `${name} did not deep-link ${href ?? "missing href"} from ${page.url()} (aria-current=${state ?? "missing"}).`,
      );
    }
    await actionNode.waitFor({ state: "visible" });
    await page
      .getByRole("heading", { name: /complete decision tree/i })
      .waitFor();
  }
  if (scrollToText) {
    await page
      .getByText(scrollToText, { exact: false })
      .last()
      .scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  }

  if (fullPage && viewport.width < 768) {
    await page.evaluate(() => {
      for (const element of document.querySelectorAll("body *")) {
        if (getComputedStyle(element).position === "fixed") {
          element.setAttribute("data-evidence-hidden", "true");
        }
      }
    });
    await page.addStyleTag({
      content:
        '[data-evidence-hidden="true"] { visibility: hidden !important; }',
    });
  }

  await page.screenshot({
    path: path.join(output, `${name}.png`),
    fullPage,
    animations: "disabled",
  });
  await context.close();
}

await capture({
  name: "flowchart-procure-to-pay-desktop",
  route: "/knowledge?flow=procure-to-pay",
  viewport: { width: 1440, height: 900 },
  email: "intra.test.proc.requester@mwell.com.ph",
  expectedText: "Complete decision tree",
  verifyFlowInteraction: true,
});
await capture({
  name: "knowledge-home-desktop",
  route: "/knowledge",
  viewport: { width: 1440, height: 900 },
  email: "intra.test.proc.requester@mwell.com.ph",
  expectedText: "What do you need to complete?",
  output: manualOutput,
  fullPage: false,
});
await capture({
  name: "knowledge-home-mobile",
  route: "/knowledge",
  viewport: { width: 390, height: 844 },
  email: "intra.test.proc.requester@mwell.com.ph",
  expectedText: "What do you need to complete?",
  output: manualOutput,
  fullPage: false,
});
await capture({
  name: "flowchart-procure-to-pay-mobile",
  route: "/knowledge?flow=procure-to-pay",
  viewport: { width: 390, height: 844 },
  email: "intra.test.proc.requester@mwell.com.ph",
  expectedText: "Guided workflow",
  verifyFlowInteraction: true,
  fullPage: false,
});
await capture({
  name: "flowchart-receive-to-putaway-mobile",
  route: "/knowledge?flow=receive-to-putaway",
  viewport: { width: 320, height: 720 },
  email: "intra.test.wh.logistics@mwell.com.ph",
  expectedText: "Guided workflow",
  verifyFlowInteraction: true,
  fullPage: false,
});
await capture({
  name: "step-receiving-desktop",
  route: "/knowledge?flow=receive-to-putaway&step=receive-record",
  viewport: { width: 1280, height: 800 },
  email: "intra.test.wh.logistics@mwell.com.ph",
  expectedText: "Record receipt lines",
  scrollToText: "Verified 2026-07-11",
  fullPage: false,
});
await capture({
  name: "step-receiving-mobile",
  route: "/knowledge?flow=receive-to-putaway&step=receive-record",
  viewport: { width: 390, height: 844 },
  email: "intra.test.wh.logistics@mwell.com.ph",
  expectedText: "Record receipt lines",
  scrollToText: "Verified 2026-07-11",
  fullPage: false,
});
await capture({
  name: "warehouse-storage-desktop",
  route: "/warehouse/storage",
  viewport: { width: 1440, height: 900 },
  email: "intra.test.wh.warehouse.admin@mwell.com.ph",
  expectedText: "Storage",
  output: publicOutput,
});
for (const item of [
  ["warehouse-inventory-desktop", "/warehouse/inventory", "Inventory"],
  ["warehouse-allocations-desktop", "/warehouse/allocations", "Allocations"],
  ["warehouse-returns-desktop", "/warehouse/returns", "Returns"],
  ["warehouse-events-desktop", "/warehouse/events", "Events"],
  ["warehouse-cycle-counts-desktop", "/warehouse/cycle-counts", "Cycle Counts"],
  ["warehouse-quality-desktop", "/warehouse/quality", "Quality Control"],
  ["warehouse-approvals-desktop", "/warehouse/approvals", "Stock approvals"],
  ["warehouse-exceptions-desktop", "/warehouse/exceptions", "Exceptions"],
  ["warehouse-pricing-desktop", "/warehouse/pricing", "Pricing"],
  [
    "warehouse-operation-routes-desktop",
    "/warehouse/operation-routes",
    "Operation Routes",
  ],
  [
    "warehouse-purchase-orders-desktop",
    "/warehouse/purchase-orders",
    "Purchase Orders",
  ],
]) {
  await capture({
    name: item[0],
    route: item[1],
    viewport: { width: 1440, height: 900 },
    email: "intra.test.wh.warehouse.admin@mwell.com.ph",
    expectedText: item[2],
    output: publicOutput,
    fullPage: false,
  });
}
await capture({
  name: "procurement-approvals-desktop",
  route: "/procurement/approvals",
  viewport: { width: 1440, height: 900 },
  email: "intra.test.proc.officer@mwell.com.ph",
  expectedText: "Approvals",
  output: publicOutput,
  fullPage: false,
});
await capture({
  name: "procurement-purchase-orders-desktop",
  route: "/procurement/purchase-orders",
  viewport: { width: 1440, height: 900 },
  email: "intra.test.proc.officer@mwell.com.ph",
  expectedText: "Purchase orders",
  output: publicOutput,
  fullPage: false,
});
await capture({
  name: "admin-users-desktop",
  route: "/admin/users",
  viewport: { width: 1440, height: 900 },
  email: "intra.test.admin@mwell.com.ph",
  expectedText: "Users",
  output: publicOutput,
  fullPage: false,
});
await capture({
  name: "admin-doa-desktop",
  route: "/admin/doa",
  viewport: { width: 1440, height: 900 },
  email: "intra.test.admin@mwell.com.ph",
  expectedText: "Delegation",
  output: publicOutput,
  fullPage: false,
});
await capture({
  name: "warehouse-receiving-desktop",
  route: "/warehouse/receiving",
  viewport: { width: 1440, height: 900 },
  email: "intra.test.wh.logistics@mwell.com.ph",
  expectedText: "Receiving",
  output: publicOutput,
});

await browser.close();
console.log("Knowledge Base evidence passed visual guards and was captured.");
