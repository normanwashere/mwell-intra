import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

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

async function expectAccessibleGuide(page: Page) {
  await expect(page.locator("article h1")).toHaveCount(1);
  const geometry = await page.locator("article").evaluate((article) => {
    const targets = [...article.querySelectorAll("a, button")].filter(
      (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      },
    );
    return {
      overflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
      undersizedTargets: targets.flatMap((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width < 44 || rect.height < 44
          ? [
              {
                label: element.textContent?.trim() ?? "",
                width: rect.width,
                height: rect.height,
              },
            ]
          : [];
      }),
      unlabeledSections: [...article.querySelectorAll("section")].filter(
        (section) => !section.hasAttribute("aria-labelledby"),
      ).length,
    };
  });
  expect(geometry).toEqual({
    overflow: false,
    undersizedTargets: [],
    unlabeledSections: 0,
  });

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    axe.violations.map(({ id, impact, nodes }) => ({
      id,
      impact,
      nodes: nodes.length,
    })),
  ).toEqual([]);
}

test("role guide uses explicit operating data and safe parameter-route parents", async ({
  page,
}) => {
  await page.goto("/knowledge?article=role-warehouse_logistics_supervisor");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Warehouse logistics supervisor",
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Review inbound receipts, quality holds, count variances, and warehouse exceptions.",
    ),
  ).toBeVisible();
  await expect(page.getByText("Control inbound execution")).toBeVisible();
  await expect(
    page.locator('article a[href="/warehouse/inventory/:id"]'),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Open inventory list" }),
  ).toHaveAttribute("href", "/warehouse/inventory");
  await expectAccessibleGuide(page);
});

test("feature guide renders only explicit policy and flow relationships", async ({
  page,
}) => {
  await page.goto("/knowledge?article=feature-procurement-request-detail");

  await expect(
    page.getByRole("heading", { level: 1, name: "Purchase request detail" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Procurement policy requires threshold- and risk-appropriate sourcing, competition evidence, vendor eligibility, budget evidence, and active approval authority.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Procure to pay Guided workflow/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Vendor accreditation Guided workflow/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Identity and access Guided workflow/ }),
  ).toHaveCount(0);
  await expect(
    page.locator('article a[href="/procurement/requests/:id"]'),
  ).toHaveCount(0);
  await expect(page.getByText("Open from a record list")).toBeVisible();
  await expectAccessibleGuide(page);
});
