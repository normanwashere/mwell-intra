import { expect, test, type Page } from "@playwright/test";
import { auditWarehouseLayout } from "../helpers/warehouseLayoutAudit";

const SESSION_KEY = "intra.memory-session.v1";

async function installWarehouseOperator(page: Page) {
  await page.addInitScript(
    ({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)),
    {
      key: SESSION_KEY,
      value: {
        profileId: "demo-warehouse-operator",
        roles: { core: ["staff"], warehouse: ["warehouse_operator"] },
      },
    },
  );
}

async function completeAssignedOrientations(page: Page) {
  const policy = page.getByRole("button", {
    name: "Start Warehouse receiving and custody policy",
  });
  for (let index = 0; index < 3 && !(await policy.isEnabled()); index += 1) {
    await page
      .locator("button:enabled")
      .filter({ hasText: /^Start Role orientation$/ })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    for (let step = 0; step < 10; step += 1) {
      const finish = dialog.getByRole("button", { name: "Finish review" });
      if (await finish.isVisible().catch(() => false)) break;
      await dialog.getByRole("button", { name: "Continue" }).click();
    }
    await dialog.getByRole("button", { name: "Finish review" }).click();
    await expect(dialog).toHaveCount(0);
  }
  await expect(policy).toBeEnabled();
}

test.describe("certified action recovery", () => {
  test("completes the controlled policy and assessment without a dead end", async ({
    page,
  }, testInfo) => {
    await installWarehouseOperator(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.goto("/onboarding");
    await completeAssignedOrientations(page);

    await page
      .getByRole("button", { name: "Start Warehouse receiving and custody policy" })
      .click();
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Version 4.2")).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Open controlled policy" })).toHaveAttribute(
      "href",
      "/knowledge?article=feature-warehouse-receiving",
    );
    const acknowledge = dialog.getByRole("button", { name: "Acknowledge policy" });
    await expect(acknowledge).toBeDisabled();
    await dialog
      .getByLabel("I have read and understand this controlled policy version.")
      .check();
    await acknowledge.click();
    await expect(dialog.getByText("Policy acknowledged")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`policy-${testInfo.project.name}.png`) });
    await dialog.getByRole("button", { name: "Close" }).click();

    await page
      .getByRole("button", { name: "Start Warehouse receiving controls knowledge check" })
      .click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Only the total delivered quantity").check();
    await dialog.getByRole("button", { name: "Next question" }).click();
    await dialog.getByLabel("Place it in available stock").check();
    await dialog.getByRole("button", { name: "Submit answers" }).click();
    await expect(dialog.getByText("Review and try again")).toBeVisible();
    await dialog.getByRole("button", { name: "Start another attempt" }).click();
    await expect(dialog.getByText("Question 1 of 2")).toBeVisible();
    await dialog.getByLabel("Delivery date, batch, and every unit serial").check();
    await dialog.getByRole("button", { name: "Next question" }).click();
    await dialog.getByLabel("Keep it in controlled quality custody").check();
    await dialog.getByRole("button", { name: "Submit answers" }).click();
    await expect(dialog.getByText("Assessment passed")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`assessment-${testInfo.project.name}.png`) });
    await dialog.getByRole("button", { name: "Close" }).click();

    await expect(
      page.getByRole("button", { name: "Start Receive and inspect controlled stock" }).first(),
    ).toBeEnabled();
    expect(pageErrors).toEqual([]);
  });

  test("blocks an uncertified live receipt and links to the exact assigned requirement", async ({
    page,
  }, testInfo) => {
    await installWarehouseOperator(page);
    const operationalWrites: string[] = [];
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => {
      if (request.method() !== "GET" && /supabase|\/rest\/v1|\/rpc\//i.test(request.url())) {
        operationalWrites.push(request.url());
      }
    });

    await page.goto("/warehouse/receiving");
    await expect(page.getByRole("heading", { name: "Receiving" })).toBeVisible();
    await page.getByLabel("Product").selectOption("smart-watch");
    await page.getByLabel("Enter barcode manually").fill("LOCK-TEST-SERIAL-001");
    await page.getByRole("button", { name: "Add", exact: true }).click();

    await expect(page.getByText("Complete onboarding before this action")).toBeVisible();
    await expect(page.getByText("Receive and inspect controlled stock")).toBeVisible();
    await expect(page.getByRole("button", { name: /Receive 1 item/ })).toHaveCount(0);
    const resume = page.getByRole("link", { name: "Resume onboarding" });
    await expect(resume).toHaveAttribute("href", "/onboarding?requirement=internal.role.warehouse.warehouse_operator.capability-practice.v1");
    expect(operationalWrites).toEqual([]);

    const receivingLayout = await auditWarehouseLayout(page);
    expect(receivingLayout.overflowElements).toEqual([]);
    expect(receivingLayout.clippedControls).toEqual([]);
    expect(receivingLayout.overlaps).toEqual([]);
    expect(receivingLayout.deadEnds).toEqual([]);
    const notifications = page.getByRole("region", { name: "Notifications" });
    const dismissNotification = notifications.locator("button");
    if (await dismissNotification.isVisible().catch(() => false)) {
      await dismissNotification.click();
      await expect(notifications).toBeEmpty();
    }
    await resume.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`locked-receiving-${testInfo.project.name}.png`),
    });

    await resume.click();
    await expect(page).toHaveURL(/\/onboarding\?requirement=internal\.role\.warehouse\.warehouse_operator\.capability-practice\.v1$/);
    await expect(page.getByRole("heading", { level: 1, name: "Role onboarding" })).toBeVisible();
    const requirement = page.locator("#onboarding-requirement-internal\\.role\\.warehouse\\.warehouse_operator\\.capability-practice\\.v1");
    await expect(requirement).toHaveAttribute("aria-current", "step");
    await expect(requirement).toBeFocused();
    await expect(
      requirement.getByRole("heading", { name: "Receive and inspect controlled stock", exact: true }),
    ).toBeVisible();
    expect(pageErrors).toEqual([]);
    expect(operationalWrites).toEqual([]);

    const onboardingLayout = await auditWarehouseLayout(page);
    expect(onboardingLayout.overflowElements).toEqual([]);
    expect(onboardingLayout.clippedControls).toEqual([]);
    expect(onboardingLayout.overlaps).toEqual([]);
    expect(onboardingLayout.deadEnds).toEqual([]);
  });
});
