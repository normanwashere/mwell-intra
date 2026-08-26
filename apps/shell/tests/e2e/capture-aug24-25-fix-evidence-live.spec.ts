import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const password = process.env.AUDIT_PASSWORD;
const evidenceDir = resolve(
  process.cwd(),
  "../../docs/evidence/2026-08-26-aug24-25-remediation",
);

async function signIn(page: Page, email: string, destination: string) {
  expect(password, "AUDIT_PASSWORD is required for live evidence capture").toBeTruthy();
  await page.goto(`/login?redirect=${encodeURIComponent(destination)}`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 20_000 });
  await page.goto(destination);
  await page.waitForLoadState("networkidle");
}

test.beforeAll(async () => {
  await mkdir(evidenceDir, { recursive: true });
});

test("captures Operations receiving and mixed-outcome controls", async ({ page }) => {
  await signIn(
    page,
    "intra.test.operations.associate@mwell.com.ph",
    "/warehouse/purchase-orders",
  );
  await expect(page.getByRole("heading", { level: 1, name: "Purchase Orders" })).toBeVisible();
  await expect(page.getByRole("link", { name: "0001", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "0002", exact: true })).toBeVisible();
  await page.screenshot({
    path: resolve(evidenceDir, "01-live-purchase-order-receiving-queue.png"),
    fullPage: false,
  });

  const poCard = page
    .locator("li")
    .filter({ has: page.getByRole("link", { name: "0001", exact: true }) });
  await poCard.getByRole("button", { name: /receive and inspect/i }).click();
  const dialog = page.getByRole("dialog", { name: "Receive approved procurement PO" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("50 physical", { exact: false })).toHaveCount(0);
  await expect(dialog.getByLabel("clean quantity for Prodigy Watch")).toBeVisible();
  await expect(dialog.getByLabel("damaged quantity for Prodigy Watch")).toBeVisible();
  await expect(dialog.getByLabel("unidentified quantity for Prodigy Watch")).toBeVisible();
  await expect(dialog.getByLabel("short quantity for Prodigy Watch")).toBeVisible();
  await expect(dialog.getByLabel("excess quantity for Prodigy Watch")).toBeVisible();
  await dialog.getByLabel("clean quantity for Prodigy Watch").fill("50");
  await dialog.getByLabel("damaged quantity for Prodigy Watch").fill("20");
  await dialog.getByLabel("unidentified quantity for Prodigy Watch").fill("10");
  await dialog.getByLabel("short quantity for Prodigy Watch").fill("20");
  await dialog.getByLabel("excess quantity for Prodigy Watch").fill("0");
  await dialog.screenshot({
    path: resolve(evidenceDir, "02-live-mixed-receipt-outcomes.png"),
  });
});

test("captures Marketing stock request and Event A handoff", async ({ page }) => {
  await signIn(
    page,
    "intra.test.marketing.events@mwell.com.ph",
    "/warehouse/fulfillment?tab=requests",
  );
  await expect(page.getByRole("heading", { level: 1, name: /Fulfillment|Pick & Pack/ })).toBeVisible();
  await expect(page.getByText("Event A staff and customer giveaway supplies", { exact: true })).toBeVisible();
  await page.screenshot({
    path: resolve(evidenceDir, "03-live-marketing-stock-request.png"),
    fullPage: false,
  });

  await page.goto("/events");
  await page.waitForLoadState("networkidle");
  const eventA = page.getByText(/UAT Event A/i).first();
  await expect(eventA).toBeVisible();
  await eventA.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(evidenceDir, "04-live-event-a-custody-and-reconciliation.png"),
    fullPage: false,
  });
});

test("captures Operations Pick and Pack scenario queue", async ({ page }) => {
  await signIn(
    page,
    "intra.test.operations.associate@mwell.com.ph",
    "/warehouse/fulfillment?tab=orders",
  );
  await expect(page.getByRole("heading", { level: 1, name: "Pick & Pack" })).toBeVisible();
  const pickingScenario = page.getByText("UAT-AUG24-PICKING", { exact: true });
  await expect(pickingScenario).toBeVisible();
  await expect(page.getByText("UAT-AUG24-PACKING", { exact: true })).toBeVisible();
  await pickingScenario.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: resolve(evidenceDir, "05-live-pick-and-pack-scenario-queue.png"),
    fullPage: false,
  });
});

test("captures the corrected 320px My Work layout", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await signIn(
    page,
    "intra.test.operations.associate@mwell.com.ph",
    "/work",
  );
  await expect(page.getByRole("heading", { level: 1, name: "My Work" })).toBeVisible();
  const geometry = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.viewport);
  expect(geometry.bodyScrollWidth).toBeLessThanOrEqual(geometry.viewport);
  await page.screenshot({
    path: resolve(evidenceDir, "06-live-mobile-my-work-no-overflow.png"),
    fullPage: false,
  });
});
