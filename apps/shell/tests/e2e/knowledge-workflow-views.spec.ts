import { expect, test } from "@playwright/test";

const MEMORY_SESSION_KEY = "intra.memory-session.v1";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ key, session }) => {
      window.sessionStorage.setItem(key, JSON.stringify(session));
    },
    {
      key: MEMORY_SESSION_KEY,
      session: {
        profileId: "demo-procurement",
        roles: {
          core: ["staff"],
          procurement: ["procurement_officer"],
        },
      },
    },
  );
});

test("desktop keeps workflow tabs, selected node, URL, and canvas synchronized", async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 0) < 640, "desktop and tablet contract");
  await page.goto("/knowledge?flow=identity-and-access&view=flow");

  const flowTab = page.getByRole("tab", { name: "Flow" });
  await expect(flowTab).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByLabel("Identity and access decision tree"),
  ).toBeVisible();
  await expect(page.getByLabel("Branch history")).toBeHidden();

  await flowTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/view=steps/);
  const stepsTab = page.getByRole("tab", { name: "Step-by-step" });
  await expect(stepsTab).toBeFocused();
  await expect(stepsTab).toHaveAttribute("aria-selected", "true");

  await page
    .getByRole("button", { name: /2 - decision Is the identity authorized/ })
    .click();
  await expect(page).toHaveURL(/step=access-authorized/);
  await expect(
    page.getByRole("heading", { name: "Is the identity authorized?" }),
  ).toBeFocused();

  await page.getByRole("tab", { name: "Roles involved" }).click();
  await expect(page).toHaveURL(/view=roles/);
  await expect(
    page.getByRole("heading", { name: "Is the identity authorized?" }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Exceptions" }).click();
  await expect(page).toHaveURL(/view=exceptions/);
  await expect(
    page.getByRole("heading", { name: "Exception and recovery points" }),
  ).toBeVisible();

  await page.getByRole("tab", { name: "Flow" }).click();
  const selectedCanvasNode = page
    .getByLabel("Identity and access decision tree")
    .locator('[aria-current="step"]');
  await expect(selectedCanvasNode).toBeVisible();
  await expect(selectedCanvasNode).toHaveCSS("transition-duration", "0s");
});

test("mobile guides a branch, preserves scroll, and restores the decision", async ({
  page,
}) => {
  test.skip((page.viewportSize()?.width ?? 0) >= 640, "mobile contract");
  await page.goto("/knowledge?flow=identity-and-access&view=flow");

  await expect(
    page.getByLabel("Identity and access decision tree"),
  ).toBeHidden();
  await expect(page.getByLabel("Branch history")).toBeVisible();
  for (const navigation of [
    page.getByRole("navigation", { name: "Workflow views" }),
    page.getByRole("navigation", { name: "Branch history" }),
  ]) {
    expect(
      await navigation.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
  }
  await expect(
    page.getByRole("heading", { name: "Is the identity authorized?" }),
  ).toBeVisible();
  await expect(page.getByText("Responsible role")).toBeVisible();

  const reject = page.getByRole("button", { name: "Not authorized" });
  const size = await reject.boundingBox();
  expect(size?.height).toBeGreaterThanOrEqual(44);
  await reject.scrollIntoViewIfNeeded();
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await reject.click();

  await expect(page).toHaveURL(
    /view=flow&branch=access-denied&step=access-denied/,
  );
  await expect(
    page.getByRole("heading", { name: "Access request escalated" }),
  ).toBeFocused();
  await expect(page.getByText("Completed: escalated")).toBeVisible();
  await expect
    .poll(async () =>
      Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore),
    )
    .toBeLessThanOrEqual(12);

  await page.getByRole("button", { name: "Backtrack" }).click();
  await expect(page).toHaveURL(
    /flow=identity-and-access&view=flow&step=access-authorized/,
  );
  await expect(page).not.toHaveURL(/branch=/);
  await expect(
    page.getByRole("heading", { name: "Is the identity authorized?" }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "Authorized", exact: true }),
  ).toBeVisible();
});
