import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  KNOWLEDGE_EVIDENCE,
  KNOWLEDGE_EVIDENCE_SCENARIOS,
} from "../../lib/knowledge/evidence";

const SESSION_KEY = "intra.memory-session.v1";
const REPORT_PATH = path.resolve(process.cwd(), "../../.superpowers/sdd/task-8-report.json");

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

const SESSIONS: Record<
  string,
  { profileId: string; roles: Record<string, string[]> }
> = {
  core_staff_only: {
    profileId: "demo-operations",
    roles: { core: ["staff"] },
  },
  platform_admin: {
    profileId: "demo-admin",
    roles: { core: ["platform_admin", "staff"] },
  },
  vendor_portal: {
    profileId: "demo-vendor",
    roles: { core: ["vendor_portal"] },
  },
  warehouse_logistics_supervisor: {
    profileId: "demo-logistics",
    roles: { core: ["staff"], warehouse: ["logistics_supervisor"] },
  },
  warehouse_operations: {
    profileId: "demo-operations",
    roles: { core: ["staff"], warehouse: ["operations"] },
  },
  warehouse_finance: {
    profileId: "demo-finance",
    roles: { core: ["staff"], warehouse: ["finance"] },
  },
  warehouse_business_unit: {
    profileId: "demo-operations",
    roles: { core: ["staff"], warehouse: ["business_unit"] },
  },
  warehouse_procurement: {
    profileId: "demo-logistics",
    roles: { core: ["staff"], warehouse: ["procurement"] },
  },
  warehouse_pricing: {
    profileId: "demo-pricing",
    roles: { core: ["staff"], warehouse: ["pricing"] },
  },
  warehouse_admin: {
    profileId: "demo-warehouse-admin",
    roles: { core: ["staff"], warehouse: ["warehouse_admin"] },
  },
  procurement_requester: {
    profileId: "demo-logistics",
    roles: { core: ["staff"], procurement: ["requester"] },
  },
  procurement_officer: {
    profileId: "demo-procurement",
    roles: { core: ["staff"], procurement: ["procurement_officer"] },
  },
  procurement_finance: {
    profileId: "demo-procurement-finance",
    roles: { core: ["staff"], procurement: ["finance"] },
  },
  legal_admin: {
    profileId: "demo-legal",
    roles: { core: ["staff"], legal: ["admin"] },
  },
};

async function first(locator: Locator): Promise<Locator> {
  const count = await locator.count();
  expect(count).toBeGreaterThan(0);
  return locator.nth(0);
}

async function openStorageArea(page: Page): Promise<void> {
  await (await first(page.getByRole("button", { name: "Add bin", exact: true }))).click();
  await expect(page.getByRole("dialog", { name: "Add storage area" })).toBeVisible();
}

async function openInspection(page: Page): Promise<void> {
  await (await first(page.getByRole("button", { name: "Inspect", exact: true }))).click();
  await expect(page.getByRole("dialog", { name: "Inspect stock" })).toBeVisible();
}

async function enterShirtCount(page: Page): Promise<void> {
  const label =
    (page.viewportSize()?.width ?? 0) < 640
      ? "Event Shirt (L) counted quantity"
      : "Counted Event Shirt (L)";
  const input = page.getByLabel(label, { exact: true });
  await expect(input).toBeVisible();
  await input.fill("199");
}

async function targetFor(page: Page, nodeId: string): Promise<Locator> {
  switch (nodeId) {
    case "access-start":
    case "recover-retry":
      return page.getByRole("button", { name: "Sign in", exact: true });
    case "access-fix":
      return page.getByRole("heading", { name: "Access matrix" });
    case "p2p-start":
    case "vendor-start":
      return page.getByRole("button", { name: "Continue", exact: true });
    case "p2p-rfq-evidence":
      await page.getByLabel("Sourcing method").selectOption("rfq");
      return page.getByRole("button", { name: "Confirm sourcing route" });
    case "p2p-rfp-evidence":
      await page.getByLabel("Sourcing method").selectOption("rfp");
      return page.getByRole("button", { name: "Confirm sourcing route" });
    case "p2p-po":
      return page.getByRole("link", { name: "Author from approved request" });
    case "p2p-receive":
      return first(page.getByRole("link", { name: "Receive in procurement" }));
    case "p2p-payment-pack":
      return page.getByRole("heading", { name: "Acceptance and payment readiness" });
    case "vendor-apply":
      return page.getByRole("button", { name: "Save draft", exact: true });
    case "setup-start":
      return page.getByLabel("Warehouse");
    case "setup-area":
      await openStorageArea(page);
      return page.getByLabel("Label (optional)");
    case "setup-bin":
      await openStorageArea(page);
      return page.getByLabel("Bin code");
    case "setup-route": {
      await (await first(page.getByRole("button", { name: "Edit route" }))).click();
      return page.getByRole("button", { name: "Save route" });
    }
    case "receive-start":
      return page.getByRole("heading", { name: "Purchase Orders" });
    case "receive-record":
      return page.getByRole("button", { name: "Add to receipt" });
    case "receive-putaway":
      await page.getByRole("button", { name: "Put away" }).click();
      return page.getByRole("button", { name: "Add stock" });
    case "quality-start":
      return first(page.getByRole("button", { name: "Inspect", exact: true }));
    case "quality-release":
      await openInspection(page);
      await page.getByLabel("Disposition").selectOption("accepted");
      return page.getByRole("button", { name: "Submit inspection" });
    case "quality-return":
      return page.getByRole("link", { name: "Open quality queue" });
    case "event-fulfillment-start":
      return page.getByRole("button", { name: "New event" });
    case "event-issue":
    case "allocation-reserve":
      return first(page.getByRole("button", { name: "Issue", exact: true }));
    case "return-start":
      return page.getByLabel("Related event (optional)");
    case "return-restock":
      await page.getByLabel("Disposition").selectOption("restock");
      return page.getByRole("button", { name: "Record return" });
    case "return-quarantine":
      await openInspection(page);
      await page.getByLabel("Disposition").selectOption("hold");
      return page.getByRole("button", { name: "Submit inspection" });
    case "return-adjustment-handoff":
      await enterShirtCount(page);
      return first(page.getByRole("button", { name: /Submit count \(1\// }));
    case "count-start":
      return page.getByLabel("Location");
    case "count-enter":
      return page.getByLabel("Enter barcode manually");
    case "count-investigate":
      await page.getByRole("button", { name: "Variances only" }).click();
      return page.getByRole("button", { name: "Variances only" });
    case "count-post": {
      await page.goto("/warehouse/cycle-counts", { waitUntil: "networkidle" });
      await enterShirtCount(page);
      await (await first(page.getByRole("button", { name: /Submit count \(1\// }))).click();
      await expect(page.getByRole("button", { name: "Submit anyway" })).toBeVisible();
      await page.getByRole("button", { name: "Submit anyway" }).click();
      await expect(page.getByText(/Awaiting Warehouse Supervisor/)).toBeVisible();
      const dismissToast = page.getByRole("button", { name: "Dismiss" });
      if (await dismissToast.count()) await dismissToast.click();
      if ((page.viewportSize()?.width ?? 0) < 640) {
        await page.getByRole("button", { name: "More" }).click();
        const approvalsTool = page.getByRole("button", { name: /Stock Approvals/ });
        await expect(approvalsTool).toBeVisible();
        await approvalsTool.click();
      } else
        await (await first(page.getByRole("link", { name: "Stock Approvals" }))).click();
      await expect(page.getByLabel("Waiting on you approvals")).toBeVisible();
      return page.getByRole("button", { name: "Review" });
    }
    case "admin-start":
      return page.getByRole("heading", { name: "Access matrix" });
    case "admin-activate":
    case "doa-activate":
      return page.getByRole("button", { name: "Save draft" });
    case "allocation-start":
      return page.getByRole("button", { name: "Reserve" });
    case "price-start":
      return page.getByRole("heading", { name: "Landed cost & turnover" });
    case "doa-start":
      return page.getByRole("button", { name: "Add tier" });
    case "recover-start":
      await page.getByLabel("Email").fill("masked@mwell.demo");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      return page.getByLabel("Password");
    default:
      throw new Error(`No capture target for ${nodeId}`);
  }
}

test("captures reviewed desktop and mobile principal-flow evidence", async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  expect(KNOWLEDGE_EVIDENCE).toHaveLength(39);
  expect(Object.keys(KNOWLEDGE_EVIDENCE_SCENARIOS)).toHaveLength(39);

  const captureFrom = process.env.CAPTURE_FROM;
  let report: Record<string, Record<string, number | string | boolean>> = {};
  if (captureFrom) {
    try {
      report = JSON.parse(await readFile(REPORT_PATH, "utf8")).report ?? {};
    } catch {
      report = {};
    }
  }
  const startIndex = captureFrom
    ? KNOWLEDGE_EVIDENCE.findIndex((item) => item.nodeId === captureFrom)
    : 0;
  expect(startIndex, `CAPTURE_FROM ${captureFrom}`).toBeGreaterThanOrEqual(0);
  for (const evidence of KNOWLEDGE_EVIDENCE.slice(startIndex)) {
    const session = SESSIONS[evidence.roleId];
    expect(session, `memory session for ${evidence.roleId}`).toBeTruthy();
    expect(evidence.capturedAt).toBe("2026-07-13");
    expect(evidence.reviewedAt).toBe("2026-07-13");
    expect(evidence.sensitiveDataReviewed).toBe(true);
    report[evidence.nodeId] = {};

    for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
      const page = await browser.newPage({ viewport });
      const browserIssues: string[] = [];
      page.on("pageerror", (error) => browserIssues.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" && !/favicon\.ico|404/.test(message.text()))
          browserIssues.push(message.text());
      });
      await page.addInitScript(
        ({ key, value }) => {
          if (value) sessionStorage.setItem(key, JSON.stringify(value));
          else sessionStorage.removeItem(key);
          localStorage.setItem("intra-theme", "light");
        },
        { key: SESSION_KEY, value: evidence.route === "/login" ? null : session },
      );
      await page.goto(evidence.route, { waitUntil: "networkidle" });
      await expect(page.getByRole("main")).toBeVisible();
      await page.addStyleTag({
        content:
          "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}button[aria-label='Open Next.js Dev Tools']{display:none!important}",
      });
      await page.waitForTimeout(300);

      if (evidence.nodeId === "recover-retry") {
        await page.getByLabel("Email").fill("masked@mwell.demo");
        await page.getByLabel("Password").fill("masked-password");
      }
      const target = await targetFor(page, evidence.nodeId);
      await expect(target).toBeVisible();
      await target.evaluate((element) =>
        element.scrollIntoView({ block: "center", inline: "center" }),
      );
      await page.waitForTimeout(200);
      await target.evaluate((element) =>
        element.scrollIntoView({ block: "center", inline: "center" }),
      );
      await page.waitForTimeout(100);
      const box = await target.boundingBox();
      expect(box, `${evidence.nodeId} ${viewportName} hotspot target`).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      const x = Number(((box!.x + box!.width / 2) / viewport.width).toFixed(4));
      const y = Number(((box!.y + box!.height / 2) / viewport.height).toFixed(4));
      const hotspot = evidence.hotspots[0]!;
      const expectedX = viewportName === "desktop" ? hotspot.x : hotspot.mobileX;
      const expectedY = viewportName === "desktop" ? hotspot.y : hotspot.mobileY;
      if (process.env.REFRESH_HOTSPOTS !== "1") {
        expect(x, `${evidence.nodeId} ${viewportName} hotspot x`).toBeCloseTo(expectedX, 3);
        expect(y, `${evidence.nodeId} ${viewportName} hotspot y`).toBeCloseTo(expectedY, 3);
      }
      expect(new URL(page.url()).pathname).toBe(evidence.route);
      report[evidence.nodeId]![`${viewportName}X`] = x;
      report[evidence.nodeId]![`${viewportName}Y`] = y;
      report[evidence.nodeId]![`${viewportName}Route`] = new URL(page.url()).pathname;
      report[evidence.nodeId]![`${viewportName}SensitiveMasked`] = true;

      const source = viewportName === "desktop" ? evidence.desktopSrc : evidence.mobileSrc;
      const output = path.resolve(process.cwd(), "public", `.${source}`);
      await mkdir(path.dirname(output), { recursive: true });
      await page.screenshot({
        path: output,
        fullPage: false,
        animations: "disabled",
        maskColor: "#111827",
        mask: [
          page.locator(
            "input:not([type='checkbox']):not([type='radio']), textarea, table tbody td:first-child, [data-sensitive='true']",
          ),
          page.locator("p").filter({ hasText: /@(?:mwell|acme)\.demo/ }),
          ...(evidence.route === "/admin/users" ? [page.locator("main li")] : []),
        ],
      });
      expect(browserIssues, `${evidence.nodeId} ${viewportName} browser issues`).toEqual([]);
      await page.close();
    }
  }

  await mkdir(path.dirname(REPORT_PATH), { recursive: true });
  await writeFile(
    REPORT_PATH,
    `${JSON.stringify(
      {
        capturedAt: "2026-07-13",
        reviewedAt: "2026-07-13",
        appCommit: KNOWLEDGE_EVIDENCE[0]!.appCommit,
        evidenceCount: KNOWLEDGE_EVIDENCE.length,
        report,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
});
