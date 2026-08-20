import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { DEMO_PROFILES } from "../lib/demoProfiles";
import {
  LEARNING_CATALOG,
  ROLE_CURRICULA,
} from "../../../modules/learning/src/catalog";

const output = resolve(
  process.cwd(),
  "../../output/playwright/tracker-refinement",
);

async function installOperationsSession(page: Page) {
  const profile = DEMO_PROFILES.find(
    (candidate) => candidate.id === "demo-operations",
  )!;
  const roleKeys = new Set(
    Object.entries(profile.roles).flatMap(([module, roles]) =>
      roles.map((role) => `${module}:${role}`),
    ),
  );
  const requirementIds = new Set(
    ROLE_CURRICULA.filter((curriculum) =>
      roleKeys.has(`${curriculum.module}:${curriculum.role}`),
    ).flatMap((curriculum) => curriculum.requirementIds),
  );
  const progress = LEARNING_CATALOG.requirements
    .filter(
      (requirement) =>
        requirement.kind === "orientation" &&
        requirementIds.has(requirement.id),
    )
    .map((requirement) => ({
      assignmentRequirementId: `visual-fixture:${requirement.id}`,
      requirementId: requirement.id,
      requirementVersion: requirement.version,
      state: "passed",
      attemptCount: 1,
      allowsSharedCompletion: true,
      completedAt: "2026-08-17T00:00:00.000Z",
      updatedAt: "2026-08-17T00:00:00.000Z",
    }));
  const learningKey = `intra.demo-learning.v1:${profile.id}:${JSON.stringify(profile.roles)}`;
  await page.addInitScript(
    ({ profile, learningKey, progress }) => {
      sessionStorage.setItem(
        "intra.memory-session.v1",
        JSON.stringify({ profileId: profile.id, roles: profile.roles }),
      );
      sessionStorage.setItem(
        learningKey,
        JSON.stringify({ progress, completedCheckpoints: {} }),
      );
    },
    { profile, learningKey, progress },
  );
}

test("tracker replacement intake is usable and stable", async ({
  page,
}, testInfo) => {
  mkdirSync(output, { recursive: true });
  await installOperationsSession(page);
  await page.goto("/warehouse/fulfillment");
  await expect(
    page.getByRole("heading", { name: /Fulfillment/i }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "New order / demand" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Create order or fulfillment demand",
  });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Order reference").fill("VISUAL-TRACKER-01");
  await dialog.getByLabel("Sales channel").selectOption("Shopify");
  await dialog.getByLabel("Customer name").fill("Visual QA Customer");
  await dialog.getByLabel("Contact number").fill("09171234567");
  await dialog.getByLabel("Street address").fill("12 Main Street");
  await dialog.getByLabel("City").fill("Pasig");
  await dialog.getByLabel("Province").fill("Metro Manila");
  await dialog.getByLabel("Postal code").fill("1600");
  await dialog.getByLabel("Product").selectOption("smart-watch");
  await expect(dialog.getByLabel("Selling price (assigned)")).not.toHaveValue(
    "",
  );
  await dialog.getByLabel("Line discount").fill("100");
  await dialog.getByRole("button", { name: "Add item" }).click();
  await dialog.getByLabel("Product").nth(1).selectOption("ecg-ring-8");
  await expect(
    dialog.getByLabel("Selling price (assigned)").nth(1),
  ).not.toHaveValue("");

  const viewport = page.viewportSize()!;
  const prefix = viewport.width < 600 ? "mobile" : "desktop";
  await page.waitForTimeout(400);
  await page.screenshot({
    path: resolve(output, `${prefix}-01-order-items.png`),
    fullPage: false,
  });

  await dialog
    .getByText("Commercial summary", { exact: true })
    .scrollIntoViewIfNeeded();
  await dialog.getByLabel("Shipping fee").fill("80");
  await dialog.getByLabel("Other fees").fill("20");
  const assignedPrices = await dialog
    .getByLabel("Selling price (assigned)")
    .evaluateAll((inputs) =>
      inputs.map((input) => Number((input as HTMLInputElement).value)),
    );
  const expectedTotal = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    currencyDisplay: "code",
  }).format(assignedPrices.reduce((sum, value) => sum + value, 0));
  await expect(
    dialog
      .getByText("Order total", { exact: true })
      .locator("..")
      .locator("dd"),
  ).toHaveText(expectedTotal);
  await page.waitForTimeout(400);
  await page.screenshot({
    path: resolve(output, `${prefix}-02-commercial-summary.png`),
    fullPage: false,
  });

  await dialog.getByLabel("Courier").fill("LBC");
  await dialog.getByLabel("Tracking / waybill number").fill("WB-VISUAL-01");
  await dialog
    .getByLabel("Delivery tracking link")
    .fill("https://track.example/WB-VISUAL-01");

  const geometry = await dialog.evaluate((dialogElement) => {
    const viewportWidth = window.innerWidth;
    const visibleControls = Array.from(
      dialogElement.querySelectorAll<HTMLElement>(
        "button, input, select, textarea",
      ),
    ).filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    return {
      horizontalOverflow: document.documentElement.scrollWidth > viewportWidth,
      clippedControls: visibleControls
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < -1 || rect.right > viewportWidth + 1;
        })
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            tag: element.tagName,
            label: element.getAttribute("aria-label") ?? element.textContent,
            left: Math.round(rect.left),
            right: Math.round(rect.right),
          };
        }),
      undersizedTargets: visibleControls.filter((element) => {
        const rect = element.getBoundingClientRect();
        return element.tagName === "BUTTON" && rect.height < 40;
      }).length,
    };
  });
  expect(geometry.horizontalOverflow).toBe(false);
  expect(geometry.clippedControls).toEqual([]);
  expect(geometry.undersizedTargets).toBeLessThanOrEqual(2);
  await dialog.getByRole("button", { name: "Create order" }).click();
  await expect(dialog).toBeHidden();
  const order = page.getByRole("listitem", { name: /VISUAL-TRACKER-01/i });
  await expect(order).toBeVisible();
  await order.getByRole("button", { name: "View order details" }).click();
  const details = page.getByRole("dialog", {
    name: /Order details.*VISUAL-TRACKER-01/i,
  });
  await expect(details.getByText("Visual QA Customer")).toBeVisible();
  await expect(
    details.getByText("WB-VISUAL-01", { exact: true }),
  ).toBeVisible();
  await details
    .getByText("Payment and commercial summary")
    .scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await page.screenshot({
    path: resolve(output, `${prefix}-03-authoritative-order-details.png`),
    fullPage: false,
  });
  testInfo.attach("geometry", {
    body: JSON.stringify(geometry, null, 2),
    contentType: "application/json",
  });
});
