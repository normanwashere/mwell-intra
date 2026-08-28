import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const evidence = resolve("../../docs/evidence/2026-08-28-aug27-remediation");
const password = process.env.AUDIT_PASSWORD;
const runtimeErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = [];
  runtimeErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});

test.afterEach(async ({ page }) => {
  expect(
    runtimeErrors.get(page),
    "No uncaught browser errors during the workflow",
  ).toEqual([]);
});

async function signIn(page: Page, persona: string, destination: string) {
  expect(
    password,
    "UAT audit password must be supplied through the environment",
  ).toBeTruthy();
  await page.goto(`/login?redirect=${encodeURIComponent(destination)}`);
  await page.getByLabel("Email").fill(`intra.test.${persona}@mwell.com.ph`);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 25_000 });
  await page.goto(destination);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
}

async function capture(page: Page, info: TestInfo, name: string) {
  await mkdir(evidence, { recursive: true });
  const width = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(width.content, `${name}: no horizontal overflow`).toBeLessThanOrEqual(
    width.viewport,
  );
  const dialog = page.getByRole("dialog");
  if (await dialog.count()) {
    const box = await dialog.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
      width.viewport + 1,
    );
  }
  await page.screenshot({
    path: resolve(evidence, `${info.project.name}-${name}.png`),
    fullPage: false,
  });
}

test("Operations receiving: item selection, serial input, safe evidence and draft control", async ({
  page,
}, info) => {
  await signIn(page, "operations.associate", "/warehouse/purchase-orders");
  const card = page
    .locator("li")
    .filter({ has: page.getByRole("link", { name: "0001", exact: true }) });
  const loadPromise = page.waitForResponse(
    (response) =>
      response.url() ===
        "https://kkoitlvydytdhlpxhuah.supabase.co/rest/v1/rpc/load_receiving_draft" &&
      response.request().method() === "POST",
  );
  await card.getByRole("button", { name: /receive and inspect/i }).click();
  const loadResponse = await loadPromise;
  expect(loadResponse.ok()).toBe(true);
  const initialDraft = await loadResponse.json();
  const dialog = page.getByRole("dialog", {
    name: "Receive approved procurement PO",
  });
  await expect(
    dialog.getByText(/Loading your saved receiving progress/),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Save progress" }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("button", { name: "Upload or photograph delivery note" }),
  ).toBeVisible();
  const items = dialog.getByRole("checkbox");
  expect(await items.count()).toBeGreaterThan(0);
  await dialog
    .getByLabel("Delivery evidence URL")
    .fill("http://deliverylink.com/OTG-L");
  await expect(dialog.getByText(/Use a secure HTTPS link/)).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Confirm governed receipt" }),
  ).toBeDisabled();
  await capture(page, info, "receiving-evidence");
  await dialog.getByLabel("Delivery evidence URL").fill("");
  const scanButton = dialog
    .getByRole("button", { name: /^Scan clean serials for / })
    .first();
  await scanButton.scrollIntoViewIfNeeded();
  await scanButton.click();
  const serialInput = dialog.getByRole("textbox", {
    name: /^Serial for clean /,
  });
  await serialInput.fill("AUG27-VISUAL-PROBE");
  await serialInput.press("Enter");
  await expect(
    dialog.getByRole("textbox", { name: /^clean serials for / }).first(),
  ).toHaveValue(/AUG27-VISUAL-PROBE/);
  await capture(page, info, "receiving-serial-scanner");
  if (initialDraft.body !== null) {
    info.annotations.push({
      type: "draft-write-not-run",
      description:
        "Preserved existing tester progress; no saved draft was overwritten.",
    });
    return;
  }
  const requestHeaders = await loadResponse.request().allHeaders();
  const headers = {
    apikey: requestHeaders.apikey,
    authorization: requestHeaders.authorization,
    "Content-Profile": "warehouse",
    "Accept-Profile": "warehouse",
  };
  let savedDraft: { version: number; body: unknown } | undefined;
  try {
    const savePromise = page.waitForResponse(
      (response) =>
        response.url().endsWith("/rpc/save_receiving_draft") &&
        response.request().method() === "POST",
    );
    await dialog
      .getByRole("button", { name: "Save progress", exact: true })
      .click();
    const savedResponse = await savePromise;
    expect(savedResponse.ok()).toBe(true);
    const saved = await savedResponse.json();
    expect(saved.status).toBe("ok");
    savedDraft = saved;
    expect(saved.version).toBe(initialDraft.version + 1);
    await expect(dialog.getByText(/Your saved progress:/)).toBeVisible();
    await page.reload();
    await card.getByRole("button", { name: /receive and inspect/i }).click();
    await expect(
      dialog.getByRole("textbox", { name: /^clean serials for / }).first(),
    ).toHaveValue(/AUG27-VISUAL-PROBE/);
    await expect(dialog.getByText(/Your saved progress:/)).toBeVisible();
    await capture(page, info, "receiving-restored-progress");
  } finally {
    if (savedDraft) {
      const currentResponse = await page.request.post(loadResponse.url(), {
        headers,
        data: { p_po_id: "UAT-AUG24-PO-0001" },
      });
      expect(currentResponse.ok()).toBe(true);
      const current = await currentResponse.json();
      expect(
        current.version,
        "Do not overwrite another session's new progress during cleanup",
      ).toBe(savedDraft.version);
      expect(current.body).toEqual(savedDraft.body);
      const cleanup = await page.request.post(
        loadResponse
          .url()
          .replace("load_receiving_draft", "delete_receiving_draft"),
        {
          headers,
          data: {
            p_po_id: "UAT-AUG24-PO-0001",
            p_expected_version: savedDraft.version,
          },
        },
      );
      expect(cleanup.ok()).toBe(true);
      expect(await cleanup.json()).toMatchObject({ status: "ok", body: null });
    }
  }
  // No receipt is submitted. Cleanup discards only this test's exact draft revision.
});

test("Marketing reserves multiple purposes without gaining issue authority", async ({
  page,
}, info) => {
  await signIn(page, "marketing.events", "/warehouse/allocations");
  await expect(page.getByRole("button", { name: /^Issue$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Return$/i })).toHaveCount(0);
  await page.getByRole("button", { name: /new reservation/i }).click();
  const dialog = page.getByRole("dialog", { name: "New reservation" });
  await dialog.getByRole("button", { name: /add product/i }).click();
  await expect(dialog.getByLabel("Purpose", { exact: true })).toHaveCount(2);
  await dialog
    .getByLabel("Purpose", { exact: true })
    .nth(1)
    .selectOption("giveaway");
  await expect(
    dialog.getByRole("button", { name: "Reserve", exact: true }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Product", { exact: true })
    .nth(0)
    .selectOption("uat-aug24-power-watch");
  await dialog
    .getByLabel("Product", { exact: true })
    .nth(1)
    .selectOption("uat-aug24-prestige-ateneo");
  await expect(
    dialog.getByRole("button", { name: "Reserve", exact: true }),
  ).toBeEnabled();
  await capture(page, info, "marketing-multi-item-reservation");
});

test("Operations sees multi-item quarantine return intake", async ({
  page,
}, info) => {
  await signIn(page, "operations.associate", "/warehouse/returns");
  await page.getByRole("button", { name: "Add product", exact: true }).click();
  await page
    .getByLabel("Product", { exact: true })
    .nth(0)
    .selectOption("uat-aug24-power-watch");
  await page
    .getByLabel("Product", { exact: true })
    .nth(1)
    .selectOption("uat-aug24-generic-paperbag-white");
  await expect(
    page.getByRole("button", { name: "Record return", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText(/quarantine/i).first()).toBeVisible();
  await capture(page, info, "multi-item-return-intake");
});

test("Operations Lead reviews requested items and queue counts", async ({
  page,
}, info) => {
  await signIn(page, "operations.lead", "/warehouse/fulfillment?tab=requests");
  await expect(
    page.getByRole("group", { name: "Request counters" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /View request/ })
    .first()
    .click();
  await expect(
    page.getByRole("table", { name: "Requested items" }),
  ).toBeVisible();
  await capture(page, info, "request-review");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await page
    .getByRole("tab", { name: "Orders and events", exact: true })
    .click();
  await expect(
    page.getByRole("group", { name: "Order counters" }),
  ).toBeVisible();
  await capture(page, info, "fulfillment-queues");
});

test("Zero-quantity backorder lines and allocation quarantine match the governed flow", async ({
  page,
}, info) => {
  await signIn(page, "operations.lead", "/warehouse/fulfillment?tab=orders");
  const order = page.getByRole("listitem", {
    name: "Order UAT-AUG24-ESHOP-RECEIVED",
    exact: true,
  });
  await order
    .getByRole("button", { name: "Split backorder", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Split backorder / UAT-AUG24-ESHOP-RECEIVED",
  });
  const inputs = dialog.getByRole("spinbutton");
  expect(await inputs.count()).toBeGreaterThan(1);
  await inputs.nth(0).fill("1");
  await inputs.nth(1).fill("0");
  await expect(
    dialog.getByRole("button", { name: "Create backorder" }),
  ).toBeEnabled();
  await capture(page, info, "zero-line-backorder");
  await inputs.nth(0).fill("0");
  await expect(
    dialog.getByRole("button", { name: "Create backorder" }),
  ).toBeDisabled();
  await page.goto("/warehouse/allocations");
  await page
    .getByRole("button", { name: /^Return$/i })
    .first()
    .click();
  const intake = page.getByRole("dialog", { name: "Log return" });
  await expect(intake.getByText("Quarantine intake")).toBeVisible();
  await expect(
    intake.getByText(/Quality controls final disposition/),
  ).toBeVisible();
  await expect(
    intake.getByRole("combobox", { name: /Disposition/ }),
  ).toHaveCount(0);
  await capture(page, info, "allocation-return-quarantine");
});
