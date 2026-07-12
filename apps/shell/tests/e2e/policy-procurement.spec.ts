import { expect, test, type Page } from "@playwright/test";

async function expectMobileActionsClearOfNavigation(page: Page) {
  if (await page.evaluate(() => window.innerWidth < 768)) {
    const action = page.locator('[data-mobile-action-bar="true"]');
    await action.waitFor();
    await action.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(100);
  }
  const geometry = await page.evaluate(() => {
    if (window.innerWidth >= 768) return { skipped: true } as const;
    const nav = document.querySelector<HTMLElement>(
      'nav[aria-label="Primary mobile"]',
    );
    const action = document.querySelector<HTMLElement>(
      '[data-mobile-action-bar="true"]',
    );
    if (!nav || !action) return null;
    const navRect = nav.getBoundingClientRect();
    const actionRect = action.getBoundingClientRect();
    return {
      skipped: false,
      actionBottom: actionRect.bottom,
      navTop: navRect.top,
    } as const;
  });
  expect(geometry).not.toBeNull();
  if (geometry?.skipped) return;
  expect(geometry?.actionBottom ?? Infinity).toBeLessThanOrEqual(
    (geometry?.navTop ?? 0) + 1,
  );
}

const SESSION_KEY = "intra.memory-session.v1";

async function installSession(
  page: Page,
  session: { profileId: string; roles: Record<string, string[]> },
) {
  await page.addInitScript(
    ({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)),
    { key: SESSION_KEY, value: session },
  );
}

async function completeRequestIntake(page: Page, amount = "999999.99") {
  await page.getByText("Goods", { exact: true }).click();
  await page.getByLabel("Title").fill("Policy routing verification");
  await page.getByLabel("Line 1 description").fill("Cold-chain supplies");
  await page.getByLabel("Line 1 unit price").fill(amount);
  await page.getByRole("button", { name: "Continue" }).click();
  await page
    .getByLabel("Need description")
    .fill("Maintain validated cold-chain operations.");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByRole("heading", { name: "Sourcing path" }),
  ).toBeVisible();
}

async function expectNoPageOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
}

test("requester supplies routing facts but cannot self-confirm the sourcing route", async ({
  page,
}) => {
  await installSession(page, {
    profileId: "demo-operations",
    roles: { core: ["staff"], procurement: ["requester"] },
  });
  await page.goto("/procurement/requests/new");
  await expectMobileActionsClearOfNavigation(page);
  await completeRequestIntake(page);

  await expect(page.getByLabel("Sourcing method")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Confirm sourcing route" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Awaiting Procurement routing" }),
  ).toBeDisabled();
  await expect(
    page.getByText("The requester supplies facts. Procurement confirms"),
  ).toBeVisible();
  await expect(page.getByLabel("Intended responses")).toHaveAttribute(
    "readonly",
    "",
  );
  await expectNoPageOverflow(page);
});

test("Procurement can confirm an evidence-ready route and sees threshold changes", async ({
  page,
}) => {
  await installSession(page, {
    profileId: "demo-procurement",
    roles: { core: ["staff"], procurement: ["procurement_officer"] },
  });
  await page.goto("/procurement/requests/new");
  await completeRequestIntake(page, "1000000");

  await expect(page.getByLabel("Sourcing method")).toBeEnabled();
  await expect(page.getByText("Competitive response record")).toBeVisible();
  await page.getByLabel("Intended responses").fill("3");
  await page.getByLabel("Vendors invited").fill("3");
  await page.getByLabel("Usable responses").fill("2");
  await expect(page.getByText("Exception required")).toBeVisible();
  await page
    .getByText(
      "Approved insufficient-bids exception is attached to the sourcing record",
      { exact: true },
    )
    .click();
  await expect(page.getByText("Ready for evaluation")).toBeVisible();

  await page.getByRole("button", { name: "Confirm sourcing route" }).click();
  await expect(page.getByText("Procurement confirmed")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save & submit for approval" }),
  ).toBeEnabled();
  await expectNoPageOverflow(page);
});
