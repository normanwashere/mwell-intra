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

test("legacy future URLs render roadmap entries", async ({ page }) => {
  await page.goto("/knowledge?type=future");

  await expect(
    page.getByRole("heading", { name: "Explore a feature" }),
  ).toBeVisible();
  await expect(page.locator("#principal-flow-title")).toBeHidden();
  await expect(
    page.getByRole("button", {
      name: /Roadmap Coming soon Offline Knowledge Base/,
    }),
  ).toBeVisible();
});

test("landing interactions preserve URL state and accessible targets", async ({
  page,
}) => {
  await page.goto("/knowledge");

  const searchSection = page.locator("#handbook-search-title");
  const flowSection = page.locator("#principal-flow-title");
  await expect(searchSection).toBeVisible();
  await expect(flowSection).toBeVisible();
  const sectionOrder = await page.evaluate(
    ([searchId, flowId]) => {
      const search = document.getElementById(searchId);
      const flows = document.getElementById(flowId);
      if (!search || !flows) return null;
      return search.compareDocumentPosition(flows);
    },
    ["handbook-search-title", "principal-flow-title"],
  );
  expect(sectionOrder).not.toBeNull();
  expect(sectionOrder! & 4).toBeTruthy();

  const recommendations = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Recommended for your work" }),
  });
  await expect(
    recommendations.getByText("Procurement officer").first(),
  ).toBeVisible();

  const roleMode = page.getByRole("button", { name: /Understand a role/ });
  await roleMode.focus();
  await page.evaluate(() => window.scrollTo(0, 700));
  const savedScroll = await page.evaluate(() => window.scrollY);
  expect(savedScroll).toBeGreaterThan(600);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/knowledge\?mode=role$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  await page.goBack();
  await expect(page).toHaveURL(/\/knowledge$/);
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(savedScroll - 20);

  const search = page.getByRole("searchbox", {
    name: "Search all handbook content",
  });
  await search.fill("Place hold");
  await expect(page).toHaveURL(/\?q=Place\+hold$/);
  await expect(flowSection).toBeHidden();
  const qualityResult = page.getByRole("button", {
    name: /Feature Live warehouse Quality control/,
  });
  await expect(qualityResult).toBeVisible();

  const clear = page.getByRole("button", { name: "Clear handbook search" });
  const box = await clear.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(44);
  expect(box?.height).toBeGreaterThanOrEqual(44);
  await qualityResult.click();
  await expect(page).toHaveURL(
    /\?q=Place\+hold&article=feature-warehouse-quality$/,
  );
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.goBack();
  await expect(page).toHaveURL(/\?q=Place\+hold$/);
  await clear.click();
  await expect(page).toHaveURL(/\/knowledge$/);

  await page.getByText("Govern and secure", { exact: true }).click();
  await page
    .getByRole("button", { name: /Identity and access 7 steps/ })
    .click();
  await expect(page).toHaveURL(
    /\?flow=identity-and-access&view=flow&step=access-authorized$/,
  );
});

test("tablet workflow carousel keeps visible card centers reachable", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "tablet-768");

  await page.goto("/knowledge");

  const carousel = page.getByTestId("principal-flow-carousel");
  const cards = carousel.getByRole("button");
  const unreachable = await cards.evaluateAll((elements) => {
    const bounds = elements[0]?.parentElement?.getBoundingClientRect();
    if (!bounds) return [];

    return elements.flatMap((element) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x < bounds.left || x > bounds.right) return [];
      const target = document.elementFromPoint(x, y);
      return target && (target === element || element.contains(target))
        ? []
        : [element.textContent?.trim() ?? "unknown workflow"];
    });
  });

  expect(unreachable).toEqual([]);
});
