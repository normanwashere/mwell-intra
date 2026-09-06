import { expect, test, type Page } from "@playwright/test";
import { DEMO_PROFILES } from "../../lib/demoProfiles";
import { auditWarehouseLayout } from "../helpers/warehouseLayoutAudit";

async function installSession(page: Page, profileId: string) {
  const profile = DEMO_PROFILES.find((item) => item.id === profileId);
  if (!profile) throw new Error(`Missing canonical demo profile: ${profileId}`);
  await page.addInitScript(
    (value) => sessionStorage.setItem("intra.memory-session.v1", JSON.stringify(value)),
    { profileId: profile.id, roles: profile.roles },
  );
}

async function expectWorkspace(page: Page, route: string) {
  await expect(page).toHaveURL(new RegExp(`${route}/?(?:\\?.*)?$`));
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Role onboarding", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Access denied for this page" })).toHaveCount(0);
}

async function expectStableLayout(page: Page) {
  const layout = await auditWarehouseLayout(page);
  expect(layout.overflowElements).toEqual([]);
  expect(layout.clippedControls).toEqual([]);
  expect(layout.deadEnds).toEqual([]);
  expect(layout.overlaps).toEqual([]);
}

async function prepareScreenshot(page: Page) {
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  // Let the scroll-driven sticky header render its top-of-page state.
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

const workspaces = [
  ["demo-operations", "/warehouse"],
  ["demo-warehouse-operator", "/warehouse"],
  ["demo-logistics", "/warehouse"],
  ["demo-procurement", "/procurement"],
  ["demo-legal", "/legal"],
  ["demo-finance", "/finance"],
  ["demo-marketing", "/events"],
  ["demo-bi", "/insights"],
  ["demo-product-owner", "/product"],
  ["demo-admin", "/admin"],
] as const;

test.describe("nonblocking role onboarding", () => {
  for (const [profileId, route] of workspaces) {
    test(`${profileId} browses authorized workspace before orientation`, async ({ page }, testInfo) => {
      await installSession(page, profileId);
      await page.goto("/");
      const workspace = page.locator(`#workspace-area-cards a[href="${route}"]`);
      await expect(workspace).toBeVisible();
      await expect(workspace).not.toHaveAttribute("aria-disabled", "true");
      await workspace.click();
      await expectWorkspace(page, route);
      await prepareScreenshot(page);
      await page.screenshot({ path: testInfo.outputPath(`${profileId}-workspace-${testInfo.project.name}.png`), fullPage: true });
      await page.goto(route);
      await expectWorkspace(page, route);
      await page.goto(`/onboarding?next=${encodeURIComponent(route)}`);
      await expect(page.getByRole("heading", { level: 1, name: "Role onboarding" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Start Role orientation", exact: true }).first()).toBeVisible();
      const returnLink = page.locator(`a[href="${route}"]`).filter({ hasText: /^Continue to / });
      await expect(returnLink).toBeVisible();
      await expectStableLayout(page);
      await prepareScreenshot(page);
      await page.screenshot({ path: testInfo.outputPath(`${profileId}-checklist-${testInfo.project.name}.png`), fullPage: true });
      await returnLink.click();
      await expectWorkspace(page, route);
    });
  }

  test("interrupted orientation resumes while all assigned employee workspaces remain available", async ({ page }, testInfo) => {
    await installSession(page, "demo-operations");
    await page.goto("/onboarding?next=%2Fwarehouse");
    await page.getByRole("button", { name: "Start Role orientation", exact: true }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Continue", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Resume later", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    for (const route of ["/warehouse", "/procurement", "/events", "/product"]) {
      await page.goto(route);
      await expectWorkspace(page, route);
    }
    await page.goto("/onboarding?next=%2Fwarehouse");
    await page.reload();
    await page.getByRole("button", { name: "Resume Role orientation", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    for (let step = 0; step < 10; step += 1) {
      if (await dialog.getByRole("button", { name: "Finish review" }).isVisible()) break;
      await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    }
    await dialog.getByRole("button", { name: "Finish review" }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("link", { name: "Continue to Warehouse", exact: true }).click();
    await expectWorkspace(page, "/warehouse");
    await expectStableLayout(page);
    await prepareScreenshot(page);
    await page.screenshot({ path: testInfo.outputPath(`onboarding-resumed-${testInfo.project.name}.png`) });
  });

  for (const profileId of ["demo-operations", "demo-vendor"]) {
    test(`${profileId} cannot bypass administration authorization`, async ({ page }) => {
      await installSession(page, profileId);
      await page.goto("/admin");
      await expect(page.getByRole("heading", { name: "Access denied for this page" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Administration", exact: true })).toHaveCount(0);
    });
  }

  test("vendor can browse its portal before its isolated curriculum", async ({ page }, testInfo) => {
    await installSession(page, "demo-vendor");
    const businessWrites: string[] = [];
    page.on("request", (request) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method()) && /supabase|\/rest\/v1|\/rpc\//i.test(request.url())) {
        businessWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });
    await page.goto("/vendor");
    await expect(page).not.toHaveURL(/onboarding/);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await prepareScreenshot(page);
    await page.screenshot({ path: testInfo.outputPath(`demo-vendor-workspace-${testInfo.project.name}.png`), fullPage: true });
    await page.goto("/onboarding");
    await page.getByRole("link", { name: "Continue to vendor onboarding" }).click();
    await expect(page).toHaveURL(/\/vendor\/onboarding$/);
    await expect(page.getByRole("heading", { level: 1, name: "Vendor onboarding" })).toBeVisible();
    await expect(page.getByText("Core / Vendor Portal User", { exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByText("Acme Medical Supplies", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Vendor portal", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary mobile" })).toHaveCount(0);
    await expectStableLayout(page);
    await prepareScreenshot(page);
    await page.screenshot({ path: testInfo.outputPath(`onboarding-vendor-${testInfo.project.name}.png`), fullPage: true });
    const evidenceStart = page.getByRole("button", { name: "Start Vendor evidence and acknowledgments", exact: true });
    await expect(evidenceStart).toBeDisabled();
    await page.getByRole("button", { name: "Start Vendor accreditation orientation", exact: true }).click();
    const dialog = page.getByRole("dialog");
    for (let step = 0; step < 10; step += 1) {
      if (await dialog.getByRole("button", { name: "Finish review", exact: true }).isVisible()) break;
      await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    }
    await dialog.getByRole("button", { name: "Finish review", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(evidenceStart).toBeEnabled();
    await evidenceStart.click();
    await expect(dialog.getByText(/This learning review does not upload or approve documents\./)).toBeVisible();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByText(/does not sign a document, make a legal acknowledgment, submit an application, or grant accreditation\./)).toBeVisible();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByRole("heading", { name: "Guided practice complete", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Finish review", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    for (const id of ["vendor.vendor_representative.orientation.v1", "vendor.vendor_representative.evidence-and-acknowledgments.v1"]) {
      const requirement = page.locator(`[id="onboarding-requirement-${id}"]`);
      await expect(requirement.getByText("Complete", { exact: true })).toBeVisible();
      await expect(requirement.getByText("Done", { exact: true })).toBeVisible();
    }
    await expectStableLayout(page);
    await prepareScreenshot(page);
    await page.screenshot({ path: testInfo.outputPath(`onboarding-vendor-complete-${testInfo.project.name}.png`), fullPage: true });
    await page.getByRole("link", { name: "Vendor portal", exact: true }).click();
    await expect(page).not.toHaveURL(/onboarding/);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    expect(businessWrites).toEqual([]);
  });

  test("employee cannot open the isolated vendor curriculum directly", async ({ page }) => {
    await installSession(page, "demo-operations");
    await page.goto("/vendor/onboarding");
    await expect(page.getByRole("heading", { level: 1, name: "Vendor onboarding unavailable" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Return home" })).toHaveAttribute("href", "/");
    await expect(page.getByText("Core / Vendor Portal User", { exact: true })).toHaveCount(0);
    await expectStableLayout(page);
  });
});
