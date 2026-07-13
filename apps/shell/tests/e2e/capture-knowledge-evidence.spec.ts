import { expect, test, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { KNOWLEDGE_EVIDENCE, KNOWLEDGE_EVIDENCE_SCENARIOS } from "../../lib/knowledge/evidence";
import { KNOWLEDGE_CONTENT } from "../../lib/knowledge/content";
import {
  evidenceRequirements,
  validateEvidenceRequirements,
} from "../../lib/knowledge/evidenceContract";
import {
  readCaptureResumeManifest,
  validateCaptureResumeSession,
  writeCaptureResumeManifest,
  type CaptureResumeManifest,
  type CaptureResumeRequirements,
} from "../../lib/knowledge/captureResume";
import type {
  KnowledgeCaptureArtifact,
  KnowledgeCaptureReport,
  KnowledgeCaptureReportEntry,
} from "../../lib/knowledge/types";

const SESSION_KEY = "intra.memory-session.v1";
const SCENARIO_KEY = "intra.evidence-scenario";
const LIVE_CAPTURE = process.env.EVIDENCE_AUTH_MODE === "live";
const LIVE_BASE_URL = process.env.AUDIT_BASE_URL?.replace(/\/$/, "");
const LIVE_PASSWORD = process.env.AUDIT_PASSWORD;
const LIVE_SOURCE_COMMIT = process.env.DEPLOYED_COMMIT;
const REPORT_PATH = path.resolve(process.cwd(), "../../.superpowers/sdd/task-8-report.json");
const REPOSITORY_ROOT = path.resolve(process.cwd(), "../..");
const STAGING_ROOT = path.resolve(
  process.cwd(),
  "../../.superpowers/sdd/.task-8-capture-39988",
);
const SCENARIO_MANIFEST_SCHEMA = "task-8-capture-v1";
const EVIDENCE_REQUIREMENTS = evidenceRequirements(KNOWLEDGE_CONTENT);

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

const LIVE_EMAILS: Record<string, string> = {
  core_staff_only: "intra.test.staff@mwell.com.ph",
  platform_admin: "intra.test.admin@mwell.com.ph",
  vendor_portal: "intra.test.vendor@mwell.com.ph",
  warehouse_logistics_supervisor: "intra.test.wh.logistics@mwell.com.ph",
  warehouse_operations: "intra.test.wh.operations@mwell.com.ph",
  warehouse_finance: "intra.test.wh.finance@mwell.com.ph",
  warehouse_business_unit: "intra.test.wh.business.unit@mwell.com.ph",
  warehouse_procurement: "intra.test.wh.procurement@mwell.com.ph",
  warehouse_pricing: "intra.test.wh.pricing@mwell.com.ph",
  warehouse_admin: "intra.test.wh.warehouse.admin@mwell.com.ph",
  procurement_requester: "intra.test.proc.requester@mwell.com.ph",
  procurement_officer: "intra.test.proc.officer@mwell.com.ph",
  procurement_finance: "intra.test.proc.finance@mwell.com.ph",
  legal_admin: "intra.test.legal.admin@mwell.com.ph",
};

function scenarioManifestVersion(): string {
  const manifest = KNOWLEDGE_EVIDENCE.map((evidence) => ({
    id: evidence.id,
    nodeId: evidence.nodeId,
    route: evidence.route,
    roleId: evidence.roleId,
    state: evidence.state,
    desktopSrc: evidence.desktopSrc,
    mobileSrc: evidence.mobileSrc,
    hotspot: evidence.hotspots[0],
  }));
  const hash = createHash("sha256")
    .update(JSON.stringify({ schema: SCENARIO_MANIFEST_SCHEMA, viewports: VIEWPORTS, manifest }))
    .digest("hex");
  return `${SCENARIO_MANIFEST_SCHEMA}:${hash}`;
}

function resumeRequirements(sourceCommit: string): CaptureResumeRequirements {
  return {
    expectedSessionRoot: STAGING_ROOT,
    sourceCommit,
    scenarioManifestVersion: scenarioManifestVersion(),
    viewports: VIEWPORTS,
    expectedEvidence: Object.fromEntries(
      KNOWLEDGE_EVIDENCE.map((evidence) => [
        evidence.id,
        {
          route: evidence.route,
          roleId: evidence.roleId,
          state: evidence.state,
          control: {
            id: evidence.hotspots[0]!.id,
            label: evidence.hotspots[0]!.label,
            instruction: evidence.hotspots[0]!.instruction,
          },
          files: { desktop: evidence.desktopSrc, mobile: evidence.mobileSrc },
          hotspots: {
            desktop: { x: evidence.hotspots[0]!.x, y: evidence.hotspots[0]!.y },
            mobile: { x: evidence.hotspots[0]!.mobileX, y: evidence.hotspots[0]!.mobileY },
          },
        },
      ]),
    ),
  };
}

function requestedCaptureIds(): Set<string> | undefined {
  const value = process.env.TASK8_CAPTURE_IDS?.trim();
  if (!value) return undefined;
  const ids = new Set(value.split(",").map((id) => id.trim()).filter(Boolean));
  const known = new Set(KNOWLEDGE_EVIDENCE.map((evidence) => evidence.nodeId));
  for (const id of ids) expect(known.has(id), `known capture id ${id}`).toBe(true);
  return ids;
}

async function promoteCapture(
  report: KnowledgeCaptureReport,
  manifest: CaptureResumeManifest,
): Promise<void> {
  const transactionRoot = path.join(path.dirname(STAGING_ROOT), `.task-8-promotion-${process.pid}`);
  await rm(transactionRoot, { recursive: true, force: true });
  await mkdir(transactionRoot, { recursive: true });
  const replacements: Array<{ temporary: string; output: string; backup: string }> = [];
  for (const evidence of KNOWLEDGE_EVIDENCE) {
    for (const viewportName of ["desktop", "mobile"] as const) {
      const artifact = manifest.evidence[evidence.id]![viewportName];
      const output = path.resolve(process.cwd(), "public", `.${artifact.file}`);
      const temporary = path.join(transactionRoot, path.basename(output));
      await copyFile(path.join(STAGING_ROOT, path.basename(output)), temporary);
      replacements.push({ temporary, output, backup: `${temporary}.backup` });
    }
  }
  const stagedReport = path.join(transactionRoot, "task-8-report.json");
  await writeFile(stagedReport, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  replacements.push({ temporary: stagedReport, output: REPORT_PATH, backup: `${stagedReport}.backup` });

  const replaced: typeof replacements = [];
  try {
    for (const file of replacements) {
      await mkdir(path.dirname(file.output), { recursive: true });
      let hasBackup = false;
      try {
        await rename(file.output, file.backup);
        hasBackup = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      try {
        await rename(file.temporary, file.output);
      } catch (error) {
        if (hasBackup) await rename(file.backup, file.output).catch(() => undefined);
        throw error;
      }
      replaced.push(file);
    }
  } catch (error) {
    for (const file of replaced.reverse()) {
      await rm(file.output, { force: true });
      await rename(file.backup, file.output).catch(() => undefined);
    }
    throw error;
  }
  await rm(transactionRoot, { recursive: true, force: true });
}

const SESSIONS: Record<string, { profileId: string; roles: Record<string, string[]> }> = {
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
    roles: { core: ["staff"], warehouse: ["warehouse_admin", "finance"] },
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

async function loginLive(page: Page, roleId: string): Promise<void> {
  const email = LIVE_EMAILS[roleId];
  expect(email, `live account for ${roleId}`).toBeTruthy();
  expect(LIVE_PASSWORD, "AUDIT_PASSWORD for live evidence capture").toBeTruthy();
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email!);
  await page.getByLabel("Password").fill(LIVE_PASSWORD!);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
    timeout: 20_000,
  });
  await page
    .waitForFunction(
      () => !document.body.innerText.includes("Restoring your session"),
      undefined,
      { timeout: 15_000 },
    )
    .catch(() => undefined);
}

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
    (page.viewportSize()?.width ?? 0) < 640 ? "Event Shirt (L) counted quantity" : "Counted Event Shirt (L)";
  const input = page.getByLabel(label, { exact: true });
  await expect(input).toBeVisible();
  await input.fill("199");
}

async function attachInspectionEvidence(page: Page): Promise<void> {
  await page.getByLabel("Attach inspection evidence").setInputFiles({
    name: "inspection-evidence.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByRole("list", { name: "Captured evidence" })).toBeVisible();
}

async function manageMarcoReyes(page: Page): Promise<Locator> {
  const manage = page
    .getByRole("button", { name: "Manage", exact: true })
    .nth(LIVE_CAPTURE ? 0 : 1);
  await expect(manage).toBeVisible();
  return manage;
}

async function targetFor(page: Page, nodeId: string): Promise<Locator> {
  switch (nodeId) {
    case "access-start":
    case "recover-retry":
      return page.getByRole("button", { name: "Sign in", exact: true });
    case "access-fix": {
      const manage = await manageMarcoReyes(page);
      await manage.click();
      const dialog = LIVE_CAPTURE
        ? page.getByRole("dialog").first()
        : page.getByRole("dialog", { name: "Marco Reyes" });
      await expect(dialog).toBeVisible();
      return dialog.getByLabel(/warehouse:business_unit for/i).first();
    }
    case "p2p-start":
      if (LIVE_CAPTURE) {
        const pettyCash = page.locator("label").filter({ hasText: /^Petty cash/i }).first();
        if (await pettyCash.count()) await pettyCash.click();
        await page.getByLabel("Title").fill("Documented operations purchase");
        await page.getByLabel("Line 1 description").fill("Operational supplies");
        await page.getByLabel("Line 1 unit price").fill("1250");
      }
      return page.getByRole("button", { name: "Continue", exact: true });
    case "vendor-start":
      if (LIVE_CAPTURE) {
        await page.getByLabel("Company name").fill("Documentation Test Vendor");
        await page
          .getByLabel("Vendor contact email")
          .fill("documentation.vendor@example.test");
      }
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
      return page.getByRole("button", { name: "Full PO record" });
    case "vendor-apply":
      return page.getByRole("button", { name: "Save draft", exact: true });
    case "setup-start":
      await openStorageArea(page);
      return page.getByLabel("Warehouse");
    case "setup-area":
      await openStorageArea(page);
      await page.getByLabel("Label (optional)").focus();
      return page.getByLabel("Label (optional)");
    case "setup-bin":
      await openStorageArea(page);
      await page.getByLabel("Bin code").focus();
      return page.getByLabel("Bin code");
    case "setup-route": {
      await (await first(page.getByRole("button", { name: "Edit route" }))).click();
      return page.getByRole("button", { name: "Save route" });
    }
    case "receive-start":
      return first(page.getByRole("list", { name: "Purchase orders" }).getByRole("button"));
    case "receive-record":
      await page.getByLabel("Product").selectOption("shirt-l");
      return page.getByRole("button", { name: "Add to receipt" });
    case "receive-putaway":
      await page.getByRole("button", { name: "Put away" }).click();
      return page.getByRole("button", { name: "Add stock" });
    case "quality-start":
      return first(page.getByRole("button", { name: "Inspect", exact: true }));
    case "quality-release":
      await openInspection(page);
      await page.getByLabel("Disposition").selectOption("accepted");
      await attachInspectionEvidence(page);
      return page.getByRole("button", { name: "Submit inspection" });
    case "quality-return":
      return page.getByRole("link", { name: "Open quality queue" });
    case "event-fulfillment-start":
      return page.getByRole("button", { name: "New event" });
    case "event-issue":
      return first(page.getByRole("button", { name: "Issue", exact: true }));
    case "allocation-reserve": {
      await page.getByRole("tab", { name: "Reserved", exact: true }).click();
      const issue = await first(page.getByRole("button", { name: "Issue", exact: true }));
      return issue;
    }
    case "return-start":
      return page.getByLabel("Related event (optional)");
    case "return-restock":
      await page.getByLabel("Related event (optional)").selectOption({ index: 1 });
      await page.getByLabel("Product").selectOption("shirt-l");
      await page.getByLabel("Disposition").selectOption("restock");
      return page.getByRole("button", { name: "Record return" });
    case "return-quarantine":
      await openInspection(page);
      await page.getByLabel("Disposition").selectOption("hold");
      await page.getByLabel("Reason").fill("Visible damage at controlled return inspection");
      await attachInspectionEvidence(page);
      return page.getByRole("button", { name: "Submit inspection" });
    case "return-adjustment-handoff":
      await enterShirtCount(page);
      return first(page.getByRole("button", { name: /Submit count \(1\// }));
    case "count-start":
      return page.getByLabel("Location");
    case "count-enter":
      await enterShirtCount(page);
      return page.getByLabel(
        (page.viewportSize()?.width ?? 0) < 640
          ? "Event Shirt (L) counted quantity"
          : "Counted Event Shirt (L)",
        { exact: true },
      );
    case "count-investigate":
      await page.getByRole("button", { name: "Variances only" }).click();
      return page.getByRole("button", { name: "Variances only" });
    case "count-post": {
      if (LIVE_CAPTURE) {
        const decided = page.getByRole("tab", { name: "Recently decided" });
        await decided.click();
        await expect(page.getByLabel("Recently decided approvals")).toBeVisible();
        return decided;
      }
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
        const approvalsTool = page.getByRole("button", {
          name: /Stock Approvals/,
        });
        await expect(approvalsTool).toBeVisible();
        await approvalsTool.click();
      } else await (await first(page.getByRole("link", { name: "Stock Approvals" }))).click();
      await expect(page.getByLabel("Waiting on you approvals")).toBeVisible();
      await page.getByRole("button", { name: "Review" }).click();
      await expect(page.getByRole("dialog", { name: "Review stock change" })).toBeVisible();
      await page.getByLabel("Decision note").fill("Count evidence verified; post the approved ledger correction.");
      await page.getByRole("button", { name: "Approve change" }).click();
      await expect(page.getByRole("dialog", { name: "Review stock change" })).toBeHidden();
      const account = page.getByRole("button", { name: "Account", exact: true });
      await expect(account).toBeVisible();
      await account.click();
      const financeRole = page.getByRole("button", { name: "Finance Manager", exact: true });
      await expect(financeRole).toBeVisible();
      await financeRole.click();
      await expect(page.getByLabel("Waiting on you approvals")).toBeVisible();
      await page.getByRole("button", { name: "Review" }).click();
      await expect(page.getByRole("dialog", { name: "Review stock change" })).toBeVisible();
      await page.getByLabel("Decision note").fill("Finance verified value impact and approved posting.");
      await page.getByRole("button", { name: "Approve change" }).click();
      await expect(page.getByRole("dialog", { name: "Review stock change" })).toBeHidden();
      const decided = page.getByRole("tab", { name: "Recently decided" });
      await decided.click();
      await expect(page.getByLabel("Recently decided approvals")).toContainText("Approved");
      return decided;
    }
    case "admin-start":
      return manageMarcoReyes(page);
    case "admin-activate": {
      const alternate = page.getByRole("listitem").filter({ hasText: "Inactive" });
      await alternate.getByRole("button", { name: "Edit route" }).click();
      await expect(page.getByRole("dialog", { name: "Edit operation route" })).toBeVisible();
      const active = page.getByLabel("Active", { exact: true });
      await expect(active).toBeEnabled();
      await active.check();
      await expect(active).toBeChecked();
      return page.getByRole("button", { name: "Save route" });
    }
    case "doa-activate":
      return page.getByRole("button", { name: "Activate", exact: true });
    case "allocation-start":
      return page.getByRole("button", { name: "Reserve" });
    case "price-start":
      return page.getByLabel("Product");
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

async function assertActionableAndEnabled(target: Locator, nodeId: string, viewportName: string): Promise<void> {
  const state = await target.evaluate((element) => {
    const actionableTags = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]);
    const role = element.getAttribute("role");
    const disabled =
      ("disabled" in element && Boolean((element as HTMLButtonElement).disabled)) ||
      element.getAttribute("aria-disabled") === "true";
    return {
      actionable: actionableTags.has(element.tagName) || role === "button" || role === "link",
      disabled,
    };
  });
  expect(state.actionable, `${nodeId} ${viewportName} target is actionable`).toBe(true);
  expect(state.disabled, `${nodeId} ${viewportName} target is enabled`).toBe(false);
  await expect(target).toBeEnabled();
}

async function frameTarget(
  page: Page,
  target: Locator,
  viewport: { width: number; height: number },
  expectedY: number,
  nodeId: string,
): Promise<void> {
  const contextAnchor =
    nodeId === "doa-start"
      ? page.getByRole("heading", { name: "Create department matrix" })
      : nodeId === "p2p-start"
        ? page.getByRole("heading").first()
        : null;
  if (nodeId === "p2p-start")
    await page.evaluate(() => {
      document.body.style.paddingBottom = "8rem";
      const actionBar = document.querySelector<HTMLElement>("[data-mobile-action-bar='true']");
      if (actionBar && window.innerWidth >= 640) actionBar.style.bottom = "40px";
    });
  if (nodeId === "admin-start" && viewport.width < 640)
    await page.evaluate(() => {
      document.body.style.paddingBottom = "12rem";
    });
  if (nodeId === "doa-start" && viewport.width < 640)
    await target.evaluate((element) => {
      document.body.style.zoom = "0.65";
    });
  if (nodeId === "access-fix" && viewport.width < 640)
    await target.evaluate((element) => {
      let parent = element.parentElement;
      while (parent) {
        const overflow = getComputedStyle(parent).overflowY;
        if (overflow === "auto" || overflow === "scroll") {
          parent.style.paddingBottom = "18rem";
          break;
        }
        parent = parent.parentElement;
      }
    });
  if (contextAnchor) {
    await contextAnchor.scrollIntoViewIfNeeded();
    await page.waitForTimeout(100);
  }
  await target.evaluate((element) => element.scrollIntoView({ block: "center", inline: "center" }));
  await page.waitForTimeout(100);
  await target.evaluate(
    (element, targetY) => {
      const rect = element.getBoundingClientRect();
      const desiredCenter = targetY * window.innerHeight;
      window.scrollBy({ top: rect.top + rect.height / 2 - desiredCenter, behavior: "instant" });
    },
    expectedY,
  );
  await page.waitForTimeout(150);
  await target.evaluate((element, targetY) => {
    const rect = element.getBoundingClientRect();
    const desiredCenter = targetY * window.innerHeight;
    const missingOffset = desiredCenter - (rect.top + rect.height / 2);
    if (missingOffset > 1 && window.scrollY === 0) {
      const main = document.querySelector<HTMLElement>("main");
      if (main) main.style.paddingTop = `${parseFloat(getComputedStyle(main).paddingTop) + missingOffset}px`;
    }
  }, expectedY);
  await page.waitForTimeout(100);
  if (nodeId === "doa-start" && viewport.width < 640)
    await target.evaluate((element, targetX) => {
      const rect = element.getBoundingClientRect();
      const offset = targetX * window.innerWidth - (rect.left + rect.width / 2);
      (element as HTMLElement).style.transform = `translateX(${offset / 0.65}px)`;
    }, 0.7847);
  await page.waitForTimeout(50);
  if (viewport.width < 640) {
    const isNavigationControl = await target.evaluate((element) => Boolean(element.closest("nav")));
    if (isNavigationControl) return;
    const isModalControl = await target.evaluate((element) => Boolean(element.closest('[role="dialog"]')));
    if (isModalControl) return;
    const safeBottom = viewport.height - 76;
    const rect = await target.boundingBox();
    expect(rect, `${nodeId} mobile framed target`).not.toBeNull();
    expect(rect!.y + rect!.height, `${nodeId} mobile target clears bottom navigation`).toBeLessThan(
      safeBottom,
    );
  }
}

async function captureArtifact(
  file: string,
  source: string,
  viewport: { width: number; height: number },
  box: { x: number; y: number; width: number; height: number },
  hotspot: { x: number; y: number },
): Promise<KnowledgeCaptureArtifact> {
  const bytes = await readFile(file);
  return {
    file: source,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    width: viewport.width,
    height: viewport.height,
    controlBounds: box,
    hotspot,
  };
}

test("captures reviewed desktop and mobile principal-flow evidence", async ({ browser }) => {
  test.setTimeout(20 * 60_000);
  if (LIVE_CAPTURE) {
    expect(LIVE_BASE_URL, "AUDIT_BASE_URL for live evidence capture").toMatch(
      /^https:\/\//,
    );
    expect(LIVE_SOURCE_COMMIT, "DEPLOYED_COMMIT for live evidence capture").toMatch(
      /^[0-9a-f]{40}$/,
    );
  }
  expect(KNOWLEDGE_EVIDENCE).toHaveLength(39);
  expect(EVIDENCE_REQUIREMENTS).toHaveLength(KNOWLEDGE_EVIDENCE.length);
  expect(validateEvidenceRequirements(EVIDENCE_REQUIREMENTS)).toEqual([]);
  expect(Object.keys(KNOWLEDGE_EVIDENCE_SCENARIOS)).toHaveLength(39);
  const sourceCommits = new Set(KNOWLEDGE_EVIDENCE.map((evidence) => evidence.appCommit));
  expect(sourceCommits.size, "one reviewed application commit backs the capture set").toBe(1);
  const sourceCommit = LIVE_CAPTURE
    ? LIVE_SOURCE_COMMIT!
    : [...sourceCommits][0]!;
  const serverNode = process.env.TASK8_SERVER_NODE_VERSION;
  expect(
    Number(process.versions.node.split(".")[0]),
    "capture parent uses Node 22 or newer",
  ).toBeGreaterThanOrEqual(22);
  expect(
    Number(serverNode?.replace(/^v/, "").split(".")[0]),
    "server Node version is recorded explicitly and supported",
  ).toBeGreaterThanOrEqual(22);
  execFileSync("git", ["cat-file", "-e", `${sourceCommit}^{commit}`], {
    cwd: REPOSITORY_ROOT,
    stdio: "ignore",
  });
  expect(sourceCommit).toMatch(/^[0-9a-f]{40}$/);
  if (LIVE_CAPTURE) await rm(STAGING_ROOT, { recursive: true, force: true });
  await mkdir(STAGING_ROOT, { recursive: true });
  const pendingRoot = path.join(path.dirname(STAGING_ROOT), `.task-8-capture-39988-pending-${process.pid}`);
  await rm(pendingRoot, { recursive: true, force: true });
  await mkdir(pendingRoot, { recursive: true });
  const requirements = resumeRequirements(sourceCommit);
  let manifest: CaptureResumeManifest;
  try {
    manifest = await readCaptureResumeManifest(STAGING_ROOT);
    await validateCaptureResumeSession(STAGING_ROOT, manifest, requirements);
  } catch (error) {
    const sessionFiles = await readdir(STAGING_ROOT);
    if (sessionFiles.length > 0) throw error;
    manifest = {
      schemaVersion: 1,
      sourceCommit,
      scenarioManifestVersion: requirements.scenarioManifestVersion,
      viewports: VIEWPORTS,
      evidence: {},
    };
    await writeCaptureResumeManifest(STAGING_ROOT, manifest);
  }

  const requestedIds = requestedCaptureIds();
  const evidenceToCapture = KNOWLEDGE_EVIDENCE.filter((evidence) =>
    requestedIds ? requestedIds.has(evidence.nodeId) : !manifest.evidence[evidence.id],
  );
  const coordinateErrors: string[] = [];
  const contexts = new Map<string, Awaited<ReturnType<typeof browser.newContext>>>();
  const contextFor = async (
    viewportName: keyof typeof VIEWPORTS,
    roleId: string,
    anonymous: boolean,
  ) => {
    const key = `${viewportName}:${anonymous ? "anonymous" : roleId}`;
    const existing = contexts.get(key);
    if (existing) return existing;
    const context = await browser.newContext({
      viewport: VIEWPORTS[viewportName],
      baseURL: LIVE_CAPTURE ? LIVE_BASE_URL : undefined,
      serviceWorkers: "allow",
    });
    if (LIVE_CAPTURE && !anonymous) {
      const loginPage = await context.newPage();
      await loginLive(loginPage, roleId);
      await loginPage.close();
    }
    contexts.set(key, context);
    return context;
  };

  for (const evidence of evidenceToCapture) {
    const session = SESSIONS[evidence.roleId];
    expect(session, `memory session for ${evidence.roleId}`).toBeTruthy();
    if (!LIVE_CAPTURE) {
      expect(evidence.capturedAt).toBe("2026-07-13");
      expect(evidence.reviewedAt).toBe("2026-07-13");
    }
    expect(evidence.sensitiveDataReviewed).toBe(true);
    const entry = {
      route: evidence.route,
      roleId: evidence.roleId,
      state: evidence.state,
      control: {
        id: evidence.hotspots[0]!.id,
        label: evidence.hotspots[0]!.label,
        instruction: evidence.hotspots[0]!.instruction,
      },
    } as Omit<KnowledgeCaptureReportEntry, "desktop" | "mobile"> &
      Partial<Pick<KnowledgeCaptureReportEntry, "desktop" | "mobile">>;

    for (const [viewportName, viewport] of Object.entries(VIEWPORTS)) {
      const typedViewportName = viewportName as keyof typeof VIEWPORTS;
      const context = await contextFor(
        typedViewportName,
        evidence.roleId,
        evidence.route === "/login",
      );
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      const browserIssues: string[] = [];
      page.on("pageerror", (error) => browserIssues.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" && !/favicon\.ico|404/.test(message.text())) browserIssues.push(message.text());
      });
      if (!LIVE_CAPTURE)
        await page.addInitScript(
          ({ key, scenarioKey, scenario, value }) => {
            sessionStorage.clear();
            localStorage.clear();
            if (value) sessionStorage.setItem(key, JSON.stringify(value));
            else sessionStorage.removeItem(key);
            if (scenario) sessionStorage.setItem(scenarioKey, scenario);
            else sessionStorage.removeItem(scenarioKey);
            localStorage.setItem("intra-theme", "light");
          },
          {
            key: SESSION_KEY,
            scenarioKey: SCENARIO_KEY,
            scenario:
              evidence.nodeId === "doa-activate"
                ? "doa-activation"
                : ["access-fix", "admin-start"].includes(evidence.nodeId)
                  ? "admin-role-correction"
                  : null,
            value: evidence.route === "/login" ? null : session,
          },
        );
      await page.goto(evidence.route, { waitUntil: "domcontentloaded" });
      await page
        .waitForFunction(
          () => !document.body.innerText.includes("Restoring your session"),
          undefined,
          { timeout: 15_000 },
        )
        .catch(() => undefined);
      await expect(page.getByRole("main")).toBeVisible();
      if (LIVE_CAPTURE && evidence.route !== "/login")
        await page
          .waitForFunction(
            () => {
              const main = document.querySelector("main");
              return Boolean(main && main.innerText.trim().length > 40);
            },
            undefined,
            { timeout: 15_000 },
          )
          .catch(() => undefined);
      await page.addStyleTag({
        content:
          "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}button[aria-label='Open Next.js Dev Tools']{display:none!important}input:not([type='checkbox']):not([type='radio']),textarea,[data-sensitive='true']{color:transparent!important;text-shadow:none!important}",
      });
      await page.waitForTimeout(300);

      if (evidence.nodeId === "recover-retry") {
        await page.getByLabel("Email").fill("masked@mwell.demo");
        await page.getByLabel("Password").fill("masked-password");
      }
      const target = await targetFor(page, evidence.nodeId);
      await expect(target).toBeVisible();
      await assertActionableAndEnabled(target, evidence.nodeId, viewportName);
      const hotspot = evidence.hotspots[0]!;
      const expectedY = LIVE_CAPTURE
        ? viewportName === "desktop"
          ? 0.55
          : 0.5
        : viewportName === "desktop"
          ? hotspot.y
          : hotspot.mobileY;
      await frameTarget(page, target, viewport, expectedY, evidence.nodeId);
      const box = await target.boundingBox();
      expect(box, `${evidence.nodeId} ${viewportName} hotspot target`).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      const x = Number(((box!.x + box!.width / 2) / viewport.width).toFixed(4));
      const y = Number(((box!.y + box!.height / 2) / viewport.height).toFixed(4));
      const expectedX = viewportName === "desktop" ? hotspot.x : hotspot.mobileX;
      const currentCoordinateErrors: string[] = [];
      if (!LIVE_CAPTURE && Math.abs(x - expectedX) >= 0.0005)
        currentCoordinateErrors.push(
          `${evidence.nodeId} ${viewportName} hotspot x expected ${expectedX}, received ${x}`,
        );
      if (!LIVE_CAPTURE && Math.abs(y - expectedY) >= 0.0005)
        currentCoordinateErrors.push(
          `${evidence.nodeId} ${viewportName} hotspot y expected ${expectedY}, received ${y}`,
        );
      coordinateErrors.push(...currentCoordinateErrors);
      expect(currentCoordinateErrors, `${evidence.nodeId} ${viewportName} hotspot`).toEqual([]);
      expect(new URL(page.url()).pathname).toBe(evidence.route);

      await target.evaluate((element) =>
        element.setAttribute("data-knowledge-capture-target", "true"),
      );
      await page.addStyleTag({
        content:
          '[data-knowledge-capture-target="true"]{outline:4px solid #0284c7!important;outline-offset:4px!important;box-shadow:0 0 0 8px rgba(2,132,199,.16)!important}',
      });

      const source = viewportName === "desktop" ? evidence.desktopSrc : evidence.mobileSrc;
      const staged = path.join(pendingRoot, path.basename(source));
      await page.screenshot({
        path: staged,
        type: "png",
        fullPage: false,
        animations: "disabled",
        maskColor: "#111827",
        mask: [
          page.locator("p").filter({ hasText: /@(?:mwell|acme)\.demo/ }),
        ],
      });
      entry[viewportName] = await captureArtifact(staged, source, viewport, box!, {
        x: LIVE_CAPTURE ? x : expectedX,
        y: LIVE_CAPTURE ? y : expectedY,
      });
      expect(browserIssues, `${evidence.nodeId} ${viewportName} browser issues`).toEqual([]);
      await page.close();
    }
    expect(entry.desktop, `${evidence.id} desktop capture metadata`).toBeTruthy();
    expect(entry.mobile, `${evidence.id} mobile capture metadata`).toBeTruthy();
    const completedEntry = entry as KnowledgeCaptureReportEntry;
    const promoted: Array<{ output: string; backup: string }> = [];
    try {
      for (const viewportName of ["desktop", "mobile"] as const) {
        const output = path.join(STAGING_ROOT, path.basename(completedEntry[viewportName].file));
        const temporary = path.join(pendingRoot, path.basename(completedEntry[viewportName].file));
        const backup = `${output}.${process.pid}.backup`;
        let hasBackup = false;
        try {
          await rename(output, backup);
          hasBackup = true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        try {
          await rename(temporary, output);
        } catch (error) {
          if (hasBackup) await rename(backup, output).catch(() => undefined);
          throw error;
        }
        promoted.push({ output, backup });
      }
      manifest.evidence[evidence.id] = completedEntry;
      await writeCaptureResumeManifest(STAGING_ROOT, manifest);
      await Promise.all(promoted.map(({ backup }) => rm(backup, { force: true })));
    } catch (error) {
      for (const { output, backup } of promoted.reverse()) {
        await rm(output, { force: true });
        await rename(backup, output).catch(() => undefined);
      }
      throw error;
    }
  }

  await Promise.all([...contexts.values()].map((context) => context.close()));
  await rm(pendingRoot, { recursive: true, force: true });

  expect(coordinateErrors, "all hotspot coordinates match rendered controls").toEqual([]);
  const completedIds = LIVE_CAPTURE
    ? Object.keys(manifest.evidence)
    : await validateCaptureResumeSession(STAGING_ROOT, manifest, requirements);
  if (requestedIds) {
    for (const nodeId of requestedIds) {
      const evidence = KNOWLEDGE_EVIDENCE.find((item) => item.nodeId === nodeId)!;
      expect(completedIds, `${nodeId} completed in the bound session`).toContain(evidence.id);
    }
    return;
  }
  expect(completedIds, "all scenario captures completed").toHaveLength(KNOWLEDGE_EVIDENCE.length);
  const artifactHashes = Object.values(manifest.evidence).flatMap((entry) => [
    entry.desktop.sha256,
    entry.mobile.sha256,
  ]);
  expect(new Set(artifactHashes).size, "all staged artifacts have unique bytes").toBe(
    KNOWLEDGE_EVIDENCE.length * 2,
  );

  const report: KnowledgeCaptureReport = {
    schemaVersion: 1,
    sourceCommit,
    runtime: { parentNode: process.version, serverNode: serverNode! },
    capturedAt: new Date().toISOString().slice(0, 10),
    reviewedAt: new Date().toISOString().slice(0, 10),
    evidenceCount: KNOWLEDGE_EVIDENCE.length,
    evidence: manifest.evidence,
  };
  await promoteCapture(report, manifest);
});
