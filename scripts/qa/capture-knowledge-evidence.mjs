import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const require = createRequire(path.resolve("apps/shell/package.json"));
const { chromium } = require("@playwright/test");

const baseUrl = process.env.AUDIT_BASE_URL?.replace(/\/$/, "");
const password = process.env.AUDIT_PASSWORD;
const authMode = process.env.EVIDENCE_AUTH_MODE ?? "live";
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
}) {
  const context = await browser.newContext({
    viewport,
    serviceWorkers: "allow",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
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
    await page.locator('button[aria-label*=". action."]').first().click();
    await page.waitForURL((url) => url.searchParams.has("step"));
    await page.getByRole("heading", { name: /complete decision tree/i }).waitFor();
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
  name: "warehouse-storage-desktop",
  route: "/warehouse/storage",
  viewport: { width: 1440, height: 900 },
  email: "intra.test.wh.warehouse.admin@mwell.com.ph",
  expectedText: "Storage",
  output: publicOutput,
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
