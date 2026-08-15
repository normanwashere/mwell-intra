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
        roles: {
          core: ["staff"],
          warehouse: ["warehouse_operator"],
        },
      },
    },
  );
}

async function minimizeMobileCoach(page: Page) {
  const minimize = page.getByRole("button", {
    name: "Minimize training coach",
  });
  if (await minimize.isVisible().catch(() => false)) await minimize.click();
}

async function expandMobileCoach(page: Page) {
  const expand = page.getByRole("button", { name: "Expand training coach" });
  if (await expand.isVisible().catch(() => false)) await expand.click();
}

async function completeOrientationPrerequisites(page: Page) {
  const practice = page
    .getByRole("button", { name: "Start Receive and inspect controlled stock" })
    .first();
  for (let prerequisite = 0; prerequisite < 3; prerequisite += 1) {
    const policy = page.getByRole("button", {
      name: "Start Warehouse receiving and custody policy",
    });
    if (await policy.isEnabled()) break;
    await page
      .locator("button:enabled")
      .filter({ hasText: /^Start Role orientation$/ })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("button", { name: "Continue" }).click();
    await dialog.getByRole("button", { name: "Finish review" }).click();
  }
  const policy = page.getByRole("button", {
    name: "Start Warehouse receiving and custody policy",
  });
  await expect(policy).toBeEnabled();
  await policy.click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("I have read and understand this controlled policy version.")
    .check();
  await dialog.getByRole("button", { name: "Acknowledge policy" }).click();
  await expect(dialog.getByText("Policy acknowledged")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await page
    .getByRole("button", {
      name: "Start Warehouse receiving controls knowledge check",
    })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Delivery date, batch, and every unit serial")
    .check();
  await dialog.getByRole("button", { name: "Next question" }).click();
  await dialog.getByLabel("Keep it in controlled quality custody").check();
  await dialog.getByRole("button", { name: "Submit answers" }).click();
  await expect(dialog.getByText("Assessment passed")).toBeVisible();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(practice).toBeEnabled();
}

test.describe("Warehouse receiving onboarding pilot", () => {
  test.describe.configure({ mode: "serial" });

  test("practices real controls, negative paths, recovery, and certification without live writes", async ({
    page,
  }, testInfo) => {
    await installWarehouseOperator(page);
    const operationalWrites: string[] = [];
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => {
      if (
        request.method() !== "GET" &&
        /supabase|\/rest\/v1|\/rpc\//i.test(request.url())
      ) {
        operationalWrites.push(request.url());
      }
    });

    await page.goto("/onboarding");
    await expect(
      page.locator("main").getByText("Operations Associate", { exact: true }),
    ).toBeVisible();
    await completeOrientationPrerequisites(page);
    await page
      .getByRole("button", {
        name: "Start Receive and inspect controlled stock",
      })
      .first()
      .click();

    await expect(page).toHaveURL(
      /\/warehouse\/receiving\?training=warehouse-receiving-v1/,
    );
    await page.waitForTimeout(250);
    expect(pageErrors).toEqual([]);
    await expect(
      page.getByRole("region", { name: "Training mode" }),
    ).toBeVisible();
    const receiptHistoryBefore = await page
      .getByRole("list", { name: "Receipts" })
      .getByRole("listitem")
      .count()
      .catch(() => 0);

    await minimizeMobileCoach(page);
    await page.getByRole("button", { name: "Use practice order" }).click();
    await expect(
      page.getByRole("dialog").getByRole("heading", {
        name: "Record delivery details",
      }),
    ).toBeVisible();
    await minimizeMobileCoach(page);
    const deliveryDate = page.getByLabel("Actual delivery date");
    await deliveryDate.fill("2026-08-13");
    await page.getByRole("button", { name: "Confirm delivery date" }).click();
    await expect(
      page.getByRole("dialog").getByRole("heading", {
        name: "Identify the received item",
      }),
    ).toBeVisible();

    await minimizeMobileCoach(page);
    await page.getByLabel("Product").selectOption("smart-watch");
    await expect(
      page.getByRole("dialog").getByRole("heading", {
        name: "Record the supplier batch",
      }),
    ).toBeVisible();
    await minimizeMobileCoach(page);
    const batch = page.getByLabel("Batch number");
    await page.getByRole("button", { name: "Confirm batch number" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "Batch number is required" }),
    ).toBeVisible();
    await minimizeMobileCoach(page);
    await batch.fill("TRAIN-BATCH-A");
    await page.getByRole("button", { name: "Confirm batch number" }).click();
    await expect(
      page.getByRole("dialog").getByRole("heading", {
        name: "Capture unit traceability",
      }),
    ).toBeVisible();

    await minimizeMobileCoach(page);
    const serial = page.getByLabel("Enter practice serial or sheet barcode");
    const record = page.getByRole("button", { name: "Record" });
    await serial.fill("TRAIN-SERIAL-0001");
    await record.click();
    await serial.fill("TRAIN-SERIAL-0001");
    await record.click();
    await expect(
      page.getByRole("alert").filter({ hasText: "already on this receipt" }),
    ).toBeVisible();
    await minimizeMobileCoach(page);
    await serial.fill("TRAIN-SERIAL-0002");
    await record.click();
    await serial.fill("TRAIN-SERIAL-0003");
    await record.click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Quantity exceeds the purchase order" }),
    ).toBeVisible();

    await expandMobileCoach(page);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm traceability" })
      .click();
    await expect(
      page.getByRole("dialog").getByRole("heading", {
        name: "Choose controlled custody",
      }),
    ).toBeVisible();
    await minimizeMobileCoach(page);
    await page.getByLabel("Put away to").selectOption("TRAIN-QA-STAGING");
    await expect(
      page.getByRole("dialog").getByRole("heading", {
        name: "Attach delivery evidence",
      }),
    ).toBeVisible();
    await minimizeMobileCoach(page);
    await page
      .getByRole("button", { name: "Attach practice delivery photo" })
      .click();
    await page.getByRole("button", { name: "Damaged" }).click();
    await expect(
      page.getByRole("dialog").getByRole("heading", {
        name: "Review the simulated receipt",
      }),
    ).toBeVisible();

    await expandMobileCoach(page);
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Resume later" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByRole("region", { name: "Training mode" })
      .getByRole("button", { name: "Resume", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Resume receipt" })
      .click();
    await minimizeMobileCoach(page);
    await page.getByRole("button", { name: "Receive 2 item(s)" }).click();

    await expect(
      page.getByRole("dialog").getByRole("heading", {
        name: "Receiving practice complete",
      }),
    ).toBeVisible();
    await expandMobileCoach(page);
    await expect(page.getByText(/No live stock was changed/i)).toBeVisible();
    expect(operationalWrites).toEqual([]);
    const receiptHistoryAfter = await page
      .getByRole("list", { name: "Receipts" })
      .getByRole("listitem")
      .count()
      .catch(() => 0);
    expect(receiptHistoryAfter).toBe(receiptHistoryBefore);
    expect(
      await page.evaluate(() =>
        Object.keys(sessionStorage).filter((key) =>
          key.startsWith("intra-training:"),
        ),
      ),
    ).toEqual([]);

    const layout = await auditWarehouseLayout(page);
    expect(layout.overflowElements).toEqual([]);
    expect(layout.clippedControls).toEqual([]);
    expect(layout.overlaps).toEqual([]);
    expect(layout.deadEnds).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath(`receiving-pilot-${testInfo.project.name}.png`),
      fullPage: true,
    });
  });
});
